from django.urls import path

from . import views

urlpatterns = [
    path("focus/blocks/", views.blocks, name="blocks"),
    path("focus/blocks/<int:block_id>/", views.block_detail, name="block-detail"),
    path("focus/blocks/<int:block_id>/presence/", views.presence, name="block-presence"),
    path("focus/blocks/<int:block_id>/drift/", views.drift, name="block-drift"),
    path("focus/blocks/<int:block_id>/abandon/", views.abandon, name="block-abandon"),
    path("focus/blocks/<int:block_id>/claim/", views.claim, name="block-claim"),
    path("focus/plan/", views.study_plan, name="study-plan"),
    path("focus/history/", views.history, name="focus-history"),
    path("sessions/open/", views.session_open, name="session-open"),
    path("sessions/close/", views.session_close, name="session-close"),
]
