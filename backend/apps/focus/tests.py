from datetime import timedelta

import pytest
from django.db import IntegrityError, transaction

from apps.focus.models import FocusBlock, PlaySession
from apps.game import rules, services
from apps.game.models import TimeLedger

BLOCKS = "/api/v1/focus/blocks/"


def start(api, minutes=25, goal="Ship it"):
    return api.post(BLOCKS, {"goal": goal, "minutes": minutes}, format="json")


def claim(api, block_id, done=True):
    return api.post(f"{BLOCKS}{block_id}/claim/", {"done": done}, format="json")


def finish(api, clock, minutes=25, done=True):
    block = start(api, minutes).json()["block"]
    clock.advance(minutes=minutes, seconds=1)
    return claim(api, block["id"], done)


def error(response):
    return response.json()["error"]["code"]


class TestStartingABlock:
    def test_uses_the_server_clock(self, api, clock):
        block = start(api, 25).json()["block"]
        row = FocusBlock.objects.get(pk=block["id"])
        assert row.started_at == clock.now()
        assert row.ends_at == clock.now() + timedelta(minutes=25)

    def test_ignores_times_sent_by_the_client(self, api, clock):
        response = api.post(BLOCKS, {"goal": "x", "minutes": 25, "started_at": "2020-01-01T00:00:00Z", "ends_at": "2020-01-01T00:00:01Z"}, format="json")
        row = FocusBlock.objects.get(pk=response.json()["block"]["id"])
        assert row.started_at == clock.now()

    @pytest.mark.parametrize("minutes", [0, 1, 14, 16, 60, -25, 1000000])
    def test_only_allows_the_real_lengths(self, api, minutes):
        assert start(api, minutes).status_code == 400

    @pytest.mark.parametrize("goal", ["", "   ", "x" * 101])
    def test_needs_a_sensible_goal(self, api, goal):
        assert start(api, 25, goal).status_code == 400

    def test_only_one_at_a_time(self, api, clock):
        start(api)
        response = start(api)
        assert response.status_code == 409 and error(response) == "block_in_progress"

    def test_the_database_also_refuses_two_at_once(self, user, clock):
        make = lambda: FocusBlock.objects.create(player=user.player, goal="x", minutes=25, started_at=clock.now(), ends_at=clock.now())
        make()
        with pytest.raises(IntegrityError), transaction.atomic():
            make()

    def test_a_finished_but_unclaimed_block_still_blocks_a_new_one(self, api, clock):
        start(api, 15)
        clock.advance(minutes=20)
        assert error(start(api)) == "block_in_progress"


class TestClaiming:
    # The block itself starts a one-day streak, so its XP already has the +5%.
    @pytest.mark.parametrize("minutes,seconds,xp", [(15, 300, 16), (25, 480, 26), (45, 900, 47)])
    def test_pays_what_the_table_says_when_goal_not_finished(self, api, clock, minutes, seconds, xp):
        body = finish(api, clock, minutes, done=False).json()
        assert body["seconds_earned"] == seconds
        assert body["bank_seconds"] == 300 + seconds
        assert body["xp"] == xp

    @pytest.mark.parametrize("minutes", rules.BLOCK_MINUTES)
    def test_finishing_the_goal_adds_the_bonus(self, api, clock, minutes):
        body = finish(api, clock, minutes, done=True).json()
        assert body["seconds_earned"] == rules.EARN_SECONDS[minutes] + 120
        assert body["xp"] == rules.apply_multiplier(minutes + 10, 1)

    def test_is_refused_before_the_timer_ends(self, api, clock):
        block = start(api, 25).json()["block"]
        clock.advance(minutes=24, seconds=59)
        response = claim(api, block["id"])
        assert response.status_code == 409 and error(response) == "block_not_finished"
        assert api.user.player.bank() == 300

    def test_works_exactly_at_the_end(self, api, clock):
        block = start(api, 25).json()["block"]
        clock.advance(minutes=25)
        assert claim(api, block["id"]).status_code == 200

    def test_is_refused_the_second_time(self, api, clock):
        block = start(api, 25).json()["block"]
        clock.advance(minutes=26)
        assert claim(api, block["id"]).status_code == 200
        bank = api.user.player.bank()
        response = claim(api, block["id"])
        assert response.status_code == 409 and error(response) == "already_claimed"
        assert api.user.player.bank() == bank

    def test_focus_stops_at_the_cap(self, api, clock):
        services.add_time(api.user.player, rules.BANK_CAP - 300 - 60, TimeLedger.Reason.FOCUS)
        finish(api, clock, 25)
        assert api.user.player.bank() == rules.BANK_CAP

    def test_never_takes_time_away_from_a_bank_over_the_cap(self, api, clock):
        services.add_time(api.user.player, rules.BONUS_CAP - 300, TimeLedger.Reason.STREAK)
        finish(api, clock, 25)
        assert api.user.player.bank() == rules.BONUS_CAP

    def test_applies_the_streak_multiplier(self, api, clock):
        p = api.user.player
        p.streak = 4
        p.last_streak_day = services.local_date(p, clock.now() - timedelta(days=1))
        p.save()
        assert finish(api, clock, 25, done=False).json()["xp"] == 31  # streak 5, so +25%

    def test_needs_a_true_or_false(self, api, clock):
        block = start(api, 25).json()["block"]
        clock.advance(minutes=26)
        assert api.post(f"{BLOCKS}{block['id']}/claim/", {}, format="json").status_code == 400

    def test_counts_towards_the_streak_and_first_block_badge(self, api, clock):
        body = finish(api, clock).json()
        assert body["streak"] == 1
        assert {"type": "badge", "code": "firstblock", "name": "First Block"} in body["events"]


class TestEndingEarly:
    def test_earns_nothing(self, api, clock):
        block = start(api).json()["block"]
        clock.advance(minutes=24)
        assert api.post(f"{BLOCKS}{block['id']}/abandon/").status_code == 200
        p = api.user.player
        p.refresh_from_db()
        assert p.bank() == 300 and p.xp == 0 and p.streak == 0

    def test_cant_claim_afterwards(self, api, clock):
        block = start(api).json()["block"]
        api.post(f"{BLOCKS}{block['id']}/abandon/")
        clock.advance(minutes=30)
        assert error(claim(api, block["id"])) == "already_claimed"

    def test_lets_you_start_again(self, api, clock):
        block = start(api).json()["block"]
        api.post(f"{BLOCKS}{block['id']}/abandon/")
        assert start(api).status_code == 201


class TestDrifts:
    def test_are_free_and_counted(self, api, clock):
        block = start(api).json()["block"]
        assert api.post(f"{BLOCKS}{block['id']}/drift/").json()["block"]["drifts"] == 1
        assert api.user.player.bank() == 300

    def test_a_clean_block_has_none(self, api, clock):
        finish(api, clock)
        assert FocusBlock.objects.filter(player=api.user.player, drifts=0).count() == 1


class TestOtherPeoplesBlocks:
    @pytest.mark.parametrize("action,body", [("drift", {}), ("abandon", {}), ("claim", {"done": True})])
    def test_look_like_they_dont_exist(self, api, other_api, clock, action, body):
        block = start(api).json()["block"]
        clock.advance(minutes=30)
        response = other_api.post(f"{BLOCKS}{block['id']}/{action}/", body, format="json")
        assert response.status_code == 404
        row = FocusBlock.objects.get(pk=block["id"])
        assert row.outcome == "" and row.drifts == 0

    def test_arent_in_your_history(self, api, other_api, clock):
        start(api)
        assert other_api.get(BLOCKS).json()["blocks"] == []


class TestSessions:
    def test_opening_moves_the_whole_bank(self, api, clock):
        body = api.post("/api/v1/sessions/open/").json()
        p = api.user.player
        assert p.bank() == 0
        assert body["session"]["seconds_left"] == 300
        assert PlaySession.objects.get(player=p).expires_at == clock.now() + timedelta(seconds=300)

    def test_closing_returns_what_is_left(self, api, clock):
        api.post("/api/v1/sessions/open/")
        clock.advance(seconds=100)
        body = api.post("/api/v1/sessions/close/").json()
        assert body["returned_seconds"] == 200
        assert body["bank_seconds"] == 200

    def test_cant_open_two(self, api, clock):
        api.post("/api/v1/sessions/open/")
        response = api.post("/api/v1/sessions/open/")
        assert response.status_code == 409 and error(response) == "session_already_open"

    def test_cant_open_with_an_empty_bank(self, api, clock):
        api.post("/api/v1/sessions/open/")
        clock.advance(seconds=400)
        response = api.post("/api/v1/sessions/open/")
        assert error(response) == "no_play_time"

    def test_an_expired_session_gives_nothing_back(self, api, clock):
        api.post("/api/v1/sessions/open/")
        clock.advance(seconds=301)
        response = api.post("/api/v1/sessions/close/")
        assert error(response) == "no_active_session"
        assert api.user.player.bank() == 0

    def test_opening_and_closing_fast_cant_create_time(self, api, clock):
        for _ in range(5):
            api.post("/api/v1/sessions/open/")
            api.post("/api/v1/sessions/close/")
        assert api.user.player.bank() == 300

    def test_cant_open_during_a_block(self, api, clock):
        start(api)
        assert error(api.post("/api/v1/sessions/open/")) == "block_in_progress"

    def test_cant_open_with_an_unclaimed_block(self, api, clock):
        start(api, 15)
        clock.advance(minutes=20)
        assert error(api.post("/api/v1/sessions/open/")) == "block_in_progress"

    def test_starting_a_block_closes_the_session_and_keeps_the_time(self, api, clock):
        api.post("/api/v1/sessions/open/")
        clock.advance(seconds=100)
        start(api)
        p = api.user.player
        assert p.bank() == 200
        assert PlaySession.objects.get(player=p).closed_at is not None

    def test_the_database_refuses_two_open_sessions(self, user, clock):
        make = lambda: PlaySession.objects.create(player=user.player, opened_at=clock.now(), expires_at=clock.now())
        make()
        with pytest.raises(IntegrityError), transaction.atomic():
            make()

    def test_the_ledger_explains_every_second(self, api, clock):
        api.post("/api/v1/sessions/open/")
        clock.advance(seconds=100)
        api.post("/api/v1/sessions/close/")
        rows = list(TimeLedger.objects.filter(player=api.user.player).order_by("id").values_list("reason", "delta_seconds"))
        assert rows == [("starter", 300), ("session_open", -300), ("session_return", 200)]
