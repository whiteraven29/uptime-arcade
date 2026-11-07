from django.urls import path

from . import views

urlpatterns = [
    path("focus/blocks/", views.blocks, name="blocks"),
    path("focus/blocks/<int:block_id>/drift/", views.drift, name="block-drift"),
    path("focus/blocks/<int:block_id>/abandon/", views.abandon, name="block-abandon"),
    path("focus/blocks/<int:block_id>/claim/", views.claim, name="block-claim"),
    path("sessions/open/", views.session_open, name="session-open"),
    path("sessions/close/", views.session_close, name="session-close"),
]
