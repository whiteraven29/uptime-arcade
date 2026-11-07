"""Codes for verifying an email and resetting a password. A six-digit code is only safe with limits, so each one has
few guesses and a short life, and the number of codes an account can be sent is capped. That also stops anyone using
this to flood somebody's inbox."""
import hashlib
import hmac
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db import transaction

from apps.core import clock

from .models import EmailCode

MAX_ATTEMPTS = 5
COOLDOWN = timedelta(seconds=60)
MAX_PER_HOUR = 5
MAX_PER_DAY = 10
# An email isn't unique, so someone could register many usernames at one victim's address. It has limits of its own.
MAX_PER_ADDRESS_HOUR = 6
MAX_PER_ADDRESS_DAY = 15
LIFETIME = {EmailCode.Purpose.VERIFY: timedelta(minutes=30), EmailCode.Purpose.RESET: timedelta(minutes=10)}


def _hash(user_id, purpose, code):
    message = f"{user_id}:{purpose}:{code}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).hexdigest()


def issue(user, purpose):
    """A new code that replaces any earlier one, or None if this account has been sent enough for now."""
    now = clock.now()
    with transaction.atomic():
        get_user_model().objects.select_for_update().get(pk=user.pk)  # two requests at once can't both pass the limits
        sent = EmailCode.objects.filter(user=user, purpose=purpose, created_at__gt=now - timedelta(days=1))
        if sent.filter(created_at__gt=now - COOLDOWN).exists():
            return None
        if sent.filter(created_at__gt=now - timedelta(hours=1)).count() >= MAX_PER_HOUR or sent.count() >= MAX_PER_DAY:
            return None
        address = EmailCode.objects.filter(user__email=user.email, created_at__gt=now - timedelta(days=1))
        if address.filter(created_at__gt=now - timedelta(hours=1)).count() >= MAX_PER_ADDRESS_HOUR or address.count() >= MAX_PER_ADDRESS_DAY:
            return None
        EmailCode.objects.filter(user=user, purpose=purpose, consumed_at__isnull=True).update(consumed_at=now)
        code = f"{secrets.randbelow(1_000_000):06d}"
        EmailCode.objects.create(user=user, purpose=purpose, code_hash=_hash(user.pk, purpose, code), created_at=now, expires_at=now + LIFETIME[purpose])
    return code


def redeem(user, purpose, code):
    """True once for the right code. A wrong guess is counted, and the last allowed guess kills the code."""
    if user is None:
        _hash(0, purpose, code)  # the same work as a real check
        return False
    now = clock.now()
    with transaction.atomic():
        row = EmailCode.objects.select_for_update().filter(user=user, purpose=purpose, consumed_at__isnull=True).order_by("-created_at").first()
        if row is None or row.expires_at <= now or row.attempts >= MAX_ATTEMPTS:
            return False
        if not hmac.compare_digest(row.code_hash, _hash(user.pk, purpose, code)):
            row.attempts += 1
            row.save(update_fields=["attempts"])
            return False
        row.consumed_at = now
        row.save(update_fields=["consumed_at"])
    return True


def _deliver(user, subject, intro, code, minutes):
    body = (
        f"Hi {user.username},\n\n{intro}\n\n    {code}\n\n"
        f"It works for {minutes} minutes, and only once. Nobody from Uptime Arcade will ever ask you for it.\n\n"
        "If this wasn't you, you can ignore this email. Nothing changes without the code.\n"
    )
    send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [user.email])


def send_verify(user):
    code = issue(user, EmailCode.Purpose.VERIFY)
    if code:
        _deliver(user, "Confirm your Uptime Arcade email", "Enter this code to finish creating your account:", code, 30)


def send_reset(user):
    code = issue(user, EmailCode.Purpose.RESET)
    if code:
        _deliver(user, "Reset your Uptime Arcade password", "Enter this code to choose a new password:", code, 10)


def send_password_changed(user):
    send_mail(
        "Your Uptime Arcade password was changed",
        f"Hi {user.username},\n\nYour password was just changed, and every device was logged out.\n\n"
        "If this was you, there's nothing to do. If it wasn't, use Forgot password on the login page straight away.\n",
        settings.DEFAULT_FROM_EMAIL,
        [user.email],
    )
