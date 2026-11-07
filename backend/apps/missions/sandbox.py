"""Runs a player's code and decides whether it passed. In production every job gets a fresh container with no network,
no capabilities, a read-only root and hard limits on CPU, memory, processes and time, and the job goes in on stdin so
nothing from the host is mounted (section 11, ADR 0015). The local backend has none of that, so it exists only for
development and tests and production settings can't select it."""
import io
import json
import os
import resource
import secrets
import selectors
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass

from django.conf import settings

MAX_OUTPUT = 64_000
SHOWN_OUTPUT = 8_000


class SandboxUnavailable(Exception):
    """Nothing could be run, which says nothing about the player's code."""


@dataclass
class Outcome:
    passed: bool
    output: str


CAPTURE = '''_o = []
_print = print
def print(*a, sep=" ", end="\\n"):
    _o.append(sep.join([str(x) for x in a]) + end)
def _printed():
    return "".join(_o)
'''
HARNESS = '''
_fails = 0
def _t(name, got, want):
    global _fails
    if got == want and type(got) == type(want):
        _print("ok   " + name)
    else:
        _fails = _fails + 1
        _print("FAIL " + name + ": got " + repr(got) + ", wanted " + repr(want))
'''


def python_program(spec, code, token):
    """The same program the browser builds in program.js, except that the line that means "passed" is a secret for
    this one run, so printing it isn't enough."""
    head = CAPTURE if spec.get("capture_output") else "_print = print\n"
    body = code
    wrap = spec.get("wrap")
    if wrap:
        inner = "\n".join(f"    {line}" for line in code.split("\n"))
        body = f"def __case({wrap['args']}):\n{inner}\n    return {wrap['ret']}\n"
    tests = "\n".join(f"_t({json.dumps(t.get('label') or t['expr'])}, {t['expr']}, {t['want']})" for t in spec["tests"])
    return f'{head}{body}\n{spec.get("prelude") or ""}{HARNESS}{tests}\n_print("{token}" if _fails == 0 else "SOME_FAILED")\n'


def _tar(files):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as tar:
        for name, content in files.items():
            data = content.encode()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def _bounded_run(command, stdin, timeout, cwd=None, env=None, preexec=None, on_timeout=None):
    """Like subprocess.run, except a program that floods its output is stopped rather than filling this process's memory."""
    try:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=cwd, env=env, preexec_fn=preexec)
    except OSError as e:
        raise SandboxUnavailable(str(e)) from e

    def feed():
        try:
            process.stdin.write(stdin)
            process.stdin.close()
        except OSError:
            pass  # it stopped reading, which is its business

    threading.Thread(target=feed, daemon=True).start()
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    chunks, size, deadline, reason = [], 0, time.monotonic() + timeout, None
    while True:
        left = deadline - time.monotonic()
        if left <= 0:
            reason = "time"
            break
        if not selector.select(left):
            continue
        chunk = os.read(process.stdout.fileno(), 65536)
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)
        if size > MAX_OUTPUT:
            reason = "output"
            break
    selector.close()
    if reason:
        process.kill()
        if on_timeout:
            on_timeout()
    code = process.wait()
    process.stdout.close()
    return (None if reason else code), b"".join(chunks).decode(errors="replace")[:MAX_OUTPUT], reason


def _docker_command(kind, name):
    limits = settings.RUNNER_LIMITS[kind]
    command = [
        settings.RUNNER_DOCKER, "run", "--rm", "-i", "--name", name,
        "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--pids-limit", str(limits["pids"]), "--memory", limits["memory"], "--memory-swap", limits["memory"],
        "--cpus", str(limits["cpus"]), "--ulimit", "nofile=128:128", "--ulimit", "core=0",
        "--tmpfs", f"/tmp:rw,nosuid,nodev,{limits['tmp_exec']}size={limits['tmp']},mode=1777", "--log-driver", "none",
    ]
    if settings.RUNNER_RUNTIME:
        command += ["--runtime", settings.RUNNER_RUNTIME]
    return [*command, settings.RUNNER_IMAGES[kind]]


def _run_docker(kind, files):
    name = f"ua-job-{uuid.uuid4().hex}"
    remove = lambda: subprocess.run([settings.RUNNER_DOCKER, "rm", "-f", name], capture_output=True, timeout=20, check=False)  # noqa: E731
    code, output, reason = _bounded_run(_docker_command(kind, name), _tar(files), settings.RUNNER_LIMITS[kind]["seconds"], on_timeout=remove)
    if code == 125:  # the docker command itself failed, and the job never ran
        raise SandboxUnavailable(output[:500])
    return code, output, reason


def _limit_local():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))


def _run_local(kind, files):
    if not settings.RUNNER_ALLOW_LOCAL:
        raise SandboxUnavailable("The local runner is not allowed here.")
    seconds = settings.RUNNER_LIMITS[kind]["seconds"]
    with tempfile.TemporaryDirectory(prefix="ua-job-") as folder:
        for name, content in files.items():
            with open(os.path.join(folder, name), "w") as f:
                f.write(content)
        env = {"PATH": os.environ.get("PATH", ""), "HOME": folder, "LANG": "C.UTF-8"}
        if kind == "python":
            command = [sys.executable, "-I", "program.py"]
        else:
            go = shutil.which("go")
            if not go:
                raise SandboxUnavailable("Go isn't installed here.")
            command = [go, "test", "-vet=off", "-timeout", "10s", "./..."]
            env.update({"GOCACHE": os.environ.get("GOCACHE") or os.path.expanduser("~/.cache/go-build"), "GOFLAGS": "-mod=mod", "GOPROXY": "off", "GOTOOLCHAIN": "local", "CGO_ENABLED": "0"})
        return _bounded_run(command, b"", seconds, cwd=folder, env=env, preexec=_limit_local)


def _execute(kind, files):
    return _run_docker(kind, files) if settings.RUNNER_BACKEND == "docker" else _run_local(kind, files)


TOO_MUCH = {"time": "Stopped: it took too long. Look for a loop that never ends.", "output": "Stopped: it printed too much."}


def _python(mission, code):
    token = f"PASSED_{secrets.token_hex(16)}"
    spec = mission.play["python"]
    files = {"program.py": python_program(spec, code, token), **(spec.get("files") or {})}
    exit_code, output, reason = _execute("python", files)
    lines = output.rstrip().split("\n")
    passed = exit_code == 0 and lines[-1] == token
    shown = "\n".join(line for line in lines if line not in (token, "SOME_FAILED"))
    return Outcome(passed, _shown(shown, reason))


GO_MOD = "module mission\n\ngo 1.22\n"


def _go(mission, code):
    files = {"go.mod": GO_MOD, "main.go": code, "main_test.go": mission.answer_spec["go_test"]}
    exit_code, output, reason = _execute("go", files)
    return Outcome(exit_code == 0, _shown(output, reason))


def _shown(output, reason):
    text = output[-SHOWN_OUTPUT:].strip()
    return f"{text}\n{TOO_MUCH[reason]}".strip() if reason else text


def grade(mission, code):
    return _python(mission, code) if mission.check_type == "py" else _go(mission, code)
