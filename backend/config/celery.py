"""Slow grading runs here, so a queue with a fixed number of workers decides how many sandboxes run at once.
It sets no default settings module on purpose: this file is imported first, so a default here would override the
production default in wsgi.py."""
from celery import Celery

app = Celery("uptime_arcade")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
