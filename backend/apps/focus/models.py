from datetime import timedelta

from django.db import models
from django.db.models import Q

from apps.core import clock
from apps.game import rules
from apps.game.models import Player


class FocusBlock(models.Model):
    class Outcome(models.TextChoices):
        DONE = "done"
        NOT_DONE = "not_done"
        ABANDONED = "abandoned"
        MISSED = "missed"  # the player wasn't there for the check
        EXPIRED = "expired"  # never claimed in time

    class Kind(models.TextChoices):
        PLAN = "plan"  # inside the study plan: earns
        MAKEUP = "makeup"  # outside the plan, covering minutes missed this week: earns
        FREE = "free"  # extra: counts on the map, earns nothing

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="blocks")
    goal = models.CharField(max_length=100)
    note = models.CharField(max_length=140, blank=True)  # what actually got done, in the player's words
    minutes = models.PositiveSmallIntegerField()
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.PLAN)
    started_at = models.DateTimeField()  # server clock, never from the client
    ends_at = models.DateTimeField()
    # Server-only until it's due: knowing the moment in advance would defeat the check.
    check_at = models.DateTimeField(null=True, blank=True)
    checked_at = models.DateTimeField(null=True, blank=True)
    claimed_at = models.DateTimeField(null=True, blank=True)
    outcome = models.CharField(max_length=10, choices=Outcome.choices, blank=True)
    drifts = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-started_at"]
        constraints = [
            # A player can't have two blocks going, even if two requests race.
            models.UniqueConstraint(fields=["player"], condition=Q(outcome=""), name="one_open_block_per_player"),
        ]

    @property
    def claim_by(self):
        return self.ends_at + timedelta(seconds=rules.CLAIM_WINDOW_SECONDS)

    def presence(self):
        """waiting, due, ok or missed. It says nothing about when a waiting check will come."""
        if not self.check_at or self.checked_at:
            return "ok"
        now = clock.now()
        if now < self.check_at:
            return "waiting"
        return "due" if now <= self.check_expires_at else "missed"

    @property
    def check_expires_at(self):
        return self.check_at + timedelta(seconds=rules.PRESENCE_WINDOW_SECONDS)

    def public(self):
        presence = self.presence()
        return {
            "id": self.pk,
            "goal": self.goal,
            "note": self.note,
            "minutes": self.minutes,
            "kind": self.kind,
            "started_at": self.started_at,
            "ends_at": self.ends_at,
            "claim_by": self.claim_by,
            "claimed_at": self.claimed_at,
            "outcome": self.outcome,
            "drifts": self.drifts,
            "presence": presence,
            "check_expires_at": self.check_expires_at if presence == "due" else None,
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


class StudyPlan(models.Model):
    """When a player said they'd study. Rows are never edited once in force: a change is a new row from a
    later date, so the past keeps the plan it was judged by (ADR 0010)."""

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="plans")
    days = models.JSONField()  # weekdays, with Monday as 0
    blocks_per_day = models.PositiveSmallIntegerField()
    block_minutes = models.PositiveSmallIntegerField()
    windows = models.JSONField()  # [[start, end]] in minutes after local midnight, sorted
    # Its own zone, so moving your time zone can't open a window or a new day on the spot.
    time_zone = models.CharField(max_length=64)
    effective_from = models.DateField()
    by_player = models.BooleanField(default=True)  # false for the copy made when a time zone moves
    created_at = models.DateTimeField()

    class Meta:
        ordering = ["-effective_from", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["player", "effective_from"], name="one_plan_per_start_date"),
        ]

    @property
    def daily_minutes(self):
        return self.blocks_per_day * self.block_minutes

    def public(self):
        return {
            "days": self.days,
            "blocks_per_day": self.blocks_per_day,
            "block_minutes": self.block_minutes,
            "daily_minutes": self.daily_minutes,
            "windows": [{"start": clock_text(a), "end": clock_text(b)} for a, b in self.windows],
            "time_zone": self.time_zone,
            "effective_from": self.effective_from,
        }


class TargetReward(models.Model):
    """A weekly or monthly goal that was met. The constraint is what makes it pay only once."""

    class Period(models.TextChoices):
        WEEK = "week"
        MONTH = "month"

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="target_rewards")
    period = models.CharField(max_length=5, choices=Period.choices)
    starts_on = models.DateField()
    target_minutes = models.PositiveIntegerField()
    reached_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["player", "period", "starts_on"], name="target_paid_once"),
        ]


def clock_text(minutes):
    return f"{minutes // 60:02d}:{minutes % 60:02d}"
