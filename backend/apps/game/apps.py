from django.apps import AppConfig


class GameConfig(AppConfig):
    name = "apps.game"

    def ready(self):
        from . import signals  # noqa: F401
