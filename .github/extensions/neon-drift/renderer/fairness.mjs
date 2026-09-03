export const PLAYER_RADIUS = 14;
export const PLAYER_LATERAL_SPEED = 440;

const SPEED_RESERVE = 1.18;
const EDGE_MARGIN_RATIO = 0.08;
const MIN_EDGE_MARGIN = 28;
const HAZARD_CLEARANCE = 9;
const ROW_CLEARANCE = 12;

export const FAIRNESS_TUNING = Object.freeze({
    relaxed: {
        reactionTime: 0.62,
        transitionTime: 0.46,
        gateChance: 0.32,
        maxBlockers: 1,
    },
    standard: {
        reactionTime: 0.54,
        transitionTime: 0.38,
        gateChance: 0.38,
        maxBlockers: 2,
    },
    overdrive: {
        reactionTime: 0.48,
        transitionTime: 0.32,
        gateChance: 0.44,
        maxBlockers: 2,
    },
});

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function lanePosition(width, lane) {
    const tunnelWidth = Math.min(width * 0.76, 720);
    const left = (width - tunnelWidth) / 2;
    return left + tunnelWidth * ((lane + 0.5) / 6);
}

function choose(items, rng) {
    return items[Math.floor(rng() * items.length)];
}

export function createSeededRandom(seed) {
    let value = seed >>> 0;
    return () => {
        value += 0x6d2b79f5;
        let result = value;
        result = Math.imul(result ^ (result >>> 15), result | 1);
        result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
        return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
    };
}

export function createHazardPlanner({
    width,
    difficulty,
    playerRadius = PLAYER_RADIUS,
    lateralSpeed = PLAYER_LATERAL_SPEED,
    initialSafeCenter = width / 2,
    rng = Math.random,
}) {
    const tuning = FAIRNESS_TUNING[difficulty];
    if (!tuning) {
        throw new Error(`Unsupported difficulty: ${difficulty}`);
    }

    const edgeMargin = Math.max(MIN_EDGE_MARGIN, width * EDGE_MARGIN_RATIO);
    const safeHalfWidth = playerRadius + HAZARD_CLEARANCE + 14;
    const minimumCenter = edgeMargin + safeHalfWidth;
    const maximumCenter = width - minimumCenter;
    let waveId = 0;
    let previous = {
        safeCenter: clamp(initialSafeCenter, minimumCenter, maximumCenter),
        verticalSpan: 0,
    };

    function next({ travelSpeed, elapsed }) {
        const maxShift = lateralSpeed * tuning.transitionTime;
        const desiredShift = (rng() * 2 - 1) * maxShift;
        const safeCenter = clamp(
            previous.safeCenter + desiredShift,
            minimumCenter,
            maximumCenter,
        );
        const requiredTravelTime =
            Math.abs(safeCenter - previous.safeCenter) / lateralSpeed;
        const gate = elapsed >= 10 && rng() < tuning.gateChance;
        const gapWidth = safeHalfWidth * 2;
        const entities = [];
        let verticalSpan;

        waveId += 1;
        if (gate) {
            verticalSpan = 22;
            entities.push({
                kind: "gate",
                x: 0,
                y: -40,
                gapX: safeCenter,
                gapWidth,
                height: verticalSpan,
                fairWaveId: waveId,
            });
        } else {
            const radius = 22;
            verticalSpan = radius * 2;
            const validLanes = Array.from({ length: 6 }, (_, lane) =>
                lanePosition(width, lane),
            ).filter(
                (x) =>
                    Math.abs(x - safeCenter) >=
                    safeHalfWidth + playerRadius + radius + HAZARD_CLEARANCE,
            );
            const blockers = Math.min(
                tuning.maxBlockers,
                validLanes.length,
                elapsed >= 24 && rng() < 0.42 ? 2 : 1,
            );
            for (let index = 0; index < blockers; index += 1) {
                const x = choose(validLanes, rng);
                validLanes.splice(validLanes.indexOf(x), 1);
                entities.push({
                    kind: "hazard",
                    x,
                    y: -35,
                    radius,
                    rotation: rng() * Math.PI,
                    fairWaveId: waveId,
                });
            }
        }

        const designSpeed = travelSpeed * SPEED_RESERVE;
        const spacing =
            previous.verticalSpan +
            playerRadius * 2 +
            ROW_CLEARANCE +
            designSpeed * (tuning.reactionTime + requiredTravelTime);
        const wave = {
            id: waveId,
            difficulty,
            safeCenter,
            safeHalfWidth,
            previousSafeCenter: previous.safeCenter,
            previousVerticalSpan: previous.verticalSpan,
            verticalSpan,
            reactionTime: tuning.reactionTime,
            travelSpeed,
            designSpeed,
            spacing,
            entities,
        };
        previous = { safeCenter, verticalSpan };
        return wave;
    }

    return {
        next,
        reset() {
            waveId = 0;
            previous = {
                safeCenter: clamp(initialSafeCenter, minimumCenter, maximumCenter),
                verticalSpan: 0,
            };
        },
    };
}

export function createHazardScheduler(options) {
    const planner = createHazardPlanner(options);
    let pendingWave = null;
    let remainingDistance = 0;

    function queue(planningSpeed, elapsed, minimumDistance = 0) {
        pendingWave = planner.next({ travelSpeed: planningSpeed, elapsed });
        remainingDistance = Math.max(pendingWave.spacing, minimumDistance);
    }

    return {
        reset({ planningSpeed, elapsed = 0, minimumDistance = 0 }) {
            planner.reset();
            queue(planningSpeed, elapsed, minimumDistance);
        },
        advance({ distance, planningSpeed, elapsed }) {
            remainingDistance -= distance;
            if (remainingDistance > 0 || !pendingWave) {
                return [];
            }
            const spawned = pendingWave;
            queue(planningSpeed, elapsed);
            return [spawned];
        },
        getRemainingDistance() {
            return remainingDistance;
        },
    };
}

export function validateFairWave(
    wave,
    {
        width,
        playerRadius = PLAYER_RADIUS,
        lateralSpeed = PLAYER_LATERAL_SPEED,
    },
) {
    const errors = [];
    const edgeMargin = Math.max(MIN_EDGE_MARGIN, width * EDGE_MARGIN_RATIO);
    const safeLeft = wave.safeCenter - wave.safeHalfWidth;
    const safeRight = wave.safeCenter + wave.safeHalfWidth;
    const availableTime =
        (wave.spacing -
            wave.previousVerticalSpan -
            playerRadius * 2 -
            ROW_CLEARANCE) /
        wave.designSpeed;
    const requiredTravelTime =
        Math.abs(wave.safeCenter - wave.previousSafeCenter) / lateralSpeed;

    if (safeLeft < edgeMargin || safeRight > width - edgeMargin) {
        errors.push("safe corridor exceeds playable bounds");
    }
    if (wave.safeHalfWidth < playerRadius + HAZARD_CLEARANCE) {
        errors.push("safe corridor is narrower than the player hitbox clearance");
    }
    if (availableTime + 1e-9 < wave.reactionTime + requiredTravelTime) {
        errors.push("safe corridor moves farther than the player can reach");
    }
    if (
        wave.spacing <=
        wave.previousVerticalSpan + playerRadius * 2 + ROW_CLEARANCE
    ) {
        errors.push("adjacent obstacle rows overlap the required recovery zone");
    }

    for (const entity of wave.entities) {
        if (entity.kind === "gate") {
            if (entity.gapWidth / 2 + 1e-9 < wave.safeHalfWidth) {
                errors.push("gate is narrower than its declared safe corridor");
            }
            continue;
        }
        const clearance =
            Math.abs(entity.x - wave.safeCenter) -
            entity.radius -
            playerRadius;
        if (clearance + 1e-9 < HAZARD_CLEARANCE) {
            errors.push("point hazard intrudes into the safe corridor");
        }
    }

    return errors;
}
