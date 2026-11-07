import hashlib

from rest_framework.throttling import SimpleRateThrottle, UserRateThrottle


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


class RegisterThrottle(SimpleRateThrottle):
    """New accounts per address. Each one sends an email, which costs something and can be aimed at someone."""

    scope = "register"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class CodeAccountThrottle(SimpleRateThrottle):
    """The same limit per account or address for everything about email codes, wherever the requests come from."""

    scope = "code_account"

    def get_cache_key(self, request, view):
        data = request.data if isinstance(request.data, dict) else {}
        target = data.get("username") or data.get("identifier")
        if not isinstance(target, str):
            return None
        ident = hashlib.sha256(target.strip().lower().encode()).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": ident}


class AvatarThrottle(UserRateThrottle):
    scope = "avatar"


class UsernameCheckThrottle(SimpleRateThrottle):
    """Enough for checking as you type, too few for listing who plays."""

    scope = "username_check"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
