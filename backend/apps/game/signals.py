from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .services import create_player


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def give_new_user_a_player(sender, instance, created, raw=False, **kwargs):
    if created and not raw:
        create_player(instance)
