import {
    CanvasError,
    createCanvas,
    joinSession,
} from "@github/copilot-sdk/extension";
import { createGameServer } from "./server.mjs";
import { createProfileStore, DEFAULT_PROFILE_ID } from "./state.mjs";

const instances = new Map();
const profiles = await createProfileStore();

function requireInstance(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance) {
        throw new CanvasError(
            "neon_drift_instance_missing",
            "This Neon Drift instance is no longer running. Open the canvas again.",
        );
    }
    return instance;
}

const canvas = createCanvas({
    id: "neon-drift",
    displayName: "Neon Drift",
    description:
        "Pilot a glowing courier through an accelerating obstacle tunnel in a fast neon arcade run.",
    inputSchema: {
        type: "object",
        properties: {
            profileId: {
                type: "string",
                minLength: 1,
                maxLength: 48,
                pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
                description: "Stable player profile used for high scores and preferences.",
            },
            difficulty: {
                type: "string",
                enum: ["relaxed", "standard", "overdrive"],
            },
        },
        additionalProperties: false,
    },
    actions: [
        {
            name: "get_status",
            description:
                "Get the current run state, score, combo, speed, dash cooldown, Overdrive charge, near misses, pickup status, difficulty, and high score.",
            inputSchema: {
                type: "object",
                additionalProperties: false,
            },
            handler: (ctx) => requireInstance(ctx.instanceId).getStatus(),
        },
        {
            name: "restart_game",
            description: "Restart the active Neon Drift run immediately.",
            inputSchema: {
                type: "object",
                additionalProperties: false,
            },
            handler: (ctx) => requireInstance(ctx.instanceId).restart(),
        },
        {
            name: "set_difficulty",
            description:
                "Set the active and persisted difficulty, then restart the run with the new tuning.",
            inputSchema: {
                type: "object",
                properties: {
                    difficulty: {
                        type: "string",
                        enum: ["relaxed", "standard", "overdrive"],
                    },
                },
                required: ["difficulty"],
                additionalProperties: false,
            },
            handler: async (ctx) => {
                const instance = requireInstance(ctx.instanceId);
                await profiles.updateProfile(instance.profileId, {
                    difficulty: ctx.input.difficulty,
                });
                return instance.setDifficulty(ctx.input.difficulty);
            },
        },
    ],
    open: async (ctx) => {
        let instance = instances.get(ctx.instanceId);
        if (!instance) {
            const profileId = ctx.input?.profileId ?? DEFAULT_PROFILE_ID;
            let profile = await profiles.getProfile(profileId);
            if (ctx.input?.difficulty && ctx.input.difficulty !== profile.difficulty) {
                profile = await profiles.updateProfile(profileId, {
                    difficulty: ctx.input.difficulty,
                });
            }

            instance = await createGameServer({
                instanceId: ctx.instanceId,
                profileId,
                profile,
                updateProfile: (patch) => profiles.updateProfile(profileId, patch),
            });
            instances.set(ctx.instanceId, instance);
        }

        return {
            title: "Neon Drift",
            status: "Ready to launch",
            url: instance.url,
        };
    },
    onClose: async (ctx) => {
        const instance = instances.get(ctx.instanceId);
        if (!instance) {
            return;
        }
        instances.delete(ctx.instanceId);
        await instance.close();
    },
});

await joinSession({ canvases: [canvas] });
