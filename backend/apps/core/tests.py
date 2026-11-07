import os
import subprocess
import sys
from pathlib import Path

from django.conf import settings


def test_health_is_public(anon):
    response = anon.get("/api/v1/health/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_every_other_endpoint_needs_login(anon):
    from django.urls import get_resolver

    public = {"health/", "auth/username/", "auth/register/", "auth/verify/", "auth/verify/resend/", "auth/password/forgot/", "auth/password/reset/", "auth/login/", "auth/refresh/", "auth/logout/", "avatars/<uuid:token>.webp"}
    checked = 0
    def walk(patterns, prefix=""):
        for p in patterns:
            route = prefix + str(p.pattern)
            if hasattr(p, "url_patterns"):
                yield from walk(p.url_patterns, route)
            else:
                yield route
    for route in walk(get_resolver().url_patterns):
        if not route.startswith("api/v1/"):
            continue
        short = route[len("api/v1/"):]
        if short in public:
            continue
        url = "/" + route.replace("<str:code>", "sh-01").replace("<int:block_id>", "1").replace("<uuid:job_id>", "00000000-0000-0000-0000-000000000000")
        for method in ("get", "post"):
            status = getattr(anon, method)(url, {}, format="json").status_code
            assert status in (401, 405), f"{method} {url} answered {status} without a login"
        checked += 1
    assert checked >= 18


def test_errors_have_one_shape(anon):
    body = anon.get("/api/v1/player/").json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == "not_authenticated"


def test_only_json_goes_in_or_out():
    drf = settings.REST_FRAMEWORK
    assert drf["DEFAULT_RENDERER_CLASSES"] == ["rest_framework.renderers.JSONRenderer"]
    assert drf["DEFAULT_PARSER_CLASSES"] == ["apps.core.parsers.LimitedJSONParser"]


def test_a_huge_request_is_refused(api):
    response = api.post("/api/v1/focus/blocks/", {"goal": "x" * 1_100_000, "minutes": 25}, format="json")
    # Django refuses it with a 400 when it has already read the body, and our parser with a 413 otherwise.
    assert response.status_code in (400, 413)


def test_a_request_that_lies_about_its_size_is_refused(api):
    from apps.core.parsers import LimitedJSONParser, TooLarge
    import io

    class Fake:
        META = {"CONTENT_LENGTH": "10"}

    body = io.BytesIO(b'{"goal": "' + b"x" * 1_100_000 + b'"}')
    import pytest

    with pytest.raises(TooLarge):
        LimitedJSONParser().parse(body, parser_context={"request": Fake()})


def test_form_posts_are_refused(api):
    assert api.post("/api/v1/focus/blocks/", {"goal": "x", "minutes": 25}, format="multipart").status_code == 415


def test_production_settings_pass_djangos_deploy_check():
    backend = Path(settings.BASE_DIR)
    env = {
        **os.environ,
        "DJANGO_SETTINGS_MODULE": "config.settings.prod",
        "DJANGO_SECRET_KEY": "x" * 30 + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
        "DJANGO_ALLOWED_HOSTS": "arcade.example.test",
        "POSTGRES_DB": "x", "POSTGRES_USER": "x", "POSTGRES_PASSWORD": "x",
        "REDIS_URL": "redis://127.0.0.1:6379/0", "EMAIL_HOST": "smtp.example.test", "EMAIL_HOST_USER": "x", "EMAIL_HOST_PASSWORD": "x", "DEFAULT_FROM_EMAIL": "Uptime Arcade <a@example.test>",
    }
    result = subprocess.run([sys.executable, "manage.py", "check", "--deploy", "--fail-level", "WARNING"], cwd=backend, env=env, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr


def test_production_stops_without_a_secret_key():
    backend = Path(settings.BASE_DIR)
    env = {k: v for k, v in os.environ.items() if k != "DJANGO_SECRET_KEY"}
    env.update({"DJANGO_SETTINGS_MODULE": "config.settings.prod", "DJANGO_ALLOWED_HOSTS": "x", "POSTGRES_DB": "x", "POSTGRES_USER": "x", "POSTGRES_PASSWORD": "x"})
    result = subprocess.run([sys.executable, "-c", "import django; django.setup()"], cwd=backend, env=env, capture_output=True, text=True, check=False)
    assert result.returncode != 0
