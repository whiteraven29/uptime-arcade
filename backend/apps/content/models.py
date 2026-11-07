"""The curriculum, imported from content/ by manage.py import_content (section 13).

answer_spec, expect, debrief and rewind are server-only. They must never appear in a public
serializer, and tests prove they don't (section 14)."""
from django.db import models


class ContentRelease(models.Model):
    version = models.PositiveIntegerField(unique=True)
    difficulties = models.JSONField(default=list)
    mission_count = models.PositiveIntegerField(default=0)
    imported_at = models.DateTimeField(auto_now_add=True)

    @classmethod
    def latest(cls):
        return cls.objects.order_by("-version").first()

    def __str__(self):
        return f"content v{self.version}"


class Track(models.Model):
    code = models.CharField(max_length=8, unique=True)
    name = models.CharField(max_length=60)
    subtitle = models.CharField(max_length=120, blank=True)
    order = models.PositiveIntegerField()
    after_archmage = models.BooleanField(default=False)
    # Seasons are content we publish. Older ones stay open for good (ADR 0009).
    season = models.PositiveIntegerField(default=1)
    # A mission that must be cleared before this track opens, like NET-11 for NetLab (section 6.6).
    requires = models.CharField(max_length=10, blank=True)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return self.name


class Chapter(models.Model):
    track = models.ForeignKey(Track, on_delete=models.CASCADE, related_name="chapters")
    name = models.CharField(max_length=80)
    order = models.PositiveIntegerField()

    class Meta:
        ordering = ["track", "order"]
        constraints = [models.UniqueConstraint(fields=["track", "name"], name="unique_chapter_per_track")]

    def __str__(self):
        return f"{self.track.code}: {self.name}"


class Topology(models.Model):
    """A NetLab network. Empty until M6."""

    code = models.CharField(max_length=20, unique=True)
    yaml = models.TextField()
    version = models.PositiveIntegerField(default=1)

    def __str__(self):
        return self.code


class Mission(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft"
        PUBLISHED = "published"
        RETIRED = "retired"

    code = models.CharField(max_length=10, unique=True)
    track = models.ForeignKey(Track, on_delete=models.PROTECT, related_name="missions")
    chapter = models.ForeignKey(Chapter, on_delete=models.PROTECT, related_name="missions")
    order = models.PositiveIntegerField()
    skill = models.CharField(max_length=20)
    title = models.CharField(max_length=80)
    from_dept = models.CharField(max_length=40)
    difficulty = models.CharField(max_length=12)
    check_type = models.CharField(max_length=10)
    xp = models.PositiveIntegerField()
    par_kind = models.CharField(max_length=10)
    par_value = models.PositiveIntegerField()
    lesson_text = models.TextField()
    lesson_example = models.TextField()
    brief = models.TextField()
    goal = models.TextField()
    hints = models.JSONField(default=list)  # revealed one at a time, never all at once
    play = models.JSONField(default=dict)  # what a workspace needs: starter, tests, program, file
    teaches = models.JSONField(default=list)
    topology = models.ForeignKey(Topology, null=True, blank=True, on_delete=models.SET_NULL)
    content_version = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PUBLISHED)
    # Server-only from here down.
    answer_spec = models.JSONField(default=dict)
    expect = models.JSONField(default=list)
    debrief = models.JSONField(default=dict)
    rewind = models.JSONField(default=list)

    class Meta:
        ordering = ["track__order", "order"]

    def __str__(self):
        return f"{self.code} {self.title}"


class MissionPrereq(models.Model):
    """Extra requirements beyond track order. Operations use these in M7."""

    mission = models.ForeignKey(Mission, on_delete=models.CASCADE, related_name="prereqs")
    requires = models.ForeignKey(Mission, on_delete=models.CASCADE, related_name="unlocks")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["mission", "requires"], name="unique_prereq")]


class FixtureFile(models.Model):
    """The starting file tree of the virtual machine. It's also how the grader knows what exists
    before a player has touched anything."""

    path = models.CharField(max_length=255, unique=True)
    content = models.TextField(blank=True)
    mode = models.PositiveIntegerField(default=0o644)

    def __str__(self):
        return self.path
