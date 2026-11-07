from django.urls import path

from apps.accounts.views import avatar_image

from . import views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("avatars/<uuid:token>.webp", avatar_image, name="avatar-image"),
]
