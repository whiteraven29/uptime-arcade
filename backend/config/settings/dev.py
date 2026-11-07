from .base import *  # noqa: F403
from .base import BASE_DIR, SECRET_KEY

DEBUG = True
BACKGROUND_INLINE = True
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]
SECRET_KEY = SECRET_KEY or "dev-only-insecure-key-do-not-deploy"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}
