import hashlib

from rest_framework.throttling import SimpleRateThrottle


class AuthThrottle(SimpleRateThrottle):
    """Section 17: 10 a minute per client address, for everything that checks a password."""

    scope = "auth"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class LoginAccountThrottle(SimpleRateThrottle):
    """The same limit per account, so an attacker moving between addresses still can't keep guessing."""

    scope = "login_account"

    def get_cache_key(self, request, view):
        username = request.data.get("username") if isinstance(request.data, dict) else None
        if not isinstance(username, str):
            return None
        ident = hashlib.sha256(username.strip().lower().encode()).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": ident}


class UsernameCheckThrottle(SimpleRateThrottle):
    """Enough for checking as you type, too few for listing who plays."""

    scope = "username_check"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
