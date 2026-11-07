from django.contrib import admin

from apps.game.admin import ReadOnlyAdmin

from .models import MissionProgress, Submission


@admin.register(MissionProgress)
class MissionProgressAdmin(ReadOnlyAdmin):
    list_display = ("player", "mission", "season", "state", "tries", "hints_used", "xp_awarded")
    list_filter = ("state",)


@admin.register(Submission)
class SubmissionAdmin(ReadOnlyAdmin):
    list_display = ("progress", "result", "created_at")
