<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Wormate Clone - Network Fixed</title>
    <style>
        body { margin: 0; overflow: hidden; background: #0b0b12; font-family: 'Segoe UI', sans-serif; user-select: none; }
        canvas { display: block; }

        /* UI LAYERS */
        #ui-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; display: none; }

        /* MINIMAP */
        #minimap-container { position: absolute; top: 20px; left: 20px; width: 150px; height: 150px; background: rgba(0,0,0,0.5); border-radius: 50%; border: 3px solid #333; overflow: hidden; }
        #minimap { width: 100%; height: 100%; }

        /* STATS */
        #stats-ui { position: absolute; top: 180px; left: 20px; color: white; font-size: 16px; font-weight: bold; text-shadow:1px 1px 2px black; background: rgba(0,0,0,0.4); padding: 5px 10px; border-radius: 8px; }
        #stats-ui span { color: #ffd700; margin-left: 5px; }

        /* BUFFS */
        #status-box { position: absolute; top: 220px; left: 20px; display: flex; flex-direction: column; gap: 5px; }
        .buff { background: rgba(0,0,0,0.6); color: white; padding: 5px 10px; border-radius: 15px; font-size: 12px; font-weight: bold; border-left: 5px solid; display: none; align-items: center; }
        
        /* LEADERBOARD */
        #leaderboard { position: absolute; top: 20px; right: 20px; width: 200px; background: rgba(0,0,0,0.6); color: white; padding: 15px; border-radius: 10px; }
        #leaderboard h3 { margin: 0 0 10px 0; text-align: center; color: #ffd700; }
        .lb-row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 14px; }
        .lb-me { color: #00ff00; font-weight: bold; }

        /* TIMER */
        #clock-display { position: absolute; top: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.5); padding: 10px 20px; border-radius: 20px; color: white; font-size: 20px; font-weight: bold; }

        /* LOBBY */
        #lobby { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(11,11,18,0.95); display: flex; flex-direction: column; justify-content: center; align-items: center; z-index: 200; }
        #lobby h1 { font-size: 60px; color: #ffd700; margin-bottom: 20px; text-shadow: 0 0 20px #ff9900; }
        #nickname-input { padding: 15px; border-radius: 30px; border: 2px solid #444; background: #222; color: white; font-size: 20px; text-align: center; margin-bottom: 20px; outline: none; width: 250px; }
        
        /* LOADING */
        #loading-screen { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); display: none; flex-direction: column; justify-content: center; align-items: center; z-index: 300; }
        .spinner { width: 50px; height: 50px; border: 5px solid #333; border-top: 5px solid #00cc66; border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        /* OVERLAY / POPUP */
        #game-over { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); display: none; flex-direction: column; justify-content: center; align-items: center; color: white; pointer-events: auto; z-index: 100; }
        .menu-btn { padding: 15px 40px; font-size: 24px; color: white; border: none; border-radius: 30px; cursor: pointer; margin: 10px; font-weight: bold; transition: transform 0.2s; }
        .btn-green { background: #00cc66; }
        .btn-green:hover { transform: scale(1.1); background: #00ee77; }
        .btn-blue { background: #3366ff; }
        .btn-blue:hover { transform: scale(1.1); background: #5588ff; }
        .btn-red { background: #cc3333; }
        .btn-red:hover { transform: scale(1.1); background: #ff4444; }
    </style>
</head>
<body>

    <canvas id="game"></canvas>

    <!-- LOADING -->
    <div id="loading-screen">
        <div class="spinner"></div>
        <h2 style="color:white; margin-top:20px;">Connecting to Server...</h2>
    </div>

    <!-- LOBBY -->
    <div id="lobby">
        <h1>WORMATE CLONE</h1>
        <input type="text" id="nickname-input" placeholder="Nickname" value="Player" maxlength="12">
        <button class="menu-btn btn-green" onclick="connect()">PLAY</button>
    </div>

    <!-- GAME UI -->
    <div id="ui-layer">
        <div id="minimap-container"><canvas id="minimap"></canvas></div>
        <div id="stats-ui">Score: <span id="score-val">0</span> | Kills: <span id="kill-val">0</span></div>
        
        <div id="status-box">
            <div id="buff-x2" class="buff" style="border-color: #ff9900">2x SCORE</div>
            <div id="buff-x5" class="buff" style="border-color: #ff3300">5x SCORE</div>
            <div id="buff-x10" class="buff" style="border-color: #ff0066">10x SCORE</div>
            <div id="buff-ae" class="buff" style="border-color: #00ffcc">CUTTING EDGE</div>
            <div id="buff-spd" class="buff" style="border-color: #aa00ff">SPEED</div>
        </div>

        <div id="leaderboard">
            <h3>Leaderboard <span id="online-count">(0 online)</span></h3>
            <div id="lb-content"></div>
        </div>
        <div id="clock-display">00:00</div>
    </div>

    <!-- OVERLAY / POPUP (Network Error / Game Over) -->
    <!-- We reuse the #game-over div for both scenarios -->
    <div id="game-over">
        <!-- Title changes dynamically -->
        <h1 id="overlay-title" style="font-size: 50px; color: #ff3333;">GAME OVER</h1>
        <p id="overlay-msg" style="font-size: 24px;">Length: <span id="final-score" style="color: #ffd700;">0</span></p>
        <div class="btn-group">
            <button id="btn-home" class="menu-btn btn-blue" onclick="goHome()">EXIT TO LOBBY</button>
            <button id="btn-play" class="menu-btn btn-green" onclick="restartGame()">PLAY AGAIN</button>
        </div>
    </div>

    <!-- ========================================== -->
    <!--               GAME.JS                      -->
    <!-- ========================================== -->
    <script>
        // ================= SERVER CONNECTION =================
        const SERVER_URL = "wss://snake-server-3bnw.onrender.com";
        
        let ws = null;
        let myId = null;
        let remotePlayers = {};
        let connectionActive = false;

        function connect() {
            const loadingScreen = document.getElementById("loading-screen");
            const lobby = document.getElementById("lobby");
            const input = document.getElementById("nickname-input");
            
            if (!loadingScreen || !lobby || !input) {
                console.error("HTML Elements missing");
                return;
            }

            playerName = input.value.trim() || "Player";
            lobby.style.display = "none"; 
            loadingScreen.style.display = "flex"; 
            
            connectToServer();
        }

        function connectToServer() {
            // Fix: Close any existing socket before creating new one
            if (ws) {
                ws.close();
                ws = null;
            }

            try {
                ws = new WebSocket(SERVER_URL);

                ws.onopen = () => { 
                    console.log("Connected to Game Server");
                    connectionActive = true;
                    // Note: initGame is called when server sends 'init' message
                };
                
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    handleMessage(data);
                };
                
                ws.onclose = () => {
                    console.log("Disconnected from Server");
                    connectionActive = false;
                    // FIX: Handle network error gracefully
                    handleNetworkError("NETWORK ERROR", "Connection lost. Please check your internet.");
                };

                ws.onerror = (err) => {
                    console.error("WebSocket Error:", err);
                    connectionActive = false;
                    handleNetworkError("CONNECTION ERROR", "Could not connect to server.");
                };
                
                setInterval(sendInput, 1000/30);

            } catch (e) {
                handleNetworkError("ERROR", "Failed to initialize WebSocket.");
                goHome();
            }
        }

        // --- NEW: Network Error Handler ---
        function handleNetworkError(title, msg) {
            // 1. Stop Game Logic
            isGameRunning = false;

            // 2. Hide Game UI Layer
            document.getElementById('ui-layer').style.display = 'none';
            
            // 3. Show Overlay Popup
            const overlay = document.getElementById('game-over');
            overlay.style.display = 'flex';
            
            // 4. Set Text
            document.getElementById('overlay-title').innerText = title;
            document.getElementById('overlay-msg').innerText = msg;

            // 5. Configure Buttons
            const btnPlay = document.getElementById('btn-play');
            const btnHome = document.getElementById('btn-home');

            btnPlay.innerText = "RETRY";
            btnHome.innerText = "EXIT TO LOBBY";
            
            // 6. Override Clicks for Network Error
            btnPlay.onclick = () => {
                overlay.style.display = 'none'; // Hide overlay
                connect(); // Try connecting again
            };
            
            btnHome.onclick = () => {
                goHome();
            };
        }

        function sendInput() {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            const dx = mouse.x - canvas.width/2;
            const dy = mouse.y - canvas.height/2;
            const angle = Math.atan2(dy, dx);

            ws.send(JSON.stringify({
                type: 'input',
                angle: angle,
                boost: boosting,
                name: entities[myId] ? entities[myId].name : "" 
            }));
        }

        function goHome() {
            // Clean up socket if exists
            if (ws) {
                ws.close();
                ws = null;
            }
            // Return to Lobby
            document.getElementById('game-over').style.display = 'none';
            document.getElementById('ui-layer').style.display = 'none';
            document.getElementById('loading-screen').style.display = 'none';
            document.getElementById('lobby').style.display = 'flex';
            
            // Reset Game State
            isGameRunning = false;
            myId = null;
            remotePlayers = {};
            connectionActive = false;
            // Reset vars
            food.length = 0;
            powerups.length = 0;
            killCount = 0;
            playerIsUnder = false;
        }

        /* ================= GLOBAL SETUP ================= */
        const canvas = document.getElementById("game");
        const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
        const minimapCanvas = document.getElementById("minimap");
        const miniCtx = minimapCanvas.getContext("2d", { desynchronized: true });

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            minimapCanvas.width = 150;
            minimapCanvas.height = 150;
        }
        resize();
        window.addEventListener("resize", resize);

        /* ================= CONFIGURATION ================= */
        const SEGMENT_SPACING = 5;
        const PATH_SPACING = 5;
        const MAP_RADIUS = 6000;

        const BASE_SPEED = 2.0;
        const MANUAL_BOOST_ADD = 2.2;
        const POWERUP_SPEED_MULT = 1.5;

        // Turning Physics
        const TURN_SPEED_WIDE = 0.075;
        const TURN_SPEED_BOOST = 0.12;
        const TURN_SPEED_SHARP = 0.18;
        const MASS_LOSS_PER_TICK = 0.03;

        const UNDER_RATIO = 0.60;
        const COLLISION_OVER_RATIO = 1.00;

        /* ================= GAME VARIABLES ================= */
        let isGameRunning = false;
        let isGameOver = false;
        let gameTime = 0;
        let startTime = 0;
        let zoom = 1.0;
        let playerName = "Player";
        let playerColor = "#ff66cc";

        let head = { x: 0, y: 0, angle: 0 };
        let length = 50;
        let path = [];
        let food = [];
        let powerups = [];
        let killCount = 0;
        let hsCount = 0;
        let playerIsUnder = false;

        let expiries = { x2: 0, x5: 0, x10: 0, ae: 0, spd: 0 };

        let lastTime = performance.now();
        let frameCount = 0;
        let lastFpsUpdate = 0;

        const BOT_COUNT = 25;
        let bots = Array.from({ length: BOT_COUNT }, (_, i) => ({
            name: `Bot_${String(i + 1).padStart(3, '0')}`,
            score: 0,
            x: 0, y: 0,
            angle: 0,
            path: [],
            color: "#00ff00"
        }));

        /* ================= INPUT HANDLING ================= */
        let mouse = { x: canvas.width / 2, y: canvas.height / 2 };
        let moving = true;
        let boosting = false;

        window.addEventListener("mousemove", e => {
            mouse.x = e.clientX;
            mouse.y = e.clientY;
        });
        window.addEventListener("mousedown", () => boosting = true);
        window.addEventListener("mouseup", () => boosting = false);

        window.addEventListener("wheel", e => {
            const zoomSpeed = 0.001;
            zoom -= e.deltaY * zoomSpeed;
            if (zoom < 0.3) zoom = 0.3;
            if (zoom > 1.5) zoom = 1.5;
        }, { passive: true });

        /* ================= GAME LIFECYCLE ================= */

        function initGame() {
            food.length = 0;
            powerups.length = 0;
            bots.forEach(resetBot);

            // RANDOM SAFE SPAWN LOGIC
            let safe = false;
            let attempts = 0;
            let startX = 0, startY = 0;

            while (!safe && attempts < 200) {
                startX = (Math.random() - 0.5) * (MAP_RADIUS * 1.8);
                startY = (Math.random() - 0.5) * (MAP_RADIUS * 1.8);

                let tooClose = false;
                for (const bot of bots) {
                    if (Math.hypot(startX - bot.x, startY - bot.y) < 500) { tooClose = true; break; }
                }
                if (!tooClose) safe = true;
                attempts++;
            }

            head = { x: startX, y: startY, angle: Math.random() * Math.PI * 2 };
            length = 50;

            path = [];
            for (let i = 0; i < length * SEGMENT_SPACING; i += SEGMENT_SPACING) {
                path.push({ x: startX, y: startY });
            }

            food = [];
            powerups = [];
            killCount = 0;
            hsCount = 0;
            updateStatsUI();

            isGameOver = false;
            isGameRunning = true;
            startTime = Date.now();
            lastTime = performance.now();

            playerColor = `hsl(${Math.random() * 360}, 100%, 50%)`;

            expiries = { x2: 0, x5: 0, x10: 0, ae: 0, spd: 0 };

            for (let i = 0; i < 3000; i++) spawnFood();
            for (let i = 0; i < 120; i++) spawnPowerup();

            document.getElementById('game-over').style.display = 'none';
            document.getElementById('ui-layer').style.display = 'block';
        }

        function resetBot(bot) {
            bot.x = (Math.random() - 0.5) * MAP_RADIUS * 1.5;
            bot.y = (Math.random() - 0.5) * MAP_RADIUS * 1.5;
            bot.angle = Math.random() * Math.PI * 2;
            bot.path = [];
            bot.length = 700;
            bot.score = Math.floor(bot.length * 10);
            bot.color = `hsl(${Math.random() * 360}, 100%, 50%)`;
            for (let k = 0; k < bot.length * SEGMENT_SPACING; k += SEGMENT_SPACING) {
                bot.path.push({ x: bot.x, y: bot.y });
            }
        }

        /* ================= ENTITY MANAGEMENT ================= */
        function spawnFood(x, y, val, colorOverride) {
            const type = Math.floor(Math.random() * 3);
            let r = val || (7 + Math.random() * 3);
            const now = Date.now();

            if (x !== undefined && y !== undefined) {
                food.push({
                    x: x, y: y,
                    r: r * 1.15,
                    color: colorOverride || `hsl(${Math.random() * 360}, 100%, 50%)`,
                    type: type,
                    angle: Math.random() * Math.PI * 2,
                    spawnTime: now,
                    isDrops: true,
                    noGlow: false,
                    vx: 0, vy: 0
                });
                return;
            }

            const angle = Math.random() * Math.PI * 2;
            const dist = Math.sqrt(Math.random()) * (MAP_RADIUS - 50);
            food.push({
                x: Math.cos(angle) * dist, y: Math.sin(angle) * dist,
                r: r,
                color: `hsl(${Math.random() * 360}, 100%, 50%)`,
                type: type,
                angle: Math.random() * Math.PI * 2,
                spawnTime: 0,
                isDrops: false,
                vx: 0, vy: 0
            });
        }

        function spawnPowerup() {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * (MAP_RADIUS - 100);
            const types = ['2x', '5x', '10x', 'ae', 'spd'];
            const type = types[Math.floor(Math.random() * types.length)];
            let color = '#fff', label = type;

            if (type === '2x') color = '#ff9900';
            if (type === '5x') color = '#ff3300';
            if (type === '10x') color = '#ff0066';
            if (type === 'ae') { color = '#00ffcc'; label = "Turn"; }
            if (type === 'spd') { color = '#aa00ff'; label = "Speed"; }

            powerups.push({
                x: Math.cos(angle) * r, y: Math.sin(angle) * r,
                type: type, label: label,
                color: color, r: 15
            });
        }

        function getRenderedBodyPoints(path, headX, headY, maxLen) {
            const smooth = path;
            const h = { x: headX, y: headY };

            const points = [];
            let dist = 0;
            let target = SEGMENT_SPACING;
            let prev = h;

            for (let i = smooth.length - 1; i >= 0; i--) {
                const curr = smooth[i];
                const d = Math.hypot(prev.x - curr.x, prev.y - curr.y);

                while (dist + d >= target) {
                    const t = (target - dist) / d;
                    points.push({
                        x: prev.x + (curr.x - prev.x) * t,
                        y: prev.y + (curr.y - prev.y) * t
                    });
                    target += SEGMENT_SPACING;
                    if (points.length >= maxLen) return points;
                }
                dist += d;
                prev = curr;
            }
            return points;
        }

        function explodeWorm(pathArr, skinColor) {
            const body = getRenderedBodyPoints(pathArr, pathArr[pathArr.length - 1]?.x || 0, pathArr[pathArr.length - 1]?.y || 0, pathArr.length);
            let i = 0;

            function spawnBatch() {
                let count = 0;
                while (i < body.length && count < 20) {
                    const p = body[i];
                    spawnFood(
                        p.x + (Math.random() - 0.5) * 2,
                        p.y + (Math.random() - 0.5) * 2,
                        5 + Math.random() * 10,
                        skinColor
                    );
                    i += 4;
                    count++;
                }
                if (i < body.length) {
                    requestAnimationFrame(spawnBatch);
                }
            }

            spawnBatch();
        }

        /* ================= UPDATE LOOP ================= */
        function update(dt) {
            if (!connectionActive) return;
            if (isGameOver || !isGameRunning) return;

            const now = Date.now();
            gameTime += 0.05 * dt;

            // Clock Update
            const elapsed = Math.floor((now - startTime) / 1000);
            const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const secs = (elapsed % 60).toString().padStart(2, '0');
            document.getElementById('clock-display').innerText = `${mins}:${secs}`;

            // Buffs
            updateBuffUI('buff-x2', 'time-x2', expiries.x2, now);
            updateBuffUI('buff-x5', 'time-x5', expiries.x5, now);
            updateBuffUI('buff-x10', 'time-x10', expiries.x10, now);
            updateBuffUI('buff-ae', 'time-ae', expiries.ae, now);
            updateBuffUI('buff-spd', 'time-spd', expiries.spd, now);

            let currentMult = 1;
            if (now < expiries.x2) currentMult *= 2;
            if (now < expiries.x5) currentMult *= 5;
            if (now < expiries.x10) currentMult *= 10;

            let spd = BASE_SPEED;

            if (boosting && length > 20) {
                let boostAmount = MANUAL_BOOST_ADD;
                if (now < expiries.spd) boostAmount *= POWERUP_SPEED_MULT;

                spd += boostAmount;
                length -= MASS_LOSS_PER_TICK * dt;
            }

            const isSharp = (now < expiries.ae);

            // Player Turning
            const dx = mouse.x - canvas.width / 2;
            const dy = mouse.y - canvas.height / 2;
            const distToMouse = Math.hypot(dx, dy);

            if (distToMouse > 20) {
                const targetAngle = Math.atan2(dy, dx);
                let baseTurnSpeed = TURN_SPEED_WIDE;
                if (boosting) baseTurnSpeed = TURN_SPEED_BOOST;
                if (isSharp) baseTurnSpeed = TURN_SPEED_SHARP;

                let turnSpd = baseTurnSpeed * dt;
                if (turnSpd > 0.35) turnSpd = 0.35;
                head.angle = lerpAngle(head.angle, targetAngle, turnSpd);
            }

            // Player Movement
            if (moving) {
                head.x += Math.cos(head.angle) * spd * dt;
                head.y += Math.sin(head.angle) * spd * dt;

                const last = path[path.length - 1];
                if (!last || Math.hypot(head.x - last.x, head.y - last.y) >= PATH_SPACING) {
                    path.push({ x: head.x, y: head.y });
                }
            }

            const maxPath = length * SEGMENT_SPACING + 150;
            if (path.length > maxPath) path.splice(0, path.length - maxPath);

            // Send Data to Server
            if (ws && ws.readyState === WebSocket.OPEN) {
                // Throttle to 20Hz
                if (now % 50 < 17) {
                    const payload = {
                        type: 'update',
                        x: head.x,
                        y: head.y,
                        angle: head.angle,
                        length: length,
                        path: path,
                        name: playerName,
                        color: playerColor
                    };
                    ws.send(JSON.stringify(payload));
                }
            }

            if (Math.hypot(head.x, head.y) > MAP_RADIUS) {
                // FIX: Handle Disconnect gracefully instead of hard game over
                ws.send(JSON.stringify({ type: 'quit' }));
                ws.close();
                handleNetworkError("GAME OVER", "You hit the map border.");
                return;
            }

            // Food Physics + Collision
            for (let i = food.length - 1; i >= 0; i--) {
                const f = food[i];

                if (f.isDrops && (now - f.spawnTime > 40000)) {
                    food.splice(i, 1);
                    continue;
                }

                if (Math.abs(head.x - f.x) > 50 || Math.abs(head.y - f.y) > 50) continue;

                if (Math.hypot(head.x - f.x, head.y - f.y) < getWormRadius(length) + f.r + 10) {
                    const growthFactor = Math.max(0.1, 50 / length);
                    length += (f.r / 4) * currentMult * growthFactor;

                    food.splice(i, 1);
                    if (!f.isDrops) spawnFood();
                }
            }

            // Powerups Collision
            for (let i = powerups.length - 1; i >= 0; i--) {
                const p = powerups[i];
                p.x += Math.cos(gameTime + i) * 0.5 * dt;
                if (Math.abs(head.x - p.x) > 50 || Math.abs(head.y - p.y) > 50) continue;
                if (Math.hypot(head.x - p.x, head.y - p.y) < getWormRadius(length) + p.r + 10) {
                    applyPowerup(p.type);
                    powerups.splice(i, 1);
                    setTimeout(spawnPowerup, 5000);
                }
            }

            updateBots(dt);
            checkCombat();
            updateLeaderboardUI();
        }

        function updateBots(dt) {
            bots.forEach(bot => {
                if (Math.random() < 0.05 * dt) {
                    bot.targetAngle = (Math.random() * Math.PI * 2);
                }
                if (Math.hypot(bot.x, bot.y) > MAP_RADIUS - 200) {
                    bot.targetAngle = Math.atan2(-bot.y, -bot.x);
                }
                bot.angle = lerpAngle(bot.angle, bot.targetAngle || bot.angle, 0.05 * dt);
                bot.x += Math.cos(bot.angle) * BASE_SPEED * dt;
                bot.y += Math.sin(bot.angle) * BASE_SPEED * dt;

                const last = bot.path[bot.path.length - 1];
                if (!last || Math.hypot(bot.x - last.x, bot.y - last.y) >= PATH_SPACING) {
                    bot.path.push({ x: bot.x, y: bot.y });
                }
                const maxPath = bot.length * SEGMENT_SPACING + 150;
                if (bot.path.length > maxPath) bot.path.splice(0, bot.path.length - maxPath);

                bot.score = Math.floor(bot.length * 10);
            });
        }

        /* ================= COMBAT LOGIC ================= */
        function getCollisionPath(path, headX, headY, maxLen) {
            return getRenderedBodyPoints(path, headX, headY, maxLen);
        }

        function isHeadUnderEnemy(head, enemyCollPath, enemyLen) {
            const enemyR = getWormRadius(enemyLen);
            const underR = enemyR * UNDER_RATIO;
            const skipTail = Math.min(30, Math.floor(enemyCollPath.length * 0.15));

            for (let k = 0; k < enemyCollPath.length - skipTail; k += 2) {
                const p = enemyCollPath[k];
                const dx = head.x - p.x;
                const dy = head.y - p.y;
                if (Math.abs(dx) > underR + 2 || Math.abs(dy) > underR + 2) continue;
                if (Math.hypot(dx, dy) < underR) return true;
            }
            return false;
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

        function checkCombat() {
            if (isGameOver || !isGameRunning) return;

            playerIsUnder = false;

            const myR = getWormRadius(length);

            const checkHit = (attackerHead, victimPath, victimLen, attackerHeadRadius) => {
                const victimR = getWormRadius(victimLen);
                const underR = victimR * UNDER_RATIO;
                const overR = victimR * COLLISION_OVER_RATIO + attackerHeadRadius * 0.05;
                const skipTail = Math.min(6, Math.floor(victimPath.length * 0.2));

                for (let k = 0; k < victimPath.length - skipTail; k += 3) {
                    const p = victimPath[k];
                    const dx = attackerHead.x - p.x;
                    const dy = attackerHead.y - p.y;
                    if (Math.abs(dx) > overR + 6 || Math.abs(dy) > overR + 6) continue;

                    const d = Math.hypot(dx, dy);
                    if (d < underR) continue;
                    if (d < overR) return true;
                }
                return false;
            };

            const checkHeadshotTouch = (attackerHead, victimNeckPath, victimLen, attackerLen) => {
                const victimR = getWormRadius(victimLen);
                const attackerR = getWormRadius(attackerLen);
                const hsR = victimR * 0.60 + attackerR * 0.60;

                for (let k = 0; k < victimNeckPath.length; k += 2) {
                    const p = victimNeckPath[k];
                    const dx = attackerHead.x - p.x;
                    const dy = attackerHead.y - p.y;
                    if (Math.abs(dx) > hsR + 4 || Math.abs(dy) > hsR + 4) continue;
                    if (Math.hypot(dx, dy) < hsR) return true;
                }
                return false;
            };

            const resolveHeadOn = (a, b, aLen, bLen, aColl, bColl) => {
                const dist = Math.hypot(a.x - b.x, a.y - b.y);
                const minR = Math.min(getWormRadius(aLen), getWormRadius(bLen));

                if (dist < (minR * 2.2) && dist > (minR * 0.55)) {
                    const distA = Math.hypot(a.x, a.y);
                    const distB = Math.hypot(b.x, b.y);
                    const dotA = (-a.x * Math.cos(a.angle)) + (-a.y * Math.sin(a.angle));
                    const dotB = (-b.x * Math.cos(b.angle)) + (-b.y * Math.sin(b.angle));

                    if (distA > distB && dotA > 0) return 1;
                    if (distB > distA && dotB > 0) return 2;
                    return 3;
                }

                const neckDistA = getWormRadius(aLen) * 2.2;
                const neckDistB = getWormRadius(bLen) * 2.2;
                const aNeck = getNeckByDistance(aColl, neckDistA);
                const bNeck = getNeckByDistance(bColl, neckDistB);

                const aHitsBNeck = checkHeadshotTouch(a, bNeck, bLen, aLen);
                const bHitsANeck = checkHeadshotTouch(b, aNeck, aLen, bLen);

                if (aHitsBNeck && bHitsANeck) return 3;
                if (aHitsBNeck) return 1;
                if (bHitsANeck) return 2;
                return 0;
            };

            const playerCollPath = getCollisionPath(path, head.x, head.y, length - 3);
            const botCollPaths = new Array(bots.length);
            for (let i = 0; i < bots.length; i++) {
                const b = bots[i];
                botCollPaths[i] = getCollisionPath(b.path, b.x, b.y, b.length - 3);
            }

            // 1. Player vs Bots
            for (let i = 0; i < bots.length; i++) {
                let b = bots[i];

                if (isHeadUnderEnemy(head, botCollPaths[i], b.length)) {
                    playerIsUnder = true;
                }

                if (checkHit(head, botCollPaths[i], b.length, myR)) {
                    triggerGameOver();
                    return;
                }

                if (playerCollPath.length > 30 && checkHit(b, playerCollPath, length, getWormRadius(b.length))) {
                    killBot(i);
                    killCount++;
                    updateStatsUI();
                    continue;
                }

                const res = resolveHeadOn(head, b, length, b.length, playerCollPath, botCollPaths[i]);
                if (res === 1) {
                    killBot(i);
                    hsCount++;
                    updateStatsUI();
                    continue;
                }
                else if (res === 2) { triggerGameOver(); return; }
                else if (res === 3) { triggerGameOver(); return; }
            }

            // 2. Player vs Remote Players (Under Check Only)
            for (const rp of Object.values(remotePlayers)) {
                if (!rp || !rp.path) continue;
                const rpLen = rp.length || 50;
                const rpColl = getCollisionPath(rp.path, rp.x, rp.y, rpLen - 3);

                if (isHeadUnderEnemy(head, rpColl, rpLen)) {
                    playerIsUnder = true;
                    break;
                }
            }
        }

        function updateStatsUI() {
            document.getElementById('kill-val').innerText = killCount;
            document.getElementById('score-val').innerText = Math.floor(length * 10);
        }

        function killBot(index) {
            const b = bots[index];
            explodeWorm(b.path, b.color);
            resetBot(b);
        }

        function updateBuffUI(id, timeId, expiry, now) {
            const el = document.getElementById(id);
            if (now < expiry) {
                el.style.display = 'flex';
                const left = Math.ceil((expiry - now) / 1000);
                const timeEl = document.getElementById(timeId);
                if(timeEl) timeEl.innerText = left + "s";
            } else {
                el.style.display = 'none';
            }
        }

        function applyPowerup(type) {
            const duration = 30000;
            const now = Date.now();
            if (type === '2x') expiries.x2 = now + duration;
            if (type === '5x') expiries.x5 = now + duration;
            if (type === '10x') expiries.x10 = now + duration;
            if (type === 'ae') expiries.ae = now + duration;
            if (type === 'spd') expiries.spd = now + duration;
        }

        function triggerGameOver() {
            if (isGameOver) return;

            isGameOver = true;
            isGameRunning = false;

            // Explicitly tell server to remove us
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'quit' }));
                ws.close();
            }

            explodeWorm(path, playerColor);
            
            // Show Game Over UI
            const overlay = document.getElementById('game-over');
            overlay.style.display = 'flex';
            
            // Reset Text for Game Over
            document.getElementById('overlay-title').innerText = "GAME OVER";
            document.getElementById('overlay-msg').innerText = `Score: ${Math.floor(length * 10)}`;
            
            // Reset Buttons for Game Over
            const btnPlay = document.getElementById('btn-play');
            const btnHome = document.getElementById('btn-home');
            
            btnPlay.innerText = "PLAY AGAIN";
            btnHome.innerText = "GO HOME";
            
            // Override Clicks for Game Over
            btnPlay.onclick = () => {
                overlay.style.display = 'none';
                restartGame();
            };
            
            btnHome.onclick = () => {
                goHome();
            };
        }

        function restartGame() {
            // Ensure we are in a clean state
            const overlay = document.getElementById('game-over');
            overlay.style.display = 'none';
            // Reset Buttons to Default (handled in overlay logic)
            const btnPlay = document.getElementById('btn-play');
            const btnHome = document.getElementById('btn-home');
            btnPlay.innerText = "PLAY AGAIN";
            btnHome.innerText = "GO HOME";
            
            connect();
        }

        /* ================= DRAWING / RENDERER ================= */
        function isPointUnderWorm(x, y, worm) {
            if (!worm || !worm.path) return false;

            const wormR = getWormRadius(worm.length || 50);
            const underR = wormR * UNDER_RATIO;
            const underR2 = underR * underR;

            const coll = getCollisionPath(worm.path, worm.x, worm.y, (worm.length || 50) - 3);
            const maxK = Math.floor(coll.length * 0.7);

            for (let k = 0; k < maxK; k += 3) {
                const p = coll[k];
                const dx = x - p.x;
                const dy = y - p.y;
                if (dx * dx + dy * dy < underR2) return true;
            }
            return false;
        }

        function draw() {
            ctx.fillStyle = "#0b0b12";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            if (!isGameRunning) return;

            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.scale(zoom, zoom);
            ctx.translate(-head.x, -head.y);

            // Viewport Culling
            const visibleW = canvas.width / zoom;
            const visibleH = canvas.height / zoom;
            const viewLeft = head.x - visibleW / 2 - 200;
            const viewRight = head.x + visibleW / 2 + 200;
            const viewTop = head.y - visibleH / 2 - 200;
            const viewBottom = head.y + visibleH / 2 + 200;

            // Draw Map Border
            ctx.beginPath();
            ctx.arc(0, 0, MAP_RADIUS, 0, Math.PI * 2);
            ctx.strokeStyle = "#ff3333";
            ctx.lineWidth = 20;
            ctx.stroke();
            ctx.fillStyle = "#161621";
            ctx.fill();

            // Grid
            ctx.save();
            ctx.clip();
            ctx.strokeStyle = "#2a2a35";
            ctx.lineWidth = 1;
            ctx.beginPath();

            const gridStep = 100;
            const startX = Math.max(-MAP_RADIUS, Math.floor(viewLeft / gridStep) * gridStep);
            const endX = Math.min(MAP_RADIUS, Math.ceil(viewRight / gridStep) * gridStep);
            const startY = Math.max(-MAP_RADIUS, Math.floor(viewTop / gridStep) * gridStep);
            const endY = Math.min(MAP_RADIUS, Math.ceil(viewBottom / gridStep) * gridStep);

            for (let i = startX; i <= endX; i += gridStep) {
                ctx.moveTo(i, -MAP_RADIUS); ctx.lineTo(i, MAP_RADIUS);
            }
            for (let i = startY; i <= endY; i += gridStep) {
                ctx.moveTo(-MAP_RADIUS, i); ctx.lineTo(MAP_RADIUS, i);
            }
            ctx.stroke();
            ctx.restore();

            // Food
            for (const f of food) {
                if (f.x < viewLeft || f.x > viewRight || f.y < viewTop || f.y > viewBottom) continue;
                drawFood(ctx, f);
            }

            // Powerups
            for (const p of powerups) {
                if (p.x < viewLeft || p.x > viewRight || p.y < viewTop || p.y > viewBottom) continue;
                ctx.save();
                ctx.translate(p.x, p.y);
                const scale = 1 + Math.sin(gameTime * 2) * 0.1;
                ctx.scale(scale, scale);
                ctx.fillStyle = "rgba(0,0,0,0.5)";
                ctx.beginPath();
                ctx.arc(3, 3, p.r, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(0, 0, p.r, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "white";
                ctx.font = "bold 10px Arial";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(p.label, 0, 0);
                ctx.restore();
            }

            // Draw Bots and Player with Layering
            drawBots(visibleW, visibleH);
            drawRemotePlayers(visibleW, visibleH);
            drawPlayerBody(visibleW, visibleH);

            drawMinimap();
            ctx.restore();
        }

        function drawBots(visibleW, visibleH) {
            bots.forEach(bot => {
                drawGenericSnake(bot, visibleW, visibleH);
            });
        }

        function drawRemotePlayers(visibleW, visibleH) {
            Object.values(remotePlayers).forEach(p => {
                drawGenericSnake(p, visibleW, visibleH);
            });
        }

        function drawGenericSnake(bot, visibleW, visibleH) {
            if (Math.abs(bot.x - head.x) > visibleW && Math.abs(bot.y - head.y) > visibleH) return;

            const dxB = bot.x - head.x;
            const dyB = bot.y - head.y;
            const distB = Math.hypot(dxB, dyB);
            const maxDrawSegments = distB > 2000 ? Math.min(bot.length, 25) :
                distB > 1200 ? Math.min(bot.length, 60) :
                    bot.length;

            const botR = getWormRadius(bot.length);
            if (!bot.path) bot.path = [];

            const pointsToDraw = getRenderedBodyPoints(bot.path, bot.x, bot.y, maxDrawSegments);

            // FAKE SHADOW / GLOW LAYER
            if (distB < 1200) {
                ctx.fillStyle = "rgba(0,0,0,0.2)";
                for (let i = pointsToDraw.length - 1; i >= 0; i--) {
                    const p = pointsToDraw[i];
                    ctx.beginPath();
                    ctx.arc(p.x + 3, p.y + 3, botR, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // MAIN BODY DRAW
            const hasSkin = false; // Use skin for bots too

            // Draw Segments
            for (let i = pointsToDraw.length - 1; i >= 0; i--) {
                const p = pointsToDraw[i];
                ctx.fillStyle = bot.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, botR, 0, Math.PI*2);
                ctx.fill();
                if (distB < 1600) drawSegmentOverlay(ctx, p.x, p.y, botR);
            }

            // Head
            ctx.fillStyle = bot.color;
            ctx.beginPath();
            ctx.arc(bot.x, bot.y, botR * 1.05, 0, Math.PI * 2);
            ctx.fill();

            drawWormateFace(ctx, bot.x, bot.y, bot.angle, botR);

            if (distB < 900) {
                ctx.fillStyle = "white";
                ctx.font = "12px Arial";
                ctx.textAlign = "center";
                ctx.fillText(bot.name, bot.x, bot.y - 15);
            }
        }

        function drawPlayerBody(visibleW, visibleH) {
            if (!isGameOver) {
                const playerR = getWormRadius(length);
                const underTint = playerIsUnder ? 0.92 : 1.0;
                ctx.globalAlpha = underTint;

                const pointsToDraw = getRenderedBodyPoints(path, head.x, head.y, length);

                // Determine segments (Under vs Over)
                const underSegs = [];
                const overSegs = [];
                const enemies = [...bots, ...Object.values(remotePlayers)];

                for (let i = 0; i < pointsToDraw.length; i++) {
                    const p = pointsToDraw[i];
                    let under = false;
                    // Optimization: Distance check
                    for (const e of enemies) {
                        if (Math.abs(p.x - e.x) < 200 && Math.abs(p.y - e.y) < 200) {
                            if (isPointUnderWorm(p.x, p.y, e)) {
                                under = true;
                                break;
                            }
                        }
                    }
                    (under ? underSegs : overSegs).push(p);
                }

                // 1. Draw Glow/Shadow for UNDER segments
                underSegs.forEach((p, index) => {
                    ctx.fillStyle = "rgba(0,0,0,0.2)";
                    ctx.beginPath();
                    ctx.arc(p.x + 3, p.y + 3, playerR, 0, Math.PI * 2);
                    ctx.fill();
                });

                // 2. Draw UNDER Segments
                for (let i = underSegs.length - 1; i >= 0; i--) {
                    const p = underSegs[i];
                    ctx.fillStyle = playerColor;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, playerR, 0, Math.PI * 2);
                    ctx.fill();
                    drawSegmentOverlay(ctx, p.x, p.y, playerR);
                }

                // 3. Draw Glow/Shadow for OVER segments
                overSegs.forEach((p, index) => {
                    ctx.fillStyle = "rgba(0,0,0,0.2)";
                    ctx.beginPath();
                    ctx.arc(p.x + 3, p.y + 3, playerR, 0, Math.PI * 2);
                    ctx.fill();
                });

                // 4. Draw OVER Segments
                for (let i = overSegs.length - 1; i >= 0; i--) {
                    const p = overSegs[i];
                    ctx.fillStyle = playerColor;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, playerR, 0, Math.PI * 2);
                    ctx.fill();
                    drawSegmentOverlay(ctx, p.x, p.y, playerR);
                }

                // Head
                ctx.fillStyle = playerColor;
                ctx.beginPath();
                ctx.arc(head.x, head.y, playerR * 1.05, 0, Math.PI * 2);
                ctx.fill();

                drawWormateFace(ctx, head.x, head.y, head.angle, playerR);
                ctx.globalAlpha = 1;
            }
        }

        function drawSegmentOverlay(ctx, x, y, r) {
            ctx.fillStyle = "rgba(0,0,0,0.2)";
            ctx.beginPath();
            ctx.arc(x - r * 0.25, y, r * 0.92, 0, Math.PI * 2);
            ctx.fill();
        }

        function drawWormateFace(ctx, x, y, angle, r) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);

            const eyeX = r * 0.35;
            const eyeY = r * 0.28;
            const eyeR = r * 0.35;

            ctx.fillStyle = "white";
            ctx.strokeStyle = "black";
            ctx.lineWidth = Math.max(2, r * 0.12);

            ctx.beginPath();
            ctx.arc(eyeX, -eyeY, eyeR, 0, Math.PI * 2);
            ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = "black";
            const pupilR = eyeR * 0.28;
            ctx.beginPath();
            ctx.arc(eyeX + eyeR * 0.15, -eyeY, pupilR, 0, Math.PI * 2);
            ctx.arc(eyeX + eyeR * 0.15, eyeY, pupilR, 0, Math.PI * 2);
            ctx.arc(eyeX + eyeR * 0.15, eyeY, pupilR, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = "#e43b3b";
            ctx.lineWidth = Math.max(2, r * 0.14);
            ctx.lineCap = "round";

            const mouthX = r * 0.55;
            const mouthY = 0;
            const mouthR = r * 0.55;

            ctx.beginPath();
            ctx.arc(mouthX, mouthY, mouthR, -0.55, 0.55);
            ctx.stroke();

            ctx.restore();
        }

        function drawFood(ctx, f) {
            ctx.save();
            ctx.translate(f.x, f.y);
            ctx.rotate(f.angle + gameTime * 0.1);
            ctx.fillStyle = f.color;

            ctx.strokeStyle = "rgba(0,0,0,0.25)";
            ctx.lineWidth = Math.max(1, f.r * 0.18);

            if (f.isDrops && !f.noGlow) {
                ctx.save();
                ctx.translate(3, 3);
                ctx.fillStyle = "rgba(0,0,0,0.3)";
                ctx.beginPath();
                if (f.type === 0) {
                    ctx.arc(0, 0, f.r, 0, Math.PI * 2);
                    ctx.arc(0, 0, f.r * 0.4, 0, Math.PI * 2, true);
                } else {
                    ctx.arc(0, 0, f.r, 0, Math.PI * 2);
                }
                ctx.fill();
                ctx.restore();
            }

            if (f.type === 0) {
                ctx.beginPath();
                ctx.arc(0, 0, f.r, 0, Math.PI * 2);
                ctx.arc(0, 0, f.r * 0.4, 0, Math.PI * 2, true);
                ctx.fill();
                ctx.stroke();
            } else if (f.type === 1) {
                ctx.beginPath();
                ctx.arc(0, 0, f.r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                ctx.strokeStyle = "rgba(255,255,255,0.5)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, f.r * 0.6, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(0, 0, f.r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = "rgba(0,0,0,0.3)";
                ctx.beginPath();
                ctx.arc(-f.r * 0.3, -f.r * 0.3, f.r * 0.2, 0, Math.PI * 2);
                ctx.arc(f.r * 0.3, f.r * 0.2, f.r * 0.2, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.globalAlpha = 0.22;
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(-f.r * 0.25, -f.r * 0.25, f.r * 0.35, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;

            ctx.restore();
        }

        function drawMinimap() {
            miniCtx.fillStyle = "rgba(20, 20, 30, 0.8)";
            miniCtx.fillRect(0, 0, 150, 150);

            miniCtx.strokeStyle = "rgba(255, 255, 255, 0.3)";
            miniCtx.lineWidth = 1;
            miniCtx.beginPath();
            miniCtx.moveTo(0, 75); miniCtx.lineTo(150, 75);
            miniCtx.moveTo(75, 0); miniCtx.lineTo(75, 150);
            miniCtx.stroke();

            const scale = 150 / (MAP_RADIUS * 2);
            const centerX = 75;
            const centerY = 75;

            bots.forEach(bot => {
                const mx = centerX + bot.x * scale;
                const my = centerY + bot.y * scale;
                miniCtx.fillStyle = bot.color;
                miniCtx.beginPath();
                miniCtx.arc(mx, my, 2, 0, Math.PI * 2);
                miniCtx.fill();
            });

            Object.values(remotePlayers).forEach(p => {
                const mx = centerX + p.x * scale;
                const my = centerY + p.y * scale;
                miniCtx.fillStyle = p.color || "#fff";
                miniCtx.beginPath();
                miniCtx.arc(mx, my, 2, 0, Math.PI * 2);
                miniCtx.fill();
            });

            if (!isGameOver) {
                const px = centerX + head.x * scale;
                const py = centerY + head.y * scale;
                miniCtx.fillStyle = "white";
                miniCtx.beginPath();
                miniCtx.arc(px, py, 3, 0, Math.PI * 2);
                miniCtx.fill();
                miniCtx.strokeStyle = "black";
                miniCtx.stroke();
            }
        }

        /* ================= UTILS ================= */
        function lerpAngle(a, b, t) {
            let diff = b - a;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            return a + diff * t;
        }

        function getWormRadius(len) {
            // Start THICKER (minR increased from 11 to 20)
            const minR = 25;
            const maxR = 60;

            // Use Logarithmic scale so 100000 mass doesn't cover map
            const base = Math.log10(Math.max(len, 50));
            const t = Math.min(1, Math.max(0, (base - 1.7) / 4.0)); 
            return minR + (maxR - minR) * t;
        }

        function updateLeaderboardUI() {
            const myList = [...bots, ...Object.values(remotePlayers)];
            const onlineEl = document.getElementById('online-count');
            if (onlineEl) {
                const onlineCount = bots.length + Object.keys(remotePlayers).length;
                onlineEl.innerText = `(${onlineCount} online)`;
            }

            const myScore = Math.floor(length * 10);
            myList.push({ name: playerName || "You", score: myScore, isMe: true });
            myList.sort((a, b) => b.score - a.score);
            const lbDiv = document.getElementById('lb-content');
            let html = '';
            myList.slice(0, 10).forEach((p, index) => {
                const className = p.isMe ? "lb-row lb-me" : "lb-row";
                html += `<div class="${className}"><span>#${index + 1} ${p.name}</span><span>${p.score}</span></div>`;
            });
            lbDiv.innerHTML = html;
        }

        /* ================= MAIN LOOP ================= */
        function loop() {
            requestAnimationFrame(loop);

            const now = performance.now();
            let dt = (now - lastTime) / (1000 / 60);
            lastTime = now;
            if (dt > 10) dt = 1;

            frameCount++;
            if (now - lastFpsUpdate >= 1000) {
                // const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
                lastFpsUpdate = now;
                frameCount = 0;
            }

            update(dt);
            draw();
        }

        loop();
    </script>
</body>
</html>
