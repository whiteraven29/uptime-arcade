# 15. The server decides what passed

## Context

Until now, a browser could claim a Python pass by sending `passed: true`, and could claim any shell or vi result by describing files it never made. ADR 0005 accepted that for a single-player start. It doesn't hold once the game is public, so this is M9.

## Decision

- **Shell and vi missions are replayed.** The browser logs every line and key. When what it reports looks finished, the server plays the log through the same engines in Node, on a clean machine, and the rules are checked against that result. Command and key counts for par come from the replay too. What the browser reports is only used to avoid running Node after every command.
- **So every mission starts on a clean machine.** Files no longer carry over between missions, which the replay requires. All missions were proven to solve from clean, and only NET-24 needed a change. Leaving a mission half done and starting another restarts the first.
- **Python and Go run in a sandbox on the server.** A browser's pass only asks for the check, and the check decides. A failed run the browser reports is taken on trust, since it only costs the player. A Python pass depends on a random line chosen for that run, so printing a word isn't enough. A Go pass is `go test` exiting cleanly.
- **Each job gets a fresh container:** no network, read-only root, all capabilities dropped, no new privileges, non-root user, and limits on CPU, memory, processes, time and output. The job goes in on stdin, so nothing from the host is mounted. gVisor can be turned on with one setting.
- **Jobs go through a queue,** Celery on Redis with two workers, so a player gets one job at a time and the server runs at most two sandboxes however many people press Run. If the queue or sandbox is down, the job fails, costs the player nothing, and can be sent again.
- **Redis also holds the rate limit counters,** so they're shared across server processes. They weren't before, which would have multiplied every limit by the number of processes.
- **Go's three blank-filling missions become real code,** run with `go test`. Their tests aren't sent to the browser, though they sit beside the player's code while it runs.
- **The unisolated local runner stays for development and tests,** and production settings turn it off with no way to choose it from the environment.

## Consequences

Docker on the worker's user amounts to root on that machine, so only the worker has it and it handles no web requests. A player's code shares a sandbox with its tests, so it can hard-code the test values, read the test or Python's pass line from the job's files, or exit early with success in Go. That gets a mission solved without doing it, but the questions still have to be answered, nothing reaches another player or the host, and it only cheats themselves while there are no leaderboards. Before any shared ranking, tests would need to run in a separate process from the player's code. A browser can also still claim a low command count on `answer` and `net` missions, which earns the par bonus.
