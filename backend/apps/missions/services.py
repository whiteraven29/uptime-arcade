"""Playing a mission (sections 6.2, 6.3, 6.5, 6.6 and 14).

XP is paid in one place only, clear(), when both the task and its rewind are finished. Everything takes
the player's row lock first, so a double click or two tabs can't pay twice."""
from contextlib import contextmanager
from datetime import timedelta
from types import SimpleNamespace

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from rest_framework import serializers, status

from apps.content.models import Mission, MissionPrereq, Track
from apps.core import clock
from apps.core.exceptions import GameError
from apps.focus.services import current_block, require_session, stop_session
from apps.game import rules, services
from apps.game.models import XPLedger
from apps.netlab import grader

from . import grading, replay, sandbox
from .models import GradingJob, MissionProgress, RewindProgress, Submission

State = MissionProgress.State
ANSWER_CHECKS = ("answer", "go-out")
GOAL_CHECKS = ("fs", "vi")
NET_CHECK = "net"
GO_CODE_CHECK = "go-code"
JOB_GIVE_UP = timedelta(minutes=2)


def get_mission(code):
    mission = Mission.objects.select_related("track", "chapter").filter(code=str(code).lower(), status=Mission.Status.PUBLISHED).first()
    if not mission:
        raise GameError("not_found", "No such mission.", status.HTTP_404_NOT_FOUND)
    return mission


def beyond_open(player):
    return player.peak_cleared >= services.core_mission_count()


def _requirement(player, track):
    """The mission a track waits for, if it hasn't been cleared. Earlier seasons count, because nothing
    a player has done is ever taken away."""
    if not track.requires:
        return None
    needed = Mission.objects.filter(code=track.requires).first()
    if needed and MissionProgress.objects.filter(player=player, mission=needed, state=State.CLEARED).exists():
        return None
    return needed


def track_gate(player, track):
    """Why a track is closed, or None if it's open (section 6.6)."""
    if track.after_archmage and not beyond_open(player):
        return "Reach Archmage to open these."
    needed = _requirement(player, track)
    if needed:
        return f"Clear {needed.title} ({needed.code.upper()}) in {needed.track.name} first."
    return None


def _needs_first(mission, title, code, track):
    return f"Clear {title} ({code.upper()}) in {track} first."


def mission_gate(player, mission):
    """Why this one mission is closed, or None. A lab opens from the mission that teaches it (ADR 0011). Earlier
    seasons count here too."""
    missing = MissionPrereq.objects.filter(mission=mission).exclude(
        requires__in=MissionProgress.objects.filter(player=player, state=State.CLEARED).values("mission")
    ).select_related("requires__track").first()
    if not missing:
        return None
    return _needs_first(mission, missing.requires.title, missing.requires.code, missing.requires.track.name)


def progress_of(player, mission):
    return MissionProgress.objects.filter(player=player, mission=mission, season=player.season).first()


def state_of(player, mission):
    """locked, open, solved or cleared. Section 6.6."""
    progress = progress_of(player, mission)
    if progress and progress.state != State.OPEN:
        return progress.state
    if track_gate(player, mission.track) or mission_gate(player, mission):
        return "locked"
    previous = None if mission.track.side else Mission.objects.filter(track=mission.track, order=mission.order - 1, status=Mission.Status.PUBLISHED).first()
    if previous:
        before = progress_of(player, previous)
        if not before or before.state != State.CLEARED:
            return "locked"
    return State.OPEN


def tracks_for(player):
    """The whole map in one go. Tracks with no missions yet still appear, with what opens them."""
    states = dict(MissionProgress.objects.filter(player=player, season=player.season).values_list("mission_id", "state"))
    answered = dict(RewindProgress.objects.filter(progress__player=player, progress__season=player.season).values_list("progress__mission_id", "correct"))
    missions = Mission.objects.filter(status=Mission.Status.PUBLISHED).select_related("track", "chapter").defer("answer_spec", "expect", "debrief", "rewind", "play", "hints", "lesson_text", "lesson_example", "brief", "goal", "teaches")
    grouped = {}
    for t in Track.objects.all():
        gate = track_gate(player, t)
        grouped[t.code] = {"code": t.code, "name": t.name, "subtitle": t.subtitle, "after_archmage": t.after_archmage, "side": t.side, "season": t.season, "locked_because": gate, "requires": t.requires or None, "missions": []}
    previous = {}
    ever_cleared = set(MissionProgress.objects.filter(player=player, state=State.CLEARED).values_list("mission_id", flat=True))
    prereqs = {}
    for row in MissionPrereq.objects.select_related("requires__track"):
        if row.requires_id not in ever_cleared:
            prereqs.setdefault(row.mission_id, row.requires)
    for m in missions:
        code = m.track.code
        state = states.get(m.pk, State.OPEN)
        waiting = None
        if state == State.OPEN:
            before = previous.get(code)
            needed = prereqs.get(m.pk)
            if needed:
                waiting = _needs_first(m, needed.title, needed.code, needed.track.name)
            ahead_of_turn = not m.track.side and before is not None and before != State.CLEARED
            if grouped[code]["locked_because"] or waiting or ahead_of_turn:
                state = "locked"
        previous[code] = state
        grouped[code]["missions"].append({"code": m.code, "chapter": m.chapter.name, "order": m.order, "title": m.title, "difficulty": m.difficulty, "xp": m.xp, "state": str(state), "locked_because": waiting, "answered": answered.get(m.pk, 0)})
    return list(grouped.values())


def _require_playable(player, mission):
    state = state_of(player, mission)
    if state == "locked":
        reason = track_gate(player, mission.track) or mission_gate(player, mission) or "Clear the mission before this one first."
        raise GameError("mission_locked", reason, status.HTTP_403_FORBIDDEN)
    return state


def require_play(player, state):
    """A replay of something cleared costs nothing and earns nothing, so it needs no session (ADR 0012). It still
    waits for a focus block to end, or a player could practise through the time that block is earning."""
    if state != State.CLEARED:
        require_session(player)
    elif current_block(player):
        raise GameError("block_in_progress", "Replays wait until your focus block is over.")


def _progress_for_update(player, mission):
    progress, _ = MissionProgress.objects.select_for_update().get_or_create(player=player, mission=mission, season=player.season)
    return progress


@transaction.atomic
def reveal_hint(user, code):
    """Costs XP from what the mission is worth when it's finally paid."""
    player = services.locked_player(user)
    mission = get_mission(code)
    if _require_playable(player, mission) != State.OPEN:
        raise GameError("already_solved", "Hints are free on a mission you've solved. They're all on the page.")
    require_session(player)
    progress = _progress_for_update(player, mission)
    if progress.hints_used >= len(mission.hints):
        raise GameError("no_more_hints", "No more hints here. Read the lesson again.")
    hint = mission.hints[progress.hints_used]
    progress.hints_used += 1
    progress.save(update_fields=["hints_used"])
    return {"hint": hint, "hints_used": progress.hints_used, "hints_total": len(mission.hints), "worth": rules.mission_worth(mission.xp, 0, progress.hints_used)}


def _count(value, field):
    if value is None:
        return 0
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 1_000_000:
        raise serializers.ValidationError({field: "Must be a whole number."})
    return value


OPS_CHECK = "ops"


@contextmanager
def one_at_a_time(user):
    """Grading can run a process for seconds while holding the player's row. Without this, one account could send
    requests that all queue on that lock and tie up every server worker, so a second request is turned away at once."""
    key = f"grading:{user.pk}"
    if not cache.add(key, 1, timeout=settings.LAB_GRADER_TIMEOUT * 2):
        raise GameError("still_checking", "Still checking your last step.", status.HTTP_429_TOO_MANY_REQUESTS)
    try:
        yield
    finally:
        cache.delete(key)


def stage_count(mission):
    return len(mission.play["stages"])


def stage_view(mission, index):
    """One stage of an Operation, shaped like a mission so everything that grades a mission can grade it."""
    public, private = mission.play["stages"][index], mission.answer_spec["stages"][index]
    return SimpleNamespace(
        code=mission.code, check_type=public["check"], play={**public["workspace"], "fixtures": mission.play.get("fixtures") or {}},
        answer_spec=private["answer_spec"], expect=private["expect"], debrief={"solution": private["solution"]},
    )


def _stage_index(mission, data, state, progress):
    """Where a player is. A cleared Operation is a replay, so there the player says which stage they're practising."""
    if state != State.CLEARED:
        return progress.stage if progress else 0
    index = data.get("stage", 0)
    if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < stage_count(mission):
        raise serializers.ValidationError({"stage": "No such stage."})
    return index


def graded_part(mission, data, state, progress):
    if mission.check_type != OPS_CHECK:
        return mission, 0
    index = _stage_index(mission, data, state, progress)
    return stage_view(mission, index), index


def lab_of(mission):
    """The mission or Operation stage that holds this mission's lab, if there is one."""
    if mission.check_type == NET_CHECK:
        return mission
    if mission.check_type == OPS_CHECK:
        for index, stage in enumerate(mission.play["stages"]):
            if stage["check"] == NET_CHECK:
                return stage_view(mission, index)
    return None


def _played(mission, data):
    return replay.run(mission, data.get("log"))


def _grade(mission, data, revisit):
    """Returns (passed, what to keep on record). Whole file trees aren't stored, only the counts."""
    if mission.check_type in ANSWER_CHECKS:
        answer = data.get("answer")
        if not isinstance(answer, str) or not answer.strip() or len(answer) > grading.MAX_ANSWER:
            raise serializers.ValidationError({"answer": "Send your answer as text."})
        return grading.answer_matches(answer, mission.answer_spec["accept"]), {"answer": answer[:200]}
    if mission.check_type in GOAL_CHECKS:
        # What the browser says only decides whether it's worth checking, so most commands cost the server nothing.
        body = grading.PlayerState(data=data.get("state") or {})
        body.is_valid(raise_exception=True)
        if not grading.goals_met(mission.expect, body.validated_data):
            return False, {}
        if revisit:  # practice: nothing is at stake, and nothing is paid
            return True, {}
        played = _played(mission, data)
        file = grading._home(mission.play["file"]) if mission.play.get("file") else None
        keys = played["state"].get("vi_keys", {}).get(file, 0) if file else 0
        return grading.goals_met(mission.expect, played["state"]), {"commands": played["commands"], "keys": keys}
    if mission.check_type == NET_CHECK:
        lab = mission.play["lab"]
        goals = grader.grade(lab, mission.expect, grader.clean_state(data.get("state"), lab))
        return all(g["ok"] for g in goals), {"goals": goals}
    code = _code_from(data)
    passed = data.get("passed")
    if not isinstance(passed, bool):
        raise serializers.ValidationError({"code": "Send your code and whether the tests passed."})
    # A failed run, or a practice run on a cleared mission, is safe to take on trust. A claimed pass never gets here.
    return passed, {"code": code}


def _code_from(data):
    code = data.get("code")
    if not isinstance(code, str) or len(code) > grading.MAX_CODE:
        raise serializers.ValidationError({"code": "Send your code as text."})
    return code


def _needs_a_sandbox(mission, data, state):
    if mission.check_type == GO_CODE_CHECK:
        return True  # there's no Go in the browser, so even practice runs here
    return mission.check_type == "py" and state != State.CLEARED and data.get("passed") is True


def _queue_job(player, mission, code, commands, keys, stage=0):
    """One job at a time per player, so nobody can fill the queue. A job the queue lost stops counting after a while."""
    now = clock.now()
    active = GradingJob.objects.filter(player=player, state=GradingJob.State.PENDING)
    active.filter(created_at__lte=now - JOB_GIVE_UP).update(state=GradingJob.State.FAILED, finished_at=now)
    if active.exists():
        raise GameError("grading_in_progress", "Your last run is still being checked.", status.HTTP_409_CONFLICT)
    return GradingJob.objects.create(player=player, mission=mission, code=code, stage=stage, commands=commands, keys=keys, created_at=now)


def _par_bonus(mission, progress, commands, keys):
    if mission.check_type == OPS_CHECK:
        met = progress.tries == stage_count(mission)  # one try for each stage
    elif mission.par_kind == "first-try":
        met = progress.tries == 1
    elif mission.par_kind == "keys":
        met = 0 < keys <= mission.par_value
    else:
        met = 0 < commands <= mission.par_value
    return rules.PAR_BONUS if met else 0


@transaction.atomic
def submit(user, code, data):
    player = services.locked_player(user)
    mission = get_mission(code)
    state = _require_playable(player, mission)
    require_play(player, state)
    if state == State.SOLVED:
        raise GameError("already_solved", "This mission is already solved. Its questions are waiting.")
    commands = _count(data.get("commands"), "commands")
    keys = _count(data.get("keys"), "keys")
    part, stage = graded_part(mission, data, state, progress_of(player, mission))
    if _needs_a_sandbox(part, data, state):
        job = _queue_job(player, mission, _code_from(data), commands, keys, stage)
        return {"result": "grading", "job": str(job.pk), "events": []}
    passed, record = _grade(part, data, state == State.CLEARED)
    commands = record.pop("commands", commands)
    keys = record.pop("keys", keys)
    # A lab says how each goal went, in words. It's what a player learns from.
    goals = {"goals": record.pop("goals")} if "goals" in record else {}
    if state == State.CLEARED:
        # Revisiting: the answer is checked so you can practise, and nothing else changes.
        return {"result": "pass" if passed else "fail", "revisit": True, "tries": 0, "events": [], **goals}
    return _settle(player, mission, part, passed, record, commands, keys, goals)


def _settle(player, mission, part, passed, record, commands, keys, goals=None):
    goals = goals or {}
    progress = _progress_for_update(player, mission)
    if not passed and (part.check_type in GOAL_CHECKS or part.check_type == NET_CHECK):
        # Not there yet, which isn't a wrong answer. These run after every command, so they aren't kept.
        return {"result": "fail", "tries": progress.tries, "events": [], **goals}
    progress.tries += 1
    progress.commands = commands
    progress.keys = keys
    Submission.objects.create(progress=progress, payload={**record, "commands": commands, "keys": keys}, result="pass" if passed else "fail", created_at=clock.now())
    if not passed:
        progress.save(update_fields=["tries", "commands", "keys"])
        return {"result": "fail", "tries": progress.tries, "events": []}
    if mission.check_type == OPS_CHECK and progress.stage + 1 < stage_count(mission):
        progress.stage += 1
        progress.save(update_fields=["tries", "commands", "keys", "stage"])
        return {"result": "stage", "stage": progress.stage, "total": stage_count(mission), "tries": progress.tries, "events": [], **goals}
    progress.state = State.SOLVED
    progress.solved_at = clock.now()
    progress.par_bonus = _par_bonus(mission, progress, commands, keys)
    # Solving pays nothing yet. This is what it will be worth when the rewind is finished too.
    progress.worth = rules.mission_worth(mission.xp, progress.par_bonus, progress.hints_used)
    progress.save()
    RewindProgress.objects.get_or_create(progress=progress, defaults={"queue": list(range(len(mission.rewind)))})
    return {"result": "pass", "tries": progress.tries, "par_bonus": progress.par_bonus, "xp_on_clear": progress.worth, "events": [{"type": "solved", "mission": mission.code}], **goals}


def run_job(job_id):
    """The queue's side of a submission: run the code with no lock held, then record what happened in one step."""
    job = GradingJob.objects.select_related("mission__track", "player__user").filter(pk=job_id, state=GradingJob.State.PENDING).first()
    if job is None:
        return
    try:
        part = stage_view(job.mission, job.stage) if job.mission.check_type == OPS_CHECK else job.mission
        outcome = sandbox.grade(part, job.code)
    except sandbox.SandboxUnavailable:
        GradingJob.objects.filter(pk=job.pk).update(state=GradingJob.State.FAILED, finished_at=clock.now())
        return
    with transaction.atomic():
        player = services.locked_player(job.player.user)
        job = GradingJob.objects.select_for_update().get(pk=job.pk)
        state = state_of(player, job.mission)
        if state == State.CLEARED:
            result = {"result": "pass" if outcome.passed else "fail", "revisit": True, "tries": 0, "events": []}
        elif state == State.SOLVED:
            result = {"result": "pass", "tries": 0, "events": []}  # two tabs: the other one got there first
        else:
            # It was sent while the session was open, so a session ending during the wait doesn't lose it.
            result = _settle(player, job.mission, part, outcome.passed, {"code": job.code}, job.commands, job.keys)
        job.result = {**result, "output": outcome.output}
        job.state = GradingJob.State.DONE
        job.finished_at = clock.now()
        job.save(update_fields=["result", "state", "finished_at"])


def fail_job(job_id):
    GradingJob.objects.filter(pk=job_id, state=GradingJob.State.PENDING).update(state=GradingJob.State.FAILED, finished_at=clock.now())


def job_view(user, job_id):
    job = GradingJob.objects.filter(pk=job_id, player__user=user).first()
    if job is None:
        raise GameError("job_not_found", "That run doesn't exist.", status.HTTP_404_NOT_FOUND)
    if job.state == GradingJob.State.PENDING and clock.now() - job.created_at > JOB_GIVE_UP:
        GradingJob.objects.filter(pk=job.pk).update(state=GradingJob.State.FAILED, finished_at=clock.now())
        job.state = GradingJob.State.FAILED
    return {"state": str(job.state), "result": job.result if job.state == GradingJob.State.DONE else None}


def check_goal(user, code, data):
    """For terminal and vi missions, whose goal the browser can't see."""
    mission = get_mission(code)
    player = user.player
    part, _ = graded_part(mission, data, state_of(player, mission), progress_of(player, mission))
    if part.check_type not in GOAL_CHECKS:
        raise GameError("not_a_goal_mission", "This mission is answered with submit.", status.HTTP_400_BAD_REQUEST)
    return submit(user, code, data)


def debrief(user, code):
    player = user.player
    mission = get_mission(code)
    if state_of(player, mission) not in (State.SOLVED, State.CLEARED):
        raise GameError("not_solved", "The debrief opens once you've solved the mission.", status.HTTP_403_FORBIDDEN)
    progress = progress_of(player, mission)
    return {**mission.debrief, "xp_on_clear": progress.worth, "par_bonus": progress.par_bonus, "xp_awarded": progress.xp_awarded}


PUBLIC_TASK_FIELDS = ("type", "level", "label", "q", "context", "show", "options", "scrambled", "code")


def _public_task(task, rewind, index):
    """Listed field by field, so the answer and the hint only go out when they've been earned."""
    out = {k: task[k] for k in PUBLIC_TASK_FIELDS if k in task}
    misses = int(rewind.misses.get(str(index), 0))
    if rewind.queue and all(int(rewind.misses.get(str(i), 0)) > 0 for i in rewind.queue):
        out["hint"] = task["hint"]
    if misses >= rules.REWIND_REVEAL_AFTER:
        answer = task["answer"]
        out["reveal"] = answer[0] if task["type"] == "text" else answer
    return out


def rewind_view(user, code):
    player = user.player
    mission = get_mission(code)
    state = state_of(player, mission)
    if state not in (State.SOLVED, State.CLEARED):
        raise GameError("not_solved", "Solve the mission first.", status.HTTP_403_FORBIDDEN)
    progress = progress_of(player, mission)
    total = len(mission.rewind)
    if state == State.CLEARED:
        return {"state": "cleared", "correct": total, "total": total, "task": None, "xp_on_clear": progress.worth}
    rewind = progress.rewind
    index = rewind.queue[0]
    return {"state": "solved", "correct": rewind.correct, "total": total, "task": _public_task(mission.rewind[index], rewind, index), "xp_on_clear": progress.worth}


def _task_correct(task, value):
    if task["type"] == "mc":
        return isinstance(value, str) and value == task["answer"]
    if task["type"] == "order":
        return isinstance(value, list) and value == task["answer"]
    return isinstance(value, str) and any(grading.normalize_rewind(a) == grading.normalize_rewind(value) for a in task["answer"])


def _validate_value(value):
    if isinstance(value, str) and len(value) <= grading.MAX_ANSWER:
        return
    if isinstance(value, list) and len(value) <= 50 and all(isinstance(v, str) and len(v) <= 500 for v in value):
        return
    raise serializers.ValidationError({"value": "Send your answer as text, or a list for an order question."})


def _cleared_core(player):
    return MissionProgress.objects.filter(player=player, season=player.season, state=State.CLEARED, mission__track__side=False, mission__track__after_archmage=False).count()


def _lab_preview(mission):
    """Enough to draw a lab's network as it opens. Every field is named, so a lab's starting config stays out of it."""
    lab = (mission.play or {}).get("lab")
    if not lab:
        return {}
    devices = [{"name": d["name"], "kind": d["kind"], "x": d["x"], "y": d["y"]} for d in lab["devices"]]
    cables = [[c[0], c[2]] for c in lab["cables"]]
    return {"preview": {"devices": devices, "cables": cables}}


def _unlock_events(player, mission):
    """Only what really just opened. A lab can open from the lab before it or from the mission it needs, whichever
    comes last, so both are asked, and the answer comes from the same rules that decide who can play."""
    following = None if mission.track.side else Mission.objects.filter(track=mission.track, order=mission.order + 1, status=Mission.Status.PUBLISHED).first()
    gated = [row.mission for row in MissionPrereq.objects.filter(requires=mission).select_related("mission__track")]
    events, seen = [], set()
    for candidate in ([following] if following else []) + gated:
        if candidate.code in seen or candidate.status != Mission.Status.PUBLISHED:
            continue
        seen.add(candidate.code)
        if state_of(player, candidate) == State.OPEN:
            events.append({"type": "unlocked", "mission": candidate.code, **_lab_preview(candidate)})
    if following and following.code not in {e["mission"] for e in events}:
        missing = MissionPrereq.objects.filter(mission=following).exclude(
            requires__in=MissionProgress.objects.filter(player=player, state=State.CLEARED).values("mission")
        ).select_related("requires").first()
        if missing:
            events.append({"type": "lab_waiting", "mission": following.code, "needs": missing.requires.code, "needs_title": missing.requires.title})
    return events


def _clear(player, mission, progress):
    """The whole task is finished. This is the only place a mission pays XP."""
    now = clock.now()
    progress.state = State.CLEARED
    progress.cleared_at = now
    xp = services.award_xp(player, progress.worth, XPLedger.Reason.MISSION, "mission", f"{mission.code}:s{player.season}")
    progress.xp_awarded = xp
    progress.save(update_fields=["state", "cleared_at", "xp_awarded"])
    events = [{"type": "cleared", "mission": mission.code, "xp": xp}]
    if not mission.track.after_archmage and not mission.track.side:
        before = rules.level_index(player.peak_cleared)
        player.peak_cleared = max(player.peak_cleared, _cleared_core(player))
        player.save(update_fields=["peak_cleared"])
        after = rules.level_index(player.peak_cleared)
        if after != before:
            events.append({"type": "level_up", "level": after + 1, "title": rules.LEVELS[after][1]})
    events += _unlock_events(player, mission)
    events += services.award_badges(player)
    # The job is done, so the clock stops, and the unused play time goes back to the bank (section 6.2).
    returned = stop_session(player)
    if returned is not None:
        events.append({"type": "session_closed", "returned": returned})
    return xp, events


@transaction.atomic
def answer_rewind(user, code, value):
    player = services.locked_player(user)
    require_session(player)
    mission = get_mission(code)
    if state_of(player, mission) != State.SOLVED:
        raise GameError("not_in_rewind", "This mission isn't waiting on its questions.")
    _validate_value(value)
    progress = _progress_for_update(player, mission)
    rewind = RewindProgress.objects.select_for_update().get(progress=progress)
    index = rewind.queue[0]
    correct = _task_correct(mission.rewind[index], value)
    if correct:
        rewind.queue = rewind.queue[1:]
        rewind.correct += 1
    else:
        # The right answer isn't sent. The task comes back after the others, with help when it's earned.
        rewind.misses[str(index)] = int(rewind.misses.get(str(index), 0)) + 1
        rewind.queue = rewind.queue[1:] + [index]
    rewind.save()
    if rewind.queue:
        following = rewind.queue[0]
        return {"correct": correct, "state": "solved", "done": rewind.correct, "total": len(mission.rewind), "task": _public_task(mission.rewind[following], rewind, following), "events": []}
    xp, events = _clear(player, mission, progress)
    return {"correct": correct, "state": "cleared", "done": rewind.correct, "total": len(mission.rewind), "task": None, "xp": xp, "events": events}
