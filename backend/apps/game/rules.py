"""Every number in the game (section 6), so balancing never needs a migration. Mission XP by
difficulty lives in content/tracks.yaml with the rest of the curriculum."""
import math

STARTER_BANK = 5 * 60
BANK_CAP = 30 * 60  # what focus blocks can bank
BONUS_CAP = 60 * 60  # what streak rewards can raise the bank to

# Each player picks their own lengths (ADR 0017), within limits that keep a block real and the rest a break.
BLOCK_MIN_MINUTES = 10
BLOCK_MAX_MINUTES = 90
GOAL_BONUS_XP = 10
GOAL_MAX_LENGTH = 100

# The study plan (ADRs 0010 and 0017). Time alone proves nothing, so play time comes from keeping a plan you set
# in advance. Each study time is yours to set: when it starts and ends, and how many rest breaks it has. The study
# between the breaks is what's left, a kept block earns the rest after it, and nothing earns outside your study times.
PLAN_MAX_WINDOWS = 3
PLAN_MIN_WINDOW_MINUTES = 30
PLAN_MAX_BREAKS = 4  # rest breaks in one study time, each after a stretch of study
PLAN_CHANGE_DAYS = 7
PLAN_MAX_DAY_MINUTES = 8 * 60  # study times in a day can't add up to more: "any time at all" isn't a plan
REST_MIN_MINUTES = 5
REST_MAX_MINUTES = 30
REST_MAX_SHARE = 0.5  # a break is at most half the study before it, so a 50 can rest 25 and a 10 can rest 5
WEEKEND = (5, 6)  # Saturday and Sunday, which can have their own times

# One tap, at a moment the player can't know in advance, somewhere after this share of the block.
PRESENCE_EARLIEST_SHARE = 0.25
PRESENCE_WINDOW_SECONDS = 3 * 60
CLAIM_WINDOW_SECONDS = 15 * 60
NOTE_MIN_LENGTH = 5
NOTE_MAX_LENGTH = 140

# Goals are worked out from the plan, with some room for a bad day. Rewards grow with the goal, up to a cap,
# so a tiny plan can't collect a big reward.
TARGET_SHARE = {"week": 0.8, "month": 0.75}
TARGET_REWARD_SECONDS_PER_MINUTE = {"week": 6, "month": 3}
TARGET_REWARD_MAX_SECONDS = {"week": 20 * 60, "month": 45 * 60}

PAR_BONUS = 20
HINT_COST = 15
MIN_MISSION_XP = 10

# Rewind tasks earn nothing alone: XP is paid when the mission and its rewind are both finished.
REWIND_REVEAL_AFTER = 3  # misses on one task before its answer is shown, so nobody gets stuck

# Day boundaries follow the player's time zone, so moving it freely could fake an extra streak day.
TIME_ZONE_CHANGE_HOURS = 24

SYSTEM_AVATARS = 16

STREAK_STEP = 0.05
STREAK_MAX_STEPS = 10

# (days, play seconds, XP, shields)
STREAK_MILESTONES = (
    (3, 5 * 60, 50, 0),
    (7, 10 * 60, 150, 1),
    (14, 15 * 60, 300, 0),
    (21, 15 * 60, 500, 1),
    (30, 20 * 60, 1000, 0),
    (60, 30 * 60, 2000, 1),
    (100, 30 * 60, 5000, 1),
)

# Section 6.4, over the 213 core missions (ADR 0012). Beyond doesn't count towards these.
LEVELS = (
    (0, "Noob"),
    (10, "Initiate"),
    (25, "Apprentice"),
    (45, "Operator"),
    (70, "Adept"),
    (95, "Specialist"),
    (125, "Technomancer"),
    (155, "Sorcerer"),
    (185, "Sage"),
    (213, "Archmage"),
)

CORE_TRACK_BADGES = (("SH", "Shell"), ("VI", "vi"), ("PY", "Python"), ("GO", "Go"), ("NET", "Networking"), ("LAB", "NetLab"))
BEYOND_TIERS = ("Easy", "Medium", "Hard", "Expert", "Brainfuck")

BADGES = (
    ("firstblock", "First Block", "Finish a focus block"),
    ("clean10", "Clean Ten", "10 blocks with no drifts"),
    ("hours10", "Ten Hours", "10 hours of focus"),
    ("hours100", "Hundred Hours", "100 hours of focus"),
    ("week", "Full Week", "7 day streak"),
    ("month", "Iron Month", "30 day streak"),
    ("centurion", "Centurion", "100 day streak"),
    ("first", "First Clear", "Clear one mission"),
    *((f"lv{i + 1}", name, f"Reach level {i + 1}") for i, (_, name) in enumerate(LEVELS) if 0 < i < len(LEVELS) - 1),
    *((f"t{code}", f"{name} Master", f"Clear the {name} path") for code, name in CORE_TRACK_BADGES),
    ("tOPS", "Operator of Operations", "Clear every Operation"),
    ("par50", "Par Hunter", "50 missions at or under par"),
    ("nohints", "No Hints Needed", "Clear a whole chapter without hints"),
    ("night", "Night Shift", "Finish 25 on-call incidents"),
    ("arch", "Archmage", "Clear every core mission"),
    *((f"bx{i + 1}", f"{tier} Conquered", f"Clear the {tier} tier of Beyond") for i, tier in enumerate(BEYOND_TIERS)),
)


def level_index(cleared):
    index = 0
    for i, (needed, _) in enumerate(LEVELS):
        if cleared >= needed:
            index = i
    return index


def multiplier(streak):
    return 1 + min(max(streak, 0), STREAK_MAX_STEPS) * STREAK_STEP


def apply_multiplier(amount, streak):
    # Half rounds up, like the browser game. Python's round() would send 26.5 to 26.
    return math.floor(amount * multiplier(streak) + 0.5)


def mission_worth(base, par_bonus, hints_used):
    return max(MIN_MISSION_XP, base + par_bonus - hints_used * HINT_COST)


def focus_credit(bank, earned):
    """What a focus earning adds. It tops up to the cap and never takes away a bank already over it."""
    return max(0, min(BANK_CAP, bank + earned) - bank)


def streak_credit(bank, earned):
    return max(0, min(BONUS_CAP, bank + earned) - bank)


def block_fits(minutes):
    return isinstance(minutes, int) and BLOCK_MIN_MINUTES <= minutes <= BLOCK_MAX_MINUTES


def rest_limit(block_minutes):
    """The longest rest a block of this length can have."""
    return min(REST_MAX_MINUTES, int(block_minutes * REST_MAX_SHARE))


def rest_fits(block_minutes, rest_minutes):
    return isinstance(rest_minutes, int) and REST_MIN_MINUTES <= rest_minutes <= rest_limit(block_minutes)


def rest_earned(block_minutes, rest_minutes, minutes):
    """Seconds of play a kept block of this length earns: the plan's rest, in step with the block's length.
    Rounded down, and the browser shows it with the same sum."""
    return rest_minutes * 60 * minutes // block_minutes


def target_minutes(period, planned):
    """The share of the planned minutes that meets the goal, rounded up to the next 5."""
    return math.ceil(planned * TARGET_SHARE[period] / 5) * 5


def target_reward(period, target):
    """(play seconds, XP) for meeting a goal."""
    return min(TARGET_REWARD_MAX_SECONDS[period], target * TARGET_REWARD_SECONDS_PER_MINUTE[period]), target
