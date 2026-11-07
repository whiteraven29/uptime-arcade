from datetime import timedelta

from django.db import transaction
from django.db.models import Sum
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.core import clock
from apps.focus.models import FocusBlock
from apps.focus.services import current_block, current_session, session_summary

from . import rules, services
from .models import StreakReward, UserBadge


@api_view(["GET"])
def player(request):
    p = request.user.player
    block = current_block(p)
    claimed = FocusBlock.objects.filter(player=p, claimed_at__isnull=False)
    today = services.local_date(p)
    recent = [b for b in claimed.filter(claimed_at__gte=clock.now() - timedelta(hours=48)) if services.local_date(p, b.claimed_at) == today]
    return Response({
        # Lets the client run its countdowns on the server's clock instead of trusting its own.
        "server_time": clock.now(),
        "username": request.user.username,
        "display_name": p.display_name,
        "sound_on": p.sound_on,
        "time_zone": p.time_zone,
        "today_minutes": sum(b.minutes for b in recent),
        "today_drifts": sum(b.drifts for b in recent),
        "focus_minutes": claimed.aggregate(total=Sum("minutes"))["total"] or 0,
        "blocks_finished": claimed.count(),
        "xp": p.xp,
        "level": services.level_summary(p),
        "bank_seconds": p.bank(),
        "session": session_summary(current_session(p)),
        "block": block.public() if block else None,
        "streak": p.streak,
        "best_streak": p.best_streak,
        "shields": p.shields,
        "multiplier": rules.multiplier(p.streak),
        "season": p.season,
        "badges": UserBadge.objects.filter(player=p).count(),
    })


@api_view(["GET"])
def rewards(request):
    p = request.user.player
    claimed = set(StreakReward.objects.filter(player=p).values_list("milestone", flat=True))
    earned = dict(UserBadge.objects.filter(player=p).values_list("code", "earned_at"))
    level = rules.level_index(p.peak_cleared)
    return Response({
        "config": {
            "earn_seconds": rules.EARN_SECONDS,
            "goal_bonus_seconds": rules.GOAL_BONUS_SECONDS,
            "bank_cap": rules.BANK_CAP,
            "hint_cost": rules.HINT_COST,
            "rewind_reveal_after": rules.REWIND_REVEAL_AFTER,
        },
        "streak": [{"days": d, "seconds": s, "xp": x, "shields": sh, "claimed": d in claimed} for d, s, x, sh in rules.STREAK_MILESTONES],
        "levels": [{"index": i + 1, "title": t, "cleared": n, "reached": i <= level} for i, (n, t) in enumerate(rules.LEVELS)],
        "badges": [{"code": c, "name": n, "description": d, "earned_at": earned.get(c)} for c, n, d in rules.BADGES],
    })


@api_view(["POST"])
def new_season(request):
    """Section 6.9: resets mission progress only. XP, level (through peak), streak and badges stay."""
    with transaction.atomic():
        p = services.locked_player(request.user)
        p.season += 1
        p.save(update_fields=["season"])
    return Response({"season": p.season, "events": [{"type": "new_season", "season": p.season}]})
