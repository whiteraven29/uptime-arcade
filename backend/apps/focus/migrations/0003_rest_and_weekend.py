"""ADR 0017: each study time is set on the player's terms, with its rest breaks inside it, the weekend can have its
own study times, and a block keeps what it earns from the moment it starts."""
from django.db import migrations, models

# What blocks earned before, so one running across the change pays as it was promised.
OLD_EARN_SECONDS = {15: 5 * 60, 25: 8 * 60, 45: 15 * 60}
# The nearest allowed break to what a kept block used to earn with its goal bonus.
FIRST_REST = {15: 5, 25: 10, 45: 15}


def forwards(apps, schema_editor):
    """Old plans had one block length for the day, spread over their windows. Each window becomes a study time
    holding as many of those blocks, each followed by its break, as fit, so the length of study stays the same."""
    StudyPlan = apps.get_model("focus", "StudyPlan")
    FocusBlock = apps.get_model("focus", "FocusBlock")
    for row in StudyPlan.objects.all():
        block, left = row.block_minutes, row.blocks_per_day
        rest = FIRST_REST.get(block, 5)
        times = []
        for start, end in row.windows:
            fits = min(left, 4, (end - start) // (block + rest))
            if fits:
                times.append([start, start + fits * (block + rest), fits, rest])
                left -= fits
        if not times:  # windows too tight for a break: keep one block in the first
            start = row.windows[0][0]
            times = [[start, min(24 * 60, start + block + rest), 1, rest]]
        row.windows = times
        row.save(update_fields=["windows"])
    for minutes, seconds in OLD_EARN_SECONDS.items():
        FocusBlock.objects.filter(kind__in=["plan", "makeup"], minutes=minutes).update(earn_seconds=seconds)


class Migration(migrations.Migration):

    dependencies = [
        ('focus', '0002_study_plan_and_checks'),
    ]

    operations = [
        migrations.AddField(
            model_name='focusblock',
            name='earn_seconds',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='studyplan',
            name='weekend',
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='studyplan',
            name='blocks_per_day',
        ),
        migrations.RemoveField(
            model_name='studyplan',
            name='block_minutes',
        ),
    ]
