const WebSocket = require('ws');

// ============== CONFIGURATION (AYARLAR) ==============
const PORT = process.env.PORT || 8080;
const TICK_RATE = 60;            // Saniyedeki güncelleme sayısı
const STATE_SEND_RATE = 20;      // İstemciye veri gönderme hızı (Düşürülerek lag önlendi)
const WORLD_RADIUS = 5000;
const WORLD_CENTER = 5000;
const MAX_BOTS = 10;             // Bot sayısını ideal seviyeye çektik
const SNAKE_START_SPEED = 150;
const SNAKE_BOOST_MULTIPLIER = 2.0;
const SNAKE_TURN_SPEED = 0.09;
const SNAKE_START_WIDTH = 25;
const MAX_BODY_PARTS = 300;      // Maksimum uzunluğu sunucu sağlığı için sınırladık

// ============== UTILITY (YARDIMCI FONKSİYONLAR) ==============
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

        // Rastgele doğma noktası
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * (WORLD_RADIUS - 500);
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

        // Path history (Kuyruk çizimi için geçmiş)
        this.pathHistory = [];
        // Başlangıç için noktaları doldur
        for (let i = 0; i < this.bodyPartsCount * 5; i++) {
            this.pathHistory.push({ x: this.x, y: this.y });
        }

        // Bot AI değişkenleri
        this.botTarget = { x: this.x, y: this.y };
        this.botTimer = 0;
    }

    get pointSeparation() {
        return this.width * 0.25;
    }

    update(dt) {
        if (!this.isActive) return;

        if (this.isBot) {
            this.updateBotAI(dt);
        }

        // Dönüş yumuşatma (Smooth rotation)
        let diff = this.targetAngle - this.rotation;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        
        // Sabit 60 FPS varsayımıyla dönüş hesaplama
        const turnAmount = SNAKE_TURN_SPEED * dt * 60;
        
        if (Math.abs(diff) < turnAmount) {
            this.rotation = this.targetAngle;
        } else {
            this.rotation += Math.sign(diff) * turnAmount;
        }

        // Hız hesaplama
        const targetSpeed = this.isBoosting ? this.baseSpeed * SNAKE_BOOST_MULTIPLIER : this.baseSpeed;
        // Basit lerp ile hız geçişi
        this.currentSpeed += (targetSpeed - this.currentSpeed) * 0.1;

        // Hareket
        this.x += Math.cos(this.rotation) * this.currentSpeed * dt;
        this.y += Math.sin(this.rotation) * this.currentSpeed * dt;

        // --- OPTİMİZASYON: PATH HISTORY ---
        // Sadece hareket ettiysek geçmişe ekle
        if (this.currentSpeed > 0) {
            this.pathHistory.unshift({ x: this.x, y: this.y });
        }

        // Geçmişi temizle (Memory Leak Önleme)
        // Yılanın boyuna ve genişliğine göre ne kadar geçmiş tutmamız gerektiğini hesapla
        // +100 güvenlik payı ekliyoruz
        // MAX 2000 nokta ile sınırlıyoruz (Sunucuyu korumak için en önemli ayar bu)
        const neededHistory = Math.ceil(this.bodyPartsCount * (this.pointSeparation / (this.currentSpeed * dt || 1)) * 1.5) + 50;
        const maxHistoryLimit = 2000; 
        const trimTo = Math.min(neededHistory, maxHistoryLimit);

        if (this.pathHistory.length > trimTo) {
            this.pathHistory.length = trimTo; // Fazlalığı anında kes
        }

        // Büyüme mantığı
        if (this.growPending >= 1 && this.bodyPartsCount < MAX_BODY_PARTS) {
            this.bodyPartsCount++;
            this.growPending -= 1;
        }

        // Genişlik büyümesi
        const sizeBonus = Math.log10(this.score + 100) * 4;
        const targetWidth = SNAKE_START_WIDTH + sizeBonus;
        this.width += (targetWidth - this.width) * dt * 0.1;
        this.width = Math.min(this.width, 150); // Maksimum genişlik sınırı

        // Efekt süreleri
        for (const key in this.activeEffects) {
            this.activeEffects[key] -= dt;
            if (this.activeEffects[key] <= 0) {
                delete this.activeEffects[key];
            }
        }

        // Harita dışına çıkma kontrolü
        const distToCenter = distance(this.x, this.y, WORLD_CENTER, WORLD_CENTER);
        if (distToCenter > WORLD_RADIUS + 50) {
            this.die();
        }
    }

    updateBotAI(dt) {
        this.botTimer += dt;
        if (this.botTimer > (Math.random() * 2 + 1)) {
            this.pickNewBotTarget();
            this.botTimer = 0;
        }

        // Harita sınırından kaçış
        const distToCenter = distance(this.x, this.y, WORLD_CENTER, WORLD_CENTER);
        if (distToCenter > WORLD_RADIUS - 600) {
            // Merkeze doğru dön
            this.botTarget = { 
                x: WORLD_CENTER + (Math.random() - 0.5) * 1000, 
                y: WORLD_CENTER + (Math.random() - 0.5) * 1000
            };
        }

        const dx = this.botTarget.x - this.x;
        const dy = this.botTarget.y - this.y;
        this.targetAngle = Math.atan2(dy, dx);
        
        // Ara sıra hızlan
        this.isBoosting = Math.random() < 0.02;
    }

    pickNewBotTarget() {
        const angle = Math.random() * Math.PI * 2;
        const dist = 500 + Math.random() * 2000;
        this.botTarget = {
            x: this.x + Math.cos(angle) * dist,
            y: this.y + Math.sin(angle) * dist
        };
    }

    getBodyPositions() {
        const positions = [{ x: this.x, y: this.y }];
        let accumulatedDist = 0;

        for (let i = 0; i < this.pathHistory.length - 1 && positions.length < this.bodyPartsCount; i++) {
            const p1 = this.pathHistory[i];
            const p2 = this.pathHistory[i + 1];
            const dist = distance(p1.x, p1.y, p2.x, p2.y);
            
            // Sıfır mesafe varsa atla
            if (dist === 0) continue;

            accumulatedDist += dist;

            while (accumulatedDist >= this.pointSeparation && positions.length < this.bodyPartsCount) {
                const overshoot = accumulatedDist - this.pointSeparation;
                const ratio = (dist - overshoot) / dist; // Geriye doğru oran
                
                positions.push({
                    x: p1.x + (p2.x - p1.x) * ratio, // P1'den P2'ye doğru
                    y: p1.y + (p2.y - p1.y) * ratio
                });
                
                accumulatedDist -= this.pointSeparation;
            }
        }
        return positions;
    }

    getTotalMultiplier() {
        let total = 1;
        if (this.activeEffects['2x'] > 0) total *= 2;
        if (this.activeEffects['5x'] > 0) total *= 5;
        if (this.activeEffects['10x'] > 0) total *= 10;
        return total;
    }

    die() {
        this.isActive = false;
    }

    // --- OPTİMİZASYON: VERİ PAKETLEME ---
    toState() {
        const compressedPath = [];
        
        // Dinamik kalite ayarı: Yılan ne kadar uzunsa, o kadar seyrek nokta gönder
        // Bu, dev yılanların interneti tıkamasını önler.
        let step = 2; // Varsayılan: Her 2 noktada bir al
        if (this.pathHistory.length > 500) step = 4;
        if (this.pathHistory.length > 1000) step = 8;
        
        // Başlangıç noktasını ekle
        if (this.pathHistory.length > 0) {
             // Math.round ile veriyi küçültüyoruz (12.345 -> 12)
             compressedPath.push({ 
                 x: Math.round(this.pathHistory[0].x), 
                 y: Math.round(this.pathHistory[0].y) 
             });
        }

        for (let i = step; i < this.pathHistory.length; i += step) {
            compressedPath.push({
                x: Math.round(this.pathHistory[i].x),
                y: Math.round(this.pathHistory[i].y)
            });
        }

        return {
            id: this.id,
            name: this.name,
            skin: this.skin,
            x: Math.round(this.x),
            y: Math.round(this.y),
            rotation: Number(this.rotation.toFixed(2)), // Virgülden sonra 2 hane yeterli
            width: Math.round(this.width),
            bodyPartsCount: this.bodyPartsCount,
            score: Math.floor(this.score),
            killCount: this.killCount,
            hsCount: this.hsCount,
            isBoosting: this.isBoosting,
            isBot: this.isBot,
            pathPoints: compressedPath,
            activeEffects: this.activeEffects
        };
    }
}

// ============== FOOD CLASS ==============
class Food {
    constructor(id, x, y, type, value) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.type = type;
        this.value = value;
        this.lifeTime = 0;
    }

    toState() {
        return {
            id: this.id,
            x: Math.round(this.x), // Yuvarlama
            y: Math.round(this.y),
            type: this.type,
            v: this.value // 'value' yerine 'v' (kısaltma)
        };
    }
}

// ============== GAME SERVER ==============
class GameServer {
    constructor() {
        this.snakes = new Map();
        this.foods = new Map();
        this.foodIdCounter = 0;
        this.clients = new Map(); // ws -> playerId
    }

    addPlayer(id, name, skin) {
        const snake = new Snake(id, name, skin, false);
        this.snakes.set(id, snake);
        return snake;
    }

    removePlayer(id) {
        const snake = this.snakes.get(id);
        if (snake && snake.isActive) {
            snake.die();
            this.spawnFoodFromDeath(snake);
        }
        this.snakes.delete(id);
    }

    spawnBot() {
        const id = 'bot_' + generateId();
        const names = ['Alex', 'Steve', 'Wormy', 'Pro', 'Noob', 'Hunter', 'Ghost', 'Viper', 'Legend', 'Rex'];
        const skins = ['yellow', 'red', 'blue', 'green', 'tr', 'purple', 'cyan'];
        const snake = new Snake(
            id,
            names[Math.floor(Math.random() * names.length)],
            skins[Math.floor(Math.random() * skins.length)],
            true
        );
        // Botlar rastgele büyüklükte başlasın
        snake.bodyPartsCount = 20 + Math.floor(Math.random() * 50);
        snake.score = snake.bodyPartsCount * 10;
        this.snakes.set(id, snake);
    }

    manageBots() {
        const activeBots = Array.from(this.snakes.values()).filter(s => s.isBot && s.isActive);
        // Eksik bot varsa tamamla
        if (activeBots.length < MAX_BOTS) {
            this.spawnBot();
        }
    }

    spawnFood() {
        if (this.foods.size >= 1500) return; // Maksimum yem sınırı

        const angle = Math.random() * Math.PI * 2;
        const dist = Math.sqrt(Math.random()) * (WORLD_RADIUS - 100);
        const x = WORLD_CENTER + Math.cos(angle) * dist;
        const y = WORLD_CENTER + Math.sin(angle) * dist;

        let type = 'normal';
        let value = 1;
        const chance = Math.random();

        if (chance > 0.98) { type = '10x'; value = 10; }
        else if (chance > 0.95) { type = '5x'; value = 5; }
        else if (chance > 0.90) { type = '2x'; value = 2; }

        const food = new Food(this.foodIdCounter++, x, y, type, value);
        this.foods.set(food.id, food);
    }

    spawnFoodFromDeath(snake) {
        // Ölen yılanın vücut parçalarından yem çıkar
        const positions = snake.getBodyPositions();
        // Tüm parçaları değil, her 2-3 parçada bir yem bırak (Performans için)
        const step = Math.max(1, Math.floor(positions.length / 30)); 
        
        for (let i = 0; i < positions.length; i += step) {
            const pos = positions[i];
            const food = new Food(this.foodIdCounter++, pos.x, pos.y, 'dead', 5);
            this.foods.set(food.id, food);
        }
    }

    checkCollisions() {
        const snakeList = Array.from(this.snakes.values()).filter(s => s.isActive);

        for (const snake of snakeList) {
            const headX = snake.x;
            const headY = snake.y;
            const hitboxRadius = (snake.width / 2) * 0.8; // Hitbox biraz daha küçük olsun

            // 1. Yem Yeme
            // Yemleri optimize etmek için sadece yakınındakileri kontrol etmek gerekir ama JS map döngüsü 2000 obje için hızlıdır.
            // Yine de Snake'in "yeme yarıçapını" hesaplayalım.
            const eatRadius = (snake.width / 2) + 10;
            const eatRadiusSq = eatRadius * eatRadius; // Karekök almamak için

            // Food collision
            // Map üzerinde dönerken silme işlemi yapmak tehlikelidir, toplanacakları listeye atalım
            const foodsToEat = [];

            for (const food of this.foods.values()) {
                const dx = headX - food.x;
                const dy = headY - food.y;
                const distSq = dx * dx + dy * dy;

                if (distSq < eatRadiusSq) {
                    foodsToEat.push(food);
                }
            }

            for (const food of foodsToEat) {
                 const mult = snake.getTotalMultiplier();
                 let scoreGain = food.type === 'normal' ? 5 : (food.type === 'dead' ? 20 : 10);
                 scoreGain *= mult * food.value;
                 
                 snake.score += scoreGain;
                 snake.growPending += scoreGain * 0.01; // Büyüme oranını biraz kıstım

                 if (food.type !== 'normal' && food.type !== 'dead') {
                     const durations = { '2x': 20, '5x': 15, '10x': 10 };
                     snake.activeEffects[food.type] = durations[food.type] || 20;
                 }
                 this.foods.delete(food.id);
            }


            // 2. Yılan Çarpışması
            for (const other of snakeList) {
                if (other === snake || !other.isActive) continue;

                const otherHitbox = (other.width / 2) * 0.8;
                const combinedRadius = hitboxRadius + otherHitbox;
                const combinedRadiusSq = combinedRadius * combinedRadius;

                // Kafa kafaya çarpışma
                const dx = headX - other.x;
                const dy = headY - other.y;
                const headDistSq = dx * dx + dy * dy;

                if (headDistSq < combinedRadiusSq) {
                    // Skor veya boyuta göre kazananı belirle
                    if (snake.bodyPartsCount > other.bodyPartsCount) {
                        snake.hsCount++;
                        other.die();
                        this.spawnFoodFromDeath(other);
                    } else {
                        other.hsCount++;
                        snake.die();
                        this.spawnFoodFromDeath(snake);
                    }
                    continue;
                }

                // Gövdeye çarpma
                // Diğer yılanın vücut pozisyonlarını al
                // OPTİMİZASYON: Sadece kafa, diğer yılanın bounding box'ı içindeyse detaylı kontrol yap
                if (Math.abs(headX - other.x) > 2000 || Math.abs(headY - other.y) > 2000) continue;

                const bodyPositions = other.getBodyPositions();
                // İlk birkaç boğumu atla (kafa kendisine çarpmaz mantığı diğer yılan için geçerli değil ama olsun)
                let collisionFound = false;
                
                // Adımlayarak kontrol et (her noktayı kontrol etme, performans artışı)
                const checkStep = Math.max(1, Math.floor(other.width / 15));

                for (let i = 0; i < bodyPositions.length; i += checkStep) {
                    const part = bodyPositions[i];
                    const pdx = headX - part.x;
                    const pdy = headY - part.y;
                    
                    if (pdx*pdx + pdy*pdy < combinedRadiusSq) {
                        snake.die();
                        other.killCount++;
                        this.spawnFoodFromDeath(snake);
                        collisionFound = true;
                        break;
                    }
                }
                if (collisionFound) break;
            }
        }
    }

    tick(dt) {
        // Snake update
        for (const snake of this.snakes.values()) {
            snake.update(dt);
        }

        // Ölü botları temizle
        for (const [id, snake] of this.snakes) {
            if (!snake.isActive && snake.isBot) {
                this.snakes.delete(id);
            }
        }

        this.manageBots();
        
        // Yem spawnla (sabit sayıya tamamla)
        // Her tick hepsini spawnlama, performans için tick başına 5-10 tane ekle
        let spawnCount = 0;
        while (this.foods.size < 1200 && spawnCount < 5) {
            this.spawnFood();
            spawnCount++;
        }

        // Ölü yem süresi (dead food decay)
        for (const [id, food] of this.foods) {
            if (food.type === 'dead') {
                food.lifeTime += dt;
                if (food.lifeTime > 20) { // 20 saniye sonra kaybolsun
                    this.foods.delete(id);
                }
            }
        }

        this.checkCollisions();
    }

    getState() {
        // Sadece aktif yılanları gönder
        const snakes = [];
        for (const s of this.snakes.values()) {
            if (s.isActive) snakes.push(s.toState());
        }

        // Yemleri gönder
        // OPTİMİZASYON: Yemlerin hepsini her seferinde göndermek yerine
        // sadece ekrandakileri göndermek en iyisidir ama bu kodda o kadar karmaşıklığa girmeden
        // basitçe array'e çeviriyoruz. Yem sayısı çoksa burası şişebilir.
        const foods = Array.from(this.foods.values()).map(f => f.toState());

        return { snakes, foods };
    }
}

// ============== WEBSOCKET SERVER ==============
const wss = new WebSocket.Server({ port: PORT });
const game = new GameServer();

console.log(`WebSocket server starting on port ${PORT}`);

wss.on('connection', (ws) => {
    const clientId = generateId();
    console.log(`Client connected: ${clientId}`);

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());

            switch (message.type) {
                case 'join':
                    game.clients.set(ws, clientId);
                    game.addPlayer(clientId, message.name || 'Player', message.skin || 'tr');
                    ws.send(JSON.stringify({
                        type: 'init',
                        playerId: clientId
                    }));
                    break;

                case 'input':
                    const snake = game.snakes.get(clientId);
                    if (snake && snake.isActive) {
                        snake.targetAngle = message.angle;
                        snake.isBoosting = message.boost || false;
                    }
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong', time: message.time }));
                    break;
            }
        } catch (e) {
            console.error('Message parse error:', e);
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${clientId}`);
        game.removePlayer(clientId);
        game.clients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for ${clientId}:`, error);
    });
});

// Game loop
let lastTime = Date.now();
let lastStateBroadcast = Date.now();

setInterval(() => {
    const now = Date.now();
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    
    // Lag spike koruması: Eğer sunucu çok takılırsa dt devasa olabilir, onu sınırla
    if (dt > 0.1) dt = 0.1;

    game.tick(dt);

    // Broadcast state
    if (now - lastStateBroadcast >= 1000 / STATE_SEND_RATE) {
        const state = game.getState();
        const stateMessage = JSON.stringify({ type: 'state', ...state });

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(stateMessage);
            }
        });

        lastStateBroadcast = now;
    }
}, 1000 / TICK_RATE);

console.log(`Game server running at ${TICK_RATE} ticks/sec, broadcasting at ${STATE_SEND_RATE} Hz`);
