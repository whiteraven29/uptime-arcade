from rest_framework.throttling import UserRateThrottle


class SubmitThrottle(UserRateThrottle):
    """Section 17: 30 a minute per player, so answers can't be brute forced."""

    scope = "submit"


class GoalCheckThrottle(UserRateThrottle):
    """Terminal and vi goals are checked after each command, so they get more room. There's nothing to
    guess at here: passing means really having the files in the right state."""

    scope = "goal_check"
