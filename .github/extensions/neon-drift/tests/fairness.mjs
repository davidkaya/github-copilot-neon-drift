import assert from "node:assert/strict";
import {
    FAIRNESS_TUNING,
    PLAYER_LATERAL_SPEED,
    PLAYER_RADIUS,
    createHazardPlanner,
    createHazardScheduler,
    createSeededRandom,
    validateFairWave,
} from "../renderer/fairness.mjs";

const widths = [320, 480, 768, 1280];
const speedFactors = [1, 1.4, 1.9, 2.4, 2.85];
const baseSpeeds = {
    relaxed: 215,
    standard: 245,
    overdrive: 285,
};
const sequencesPerCase = 80;
const wavesPerSequence = 250;
let validatedWaves = 0;
let scheduledWaves = 0;

for (const difficulty of Object.keys(FAIRNESS_TUNING)) {
    for (const width of widths) {
        for (const speedFactor of speedFactors) {
            for (let sequence = 0; sequence < sequencesPerCase; sequence += 1) {
                const rng = createSeededRandom(
                    sequence +
                        width * 101 +
                        Math.round(speedFactor * 1_000) +
                        difficulty.length * 1_000_003,
                );
                const planner = createHazardPlanner({
                    width,
                    difficulty,
                    playerRadius: PLAYER_RADIUS,
                    lateralSpeed: PLAYER_LATERAL_SPEED,
                    rng,
                });
                for (let index = 0; index < wavesPerSequence; index += 1) {
                    const travelSpeed = baseSpeeds[difficulty] * speedFactor;
                    const wave = planner.next({
                        travelSpeed,
                        elapsed: index,
                    });
                    const errors = validateFairWave(wave, {
                        width,
                        playerRadius: PLAYER_RADIUS,
                        lateralSpeed: PLAYER_LATERAL_SPEED,
                    });
                    assert.deepEqual(errors, [], {
                        difficulty,
                        width,
                        speedFactor,
                        sequence,
                        index,
                        wave,
                    });
                    assert.ok(
                        wave.safeHalfWidth - PLAYER_RADIUS > 17,
                        "Following the center of a fair gate must not trigger a near miss.",
                    );
                    validatedWaves += 1;
                }
            }
        }
    }
}

for (const difficulty of Object.keys(FAIRNESS_TUNING)) {
    for (const width of widths) {
        for (const speedFactor of speedFactors) {
            const planningSpeed = baseSpeeds[difficulty] * speedFactor;
            const scheduler = createHazardScheduler({
                width,
                difficulty,
                rng: createSeededRandom(width + Math.round(planningSpeed * 10)),
            });
            scheduler.reset({ planningSpeed });
            let distanceSinceSpawn = 0;
            let caseScheduledWaves = 0;
            while (caseScheduledWaves < 2_000) {
                const step = 7 + (caseScheduledWaves % 19);
                distanceSinceSpawn += step;
                const spawned = scheduler.advance({
                    distance: step,
                    planningSpeed,
                    elapsed: scheduledWaves,
                });
                for (const wave of spawned) {
                    assert.ok(
                        distanceSinceSpawn + 1e-9 >= wave.spacing,
                        "A wave spawned before its own required preceding spacing elapsed.",
                    );
                    distanceSinceSpawn = 0;
                    caseScheduledWaves += 1;
                    scheduledWaves += 1;
                }
            }
        }
    }
}

console.log(
    `Fairness invariant passed for ${validatedWaves.toLocaleString("en-US")} generated obstacle waves and ${scheduledWaves.toLocaleString("en-US")} scheduled arrivals across 3 difficulties, 4 viewport widths, and 5 speed tiers.`,
);
