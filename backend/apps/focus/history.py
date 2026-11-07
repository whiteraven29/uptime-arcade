"""What Profile draws. Dates are the player's own, and every field is listed by name."""
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.db.models import Count, Sum
from django.db.models.functions import TruncDate, TruncWeek

from apps.core import clock
from apps.game.models import XPLedger

from .models import FocusBlock

MAP_DAYS = 371  # 53 weeks, so a whole year shows whatever day the week starts on
XP_WEEKS = 12
RECENT_BLOCKS = 15


def _recent(block):
    outcome = block.outcome or ("expired" if clock.now() > block.claim_by else "open")
    return {
        "id": block.pk,
        "goal": block.goal,
        "note": block.note,
        "minutes": block.minutes,
        "kind": block.kind,
        "outcome": outcome,
        "started_at": block.started_at,
    }


def history_of(player):
    zone = ZoneInfo(player.time_zone)
    now = clock.now()
    today = now.astimezone(zone).date()
    claimed = FocusBlock.objects.filter(player=player, claimed_at__isnull=False, claimed_at__gte=now - timedelta(days=MAP_DAYS + 1))
    rows = claimed.annotate(day=TruncDate("claimed_at", tzinfo=zone)).order_by().values("day").annotate(minutes=Sum("minutes"), blocks=Count("id"))
    first = today - timedelta(days=MAP_DAYS - 1)
    days = sorted(({"date": r["day"], "minutes": r["minutes"], "blocks": r["blocks"]} for r in rows if r["day"] >= first), key=lambda d: d["date"])

    monday = today - timedelta(days=today.weekday())
    starts = [monday - timedelta(weeks=i) for i in range(XP_WEEKS - 1, -1, -1)]
    entries = (
        XPLedger.objects.filter(player=player, created_at__gte=now - timedelta(weeks=XP_WEEKS + 1))
        .annotate(week=TruncWeek("created_at", tzinfo=zone))
        .order_by()
        .values("week")
        .annotate(xp=Sum("delta"))
    )
    earned = {r["week"].date(): r["xp"] for r in entries}
    return {
        "today": today,
        "time_zone": player.time_zone,
        "days": days,
        "weeks": [{"start": start, "xp": earned.get(start, 0)} for start in starts],
        "recent": [_recent(b) for b in FocusBlock.objects.filter(player=player)[:RECENT_BLOCKS]],
    }
