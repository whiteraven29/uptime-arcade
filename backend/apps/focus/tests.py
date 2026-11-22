import json
import random
from datetime import timedelta

import pytest
from django.db import IntegrityError, transaction

from apps.focus.models import FocusBlock, PlaySession, StudyPlan, TargetReward
from apps.game import rules, services
from apps.game.models import Player, TimeLedger, XPLedger

BLOCKS = "/api/v1/focus/blocks/"


def start(api, minutes=25, goal="Ship it"):
    return api.post(BLOCKS, {"goal": goal, "minutes": minutes}, format="json")


def claim(api, block_id, done=True, note="Did the work", checked=True):
    if checked:  # tests about the check itself say so
        FocusBlock.objects.filter(pk=block_id).update(checked_at=FocusBlock.objects.get(pk=block_id).started_at)
    return api.post(f"{BLOCKS}{block_id}/claim/", {"done": done, "note": note}, format="json")


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

    @pytest.mark.parametrize("minutes", [0, 1, 9, 91, -25, 1000000])
    def test_only_allows_lengths_in_range(self, api, minutes):
        assert start(api, minutes).status_code == 400

    @pytest.mark.parametrize("minutes", [10, 33, 50, 90])
    def test_any_length_in_range_will_do(self, api, minutes):
        assert start(api, minutes).status_code == 201

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
    # The block itself starts a one-day streak, so its XP already has the +5%. The test plan is 45 minute
    # blocks with 15 minutes of rest, so other lengths earn rest in step with their length.
    @pytest.mark.parametrize("minutes,seconds,xp", [(15, 300, 16), (25, 500, 26), (45, 900, 47)])
    def test_pays_the_plans_rest_when_goal_not_finished(self, api, clock, minutes, seconds, xp):
        body = finish(api, clock, minutes, done=False).json()
        assert body["seconds_earned"] == seconds
        assert body["bank_seconds"] == 300 + seconds
        assert body["xp"] == xp

    @pytest.mark.parametrize("minutes", [15, 25, 45])
    def test_finishing_the_goal_adds_xp_but_not_time(self, api, clock, minutes):
        body = finish(api, clock, minutes, done=True).json()
        assert body["seconds_earned"] == rules.rest_earned(45, 15, minutes)
        assert body["xp"] == rules.apply_multiplier(minutes + 10, 1)

    def test_what_it_earns_is_fixed_when_it_starts(self, api, clock):
        block = start(api, 45).json()["block"]
        assert block["earn_seconds"] == 900
        StudyPlan.objects.filter(player=api.user.player).update(windows=[[0, 1440, 24, 5]])
        clock.advance(minutes=45)
        assert claim(api, block["id"]).json()["seconds_earned"] == 900

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


# ---------- the study plan (ADR 0010) ----------

PLAN = "/api/v1/focus/plan/"
WEEKDAYS = [0, 1, 2, 3, 4]


def plan_body(**over):
    # 08:00 to 09:00 with two 5 minute breaks: two 25 minute blocks, Monday to Friday. 2026-11-06 is a Friday, and the
    # clock starts at 08:00 UTC.
    return {"days": WEEKDAYS, "windows": [w("08:00", "09:00")], **over}


def w(start, end, breaks=2, rest=5):
    """A study time on the player's terms."""
    return {"start": start, "end": end, "breaks": breaks, "rest_minutes": rest}


# Two hours with 30 minutes of rest in two breaks: 45 study, 15 play, 45 study, 15 play.
EVENING = [w("21:00", "23:00", 2, 15)]


def set_plan(api, breaks=None, **over):
    """`breaks` changes the morning's breaks, which tests use as a plain change to a plan."""
    if breaks:
        over["windows"] = [w("08:00", "09:00", breaks)]
    return api.put(PLAN, plan_body(**over), format="json")


def utc_player(api):
    """The plan's times are local, and these tests read best with local meaning UTC."""
    Player.objects.filter(pk=api.user.player.pk).update(time_zone="UTC")


def kind_of(response):
    return response.json()["block"]["kind"]


def run_block(api, clock, minutes=25, gap=None):
    """A block, kept honestly from start to claim."""
    block = start(api, minutes).json()["block"]
    clock.advance(minutes=minutes)
    body = claim(api, block["id"]).json()
    if gap:
        clock.advance(**gap)
    return block, body


@pytest.fixture
def planner(newcomer, clock):
    utc_player(newcomer)
    assert set_plan(newcomer).status_code == 200
    return newcomer


class TestSettingAPlan:
    def test_a_new_player_has_none(self, newcomer):
        body = newcomer.get(PLAN).json()
        assert body["plan"] is None and body["targets"] is None and body["limits"]["rest_max_share"] == 0.5

    def test_a_block_needs_one_first(self, newcomer, clock):
        response = start(newcomer)
        assert response.status_code == 409 and error(response) == "plan_required"
        assert not FocusBlock.objects.exists()

    def test_the_first_one_starts_today(self, newcomer, clock):
        utc_player(newcomer)
        body = set_plan(newcomer).json()
        assert body["plan"]["effective_from"] == "2026-11-06"
        assert body["plan"]["daily_minutes"] == 50
        assert body["plan"]["windows"] == [{"start": "08:00", "end": "09:00", "breaks": 2, "rest_minutes": 5, "block_minutes": 25, "study_minutes": 50}]
        assert body["today"]["in_window"] is True and body["today"]["window_ends"] == "09:00"

    def test_ignores_a_start_date_or_zone_from_the_client(self, newcomer, clock):
        utc_player(newcomer)
        body = set_plan(newcomer, effective_from="2020-01-01", time_zone="Asia/Tokyo", created_at="2020-01-01T00:00:00Z").json()
        assert body["plan"]["effective_from"] == "2026-11-06" and body["plan"]["time_zone"] == "UTC"

    @pytest.mark.parametrize("over,code", [
        ({"days": []}, "bad_days"),
        ({"days": [7]}, "bad_days"),
        ({"days": [-1]}, "bad_days"),
        ({"windows": []}, "bad_windows"),
        ({"windows": [w("08:00", "09:00")] * 4}, "bad_windows"),
        ({"windows": [w("8am", "09:00")]}, "bad_time"),
        ({"windows": [w("24:30", "24:45")]}, "bad_time"),
        ({"windows": [w("08:00", "08:29")]}, "window_too_short"),
        ({"windows": [w("23:00", "01:00")]}, "window_too_short"),
        ({"windows": [w("08:00", "09:30"), w("09:00", "10:30")]}, "windows_overlap"),
        ({"windows": [w("00:00", "24:00", 4)]}, "windows_too_wide"),
        ({"windows": [w("06:00", "10:30", 3), w("18:00", "22:00", 3)]}, "windows_too_wide"),  # 8:30 in a day
        ({"windows": [w("08:00", "09:00", 0)]}, "bad_breaks"),
        ({"windows": [w("08:00", "11:00", 5)]}, "bad_breaks"),
        ({"windows": [w("08:00", "09:00", 1, 4)]}, "bad_rest"),
        ({"windows": [w("08:00", "11:00", 2, 31)]}, "bad_rest"),
        ({"windows": [w("08:00", "09:00", 4, 10)]}, "bad_block_length"),  # leaves 5 minutes of study
        ({"windows": [w("08:00", "10:00", 1)]}, "bad_block_length"),  # leaves 115
        ({"windows": [w("08:00", "09:00", 2, 15)]}, "bad_rest"),  # 15 of play after 15 of study
        ({"days": [0, 5], "weekend": [w("21:00", "23:00", 2, 40)]}, "bad_rest"),
        ({"days": [0, 5], "weekend": [w("21:00", "21:20")]}, "window_too_short"),
    ])
    def test_refuses_a_plan_that_isnt_one(self, newcomer, clock, over, code):
        response = set_plan(newcomer, **over)
        assert response.status_code == 400 and error(response) == code
        assert not StudyPlan.objects.exists()

    def test_days_and_times_are_tidied(self, newcomer, clock):
        windows = [w("18:00", "19:00"), w("08:00", "09:00")]
        body = set_plan(newcomer, days=[4, 0, 4], windows=windows).json()
        assert body["plan"]["days"] == [0, 4]
        assert body["plan"]["windows"][0]["start"] == "08:00"

    def test_windows_can_touch(self, newcomer, clock):
        assert set_plan(newcomer, windows=[w("08:00", "09:00"), w("09:00", "10:00")]).status_code == 200

    def test_someone_elses_plan_stays_theirs(self, planner, other_api):
        assert other_api.get(PLAN).json()["plan"]["windows"][0]["breaks"] == 24


class TestChangingAPlan:
    def test_a_typo_can_be_fixed_until_the_first_block(self, planner, clock):
        body = set_plan(planner, breaks=3).json()
        assert body["plan"]["windows"][0]["breaks"] == 3 and body["plan"]["effective_from"] == "2026-11-06"
        assert StudyPlan.objects.count() == 1

    def test_a_typo_can_still_be_fixed_after_moving_your_zone(self, planner, clock):
        planner.patch("/api/v1/auth/me/", {"time_zone": "Asia/Tokyo"}, format="json")
        assert set_plan(planner, breaks=3).status_code == 200
        assert set_plan(planner, breaks=4).status_code == 200

    def test_after_a_block_it_is_locked_for_a_week(self, planner, clock):
        start(planner)
        response = set_plan(planner, breaks=3)
        assert response.status_code == 409 and error(response) == "plan_locked"
        assert "2026-11-13" in response.json()["error"]["message"]
        assert planner.get(PLAN).json()["changes_open_on"] == "2026-11-13"

    def test_a_change_starts_tomorrow_not_today(self, planner, clock):
        run_block(planner, clock)
        clock.advance(days=7)
        body = set_plan(planner, breaks=3).json()
        assert body["plan"]["windows"][0]["breaks"] == 2
        assert body["pending"]["windows"][0]["breaks"] == 3 and body["pending"]["effective_from"] == "2026-11-14"
        clock.advance(days=1)
        body = planner.get(PLAN).json()
        assert body["plan"]["windows"][0]["breaks"] == 3 and body["pending"] is None

    def test_cant_move_todays_window_to_where_you_are_now(self, planner, clock):
        run_block(planner, clock)
        clock.advance(days=7, hours=5)  # Friday 13:33, well outside the morning
        set_plan(planner, windows=[w("13:00", "15:00")])
        assert planner.get(PLAN).json()["today"]["in_window"] is False

    def test_a_change_waiting_to_start_can_be_replaced(self, planner, clock):
        run_block(planner, clock)
        clock.advance(days=7)
        set_plan(planner, breaks=3)
        body = set_plan(planner, breaks=4).json()
        assert body["pending"]["windows"][0]["breaks"] == 4
        assert body["pending"]["effective_from"] == "2026-11-14"

    def test_the_week_starts_again_after_a_change(self, planner, clock):
        run_block(planner, clock)
        clock.advance(days=7)
        set_plan(planner, breaks=3)
        clock.advance(days=1)
        assert error(set_plan(planner, breaks=4)) == "plan_locked"


class TestTimeZones:
    def test_windows_are_in_your_own_zone(self, newcomer, clock):
        Player.objects.filter(pk=newcomer.user.player.pk).update(time_zone="Africa/Nairobi")
        # 08:00 UTC is 11:00 in Nairobi.
        assert set_plan(newcomer, windows=[w("11:00", "12:00")]).json()["today"]["in_window"] is True

    def test_moving_your_zone_opens_no_window_today(self, planner, clock):
        clock.advance(hours=4)  # 12:00 UTC, past the morning
        assert planner.get(PLAN).json()["today"]["in_window"] is False
        planner.patch("/api/v1/auth/me/", {"time_zone": "America/Los_Angeles"}, format="json")  # it's 04:00 there
        planner.patch("/api/v1/auth/me/", {"time_zone": "America/New_York"}, format="json")  # refused: once a day
        body = planner.get(PLAN).json()
        assert body["plan"]["time_zone"] == "UTC" and body["today"]["in_window"] is False
        assert body["pending"]["time_zone"] == "America/Los_Angeles"

    def test_the_new_zone_starts_the_next_day_there(self, planner, clock):
        planner.patch("/api/v1/auth/me/", {"time_zone": "Asia/Tokyo"}, format="json")
        assert planner.get(PLAN).json()["pending"]["effective_from"] == "2026-11-07"
        clock.set(2026, 11, 6, 23, 30)  # 08:30 on the 7th in Tokyo, a Saturday and so a day off
        body = planner.get(PLAN).json()
        assert body["plan"]["time_zone"] == "Asia/Tokyo" and body["pending"] is None
        assert body["today"]["date"] == "2026-11-07" and body["today"]["is_study_day"] is False

    def test_moving_your_zone_doesnt_use_up_your_weekly_change(self, planner, clock):
        run_block(planner, clock)
        clock.advance(days=7)
        planner.patch("/api/v1/auth/me/", {"time_zone": "Asia/Tokyo"}, format="json")
        clock.advance(days=2)
        assert set_plan(planner, breaks=3).status_code == 200

    def test_moving_your_zone_cant_get_round_the_weekly_lock(self, planner, clock):
        run_block(planner, clock)
        planner.patch("/api/v1/auth/me/", {"time_zone": "Asia/Tokyo"}, format="json")
        assert error(set_plan(planner, breaks=3)) == "plan_locked"

    def test_no_plan_means_nothing_to_move(self, newcomer, clock):
        assert newcomer.patch("/api/v1/auth/me/", {"time_zone": "Asia/Tokyo"}, format="json").status_code == 200
        assert not StudyPlan.objects.exists()


class TestWhatABlockEarns:
    def test_inside_the_plan_it_pays_as_usual(self, planner, clock):
        response = start(planner)
        assert kind_of(response) == "plan"
        clock.advance(minutes=25)
        body = claim(planner, response.json()["block"]["id"]).json()
        assert body["result"] == "plan" and body["seconds_earned"] == 300 and body["xp"] == 37

    def test_a_window_includes_its_first_minute(self, planner, clock):
        clock.set(2026, 11, 6, 8, 0)
        assert planner.get(PLAN).json()["today"]["room_minutes"] == 50

    def test_a_window_stops_at_its_last_minute(self, planner, clock):
        clock.set(2026, 11, 6, 8, 59, 59)
        assert planner.get(PLAN).json()["today"]["in_window"] is True
        clock.set(2026, 11, 6, 9, 0)
        assert planner.get(PLAN).json()["today"]["in_window"] is False

    def test_only_the_start_needs_to_be_in_the_window(self, planner, clock):
        clock.set(2026, 11, 6, 8, 59)
        block = start(planner).json()["block"]
        assert block["kind"] == "plan"
        clock.advance(minutes=25)
        assert claim(planner, block["id"]).json()["seconds_earned"] == 300

    def test_the_daily_amount_is_the_limit(self, planner, clock):
        run_block(planner, clock)
        run_block(planner, clock)
        response = start(planner)
        assert kind_of(response) == "free"
        clock.advance(minutes=25)
        body = claim(planner, response.json()["block"]["id"]).json()
        assert body["result"] == "free" and body["seconds_earned"] == 0 and body["xp"] == 0

    def test_a_missed_day_doesnt_raise_todays_amount(self, newcomer, clock):
        utc_player(newcomer)
        clock.set(2026, 11, 9, 8, 0)  # Monday
        set_plan(newcomer)
        clock.set(2026, 11, 10, 8, 0)  # Tuesday, with Monday's 50 minutes unused
        run_block(newcomer, clock)
        run_block(newcomer, clock)
        # Still inside the window, but today's amount is done, and nothing earns past it.
        assert kind_of(start(newcomer)) == "free"

    def test_a_length_that_doesnt_fit_doesnt_earn(self, planner, clock):
        # 50 minutes a day: a 45 fits, and then a 15 doesn't, though there are 5 minutes left.
        run_block(planner, clock, 45)
        assert kind_of(start(planner, 15)) == "free"

    def test_a_longer_block_can_use_the_amount_its_own_way(self, planner, clock):
        assert kind_of(start(planner, 45)) == "plan"

    def test_abandoned_blocks_dont_use_up_the_day(self, planner, clock):
        for _ in range(3):
            block = start(planner).json()["block"]
            planner.post(f"{BLOCKS}{block['id']}/abandon/")
        assert kind_of(start(planner)) == "plan"

    def test_a_new_day_gets_a_new_amount(self, planner, clock):
        run_block(planner, clock)
        run_block(planner, clock)
        clock.set(2026, 11, 9, 8, 0)  # Monday, and a new week too
        assert kind_of(start(planner)) == "plan"

    def test_the_day_turns_over_in_your_zone(self, newcomer, clock):
        Player.objects.filter(pk=newcomer.user.player.pk).update(time_zone="Asia/Tokyo")
        clock.set(2026, 11, 8, 23, 0)  # 08:00 on Monday the 9th in Tokyo, still Sunday in UTC
        body = set_plan(newcomer).json()
        assert body["today"]["date"] == "2026-11-09" and body["today"]["is_study_day"] is True
        assert kind_of(start(newcomer)) == "plan"

    def test_extra_work_counts_but_doesnt_pay_or_touch_the_streak(self, planner, clock):
        run_block(planner, clock)
        run_block(planner, clock)
        before = planner.user.player.bank()
        _, body = run_block(planner, clock)
        p = planner.user.player
        p.refresh_from_db()
        assert body["result"] == "free"
        assert p.bank() == before and p.streak == 1
        assert planner.get("/api/v1/player/").json()["focus_minutes"] == 75


class TestNothingEarnsOutsideTheWindow:
    """ADR 0017: a block earns only inside your study times. There are no make-ups."""

    def test_before_the_window_is_extra(self, planner, clock):
        clock.set(2026, 11, 6, 7, 0)  # Friday, an hour before the morning
        assert kind_of(start(planner)) == "free"

    def test_after_the_window_is_extra_even_with_the_day_still_to_do(self, planner, clock):
        clock.set(2026, 11, 6, 15, 0)  # Friday afternoon, with today's 50 minutes still to do
        assert planner.get(PLAN).json()["today"]["room_minutes"] == 0
        _, body = run_block(planner, clock)
        assert body["result"] == "free" and body["seconds_earned"] == 0 and body["xp"] == 0

    def test_a_day_off_earns_nothing(self, planner, clock):
        clock.set(2026, 11, 7, 8, 0)  # Saturday, a day off, at the weekday's study time
        assert kind_of(start(planner)) == "free"

    def test_extra_blocks_still_go_on_the_map(self, planner, clock):
        clock.set(2026, 11, 6, 15, 0)
        run_block(planner, clock)
        days = planner.get("/api/v1/focus/history/").json()["days"]
        assert days == [{"date": "2026-11-06", "minutes": 25, "blocks": 1}]

    def test_nothing_is_said_about_make_ups(self, planner, clock):
        body = planner.get(PLAN).json()
        assert "makeups_left" not in body["today"] and "makeups_per_week" not in body["limits"]


class TestStudyTimesOnYourTerms:
    """ADR 0017: each study time is set by the player, with its rest breaks inside it, and the study between breaks
    is worked out from that."""

    MORNING_AND_EVENING = [w("04:00", "06:00", 2, 15), *EVENING]

    def plan(self, newcomer, windows=MORNING_AND_EVENING):
        utc_player(newcomer)
        return set_plan(newcomer, windows=windows)

    def test_two_study_times_with_thirty_minutes_of_play_in_each(self, newcomer, clock):
        clock.set(2026, 11, 9, 4, 0)  # Monday, 04:00
        body = self.plan(newcomer).json()
        assert body["plan"]["daily_minutes"] == 180
        assert [(t["start"], t["end"], t["block_minutes"], t["breaks"], t["rest_minutes"]) for t in body["plan"]["windows"]] == [
            ("04:00", "06:00", 45, 2, 15),
            ("21:00", "23:00", 45, 2, 15),
        ]
        assert body["today"]["slots"] == [
            {"kind": "study", "start": "04:00", "minutes": 45},
            {"kind": "rest", "start": "04:45", "minutes": 15},
            {"kind": "study", "start": "05:00", "minutes": 45},
            {"kind": "rest", "start": "05:45", "minutes": 15},
            {"kind": "study", "start": "21:00", "minutes": 45},
            {"kind": "rest", "start": "21:45", "minutes": 15},
            {"kind": "study", "start": "22:00", "minutes": 45},
            {"kind": "rest", "start": "22:45", "minutes": 15},
        ]

    def test_each_study_time_earns_its_own_minutes(self, newcomer, clock):
        clock.set(2026, 11, 9, 4, 0)
        self.plan(newcomer)
        # What each block earns, before the bank's 30:00 cap: these tests don't play the rest.
        run_block(newcomer, clock, 45, gap={"minutes": 15})
        second, _ = run_block(newcomer, clock, 45)
        assert second["kind"] == "plan" and second["earn_seconds"] == 900
        assert newcomer.get(PLAN).json()["today"]["room_minutes"] == 0  # 05:45: the morning's study is done
        clock.set(2026, 11, 9, 21, 0)
        assert newcomer.get(PLAN).json()["today"]["room_minutes"] == 90
        evening, _ = run_block(newcomer, clock, 45)
        assert evening["kind"] == "plan" and evening["earn_seconds"] == 900

    def test_a_missed_morning_cant_be_studied_in_the_evening(self, newcomer, clock):
        clock.set(2026, 11, 9, 21, 0)
        self.plan(newcomer)
        assert kind_of(start(newcomer, 90)) == "plan"
        FocusBlock.objects.filter(outcome="").delete()
        assert newcomer.get(PLAN).json()["today"]["room_minutes"] == 90

    def test_each_study_time_can_be_set_its_own_way(self, newcomer, clock):
        clock.set(2026, 11, 9, 4, 0)
        self.plan(newcomer, [w("04:00", "06:00", 3, 10), *EVENING])  # three 30s with 10 minute breaks
        today = newcomer.get(PLAN).json()["today"]
        assert (today["block_minutes"], today["rest_minutes"]) == (30, 10)
        _, claimed = run_block(newcomer, clock, 30)
        assert claimed["seconds_earned"] == 600
        clock.set(2026, 11, 9, 21, 0)
        today = newcomer.get(PLAN).json()["today"]
        assert (today["block_minutes"], today["rest_minutes"]) == (45, 15)

    def test_before_a_study_time_the_next_one_is_previewed(self, newcomer, clock):
        clock.set(2026, 11, 9, 12, 0)
        self.plan(newcomer)
        today = newcomer.get(PLAN).json()["today"]
        assert today["room_minutes"] == 0 and (today["block_minutes"], today["rest_minutes"]) == (45, 15)

    def test_fifty_minutes_of_study_can_have_a_twenty_five_minute_break(self, newcomer, clock):
        self.plan(newcomer, [w("08:00", "09:15", 1, 25)])
        _, claimed = run_block(newcomer, clock, 50)
        assert claimed["seconds_earned"] == 25 * 60

    def test_odd_numbers_are_fine(self, newcomer, clock):
        body = self.plan(newcomer, [w("08:00", "09:40", 2, 13)]).json()
        assert body["plan"]["windows"][0]["block_minutes"] == 37
        _, claimed = run_block(newcomer, clock, 37)
        assert claimed["seconds_earned"] == 13 * 60

    def test_another_length_earns_in_step_and_rounds_down(self, newcomer, clock):
        self.plan(newcomer, [w("08:00", "09:50", 2, 10)])  # two 45s
        _, claimed = run_block(newcomer, clock, 22)
        assert claimed["seconds_earned"] == 10 * 60 * 22 // 45

    def test_room_says_how_long_a_block_can_still_earn(self, newcomer, clock):
        self.plan(newcomer, [w("08:00", "10:30", 2, 25)])  # two 50s
        run_block(newcomer, clock, 30)
        assert newcomer.get(PLAN).json()["today"]["room_minutes"] == 70
        assert kind_of(start(newcomer, 71)) == "free"
        FocusBlock.objects.filter(outcome="").delete()
        assert kind_of(start(newcomer, 70)) == "plan"

    def test_the_limits_are_told(self, newcomer, clock):
        limits = newcomer.get(PLAN).json()["limits"]
        assert (limits["block_min_minutes"], limits["block_max_minutes"], limits["rest_min_minutes"], limits["rest_max_minutes"], limits["max_breaks"]) == (10, 90, 5, 30, 4)

    def test_the_message_names_the_study_time(self, newcomer, clock):
        response = self.plan(newcomer, [w("04:00", "06:00", 2, 15), w("21:00", "22:00", 4, 10)])
        assert error(response) == "bad_block_length" and "21:00 to 22:00" in response.json()["error"]["message"]


class TestRest:
    def evening(self, newcomer, **over):
        utc_player(newcomer)
        clock_body = {"days": WEEKDAYS, "windows": EVENING, **over}
        return newcomer.put(PLAN, clock_body, format="json")

    def test_two_hours_hold_two_blocks_and_their_rest(self, newcomer, clock):
        clock.set(2026, 11, 9, 21, 0)  # Monday evening
        body = self.evening(newcomer).json()
        assert body["plan"]["windows"][0]["rest_minutes"] == 15
        assert body["today"]["slots"] == [
            {"kind": "study", "start": "21:00", "minutes": 45},
            {"kind": "rest", "start": "21:45", "minutes": 15},
            {"kind": "study", "start": "22:00", "minutes": 45},
            {"kind": "rest", "start": "22:45", "minutes": 15},
        ]

    def test_a_kept_block_earns_its_rest(self, newcomer, clock):
        clock.set(2026, 11, 9, 21, 0)
        self.evening(newcomer)
        today = newcomer.get(PLAN).json()["today"]
        assert (today["room_minutes"], today["block_minutes"], today["rest_minutes"]) == (90, 45, 15)
        _, body = run_block(newcomer, clock, 45)
        assert body["result"] == "plan" and body["seconds_earned"] == 900

    def test_the_rest_can_be_played_and_the_next_block_still_earns(self, newcomer, clock):
        clock.set(2026, 11, 9, 21, 0)
        self.evening(newcomer)
        run_block(newcomer, clock, 45)
        newcomer.post("/api/v1/sessions/open/")
        clock.advance(minutes=15)
        _, body = run_block(newcomer, clock, 45)
        assert body["result"] == "plan" and body["seconds_earned"] == 900

    def test_a_shorter_block_earns_rest_in_step(self, newcomer, clock):
        clock.set(2026, 11, 9, 21, 0)
        self.evening(newcomer)
        _, body = run_block(newcomer, clock, 15)
        assert body["seconds_earned"] == 300

    def test_nothing_after_the_evening_ends(self, newcomer, clock):
        clock.set(2026, 11, 9, 23, 0)
        self.evening(newcomer)
        assert kind_of(start(newcomer, 45)) == "free"

    def test_a_day_off_has_no_slots(self, planner, clock):
        clock.set(2026, 11, 7, 8, 0)
        assert planner.get(PLAN).json()["today"]["slots"] == []


class TestWeekends:
    def plan(self, newcomer, weekend=EVENING, days=(0, 1, 2, 3, 4, 5, 6)):
        utc_player(newcomer)
        return set_plan(newcomer, days=list(days), weekend=weekend)

    def test_the_weekend_keeps_its_own_times(self, newcomer, clock):
        body = self.plan(newcomer).json()
        assert body["plan"]["windows"][0]["end"] == "09:00"
        assert body["plan"]["weekend"]["windows"][0]["start"] == "21:00"
        assert body["plan"]["weekend"]["daily_minutes"] == 90

    def test_saturday_follows_the_weekend_times(self, newcomer, clock):
        self.plan(newcomer)
        clock.set(2026, 11, 7, 8, 0)  # Saturday, at the weekday morning time
        assert kind_of(start(newcomer)) == "free"
        clock.set(2026, 11, 7, 21, 0)
        FocusBlock.objects.all().delete()
        body = newcomer.get(PLAN).json()
        assert body["today"]["in_window"] is True and body["today"]["minutes_planned"] == 90
        _, claimed = run_block(newcomer, clock, 45)
        assert claimed["result"] == "plan" and claimed["seconds_earned"] == 900

    def test_weekdays_dont_use_the_weekend_times(self, newcomer, clock):
        self.plan(newcomer)
        clock.set(2026, 11, 9, 21, 0)  # Monday evening
        assert kind_of(start(newcomer)) == "free"

    def test_without_one_the_weekend_follows_the_week(self, newcomer, clock):
        self.plan(newcomer, weekend=None)
        clock.set(2026, 11, 7, 8, 0)
        assert kind_of(start(newcomer)) == "plan"

    def test_a_weekend_off_drops_its_schedule(self, newcomer, clock):
        body = self.plan(newcomer, days=WEEKDAYS).json()
        assert body["plan"]["weekend"] is None

    def test_goals_count_both(self, newcomer, clock):
        clock.set(2026, 11, 2, 8, 0)  # Monday
        goals = self.plan(newcomer).json()["targets"]
        assert goals["week"]["target_minutes"] == 345  # 80% of 5 x 50 and 2 x 90, rounded up to the next 5

    def test_next_study_time_on_friday_evening_is_saturday_night(self, newcomer, clock):
        clock.set(2026, 11, 6, 12, 0)  # Friday, after the morning
        self.plan(newcomer)
        assert newcomer.get(PLAN).json()["today"]["next_window"] == {"date": "2026-11-07", "start": "21:00"}

    def test_moving_your_zone_keeps_the_weekend(self, newcomer, clock):
        self.plan(newcomer)
        newcomer.patch("/api/v1/auth/me/", {"time_zone": "Asia/Tokyo"}, format="json")
        assert newcomer.get(PLAN).json()["pending"]["weekend"]["windows"][0]["start"] == "21:00"


class TestTheWeeklyCeiling:
    def test_no_mix_of_blocks_pays_for_more_than_the_plan(self, newcomer, clock):
        """Whatever someone tries, in or out of their windows, paid minutes never pass what was planned."""
        utc_player(newcomer)
        clock.set(2026, 11, 2, 8, 0)
        set_plan(newcomer)
        chooser = random.Random(7)
        for _ in range(60):
            clock.advance(hours=chooser.randint(1, 30), minutes=chooser.randint(0, 59))
            run_block(newcomer, clock, chooser.randint(rules.BLOCK_MIN_MINUTES, rules.BLOCK_MAX_MINUTES))
            now = clock.now().date()
            monday = now - timedelta(days=now.weekday())
            paid = FocusBlock.objects.filter(player=newcomer.user.player, kind="plan", outcome__in=["done", "not_done"], started_at__date__gte=monday, started_at__date__lte=now)
            planned = sum(50 for offset in range((now - monday).days + 1) if offset < 5)
            assert sum(b.minutes for b in paid) <= planned


class TestPresenceCheck:
    def test_every_block_gets_one_in_the_right_part(self, api, clock):
        for minutes in (rules.BLOCK_MIN_MINUTES, 25, 45, rules.BLOCK_MAX_MINUTES):
            block = start(api, minutes).json()["block"]
            row = FocusBlock.objects.get(pk=block["id"])
            assert row.started_at + timedelta(seconds=minutes * 60 * 0.25) <= row.check_at
            assert row.check_at + timedelta(seconds=rules.presence_window(minutes)) <= row.ends_at
            api.post(f"{BLOCKS}{block['id']}/abandon/")

    def test_the_moment_changes_from_block_to_block(self, api, clock):
        moments = set()
        for _ in range(8):
            block = start(api).json()["block"]
            moments.add(FocusBlock.objects.get(pk=block["id"]).check_at)
            api.post(f"{BLOCKS}{block['id']}/abandon/")
        assert len(moments) > 1

    def test_the_moment_is_never_told_in_advance(self, api, clock):
        block = start(api).json()["block"]
        for body in [api.get(f"{BLOCKS}{block['id']}/").json(), api.get("/api/v1/player/").json(), api.get(BLOCKS).json()]:
            assert "check_at" not in json.dumps(body)
        assert block["presence"] == "waiting" and block["check_expires_at"] is None

    def test_it_comes_up_when_due(self, api, clock):
        block = start(api).json()["block"]
        clock.value = FocusBlock.objects.get(pk=block["id"]).check_at
        body = api.get(f"{BLOCKS}{block['id']}/").json()["block"]
        assert body["presence"] == "due" and body["check_expires_at"] is not None

    def test_cant_be_answered_early(self, api, clock):
        block = start(api).json()["block"]
        response = api.post(f"{BLOCKS}{block['id']}/presence/")
        assert response.status_code == 409 and error(response) == "check_not_due"
        assert FocusBlock.objects.get(pk=block["id"]).checked_at is None

    def test_answering_makes_the_block_count(self, api, clock):
        block = start(api).json()["block"]
        clock.value = FocusBlock.objects.get(pk=block["id"]).check_at
        assert api.post(f"{BLOCKS}{block['id']}/presence/").json()["block"]["presence"] == "ok"
        assert api.post(f"{BLOCKS}{block['id']}/presence/").status_code == 200  # a double tap is harmless
        clock.value = FocusBlock.objects.get(pk=block["id"]).ends_at
        assert claim(api, block["id"], checked=False).json()["seconds_earned"] == 500

    def test_too_late_is_too_late(self, api, clock):
        block = start(api).json()["block"]
        clock.value = FocusBlock.objects.get(pk=block["id"]).check_at + timedelta(seconds=rules.presence_window(25) + 1)
        assert api.get(f"{BLOCKS}{block['id']}/").json()["block"]["presence"] == "missed"
        assert error(api.post(f"{BLOCKS}{block['id']}/presence/")) == "check_missed"

    def test_the_last_second_still_counts(self, api, clock):
        block = start(api).json()["block"]
        clock.value = FocusBlock.objects.get(pk=block["id"]).check_at + timedelta(seconds=rules.presence_window(25))
        assert api.post(f"{BLOCKS}{block['id']}/presence/").status_code == 200

    def test_there_are_ten_minutes_to_answer(self, api, clock):
        """Deep in a problem, a few minutes can pass before you look up (ADR 0018)."""
        assert rules.presence_window(25) == rules.presence_window(90) == 600
        block = start(api).json()["block"]
        clock.value = FocusBlock.objects.get(pk=block["id"]).check_at + timedelta(minutes=9, seconds=30)
        assert api.post(f"{BLOCKS}{block['id']}/presence/").json()["block"]["presence"] == "ok"

    def test_a_short_block_gets_half_its_length(self, api, clock):
        assert rules.presence_window(10) == 300 and rules.presence_window(15) == 450
        for _ in range(20):  # the moment is random, so try it many times
            block = start(api, 10).json()["block"]
            row = FocusBlock.objects.get(pk=block["id"])
            assert row.check_at + timedelta(seconds=300) <= row.ends_at
            api.post(f"{BLOCKS}{block['id']}/abandon/")

    def test_missing_it_voids_the_block(self, api, clock):
        block = start(api).json()["block"]
        clock.advance(minutes=25)
        body = claim(api, block["id"], checked=False).json()
        assert body["result"] == "missed" and body["seconds_earned"] == 0 and body["xp"] == 0
        p = api.user.player
        p.refresh_from_db()
        assert p.bank() == 300 and p.streak == 0
        player = api.get("/api/v1/player/").json()
        assert player["focus_minutes"] == 0 and player["blocks_finished"] == 0 and player["block"] is None
        assert FocusBlock.objects.get(pk=block["id"]).outcome == "missed"

    def test_a_voided_block_needs_no_note_and_frees_the_day(self, planner, clock):
        block = start(planner).json()["block"]
        clock.advance(minutes=25)
        assert planner.post(f"{BLOCKS}{block['id']}/claim/", {"done": False}, format="json").json()["result"] == "missed"
        run_block(planner, clock)
        assert kind_of(start(planner)) == "plan"

    def test_someone_elses_check_looks_missing(self, api, other_api, clock):
        block = start(api).json()["block"]
        clock.value = FocusBlock.objects.get(pk=block["id"]).check_at
        assert other_api.post(f"{BLOCKS}{block['id']}/presence/").status_code == 404
        assert other_api.get(f"{BLOCKS}{block['id']}/").status_code == 404
        assert FocusBlock.objects.get(pk=block["id"]).checked_at is None


class TestClaimRules:
    @pytest.mark.parametrize("note", ["", "    ", "abcd"])
    def test_needs_a_line_on_what_you_did(self, api, clock, note):
        block = start(api).json()["block"]
        clock.advance(minutes=25)
        response = claim(api, block["id"], note=note)
        assert response.status_code == 400 and error(response) == "note_required"
        row = FocusBlock.objects.get(pk=block["id"])
        assert row.outcome == "" and row.claimed_at is None
        assert api.user.player.bank() == 300

    def test_keeps_what_you_said(self, api, clock):
        block = start(api).json()["block"]
        clock.advance(minutes=25)
        claim(api, block["id"], note="  Fixed the login redirect  ")
        assert FocusBlock.objects.get(pk=block["id"]).note == "Fixed the login redirect"

    def test_a_note_cant_be_an_essay(self, api, clock):
        block = start(api).json()["block"]
        clock.advance(minutes=25)
        assert error(claim(api, block["id"], note="x" * 141)) == "note_too_long"

    def test_can_be_claimed_right_up_to_the_deadline(self, api, clock):
        block = start(api).json()["block"]
        clock.advance(minutes=25, seconds=rules.CLAIM_WINDOW_SECONDS)
        assert claim(api, block["id"]).json()["result"] == "plan"

    def test_after_the_deadline_it_earns_nothing(self, api, clock):
        block = start(api).json()["block"]
        clock.advance(minutes=25, seconds=rules.CLAIM_WINDOW_SECONDS + 1)
        body = claim(api, block["id"]).json()
        assert body["result"] == "expired" and body["seconds_earned"] == 0
        assert FocusBlock.objects.get(pk=block["id"]).outcome == "expired"
        assert api.user.player.bank() == 300

    def test_a_block_left_too_long_stops_being_current(self, api, clock):
        start(api, 15)
        clock.advance(minutes=15, seconds=rules.CLAIM_WINDOW_SECONDS + 1)
        assert api.get("/api/v1/player/").json()["block"] is None
        assert api.post("/api/v1/sessions/open/").status_code == 201

    def test_and_doesnt_stop_a_new_one(self, api, clock):
        first = start(api, 15).json()["block"]
        clock.advance(minutes=15, seconds=rules.CLAIM_WINDOW_SECONDS + 1)
        assert start(api).status_code == 201
        assert FocusBlock.objects.get(pk=first["id"]).outcome == "expired"


class TestGoals:
    def goals(self, api):
        return api.get(PLAN).json()["targets"]

    def test_are_worked_out_from_the_plan(self, newcomer, clock):
        utc_player(newcomer)
        clock.set(2026, 11, 2, 8, 0)  # a Monday and the start of the month's first whole week
        set_plan(newcomer)
        goals = self.goals(newcomer)
        assert goals["week"]["starts_on"] == "2026-11-02" and goals["week"]["ends_on"] == "2026-11-08"
        assert goals["week"]["target_minutes"] == 200  # 80% of 5 x 50
        assert goals["month"]["starts_on"] == "2026-11-01" and goals["month"]["ends_on"] == "2026-11-30"
        assert goals["month"]["target_minutes"] == 790  # 75% of 21 x 50, rounded up to the next 5

    def test_a_plan_started_part_way_only_counts_what_is_left(self, planner, clock):
        # Friday the 6th: only one study day left this week.
        assert self.goals(planner)["week"]["target_minutes"] == 40

    def test_a_plan_with_no_days_left_has_no_goal(self, newcomer, clock):
        utc_player(newcomer)
        clock.set(2026, 11, 7, 8, 0)  # Saturday, and this plan only studies on weekdays
        assert self.goals(newcomer) is None
        goals = set_plan(newcomer).json()["targets"]
        assert goals["week"]["target_minutes"] == 0

    def test_meeting_one_pays_once(self, planner, clock):
        block = start(planner, 45).json()["block"]  # 45 of the 40 this week needs
        clock.advance(minutes=45)
        body = claim(planner, block["id"]).json()
        assert {"type": "target_reached", "period": "week", "minutes": 40, "seconds": 240, "xp": 40} in body["events"]
        rows = TargetReward.objects.filter(player=planner.user.player, period="week")
        assert rows.count() == 1
        assert self.goals(planner)["week"]["reached"] is True
        p = planner.user.player
        assert TimeLedger.objects.filter(player=p, reason="target").count() == 1
        assert XPLedger.objects.filter(player=p, reason="target").count() == 1
        clock.set(2026, 11, 6, 15, 0)
        _, later = run_block(planner, clock, 15)
        assert not [e for e in later["events"] if e["type"] == "target_reached"]

    def test_only_blocks_that_earned_count(self, planner, clock):
        run_block(planner, clock)
        run_block(planner, clock, 15)
        run_block(planner, clock, 25)  # the third is over the daily amount
        assert self.goals(planner)["week"]["minutes"] == 40

    def test_reward_grows_with_the_goal_up_to_a_cap(self):
        assert rules.target_reward("week", 40) == (240, 40)
        assert rules.target_reward("week", 1000) == (20 * 60, 1000)
        assert rules.target_reward("month", 100) == (300, 100)
        assert rules.target_reward("month", 5000) == (45 * 60, 5000)

    def test_rewards_stay_under_the_bonus_cap(self, planner, clock):
        services.add_time(planner.user.player, rules.BONUS_CAP - 300 - 60, TimeLedger.Reason.STREAK)
        block = start(planner, 45).json()["block"]
        clock.advance(minutes=45)
        claim(planner, block["id"])
        assert planner.user.player.bank() == rules.BONUS_CAP

    def test_a_new_week_is_a_new_goal(self, newcomer, clock):
        utc_player(newcomer)
        clock.set(2026, 11, 6, 8, 0)
        set_plan(newcomer)
        run_block(newcomer, clock, 45)
        clock.set(2026, 11, 9, 8, 0)
        goals = self.goals(newcomer)
        assert goals["week"]["reached"] is False and goals["week"]["minutes"] == 0
        assert goals["month"]["minutes"] == 45


class TestStreaksFollowThePlan:
    def test_a_day_off_doesnt_break_it(self, planner, clock):
        run_block(planner, clock)  # Friday
        clock.set(2026, 11, 9, 8, 0)  # Monday, after a weekend off
        _, body = run_block(planner, clock)
        assert body["streak"] == 2
        p = planner.user.player
        p.refresh_from_db()
        assert p.shields == 0

    def test_a_missed_study_day_still_does(self, planner, clock):
        run_block(planner, clock)
        clock.set(2026, 11, 10, 8, 0)  # Tuesday: Monday was a study day
        _, body = run_block(planner, clock)
        assert body["streak"] == 1

    def test_a_shield_only_covers_the_study_days(self, planner, clock):
        Player.objects.filter(pk=planner.user.player.pk).update(shields=1)
        run_block(planner, clock)
        clock.set(2026, 11, 10, 8, 0)
        # Coming back is when it's settled, and said once.
        assert {"type": "shield_used", "days": 1} in planner.get("/api/v1/player/").json()["events"]
        assert planner.get("/api/v1/player/").json()["events"] == []
        _, body = run_block(planner, clock)
        assert body["streak"] == 2

    def test_starting_a_block_says_so_if_nothing_else_did(self, planner, clock):
        Player.objects.filter(pk=planner.user.player.pk).update(shields=1)
        run_block(planner, clock)
        clock.set(2026, 11, 10, 8, 0)
        assert {"type": "shield_used", "days": 1} in start(planner).json()["events"]

    def test_without_a_shield_the_streak_is_zero_as_soon_as_you_come_back(self, planner, clock):
        run_block(planner, clock)  # Friday
        clock.set(2026, 11, 9, 8, 0)
        run_block(planner, clock)  # Monday: 2
        clock.set(2026, 11, 11, 7, 0)  # Wednesday, before studying: Tuesday was missed
        body = planner.get("/api/v1/player/").json()
        assert body["streak"] == 0 and body["multiplier"] == 1
        assert {"type": "streak_lost", "days": 1} in body["events"]
        clock.set(2026, 11, 11, 8, 0)
        _, claimed = run_block(planner, clock)
        assert claimed["streak"] == 1

    def test_a_day_off_isnt_a_missed_day_on_arrival_either(self, planner, clock):
        run_block(planner, clock)  # Friday
        clock.set(2026, 11, 9, 7, 0)  # Monday morning, after a weekend off
        body = planner.get("/api/v1/player/").json()
        assert body["streak"] == 1 and body["events"] == []

    def test_today_not_yet_studied_isnt_missed(self, planner, clock):
        run_block(planner, clock)  # Friday
        clock.set(2026, 11, 9, 23, 0)  # Monday night, nothing done yet today
        assert planner.get("/api/v1/player/").json()["streak"] == 1


class TestHistory:
    URL = "/api/v1/focus/history/"

    def test_is_empty_to_begin_with(self, api, clock):
        body = api.get(self.URL).json()
        assert body["days"] == [] and body["recent"] == []
        assert len(body["weeks"]) == 12 and all(w["xp"] == 0 for w in body["weeks"])
        assert body["today"] == "2026-11-06"

    def test_needs_login(self, anon):
        assert anon.get(self.URL).status_code == 401

    def test_adds_up_each_day(self, api, clock):
        finish(api, clock, 25)
        finish(api, clock, 15)
        clock.advance(days=1)
        finish(api, clock, 45)
        assert api.get(self.URL).json()["days"] == [
            {"date": "2026-11-06", "minutes": 40, "blocks": 2},
            {"date": "2026-11-07", "minutes": 45, "blocks": 1},
        ]

    def test_days_are_in_your_zone(self, api, clock):
        Player.objects.filter(pk=api.user.player.pk).update(time_zone="Asia/Tokyo")
        clock.set(2026, 11, 6, 14, 30)  # 23:30 in Tokyo
        finish(api, clock, 15)
        clock.set(2026, 11, 6, 15, 30)  # 00:30 the next day in Tokyo
        finish(api, clock, 15)
        assert [d["date"] for d in api.get(self.URL).json()["days"]] == ["2026-11-06", "2026-11-07"]

    def test_only_real_focus_goes_on_the_map(self, api, clock):
        missed = start(api, 15).json()["block"]
        clock.advance(minutes=15)
        claim(api, missed["id"], checked=False)
        left = start(api, 15).json()["block"]
        api.post(f"{BLOCKS}{left['id']}/abandon/")
        assert api.get(self.URL).json()["days"] == []

    def test_extra_blocks_go_on_the_map(self, planner, clock):
        run_block(planner, clock)
        run_block(planner, clock)
        run_block(planner, clock)
        days = planner.get(self.URL).json()["days"]
        assert days == [{"date": "2026-11-06", "minutes": 75, "blocks": 3}]

    def test_a_year_is_as_far_back_as_it_goes(self, api, clock):
        finish(api, clock, 15)
        clock.advance(days=371)
        finish(api, clock, 15)
        assert [d["date"] for d in api.get(self.URL).json()["days"]] == ["2027-11-12"]

    def test_xp_is_per_week_from_monday(self, api, clock):
        finish(api, clock, 25, done=False)  # Friday
        first = api.user.player.xp_entries.all()[0].delta
        clock.set(2026, 11, 9, 8, 0)  # Monday
        finish(api, clock, 15, done=False)
        weeks = api.get(self.URL).json()["weeks"]
        assert weeks[-2]["start"] == "2026-11-02" and weeks[-2]["xp"] == first
        assert weeks[-1]["start"] == "2026-11-09" and weeks[-1]["xp"] > 0

    def test_recent_blocks_say_what_happened(self, api, clock):
        finish(api, clock, 25)
        left = start(api, 15).json()["block"]
        api.post(f"{BLOCKS}{left['id']}/abandon/")
        recent = api.get(self.URL).json()["recent"]
        assert [r["outcome"] for r in recent] == ["abandoned", "done"]
        assert recent[1]["note"] == "Did the work"
        assert set(recent[0]) == {"id", "goal", "note", "minutes", "kind", "outcome", "started_at"}

    def test_never_shows_someone_elses(self, api, other_api, clock):
        finish(api, clock)
        body = other_api.get(self.URL).json()
        assert body["days"] == [] and body["recent"] == [] and all(w["xp"] == 0 for w in body["weeks"])
