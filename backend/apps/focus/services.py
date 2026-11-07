"""Focus blocks and play sessions (sections 6.1 and 6.2). All times come from the server's clock."""
import math
import secrets
from datetime import timedelta

from django.db import transaction
from rest_framework import status

from apps.core import clock
from apps.core.exceptions import GameError
from apps.game import rules, services
from apps.game.models import TimeLedger, XPLedger

from . import plan
from .models import FocusBlock, PlaySession


def current_block(player):
    """The block running or waiting to be claimed. One left past its claim deadline is simply over."""
    deadline = clock.now() - timedelta(seconds=rules.CLAIM_WINDOW_SECONDS)
    return FocusBlock.objects.filter(player=player, outcome="", ends_at__gte=deadline).first()


def _expire_unclaimed(player):
    deadline = clock.now() - timedelta(seconds=rules.CLAIM_WINDOW_SECONDS)
    FocusBlock.objects.filter(player=player, outcome="", ends_at__lt=deadline).update(outcome=FocusBlock.Outcome.EXPIRED)


def _check_moment(started_at, minutes):
    """A moment the player can't predict, leaving the whole check window before the block ends."""
    length = minutes * 60
    earliest = int(length * rules.PRESENCE_EARLIEST_SHARE)
    latest = length - rules.PRESENCE_WINDOW_SECONDS
    return started_at + timedelta(seconds=earliest + secrets.randbelow(latest - earliest + 1))


def current_session(player):
    """The open session, if it's still running. An expired one is simply over."""
    session = PlaySession.objects.filter(player=player, closed_at__isnull=True).first()
    return session if session and session.expires_at > clock.now() else None


def session_summary(session):
    if not session:
        return None
    return {"opened_at": session.opened_at, "expires_at": session.expires_at, "seconds_left": max(0, math.ceil((session.expires_at - clock.now()).total_seconds()))}


def require_session(player):
    session = current_session(player)
    if not session:
        raise GameError("no_active_session", "Open a session first. It takes play time you've earned.")
    return session


def _close_expired(player):
    """Time in an expired session has been used, so nothing goes back to the bank."""
    now = clock.now()
    for session in PlaySession.objects.filter(player=player, closed_at__isnull=True, expires_at__lte=now):
        session.closed_at = session.expires_at
        session.save(update_fields=["closed_at"])


def _close_session(player, session):
    now = clock.now()
    left = max(0, int((session.expires_at - now).total_seconds()))
    session.closed_at = now
    session.returned_seconds = left
    session.save(update_fields=["closed_at", "returned_seconds"])
    services.add_time(player, left, TimeLedger.Reason.SESSION_RETURN, "session", session.pk)
    return left


@transaction.atomic
def open_session(user):
    player = services.locked_player(user)
    _close_expired(player)
    if current_session(player):
        raise GameError("session_already_open", "A session is already open.")
    if current_block(player):
        raise GameError("block_in_progress", "Finish or claim your focus block first.")
    bank = player.bank()
    if bank <= 0:
        raise GameError("no_play_time", "No play time banked. Finish a focus block to earn some.")
    now = clock.now()
    session = PlaySession.objects.create(player=player, opened_at=now, expires_at=now + timedelta(seconds=bank))
    services.add_time(player, -bank, TimeLedger.Reason.SESSION_OPEN, "session", session.pk)
    return session


@transaction.atomic
def close_session(user):
    player = services.locked_player(user)
    _close_expired(player)
    session = current_session(player)
    if not session:
        raise GameError("no_active_session", "No session is open.")
    return _close_session(player, session)


@transaction.atomic
def start_block(user, goal, minutes):
    player = services.locked_player(user)
    goal = (goal or "").strip()
    if not goal:
        raise GameError("goal_required", "Say what you'll finish in this block.", status.HTTP_400_BAD_REQUEST)
    if len(goal) > rules.GOAL_MAX_LENGTH:
        raise GameError("goal_too_long", f"Keep the goal under {rules.GOAL_MAX_LENGTH} characters.", status.HTTP_400_BAD_REQUEST)
    if minutes not in rules.BLOCK_MINUTES:
        raise GameError("bad_block_length", "A block is 15, 25 or 45 minutes.", status.HTTP_400_BAD_REQUEST)
    now = clock.now()
    kind = plan.classify(player, minutes, now)
    if kind is None:
        raise GameError("plan_required", "Set your study plan first, so your blocks have something to count towards.")
    _expire_unclaimed(player)
    if current_block(player):
        raise GameError("block_in_progress", "You already have a block running or waiting to be claimed.")
    _close_expired(player)
    session = current_session(player)
    if session:
        _close_session(player, session)  # missions lock while a block runs, and unused time is kept
    return FocusBlock.objects.create(
        player=player,
        goal=goal,
        minutes=minutes,
        kind=kind,
        started_at=now,
        ends_at=now + timedelta(minutes=minutes),
        check_at=_check_moment(now, minutes),
    )


def own_block(player, block_id):
    block = FocusBlock.objects.filter(pk=block_id, player=player).first()
    if not block:
        raise GameError("not_found", "No such block.", status.HTTP_404_NOT_FOUND)
    return block


def _own_block(player, block_id):
    """Someone else's block looks exactly like one that doesn't exist."""
    block = FocusBlock.objects.select_for_update().filter(pk=block_id, player=player).first()
    if not block:
        raise GameError("not_found", "No such block.", status.HTTP_404_NOT_FOUND)
    return block


@transaction.atomic
def confirm_presence(user, block_id):
    player = services.locked_player(user)
    block = _own_block(player, block_id)
    if block.outcome:
        raise GameError("block_finished", "That block is over.")
    state = block.presence()
    if state == "waiting":
        raise GameError("check_not_due", "There's nothing to confirm yet.")
    if state == "missed":
        raise GameError("check_missed", "That check has passed, so this block won't earn anything.")
    if state == "due":
        block.checked_at = clock.now()
        block.save(update_fields=["checked_at"])
    return block


@transaction.atomic
def log_drift(user, block_id):
    player = services.locked_player(user)
    block = _own_block(player, block_id)
    if block.outcome:
        raise GameError("block_finished", "That block is over.")
    block.drifts += 1
    block.save(update_fields=["drifts"])
    return block


@transaction.atomic
def abandon_block(user, block_id):
    """Section 6.1: ending early earns nothing."""
    player = services.locked_player(user)
    block = _own_block(player, block_id)
    if block.outcome:
        raise GameError("block_finished", "That block is over.")
    block.outcome = FocusBlock.Outcome.ABANDONED
    block.save(update_fields=["outcome"])
    return block


def _clean_note(note):
    note = (note or "").strip()
    if len(note) < rules.NOTE_MIN_LENGTH:
        raise GameError("note_required", "Write a line about what you actually did.", status.HTTP_400_BAD_REQUEST)
    if len(note) > rules.NOTE_MAX_LENGTH:
        raise GameError("note_too_long", f"Keep it under {rules.NOTE_MAX_LENGTH} characters.", status.HTTP_400_BAD_REQUEST)
    return note


def _unpaid(player, result):
    return {"result": result, "seconds_earned": 0, "xp": 0, "streak": player.streak, "bank_seconds": player.bank(), "events": []}


@transaction.atomic
def claim_block(user, block_id, done, note=""):
    player = services.locked_player(user)
    block = _own_block(player, block_id)
    if block.outcome:
        raise GameError("already_claimed", "That block has already been settled.")
    now = clock.now()
    if now < block.ends_at:
        raise GameError("block_not_finished", "That block isn't over yet.")
    # These two settle the block rather than raise, because raising would roll the settling back.
    if now > block.claim_by:
        block.outcome = FocusBlock.Outcome.EXPIRED
        block.save(update_fields=["outcome"])
        return _unpaid(player, "expired")
    if block.check_at and not block.checked_at:
        block.outcome = FocusBlock.Outcome.MISSED
        block.save(update_fields=["outcome"])
        return _unpaid(player, "missed")

    block.note = _clean_note(note)
    block.claimed_at = now
    block.outcome = FocusBlock.Outcome.DONE if done else FocusBlock.Outcome.NOT_DONE
    block.save(update_fields=["note", "claimed_at", "outcome"])

    if block.kind == FocusBlock.Kind.FREE:
        return {**_unpaid(player, "free"), "events": services.award_badges(player)}

    bank = player.bank()
    earned = rules.focus_credit(bank, rules.EARN_SECONDS[block.minutes])
    services.add_time(player, earned, TimeLedger.Reason.FOCUS, "block", block.pk)
    bonus = rules.focus_credit(bank + earned, rules.GOAL_BONUS_SECONDS) if done else 0
    services.add_time(player, bonus, TimeLedger.Reason.GOAL_BONUS, "block", block.pk)

    events = services.record_streak_day(player)
    xp = services.award_xp(player, block.minutes + (rules.GOAL_BONUS_XP if done else 0), XPLedger.Reason.FOCUS, "block", block.pk)
    events += plan.settle_targets(player, block.started_at)
    events += services.award_badges(player)
    return {"result": block.kind, "seconds_earned": earned + bonus, "xp": xp, "streak": player.streak, "bank_seconds": player.bank(), "events": events}
