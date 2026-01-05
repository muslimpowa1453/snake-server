/* ========================================== */
/* SERVER.JS                                  */
/* ========================================== */
const WebSocket = require('ws');

// Use process.env.PORT for Render, fallback to 10000 locally
const port = process.env.PORT || 10000;
const wss = new WebSocket.Server({ port: port });

console.log(`Snake Server Started on port ${port}`);

// Store all connected players
// Structure: { id: { x, y, angle, length, color, name } }
let players = {};

// SEGMENT SPACING (Match with client)
const SEGMENT_SPACING = 5;

// When a player connects
wss.on('connection', (ws) => {
    // Generate a unique ID for this player
    const id = Math.random().toString(36).substring(2, 9);
    let color = `hsl(${Math.random() * 360}, 100%, 50%)`;
    
    console.log(`Player ${id} connected`);

    // Initialize player data
    players[id] = {
        x: 0, 
        y: 0, 
        angle: 0, 
        length: 50, 
        color: color, 
        name: "Guest",
        path: [] // We will store a simplified path for others to draw
    };

    // Send the player their own ID so they know who they are
    ws.send(JSON.stringify({ type: 'init', selfId: id }));

    // Listen for messages from this player
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'move') {
                // Update this player's position in the server memory
                if (players[id]) {
                    players[id].x = data.x;
                    players[id].y = data.y;
                    players[id].angle = data.angle;
                    players[id].length = data.length;
                    players[id].path = data.path; // Receive path history
                    players[id].name = data.name;
                    players[id].color = players[id].color; // Keep color consistent
                }
            } else if (data.type === 'quit') {
                // Explicit quit message handling
                removePlayer(id);
            }
        } catch (e) {
            console.error("Invalid message received");
        }
    });

    // When a player disconnects, remove them
    ws.on('close', () => {
        // Only run removal if the player still exists (hasn't been quit explicitly)
        if (players[id]) {
            console.log(`Player ${id} disconnected via socket close`);
            removePlayer(id);
        }
    });

    function removePlayer(playerId) {
        if (!players[playerId]) return;

        // SERVER SIDE LOOT GENERATION
        // When player disconnects, transform them into food
        if (players[playerId].path && players[playerId].path.length > 0) {
            const loot = generateLootFromPath(players[playerId]);
            // Broadcast the food to everyone else
            broadcast({ type: 'spawn_food', food: loot });
        }

        delete players[playerId];
        // Tell everyone else to remove this player
        broadcast({ type: 'remove', id: playerId });
    }
});

// Broadcast function: sends data to ALL connected players
function broadcast(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Helper: Generate Food from Path
function generateLootFromPath(player) {
    const foodDrops = [];
    // We recreate the body points roughly
    // This is a simplified version of client-side rendering logic
    let path = player.path || [];
    // Ensure we have the head
    path.push({ x: player.x, y: player.y });
    
    // Simply scatter food along the path points
    // We skip every few points to not overload the network, but make enough food
    const step = 2; 
    for(let i = 0; i < path.length; i += step) {
        // Random chance to drop food at this segment
        if (Math.random() > 0.3) {
            foodDrops.push({
                x: path[i].x + (Math.random() - 0.5) * 10,
                y: path[i].y + (Math.random() - 0.5) * 10,
                r: 8 + Math.random() * 8, // Random size
                color: player.color, // Food takes color of snake
                type: Math.floor(Math.random() * 3) // Random food type
            });
        }
    }
    return foodDrops;
}

// The "Heartbeat" Loop
// Every 50ms (20 times a second), send the full state of all players to everyone
setInterval(() => {
    const pack = [];
    for (const id in players) {
        pack.push({
            id: id,
            x: players[id].x,
            y: players[id].y,
            angle: players[id].angle,
            path: players[id].path,
            color: players[id].color,
            name: players[id].name,
            length: players[id].length
        });
    }
    broadcast({ type: 'state', players: pack });
}, 50);
