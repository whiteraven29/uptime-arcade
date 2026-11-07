from .base import *  # noqa: F403

SECRET_KEY = "test-only-key-with-enough-length-for-simplejwt-signing"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

BACKGROUND_INLINE = True
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]  # speed only, never outside tests
