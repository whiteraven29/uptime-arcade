"""The player and the ledgers. Play time and XP are never edited in place: each change is a row, so
balances can be audited, rebuilt and explained (section 15)."""
from django.conf import settings
from django.db import models
from django.db.models import Sum


class Player(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="player")
    display_name = models.CharField(max_length=40, blank=True)
    xp = models.IntegerField(default=0)  # a cache of the XP ledger's sum
    peak_cleared = models.PositiveIntegerField(default=0)
    season = models.PositiveIntegerField(default=1)
    streak = models.PositiveIntegerField(default=0)
    best_streak = models.PositiveIntegerField(default=0)
    shields = models.PositiveIntegerField(default=0)
    last_streak_day = models.DateField(null=True, blank=True)
    time_zone = models.CharField(max_length=64, default=settings.TIME_ZONE)
    time_zone_changed_at = models.DateTimeField(null=True, blank=True)
    sound_on = models.BooleanField(default=True)
    avatar_index = models.PositiveSmallIntegerField(default=0)  # which system avatar, while no picture is set
    oncall_resolved = models.PositiveIntegerField(default=0)

    def bank(self):
        return self.time_entries.aggregate(total=Sum("delta_seconds"))["total"] or 0

    def __str__(self):
        return self.display_name or self.user.get_username()


class TimeLedger(models.Model):
    class Reason(models.TextChoices):
        STARTER = "starter"
        FOCUS = "focus"
        GOAL_BONUS = "goal_bonus"
        STREAK = "streak"
        SESSION_OPEN = "session_open"
        SESSION_RETURN = "session_return"

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="time_entries")
    delta_seconds = models.IntegerField()
    reason = models.CharField(max_length=20, choices=Reason.choices)
    ref_type = models.CharField(max_length=20, blank=True)
    ref_id = models.CharField(max_length=20, blank=True)
    created_at = models.DateTimeField()

    class Meta:
        ordering = ["created_at", "id"]


class XPLedger(models.Model):
    class Reason(models.TextChoices):
        MISSION = "mission"
        FOCUS = "focus"
        STREAK = "streak"
        ONCALL = "oncall"

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="xp_entries")
    delta = models.IntegerField()
    reason = models.CharField(max_length=20, choices=Reason.choices)
    multiplier = models.FloatField(default=1)
    ref_type = models.CharField(max_length=20, blank=True)
    ref_id = models.CharField(max_length=20, blank=True)
    created_at = models.DateTimeField()

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            # A mission can only ever be paid once per season, whatever a client or a race tries.
            models.UniqueConstraint(fields=["player", "reason", "ref_type", "ref_id"], name="xp_paid_once", condition=~models.Q(ref_id="")),
        ]


class AvatarImage(models.Model):
    """An uploaded picture, always re-encoded by accounts/avatars.py. What a user sent is never stored or
    served. It lives in the database so deleting an account removes it with everything else."""

    player = models.OneToOneField(Player, on_delete=models.CASCADE, related_name="avatar_image")
    token = models.UUIDField(unique=True)  # the public address, unguessable and new with each upload
    data = models.BinaryField()
    updated_at = models.DateTimeField(auto_now=True)


class StreakDay(models.Model):
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="streak_days")
    date = models.DateField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["player", "date"], name="one_streak_row_per_day")]


class StreakReward(models.Model):
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="streak_rewards")
    milestone = models.PositiveIntegerField()
    claimed_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["player", "milestone"], name="milestone_pays_once")]


class UserBadge(models.Model):
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="badges")
    code = models.CharField(max_length=20)  # the list of badges lives in rules.py
    earned_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["player", "code"], name="badge_earned_once")]
