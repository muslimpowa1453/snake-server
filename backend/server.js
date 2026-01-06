import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const MAP = 5000;
const TICK = 30;
const BOT_COUNT = 15;

const players = new Map();
const foods = new Map();

const SKINS = ["#ff8800", "#00c3ff", "#ff4d4d", "#7cff00", "#9d4edd", "#ffd166"];
const rand = () => Math.random() * MAP - MAP / 2;
const randSkin = () => SKINS[Math.floor(Math.random() * SKINS.length)];

function spawnFood(x, y, count = 10) {
    for (let i = 0; i < count; i++) {
        foods.set(crypto.randomUUID(), {
            x: x + Math.random() * 50 - 25,
            y: y + Math.random() * 50 - 25
        });
    }
}

function newPlayer(id, isBot = false) {
    return {
        id,
        isBot,
        skin: randSkin(),
        x: rand(),
        y: rand(),
        angle: Math.random() * Math.PI * 2,
        boost: false,
        speed: 2.5,
        length: 25,
        segments: [],
        score: 0,
        aiTimer: 0
    };
}

// Bots
for (let i = 0; i < BOT_COUNT; i++) {
    const id = "BOT_" + crypto.randomUUID();
    players.set(id, newPlayer(id, true));
}

wss.on("connection", ws => {
    const id = crypto.randomUUID();
    const p = newPlayer(id, false);
    players.set(id, p);
    ws.send(JSON.stringify({ type: "init", id }));

    ws.on("message", msg => {
        const d = JSON.parse(msg);
        if (d.type === "input") {
            p.angle = d.angle;
            p.boost = d.boost;
        }
    });

    ws.on("close", () => players.delete(id));
});

function tick() {
    players.forEach(p => {
        if (p.isBot) {
            p.aiTimer--;
            if (p.aiTimer <= 0) {
                p.angle += Math.random() - 0.5;
                p.boost = Math.random() < 0.1;
                p.aiTimer = 30 + Math.random() * 60;
            }
        }

        const speed = p.boost && p.length > 10 ? 4.5 : p.speed;
        if (p.boost && p.length > 10) p.length -= 0.05;

        p.x += Math.cos(p.angle) * speed;
        p.y += Math.sin(p.angle) * speed;

        p.segments.unshift({ x: p.x, y: p.y });
        while (p.segments.length > p.length) p.segments.pop();

        foods.forEach((f, id) => {
            if ((p.x - f.x) ** 2 + (p.y - f.y) ** 2 < 400) {
                foods.delete(id);
                p.length++; p.score++;
            }
        });
    });

    players.forEach(p => {
        players.forEach(o => {
            if (p.id === o.id) return;
            o.segments.forEach(s => {
                if ((p.x - s.x) ** 2 + (p.y - s.y) ** 2 < 200) {
                    spawnFood(p.x, p.y, p.length);
                    players.set(p.id, newPlayer(p.id, p.isBot));
                }
            });
        });
    });

    const state = { type: "state", players: [...players.values()], foods: [...foods.values()] };
    wss.clients.forEach(ws => {
        if (ws.readyState === 1) ws.send(JSON.stringify(state));
    });
}

setInterval(tick, 1000 / TICK);
server.listen(process.env.PORT || 3000);
