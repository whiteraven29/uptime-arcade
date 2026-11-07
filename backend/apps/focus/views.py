from datetime import timedelta

from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.core import clock

from . import services
from .models import FocusBlock


class StartBlock(serializers.Serializer):
    # Only these two are read. A start time or length in seconds sent by a client is simply ignored.
    goal = serializers.CharField(max_length=500, trim_whitespace=True)
    minutes = serializers.IntegerField()


class ClaimBlock(serializers.Serializer):
    done = serializers.BooleanField()


@api_view(["GET", "POST"])
def blocks(request):
    if request.method == "GET":
        days = 30
        since = clock.now() - timedelta(days=days)
        rows = FocusBlock.objects.filter(player=request.user.player, started_at__gte=since)[:500]
        return Response({"blocks": [b.public() for b in rows]})
    body = StartBlock(data=request.data)
    body.is_valid(raise_exception=True)
    block = services.start_block(request.user, body.validated_data["goal"], body.validated_data["minutes"])
    return Response({"block": block.public(), "events": []}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def drift(request, block_id):
    return Response({"block": services.log_drift(request.user, block_id).public(), "events": []})


@api_view(["POST"])
def abandon(request, block_id):
    return Response({"block": services.abandon_block(request.user, block_id).public(), "events": []})


@api_view(["POST"])
def claim(request, block_id):
    body = ClaimBlock(data=request.data)
    body.is_valid(raise_exception=True)
    return Response(services.claim_block(request.user, block_id, body.validated_data["done"]))


@api_view(["POST"])
def session_open(request):
    session = services.open_session(request.user)
    return Response({"session": services.session_summary(session), "events": []}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def session_close(request):
    returned = services.close_session(request.user)
    return Response({"returned_seconds": returned, "bank_seconds": request.user.player.bank(), "events": []})
