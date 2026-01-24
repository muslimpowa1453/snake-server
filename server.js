const WebSocket = require('ws');

// ============== AYARLAR (FRONTEND İLE EŞİTLENDİ) ==============
const PORT = process.env.PORT || 8080;
const TICK_RATE = 20;             // Saniyede 20 güncelleme (Wormate tarzı daha yavaş tick)
const STATE_SEND_RATE = 20;       // İstemciye gönderme hızı
const WORLD_RADIUS = 5000;
const WORLD_CENTER = 5000;
const MAX_BOTS = 10;
const MAX_FOOD = 800;

// Bu değerler senin 'constants.ts' dosyanla aynı olmalı
const SNAKE_START_SPEED = 150;
const SNAKE_TURN_SPEED = 3.0;     // Frontend 3.0 bekliyor
const SNAKE_START_WIDTH = 25;

// ============== YARDIMCI ==============
function generateId() { return Math.random().toString(36).substring(2, 15); }
function distance(x1, y1, x2, y2) { return Math.sqrt((x1-x2)**2 + (y1-y2)**2); }

// ============== YILAN SINIFI ==============
class Snake {
    constructor(id, name, skin, isBot = false) {
        this.id = id;
        this.name = name || 'Player';
        this.skin = skin || 'tr';
        this.isBot = isBot;
        this.isActive = true;

        // Rastgele Doğuş
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * (WORLD_RADIUS - 500);
        this.x = WORLD_CENTER + Math.cos(a) * d;
        this.y = WORLD_CENTER + Math.sin(a) * d;
        this.rotation = Math.random() * Math.PI * 2;
        this.targetAngle = this.rotation;

        this.currentSpeed = SNAKE_START_SPEED;
        this.width = SNAKE_START_WIDTH;
        this.bodyPartsCount = 20;
        this.score = 0;
        this.isBoosting = false;
        
        // Geçmiş (Kuyruk Çizimi İçin)
        this.pathHistory = [];
        for(let i=0; i<this.bodyPartsCount*5; i++) {
            this.pathHistory.push({x: this.x, y: this.y});
        }
        
        // AI
        this.botTarget = {x: WORLD_CENTER, y: WORLD_CENTER};
        this.botTimer = 0;
    }

    update(dt) {
        if (!this.isActive) return;

        // Bot Yapay Zekası
        if (this.isBot) {
            this.botTimer -= dt;
            if (this.botTimer <= 0) {
                this.botTimer = Math.random() * 2 + 1;
                const ang = Math.random() * Math.PI * 2;
                const dst = Math.random() * 1000 + 500;
                this.botTarget = { x: this.x + Math.cos(ang)*dst, y: this.y + Math.sin(ang)*dst };
            }
            const dx = this.botTarget.x - this.x;
            const dy = this.botTarget.y - this.y;
            this.targetAngle = Math.atan2(dy, dx);
        }

        // 1. AÇI HESAPLAMA (Dönüş)
        let diff = this.targetAngle - this.rotation;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        
        // Turn speed dt ile çarpılır
        const turnAmount = SNAKE_TURN_SPEED * dt;
        if (Math.abs(diff) < turnAmount) this.rotation = this.targetAngle;
        else this.rotation += Math.sign(diff) * turnAmount;

        // 2. HAREKET (Movement)
        // Boost varsa hız 2 katına çıkar
        const speed = this.isBoosting ? SNAKE_START_SPEED * 2 : SNAKE_START_SPEED;
        this.currentSpeed += (speed - this.currentSpeed) * 0.1; // Yumuşak geçiş

        this.x += Math.cos(this.rotation) * this.currentSpeed * dt;
        this.y += Math.sin(this.rotation) * this.currentSpeed * dt;

        // 3. KUYRUK KAYDI
        // Her tick'te kayıt alıyoruz. Yuvarlama YOK.
        this.pathHistory.unshift({x: this.x, y: this.y});
        
        // Kuyruk uzunluğunu sınırla
        // (BodyCount * PointSeparation) formülüyle kabaca hesaplanır
        const limit = this.bodyPartsCount * 10 + 100;
        if (this.pathHistory.length > limit) this.pathHistory.length = limit;

        // Harita Sınırı
        if (distance(this.x, this.y, WORLD_CENTER, WORLD_CENTER) > WORLD_RADIUS) {
            // Basitçe geri çevir (Ölmek yerine)
            this.targetAngle = Math.atan2(WORLD_CENTER-this.y, WORLD_CENTER-this.x);
        }
    }

    toState() {
        // İstemciye (tarayıcıya) giden veri
        // YUVARLAMA YAPMIYORUZ (Float gönderiyoruz)
        
        // Path verisini biraz seyreltelim (Bandwidth tasarrufu)
        const sentPath = [];
        for(let i=0; i<this.pathHistory.length; i+=2) {
            sentPath.push(this.pathHistory[i]);
        }

        return {
            id: this.id,
            name: this.name,
            skin: this.skin,
            x: this.x,
            y: this.y,
            rotation: this.rotation,
            width: Math.floor(this.width), // Genişlik tamsayı olabilir
            bodyPartsCount: this.bodyPartsCount,
            score: Math.floor(this.score),
            pathPoints: sentPath,
            isBoosting: this.isBoosting
        };
    }
}

// ============== SUNUCU ==============
const game = {
    snakes: new Map(),
    foods: [],
    foodId: 0,
    clients: new Map()
};

const wss = new WebSocket.Server({ port: PORT });
console.log(`Server ${PORT} portunda çalışıyor...`);

// Yem Oluşturma
function spawnFood() {
    if (game.foods.length >= MAX_FOOD) return;
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * (WORLD_RADIUS - 50);
    game.foods.push({
        id: game.foodId++,
        x: Math.floor(WORLD_CENTER + Math.cos(a) * d),
        y: Math.floor(WORLD_CENTER + Math.sin(a) * d),
        type: Math.random() > 0.95 ? '10x' : (Math.random() > 0.9 ? '5x' : 'normal'),
        value: 1
    });
}

// Oyun Döngüsü
setInterval(() => {
    // 1. Bot Ekle
    let bots = 0;
    game.snakes.forEach(s => { if(s.isBot) bots++ });
    if (bots < MAX_BOTS) {
        const id = 'bot_' + generateId();
        game.snakes.set(id, new Snake(id, 'Bot', 'tr', true));
    }

    // 2. Yem Ekle
    while(game.foods.length < 500) spawnFood();

    // 3. Güncelle
    const dt = 1 / TICK_RATE;
    game.snakes.forEach(s => s.update(dt));

    // 4. State Gönder
    const state = {
        type: 'state',
        snakes: Array.from(game.snakes.values()).map(s => s.toState()),
        foods: game.foods
    };
    
    const msg = JSON.stringify(state);
    wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });

}, 1000 / TICK_RATE);


wss.on('connection', ws => {
    const id = generateId();
    console.log('Oyuncu bağlandı:', id);

    ws.on('message', msg => {
        try {
            const data = JSON.parse(msg);
            if (data.type === 'join') {
                game.clients.set(ws, id);
                game.snakes.set(id, new Snake(id, data.name, data.skin));
                ws.send(JSON.stringify({ type: 'init', playerId: id }));
            }
            if (data.type === 'input') {
                const s = game.snakes.get(id);
                if (s) {
                    s.targetAngle = data.angle;
                    s.isBoosting = data.boost;
                }
            }
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', time: data.time }));
            }
        } catch(e) {}
    });

    ws.on('close', () => {
        game.snakes.delete(id);
        game.clients.delete(ws);
    });
});
