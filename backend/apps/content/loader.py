"""Reads and validates everything under content/. It writes nothing, so CI can run it alone."""
import json
from pathlib import Path

import yaml
from django.conf import settings
from jsonschema import Draft202012Validator


class ContentError(Exception):
    def __init__(self, problems):
        super().__init__(f"{len(problems)} problem(s) in content")
        self.problems = problems


def _yaml(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def validate_mission(mission, validator):
    """Problems the schema can't express come after the ones it can."""
    problems = [f"{'/'.join(map(str, e.path)) or '(top)'}: {e.message}" for e in validator.iter_errors(mission)]
    if problems:
        return problems
    for i, task in enumerate(mission["rewind"]):
        if task["type"] == "mc" and task["answer"] not in task["options"]:
            problems.append(f"rewind {i}: the answer isn't one of the options")
        if task["type"] == "order" and sorted(task["scrambled"]) != sorted(task["answer"]):
            problems.append(f"rewind {i}: scrambled doesn't hold the same items as the answer")
    for piece in [mission, *mission.get("stages", [])]:
        if piece.get("check") == "go-out" and "program" not in piece["go"]:
            problems.append("a go-out mission needs a program to read")
        if piece.get("check") == "go-code" and not {"starter", "test"} <= set(piece["go"]):
            problems.append("a go-code mission needs a starter and a test")
    if mission["check"] == "ops":
        kinds = [s["check"] for s in mission["stages"]]
        # A lab's saved work and a code editor's text are kept per mission, so an Operation has room for one of each.
        if kinds.count("net") > 1 or kinds.count("py") + kinds.count("go-code") > 1:
            problems.append("an Operation can have one lab stage and one code stage")
    if mission.get("track") == "BX" and mission["difficulty"] != mission["chapter"].lower():
        problems.append("a Beyond mission's chapter must be its difficulty tier")
    return problems


def load(root=None):
    root = Path(root or settings.CONTENT_DIR)
    config = _yaml(root / "tracks.yaml")
    schema = json.loads((root / "schema" / "mission.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)

    known_difficulty = {d["code"]: d for d in config["difficulties"]}
    missions, problems, seen = [], [], set()
    for track in config["tracks"]:
        files = sorted((root / "missions" / track["dir"]).glob("*.yaml"))
        rows = []
        for path in files:
            mission = _yaml(path)
            found = validate_mission(mission, validator)
            label = path.name
            if not found:
                if mission["id"] in seen:
                    found.append("duplicate id")
                seen.add(mission["id"])
                if mission["id"] != path.stem:
                    found.append(f"id {mission['id']} doesn't match the file name")
                if mission["track"] != track["code"]:
                    found.append(f"track {mission['track']} is in the {track['dir']} folder")
                if mission["difficulty"] not in known_difficulty:
                    found.append(f"unknown difficulty {mission['difficulty']}")
            problems += [f"{label}: {p}" for p in found]
            rows.append(mission)
        orders = sorted(m["order"] for m in rows if isinstance(m.get("order"), int))
        if orders != list(range(1, len(rows) + 1)):
            problems.append(f"{track['dir']}: orders must run 1 to {len(rows)} with no gaps")
        missions += rows
    known = {m["id"] for m in missions if isinstance(m, dict) and "id" in m}
    for track in config["tracks"]:
        if track.get("requires") and track["requires"] not in known:
            problems.append(f"{track['code']}: requires {track['requires']}, which doesn't exist")
    for m in missions:
        for needed in (m.get("requires_all") or []) if isinstance(m, dict) else []:
            if needed not in known:
                problems.append(f"{m.get('id')}: requires_all names {needed}, which doesn't exist")
        if isinstance(m, dict) and m.get("requires") and m["requires"] not in known:
            problems.append(f"{m['id']}: requires {m['requires']}, which doesn't exist")
    fixtures = _yaml(root / "fixtures" / "fs" / "base.yaml")["files"]
    if problems:
        raise ContentError(problems)
    return {"config": config, "missions": missions, "fixtures": fixtures}


def worth(mission, track, difficulties):
    row = next(d for d in difficulties if d["code"] == mission["difficulty"])
    return row["beyond_xp"] if track.get("after_archmage") else row["xp"]
