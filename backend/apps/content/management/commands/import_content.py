from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.content.loader import ContentError, load, worth
from apps.content.models import Chapter, ContentRelease, FixtureFile, Mission, Track


def _play(m):
    """What a player's workspace needs. Goals and solutions stay out."""
    play = {}
    if "file" in m:
        play["file"] = m["file"]
    if "fixtures" in m:
        play["fixtures"] = m["fixtures"]
    if "python" in m:
        play["python"] = m["python"]
    if "go" in m:
        play["go"] = {"program": m["go"]["program"]}  # "prints" would give a go-fix answer away
    return play


@transaction.atomic
def run_import(content):
    """Upserts by id and never deletes, so progress survives. Removed missions are marked retired."""
    latest = ContentRelease.latest()
    version = (latest.version if latest else 0) + 1
    config = content["config"]
    difficulties = config["difficulties"]
    tracks = {}
    for order, t in enumerate(config["tracks"], start=1):
        tracks[t["code"]], _ = Track.objects.update_or_create(
            code=t["code"],
            defaults={"name": t["name"], "subtitle": t["subtitle"], "order": order, "after_archmage": t.get("after_archmage", False)},
        )
    by_code = {t["code"]: t for t in config["tracks"]}
    chapters = {}
    for m in sorted(content["missions"], key=lambda x: (x["track"], x["order"])):
        track = tracks[m["track"]]
        key = (m["track"], m["chapter"])
        if key not in chapters:
            count = len({c for c in chapters if c[0] == m["track"]}) + 1
            chapters[key], _ = Chapter.objects.update_or_create(track=track, name=m["chapter"], defaults={"order": count})
        Mission.objects.update_or_create(
            code=m["id"],
            defaults={
                "track": track,
                "chapter": chapters[key],
                "order": m["order"],
                "skill": m["skill"],
                "title": m["title"],
                "from_dept": m["from"],
                "difficulty": m["difficulty"],
                "check_type": m["check"],
                "xp": worth(m, by_code[m["track"]], difficulties),
                "par_kind": m["par"]["kind"],
                "par_value": m["par"]["value"],
                "lesson_text": m["lesson"]["text"],
                "lesson_example": m["lesson"]["example"],
                "brief": m["brief"],
                "goal": m["goal"],
                "hints": m["hints"],
                "play": _play(m),
                "teaches": m["teaches"],
                "content_version": version,
                "status": Mission.Status.PUBLISHED,
                "answer_spec": m.get("answer", {}),
                "expect": m.get("expect", []),
                "debrief": m["debrief"],
                "rewind": m["rewind"],
            },
        )
    codes = {m["id"] for m in content["missions"]}
    retired = Mission.objects.exclude(code__in=codes).exclude(status=Mission.Status.RETIRED).update(status=Mission.Status.RETIRED)
    paths = set()
    for f in content["fixtures"]:
        paths.add(f["path"])
        FixtureFile.objects.update_or_create(path=f["path"], defaults={"content": f["content"], "mode": f["mode"]})
    FixtureFile.objects.exclude(path__in=paths).delete()
    ContentRelease.objects.create(version=version, difficulties=difficulties, mission_count=len(codes))
    return version, len(codes), retired


class Command(BaseCommand):
    help = "Validates content/ and imports it. Safe to run again: it upserts and never deletes progress."

    def add_arguments(self, parser):
        parser.add_argument("--check", action="store_true", help="Validate only. Touches no database.")

    def handle(self, *args, **options):
        try:
            content = load()
        except ContentError as e:
            raise CommandError("\n".join(["Content is not valid:", *e.problems])) from e
        if options["check"]:
            self.stdout.write(f"content OK: {len(content['missions'])} missions")
            return
        version, count, retired = run_import(content)
        self.stdout.write(f"imported content v{version}: {count} missions, {retired} retired")
