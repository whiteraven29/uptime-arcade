import os

bind = f"127.0.0.1:{os.environ.get('UPTIME_PORT', '8000')}"
workers = 3
timeout = 30
graceful_timeout = 30
max_requests = 2000
max_requests_jitter = 200
limit_request_line = 4094
limit_request_fields = 50
worker_tmp_dir = "/dev/shm"
accesslog = "-"
errorlog = "-"
forwarded_allow_ips = "127.0.0.1"
