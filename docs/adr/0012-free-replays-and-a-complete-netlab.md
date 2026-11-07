# ADR 0012: Replays are free, and NetLab is complete

**Status:** accepted, 2026-11-07. Changes sections 5, 6.2, 6.4, 8.5, 8.6, 9, 12, 15, 16 and 19. It replaces the line in ADR 0009 that revisits use play time.

## Context

The owner decided that replaying something already cleared should cost nothing and add nothing, and asked for everything NetLab was still missing, so it's a complete set: stepping through packets, injecting faults, a free-play sandbox, Wi-Fi and IPv6.

## Decision

- **Replays need no session.** Nothing about a cleared mission spends play time, pays XP or changes progress.
- **A running session pauses.** Its clock would otherwise spend play time during a replay, so entering one closes the session and returns the unused time to the bank.
- **Replays still wait for a focus block.** Otherwise someone could practise through the time a block is earning, which is the behaviour ADR 0010 exists to stop.
- **Stepping is built on what the engine already records.** Each hop keeps the decision and the packet as it looked then, and the UI walks them.
- **Fault drills are replays.** They run on a cleared lab with the real grader. The server plays the lab's solution, then breaks config, and only keeps a fault that really makes a goal fail. Goals about config text don't count, because any change would break those. It keeps what it broke until the player asks. Because a drill pays nothing, there's nothing to protect beyond that.
- **The sandbox costs nothing and earns nothing.** It opens after LAB-05, when a player can use a console and save, and it waits for a focus block like a replay. Only name, kind and position are kept for each device, so a client can't save a locked device or anything else.
- **An access point is a switch with a radio.** SSIDs map to VLANs and every client gets a virtual port on the access point, so all the existing switching applies. It's outside the spanning tree.
- **Wi-Fi is judged by distance and channel numbers,** with enterprise logins checked over the network through RADIUS. It's enough to teach SSIDs, channel plans, security, roaming, and tracing a rogue, without radio physics.
- **IPv6 is a separate plane.** It has its own addresses, routing table and access lists, and IPv4 lists never touch it, which is exactly the hole one lab teaches. It has SLAAC and static routes, with no OSPFv3 or DHCPv6.
- **The core is 213 missions.** Networking is 49 and NetLab is 44, and the level ladder moves to match, with Archmage at 213.

## Why not the alternatives

- **Replays that keep the session running:** cheap to build, but they'd quietly spend the player's time.
- **Pausing the session on the server when a replay loads:** a GET shouldn't change anything, so the client closes the session through the normal endpoint.
- **Drills as a paid challenge:** that would need the grader to prove the fault was present in what's submitted, and a replay earns nothing anyway.

## Consequences

- Levels move again. Archmage needs 213, so anyone past the old step sees their level change.
- Grading finds Node on the server's PATH first, so Node under nvm works.
- A real-world feature set stays out of scope and is stated in section 9.4: OSPFv3, DHCPv6, radio physics and IPv6 through firewalls.
