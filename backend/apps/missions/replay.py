"""Section 14. What a shell or vi mission achieved is worked out here by playing the player's log back through the real
engines on a clean machine. A browser can claim anything about its files. It can only make a log that really does it."""
from django.conf import settings
from rest_framework import serializers

from apps.content.models import FixtureFile
from apps.netlab import grader

MAX_ENTRIES = 20_000
MAX_ENTRY = 4_096


def clean_log(log):
    if not isinstance(log, list) or len(log) > MAX_ENTRIES:
        raise serializers.ValidationError({"log": "Send what you did as a list of at most 20000 steps."})
    for entry in log:
        if not isinstance(entry, str) or not 2 <= len(entry) <= MAX_ENTRY or entry[0] not in "lkc":
            raise serializers.ValidationError({"log": "That step isn't one a player could have made."})
    return log


def run(mission, log):
    """{state, commands}. If the replay can't run, nothing passes and the player can simply try again."""
    base = list(FixtureFile.objects.values("path", "content", "mode"))
    return grader._run(settings.MACHINE_REPLAY, {"base": base, "fixtures": mission.play.get("fixtures") or {}, "log": clean_log(log)})
