# Runs one player's Python tests. Started once per job by backend/apps/missions/sandbox.py with no network, a read-only
# root, no capabilities and CPU, memory and process limits (section 11).
FROM python:3.13-alpine
COPY run_python.sh /opt/run.sh
USER 65534:65534
ENTRYPOINT ["/opt/run.sh"]
