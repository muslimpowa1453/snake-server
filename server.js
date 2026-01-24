const WebSocket = require('ws');

// ============== AYARLAR ==============
const PORT = process.env.PORT || 8080;
const TICK_RATE = 30;             // Saniyede 30 güncelleme (En stabil hız)
const STATE_SEND_RATE = 30;       // İstemciye gönderme hızı (Eşitlendi)
const WORLD_RADIUS = 5000;
const WORLD_CENTER = 5000;
const MAX_BOTS = 10;
const MAX_FOOD = 800;             // Yem sayısını biraz düşürdük, performansı artırır

// İstemci (Frontend) ile uyumlu ayarlar
const SNAKE_START_SPEED = 150;
const SNAKE_BOOST_MULTIPLIER = 2.0;
const SNAKE_TURN_SPEED = 3.0;     // Hızlı dönüş (Senin ayarlarınla aynı)
const SNAKE_START_WIDTH = 25;
const MAX_BODY_PARTS = 250;

// ============== YARDIMCI FONKSİYONLAR ==============
function generateId() {
    return Math.random().toString(36).substring(2, 15);
}

function distance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
}

// ============== SNAKE SINIFI ==============
class Snake {
    constructor(id, name, skin, isBot = false) {
        this.id = id;
        this.name = name || 'Player';
        this.skin = skin || 'tr';
        this.isBot = isBot;
        this.isActive = true;

        // Rastgele doğma
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * (WORLD_RADIUS - 1000);
        this.x = WORLD_CENTER + Math.cos(angle) * dist;
        this.y = WORLD_CENTER + Math.sin(angle) * dist;
        this.rotation = Math.random() * Math.PI * 2;
        this.targetAngle = this.rotation;

        this.currentSpeed = SNAKE_START_SPEED;
        this.width = SNAKE_START_WIDTH;
        this.bodyPartsCount = 20;
        this.score = 0;
        this.isBoosting = false;
        
        // Hareket geçmişi
        this.pathHistory = [];
        // Başlangıç kuyruğu
        for (let i = 0; i < this.bodyPartsCount * 3; i++) {
            this.pathHistory.push({ x: this.x, y: this.y });
        }

        this.activeEffects = {};
        
        // Bot Yapay Zekası
        this.botTarget = { x: WORLD_CENTER, y: WORLD_CENTER };
        this.botTimer = 0;
    }

    get pointSeparation() {
        return this.width * 0.25;
    }

    update(dt) {
        if (!this.isActive) return;

        if (this.isBot) this.updateBotAI(dt);

        // --- DÖNÜŞ (ROTATION) ---
        let diff = this.targetAngle - this.rotation;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        const turnStep = SNAKE_TURN_SPEED * dt;
        if (Math.abs(diff) < turnStep) {
            this.rotation = this.targetAngle;
        } else {
            this.rotation += Math.sign(diff) * turnStep;
        }

        // --- HAREKET ---
        const targetSpeed = this.isBoosting ? SNAKE_START_SPEED * SNAKE_BOOST_MULTIPLIER : SNAKE_START_SPEED;
        this.currentSpeed += (targetSpeed - this.currentSpeed) * 0.1;

        // HASSAS HESAPLAMA (Yuvarlama YOK)
        this.x += Math.cos(this.rotation) * this.currentSpeed * dt;
        this.y += Math.sin(this.rotation) * this.currentSpeed * dt;

        // --- KUYRUK KAYDI ---
        // Her frame'de kayıt alıyoruz (En güvenlisi bu)
        this.pathHistory.unshift({ x: this.x, y: this.y });

        // Geçmişi temizle (Memory Leak önlemi)
        // Hesaplanan: (Uzunluk * Sıklık) + Pay
        const limit = (this.bodyPartsCount * 10) + 100;
        if (this.pathHistory.length > limit) {
            this.pathHistory.length = limit;
        }

        // --- BÜYÜME VE EFEKTLER ---
        if (this.score > (this.bodyPartsCount - 20) * 50 && this.bodyPartsCount < MAX_BODY_PARTS) {
            this.bodyPartsCount++;
        }

        const distCenter = distance(this.x, this.y, WORLD_CENTER, WORLD_CENTER);
        if (distCenter > WORLD_RADIUS) {
            // Sınıra çarpınca ölme (Şimdilik kapatıldı, test için geri sektirelim)
            const angleToCenter = Math.atan2(WORLD_CENTER - this.y, WORLD_CENTER - this.x);
            this.rotation = angleToCenter;
            this.targetAngle = angleToCenter;
            this.x += Math.cos(angleToCenter) * 50;
            this.y += Math.sin(angleToCenter) * 50;
        }
    }

    updateBotAI(dt) {
        this.botTimer -= dt;
        if (this.botTimer <= 0) {
            this.botTimer = Math.random() * 2 + 1;
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * 1000 + 500;
            this.botTarget = { x: this.x + Math.cos(angle) * dist, y: this.y + Math.sin(angle) * dist };
        }
        const dx = this.botTarget.x - this.x;
        const dy = this.botTarget.y - this.y;
        this.targetAngle = Math.atan2(dy, dx);
    }

    // İstemciye gidecek veri paketi
    toState() {
        // --- KRİTİK DÜZELTME ---
        // Koordinatları "Math.round" yapmıyoruz. Olduğu gibi (float) gönderiyoruz.
        // Yılanın "doğduğu yerde kalma" sorunu buradaydı.
        
        // Veri şişmesin diye pathHistory'yi biraz seyrelterek gönderelim
        const sendPath = [];
        const step = 2; // Her 2 noktadan 1'ini gönder (Kaliteyi bozmadan tasarruf)
        
        for (let i = 0; i < this.pathHistory.length; i += step) {
            sendPath.push(this.pathHistory[i]);
        }

        return {
            id: this.id,
            name: this.name,
            skin: this.skin,
            x: this.x,            // DÜZELTİLDİ: Hassas koordinat
            y: this.y,            // DÜZELTİLDİ: Hassas koordinat
            rotation: this.rotation,
            width: Math.round(this.width),
            bodyPartsCount: this.bodyPartsCount,
            score: Math.floor(this.score),
            pathPoints: sendPath, // DÜZELTİLDİ: İstemci "pathPoints" bekliyor
            isBoosting: this.isBoosting
        };
    }
    
    // Yılan öldüğünde yem saçmak için
    getBodyPositions() {
        // Yem saçmak için kaba pozisyonlar yeterli
        return this.pathHistory.filter((_, i) => i % 5 === 0);
    }
}

// ============== SUNUCU YÖNETİCİSİ ==============
class GameServer {
    constructor() {
        this.snakes = new Map();
        this.foods = new Map();
        this.foodIdCounter = 0;
        this.clients = new Map();
    }

    addPlayer(id, name, skin) {
        const s = new Snake(id, name, skin);
        this.snakes.set(id, s);
        console.log(`Oyuncu Eklendi: ${name} (${id})`);
        return s;
    }

    removePlayer(id) {
        if (this.snakes.has(id)) {
            console.log(`Oyuncu Çıktı: ${id}`);
            this.snakes.delete(id);
        }
    }

    spawnBot() {
        const id = 'bot_' + generateId();
        const s = new Snake(id, 'Bot', 'tr', true);
        this.snakes.set(id, s);
    }

    spawnFood() {
        if (this.foods.size >= MAX_FOOD) return;
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * (WORLD_RADIUS - 100);
        this.foods.set(this.foodIdCounter++, {
            id: this.foodIdCounter,
            x: Math.round(WORLD_CENTER + Math.cos(a) * d),
            y: Math.round(WORLD_CENTER + Math.sin(a) * d),
            type: 'normal',
            value: 1
        });
    }

    tick(dt) {
        // Bot ve Yem Yönetimi
        let bots = 0;
        this.snakes.forEach(s => { if(s.isBot) bots++; });
        if (bots < MAX_BOTS) this.spawnBot();
        
        let spawnRate = 0;
        while (this.foods.size < MAX_FOOD && spawnRate < 5) {
            this.spawnFood();
            spawnRate++;
        }

        // Güncelleme
        this.snakes.forEach(s => s.update(dt));

        // Not: Çarpışmaları geçici olarak kapattım, oyunun aktığını görmek için.
        // Hareket düzeldikten sonra çarpışma kodlarını ekleyebiliriz.
    }

    getState() {
        const snakes = [];
        this.snakes.forEach(s => {
            if (s.isActive) snakes.push(s.toState());
        });
        return { 
            snakes: snakes, 
            foods: Array.from(this.foods.values()) 
        };
    }
}

// ============== WEBSOCKET KURULUMU ==============
const wss = new WebSocket.Server({ port: PORT });
const game = new GameServer();

console.log(`Sunucu Başlatıldı: Port ${PORT}`);

wss.on('connection', (ws) => {
    const clientId = generateId();
    // ws.send('{}'); // Gereksiz veri gönderme

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            
            if (data.type === 'join') {
                game.clients.set(ws, clientId);
                game.addPlayer(clientId, data.name, data.skin);
                // İstemciye INIT mesajı gönder
                ws.send(JSON.stringify({ type: 'init', playerId: clientId }));
            }
            else if (data.type === 'input') {
                const s = game.snakes.get(clientId);
                if (s) {
                    s.targetAngle = data.angle;
                    s.isBoosting = data.boost;
                }
            }
            else if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', time: data.time }));
            }
        } catch (e) {
            console.error("Hata:", e);
        }
    });

    ws.on('close', () => {
        game.removePlayer(clientId);
        game.clients.delete(ws);
    });
});

// Oyun Döngüsü
let lastTime = Date.now();
let lastSend = Date.now();

setInterval(() => {
    const now = Date.now();
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.1) dt = 0.1;

    game.tick(dt);

    // İstemciye veri gönder
    if (now - lastSend >= 1000 / STATE_SEND_RATE) {
        const state = JSON.stringify({ type: 'state', ...game.getState() });
        wss.clients.forEach(c => {
            if (c.readyState === WebSocket.OPEN) {
                c.send(state);
            }
        });
        lastSend = now;
    }
}, 1000 / TICK_RATE);
