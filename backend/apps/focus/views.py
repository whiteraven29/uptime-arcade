from datetime import timedelta

from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.core import clock

from . import history as focus_history
from . import plan, services
from .models import FocusBlock


class StartBlock(serializers.Serializer):
    # Only these two are read. A start time or length in seconds sent by a client is simply ignored.
    goal = serializers.CharField(max_length=500, trim_whitespace=True)
    minutes = serializers.IntegerField()


class ClaimBlock(serializers.Serializer):
    done = serializers.BooleanField()
    # A block that missed its check needs no note, so the rule lives where that's known.
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, trim_whitespace=True)


class Window(serializers.Serializer):
    start = serializers.CharField(max_length=5)
    end = serializers.CharField(max_length=5)


class Plan(serializers.Serializer):
    # Only these are read. Nobody picks a start date or a time zone for their plan.
    days = serializers.ListField(child=serializers.IntegerField(), max_length=7)
    blocks_per_day = serializers.IntegerField()
    block_minutes = serializers.IntegerField()
    windows = serializers.ListField(child=Window(), max_length=8)


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


@api_view(["GET"])
def block_detail(request, block_id):
    """Asked every few seconds while a block runs, to learn when its check comes up."""
    return Response({"block": services.own_block(request.user.player, block_id).public()})


@api_view(["POST"])
def presence(request, block_id):
    return Response({"block": services.confirm_presence(request.user, block_id).public(), "events": []})


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
    return Response(services.claim_block(request.user, block_id, body.validated_data["done"], body.validated_data.get("note", "")))


@api_view(["GET", "PUT"])
def study_plan(request):
    if request.method == "PUT":
        body = Plan(data=request.data)
        body.is_valid(raise_exception=True)
        plan.set_plan(request.user, **body.validated_data)
    return Response(plan.status_of(request.user.player))


@api_view(["GET"])
def history(request):
    return Response(focus_history.history_of(request.user.player))


@api_view(["POST"])
def session_open(request):
    session = services.open_session(request.user)
    return Response({"session": services.session_summary(session), "events": []}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def session_close(request):
    returned = services.close_session(request.user)
    return Response({"returned_seconds": returned, "bank_seconds": request.user.player.bank(), "events": []})
