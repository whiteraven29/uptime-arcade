from celery import shared_task

from . import services


@shared_task(ignore_result=True, time_limit=120, soft_time_limit=100)
def grade_job(job_id):
    services.run_job(job_id)
