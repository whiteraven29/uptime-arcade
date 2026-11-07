# ADR 0011: NetLab runs in the browser and is judged on the server

**Status:** accepted, 2026-11-07. Changes sections 5, 6.4, 6.6, 8.5, 8.6, 9, 12, 14, 15, 16 and 19, and replaces the single NET-11 gate from ADR 0009.

## Context

The owner asked for NetLab, with each lab unable to open until something corresponding is finished in the missions, more Networking missions where needed, and labs that mimic daily activities: designs, configs, security, firewalls, DNS, VPNs, OSPF and all that matters.

A lab needs a console that answers every keystroke, so it has to run in the browser. But everything a browser says can be forged, and the server owns the rules and answers (ADR 0005).

## Decision

- **One engine, two places.** `engines/netsim` is plain JavaScript. The browser runs it for play, and on a Check, `runner/grade_lab.mjs` runs it again on the server, in a short-lived Node process with time and memory limits. Node is now a backend dependency, which is where the design was heading for M9.
- **The config is the only input.** The client sends each device's config and, in a lab about cabling, its cables. It can't say what happened, because nothing else is read. To fake a pass, you'd have to send a config that really works, which is the lab. Configs are only ever parsed by the engine's command tables, and nothing in them is evaluated.
- **Locked devices belong to the lab.** What a client says about the ISP is thrown away.
- **Goals stay on the server.** The browser gets each goal's label, and never its assertion. A failed check returns the label and the reason, which is what teaches.
- **Per-lab gates.** Each lab has `requires` in its YAML, naming the Networking mission that teaches it, and it opens when that's cleared and the previous lab is. The existing `MissionPrereq` table holds them. The track itself opens with the first lab's gate.
- **Networking grows from 30 to 46.** Labs needed things it didn't teach: switching, VLANs, trunks, spanning tree, device consoles, DHCP relay, routing between VLANs, administrative distance, OSPF, wildcard masks, access list placement, firewalls, hardening, tunnels and IPsec. IDs stay fixed so progress survives, and `order` places them where they belong.
- **Thirty-four labs from daily work.** They arrive as tickets, changes and builds from named teams, ending with a design-day build and a multi-fault outage.
- **Levels go back to the design's numbers.** The core is now 200 missions, so Archmage is 200 again, and NetLab gets a master badge.
- **A walk, not a discrete-event simulator.** A packet is walked hop by hop in order, rather than scheduled by ticks. That's enough to be deterministic and explain every drop, in far less code. Stepping through packets in the UI can build on the recorded hops.
- **Labs live in their mission's YAML.** One file per lab is simpler to author than a separate topology file, and no lab shares one, so the unused `Topology` table is gone.
- **Lessons show the pattern, not the answer.** Examples use different addresses from the lab, because one test caught a lesson that gave the exact solution away.

## Why not the alternatives

- **Trusting the browser's check:** anyone could fake a pass and collect XP.
- **Sending every keystroke to the server:** consoles would lag on a poor connection, and every player would hold server state.
- **A second simulator in Python:** two engines would disagree, and the differences would be the bugs players find.

## Consequences

- A Check costs a Node process, so it uses the stricter submit limit of 30 a minute per player, and sizes are bounded before anything runs. If Node is missing, checks return 503 and nothing passes.
- `verify_content` proves every lab three ways: it isn't already solved, its solution works with no device errors, and the server's grader agrees from saved configs alone. `apps/netlab/tests.py` runs them all through the real grader.
- The simulation is simplified in the ways section 9.4 lists. Those are stated rather than hidden, and the syntax and behaviour are close enough to transfer.
- Players already past Archmage's old 150 keep their progress, but can see their level move, because the ladder changed.
