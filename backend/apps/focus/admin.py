from django.contrib import admin

from apps.game.admin import ReadOnlyAdmin

from .models import FocusBlock, PlaySession


@admin.register(FocusBlock)
class FocusBlockAdmin(ReadOnlyAdmin):
    list_display = ("player", "minutes", "started_at", "ends_at", "outcome", "drifts")


@admin.register(PlaySession)
class PlaySessionAdmin(ReadOnlyAdmin):
    list_display = ("player", "opened_at", "expires_at", "closed_at", "returned_seconds")
