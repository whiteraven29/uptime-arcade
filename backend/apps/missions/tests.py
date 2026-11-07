import json

import pytest
from django.conf import settings
from django.core.cache import cache

from apps.content.models import Mission
from apps.focus.services import open_session
from apps.game import rules, services
from apps.game.models import Player, TimeLedger, UserBadge, XPLedger
from apps.missions.grading import PlayerState, answer_matches, goals_met
from apps.missions.models import MissionProgress, Submission


def url(code, tail=""):
    return f"/api/v1/missions/{code}/{tail}"


def top_up(player, seconds=3000):
    services.add_time(player, seconds, TimeLedger.Reason.STREAK)


@pytest.fixture
def playing(api, clock):
    top_up(api.user.player)
    open_session(api.user)
    return api


def mission(code):
    return Mission.objects.get(code=code)


def solve(api, code, **extra):
    m = mission(code)
    if m.check_type in ("answer", "go-out", "go-fix"):
        return api.post(url(code, "submit/"), {"answer": m.answer_spec["accept"][0], "commands": m.par_value, **extra}, format="json")
    if m.check_type == "py":
        return api.post(url(code, "submit/"), {"code": "x = 1", "passed": True, **extra}, format="json")
    return api.post(url(code, "submit/"), {"state": _state_meeting(m), "commands": m.par_value, "keys": m.par_value, **extra}, format="json")


def _state_meeting(m):
    state = {"files": {}, "vi_keys": {}, "vi_used": {}}
    home = lambda p: "/home/ops" + p[1:] if p.startswith("~") else p
    for rule in m.expect:
        name, arg = next(iter(rule.items()))
        if name == "file_exists":
            state["files"][home(arg)] = state["files"].get(home(arg)) or {"c": "x", "m": 0o644}
        elif name == "file_missing":
            state["files"][home(arg)] = None
        elif name == "file_equals":
            state["files"][home(arg["path"])] = {"c": arg["content"], "m": 0o644}
        elif name == "file_contains":
            f = state["files"].setdefault(home(arg["path"]), {"c": "", "m": 0o644})
            f["c"] += arg["text"]
        elif name == "mode_has":
            f = state["files"].setdefault(home(arg["path"]), {"c": "", "m": 0o644})
            f["m"] = 0o755
        elif name == "cwd_is":
            state["cwd"] = home(arg)
        elif name == "gateway_is":
            state["gateway"] = arg
        elif name == "script_ran":
            state["ran_script"] = home(arg)
        elif name == "vi_saved":
            state["vi_keys"][home(arg)] = 5
        elif name == "vi_used":
            state["vi_used"][home(arg["path"])] = arg["keys"]
    return state


def right_value(task):
    return task["answer"][0] if task["type"] == "text" else task["answer"]


def wrong_value(task):
    return ["nope"] if task["type"] == "order" else "definitely wrong"


def current_task(api, code):
    """The full task from the database, the way a test may see it. The API never sends the answer."""
    m = mission(code)
    player = Player.objects.get(user=api.user)
    progress = MissionProgress.objects.get(player=player, mission=m, season=player.season)
    return m.rewind[progress.rewind.queue[0]]


def answer(api, code, value):
    return api.post(url(code, "rewind/answer/"), {"value": value}, format="json")


def clear_rewind(api, code):
    response = None
    for _ in range(5):
        response = answer(api, code, right_value(current_task(api, code)))
        assert response.json()["correct"] is True
    return response


def clear(api, code):
    cache.clear()  # long flows here would otherwise trip the 30 a minute limit, which has its own test
    assert solve(api, code).json()["result"] == "pass"
    return clear_rewind(api, code)


def leaves_no_trace_of(text, response):
    return text not in response.content.decode()


class TestNormalize:
    @pytest.mark.parametrize("sent,accept", [("  /v1/Orders ", ["/v1/orders"]), ("a   b", ["a b"]), ("'x'", ['"x"']), ("[1, 2]", ["[1,2]"])])
    def test_ignores_spacing_case_and_quote_style(self, sent, accept):
        assert answer_matches(sent, accept)

    def test_still_tells_different_answers_apart(self):
        assert not answer_matches("443", ["80"])


class TestSessionGate:
    def test_submit_needs_a_session(self, api, clock):
        response = solve(api, "net-01")
        assert response.status_code == 409 and response.json()["error"]["code"] == "no_active_session"

    def test_play_needs_a_session(self, api, clock):
        assert api.get(url("net-01", "play/")).status_code == 409

    def test_hint_needs_a_session(self, api, clock):
        assert api.post(url("net-01", "hint/")).status_code == 409

    def test_rewind_answer_needs_a_session(self, playing, clock):
        solve(playing, "net-01")
        clock.advance(seconds=99999)
        assert answer(playing, "net-01", "x").status_code == 409

    def test_an_expired_session_stops_play(self, playing, clock):
        clock.advance(seconds=99999)
        assert solve(playing, "net-01").status_code == 409


class TestUnlockRules:
    def test_each_track_opens_at_its_first_mission(self, api):
        tracks = {t["code"]: t["missions"] for t in api.get("/api/v1/tracks/").json()["tracks"]}
        for code in ("SH", "VI", "PY", "GO", "NET"):
            assert tracks[code][0]["state"] == "open"
            assert tracks[code][1]["state"] == "locked"

    def test_a_locked_mission_cant_be_read_or_played(self, playing):
        assert playing.get(url("net-02")).status_code == 403
        assert playing.get(url("net-02", "play/")).status_code == 403
        assert solve(playing, "net-02").status_code == 403
        assert playing.post(url("net-02", "hint/")).status_code == 403

    def test_solving_alone_doesnt_unlock_the_next(self, playing):
        solve(playing, "net-01")
        assert playing.get(url("net-02")).status_code == 403

    def test_clearing_unlocks_the_next(self, playing):
        response = clear(playing, "net-01")
        assert {"type": "unlocked", "mission": "net-02"} in response.json()["events"]
        assert playing.get(url("net-02")).status_code == 200

    def test_a_retired_mission_is_gone(self, playing):
        Mission.objects.filter(code="net-01").update(status="retired")
        assert playing.get(url("net-01")).status_code == 404

    def test_a_mission_code_cant_inject_anything(self, playing):
        assert playing.get(url("' OR 1=1 --")).status_code == 404


class TestBeyond:
    def test_is_locked_until_archmage(self, playing):
        tracks = {t["code"]: t["missions"] for t in playing.get("/api/v1/tracks/").json()["tracks"]}
        assert all(m["state"] == "locked" for m in tracks["BX"])
        response = playing.get(url("bx-01"))
        assert response.status_code == 403 and "Archmage" in response.json()["error"]["message"]

    def test_opens_at_archmage_one_at_a_time(self, playing):
        p = playing.user.player
        p.peak_cleared = 150
        p.save()
        assert playing.get(url("bx-01")).status_code == 200
        assert playing.get(url("bx-02")).status_code == 403

    def test_runs_from_easy_to_brainfuck_and_pays_more_each_tier(self):
        rows = list(Mission.objects.filter(track__code="BX").order_by("order").values_list("difficulty", "xp"))
        assert len(rows) == 50
        assert [rows[i][0] for i in (0, 10, 20, 30, 40)] == ["easy", "medium", "hard", "expert", "brainfuck"]
        assert [rows[i][1] for i in (0, 10, 20, 30, 40)] == [200, 300, 400, 500, 750]
        for tier in ("easy", "medium", "hard", "expert", "brainfuck"):
            assert sum(1 for d, _ in rows if d == tier) == 10

    def test_doesnt_count_towards_levels(self, playing):
        p = playing.user.player
        p.peak_cleared = 150
        p.save()
        clear(playing, "bx-01")
        p.refresh_from_db()
        assert p.peak_cleared == 150

    def test_every_core_track_gets_harder_and_only_beyond_reaches_brainfuck(self):
        core = set(Mission.objects.filter(track__after_archmage=False).values_list("difficulty", flat=True))
        assert core == {"easy", "medium", "hard", "expert"}

    def test_clearing_a_tier_earns_its_badge(self, playing):
        p = playing.user.player
        p.peak_cleared = 150
        p.save()
        last = None
        for m in Mission.objects.filter(track__code="BX", difficulty="easy").order_by("order"):
            last = clear(playing, m.code)
        assert any(e["type"] == "badge" and e["code"] == "bx1" for e in last.json()["events"])


class TestXpOnlyForTheWholeTask:
    def test_solving_pays_nothing(self, playing):
        body = solve(playing, "net-01").json()
        playing.user.player.refresh_from_db()
        assert body["result"] == "pass"
        assert body["xp_on_clear"] == 120
        assert playing.user.player.xp == 0
        assert not XPLedger.objects.filter(reason="mission").exists()

    def test_rewind_answers_pay_nothing(self, playing):
        solve(playing, "net-01")
        for _ in range(4):
            answer(playing, "net-01", right_value(current_task(playing, "net-01")))
        playing.user.player.refresh_from_db()
        assert playing.user.player.xp == 0

    def test_the_last_answer_pays_the_whole_mission(self, playing):
        body = clear(playing, "net-01").json()
        p = playing.user.player
        p.refresh_from_db()
        assert body["state"] == "cleared"
        assert body["xp"] == 120
        assert p.xp == 120
        assert {"type": "cleared", "mission": "net-01", "xp": 120} in body["events"]

    def test_pays_exactly_once(self, playing):
        clear(playing, "net-01")
        response = answer(playing, "net-01", "again")
        assert response.status_code == 409
        assert XPLedger.objects.filter(reason="mission").count() == 1

    def test_cant_solve_a_cleared_mission_again(self, playing):
        clear(playing, "net-01")
        assert solve(playing, "net-01").json()["error"]["code"] == "already_solved"

    def test_cant_solve_twice_to_reset_the_rewind(self, playing):
        solve(playing, "net-01")
        answer(playing, "net-01", right_value(current_task(playing, "net-01")))
        assert solve(playing, "net-01").status_code == 409
        progress = MissionProgress.objects.get(mission__code="net-01")
        assert progress.rewind.correct == 1

    def test_the_streak_multiplier_applies_when_it_pays(self, playing):
        p = playing.user.player
        p.streak = 4
        p.save()
        assert clear(playing, "net-01").json()["xp"] == 144  # 120 at +20%

    def test_the_new_season_replays_and_pays_again(self, playing):
        clear(playing, "net-01")
        playing.post("/api/v1/seasons/new/")
        clear(playing, "net-01")
        assert XPLedger.objects.filter(reason="mission").count() == 2

    def test_rewards_dont_depend_on_a_client_xp_value(self, playing):
        solve(playing, "net-01", xp=999999, worth=999999)
        clear_rewind(playing, "net-01")
        p = playing.user.player
        p.refresh_from_db()
        assert p.xp == 120


class TestDifficultyAndWorth:
    @pytest.mark.parametrize("code,difficulty,xp", [("sh-01", "easy", 100), ("sh-11", "medium", 130), ("sh-21", "hard", 160), ("sh-30", "expert", 200)])
    def test_core_missions(self, code, difficulty, xp):
        m = mission(code)
        assert m.difficulty == difficulty and m.xp == xp

    def test_tracks_show_difficulty(self, api):
        body = api.get("/api/v1/tracks/").json()
        assert [d["code"] for d in body["difficulties"]] == ["easy", "medium", "hard", "expert", "brainfuck"]
        assert body["tracks"][0]["missions"][0]["difficulty"] == "easy"

    def test_rewind_tasks_go_from_easy_to_hard(self):
        order = {"easy": 0, "medium": 1, "hard": 2}
        for m in Mission.objects.all():
            levels = [order[t["level"]] for t in m.rewind]
            assert levels == sorted(levels), m.code

    def test_hints_lower_what_it_pays(self, playing):
        playing.post(url("net-01", "hint/"))
        clear(playing, "net-01")
        p = playing.user.player
        p.refresh_from_db()
        assert p.xp == 100 + 20 - 15

    def test_a_mission_is_never_worth_less_than_the_minimum(self, playing):
        m = Mission.objects.get(code="net-01")
        Mission.objects.filter(pk=m.pk).update(xp=5, hints=["a", "b"])
        playing.post(url("net-01", "hint/"))
        playing.post(url("net-01", "hint/"))
        body = solve(playing, "net-01").json()
        assert body["xp_on_clear"] == rules.MIN_MISSION_XP

    def test_a_wrong_try_loses_the_first_try_bonus(self, playing):
        playing.post(url("net-01", "submit/"), {"answer": "wrong"}, format="json")
        assert solve(playing, "net-01").json()["xp_on_clear"] == 100

    def test_commands_over_par_lose_the_bonus(self, playing):
        assert solve(playing, "sh-01", commands=9).json()["xp_on_clear"] == 100

    def test_keys_over_par_lose_the_bonus(self, playing):
        m = mission("vi-01")
        assert solve(playing, "vi-01", keys=m.par_value + 1).json()["xp_on_clear"] == 100


class TestRewindHelp:
    def start(self, api):
        solve(api, "net-01")

    def task(self, api):
        return api.get(url("net-01", "rewind/")).json()["task"]

    def miss(self, api):
        return answer(api, "net-01", wrong_value(current_task(api, "net-01")))

    def test_a_task_never_carries_its_answer(self, playing):
        self.start(playing)
        for _ in range(5):
            task = self.task(playing)
            assert "answer" not in task
            answer(playing, "net-01", right_value(current_task(playing, "net-01")))

    def test_a_wrong_answer_doesnt_reveal_the_right_one(self, playing):
        self.start(playing)
        full = current_task(playing, "net-01")
        response = answer(playing, "net-01", wrong_value(full))
        body = response.json()
        assert body["correct"] is False
        assert "answer" not in body
        assert "reveal" not in body["task"]

    def test_no_hint_until_every_question_has_been_failed(self, playing):
        self.start(playing)
        for _ in range(4):
            assert "hint" not in self.miss(playing).json()["task"]
        assert "hint" in self.miss(playing).json()["task"]

    def test_the_hint_is_available_on_read_too(self, playing):
        self.start(playing)
        for _ in range(5):
            self.miss(playing)
        assert "hint" in self.task(playing)

    def test_a_right_answer_doesnt_trigger_hints_for_the_others(self, playing):
        self.start(playing)
        answer(playing, "net-01", right_value(current_task(playing, "net-01")))
        assert "hint" not in self.miss(playing).json()["task"]

    def test_the_last_question_left_gets_a_hint_once_failed(self, playing):
        self.start(playing)
        self.miss(playing)
        for _ in range(4):
            answer(playing, "net-01", right_value(current_task(playing, "net-01")))
        assert "hint" in self.task(playing)

    def test_the_answer_shows_after_three_misses_so_nobody_is_stuck(self, playing):
        self.start(playing)
        for _ in range(15):
            self.miss(playing)
        task = self.task(playing)
        assert "reveal" in task
        assert answer(playing, "net-01", task["reveal"]).json()["correct"] is True

    def test_two_misses_arent_enough_to_see_it(self, playing):
        self.start(playing)
        for _ in range(10):
            self.miss(playing)
        assert "reveal" not in self.task(playing)

    def test_the_rewind_cant_be_read_before_solving(self, playing):
        response = playing.get(url("net-01", "rewind/"))
        assert response.status_code == 403
        assert answer(playing, "net-01", "x").status_code == 409

    def test_order_questions_dont_leak_their_order(self, playing):
        for m in Mission.objects.all():
            for t in m.rewind:
                if t["type"] == "order":
                    assert "items" not in t

    @pytest.mark.parametrize("bad", [None, 5, {"a": 1}, ["x"] * 51, "x" * 2001])
    def test_rejects_junk_answers(self, playing, bad):
        self.start(playing)
        assert answer(playing, "net-01", bad).status_code == 400
        assert MissionProgress.objects.get(mission__code="net-01").rewind.misses == {}


class TestAnswersStayOnTheServer:
    SECRET = ["answer_spec", "expect", "debrief", "rewind", "accept", "solution", "prints"]

    def check_keys(self, data):
        text = json.dumps(data)
        for word in self.SECRET:
            assert f'"{word}"' not in text, word

    def test_tracks_list(self, api):
        self.check_keys(api.get("/api/v1/tracks/").json())

    def test_every_briefing_and_play_payload(self, api, clock):
        p = api.user.player
        p.peak_cleared = 150
        p.save()
        top_up(p)
        open_session(api.user)
        for m in Mission.objects.filter(order=1).select_related("track"):
            for tail in ("", "play/"):
                response = api.get(url(m.code, tail))
                assert response.status_code == 200, m.code
                self.check_keys(response.json())
                if len(m.debrief["solution"]) > 30:
                    assert m.debrief["solution"] not in response.content.decode()

    def test_a_go_fix_program_keeps_its_blank(self, playing):
        m = mission("go-08")
        assert "____" in m.play["go"]["program"]
        assert "prints" not in m.play["go"]
        assert m.answer_spec["accept"][0] not in m.play["go"]["program"]

    def test_a_wrong_submission_says_only_that_it_was_wrong(self, playing):
        response = playing.post(url("net-01", "submit/"), {"answer": "wrong"}, format="json")
        assert set(response.json()) == {"result", "tries", "events"}

    def test_hints_arent_sent_before_they_are_paid_for(self, playing):
        m = mission("net-01")
        body = playing.get(url("net-01", "play/")).json()
        assert body["hints"] == []
        assert m.hints[0] not in json.dumps(body)
        playing.post(url("net-01", "hint/"))
        assert playing.get(url("net-01", "play/")).json()["hints"] == [m.hints[0]]

    def test_the_debrief_waits_until_solved(self, playing):
        assert playing.get(url("net-01", "debrief/")).status_code == 403
        solve(playing, "net-01")
        assert playing.get(url("net-01", "debrief/")).json()["solution"]


class TestPlayerStateGoals:
    def test_all_real_goals_pass_with_a_state_that_meets_them(self):
        for m in Mission.objects.exclude(expect=[]):
            assert goals_met(m.expect, _state_meeting(m)), m.code

    def test_an_empty_state_meets_no_mission_that_changes_anything(self):
        for m in Mission.objects.exclude(expect=[]):
            needs_change = any(next(iter(r)) in ("file_exists", "file_equals", "cwd_is", "gateway_is", "script_ran", "vi_saved") for r in m.expect)
            if needs_change and m.code not in ("sh-07", "sh-18"):
                assert not goals_met(m.expect, {}), m.code

    def test_a_file_deleted_by_the_player_counts_as_missing(self):
        assert goals_met([{"file_missing": "/home/ops/README"}], {"files": {"/home/ops/README": None}})

    def test_a_starting_file_exists_until_it_is_deleted(self):
        assert goals_met([{"file_exists": "~/README"}], {})
        assert not goals_met([{"file_missing": "~/README"}], {})

    def test_a_folder_in_the_starting_tree_exists(self):
        assert goals_met([{"file_exists": "~/logs"}], {})

    def test_an_unknown_rule_never_passes(self):
        assert not goals_met([{"run_this": "x"}], {})

    def test_fs_submission_passes_and_fails_on_the_goal(self, playing):
        for code in ("sh-01", "sh-02", "sh-03", "sh-04"):
            clear(playing, code)
        fail = playing.post(url("sh-05", "submit/"), {"state": {"files": {}}}, format="json")
        assert fail.json()["result"] == "fail"
        ok = playing.post(url("sh-05", "submit/"), {"state": {"files": {"/home/ops/work/today/notes.txt": {"c": "", "m": 420}}}}, format="json")
        assert ok.json()["result"] == "pass"

    @pytest.mark.parametrize("state", [{"files": {"relative/path": {"c": "x"}}}, {"files": {"/a": {"m": 99999999}}}, {"files": {"/a": "not an object"}}, {"files": "nope"}, {"vi_keys": {"/a": -1}}])
    def test_rejects_malformed_state(self, playing, state):
        m = mission("sh-02")
        clear(playing, "sh-01")
        response = playing.post(url(m.code, "submit/"), {"state": state}, format="json")
        assert response.status_code == 400

    def test_doesnt_keep_whole_file_trees(self, playing):
        clear(playing, "sh-01")
        playing.post(url("sh-02", "submit/"), {"state": {"cwd": "/home/ops/logs", "files": {"/home/ops/secret": {"c": "private"}}}}, format="json")
        row = Submission.objects.filter(progress__mission__code="sh-02").first()
        assert "files" not in row.payload


class TestGoalChecks:
    def test_not_there_yet_costs_nothing_and_leaves_no_record(self, playing):
        clear(playing, "sh-01")
        for _ in range(3):
            response = playing.post(url("sh-02", "check/"), {"state": {"cwd": "/etc"}}, format="json")
            assert response.json()["result"] == "fail"
        progress = MissionProgress.objects.get(mission__code="sh-02")
        assert progress.tries == 0
        assert progress.submissions.count() == 0

    def test_passes_when_the_goal_is_met(self, playing):
        clear(playing, "sh-01")
        response = playing.post(url("sh-02", "check/"), {"state": {"cwd": "/home/ops/logs"}, "commands": 3}, format="json")
        assert response.json()["result"] == "pass"
        assert response.json()["par_bonus"] == 20

    def test_needs_a_session(self, api, clock):
        assert api.post(url("vi-01", "check/"), {"state": {}}, format="json").status_code == 409

    def test_cant_be_used_to_guess_an_answer(self, playing):
        response = playing.post(url("net-01", "check/"), {"answer": "32"}, format="json")
        assert response.status_code == 400
        assert MissionProgress.objects.filter(mission__code="net-01", state="solved").count() == 0

    def test_a_locked_mission_stays_locked(self, playing):
        assert playing.post(url("sh-05", "check/"), {"state": {}}, format="json").status_code == 403

    def test_has_room_for_checking_after_every_command(self, playing):
        clear(playing, "sh-01")
        cache.clear()
        codes = [playing.post(url("sh-02", "check/"), {"state": {"cwd": "/tmp"}}, format="json").status_code for _ in range(121)]
        assert codes[119] == 200 and codes[120] == 429


class TestServerAgreesWithTheEngines:
    """Only the server decides now, so a disagreement would leave a player stuck on a mission they solved.
    These states come from the real engines, playing the real solutions (tools/verify_content.mjs)."""

    def states(self):
        path = settings.CONTENT_DIR / "build" / "solved_states.json"
        if not path.exists():
            pytest.skip("run tools/verify_content.mjs first, as make check does")
        return json.loads(path.read_text())

    def test_every_goal_mission_passes_with_its_real_final_state(self):
        states = self.states()
        for m in Mission.objects.exclude(expect=[]):
            assert m.code in states, m.code
            body = PlayerState(data=states[m.code])
            assert body.is_valid(), (m.code, body.errors)
            assert goals_met(m.expect, body.validated_data), m.code

    def test_the_final_state_fits_in_one_request(self):
        for code, state in self.states().items():
            assert len(json.dumps({"state": state})) < settings.DATA_UPLOAD_MAX_MEMORY_SIZE, code


class TestPythonMissions:
    def test_stores_the_code_and_trusts_the_browser_for_now(self, playing):
        response = playing.post(url("py-01", "submit/"), {"code": 'print("x")', "passed": True}, format="json")
        assert response.json()["result"] == "pass"
        assert Submission.objects.get(progress__mission__code="py-01").payload["code"] == 'print("x")'

    def test_a_failed_run_isnt_a_pass(self, playing):
        assert playing.post(url("py-01", "submit/"), {"code": "x", "passed": False}, format="json").json()["result"] == "fail"

    def test_needs_real_values(self, playing):
        assert playing.post(url("py-01", "submit/"), {"code": "x", "passed": "yes"}, format="json").status_code == 400
        assert playing.post(url("py-01", "submit/"), {"code": "x" * 20001, "passed": True}, format="json").status_code == 400


class TestIsolation:
    def test_my_progress_isnt_yours(self, playing, other_api):
        clear(playing, "net-01")
        tracks = {t["code"]: t["missions"] for t in other_api.get("/api/v1/tracks/").json()["tracks"]}
        assert tracks["NET"][0]["state"] == "open"
        assert tracks["NET"][1]["state"] == "locked"
        assert other_api.get(url("net-01", "debrief/")).status_code == 403


class TestRateLimit:
    def test_stops_brute_forcing_answers(self, playing):
        codes = [playing.post(url("net-01", "submit/"), {"answer": f"guess-{i}"}, format="json").status_code for i in range(31)]
        assert codes[:30] == [200] * 30
        assert codes[30] == 429

    @pytest.mark.parametrize("payload", [{"answer": 5}, {"answer": ""}, {"answer": "x" * 2001}, {"commands": "lots", "answer": "1"}, {"commands": -1, "answer": "1"}, {"commands": True, "answer": "1"}])
    def test_rejects_bad_submissions(self, playing, payload):
        assert playing.post(url("net-01", "submit/"), payload, format="json").status_code == 400

    def test_rejects_a_body_that_isnt_an_object(self, playing):
        assert playing.post(url("net-01", "submit/"), [1, 2], format="json").status_code == 400


class TestProgressEvents:
    def test_level_up_comes_with_its_badge(self, playing):
        p = playing.user.player
        p.peak_cleared = 7
        p.save()
        body = clear(playing, "net-01").json()
        # One cleared this season, so peak stays at 7: a season can't inflate your count.
        assert all(e["type"] != "level_up" for e in body["events"])
        for code in ("net-02", "net-03", "net-04", "net-05", "net-06", "net-07", "net-08"):
            body = clear(playing, code).json()
        assert {"type": "level_up", "level": 2, "title": "Initiate"} in body["events"]
        assert {"type": "badge", "code": "lv2", "name": "Initiate"} in body["events"]
        assert UserBadge.objects.filter(player=p, code="lv2").exists()

    def test_first_clear_badge(self, playing):
        body = clear(playing, "net-01").json()
        assert {"type": "badge", "code": "first", "name": "First Clear"} in body["events"]

    def test_a_clean_chapter_earns_no_hints_needed(self, playing):
        body = None
        for code in ("net-01", "net-02", "net-03"):
            body = clear(playing, code).json()
        assert any(e.get("code") == "nohints" for e in body["events"])

    def test_a_hint_costs_you_no_hints_needed(self, playing):
        playing.post(url("net-01", "hint/"))
        body = None
        for code in ("net-01", "net-02", "net-03"):
            body = clear(playing, code).json()
        assert not any(e.get("code") == "nohints" for e in body["events"])

    def test_the_new_season_resets_progress_but_not_the_title(self, playing):
        clear(playing, "net-01")
        p = playing.user.player
        p.refresh_from_db()
        peak = p.peak_cleared
        playing.post("/api/v1/seasons/new/")
        tracks = {t["code"]: t["missions"] for t in playing.get("/api/v1/tracks/").json()["tracks"]}
        assert tracks["NET"][0]["state"] == "open"
        p.refresh_from_db()
        assert p.peak_cleared == peak
