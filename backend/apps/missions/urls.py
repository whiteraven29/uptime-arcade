from django.urls import path

from . import views

urlpatterns = [
    path("tracks/", views.tracks, name="tracks"),
    path("missions/<str:code>/", views.briefing, name="briefing"),
    path("missions/<str:code>/play/", views.play, name="play"),
    path("missions/<str:code>/hint/", views.hint, name="hint"),
    path("missions/<str:code>/submit/", views.submit, name="submit"),
    path("missions/<str:code>/debrief/", views.debrief, name="debrief"),
    path("missions/<str:code>/rewind/", views.rewind, name="rewind"),
    path("missions/<str:code>/rewind/answer/", views.rewind_answer, name="rewind-answer"),
]
