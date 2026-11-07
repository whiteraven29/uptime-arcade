"""One error shape for the whole API: {"error": {"code", "message", "details"}}."""
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.views import exception_handler


class GameError(APIException):
    """A rule of the game said no. The code is stable and the client can act on it."""

    status_code = status.HTTP_409_CONFLICT

    def __init__(self, code, message, status_code=None):
        super().__init__(detail=message, code=code)
        self.game_code = code
        if status_code:
            self.status_code = status_code


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return None  # Unexpected errors stay 500s, and Django never shows details outside DEBUG.
    if isinstance(exc, GameError):
        body = {"code": exc.game_code, "message": str(exc.detail)}
    elif isinstance(exc, ValidationError):
        body = {"code": "invalid", "message": "Some of that wasn't valid.", "details": response.data}
    else:
        code = exc.default_code if isinstance(exc, APIException) else "error"
        detail = response.data.get("detail", "Request failed.") if isinstance(response.data, dict) else "Request failed."
        body = {"code": code, "message": str(detail)}
    response.data = {"error": body}
    return response
