from django.contrib import admin

from .models import AvatarImage, Player, StreakDay, StreakReward, TimeLedger, UserBadge, XPLedger


class ReadOnlyAdmin(admin.ModelAdmin):
    """Ledgers are an audit trail: nobody edits them, not even staff."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Player)
class PlayerAdmin(ReadOnlyAdmin):
    list_display = ("user", "display_name", "xp", "peak_cleared", "streak", "season")
    search_fields = ("user__username", "display_name")


@admin.register(TimeLedger)
class TimeLedgerAdmin(ReadOnlyAdmin):
    list_display = ("player", "delta_seconds", "reason", "created_at")
    list_filter = ("reason",)


@admin.register(XPLedger)
class XPLedgerAdmin(ReadOnlyAdmin):
    list_display = ("player", "delta", "reason", "multiplier", "created_at")
    list_filter = ("reason",)


@admin.register(AvatarImage)
class AvatarImageAdmin(ReadOnlyAdmin):
    list_display = ("player", "token", "updated_at")
    exclude = ("data",)


admin.site.register(StreakDay, ReadOnlyAdmin)
admin.site.register(StreakReward, ReadOnlyAdmin)
admin.site.register(UserBadge, ReadOnlyAdmin)
