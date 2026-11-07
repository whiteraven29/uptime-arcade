"""Accounts. The access token comes back in the response and the browser keeps it in memory. The
refresh token only ever travels in an HttpOnly, SameSite=Strict cookie, so a script on the page can't
read it and another site can't send it."""
from datetime import timedelta
from zoneinfo import available_timezones

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from rest_framework import serializers, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core import clock
from apps.core.exceptions import GameError
from apps.game import rules
from apps.game.services import locked_player

from .throttles import AuthThrottle, LoginEmailThrottle

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
    return {"email": user.email, "display_name": p.display_name, "time_zone": p.time_zone, "sound_on": p.sound_on}


def _valid_zone(value):
    if value not in available_timezones():
        raise serializers.ValidationError("Unknown time zone.")
    return value


class Register(serializers.Serializer):
    email = serializers.EmailField(max_length=150)
    password = serializers.CharField(max_length=128, trim_whitespace=False)
    display_name = serializers.CharField(max_length=40, required=False, allow_blank=True)
    time_zone = serializers.CharField(max_length=64, required=False, validators=[_valid_zone])


class Login(serializers.Serializer):
    email = serializers.CharField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class Account(serializers.Serializer):
    # Only what a player may change about themselves. XP, season and the rest aren't listed, so a
    # request that sets them does nothing.
    display_name = serializers.CharField(max_length=40, required=False, allow_blank=True)
    time_zone = serializers.CharField(max_length=64, required=False, validators=[_valid_zone])
    sound_on = serializers.BooleanField(required=False)


class DeleteAccount(serializers.Serializer):
    password = serializers.CharField(max_length=128, trim_whitespace=False)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def register(request):
    body = Register(data=request.data)
    body.is_valid(raise_exception=True)
    data = body.validated_data
    email = data["email"].strip().lower()
    candidate = User(username=email, email=email)
    try:
        validate_password(data["password"], user=candidate)
    except DjangoValidationError as e:
        raise serializers.ValidationError({"password": e.messages}) from e
    try:
        with transaction.atomic():
            user = User.objects.create_user(username=email, email=email, password=data["password"])
            player = user.player
            player.display_name = data.get("display_name", "")
            if data.get("time_zone"):
                player.time_zone = data["time_zone"]
            player.save(update_fields=["display_name", "time_zone"])
    except IntegrityError as e:
        raise GameError("email_taken", "That email can't be used.", status.HTTP_400_BAD_REQUEST) from e
    return _with_tokens(Response({"account": _account(user)}, status=status.HTTP_201_CREATED), RefreshToken.for_user(user))


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle, LoginEmailThrottle])
def login(request):
    body = Login(data=request.data)
    body.is_valid(raise_exception=True)
    email = body.validated_data["email"].strip().lower()
    user = authenticate(request, username=email, password=body.validated_data["password"])
    if user is None:
        # One message whether the email exists or not, and Django runs the hasher either way.
        raise GameError("bad_credentials", "Wrong email or password.", status.HTTP_401_UNAUTHORIZED)
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
