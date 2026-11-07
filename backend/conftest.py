from datetime import date, datetime, timedelta, timezone

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.content.loader import load
from apps.content.management.commands.import_content import run_import
from apps.focus.models import StudyPlan


@pytest.fixture(scope="session")
def django_db_setup(django_db_setup, django_db_blocker):
    with django_db_blocker.unblock():
        run_import(load())


@pytest.fixture(autouse=True)
def _db_and_clean_limits(db):
    cache.clear()  # rate limit counters live here


class Clock:
    def __init__(self):
        self.value = datetime(2026, 11, 6, 8, 0, tzinfo=timezone.utc)

    def now(self):
        return self.value

    def advance(self, **kwargs):
        self.value += timedelta(**kwargs)

    def set(self, *args, tz=timezone.utc):
        self.value = datetime(*args, tzinfo=tz)


@pytest.fixture
def clock(monkeypatch):
    fake = Clock()
    monkeypatch.setattr("apps.core.clock.now", fake.now)
    return fake


def make_user(username="amina"):
    return get_user_model().objects.create_user(username=username, email=f"{username}@example.test", password="correct horse battery")


@pytest.fixture
def user():
    return make_user()


class PlayerClient(APIClient):
    """Loads the user fresh for each request, as a real request does, so nothing is cached between them."""

    def __init__(self, user):
        super().__init__()
        self.user = user

    def request(self, **kwargs):
        self.force_authenticate(get_user_model().objects.get(pk=self.user.pk))
        return super().request(**kwargs)


def any_time_plan(user):
    """Goes straight to the table, because a real plan can't be this wide. It lets tests that aren't about the
    plan run at any hour, and its goals are too big to pay out by accident."""
    return StudyPlan.objects.create(
        player=user.player,
        days=list(range(7)),
        blocks_per_day=40,
        block_minutes=45,
        windows=[[0, 1440]],
        time_zone=user.player.time_zone,
        effective_from=date(2000, 1, 1),
        by_player=False,
        created_at=datetime(2000, 1, 1, tzinfo=timezone.utc),
    )


@pytest.fixture
def api(user):
    any_time_plan(user)
    return PlayerClient(user)


@pytest.fixture
def other_api():
    other = make_user("joel")
    any_time_plan(other)
    return PlayerClient(other)


@pytest.fixture
def newcomer():
    """A player who hasn't set a plan yet."""
    return PlayerClient(make_user("nora"))


@pytest.fixture
def anon():
    return APIClient()
