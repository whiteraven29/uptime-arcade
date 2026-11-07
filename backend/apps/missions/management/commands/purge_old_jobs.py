from datetime import timedelta

from django.core.management.base import BaseCommand

from apps.core import clock
from apps.missions.models import GradingJob


class Command(BaseCommand):
    help = "Deletes finished code runs after a month, since a run's code and output have no further use."

    def handle(self, *args, **options):
        count, _ = GradingJob.objects.filter(created_at__lt=clock.now() - timedelta(days=30)).delete()
        self.stdout.write(f"Removed {count} old runs.")
