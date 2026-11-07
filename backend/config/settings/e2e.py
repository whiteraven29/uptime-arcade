"""For tools/e2e.mjs only: a throwaway database, and rate limits high enough for a fast robot."""
import os

from .dev import *  # noqa: F403
from .dev import REST_FRAMEWORK

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": os.environ["E2E_DB"]}}
REST_FRAMEWORK = {**REST_FRAMEWORK, "DEFAULT_THROTTLE_RATES": {k: "10000/min" for k in REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]}}
