import uuid

from django.db import models

from apps.content.models import Mission
from apps.game.models import Player


class MissionProgress(models.Model):
    class State(models.TextChoices):
        OPEN = "open"
        SOLVED = "solved"  # the task is done, the rewind is not
        CLEARED = "cleared"

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="progress")
    mission = models.ForeignKey(Mission, on_delete=models.PROTECT, related_name="progress")
    season = models.PositiveIntegerField()
    state = models.CharField(max_length=10, choices=State.choices, default=State.OPEN)
    tries = models.PositiveIntegerField(default=0)
    stage = models.PositiveSmallIntegerField(default=0)  # how far through an Operation
    hints_used = models.PositiveIntegerField(default=0)
    commands = models.PositiveIntegerField(default=0)
    keys = models.PositiveIntegerField(default=0)
    par_bonus = models.PositiveIntegerField(default=0)
    worth = models.PositiveIntegerField(default=0)  # fixed when solved, and paid when cleared
    xp_awarded = models.PositiveIntegerField(default=0)
    solved_at = models.DateTimeField(null=True, blank=True)
    cleared_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["player", "mission", "season"], name="one_progress_per_season")]


class Submission(models.Model):
    progress = models.ForeignKey(MissionProgress, on_delete=models.CASCADE, related_name="submissions")
    payload = models.JSONField(default=dict)
    result = models.CharField(max_length=10)
    created_at = models.DateTimeField()

    class Meta:
        ordering = ["-created_at"]


class RewindProgress(models.Model):
    progress = models.OneToOneField(MissionProgress, on_delete=models.CASCADE, related_name="rewind")
    queue = models.JSONField(default=list)
    correct = models.PositiveIntegerField(default=0)
    misses = models.JSONField(default=dict)


class GradingJob(models.Model):
    """One run of a player's code. It goes through a queue, so a player waits a moment and the server stays up."""

    class State(models.TextChoices):
        PENDING = "pending"
        DONE = "done"
        FAILED = "failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="grading_jobs")
    mission = models.ForeignKey(Mission, on_delete=models.PROTECT, related_name="+")
    code = models.TextField()
    stage = models.PositiveSmallIntegerField(default=0)
    commands = models.PositiveIntegerField(default=0)
    keys = models.PositiveIntegerField(default=0)
    state = models.CharField(max_length=10, choices=State.choices, default=State.PENDING)
    result = models.JSONField(default=dict)
    created_at = models.DateTimeField()
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["player", "state", "created_at"])]
