"""Accounts. A username is the public identity and how you log in, so saying whether one is free
gives nothing away. An email is private: it isn't unique and nothing ever says whether it's in use.

The access token comes back in the response and the browser keeps it in memory. The
refresh token only ever travels in an HttpOnly, SameSite=Strict cookie, so a script on the page can't
read it and another site can't send it."""
import re
import uuid
from datetime import timedelta
from zoneinfo import available_timezones

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.http import Http404, HttpResponse
from rest_framework import serializers, status
from rest_framework.decorators import api_view, authentication_classes, parser_classes, permission_classes, throttle_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core import clock
from apps.core.exceptions import GameError
from apps.focus import plan as study_plan
from apps.game import rules
from apps.game.models import AvatarImage
from apps.game.services import avatar_summary, locked_player

from .avatars import MAX_BYTES, NotAnImage, reencode
from .throttles import AuthThrottle, AvatarThrottle, LoginAccountThrottle, UsernameCheckThrottle

User = get_user_model()


def _with_tokens(response, refresh):
    response.data["access"] = str(refresh.access_token)
    response.set_cookie(value=str(refresh), **settings.REFRESH_COOKIE)
    return response


def _clear_cookie(response):
    response.delete_cookie(settings.REFRESH_COOKIE["key"], path=settings.REFRESH_COOKIE["path"], samesite=settings.REFRESH_COOKIE["samesite"])
    return response


def _account(user):
    p = user.player
    return {"username": user.username, "email": user.email, "display_name": p.display_name, "time_zone": p.time_zone, "sound_on": p.sound_on, "avatar": avatar_summary(p)}


USERNAME = re.compile(r"^[A-Za-z0-9_-]{3,20}$")
RESERVED = {"admin", "administrator", "root", "support", "system", "staff", "whiteraven", "uptime", "arcade", "me", "null", "none", "api"}


def username_problem(name):
    """Why a name can't be used, or None. Taken is checked separately, so this needs no database."""
    if not USERNAME.match(name or ""):
        return "invalid"
    if name.lower() in RESERVED:
        return "reserved"
    return None


def _valid_zone(value):
    if value not in available_timezones():
        raise serializers.ValidationError("Unknown time zone.")
    return value


class Register(serializers.Serializer):
    username = serializers.CharField(max_length=20)
    email = serializers.EmailField(max_length=150)
    password = serializers.CharField(max_length=128, trim_whitespace=False)
    display_name = serializers.CharField(max_length=40, required=False, allow_blank=True)
    time_zone = serializers.CharField(max_length=64, required=False, validators=[_valid_zone])


class Login(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class Account(serializers.Serializer):
    # Only what a player may change about themselves. XP, season and the rest aren't listed, so a
    # request that sets them does nothing.
    display_name = serializers.CharField(max_length=40, required=False, allow_blank=True)
    time_zone = serializers.CharField(max_length=64, required=False, validators=[_valid_zone])
    sound_on = serializers.BooleanField(required=False)
    avatar_index = serializers.IntegerField(required=False, min_value=0, max_value=rules.SYSTEM_AVATARS - 1)


class DeleteAccount(serializers.Serializer):
    password = serializers.CharField(max_length=128, trim_whitespace=False)


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([UsernameCheckThrottle])
def username_available(request):
    """Answers as you type. It only ever speaks about usernames, which are public anyway."""
    name = request.query_params.get("name", "").strip()
    problem = username_problem(name)
    if not problem and User.objects.filter(username=name.lower()).exists():
        problem = "taken"
    return Response({"available": problem is None, "reason": problem})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def register(request):
    body = Register(data=request.data)
    body.is_valid(raise_exception=True)
    data = body.validated_data
    typed = data["username"].strip()
    problem = username_problem(typed)
    if problem:
        raise GameError(f"username_{problem}", "That username can't be used.", status.HTTP_400_BAD_REQUEST)
    username = typed.lower()
    email = data["email"].strip().lower()
    try:
        validate_password(data["password"], user=User(username=username, email=email))
    except DjangoValidationError as e:
        raise serializers.ValidationError({"password": e.messages}) from e
    try:
        with transaction.atomic():
            user = User.objects.create_user(username=username, email=email, password=data["password"])
            player = user.player
            player.display_name = data.get("display_name") or typed
            if data.get("time_zone"):
                player.time_zone = data["time_zone"]
            player.save(update_fields=["display_name", "time_zone"])
    except IntegrityError as e:
        raise GameError("username_taken", "That username is taken.", status.HTTP_400_BAD_REQUEST) from e
    return _with_tokens(Response({"account": _account(user)}, status=status.HTTP_201_CREATED), RefreshToken.for_user(user))


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle, LoginAccountThrottle])
def login(request):
    body = Login(data=request.data)
    body.is_valid(raise_exception=True)
    username = body.validated_data["username"].strip().lower()
    user = authenticate(request, username=username, password=body.validated_data["password"])
    if user is None:
        # One message whether the username exists or not, and Django runs the hasher either way.
        raise GameError("bad_credentials", "Wrong username or password.", status.HTTP_401_UNAUTHORIZED)
    return _with_tokens(Response({"account": _account(user)}), RefreshToken.for_user(user))


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def refresh(request):
    token = request.COOKIES.get(settings.REFRESH_COOKIE["key"])
    if not token:
        raise GameError("not_logged_in", "Please log in.", status.HTTP_401_UNAUTHORIZED)
    body = TokenRefreshSerializer(data={"refresh": token})
    try:
        body.is_valid(raise_exception=True)
    except (TokenError, AuthenticationFailed, serializers.ValidationError, User.DoesNotExist):  # also a disabled or deleted user
        response = Response({"error": {"code": "not_logged_in", "message": "Please log in."}}, status=status.HTTP_401_UNAUTHORIZED)
        return _clear_cookie(response)
    response = Response({"access": body.validated_data["access"]})
    # Rotation: each refresh token works once, so a stolen one is spotted the next time either side uses it.
    response.set_cookie(value=body.validated_data["refresh"], **settings.REFRESH_COOKIE)
    return response


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def logout(request):
    token = request.COOKIES.get(settings.REFRESH_COOKIE["key"])
    if token:
        try:
            RefreshToken(token).blacklist()
        except TokenError:
            pass  # already expired or used: logging out should still succeed
    return _clear_cookie(Response({"ok": True}))


@api_view(["GET", "PATCH", "DELETE"])
def me(request):
    user = request.user
    if request.method == "PATCH":
        body = Account(data=request.data, partial=True)
        body.is_valid(raise_exception=True)
        changes = dict(body.validated_data)
        with transaction.atomic():
            player = locked_player(user)
            if changes.get("time_zone", player.time_zone) == player.time_zone:
                changes.pop("time_zone", None)
            elif player.time_zone_changed_at and clock.now() - player.time_zone_changed_at < timedelta(hours=rules.TIME_ZONE_CHANGE_HOURS):
                raise GameError("time_zone_changed_recently", "You can change your time zone once a day.")
            else:
                player.time_zone_changed_at = clock.now()
                player.save(update_fields=["time_zone_changed_at"])
            for field, value in changes.items():
                setattr(player, field, value)
            if changes:
                player.save(update_fields=list(changes))
            if "time_zone" in changes:
                study_plan.follow_time_zone(player)
            if "avatar_index" in changes:
                AvatarImage.objects.filter(player=player).delete()  # choosing a system avatar replaces a picture
        user.player = player
    elif request.method == "DELETE":
        # Section 17: account delete wipes everything. Asking for the password stops a stolen access
        # token from destroying the account.
        body = DeleteAccount(data=request.data)
        body.is_valid(raise_exception=True)
        if not user.check_password(body.validated_data["password"]):
            raise GameError("bad_credentials", "Wrong password.", status.HTTP_403_FORBIDDEN)
        user.delete()
        return _clear_cookie(Response(status=status.HTTP_204_NO_CONTENT))
    return Response({"account": _account(user)})


@api_view(["POST", "DELETE"])
@parser_classes([MultiPartParser])
@throttle_classes([AvatarThrottle])
def avatar(request):
    player = request.user.player
    if request.method == "DELETE":
        AvatarImage.objects.filter(player=player).delete()
        return Response({"avatar": avatar_summary(player)})
    declared = request.META.get("CONTENT_LENGTH") or "0"
    if not declared.isdigit() or int(declared) > MAX_BYTES:
        raise GameError("picture_too_large", "That picture is too large. Try one under 3 MB.", status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    upload = request.FILES.get("picture")
    if upload is None:
        raise GameError("picture_missing", "Choose a picture first.", status.HTTP_400_BAD_REQUEST)
    if upload.size > MAX_BYTES:
        raise GameError("picture_too_large", "That picture is too large. Try one under 3 MB.", status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    try:
        data = reencode(upload)
    except NotAnImage as e:
        raise GameError("not_a_picture", "That file isn't a PNG, JPEG, WebP or GIF picture.", status.HTTP_400_BAD_REQUEST) from e
    AvatarImage.objects.update_or_create(player=player, defaults={"token": uuid.uuid4(), "data": data})
    return Response({"avatar": avatar_summary(player)}, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([])
def avatar_image(request, token):
    """Public, because an img tag can't send a login, and the address can't be guessed. It only ever
    serves our own re-encoded WebP, and the headers stop a browser treating it as anything else."""
    row = AvatarImage.objects.filter(token=token).first()
    if not row:
        raise Http404
    response = HttpResponse(bytes(row.data), content_type="image/webp")
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    response["Cache-Control"] = "public, max-age=31536000, immutable"  # a new upload gets a new address
    return response
