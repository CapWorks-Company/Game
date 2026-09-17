// ===== CONFIG =====
// Remplace par l'URL de ton service Render une fois déployé
// (ex: "https://capnaval.onrender.com")
const BACKEND_URL = "https://capnaval-backend.onrender.com";

// Métadonnées des attaques côté client (doit correspondre à ATTACKS dans le backend)
const ATTACKS_META = {
  meteor:       { name: "Météorite",         desc: "Choisis le centre d'une zone 3x3",                  target: "zone", size: 3 },
  airstrike:    { name: "Frappe aérienne",   desc: "Choisis le centre d'une zone 5x5", target: "zone", size: 5 },
  meteorShower: { name: "Pluie de météores", desc: "Choisis le centre d'une zone 6x6", target: "zone", size: 6 },
  snipe:        { name: "Tir de précision",  desc: "Choisis une case à frapper",           target: "cell" },
  laser:        { name: "Rayon laser",       desc: "Choisis une case puis une ligne ou colonne", target: "line" },
  shockwave:    { name: "Onde de choc",      desc: "Frappe toutes les cases autour de toi",             target: "self" },
  gunline:      { name: "Rafale",            desc: "Choisis une case puis une ligne ou colonne",         target: "line" },
  grenade:      { name: "Grenade",           desc: "Choisis le centre d'une zone 2x2",                   target: "zone", size: 2 },
  arrow:        { name: "Flèche perforante", desc: "Choisis une direction : transperce jusqu'à un mur",  target: "direction" },
  charge:       { name: "Charge",            desc: "Choisis une direction pour foncer",                  target: "direction" },
  tornado:      { name: "Tornade",           desc: "Choisis le centre d'une zone 3x3 à aspirer",         target: "zone", size: 3 },
  net:          { name: "Filet",             desc: "Choisis une case à immobiliser",                     target: "cell" },
  frost:        { name: "Vague de givre",    desc: "Choisis le centre d'une zone 3x3 à ralentir",        target: "zone", size: 3 },
  mine:         { name: "Piège explosif",    desc: "Choisis une case où poser le piège",                 target: "cell" },
  heal:         { name: "Soin d'urgence",    desc: "Touche-toi ou un allié proche pour soigner",         target: "ally" },
  shield:       { name: "Bouclier",          desc: "Absorbe la prochaine attaque reçue",                 target: "self" },
  poison:       { name: "Zone toxique",      desc: "Choisis le centre d'une zone 3x3 empoisonnée",       target: "zone", size: 3 },
  teleport:     { name: "Téléportation",     desc: "Choisis n'importe quelle case sur la carte",         target: "cell" },
};

// Thème visuel + icône par attaque (regroupe les animations par famille plutôt
// que d'en écrire une par attaque : plus lisible, tout aussi distinctif à l'écran)
const ATTACK_THEME = {
  meteor: "fire", airstrike: "fire", meteorShower: "fire", grenade: "fire",
  snipe: "physical", gunline: "physical", laser: "physical", charge: "physical", arrow: "physical",
  poison: "poison",
  frost: "ice",
  tornado: "control", net: "control",
  heal: "heal", shield: "shield", teleport: "teleport", mine: "trap",
};
const ATTACK_ICON = {
  meteor: "☄️", airstrike: "✈️", meteorShower: "🌠", grenade: "💣",
  snipe: "🎯", gunline: "🔫", laser: "⚡", charge: "🐗", arrow: "🏹",
  poison: "☠️", frost: "❄️", tornado: "🌪️", net: "🕸️",
  heal: "💚", shield: "🛡️", teleport: "🌀", mine: "💥",
};

let ws = null;
let myId = null;
let myCode = null;
let myPseudo = null;
let lastState = null;
let targetingAttackId = null;
let selectedCell = null;
let MODES_META = {};
let MAPS_META = {};
let lastMyHp = null;
let chronoTickHandle = null;
let lastTurnKey = null;

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
  survivor: [],
};

function populateModeSelect(selectEl) {
  selectEl.innerHTML = Object.entries(MODES_META)
    .map(([id, m]) => `<option value="${id}">${escapeHtml(m.label)}</option>`)
    .join("");
}

function populateMapSelect(selectEl) {
  selectEl.innerHTML = Object.entries(MAPS_META)
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

function wireMapSelector(selectEl, descEl, previewEl) {
  const update = () => {
    descEl.textContent = (MAPS_META[selectEl.value] && MAPS_META[selectEl.value].desc) || "";
    if (previewEl) renderMapPreview(selectEl.value, previewEl);
  };
  selectEl.addEventListener("change", update);
  update();
}

function renderMapPreview(mapId, containerEl) {
  const def = MAPS_META[mapId];
  if (!def) { containerEl.innerHTML = ""; return; }
  const n = 12;
  const cells = new Array(n * n).fill("");
  const place = (count, cls) => {
    let placed = 0, guard = 0;
    while (placed < count && guard < 800) {
      guard++;
      const idx = Math.floor(Math.random() * n * n);
      if (!cells[idx]) { cells[idx] = cls; placed++; }
    }
  };
  place(def.walls || 0, "mp-w");
  place(def.barrels || 0, "mp-b");
  place(def.mud || 0, "mp-m");
  containerEl.innerHTML = `<div class="map-preview-grid">${cells.map(c => `<div class="mp-cell ${c}"></div>`).join("")}</div>`;
}

// ---------- Réglages sauvegardés (localStorage) ----------
const SETTINGS_KEY = "capnaval_last_settings";
let appliedSavedSettingsOnce = false;

function saveLastSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}
function loadLastSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || null; } catch (e) { return null; }
}

function applySavedSettings(prefix) {
  const saved = loadLastSettings();
  if (!saved) return;
  const modeSelect = document.getElementById(prefix + "mode-select");
  const modeConfig = document.getElementById(prefix + "mode-config");
  const modeDesc = document.getElementById(prefix + "mode-desc");
  if (modeSelect && saved.mode && MODES_META[saved.mode]) {
    modeSelect.value = saved.mode;
    renderModeConfigFields(saved.mode, modeConfig, modeDesc);
    if (saved.config) {
      modeConfig.querySelectorAll("input[name]").forEach(inp => {
        if (saved.config[inp.name] !== undefined) inp.value = saved.config[inp.name];
      });
    }
  }
  const mapSelect = document.getElementById(prefix + "map-select");
  if (mapSelect && saved.config && saved.config.mapId && MAPS_META[saved.config.mapId]) {
    mapSelect.value = saved.config.mapId;
    mapSelect.dispatchEvent(new Event("change"));
  }
  const powerToggle = document.getElementById(prefix + "powerups-toggle");
  if (powerToggle && saved.config && typeof saved.config.powerupsEnabled !== "undefined") {
    powerToggle.checked = !!saved.config.powerupsEnabled;
  }
  const powerInterval = document.getElementById(prefix + "powerup-interval");
  if (powerInterval && saved.config && saved.config.powerupIntervalSec) {
    powerInterval.value = saved.config.powerupIntervalSec;
  }
  const teamsToggle = document.getElementById(prefix + "teams-toggle");
  if (teamsToggle && saved.config && typeof saved.config.teamsEnabled !== "undefined") {
    teamsToggle.checked = !!saved.config.teamsEnabled;
  }
  const shrinkToggle = document.getElementById(prefix + "shrink-toggle");
  if (shrinkToggle && saved.config && typeof saved.config.shrinkEnabled !== "undefined") {
    shrinkToggle.checked = !!saved.config.shrinkEnabled;
  }
}

// ---------- Ecrans ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ---------- Pseudo mémorisé ----------
const PSEUDO_KEY = "capnaval_pseudo";
(function prefillPseudo() {
  const saved = localStorage.getItem(PSEUDO_KEY);
  if (saved) document.getElementById("input-pseudo").value = saved;
})();
function saveLastPseudo(pseudo) {
  try { localStorage.setItem(PSEUDO_KEY, pseudo); } catch (e) { /* ignore */ }
}

// ---------- Accueil ----------
document.getElementById("btn-create").addEventListener("click", async () => {
  const pseudo = document.getElementById("input-pseudo").value.trim();
  if (!pseudo) return setHomeError("Entre un pseudo.");
  saveLastPseudo(pseudo);
  const isPublic = document.getElementById("create-public-toggle").checked;
  try {
    const res = await fetch(`${BACKEND_URL}/api/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic }),
    });
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
  saveLastPseudo(pseudo);
  connect(code, pseudo);
});

function setHomeError(msg) { document.getElementById("home-error").textContent = msg; }

// ---------- Liste des parties publiques ----------
let publicRoomsTimer = null;
async function refreshPublicRooms() {
  const list = document.getElementById("public-rooms-list");
  const empty = document.getElementById("public-rooms-empty");
  try {
    const res = await fetch(`${BACKEND_URL}/api/public-rooms`);
    const rooms = await res.json();
    list.innerHTML = "";
    if (!rooms.length) { empty.style.display = "block"; return; }
    empty.style.display = "none";
    rooms.forEach(r => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="pname">Partie de ${escapeHtml(r.hostPseudo)}</span>
        <span class="room-meta">${r.players}/${r.maxPlayers} · ${r.status === "ended" ? "en pause" : "en salle"}</span>`;
      li.addEventListener("click", () => {
        const pseudo = document.getElementById("input-pseudo").value.trim();
        if (!pseudo) { setHomeError("Entre un pseudo avant de rejoindre."); return; }
        saveLastPseudo(pseudo);
        connect(r.code, pseudo);
      });
      list.appendChild(li);
    });
  } catch (e) { /* silencieux : liste juste non rafraîchie */ }
}
document.getElementById("btn-refresh-public").addEventListener("click", refreshPublicRooms);
function startPublicRoomsPolling() {
  refreshPublicRooms();
  if (publicRoomsTimer) clearInterval(publicRoomsTimer);
  publicRoomsTimer = setInterval(refreshPublicRooms, 7000);
}
function stopPublicRoomsPolling() {
  if (publicRoomsTimer) clearInterval(publicRoomsTimer);
  publicRoomsTimer = null;
}
startPublicRoomsPolling();

// ---------- Identité persistante (pour la reconnexion) ----------
const CLIENT_ID_KEY = "capnaval_client_id";
function getClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}
const myClientId = getClientId();

let intentionalDisconnect = false;
let reconnectTimer = null;
let reconnectAttempts = 0;

function showConnectionBanner(text) {
  const b = document.getElementById("connection-banner");
  if (b) { b.textContent = text; b.style.display = "block"; }
}
function hideConnectionBanner() {
  const b = document.getElementById("connection-banner");
  if (b) b.style.display = "none";
}

function connect(code, pseudo) {
  stopPublicRoomsPolling();
  myCode = code; myPseudo = pseudo;
  const wsUrl = BACKEND_URL.replace(/^http/, "ws") + `/ws?code=${code}&pseudo=${encodeURIComponent(pseudo)}&clientId=${myClientId}`;
  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => { setHomeError(""); hideConnectionBanner(); reconnectAttempts = 0; });
  ws.addEventListener("message", (evt) => onMessage(JSON.parse(evt.data)));
  ws.addEventListener("close", () => {
    if (intentionalDisconnect) return;
    if (myId) {
      showConnectionBanner("Connexion perdue — reconnexion en cours…");
      scheduleReconnect();
    } else {
      setHomeError("Connexion perdue.");
    }
  });
  ws.addEventListener("error", () => {});
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempts++;
  if (reconnectAttempts > 40) { showConnectionBanner("Impossible de se reconnecter. Recharge la page."); return; }
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(myCode, myPseudo); }, 2000);
}

// ---------- Quitter une partie ----------
function doLeave() {
  intentionalDisconnect = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  try { if (ws) ws.send(JSON.stringify({ type: "leave" })); } catch (e) { /* ignore */ }
  setTimeout(() => { try { if (ws) ws.close(); } catch (e) { /* ignore */ } }, 80);
  myId = null; myCode = null; lastState = null;
  boardBuilt = false;
  playerTokenEls.clear();
  prevPlayerStats.clear();
  hideConnectionBanner();
  showScreen("screen-home");
  startPublicRoomsPolling();
}
document.getElementById("btn-leave-lobby").addEventListener("click", doLeave);
document.getElementById("btn-leave-end").addEventListener("click", doLeave);
document.getElementById("btn-leave-game").addEventListener("click", doLeave);

document.getElementById("btn-end-match").addEventListener("click", () => {
  if (!confirm("Terminer la partie et ramener tout le monde au salon ?")) return;
  ws.send(JSON.stringify({ type: "endMatch" }));
});

function onMessage(msg) {
  if (msg.type === "welcome") {
    myId = msg.playerId;
    myCode = msg.code;
    MODES_META = msg.modes || {};
    MAPS_META = msg.maps || {};
    document.getElementById("room-code").textContent = myCode;

    const modeSelect = document.getElementById("mode-select");
    const modeConfig = document.getElementById("mode-config");
    const modeDesc = document.getElementById("mode-desc");
    populateModeSelect(modeSelect);
    renderModeConfigFields(modeSelect.value, modeConfig, modeDesc);
    wireModeSelector(modeSelect, modeConfig, modeDesc);

    const mapSelect = document.getElementById("map-select");
    const mapDesc = document.getElementById("map-desc");
    const mapPreview = document.getElementById("map-preview");
    populateMapSelect(mapSelect);
    wireMapSelector(mapSelect, mapDesc, mapPreview);

    const endModeSelect = document.getElementById("end-mode-select");
    const endModeConfig = document.getElementById("end-mode-config");
    const endModeDesc = document.getElementById("end-mode-desc");
    populateModeSelect(endModeSelect);
    renderModeConfigFields(endModeSelect.value, endModeConfig, endModeDesc);
    wireModeSelector(endModeSelect, endModeConfig, endModeDesc);

    const endMapSelect = document.getElementById("end-map-select");
    const endMapDesc = document.getElementById("end-map-desc");
    const endMapPreview = document.getElementById("end-map-preview");
    populateMapSelect(endMapSelect);
    wireMapSelector(endMapSelect, endMapDesc, endMapPreview);

    if (!appliedSavedSettingsOnce) {
      applySavedSettings("");
      applySavedSettings("end-");
      appliedSavedSettingsOnce = true;
    }
    // Pas de showScreen ici : le message "state" qui suit immédiatement indique
    // le bon écran (lobby / jeu / fin), y compris lors d'une reconnexion en cours de partie.
  } else if (msg.type === "state") {
    lastState = msg;
    render();
  } else if (msg.type === "log") {
    pushLog(msg.message);
  } else if (msg.type === "attackResolved") {
    if (msg.attackId === "teleport" || msg.attackId === "mine") noGlideFor.add(msg.by);
    flashCells(msg.cells, msg.attackId);
  } else if (msg.type === "telegraph") {
    showTelegraph(msg.cells, msg.resolveAt, msg.attackId);
    castingGlow(msg.by, msg.attackId, msg.resolveAt);
  } else if (msg.type === "error") {
    setHomeError(msg.message);
  }
}

// ---------- Lobby ----------
function renderLobby() {
  showScreen("screen-lobby");
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
  document.getElementById("host-public-toggle-wrap").style.display = isHost ? "block" : "none";
  if (isHost) document.getElementById("lobby-public-toggle").checked = !!lastState.isPublic;
}
document.getElementById("lobby-public-toggle").addEventListener("change", (e) => {
  ws.send(JSON.stringify({ type: "setPublic", value: e.target.checked }));
});
document.getElementById("btn-start").addEventListener("click", () => {
  const mode = document.getElementById("mode-select").value;
  const config = readModeConfig(document.getElementById("mode-config"));
  config.mapId = document.getElementById("map-select").value;
  config.powerupsEnabled = document.getElementById("powerups-toggle").checked;
  config.powerupIntervalSec = document.getElementById("powerup-interval").value;
  config.teamsEnabled = document.getElementById("teams-toggle").checked;
  config.shrinkEnabled = document.getElementById("shrink-toggle").checked;
  saveLastSettings({ mode, config });
  ws.send(JSON.stringify({ type: "start", mode, config }));
});
document.getElementById("btn-restart").addEventListener("click", () => {
  const mode = document.getElementById("end-mode-select").value;
  const config = readModeConfig(document.getElementById("end-mode-config"));
  config.mapId = document.getElementById("end-map-select").value;
  config.powerupsEnabled = document.getElementById("end-powerups-toggle").checked;
  config.powerupIntervalSec = document.getElementById("end-powerup-interval").value;
  config.teamsEnabled = document.getElementById("end-teams-toggle").checked;
  config.shrinkEnabled = document.getElementById("end-shrink-toggle").checked;
  saveLastSettings({ mode, config });
  ws.send(JSON.stringify({ type: "start", mode, config }));
});

// ---------- Rendu principal ----------
let lastKnownStatus = null;
function render() {
  if (!lastState) return;
  if (lastState.status === "lobby") {
    renderLobby();
    lastKnownStatus = "lobby";
    return;
  }
  if (lastState.status === "ended") {
    renderEndScreen();
    lastKnownStatus = "ended";
    return;
  }
  if (lastKnownStatus !== "playing") startCountdownOverlay();
  lastKnownStatus = "playing";
  showScreen("screen-game");
  renderBoard();
  renderHud();
  renderPlayersPanel();
  const isHost = myId === lastState.hostId;
  document.getElementById("btn-end-match").style.display = isHost ? "block" : "none";
  document.getElementById("btn-leave-game").style.display = isHost ? "none" : "block";
}

function startCountdownOverlay() {
  const overlay = document.getElementById("countdown-overlay");
  const numberEl = document.getElementById("countdown-number");
  if (!overlay || !numberEl) return;
  const steps = ["3", "2", "1", "GO !"];
  overlay.style.display = "flex";
  let i = 0;
  const showStep = () => {
    numberEl.textContent = steps[i];
    numberEl.style.animation = "none";
    void numberEl.offsetWidth;
    numberEl.style.animation = "";
    i++;
    if (i < steps.length) setTimeout(showStep, 650);
    else setTimeout(() => { overlay.style.display = "none"; }, 500);
  };
  showStep();
}

function teamBadge(p) {
  if (!lastState.teamsEnabled || !p.team) return "";
  const color = (lastState.teamColors && lastState.teamColors[p.team]) || "#888";
  return `<span class="team-badge" style="background:${color}">${p.team}</span>`;
}

function statLine(p, mode) {
  if (mode === "koHunt" || mode === "chrono") return `${p.eliminations} K.O.`;
  if (mode === "kingHill") return `${p.score} pts`;
  if (mode === "survivor") return p.alive ? "vivant" : "K.O.";
  return "";
}

function statSort(p, mode) {
  if (mode === "koHunt" || mode === "chrono") return p.eliminations;
  if (mode === "kingHill") return p.score;
  if (mode === "survivor") return p.alive ? 1 : 0;
  return 0;
}

function renderEndScreen() {
  const wasAlreadyEnded = lastKnownStatus === "ended";
  showScreen("screen-end");
  const w = lastState.winner;
  const winnerEl = document.getElementById("end-winner");
  if (w && w.ids && w.ids.length) {
    const names = w.ids.map(id => (lastState.players.find(p => p.id === id) || {}).pseudo).filter(Boolean);
    const reasonTxt = w.reason === "suddenDeath" ? " (mort subite)" : "";
    winnerEl.textContent = names.length
      ? `🏆 ${names.join(" et ")} remporte la partie !${reasonTxt} (${lastState.modeLabel || ""})`
      : "Partie terminée.";
    if (!wasAlreadyEnded && names.length) celebrateVictory();
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
      li.style.flexDirection = "column";
      li.style.alignItems = "flex-start";
      li.style.gap = "4px";
      const isWinner = w && w.ids && w.ids.includes(p.id);
      li.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;width:100%">
          <span class="dot" style="background:${p.color}"></span>
          <span class="pname">${escapeHtml(p.pseudo)}${isWinner ? " 🏆" : ""}</span>
          ${teamBadge(p)}
          <span class="hint" style="margin-left:auto">${statLine(p, lastState.mode)}</span>
        </div>
        <div class="hint" style="font-size:11px;padding-left:24px">
          ${p.damageDealt} dégâts infligés · ${p.damageTaken} subis · ${p.timesKO} K.O. subi(s)
        </div>`;
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
    board.innerHTML = "";
    const layer = document.createElement("div");
    layer.id = "player-layer";
    layer.className = "player-layer";
    board.appendChild(layer);

    board.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    const cellPx = Math.min(28, Math.floor((window.innerWidth - 24) / n));
    const gap = 2;
    const totalWidth = cellPx * n;
    board.style.width = `${totalWidth}px`;
    cellGeometry = { track: (totalWidth - (n - 1) * gap) / n, gap };

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

  // zone qui rétrécit : teinte toutes les cases actuellement hors de la zone sûre
  if (lastState.shrink && lastState.shrink.enabled) {
    const { radius, center } = lastState.shrink;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dist = Math.max(Math.abs(x - center.x), Math.abs(y - center.y));
        if (dist > radius) {
          const c = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
          if (c) c.classList.add("danger-zone");
        }
      }
    }
  }

  // obstacles de la carte
  const obstacles = lastState.obstacles || { walls: [], barrels: [], mud: [] };
  (obstacles.mud || []).forEach(({ x, y }) => {
    const c = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
    if (c) c.classList.add("mud");
  });
  (obstacles.walls || []).forEach(({ x, y }) => {
    const c = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
    if (c) c.classList.add("wall");
  });
  (obstacles.barrels || []).forEach(({ x, y }) => {
    const c = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
    if (c) c.classList.add("barrel");
  });

  // bonus au sol
  const POWERUP_ICON = { heal: "+PV", resist: "🛡", speed: "⚡" };
  (lastState.powerups || []).forEach(pu => {
    const c = board.querySelector(`.cell[data-x="${pu.x}"][data-y="${pu.y}"]`);
    if (!c) return;
    const el = document.createElement("div");
    el.className = "powerup powerup-" + pu.type;
    el.textContent = POWERUP_ICON[pu.type] || "?";
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
    const now = Date.now();
    let statusIcons = "";
    if (p.rootedUntil && p.rootedUntil > now) statusIcons += "🕸";
    if (p.slowedUntil && p.slowedUntil > now) statusIcons += "❄️";
    if (p.resistUntil && p.resistUntil > now) statusIcons += "🛡";
    if (p.speedUntil && p.speedUntil > now) statusIcons += "⚡";
    el.querySelector(".pseudo-label").textContent = p.pseudo + (statusIcons ? " " + statusIcons : "") + (p.connected === false ? " (déco)" : "");
    el.classList.toggle("me", p.id === myId);
    el.classList.toggle("dead", !p.alive);
    el.classList.toggle("disconnected", p.connected === false);

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
  const shrinkTxt = (lastState.shrink && lastState.shrink.enabled) ? ` · 🌀 zone : rayon ${lastState.shrink.radius}` : "";
  if (lastState.suddenDeath) return `<strong>⚔ MORT SUBITE</strong> — le prochain K.O. gagne !${shrinkTxt}`;
  if (mode === "koHunt") return `<strong>Chasse au K.O.</strong> — objectif ${config.targetKO} K.O.${lastState.teamsEnabled ? " (cumul d'équipe)" : ""}${shrinkTxt}`;
  if (mode === "kingHill") return `<strong>Roi de la case</strong> — objectif ${config.targetScore} pts (tiens le centre)${shrinkTxt}`;
  if (mode === "survivor") return `<strong>Dernier survivant</strong> — pas de respawn${shrinkTxt}`;
  if (mode === "chrono") {
    const remaining = Math.max(0, (lastState.chronoEndAt || 0) - Date.now());
    const mm = Math.floor(remaining / 60000);
    const ss = Math.floor((remaining % 60000) / 1000).toString().padStart(2, "0");
    return `<strong>Chrono</strong> — ${mm}:${ss} restantes (plus de K.O. gagne)${shrinkTxt}`;
  }
  return shrinkTxt ? shrinkTxt.replace(/^ · /, "") : "";
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
  const total = 12000; // fenêtre d'action côté serveur (ATTACK_WINDOW_MS)
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
    const isMe = turn.playerId === myId;
    const turnKey = turn.playerId + ":" + turn.attackId + ":" + turn.deadline;
    banner.classList.toggle("my-turn", isMe);
    if (turnKey !== lastTurnKey) {
      lastTurnKey = turnKey;
      runSlotMachine(banner, turn, isMe);
    }
  } else {
    lastTurnKey = null;
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
      let pattern = 100;
      if (me.hp === 0) pattern = [80, 60, 120];
      else if (recentHazardFlag === "explosion") pattern = [60, 40, 60, 40, 60];
      else if (recentHazardFlag === "mine") pattern = [40, 30, 40];
      try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
    }
    lastMyHp = me.hp;
  }
}

// Effet "machine à sous" : les icônes d'armes défilent brièvement avant de se
// figer sur celle réellement tirée au sort — rend le tirage plus excitant.
function runSlotMachine(banner, turn, isMe) {
  const p = lastState.players.find(pl => pl.id === turn.playerId);
  const who = isMe ? "À toi de jouer" : `${p ? p.pseudo : "Un joueur"} prépare`;
  const ids = Object.keys(ATTACKS_META);
  let spins = 0;
  const maxSpins = 8;
  const spin = setInterval(() => {
    const randomId = ids[Math.floor(Math.random() * ids.length)];
    banner.textContent = `${who} : ${ATTACK_ICON[randomId] || ""} ${ATTACKS_META[randomId].name} ?`;
    spins++;
    if (spins >= maxSpins) {
      clearInterval(spin);
      const icon = ATTACK_ICON[turn.attackId] || "";
      banner.textContent = `${who} : ${icon} ${turn.attackName} !`;
      if (isMe) startTargeting(turn.attackId);
    }
  }, 65);
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
    const discoTxt = p.connected === false ? " · déconnecté" : "";
    li.innerHTML = `<span class="dot" style="background:${p.color}"></span>
      ${teamBadge(p)}
      <span class="pname">${escapeHtml(p.pseudo)}${p.id===myId?" (toi)":""}${!p.alive?" · K.O.":""}${stat?` · ${stat}`:""}${discoTxt}</span>
      <span class="hpbar"><span class="hpbar-fill" style="width:${pct}%;background:${barColor}"></span></span>`;
    if (p.connected === false) li.style.opacity = "0.5";
    list.appendChild(li);
  });
}

// ---------- Sons (synthétisés, pas de fichier audio à héberger) ----------
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  }
  if (audioCtx.state === "suspended") { audioCtx.resume().catch(() => {}); }
  return audioCtx;
}
function playTone(freq, duration, type, gainVal) {
  const ctx = ensureAudio(); if (!ctx) return;
  const osc = ctx.createOscillator(); const gain = ctx.createGain();
  osc.type = type || "sine"; osc.frequency.value = freq;
  gain.gain.value = gainVal || 0.15;
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.stop(ctx.currentTime + duration + 0.02);
}
function playNoise(duration, gainVal) {
  const ctx = ensureAudio(); if (!ctx) return;
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const src = ctx.createBufferSource(); src.buffer = buffer;
  const gain = ctx.createGain(); gain.gain.value = gainVal || 0.2;
  src.connect(gain); gain.connect(ctx.destination);
  src.start();
}
function sfxImpact() { playNoise(0.15, 0.22); }
function sfxExplosion() { playNoise(0.35, 0.32); playTone(80, 0.3, "sawtooth", 0.18); }
function sfxKO() { playTone(220, 0.15, "square", 0.18); setTimeout(() => playTone(140, 0.25, "square", 0.18), 120); }
function sfxPickup() { playTone(660, 0.08, "sine", 0.14); setTimeout(() => playTone(880, 0.12, "sine", 0.14), 80); }

function sfxFanfare() {
  const notes = [523, 659, 784, 1047]; // do-mi-sol-do, petit air de victoire
  notes.forEach((freq, i) => setTimeout(() => playTone(freq, 0.28, "triangle", 0.16), i * 130));
}

function spawnConfetti() {
  const layer = document.getElementById("confetti-layer");
  if (!layer) return;
  const colors = ["#ff8a3d", "#4ade80", "#60a5fa", "#facc15", "#a855f7", "#ef4444"];
  const count = 60;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = Math.random() * 100 + "vw";
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = (2 + Math.random() * 1.5) + "s";
    piece.style.animationDelay = (Math.random() * 0.4) + "s";
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.appendChild(piece);
    setTimeout(() => piece.remove(), 4500);
  }
}

function celebrateVictory() {
  spawnConfetti();
  sfxFanfare();
}

// Petit flag temporaire posé par les messages de log, pour distinguer la source
// des dégâts encaissés (mine / explosion) et adapter la vibration + le son.
let recentHazardFlag = null;
let recentHazardTimer = null;
function flagRecentHazard(kind) {
  recentHazardFlag = kind;
  clearTimeout(recentHazardTimer);
  recentHazardTimer = setTimeout(() => { recentHazardFlag = null; }, 500);
}

function pushLog(message) {
  const feed = document.getElementById("log-feed");
  const div = document.createElement("div");
  div.textContent = message;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
  while (feed.children.length > 30) feed.removeChild(feed.firstChild);

  if (message.includes("piège explosif")) flagRecentHazard("mine");
  if (message.includes("tonneau explose")) flagRecentHazard("explosion");
  if (message.includes("explose") || message.includes("piège explosif")) sfxExplosion();
  else if (message.includes("récupère un bonus")) sfxPickup();
  else if (message.includes("est K.O.")) sfxKO();
}

function flashCells(cells, attackId) {
  sfxImpact();
  const layer = document.getElementById("player-layer");
  if (!layer || !cellGeometry.track) return;
  const theme = ATTACK_THEME[attackId] || "physical";
  (cells || []).forEach(({x,y}) => {
    const ring = document.createElement("div");
    ring.className = "impact-ring theme-" + theme;
    ring.style.left = (x * (cellGeometry.track + cellGeometry.gap)) + "px";
    ring.style.top = (y * (cellGeometry.track + cellGeometry.gap)) + "px";
    ring.style.width = cellGeometry.track + "px";
    ring.style.height = cellGeometry.track + "px";
    layer.appendChild(ring);
    setTimeout(() => ring.remove(), 500);
  });
}

// Clignotement d'avertissement affiché dès qu'une attaque est déclarée : les cases
// listées ici sont EXACTEMENT celles qui seront touchées à resolveAt — le joueur a
// jusque-là pour s'écarter et esquiver. Le thème (couleur/style) varie selon la
// famille de l'attaque pour qu'on reconnaisse le danger au premier coup d'œil.
function showTelegraph(cells, resolveAt, attackId) {
  const layer = document.getElementById("player-layer");
  if (!layer || !cellGeometry.track) return;
  const theme = ATTACK_THEME[attackId] || "physical";
  const els = (cells || []).map(({x,y}) => {
    const el = document.createElement("div");
    el.className = "telegraph-warn theme-" + theme;
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

// Halo lumineux sur le jeton du lanceur pendant qu'une attaque se prépare —
// permet de repérer qui a déclenché la menace sans lire les logs.
function castingGlow(playerId, attackId, resolveAt) {
  const el = playerTokenEls.get(playerId);
  if (!el) return;
  const theme = ATTACK_THEME[attackId] || "physical";
  el.classList.add("casting", "theme-" + theme);
  const delay = Math.max(0, (resolveAt || Date.now()) - Date.now());
  setTimeout(() => el.classList.remove("casting", "theme-" + theme), delay + 60);
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
  hint.textContent = (ATTACK_ICON[attackId] ? ATTACK_ICON[attackId] + " " : "") + (meta.desc || "Choisis une cible");

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
