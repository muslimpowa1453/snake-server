/* ========================================== */
/* SERVER.JS (AUTHORITATIVE)                  */
/* ========================================== */
const WebSocket = require('ws');

const PORT = process.env.PORT || 10000;
const wss = new WebSocket.Server({ port: PORT });

console.log(`Wormate Server Started on port ${PORT}`);

// --- CONFIGURATION (Must match client) ---
const MAP_RADIUS = 6000;
const SEGMENT_SPACING = 5;
const PATH_SPACING = 5; // Lower = smoother path
const BASE_SPEED = 3.0; 
const BOOST_SPEED = 6.0;
const TURN_SPEED = 0.08;
const TURN_SPEED_BOOST = 0.06;
const BOT_COUNT = 20;
const TICK_RATE = 30; // Server updates per second (30ms)
const TIMEOUT_MS = 10000; // Kick if no input for 10s

// --- GAME STATE ---
let players = {};
let bots = [];
let foods = [];
let powerups = [];
let idCounter = 0;

// --- UTILS ---
const getDistance = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const randomRange = (min, max) => Math.random() * (max - min) + min;
const generateId = () => (++idCounter).toString(36);

// --- ENTITY CLASSES ---

class Snake {
    constructor(id, x, y, isBot = false, name = "Bot") {
        this.id = id;
        this.x = x;
        this.y = y;
        this.angle = Math.random() * Math.PI * 2;
        this.targetAngle = this.angle;
        this.length = 50;
        this.width = 20; // Base width
        this.color = isBot ? `hsl(${Math.random() * 360}, 100%, 50%)` : null;
        this.name = name;
        this.path = [];
        // Fill initial path
        for(let i=0; i<this.length * SEGMENT_SPACING; i+=PATH_SPACING) {
            this.path.push({x: x, y: y});
        }
        
        this.speed = BASE_SPEED;
        this.boosting = false;
        this.isBot = isBot;
        this.dead = false;
        this.score = Math.floor(this.length * 10);
        
        // Powerups
        this.buffs = {
            x2: 0, x5: 0, x10: 0, ae: 0, spd: 0
        };
        this.kills = 0;
        this.hsCount = 0;

        // Input state
        this.mouseX = 0;
        this.mouseY = 0;
        
        // Connection health
        this.lastSeen = Date.now();
    }

    update(dt) {
        if (this.dead) return;

        const now = Date.now();
        
        // 1. Process Powerups
        let scoreMult = 1;
        let turnSpd = TURN_SPEED;
        let spd = BASE_SPEED;

        if (now < this.buffs.x2) scoreMult *= 2;
        if (now < this.buffs.x5) scoreMult *= 5;
        if (now < this.buffs.x10) scoreMult *= 10;
        if (now < this.buffs.spd) spd *= 1.5;
        if (now < this.buffs.ae) turnSpd = 0.15; // sharper turn

        // 2. Determine Target Angle (Mouse for player, AI for bots)
        if (this.isBot) {
            this.updateBotAI();
        } else {
            // Player input is relative to screen center, but server is absolute
            // We trust the client calculated the absolute angle or relative coords
            // For simplicity in this demo, Client sends absolute Angle or TargetXY
            // Let's assume client sends angle directly in input
        }

        // Smooth Turning
        let diff = this.targetAngle - this.angle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.angle += diff * turnSpd; // Instant turn for this simple logic, can clamp for smoother

        // 3. Movement
        if (this.boosting && this.length > 20) {
            spd = BOOST_SPEED;
            if (now < this.buffs.spd) spd *= 1.5;
            
            // Lose mass while boosting
            this.length -= 0.05;
            if (this.length < 10) this.length = 10;
            
            // Drop food occasionally (visual effect mostly)
            if (Math.random() < 0.2) {
                spawnFood(this.path[0].x, this.path[0].y, 4, this.color);
            }
        }

        this.x += Math.cos(this.angle) * spd;
        this.y += Math.sin(this.angle) * spd;

        // Update Path
        const last = this.path[this.path.length - 1];
        if (!last || getDistance(this.x, this.y, last.x, last.y) >= PATH_SPACING) {
            this.path.push({x: this.x, y: this.y});
        }

        // Trim Path
        const maxPath = (this.length * SEGMENT_SPACING) + 50;
        if (this.path.length > maxPath) {
            this.path.splice(0, this.path.length - maxPath);
        }

        // Map Boundary
        if (getDistance(this.x, this.y, 0, 0) > MAP_RADIUS) {
            this.die();
        }
    }

    updateBotAI() {
        // Simple AI
        if (Math.random() < 0.05) {
            this.targetAngle = Math.random() * Math.PI * 2;
        }
        
        // Avoid walls
        if (getDistance(this.x, this.y, 0, 0) > MAP_RADIUS * 0.8) {
            this.targetAngle = Math.atan2(-this.y, -this.x);
        }
        
        // Boost randomly
        this.boosting = (this.length > 100 && Math.random() < 0.01);
    }

    getRadius() {
        // Logarithmic growth similar to client
        const minR = 10; // Slightly smaller for server performance calc
        const maxR = 40;
        const base = Math.log10(Math.max(this.length, 50));
        const t = Math.min(1, Math.max(0, (base - 1.7) / 3.5));
        return minR + (maxR - minR) * t;
    }

    die() {
        this.dead = true;
        // Convert body to food
        const step = 3;
        for (let i = 0; i < this.path.length; i += step) {
            spawnFood(
                this.path[i].x + (Math.random()-0.5)*10, 
                this.path[i].y + (Math.random()-0.5)*10, 
                Math.min(10, this.length / 20), 
                this.color
            );
        }
    }
}

// --- GAME FUNCTIONS ---

function spawnFood(x, y, r, color) {
    if (foods.length > 3000) return; // Cap food
    
    if (x === undefined) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * MAP_RADIUS;
        x = Math.cos(angle) * dist;
        y = Math.sin(angle) * dist;
        r = 5 + Math.random() * 5;
        color = `hsl(${Math.random() * 360}, 100%, 50%)`;
    }

    foods.push({
        x: x, y: y, r: r, color: color,
        type: Math.floor(Math.random() * 3),
        angle: Math.random() * Math.PI * 2
    });
}

function spawnPowerup() {
    if (powerups.length > 50) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * MAP_RADIUS;
    const types = ['2x', '5x', '10x', 'ae', 'spd'];
    const type = types[Math.floor(Math.random() * types.length)];
    
    let color = '#fff';
    if(type === '2x') color = '#ff9900';
    if(type === '5x') color = '#ff3300';
    if(type === '10x') color = '#ff0066';
    if(type === 'ae') color = '#00ffcc';
    if(type === 'spd') color = '#aa00ff';

    powerups.push({ x: Math.cos(angle)*dist, y: Math.sin(angle)*dist, type: type, color: color, r: 15 });
}

function checkCollisions() {
    const allSnakes = [...Object.values(players), ...bots].filter(s => !s.dead);

    for (let i = 0; i < allSnakes.length; i++) {
        let s1 = allSnakes[i];
        let r1 = s1.getRadius();

        // 1. Food Collision
        for (let f = foods.length - 1; f >= 0; f--) {
            const food = foods[f];
            if (getDistance(s1.x, s1.y, food.x, food.y) < r1 + food.r + 5) {
                // Eat
                let growth = (food.r / 3);
                
                // Apply Multipliers
                const now = Date.now();
                let mult = 1;
                if(now < s1.buffs.x2) mult*=2;
                if(now < s1.buffs.x5) mult*=5;
                if(now < s1.buffs.x10) mult*=10;
                
                s1.length += growth * mult;
                foods.splice(f, 1);
                spawnFood(); // Respawn somewhere else
            }
        }

        // 2. Powerup Collision
        for (let p = powerups.length - 1; p >= 0; p--) {
            const pup = powerups[p];
            if (getDistance(s1.x, s1.y, pup.x, pup.y) < r1 + pup.r + 5) {
                // Apply Powerup
                const now = Date.now();
                const duration = 30000; // 30s
                if(pup.type === '2x') s1.buffs.x2 = now + duration;
                if(pup.type === '5x') s1.buffs.x5 = now + duration;
                if(pup.type === '10x') s1.buffs.x10 = now + duration;
                if(pup.type === 'ae') s1.buffs.ae = now + duration;
                if(pup.type === 'spd') s1.buffs.spd = now + duration;
                
                powerups.splice(p, 1);
                setTimeout(spawnPowerup, 10000);
            }
        }

        // 3. Snake vs Snake Collision
        for (let j = 0; j < allSnakes.length; j++) {
            if (i === j) continue;
            let s2 = allSnakes[j];
            if (s2.dead) continue;

            // Optimization: Check bounding box first (distance check)
            // If heads are far, don't check body segments
            if (getDistance(s1.x, s1.y, s2.x, s2.y) > 500) continue; 

            const r2 = s2.getRadius();
            // Check s1 Head against s2 Body
            // We skip the very front of s2 (neck) to allow head-to-head logic elsewhere if we wanted it
            // But standard Slither/Wormate rule: Head hits Body = Head dies.
            
            const safeZone = 10; // Skip first few segments
            let hit = false;
            
            // Check segments efficiently
            // Check every 3rd segment for performance
            for (let k = 0; k < s2.path.length - safeZone; k += 3) {
                const pt = s2.path[k];
                if (getDistance(s1.x, s1.y, pt.x, pt.y) < (r1 + r2 * 0.8)) {
                    hit = true;
                    break;
                }
            }

            if (hit) {
                s1.die();
                s2.kills++;
                if(!s1.isBot && s1.kills === 1) s2.hsCount++; // Just simple tracking
                break; // s1 is dead, stop checking
            }
        }
    }
}

// --- SERVER LOOP ---

function gameLoop() {
    const now = Date.now();

    // Clean up dead players
    for (const id in players) {
        if (players[id].dead) {
            const p = players[id];
            broadcast({ type: 'die', id: id });
            
            // Check if it was a player or bot (player removal logic handled in WS close or here)
            // Actually, for players, we keep them object until respawn or explicit removal?
            // Let's remove them from players map, client will handle Game Over screen
            delete players[id];
        }
    }

    // Clean up dead bots
    for (let i = bots.length - 1; i >= 0; i--) {
        if (bots[i].dead) {
            bots.splice(i, 1);
            spawnBot(); // Respawn bot
        }
    }

    // Update Entities
    Object.values(players).forEach(p => p.update(1));
    bots.forEach(b => b.update(1));

    checkCollisions();

    // Serialize State
    // Optimization: Only send visible food to clients? 
    // For simplicity in single-file demo, we send all, but limit food count.
    
    const state = {
        type: 'state',
        players: Object.values(players).map(p => ({
            id: p.id,
            x: Math.round(p.x), // Round to save bandwidth
            y: Math.round(p.y),
            a: Math.round(p.angle * 100) / 100,
            l: Math.round(p.length),
            c: p.color,
            n: p.name,
            p: p.path, // Path is heavy, but needed for rendering
            b: p.buffs,
            k: p.kills,
            hs: p.hsCount
        })),
        bots: bots.map(b => ({
            id: b.id,
            x: Math.round(b.x),
            y: Math.round(b.y),
            a: Math.round(b.angle * 100) / 100,
            l: Math.round(b.length),
            c: b.color,
            n: b.name,
            p: b.path
        })),
        // Send Food: Only send subset or full if low. 
        // To support 3000 food over websocket efficiently, usually we binary encode.
        // Here we will just send food updates or full list if it changes less.
        // For this demo: Send full food list. Warning: High bandwidth usage.
        food: foods 
    };

    broadcast(state);
}

// Initialize World
for(let i=0; i<BOT_COUNT; i++) spawnBot();
for(let i=0; i<2000; i++) spawnFood();
for(let i=0; i<50; i++) spawnPowerup();

function spawnBot() {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * MAP_RADIUS * 0.8;
    const x = Math.cos(angle) * dist;
    const y = Math.sin(angle) * dist;
    bots.push(new Snake('bot_' + generateId(), x, y, true, `Bot_${Math.floor(Math.random()*999)}`));
}

setInterval(gameLoop, 1000 / TICK_RATE);

// --- WEBSOCKET HANDLERS ---

function broadcast(data) {
    // Convert to JSON
    const json = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(json);
        }
    });
}

wss.on('connection', (ws) => {
    const id = generateId();
    console.log(`Connection: ${id}`);

    // Spawn Player
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * MAP_RADIUS * 0.5;
    const player = new Snake(id, Math.cos(angle)*dist, Math.sin(angle)*dist, false, "Guest");
    players[id] = player;

    ws.send(JSON.stringify({ 
        type: 'init', 
        id: id, 
        config: { mapRadius: MAP_RADIUS } 
    }));

    // Handle Input
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (!players[id]) return;

            // Heartbeat
            players[id].lastSeen = Date.now();

            if (data.type === 'input') {
                // Client sends: { angle: 3.14, boosting: false }
                // Or MouseXY. Let's use Angle for responsiveness.
                if (data.angle !== undefined) players[id].targetAngle = data.angle;
                if (data.boost !== undefined) players[id].boosting = data.boost;
                if (data.name) players[id].name = data.name; // Update name once
            }
        } catch (e) {
            console.error(e);
        }
    });

    ws.on('close', () => {
        console.log(`Disconnect: ${id}`);
        if (players[id]) {
            players[id].die(); // Turn into food
            delete players[id];
        }
    });
});

// Timeout Monitor
setInterval(() => {
    const now = Date.now();
    for (const id in players) {
        if (now - players[id].lastSeen > TIMEOUT_MS) {
            console.log(`Kicking ${id} (Timeout)`);
            // Trigger disconnect logic
            const ws = wss.clients.find(c => c.id === id); // Simple way, not robust for prod but ok here
            if(ws) ws.terminate();
            else {
                // Force remove if socket is gone but object remains
                players[id].die();
                delete players[id];
            }
        }
    }
}, 5000);
