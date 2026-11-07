"""The study plan: when a block earns, and the weekly and monthly goals (ADR 0010).

Nothing can prove someone studied, so the aim is to make idling pointless. A block earns only inside
the times you set in advance, up to the amount you set, and paid minutes in a week can never pass what
was planned up to that day. Off-plan work still counts on your map."""
import re
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Sum
from rest_framework import status

from apps.core import clock
from apps.core.exceptions import GameError
from apps.game import rules, services
from apps.game.models import TimeLedger, XPLedger

from .models import FocusBlock, StudyPlan, TargetReward, clock_text

PAID_KINDS = (FocusBlock.Kind.PLAN, FocusBlock.Kind.MAKEUP)
PAID_OUTCOMES = (FocusBlock.Outcome.DONE, FocusBlock.Outcome.NOT_DONE)
CLOCK = re.compile(r"^(?:([01]\d|2[0-3]):([0-5]\d)|(24):(00))$")


def rows_of(player):
    return list(StudyPlan.objects.filter(player=player))  # newest start date first


def in_force(rows, moment):
    """Each plan's start date is in its own time zone."""
    for row in rows:
        if moment.astimezone(ZoneInfo(row.time_zone)).date() >= row.effective_from:
            return row
    return None


def on_date(rows, day):
    return next((row for row in rows if day >= row.effective_from), None)


def studies_on(row, day):
    return row is not None and day.weekday() in row.days


def minute_of_day(local):
    return local.hour * 60 + local.minute


def open_window(row, local):
    """The window this moment falls in. A window includes its start and stops just before its end."""
    now = minute_of_day(local)
    return next(((a, b) for a, b in row.windows if a <= now < b), None)


def dates(first, last):
    for offset in range((last - first).days + 1):
        yield first + timedelta(days=offset)


def planned_minutes(rows, first, last):
    return sum(on_date(rows, day).daily_minutes for day in dates(first, last) if studies_on(on_date(rows, day), day))


def day_start(day, zone):
    return datetime.combine(day, time.min, tzinfo=zone)


def paid_minutes(player, first, last, zone, kinds=PAID_KINDS):
    """Minutes that earned in these local dates, on the day each block started."""
    return FocusBlock.objects.filter(
        player=player,
        kind__in=kinds,
        outcome__in=PAID_OUTCOMES,
        started_at__gte=day_start(first, zone),
        started_at__lt=day_start(last + timedelta(days=1), zone),
    ).aggregate(total=Sum("minutes"))["total"] or 0


def week_of(day):
    monday = day - timedelta(days=day.weekday())
    return monday, monday + timedelta(days=6)


def month_of(day):
    first = day.replace(day=1)
    return first, (first + timedelta(days=32)).replace(day=1) - timedelta(days=1)


PERIODS = {"week": week_of, "month": month_of}


def _makeups_used(player, first, last, zone):
    return FocusBlock.objects.filter(
        player=player,
        kind=FocusBlock.Kind.MAKEUP,
        outcome__in=PAID_OUTCOMES,
        started_at__gte=day_start(first, zone),
        started_at__lt=day_start(last + timedelta(days=1), zone),
    ).count()


def classify(player, minutes, moment, rows=None):
    """What a block of this length, started at this moment, would be. None without a plan."""
    rows = rows_of(player) if rows is None else rows
    row = in_force(rows, moment)
    if not row:
        return None
    zone = ZoneInfo(row.time_zone)
    local = moment.astimezone(zone)
    today = local.date()
    monday, sunday = week_of(today)
    # What's been planned so far this week and not yet earned. Nothing earns past this, so no mix of
    # plan changes, make-ups and extra blocks can pay for more than the plan asked for.
    room = planned_minutes(rows, monday, today) - paid_minutes(player, monday, today, zone)
    if minutes > room:
        return FocusBlock.Kind.FREE
    used_today = paid_minutes(player, today, today, zone, (FocusBlock.Kind.PLAN,))
    if studies_on(row, today) and open_window(row, local) and used_today + minutes <= row.daily_minutes:
        return FocusBlock.Kind.PLAN
    if _makeups_used(player, monday, sunday, zone) < rules.MAKEUPS_PER_WEEK:
        return FocusBlock.Kind.MAKEUP
    return FocusBlock.Kind.FREE


def study_days_between(player, first, last):
    """How many days in this range should have had study. Before any plan, every day counted."""
    if last < first:
        return 0
    rows = rows_of(player)
    return sum(1 for day in dates(first, last) if on_date(rows, day) is None or studies_on(on_date(rows, day), day))


# ---------- goals ----------


def target_summary(player, rows, period, moment):
    row = in_force(rows, moment)
    zone = ZoneInfo(row.time_zone)
    first, last = PERIODS[period](moment.astimezone(zone).date())
    target = rules.target_minutes(period, planned_minutes(rows, first, last))
    seconds, xp = rules.target_reward(period, target)
    return {
        "period": period,
        "starts_on": first,
        "ends_on": last,
        "target_minutes": target,
        "minutes": paid_minutes(player, first, last, zone),
        "reached": TargetReward.objects.filter(player=player, period=period, starts_on=first).exists(),
        "reward_seconds": seconds,
        "reward_xp": xp,
    }


def settle_targets(player, moment):
    """Called holding the player's lock when a block pays. Goals are judged on the day the block started."""
    rows = rows_of(player)
    if not in_force(rows, moment):
        return []
    events = []
    for period in PERIODS:
        goal = target_summary(player, rows, period, moment)
        if goal["reached"] or not goal["target_minutes"] or goal["minutes"] < goal["target_minutes"]:
            continue
        reward = TargetReward.objects.create(player=player, period=period, starts_on=goal["starts_on"], target_minutes=goal["target_minutes"], reached_at=clock.now())
        seconds = rules.streak_credit(player.bank(), goal["reward_seconds"])
        services.add_time(player, seconds, TimeLedger.Reason.TARGET, "target", reward.pk)
        services.award_xp(player, goal["reward_xp"], XPLedger.Reason.TARGET, "target", reward.pk, multiplied=False)
        events.append({"type": "target_reached", "period": period, "minutes": goal["target_minutes"], "seconds": seconds, "xp": goal["reward_xp"]})
    return events


# ---------- reading ----------


def _next_window(rows, local):
    today = local.date()
    now = minute_of_day(local)
    for day in dates(today, today + timedelta(days=7)):
        row = on_date(rows, day)
        if not studies_on(row, day):
            continue
        for start, _ in row.windows:
            if day > today or start > now:
                return {"date": day, "start": clock_text(start)}
    return None


def _unlocks_on(rows, moment):
    """The date a player can next change their plan, or None if they can now."""
    last = next((row for row in rows if row.by_player), None)
    if not last:
        return None
    unlocks = last.created_at + timedelta(days=rules.PLAN_CHANGE_DAYS)
    return unlocks.astimezone(ZoneInfo(last.time_zone)).date() if moment < unlocks else None


def _first_plan_is_open(player, rows):
    """Until you've started a block under a plan, nothing rides on it and a typo can be fixed."""
    return bool(rows) and not FocusBlock.objects.filter(player=player, started_at__gte=rows[-1].created_at).exists()


def status_of(player):
    rows = rows_of(player)
    now = clock.now()
    limits = {
        "makeups_per_week": rules.MAKEUPS_PER_WEEK,
        "max_blocks_per_day": rules.PLAN_MAX_BLOCKS_PER_DAY,
        "max_windows": rules.PLAN_MAX_WINDOWS,
        "min_window_minutes": rules.PLAN_MIN_WINDOW_MINUTES,
        "change_days": rules.PLAN_CHANGE_DAYS,
        "presence_window_seconds": rules.PRESENCE_WINDOW_SECONDS,
        "claim_window_seconds": rules.CLAIM_WINDOW_SECONDS,
        "note_min_length": rules.NOTE_MIN_LENGTH,
        "note_max_length": rules.NOTE_MAX_LENGTH,
    }
    row = in_force(rows, now)
    if not row:
        return {"plan": None, "pending": None, "changes_open_on": None, "today": None, "outlook": None, "targets": None, "limits": limits, "time_zone": player.time_zone}
    zone = ZoneInfo(row.time_zone)
    local = now.astimezone(zone)
    today = local.date()
    monday, sunday = week_of(today)
    window = open_window(row, local) if studies_on(row, today) else None
    pending = rows[0] if rows[0].pk != row.pk else None
    return {
        "plan": row.public(),
        "pending": pending.public() if pending else None,
        "changes_open_on": None if _first_plan_is_open(player, rows) or (pending and pending.by_player) else _unlocks_on(rows, now),
        "today": {
            "date": today,
            "is_study_day": studies_on(row, today),
            "in_window": window is not None,
            "window_ends": clock_text(window[1]) if window else None,
            "next_window": _next_window(rows, local),
            "minutes_planned": row.daily_minutes if studies_on(row, today) else 0,
            "minutes_earning": paid_minutes(player, today, today, zone),
            "makeups_left": max(0, rules.MAKEUPS_PER_WEEK - _makeups_used(player, monday, sunday, zone)),
        },
        "outlook": {str(minutes): classify(player, minutes, now, rows) for minutes in rules.BLOCK_MINUTES},
        "targets": {period: target_summary(player, rows, period, now) for period in PERIODS},
        "limits": limits,
        "time_zone": player.time_zone,
    }


# ---------- changing ----------


def _minutes(text):
    match = CLOCK.match(text)
    if not match:
        raise GameError("bad_time", "Study times look like 18:30.", status.HTTP_400_BAD_REQUEST)
    hours, minutes = (match.group(1), match.group(2)) if match.group(1) else (match.group(3), match.group(4))
    return int(hours) * 60 + int(minutes)


def clean(days, blocks_per_day, block_minutes, windows):
    """Checks a plan and returns it in stored form."""
    bad = status.HTTP_400_BAD_REQUEST
    days = sorted(set(days))
    if not days or any(day not in range(7) for day in days):
        raise GameError("bad_days", "Pick at least one day to study.", bad)
    if block_minutes not in rules.BLOCK_MINUTES:
        raise GameError("bad_block_length", "A block is 15, 25 or 45 minutes.", bad)
    if not 1 <= blocks_per_day <= rules.PLAN_MAX_BLOCKS_PER_DAY:
        raise GameError("bad_blocks_per_day", f"Plan between 1 and {rules.PLAN_MAX_BLOCKS_PER_DAY} blocks a day.", bad)
    if not 1 <= len(windows) <= rules.PLAN_MAX_WINDOWS:
        raise GameError("bad_windows", f"Set between 1 and {rules.PLAN_MAX_WINDOWS} study times.", bad)
    spans = sorted((_minutes(w["start"]), _minutes(w["end"])) for w in windows)
    for start, end in spans:
        if end - start < rules.PLAN_MIN_WINDOW_MINUTES:
            raise GameError("window_too_short", f"Each study time needs at least {rules.PLAN_MIN_WINDOW_MINUTES} minutes, and has to end the same day.", bad)
    if any(earlier[1] > later[0] for earlier, later in zip(spans, spans[1:])):
        raise GameError("windows_overlap", "Your study times overlap.", bad)
    total = sum(end - start for start, end in spans)
    daily = blocks_per_day * block_minutes
    if total < daily:
        raise GameError("windows_too_small", f"Your study times need to add up to at least your {daily} minutes a day.", bad)
    limit = max(rules.PLAN_WINDOW_FLOOR_MINUTES, daily * rules.PLAN_WINDOW_SLACK)
    if total > limit:
        raise GameError("windows_too_wide", f"Keep your study times to {limit} minutes a day at most. A plan that covers all day isn't a plan.", bad)
    return {"days": days, "blocks_per_day": blocks_per_day, "block_minutes": block_minutes, "windows": [list(span) for span in spans]}


@transaction.atomic
def set_plan(user, days, blocks_per_day, block_minutes, windows):
    """A first plan starts today. Later changes start tomorrow, at most once a week, so a plan can't be
    moved to wherever you happen to be right now."""
    player = services.locked_player(user)
    fields = clean(days, blocks_per_day, block_minutes, windows)
    now = clock.now()
    fields |= {"time_zone": player.time_zone, "created_at": now, "by_player": True}
    today = now.astimezone(ZoneInfo(player.time_zone)).date()
    rows = rows_of(player)
    if not rows:
        return StudyPlan.objects.create(player=player, effective_from=today, **fields)
    if _first_plan_is_open(player, rows):
        return _update(rows[0], fields)
    current = in_force(rows, now)
    pending = rows[0] if not current or rows[0].pk != current.pk else None
    if pending and pending.by_player:
        return _update(pending, fields)  # it hasn't started, and whatever replaces it can't start sooner
    unlocks = _unlocks_on(rows, now)
    if unlocks:
        raise GameError("plan_locked", f"You can change your plan once every {rules.PLAN_CHANGE_DAYS} days. Next on {unlocks.isoformat()}.")
    if pending:
        return _update(pending, fields)
    row, _ = StudyPlan.objects.update_or_create(player=player, effective_from=today + timedelta(days=1), defaults=fields)
    return row


def _update(row, fields):
    for name, value in fields.items():
        setattr(row, name, value)
    row.save()
    return row


def follow_time_zone(player):
    """Called holding the player's lock. Study times stay put in the old zone until tomorrow in the new one,
    so moving your clock can't open a window, or a new day's allowance, right now."""
    rows = rows_of(player)
    if not rows:
        return
    newest = rows[0]
    tomorrow = clock.now().astimezone(ZoneInfo(player.time_zone)).date() + timedelta(days=1)
    StudyPlan.objects.filter(player=player, effective_from__gt=tomorrow).delete()
    StudyPlan.objects.update_or_create(
        player=player,
        effective_from=tomorrow,
        defaults={
            "days": newest.days,
            "blocks_per_day": newest.blocks_per_day,
            "block_minutes": newest.block_minutes,
            "windows": newest.windows,
            "time_zone": player.time_zone,
            # A change the player already asked for stays theirs. The copy itself doesn't use up their weekly change.
            "by_player": newest.by_player and newest.effective_from == tomorrow,
            "created_at": newest.created_at if newest.effective_from == tomorrow else clock.now(),
        },
    )


