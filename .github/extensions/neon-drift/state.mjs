import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_PROFILE_ID = "neon-drift.default-player.v1";

const DOMAIN_KEY = "neon-drift.arcade-profile.v1";
const DIFFICULTIES = new Set(["relaxed", "standard", "overdrive"]);
const DEFAULT_PROFILE = Object.freeze({
    highScore: 0,
    difficulty: "standard",
    soundEnabled: true,
    runs: 0,
});

function getStatePath() {
    const copilotHome = process.env.COPILOT_HOME || join(homedir(), ".copilot");
    return join(
        copilotHome,
        "extensions",
        "neon-drift",
        "artifacts",
        `${DOMAIN_KEY}.json`,
    );
}

function sanitizeProfile(value) {
    return {
        highScore:
            Number.isSafeInteger(value?.highScore) && value.highScore >= 0
                ? value.highScore
                : DEFAULT_PROFILE.highScore,
        difficulty: DIFFICULTIES.has(value?.difficulty)
            ? value.difficulty
            : DEFAULT_PROFILE.difficulty,
        soundEnabled:
            typeof value?.soundEnabled === "boolean"
                ? value.soundEnabled
                : DEFAULT_PROFILE.soundEnabled,
        runs:
            Number.isSafeInteger(value?.runs) && value.runs >= 0
                ? value.runs
                : DEFAULT_PROFILE.runs,
    };
}

async function readStore(path) {
    try {
        const parsed = JSON.parse(await readFile(path, "utf8"));
        return parsed?.domainKey === DOMAIN_KEY && parsed.profiles
            ? parsed
            : { domainKey: DOMAIN_KEY, profiles: {} };
    } catch (error) {
        if (error?.code === "ENOENT") {
            return { domainKey: DOMAIN_KEY, profiles: {} };
        }
        throw error;
    }
}

async function writeStore(path, store) {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
}

export async function createProfileStore() {
    const path = getStatePath();
    let queue = Promise.resolve();

    async function getProfile(profileId) {
        await queue;
        const store = await readStore(path);
        return sanitizeProfile(store.profiles[profileId]);
    }

    async function updateProfile(profileId, patch) {
        let result;
        queue = queue.then(async () => {
            const store = await readStore(path);
            const current = sanitizeProfile(store.profiles[profileId]);
            result = sanitizeProfile({ ...current, ...patch });
            store.profiles[profileId] = result;
            await writeStore(path, store);
        });
        await queue;
        return result;
    }

    return { getProfile, updateProfile };
}
