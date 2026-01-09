const WebSocket = require('ws');
const http = require('http');

// Setup HTTP server (Required for health checks and WebSocket upgrade)
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Wormate Server Running');
});

const wss = new WebSocket.Server({ server });

// IMPORTANT: Use Render's assigned port or fallback to 8080
const PORT = process.env.PORT || 8080;

const CONFIG = {
    worldSize: 4000,
    tickRate: 33, // ~30 updates per second
    baseSpeed: 4,
    boostSpeed: 8,
    turnSpeed: 0.08,
    baseRadius: 10,
    segmentDistance: 7
};

// Game State
let clients = new Map(); // socket -> { id, snake }
let foods = [];
let lastSnakeId = 0;

const rand = (min, max) => Math.random() * (max - min) + min;

class Snake {
    constructor(id, name) {
        this.id = id;
        this.name = name || "Unnamed";
        this.x = rand(200, CONFIG.worldSize - 200);
        this.y = rand(200, CONFIG.worldSize - 200);
        this.angle = rand(0, Math.PI * 2);
        this.targetAngle = this.angle;
        this.score = 10;
        this.speed = CONFIG.baseSpeed;
        this.boosting = false;
        this.radius = CONFIG.baseRadius;
        
        // Random Skin Color
        this.r = Math.floor(rand(50, 255));
        this.g = Math.floor(rand(50, 255));
        this.b = Math.floor(rand(50, 255));

        this.history = []; 
        for(let i=0; i<100; i++) {
            this.history.push({x: this.x, y: this.y});
        }
        this.dead = false;
    }

    update() {
        if (this.dead) return;

        let diff = this.targetAngle - this.angle;
        while (diff <= -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.angle += diff * CONFIG.turnSpeed;

        if (this.boosting && this.score > 15) {
            this.speed = CONFIG.boostSpeed;
            this.score -= 0.1; 
            if (Math.random() < 0.2) {
                const tail = this.history[this.history.length-1];
                foods.push({
                    x: tail.x + rand(-5,5), y: tail.y + rand(-5,5), 
                    val: 0.5, type: 0
                });
            }
        } else {
            this.speed = CONFIG.baseSpeed;
        }

        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;

        if (this.x < 0 || this.x > CONFIG.worldSize || this.y < 0 || this.y > CONFIG.worldSize) {
            this.dead = true;
            return;
        }

        this.history.unshift({x: this.x, y: this.y});
        
        const segments = Math.floor(this.score);
        const historyLimit = segments * CONFIG.segmentDistance;
        while (this.history.length > historyLimit) {
            this.history.pop();
        }

        this.radius = CONFIG.baseRadius + Math.sqrt(this.score) * 0.5;
    }
}

// Init Food
for (let i = 0; i < 500; i++) spawnFood();

function spawnFood() {
    // Types: 0=food, 1=speed, 2=magnet, 3=2x, 4=5x
    const types = [0, 0, 0, 0, 1, 2, 3, 4]; 
    const type = types[Math.floor(Math.random() * types.length)];
    foods.push({
        x: rand(0, CONFIG.worldSize),
        y: rand(0, CONFIG.worldSize),
        val: (type === 0) ? rand(1, 5) : 15, 
        type: type 
    });
}

wss.on('connection', (ws) => {
    const id = ++lastSnakeId;
    
    ws.on('message', (message) => {
        try {
            const data = new Uint8Array(message);
            if (data.length < 1) return;
            
            const type = data[0];
            const view = new DataView(message.buffer);

            if (type === 1) { // JOIN
                const len = data[1];
                const name = new TextDecoder().decode(data.slice(2, 2 + len));
                const snake = new Snake(id, name);
                clients.set(ws, snake);
                
                // Send Init Packet
                const buf = new Uint8Array(5);
                new DataView(buf.buffer).setUint8(0, 10); // INIT
                new DataView(buf.buffer).setUint32(1, id, true);
                ws.send(buf);
            }
            else if (type === 0) { // INPUT
                const snake = clients.get(ws);
                if (snake && !snake.dead && data.length >= 9) {
                    snake.targetAngle = view.getFloat64(1, true);
                }
            }
            else if (type === 2) { // BOOST START
                const snake = clients.get(ws);
                if (snake) snake.boosting = true;
            }
            else if (type === 3) { // BOOST END
                const snake = clients.get(ws);
                if (snake) snake.boosting = false;
            }
        } catch (e) {
            console.error("Packet Error:", e);
        }
    });

    ws.on('close', () => {
        const snake = clients.get(ws);
        if (snake) {
            for(let i=0; i<snake.history.length; i+=5) {
                const p = snake.history[i];
                foods.push({x: p.x, y: p.y, val: 1, type: 0});
            }
            clients.delete(ws);
        }
    });
});

// Game Loop
setInterval(() => {
    clients.forEach(snake => snake.update());

    // Collisions
    const allSnakes = Array.from(clients.values());
    allSnakes.forEach(attacker => {
        if(attacker.dead) return;
        
        // Food
        let eatRad = attacker.radius + 20;
        if (attacker.boosting) eatRad *= 1.5;

        for (let i = foods.length - 1; i >= 0; i--) {
            const f = foods[i];
            const dx = attacker.x - f.x;
            const dy = attacker.y - f.y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            // Magnet Logic
            if (attacker.boosting && dist < 100 && dist > eatRad) {
                 f.x += (dx/dist) * 5;
                 f.y += (dy/dist) * 5;
            }

            if (dist < eatRad) {
                attacker.score += f.val;
                foods.splice(i, 1);
                spawnFood();
            }
        }
    });

    // Snake vs Snake
    allSnakes.forEach(attacker => {
        if(attacker.dead) return;
        allSnakes.forEach(victim => {
            if(attacker === victim || victim.dead) return;
            if (Math.abs(attacker.x - victim.x) > 2000) return;

            for(let i=0; i<victim.history.length; i+=CONFIG.segmentDistance) {
                const p = victim.history[i];
                const dx = attacker.x - p.x;
                const dy = attacker.y - p.y;
                if (dx*dx + dy*dy < (attacker.radius + victim.radius)**2) {
                    attacker.dead = true;
                    broadcastKill(victim.name, attacker.name);
                    break;
                }
            }
        });
    });

    // Cleanup Dead
    allSnakes.forEach(s => {
        if(s.dead) {
             clients.forEach((val, key) => {
                 if(val === s) clients.delete(key);
             });
             for(let i=0; i<s.history.length; i+=5) {
                foods.push({x: s.history[i].x, y: s.history[i].y, val: 1, type: 0});
            }
        }
    });

    broadcastUpdate();

}, CONFIG.tickRate);

function broadcastUpdate() {
    // Calculate buffer size first to avoid resizing
    // Header: 3 bytes (Type 1 + Count 2)
    let totalSize = 3;
    const snakeDataParts = [];
    
    clients.forEach(s => {
        // Snake Part: ID(4) + X(8) + Y(8) + Ang(8) + Score(4) + Skin(3) + NameLen(1) + Name(N) + BodyCount(2) + Body(N*16)
        const nameEnc = new TextEncoder().encode(s.name);
        const step = 3;
        const bodyCount = Math.floor(s.history.length / step);
        const sSize = 36 + 1 + nameEnc.length + 2 + (bodyCount * 16);
        totalSize += sSize;
    });

    // Food Header: 2 bytes
    totalSize += 2;
    // Food Data: 21 bytes each
    totalSize += foods.length * 21;

    const buffer = new Uint8Array(totalSize);
    const view = new DataView(buffer.buffer);
    let offset = 0;

    // Header
    view.setUint8(offset, 11); // UPDATE
    offset++;
    view.setUint16(offset, clients.size, true);
    offset += 2;

    // Snakes
    clients.forEach(s => {
        const nameEnc = new TextEncoder().encode(s.name);
        const step = 3;
        const bodyCount = Math.floor(s.history.length / step);

        view.setUint32(offset, s.id, true); offset += 4;
        view.setFloat64(offset, s.x, true); offset += 8;
        view.setFloat64(offset, s.y, true); offset += 8;
        view.setFloat64(offset, s.angle, true); offset += 8;
        view.setFloat32(offset, s.score, true); offset += 4;
        view.setUint8(offset++, s.r);
        view.setUint8(offset++, s.g);
        view.setUint8(offset++, s.b);
        view.setUint8(offset++, nameEnc.length);
        buffer.set(nameEnc, offset); offset += nameEnc.length;
        view.setUint16(offset, bodyCount, true); offset += 2;

        for(let i=0; i<bodyCount; i++) {
            let p = s.history[i*step];
            view.setFloat64(offset, p.x, true); offset += 8;
            view.setFloat64(offset, p.y, true); offset += 8;
        }
    });

    // Foods
    view.setUint16(offset, foods.length, true); offset += 2;
    foods.forEach(f => {
        view.setFloat64(offset, f.x, true); offset += 8;
        view.setFloat64(offset, f.y, true); offset += 8;
        view.setFloat32(offset, f.val, true); offset += 4;
        view.setUint8(offset++, f.type);
    });

    const finalData = buffer.slice(0, offset);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(finalData);
        }
    });
}

function broadcastKill(killer, victim) {
    const killerEnc = new TextEncoder().encode(killer);
    const victimEnc = new TextEncoder().encode(victim);
    const buf = new Uint8Array(2 + killerEnc.length + victimEnc.length);
    buf[0] = 13; // KILL_FEED
    buf[1] = killerEnc.length;
    buf.set(killerEnc, 2);
    buf[2 + killerEnc.length] = victimEnc.length;
    buf.set(victimEnc, 3 + killerEnc.length);
    
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) c.send(buf);
    });
}

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
