const WebSocket = require('ws');

// ============== CONFIGURATION (CONSTANTS.TS İLE EŞİTLENDİ) ==============
const PORT = process.env.PORT || 8080;
const TICK_RATE = 60;             // Sunucu saniyede 60 kez hesap yapar
const STATE_SEND_RATE = 45;       // İstemciye veri gönderme hızını ARTIRDIK (Daha akıcı olması için)
const WORLD_RADIUS = 5000;
const WORLD_CENTER = 5000;
const MAX_BOTS = 10;              // Bot sayısını makul seviyede tut
const MAX_FOOD = 1000;            // Yem sayısını optimize et

// CONSTANTS.TS'den gelen değerler (BUNLAR EŞİT OLMALI)
const SNAKE_START_SPEED = 150;
const SNAKE_BOOST_MULTIPLIER = 2.0;
const SNAKE_TURN_SPEED = 3.0;     // DÜZELTME: 0.09'dan 3.0'a çıkarıldı (Frontend ile aynı)
const SNAKE_START_WIDTH = 25;
const MAX_BODY_PARTS = 300;       

// ============== UTILITY ==============
function generateId() {
    return Math.random().toString(36).substring(2, 15);
}

function distance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
}

// ============== SNAKE CLASS ==============
class Snake {
    constructor(id, name, skin, isBot = false) {
        this.id = id;
        this.name = name;
        this.skin = skin;
        this.isBot = isBot;
        this.isActive = true;

        // Rastgele doğma
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * (WORLD_RADIUS - 1000);
        this.x = WORLD_CENTER + Math.cos(angle) * dist;
        this.y = WORLD_CENTER + Math.sin(angle) * dist;
        this.rotation = Math.random() * Math.PI * 2;

        this.targetAngle = this.rotation;
        this.isBoosting = false;
        this.baseSpeed = SNAKE_START_SPEED;
        this.currentSpeed = this.baseSpeed;
        this.width = SNAKE_START_WIDTH;

        this.bodyPartsCount = 20;
        this.score = 0;
        this.killCount = 0;
        this.hsCount = 0;
        this.growPending = 0;
        this.activeEffects = {};

        // Path history: Sadece gerekli noktaları tutacağız
        this.pathHistory = [];
        // Başlangıç noktaları
        for (let i = 0; i < this.bodyPartsCount * 2; i++) {
            this.pathHistory.push({ x: this.x, y: this.y });
        }
        
        // Bot AI
        this.botTarget = { x: WORLD_CENTER, y: WORLD_CENTER };
        this.botTimer = 0;
    }

    // Yılanın boğumları arasındaki mesafe
    get pointSeparation() {
        return this.width * 0.20; // Boğumları biraz sıkılaştır
    }

    update(dt) {
        if (!this.isActive) return;

        if (this.isBot) this.updateBotAI(dt);

        // --- DÖNÜŞ (ROTATION) DÜZELTMESİ ---
        // Frontend'deki (constants.ts) mantıkla aynı çalışmalı
        let diff = this.targetAngle - this.rotation;
        // Açıyı -PI ile +PI arasına normalize et
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        // Dönüş hızı hesabı (radyan/saniye)
        const turnStep = SNAKE_TURN_SPEED * dt;

        if (Math.abs(diff) < turnStep) {
            this.rotation = this.targetAngle;
        } else {
            // Yönüne göre döndür
            this.rotation += Math.sign(diff) * turnStep;
        }
        // Rotasyonu normalize et (0-2PI arası taşmasın)
        this.rotation = (this.rotation + Math.PI * 2) % (Math.PI * 2);

        // --- HIZ VE HAREKET ---
        const targetSpeed = this.isBoosting ? this.baseSpeed * SNAKE_BOOST_MULTIPLIER : this.baseSpeed;
        // Basit hızlanma (lerp)
        this.currentSpeed += (targetSpeed - this.currentSpeed) * 0.1;

        this.x += Math.cos(this.rotation) * this.currentSpeed * dt;
        this.y += Math.sin(this.rotation) * this.currentSpeed * dt;

        // --- KUYRUK TAKİBİ (DÜZELTİLMİŞ) ---
        // Her frame değil, yılan belirli bir mesafe gittiğinde nokta ekle
        // Bu "tırtıklı" görünümü engeller ve veri tasarrufu sağlar.
        const lastPoint = this.pathHistory[0];
        const distMoved = distance(this.x, this.y, lastPoint.x, lastPoint.y);

        // Eğer yılan yeterince hareket ettiyse yeni noktayı kaydet
        if (distMoved >= 2) { 
            this.pathHistory.unshift({ x: this.x, y: this.y });
        }

        // Kuyruk uzunluğunu sınırla
        // İhtiyaç duyulan nokta sayısı hesaplanıyor
        const neededPoints = Math.ceil((this.bodyPartsCount * this.pointSeparation) / 2) + 50;
        
        // Eğer dizi çok uzarsa kes
        if (this.pathHistory.length > neededPoints) {
            this.pathHistory.length = neededPoints;
        }

        // Büyüme
        if (this.growPending >= 1 && this.bodyPartsCount < MAX_BODY_PARTS) {
            this.bodyPartsCount++;
            this.growPending--;
        }

        // Genişlik
        const sizeBonus = Math.floor(this.score / 100);
        const targetWidth = Math.min(100, SNAKE_START_WIDTH + sizeBonus);
        this.width += (targetWidth - this.width) * dt * 0.5;

        // Efekt süresi
        for (const key in this.activeEffects) {
            this.activeEffects[key] -= dt;
            if (this.activeEffects[key] <= 0) delete this.activeEffects[key];
        }

        // Sınır kontrolü
        if (distance(this.x, this.y, WORLD_CENTER, WORLD_CENTER) > WORLD_RADIUS) {
            this.die();
        }
    }

    updateBotAI(dt) {
        this.botTimer -= dt;
        if (this.botTimer <= 0) {
            this.botTimer = Math.random() * 2 + 0.5;
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * 500 + 200;
            this.botTarget = {
                x: this.x + Math.cos(angle) * dist,
                y: this.y + Math.sin(angle) * dist
            };
            // Merkeze dönme eğilimi
            if (distance(this.x, this.y, WORLD_CENTER, WORLD_CENTER) > WORLD_RADIUS - 800) {
                this.botTarget = { x: WORLD_CENTER, y: WORLD_CENTER };
            }
        }
        
        const dx = this.botTarget.x - this.x;
        const dy = this.botTarget.y - this.y;
        this.targetAngle = Math.atan2(dy, dx);
        this.isBoosting = Math.random() < 0.05;
    }

    getBodyPositions() {
        const positions = [];
        let currentDist = 0;
        // Basitleştirilmiş gövde hesaplaması
        // History üzerinden "pointSeparation" kadar atlayarak nokta seç
        
        if (this.pathHistory.length === 0) return [{x: this.x, y:this.y}];

        positions.push(this.pathHistory[0]); // Kafa

        let lastIndex = 0;
        for (let i = 0; i < this.bodyPartsCount; i++) {
            // Bir sonraki noktayı bulmak için history içinde ilerle
            let accumulated = 0;
            for (let j = lastIndex; j < this.pathHistory.length - 1; j++) {
                const p1 = this.pathHistory[j];
                const p2 = this.pathHistory[j+1];
                const d = distance(p1.x, p1.y, p2.x, p2.y);
                accumulated += d;
                if (accumulated >= this.pointSeparation) {
                    positions.push(p2);
                    lastIndex = j + 1;
                    break;
                }
            }
        }
        return positions;
    }
    
    getTotalMultiplier() {
        let m = 1;
        if (this.activeEffects['2x']) m *= 2;
        if (this.activeEffects['5x']) m *= 5;
        if (this.activeEffects['10x']) m *= 10;
        return m;
    }

    die() {
        this.isActive = false;
    }

    toState() {
        // VERİ OPTİMİZASYONU
        // Koordinatları tam sayıya yuvarla (Int) -> Veri boyutu %50 azalır
        
        // Gövde noktalarını seyrelt (Her 3 noktadan 1'ini gönder)
        // Bu lag'i en çok azaltan kısımdır.
        const compressedPath = [];
        const step = 3; 
        
        for (let i = 0; i < this.pathHistory.length; i += step) {
            const p = this.pathHistory[i];
            compressedPath.push({ x: Math.round(p.x), y: Math.round(p.y) });
        }

        return {
            id: this.id,
            name: this.name,
            skin: this.skin,
            x: Math.round(this.x),
            y: Math.round(this.y),
            rotation: Number(this.rotation.toFixed(2)), // 2 ondalık basamak yeter
            width: Math.round(this.width),
            bodyPartsCount: this.bodyPartsCount,
            score: Math.floor(this.score),
            pathPoints: compressedPath,
            isBoosting: this.isBoosting
        };
    }
}

// ============== GAME SERVER MANAGER ==============
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
        return s;
    }

    removePlayer(id) {
        const s = this.snakes.get(id);
        if (s) {
            s.die();
            this.spawnFoodFromDead(s);
            this.snakes.delete(id);
        }
    }

    spawnBot() {
        const id = 'bot_' + generateId();
        const names = ['Bot1', 'Bot2', 'Pro', 'Noob', 'Snake', 'Worm'];
        const skins = ['tr', 'usa', 'blue', 'red', 'green', 'yellow'];
        const s = new Snake(id, names[Math.floor(Math.random()*names.length)], skins[Math.floor(Math.random()*skins.length)], true);
        this.snakes.set(id, s);
    }

    spawnFood() {
        if (this.foods.size >= MAX_FOOD) return;
        
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * (WORLD_RADIUS - 100);
        const x = WORLD_CENTER + Math.cos(angle) * dist;
        const y = WORLD_CENTER + Math.sin(angle) * dist;
        
        let type = 'normal';
        let val = 1;
        const r = Math.random();
        if (r > 0.95) { type = '10x'; val = 10; }
        else if (r > 0.90) { type = '5x'; val = 5; }
        else if (r > 0.85) { type = '2x'; val = 2; }

        const f = { id: this.foodIdCounter++, x: Math.round(x), y: Math.round(y), type, value: val };
        this.foods.set(f.id, f);
    }

    spawnFoodFromDead(snake) {
        const positions = snake.getBodyPositions();
        for (let i = 0; i < positions.length; i+=2) { // Her 2 parçadan 1'i yeme dönüşsün
            const p = positions[i];
            const f = { 
                id: this.foodIdCounter++, 
                x: Math.round(p.x + (Math.random()*20-10)), 
                y: Math.round(p.y + (Math.random()*20-10)), 
                type: 'dead', 
                value: 5 
            };
            this.foods.set(f.id, f);
        }
    }

    tick(dt) {
        // Bot kontrolü
        let bots = 0;
        this.snakes.forEach(s => { if(s.isBot) bots++; });
        if (bots < MAX_BOTS) this.spawnBot();

        // Yem kontrolü
        if (this.foods.size < MAX_FOOD) {
            for(let i=0; i<5; i++) this.spawnFood();
        }

        // Yılanları güncelle
        this.snakes.forEach(s => s.update(dt));

        // Çarpışma Kontrolü
        const activeSnakes = Array.from(this.snakes.values()).filter(s => s.isActive);
        
        activeSnakes.forEach(s => {
            const headR = s.width / 2;

            // 1. Yem Yeme
            // Basit döngü (Grid sistemi olmadan en temizi budur)
            for (const [fid, f] of this.foods) {
                if (Math.abs(s.x - f.x) > 100 || Math.abs(s.y - f.y) > 100) continue; // Uzaktakileri atla
                
                if (distance(s.x, s.y, f.x, f.y) < headR + 20) {
                    let gain = f.value * s.getTotalMultiplier();
                    if (f.type === 'normal') gain *= 5;
                    else gain *= 10;
                    
                    s.score += gain;
                    s.growPending += gain * 0.05;
                    
                    if (f.type !== 'normal' && f.type !== 'dead') {
                        const times = { '2x': 20, '5x': 15, '10x': 10 };
                        s.activeEffects[f.type] = times[f.type];
                    }
                    this.foods.delete(fid);
                }
            }

            // 2. Yılan Çarpışması
            activeSnakes.forEach(other => {
                if (s === other) return;
                
                // Kafa kafaya
                if (distance(s.x, s.y, other.x, other.y) < headR + other.width/2) {
                    // Küçük olan ölür
                    if (s.bodyPartsCount <= other.bodyPartsCount) s.die();
                    else other.die();
                }

                // Gövdeye çarpma
                // Basit kontrol: Eğer other yılanının yakınındaysam detaylı bak
                if (Math.abs(s.x - other.x) < 2000 && Math.abs(s.y - other.y) < 2000) {
                    const body = other.getBodyPositions();
                    for (let i = 2; i < body.length; i+=2) { // Hız için her 2. noktayı kontrol et
                        if (distance(s.x, s.y, body[i].x, body[i].y) < headR + other.width/2) {
                            s.die();
                            other.killCount++;
                            this.spawnFoodFromDead(s);
                            break;
                        }
                    }
                }
            });
        });

        // Ölüleri temizle
        this.snakes.forEach((s, id) => {
            if (!s.isActive && s.isBot) {
                this.spawnFoodFromDead(s);
                this.snakes.delete(id);
            }
        });
    }

    getState() {
        const snakes = [];
        this.snakes.forEach(s => {
            if (s.isActive) snakes.push(s.toState());
        });
        
        // Tüm yemleri göndermek yerine array'e çevir
        // Client tarafında "foods" array'i bekleniyor
        const foods = [];
        this.foods.forEach(f => foods.push(f));

        return { snakes, foods };
    }
}

// ============== SERVER SETUP ==============
const wss = new WebSocket.Server({ port: PORT });
const game = new GameServer();

console.log(`Server started on port ${PORT}`);
console.log(`Settings: TurnSpeed=${SNAKE_TURN_SPEED}, Speed=${SNAKE_START_SPEED}`);

wss.on('connection', (ws) => {
    const clientId = generateId();
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.type === 'join') {
                game.clients.set(ws, clientId);
                game.addPlayer(clientId, data.name, data.skin);
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
        } catch (e) {}
    });

    ws.on('close', () => {
        game.removePlayer(clientId);
        game.clients.delete(ws);
    });
});

let lastTime = Date.now();
let lastSend = Date.now();

setInterval(() => {
    const now = Date.now();
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.1) dt = 0.1; // Lag spike koruması

    game.tick(dt);

    if (now - lastSend > 1000 / STATE_SEND_RATE) {
        const state = JSON.stringify({ type: 'state', ...game.getState() });
        wss.clients.forEach(c => {
            if (c.readyState === WebSocket.OPEN) c.send(state);
        });
        lastSend = now;
    }
}, 1000 / TICK_RATE);
