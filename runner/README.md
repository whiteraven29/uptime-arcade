# runner

Grading that needs real engines on the server.

- `grade_lab.mjs`: grades a NetLab lab from its submitted configs (ADR 0011). The backend runs it as a short-lived
  Node process with a time and memory limit, so Node has to be installed wherever the backend runs.
- The sandbox launcher for Python and Go arrives in M9.
