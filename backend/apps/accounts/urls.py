from django.urls import path

from . import views

urlpatterns = [
    path("username/", views.username_available, name="username-available"),
    path("register/", views.register, name="register"),
    path("verify/", views.verify_email, name="verify-email"),
    path("verify/resend/", views.resend_verify, name="verify-resend"),
    path("password/forgot/", views.forgot_password, name="password-forgot"),
    path("password/reset/", views.reset_password, name="password-reset"),
    path("login/", views.login, name="login"),
    path("refresh/", views.refresh, name="refresh"),
    path("logout/", views.logout, name="logout"),
    path("me/", views.me, name="me"),
    path("avatar/", views.avatar, name="avatar"),
]
