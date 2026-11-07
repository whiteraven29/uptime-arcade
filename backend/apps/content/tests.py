import copy
import json
from io import StringIO

import pytest
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from jsonschema import Draft202012Validator

from apps.content.loader import ContentError, load, validate_mission
from apps.content.management.commands.import_content import run_import
from apps.content.models import ContentRelease, FixtureFile, Mission, Track
from apps.content.serializers import SERVER_ONLY, MissionBriefingSerializer, MissionCardSerializer
from apps.game import rules


def validator():
    schema = json.loads((settings.CONTENT_DIR / "schema" / "mission.schema.json").read_text())
    return Draft202012Validator(schema)


@pytest.fixture(scope="module")
def content():
    return load()


class TestImport:
    def test_imports_every_mission(self):
        assert Mission.objects.count() == 200
        assert Mission.objects.filter(track__after_archmage=False).count() == 150
        assert Track.objects.count() == 6
        assert FixtureFile.objects.count() > 50

    def test_every_track_has_thirty_and_beyond_has_fifty(self):
        for track in Track.objects.all():
            assert track.missions.count() == (50 if track.after_archmage else 30)

    def test_running_it_again_changes_nothing_but_the_version(self, content):
        before = ContentRelease.latest().version
        snapshot = list(Mission.objects.order_by("code").values("code", "title", "answer_spec", "xp"))
        run_import(content)
        assert ContentRelease.latest().version == before + 1
        assert list(Mission.objects.order_by("code").values("code", "title", "answer_spec", "xp")) == snapshot

    def test_a_removed_mission_is_retired_not_deleted(self, content):
        fewer = {**content, "missions": [m for m in content["missions"] if m["id"] != "sh-30"]}
        run_import(fewer)
        assert Mission.objects.get(code="sh-30").status == "retired"

    def test_check_mode_writes_nothing(self):
        before = ContentRelease.objects.count()
        out = StringIO()
        call_command("import_content", "--check", stdout=out)
        assert "200 missions" in out.getvalue()
        assert ContentRelease.objects.count() == before

    def test_top_level_is_reached_by_clearing_every_core_mission(self):
        assert rules.LEVELS[-1][0] == Mission.objects.filter(track__after_archmage=False).count()


class TestValidation:
    def good(self, content):
        return copy.deepcopy(next(m for m in content["missions"] if m["id"] == "sh-08"))

    def test_accepts_the_real_content(self, content):
        for m in content["missions"]:
            assert validate_mission(m, validator()) == [], m["id"]

    @pytest.mark.parametrize("field", ["title", "brief", "goal", "hints", "debrief", "rewind", "difficulty", "lesson"])
    def test_needs_every_required_field(self, content, field):
        m = self.good(content)
        del m[field]
        assert validate_mission(m, validator())

    def test_rejects_unknown_fields(self, content):
        m = self.good(content)
        m["surprise"] = 1
        assert validate_mission(m, validator())

    def test_an_answer_mission_needs_an_answer(self, content):
        m = self.good(content)
        del m["answer"]
        assert validate_mission(m, validator())

    def test_a_yes_or_no_answer_cant_silently_become_a_boolean(self, content):
        m = self.good(content)
        m["answer"]["accept"] = [False]
        assert validate_mission(m, validator())

    def test_needs_exactly_five_rewind_tasks(self, content):
        m = self.good(content)
        m["rewind"] = m["rewind"][:4]
        assert validate_mission(m, validator())

    def test_a_multiple_choice_answer_must_be_an_option(self, content):
        m = self.good(content)
        task = next(t for t in m["rewind"] if t["type"] == "mc")
        task["answer"] = "something else"
        assert validate_mission(m, validator())

    def test_every_rewind_task_has_a_hint(self, content):
        m = self.good(content)
        del m["rewind"][0]["hint"]
        assert validate_mission(m, validator())

    def test_an_unknown_goal_rule_is_refused(self, content):
        m = copy.deepcopy(next(x for x in content["missions"] if x["id"] == "sh-05"))
        m["expect"] = [{"run_this": "rm -rf /"}]
        assert validate_mission(m, validator())

    def test_bad_content_stops_the_import(self, tmp_path, monkeypatch):
        import shutil

        root = tmp_path / "content"
        shutil.copytree(settings.CONTENT_DIR, root, ignore=shutil.ignore_patterns("build"))
        (root / "missions" / "shell" / "sh-08.yaml").write_text("id: sh-08\n")
        with pytest.raises(ContentError) as e:
            load(root)
        assert any("sh-08" in p for p in e.value.problems)
        monkeypatch.setattr(settings, "CONTENT_DIR", root)
        with pytest.raises(CommandError):
            call_command("import_content", "--check")

    def test_yaml_cant_run_code(self, tmp_path):
        import shutil

        root = tmp_path / "content"
        shutil.copytree(settings.CONTENT_DIR, root, ignore=shutil.ignore_patterns("build"))
        (root / "missions" / "shell" / "sh-08.yaml").write_text('!!python/object/apply:os.system ["echo owned"]\n')
        with pytest.raises(Exception) as e:
            load(root)
        assert "python/object" in str(e.value)


class TestSerializersKeepSecrets:
    @pytest.mark.parametrize("serializer", [MissionCardSerializer, MissionBriefingSerializer])
    def test_declare_no_server_only_field(self, serializer):
        assert not set(SERVER_ONLY) & set(serializer.Meta.fields)
        assert serializer.Meta.fields != "__all__"

    def test_every_field_on_a_real_mission_is_safe(self):
        for mission in Mission.objects.all()[:20]:
            data = MissionBriefingSerializer(mission).data
            assert not set(SERVER_ONLY) & set(data)
            # Short solutions like pwd appear in their own lessons. Long ones never should.
            if len(mission.debrief["solution"]) > 30:
                assert mission.debrief["solution"] not in json.dumps(data)
