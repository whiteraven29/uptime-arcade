from django.urls import path

from . import views

urlpatterns = [
    path("netlab/sandbox/", views.sandbox, name="lab-sandbox"),
    path("netlab/<str:code>/state/", views.state, name="lab-state"),
    path("netlab/<str:code>/drill/", views.drill, name="lab-drill"),
]
