from rest_framework import serializers
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response

from apps.content.models import ContentRelease
from apps.content.serializers import MissionBriefingSerializer
from apps.focus.services import require_session

from . import services
from .throttles import SubmitThrottle


def _body(request):
    if not isinstance(request.data, dict):
        raise serializers.ValidationError("Send a JSON object.")
    return request.data


@api_view(["GET"])
def tracks(request):
    release = ContentRelease.latest()
    return Response({
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
    require_session(player)
    mission = services.get_mission(code)
    state = services._require_playable(player, mission)
    progress = services.progress_of(player, mission)
    used = progress.hints_used if progress else 0
    return Response({
        "code": mission.code,
        "state": str(state),
        "check_type": mission.check_type,
        "workspace": mission.play,
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
    return Response(services.submit(request.user, code, _body(request)))


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
