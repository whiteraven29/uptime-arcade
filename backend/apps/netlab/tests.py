import json

import pytest
from django.conf import settings

from apps.content.models import Mission, MissionPrereq
from apps.focus.services import open_session
from apps.game import services
from apps.game.models import TimeLedger
from apps.missions.models import MissionProgress
from apps.netlab import grader
from apps.netlab.models import LabState


def url(code, tail=""):
    return f"/api/v1/missions/{code}/{tail}"


def state_url(code):
    return f"/api/v1/netlab/{code}/state/"


def solved():
    return json.loads((settings.CONTENT_DIR / "build" / "solved_states.json").read_text())


def lab(code):
    return Mission.objects.get(code=code)


def open_lab(player, code):
    """Clears what the lab needs, so a test can get straight to it."""
    m = lab(code)
    needed = [m.prereqs.first().requires] + list(Mission.objects.filter(track=m.track, order__lt=m.order)) + [lab("net-05")]
    for mission in needed:
        MissionProgress.objects.get_or_create(player=player, mission=mission, season=player.season, defaults={"state": "cleared"})


@pytest.fixture
def playing(api, clock):
    services.add_time(api.user.player, 3000, TimeLedger.Reason.STREAK)
    open_session(api.user)
    return api


@pytest.fixture
def ready(playing):
    open_lab(playing.user.player, "lab-07")
    return playing


class TestContent:
    def test_every_lab_opens_from_a_networking_mission(self):
        labs = Mission.objects.filter(track__code="LAB")
        assert labs.count() == 44
        for m in labs:
            needed = MissionPrereq.objects.get(mission=m).requires
            assert needed.track.code == "NET", m.code

    def test_the_labs_cover_what_the_job_is(self):
        chapters = set(Mission.objects.filter(track__code="LAB").values_list("chapter__name", flat=True))
        assert {"VLANs", "Services", "Security", "Firewalls", "Wireless", "IPv6", "Dynamic routing", "VPNs", "Capstones"} <= chapters


class TestWhatTheBrowserSees:
    def test_gets_the_topology_and_what_each_goal_says(self, ready):
        body = ready.get(url("lab-07", "play/")).json()
        assert {d["name"] for d in body["workspace"]["lab"]["devices"]} == {"PC-HQ", "R-HQ", "R-MBA", "PC-MBA"}
        assert body["workspace"]["goals"][0] == "R-HQ has a route to the branch"

    def test_never_gets_how_a_goal_is_tested(self, ready):
        text = ready.get(url("lab-07", "play/")).content.decode() + ready.get(url("lab-07")).content.decode()
        for secret in ('"expect"', '"via"', '"reach"', lab("lab-07").debrief["solution"], "10.40.9.0 255.255.255.0 10.40.8.2"):
            assert secret not in text


class TestLabsWithWiring:
    def test_a_lab_with_wiring_needs_its_cables(self, playing):
        open_lab(playing.user.player, "lab-09")
        state = solved()["lab-09"]["state"]
        unplugged = {**state, "cables": [c for c in state["cables"] if "FL2" not in (c[0], c[2]) or "FL1" not in (c[0], c[2])]}
        assert len(unplugged["cables"]) == len(state["cables"]) - 1
        body = playing.post(url("lab-09", "submit/"), {"state": unplugged}, format="json").json()
        assert body["result"] == "fail"
        assert playing.post(url("lab-09", "submit/"), {"state": state}, format="json").json()["result"] == "pass"

    def test_these_labs_start_with_something_to_plug_in(self):
        for code in ("lab-01", "lab-02", "lab-04", "lab-06", "lab-09", "lab-12", "lab-14", "lab-25", "lab-33", "lab-35"):
            assert lab(code).play["lab"].get("cabling") is True, code
            assert "[cable]" in lab(code).debrief["solution"], code


class TestGrading:
    def test_every_solution_passes_on_the_real_grader(self):
        states = solved()
        for m in Mission.objects.filter(check_type="net"):
            results = grader.grade(m.play["lab"], m.expect, grader.clean_state(states[m.code]["state"], m.play["lab"]))
            assert all(g["ok"] for g in results), (m.code, [g for g in results if not g["ok"]])

    def test_no_lab_passes_untouched(self):
        for m in Mission.objects.filter(check_type="net"):
            assert not all(g["ok"] for g in grader.grade(m.play["lab"], m.expect, {"devices": {}})), m.code

    def test_a_failed_check_says_why_and_costs_nothing(self, ready):
        response = ready.post(url("lab-07", "submit/"), {"state": {"devices": {}}, "commands": 3}, format="json").json()
        assert response["result"] == "fail" and response["tries"] == 0
        assert [g["label"] for g in response["goals"]][0] == "R-HQ has a route to the branch"
        assert "no route" in response["goals"][0]["why"]
        assert not MissionProgress.objects.filter(mission=lab("lab-07"), state="solved").exists()

    def test_the_real_configs_pass_and_solve_it(self, ready):
        body = ready.post(url("lab-07", "submit/"), {"state": solved()["lab-07"]["state"], "commands": 5}, format="json").json()
        assert body["result"] == "pass" and all(g["ok"] for g in body["goals"])
        assert body["par_bonus"] == 20
        assert MissionProgress.objects.get(mission=lab("lab-07"), player=ready.user.player).state == "solved"

    @pytest.mark.parametrize("claim", [
        {"state": {"devices": {}}, "passed": True},
        {"state": {"devices": {}}, "result": "pass", "goals": [{"label": "x", "ok": True}]},
        {"state": {"devices": {}, "passed": True}},
    ])
    def test_saying_it_passed_changes_nothing(self, ready, claim):
        assert ready.post(url("lab-07", "submit/"), claim, format="json").json()["result"] == "fail"

    def test_what_a_client_says_about_a_locked_device_is_ignored(self, playing):
        open_lab(playing.user.player, "lab-18")
        m = lab("lab-18")
        state = json.loads(json.dumps(solved()["lab-18"]["state"]))
        state["devices"]["ISP"] = {"running": "interface Gi0/0\n shutdown", "startup": ""}
        assert playing.post(url("lab-18", "submit/"), {"state": state}, format="json").json()["result"] == "pass"
        assert "ISP" not in grader.clean_state(state, m.play["lab"])["devices"]

    def test_cables_only_count_in_a_lab_about_cables(self, ready):
        # Lab 7's cables are fixed, so claiming they've been unplugged or moved changes nothing.
        state = {**solved()["lab-07"]["state"], "cables": []}
        assert ready.post(url("lab-07", "submit/"), {"state": state}, format="json").json()["result"] == "pass"

    @pytest.mark.parametrize("state", [
        None,
        "x",
        [],
        {"devices": "x"},
        {"devices": {"R-HQ": {"running": "x" * (grader.MAX_DEVICE_CONFIG + 1)}}},
        {"devices": {"R-HQ": {"running": 7}}},
        {"cables": "x"},
        {"cables": [["a"]]},
        {"cables": [[1, 2, 3, 4]]},
        {"cables": [["a", "b", "c", "d"]] * 65},
    ])
    def test_a_bad_shape_is_refused_before_anything_runs(self, ready, state, monkeypatch):
        def never(*a, **k):
            raise AssertionError("the grader should not have run")

        monkeypatch.setattr("subprocess.run", never)
        assert ready.post(url("lab-07", "submit/"), {"state": state}, format="json").status_code == 400

    def test_rubbish_in_a_config_just_fails(self, ready):
        state = {"devices": {"R-HQ": {"running": "ip route x\n\x00\n`rm -rf /`\n$(id)\n" * 50, "startup": ""}}}
        response = ready.post(url("lab-07", "submit/"), {"state": state}, format="json")
        assert response.status_code == 200 and response.json()["result"] == "fail"

    def test_an_unknown_device_is_dropped(self, ready):
        state = {"devices": {"NOPE": {"running": "x", "startup": ""}}}
        assert ready.post(url("lab-07", "submit/"), {"state": state}, format="json").json()["result"] == "fail"

    def test_if_the_grader_cant_run_nothing_passes(self, ready, settings):
        settings.NODE_BINARY = "/nonexistent/node"
        response = ready.post(url("lab-07", "submit/"), {"state": solved()["lab-07"]["state"]}, format="json")
        assert response.status_code == 503 and response.json()["error"]["code"] == "grader_unavailable"
        assert not MissionProgress.objects.filter(mission=lab("lab-07"), state="solved").exists()

    def test_needs_a_session(self, api, clock):
        open_lab(api.user.player, "lab-07")
        assert api.post(url("lab-07", "submit/"), {"state": {}}, format="json").status_code == 409

    def test_a_revisit_still_checks_and_changes_nothing(self, ready):
        p = ready.user.player
        MissionProgress.objects.create(player=p, mission=lab("lab-07"), season=p.season, state="cleared")
        before = p.xp
        body = ready.post(url("lab-07", "submit/"), {"state": solved()["lab-07"]["state"]}, format="json").json()
        assert body["revisit"] is True and body["result"] == "pass"
        p.refresh_from_db()
        assert p.xp == before


class TestSavedState:
    STATE = {"devices": {"R-HQ": {"running": "hostname A", "startup": ""}}}

    def test_starts_empty(self, ready):
        assert ready.get(state_url("lab-07")).json() == {"state": None}

    def test_comes_back_as_saved(self, ready):
        assert ready.put(state_url("lab-07"), {"state": self.STATE}, format="json").status_code == 200
        assert ready.get(state_url("lab-07")).json()["state"] == self.STATE

    def test_replaces_rather_than_piles_up(self, ready):
        ready.put(state_url("lab-07"), {"state": self.STATE}, format="json")
        ready.put(state_url("lab-07"), {"state": self.STATE}, format="json")
        assert LabState.objects.count() == 1

    def test_can_be_reset(self, ready):
        ready.put(state_url("lab-07"), {"state": self.STATE}, format="json")
        assert ready.delete(state_url("lab-07")).status_code == 204
        assert ready.get(state_url("lab-07")).json() == {"state": None}

    def test_is_private(self, ready, other_api):
        ready.put(state_url("lab-07"), {"state": self.STATE}, format="json")
        open_lab(other_api.user.player, "lab-07")
        assert other_api.get(state_url("lab-07")).json() == {"state": None}

    def test_stays_locked_with_its_lab(self, playing):
        assert playing.get(state_url("lab-07")).status_code == 403
        assert playing.put(state_url("lab-07"), {"state": self.STATE}, format="json").status_code == 403

    def test_needs_a_session_to_change(self, api, clock):
        open_lab(api.user.player, "lab-07")
        assert api.put(state_url("lab-07"), {"state": self.STATE}, format="json").status_code == 409

    def test_only_labs_have_one(self, playing):
        assert playing.get(state_url("net-01")).status_code == 400

    def test_refuses_a_huge_config(self, ready):
        big = {"devices": {"R-HQ": {"running": "x" * (grader.MAX_DEVICE_CONFIG + 1)}}}
        assert ready.put(state_url("lab-07"), {"state": big}, format="json").status_code == 400

    def test_cant_save_for_a_locked_device(self, playing):
        open_lab(playing.user.player, "lab-18")
        state = {"devices": {"ISP": {"running": "x", "startup": ""}}}
        playing.put(state_url("lab-18"), {"state": state}, format="json")
        assert playing.get(state_url("lab-18")).json()["state"]["devices"] == {}

    def test_goes_with_the_account(self, ready):
        ready.put(state_url("lab-07"), {"state": self.STATE}, format="json")
        ready.user.delete()
        assert not LabState.objects.exists()


def finish_questions(api, code):
    """Answers a solved mission's questions with the right answers, and returns the last response."""
    from apps.missions.tests import right_value

    m = lab(code)
    last = None
    for _ in range(20):
        task = api.get(url(code, "rewind/")).json()["task"]
        match = next(t for t in m.rewind if t["q"] == task["q"])
        last = api.post(url(code, "rewind/answer/"), {"value": right_value(match)}, format="json").json()
        if last.get("state") == "cleared":
            return last
    raise AssertionError("the questions never finished")


class TestVisibleUnlocks:
    def clear_net(self, api, code):
        m = lab(code)
        assert api.post(url(code, "submit/"), {"answer": m.answer_spec["accept"][0]}, format="json").json()["result"] == "pass"
        return finish_questions(api, code)["events"]

    def clear_lab(self, api, code):
        assert api.post(url(code, "submit/"), {"state": solved()[code]["state"]}, format="json").json()["result"] == "pass"
        return finish_questions(api, code)["events"]

    def unlocked(self, events):
        return {e["mission"]: e for e in events if e["type"] == "unlocked"}

    def walk_up_to(self, player, code):
        """Clears every mission before this one in its own track, and nothing else."""
        m = lab(code)
        for before in Mission.objects.filter(track=m.track, order__lt=m.order):
            MissionProgress.objects.get_or_create(player=player, mission=before, season=player.season, defaults={"state": "cleared"})

    def test_a_lab_that_still_waits_isnt_called_unlocked(self, playing):
        p = playing.user.player
        MissionProgress.objects.create(player=p, mission=lab("net-05"), season=p.season, state="cleared")
        events = self.clear_lab(playing, "lab-01")
        assert "lab-02" not in self.unlocked(events)
        waiting = next(e for e in events if e["type"] == "lab_waiting")
        assert waiting["mission"] == "lab-02" and waiting["needs"] == "net-31" and waiting["needs_title"] == "How a switch learns"

    def test_clearing_the_mission_it_waits_for_opens_it(self, playing):
        p = playing.user.player
        self.walk_up_to(p, "net-31")
        for code in ("net-05", "lab-01"):
            MissionProgress.objects.get_or_create(player=p, mission=lab(code), season=p.season, defaults={"state": "cleared"})
        opened = self.unlocked(self.clear_net(playing, "net-31"))
        assert set(opened) == {"net-32", "lab-02"}
        assert "preview" not in opened["net-32"]
        assert {d["name"] for d in opened["lab-02"]["preview"]["devices"]} == {"PC-1", "PC-2", "SW1"}

    def test_that_mission_opens_nothing_if_the_lab_before_isnt_done(self, playing):
        p = playing.user.player
        self.walk_up_to(p, "net-31")
        assert set(self.unlocked(self.clear_net(playing, "net-31"))) == {"net-32"}

    def test_the_lab_before_opens_it_if_the_mission_is_already_done(self, playing):
        p = playing.user.player
        for code in ("net-05", "net-31"):
            MissionProgress.objects.create(player=p, mission=lab(code), season=p.season, state="cleared")
        events = self.clear_lab(playing, "lab-01")
        assert set(self.unlocked(events)) == {"lab-02"}
        assert not [e for e in events if e["type"] == "lab_waiting"]

    def test_the_first_lab_opens_from_its_mission(self, playing):
        p = playing.user.player
        self.walk_up_to(p, "net-05")
        assert set(self.unlocked(self.clear_net(playing, "net-05"))) == {"net-06", "lab-01"}

    def test_a_preview_only_says_where_things_are(self, playing):
        p = playing.user.player
        self.walk_up_to(p, "net-05")
        preview = self.unlocked(self.clear_net(playing, "net-05"))["lab-01"]["preview"]
        for device in preview["devices"]:
            assert set(device) == {"name", "kind", "x", "y"}
        assert set(preview) == {"devices", "cables"}

    def test_a_preview_gives_no_config_away(self):
        from apps.missions.services import _lab_preview

        text = json.dumps(_lab_preview(lab("lab-22")))
        assert "config" not in text and "access-list" not in text and "10.40" not in text


class TestFreeLabReplays:
    def test_a_cleared_lab_needs_no_session_or_play_time(self, api, clock):
        p = api.user.player
        open_lab(p, "lab-07")
        MissionProgress.objects.create(player=p, mission=lab("lab-07"), season=p.season, state="cleared")
        services.add_time(p, -p.bank(), TimeLedger.Reason.SESSION_OPEN)
        assert api.get(url("lab-07", "play/")).status_code == 200
        before = p.bank()
        body = api.post(url("lab-07", "submit/"), {"state": solved()["lab-07"]["state"]}, format="json").json()
        assert body["result"] == "pass" and body["revisit"] is True
        assert p.bank() == before


class TestFaultDrills:
    @pytest.fixture
    def cleared(self, api, clock):
        p = api.user.player
        open_lab(p, "lab-21")
        MissionProgress.objects.create(player=p, mission=lab("lab-21"), season=p.season, state="cleared")
        return api

    def drill_url(self, code="lab-21"):
        return f"/api/v1/netlab/{code}/drill/"

    def test_breaks_a_working_lab_that_a_check_then_fails(self, cleared):
        body = cleared.post(self.drill_url(), {"faults": 1}, format="json").json()
        assert body["count"] == 1
        result = cleared.post(url("lab-21", "submit/"), {"state": body["state"]}, format="json").json()
        assert result["revisit"] is True and result["result"] == "fail"

    def test_never_says_what_broke_until_asked(self, cleared):
        response = cleared.post(self.drill_url(), {"faults": 1}, format="json")
        assert "explain" not in response.content.decode() and "faults" not in response.json()
        faults = cleared.get(self.drill_url()).json()["faults"]
        assert len(faults) == 1 and faults[0]["explain"]

    def test_can_be_stacked_but_not_endlessly(self, cleared):
        assert cleared.post(self.drill_url(), {"faults": 3}, format="json").json()["count"] >= 2
        for bad in (0, 4, True, "2"):
            assert cleared.post(self.drill_url(), {"faults": bad}, format="json").status_code == 400

    def test_costs_nothing_and_earns_nothing(self, cleared):
        p = cleared.user.player
        before = (p.bank(), p.xp)
        body = cleared.post(self.drill_url(), {"faults": 1}, format="json").json()
        cleared.post(url("lab-21", "submit/"), {"state": body["state"]}, format="json")
        cleared.post(url("lab-21", "submit/"), {"state": solved()["lab-21"]["state"]}, format="json")
        p.refresh_from_db()
        assert (p.bank(), p.xp) == before

    def test_needs_the_lab_cleared_first(self, playing):
        open_lab(playing.user.player, "lab-21")
        assert playing.post(self.drill_url(), {"faults": 1}, format="json").status_code == 403

    def test_a_lab_about_settings_has_nothing_to_break(self, api, clock):
        p = api.user.player
        open_lab(p, "lab-03")
        MissionProgress.objects.create(player=p, mission=lab("lab-03"), season=p.season, state="cleared")
        response = api.post(self.drill_url("lab-03"), {"faults": 1}, format="json")
        assert response.status_code == 409 and response.json()["error"]["code"] == "nothing_to_break"

    def test_waits_for_a_focus_block(self, cleared):
        cleared.post("/api/v1/focus/blocks/", {"goal": "x", "minutes": 25}, format="json")
        assert cleared.post(self.drill_url(), {"faults": 1}, format="json").status_code == 409

    def test_is_private(self, cleared, other_api):
        cleared.post(self.drill_url(), {"faults": 1}, format="json")
        p = other_api.user.player
        open_lab(p, "lab-21")
        MissionProgress.objects.create(player=p, mission=lab("lab-21"), season=p.season, state="cleared")
        assert other_api.get(self.drill_url()).status_code == 404

    def test_every_lab_with_something_to_break_can_be_drilled(self, cleared):
        for m in Mission.objects.filter(check_type="net"):
            functional = [g for g in m.expect if "saved" not in g and "config" not in g]
            if not functional:
                continue
            result = grader.drill(m, 1)
            assert result["faults"], m.code
            graded = grader.grade(m.play["lab"], m.expect, grader.clean_state(result["state"], m.play["lab"]))
            assert not all(g["ok"] for g in graded), m.code


class TestSandbox:
    URL = "/api/v1/netlab/sandbox/"
    NET = {"devices": [{"name": "PC-1", "kind": "pc", "x": 10, "y": 20}, {"name": "AP-1", "kind": "ap", "x": 30, "y": 20}], "cables": []}
    STATE = {"devices": {"PC-1": {"running": "ip addr add 10.0.0.1/24 dev eth0", "startup": ""}}, "cables": [["PC-1", "eth0", "AP-1", "Gi0/1"]]}

    @pytest.fixture
    def opened(self, api, clock):
        p = api.user.player
        MissionProgress.objects.create(player=p, mission=lab("lab-05"), season=p.season, state="cleared")
        return api

    def test_waits_for_the_console_labs(self, api, clock):
        response = api.get(self.URL)
        assert response.status_code == 403 and "LAB-05" in response.json()["error"]["message"]

    def test_starts_empty_and_needs_no_session(self, opened):
        assert opened.get(self.URL).json() == {"topology": None, "state": None}

    def test_comes_back_as_saved(self, opened):
        assert opened.put(self.URL, {"topology": self.NET, "state": self.STATE}, format="json").status_code == 200
        body = opened.get(self.URL).json()
        assert [d["name"] for d in body["topology"]["devices"]] == ["PC-1", "AP-1"]
        assert body["state"]["cables"] == self.STATE["cables"]

    def test_costs_nothing_and_earns_nothing(self, opened):
        p = opened.user.player
        before = (p.bank(), p.xp)
        opened.put(self.URL, {"topology": self.NET, "state": self.STATE}, format="json")
        p.refresh_from_db()
        assert (p.bank(), p.xp) == before

    def test_can_be_cleared(self, opened):
        opened.put(self.URL, {"topology": self.NET, "state": self.STATE}, format="json")
        assert opened.delete(self.URL).status_code == 204
        assert opened.get(self.URL).json()["topology"] is None

    def test_waits_for_a_focus_block(self, opened):
        opened.post("/api/v1/focus/blocks/", {"goal": "x", "minutes": 25}, format="json")
        assert opened.get(self.URL).status_code == 409

    @pytest.mark.parametrize("topology", [
        None,
        {"devices": "x"},
        {"devices": [{"name": "lower", "kind": "pc"}]},
        {"devices": [{"name": "PC", "kind": "toaster"}]},
        {"devices": [{"name": "PC", "kind": "pc"}, {"name": "PC", "kind": "pc"}]},
        {"devices": [{"name": "PC", "kind": "pc", "x": "far"}]},
        {"devices": [{"name": f"PC-{i}", "kind": "pc"} for i in range(25)]},
    ])
    def test_refuses_a_bad_network(self, opened, topology):
        assert opened.put(self.URL, {"topology": topology, "state": {}}, format="json").status_code == 400

    def test_keeps_only_what_a_device_is_made_of(self, opened):
        net = {"devices": [{"name": "R-1", "kind": "router", "x": 500, "y": -5, "locked": True, "config": "x", "evil": 1}]}
        opened.put(self.URL, {"topology": net, "state": {}}, format="json")
        assert opened.get(self.URL).json()["topology"]["devices"] == [{"name": "R-1", "kind": "router", "x": 100, "y": 0}]

    def test_keeps_a_sensible_port_count_and_drops_a_silly_one(self, opened):
        net = {"devices": [{"name": "SW-1", "kind": "switch", "ports": 8}, {"name": "SW-2", "kind": "switch", "ports": 5000}, {"name": "SW-3", "kind": "switch", "ports": True}]}
        opened.put(self.URL, {"topology": net, "state": {}}, format="json")
        rows = opened.get(self.URL).json()["topology"]["devices"]
        assert rows[0]["ports"] == 8 and "ports" not in rows[1] and "ports" not in rows[2]

    def test_is_private(self, opened, other_api):
        opened.put(self.URL, {"topology": self.NET, "state": self.STATE}, format="json")
        p = other_api.user.player
        MissionProgress.objects.create(player=p, mission=lab("lab-05"), season=p.season, state="cleared")
        assert other_api.get(self.URL).json()["topology"] is None
