import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = join(ROOT, "renderer");
const DIFFICULTIES = new Set(["relaxed", "standard", "overdrive"]);
const PHASES = new Set(["ready", "playing", "paused", "gameover"]);
const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
};

const ASSETS = new Map(
    await Promise.all(
        ["index.html", "styles.css", "game.js", "fairness.mjs"].map(async (name) => [
            `/${name === "index.html" ? "" : name}`,
            {
                body: await readFile(join(PUBLIC_ROOT, name)),
                type: MIME_TYPES[extname(name)],
            },
        ]),
    ),
);

function sendJson(res, statusCode, value) {
    const body = JSON.stringify(value);
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
    });
    res.end(body);
}

async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 16_384) {
            const error = new Error("Request body exceeds 16 KB.");
            error.code = "BODY_TOO_LARGE";
            throw error;
        }
        chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    try {
        return raw ? JSON.parse(raw) : {};
    } catch {
        const error = new Error("Request body must be valid JSON.");
        error.code = "INVALID_JSON";
        throw error;
    }
}

function isFiniteNumber(value, minimum, maximum) {
    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= minimum &&
        value <= maximum
    );
}

export async function createGameServer({
    instanceId,
    profileId,
    profile,
    updateProfile,
}) {
    const clients = new Set();
    let currentProfile = { ...profile };
    let status = {
        instanceId,
        profileId,
        phase: "ready",
        score: 0,
        combo: 1,
        speed: 1,
        shields: 0,
        slowMotion: false,
        dashCooldown: 0,
        dashActive: false,
        overdriveEnergy: 0,
        overdriveRemaining: 0,
        nearMisses: 0,
        paused: false,
        difficulty: profile.difficulty,
        highScore: profile.highScore,
        soundEnabled: profile.soundEnabled,
        updatedAt: new Date().toISOString(),
    };

    function broadcast(type, payload) {
        const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
        for (const client of clients) {
            client.write(message);
        }
    }

    function replaceStatus(patch) {
        status = {
            ...status,
            ...patch,
            updatedAt: new Date().toISOString(),
        };
        return { ...status };
    }

    async function persistProfile(patch) {
        currentProfile = await updateProfile(patch);
        replaceStatus({
            difficulty: currentProfile.difficulty,
            highScore: currentProfile.highScore,
            soundEnabled: currentProfile.soundEnabled,
        });
        return currentProfile;
    }

    const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'none'; object-src 'none'",
        );

        if (req.method === "GET" && ASSETS.has(url.pathname)) {
            const asset = ASSETS.get(url.pathname);
            res.writeHead(200, {
                "Content-Type": asset.type,
                "Cache-Control": "no-store",
            });
            res.end(asset.body);
            return;
        }

        if (req.method === "GET" && url.pathname === "/api/bootstrap") {
            sendJson(res, 200, {
                instanceId,
                profileId,
                profile: currentProfile,
                status,
            });
            return;
        }

        if (req.method === "GET" && url.pathname === "/events") {
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            });
            res.write(`event: connected\ndata: ${JSON.stringify({ instanceId })}\n\n`);
            clients.add(res);
            req.on("close", () => clients.delete(res));
            return;
        }

        if (req.method === "POST" && url.pathname === "/api/state") {
            try {
                const input = await readJson(req);
                if (
                    !PHASES.has(input.phase) ||
                    !Number.isSafeInteger(input.score) ||
                    input.score < 0 ||
                    input.score > 1_000_000_000 ||
                    !isFiniteNumber(input.combo, 1, 99) ||
                    !isFiniteNumber(input.speed, 0, 99) ||
                    !Number.isSafeInteger(input.shields) ||
                    input.shields < 0 ||
                    input.shields > 9 ||
                    typeof input.slowMotion !== "boolean" ||
                    !isFiniteNumber(input.dashCooldown, 0, 10) ||
                    typeof input.dashActive !== "boolean" ||
                    !isFiniteNumber(input.overdriveEnergy, 0, 100) ||
                    !isFiniteNumber(input.overdriveRemaining, 0, 30) ||
                    !Number.isSafeInteger(input.nearMisses) ||
                    input.nearMisses < 0 ||
                    input.nearMisses > 1_000_000 ||
                    typeof input.paused !== "boolean" ||
                    typeof input.soundEnabled !== "boolean"
                ) {
                    sendJson(res, 400, { error: "Invalid game state payload." });
                    return;
                }

                const highScore = Math.max(currentProfile.highScore, input.score);
                replaceStatus({
                    phase: input.phase,
                    score: input.score,
                    combo: input.combo,
                    speed: input.speed,
                    shields: input.shields,
                    slowMotion: input.slowMotion,
                    dashCooldown: input.dashCooldown,
                    dashActive: input.dashActive,
                    overdriveEnergy: input.overdriveEnergy,
                    overdriveRemaining: input.overdriveRemaining,
                    nearMisses: input.nearMisses,
                    paused: input.paused,
                    highScore,
                    soundEnabled: input.soundEnabled,
                });

                if (
                    highScore !== currentProfile.highScore ||
                    input.soundEnabled !== currentProfile.soundEnabled ||
                    (input.runStarted === true && input.phase === "playing")
                ) {
                    const patch = {
                        highScore,
                        soundEnabled: input.soundEnabled,
                    };
                    if (input.runStarted === true) {
                        patch.runs = currentProfile.runs + 1;
                    }
                    await persistProfile(patch);
                }
                sendJson(res, 200, status);
            } catch (error) {
                const expectedInputError =
                    error?.code === "BODY_TOO_LARGE" || error?.code === "INVALID_JSON";
                sendJson(
                    res,
                    expectedInputError
                        ? error.code === "BODY_TOO_LARGE"
                            ? 413
                            : 400
                        : 500,
                    {
                        error: expectedInputError
                            ? error.message
                            : "Unable to save game state.",
                    },
                );
            }
            return;
        }

        if (req.method === "POST" && url.pathname === "/api/settings") {
            try {
                const input = await readJson(req);
                const patch = {};
                if ("difficulty" in input) {
                    if (!DIFFICULTIES.has(input.difficulty)) {
                        sendJson(res, 400, { error: "Invalid difficulty." });
                        return;
                    }
                    patch.difficulty = input.difficulty;
                }
                if ("soundEnabled" in input) {
                    if (typeof input.soundEnabled !== "boolean") {
                        sendJson(res, 400, { error: "Invalid sound setting." });
                        return;
                    }
                    patch.soundEnabled = input.soundEnabled;
                }
                if (Object.keys(patch).length === 0) {
                    sendJson(res, 400, { error: "No supported setting provided." });
                    return;
                }
                const saved = await persistProfile(patch);
                sendJson(res, 200, saved);
            } catch (error) {
                const expectedInputError =
                    error?.code === "BODY_TOO_LARGE" || error?.code === "INVALID_JSON";
                sendJson(
                    res,
                    expectedInputError
                        ? error.code === "BODY_TOO_LARGE"
                            ? 413
                            : 400
                        : 500,
                    {
                        error: expectedInputError
                            ? error.message
                            : "Unable to save game settings.",
                    },
                );
            }
            return;
        }

        sendJson(res, 404, { error: "Not found." });
    });

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    return {
        profileId,
        url: `http://127.0.0.1:${port}/`,
        getStatus: () => ({ ...status }),
        restart: () => {
            const next = replaceStatus({
                phase: "ready",
                score: 0,
                combo: 1,
                speed: 1,
                shields: 0,
                slowMotion: false,
                dashCooldown: 0,
                dashActive: false,
                overdriveEnergy: 0,
                overdriveRemaining: 0,
                nearMisses: 0,
                paused: false,
            });
            broadcast("command", { name: "restart" });
            return next;
        },
        setDifficulty: (difficulty) => {
            const next = replaceStatus({
                difficulty,
                phase: "ready",
                score: 0,
                combo: 1,
                speed: 1,
                shields: 0,
                slowMotion: false,
                dashCooldown: 0,
                dashActive: false,
                overdriveEnergy: 0,
                overdriveRemaining: 0,
                nearMisses: 0,
                paused: false,
            });
            broadcast("command", { name: "set-difficulty", difficulty });
            return next;
        },
        close: () =>
            new Promise((resolve) => {
                for (const client of clients) {
                    client.end();
                }
                clients.clear();
                server.close(() => resolve());
            }),
    };
}
