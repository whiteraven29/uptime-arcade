from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from apps.core import clock

MAX_AGE = timedelta(hours=48)


class Command(BaseCommand):
    help = "Deletes accounts whose email was never confirmed, so nobody can sit on a username with an address they don't own."

    def handle(self, *args, **options):
        stale = get_user_model().objects.filter(player__email_verified_at__isnull=True, is_staff=False, date_joined__lt=clock.now() - MAX_AGE)
        count = stale.count()
        stale.delete()
        self.stdout.write(f"Removed {count} unconfirmed accounts.")
