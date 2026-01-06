/* ========================================== */
/* SERVER.JS - Wormate Clone Backend          */
/* ========================================== */
const WebSocket = require('ws');

// Render sets the PORT env variable
const port = process.env.PORT || 10000;
const wss = new WebSocket.Server({ port: port });

console.log(`Wormate Server Started on port ${port}`);

// --- Game Constants ---
const WORLD_SIZE = 5000;
const MAX_FOOD = 800;
const BASE_SPEED = 5;
const BOOST_SPEED = 10;
const TURN_SPEED = 0.15;
const START_SCORE = 10;

// State
let players = {};
let food = [];

// Utils
const randomColor = () => {
    const hues = [0, 20, 45, 120, 180, 280, 300]; 
    return `hsl(${hues[Math.floor(Math.random()*hues.length)]}, 90%, 55%)`;
};

// Generate initial food
function spawnFood(amount) {
    for (let i = 0; i < amount; i++) {
        if (food.length >= MAX_FOOD) break;
        food.push({
            id: Math.random().toString(36).substr(2, 5),
            x: (Math.random() - 0.5) * WORLD_SIZE,
            y: (Math.random() - 0.5) * WORLD_SIZE,
            r: 10 + Math.random() * 15,
            color: randomColor(),
            type: Math.floor(Math.random() * 4) // 0=Donut, 1=Cake, etc
        });
    }
}
spawnFood(400);

wss.on('connection', (ws) => {
    const id = Math.random().toString(36).substring(2, 9);
    console.log(`Player ${id} connected`);

    players[id] = {
        id: id, ws: ws,
        x: 0, y: 0, angle: 0,
        score: START_SCORE,
        width: 25,
        color: randomColor(),
        name: "Guest",
        path: [],
        inputAngle: 0,
        isBoosting: false,
        isPlaying: false
    };

    ws.send(JSON.stringify({ type: 'init', selfId: id }));

    ws.on('message', (msgStr) => {
        try {
            const msg = JSON.parse(msgStr);
            const p = players[id];
            if (!p) return;

            if (msg.type === 'join') {
                p.name = msg.name || "Guest";
                p.isPlaying = true;
                p.x = (Math.random() - 0.5) * 1000;
                p.y = (Math.random() - 0.5) * 1000;
                p.path = [];
                for(let i=0; i<5; i++) p.path.push({x: p.x, y: p.y}); // Init body
            }
            
            if (msg.type === 'input') {
                p.inputAngle = msg.angle;
                p.isBoosting = !!msg.boost;
            }
        } catch (e) { console.error(e); }
    });

    ws.on('close', () => delete players[id]);
});

// --- Game Loop (20 FPS) ---
setInterval(() => {
    // 1. Logic
    for (const id in players) {
        const p = players[id];
        if (!p.isPlaying) continue;

        // Turn Logic
        let diff = p.inputAngle - p.angle;
        while (diff <= -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        p.angle += Math.sign(diff) * Math.min(Math.abs(diff), TURN_SPEED);

        // Speed & Boost Logic
        let speed = BASE_SPEED;
        if (p.isBoosting && p.score > 20) {
            speed = BOOST_SPEED;
            p.score -= 0.1; // Cost to boost
            // Drop food trail while boosting? (Optional, skipping for simplicity)
        }

        // Move
        p.x += Math.cos(p.angle) * speed;
        p.y += Math.sin(p.angle) * speed;

        // Wall Death
        const limit = WORLD_SIZE / 2;
        if (Math.abs(p.x) > limit || Math.abs(p.y) > limit) {
            killPlayer(id);
            continue;
        }

        // Update Body Path
        // We only add a point if we moved enough distance to create segments
        // But for smooth visuals, we push every frame and trim
        p.path.push({x: p.x, y: p.y});
        
        // Calculate length based on score
        const targetLen = 10 + (p.score * 0.5); 
        while (p.path.length > targetLen) p.path.shift();

        // Width grows with score
        p.width = 25 + Math.min(20, Math.floor(p.score / 100));

        // Eat Food
        for (let i = food.length - 1; i >= 0; i--) {
            const f = food[i];
            const dx = p.x - f.x;
            const dy = p.y - f.y;
            if (dx*dx + dy*dy < (p.width + f.r)*(p.width + f.r)) {
                p.score += (f.r / 5);
                food.splice(i, 1);
            }
        }

        // Collision with Others
        for (const otherId in players) {
            if (id === otherId) continue;
            const other = players[otherId];
            if (!other.isPlaying) continue;

            // Check if my head hits their path
            // Optimization: check only every 3rd point
            let collision = false;
            for (let i = 0; i < other.path.length - 2; i += 3) {
                const pt = other.path[i];
                const dx = p.x - pt.x;
                const dy = p.y - pt.y;
                const distSq = dx*dx + dy*dy;
                const rad = (p.width + other.width) / 2;
                
                // Hit body
                if (distSq < rad * rad) {
                    collision = true;
                    break;
                }
            }
            if (collision) {
                killPlayer(id);
                break;
            }
        }
    }

    // Spawn more food if low
    if (food.length < MAX_FOOD) spawnFood(10);

    // 2. Send Update
    const pack = {
        players: {},
        food: food
    };
    for (const id in players) {
        if (!players[id].isPlaying) continue;
        const p = players[id];
        pack.players[id] = {
            id: p.id,
            x: p.x, y: p.y,
            angle: p.angle,
            path: p.path, // Full path for smooth curves
            color: p.color,
            name: p.name,
            score: p.score,
            width: p.width
        };
    }

    const data = JSON.stringify({ type: 'update', ...pack });
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) c.send(data);
    });

}, 50); // 50ms = 20 ticks/sec

function killPlayer(id) {
    const p = players[id];
    if (!p) return;
    
    // Notify death
    if (p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(JSON.stringify({ type: 'dead', score: p.score }));
    }

    // Turn body into food
    const dropCount = Math.min(100, p.path.length);
    for (let i = 0; i < dropCount; i+=2) {
        food.push({
            id: Math.random().toString(36),
            x: p.path[i].x + (Math.random()*20-10),
            y: p.path[i].y + (Math.random()*20-10),
            r: 10 + Math.random() * 10,
            color: p.color,
            type: Math.floor(Math.random() * 4)
        });
    }

    // Reset
    p.isPlaying = false;
    p.path = [];
    p.score = START_SCORE;
}
