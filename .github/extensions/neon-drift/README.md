# Neon Drift

Neon Drift is a project-scoped Copilot canvas game for quick 1–3 minute arcade runs. Pilot a courier through an accelerating tunnel, collect data shards to build a combo, and use shield or time-coil pickups to survive longer.

## Install and launch

The extension is discovered automatically from `.github/extensions/neon-drift/`. Reload extensions, then open the `neon-drift` canvas from Copilot or ask the agent to open Neon Drift.

## Controls

- **Keyboard:** Left/Right arrows or A/D to steer; P or Space to pause; R to restart; M to toggle sound.
- **Mouse/pointer:** Point or drag across the playfield.
- **Touch:** Drag in the playfield or use the large left/right controls.

Choose Relaxed, Standard, or Overdrive before a run. The toolbar also provides pause, restart, and sound controls.

## Architecture

`extension.mjs` declares the canvas and agent actions. `server.mjs` creates one loopback-only ephemeral HTTP server per open instance and cleans it up on close. The dependency-free renderer lives under `renderer/`. High score, difficulty, sound, and run count persist under the stable `neon-drift.arcade-profile.v1` domain key in the user's Copilot extension artifacts directory rather than under a transient canvas instance ID.

Agent actions:

- `get_status` returns live run state.
- `restart_game` restarts the active run.
- `set_difficulty` validates and applies `relaxed`, `standard`, or `overdrive`.
