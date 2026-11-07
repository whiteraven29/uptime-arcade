from datetime import date

import pytest
from hypothesis import given
from hypothesis import strategies as st

from apps.focus.models import FocusBlock
from apps.game import rules, services
from apps.game.models import StreakReward, TimeLedger, UserBadge, XPLedger


class TestRulesNumbers:
    def test_focus_economy_matches_the_design(self):
        assert rules.EARN_SECONDS == {15: 300, 25: 480, 45: 900}
        assert rules.GOAL_BONUS_SECONDS == 120
        assert rules.BANK_CAP == 1800
        assert rules.BONUS_CAP == 3600
        assert rules.STARTER_BANK == 300

    @pytest.mark.parametrize("cleared,title", [(0, "Noob"), (9, "Noob"), (10, "Initiate"), (212, "Sage"), (213, "Archmage"), (500, "Archmage")])
    def test_level_from_cleared_count(self, cleared, title):
        assert rules.LEVELS[rules.level_index(cleared)][1] == title

    def test_there_is_a_badge_for_every_level_climbed(self):
        codes = {b[0] for b in rules.BADGES}
        assert {f"lv{i}" for i in range(2, 10)} <= codes
        assert "arch" in codes

    def test_there_is_a_badge_for_every_beyond_tier(self):
        codes = {b[0] for b in rules.BADGES}
        assert {f"bx{i}" for i in range(1, 6)} <= codes

    def test_badge_codes_are_unique(self):
        codes = [b[0] for b in rules.BADGES]
        assert len(codes) == len(set(codes))

    def test_a_mission_is_never_worth_less_than_the_minimum(self):
        assert rules.mission_worth(100, 0, 50) == rules.MIN_MISSION_XP
        assert rules.mission_worth(100, 20, 2) == 90


class TestRulesProperties:
    @given(st.integers(min_value=0, max_value=100_000))
    def test_streak_multiplier_stays_in_range(self, streak):
        assert 1 <= rules.multiplier(streak) <= 1.5

    @given(st.integers(min_value=0), st.integers(min_value=0, max_value=10_000))
    def test_focus_never_lowers_the_bank_or_passes_the_cap(self, bank, earned):
        credit = rules.focus_credit(bank, earned)
        assert credit >= 0
        assert credit <= earned
        assert bank + credit <= max(bank, rules.BANK_CAP)

    @given(st.integers(min_value=0), st.integers(min_value=0, max_value=10_000))
    def test_streak_rewards_never_pass_their_higher_cap(self, bank, earned):
        assert bank + rules.streak_credit(bank, earned) <= max(bank, rules.BONUS_CAP)

    @given(st.integers(min_value=0, max_value=500), st.integers(min_value=0, max_value=500))
    def test_clearing_more_never_lowers_the_level(self, a, b):
        low, high = sorted((a, b))
        assert rules.level_index(low) <= rules.level_index(high)

    @given(st.integers(min_value=1, max_value=1000), st.integers(min_value=0, max_value=20), st.integers(min_value=0, max_value=50))
    def test_a_mission_always_pays_something_positive(self, base, bonus, hints):
        assert rules.mission_worth(base, bonus, hints) >= rules.MIN_MISSION_XP


class TestLedgers:
    def test_xp_on_the_player_always_equals_the_ledger(self, user):
        p = user.player
        p.streak = 4
        p.save()
        services.award_xp(p, 100, XPLedger.Reason.FOCUS, "block", 1)
        services.award_xp(p, 30, XPLedger.Reason.FOCUS, "block", 2)
        assert p.xp == sum(XPLedger.objects.filter(player=p).values_list("delta", flat=True)) == 120 + 36

    def test_bank_is_the_sum_of_the_ledger(self, user):
        p = user.player
        services.add_time(p, 100, TimeLedger.Reason.FOCUS)
        services.add_time(p, -50, TimeLedger.Reason.SESSION_OPEN)
        assert p.bank() == 300 + 100 - 50

    def test_the_same_mission_cant_be_paid_twice(self, user):
        from django.db import IntegrityError, transaction

        p = user.player
        services.award_xp(p, 100, XPLedger.Reason.MISSION, "mission", "sh-01:s1")
        with pytest.raises(IntegrityError), transaction.atomic():
            services.award_xp(p, 100, XPLedger.Reason.MISSION, "mission", "sh-01:s1")


class TestStreak:
    def day(self, clock, player, *when):
        clock.set(*when)
        return services.record_streak_day(player)

    def test_starts_at_one(self, user, clock):
        p = user.player
        self.day(clock, p, 2026, 11, 6, 8)
        assert p.streak == 1

    def test_grows_on_the_next_day_only(self, user, clock):
        p = user.player
        self.day(clock, p, 2026, 11, 6, 8)
        self.day(clock, p, 2026, 11, 6, 15)
        assert p.streak == 1
        self.day(clock, p, 2026, 11, 7, 8)
        assert p.streak == 2

    def test_uses_a_shield_for_a_missed_day(self, user, clock):
        p = user.player
        p.shields = 1
        p.save()
        self.day(clock, p, 2026, 11, 6, 8)
        events = self.day(clock, p, 2026, 11, 8, 8)
        assert p.streak == 2 and p.shields == 0
        assert {"type": "shield_used", "days": 1} in events

    def test_too_few_shields_resets_and_keeps_them(self, user, clock):
        p = user.player
        p.shields = 1
        p.streak = 5
        p.last_streak_day = date(2026, 11, 1)
        p.save()
        self.day(clock, p, 2026, 11, 6, 8)
        assert p.streak == 1 and p.shields == 1

    def test_day_boundary_uses_the_players_time_zone(self, user, clock):
        p = user.player
        p.time_zone = "Africa/Dar_es_Salaam"  # UTC+3
        p.save()
        self.day(clock, p, 2026, 11, 6, 20)  # 23:00 on the 6th there
        assert p.last_streak_day == date(2026, 11, 6)
        self.day(clock, p, 2026, 11, 6, 21, 30)  # 00:30 on the 7th there, same UTC date
        assert p.last_streak_day == date(2026, 11, 7)
        assert p.streak == 2

    def test_the_same_moment_can_be_a_different_day_elsewhere(self, user, clock):
        p = user.player
        p.time_zone = "America/Los_Angeles"
        p.save()
        self.day(clock, p, 2026, 11, 7, 2)  # still the evening of the 6th in LA
        assert p.last_streak_day == date(2026, 11, 6)

    def test_moving_the_time_zone_backwards_doesnt_break_the_streak(self, user, clock):
        p = user.player
        p.streak = 5
        p.last_streak_day = date(2026, 11, 7)
        p.save()
        self.day(clock, p, 2026, 11, 6, 20)  # an earlier local date than the last one
        assert p.streak == 5
        assert p.last_streak_day == date(2026, 11, 7)

    def test_best_streak_survives_a_reset(self, user, clock):
        p = user.player
        p.streak = 9
        p.best_streak = 9
        p.last_streak_day = date(2026, 11, 1)
        p.save()
        self.day(clock, p, 2026, 11, 6, 8)
        assert p.streak == 1 and p.best_streak == 9

    @pytest.mark.parametrize("days,seconds,xp,shields", rules.STREAK_MILESTONES)
    def test_each_milestone_pays_what_the_table_says(self, user, clock, days, seconds, xp, shields):
        p = user.player
        p.streak = days - 1
        p.last_streak_day = date(2026, 11, 5)
        # Everything below this milestone was already paid.
        for lower, *_ in rules.STREAK_MILESTONES:
            if lower < days:
                StreakReward.objects.create(player=p, milestone=lower, claimed_at=clock.now())
        p.save()
        before = p.bank()
        events = self.day(clock, p, 2026, 11, 6, 8)
        assert any(e["type"] == "streak_reward" and e["days"] == days for e in events)
        assert p.xp == xp
        assert p.bank() == before + seconds
        assert p.shields == shields

    def test_a_milestone_pays_only_once_per_account(self, user, clock):
        p = user.player
        p.streak = 2
        p.last_streak_day = date(2026, 11, 5)
        p.save()
        self.day(clock, p, 2026, 11, 6, 8)
        xp = p.xp
        p.streak = 2
        p.last_streak_day = date(2026, 11, 6)
        p.save()
        self.day(clock, p, 2026, 11, 7, 8)
        assert p.xp == xp

    def test_streak_rewards_can_raise_the_bank_to_the_higher_cap_only(self, user, clock):
        p = user.player
        services.add_time(p, rules.BONUS_CAP - 300 - 60, TimeLedger.Reason.FOCUS)
        p.streak = 2
        p.last_streak_day = date(2026, 11, 5)
        p.save()
        self.day(clock, p, 2026, 11, 6, 8)
        assert p.bank() == rules.BONUS_CAP


class TestPlayerAndRewards:
    def test_player_summary(self, api):
        body = api.get("/api/v1/player/").json()
        assert body["bank_seconds"] == 300
        assert body["level"]["title"] == "Noob"
        assert body["level"]["next_title"] == "Initiate"
        assert body["session"] is None
        assert body["username"] == api.user.username
        assert body["focus_minutes"] == 0 and body["blocks_finished"] == 0

    def test_player_reports_the_servers_clock(self, api, clock):
        assert api.get("/api/v1/player/").json()["server_time"].startswith("2026-11-06T08:00")

    def test_today_counts_only_todays_blocks_in_the_players_zone(self, api, clock):
        block = api.post("/api/v1/focus/blocks/", {"goal": "x", "minutes": 25}, format="json").json()["block"]
        api.post(f"/api/v1/focus/blocks/{block['id']}/drift/")
        FocusBlock.objects.filter(pk=block["id"]).update(checked_at=clock.now())
        clock.advance(minutes=26)
        api.post(f"/api/v1/focus/blocks/{block['id']}/claim/", {"done": True, "note": "Did the work"}, format="json")
        body = api.get("/api/v1/player/").json()
        assert body["today_minutes"] == 25 and body["today_drifts"] == 1
        assert body["focus_minutes"] == 25 and body["blocks_finished"] == 1
        clock.advance(days=1)
        body = api.get("/api/v1/player/").json()
        assert body["today_minutes"] == 0 and body["focus_minutes"] == 25

    def test_rewards_list_everything(self, api):
        body = api.get("/api/v1/rewards/").json()
        assert len(body["streak"]) == 7
        assert len(body["levels"]) == 10
        assert len(body["badges"]) == len(rules.BADGES)
        assert all(b["earned_at"] is None for b in body["badges"])

    def test_each_badge_is_earned_once(self, user, clock):
        p = user.player
        p.best_streak = 7
        p.save()
        first = services.award_badges(p)
        assert {"type": "badge", "code": "week", "name": "Full Week"} in first
        assert services.award_badges(p) == []
        assert UserBadge.objects.filter(player=p, code="week").count() == 1
