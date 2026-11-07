from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import ContentRelease, FixtureFile


@api_view(["GET"])
def fixtures(request):
    """The starting file tree. Large and rarely changing, so the client caches it by version."""
    release = ContentRelease.latest()
    return Response({
        "version": release.version if release else 0,
        "files": list(FixtureFile.objects.values("path", "content", "mode")),
    })
