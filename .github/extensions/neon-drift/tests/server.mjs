import assert from "node:assert/strict";
import { createGameServer } from "../server.mjs";

let profile = {
    highScore: 42,
    difficulty: "standard",
    soundEnabled: true,
    runs: 3,
};

const game = await createGameServer({
    instanceId: "server-validation",
    profileId: "validation-profile",
    profile,
    updateProfile: async (patch) => {
        profile = { ...profile, ...patch };
        return profile;
    },
});

try {
    const bootstrap = await fetch(`${game.url}api/bootstrap`).then((response) =>
        response.json(),
    );
    assert.equal(bootstrap.profile.highScore, 42);

    const invalid = await fetch(`${game.url}api/state`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phase: "broken" }),
    });
    assert.equal(invalid.status, 400);

    const state = await fetch(`${game.url}api/state`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            phase: "playing",
            score: 120,
            combo: 2,
            speed: 1.3,
            shields: 1,
            slowMotion: false,
            dashCooldown: 0.8,
            dashActive: true,
            overdriveEnergy: 88,
            overdriveRemaining: 0,
            nearMisses: 4,
            paused: false,
            soundEnabled: true,
            runStarted: true,
        }),
    });
    assert.equal(state.status, 200);
    const status = await state.json();
    assert.equal(status.dashActive, true);
    assert.equal(status.overdriveEnergy, 88);
    assert.equal(status.nearMisses, 4);
    assert.equal(profile.highScore, 120);
    assert.equal(profile.runs, 4);
} finally {
    await game.close();
}

console.log("Loopback server mechanics state validation passed.");
