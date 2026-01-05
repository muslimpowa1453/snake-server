/* ========================================== */
/* SERVER.JS (Authoritative Multiplayer + Bots) */
/* ========================================== */
const WebSocket = require("ws");

// Render uses process.env.PORT
const port = process.env.PORT || 10000;
const wss = new WebSocket.Server({ port });

console.log(`Snake Server Started on port ${port}`);

/* ===================== TUNING (Wormate-like) ===================== */
const MAP_RADIUS = 6000;

// Geometry / collision sampling
const SEGMENT_SPACING = 5;

// Thickness "under" rule (inner safe zone)
const UNDER_RATIO = 0.60;          // 60% width safe/under
const COLLISION_OVER_RATIO = 1.00; // outer ring lethal

// Headshot tuning (neck only)
const HS_NECK_MULT = 2.2;          // neck length = victimRadius * this
const HS_HIT_MULT = 0.60;          // HS radius = (victimR + attackerR) * this

// Tick rates
const STATE_MS = 50;  // 20Hz broadcast
const COMBAT_MS = 50; // 20Hz combat
const BOT_MS = 50;    // 20Hz bot move

// Path bandwidth
const PATH_DECIMATE_STEP = 6;
const PATH_MAX = 900;

// Respawn (Choice B)
const RESPAWN_RADIUS = MAP_RADIUS * 0.75;
const RESPAWN_MIN_SEP = 1200;

// Bots (server-authoritative)
const BOT_COUNT = 80;                 // Wormate feel, but keep server CPU ok
const BOT_BASE_SPEED = 2.0;
const BOT_TURN_RATE = 0.05;
const BOT_TARGET_CHANGE_CHANCE = 0.05;

/* ===================== STATE ===================== */
/**
 * players[id] = {
 *   ws, id, type:"player",
 *   x,y,angle,length,color,name,path, alive,
 *   killCount, hsCount
 * }
 *
 * bots[id] = {
 *   id, type:"bot",
 *   x,y,angle,length,color,name,path, alive,
 *   killCount, hsCount, targetAngle
 * }
 */
const players = {};
const bots = {};

/* ===================== HELPERS ===================== */
function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function getWormRadius(len) {
  const minR = 11;
  const maxR = 20;
  const t = Math.min(1, Math.max(0, (len - 40) / 260));
  return minR + (maxR - minR) * (1 - Math.pow(1 - t, 2));
}

function decimatePath(path, step = PATH_DECIMATE_STEP, max = PATH_MAX) {
  if (!Array.isArray(path)) return [];
  const out = [];
  for (let i = 0; i < path.length; i += step) {
    const p = path[i];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out.push({ x: p.x, y: p.y });
  }
  if (out.length > max) out.splice(0, out.length - max);
  return out;
}

// Returns points ordered from head backwards (head-first)
function getCollisionPath(path, headX, headY, maxLen) {
  const smooth = (path || []).concat([{ x: headX, y: headY }]);
  const points = [];
  let dist = 0;
  let target = SEGMENT_SPACING;

  for (let i = smooth.length - 1; i > 0; i--) {
    const a = smooth[i];
    const b = smooth[i - 1];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d <= 0.00001) continue;

    while (dist + d >= target) {
      const t = (target - dist) / d;
      points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      target += SEGMENT_SPACING;
      if (points.length >= maxLen) return points;
    }
    dist += d;
  }
  return points;
}

function getNeckByDistance(collPathHeadFirst, maxDist) {
  const neck = [];
  let dist = 0;

  for (let i = 0; i < collPathHeadFirst.length; i++) {
    if (i > 0) {
      dist += Math.hypot(
        collPathHeadFirst[i].x - collPathHeadFirst[i - 1].x,
        collPathHeadFirst[i].y - collPathHeadFirst[i - 1].y
      );
    }
    if (dist > maxDist) break;
    neck.push(collPathHeadFirst[i]);
  }
  return neck;
}

function checkRingHit(attackerHead, attackerLen, victimCollPath, victimLen) {
  const victimR = getWormRadius(victimLen);
  const underR = victimR * UNDER_RATIO;

  const attackerR = getWormRadius(attackerLen);
  const overR = victimR * COLLISION_OVER_RATIO + attackerR * 0.05;

  const underR2 = underR * underR;
  const overR2 = overR * overR;

  const skipTail = Math.min(6, Math.floor(victimCollPath.length * 0.2));

  for (let k = 0; k < victimCollPath.length - skipTail; k += 3) {
    const p = victimCollPath[k];
    const dx = attackerHead.x - p.x;
    const dy = attackerHead.y - p.y;
    const d2 = dx * dx + dy * dy;

    if (d2 < underR2) continue;   // safe under
    if (d2 < overR2) return true; // hit ring => dead
  }
  return false;
}

function checkHeadshot(attacker, victim, victimCollPath) {
  const victimR = getWormRadius(victim.length);
  const attackerR = getWormRadius(attacker.length);

  const neckDist = victimR * HS_NECK_MULT;
  const neck = getNeckByDistance(victimCollPath, neckDist);

  const hsR = (victimR + attackerR) * HS_HIT_MULT;
  const hsR2 = hsR * hsR;

  for (let k = 0; k < neck.length; k += 2) {
    const p = neck[k];
    const dx = attacker.x - p.x;
    const dy = attacker.y - p.y;
    if (dx * dx + dy * dy < hsR2) return true;
  }
  return false;
}

function randomSpawnSafe(excludeId = null) {
  for (let attempts = 0; attempts < 40; attempts++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * RESPAWN_RADIUS;
    const x = Math.cos(ang) * dist;
    const y = Math.sin(ang) * dist;

    let ok = true;

    for (const id in players) {
      if (id === excludeId) continue;
      const p = players[id];
      if (!p || !p.alive) continue;
      if (Math.hypot(x - p.x, y - p.y) < RESPAWN_MIN_SEP) { ok = false; break; }
    }
    if (!ok) continue;

    for (const id in bots) {
      const b = bots[id];
      if (!b || !b.alive) continue;
      if (Math.hypot(x - b.x, y - b.y) < RESPAWN_MIN_SEP) { ok = false; break; }
    }

    if (ok) return { x, y };
  }
  return { x: (Math.random() - 0.5) * RESPAWN_RADIUS, y: (Math.random() - 0.5) * RESPAWN_RADIUS };
}

/* ===================== BOTS ===================== */
function createBots() {
  for (let i = 0; i < BOT_COUNT; i++) {
    const id = `bot_${String(i + 1).padStart(3, "0")}`;
    const spawn = randomSpawnSafe();
    const length = 250 + Math.random() * 550; // Wormate-ish big worms

    bots[id] = {
      id,
      type: "bot",
      name: `Bot_${String(i + 1).padStart(3, "0")}`,
      x: spawn.x,
      y: spawn.y,
      angle: Math.random() * Math.PI * 2,
      targetAngle: Math.random() * Math.PI * 2,
      length,
      color: `hsl(${Math.random() * 360}, 100%, 50%)`,
      path: [],
      alive: true,
      killCount: 0,
      hsCount: 0
    };

    // initial path
    for (let k = 0; k < length * SEGMENT_SPACING; k += SEGMENT_SPACING) {
      bots[id].path.push({ x: bots[id].x, y: bots[id].y });
    }
  }
}

function resetBot(bot) {
  const spawn = randomSpawnSafe();
  bot.x = spawn.x;
  bot.y = spawn.y;
  bot.angle = Math.random() * Math.PI * 2;
  bot.targetAngle = Math.random() * Math.PI * 2;
  bot.length = 250 + Math.random() * 550;
  bot.color = `hsl(${Math.random() * 360}, 100%, 50%)`;
  bot.path = [];
  bot.alive = true;
  for (let k = 0; k < bot.length * SEGMENT_SPACING; k += SEGMENT_SPACING) {
    bot.path.push({ x: bot.x, y: bot.y });
  }
}

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff < -Math.PI) diff += Math.PI * 2;
  while (diff > Math.PI) diff -= Math.PI * 2;
  return a + diff * t;
}

// Move bots (server authoritative)
setInterval(() => {
  for (const id in bots) {
    const bot = bots[id];
    if (!bot.alive) continue;

    // random turn
    if (Math.random() < BOT_TARGET_CHANGE_CHANCE) {
      bot.targetAngle = Math.random() * Math.PI * 2;
    }

    // stay inside map
    if (Math.hypot(bot.x, bot.y) > MAP_RADIUS - 250) {
      bot.targetAngle = Math.atan2(-bot.y, -bot.x);
    }

    bot.angle = lerpAngle(bot.angle, bot.targetAngle, BOT_TURN_RATE);

    bot.x += Math.cos(bot.angle) * BOT_BASE_SPEED;
    bot.y += Math.sin(bot.angle) * BOT_BASE_SPEED;

    const last = bot.path[bot.path.length - 1];
    if (!last || Math.hypot(bot.x - last.x, bot.y - last.y) >= 2) {
      bot.path.push({ x: bot.x, y: bot.y });
    }

    const maxPath = bot.length * SEGMENT_SPACING + 150;
    if (bot.path.length > maxPath) bot.path.splice(0, bot.path.length - maxPath);
  }
}, BOT_MS);

/* ===================== CONNECTIONS ===================== */
createBots();

wss.on("connection", (ws) => {
  const id = Math.random().toString(36).substring(2, 9);
  const color = `hsl(${Math.random() * 360}, 100%, 50%)`;

  const spawn = randomSpawnSafe(id);

  players[id] = {
    ws,
    id,
    type: "player",
    x: spawn.x,
    y: spawn.y,
    angle: Math.random() * Math.PI * 2,
    length: 50,
    color,
    name: "Guest",
    path: [],
    alive: true,
    killCount: 0,
    hsCount: 0
  };

  for (let k = 0; k < players[id].length * SEGMENT_SPACING; k += SEGMENT_SPACING) {
    players[id].path.push({ x: players[id].x, y: players[id].y });
  }

  send(ws, {
    type: "init",
    selfId: id,
    rules: { mapRadius: MAP_RADIUS, underRatio: UNDER_RATIO, hsNeckMult: HS_NECK_MULT, hsHitMult: HS_HIT_MULT }
  });

  ws.on("message", (message) => {
    let data;
    try { data = JSON.parse(message); } catch { return; }
    const p = players[id];
    if (!p) return;

    if (data.type === "move") {
      if (!p.alive) return;

      if (!Number.isFinite(data.x) || !Number.isFinite(data.y) || !Number.isFinite(data.angle)) return;
      if (!Number.isFinite(data.length)) return;

      p.x = data.x;
      p.y = data.y;
      p.angle = data.angle;
      p.length = clamp(data.length, 10, 3000);
      p.name = (data.name || "Guest").toString().slice(0, 12);

      // compress path server-side
      p.path = decimatePath(data.path);

      // server border kill
      if (Math.hypot(p.x, p.y) > MAP_RADIUS) {
        p.alive = false;
        broadcast({ type: "death", id, killerId: "", reason: "border" });
      }
    }

    if (data.type === "respawn") {
      const spawn = randomSpawnSafe(id);
      p.alive = true;
      p.x = spawn.x;
      p.y = spawn.y;
      p.angle = Math.random() * Math.PI * 2;
      p.length = 50;
      p.path = [];
      for (let k = 0; k < p.length * SEGMENT_SPACING; k += SEGMENT_SPACING) {
        p.path.push({ x: p.x, y: p.y });
      }
      send(ws, { type: "respawn", x: p.x, y: p.y, angle: p.angle, length: p.length });
    }
  });

  ws.on("close", () => {
    delete players[id];
    broadcast({ type: "remove", id });
  });
});

/* ===================== AUTHORITATIVE COMBAT ===================== */
setInterval(() => {
  // Build list of alive entities (players + bots)
  const entities = [];
  for (const id in players) if (players[id].alive) entities.push(players[id]);
  for (const id in bots) if (bots[id].alive) entities.push(bots[id]);

  // Cache collision paths for this tick
  const coll = {};
  for (const e of entities) {
    coll[e.id] = getCollisionPath(e.path, e.x, e.y, Math.max(10, e.length - 3));
  }

  // Pairwise checks
  for (let i = 0; i < entities.length; i++) {
    const a = entities[i];
    if (!a.alive) continue;

    for (let j = 0; j < entities.length; j++) {
      if (i === j) continue;
      const b = entities[j];
      if (!b.alive) continue;

      // Headshot priority
      if (checkHeadshot(a, b, coll[b.id])) {
        b.alive = false;

        // score attacker (only for players and bots, stored server-side)
        a.hsCount += 1;
        a.killCount += 1;

        broadcast({ type: "death", id: b.id, killerId: a.id, reason: "hs" });

        // if bot died, respawn it quickly (wormate always has worms)
        if (b.type === "bot") {
          resetBot(b);
        }
        continue;
      }

      // Body ring kill
      if (checkRingHit({ x: a.x, y: a.y }, a.length, coll[b.id], b.length)) {
        a.alive = false;

        b.killCount += 1;
        broadcast({ type: "death", id: a.id, killerId: b.id, reason: "body" });

        // if bot died, respawn
        if (a.type === "bot") {
          resetBot(a);
        }
        break;
      }
    }
  }
}, COMBAT_MS);

/* ===================== STATE BROADCAST ===================== */
setInterval(() => {
  const pack = [];

  // players
  for (const id in players) {
    const p = players[id];
    pack.push({
      id: p.id,
      type: p.type,
      x: p.x, y: p.y,
      angle: p.angle,
      path: p.path,
      color: p.color,
      name: p.name,
      length: p.length,
      alive: p.alive,
      killCount: p.killCount,
      hsCount: p.hsCount
    });
  }

  // bots
  for (const id in bots) {
    const b = bots[id];
    pack.push({
      id: b.id,
      type: b.type,
      x: b.x, y: b.y,
      angle: b.angle,
      path: b.path,
      color: b.color,
      name: b.name,
      length: b.length,
      alive: b.alive,
      killCount: b.killCount,
      hsCount: b.hsCount
    });
  }

  broadcast({ type: "state", players: pack });
}, STATE_MS);
