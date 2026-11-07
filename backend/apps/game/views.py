from django.db import transaction
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.focus.services import current_block, current_session, session_summary

from . import rules, services
from .models import StreakReward, UserBadge


@api_view(["GET"])
def player(request):
    p = request.user.player
    block = current_block(p)
    return Response({
        "display_name": p.display_name,
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
