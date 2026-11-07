from rest_framework.throttling import UserRateThrottle


class SubmitThrottle(UserRateThrottle):
    """Section 17: 30 a minute per player, so answers can't be brute forced."""

    scope = "submit"
