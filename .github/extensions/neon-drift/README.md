# Neon Drift

Neon Drift is a project-scoped Copilot canvas game for quick 1–3 minute arcade runs. Pilot a courier through an accelerating tunnel, collect data shards, skim hazards to charge Overdrive, and use dash, shield, or time-coil defenses to survive longer.

## Install and launch

The extension is discovered automatically from `.github/extensions/neon-drift/`. Reload extensions, then open the `neon-drift` canvas from Copilot or ask the agent to open Neon Drift.

## Controls

- **Keyboard:** Left/Right arrows or A/D to steer; Shift to dash; Q to activate a fully charged Overdrive; P or Space to pause; R to restart; M to toggle sound.
- **Mouse/pointer:** Point or drag across the playfield, double-click to dash, and use the on-screen ability controls.
- **Touch:** Drag in the playfield or use the large left/right controls plus the Dash and Overdrive buttons.

Choose Relaxed, Standard, or Overdrive before a run. The toolbar also provides pause, restart, and sound controls.

## Mechanics

- **Fair routes:** Every red obstacle wave is generated around a verified safe corridor. Barrier spacing accounts for the courier hitbox, lateral movement speed, tunnel speed, difficulty reaction time, and an acceleration reserve.
- **Dash:** A short phase dash crosses one threat safely, then recharges for 1.55 seconds.
- **Near misses:** Passing within the narrow reward band of a hazard scores a bonus and charges 22% Overdrive energy. Each hazard can award only once, and dash-assisted passes do not count.
- **Overdrive:** At 100% energy, activate a six-second scoring burst. Shards, near misses, cleared hazards, and passive score are doubled; charge returns to zero when the burst ends.
- **Pickups:** Shield nodes absorb one impact, while time coils temporarily slow the tunnel.

## Architecture

`extension.mjs` declares the canvas and agent actions. `server.mjs` creates one loopback-only ephemeral HTTP server per open instance and cleans it up on close. The dependency-free renderer lives under `renderer/`; `fairness.mjs` is shared with the deterministic stress harness under `tests/`. High score, difficulty, sound, and run count persist under the stable `neon-drift.arcade-profile.v1` domain key in the user's Copilot extension artifacts directory rather than under a transient canvas instance ID.

Agent actions:

- `get_status` returns live run state.
- `restart_game` restarts the active run.
- `set_difficulty` validates and applies `relaxed`, `standard`, or `overdrive`.
