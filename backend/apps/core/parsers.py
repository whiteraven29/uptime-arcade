from django.conf import settings
from rest_framework.exceptions import APIException, ParseError
from rest_framework.parsers import JSONParser


class TooLarge(APIException):
    status_code = 413
    default_code = "too_large"
    default_detail = "That request is too large."


class LimitedJSONParser(JSONParser):
    """DRF reads the request stream directly, which skips Django's DATA_UPLOAD_MAX_MEMORY_SIZE. So
    the limit is enforced here, on the declared size and then on what actually arrives."""

    def parse(self, stream, media_type=None, parser_context=None):
        limit = settings.DATA_UPLOAD_MAX_MEMORY_SIZE
        request = (parser_context or {}).get("request")
        declared = request.META.get("CONTENT_LENGTH") if request is not None else None
        try:
            if declared and int(declared) > limit:
                raise TooLarge()
        except ValueError as e:
            raise TooLarge() from e
        try:
            return super().parse(_Capped(stream, limit), media_type, parser_context)
        except RecursionError as e:  # JSON nested deep enough to overflow the parser
            raise ParseError("That request is nested too deeply.") from e


class _Capped:
    def __init__(self, stream, limit):
        self.stream = stream
        self.left = limit

    def read(self, size=-1):
        chunk = self.stream.read(self.left + 1 if size < 0 else min(size, self.left + 1))
        self.left -= len(chunk)
        if self.left < 0:
            raise TooLarge()
        return chunk
