"""Playing a mission (sections 6.2, 6.3, 6.5, 6.6 and 14).

XP is paid in one place only, clear(), when both the task and its rewind are finished. Everything takes
the player's row lock first, so a double click or two tabs can't pay twice."""
from django.db import transaction
from rest_framework import serializers, status

from apps.content.models import Mission, Track
from apps.core import clock
from apps.core.exceptions import GameError
from apps.focus.services import require_session
from apps.game import rules, services
from apps.game.models import XPLedger

from . import grading
from .models import MissionProgress, RewindProgress, Submission

State = MissionProgress.State
ANSWER_CHECKS = ("answer", "go-out", "go-fix")
GOAL_CHECKS = ("fs", "vi")


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


def progress_of(player, mission):
    return MissionProgress.objects.filter(player=player, mission=mission, season=player.season).first()


def state_of(player, mission):
    """locked, open, solved or cleared. Section 6.6."""
    progress = progress_of(player, mission)
    if progress and progress.state != State.OPEN:
        return progress.state
    if track_gate(player, mission.track):
        return "locked"
    previous = Mission.objects.filter(track=mission.track, order=mission.order - 1, status=Mission.Status.PUBLISHED).first()
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
        grouped[t.code] = {"code": t.code, "name": t.name, "subtitle": t.subtitle, "after_archmage": t.after_archmage, "season": t.season, "locked_because": gate, "requires": t.requires or None, "missions": []}
    previous = {}
    for m in missions:
        code = m.track.code
        state = states.get(m.pk, State.OPEN)
        if state == State.OPEN:
            before = previous.get(code)
            if grouped[code]["locked_because"] or (before is not None and before != State.CLEARED):
                state = "locked"
        previous[code] = state
        grouped[code]["missions"].append({"code": m.code, "chapter": m.chapter.name, "order": m.order, "title": m.title, "difficulty": m.difficulty, "xp": m.xp, "state": str(state), "answered": answered.get(m.pk, 0)})
    return list(grouped.values())


def _require_playable(player, mission):
    state = state_of(player, mission)
    if state == "locked":
        reason = track_gate(player, mission.track) or "Clear the mission before this one first."
        raise GameError("mission_locked", reason, status.HTTP_403_FORBIDDEN)
    return state


def _progress_for_update(player, mission):
    progress, _ = MissionProgress.objects.select_for_update().get_or_create(player=player, mission=mission, season=player.season)
    return progress


@transaction.atomic
def reveal_hint(user, code):
    """Costs XP from what the mission is worth when it's finally paid."""
    player = services.locked_player(user)
    require_session(player)
    mission = get_mission(code)
    if _require_playable(player, mission) != State.OPEN:
        raise GameError("already_solved", "Hints are free on a mission you've solved. They're all on the page.")
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


def _grade(mission, data):
    """Returns (passed, what to keep on record). Whole file trees aren't stored, only the counts."""
    if mission.check_type in ANSWER_CHECKS:
        answer = data.get("answer")
        if not isinstance(answer, str) or not answer.strip() or len(answer) > grading.MAX_ANSWER:
            raise serializers.ValidationError({"answer": "Send your answer as text."})
        return grading.answer_matches(answer, mission.answer_spec["accept"]), {"answer": answer[:200]}
    if mission.check_type in GOAL_CHECKS:
        body = grading.PlayerState(data=data.get("state") or {})
        body.is_valid(raise_exception=True)
        return grading.goals_met(mission.expect, body.validated_data), {}
    code = data.get("code")
    passed = data.get("passed")
    if not isinstance(code, str) or len(code) > grading.MAX_CODE or not isinstance(passed, bool):
        raise serializers.ValidationError({"code": "Send your code and whether the tests passed."})
    return passed, {"code": code}


def _par_bonus(mission, progress, commands, keys):
    if mission.par_kind == "first-try":
        met = progress.tries == 1
    elif mission.par_kind == "keys":
        met = 0 < keys <= mission.par_value
    else:
        met = 0 < commands <= mission.par_value
    return rules.PAR_BONUS if met else 0


@transaction.atomic
def submit(user, code, data):
    player = services.locked_player(user)
    require_session(player)
    mission = get_mission(code)
    state = _require_playable(player, mission)
    if state == State.SOLVED:
        raise GameError("already_solved", "This mission is already solved. Its questions are waiting.")
    commands = _count(data.get("commands"), "commands")
    keys = _count(data.get("keys"), "keys")
    passed, record = _grade(mission, data)
    if state == State.CLEARED:
        # Revisiting: the answer is checked so you can practise, and nothing else changes.
        return {"result": "pass" if passed else "fail", "revisit": True, "tries": 0, "events": []}
    progress = _progress_for_update(player, mission)
    if not passed and mission.check_type in GOAL_CHECKS:
        # Not there yet, which isn't a wrong answer. These run after every command, so they aren't kept.
        return {"result": "fail", "tries": progress.tries, "events": []}
    progress.tries += 1
    progress.commands = commands
    progress.keys = keys
    Submission.objects.create(progress=progress, payload={**record, "commands": commands, "keys": keys}, result="pass" if passed else "fail", created_at=clock.now())
    if not passed:
        progress.save(update_fields=["tries", "commands", "keys"])
        return {"result": "fail", "tries": progress.tries, "events": []}
    progress.state = State.SOLVED
    progress.solved_at = clock.now()
    progress.par_bonus = _par_bonus(mission, progress, commands, keys)
    # Solving pays nothing yet. This is what it will be worth when the rewind is finished too.
    progress.worth = rules.mission_worth(mission.xp, progress.par_bonus, progress.hints_used)
    progress.save()
    RewindProgress.objects.get_or_create(progress=progress, defaults={"queue": list(range(len(mission.rewind)))})
    return {"result": "pass", "tries": progress.tries, "par_bonus": progress.par_bonus, "xp_on_clear": progress.worth, "events": [{"type": "solved", "mission": mission.code}]}


def check_goal(user, code, data):
    """For terminal and vi missions, whose goal the browser can't see."""
    mission = get_mission(code)
    if mission.check_type not in GOAL_CHECKS:
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
    return MissionProgress.objects.filter(player=player, season=player.season, state=State.CLEARED, mission__track__after_archmage=False).count()


def _clear(player, mission, progress):
    """The whole task is finished. This is the only place a mission pays XP."""
    now = clock.now()
    progress.state = State.CLEARED
    progress.cleared_at = now
    xp = services.award_xp(player, progress.worth, XPLedger.Reason.MISSION, "mission", f"{mission.code}:s{player.season}")
    progress.xp_awarded = xp
    progress.save(update_fields=["state", "cleared_at", "xp_awarded"])
    events = [{"type": "cleared", "mission": mission.code, "xp": xp}]
    if not mission.track.after_archmage:
        before = rules.level_index(player.peak_cleared)
        player.peak_cleared = max(player.peak_cleared, _cleared_core(player))
        player.save(update_fields=["peak_cleared"])
        after = rules.level_index(player.peak_cleared)
        if after != before:
            events.append({"type": "level_up", "level": after + 1, "title": rules.LEVELS[after][1]})
    following = Mission.objects.filter(track=mission.track, order=mission.order + 1, status=Mission.Status.PUBLISHED).first()
    if following:
        events.append({"type": "unlocked", "mission": following.code})
    events += services.award_badges(player)
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
