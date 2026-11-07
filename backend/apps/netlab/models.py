from django.db import models

from apps.content.models import Mission
from apps.game.models import Player


class LabState(models.Model):
    """Where a player has got to in a lab: configs and cables, as text. Never trusted for grading on its own."""

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="labs")
    mission = models.ForeignKey(Mission, on_delete=models.CASCADE, related_name="lab_states")
    state = models.JSONField(default=dict)
    updated_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["player", "mission"], name="one_lab_state_per_mission")]


class LabDrill(models.Model):
    """What was broken in a fault drill. It stays here until the player gives up and asks."""

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="drills")
    mission = models.ForeignKey(Mission, on_delete=models.CASCADE, related_name="drills")
    faults = models.JSONField(default=list)
    started_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["player", "mission"], name="one_drill_per_lab")]


class Sandbox(models.Model):
    """A player's own network, with no goals. It costs nothing and earns nothing."""

    player = models.OneToOneField(Player, on_delete=models.CASCADE, related_name="sandbox")
    topology = models.JSONField(default=dict)
    state = models.JSONField(default=dict)
    updated_at = models.DateTimeField()
