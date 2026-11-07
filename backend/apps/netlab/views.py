from rest_framework import status
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response

from apps.core import clock
from apps.core.exceptions import GameError
from apps.content.models import Mission
from apps.focus.services import current_block, require_session
from apps.missions import services as missions
from apps.missions.models import MissionProgress
from apps.missions.throttles import SubmitThrottle

from . import grader
from .models import LabDrill, LabState, Sandbox

SANDBOX_NEEDS = "lab-05"  # by then a player can use a console and save a config
MAX_DRILL_FAULTS = 3


def _lab_mission(player, code):
    mission = missions.get_mission(code)
    if mission.check_type != "net":
        raise GameError("not_a_lab", "That mission isn't a lab.", status.HTTP_400_BAD_REQUEST)
    missions._require_playable(player, mission)
    return mission


@api_view(["GET", "PUT", "DELETE"])
def state(request, code):
    player = request.user.player
    mission = _lab_mission(player, code)
    if request.method == "GET":
        row = LabState.objects.filter(player=player, mission=mission).first()
        return Response({"state": row.state if row else None})
    require_session(player)
    if request.method == "DELETE":
        LabState.objects.filter(player=player, mission=mission).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    clean = grader.clean_state(request.data.get("state") if isinstance(request.data, dict) else None, mission.play["lab"])
    LabState.objects.update_or_create(player=player, mission=mission, defaults={"state": clean, "updated_at": clock.now()})
    return Response({"saved": True})


def _not_during_a_block(player):
    if current_block(player):
        raise GameError("block_in_progress", "This waits until your focus block is over.")


@api_view(["GET", "POST"])
@throttle_classes([SubmitThrottle])
def drill(request, code):
    """Break a lab you've cleared and fix it again. Like any replay, it costs nothing and earns nothing."""
    player = request.user.player
    mission = _lab_mission(player, code)
    if missions.state_of(player, mission) != "cleared":
        raise GameError("clear_it_first", "Clear this lab first. Then you can break it.", status.HTTP_403_FORBIDDEN)
    _not_during_a_block(player)
    if request.method == "GET":
        row = LabDrill.objects.filter(player=player, mission=mission).first()
        if not row:
            raise GameError("no_drill", "There's no drill running on this lab.", status.HTTP_404_NOT_FOUND)
        return Response({"faults": row.faults})
    count = request.data.get("faults", 1) if isinstance(request.data, dict) else 1
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= MAX_DRILL_FAULTS:
        raise GameError("bad_fault_count", f"A drill has between 1 and {MAX_DRILL_FAULTS} faults.", status.HTTP_400_BAD_REQUEST)
    result = grader.drill(mission, count)
    if not result.get("faults"):
        raise GameError("nothing_to_break", "This lab is about settings, so there's nothing to break in a drill. Try another.")
    LabDrill.objects.update_or_create(player=player, mission=mission, defaults={"faults": result["faults"], "started_at": clock.now()})
    # Which things broke stays here until the player gives up and asks.
    return Response({"state": result["state"], "count": len(result["faults"])}, status=status.HTTP_201_CREATED)


def _sandbox_gate(player):
    needed = Mission.objects.filter(code=SANDBOX_NEEDS).first()
    if needed and not MissionProgress.objects.filter(player=player, mission=needed, state=MissionProgress.State.CLEARED).exists():
        return f"Clear {needed.title} ({needed.code.upper()}) in NetLab first."
    return None


@api_view(["GET", "PUT", "DELETE"])
def sandbox(request):
    player = request.user.player
    why = _sandbox_gate(player)
    if why:
        raise GameError("mission_locked", why, status.HTTP_403_FORBIDDEN)
    _not_during_a_block(player)
    if request.method == "GET":
        row = Sandbox.objects.filter(player=player).first()
        return Response({"topology": row.topology if row else None, "state": row.state if row else None})
    if request.method == "DELETE":
        Sandbox.objects.filter(player=player).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    body = request.data if isinstance(request.data, dict) else {}
    topology = grader.clean_topology(body.get("topology"))
    clean = grader.clean_state(body.get("state"), topology)
    Sandbox.objects.update_or_create(player=player, defaults={"topology": topology, "state": clean, "updated_at": clock.now()})
    return Response({"saved": True})
