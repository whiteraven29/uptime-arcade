"""Section 9.6 and ADR 0011. The browser runs the simulator so it can answer every keystroke, but a pass comes from
here: the same engine, run by Node on the configs the player submits. What the browser says happened isn't read."""
import json
import re
import secrets
import shutil
import subprocess

from django.conf import settings
from rest_framework import serializers, status

from apps.core.exceptions import GameError

MAX_DEVICE_CONFIG = 40_000  # far past any real lab, and it bounds how long a grade can take
MAX_CABLES = 64


def clean_state(raw, lab):
    """Only named devices, only text, only sensible sizes. Locked devices are dropped, because they aren't the player's."""
    if not isinstance(raw, dict):
        raise serializers.ValidationError({"state": "Send the lab's state."})
    open_devices = {d["name"] for d in lab["devices"] if not d.get("locked")}
    devices = {}
    given = raw.get("devices") or {}
    if not isinstance(given, dict):
        raise serializers.ValidationError({"state": "Bad devices."})
    for name, config in given.items():
        if name not in open_devices or not isinstance(config, dict):
            continue
        running, startup = config.get("running", ""), config.get("startup", "")
        if not isinstance(running, str) or not isinstance(startup, str) or len(running) > MAX_DEVICE_CONFIG or len(startup) > MAX_DEVICE_CONFIG:
            raise serializers.ValidationError({"state": "A device's config is too large."})
        devices[name] = {"running": running, "startup": startup}
    state = {"devices": devices}
    cables = raw.get("cables")
    if cables is not None:
        if not isinstance(cables, list) or len(cables) > MAX_CABLES:
            raise serializers.ValidationError({"state": "Bad cables."})
        for cable in cables:
            if not isinstance(cable, list) or len(cable) != 4 or not all(isinstance(end, str) and len(end) <= 32 for end in cable):
                raise serializers.ValidationError({"state": "Bad cables."})
        state["cables"] = cables
    return state


def _run(script, payload):
    # Found on this server's PATH first, so Node installed under nvm or a version manager works too.
    command = [shutil.which(settings.NODE_BINARY) or settings.NODE_BINARY, "--max-old-space-size=128", str(script)]
    try:
        done = subprocess.run(command, input=json.dumps(payload), capture_output=True, text=True, timeout=settings.LAB_GRADER_TIMEOUT, check=True, env={})
        return json.loads(done.stdout)
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        raise GameError("grader_unavailable", "The lab couldn't be checked just now. Try again in a moment.", status.HTTP_503_SERVICE_UNAVAILABLE) from e


def grade(lab, goals, state):
    """Returns [{label, ok, why}]. If the grader can't run, nothing passes and the player can simply try again."""
    return _run(settings.LAB_GRADER, {"lab": lab, "state": state, "goals": goals}).get("goals", [])


def drill(mission, count):
    """A working network with something broken in it, and what was broken. ADR 0012."""
    seed = secrets.randbelow(2**31)
    return _run(settings.LAB_DRILL, {"lab": mission.play["lab"], "solution": mission.debrief["solution"], "goals": mission.expect, "seed": seed, "count": count})


KINDS = {"pc", "laptop", "server", "switch", "l3switch", "router", "firewall", "ap"}
NAME = re.compile(r"^[A-Z][A-Z0-9-]{0,15}$")
MAX_SANDBOX_DEVICES = 24


def clean_topology(raw):
    """Only what a sandbox device is made of. Nothing else a client sends is kept."""
    devices = raw.get("devices") if isinstance(raw, dict) else None
    if not isinstance(devices, list) or len(devices) > MAX_SANDBOX_DEVICES:
        raise serializers.ValidationError({"topology": f"A sandbox holds up to {MAX_SANDBOX_DEVICES} devices."})
    clean, seen = [], set()
    for d in devices:
        if not isinstance(d, dict) or d.get("kind") not in KINDS or not isinstance(d.get("name"), str) or not NAME.match(d["name"]) or d["name"] in seen:
            raise serializers.ValidationError({"topology": "Bad device."})
        x, y = d.get("x", 50), d.get("y", 50)
        if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            raise serializers.ValidationError({"topology": "Bad position."})
        seen.add(d["name"])
        row = {"name": d["name"], "kind": d["kind"], "x": max(0, min(100, x)), "y": max(0, min(100, y))}
        ports = d.get("ports")
        if isinstance(ports, int) and not isinstance(ports, bool) and 1 <= ports <= 48:
            row["ports"] = ports
        clean.append(row)
    return {"devices": clean, "cables": [], "cabling": True}
