import uuid
from io import BytesIO

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.avatars import MAX_BYTES
from apps.game import rules
from apps.game.models import AvatarImage, Player, TimeLedger

GOOD = {"username": "Sara_01", "email": "Sara@Example.test", "password": "correct horse battery"}
COOKIE = settings.REFRESH_COOKIE["key"]


@pytest.fixture
def registered(anon):
    response = anon.post("/api/v1/auth/register/", GOOD, format="json")
    assert response.status_code == 201
    return response


class TestRegister:
    def test_gives_a_new_player_the_starter_bank(self, registered):
        player = Player.objects.get(user__username="sara_01")
        assert player.bank() == 300
        assert TimeLedger.objects.filter(player=player, reason="starter").count() == 1

    def test_keeps_the_refresh_token_out_of_reach_of_scripts(self, registered):
        assert "refresh" not in registered.json()
        cookie = registered.cookies[COOKIE]
        assert cookie["httponly"]
        assert cookie["samesite"] == "Strict"
        assert cookie["path"] == "/api/v1/auth/"

    def test_never_returns_the_password(self, registered):
        assert GOOD["password"] not in registered.content.decode()

    @pytest.mark.parametrize("password", ["short1", "password123", "12345678901"])
    def test_rejects_weak_passwords(self, anon, password):
        response = anon.post("/api/v1/auth/register/", {**GOOD, "password": password}, format="json")
        assert response.status_code == 400
        assert not get_user_model().objects.filter(username="sara_01").exists()

    def test_rejects_a_password_like_the_username(self, anon):
        response = anon.post("/api/v1/auth/register/", {"username": "longusername", "email": "a@example.test", "password": "longusername1"}, format="json")
        assert response.status_code == 400

    def test_username_ignores_capitals(self, anon, registered):
        again = anon.post("/api/v1/auth/register/", {**GOOD, "username": "SARA_01", "email": "other@example.test"}, format="json")
        assert again.status_code == 400
        assert again.json()["error"]["code"] == "username_taken"

    def test_a_used_email_is_never_revealed(self, anon, registered):
        again = APIClient().post("/api/v1/auth/register/", {**GOOD, "username": "someone_else"}, format="json")
        fresh = APIClient().post("/api/v1/auth/register/", {**GOOD, "username": "third_person", "email": "never.used@example.test"}, format="json")
        assert again.status_code == fresh.status_code == 201
        assert set(again.json()) == set(fresh.json())

    @pytest.mark.parametrize("name", ["ab", "x" * 21, "has space", "bad!name", "a@b.com", "../etc"])
    def test_rejects_bad_usernames(self, anon, name):
        response = anon.post("/api/v1/auth/register/", {**GOOD, "username": name}, format="json")
        assert response.status_code == 400

    @pytest.mark.parametrize("name", ["admin", "ROOT", "Whiteraven"])
    def test_rejects_reserved_usernames(self, anon, name):
        assert anon.post("/api/v1/auth/register/", {**GOOD, "username": name}, format="json").status_code == 400

    def test_rejects_an_unknown_time_zone(self, anon):
        assert anon.post("/api/v1/auth/register/", {**GOOD, "time_zone": "Mars/Olympus"}, format="json").status_code == 400

    def test_a_client_cant_set_its_own_xp(self, anon):
        anon.post("/api/v1/auth/register/", {**GOOD, "xp": 99999, "is_staff": True, "is_superuser": True}, format="json")
        user = get_user_model().objects.get(username="sara_01")
        assert user.player.xp == 0
        assert not user.is_staff and not user.is_superuser

    def test_stores_a_hash_not_the_password(self, registered):
        user = get_user_model().objects.get(username="sara_01")
        assert GOOD["password"] not in user.password


class TestUsernameCheck:
    def check(self, client, name):
        return client.get("/api/v1/auth/username/", {"name": name}).json()

    def test_says_free_or_taken(self, anon, registered):
        assert self.check(anon, "brand_new") == {"available": True, "reason": None}
        assert self.check(anon, "sara_01") == {"available": False, "reason": "taken"}

    def test_ignores_capitals(self, anon, registered):
        assert self.check(anon, "SARA_01")["available"] is False

    def test_explains_names_that_cant_be_used(self, anon):
        assert self.check(anon, "ab")["reason"] == "invalid"
        assert self.check(anon, "admin")["reason"] == "reserved"

    def test_is_public(self, anon):
        assert anon.get("/api/v1/auth/username/", {"name": "brand_new"}).status_code == 200

    def test_says_nothing_about_email(self, anon, registered):
        assert self.check(anon, "sara@example.test")["reason"] == "invalid"

    def test_is_rate_limited_so_nobody_can_list_players(self, anon):
        codes = [anon.get("/api/v1/auth/username/", {"name": f"name{i}"}).status_code for i in range(61)]
        assert codes[59] == 200 and codes[60] == 429


class TestLogin:
    def test_right_password_gets_tokens(self, anon, registered):
        fresh = APIClient()
        response = fresh.post("/api/v1/auth/login/", {"username": "sara_01", "password": GOOD["password"]}, format="json")
        assert response.status_code == 200
        assert response.json()["access"]
        assert COOKIE in response.cookies

    def test_capitals_dont_matter(self, registered):
        response = APIClient().post("/api/v1/auth/login/", {"username": "SARA_01", "password": GOOD["password"]}, format="json")
        assert response.status_code == 200

    def test_an_email_isnt_a_login(self, registered):
        response = APIClient().post("/api/v1/auth/login/", {"username": "sara@example.test", "password": GOOD["password"]}, format="json")
        assert response.status_code == 401

    def test_access_token_works(self, anon, registered):
        fresh = APIClient()
        fresh.credentials(HTTP_AUTHORIZATION=f"Bearer {registered.json()['access']}")
        assert fresh.get("/api/v1/player/").status_code == 200

    def test_gives_the_same_answer_for_a_wrong_password_and_an_unknown_username(self, anon, registered):
        fresh = APIClient()
        wrong = fresh.post("/api/v1/auth/login/", {"username": "sara_01", "password": "nope nope nope"}, format="json")
        unknown = fresh.post("/api/v1/auth/login/", {"username": "nobody", "password": "nope nope nope"}, format="json")
        assert wrong.status_code == unknown.status_code == 401
        assert wrong.json() == unknown.json()

    def test_a_disabled_account_cant_log_in(self, anon, registered):
        get_user_model().objects.filter(username="sara_01").update(is_active=False)
        response = APIClient().post("/api/v1/auth/login/", {"username": "sara_01", "password": GOOD["password"]}, format="json")
        assert response.status_code == 401


class TestRefresh:
    def test_without_a_cookie_is_refused(self):
        assert APIClient().post("/api/v1/auth/refresh/").status_code == 401

    def test_ignores_a_token_in_the_body(self, registered):
        token = registered.cookies[COOKIE].value
        assert APIClient().post("/api/v1/auth/refresh/", {"refresh": token}, format="json").status_code == 401

    def test_rotates_and_the_old_token_stops_working(self, registered):
        old = registered.cookies[COOKIE].value
        client = APIClient()
        client.cookies[COOKIE] = old
        first = client.post("/api/v1/auth/refresh/")
        assert first.status_code == 200
        assert first.cookies[COOKIE].value != old
        replay = APIClient()
        replay.cookies[COOKIE] = old
        assert replay.post("/api/v1/auth/refresh/").status_code == 401

    def test_garbage_is_refused_and_clears_the_cookie(self):
        client = APIClient()
        client.cookies[COOKIE] = "not-a-token"
        response = client.post("/api/v1/auth/refresh/")
        assert response.status_code == 401
        assert response.cookies[COOKIE].value == ""


    def test_a_disabled_account_cant_refresh(self, registered):
        get_user_model().objects.filter(username="sara_01").update(is_active=False)
        client = APIClient()
        client.cookies[COOKIE] = registered.cookies[COOKIE].value
        assert client.post("/api/v1/auth/refresh/").status_code == 401

    def test_a_deleted_account_cant_refresh(self, registered):
        token = registered.cookies[COOKIE].value
        get_user_model().objects.filter(username="sara_01").delete()
        client = APIClient()
        client.cookies[COOKIE] = token
        assert client.post("/api/v1/auth/refresh/").status_code == 401


class TestLogout:
    def test_kills_the_refresh_token(self, registered):
        token = registered.cookies[COOKIE].value
        client = APIClient()
        client.cookies[COOKIE] = token
        response = client.post("/api/v1/auth/logout/")
        assert response.status_code == 200
        assert response.cookies[COOKIE].value == ""
        replay = APIClient()
        replay.cookies[COOKIE] = token
        assert replay.post("/api/v1/auth/refresh/").status_code == 401

    def test_succeeds_with_nothing_to_log_out_of(self):
        assert APIClient().post("/api/v1/auth/logout/").status_code == 200


class TestRateLimits:
    def test_blocks_password_guessing(self):
        client = APIClient()
        codes = [client.post("/api/v1/auth/login/", {"username": "someone", "password": "x" * 12}, format="json").status_code for _ in range(11)]
        assert codes[:10] == [401] * 10
        assert codes[10] == 429

    def test_faking_x_forwarded_for_doesnt_dodge_the_limit(self):
        client = APIClient()
        codes = [client.post("/api/v1/auth/login/", {"username": f"a{i}", "password": "x" * 12}, format="json", HTTP_X_FORWARDED_FOR=f"10.0.0.{i}").status_code for i in range(11)]
        assert codes[10] == 429

    def test_guessing_one_account_from_many_addresses_is_limited_too(self):
        client = APIClient()
        codes = [client.post("/api/v1/auth/login/", {"username": "someone", "password": "x" * 12}, format="json", REMOTE_ADDR=f"10.0.0.{i}").status_code for i in range(11)]
        assert codes[10] == 429

    def test_changing_capitals_doesnt_reset_the_account_limit(self):
        client = APIClient()
        names = ["someone", "Someone", " SOMEONE"]
        codes = [client.post("/api/v1/auth/login/", {"username": names[i % 3], "password": "x" * 12}, format="json", REMOTE_ADDR=f"10.0.0.{i}").status_code for i in range(11)]
        assert codes[10] == 429

    def test_argon2_is_the_production_hasher(self):
        from config.settings import base

        assert base.PASSWORD_HASHERS[0].endswith("Argon2PasswordHasher")


class TestAccount:
    def test_can_change_only_its_own_settings(self, api):
        response = api.patch("/api/v1/auth/me/", {"display_name": "Amina", "time_zone": "Africa/Nairobi", "xp": 5000, "season": 9, "peak_cleared": 150}, format="json")
        assert response.status_code == 200
        player = api.user.player
        player.refresh_from_db()
        assert player.display_name == "Amina"
        assert player.time_zone == "Africa/Nairobi"
        assert player.xp == 0 and player.season == 1 and player.peak_cleared == 0

    def test_time_zone_changes_once_a_day_so_it_cant_fake_a_streak_day(self, api, clock):
        assert api.patch("/api/v1/auth/me/", {"time_zone": "Pacific/Kiritimati"}, format="json").status_code == 200
        again = api.patch("/api/v1/auth/me/", {"time_zone": "Pacific/Pago_Pago"}, format="json")
        assert again.status_code == 409
        assert again.json()["error"]["code"] == "time_zone_changed_recently"
        clock.advance(hours=24)
        assert api.patch("/api/v1/auth/me/", {"time_zone": "Pacific/Pago_Pago"}, format="json").status_code == 200

    def test_setting_the_same_zone_doesnt_use_up_the_change(self, api, clock):
        same = api.user.player.time_zone
        api.patch("/api/v1/auth/me/", {"time_zone": same}, format="json")
        assert api.patch("/api/v1/auth/me/", {"time_zone": "Africa/Nairobi"}, format="json").status_code == 200

    def test_other_settings_arent_limited(self, api, clock):
        api.patch("/api/v1/auth/me/", {"time_zone": "Africa/Nairobi"}, format="json")
        assert api.patch("/api/v1/auth/me/", {"sound_on": False, "time_zone": "Africa/Nairobi"}, format="json").status_code == 200

    def test_delete_needs_the_password(self, api):
        assert api.delete("/api/v1/auth/me/", {"password": "wrong wrong wrong"}, format="json").status_code == 403
        assert get_user_model().objects.filter(pk=api.user.pk).exists()

    def test_delete_wipes_everything(self, api):
        api.post("/api/v1/focus/blocks/", {"goal": "x", "minutes": 25}, format="json")
        pk = api.user.pk
        assert api.delete("/api/v1/auth/me/", {"password": "correct horse battery"}, format="json").status_code == 204
        assert not Player.objects.filter(user_id=pk).exists()
        assert not TimeLedger.objects.exists()

    def test_a_deleted_accounts_token_stops_working(self, user):
        token = str(RefreshToken.for_user(user).access_token)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        assert client.get("/api/v1/player/").status_code == 200
        user.delete()
        assert client.get("/api/v1/player/").status_code == 401


def picture(kind="PNG", size=(40, 30), **save):
    image = Image.new("RGB", size, (200, 40, 90))
    out = BytesIO()
    image.save(out, format=kind, **save)
    return out.getvalue()


def upload(api, data, name="me.png", content_type="image/png"):
    return api.post("/api/v1/auth/avatar/", {"picture": SimpleUploadedFile(name, data, content_type=content_type)}, format="multipart")


def served(api):
    return api.get("/api/v1/player/").json()["avatar"]


class TestSystemAvatars:
    def test_everyone_gets_one_automatically(self, api):
        assert served(api)["kind"] == "system"
        assert 0 <= served(api)["index"] < rules.SYSTEM_AVATARS

    def test_the_same_username_always_gets_the_same_one(self):
        a = get_user_model().objects.create_user(username="same_name", password="x" * 12).player.avatar_index
        get_user_model().objects.filter(username="same_name").delete()
        b = get_user_model().objects.create_user(username="same_name", password="x" * 12).player.avatar_index
        assert a == b

    def test_different_usernames_are_spread_out(self):
        seen = {get_user_model().objects.create_user(username=f"spread{i}", password="x" * 12).player.avatar_index for i in range(40)}
        assert len(seen) > 8

    def test_can_be_changed(self, api):
        assert api.patch("/api/v1/auth/me/", {"avatar_index": 5}, format="json").json()["account"]["avatar"] == {"kind": "system", "index": 5}

    @pytest.mark.parametrize("bad", [-1, 16, 9999, "x"])
    def test_only_real_ones_can_be_chosen(self, api, bad):
        assert api.patch("/api/v1/auth/me/", {"avatar_index": bad}, format="json").status_code == 400


class TestUploadedAvatars:
    @pytest.mark.parametrize("kind", ["PNG", "JPEG", "WEBP", "GIF"])
    def test_accepts_normal_pictures(self, api, kind):
        response = upload(api, picture(kind))
        assert response.status_code == 201
        assert served(api)["kind"] == "upload"

    def test_what_is_served_is_always_our_own_small_webp(self, api):
        upload(api, picture("PNG", (800, 300)))
        image = Image.open(BytesIO(bytes(AvatarImage.objects.get().data)))
        assert image.format == "WEBP" and image.size == (256, 256)

    def test_location_and_other_metadata_are_removed(self, api):
        exif = Image.Exif()
        exif[0x010F] = "SECRET-CAMERA-MAKER"
        upload(api, picture("JPEG", exif=exif))
        data = bytes(AvatarImage.objects.get().data)
        assert b"SECRET-CAMERA-MAKER" not in data
        assert not Image.open(BytesIO(data)).getexif()

    @pytest.mark.parametrize("data,name,ctype", [
        (b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "x.svg", "image/svg+xml"),
        (b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "x.png", "image/png"),
        (b"<html><script>alert(1)</script></html>", "x.png", "image/png"),
        (b"MZ this is not a picture", "x.jpg", "image/jpeg"),
        (b"", "x.png", "image/png"),
    ])
    def test_refuses_anything_that_isnt_a_real_picture(self, api, data, name, ctype):
        response = upload(api, data, name, ctype)
        assert response.status_code == 400
        assert not AvatarImage.objects.exists()

    def test_a_script_hidden_inside_a_picture_doesnt_survive(self, api):
        upload(api, picture("PNG") + b"<script>alert(1)</script>")
        assert b"<script>" not in bytes(AvatarImage.objects.get().data)

    def test_a_cut_off_picture_is_refused(self, api):
        assert upload(api, picture("PNG", (200, 200))[:60]).status_code == 400

    def test_a_tiny_file_that_would_expand_to_gigabytes_is_refused(self, api):
        huge = BytesIO()
        Image.new("1", (9000, 9000)).save(huge, format="PNG")
        response = upload(api, huge.getvalue())
        assert response.status_code == 400
        assert not AvatarImage.objects.exists()

    def test_a_huge_file_is_refused(self, api):
        response = upload(api, b"x" * (MAX_BYTES + 10))
        assert response.status_code == 413

    def test_needs_a_file(self, api):
        assert api.post("/api/v1/auth/avatar/", {}, format="multipart").status_code == 400

    def test_needs_a_login(self, anon):
        assert anon.post("/api/v1/auth/avatar/", {"picture": SimpleUploadedFile("x.png", picture())}, format="multipart").status_code == 401

    def test_is_rate_limited(self, api):
        codes = [upload(api, picture()).status_code for _ in range(11)]
        assert codes[9] == 201 and codes[10] == 429

    def test_only_changes_your_own(self, api, other_api):
        upload(api, picture())
        mine = served(api)["url"]
        upload(other_api, picture())
        assert served(api)["url"] == mine
        assert AvatarImage.objects.count() == 2

    def test_each_upload_gets_a_new_address(self, api):
        upload(api, picture())
        first = served(api)["url"]
        upload(api, picture())
        assert served(api)["url"] != first
        assert AvatarImage.objects.count() == 1

    def test_can_go_back_to_a_system_avatar(self, api):
        upload(api, picture())
        assert api.delete("/api/v1/auth/avatar/").json()["avatar"]["kind"] == "system"
        assert not AvatarImage.objects.exists()

    def test_choosing_a_system_avatar_replaces_the_picture(self, api):
        upload(api, picture())
        api.patch("/api/v1/auth/me/", {"avatar_index": 3}, format="json")
        assert not AvatarImage.objects.exists()

    def test_deleting_the_account_deletes_the_picture(self, api):
        upload(api, picture())
        api.delete("/api/v1/auth/me/", {"password": "correct horse battery"}, format="json")
        assert not AvatarImage.objects.exists()


class TestServingAvatars:
    def test_needs_no_login_but_has_safe_headers(self, api, anon):
        upload(api, picture())
        response = anon.get(served(api)["url"])
        assert response.status_code == 200
        assert response["Content-Type"] == "image/webp"
        assert response["X-Content-Type-Options"] == "nosniff"
        assert "sandbox" in response["Content-Security-Policy"]

    def test_an_unknown_address_is_missing(self, anon):
        assert anon.get(f"/api/v1/avatars/{uuid.uuid4()}.webp").status_code == 404

    def test_the_old_address_stops_working_after_a_new_upload(self, api, anon):
        upload(api, picture())
        old = served(api)["url"]
        upload(api, picture())
        assert anon.get(old).status_code == 404

    def test_addresses_cant_be_walked_through(self, anon):
        assert anon.get("/api/v1/avatars/1.webp").status_code == 404
