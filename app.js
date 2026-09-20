// ===== CONFIG =====
// Remplace par l'URL de ton service Render une fois déployé
// (ex: "https://capnaval.onrender.com")
const BACKEND_URL = "https://capnaval-backend.onrender.com";

// Métadonnées des attaques côté client (doit correspondre à ATTACKS dans le backend)
const ATTACKS_META = {
  meteor:       { name: "Météorite",         desc: "Choisis le centre d'une zone 3x3",                  target: "zone", size: 3 },
  airstrike:    { name: "Frappe aérienne",   desc: "Choisis le centre d'une zone 5x5 : 3 impacts en rafale, instantané", target: "zone", size: 5 },
  meteorShower: { name: "Pluie de météores", desc: "Choisis le centre d'une zone 6x6 : 5 impacts en rafale, instantané", target: "zone", size: 6 },
  napalm:       { name: "Chute de napalme",  desc: "Choisis le centre d'une grande zone : 4 explosions 3x3 en rafale, instantané", target: "zone", size: 7 },
  acidRain:     { name: "Pluie acide",       desc: "Choisis une zone 7x7 : des cases deviennent toxiques au hasard", target: "zone", size: 7 },
  snipe:        { name: "Tir de précision",  desc: "Choisis une case à frapper, instantané",           target: "cell" },
  laser:        { name: "Rayon laser",       desc: "Choisis une case puis une ligne ou colonne, instantané", target: "line" },
  shockwave:    { name: "Onde de choc",      desc: "Frappe toutes les cases autour de toi, instantané", target: "self" },
  gunline:      { name: "Rafale",            desc: "Choisis une case puis une ligne ou colonne",         target: "line" },
  grenade:      { name: "Grenade",           desc: "Choisis le centre d'une zone 2x2",                   target: "zone", size: 2 },
  arrow:        { name: "Flèche perforante", desc: "Choisis une direction : transperce jusqu'à un mur",  target: "direction" },
  charge:       { name: "Charge",            desc: "Choisis une direction pour foncer, instantané",     target: "direction" },
  tornado:      { name: "Tornade",           desc: "Choisis le centre d'une zone 3x3 à aspirer",         target: "zone", size: 3 },
  net:          { name: "Filet",             desc: "Choisis une case à immobiliser",                     target: "cell" },
  frost:        { name: "Vague de givre",    desc: "Choisis le centre d'une zone 3x3 : laisse une trace glacée", target: "zone", size: 3 },
  mine:         { name: "Piège explosif",    desc: "Choisis une case où poser le piège",                 target: "cell" },
  heal:         { name: "Soin d'urgence",    desc: "Touche-toi ou un allié proche pour soigner",         target: "ally" },
  shield:       { name: "Bouclier",          desc: "Absorbe la prochaine attaque reçue",                 target: "self" },
  poison:       { name: "Zone toxique",      desc: "Choisis le centre d'une zone 3x3 empoisonnée",       target: "zone", size: 3 },
  teleport:     { name: "Téléportation",     desc: "Choisis n'importe quelle case sur la carte",         target: "cell" },
};

// Thème visuel + icône par attaque (regroupe les animations par famille plutôt
// que d'en écrire une par attaque : plus lisible, tout aussi distinctif à l'écran)
const ATTACK_THEME = {
  meteor: "fire", airstrike: "fire", meteorShower: "fire", napalm: "fire", grenade: "fire",
  snipe: "physical", gunline: "physical", laser: "physical", charge: "physical", arrow: "physical",
  poison: "poison", acidRain: "poison",
  frost: "ice",
  tornado: "control", net: "control",
  heal: "heal", shield: "shield", teleport: "teleport", mine: "trap",
};
const ATTACK_ICON = {
  meteor: "☄️", airstrike: "✈️", meteorShower: "🌠", napalm: "🔥", grenade: "💣",
  snipe: "🎯", gunline: "🔫", laser: "⚡", charge: "🐗", arrow: "🏹",
  poison: "☠️", acidRain: "🧪", frost: "❄️", tornado: "🌪️", net: "🕸️",
  heal: "💚", shield: "🛡️", teleport: "🌀", mine: "💥",
};
// Attaques dont les impacts s'affichent un par un (son + explosion à chaque case
// / groupe) plutôt que tous en même temps.
const STAGGERED_ATTACKS = new Set(["airstrike", "meteorShower", "napalm", "acidRain"]);
const STAGGER_DELAY_MS = 320;

let ws = null;
let myId = null;
let myCode = null;
let myPseudo = null;
let lastState = null;
let targetingAttackId = null;
let selectedCell = null;
let MODES_META = {};
let MAPS_META = {};
const mapWheelStates = new Map(); // containerId -> état de la roue (rotation, sélection...)
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

// ---------- Roue de la fortune (choix de carte) ----------
const WHEEL_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316"];
const WHEEL_FRICTION = 0.965;
const WHEEL_MIN_VELOCITY = 0.15;

function wheelPolarToXY(deg, r) {
  const rad = (deg * Math.PI) / 180;
  return [100 + r * Math.sin(rad), 100 - r * Math.cos(rad)];
}

function buildWheelSVG(order) {
  const n = order.length;
  const seg = 360 / n;
  let svg = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">`;
  order.forEach((id, i) => {
    const a0 = i * seg, a1 = (i + 1) * seg;
    const [x1, y1] = wheelPolarToXY(a0, 95);
    const [x2, y2] = wheelPolarToXY(a1, 95);
    const large = seg > 180 ? 1 : 0;
    const color = WHEEL_COLORS[i % WHEEL_COLORS.length];
    svg += `<path d="M100,100 L${x1.toFixed(2)},${y1.toFixed(2)} A95,95 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${color}" stroke="#10131a" stroke-width="2"/>`;
    const mid = a0 + seg / 2;
    const [lx, ly] = wheelPolarToXY(mid, 58);
    const label = (MAPS_META[id] && MAPS_META[id].label) || id;
    const uprightAtRest = (mid - 180).toFixed(2);
    svg += `<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" transform="rotate(${uprightAtRest} ${lx.toFixed(2)} ${ly.toFixed(2)})" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="700" fill="#10131a">${escapeHtml(label)}</text>`;
  });
  svg += `</svg>`;
  return svg;
}

function applyWheelRotation(el, deg) { el.style.transform = `rotate(${deg}deg)`; }

// Case actuellement sous la flèche (en bas de la roue), selon la rotation courante.
function wheelSegmentAt(state) {
  const seg = 360 / state.order.length;
  const effectiveLocal = (((180 - state.rotation) % 360) + 360) % 360;
  return Math.floor(effectiveLocal / seg) % state.order.length;
}

function syncMapFieldDisplays(mapId) {
  const label = (MAPS_META[mapId] && MAPS_META[mapId].label) || mapId || "—";
  const desc = (MAPS_META[mapId] && MAPS_META[mapId].desc) || "";
  const labelEl1 = document.getElementById("map-field-label");
  const labelEl2 = document.getElementById("end-map-field-label");
  if (labelEl1) labelEl1.textContent = label;
  if (labelEl2) labelEl2.textContent = label;
  const descEl1 = document.getElementById("map-desc");
  const descEl2 = document.getElementById("end-map-desc");
  if (descEl1) descEl1.textContent = desc;
  if (descEl2) descEl2.textContent = desc;
}

function selectWheelMap(state, wheelEl, descEl, mapId, playSound) {
  const changed = state.selected !== mapId;
  state.selected = mapId;
  if (descEl) descEl.textContent = (MAPS_META[mapId] && MAPS_META[mapId].desc) || "";
  syncMapFieldDisplays(mapId);
  const editBtn = document.getElementById("btn-edit-custom-map");
  if (editBtn) editBtn.style.display = mapId === "custom" ? "block" : "none";
  if (playSound && changed) sfxWheelSettle();
}

// Place la roue directement sur une carte donnée, sans animation ni son (état initial).
function setWheelToMap(state, wheelEl, mapId, descEl) {
  const idx = state.order.indexOf(mapId);
  if (idx < 0) return;
  const seg = 360 / state.order.length;
  const targetMid = idx * seg + seg / 2;
  state.rotation = 180 - targetMid;
  applyWheelRotation(wheelEl, state.rotation);
  state.lastSegmentIndex = idx;
  selectWheelMap(state, wheelEl, descEl, mapId, false);
}

function settleWheel(state, wheelEl, descEl) {
  const seg = 360 / state.order.length;
  const idx = wheelSegmentAt(state);
  const effectiveLocal = (((180 - state.rotation) % 360) + 360) % 360;
  const targetMid = idx * seg + seg / 2;
  const diff = targetMid - effectiveLocal;
  state.rotation -= diff;
  wheelEl.style.transition = "transform .35s cubic-bezier(.2,.8,.3,1)";
  applyWheelRotation(wheelEl, state.rotation);
  setTimeout(() => { wheelEl.style.transition = ""; }, 380);
  selectWheelMap(state, wheelEl, descEl, state.order[idx], true);
}

function attachWheelDrag(wheelEl, state, descEl) {
  let dragging = false, lastAngle = 0, lastTime = 0, velocity = 0;

  const angleAt = (clientX, clientY) => {
    const rect = wheelEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    return Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI);
  };

  const stopMomentum = () => { if (state.momentumRAF) cancelAnimationFrame(state.momentumRAF); state.momentumRAF = null; };

  const tickIfSegmentChanged = () => {
    const idx = wheelSegmentAt(state);
    if (idx !== state.lastSegmentIndex) { state.lastSegmentIndex = idx; sfxWheelTick(); }
  };

  const runMomentum = () => {
    velocity *= WHEEL_FRICTION;
    state.rotation += velocity;
    applyWheelRotation(wheelEl, state.rotation);
    tickIfSegmentChanged();
    if (Math.abs(velocity) > WHEEL_MIN_VELOCITY) {
      state.momentumRAF = requestAnimationFrame(runMomentum);
    } else {
      settleWheel(state, wheelEl, descEl);
    }
  };

  wheelEl.addEventListener("pointerdown", (e) => {
    stopMomentum();
    wheelEl.style.transition = "";
    dragging = true;
    try { wheelEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    lastAngle = angleAt(e.clientX, e.clientY);
    lastTime = performance.now();
    velocity = 0;
  });
  wheelEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const now = performance.now();
    const ang = angleAt(e.clientX, e.clientY);
    let delta = ang - lastAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    state.rotation += delta;
    applyWheelRotation(wheelEl, state.rotation);
    tickIfSegmentChanged();
    const dt = Math.max(1, now - lastTime);
    velocity = (delta / dt) * 16;
    lastAngle = ang; lastTime = now;
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    if (Math.abs(velocity) > WHEEL_MIN_VELOCITY) state.momentumRAF = requestAnimationFrame(runMomentum);
    else settleWheel(state, wheelEl, descEl);
  };
  wheelEl.addEventListener("pointerup", endDrag);
  wheelEl.addEventListener("pointercancel", endDrag);
}

function createMapWheel(containerId, descId) {
  const container = document.getElementById(containerId);
  const descEl = document.getElementById(descId);
  const order = Object.keys(MAPS_META);
  if (!container || !order.length) return null;
  container.innerHTML = buildWheelSVG(order);
  const state = { order, rotation: 0, selected: null, lastSegmentIndex: 0, momentumRAF: null };
  setWheelToMap(state, container, order[0], descEl);
  attachWheelDrag(container, state, descEl);
  mapWheelStates.set(containerId, state);
  return state;
}

function getWheelSelection() {
  const state = mapWheelStates.get("modal-map-wheel");
  return state ? state.selected : null;
}

function openMapModal() { document.getElementById("map-wheel-modal").style.display = "flex"; }
function closeMapModal() { document.getElementById("map-wheel-modal").style.display = "none"; }
document.getElementById("map-field-trigger").addEventListener("click", openMapModal);
document.getElementById("end-map-field-trigger").addEventListener("click", openMapModal);
document.getElementById("btn-confirm-map").addEventListener("click", closeMapModal);

// ---------- Éditeur de carte personnalisée (enregistré en local sur l'appareil) ----------
const CUSTOM_MAP_KEY = "capnaval_custom_map";
const CUSTOM_MAP_CYCLE = ["empty", "wall", "barrel", "mud"];

function loadCustomMap() {
  try {
    const raw = localStorage.getItem(CUSTOM_MAP_KEY);
    if (!raw) return { walls: [], barrels: [], mud: [] };
    const parsed = JSON.parse(raw);
    return {
      walls: Array.isArray(parsed.walls) ? parsed.walls : [],
      barrels: Array.isArray(parsed.barrels) ? parsed.barrels : [],
      mud: Array.isArray(parsed.mud) ? parsed.mud : [],
    };
  } catch (e) { return { walls: [], barrels: [], mud: [] }; }
}
function saveCustomMapToStorage(data) {
  try { localStorage.setItem(CUSTOM_MAP_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
}

let editingMap = { walls: [], barrels: [], mud: [] };

function cellTypeInEditor(x, y) {
  if (editingMap.walls.some(c => c.x === x && c.y === y)) return "wall";
  if (editingMap.barrels.some(c => c.x === x && c.y === y)) return "barrel";
  if (editingMap.mud.some(c => c.x === x && c.y === y)) return "mud";
  return "empty";
}

function buildEditorGrid() {
  const container = document.getElementById("map-editor-grid");
  container.innerHTML = "";
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const cell = document.createElement("div");
      cell.className = "me-cell";
      cell.dataset.x = x; cell.dataset.y = y;
      const t = cellTypeInEditor(x, y);
      if (t !== "empty") cell.classList.add("me-" + t);
      cell.addEventListener("click", () => cycleEditorCell(x, y));
      container.appendChild(cell);
    }
  }
}

function cycleEditorCell(x, y) {
  const current = cellTypeInEditor(x, y);
  const next = CUSTOM_MAP_CYCLE[(CUSTOM_MAP_CYCLE.indexOf(current) + 1) % CUSTOM_MAP_CYCLE.length];
  editingMap.walls = editingMap.walls.filter(c => !(c.x === x && c.y === y));
  editingMap.barrels = editingMap.barrels.filter(c => !(c.x === x && c.y === y));
  editingMap.mud = editingMap.mud.filter(c => !(c.x === x && c.y === y));
  if (next === "wall") editingMap.walls.push({ x, y });
  else if (next === "barrel") editingMap.barrels.push({ x, y });
  else if (next === "mud") editingMap.mud.push({ x, y });
  const cell = document.querySelector(`.me-cell[data-x="${x}"][data-y="${y}"]`);
  if (cell) cell.className = "me-cell" + (next !== "empty" ? " me-" + next : "");
  updateEditorCounts();
}

function updateEditorCounts() {
  const free = 144 - editingMap.walls.length - editingMap.barrels.length;
  const countsEl = document.getElementById("map-editor-counts");
  countsEl.textContent = `Murs : ${editingMap.walls.length} · Tonneaux : ${editingMap.barrels.length} · Boue : ${editingMap.mud.length} · Cases libres : ${free}/144`;
  countsEl.style.color = free < 12 ? "var(--danger)" : "var(--text-dim)";
  document.getElementById("map-editor-error").textContent = free < 12 ? "Il faut au moins 12 cases libres pour 6 joueurs." : "";
}

function openMapEditor() {
  const saved = loadCustomMap();
  editingMap = { walls: saved.walls.slice(), barrels: saved.barrels.slice(), mud: saved.mud.slice() };
  buildEditorGrid();
  updateEditorCounts();
  document.getElementById("map-editor-modal").style.display = "flex";
}
document.getElementById("btn-edit-custom-map").addEventListener("click", openMapEditor);
document.getElementById("btn-editor-close").addEventListener("click", () => {
  document.getElementById("map-editor-modal").style.display = "none";
});
document.getElementById("btn-editor-reset").addEventListener("click", () => {
  editingMap = { walls: [], barrels: [], mud: [] };
  buildEditorGrid();
  updateEditorCounts();
});
document.getElementById("btn-editor-save").addEventListener("click", () => {
  const free = 144 - editingMap.walls.length - editingMap.barrels.length;
  if (free < 12) return;
  saveCustomMapToStorage(editingMap);
  document.getElementById("map-editor-modal").style.display = "none";
});

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
  const pushToggle = document.getElementById(prefix + "push-toggle");
  if (pushToggle && saved.config && typeof saved.config.pushEnabled !== "undefined") {
    pushToggle.checked = !!saved.config.pushEnabled;
  }
  const shrinkToggle = document.getElementById(prefix + "shrink-toggle");
  if (shrinkToggle && saved.config && typeof saved.config.shrinkEnabled !== "undefined") {
    shrinkToggle.checked = !!saved.config.shrinkEnabled;
  }
  const shrinkModeSelect = document.getElementById(prefix + "shrink-mode-select");
  if (shrinkModeSelect && saved.config && saved.config.shrinkMode) {
    shrinkModeSelect.value = saved.config.shrinkMode;
  }
  const shrinkIntervalInput = document.getElementById(prefix + "shrink-interval");
  if (shrinkIntervalInput && saved.config && saved.config.shrinkIntervalSec) {
    shrinkIntervalInput.value = saved.config.shrinkIntervalSec;
  }
  if (shrinkToggle) shrinkToggle.dispatchEvent(new Event("change"));
  if (shrinkModeSelect) shrinkModeSelect.dispatchEvent(new Event("change"));

  const advIds = ["adv-starting-hp", "adv-respawn-delay", "adv-respawn-hp-percent", "adv-attack-window",
    "adv-turn-gap", "adv-move-cooldown", "adv-damage-mult", "adv-barrel-damage", "adv-powerup-max"];
  const advKeys = { "adv-starting-hp": "startingHP", "adv-respawn-delay": "respawnDelaySec", "adv-respawn-hp-percent": "respawnHpPercent",
    "adv-attack-window": "attackWindowSec", "adv-turn-gap": "turnGapSec", "adv-move-cooldown": "moveCooldownMs",
    "adv-damage-mult": "damageMultiplier", "adv-barrel-damage": "barrelDamage", "adv-powerup-max": "powerupMaxOnMap" };
  advIds.forEach(id => {
    const el = document.getElementById(prefix + id);
    const key = advKeys[id];
    if (el && saved.config && saved.config[key] !== undefined) el.value = saved.config[key];
  });
  const noRepeatEl = document.getElementById(prefix + "adv-weapon-no-repeat");
  if (noRepeatEl && saved.config && typeof saved.config.weaponNoRepeat !== "undefined") noRepeatEl.checked = !!saved.config.weaponNoRepeat;
  const mineVisibleEl = document.getElementById(prefix + "adv-mine-visible");
  if (mineVisibleEl && saved.config && typeof saved.config.mineVisibleToAll !== "undefined") mineVisibleEl.checked = !!saved.config.mineVisibleToAll;
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

// ---------- Installation PWA (icône sur l'appareil) ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* tant pis, l'app marche quand même */ });
  });
}

const isStandaloneAlready = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
let deferredInstallPrompt = null;
const btnInstall = document.getElementById("btn-install");

if (!isStandaloneAlready) {
  if (isIOS) {
    // Safari n'expose pas d'API pour déclencher l'installation : on montre le bouton,
    // qui ouvre des instructions manuelles au clic.
    btnInstall.style.display = "block";
  } else {
    // Chrome/Edge (Android ou bureau) : on intercepte l'invite native et on la
    // déclenche nous-même au clic, avec notre propre bouton dans le style du jeu.
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      btnInstall.style.display = "block";
    });
    window.addEventListener("appinstalled", () => { btnInstall.style.display = "none"; });
  }
}

btnInstall.addEventListener("click", async () => {
  if (isIOS) {
    document.getElementById("ios-install-modal").style.display = "flex";
    return;
  }
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  btnInstall.style.display = "none";
});
document.getElementById("btn-close-ios-modal").addEventListener("click", () => {
  document.getElementById("ios-install-modal").style.display = "none";
});

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
  lastMyPosKey = null;
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

    const endModeSelect = document.getElementById("end-mode-select");
    const endModeConfig = document.getElementById("end-mode-config");
    const endModeDesc = document.getElementById("end-mode-desc");
    populateModeSelect(endModeSelect);
    renderModeConfigFields(endModeSelect.value, endModeConfig, endModeDesc);
    wireModeSelector(endModeSelect, endModeConfig, endModeDesc);

    if (!appliedSavedSettingsOnce) {
      createMapWheel("modal-map-wheel", "modal-map-desc");
      const savedForMap = loadLastSettings();
      if (savedForMap && savedForMap.config && savedForMap.config.mapId && MAPS_META[savedForMap.config.mapId]) {
        const wheelState = mapWheelStates.get("modal-map-wheel");
        setWheelToMap(wheelState, document.getElementById("modal-map-wheel"), savedForMap.config.mapId, document.getElementById("modal-map-desc"));
      }
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
    if (STAGGERED_ATTACKS.has(msg.attackId) && msg.groups && msg.groups.length) {
      msg.groups.forEach((group, i) => {
        setTimeout(() => flashCells(group, msg.attackId), i * STAGGER_DELAY_MS);
      });
    } else {
      flashCells(msg.cells, msg.attackId);
    }
  } else if (msg.type === "telegraph") {
    showTelegraph(msg.cells, msg.resolveAt, msg.attackId);
    castingGlow(msg.by, msg.attackId, msg.resolveAt);
  } else if (msg.type === "kicked") {
    intentionalDisconnect = true;
    myId = null; myCode = null; lastState = null;
    boardBuilt = false; lastMyPosKey = null;
    playerTokenEls.clear(); prevPlayerStats.clear();
    showScreen("screen-home");
    startPublicRoomsPolling();
    setHomeError("Tu as été exclu de la partie par l'hôte.");
  } else if (msg.type === "error") {
    setHomeError(msg.message);
  }
}

// ---------- Lobby ----------
function renderLobby() {
  showScreen("screen-lobby");
  const list = document.getElementById("lobby-players");
  list.innerHTML = "";
  const isHost = myId === lastState.hostId;
  lastState.players.forEach(p => {
    const li = document.createElement("li");
    const isMe = p.id === myId;
    li.innerHTML = `<span class="dot" style="background:${p.color}"></span><span class="pname">${escapeHtml(p.pseudo)}${p.id === lastState.hostId ? " · hôte" : ""}</span>`;
    if (isHost && !isMe) {
      const actions = document.createElement("span");
      actions.style.display = "flex"; actions.style.gap = "6px"; actions.style.marginLeft = "auto";
      const transferBtn = document.createElement("button");
      transferBtn.className = "player-manage-btn"; transferBtn.title = "Rendre hôte"; transferBtn.textContent = "👑";
      transferBtn.addEventListener("click", () => {
        if (confirm(`Faire de ${p.pseudo} le nouvel hôte ?`)) ws.send(JSON.stringify({ type: "transferHost", targetId: p.id }));
      });
      const kickBtn = document.createElement("button");
      kickBtn.className = "player-manage-btn"; kickBtn.title = "Exclure"; kickBtn.textContent = "✕";
      kickBtn.addEventListener("click", () => {
        if (confirm(`Exclure ${p.pseudo} de la partie ?`)) ws.send(JSON.stringify({ type: "kickPlayer", targetId: p.id }));
      });
      actions.appendChild(transferBtn); actions.appendChild(kickBtn);
      li.appendChild(actions);
    }
    list.appendChild(li);
  });
  document.getElementById("btn-start").style.display = isHost ? "block" : "none";
  document.getElementById("mode-select-wrap").style.display = isHost ? "block" : "none";
  document.getElementById("lobby-wait").style.display = isHost ? "none" : "block";
  document.getElementById("host-public-toggle-wrap").style.display = isHost ? "block" : "none";
  document.getElementById("host-maxplayers-wrap").style.display = isHost ? "block" : "none";
  if (isHost) {
    document.getElementById("lobby-public-toggle").checked = !!lastState.isPublic;
    const mpInput = document.getElementById("lobby-maxplayers");
    if (document.activeElement !== mpInput) mpInput.value = lastState.maxPlayers || 6;
  }
}
document.getElementById("lobby-public-toggle").addEventListener("change", (e) => {
  ws.send(JSON.stringify({ type: "setPublic", value: e.target.checked }));
});
document.getElementById("lobby-maxplayers").addEventListener("change", (e) => {
  ws.send(JSON.stringify({ type: "setMaxPlayers", value: e.target.value }));
});
document.getElementById("btn-start").addEventListener("click", () => {
  const mode = document.getElementById("mode-select").value;
  const config = readModeConfig(document.getElementById("mode-config"));
  config.mapId = getWheelSelection();
  config.customMap = loadCustomMap();
  config.powerupsEnabled = document.getElementById("powerups-toggle").checked;
  config.powerupIntervalSec = document.getElementById("powerup-interval").value;
  config.teamsEnabled = document.getElementById("teams-toggle").checked;
  config.pushEnabled = document.getElementById("push-toggle").checked;
  config.shrinkEnabled = document.getElementById("shrink-toggle").checked;
  config.shrinkMode = document.getElementById("shrink-mode-select").value;
  config.shrinkIntervalSec = document.getElementById("shrink-interval").value;
  Object.assign(config, readAdvancedConfig(""));
  saveLastSettings({ mode, config });
  ws.send(JSON.stringify({ type: "start", mode, config }));
});
document.getElementById("btn-restart").addEventListener("click", () => {
  const mode = document.getElementById("end-mode-select").value;
  const config = readModeConfig(document.getElementById("end-mode-config"));
  config.mapId = getWheelSelection();
  config.customMap = loadCustomMap();
  config.powerupsEnabled = document.getElementById("end-powerups-toggle").checked;
  config.powerupIntervalSec = document.getElementById("end-powerup-interval").value;
  config.teamsEnabled = document.getElementById("end-teams-toggle").checked;
  config.pushEnabled = document.getElementById("end-push-toggle").checked;
  config.shrinkEnabled = document.getElementById("end-shrink-toggle").checked;
  config.shrinkMode = document.getElementById("end-shrink-mode-select").value;
  config.shrinkIntervalSec = document.getElementById("end-shrink-interval").value;
  Object.assign(config, readAdvancedConfig("end-"));
  saveLastSettings({ mode, config });
  ws.send(JSON.stringify({ type: "start", mode, config }));
});

// ---------- Paramètres avancés (lecture générique par préfixe) ----------
function readAdvancedConfig(prefix) {
  const val = (id, def) => { const el = document.getElementById(prefix + id); return el && el.value !== "" ? el.value : def; };
  const checked = (id, def) => { const el = document.getElementById(prefix + id); return el ? el.checked : def; };
  return {
    startingHP: val("adv-starting-hp"),
    respawnDelaySec: val("adv-respawn-delay"),
    respawnHpPercent: val("adv-respawn-hp-percent"),
    attackWindowSec: val("adv-attack-window"),
    turnGapSec: val("adv-turn-gap"),
    moveCooldownMs: val("adv-move-cooldown"),
    damageMultiplier: val("adv-damage-mult"),
    barrelDamage: val("adv-barrel-damage"),
    powerupMaxOnMap: val("adv-powerup-max"),
    weaponNoRepeat: checked("adv-weapon-no-repeat", true),
    mineVisibleToAll: checked("adv-mine-visible", false),
  };
}

// ---------- Options de la zone qui rétrécit (afficher/masquer) ----------
function wireShrinkOptions(prefix) {
  const toggle = document.getElementById(prefix + "shrink-toggle");
  const optsWrap = document.getElementById(prefix + "shrink-options-wrap");
  const modeSelect = document.getElementById(prefix + "shrink-mode-select");
  const customWrap = document.getElementById(prefix + "shrink-custom-wrap");
  const updateOpts = () => { optsWrap.style.display = toggle.checked ? "block" : "none"; };
  const updateCustom = () => { customWrap.style.display = modeSelect.value === "custom" ? "block" : "none"; };
  toggle.addEventListener("change", updateOpts);
  modeSelect.addEventListener("change", updateCustom);
  updateOpts();
  updateCustom();
}
wireShrinkOptions("");
wireShrinkOptions("end-");

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
    winnerEl.textContent = names.length
      ? `🏆 ${names.join(" et ")} remporte la partie !`
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

  // cases marchables (adjacentes à moi) — visibles même en train de viser une attaque
  if (me && me.alive) {
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
    if (h.type === "mine" && (lastState.mineVisibleToAll || h.ownerId === myId)) c.classList.add("hazard-mine");
    if (h.type === "poison" || h.type === "frost") {
      const cls = h.type === "poison" ? "hazard-poison" : "hazard-frost";
      const half = Math.floor(h.size/2);
      for (let dx=-half; dx<=h.size-1-half; dx++) for (let dy=-half; dy<=h.size-1-half; dy++) {
        const cc = board.querySelector(`.cell[data-x="${h.x+dx}"][data-y="${h.y+dy}"]`);
        if (cc) cc.classList.add(cls);
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
    el.querySelector(".pseudo-label").textContent = p.pseudo + (statusIcons ? " " + statusIcons : "") + (p.connected === false ? " · déco" : "");
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
  if (mode === "koHunt") return `<strong>Chasse au K.O.</strong> — objectif ${config.targetKO} K.O.${lastState.teamsEnabled ? " — cumul d'équipe" : ""}${shrinkTxt}`;
  if (mode === "kingHill") return `<strong>Roi de la case</strong> — objectif ${config.targetScore} pts, tiens le centre${shrinkTxt}`;
  if (mode === "survivor") return `<strong>Dernier survivant</strong> — pas de respawn${shrinkTxt}`;
  if (mode === "chrono") {
    const remaining = Math.max(0, (lastState.chronoEndAt || 0) - Date.now());
    const mm = Math.floor(remaining / 60000);
    const ss = Math.floor((remaining % 60000) / 1000).toString().padStart(2, "0");
    return `<strong>Chrono</strong> — ${mm}:${ss} restantes, plus de K.O. gagne${shrinkTxt}`;
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

let lastMyPosKey = null;
function updateEnergyBar() {
  const me = lastState.players.find(p => p.id === myId);
  const fill = document.getElementById("energy-fill");
  if (!me || !fill) return;
  const posKey = me.x + "," + me.y;
  if (lastMyPosKey !== null && posKey !== lastMyPosKey && me.alive) {
    const hasSpeed = !!(me.speedUntil && me.speedUntil > Date.now());
    const cooldownMs = hasSpeed ? 400 : 800;
    fill.style.background = hasSpeed ? "#facc15" : "#3b82f6";
    fill.style.transition = "none";
    fill.style.width = "100%";
    void fill.offsetWidth; // force le navigateur à appliquer avant de relancer la transition
    fill.style.transition = `width ${cooldownMs}ms linear`;
    fill.style.width = "0%";
  }
  lastMyPosKey = posKey;
}

function renderHud() {
  updateEnergyBar();
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
      <span class="pname">${escapeHtml(p.pseudo)}${p.id===myId?" · toi":""}${!p.alive?" · K.O.":""}${stat?` · ${stat}`:""}${discoTxt}</span>
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
function sfxWheelTick() { playTone(1400, 0.025, "square", 0.09); }
function sfxWheelSettle() { playTone(700, 0.05, "sine", 0.12); setTimeout(() => playTone(1000, 0.09, "sine", 0.12), 60); }

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
    const left = x * (cellGeometry.track + cellGeometry.gap);
    const top = y * (cellGeometry.track + cellGeometry.gap);
    const ring = document.createElement("div");
    ring.className = "impact-ring theme-" + theme;
    ring.style.left = left + "px";
    ring.style.top = top + "px";
    ring.style.width = cellGeometry.track + "px";
    ring.style.height = cellGeometry.track + "px";
    layer.appendChild(ring);
    setTimeout(() => ring.remove(), 500);

    if (theme === "fire") {
      const cx = left + cellGeometry.track / 2, cy = top + cellGeometry.track / 2;
      for (let i = 0; i < 3; i++) {
        const puff = document.createElement("div");
        puff.className = "smoke-puff";
        const size = cellGeometry.track * (0.35 + Math.random() * 0.25);
        puff.style.width = size + "px";
        puff.style.height = size + "px";
        puff.style.left = (cx - size / 2 + (Math.random() * 10 - 5)) + "px";
        puff.style.top = (cy - size / 2) + "px";
        puff.style.setProperty("--sx", (Math.random() * 16 - 8) + "px");
        puff.style.animationDelay = (i * 60) + "ms";
        layer.appendChild(puff);
        setTimeout(() => puff.remove(), 800 + i * 60);
      }
    }
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
// Le déplacement reste possible même quand on doit viser une attaque : un tap
// bref sert à choisir la cible, un glissement plus large déplace le joueur.
function onCellClick(x, y) {
  if (dragMoved) { dragMoved = false; return; } // c'était un glissement, pas un tap de ciblage
  if (targetingAttackId) onTargetClick(x, y);
}

const SWIPE_THRESHOLD_PX = 22;
let swipeStart = null;
let dragMoved = false;

function initSwipeControls() {
  const el = document.getElementById("board-wrap");
  if (!el) return;
  el.addEventListener("pointerdown", (e) => {
    swipeStart = { x: e.clientX, y: e.clientY };
    dragMoved = false;
  });
  el.addEventListener("pointermove", (e) => {
    if (!swipeStart) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    if (Math.hypot(dx, dy) >= SWIPE_THRESHOLD_PX) dragMoved = true;
  });
  el.addEventListener("pointerup", (e) => {
    if (!swipeStart) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.hypot(dx, dy) >= SWIPE_THRESHOLD_PX) handleSwipeMove(dx, dy);
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
