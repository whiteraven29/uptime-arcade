"""What the browser may see of a mission. Fields are always listed one by one, never "__all__", so a
new server-only column can't leak by accident. tests/test_content.py proves it."""
from rest_framework import serializers

from .models import Mission

SERVER_ONLY = ("answer_spec", "expect", "debrief", "rewind")


class MissionCardSerializer(serializers.ModelSerializer):
    track = serializers.CharField(source="track.code")
    chapter = serializers.CharField(source="chapter.name")

    class Meta:
        model = Mission
        fields = ("code", "track", "chapter", "order", "title", "difficulty", "xp")


class MissionBriefingSerializer(serializers.ModelSerializer):
    track = serializers.CharField(source="track.code")
    chapter = serializers.CharField(source="chapter.name")
    lesson = serializers.SerializerMethodField()

    class Meta:
        model = Mission
        fields = ("code", "track", "chapter", "order", "skill", "title", "from_dept", "difficulty", "check_type", "xp", "par_kind", "par_value", "lesson", "brief", "goal")

    def get_lesson(self, mission):
        return {"text": mission.lesson_text, "example": mission.lesson_example}
