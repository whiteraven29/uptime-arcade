"""Section 14. Answers are compared here, on the server, and never leave it. Goals in a player's file
tree use the same expect rules as engines/fs/expect.js. In v1 the browser reports that state, so it's
checked for shape and against the rules, and M9's runner replays it before anything shared relies on it."""
import re

from rest_framework import serializers

from apps.content.models import FixtureFile

HOME = "/home/ops"
BITS = {"r": 0o400, "w": 0o200, "x": 0o100}
MAX_ANSWER = 2000
MAX_CODE = 20_000
MAX_PATHS = 500


def normalize(value):
    """Same as the browser game's submit: spacing, quote style and capitals don't change an answer."""
    text = re.sub(r"\s+", " ", str(value).strip())
    return text.replace("'", '"').replace(", ", ",").lower()


def normalize_rewind(value):
    return re.sub(r"\s+", " ", str(value).strip()).replace("'", '"').lower()


def answer_matches(submitted, accept):
    wanted = normalize(submitted)
    return any(normalize(a) == wanted for a in accept)


def _home(path):
    return HOME + path[1:] if path == "~" or path.startswith("~/") else path


def _path_exists_in_base(path):
    return FixtureFile.objects.filter(path=path).exists() or FixtureFile.objects.filter(path__startswith=path + "/").exists()


def _file(state, path):
    """The file as the player left it: their changes first, then the starting tree."""
    files = state.get("files", {})
    if path in files:
        return files[path]
    row = FixtureFile.objects.filter(path=path).values("content", "mode").first()
    return {"c": row["content"], "m": row["mode"]} if row else None


def _exists(state, path):
    files = state.get("files", {})
    return files[path] is not None if path in files else _path_exists_in_base(path)


def _check(name, arg, state):
    if name == "file_exists":
        return _exists(state, _home(arg))
    if name == "file_missing":
        return not _exists(state, _home(arg))
    if name == "file_equals":
        f = _file(state, _home(arg["path"]))
        return bool(f) and f.get("c") == arg["content"]
    if name == "file_contains":
        f = _file(state, _home(arg["path"]))
        return bool(f) and arg["text"] in (f.get("c") or "")
    if name == "mode_has":
        f = _file(state, _home(arg["path"]))
        return bool(f) and bool((f.get("m") or 0) & BITS[arg["bit"]])
    if name == "cwd_is":
        return state.get("cwd") == _home(arg)
    if name == "gateway_is":
        return state.get("gateway") == arg
    if name == "script_ran":
        return state.get("ran_script") == _home(arg)
    if name == "vi_saved":
        return (state.get("vi_keys", {}).get(_home(arg)) or 0) > 0
    if name == "vi_used":
        used = state.get("vi_used", {}).get(_home(arg["path"])) or []
        return all(k in used for k in arg["keys"])
    return False  # a rule this version doesn't know never passes


def goals_met(rules, state):
    return all(_check(*next(iter(rule.items())), state) for rule in rules)


class FileEntry(serializers.Serializer):
    c = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)
    m = serializers.IntegerField(required=False, min_value=0, max_value=0o7777)
    t = serializers.CharField(required=False)


class PlayerState(serializers.Serializer):
    files = serializers.DictField(required=False)
    cwd = serializers.CharField(required=False, max_length=512, trim_whitespace=False)
    gateway = serializers.CharField(required=False, max_length=64)
    ran_script = serializers.CharField(required=False, max_length=512, allow_null=True)
    vi_keys = serializers.DictField(child=serializers.IntegerField(min_value=0), required=False)
    vi_used = serializers.DictField(child=serializers.ListField(child=serializers.CharField(max_length=16), max_length=200), required=False)

    def validate_files(self, files):
        if len(files) > MAX_PATHS:
            raise serializers.ValidationError("Too many files.")
        clean = {}
        for path, entry in files.items():
            if not isinstance(path, str) or not path.startswith("/") or len(path) > 512:
                raise serializers.ValidationError("Bad path.")
            if entry is None:
                clean[path] = None
                continue
            row = FileEntry(data=entry)
            row.is_valid(raise_exception=True)
            clean[path] = dict(row.validated_data)
        return clean
