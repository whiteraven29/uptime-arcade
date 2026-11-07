from django.contrib import admin

from .models import Chapter, ContentRelease, FixtureFile, Mission, Track


@admin.register(Mission)
class MissionAdmin(admin.ModelAdmin):
    list_display = ("code", "title", "track", "chapter", "difficulty", "check_type", "xp", "status")
    list_filter = ("track", "difficulty", "check_type", "status")
    search_fields = ("code", "title")
    ordering = ("track__order", "order")
    # Content is code (section 13): change the YAML, not this page.
    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(Track)
class TrackAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "order", "after_archmage")


admin.site.register(Chapter)
admin.site.register(ContentRelease)


@admin.register(FixtureFile)
class FixtureFileAdmin(admin.ModelAdmin):
    list_display = ("path", "mode")
    search_fields = ("path",)
