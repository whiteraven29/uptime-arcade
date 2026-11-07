import os

from django.contrib import admin
from django.urls import include, path

# Section 17 limits admin by IP at the proxy. A private path also keeps it away from casual scanners.
ADMIN_PATH = os.environ.get("DJANGO_ADMIN_PATH", "admin/")

urlpatterns = [
    path(ADMIN_PATH, admin.site.urls),
    path("api/v1/", include("apps.core.urls")),
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/", include("apps.game.urls")),
    path("api/v1/", include("apps.focus.urls")),
    path("api/v1/", include("apps.content.urls")),
    path("api/v1/", include("apps.missions.urls")),
]
