// server.js
const WebSocket = require('ws');
const http = require('http');

// Setup simple HTTP server for health checks (Render needs this)
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Wormate Server Running');
});

const wss = new WebSocket.Server({ server });

const CONFIG = {
    worldSize: 4000,
    tickRate: 1000 / 30, // 30 ticks per second
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
let updateCounter = 0;

// Helper: Random Pos
const rand = (min, max) => Math.random() * (max - min) + min;

class Snake {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.x = rand(200, CONFIG.worldSize - 200);
        this.y = rand(200, CONFIG.worldSize - 200);
        this.angle = rand(0, Math.PI * 2);
        this.targetAngle = this.angle;
        this.score = 10;
        this.speed = CONFIG.baseSpeed;
        this.boosting = false;
        this.radius = CONFIG.baseRadius;
        
        // Skin
        this.r = Math.floor(rand(50, 255));
        this.g = Math.floor(rand(50, 255));
        this.b = Math.floor(rand(50, 255));

        // Body History (We store more points than visible segments for smoothness)
        this.history = []; 
        // Pre-fill history so snake doesn't appear as a dot
        for(let i=0; i<100; i++) {
            this.history.push({x: this.x, y: this.y});
        }
        
        this.dead = false;
    }

    update() {
        if (this.dead) return;

        // Smooth Turn
        let diff = this.targetAngle - this.angle;
        while (diff <= -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.angle += diff * CONFIG.turnSpeed;

        // Speed
        if (this.boosting && this.score > 15) {
            this.speed = CONFIG.boostSpeed;
            this.score -= 0.1; // Cost of boost
            // Drop food behind
            if (Math.random() < 0.2) {
                const tail = this.history[this.history.length-1];
                foods.push({
                    x: tail.x, y: tail.y, 
                    val: 0.5, type: 0,
                    color: `rgb(${this.r},${this.g},${this.b})`
                });
            }
        } else {
            this.speed = CONFIG.baseSpeed;
        }

        // Move Head
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;

        // Border Collision (Die)
        if (this.x < 0 || this.x > CONFIG.worldSize || this.y < 0 || this.y > CONFIG.worldSize) {
            this.dead = true;
            return;
        }

        // Update Body History
        this.history.unshift({x: this.x, y: this.y});
        
        // Trim History
        // Length in segments roughly = score
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
    const types = [0, 0, 0, 0, 1, 2, 3, 4]; // 0 is normal food (most common)
    const type = types[Math.floor(Math.random() * types.length)];
    foods.push({
        x: rand(0, CONFIG.worldSize),
        y: rand(0, CONFIG.worldSize),
        val: (type === 0) ? rand(1, 5) : 15, // Boosters give more mass
        type: type 
    });
}

// --- Network Handlers ---

wss.on('connection', (ws) => {
    const id = ++lastSnakeId;
    
    ws.on('message', (message) => {
        const data = new Uint8Array(message);
        const type = data[0];
        const view = new DataView(message.buffer);

        if (type === 1) { // JOIN
            const len = data[1];
            const name = new TextDecoder().decode(data.slice(2, 2 + len));
            const snake = new Snake(id, name || "Unnamed");
            clients.set(ws, snake);
            
            // Send Init
            const buf = new Uint8Array(5);
            new DataView(buf.buffer).setUint8(0, 10); // INIT
            new DataView(buf.buffer).setUint32(1, id, true);
            ws.send(buf);
        }
        else if (type === 0) { // INPUT (Angle)
            const snake = clients.get(ws);
            if (snake && !snake.dead) {
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
    });

    ws.on('close', () => {
        const snake = clients.get(ws);
        if (snake) {
            // Turn body to food
            for(let i=0; i<snake.history.length; i+=5) {
                const p = snake.history[i];
                foods.push({x: p.x, y: p.y, val: 1, type: 0});
            }
            clients.delete(ws);
        }
    });
});

// --- Game Loop ---

setInterval(() => {
    // 1. Update Physics
    clients.forEach(snake => snake.update());

    // Check Collisions
    // 1. Snake vs Food
    clients.forEach(snake => {
        if(snake.dead) return;
        
        // Eat Radius
        let eatRad = snake.radius + 20;
        if (snake.boosting) eatRad *= 1.5; // Magnet effect logic (simplified)

        for (let i = foods.length - 1; i >= 0; i--) {
            const f = foods[i];
            const dx = snake.x - f.x;
            const dy = snake.y - f.y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            // Magnet logic: pull food if boosting
            if (snake.boosting && dist < 100 && dist > eatRad) {
                 f.x += (dx/dist) * 2;
                 f.y += (dy/dist) * 2;
            }

            if (dist < eatRad) {
                snake.score += f.val;
                foods.splice(i, 1);
                spawnFood();
            }
        }
    });

    // 2. Snake vs Snake
    const allSnakes = Array.from(clients.values());
    allSnakes.forEach(attacker => {
        if(attacker.dead) return;

        allSnakes.forEach(victim => {
            if(attacker === victim || victim.dead) return;

            // Optimization: Bounding box
            if (Math.abs(attacker.x - victim.x) > 2000) return;

            // Check Attacker Head vs Victim Body
            // We check history points
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

    // 3. Clean up dead snakes (convert to food done in close, but for game over kill:
    allSnakes.forEach(s => {
        if(s.dead) {
             // Respawn logic could go here, or just remove from map
             // For this clone, we remove them.
             clients.forEach((val, key) => {
                 if(val === s) clients.delete(key);
             });
             // Turn to food
             for(let i=0; i<s.history.length; i+=5) {
                const p = s.history[i];
                foods.push({x: p.x, y: p.y, val: 1, type: 0});
            }
        }
    });

    // 4. Broadcast State
    broadcastUpdate();

}, CONFIG.tickRate);

function broadcastUpdate() {
    // Construct binary packet
    // Estimate buffer size roughly, dynamic resizing is better but Uint8Array is fixed.
    // We'll do a simple buffer concatenation approach or just a large buffer.
    // To keep it simple in one file without Buffer concat overhead:
    // We will iterate to calculate size first? No, too slow.
    // Let's use a reasonable max size array.
    
    const headerSize = 3; // Type(1) + NumSnakes(2)
    // We'll just build parts and concatenate. JS optimizations usually handle this okay for <50 players.
    let parts = [];
    let part1 = new Uint8Array(3);
    new DataView(part1.buffer).setUint8(0, 11); // UPDATE
    new DataView(part1.buffer).setUint16(1, clients.size, true);
    parts.push(part1);

    clients.forEach(s => {
        // Snake Header: ID(4), X(8), Y(8), Ang(8), Score(4), Skin(3), NameLen(1), Name(N)
        const nameEnc = new TextEncoder().encode(s.name);
        // Body Data: Count(2), Points(Point * 16)
        // Optimization: Send every 3rd history point to save bandwidth
        let step = 3; 
        let bodyCount = Math.floor(s.history.length / step);
        
        const snakeSize = 36 + 1 + nameEnc.length + 2 + (bodyCount * 16);
        const buf = new Uint8Array(snakeSize);
        const view = new DataView(buf.buffer);
        let off = 0;
        
        view.setUint32(off, s.id, true); off += 4;
        view.setFloat64(off, s.x, true); off += 8;
        view.setFloat64(off, s.y, true); off += 8;
        view.setFloat64(off, s.angle, true); off += 8;
        view.setFloat32(off, s.score, true); off += 4;
        view.setUint8(off++, s.r);
        view.setUint8(off++, s.g);
        view.setUint8(off++, s.b);
        view.setUint8(off++, nameEnc.length);
        buf.set(nameEnc, off); off += nameEnc.length;
        
        view.setUint16(off, bodyCount, true); off += 2;
        
        for(let i=0; i<bodyCount; i++) {
            let p = s.history[i*step];
            view.setFloat64(off, p.x, true); off += 8;
            view.setFloat64(off, p.y, true); off += 8;
        }
        
        parts.push(buf);
    });

    // Food Header
    const foodHeader = new Uint8Array(2);
    new DataView(foodHeader.buffer).setUint16(0, foods.length, true);
    parts.push(foodHeader);

    // Food Data
    foods.forEach(f => {
        const buf = new Uint8Array(21); // X(8) + Y(8) + Val(4) + Type(1)
        const view = new DataView(buf.buffer);
        view.setFloat64(0, f.x, true);
        view.setFloat64(8, f.y, true);
        view.setFloat32(16, f.val, true);
        view.setUint8(20, f.type);
        parts.push(buf);
    });

    const finalPacket = new Uint8Array(parts.reduce((acc, p) => acc + p.length, 0));
    let offset = 0;
    parts.forEach(p => {
        finalPacket.set(p, offset);
        offset += p.length;
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(finalPacket);
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
    
    wss.clients.forEach(c => c.send(buf));
}

server.listen(8080, () => {
    console.log(`Server running on port 8080`);
});
