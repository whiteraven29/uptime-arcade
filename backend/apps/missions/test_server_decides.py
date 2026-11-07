"""M9: the browser can claim what it likes. These prove that only what really ran counts."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from django.conf import settings
from rest_framework.test import APIClient

from apps.content.models import Mission
from apps.focus.services import open_session
from apps.game import services as game_services
from apps.game.models import TimeLedger
from apps.missions import sandbox, services
from apps.missions.models import GradingJob, MissionProgress

SOLVED = json.loads((Path(settings.BASE_DIR).parent / "content" / "build" / "solved_states.json").read_text())


def url(code, tail=""):
    return f"/api/v1/missions/{code}/{tail}"


@pytest.fixture
def playing(api):
    game_services.add_time(api.user.player, 3000, TimeLedger.Reason.STREAK)
    open_session(api.user)
    player = api.user.player
    # Unlock everything these tests need by marking what's before them as cleared.
    for code in ("py-05", "go-08", "go-22", "sh-05", "vi-05"):
        m = Mission.objects.get(code=code)
        for earlier in Mission.objects.filter(track=m.track, order__lt=m.order):
            MissionProgress.objects.update_or_create(player=player, mission=earlier, season=player.season, defaults={"state": "cleared", "worth": 0})
    return api


def state_of(api, code):
    p = MissionProgress.objects.filter(player=api.user.player, mission__code=code).first()
    return p.state if p else "open"


def run_code(api, code, body):
    sent = api.post(url(code, "submit/"), body, format="json")
    assert sent.status_code == 200, sent.content
    assert sent.json()["result"] == "grading"
    done = api.get(f"/api/v1/missions/jobs/{sent.json()['job']}/").json()
    assert done["state"] == "done", done
    return done["result"]


class TestShellAndViReplay:
    @pytest.mark.real_replay
    def test_a_forged_machine_with_no_log_gets_nothing(self, playing):
        forged = {"files": {"/home/ops/work/today/notes.txt": {"c": "", "m": 0o644}}}
        response = playing.post(url("sh-05", "check/"), {"state": forged, "log": []}, format="json")
        assert response.json()["result"] == "fail"
        assert state_of(playing, "sh-05") == "open"

    @pytest.mark.real_replay
    def test_a_log_that_never_did_it_gets_nothing(self, playing):
        forged = {"files": {"/home/ops/work/today/notes.txt": {"c": "", "m": 0o644}}}
        response = playing.post(url("sh-05", "check/"), {"state": forged, "log": ["lpwd", "lls"]}, format="json")
        assert response.json()["result"] == "fail"

    @pytest.mark.real_replay
    @pytest.mark.parametrize("code", ["sh-05", "vi-05"])
    def test_what_a_player_really_did_passes(self, playing, code):
        solved = SOLVED[code]
        response = playing.post(url(code, "check/"), {"state": solved, "log": solved["log"]}, format="json")
        assert response.json()["result"] == "pass", response.content
        assert state_of(playing, code) == "solved"

    @pytest.mark.real_replay
    def test_par_comes_from_the_replay_and_not_the_claim(self, playing):
        solved = SOLVED["vi-05"]
        playing.post(url("vi-05", "check/"), {"state": solved, "log": solved["log"], "keys": 1}, format="json")
        progress = MissionProgress.objects.get(player=playing.user.player, mission__code="vi-05")
        assert progress.keys == solved["vi_keys"]["/home/ops/vi/hosts.txt"] != 1

    @pytest.mark.parametrize("log", ["lpwd", [1, 2], ["xpwd"], ["l"], ["l" + "a" * 5000], ["lpwd"] * 20001, [{"l": "pwd"}]])
    @pytest.mark.real_replay
    def test_a_log_no_player_could_make_is_refused(self, playing, log):
        solved = SOLVED["sh-05"]
        response = playing.post(url("sh-05", "check/"), {"state": solved, "log": log}, format="json")
        assert response.status_code in (400, 413)
        assert state_of(playing, "sh-05") == "open"

    @pytest.mark.real_replay
    def test_a_replay_that_never_ends_passes_nothing(self, playing, settings):
        settings.LAB_GRADER_TIMEOUT = 0.01
        solved = SOLVED["sh-05"]
        response = playing.post(url("sh-05", "check/"), {"state": solved, "log": solved["log"]}, format="json")
        assert response.status_code == 503
        assert state_of(playing, "sh-05") == "open"




def solution(code):
    return Mission.objects.get(code=code).debrief["solution"]


class TestPythonOnTheServer:
    def test_claiming_a_pass_with_the_starter_gets_nothing(self, playing):
        starter = Mission.objects.get(code="py-05").play["python"]["starter"]
        result = run_code(playing, "py-05", {"code": starter, "passed": True})
        assert result["result"] == "fail" and "FAIL" in result["output"]
        assert state_of(playing, "py-05") == "open"

    def test_printing_the_old_pass_line_gets_nothing(self, playing):
        result = run_code(playing, "py-05", {"code": 'def slugify(name):\n    return ""\nprint("ALL_PASSED")\n', "passed": True})
        assert result["result"] == "fail"

    def test_the_right_code_passes(self, playing):
        result = run_code(playing, "py-05", {"code": solution("py-05"), "passed": True})
        assert result["result"] == "pass"
        assert state_of(playing, "py-05") == "solved"

    def test_a_failure_the_browser_reports_needs_no_sandbox(self, playing):
        response = playing.post(url("py-05", "submit/"), {"code": "x", "passed": False}, format="json")
        assert response.json()["result"] == "fail"
        assert not GradingJob.objects.exists()

    def test_code_that_crashes_fails_and_says_why(self, playing):
        result = run_code(playing, "py-05", {"code": "1/0\n", "passed": True})
        assert result["result"] == "fail" and "ZeroDivisionError" in result["output"]

    def test_an_endless_loop_is_stopped(self, playing, settings):
        settings.RUNNER_LIMITS = {**settings.RUNNER_LIMITS, "python": {**settings.RUNNER_LIMITS["python"], "seconds": 1}}
        result = run_code(playing, "py-05", {"code": "while True:\n    pass\n", "passed": True})
        assert result["result"] == "fail" and "too long" in result["output"]

    def test_a_flood_of_output_is_stopped(self, playing):
        result = run_code(playing, "py-05", {"code": 'while True:\n    print("x" * 1000)\n', "passed": True})
        assert result["result"] == "fail" and "too much" in result["output"]
        assert len(result["output"]) < 10_000

    def test_code_too_long_is_refused(self, playing):
        response = playing.post(url("py-05", "submit/"), {"code": "#" * 30_000, "passed": True}, format="json")
        assert response.status_code == 400


class TestGoOnTheServer:
    pytestmark = pytest.mark.skipif(not shutil.which("go"), reason="needs go")

    def test_the_starter_fails_and_the_solution_passes(self, playing):
        starter = Mission.objects.get(code="go-08").play["go"]["starter"]
        assert run_code(playing, "go-08", {"code": starter})["result"] == "fail"
        assert run_code(playing, "go-08", {"code": solution("go-08")})["result"] == "pass"

    def test_broken_go_says_what_the_compiler_said(self, playing):
        result = run_code(playing, "go-08", {"code": "package main\nfunc oops( {}\n"})
        assert result["result"] == "fail" and "main.go" in result["output"]

    def test_the_test_file_stays_on_the_server(self, playing):
        response = playing.get(url("go-08", "play/"))
        assert "go_test" not in response.content.decode() and "TestDescribe" not in response.content.decode()
        assert "TestDescribe" not in playing.get(url("go-08")).content.decode()


class TestTheQueue:
    def test_one_run_at_a_time(self, playing, monkeypatch):
        monkeypatch.setattr("apps.missions.tasks.grade_job.delay", lambda job: None)
        first = playing.post(url("py-05", "submit/"), {"code": "x", "passed": True}, format="json")
        again = playing.post(url("py-05", "submit/"), {"code": "x", "passed": True}, format="json")
        assert first.json()["result"] == "grading"
        assert again.status_code == 409 and again.json()["error"]["code"] == "grading_in_progress"

    def test_a_lost_job_stops_blocking(self, playing, monkeypatch, clock):
        monkeypatch.setattr("apps.missions.tasks.grade_job.delay", lambda job: None)
        game_services.add_time(playing.user.player, 0, TimeLedger.Reason.STREAK)
        first = playing.post(url("py-05", "submit/"), {"code": "x", "passed": True}, format="json").json()
        clock.advance(minutes=3)
        assert playing.get(f"/api/v1/missions/jobs/{first['job']}/").json()["state"] == "failed"

    def test_nobody_else_can_read_your_run(self, playing, monkeypatch):
        from django.contrib.auth import get_user_model

        monkeypatch.setattr("apps.missions.tasks.grade_job.delay", lambda job: None)
        job = playing.post(url("py-05", "submit/"), {"code": "x", "passed": True}, format="json").json()["job"]
        other = APIClient()
        other.force_authenticate(get_user_model().objects.create_user(username="someone_else", password="x" * 12))
        assert other.get(f"/api/v1/missions/jobs/{job}/").status_code == 404

    def test_a_broken_sandbox_costs_the_player_nothing(self, playing, monkeypatch):
        def broken(*a):
            raise sandbox.SandboxUnavailable("no docker")

        monkeypatch.setattr(sandbox, "grade", broken)
        sent = playing.post(url("py-05", "submit/"), {"code": "x", "passed": True}, format="json").json()
        assert playing.get(f"/api/v1/missions/jobs/{sent['job']}/").json()["state"] == "failed"
        assert MissionProgress.objects.filter(player=playing.user.player, mission__code="py-05", tries__gt=0).count() == 0

    def test_a_queue_that_is_down_says_so(self, playing, monkeypatch):
        from kombu.exceptions import OperationalError

        def down(job):
            raise OperationalError("no redis")

        monkeypatch.setattr("apps.missions.tasks.grade_job.delay", down)
        response = playing.post(url("py-05", "submit/"), {"code": "x", "passed": True}, format="json")
        assert response.status_code == 503
        assert GradingJob.objects.get().state == "failed"


class TestContainerRules:
    def test_every_job_gets_the_full_lockdown(self):
        for kind in ("python", "go"):
            command = " ".join(sandbox._docker_command(kind, "job"))
            for flag in ("--network none", "--read-only", "--cap-drop ALL", "no-new-privileges", "--pids-limit", "--memory", "--memory-swap", "--cpus", "--rm"):
                assert flag in command, flag
            assert "-v " not in command and "--volume" not in command and "--privileged" not in command

    def test_the_unisolated_runner_can_be_turned_off(self, settings):
        settings.RUNNER_ALLOW_LOCAL = False
        with pytest.raises(sandbox.SandboxUnavailable):
            sandbox._execute("python", {"program.py": "print(1)"})

    def test_production_cannot_choose_the_unisolated_runner(self):
        text = (Path(settings.BASE_DIR) / "config" / "settings" / "prod.py").read_text()
        assert 'RUNNER_BACKEND = "docker"' in text and "RUNNER_ALLOW_LOCAL = False" in text
        assert 'environ.get("RUNNER_BACKEND' not in text


def _docker_ready():
    docker = shutil.which("docker")
    if not docker:
        return False
    probe = subprocess.run([docker, "image", "inspect", settings.RUNNER_IMAGES["python"], settings.RUNNER_IMAGES["go"]], capture_output=True, check=False)
    return probe.returncode == 0


@pytest.mark.docker_sandbox
@pytest.mark.skipif(not _docker_ready(), reason="needs Docker and the images: make sandbox-images")
class TestRealContainers:
    """Attacks from inside, with the real images. Each prints something that only an escape could print."""

    @pytest.fixture(autouse=True)
    def _use_docker(self, settings):
        settings.RUNNER_BACKEND = "docker"
        settings.RUNNER_ALLOW_LOCAL = False

    def attack(self, program):
        return sandbox._execute("python", {"program.py": program})

    def test_python_runs(self):
        code, output, _ = self.attack("print(6 * 7)")
        assert code == 0 and output.strip() == "42"

    def test_no_network(self):
        code, output, _ = self.attack("import socket\ntry:\n    socket.create_connection(('1.1.1.1', 53), 2)\n    print('ESCAPED')\nexcept OSError as e:\n    print('blocked')\n")
        assert "ESCAPED" not in output and "blocked" in output

    def test_the_root_is_read_only(self):
        _, output, _ = self.attack("try:\n    open('/etc/pwned', 'w')\n    print('ESCAPED')\nexcept OSError:\n    print('blocked')\n")
        assert "ESCAPED" not in output

    def test_not_root(self):
        _, output, _ = self.attack("import os\nprint(os.getuid())\n")
        assert output.strip() == "65534"

    def test_no_secrets_in_the_environment(self):
        _, output, _ = self.attack("import os\nprint(sorted(os.environ))\n")
        for name in ("DJANGO_SECRET_KEY", "POSTGRES_PASSWORD", "EMAIL_HOST_PASSWORD", "REDIS_URL"):
            assert name not in output

    def test_a_fork_bomb_hits_the_wall(self):
        code, output, reason = self.attack("import os\nwhile True:\n    os.fork()\n")
        assert code != 0 or reason

    def test_a_memory_bomb_hits_the_wall(self):
        code, output, reason = self.attack("x = []\nwhile True:\n    x.append('x' * 10_000_000)\n")
        assert code != 0 or reason

    def test_an_endless_loop_is_killed_and_removed(self):
        code, _, reason = self.attack("while True:\n    pass\n")
        assert code is None and reason == "time"
        left = subprocess.run([settings.RUNNER_DOCKER, "ps", "-aq", "--filter", "name=ua-job-"], capture_output=True, text=True, check=False)
        assert left.stdout.strip() == ""

    def test_go_runs_real_tests(self):
        mission = Mission.objects.get(code="go-08")
        assert sandbox._go(mission, mission.debrief["solution"]).passed
        assert not sandbox._go(mission, mission.play["go"]["starter"]).passed
