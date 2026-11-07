from django.urls import path

from . import views

urlpatterns = [
    path("player/", views.player, name="player"),
    path("rewards/", views.rewards, name="rewards"),
]
