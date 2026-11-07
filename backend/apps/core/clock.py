"""The one place the game reads the time. Nothing ever trusts a time sent by a client (section 6.1),
and tests replace this to move the clock."""
from django.utils import timezone


def now():
    return timezone.now()
