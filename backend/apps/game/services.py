"""The rules that change a player. Everything runs inside a transaction holding the player's row lock,
so two requests at once can't spend the same bank or be paid twice."""
import hashlib
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import F, Sum

from apps.core import clock

from . import rules
from .models import AvatarImage, Player, StreakDay, StreakReward, TimeLedger, UserBadge, XPLedger


def create_player(user):
    """Every account gets a player and the starter bank, however it was created (signals.py)."""
    with transaction.atomic():
        # Everyone starts with a system avatar picked from their username, so it's the same each time.
        index = int(hashlib.sha256(user.get_username().encode()).hexdigest(), 16) % rules.SYSTEM_AVATARS
        player = Player.objects.create(user=user, avatar_index=index)
        add_time(player, rules.STARTER_BANK, TimeLedger.Reason.STARTER)
    return player


def locked_player(user):
    """Call inside transaction.atomic. It's the single point every state change goes through."""
    return Player.objects.select_for_update().get(user=user)


def add_time(player, seconds, reason, ref_type="", ref_id=""):
    if seconds:
        TimeLedger.objects.create(player=player, delta_seconds=seconds, reason=reason, ref_type=ref_type, ref_id=str(ref_id), created_at=clock.now())


def award_xp(player, amount, reason, ref_type="", ref_id="", multiplied=True):
    mult = rules.multiplier(player.streak) if multiplied else 1
    value = rules.apply_multiplier(amount, player.streak) if multiplied else amount
    XPLedger.objects.create(player=player, delta=value, reason=reason, multiplier=mult, ref_type=ref_type, ref_id=str(ref_id), created_at=clock.now())
    Player.objects.filter(pk=player.pk).update(xp=F("xp") + value)
    player.refresh_from_db(fields=["xp"])
    return value


def local_date(player, moment=None):
    """Day boundaries always use the player's own time zone (section 17)."""
    return (moment or clock.now()).astimezone(ZoneInfo(player.time_zone)).date()


def _missed_study_days(player, today):
    """The days since the last streak day that should have had study. A planned day off isn't a missed day."""
    from apps.focus import plan

    if not player.last_streak_day:
        return 0
    return plan.study_days_between(player, player.last_streak_day + timedelta(days=1), today - timedelta(days=1))


def record_streak_day(player):
    """Section 6.7. Returns events. Called once per claimed block, and only the first each day counts."""
    today = local_date(player)
    StreakDay.objects.get_or_create(player=player, date=today)
    # Also covers moving your time zone backwards: that must never count as a gap and reset a streak.
    if player.last_streak_day and today <= player.last_streak_day:
        return []
    events = []
    missed = _missed_study_days(player, today)
    if missed == 0:
        player.streak += 1
    elif player.shields >= missed:
        player.shields -= missed
        player.streak += 1
        events.append({"type": "shield_used", "days": missed})
    else:
        player.streak = 1  # shields are kept, as section 6.7 says
    player.last_streak_day = today
    player.best_streak = max(player.best_streak, player.streak)
    player.save(update_fields=["streak", "shields", "last_streak_day", "best_streak"])
    for days, seconds, xp, shields in rules.STREAK_MILESTONES:
        if player.streak < days or StreakReward.objects.filter(player=player, milestone=days).exists():
            continue
        StreakReward.objects.create(player=player, milestone=days, claimed_at=clock.now())
        add_time(player, rules.streak_credit(player.bank(), seconds), TimeLedger.Reason.STREAK, "streak", days)
        award_xp(player, xp, XPLedger.Reason.STREAK, "streak", days, multiplied=False)
        if shields:
            player.shields += shields
            player.save(update_fields=["shields"])
        events.append({"type": "streak_reward", "days": days, "seconds": seconds, "xp": xp, "shields": shields})
    return events


def _track_cleared(player, code):
    from apps.content.models import Mission
    from apps.missions.models import MissionProgress

    total = Mission.objects.filter(track__code=code, status=Mission.Status.PUBLISHED).count()
    done = MissionProgress.objects.filter(player=player, season=player.season, mission__track__code=code, state=MissionProgress.State.CLEARED).count()
    return total > 0 and done >= total


def _clean_chapter(player):
    from apps.content.models import Chapter
    from apps.missions.models import MissionProgress

    clean = set(MissionProgress.objects.filter(player=player, season=player.season, solved_at__isnull=False, hints_used=0).values_list("mission_id", flat=True))
    for chapter in Chapter.objects.filter(track__after_archmage=False, track__side=False).prefetch_related("missions"):
        ids = {m.pk for m in chapter.missions.all()}
        if ids and ids <= clean:
            return True
    return False


def _tier_cleared(player, tier):
    from apps.content.models import Mission
    from apps.missions.models import MissionProgress

    ids = set(Mission.objects.filter(track__after_archmage=True, chapter__name=tier, status=Mission.Status.PUBLISHED).values_list("pk", flat=True))
    done = set(MissionProgress.objects.filter(player=player, state=MissionProgress.State.CLEARED, mission_id__in=ids).values_list("mission_id", flat=True))
    return bool(ids) and ids <= done


def _badge_tests(player):
    from apps.focus.models import FocusBlock
    from apps.missions.models import MissionProgress

    claimed = FocusBlock.objects.filter(player=player, claimed_at__isnull=False)
    minutes = claimed.aggregate(total=Sum("minutes"))["total"] or 0
    peak = player.peak_cleared
    level = rules.level_index(peak)
    tests = {
        "firstblock": lambda: claimed.exists(),
        "clean10": lambda: claimed.filter(drifts=0).count() >= 10,
        "hours10": lambda: minutes >= 600,
        "hours100": lambda: minutes >= 6000,
        "week": lambda: player.best_streak >= 7,
        "month": lambda: player.best_streak >= 30,
        "centurion": lambda: player.best_streak >= 100,
        "first": lambda: MissionProgress.objects.filter(player=player, state=MissionProgress.State.CLEARED).exists(),
        "par50": lambda: MissionProgress.objects.filter(player=player, par_bonus__gt=0).count() >= 50,
        "nohints": lambda: _clean_chapter(player),
        "night": lambda: player.oncall_resolved >= 25,
        "arch": lambda: level == len(rules.LEVELS) - 1,
    }
    for i in range(1, len(rules.LEVELS) - 1):
        tests[f"lv{i + 1}"] = lambda i=i: level >= i
    for code, _ in rules.CORE_TRACK_BADGES:
        tests[f"t{code}"] = lambda code=code: _track_cleared(player, code)
    tests["tOPS"] = lambda: _track_cleared(player, "OPS")
    for i, tier in enumerate(rules.BEYOND_TIERS):
        tests[f"bx{i + 1}"] = lambda tier=tier: _tier_cleared(player, tier)
    return tests


def award_badges(player):
    have = set(UserBadge.objects.filter(player=player).values_list("code", flat=True))
    names = {code: name for code, name, _ in rules.BADGES}
    events = []
    for code, test in _badge_tests(player).items():
        if code not in have and test():
            UserBadge.objects.create(player=player, code=code, earned_at=clock.now())
            events.append({"type": "badge", "code": code, "name": names[code]})
    return events


def core_mission_count():
    from apps.content.models import Mission

    return Mission.objects.filter(track__after_archmage=False, track__side=False, status=Mission.Status.PUBLISHED).count()


def current_season():
    from apps.content.models import Track

    return Track.objects.order_by("-season").values_list("season", flat=True).first() or 1


def avatar_summary(player):
    image = AvatarImage.objects.filter(player=player).values_list("token", flat=True).first()
    if image:
        return {"kind": "upload", "url": f"/api/v1/avatars/{image}.webp", "index": player.avatar_index}
    return {"kind": "system", "index": player.avatar_index}


def level_summary(player):
    index = rules.level_index(player.peak_cleared)
    needed, title = rules.LEVELS[index]
    upcoming = rules.LEVELS[index + 1] if index + 1 < len(rules.LEVELS) else None
    return {
        "index": index + 1,
        "title": title,
        "cleared": player.peak_cleared,
        "next_title": upcoming[1] if upcoming else None,
        "next_at": upcoming[0] if upcoming else None,
    }
