"""Work that shouldn't hold up a response. A public endpoint that sends mail has to answer in the same time whether
or not an account exists, or the delay would say which addresses are in use."""
import logging
import threading

from django.conf import settings
from django.db import connection

log = logging.getLogger(__name__)


def _guarded(fn, args):
    try:
        fn(*args)
    except Exception:  # noqa: BLE001 a failed email must never become a failed request, or say anything to the caller
        log.exception("background job failed: %s", getattr(fn, "__name__", fn))
    finally:
        if not settings.BACKGROUND_INLINE:
            connection.close()


def run(fn, *args):
    if settings.BACKGROUND_INLINE:
        _guarded(fn, args)
    else:
        threading.Thread(target=_guarded, args=(fn, args), daemon=True).start()
