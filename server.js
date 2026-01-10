/* ========================================== */
/* SERVER.JS (RELAY MODE - RESTORED JUICE)     */
/* ========================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// CONFIGURATION
const PORT = process.env.PORT || 10000;

// 1. HTTP SERVER (Health Check)
const server = http.createServer((req, res) => {
    console.log(`HTTP Request: ${req.url}`);
    res.writeHead(200);
    res.end('OK');
});

// 2. WEBSOCKET SERVER
const wss = new WebSocket.Server({ server });

console.log(`Server Started on port ${PORT}`);

// --- GAME STATE ---
// Store minimal state to validate collisions
let players = {}; 

// --- CONFIG (Matches Client) ---
const MAP_RADIUS = 6000;
const COLLISION_OVER_RATIO = 1.0;

// --- UTILS ---
const getDistance = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

// --- CONNECTION HANDLERS ---
wss.on('connection', (ws) => {
    const id = Math.random().toString(36).substring(2, 9);
    console.log(`Player ${id} connected`);

    players[id] = {
        x: 0,
        y: 0,
        length: 50,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`,
        name: "Guest",
        path: [],
        dead: false
    };

    // Send ID
    ws.send(JSON.stringify({ type: 'init', selfId: id }));

    ws.on('message', (message) => {
        if (players[id] && players[id].dead) return;

        try {
            const data = JSON.parse(message);

            if (data.type === 'update') {
                // 1. Store Player State
                players[id].x = data.x;
                players[id].y = data.y;
                players[id].angle = data.angle;
                players[id].length = data.length;
                players[id].path = data.path; 
                players[id].name = data.name;
                players[id].color = players[id].color;

                // 2. Check Collision (Server Side Verification)
                // We check if THIS player hits ANYONE else
                for (const otherId in players) {
                    if (otherId === id) continue; // Don't hit self
                    if (players[otherId].dead) continue;

                    const other = players[otherId];
                    if (!other.path || other.path.length === 0) continue;

                    // Simple head vs body check
                    // We skip the "neck" area to prevent accidental head-to-heads or confusion
                    const skip = 10; 
                    let hit = false;
                    const myR = getRadius(data.length);
                    const otherR = getRadius(other.length);
                    
                    // Optimization: Bounding box first
                    if (getDistance(data.x, data.y, other.x, other.y) > 500) continue;

                    // Detailed check
                    // To save CPU, check every 3rd segment
                    for (let k = 0; k < other.path.length - skip; k += 3) {
                        const pt = other.path[k];
                        if (getDistance(data.x, data.y, pt.x, pt.y) < (myR + otherR * 0.8)) {
                            hit = true;
                            break;
                        }
                    }

                    if (hit) {
                        // Tell this player they died
                        ws.send(JSON.stringify({ type: 'die' }));
                        // Tell everyone else to remove them
                        broadcast({ type: 'remove', id: id });
                        
                        // Convert to loot logic (Optional, but adds fun)
                        broadcast({ type: 'spawn_food', food: generateLoot(players[id].path, players[id].length, players[id].color) });
                        
                        players[id].dead = true;
                        delete players[id];
                        return; // Stop processing
                    }
                }

                // 3. Broadcast Update to everyone else (NOT me)
                // This makes it multiplayer
                const updatePacket = {
                    type: 'update',
                    id: id,
                    x: data.x,
                    y: data.y,
                    angle: data.angle,
                    length: data.length,
                    name: data.name,
                    color: players[id].color,
                    path: data.path // We relay the full path so others see the shape perfectly
                };

                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(updatePacket));
                    }
                });

            } else if (data.type === 'quit') {
                if (players[id]) {
                    broadcast({ type: 'remove', id: id });
                    // Generate loot on quit
                    broadcast({ type: 'spawn_food', food: generateLoot(players[id].path, players[id].length, players[id].color) });
                    delete players[id];
                }
            }

        } catch (e) {
            console.error("Invalid message", e);
        }
    });

    ws.on('close', () => {
        if (players[id]) {
            broadcast({ type: 'remove', id: id });
            // Generate loot
            broadcast({ type: 'spawn_food', food: generateLoot(players[id].path, players[id].length, players[id].color) });
            delete players[id];
        }
    });
});

function broadcast(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Helper: Get Radius (Matches Client)
function getRadius(len) {
    const minR = 20; // Match client start thickness
    const maxR = 60;
    const base = Math.log10(Math.max(len, 50));
    const t = Math.min(1, Math.max(0, (base - 1.7) / 4.0)); 
    return minR + (maxR - minR) * t;
}

// Helper: Generate Loot
function generateLoot(path, length, color) {
    const drops = [];
    if(!path) return drops;
    const step = 4;
    for (let i = 0; i < path.length; i += step) {
        drops.push({
            x: path[i].x,
            y: path[i].y,
            r: 8 + Math.random() * 5,
            color: color
        });
    }
    return drops;
}

server.listen(PORT, () => {
    console.log(`Relay Server listening on port ${PORT}`);
});
