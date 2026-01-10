/* ========================================== */
/* SERVER.JS (HTTP + WEBSOCKET)               */
/* ========================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// CONFIGURATION
const PORT = process.env.PORT || 10000;

// 1. HTTP SERVER
const server = http.createServer((req, res) => {
    console.log(`HTTP Request: ${req.url}`);
    
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html. Make sure index.html is in the same folder as server.js.');
                console.error(err);
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// 2. WEBSOCKET SERVER
const wss = new WebSocket.Server({ server });

console.log(`HTTP & WebSocket Server initialized on port ${PORT}`);

// --- GAME CONFIGURATION ---
const MAP_RADIUS = 6000;
const SEGMENT_SPACING = 5;
const PATH_SPACING = 5;
const BASE_SPEED = 3.0; 
const BOOST_SPEED = 6.0;
const TURN_SPEED = 0.08;
const TURN_SPEED_BOOST = 0.06;
const BOT_COUNT = 20;
const TICK_RATE = 30; 
const TIMEOUT_MS = 10000;

// --- GAME STATE ---
let players = {};
let bots = [];
let foods = [];
let powerups = [];
let idCounter = 0;

// --- UTILS ---
const getDistance = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const generateId = () => (++idCounter).toString(36);

// --- ENTITY CLASS ---
class Snake {
    constructor(id, x, y, isBot = false, name = "Bot") {
        this.id = id;
        this.x = x;
        this.y = y;
        this.angle = Math.random() * Math.PI * 2;
        this.targetAngle = this.angle;
        this.length = 50;
        this.width = 20;
        this.color = isBot ? `hsl(${Math.random() * 360}, 100%, 50%)` : null;
        this.name = name;
        this.path = [];
        
        for(let i=0; i<this.length * SEGMENT_SPACING; i+=PATH_SPACING) {
            this.path.push({x: x, y: y});
        }
        
        this.speed = BASE_SPEED;
        this.boosting = false;
        this.isBot = isBot;
        this.dead = false;
        this.score = Math.floor(this.length * 10);
        
        this.buffs = { x2: 0, x5: 0, x10: 0, ae: 0, spd: 0 };
        this.kills = 0;
        this.hsCount = 0;
        this.lastSeen = Date.now();
    }

    update(dt) {
        if (this.dead) return;
        const now = Date.now();
        
        let turnSpd = TURN_SPEED;
        let spd = BASE_SPEED;

        if (now < this.buffs.spd) spd *= 1.5;
        if (now < this.buffs.ae) turnSpd = 0.15; 

        if (this.isBot) this.updateBotAI();

        let diff = this.targetAngle - this.angle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.angle += diff * turnSpd;

        if (this.boosting && this.length > 20) {
            spd = BOOST_SPEED;
            if (now < this.buffs.spd) spd *= 1.5;
            this.length -= 0.05;
            if (this.length < 10) this.length = 10;
            if (Math.random() < 0.2 && this.path.length > 0) {
                const head = this.path[this.path.length - 1];
                spawnFood(head.x, head.y, 4, this.color);
            }
        }

        this.x += Math.cos(this.angle) * spd;
        this.y += Math.sin(this.angle) * spd;

        const last = this.path[this.path.length - 1];
        if (!last || getDistance(this.x, this.y, last.x, last.y) >= PATH_SPACING) {
            this.path.push({x: this.x, y: this.y});
        }

        const maxPath = (this.length * SEGMENT_SPACING) + 50;
        if (this.path.length > maxPath) {
            this.path.splice(0, this.path.length - maxPath);
        }

        if (getDistance(this.x, this.y, 0, 0) > MAP_RADIUS) this.die();
    }

    updateBotAI() {
        if (Math.random() < 0.05) this.targetAngle = Math.random() * Math.PI * 2;
        if (getDistance(this.x, this.y, 0, 0) > MAP_RADIUS * 0.8) {
            this.targetAngle = Math.atan2(-this.y, -this.x);
        }
        this.boosting = (this.length > 100 && Math.random() < 0.01);
    }

    getRadius() {
        const minR = 10; const maxR = 40;
        const base = Math.log10(Math.max(this.length, 50));
        const t = Math.min(1, Math.max(0, (base - 1.7) / 3.5));
        return minR + (maxR - minR) * t;
    }

    die() {
        this.dead = true;
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
    if (foods.length > 3000) return; 
    if (x === undefined) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * MAP_RADIUS;
        x = Math.cos(angle) * dist;
        y = Math.sin(angle) * dist;
        r = 5 + Math.random() * 5;
        color = `hsl(${Math.random() * 360}, 100%, 50%)`;
    }
    foods.push({ x: x, y: y, r: r, color: color, type: Math.floor(Math.random() * 3), angle: Math.random() * Math.PI * 2 });
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
        for (let f = foods.length - 1; f >= 0; f--) {
            const food = foods[f];
            if (getDistance(s1.x, s1.y, food.x, food.y) < r1 + food.r + 5) {
                let growth = (food.r / 3);
                const now = Date.now();
                let mult = 1;
                if(now < s1.buffs.x2) mult*=2;
                if(now < s1.buffs.x5) mult*=5;
                if(now < s1.buffs.x10) mult*=10;
                s1.length += growth * mult;
                foods.splice(f, 1);
                spawnFood(); 
            }
        }
        for (let p = powerups.length - 1; p >= 0; p--) {
            const pup = powerups[p];
            if (getDistance(s1.x, s1.y, pup.x, pup.y) < r1 + pup.r + 5) {
                const now = Date.now();
                const duration = 30000;
                if(pup.type === '2x') s1.buffs.x2 = now + duration;
                if(pup.type === '5x') s1.buffs.x5 = now + duration;
                if(pup.type === '10x') s1.buffs.x10 = now + duration;
                if(pup.type === 'ae') s1.buffs.ae = now + duration;
                if(pup.type === 'spd') s1.buffs.spd = now + duration;
                powerups.splice(p, 1);
                setTimeout(spawnPowerup, 10000);
            }
        }
        for (let j = 0; j < allSnakes.length; j++) {
            if (i === j) continue;
            let s2 = allSnakes[j];
            if (s2.dead) continue;
            if (getDistance(s1.x, s1.y, s2.x, s2.y) > 500) continue; 
            const r2 = s2.getRadius();
            const safeZone = 10; 
            let hit = false;
            for (let k = 0; k < s2.path.length - safeZone; k += 3) {
                const pt = s2.path[k];
                if (getDistance(s1.x, s1.y, pt.x, pt.y) < (r1 + r2 * 0.8)) {
                    hit = true; break;
                }
            }
            if (hit) {
                s1.die();
                s2.kills++;
                if(!s1.isBot) s2.hsCount++;
                break; 
            }
        }
    }
}

function gameLoop() {
    const now = Date.now();
    for (const id in players) {
        if (players[id].dead) {
            broadcast({ type: 'die', id: id });
            delete players[id];
        }
    }
    for (let i = bots.length - 1; i >= 0; i--) {
        if (bots[i].dead) { bots.splice(i, 1); spawnBot(); }
    }

    Object.values(players).forEach(p => p.update(1));
    bots.forEach(b => b.update(1));
    checkCollisions();

    const state = {
        type: 'state',
        players: Object.values(players).map(p => ({
            id: p.id, x: Math.round(p.x), y: Math.round(p.y),
            a: Math.round(p.angle * 100) / 100, l: Math.round(p.length),
            c: p.color, n: p.name, p: p.path, b: p.buffs, k: p.kills, hs: p.hsCount
        })),
        bots: bots.map(b => ({
            id: b.id, x: Math.round(b.x), y: Math.round(b.y),
            a: Math.round(b.angle * 100) / 100, l: Math.round(b.length),
            c: b.color, n: b.name, p: b.path
        })),
        food: foods 
    };
    broadcast(state);
}

// Init
for(let i=0; i<BOT_COUNT; i++) spawnBot();
for(let i=0; i<2000; i++) spawnFood();
for(let i=0; i<50; i++) spawnPowerup();

function spawnBot() {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * MAP_RADIUS * 0.8;
    bots.push(new Snake('bot_' + generateId(), Math.cos(angle)*dist, Math.sin(angle)*dist, true, `Bot_${Math.floor(Math.random()*999)}`));
}

setInterval(gameLoop, 1000 / TICK_RATE);

function broadcast(data) {
    const json = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(json);
    });
}

// WS HANDLER
wss.on('connection', (ws) => {
    const id = generateId();
    ws.id = id; 
    console.log(`WS Connection: ${id}`);

    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * MAP_RADIUS * 0.5;
    const player = new Snake(id, Math.cos(angle)*dist, Math.sin(angle)*dist, false, "Guest");
    players[id] = player;

    ws.send(JSON.stringify({ type: 'init', id: id, config: { mapRadius: MAP_RADIUS } }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (!players[id]) return;
            players[id].lastSeen = Date.now();
            if (data.type === 'input') {
                if (data.angle !== undefined) players[id].targetAngle = data.angle;
                if (data.boost !== undefined) players[id].boosting = data.boost;
                if (data.name) players[id].name = data.name;
            }
        } catch (e) { console.error(e); }
    });

    ws.on('close', () => {
        console.log(`WS Disconnect: ${id}`);
        if (players[id]) { players[id].die(); delete players[id]; }
    });
});

// Timeout Monitor
setInterval(() => {
    const now = Date.now();
    for (const id in players) {
        if (now - players[id].lastSeen > TIMEOUT_MS) {
            console.log(`Kicking ${id}`);
            const client = [...wss.clients].find(c => c.id === id);
            if (client) client.terminate();
            else { players[id].die(); delete players[id]; }
        }
    }
}, 5000);

server.listen(PORT, () => {
    console.log(`Game is live at http://localhost:${PORT}`);
});
