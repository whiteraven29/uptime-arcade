# ADR 0013: Wires by hand, in 2D

**Status:** accepted, 2026-11-07. Changes section 9.5.

## Context

The owner asked for animated simulations, with wires dragged to router and PC ports in 2D or 3D, so that labs are more entertaining and people want to clear them.

## Decision

- **2D, not 3D.** The map stays an SVG drawn in code. 3D would make port labels hard to read, make small ports fiddly to grab on a phone, and add a large library to the bundle, for little that helps someone learn. Cables that sag, link lights and moving packets give the physical feel without it.
- **Cables are dragged.** Each device shows its ports. A cable follows your hand, the target lights up, and letting go plugs it in. The reach of a press is measured in screen pixels, so it's usable on a phone, where letting go on a device also takes its first free port.
- **The link light tells the truth.** It's amber for a moment, then green or red according to the simulator.
- **More labs start unplugged.** Labs 2, 4, 6, 9, 12, 14, 25, 33 and 35 now have cables to plug in, with the ports named in the brief. Their cables are part of what the server grades.
- **Packets travel along the cables,** with a word at each decision, and clearing a lab sends a surge along every cable before the debrief.
- **The dropdowns stay.** Dragging can't be done from a keyboard, so the Cables panel does the same job.
- **Unlocks are something you see.** When a lab opens, its network draws itself on screen, device by device and then cable by cable, with what you just earned. The NetLab card shows every lab on one long cable that lights up as labs clear, and a new one pops into place.
- **An unlock has to be true.** Clearing a lab used to announce the next one even when it was still waiting for a Networking mission, and clearing that mission announced nothing. Both now come from the rule that decides who can play.
- **Reduced motion** turns off the blinking, the surge, the bursts and the packet's run, and a cable still plugs in.

## Consequences

- This doesn't change what a lab pays. The owner confirmed the rule: clearing one pays XP, and play time only comes from focus blocks.
