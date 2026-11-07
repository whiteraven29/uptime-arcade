"""Settings shared by every environment. See docs/DESIGN.md sections 11 and 17."""
import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE_DIR.parent / ".env")

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
DEBUG = False
ALLOWED_HOSTS = []

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "apps.core",
    "apps.accounts",
    "apps.content",
    "apps.game",
    "apps.focus",
    "apps.missions",
    "apps.rewind",
    "apps.netlab",
    "apps.oncall",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Africa/Dar_es_Salaam"  # section 17: default player time zone
USE_I18N = True
USE_TZ = True

# Mail. Production reads its SMTP account from the environment (prod.py), and everywhere else prints it.
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
DEFAULT_FROM_EMAIL = "Uptime Arcade <no-reply@localhost>"
EMAIL_TIMEOUT = 15
BACKGROUND_INLINE = False

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Section 17. Argon2 first, and the fallback only lets old hashes upgrade on next login.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# The biggest legitimate body is a shell mission's changed files. This stops anything far larger.
DATA_UPLOAD_MAX_MEMORY_SIZE = 1_000_000
DATA_UPLOAD_MAX_NUMBER_FIELDS = 200

SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

# Section 16: endpoints need login unless a view marks itself public.
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["apps.core.parsers.LimitedJSONParser"],
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "60/min",
        "user": "300/min",
        "auth": "10/min",  # section 17
        "login_account": "10/min",
        "code_account": "10/min",
        "register": "10/hour",
        "username_check": "60/min",
        "avatar": "10/min",
        "submit": "30/min",  # section 17
        "goal_check": "120/min",  # runs after each command in a terminal mission
    },
    # 0 means "use the real connection address". Left unset, DRF trusts X-Forwarded-For from anyone,
    # and a client could dodge every rate limit by changing that header. Prod sets its proxy count.
    "NUM_PROXIES": 0,
}

# Short-lived access tokens stay in memory in the browser. The long-lived refresh token only ever
# travels in an HttpOnly cookie, so a script on the page can't read it.
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=14),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    # Changing a password makes every access token issued before it stop working at once.
    "CHECK_REVOKE_TOKEN": True,
}
REFRESH_COOKIE = {
    "key": "ua_refresh",
    "httponly": True,
    "samesite": "Strict",
    "secure": False,
    "path": "/api/v1/auth/",
    "max_age": 14 * 24 * 3600,
}

CONTENT_DIR = BASE_DIR.parent / "content"
NODE_BINARY = os.environ.get("NODE_BINARY", "node")
LAB_GRADER = BASE_DIR.parent / "runner" / "grade_lab.mjs"
LAB_DRILL = BASE_DIR.parent / "runner" / "lab_drill.mjs"
LAB_GRADER_TIMEOUT = 8  # seconds
MACHINE_REPLAY = BASE_DIR.parent / "runner" / "replay_machine.mjs"

# Running a player's code (section 11, ADR 0015). "local" has no isolation, so prod.py turns it off for good.
RUNNER_BACKEND = "local"
RUNNER_ALLOW_LOCAL = True
RUNNER_DOCKER = "docker"
RUNNER_RUNTIME = ""  # an optional stronger runtime, such as gVisor's "runsc"
RUNNER_IMAGES = {"python": "uptime-arcade/sandbox-python:1", "go": "uptime-arcade/sandbox-go:1"}
RUNNER_LIMITS = {
    "python": {"seconds": 10, "memory": "128m", "cpus": 0.5, "pids": 32, "tmp": "16m", "tmp_exec": "noexec,"},
    "go": {"seconds": 30, "memory": "1g", "cpus": 1, "pids": 256, "tmp": "600m", "tmp_exec": ""},  # go test builds and runs a binary here
}

# Without a broker, jobs run inside the request, which suits development and tests.
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_IGNORE_RESULT = True
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
