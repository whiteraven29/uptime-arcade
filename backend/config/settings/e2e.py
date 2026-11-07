"""For tools/e2e.mjs only: a throwaway database, and rate limits high enough for a fast robot."""
import os

from .dev import *  # noqa: F403
from .dev import REST_FRAMEWORK

# Each email lands as a file next to the throwaway database, so the robot can read its code like a person would.
EMAIL_BACKEND = "django.core.mail.backends.filebased.EmailBackend"
EMAIL_FILE_PATH = os.path.join(os.path.dirname(os.environ["E2E_DB"]), "mail")
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": os.environ["E2E_DB"]}}
REST_FRAMEWORK = {**REST_FRAMEWORK, "DEFAULT_THROTTLE_RATES": {k: "10000/min" for k in REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]}}
