// ===== CONFIG =====
// Remplace par l'URL de ton service Render une fois déployé
// (ex: "https://capnaval.onrender.com")
const BACKEND_URL = "https://capnaval-backend.onrender.com";

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
let MODES_META = {};
let lastMyHp = null;
let chronoTickHandle = null;

// ---- Animation state ----
const playerTokenEls = new Map();  // playerId -> DOM node (persistant, pour glisser au lieu de sauter)
const prevPlayerStats = new Map(); // playerId -> { hp, alive }
let noGlideFor = new Set();        // ids à ne PAS faire glisser sur le prochain rendu (téléportation, respawn)
let cellGeometry = { track: 0, gap: 2 };

// Valeurs par défaut proposées pour chaque champ de config de mode
const MODE_FIELD_DEFS = {
  koHunt:   [{ name: "targetKO",         label: "Nombre de K.O. pour gagner",      def: 5,  min: 1, max: 50 }],
  kingHill: [{ name: "targetScore",      label: "Points pour gagner",              def: 20, min: 1, max: 200 }],
  chrono:   [{ name: "minutes",          label: "Durée (minutes)",                 def: 5,  min: 1, max: 60 }],
  harvest:  [
    { name: "cardsToWin",       label: "Cartes pour gagner",              def: 10, min: 1, max: 100 },
    { name: "cardsLostOnDeath", label: "Cartes perdues à chaque K.O.",    def: 2,  min: 0, max: 50 },
  ],
  survivor: [],
};

function populateModeSelect(selectEl) {
  selectEl.innerHTML = Object.entries(MODES_META)
    .map(([id, m]) => `<option value="${id}">${escapeHtml(m.label)}</option>`)
    .join("");
}

function renderModeConfigFields(mode, configEl, descEl) {
  descEl.textContent = (MODES_META[mode] && MODES_META[mode].desc) || "";
  const fields = MODE_FIELD_DEFS[mode] || [];
  configEl.innerHTML = fields.map(f => `
    <label class="field">
      <span>${f.label}</span>
      <input type="number" name="${f.name}" min="${f.min}" max="${f.max}" value="${f.def}">
    </label>`).join("");
}

function readModeConfig(configEl) {
  const config = {};
  configEl.querySelectorAll("input[name]").forEach(input => { config[input.name] = input.value; });
  return config;
}

function wireModeSelector(selectEl, configEl, descEl) {
  selectEl.addEventListener("change", () => renderModeConfigFields(selectEl.value, configEl, descEl));
}

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
    MODES_META = msg.modes || {};
    document.getElementById("room-code").textContent = myCode;

    const modeSelect = document.getElementById("mode-select");
    const modeConfig = document.getElementById("mode-config");
    const modeDesc = document.getElementById("mode-desc");
    populateModeSelect(modeSelect);
    renderModeConfigFields(modeSelect.value, modeConfig, modeDesc);
    wireModeSelector(modeSelect, modeConfig, modeDesc);

    const endModeSelect = document.getElementById("end-mode-select");
    const endModeConfig = document.getElementById("end-mode-config");
    const endModeDesc = document.getElementById("end-mode-desc");
    populateModeSelect(endModeSelect);
    renderModeConfigFields(endModeSelect.value, endModeConfig, endModeDesc);
    wireModeSelector(endModeSelect, endModeConfig, endModeDesc);

    showScreen("screen-lobby");
  } else if (msg.type === "state") {
    lastState = msg;
    render();
  } else if (msg.type === "log") {
    pushLog(msg.message);
  } else if (msg.type === "attackResolved") {
    if (msg.attackId === "teleport" || msg.attackId === "mine") noGlideFor.add(msg.by);
    flashCells(msg.cells);
  } else if (msg.type === "telegraph") {
    showTelegraph(msg.cells, msg.resolveAt);
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
  document.getElementById("mode-select-wrap").style.display = isHost ? "block" : "none";
  document.getElementById("lobby-wait").style.display = isHost ? "none" : "block";
}
document.getElementById("btn-start").addEventListener("click", () => {
  const mode = document.getElementById("mode-select").value;
  const config = readModeConfig(document.getElementById("mode-config"));
  ws.send(JSON.stringify({ type: "start", mode, config }));
});
document.getElementById("btn-restart").addEventListener("click", () => {
  const mode = document.getElementById("end-mode-select").value;
  const config = readModeConfig(document.getElementById("end-mode-config"));
  ws.send(JSON.stringify({ type: "start", mode, config }));
});

// ---------- Rendu principal ----------
function render() {
  if (!lastState) return;
  if (lastState.status === "lobby") {
    renderLobby();
    return;
  }
  if (lastState.status === "ended") {
    renderEndScreen();
    return;
  }
  showScreen("screen-game");
  renderBoard();
  renderHud();
  renderPlayersPanel();
}

function statLine(p, mode) {
  if (mode === "koHunt" || mode === "chrono") return `${p.eliminations} K.O.`;
  if (mode === "kingHill") return `${p.score} pts`;
  if (mode === "harvest") return `${p.cards} cartes`;
  if (mode === "survivor") return p.alive ? "vivant" : "K.O.";
  return "";
}

function statSort(p, mode) {
  if (mode === "koHunt" || mode === "chrono") return p.eliminations;
  if (mode === "kingHill") return p.score;
  if (mode === "harvest") return p.cards;
  if (mode === "survivor") return p.alive ? 1 : 0;
  return 0;
}

function renderEndScreen() {
  showScreen("screen-end");
  const w = lastState.winner;
  const winnerEl = document.getElementById("end-winner");
  if (w && w.ids && w.ids.length) {
    const names = w.ids.map(id => (lastState.players.find(p => p.id === id) || {}).pseudo).filter(Boolean);
    winnerEl.textContent = names.length
      ? `🏆 ${names.join(" et ")} remporte la partie ! (${lastState.modeLabel || ""})`
      : "Partie terminée.";
  } else {
    winnerEl.textContent = "Match nul — personne ne l'emporte.";
  }

  const list = document.getElementById("end-stats");
  list.innerHTML = "";
  lastState.players
    .slice()
    .sort((a, b) => statSort(b, lastState.mode) - statSort(a, lastState.mode))
    .forEach(p => {
      const li = document.createElement("li");
      const isWinner = w && w.ids && w.ids.includes(p.id);
      li.innerHTML = `<span class="dot" style="background:${p.color}"></span>
        <span class="pname">${escapeHtml(p.pseudo)}${isWinner ? " 🏆" : ""}</span>
        <span class="hint">${statLine(p, lastState.mode)}</span>`;
      list.appendChild(li);
    });

  const isHost = myId === lastState.hostId;
  document.getElementById("end-host-controls").style.display = isHost ? "block" : "none";
  document.getElementById("end-wait").style.display = isHost ? "none" : "block";
}

let boardBuilt = false;
function renderBoard() {
  const board = document.getElementById("board");
  const n = lastState.gridSize;
  if (!boardBuilt) {
    board.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    const cellPx = Math.min(28, Math.floor((window.innerWidth - 24) / n));
    const gap = 2;
    const totalWidth = cellPx * n;
    board.style.width = `${totalWidth}px`;
    cellGeometry = { track: (totalWidth - (n - 1) * gap) / n, gap };

    const layer = document.getElementById("player-layer");
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.x = x; cell.dataset.y = y;
        cell.addEventListener("click", () => onCellClick(x, y));
        board.insertBefore(cell, layer);
      }
    }
    boardBuilt = true;
  }

  // reset classes/content des cases (la couche joueurs n'est pas touchée)
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

  // colline (mode Roi de la case)
  if (lastState.mode === "kingHill") {
    (lastState.hillCells || []).forEach(({ x, y }) => {
      const c = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
      if (c) c.classList.add("hill");
    });
  }

  // cartes au sol (mode Récolte)
  (lastState.cardPickups || []).forEach(cp => {
    const c = board.querySelector(`.cell[data-x="${cp.x}"][data-y="${cp.y}"]`);
    if (!c) return;
    const el = document.createElement("div");
    el.className = "card-pickup";
    el.textContent = cp.count;
    c.appendChild(el);
  });

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

  updatePlayerTokens();
}

// ---- Jetons joueurs : éléments persistants sur une couche à part, pour pouvoir
// les faire glisser d'une case à l'autre au lieu de les re-créer à chaque rendu ----
function updatePlayerTokens() {
  const layer = document.getElementById("player-layer");
  const seen = new Set();

  lastState.players.forEach(p => {
    seen.add(p.id);
    let el = playerTokenEls.get(p.id);
    const isNew = !el;
    if (!el) {
      el = document.createElement("div");
      el.className = "player-token";
      el.innerHTML = `<span class="pseudo-label"></span>`;
      layer.appendChild(el);
      playerTokenEls.set(p.id, el);
    }
    el.style.background = p.color;
    el.querySelector(".pseudo-label").textContent = p.pseudo;
    el.classList.toggle("me", p.id === myId);
    el.classList.toggle("dead", !p.alive);

    const prev = prevPlayerStats.get(p.id);
    const respawned = !!(prev && prev.alive === false && p.alive === true);
    const skipGlide = isNew || respawned || noGlideFor.has(p.id);

    const left = p.x * (cellGeometry.track + cellGeometry.gap) + 2;
    const top = p.y * (cellGeometry.track + cellGeometry.gap) + 2;
    const size = Math.max(4, cellGeometry.track - 4);
    el.style.width = size + "px";
    el.style.height = size + "px";

    if (skipGlide) {
      el.classList.add("no-glide");
      el.style.left = left + "px";
      el.style.top = top + "px";
      void el.offsetWidth; // force le navigateur à appliquer la position avant de rétablir la transition
      el.classList.remove("no-glide");
    } else {
      el.style.left = left + "px";
      el.style.top = top + "px";
    }

    if (prev) {
      if (p.hp < prev.hp) spawnDamagePopup(el, `-${prev.hp - p.hp}`, "");
      if (prev.alive === true && p.alive === false) {
        el.classList.remove("ko-shake"); void el.offsetWidth; el.classList.add("ko-shake");
        setTimeout(() => el.classList.remove("ko-shake"), 450);
      } else if (p.hp > prev.hp && prev.alive === true) {
        spawnDamagePopup(el, `+${p.hp - prev.hp}`, "heal");
      } else if (prev.shield === true && p.shield === false && p.hp === prev.hp) {
        spawnDamagePopup(el, "Bloqué !", "block");
      }
    }
    prevPlayerStats.set(p.id, { hp: p.hp, alive: p.alive, shield: p.shield });
  });

  for (const [id, el] of playerTokenEls.entries()) {
    if (!seen.has(id)) { el.remove(); playerTokenEls.delete(id); prevPlayerStats.delete(id); }
  }
  noGlideFor.clear();
}

function spawnDamagePopup(tokenEl, text, kind) {
  const span = document.createElement("div");
  span.className = "dmg-popup" + (kind ? " " + kind : "");
  span.textContent = text;
  tokenEl.appendChild(span);
  setTimeout(() => span.remove(), 900);
}

function formatModeStatus() {
  const mode = lastState.mode, config = lastState.config || {};
  if (mode === "koHunt") return `<strong>Chasse au K.O.</strong> — objectif ${config.targetKO} K.O.`;
  if (mode === "kingHill") return `<strong>Roi de la case</strong> — objectif ${config.targetScore} pts (tiens le centre)`;
  if (mode === "harvest") return `<strong>Récolte</strong> — objectif ${config.cardsToWin} cartes`;
  if (mode === "survivor") return `<strong>Dernier survivant</strong> — pas de respawn`;
  if (mode === "chrono") {
    const remaining = Math.max(0, (lastState.chronoEndAt || 0) - Date.now());
    const mm = Math.floor(remaining / 60000);
    const ss = Math.floor((remaining % 60000) / 1000).toString().padStart(2, "0");
    return `<strong>Chrono</strong> — ${mm}:${ss} restantes (plus de K.O. gagne)`;
  }
  return "";
}

function startChronoTicker() {
  if (chronoTickHandle) clearInterval(chronoTickHandle);
  chronoTickHandle = setInterval(() => {
    if (!lastState || lastState.status !== "playing" || lastState.mode !== "chrono") {
      clearInterval(chronoTickHandle); chronoTickHandle = null; return;
    }
    const el = document.getElementById("mode-status");
    if (el) el.innerHTML = formatModeStatus();
  }, 1000);
}

let turnTickHandle = null;
function updateTurnTimerBar() {
  const bar = document.getElementById("turn-timer-bar");
  const fill = document.getElementById("turn-timer-fill");
  const turn = lastState && lastState.turn;
  if (!turn) { bar.style.display = "none"; if (turnTickHandle) { clearInterval(turnTickHandle); turnTickHandle = null; } return; }
  bar.style.display = "block";
  const total = 8000; // fenêtre d'action côté serveur (ATTACK_WINDOW_MS)
  const remaining = Math.max(0, turn.deadline - Date.now());
  const pct = Math.min(100, (remaining / total) * 100);
  fill.style.width = pct + "%";
  fill.style.background = pct > 40 ? "var(--accent)" : "var(--hp-low)";
  if (!turnTickHandle) {
    turnTickHandle = setInterval(() => {
      if (!lastState || !lastState.turn) { clearInterval(turnTickHandle); turnTickHandle = null; return; }
      updateTurnTimerBar();
    }, 100);
  }
}

function renderHud() {
  const modeStatusEl = document.getElementById("mode-status");
  if (lastState.mode) {
    modeStatusEl.style.display = "block";
    modeStatusEl.innerHTML = formatModeStatus();
    if (lastState.mode === "chrono" && !chronoTickHandle) startChronoTicker();
  } else {
    modeStatusEl.style.display = "none";
  }

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
  updateTurnTimerBar();

  const me = lastState.players.find(p => p.id === myId);
  if (me) {
    const pct = Math.max(0, me.hp);
    const fill = document.querySelector(".my-hp-fill");
    fill.style.width = pct + "%";
    fill.style.background = pct > 50 ? "var(--hp-full)" : pct > 20 ? "var(--hp-mid)" : "var(--hp-low)";

    if (lastMyHp !== null && me.hp < lastMyHp && navigator.vibrate) {
      try { navigator.vibrate(me.hp === 0 ? [80, 60, 120] : 100); } catch (e) { /* ignore */ }
    }
    lastMyHp = me.hp;
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
    const stat = lastState.mode && lastState.mode !== "survivor" ? statLine(p, lastState.mode) : "";
    li.innerHTML = `<span class="dot" style="background:${p.color}"></span>
      <span class="pname">${escapeHtml(p.pseudo)}${p.id===myId?" (toi)":""}${!p.alive?" · K.O.":""}${stat?` · ${stat}`:""}</span>
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
  const layer = document.getElementById("player-layer");
  if (!layer || !cellGeometry.track) return;
  (cells || []).forEach(({x,y}) => {
    const ring = document.createElement("div");
    ring.className = "impact-ring";
    ring.style.left = (x * (cellGeometry.track + cellGeometry.gap)) + "px";
    ring.style.top = (y * (cellGeometry.track + cellGeometry.gap)) + "px";
    ring.style.width = cellGeometry.track + "px";
    ring.style.height = cellGeometry.track + "px";
    layer.appendChild(ring);
    setTimeout(() => ring.remove(), 450);
  });
}

// Clignotement d'avertissement affiché dès qu'une attaque est déclarée : les cases
// listées ici sont EXACTEMENT celles qui seront touchées à resolveAt — le joueur a
// jusque-là pour s'écarter et esquiver.
function showTelegraph(cells, resolveAt) {
  const layer = document.getElementById("player-layer");
  if (!layer || !cellGeometry.track) return;
  const els = (cells || []).map(({x,y}) => {
    const el = document.createElement("div");
    el.className = "telegraph-warn";
    el.style.left = (x * (cellGeometry.track + cellGeometry.gap)) + "px";
    el.style.top = (y * (cellGeometry.track + cellGeometry.gap)) + "px";
    el.style.width = cellGeometry.track + "px";
    el.style.height = cellGeometry.track + "px";
    layer.appendChild(el);
    return el;
  });
  const delay = Math.max(0, (resolveAt || Date.now()) - Date.now());
  setTimeout(() => els.forEach(el => el.remove()), delay + 80);
}

// ---------- Déplacement (glissement de doigt) ----------
function onCellClick(x, y) {
  if (targetingAttackId) onTargetClick(x, y);
  // en dehors du ciblage, le clic sur une case ne fait plus rien : on se déplace au glissement.
}

const SWIPE_THRESHOLD_PX = 22;
let swipeStart = null;

function initSwipeControls() {
  const el = document.getElementById("board-wrap");
  if (!el) return;
  el.addEventListener("pointerdown", (e) => {
    if (targetingAttackId) return; // en visée, le tap sert à choisir la cible
    swipeStart = { x: e.clientX, y: e.clientY };
  });
  el.addEventListener("pointerup", (e) => {
    if (targetingAttackId || !swipeStart) { swipeStart = null; return; }
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.hypot(dx, dy) < SWIPE_THRESHOLD_PX) return;
    handleSwipeMove(dx, dy);
  });
  el.addEventListener("pointercancel", () => { swipeStart = null; });
}

function handleSwipeMove(dx, dy) {
  if (!lastState) return;
  const me = lastState.players.find(p => p.id === myId);
  if (!me || !me.alive) return;
  let x = me.x, y = me.y;
  if (Math.abs(dx) > Math.abs(dy)) x += dx > 0 ? 1 : -1;
  else y += dy > 0 ? 1 : -1;
  ws.send(JSON.stringify({ type: "move", x, y }));
}

initSwipeControls();

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
