"""Attacks from outside, through the real API. Each of these is something someone will try on launch day."""
import base64
import json
from datetime import timedelta

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts import email_codes
from apps.accounts.models import EmailCode
from apps.game.models import Player

User = get_user_model()
GOOD = "correct horse battery"
INJECTIONS = ["' OR 1=1 --", "'; DROP TABLE auth_user; --", '" OR ""="', "admin'--", "\\x00", "../../../etc/passwd", "<script>alert(1)</script>", "${7*7}", "{{7*7}}", "%00", "a" * 5000]


def confirmed(username="victim_01", email="victim@example.test"):
    user = User.objects.create_user(username=username, email=email, password=GOOD)
    user.player.email_verified_at = timezone.now()
    user.player.save(update_fields=["email_verified_at"])
    return user



class TestInjection:
    @pytest.mark.parametrize("payload", INJECTIONS)
    @pytest.mark.parametrize("path,field", [("login/", "username"), ("login/", "password"), ("password/forgot/", "identifier"), ("verify/resend/", "username"), ("verify/", "username"), ("verify/", "code")])
    def test_public_endpoints_never_crash_or_let_anyone_in(self, path, field, payload):
        confirmed()
        client = APIClient()
        body = {"username": "victim_01", "password": GOOD + "x", "identifier": "nobody", "code": "000000", field: payload}
        response = client.post(f"/api/v1/auth/{path}", body, format="json")
        assert response.status_code < 500
        assert "access" not in (response.data or {})
        assert User.objects.filter(username="victim_01").exists()

    @pytest.mark.parametrize("name", ["<script>alert(1)</script>", "a b", "../x", "x\ny", "x;y", "' OR 1=1"])
    def test_a_username_cannot_carry_anything(self, name):
        response = APIClient().post("/api/v1/auth/register/", {"username": name, "email": "a@example.test", "password": GOOD, "confirm_password": GOOD}, format="json")
        assert response.status_code == 400
        assert not User.objects.filter(email="a@example.test").exists()

    @pytest.mark.parametrize("email", ["a@b\nBcc: all@example.test", "a@b.test\r\nSubject: hacked", "not-an-email", "a@b.test,c@d.test"])
    def test_an_email_cannot_inject_headers(self, email):
        response = APIClient().post("/api/v1/auth/register/", {"username": "fresh_user", "email": email, "password": GOOD, "confirm_password": GOOD}, format="json")
        assert response.status_code == 400
        assert mail.outbox == []

    def test_a_display_name_comes_back_as_plain_json(self, api):
        response = api.patch("/api/v1/auth/me/", {"display_name": "<img src=x onerror=alert(1)>"}, format="json")
        assert response.status_code == 200
        assert response["Content-Type"].startswith("application/json")


class TestForgedTokens:
    def forged(self, payload_changes=None, header=None):
        user = confirmed()
        token = str(AccessToken.for_user(user))
        head, body, sig = token.split(".")
        pad = lambda s: s + "=" * (-len(s) % 4)  # noqa: E731
        enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()  # noqa: E731
        claims = json.loads(base64.urlsafe_b64decode(pad(body)))
        claims.update(payload_changes or {})
        return f"{enc(header or json.loads(base64.urlsafe_b64decode(pad(head))))}.{enc(claims)}.{sig}"

    def status(self, token):
        return APIClient().get("/api/v1/auth/me/", HTTP_AUTHORIZATION=f"Bearer {token}").status_code

    def test_a_real_token_works(self):
        assert self.status(str(AccessToken.for_user(confirmed()))) == 200

    def test_changing_who_it_is_for_is_refused(self):
        other = User.objects.create_user(username="target", password=GOOD)
        assert self.status(self.forged({"user_id": other.pk})) == 401

    def test_no_signature_algorithm_is_refused(self):
        token = self.forged(header={"alg": "none", "typ": "JWT"})
        assert self.status(token) == 401
        assert self.status(token.rsplit(".", 1)[0] + ".") == 401

    def test_a_token_from_another_key_is_refused(self):
        import jwt

        user = confirmed()
        token = jwt.encode({"token_type": "access", "user_id": user.pk, "exp": 9999999999, "jti": "x"}, "x" * 64, algorithm="HS256")
        assert self.status(token) == 401

    def test_a_refresh_token_is_not_an_access_token(self):
        from rest_framework_simplejwt.tokens import RefreshToken

        assert self.status(str(RefreshToken.for_user(confirmed()))) == 401

    def test_an_expired_token_is_refused(self):
        token = AccessToken.for_user(confirmed())
        token.set_exp(lifetime=-timedelta(seconds=1))
        assert self.status(str(token)) == 401

    def test_a_deleted_user_is_refused(self):
        user = confirmed()
        token = str(AccessToken.for_user(user))
        user.delete()
        assert self.status(token) == 401


class TestMailAbuse:
    def register(self, n, email="victim@example.test"):
        return APIClient().post("/api/v1/auth/register/", {"username": f"spam_{n}", "email": email, "password": GOOD, "confirm_password": GOOD}, format="json")

    def test_many_usernames_cannot_flood_one_inbox(self):
        for n in range(30):
            cache.clear()
            assert self.register(n).status_code == 201  # the answer never changes, so it reveals nothing
        assert len(mail.outbox) == email_codes.MAX_PER_ADDRESS_HOUR

    def test_one_address_cannot_create_endless_accounts(self):
        client = APIClient()
        statuses = []
        for n in range(14):
            statuses.append(client.post("/api/v1/auth/register/", {"username": f"bulk_{n}", "email": f"b{n}@example.test", "password": GOOD, "confirm_password": GOOD}, format="json").status_code)
        assert statuses[:5] == [201] * 5 and 429 in statuses

    def test_forgot_cannot_flood_one_inbox(self):
        confirmed()
        for _ in range(40):
            cache.clear()
            EmailCode.objects.update(created_at=timezone.now() - timedelta(minutes=2))
            assert APIClient().post("/api/v1/auth/password/forgot/", {"identifier": "victim_01"}, format="json").status_code == 200
        assert len(mail.outbox) <= email_codes.MAX_PER_HOUR

    def test_a_reset_tells_the_owner(self):
        confirmed()
        APIClient().post("/api/v1/auth/password/forgot/", {"identifier": "victim_01"}, format="json")
        import re

        code = re.search(r"\b([0-9]{6})\b", mail.outbox[-1].body).group(1)
        APIClient().post("/api/v1/auth/password/reset/", {"username": "victim_01", "code": code, "password": "a brand new long password", "confirm_password": "a brand new long password"}, format="json")
        assert mail.outbox[-1].subject == "Your Uptime Arcade password was changed"
        assert code not in mail.outbox[-1].body

    def test_codes_cannot_be_guessed_within_the_limits(self):
        """Five guesses a code, ten codes a day: at most fifty tries in a million, each day, and the owner gets an email each time."""
        assert email_codes.MAX_ATTEMPTS * email_codes.MAX_PER_DAY <= 50

    def test_a_code_in_the_subject_would_show_on_a_lock_screen(self):
        APIClient().post("/api/v1/auth/register/", {"username": "fresh_one", "email": "f@example.test", "password": GOOD, "confirm_password": GOOD}, format="json")
        import re

        assert not re.search(r"[0-9]{6}", mail.outbox[-1].subject)


class TestEnumeration:
    def test_login_says_the_same_for_a_wrong_password_and_no_such_user(self):
        confirmed()
        a = APIClient().post("/api/v1/auth/login/", {"username": "victim_01", "password": "wrong wrong wrong"}, format="json")
        b = APIClient().post("/api/v1/auth/login/", {"username": "no_such_user", "password": "wrong wrong wrong"}, format="json")
        assert (a.status_code, a.data) == (b.status_code, b.data)

    def test_reset_says_the_same_for_a_real_and_a_made_up_account(self):
        confirmed()
        body = {"code": "123456", "password": "a brand new long password", "confirm_password": "a brand new long password"}
        a = APIClient().post("/api/v1/auth/password/reset/", {**body, "username": "victim_01"}, format="json")
        b = APIClient().post("/api/v1/auth/password/reset/", {**body, "username": "no_such_user"}, format="json")
        assert (a.status_code, a.data) == (b.status_code, b.data)

    def test_an_unknown_forgot_runs_no_write(self):
        with CaptureQueriesContext(connection) as queries:
            APIClient().post("/api/v1/auth/password/forgot/", {"identifier": "nobody@example.test"}, format="json")
        assert not [q for q in queries if q["sql"].startswith(("INSERT", "UPDATE", "DELETE"))]

    def test_another_players_email_never_appears(self, api, other_api):
        for path in ("/api/v1/auth/me/", "/api/v1/player/", "/api/v1/tracks/", "/api/v1/rewards/"):
            assert other_api.user.email not in api.get(path).content.decode()


class TestAccessControl:
    def test_is_staff_cannot_be_set(self, api):
        api.patch("/api/v1/auth/me/", {"is_staff": True, "is_superuser": True, "xp": 999999, "email_verified_at": None, "email": "x@example.test", "password": "hacked"}, format="json")
        user = User.objects.get(pk=api.user.pk)
        assert not user.is_staff and not user.is_superuser and user.email != "x@example.test" and not user.check_password("hacked")
        assert Player.objects.get(user=user).xp < 1000

    def test_registering_cannot_set_anything_extra(self):
        APIClient().post("/api/v1/auth/register/", {"username": "fresh_two", "email": "t@example.test", "password": GOOD, "confirm_password": GOOD, "is_superuser": True, "is_staff": True, "email_verified_at": "2020-01-01T00:00:00Z"}, format="json")
        user = User.objects.get(username="fresh_two")
        assert not user.is_superuser and not user.is_staff and user.player.email_verified_at is None

    def test_a_stolen_token_cannot_guess_the_password_to_delete(self, api):
        statuses = [api.delete("/api/v1/auth/me/", {"password": f"wrong guess {i}"}, format="json").status_code for i in range(8)]
        assert statuses[:5] == [403] * 5 and statuses[5:] == [429] * 3
        assert User.objects.filter(pk=api.user.pk).exists()

    def test_the_admin_path_can_be_private(self):
        from config.urls import ADMIN_PATH

        assert isinstance(ADMIN_PATH, str)


class TestResourceAbuse:
    def test_a_huge_body_is_refused_before_parsing(self):
        response = APIClient().post("/api/v1/auth/login/", {"username": "x", "password": "y" * 2_000_000}, format="json")
        assert response.status_code in (400, 413)

    def test_deep_json_does_not_crash(self):
        deep = "[" * 100_000 + "]" * 100_000
        response = APIClient().post("/api/v1/auth/login/", deep, content_type="application/json")
        assert response.status_code in (400, 413)

    def test_a_second_request_cannot_wait_on_the_first(self, api):
        from apps.missions.services import one_at_a_time

        with one_at_a_time(api.user):
            response = api.post("/api/v1/missions/sh-01/check/", {}, format="json")
        assert response.status_code == 429

    def test_the_lock_comes_back_after_an_error(self, api):
        from apps.missions.services import one_at_a_time

        with pytest.raises(ValueError), one_at_a_time(api.user):
            raise ValueError
        with one_at_a_time(api.user):
            pass

    def test_the_grader_gets_no_secrets(self, monkeypatch, settings):
        import subprocess

        from apps.netlab import grader

        seen = {}
        real = subprocess.run

        def spy(*a, **k):
            seen["env"] = k.get("env", "inherited")
            return real(*a, **k)

        monkeypatch.setenv("DJANGO_SECRET_KEY", "super-secret")
        monkeypatch.setattr(subprocess, "run", spy)
        grader._run(settings.MACHINE_REPLAY, {"base": [], "fixtures": {}, "log": []})
        assert seen["env"] == {}


class TestResponses:
    def test_errors_show_no_internals(self, api, monkeypatch):
        def boom(*a, **k):
            raise RuntimeError("secret database detail")

        monkeypatch.setattr("apps.missions.services.tracks_for", boom)
        client = api
        client.raise_request_exception = False
        response = client.get("/api/v1/tracks/")
        assert response.status_code == 500
        assert b"secret database detail" not in response.content and b"Traceback" not in response.content

    def test_debug_is_off_outside_development(self):
        text = (settings.BASE_DIR / "config" / "settings" / "base.py").read_text()
        assert "DEBUG = True" not in text

    def test_unknown_routes_say_nothing_useful(self):
        response = APIClient().get("/.env")
        assert response.status_code == 404
        assert b"urlpatterns" not in response.content
