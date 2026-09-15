// ===== CONFIG =====
// Remplace par l'URL de ton Worker Cloudflare une fois déployé
// (ex: "https://tactical-arena.tonpseudo.workers.dev")
const BACKEND_URL = "https://tactical-arena.YOUR-SUBDOMAIN.workers.dev";

// Métadonnées des attaques côté client (doit correspondre à ATTACKS dans le backend)
const ATTACKS_META = {
  meteor:    { name: "Météorite",        desc: "Choisis le centre d'une zone 3x3",         target: "zone", size: 3 },
  airstrike: { name: "Frappe aérienne",  desc: "Choisis le centre d'une zone 5x5 (3 impacts aléatoires)", target: "zone", size: 5 },
  snipe:     { name: "Tir de précision", desc: "Choisis une case à frapper",                target: "cell" },
  shockwave: { name: "Onde de choc",     desc: "Frappe toutes les cases autour de toi",     target: "self" },
  gunline:   { name: "Rafale",           desc: "Choisis une case puis une ligne ou colonne", target: "line" },
  grenade:   { name: "Grenade",          desc: "Choisis le centre d'une zone 2x2",          target: "zone", size: 2 },
  mine:      { name: "Piège explosif",   desc: "Choisis une case où poser le piège",        target: "cell" },
  heal:      { name: "Soin d'urgence",   desc: "Touche-toi ou un allié proche pour soigner", target: "ally" },
  shield:    { name: "Bouclier",         desc: "Absorbe la prochaine attaque reçue",        target: "self" },
  poison:    { name: "Zone toxique",     desc: "Choisis le centre d'une zone 3x3 empoisonnée", target: "zone", size: 3 },
  teleport:  { name: "Téléportation",    desc: "Choisis une case dans un rayon de 4",       target: "cell" },
  charge:    { name: "Charge",           desc: "Choisis une direction pour foncer",          target: "direction" },
};

let ws = null;
let myId = null;
let myCode = null;
let myPseudo = null;
let lastState = null;
let targetingAttackId = null;
let selectedCell = null;

// ---------- Ecrans ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ---------- Accueil ----------
document.getElementById("btn-create").addEventListener("click", async () => {
  const pseudo = document.getElementById("input-pseudo").value.trim();
  if (!pseudo) return setHomeError("Entre un pseudo.");
  try {
    const res = await fetch(`${BACKEND_URL}/api/create`, { method: "POST" });
    const data = await res.json();
    connect(data.code, pseudo);
  } catch (e) {
    setHomeError("Impossible de joindre le serveur. Vérifie BACKEND_URL dans app.js.");
  }
});

document.getElementById("btn-join").addEventListener("click", () => {
  const pseudo = document.getElementById("input-pseudo").value.trim();
  const code = document.getElementById("input-code").value.trim().toUpperCase();
  if (!pseudo) return setHomeError("Entre un pseudo.");
  if (!code) return setHomeError("Entre un code de partie.");
  connect(code, pseudo);
});

function setHomeError(msg) { document.getElementById("home-error").textContent = msg; }

function connect(code, pseudo) {
  myCode = code; myPseudo = pseudo;
  const wsUrl = BACKEND_URL.replace(/^http/, "ws") + `/ws?code=${code}&pseudo=${encodeURIComponent(pseudo)}`;
  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => setHomeError(""));
  ws.addEventListener("message", (evt) => onMessage(JSON.parse(evt.data)));
  ws.addEventListener("close", () => setHomeError("Connexion perdue."));
  ws.addEventListener("error", () => setHomeError("Erreur de connexion."));
}

function onMessage(msg) {
  if (msg.type === "welcome") {
    myId = msg.playerId;
    myCode = msg.code;
    document.getElementById("room-code").textContent = myCode;
    showScreen("screen-lobby");
  } else if (msg.type === "state") {
    lastState = msg;
    render();
  } else if (msg.type === "log") {
    pushLog(msg.message);
  } else if (msg.type === "attackResolved") {
    flashCells(msg.cells);
  } else if (msg.type === "error") {
    setHomeError(msg.message);
  }
}

// ---------- Lobby ----------
function renderLobby() {
  const list = document.getElementById("lobby-players");
  list.innerHTML = "";
  lastState.players.forEach(p => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="dot" style="background:${p.color}"></span><span class="pname">${escapeHtml(p.pseudo)}${p.id === lastState.hostId ? " (hôte)" : ""}</span>`;
    list.appendChild(li);
  });
  const isHost = myId === lastState.hostId;
  document.getElementById("btn-start").style.display = isHost ? "block" : "none";
  document.getElementById("lobby-wait").style.display = isHost ? "none" : "block";
}
document.getElementById("btn-start").addEventListener("click", () => ws.send(JSON.stringify({ type: "start" })));

// ---------- Rendu principal ----------
function render() {
  if (!lastState) return;
  if (lastState.status === "lobby") {
    renderLobby();
    return;
  }
  showScreen("screen-game");
  renderBoard();
  renderHud();
  renderPlayersPanel();
}

let boardBuilt = false;
function renderBoard() {
  const board = document.getElementById("board");
  const n = lastState.gridSize;
  if (!boardBuilt) {
    board.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    const cellPx = Math.min(28, Math.floor((window.innerWidth - 24) / n));
    board.style.width = `${cellPx * n}px`;
    board.innerHTML = "";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.x = x; cell.dataset.y = y;
        cell.addEventListener("click", () => onCellClick(x, y));
        board.appendChild(cell);
      }
    }
    boardBuilt = true;
  }

  // reset classes/content
  board.querySelectorAll(".cell").forEach(c => {
    c.className = "cell";
    c.innerHTML = "";
  });

  const me = lastState.players.find(p => p.id === myId);

  // cases marchables (adjacentes à moi)
  if (me && me.alive && !targetingAttackId) {
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy]) => {
      const x = me.x+dx, y = me.y+dy;
      const c = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
      if (c) c.classList.add("walkable");
    });
  }

  // hazards
  (lastState.hazards || []).forEach(h => {
    const c = board.querySelector(`.cell[data-x="${h.x}"][data-y="${h.y}"]`);
    if (!c) return;
    if (h.type === "mine" && h.ownerId === myId) c.classList.add("hazard-mine");
    if (h.type === "poison") {
      const half = Math.floor(h.size/2);
      for (let dx=-half; dx<=h.size-1-half; dx++) for (let dy=-half; dy<=h.size-1-half; dy++) {
        const cc = board.querySelector(`.cell[data-x="${h.x+dx}"][data-y="${h.y+dy}"]`);
        if (cc) cc.classList.add("hazard-poison");
      }
    }
  });

  // joueurs
  lastState.players.forEach(p => {
    const c = board.querySelector(`.cell[data-x="${p.x}"][data-y="${p.y}"]`);
    if (!c) return;
    const token = document.createElement("div");
    token.className = "player-token" + (p.id === myId ? " me" : "") + (!p.alive ? " dead" : "");
    token.style.background = p.color;
    token.innerHTML = `<span class="pseudo-label">${escapeHtml(p.pseudo)}</span>`;
    c.appendChild(token);
  });
}

function renderHud() {
  const banner = document.getElementById("turn-banner");
  const turn = lastState.turn;
  if (turn) {
    const p = lastState.players.find(pl => pl.id === turn.playerId);
    const isMe = turn.playerId === myId;
    banner.textContent = isMe
      ? `À toi de jouer : ${turn.attackName} !`
      : `${p ? p.pseudo : "Un joueur"} prépare : ${turn.attackName}`;
    banner.classList.toggle("my-turn", isMe);
    if (isMe && targetingAttackId !== turn.attackId) startTargeting(turn.attackId);
  } else {
    banner.textContent = "En attente du prochain tour…";
    banner.classList.remove("my-turn");
    stopTargeting();
  }

  const me = lastState.players.find(p => p.id === myId);
  if (me) {
    const pct = Math.max(0, me.hp);
    const fill = document.querySelector(".my-hp-fill");
    fill.style.width = pct + "%";
    fill.style.background = pct > 50 ? "var(--hp-full)" : pct > 20 ? "var(--hp-mid)" : "var(--hp-low)";
  }
}

function renderPlayersPanel() {
  const list = document.getElementById("game-players");
  list.innerHTML = "";
  lastState.players
    .slice()
    .sort((a,b) => (b.id===myId)-(a.id===myId))
    .forEach(p => {
    const li = document.createElement("li");
    const pct = Math.max(0, p.hp);
    const barColor = pct > 50 ? "var(--hp-full)" : pct > 20 ? "var(--hp-mid)" : "var(--hp-low)";
    li.innerHTML = `<span class="dot" style="background:${p.color}"></span>
      <span class="pname">${escapeHtml(p.pseudo)}${p.id===myId?" (toi)":""}${!p.alive?" · K.O.":""}</span>
      <span class="hpbar"><span class="hpbar-fill" style="width:${pct}%;background:${barColor}"></span></span>`;
    list.appendChild(li);
  });
}

function pushLog(message) {
  const feed = document.getElementById("log-feed");
  const div = document.createElement("div");
  div.textContent = message;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
  while (feed.children.length > 30) feed.removeChild(feed.firstChild);
}

function flashCells(cells) {
  (cells || []).forEach(({x,y}) => {
    const c = document.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
    if (!c) return;
    c.style.background = "#ff8a3d";
    setTimeout(() => { c.style.background = ""; }, 300);
  });
}

// ---------- Déplacement ----------
function onCellClick(x, y) {
  if (targetingAttackId) { onTargetClick(x, y); return; }
  const me = lastState.players.find(p => p.id === myId);
  if (!me || !me.alive) return;
  const dx = Math.abs(x - me.x), dy = Math.abs(y - me.y);
  if ((dx===1 && dy===0) || (dx===0 && dy===1)) {
    ws.send(JSON.stringify({ type: "move", x, y }));
  }
}

// ---------- Ciblage d'attaque ----------
function startTargeting(attackId) {
  targetingAttackId = attackId;
  selectedCell = null;
  const meta = ATTACKS_META[attackId] || {};
  const hint = document.getElementById("target-hint");
  hint.style.display = "block";
  hint.textContent = meta.desc || "Choisis une cible";

  document.getElementById("direction-controls").style.display = meta.target === "direction" ? "grid" : "none";
  document.getElementById("line-controls").style.display = "none";
  document.getElementById("btn-fire-self").style.display = (meta.target === "self") ? "block" : "none";

  document.querySelectorAll(".cell").forEach(c => c.classList.toggle("targetable", meta.target !== "self" && meta.target !== "direction"));
}

function stopTargeting() {
  targetingAttackId = null;
  selectedCell = null;
  document.getElementById("target-hint").style.display = "none";
  document.getElementById("direction-controls").style.display = "none";
  document.getElementById("line-controls").style.display = "none";
  document.getElementById("btn-fire-self").style.display = "none";
  document.querySelectorAll(".cell").forEach(c => c.classList.remove("targetable"));
}

function onTargetClick(x, y) {
  const meta = ATTACKS_META[targetingAttackId] || {};
  if (meta.target === "line") {
    selectedCell = { x, y };
    document.getElementById("line-controls").style.display = "flex";
    document.getElementById("target-hint").textContent = "Frappe la ligne ou la colonne de cette case";
    return;
  }
  if (meta.target === "ally") {
    const targetPlayer = lastState.players.find(p => p.x === x && p.y === y);
    ws.send(JSON.stringify({ type: "attack", x, y, targetId: targetPlayer ? targetPlayer.id : myId }));
    stopTargeting();
    return;
  }
  ws.send(JSON.stringify({ type: "attack", x, y }));
  stopTargeting();
}

document.getElementById("direction-controls").addEventListener("click", (e) => {
  const dir = e.target.dataset.dir;
  if (!dir || !targetingAttackId) return;
  ws.send(JSON.stringify({ type: "attack", dir }));
  stopTargeting();
});

document.getElementById("line-controls").addEventListener("click", (e) => {
  const axis = e.target.dataset.axis;
  if (!axis || !selectedCell) return;
  ws.send(JSON.stringify({ type: "attack", x: selectedCell.x, y: selectedCell.y, axis }));
  stopTargeting();
});

document.getElementById("btn-fire-self").addEventListener("click", () => {
  if (!targetingAttackId) return;
  ws.send(JSON.stringify({ type: "attack", x: 0, y: 0 }));
  stopTargeting();
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
