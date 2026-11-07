from django.db import models
from django.db.models import Q

from apps.game.models import Player


class FocusBlock(models.Model):
    class Outcome(models.TextChoices):
        DONE = "done"
        NOT_DONE = "not_done"
        ABANDONED = "abandoned"

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="blocks")
    goal = models.CharField(max_length=100)
    minutes = models.PositiveSmallIntegerField()
    started_at = models.DateTimeField()  # server clock, never from the client
    ends_at = models.DateTimeField()
    claimed_at = models.DateTimeField(null=True, blank=True)
    outcome = models.CharField(max_length=10, choices=Outcome.choices, blank=True)
    drifts = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-started_at"]
        constraints = [
            # A player can't have two blocks going, even if two requests race.
            models.UniqueConstraint(fields=["player"], condition=Q(outcome=""), name="one_open_block_per_player"),
        ]

    def public(self):
        return {
            "id": self.pk,
            "goal": self.goal,
            "minutes": self.minutes,
            "started_at": self.started_at,
            "ends_at": self.ends_at,
            "claimed_at": self.claimed_at,
            "outcome": self.outcome,
            "drifts": self.drifts,
        }


class PlaySession(models.Model):
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="sessions")
    opened_at = models.DateTimeField()
    expires_at = models.DateTimeField()
    closed_at = models.DateTimeField(null=True, blank=True)
    returned_seconds = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-opened_at"]
        constraints = [
            models.UniqueConstraint(fields=["player"], condition=Q(closed_at__isnull=True), name="one_open_session_per_player"),
        ]
