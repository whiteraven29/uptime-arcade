"""The study plan: when a block earns, and the weekly and monthly goals (ADRs 0010 and 0017).

Nothing can prove someone studied, so the aim is to make idling pointless. A block earns only inside
the times you set in advance, up to the amount you set, and paid minutes in a week can never pass what
was planned up to that day. Each study time is set on the player's own terms, with its rest breaks inside it, and a
kept block earns the break after it. Off-plan work still counts
on your map, and earns nothing."""
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

from .models import FocusBlock, StudyPlan, StudyTime, TargetReward, clock_text

PAID_KINDS = (FocusBlock.Kind.PLAN, FocusBlock.Kind.MAKEUP)  # make-ups are only in older history
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


def schedule_of(row, day):
    return row.schedule_on(day) if row is not None else None


def minute_of_day(local):
    return local.hour * 60 + local.minute


def open_window(schedule, local):
    """The study time this moment falls in, or None."""
    return schedule.at(minute_of_day(local))


def dates(first, last):
    for offset in range((last - first).days + 1):
        yield first + timedelta(days=offset)


def planned_minutes(rows, first, last):
    return sum(schedule.daily_minutes for day in dates(first, last) if (schedule := schedule_of(on_date(rows, day), day)))


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


FREE = (FocusBlock.Kind.FREE, 0)


def room_now(player, rows, moment):
    """(minutes a block started now can still earn, the study time it's in). Nothing outside a study time.
    A block earns if its length fits in this, which is exactly what `classify` checks."""
    row = in_force(rows, moment)
    if not row:
        return 0, None
    zone = ZoneInfo(row.time_zone)
    local = moment.astimezone(zone)
    today = local.date()
    schedule = row.schedule_on(today)
    current = open_window(schedule, local) if schedule else None
    if not current:
        return 0, None
    monday, _ = week_of(today)
    # What's been planned so far this week and not yet earned. Nothing earns past this, so no mix of
    # plan changes and extra blocks can pay for more than the plan asked for.
    week = planned_minutes(rows, monday, today) - paid_minutes(player, monday, today, zone)
    # Each study time earns its own study minutes, so the morning can't be spent in the evening.
    opened = day_start(today, zone) + timedelta(minutes=current.start)
    closed = day_start(today, zone) + timedelta(minutes=current.end)
    used = FocusBlock.objects.filter(
        player=player, kind__in=PAID_KINDS, outcome__in=PAID_OUTCOMES, started_at__gte=opened, started_at__lt=closed
    ).aggregate(total=Sum("minutes"))["total"] or 0
    return max(0, min(week, current.study_minutes - used)), current


def classify(player, minutes, moment, rows=None):
    """(kind, seconds of play it would earn) for a block of this length started at this moment. None without a plan.
    Outside your study times nothing earns (ADR 0017), however much of the week is still to do."""
    rows = rows_of(player) if rows is None else rows
    if not in_force(rows, moment):
        return None
    room, current = room_now(player, rows, moment)
    if minutes > room:
        return FREE
    return FocusBlock.Kind.PLAN, current.earns(minutes)


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
        schedule = schedule_of(on_date(rows, day), day)
        if not schedule:
            continue
        for time in schedule.times:
            if day > today or time.start > now:
                return {"date": day, "start": clock_text(time.start)}
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
        "block_min_minutes": rules.BLOCK_MIN_MINUTES,
        "block_max_minutes": rules.BLOCK_MAX_MINUTES,
        "rest_min_minutes": rules.REST_MIN_MINUTES,
        "rest_max_minutes": rules.REST_MAX_MINUTES,
        "rest_max_share": rules.REST_MAX_SHARE,
        "weekend": rules.WEEKEND,
        "max_windows": rules.PLAN_MAX_WINDOWS,
        "max_breaks": rules.PLAN_MAX_BREAKS,
        "max_day_minutes": rules.PLAN_MAX_DAY_MINUTES,
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
    schedule = row.schedule_on(today)
    window = open_window(schedule, local) if schedule else None
    # What a block would be like now, or in the next study time today, so the screen can preview it.
    preview = window or (schedule.after(minute_of_day(local)) if schedule else None)
    pending = rows[0] if rows[0].pk != row.pk else None
    room, _ = room_now(player, rows, now)
    return {
        "plan": row.public(),
        "pending": pending.public() if pending else None,
        "changes_open_on": None if _first_plan_is_open(player, rows) or (pending and pending.by_player) else _unlocks_on(rows, now),
        "today": {
            "date": today,
            "is_study_day": schedule is not None,
            "in_window": window is not None,
            "window_ends": clock_text(window.end) if window else None,
            "next_window": _next_window(rows, local),
            "minutes_planned": schedule.daily_minutes if schedule else 0,
            "minutes_earning": paid_minutes(player, today, today, zone),
            "block_minutes": preview.block_minutes if preview else None,
            "rest_minutes": preview.rest_minutes if preview else None,
            "slots": schedule.slots() if schedule else [],
            # Any length up to this earns right now, at rest_minutes for every block_minutes. The server decides again at the start.
            "room_minutes": room,
        },
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


def _schedule(windows, where=""):
    """Checks one day's study times and returns them in stored form. `where` says which day, when there are two."""
    bad = status.HTTP_400_BAD_REQUEST
    if not 1 <= len(windows) <= rules.PLAN_MAX_WINDOWS:
        raise GameError("bad_windows", f"{where}Set between 1 and {rules.PLAN_MAX_WINDOWS} study times.", bad)
    times = sorted((_minutes(w["start"]), _minutes(w["end"]), w["breaks"], w["rest_minutes"]) for w in windows)
    for start, end, _, _ in times:
        if end - start < rules.PLAN_MIN_WINDOW_MINUTES:
            raise GameError("window_too_short", f"{where}Each study time needs at least {rules.PLAN_MIN_WINDOW_MINUTES} minutes, and has to end the same day.", bad)
    if any(earlier[1] > later[0] for earlier, later in zip(times, times[1:])):
        raise GameError("windows_overlap", f"{where}Your study times overlap.", bad)
    if sum(end - start for start, end, _, _ in times) > rules.PLAN_MAX_DAY_MINUTES:
        hours = rules.PLAN_MAX_DAY_MINUTES // 60
        raise GameError("windows_too_wide", f"{where}Keep your study times to {hours} hours a day at most. A plan that covers all day isn't a plan.", bad)
    for row in times:
        time = StudyTime(*row)
        named = f"{where}{clock_text(time.start)} to {clock_text(time.end)}: "
        if not 1 <= time.breaks <= rules.PLAN_MAX_BREAKS:
            raise GameError("bad_breaks", f"{named}have 1 to {rules.PLAN_MAX_BREAKS} rest breaks.", bad)
        if not rules.REST_MIN_MINUTES <= time.rest_minutes <= rules.REST_MAX_MINUTES:
            raise GameError("bad_rest", f"{named}a break is {rules.REST_MIN_MINUTES} to {rules.REST_MAX_MINUTES} minutes.", bad)
        if time.block_minutes < rules.BLOCK_MIN_MINUTES:
            raise GameError("bad_block_length", f"{named}that leaves {max(0, time.block_minutes)} minutes of study between breaks, and it needs at least {rules.BLOCK_MIN_MINUTES}. Use fewer or shorter breaks, or a longer study time.", bad)
        if time.block_minutes > rules.BLOCK_MAX_MINUTES:
            raise GameError("bad_block_length", f"{named}that leaves {time.block_minutes} minutes of study between breaks, and {rules.BLOCK_MAX_MINUTES} is the most. Add a break, or shorten the study time.", bad)
        if not rules.rest_fits(time.block_minutes, time.rest_minutes):
            raise GameError("bad_rest", f"{named}each break can be at most half the {time.block_minutes} minutes of study before it, so {rules.rest_limit(time.block_minutes)} minutes or less.", bad)
    return [list(row) for row in times]


def clean(days, windows, weekend=None):
    """Checks a plan and returns it in stored form. A weekend's own times are only kept if a weekend day is studied."""
    days = sorted(set(days))
    if not days or any(day not in range(7) for day in days):
        raise GameError("bad_days", "Pick at least one day to study.", status.HTTP_400_BAD_REQUEST)
    studies_weekend = any(day in rules.WEEKEND for day in days)
    return {"days": days, "windows": _schedule(windows), "weekend": _schedule(weekend, "At the weekend, ") if weekend and studies_weekend else None}


@transaction.atomic
def set_plan(user, days, windows, weekend=None):
    """A first plan starts today. Later changes start tomorrow, at most once a week, so a plan can't be
    moved to wherever you happen to be right now."""
    player = services.locked_player(user)
    fields = clean(days, windows, weekend)
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
            "windows": newest.windows,
            "weekend": newest.weekend,
            "time_zone": player.time_zone,
            # A change the player already asked for stays theirs. The copy itself doesn't use up their weekly change.
            "by_player": newest.by_player and newest.effective_from == tomorrow,
            "created_at": newest.created_at if newest.effective_from == tomorrow else clock.now(),
        },
    )


