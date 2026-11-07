"""Every number in the game (section 6), so balancing never needs a migration. Mission XP by
difficulty lives in content/tracks.yaml with the rest of the curriculum."""
import math

STARTER_BANK = 5 * 60
BANK_CAP = 30 * 60  # what focus blocks can bank
BONUS_CAP = 60 * 60  # what streak rewards can raise the bank to

BLOCK_MINUTES = (15, 25, 45)
EARN_SECONDS = {15: 5 * 60, 25: 8 * 60, 45: 15 * 60}
GOAL_BONUS_SECONDS = 2 * 60
GOAL_BONUS_XP = 10
GOAL_MAX_LENGTH = 100

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

# Section 6.4 scaled to today's 150 core missions (ADR 0004). Beyond doesn't count towards these.
LEVELS = (
    (0, "Noob"),
    (8, "Initiate"),
    (19, "Apprentice"),
    (34, "Operator"),
    (52, "Adept"),
    (71, "Specialist"),
    (90, "Technomancer"),
    (109, "Sorcerer"),
    (128, "Sage"),
    (150, "Archmage"),
)

CORE_TRACK_BADGES = (("SH", "Shell"), ("VI", "vi"), ("PY", "Python"), ("GO", "Go"), ("NET", "Networking"))
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
