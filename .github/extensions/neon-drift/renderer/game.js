const canvas = document.querySelector("#gameCanvas");
const context = canvas.getContext("2d", { alpha: false });
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const elements = {
    score: document.querySelector("#scoreValue"),
    combo: document.querySelector("#comboValue"),
    comboBar: document.querySelector("#comboBar i"),
    best: document.querySelector("#bestValue"),
    pickup: document.querySelector("#pickupStatus"),
    announcement: document.querySelector("#announcement"),
    intro: document.querySelector("#introPanel"),
    pause: document.querySelector("#pausePanel"),
    gameOver: document.querySelector("#gameOverPanel"),
    finalScore: document.querySelector("#finalScore"),
    finalCombo: document.querySelector("#finalCombo"),
    pauseButton: document.querySelector("#pauseButton"),
    soundButton: document.querySelector("#soundButton"),
    difficultyLabel: document.querySelector("#difficultyLabel"),
    speedLabel: document.querySelector("#speedLabel"),
};

const DIFFICULTY = {
    relaxed: { baseSpeed: 215, hazardRate: 1.12, acceleration: 2.1, label: "RELAXED" },
    standard: { baseSpeed: 245, hazardRate: 0.9, acceleration: 2.8, label: "STANDARD" },
    overdrive: { baseSpeed: 285, hazardRate: 0.72, acceleration: 3.7, label: "OVERDRIVE" },
};

const state = {
    phase: "ready",
    difficulty: "standard",
    score: 0,
    highScore: 0,
    combo: 1,
    comboChain: 0,
    comboLife: 0,
    bestCombo: 1,
    elapsed: 0,
    speedFactor: 1,
    shields: 0,
    slowMotion: 0,
    soundEnabled: true,
    runStartedPending: false,
    connectionWarning: false,
};

const world = {
    width: 0,
    height: 0,
    dpr: 1,
    time: 0,
    hazardClock: 0,
    shardClock: 0,
    pickupClock: 0,
    stars: [],
    entities: [],
    particles: [],
    player: { x: 0, targetX: 0, y: 0, radius: 14, tilt: 0 },
};

const input = {
    left: false,
    right: false,
    pointerActive: false,
};

let lastFrame = performance.now();
let stateSyncTimer = 0;
let audioContext;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function random(min, max) {
    return min + Math.random() * (max - min);
}

function formatScore(value) {
    return Math.floor(value).toString().padStart(6, "0");
}

function resize() {
    const rect = canvas.getBoundingClientRect();
    world.dpr = Math.min(devicePixelRatio || 1, 2);
    world.width = Math.max(320, rect.width);
    world.height = Math.max(250, rect.height);
    canvas.width = Math.round(world.width * world.dpr);
    canvas.height = Math.round(world.height * world.dpr);
    context.setTransform(world.dpr, 0, 0, world.dpr, 0, 0);
    world.player.y = world.height * 0.79;
    if (!world.player.x) {
        world.player.x = world.width / 2;
        world.player.targetX = world.player.x;
    }
    createStars();
}

function createStars() {
    const count = reducedMotion ? 28 : Math.floor(world.width * world.height / 9000);
    world.stars = Array.from({ length: count }, () => ({
        x: Math.random() * world.width,
        y: Math.random() * world.height,
        size: random(0.4, 1.8),
        depth: random(0.25, 1),
    }));
}

function setPanel(panel) {
    for (const candidate of [elements.intro, elements.pause, elements.gameOver]) {
        candidate.classList.toggle("hidden", candidate !== panel);
    }
}

function announce(message) {
    elements.announcement.textContent = "";
    requestAnimationFrame(() => {
        elements.announcement.textContent = message;
    });
}

function reportConnectionError() {
    if (state.connectionWarning) return;
    state.connectionWarning = true;
    const label = document.querySelector("#connectionLabel");
    label.classList.add("connection-error");
    label.title = "Local save and agent controls are temporarily unavailable.";
    announce("Local save unavailable. The current run can continue.");
}

function clearConnectionError() {
    if (!state.connectionWarning) return;
    state.connectionWarning = false;
    const label = document.querySelector("#connectionLabel");
    label.classList.remove("connection-error");
    label.removeAttribute("title");
}

function updateHud() {
    elements.score.textContent = formatScore(state.score);
    elements.combo.textContent = `×${state.combo}`;
    elements.comboBar.style.transform = `scaleX(${clamp(state.comboLife / 3.2, 0, 1)})`;
    elements.best.textContent = formatScore(Math.max(state.highScore, state.score));
    elements.difficultyLabel.textContent = DIFFICULTY[state.difficulty].label;
    elements.speedLabel.textContent = `${state.speedFactor.toFixed(1)}× VELOCITY`;
    elements.pauseButton.setAttribute("aria-pressed", state.phase === "paused" ? "true" : "false");
    elements.pauseButton.setAttribute("aria-label", state.phase === "paused" ? "Resume game" : "Pause game");
    elements.soundButton.setAttribute("aria-pressed", state.soundEnabled ? "false" : "true");
    elements.soundButton.setAttribute("aria-label", state.soundEnabled ? "Mute sound" : "Enable sound");

    const statuses = [];
    if (state.shields > 0) statuses.push(`SHIELD ×${state.shields}`);
    if (state.slowMotion > 0) statuses.push(`TIME COIL ${state.slowMotion.toFixed(1)}s`);
    elements.pickup.textContent = statuses.join("  ·  ");
}

function setDifficulty(difficulty, persist = true) {
    if (!DIFFICULTY[difficulty]) return;
    state.difficulty = difficulty;
    document.querySelector(`input[name="difficulty"][value="${difficulty}"]`).checked = true;
    updateHud();
    if (persist) {
        fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ difficulty }),
        })
            .then((response) => {
                if (!response.ok) throw new Error("Unable to save difficulty.");
                clearConnectionError();
            })
            .catch(reportConnectionError);
    }
}

function ensureAudio() {
    if (!state.soundEnabled) return null;
    audioContext ??= new AudioContext();
    if (audioContext.state === "suspended") audioContext.resume();
    return audioContext;
}

function sound(kind) {
    const audio = ensureAudio();
    if (!audio) return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const now = audio.currentTime;
    const sounds = {
        shard: [620, 940, 0.08, "sine"],
        pickup: [310, 680, 0.2, "triangle"],
        shield: [170, 90, 0.22, "sawtooth"],
        crash: [100, 38, 0.34, "sawtooth"],
        launch: [220, 520, 0.18, "triangle"],
    };
    const [from, to, duration, type] = sounds[kind];
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
}

function resetRun() {
    state.phase = "playing";
    state.score = 0;
    state.combo = 1;
    state.comboChain = 0;
    state.comboLife = 0;
    state.bestCombo = 1;
    state.elapsed = 0;
    state.speedFactor = 1;
    state.shields = 0;
    state.slowMotion = 0;
    state.runStartedPending = true;
    world.entities.length = 0;
    world.particles.length = 0;
    world.hazardClock = 0.5;
    world.shardClock = 0.1;
    world.pickupClock = 10;
    world.player.x = world.width / 2;
    world.player.targetX = world.player.x;
    setPanel(null);
    updateHud();
    announce("Run started");
    sound("launch");
    canvas.focus();
    syncState(true);
}

function pauseGame(force) {
    if (!["playing", "paused"].includes(state.phase)) return;
    const shouldPause = force ?? state.phase === "playing";
    state.phase = shouldPause ? "paused" : "playing";
    setPanel(shouldPause ? elements.pause : null);
    announce(shouldPause ? "Game paused" : "Game resumed");
    updateHud();
    syncState(true);
    if (!shouldPause) {
        lastFrame = performance.now();
        canvas.focus();
    }
}

function gameOver() {
    state.phase = "gameover";
    state.highScore = Math.max(state.highScore, Math.floor(state.score));
    elements.finalScore.textContent = formatScore(state.score);
    elements.finalCombo.textContent = `×${state.bestCombo}`;
    setPanel(elements.gameOver);
    announce(`Run over. Score ${Math.floor(state.score)}. Best combo ${state.bestCombo}.`);
    sound("crash");
    syncState(true);
}

function laneX(lane) {
    const tunnelWidth = Math.min(world.width * 0.76, 720);
    const left = (world.width - tunnelWidth) / 2;
    return left + tunnelWidth * ((lane + 0.5) / 6);
}

function spawnHazard() {
    const lane = Math.floor(Math.random() * 6);
    if (Math.random() < 0.28 && state.elapsed > 14) {
        world.entities.push({
            kind: "gate",
            x: 0,
            y: -40,
            gapX: laneX(lane),
            gapWidth: Math.max(62, world.width * 0.105),
            height: 22,
        });
    } else {
        world.entities.push({
            kind: "hazard",
            x: laneX(lane),
            y: -35,
            radius: random(18, 25),
            rotation: Math.random() * Math.PI,
        });
    }
}

function spawnShardChain() {
    const lane = Math.floor(Math.random() * 6);
    const amount = Math.random() < 0.3 ? 3 : 1;
    for (let index = 0; index < amount; index += 1) {
        world.entities.push({
            kind: "shard",
            x: laneX(clamp(lane + (index % 2), 0, 5)),
            y: -30 - index * 72,
            radius: 9,
            rotation: Math.random() * Math.PI,
        });
    }
}

function spawnPickup() {
    world.entities.push({
        kind: Math.random() < 0.56 ? "shield" : "slow",
        x: laneX(Math.floor(Math.random() * 6)),
        y: -35,
        radius: 14,
        rotation: 0,
    });
}

function burst(x, y, color, amount = 10) {
    const count = reducedMotion ? Math.min(4, amount) : amount;
    for (let index = 0; index < count; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = random(35, 150);
        world.particles.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: random(0.25, 0.65),
            maxLife: 0.65,
            color,
            size: random(1, 3),
        });
    }
}

function collides(entity) {
    const player = world.player;
    if (entity.kind === "gate") {
        const verticalHit =
            player.y + player.radius > entity.y &&
            player.y - player.radius < entity.y + entity.height;
        return (
            verticalHit &&
            (player.x - player.radius < entity.gapX - entity.gapWidth / 2 ||
                player.x + player.radius > entity.gapX + entity.gapWidth / 2)
        );
    }
    const dx = player.x - entity.x;
    const dy = player.y - entity.y;
    return Math.hypot(dx, dy) < player.radius + entity.radius;
}

function collect(entity) {
    if (entity.kind === "shard") {
        state.comboChain += 1;
        state.combo = Math.min(8, 1 + Math.floor(state.comboChain / 3));
        state.bestCombo = Math.max(state.bestCombo, state.combo);
        state.comboLife = 3.2;
        state.score += 75 * state.combo;
        burst(entity.x, entity.y, "#38f6ff", 12);
        sound("shard");
        if (state.combo > 1) announce(`Sync multiplier ${state.combo}`);
        return;
    }
    if (entity.kind === "shield") {
        state.shields = Math.min(2, state.shields + 1);
        burst(entity.x, entity.y, "#baff68", 16);
        sound("pickup");
        announce("Shield acquired");
        return;
    }
    if (entity.kind === "slow") {
        state.slowMotion = 5;
        burst(entity.x, entity.y, "#ff3bd4", 16);
        sound("pickup");
        announce("Time coil engaged");
    }
}

function hitHazard(entity) {
    if (state.shields > 0) {
        state.shields -= 1;
        state.combo = 1;
        state.comboChain = 0;
        state.comboLife = 0;
        burst(world.player.x, world.player.y, "#baff68", 22);
        sound("shield");
        announce("Shield absorbed impact");
        entity.dead = true;
        return;
    }
    gameOver();
}

function update(dt) {
    if (state.phase !== "playing") return;
    const tuning = DIFFICULTY[state.difficulty];
    state.elapsed += dt;
    state.slowMotion = Math.max(0, state.slowMotion - dt);
    state.speedFactor = 1 + Math.min(1.85, (state.elapsed * tuning.acceleration) / 100);
    const timeScale = state.slowMotion > 0 ? 0.58 : 1;
    const travelSpeed = tuning.baseSpeed * state.speedFactor * timeScale;

    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (steer !== 0) {
        world.player.targetX += steer * 440 * dt;
    }
    const margin = Math.max(28, world.width * 0.08);
    world.player.targetX = clamp(world.player.targetX, margin, world.width - margin);
    const before = world.player.x;
    world.player.x += (world.player.targetX - world.player.x) * Math.min(1, dt * 11);
    world.player.tilt +=
        (clamp((world.player.x - before) * 0.07, -0.5, 0.5) - world.player.tilt) *
        Math.min(1, dt * 10);

    world.hazardClock -= dt;
    world.shardClock -= dt;
    world.pickupClock -= dt;
    if (world.hazardClock <= 0) {
        spawnHazard();
        world.hazardClock = tuning.hazardRate / Math.pow(state.speedFactor, 0.65);
    }
    if (world.shardClock <= 0) {
        spawnShardChain();
        world.shardClock = random(1.05, 1.55);
    }
    if (world.pickupClock <= 0) {
        spawnPickup();
        world.pickupClock = random(13, 19);
    }

    if (state.comboLife > 0) {
        state.comboLife -= dt;
        if (state.comboLife <= 0) {
            state.combo = 1;
            state.comboChain = 0;
        }
    }

    state.score += dt * 20 * state.speedFactor * state.combo;
    for (const star of world.stars) {
        star.y += travelSpeed * star.depth * dt * 0.35;
        if (star.y > world.height) {
            star.y = 0;
            star.x = Math.random() * world.width;
        }
    }

    for (const entity of world.entities) {
        entity.y += travelSpeed * dt;
        entity.rotation = (entity.rotation ?? 0) + dt * 2.4;
        if (!entity.dead && collides(entity)) {
            if (entity.kind === "hazard" || entity.kind === "gate") {
                hitHazard(entity);
            } else {
                collect(entity);
                entity.dead = true;
            }
        }
        if (
            entity.kind === "shard" &&
            entity.y > world.player.y + 90 &&
            !entity.dead &&
            state.combo > 1
        ) {
            state.comboLife = Math.min(state.comboLife, 0.5);
        }
    }
    world.entities = world.entities.filter(
        (entity) => !entity.dead && entity.y < world.height + 80,
    );

    for (const particle of world.particles) {
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= 0.98;
        particle.vy *= 0.98;
        particle.life -= dt;
    }
    world.particles = world.particles.filter((particle) => particle.life > 0);

    stateSyncTimer += dt;
    if (stateSyncTimer >= 0.6) {
        stateSyncTimer = 0;
        syncState();
    }
    updateHud();
}

function tunnelBounds(y) {
    const depth = y / world.height;
    const center = world.width / 2;
    const half = world.width * (0.18 + depth * 0.34);
    return [center - half, center + half];
}

function drawBackground() {
    const gradient = context.createLinearGradient(0, 0, 0, world.height);
    gradient.addColorStop(0, "#030609");
    gradient.addColorStop(0.7, "#061119");
    gradient.addColorStop(1, "#071921");
    context.fillStyle = gradient;
    context.fillRect(0, 0, world.width, world.height);

    context.save();
    context.strokeStyle = "rgba(56, 246, 255, 0.09)";
    context.lineWidth = 1;
    const horizon = world.height * 0.09;
    for (let index = 0; index < 13; index += 1) {
        const progress = ((index / 12 + world.time * 0.12) % 1) ** 2;
        const y = horizon + progress * (world.height - horizon);
        const [left, right] = tunnelBounds(y);
        context.beginPath();
        context.moveTo(left, y);
        context.lineTo(right, y);
        context.stroke();
    }
    for (let lane = 0; lane <= 6; lane += 1) {
        const ratio = lane / 6;
        context.beginPath();
        context.moveTo(world.width / 2, horizon);
        const [left, right] = tunnelBounds(world.height);
        context.lineTo(left + (right - left) * ratio, world.height);
        context.stroke();
    }
    context.restore();

    for (const star of world.stars) {
        context.fillStyle = `rgba(133, 229, 255, ${0.18 + star.depth * 0.55})`;
        context.fillRect(star.x, star.y, star.size, star.size * (1 + star.depth * 2));
    }

    context.save();
    context.strokeStyle = "rgba(56, 246, 255, 0.32)";
    context.shadowBlur = 14;
    context.shadowColor = "#38f6ff";
    context.beginPath();
    for (let y = world.height * 0.08; y <= world.height; y += 18) {
        const [left, right] = tunnelBounds(y);
        context.moveTo(left, y);
        context.lineTo(left, y + 12);
        context.moveTo(right, y);
        context.lineTo(right, y + 12);
    }
    context.stroke();
    context.restore();
}

function drawHazard(entity) {
    context.save();
    context.strokeStyle = "#ff476f";
    context.fillStyle = "rgba(255, 71, 111, 0.14)";
    context.shadowBlur = 18;
    context.shadowColor = "#ff476f";
    context.lineWidth = 2;
    if (entity.kind === "gate") {
        const leftWidth = entity.gapX - entity.gapWidth / 2;
        const rightStart = entity.gapX + entity.gapWidth / 2;
        context.fillRect(0, entity.y, leftWidth, entity.height);
        context.fillRect(rightStart, entity.y, world.width - rightStart, entity.height);
        context.strokeRect(0, entity.y, leftWidth, entity.height);
        context.strokeRect(rightStart, entity.y, world.width - rightStart, entity.height);
    } else {
        context.translate(entity.x, entity.y);
        context.rotate(entity.rotation);
        context.beginPath();
        for (let index = 0; index < 8; index += 1) {
            const angle = (index / 8) * Math.PI * 2;
            const radius = index % 2 ? entity.radius * 0.62 : entity.radius;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        }
        context.closePath();
        context.fill();
        context.stroke();
        context.beginPath();
        context.arc(0, 0, 4, 0, Math.PI * 2);
        context.fillStyle = "#ff8ba5";
        context.fill();
    }
    context.restore();
}

function drawCollectible(entity) {
    const colors = {
        shard: "#38f6ff",
        shield: "#baff68",
        slow: "#ff3bd4",
    };
    const color = colors[entity.kind];
    context.save();
    context.translate(entity.x, entity.y);
    context.rotate(entity.rotation);
    context.strokeStyle = color;
    context.fillStyle = `${color}22`;
    context.shadowBlur = 18;
    context.shadowColor = color;
    context.lineWidth = 2;
    if (entity.kind === "shard") {
        context.beginPath();
        context.moveTo(0, -entity.radius * 1.35);
        context.lineTo(entity.radius * 0.75, 0);
        context.lineTo(0, entity.radius * 1.35);
        context.lineTo(-entity.radius * 0.75, 0);
        context.closePath();
    } else {
        context.beginPath();
        context.arc(0, 0, entity.radius, 0, Math.PI * 2);
        context.moveTo(-entity.radius * 0.5, 0);
        context.lineTo(entity.radius * 0.5, 0);
        if (entity.kind === "shield") {
            context.moveTo(0, -entity.radius * 0.5);
            context.lineTo(0, entity.radius * 0.5);
        }
    }
    context.fill();
    context.stroke();
    context.restore();
}

function drawPlayer() {
    const player = world.player;
    context.save();
    context.translate(player.x, player.y);
    context.rotate(player.tilt);
    if (state.shields > 0) {
        context.strokeStyle = "rgba(186, 255, 104, 0.72)";
        context.lineWidth = 2;
        context.shadowBlur = 16;
        context.shadowColor = "#baff68";
        context.beginPath();
        context.arc(0, 0, player.radius + 10, 0, Math.PI * 2);
        context.stroke();
    }
    context.shadowBlur = 24;
    context.shadowColor = "#38f6ff";
    context.fillStyle = "#dffcff";
    context.beginPath();
    context.moveTo(0, -19);
    context.lineTo(12, 13);
    context.lineTo(0, 8);
    context.lineTo(-12, 13);
    context.closePath();
    context.fill();
    context.fillStyle = "#38f6ff";
    context.fillRect(-3, 8, 6, 14 + Math.random() * 9);
    context.restore();
}

function drawParticles() {
    for (const particle of world.particles) {
        context.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
        context.fillStyle = particle.color;
        context.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
    context.globalAlpha = 1;
}

function draw() {
    drawBackground();
    for (const entity of world.entities) {
        if (entity.kind === "hazard" || entity.kind === "gate") drawHazard(entity);
        else drawCollectible(entity);
    }
    drawParticles();
    drawPlayer();

    if (state.slowMotion > 0) {
        context.fillStyle = "rgba(255, 59, 212, 0.025)";
        context.fillRect(0, 0, world.width, world.height);
    }
}

function frame(now) {
    const dt = Math.min(0.033, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (state.phase !== "paused") world.time += dt;
    update(dt);
    draw();
    requestAnimationFrame(frame);
}

function syncState(immediate = false) {
    const payload = {
        phase: state.phase,
        score: Math.floor(state.score),
        combo: state.combo,
        speed: Number(state.speedFactor.toFixed(2)),
        shields: state.shields,
        slowMotion: state.slowMotion > 0,
        paused: state.phase === "paused",
        soundEnabled: state.soundEnabled,
        runStarted: state.runStartedPending,
    };
    state.runStartedPending = false;
    const send = () =>
        fetch("/api/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            keepalive: true,
        })
            .then((response) => {
                if (!response.ok) throw new Error("Unable to save game state.");
                return response.json();
            })
            .then((serverState) => {
                clearConnectionError();
                if (serverState?.highScore > state.highScore) {
                    state.highScore = serverState.highScore;
                    updateHud();
                }
            })
            .catch(reportConnectionError);
    if (immediate) send();
    else queueMicrotask(send);
}

function pointerTarget(event) {
    const rect = canvas.getBoundingClientRect();
    world.player.targetX = clamp(event.clientX - rect.left, 22, rect.width - 22);
}

function bindHoldButton(selector, key) {
    const button = document.querySelector(selector);
    const stop = (event) => {
        event.preventDefault();
        input[key] = false;
    };
    button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        input[key] = true;
    });
    button.addEventListener("pointerup", stop);
    button.addEventListener("pointercancel", stop);
}

document.querySelector("#startButton").addEventListener("click", resetRun);
document.querySelector("#retryButton").addEventListener("click", resetRun);
document.querySelector("#restartButton").addEventListener("click", resetRun);
document.querySelector("#resumeButton").addEventListener("click", () => pauseGame(false));
elements.pauseButton.addEventListener("click", () => pauseGame());
elements.soundButton.addEventListener("click", () => {
    state.soundEnabled = !state.soundEnabled;
    updateHud();
    fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soundEnabled: state.soundEnabled }),
    })
        .then((response) => {
            if (!response.ok) throw new Error("Unable to save sound setting.");
            clearConnectionError();
        })
        .catch(reportConnectionError);
    if (state.soundEnabled) sound("shard");
});
document.querySelectorAll('input[name="difficulty"]').forEach((radio) => {
    radio.addEventListener("change", () => setDifficulty(radio.value));
});

canvas.addEventListener("pointerdown", (event) => {
    input.pointerActive = true;
    canvas.setPointerCapture(event.pointerId);
    pointerTarget(event);
});
canvas.addEventListener("pointermove", (event) => {
    if (input.pointerActive || event.pointerType === "mouse") pointerTarget(event);
});
canvas.addEventListener("pointerup", () => {
    input.pointerActive = false;
});
canvas.addEventListener("pointercancel", () => {
    input.pointerActive = false;
});

bindHoldButton("#touchLeft", "left");
bindHoldButton("#touchRight", "right");

addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", " ", "a", "A", "d", "D"].includes(event.key)) {
        event.preventDefault();
    }
    if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") input.left = true;
    if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") input.right = true;
    if (event.key.toLowerCase() === "p" || event.key === " ") {
        if (state.phase === "ready" || state.phase === "gameover") resetRun();
        else pauseGame();
    }
    if (event.key.toLowerCase() === "r") resetRun();
    if (event.key.toLowerCase() === "m") elements.soundButton.click();
});
addEventListener("keyup", (event) => {
    if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") input.left = false;
    if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") input.right = false;
});
document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.phase === "playing") pauseGame(true);
});
addEventListener("resize", resize);
addEventListener("pagehide", () => syncState(true));

const eventSource = new EventSource("/events");
eventSource.addEventListener("connected", clearConnectionError);
eventSource.addEventListener("error", reportConnectionError);
eventSource.addEventListener("command", (event) => {
    const command = JSON.parse(event.data);
    if (command.name === "restart") resetRun();
    if (command.name === "set-difficulty") {
        setDifficulty(command.difficulty, false);
        resetRun();
    }
});

fetch("/api/bootstrap")
    .then((response) => {
        if (!response.ok) throw new Error("Unable to load player profile.");
        return response.json();
    })
    .then(({ profile }) => {
        clearConnectionError();
        state.highScore = profile.highScore;
        state.soundEnabled = profile.soundEnabled;
        setDifficulty(profile.difficulty, false);
        resize();
        updateHud();
        requestAnimationFrame(frame);
    })
    .catch(() => {
        reportConnectionError();
        resize();
        updateHud();
        requestAnimationFrame(frame);
    });
