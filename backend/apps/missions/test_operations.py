"""M7: Operations run in stages, each graded like a mission of its own, on the side of the 213."""
import json
from pathlib import Path

import pytest
from django.conf import settings

from apps.content.models import Mission, Track
from apps.focus.services import open_session
from apps.game import services as game_services
from apps.game.models import Player, TimeLedger, UserBadge
from apps.missions.models import MissionProgress
from apps.missions.services import stage_view

SOLVED = json.loads((Path(settings.BASE_DIR).parent / "content" / "build" / "solved_states.json").read_text())


def url(code, tail=""):
    return f"/api/v1/missions/{code}/{tail}"


def clear_prereqs(player, code):
    for row in Mission.objects.get(code=code).prereqs.select_related("requires"):
        MissionProgress.objects.update_or_create(player=player, mission=row.requires, season=player.season, defaults={"state": "cleared", "worth": 0})


@pytest.fixture
def playing(api):
    game_services.add_time(api.user.player, 3000, TimeLedger.Reason.STREAK)
    open_session(api.user)
    return api


@pytest.fixture
def ops7(playing):
    clear_prereqs(playing.user.player, "ops-07")
    return playing


def run_python_stage(api, code, body):
    sent = api.post(url(code, "submit/"), body, format="json").json()
    assert sent["result"] == "grading"
    return api.get(f"/api/v1/missions/jobs/{sent['job']}/").json()["result"]


class TestSideTrack:
    def test_the_core_stays_at_213(self):
        assert game_services.core_mission_count() == 213
        assert Track.objects.get(code="OPS").side

    def test_there_are_twenty(self):
        assert Mission.objects.filter(track__code="OPS", status="published").count() == 20

    def test_any_opens_once_its_own_prerequisites_are_cleared(self, playing):
        clear_prereqs(playing.user.player, "ops-19")
        tracks = {t["code"]: t for t in playing.get("/api/v1/tracks/").json()["tracks"]}
        states = {m["code"]: m["state"] for m in tracks["OPS"]["missions"]}
        assert states["ops-19"] == "open"
        assert states["ops-18"] == "locked"
        assert playing.get(url("ops-19", "play/")).status_code == 200

    def test_a_locked_one_says_what_it_waits_for(self, playing):
        response = playing.get(url("ops-07", "play/"))
        assert response.status_code == 403
        assert "first" in response.json()["error"]["message"]

    def test_all_prerequisites_are_needed(self, playing):
        needed = list(Mission.objects.get(code="ops-07").prereqs.select_related("requires"))
        assert len(needed) == 2
        player = playing.user.player
        MissionProgress.objects.create(player=player, mission=needed[0].requires, season=player.season, state="cleared")
        assert playing.get(url("ops-07", "play/")).status_code == 403

    def test_clearing_one_does_not_change_your_level(self, ops7):
        player = Player.objects.get(user=ops7.user)
        self.finish_ops7(ops7)
        player.refresh_from_db()
        assert player.peak_cleared == 0

    def finish_ops7(self, api):
        api.post(url("ops-07", "submit/"), {"answer": "4"}, format="json")
        code = Mission.objects.get(code="ops-07").answer_spec["stages"][1]["solution"]
        assert run_python_stage(api, "ops-07", {"code": code, "passed": True})["result"] == "pass"


class TestStages:
    def test_only_the_current_stage_can_be_seen(self, ops7):
        body = ops7.get(url("ops-07", "play/")).json()
        assert body["stage"]["index"] == 0 and body["stage"]["total"] == 2
        assert body["check_type"] == "answer"
        text = json.dumps(body)
        assert "def missing" not in text and "tests" not in text
        assert "stages" not in text
        assert body["stage"]["names"] == ["Count the real hosts", "Find what is missing"]

    def test_nothing_private_goes_out(self, ops7):
        for path in ("", "play/"):
            text = ops7.get(url("ops-07", path)).content.decode()
            assert "answer_spec" not in text and '"solution"' not in text and '"accept"' not in text and '"expect"' not in text

    def test_a_right_answer_moves_on(self, ops7):
        response = ops7.post(url("ops-07", "submit/"), {"answer": "4"}, format="json").json()
        assert response["result"] == "stage" and response["stage"] == 1 and response["total"] == 2
        assert ops7.get(url("ops-07", "play/")).json()["check_type"] == "py"

    def test_a_wrong_answer_stays_put(self, ops7):
        assert ops7.post(url("ops-07", "submit/"), {"answer": "99"}, format="json").json()["result"] == "fail"
        assert ops7.get(url("ops-07", "play/")).json()["stage"]["index"] == 0

    def test_you_cannot_skip_a_stage(self, ops7):
        solution = Mission.objects.get(code="ops-07").answer_spec["stages"][1]["solution"]
        response = ops7.post(url("ops-07", "submit/"), {"code": solution, "passed": True, "stage": 1}, format="json")
        assert response.status_code == 400 or response.json()["result"] == "fail"
        progress = MissionProgress.objects.filter(player=ops7.user.player, mission__code="ops-07").first()
        assert progress is None or progress.stage == 0

    def test_a_forged_python_pass_gets_nothing(self, ops7):
        ops7.post(url("ops-07", "submit/"), {"answer": "4"}, format="json")
        starter = Mission.objects.get(code="ops-07").play["stages"][1]["workspace"]["python"]["starter"]
        assert run_python_stage(ops7, "ops-07", {"code": starter, "passed": True})["result"] == "fail"
        assert MissionProgress.objects.get(player=ops7.user.player, mission__code="ops-07").state == "open"

    def test_the_last_stage_solves_it_and_questions_pay_the_xp(self, ops7):
        TestSideTrack().finish_ops7(ops7)
        progress = MissionProgress.objects.get(player=ops7.user.player, mission__code="ops-07")
        assert progress.state == "solved" and progress.xp_awarded == 0
        assert ops7.get(url("ops-07", "rewind/")).status_code == 200

    def test_clean_stages_earn_the_par_bonus(self, ops7):
        TestSideTrack().finish_ops7(ops7)
        assert MissionProgress.objects.get(player=ops7.user.player, mission__code="ops-07").par_bonus > 0

    def test_a_miss_loses_the_par_bonus(self, ops7):
        ops7.post(url("ops-07", "submit/"), {"answer": "99"}, format="json")
        TestSideTrack().finish_ops7(ops7)
        assert MissionProgress.objects.get(player=ops7.user.player, mission__code="ops-07").par_bonus == 0


class TestStagesThatReplay:
    @pytest.mark.real_replay
    def test_a_machine_stage_is_replayed_too(self, playing):
        clear_prereqs(playing.user.player, "ops-13")
        playing.post(url("ops-13", "submit/"), {"answer": "build-cache"}, format="json")
        forged = {"files": {"/home/ops/ops/build-cache/a.tmp": None, "/home/ops/ops/build-cache/b.tmp": None}}
        response = playing.post(url("ops-13", "check/"), {"state": forged, "log": ["lpwd"]}, format="json")
        assert response.json()["result"] == "fail"
        assert MissionProgress.objects.get(player=playing.user.player, mission__code="ops-13").stage == 1

    @pytest.mark.real_replay
    def test_a_real_log_passes_and_moves_on(self, playing):
        clear_prereqs(playing.user.player, "ops-13")
        playing.post(url("ops-13", "submit/"), {"answer": "build-cache"}, format="json")
        solved = SOLVED["ops-13:1"]
        response = playing.post(url("ops-13", "check/"), {"state": solved, "log": solved["log"]}, format="json")
        assert response.json()["result"] == "stage", response.content

    def test_a_command_stage_refuses_the_check_endpoint(self, ops7):
        assert ops7.post(url("ops-07", "check/"), {"state": {}}, format="json").status_code == 400


class TestLabStages:
    @pytest.fixture
    def on_lab(self, playing):
        clear_prereqs(playing.user.player, "ops-17")
        playing.post(url("ops-17", "submit/"), {"answer": "203.0.113.1"}, format="json")
        return playing

    def test_it_plays_the_stages_lab(self, on_lab):
        body = on_lab.get(url("ops-17", "play/")).json()
        assert body["check_type"] == "net" and "lab" in body["workspace"]
        assert "expect" not in json.dumps(body)

    def test_work_can_be_saved(self, on_lab):
        assert on_lab.get("/api/v1/netlab/ops-17/state/").status_code == 200

    def test_the_grader_decides(self, on_lab):
        response = on_lab.post(url("ops-17", "submit/"), {"state": {"configs": {}}}, format="json")
        assert response.json()["result"] == "fail" and response.json()["goals"]

    def test_stage_view_keeps_the_assertions_on_the_server(self):
        mission = Mission.objects.get(code="ops-17")
        assert stage_view(mission, 1).expect
        assert "expect" not in json.dumps(mission.play)

    def test_fault_drills_are_for_labs(self, on_lab):
        assert on_lab.post("/api/v1/netlab/ops-17/drill/", {"faults": 1}, format="json").status_code == 400


class TestReplays:
    @pytest.fixture
    def cleared(self, api):
        player = api.user.player
        clear_prereqs(player, "ops-07")
        MissionProgress.objects.create(player=player, mission=Mission.objects.get(code="ops-07"), season=player.season, state="cleared")
        return api

    def test_any_stage_can_be_practised_with_no_session(self, cleared):
        assert cleared.get(url("ops-07", "play/") + "?stage=1").json()["stage"]["index"] == 1

    def test_practice_pays_nothing(self, cleared):
        xp = Player.objects.get(user=cleared.user).xp
        response = cleared.post(url("ops-07", "submit/"), {"answer": "4", "stage": 0}, format="json").json()
        assert response["revisit"] and response["result"] == "pass" and response["events"] == []
        assert Player.objects.get(user=cleared.user).xp == xp

    @pytest.mark.parametrize("bad", [99, -1, "1", True, None])
    def test_a_stage_that_does_not_exist_is_refused(self, cleared, bad):
        assert cleared.post(url("ops-07", "submit/"), {"answer": "4", "stage": bad}, format="json").status_code == 400

    def test_only_a_cleared_one_can_jump(self, ops7):
        assert ops7.get(url("ops-07", "play/") + "?stage=1").json()["stage"]["index"] == 0


class TestBadge:
    def test_clearing_all_of_them_earns_it(self, api):
        player = api.user.player
        for m in Mission.objects.filter(track__code="OPS"):
            MissionProgress.objects.create(player=player, mission=m, season=player.season, state="cleared")
        game_services.award_badges(player)
        assert UserBadge.objects.filter(player=player, code="tOPS").exists()


class TestEveryOperation:
    @pytest.mark.parametrize("n", range(1, 21))
    def test_it_is_well_formed(self, n):
        m = Mission.objects.get(code=f"ops-{n:02d}")
        assert m.check_type == "ops" and 2 <= len(m.play["stages"]) <= 5 and len(m.rewind) == 5
        assert m.prereqs.exists()
        for public, private in zip(m.play["stages"], m.answer_spec["stages"], strict=True):
            assert public["title"] and public["brief"] and public["goal"] and private["solution"]
            assert "answer" not in public and "solution" not in public and "expect" not in public
