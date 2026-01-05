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
        path: [] 
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
                }
            }
        } catch (e) {
            console.error("Invalid message received");
        }
    });

    // When a player disconnects
    ws.on('close', () => {
        console.log(`Player ${id} disconnected`);
        
        if (players[id]) {
            // Broadcast a 'kill_loot' event so clients can turn this snake into food
            // We send the path so clients can render the explosion exactly where the snake was
            broadcast({ 
                type: 'kill_loot', 
                path: players[id].path, 
                color: players[id].color 
            });

            delete players[id];
        }
        
        // Tell everyone else to remove this player object
        broadcast({ type: 'remove', id: id });
    });
});

// Broadcast function: sends data to ALL connected players
function broadcast(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
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
