// ===== CapNaval — serveur Node.js + ws (pour Render, pas de Durable Object) =====
const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const GRID_SIZE = 12;
const MOVE_COOLDOWN_MS = 800;
const ATTACK_WINDOW_MS = 8000;
const TURN_GAP_MS = 2500;
const START_HP = 100;
const RESPAWN_DELAY_MS = 4000;
const MAX_PLAYERS = 6;
const ROOM_IDLE_CLEANUP_MS = 1000 * 60 * 60 * 3; // vide une room après 3h sans joueurs
const HILL_TICK_MS = 2000;
const HILL_CELLS = [[5, 5], [5, 6], [6, 5], [6, 6]]; // "colline" au centre de la grille

const COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316"];

const ATTACKS = [
  { id: "meteor",    name: "Météorite",       desc: "Frappe une zone 3x3 choisie",              target: "zone", size: 3, damage: 25 },
  { id: "airstrike", name: "Frappe aérienne", desc: "3 impacts aléatoires dans une zone 5x5",    target: "zone", size: 5, damage: 15, hits: 3, random: true },
  { id: "snipe",     name: "Tir de précision",desc: "Grosse dégâts sur une case, longue portée", target: "cell", damage: 35 },
  { id: "shockwave", name: "Onde de choc",    desc: "Frappe toutes les cases autour de toi",     target: "self", damage: 18 },
  { id: "gunline",   name: "Rafale",          desc: "Mitraille toute une ligne ou colonne",      target: "line", damage: 12 },
  { id: "grenade",   name: "Grenade",         desc: "Explosion sur une zone 2x2",                target: "zone", size: 2, damage: 20 },
  { id: "mine",      name: "Piège explosif",  desc: "Pose une mine invisible sur une case",      target: "cell", damage: 30, trap: true },
  { id: "heal",      name: "Soin d'urgence",  desc: "Soigne toi ou un allié proche",             target: "ally", heal: 25 },
  { id: "shield",    name: "Bouclier",        desc: "Absorbe la prochaine attaque reçue",        target: "self", shield: true },
  { id: "poison",    name: "Zone toxique",    desc: "Nuage toxique 3x3, dégâts sur 3 tours",     target: "zone", size: 3, damage: 8, poison: true, ticks: 3 },
  { id: "teleport",  name: "Téléportation",   desc: "Téléporte-toi dans un rayon de 4 cases",    target: "cell", teleport: true, range: 4 },
  { id: "charge",    name: "Charge",          desc: "Fonce en ligne droite sur 2 cases",         target: "direction", damage: 22, distance: 2 },
];

// ---- Modes de jeu ----
const MODES = {
  survivor: { label: "Dernier survivant", desc: "Pas de respawn. Le dernier debout gagne.", respawns: false },
  koHunt:   { label: "Chasse au K.O.",    desc: "Premier à X éliminations gagne.", respawns: true },
  kingHill: { label: "Roi de la case",    desc: "Reste sur la case centrale pour marquer des points. Premier à X points gagne.", respawns: true },
  chrono:   { label: "Chrono",            desc: "Partie limitée dans le temps. Le plus d'éliminations à la fin gagne.", respawns: true },
  harvest:  { label: "Récolte",           desc: "Les K.O. laissent des cartes au sol. Premier à X cartes gagne.", respawns: true },
};

function randInt(n) { return Math.floor(Math.random() * n); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function inBounds(x, y) { return x >= 0 && y >= 0 && x < GRID_SIZE && y < GRID_SIZE; }
function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[randInt(chars.length)];
  return s;
}
function onHill(x, y) { return HILL_CELLS.some(([hx, hy]) => hx === x && hy === y); }

// ---- Une Room = une partie, tenue en mémoire du process Node ----
class Room {
  constructor(code) {
    this.code = code;
    this.status = "lobby"; // lobby | playing | ended
    this.players = {};     // id -> {id,pseudo,color,x,y,hp,alive,lastMove,shield,respawnAt,eliminations,cards,score,ws}
    this.hazards = [];     // mines / zones toxiques
    this.cardPickups = []; // {x,y,count} — cartes au sol (mode Récolte)
    this.turn = null;      // {playerId, attack, deadline}
    this.hostId = null;
    this.timer = null;     // setTimeout du prochain tick de jeu
    this.hillTimer = null; // setInterval du mode Roi de la case
    this.lastActivity = Date.now();
    this.lastAttackId = null;

    this.mode = null;
    this.config = {};
    this.chronoEndAt = null;
    this.winner = null; // { ids:[...], reason }
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const p of Object.values(this.players)) {
      if (p.ws && p.ws.readyState === 1) p.ws.send(data);
    }
  }

  publicState() {
    return {
      type: "state",
      status: this.status,
      players: Object.values(this.players).map(({ ws, ...rest }) => rest),
      hazards: this.hazards.map(h => h.type === "mine" ? { x: h.x, y: h.y, type: "mine" } : h),
      cardPickups: this.cardPickups,
      turn: this.turn ? {
        playerId: this.turn.playerId,
        attackId: this.turn.attack.id,
        attackName: this.turn.attack.name,
        deadline: this.turn.deadline,
      } : null,
      gridSize: GRID_SIZE,
      hostId: this.hostId,
      mode: this.mode,
      modeLabel: this.mode ? MODES[this.mode].label : null,
      config: this.config,
      chronoEndAt: this.chronoEndAt,
      hillCells: HILL_CELLS.map(([x, y]) => ({ x, y })),
      winner: this.winner,
    };
  }

  pushLog(message) { this.broadcast({ type: "log", message }); }

  freeSpawn() {
    for (let tries = 0; tries < 200; tries++) {
      const x = randInt(GRID_SIZE), y = randInt(GRID_SIZE);
      const occupied = Object.values(this.players).some(p => p.alive && p.x === x && p.y === y);
      if (!occupied) return { x, y };
    }
    return { x: randInt(GRID_SIZE), y: randInt(GRID_SIZE) };
  }

  addPlayer(ws, pseudo) {
    if (Object.keys(this.players).length >= MAX_PLAYERS) return null;
    const id = crypto.randomUUID();
    const usedColors = Object.values(this.players).map(p => p.color);
    const color = COLORS.find(c => !usedColors.includes(c)) || COLORS[randInt(COLORS.length)];
    const spawn = this.freeSpawn();
    const player = {
      id, pseudo, color, x: spawn.x, y: spawn.y,
      hp: START_HP, alive: true, lastMove: 0, shield: false, respawnAt: null,
      eliminations: 0, cards: 0, score: 0, ws,
    };
    this.players[id] = player;
    if (!this.hostId) this.hostId = id;
    return player;
  }

  removePlayer(id) {
    const p = this.players[id];
    if (!p) return;
    this.pushLog(`${p.pseudo} a quitté la partie.`);
    delete this.players[id];
    if (this.hostId === id) this.hostId = Object.keys(this.players)[0] || null;
  }

  // ---- Démarrage / relance ----
  start(mode, rawConfig) {
    if (this.status === "playing") return;
    if (Object.keys(this.players).length < 1) return;
    if (!MODES[mode]) mode = "koHunt";
    rawConfig = rawConfig || {};

    const config = {};
    if (mode === "koHunt") config.targetKO = clamp(parseInt(rawConfig.targetKO) || 5, 1, 50);
    if (mode === "kingHill") config.targetScore = clamp(parseInt(rawConfig.targetScore) || 20, 1, 200);
    if (mode === "chrono") config.minutes = clamp(parseFloat(rawConfig.minutes) || 5, 1, 60);
    if (mode === "harvest") {
      config.cardsToWin = clamp(parseInt(rawConfig.cardsToWin) || 10, 1, 100);
      config.cardsLostOnDeath = clamp(parseInt(rawConfig.cardsLostOnDeath) ?? 2, 0, 50);
    }

    this.mode = mode;
    this.config = config;
    this.winner = null;
    this.hazards = [];
    this.cardPickups = [];
    this.lastAttackId = null;
    this.turn = null;

    for (const p of Object.values(this.players)) {
      const spawn = this.freeSpawn();
      p.hp = START_HP; p.alive = true; p.x = spawn.x; p.y = spawn.y;
      p.shield = false; p.respawnAt = null;
      p.eliminations = 0; p.cards = 0; p.score = 0;
    }

    this.status = "playing";
    if (mode === "chrono") this.chronoEndAt = Date.now() + config.minutes * 60000;
    else this.chronoEndAt = null;

    this.pushLog(`Partie lancée — mode ${MODES[mode].label} !`);
    this.broadcast(this.publicState());

    if (this.hillTimer) clearInterval(this.hillTimer);
    if (mode === "kingHill") {
      this.hillTimer = setInterval(() => this.hillTick(), HILL_TICK_MS);
      this.hillTimer.unref();
    }

    this.scheduleTick(TURN_GAP_MS);
  }

  scheduleTick(delayMs) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), delayMs);
    this.timer.unref();
  }

  // ---- Fin de partie ----
  endGame(winnerIds, reason) {
    if (this.status !== "playing") return;
    this.status = "ended";
    this.winner = { ids: winnerIds, reason };
    if (this.timer) clearTimeout(this.timer);
    if (this.hillTimer) clearInterval(this.hillTimer);
    this.turn = null;
    const names = winnerIds.map(id => this.players[id]?.pseudo).filter(Boolean);
    this.pushLog(names.length ? `Victoire de ${names.join(" et ")} !` : "Match nul — personne ne l'emporte.");
    this.broadcast(this.publicState());
  }

  checkWinCondition() {
    if (this.status !== "playing") return;
    const list = Object.values(this.players);

    if (this.mode === "survivor") {
      if (list.length > 1) {
        const alive = list.filter(p => p.alive);
        if (alive.length <= 1) { this.endGame(alive.map(p => p.id), "survivor"); return; }
      }
    } else if (this.mode === "koHunt") {
      const winner = list.find(p => p.eliminations >= this.config.targetKO);
      if (winner) { this.endGame([winner.id], "koHunt"); return; }
    } else if (this.mode === "kingHill") {
      const winner = list.find(p => p.score >= this.config.targetScore);
      if (winner) { this.endGame([winner.id], "kingHill"); return; }
    } else if (this.mode === "harvest") {
      const winner = list.find(p => p.cards >= this.config.cardsToWin);
      if (winner) { this.endGame([winner.id], "harvest"); return; }
    }
  }

  // ---- Dégâts / éliminations ----
  applyDamage(attackerId, player, amount) {
    if (!player.alive) return;
    if (player.shield) { player.shield = false; this.pushLog(`${player.pseudo} bloque l'attaque avec son bouclier !`); return; }
    player.hp = clamp(player.hp - amount, 0, START_HP);
    if (player.hp === 0) this.onElimination(attackerId, player);
  }
  applyHeal(player, amount) { if (player.alive) player.hp = clamp(player.hp + amount, 0, START_HP); }

  onElimination(attackerId, victim) {
    victim.alive = false;
    this.pushLog(`${victim.pseudo} est K.O. !`);

    const attacker = attackerId ? this.players[attackerId] : null;
    if (attacker && attacker.id !== victim.id) attacker.eliminations += 1;

    if (this.mode === "harvest") {
      const lose = Math.max(0, Math.min(victim.cards, this.config.cardsLostOnDeath));
      victim.cards = Math.max(0, victim.cards - lose);
      if (lose > 0) {
        const spot = this.cardPickups.find(c => c.x === victim.x && c.y === victim.y);
        if (spot) spot.count += lose; else this.cardPickups.push({ x: victim.x, y: victim.y, count: lose });
        this.pushLog(`${victim.pseudo} laisse tomber ${lose} carte(s).`);
      }
    }

    const respawns = MODES[this.mode] ? MODES[this.mode].respawns : true;
    victim.respawnAt = respawns ? Date.now() + RESPAWN_DELAY_MS : null;

    this.checkWinCondition();
  }

  cellsForZone(anchorX, anchorY, size) {
    const half = Math.floor(size / 2);
    const cells = [];
    for (let dx = -half; dx <= size - 1 - half; dx++) {
      for (let dy = -half; dy <= size - 1 - half; dy++) {
        const x = anchorX + dx, y = anchorY + dy;
        if (inBounds(x, y)) cells.push({ x, y });
      }
    }
    return cells;
  }

  handleMove(player, msg) {
    if (!player.alive) return;
    const now = Date.now();
    if (now - player.lastMove < MOVE_COOLDOWN_MS) return;
    const { x, y } = msg;
    if (typeof x !== "number" || typeof y !== "number" || !inBounds(x, y)) return;
    const dx = Math.abs(x - player.x), dy = Math.abs(y - player.y);
    if (!((dx === 1 && dy === 0) || (dx === 0 && dy === 1))) return;
    const occupied = Object.values(this.players).some(p => p.alive && p.id !== player.id && p.x === x && p.y === y);
    if (occupied) return;

    player.x = x; player.y = y; player.lastMove = now;

    const mineIdx = this.hazards.findIndex(h => h.type === "mine" && h.x === x && h.y === y);
    if (mineIdx >= 0) {
      const mine = this.hazards[mineIdx];
      this.hazards.splice(mineIdx, 1);
      this.applyDamage(mine.ownerId, player, mine.damage || 30);
      this.pushLog(`${player.pseudo} a déclenché un piège explosif !`);
    }

    if (this.mode === "harvest") {
      const pickupIdx = this.cardPickups.findIndex(c => c.x === x && c.y === y);
      if (pickupIdx >= 0) {
        const pickup = this.cardPickups[pickupIdx];
        player.cards += pickup.count;
        this.cardPickups.splice(pickupIdx, 1);
        this.pushLog(`${player.pseudo} ramasse ${pickup.count} carte(s) !`);
        this.checkWinCondition();
      }
    }

    this.broadcast(this.publicState());
  }

  handleAttack(player, msg) {
    const turn = this.turn;
    if (!turn || turn.playerId !== player.id) return;
    if (Date.now() > turn.deadline) return;
    const attack = turn.attack;
    let affected = [];
    const hitPlayerAt = (x, y) => Object.values(this.players).find(p => p.alive && p.x === x && p.y === y);

    if (attack.target === "zone" && !attack.poison) {
      const zone = this.cellsForZone(msg.x, msg.y, attack.size);
      if (attack.random) {
        for (let i = 0; i < (attack.hits || 1); i++) {
          const c = zone[randInt(zone.length)];
          affected.push(c);
          const hitP = hitPlayerAt(c.x, c.y);
          if (hitP) this.applyDamage(player.id, hitP, attack.damage);
        }
      } else {
        affected = zone;
        for (const c of zone) { const hitP = hitPlayerAt(c.x, c.y); if (hitP) this.applyDamage(player.id, hitP, attack.damage); }
      }
    } else if (attack.target === "zone" && attack.poison) {
      const zone = this.cellsForZone(msg.x, msg.y, attack.size);
      affected = zone;
      for (const c of zone) { const hitP = hitPlayerAt(c.x, c.y); if (hitP) this.applyDamage(player.id, hitP, attack.damage); }
      this.hazards.push({ type: "poison", x: msg.x, y: msg.y, size: attack.size, damage: Math.round(attack.damage / 2), ticks: attack.ticks, ownerId: player.id });
    } else if (attack.target === "cell" && attack.trap) {
      if (inBounds(msg.x, msg.y)) { this.hazards.push({ type: "mine", x: msg.x, y: msg.y, damage: attack.damage, ownerId: player.id }); affected = [{ x: msg.x, y: msg.y }]; }
    } else if (attack.target === "cell" && attack.teleport) {
      const dist = Math.abs(msg.x - player.x) + Math.abs(msg.y - player.y);
      if (inBounds(msg.x, msg.y) && dist <= attack.range && !hitPlayerAt(msg.x, msg.y)) { player.x = msg.x; player.y = msg.y; }
    } else if (attack.target === "cell") {
      if (inBounds(msg.x, msg.y)) { affected = [{ x: msg.x, y: msg.y }]; const hitP = hitPlayerAt(msg.x, msg.y); if (hitP) this.applyDamage(player.id, hitP, attack.damage); }
    } else if (attack.target === "self" && attack.shield) {
      player.shield = true;
    } else if (attack.target === "self") {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = player.x + dx, y = player.y + dy;
        if (!inBounds(x, y)) continue;
        affected.push({ x, y });
        const hitP = hitPlayerAt(x, y);
        if (hitP) this.applyDamage(player.id, hitP, attack.damage);
      }
    } else if (attack.target === "line") {
      const axis = msg.axis === "col" ? "col" : "row";
      affected = [];
      for (let i = 0; i < GRID_SIZE; i++) {
        const x = axis === "row" ? i : msg.x;
        const y = axis === "row" ? msg.y : i;
        affected.push({ x, y });
        const hitP = hitPlayerAt(x, y);
        if (hitP) this.applyDamage(player.id, hitP, attack.damage);
      }
    } else if (attack.target === "direction") {
      const dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
      const d = dirs[msg.dir] || [0, 0];
      let cx = player.x, cy = player.y;
      for (let step = 0; step < attack.distance; step++) {
        const nx = cx + d[0], ny = cy + d[1];
        if (!inBounds(nx, ny)) break;
        cx = nx; cy = ny;
        affected.push({ x: cx, y: cy });
        const hitP = hitPlayerAt(cx, cy);
        if (hitP) this.applyDamage(player.id, hitP, attack.damage);
      }
      const occupied = Object.values(this.players).some(p => p.alive && p.id !== player.id && p.x === cx && p.y === cy);
      if (!occupied) { player.x = cx; player.y = cy; }
    } else if (attack.target === "ally") {
      const targetId = msg.targetId || player.id;
      const target = this.players[targetId];
      if (target && target.alive) {
        const dist = Math.abs(target.x - player.x) + Math.abs(target.y - player.y);
        if (target.id === player.id || dist <= 2) this.applyHeal(target, attack.heal);
      }
    }

    this.pushLog(`${player.pseudo} utilise ${attack.name} !`);
    this.turn = null;
    this.broadcast({ type: "attackResolved", attackId: attack.id, by: player.id, cells: affected });
    this.broadcast(this.publicState());
    if (this.status === "playing") this.scheduleTick(TURN_GAP_MS);
  }

  // ---- Roi de la case : points périodiques ----
  hillTick() {
    if (this.status !== "playing" || this.mode !== "kingHill") { clearInterval(this.hillTimer); return; }
    let changed = false;
    for (const p of Object.values(this.players)) {
      if (p.alive && onHill(p.x, p.y)) { p.score += 1; changed = true; }
    }
    if (changed) {
      this.broadcast(this.publicState());
      this.checkWinCondition();
    }
  }

  tick() {
    if (this.status !== "playing") return;
    const now = Date.now();

    // Chrono : fin de partie au temps imparti
    if (this.mode === "chrono" && this.chronoEndAt && now >= this.chronoEndAt) {
      const list = Object.values(this.players);
      const maxKO = list.reduce((m, p) => Math.max(m, p.eliminations), 0);
      const winners = list.filter(p => p.eliminations === maxKO && maxKO > 0).map(p => p.id);
      this.endGame(winners, "chrono");
      return;
    }

    for (const p of Object.values(this.players)) {
      if (!p.alive && p.respawnAt && now >= p.respawnAt) {
        const spawn = this.freeSpawn();
        p.alive = true; p.hp = Math.round(START_HP / 2); p.x = spawn.x; p.y = spawn.y; p.respawnAt = null;
        this.pushLog(`${p.pseudo} revient dans l'arène.`);
      }
    }

    this.hazards = this.hazards.filter(h => {
      if (h.type !== "poison") return true;
      const cells = this.cellsForZone(h.x, h.y, h.size);
      for (const p of Object.values(this.players)) {
        if (p.alive && cells.some(c => c.x === p.x && c.y === p.y)) this.applyDamage(h.ownerId, p, h.damage);
      }
      h.ticks -= 1;
      return h.ticks > 0;
    });

    if (this.status !== "playing") return; // une élimination pendant le poison peut avoir fini la partie

    if (this.turn && now > this.turn.deadline) {
      const p = this.players[this.turn.playerId];
      this.pushLog(`${p ? p.pseudo : "Le joueur"} n'a pas utilisé son arme à temps.`);
      this.turn = null;
      this.broadcast(this.publicState());
      this.scheduleTick(TURN_GAP_MS);
      return;
    }

    if (!this.turn) {
      const alive = Object.values(this.players).filter(p => p.alive);
      if (alive.length === 0) { this.scheduleTick(1000); return; }
      const chosen = alive[randInt(alive.length)];
      let attack = ATTACKS[randInt(ATTACKS.length)];
      if (ATTACKS.length > 1) {
        let guard = 0;
        while (attack.id === this.lastAttackId && guard < 10) { attack = ATTACKS[randInt(ATTACKS.length)]; guard++; }
      }
      this.lastAttackId = attack.id;
      this.turn = { playerId: chosen.id, attack, deadline: Date.now() + ATTACK_WINDOW_MS };
      this.pushLog(`${chosen.pseudo} reçoit : ${attack.name} !`);
      this.broadcast(this.publicState());
      this.scheduleTick(ATTACK_WINDOW_MS + 200);
    } else {
      this.scheduleTick(1000);
    }
  }
}

// ---- Registre des rooms en mémoire ----
const rooms = new Map();
function getOrCreateRoom(code) {
  code = code.toUpperCase();
  let room = rooms.get(code);
  if (!room) { room = new Room(code); rooms.set(code, room); }
  room.lastActivity = Date.now();
  return room;
}

// ménage périodique des rooms inactives
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    const hasPlayers = Object.keys(room.players).length > 0;
    if (!hasPlayers && now - room.lastActivity > ROOM_IDLE_CLEANUP_MS) {
      if (room.timer) clearTimeout(room.timer);
      if (room.hillTimer) clearInterval(room.hillTimer);
      rooms.delete(code);
    }
  }
}, 1000 * 60 * 10);
cleanupInterval.unref();

// ---- Serveur HTTP + WebSocket ----
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (url.pathname === "/api/create" && req.method === "POST") {
    const code = genCode();
    getOrCreateRoom(code);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code }));
    return;
  }

  if (url.pathname === "/api/modes") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(MODES));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("CapNaval backend OK");
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws") { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const code = url.searchParams.get("code");
    const pseudo = (url.searchParams.get("pseudo") || "Joueur").slice(0, 16);
    if (!code) { ws.close(1008, "code manquant"); return; }

    const room = getOrCreateRoom(code);
    const player = room.addPlayer(ws, pseudo);
    if (!player) { ws.send(JSON.stringify({ type: "error", message: "Partie pleine (6 joueurs max)." })); ws.close(1008, "full"); return; }

    ws.send(JSON.stringify({ type: "welcome", playerId: player.id, code: room.code, modes: MODES }));
    room.pushLog(`${pseudo} a rejoint la partie.`);
    room.broadcast(room.publicState());

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      room.lastActivity = Date.now();
      const p = room.players[player.id];
      if (!p) return;
      if (msg.type === "start" && player.id === room.hostId && (room.status === "lobby" || room.status === "ended")) {
        room.start(msg.mode, msg.config);
      } else if (msg.type === "move" && room.status === "playing") {
        room.handleMove(p, msg);
      } else if (msg.type === "attack" && room.status === "playing") {
        room.handleAttack(p, msg);
      }
    });

    ws.on("close", () => {
      room.removePlayer(player.id);
      room.broadcast(room.publicState());
    });
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => console.log(`CapNaval backend en écoute sur le port ${PORT}`));
}

module.exports = { Room, MODES, ATTACKS, GRID_SIZE };
