from rest_framework import serializers
from kombu.exceptions import OperationalError
from rest_framework import status
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response

from apps.content.models import ContentRelease
from apps.content.serializers import MissionBriefingSerializer
from apps.game.services import current_season

from apps.core.exceptions import GameError

from . import services, tasks
from .throttles import GoalCheckThrottle, SubmitThrottle


def _body(request):
    if not isinstance(request.data, dict):
        raise serializers.ValidationError("Send a JSON object.")
    return request.data


@api_view(["GET"])
def tracks(request):
    release = ContentRelease.latest()
    return Response({
        "season": current_season(),
        "difficulties": [{"code": d["code"], "label": d["label"]} for d in (release.difficulties if release else [])],
        "tracks": services.tracks_for(request.user.player),
    })


@api_view(["GET"])
def briefing(request, code):
    player = request.user.player
    mission = services.get_mission(code)
    state = services._require_playable(player, mission)
    return Response({**MissionBriefingSerializer(mission).data, "state": str(state)})


@api_view(["GET"])
def play(request, code):
    player = request.user.player
    mission = services.get_mission(code)
    state = services._require_playable(player, mission)
    services.require_play(player, state)
    progress = services.progress_of(player, mission)
    used = progress.hints_used if progress else 0
    if state == "cleared":
        used = len(mission.hints)  # already earned, and free when revisiting
    # An Operation shows one stage at a time. What's ahead is only named, so nothing in it can be read early.
    stage = {}
    check_type, workspace = mission.check_type, mission.play
    if mission.check_type == services.OPS_CHECK:
        asked = request.query_params.get("stage", "0")
        wanted = {"stage": int(asked)} if asked.isdigit() else {}
        index = services._stage_index(mission, wanted, state, progress)
        index = min(index, services.stage_count(mission) - 1)
        current = mission.play["stages"][index]
        check_type = current["check"]
        workspace = {**current["workspace"], "fixtures": mission.play.get("fixtures") or {}}
        stage = {"stage": {"index": index, "total": services.stage_count(mission), "title": current["title"], "brief": current["brief"], "goal": current["goal"], "names": [s["title"] for s in mission.play["stages"]]}}
    return Response({
        "code": mission.code,
        "state": str(state),
        "check_type": check_type,
        "workspace": workspace,
        **stage,
        "hints": mission.hints[:used],  # only the ones already paid for
        "hints_total": len(mission.hints),
    })


@api_view(["POST"])
@throttle_classes([SubmitThrottle])
def hint(request, code):
    return Response(services.reveal_hint(request.user, code))


@api_view(["POST"])
@throttle_classes([SubmitThrottle])
def submit(request, code):
    with services.one_at_a_time(request.user):
        result = services.submit(request.user, code, _body(request))
    if result.get("result") == "grading":
        # After the lock is gone, and if the queue is down the job just fails and can be sent again.
        try:
            tasks.grade_job.delay(result["job"])
        except OperationalError as e:
            services.fail_job(result["job"])
            raise GameError("grader_unavailable", "Your code couldn't be checked just now. Try again in a moment.", status.HTTP_503_SERVICE_UNAVAILABLE) from e
    return Response(result)


@api_view(["GET"])
def job(request, job_id):
    return Response(services.job_view(request.user, job_id))


@api_view(["POST"])
@throttle_classes([GoalCheckThrottle])
def check_goal(request, code):
    with services.one_at_a_time(request.user):
        return Response(services.check_goal(request.user, code, _body(request)))


@api_view(["GET"])
def debrief(request, code):
    return Response(services.debrief(request.user, code))


@api_view(["GET"])
def rewind(request, code):
    return Response(services.rewind_view(request.user, code))


@api_view(["POST"])
@throttle_classes([SubmitThrottle])
def rewind_answer(request, code):
    return Response(services.answer_rewind(request.user, code, _body(request).get("value")))
