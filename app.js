// ===== CONFIG =====
// Remplace par l'URL de ton service Render une fois déployé
// (ex: "https://capnaval.onrender.com")
const BACKEND_URL = "https://capnaval.onrender.com";

// Métadonnées des attaques côté client (doit correspondre à ATTACKS dans le backend)
const ATTACKS_META = {
  meteor:       { name: "Météorite",         desc: "Choisis le centre d'une zone 3x3",                  target: "zone", size: 3 },
  airstrike:    { name: "Frappe aérienne",   desc: "Choisis le centre d'une zone 5x5 : 3 impacts en rafale, instantané", target: "zone", size: 5 },
  meteorShower: { name: "Pluie de météores", desc: "Choisis le centre d'une zone 6x6 : 5 impacts en rafale, instantané", target: "zone", size: 6 },
  napalm:       { name: "Chute de napalme",  desc: "Choisis une case : un brasier tourne dans une zone 5x5 et laisse des flammes, instantané", target: "cell" },
  acidRain:     { name: "Pluie acide",       desc: "Choisis une zone 7x7 : des cases deviennent toxiques au hasard", target: "zone", size: 7 },
  nuke:         { name: "Bombe nucléaire",   desc: "Rase toute la carte, instantané — quasi mythique", target: "self" },
  snipe:        { name: "Tir de précision",  desc: "Choisis une case à frapper, instantané",           target: "cell" },
  chainLightning: { name: "Chaîne d'éclairs", desc: "Choisis une case ou un joueur : l'éclair frappe et rebondit sur les joueurs proches, instantané", target: "cell" },
  laser:        { name: "Rayon laser",       desc: "Choisis une case puis une ligne ou colonne, instantané", target: "line" },
  shockwave:    { name: "Onde de choc",      desc: "Frappe toutes les cases autour de toi, instantané", target: "self" },
  gunline:      { name: "Rafale",            desc: "Choisis une case puis une ligne ou colonne",         target: "line" },
  grenade:      { name: "Grenade",           desc: "Choisis le centre d'une zone 2x2",                   target: "zone", size: 2 },
  arrow:        { name: "Flèche perforante", desc: "Choisis une direction : transperce tout, même les murs, instantané", target: "direction" },
  charge:       { name: "Charge",            desc: "Choisis une direction pour foncer, instantané",     target: "direction" },
  tornado:      { name: "Tornade",           desc: "Choisis le centre d'une zone 3x3 à aspirer",         target: "zone", size: 3 },
  net:          { name: "Filet",             desc: "Choisis une case à immobiliser",                     target: "cell" },
  frost:        { name: "Vague de givre",    desc: "Choisis le centre d'une zone 3x3 : laisse une trace glacée", target: "zone", size: 3 },
  mine:         { name: "Piège explosif",    desc: "Choisis une case où poser le piège",                 target: "cell" },
  heal:         { name: "Soin d'urgence",    desc: "Touche-toi ou un allié proche pour soigner",         target: "ally" },
  healZone:     { name: "Zone de soin",      desc: "Choisis une zone 3x3 qui soigne au fil du temps",     target: "zone", size: 3 },
  earthquake:   { name: "Séisme",            desc: "Secoue toute la carte, instantané",                  target: "self" },
  shield:       { name: "Bouclier",          desc: "Absorbe la prochaine attaque reçue",                 target: "self" },
  poison:       { name: "Zone toxique",      desc: "Choisis le centre d'une zone 3x3 empoisonnée",       target: "zone", size: 3 },
  teleport:     { name: "Téléportation",     desc: "Choisis n'importe quelle case sur la carte",         target: "cell" },
};

// Thème visuel + icône par attaque (regroupe les animations par famille plutôt
// que d'en écrire une par attaque : plus lisible, tout aussi distinctif à l'écran)
const ATTACK_THEME = {
  meteor: "fire", airstrike: "fire", meteorShower: "fire", napalm: "fire", grenade: "fire", meteorRain: "fire",
  snipe: "physical", gunline: "physical", laser: "physical", charge: "physical", arrow: "physical", earthquake: "physical", storm: "physical", shockwave: "physical",
  poison: "poison", acidRain: "poison", acidRainMod: "poison",
  frost: "ice",
  tornado: "control", net: "control", chainLightning: "physical",
  heal: "heal", healZone: "heal", shield: "shield", teleport: "teleport", mine: "trap",
  nuke: "nuke",
};
const ATTACK_ICON = {
  meteor: "☄️", airstrike: "✈️", meteorShower: "🌠", napalm: "🔥", grenade: "💣",
  snipe: "🎯", gunline: "🔫", laser: "⚡", charge: "🐗", arrow: "🏹", earthquake: "🌍", shockwave: "💢",
  poison: "☠️", acidRain: "🧪", frost: "❄️", tornado: "🌪️", net: "🕸️", chainLightning: "🌩️",
  heal: "💚", healZone: "💧", shield: "🛡️", teleport: "🌀", mine: "💥", nuke: "☢️",
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
let ATTACKS_LIST = [];
let MAP_MODIFIERS_META = {};
let MODIFIER_TUNABLE_RANGES = {};
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
  ctf:      [{ name: "targetCaptures",   label: "Captures pour gagner",            def: 3,  min: 1, max: 20 }],
  boss: [
    { name: "bossHpMultiplier", label: "Multiplicateur de PV du Boss", def: 3, min: 1.5, max: 6, step: 0.5 },
    { type: "select", name: "bossIsBot", label: "Le Boss est…", def: "false",
      options: [{ value: "false", label: "Un joueur" }, { value: "true", label: "Un bot" }] },
    { type: "player-select", name: "bossPlayerId", label: "Quel joueur devient le Boss ?" },
    { type: "select", name: "bossBotDifficulty", label: "Difficulté du bot Boss", def: "medium",
      options: [{ value: "easy", label: "Facile" }, { value: "medium", label: "Moyen" }, { value: "hard", label: "Difficile" }] },
  ],
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
const CUSTOM_MAP_TYPES = ["wall", "barrel", "mud", "heal", "teleport", "breakable", "lightningRod", "bush"];
const CUSTOM_MAP_KEY_BY_TYPE = { wall: "walls", barrel: "barrels", mud: "mud", heal: "heal", teleport: "teleport", breakable: "breakable", lightningRod: "lightningRod", bush: "bush" };
const CUSTOM_MAP_CYCLE = ["empty", ...CUSTOM_MAP_TYPES];
function emptyCustomMap() { return { walls: [], barrels: [], mud: [], heal: [], teleport: [], breakable: [], lightningRod: [], bush: [] }; }

function loadCustomMap() {
  try {
    const raw = localStorage.getItem(CUSTOM_MAP_KEY);
    const base = emptyCustomMap();
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    Object.keys(base).forEach(k => { if (Array.isArray(parsed[k])) base[k] = parsed[k]; });
    return base;
  } catch (e) { return emptyCustomMap(); }
}
function saveCustomMapToStorage(data) {
  try { localStorage.setItem(CUSTOM_MAP_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
}

let editingMap = emptyCustomMap();

function cellTypeInEditor(x, y) {
  for (const type of CUSTOM_MAP_TYPES) {
    if (editingMap[CUSTOM_MAP_KEY_BY_TYPE[type]].some(c => c.x === x && c.y === y)) return type;
  }
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
  CUSTOM_MAP_TYPES.forEach(type => {
    const key = CUSTOM_MAP_KEY_BY_TYPE[type];
    editingMap[key] = editingMap[key].filter(c => !(c.x === x && c.y === y));
  });
  if (next !== "empty") editingMap[CUSTOM_MAP_KEY_BY_TYPE[next]].push({ x, y });
  const cell = document.querySelector(`.me-cell[data-x="${x}"][data-y="${y}"]`);
  if (cell) cell.className = "me-cell" + (next !== "empty" ? " me-" + next : "");
  updateEditorCounts();
}

function updateEditorCounts() {
  const blocking = editingMap.walls.length + editingMap.barrels.length + editingMap.breakable.length;
  const free = 144 - blocking;
  const countsEl = document.getElementById("map-editor-counts");
  countsEl.textContent = `Murs : ${editingMap.walls.length} · Tonneaux : ${editingMap.barrels.length} · Boue : ${editingMap.mud.length} · ` +
    `Soin : ${editingMap.heal.length} · Téléport : ${editingMap.teleport.length} · Cassables : ${editingMap.breakable.length} · ` +
    `Paratonnerres : ${editingMap.lightningRod.length} · Buissons : ${editingMap.bush.length} · Cases libres : ${free}/144`;
  countsEl.style.color = free < 12 ? "var(--danger)" : "var(--text-dim)";
  document.getElementById("map-editor-error").textContent = free < 12 ? "Il faut au moins 12 cases libres pour 6 joueurs." : "";
}

function openMapEditor() {
  const saved = loadCustomMap();
  editingMap = emptyCustomMap();
  Object.keys(editingMap).forEach(k => { editingMap[k] = saved[k].slice(); });
  buildEditorGrid();
  updateEditorCounts();
  document.getElementById("map-editor-modal").style.display = "flex";
}
document.getElementById("btn-edit-custom-map").addEventListener("click", openMapEditor);
document.getElementById("btn-editor-close").addEventListener("click", () => {
  document.getElementById("map-editor-modal").style.display = "none";
});
document.getElementById("btn-editor-reset").addEventListener("click", () => {
  editingMap = emptyCustomMap();
  buildEditorGrid();
  updateEditorCounts();
});
document.getElementById("btn-editor-save").addEventListener("click", () => {
  const blocking = editingMap.walls.length + editingMap.barrels.length + editingMap.breakable.length;
  const free = 144 - blocking;
  if (free < 12) return;
  saveCustomMapToStorage(editingMap);
  document.getElementById("map-editor-modal").style.display = "none";
});

function renderModeConfigFields(mode, configEl, descEl) {
  descEl.textContent = (MODES_META[mode] && MODES_META[mode].desc) || "";
  const fields = MODE_FIELD_DEFS[mode] || [];
  configEl.innerHTML = fields.map(f => {
    if (f.type === "select") {
      const opts = f.options.map(o => `<option value="${escapeHtml(o.value)}"${o.value === f.def ? " selected" : ""}>${escapeHtml(o.label)}</option>`).join("");
      return `<label class="field"><span>${f.label}</span><select name="${f.name}">${opts}</select></label>`;
    }
    if (f.type === "player-select") {
      const players = (lastState && lastState.players) || [];
      const opts = players.map(p => `<option value="${p.id}">${escapeHtml(p.pseudo)}</option>`).join("");
      return `<label class="field" data-role="player-select"><span>${f.label}</span><select name="${f.name}">${opts}</select></label>`;
    }
    return `<label class="field">
      <span>${f.label}</span>
      <input type="number" name="${f.name}" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${f.def}">
    </label>`;
  }).join("");

  if (mode === "boss") {
    const botSelect = configEl.querySelector('select[name="bossIsBot"]');
    const playerWrap = configEl.querySelector('[data-role="player-select"]');
    const botDiffWrap = configEl.querySelector('select[name="bossBotDifficulty"]')?.closest(".field");
    const updateVisibility = () => {
      const isBot = botSelect.value === "true";
      if (playerWrap) playerWrap.style.display = isBot ? "none" : "block";
      if (botDiffWrap) botDiffWrap.style.display = isBot ? "block" : "none";
    };
    if (botSelect) { botSelect.addEventListener("change", updateVisibility); updateVisibility(); }
  }
}

function readModeConfig(configEl) {
  const config = {};
  configEl.querySelectorAll("input[name], select[name]").forEach(input => {
    config[input.name] = input.type === "checkbox" ? input.checked : input.value;
  });
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

function applySavedSettings(prefix, explicitSaved) {
  const saved = explicitSaved || loadLastSettings();
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

  const extraIds = { "adv-telegraph-mult": "telegraphMultiplier", "adv-buff-duration": "buffDurationSec",
    "adv-mud-mult": "mudSlowMultiplier", "adv-spawn-protection": "spawnProtectionSec",
    "adv-passive-regen": "passiveRegenPerSec" };
  Object.entries(extraIds).forEach(([id, key]) => {
    const el = document.getElementById(prefix + id);
    if (el && saved.config && saved.config[key] !== undefined) el.value = saved.config[key];
  });

  if (saved.config && saved.config.attackWeights) {
    const listEl = document.getElementById(prefix + "attack-weights-list");
    if (listEl) {
      listEl.querySelectorAll(".aw-input").forEach(inp => {
        const w = saved.config.attackWeights[inp.dataset.id];
        if (w !== undefined) inp.value = w;
      });
      updateAttackProbabilities(prefix + "attack-weights-list");
    }
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

// ---------- Lien direct (?code=XXXXX) : pré-remplit le code depuis un lien partagé ----------
(function prefillCodeFromLink() {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = (params.get("code") || "").trim().toUpperCase();
    if (!code) return;
    const codeInput = document.getElementById("input-code");
    codeInput.value = code;
    const pseudoInput = document.getElementById("input-pseudo");
    if (!pseudoInput.value) pseudoInput.focus();
    codeInput.scrollIntoView({ block: "center" });
    // Ne nettoie pas l'URL tout de suite : l'enregistrement du service worker peut
    // déclencher un rechargement juste après le tout premier chargement, et il faut
    // que le code reste dans l'URL pour être repris correctement à ce moment-là.
  } catch (e) { /* ignore */ }
})();

// ---------- Partage du code de partie ----------
const GAME_SHARE_URL = "https://capworks-company.github.io/Game";
function roomShareLink() { return `${GAME_SHARE_URL}/?code=${myCode}`; }
function shareRoomCode() {
  if (!myCode) return;
  const link = roomShareLink();
  const text = `Hey ! Rejoins ma partie de CapNaval sur ${link} !`;
  if (navigator.share) {
    navigator.share({ text, url: link }).catch(() => { /* annulé ou indisponible, sans gravité */ });
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(flashRoomCodeCopied).catch(() => {});
  } else {
    flashRoomCodeCopied();
  }
}
function flashRoomCodeCopied() {
  const btn = document.getElementById("room-code");
  if (!btn) return;
  const original = myCode || btn.textContent;
  btn.textContent = "Copié !";
  setTimeout(() => { btn.textContent = original; }, 1300);
}
document.getElementById("room-code").addEventListener("click", shareRoomCode);

document.getElementById("btn-copy-code").addEventListener("click", () => {
  if (!myCode) return;
  const btn = document.getElementById("btn-copy-code");
  const original = btn.textContent;
  const flash = () => { btn.textContent = "✅ Copié !"; setTimeout(() => { btn.textContent = original; }, 1300); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(myCode).then(flash).catch(() => {});
  } else {
    flash();
  }
});

// ---------- QR code du lien de partie (facultatif : dégradation silencieuse si indisponible) ----------
function renderRoomQR(retriesLeft) {
  const wrap = document.getElementById("room-qr-wrap");
  const el = document.getElementById("room-qr");
  if (!wrap || !el || !myCode) return;
  if (typeof QRCode === "undefined") {
    if (retriesLeft === undefined) retriesLeft = 4;
    if (retriesLeft > 0) setTimeout(() => renderRoomQR(retriesLeft - 1), 400); // la librairie charge peut-être encore
    return;
  }
  el.innerHTML = "";
  try {
    new QRCode(el, { text: roomShareLink(), width: 128, height: 128, colorDark: "#10131a", colorLight: "#ffffff" });
    wrap.style.display = "block";
  } catch (e) { /* pas grave, le code texte + le partage restent disponibles */ }
}

// ---------- Tutoriel rapide (au tout premier lancement, ou à la demande) ----------
const TUTORIAL_KEY = "capnaval_tutorial_seen";
const TUTORIAL_SLIDE_COUNT = 4;
let tutorialSlide = 0;

function buildTutorialDots() {
  const dots = document.getElementById("tutorial-dots");
  dots.innerHTML = Array.from({ length: TUTORIAL_SLIDE_COUNT }, (_, i) => `<span class="tutorial-dot${i === 0 ? " active" : ""}"></span>`).join("");
}
function showTutorialSlide(i) {
  tutorialSlide = i;
  document.querySelectorAll(".tutorial-slide").forEach(el => el.classList.toggle("active", parseInt(el.dataset.slide, 10) === i));
  document.querySelectorAll(".tutorial-dot").forEach((d, idx) => d.classList.toggle("active", idx === i));
  document.getElementById("btn-tutorial-next").textContent = i === TUTORIAL_SLIDE_COUNT - 1 ? "C'est parti !" : "Suivant";
}
function openTutorial() {
  buildTutorialDots();
  showTutorialSlide(0);
  document.getElementById("tutorial-modal").style.display = "flex";
}
function closeTutorial() {
  document.getElementById("tutorial-modal").style.display = "none";
  try { localStorage.setItem(TUTORIAL_KEY, "1"); } catch (e) { /* ignore */ }
}
document.getElementById("btn-tutorial-skip").addEventListener("click", closeTutorial);
document.getElementById("btn-tutorial-next").addEventListener("click", () => {
  if (tutorialSlide >= TUTORIAL_SLIDE_COUNT - 1) { closeTutorial(); return; }
  showTutorialSlide(tutorialSlide + 1);
});
document.getElementById("btn-show-tutorial").addEventListener("click", openTutorial);
(function autoOpenTutorialOnFirstLaunch() {
  try { if (!localStorage.getItem(TUTORIAL_KEY)) openTutorial(); } catch (e) { /* ignore */ }
})();

// ---------- Avatar (couleur), mémorisé sur l'appareil ----------
const AVATAR_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316"];
const AVATAR_KEY = "capnaval_avatar";

function loadAvatar() {
  try {
    const raw = JSON.parse(localStorage.getItem(AVATAR_KEY) || "{}");
    return { color: AVATAR_COLORS.includes(raw.color) ? raw.color : AVATAR_COLORS[0] };
  } catch (e) { return { color: AVATAR_COLORS[0] }; }
}
function saveAvatar(avatar) { try { localStorage.setItem(AVATAR_KEY, JSON.stringify(avatar)); } catch (e) { /* ignore */ } }

(function buildAvatarPicker() {
  const avatar = loadAvatar();
  const colorWrap = document.getElementById("avatar-color-swatches");
  colorWrap.innerHTML = AVATAR_COLORS.map(c => `<button type="button" class="avatar-swatch${c === avatar.color ? " selected" : ""}" data-color="${c}" style="background:${c}" aria-label="Couleur"></button>`).join("");
  colorWrap.querySelectorAll(".avatar-swatch").forEach(btn => {
    btn.addEventListener("click", () => {
      colorWrap.querySelectorAll(".avatar-swatch").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      saveAvatar({ ...loadAvatar(), color: btn.dataset.color });
    });
  });
})();

// ---------- Paramètres généraux (confort, personnels, enregistrés sur l'appareil) ----------
const GENERAL_SETTINGS_KEY = "capnaval_general_settings";
const DEFAULT_REACTION_EMOJIS = ["👍", "😂", "🔥"];
const REACTION_EMOJI_CHOICES = ["👍", "😂", "🔥", "😮", "😭", "💀", "🎉", "😡", "❤️", "👏", "🤔", "😎"];

function loadGeneralSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(GENERAL_SETTINGS_KEY) || "{}");
    return {
      reduceMotion: !!raw.reduceMotion,
      soundEnabled: raw.soundEnabled !== false,
      vibrationEnabled: raw.vibrationEnabled !== false,
      colorblind: !!raw.colorblind,
      showAdjacentCells: raw.showAdjacentCells !== false,
      reactionEmojis: Array.isArray(raw.reactionEmojis) && raw.reactionEmojis.length ? raw.reactionEmojis.slice(0, 6) : DEFAULT_REACTION_EMOJIS,
    };
  } catch (e) {
    return { reduceMotion: false, soundEnabled: true, vibrationEnabled: true, colorblind: false, showAdjacentCells: true, reactionEmojis: DEFAULT_REACTION_EMOJIS };
  }
}
function saveGeneralSettings(s) { try { localStorage.setItem(GENERAL_SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }

let generalSettings = loadGeneralSettings();
function applyGeneralSettingsToDOM() {
  document.body.classList.toggle("reduce-motion", generalSettings.reduceMotion);
}
applyGeneralSettingsToDOM();

function buildReactionEmojiGrid(containerId) {
  const grid = document.getElementById(containerId);
  grid.innerHTML = REACTION_EMOJI_CHOICES.map(e => `<button type="button" class="avatar-emoji-btn${generalSettings.reactionEmojis.includes(e) ? " selected" : ""}" data-emoji="${e}">${e}</button>`).join("");
  grid.querySelectorAll(".avatar-emoji-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const e = btn.dataset.emoji;
      const idx = generalSettings.reactionEmojis.indexOf(e);
      if (idx >= 0) {
        generalSettings.reactionEmojis.splice(idx, 1);
        btn.classList.remove("selected");
      } else if (generalSettings.reactionEmojis.length < 6) {
        generalSettings.reactionEmojis.push(e);
        btn.classList.add("selected");
      } else {
        return; // limite de 6 atteinte : ne touche ni aux données ni au visuel
      }
      saveGeneralSettings(generalSettings);
    });
  });
}

function openGeneralSettings() {
  generalSettings = loadGeneralSettings();
  document.getElementById("gs-reduce-motion").checked = generalSettings.reduceMotion;
  document.getElementById("gs-sound").checked = generalSettings.soundEnabled;
  document.getElementById("gs-vibration").checked = generalSettings.vibrationEnabled;
  document.getElementById("gs-colorblind").checked = generalSettings.colorblind;
  document.getElementById("gs-adjacent-cells").checked = generalSettings.showAdjacentCells;
  buildReactionEmojiGrid("gs-emoji-grid");
  document.getElementById("general-settings-modal").style.display = "flex";
}
document.getElementById("btn-general-settings").addEventListener("click", openGeneralSettings);
document.getElementById("btn-close-general-settings").addEventListener("click", () => {
  document.getElementById("general-settings-modal").style.display = "none";
});
const GS_TOGGLE_KEYS = { "gs-reduce-motion": "reduceMotion", "gs-sound": "soundEnabled", "gs-vibration": "vibrationEnabled", "gs-colorblind": "colorblind", "gs-adjacent-cells": "showAdjacentCells" };
Object.keys(GS_TOGGLE_KEYS).forEach(id => {
  document.getElementById(id).addEventListener("change", (e) => {
    generalSettings[GS_TOGGLE_KEYS[id]] = e.target.checked;
    saveGeneralSettings(generalSettings);
    applyGeneralSettingsToDOM();
    if (lastState && lastState.status === "playing") renderBoard(); // reflète le changement tout de suite en partie
  });
});

// Palette daltonien (Okabe-Ito) : remplace les couleurs serveur uniquement à l'affichage,
// personnel à chaque appareil — les autres joueurs voient toujours les couleurs normales.
const COLORBLIND_PALETTE = {
  "#ef4444": "#d55e00", "#3b82f6": "#0072b2", "#22c55e": "#009e73",
  "#eab308": "#f0e442", "#a855f7": "#cc79a7", "#f97316": "#e69f00",
};
function displayColor(serverColor) {
  return generalSettings.colorblind ? (COLORBLIND_PALETTE[serverColor] || serverColor) : serverColor;
}

// ---------- Petit utilitaire de log progressif (retours de chargement "en vrai") ----------
function runLoadingLog(el, messages, stepMs) {
  if (!el || !messages.length) return () => {};
  let i = 0;
  el.textContent = messages[0];
  const handle = setInterval(() => {
    i++;
    if (i >= messages.length) { clearInterval(handle); return; }
    el.textContent = messages[i];
  }, stepMs);
  return () => clearInterval(handle);
}

// ---------- Accueil ----------
document.getElementById("btn-create").addEventListener("click", async () => {
  const pseudo = document.getElementById("input-pseudo").value.trim();
  if (!pseudo) return setHomeError("Entre un pseudo.");
  saveLastPseudo(pseudo);
  const isPublic = document.getElementById("create-public-toggle").checked;
  const homeError = document.getElementById("home-error");
  const stopLog = runLoadingLog(homeError, ["Connexion avec le serveur...", "Création de la partie...", "En attente de la réponse du serveur..."], 650);
  try {
    const res = await fetch(`${BACKEND_URL}/api/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic }),
    });
    const data = await res.json();
    stopLog();
    homeError.textContent = "Connexion à la partie...";
    connect(data.code, pseudo);
  } catch (e) {
    stopLog();
    setHomeError("Impossible de joindre le serveur. Vérifie BACKEND_URL dans app.js.");
  }
});

document.getElementById("btn-join").addEventListener("click", () => {
  const pseudo = document.getElementById("input-pseudo").value.trim();
  const code = document.getElementById("input-code").value.trim().toUpperCase();
  if (!pseudo) return setHomeError("Entre un pseudo.");
  if (!code) return setHomeError("Entre un code de partie.");
  saveLastPseudo(pseudo);
  const homeError = document.getElementById("home-error");
  runLoadingLog(homeError, ["Connexion avec le serveur...", "Connexion à la partie..."], 650);
  connect(code, pseudo);
});

function setHomeError(msg) { document.getElementById("home-error").textContent = msg; }

// ---------- Liste des parties publiques ----------
let publicRoomsTimer = null;
async function refreshPublicRooms(manual) {
  const list = document.getElementById("public-rooms-list");
  const empty = document.getElementById("public-rooms-empty");
  const btn = document.getElementById("btn-refresh-public");
  if (manual) { btn.disabled = true; btn.innerHTML = '<span class="spin-icon">🔄</span> Actualisation…'; }
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
  finally {
    if (manual) { btn.disabled = false; btn.innerHTML = "🔄 Actualiser la liste"; }
  }
}
document.getElementById("btn-refresh-public").addEventListener("click", () => refreshPublicRooms(true));
function startPublicRoomsPolling() {
  refreshPublicRooms(false);
  if (publicRoomsTimer) clearInterval(publicRoomsTimer);
  publicRoomsTimer = setInterval(() => refreshPublicRooms(false), 7000);
}
function stopPublicRoomsPolling() {
  if (publicRoomsTimer) clearInterval(publicRoomsTimer);
  publicRoomsTimer = null;
}
startPublicRoomsPolling();

// ---------- Installation PWA + mise à jour (icône sur l'appareil) ----------
const isStandaloneAlready = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
let deferredInstallPrompt = null;
let swRegistration = null;
let fabMode = null; // "install" | "update" | null
const btnInstall = document.getElementById("btn-install");

function setFab(mode) {
  fabMode = mode;
  if (mode === "install") {
    btnInstall.textContent = "📲"; btnInstall.title = "Installer l'app"; btnInstall.setAttribute("aria-label", "Installer l'app");
    btnInstall.style.display = "flex";
  } else if (mode === "update") {
    btnInstall.textContent = "🔄"; btnInstall.title = "Mettre à jour"; btnInstall.setAttribute("aria-label", "Mettre à jour l'app");
    btnInstall.style.display = "flex";
  } else {
    btnInstall.style.display = "none";
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      swRegistration = reg;
      // Une version est déjà en attente (ex: onglet resté ouvert depuis un précédent déploiement).
      if (reg.waiting && navigator.serviceWorker.controller) setFab("update");
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          // "installed" + un controller déjà actif = ce n'est pas la toute première
          // installation, mais bien une nouvelle version qui vient d'être détectée.
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            if (isStandaloneAlready) setFab("update");
          }
        });
      });
    }).catch(() => { /* tant pis, l'app marche quand même */ });

    let reloadingForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });
  });
}

if (!isStandaloneAlready) {
  if (isIOS) {
    // Safari n'expose pas d'API pour déclencher l'installation : on montre le bouton,
    // qui ouvre des instructions manuelles au clic.
    setFab("install");
  } else {
    // Chrome/Edge (Android ou bureau) : on intercepte l'invite native et on la
    // déclenche nous-même au clic, avec notre propre bouton dans le style du jeu.
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      setFab("install");
    });
    window.addEventListener("appinstalled", () => { setFab(null); });
  }
}

btnInstall.addEventListener("click", async () => {
  if (fabMode === "update") {
    if (swRegistration && swRegistration.waiting) swRegistration.waiting.postMessage("SKIP_WAITING");
    else window.location.reload();
    return;
  }
  if (isIOS) {
    document.getElementById("ios-install-modal").style.display = "flex";
    return;
  }
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  setFab(null);
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

// ---------- Bannière hors-ligne (perte complète d'Internet, pas juste du serveur) ----------
function updateOfflineBanner() {
  const b = document.getElementById("offline-banner");
  const isOffline = navigator.onLine === false;
  if (b) b.style.display = isOffline ? "block" : "none";
  const cb = document.getElementById("connection-banner");
  if (cb) cb.style.top = isOffline && b ? b.offsetHeight + "px" : "0";
}
window.addEventListener("online", updateOfflineBanner);
window.addEventListener("offline", updateOfflineBanner);
updateOfflineBanner();

function connect(code, pseudo) {
  stopPublicRoomsPolling();
  myCode = code; myPseudo = pseudo;
  const avatar = loadAvatar();
  const wsUrl = BACKEND_URL.replace(/^http/, "ws") + `/ws?code=${code}&pseudo=${encodeURIComponent(pseudo)}&clientId=${myClientId}&color=${encodeURIComponent(avatar.color)}`;
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
  releaseWakeLock();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (lobbyStartLogStop) { lobbyStartLogStop(); lobbyStartLogStop = null; }
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
    ATTACKS_LIST = msg.attacks || [];
    MAP_MODIFIERS_META = msg.mapModifiers || {};
    MODIFIER_TUNABLE_RANGES = msg.modifierTunableRanges || {};
    document.getElementById("room-code").textContent = myCode;
    renderRoomQR();

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
      buildAttackWeightsEditor("attack-weights-list");
      buildAttackWeightsEditor("end-attack-weights-list");
      buildMapModifiersList("map-modifiers-list");
      buildMapModifiersList("end-map-modifiers-list");
      renderCustomModesList();
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
    if (msg.attackId === "nuke") {
      playNukeCinematic();
    } else if (msg.attackId === "earthquake") {
      playEarthquakeShake();
      flashCells(msg.cells, msg.attackId);
    } else if (msg.attackId === "arrow") {
      playArrowShot(msg.cells, msg.by);
    } else if (msg.attackId === "chainLightning") {
      playChainLightning(msg.groups, msg.by);
    } else if (STAGGERED_ATTACKS.has(msg.attackId) && msg.groups && msg.groups.length) {
      msg.groups.forEach((group, i) => {
        setTimeout(() => flashCells(group, msg.attackId), i * STAGGER_DELAY_MS);
      });
    } else {
      flashCells(msg.cells, msg.attackId);
    }
  } else if (msg.type === "telegraph") {
    showTelegraph(msg.cells, msg.resolveAt, msg.attackId);
    castingGlow(msg.by, msg.attackId, msg.resolveAt);
  } else if (msg.type === "reaction") {
    if (msg.by !== myId) showFloatingReaction(msg.by, msg.emoji);
  } else if (msg.type === "mapEvent") {
    playMapEvent(msg.kind, msg.cells);
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
    const botTag = p.isBot ? " 🤖" : "";
    li.innerHTML = `<span class="dot" style="background:${displayColor(p.color)}"></span><span class="pname">${escapeHtml(p.pseudo)}${botTag}${p.id === lastState.hostId ? " · hôte" : ""}</span>`;
    if (isHost && !isMe && !p.isBot) {
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
  document.getElementById("host-settings-wrap").style.display = isHost ? "block" : "none";
  document.getElementById("lobby-wait").style.display = isHost ? "none" : "block";
  if (isHost) {
    document.getElementById("lobby-public-toggle").checked = !!lastState.isPublic;
    const mpInput = document.getElementById("lobby-maxplayers");
    if (document.activeElement !== mpInput) mpInput.value = lastState.maxPlayers || 6;
    const fillCountInput = document.getElementById("lobby-fillbots-count");
    const fillDiffSelect = document.getElementById("lobby-fillbots-difficulty");
    if (document.activeElement !== fillCountInput) fillCountInput.value = lastState.fillBotCount || 0;
    if (document.activeElement !== fillDiffSelect) fillDiffSelect.value = lastState.fillBotDifficulty || "medium";
    document.getElementById("lobby-fillbots-difficulty-wrap").style.display = (lastState.fillBotCount > 0) ? "block" : "none";
  }
}
// ---------- Onglets de paramètres (générique, réutilisable) ----------
function wireSettingsTabs(tabsId) {
  const tabsEl = document.getElementById(tabsId);
  if (!tabsEl) return;
  const panelsWrap = tabsEl.parentElement;
  tabsEl.querySelectorAll(".settings-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      tabsEl.querySelectorAll(".settings-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      panelsWrap.querySelectorAll(".settings-panel").forEach(p => p.classList.toggle("active", p.dataset.panel === tab.dataset.tab));
    });
  });
}
wireSettingsTabs("lobby-settings-tabs");
wireSettingsTabs("end-settings-tabs");

document.getElementById("lobby-public-toggle").addEventListener("change", (e) => {
  ws.send(JSON.stringify({ type: "setPublic", value: e.target.checked }));
});
document.getElementById("lobby-maxplayers").addEventListener("change", (e) => {
  ws.send(JSON.stringify({ type: "setMaxPlayers", value: e.target.value }));
});
document.getElementById("lobby-fillbots-count").addEventListener("change", (e) => {
  document.getElementById("lobby-fillbots-difficulty-wrap").style.display = (parseInt(e.target.value) > 0) ? "block" : "none";
  ws.send(JSON.stringify({ type: "setFillBots", count: e.target.value, difficulty: document.getElementById("lobby-fillbots-difficulty").value }));
});
document.getElementById("lobby-fillbots-difficulty").addEventListener("change", (e) => {
  ws.send(JSON.stringify({ type: "setFillBots", count: document.getElementById("lobby-fillbots-count").value, difficulty: e.target.value }));
});
let lobbyStartLogStop = null;
function gatherFullConfig(prefix) {
  const mode = document.getElementById(prefix + "mode-select").value;
  const config = readModeConfig(document.getElementById(prefix + "mode-config"));
  config.mapId = getWheelSelection();
  config.customMap = loadCustomMap();
  config.powerupsEnabled = document.getElementById(prefix + "powerups-toggle").checked;
  config.powerupIntervalSec = document.getElementById(prefix + "powerup-interval").value;
  config.teamsEnabled = document.getElementById(prefix + "teams-toggle").checked;
  config.pushEnabled = document.getElementById(prefix + "push-toggle").checked;
  config.shrinkEnabled = document.getElementById(prefix + "shrink-toggle").checked;
  config.shrinkMode = document.getElementById(prefix + "shrink-mode-select").value;
  config.shrinkIntervalSec = document.getElementById(prefix + "shrink-interval").value;
  const modifiersRead = readMapModifiers(prefix + "map-modifiers-list");
  config.mapModifiers = modifiersRead.ids;
  config.modifierOverrides = modifiersRead.overrides;
  config.hideAttackFromOthers = document.getElementById(prefix + "hide-attack-toggle").checked;
  config.twoWeaponHand = document.getElementById(prefix + "two-weapon-toggle").checked;
  Object.assign(config, readAdvancedConfig(prefix));
  return { mode, config };
}
document.getElementById("btn-start").addEventListener("click", () => {
  const { mode, config } = gatherFullConfig("");
  saveLastSettings({ mode, config });
  if (lobbyStartLogStop) lobbyStartLogStop();
  lobbyStartLogStop = runLoadingLog(document.getElementById("lobby-status"),
    ["Connexion avec le serveur...", "En attente de création de la partie..."], 700);
  ws.send(JSON.stringify({ type: "start", mode, config }));
});
// Recharge le panel de paramètres avec les VRAIS réglages de la partie qui vient
// de se terminer (pas des valeurs par défaut ni un vieux localStorage périmé).
function populateSettingsFromLiveState(prefix) {
  if (!lastState) return;
  const modeSelect = document.getElementById(prefix + "mode-select");
  const modeConfigEl = document.getElementById(prefix + "mode-config");
  const modeDescEl = document.getElementById(prefix + "mode-desc");
  if (modeSelect && lastState.mode && MODES_META[lastState.mode]) {
    modeSelect.value = lastState.mode;
    renderModeConfigFields(lastState.mode, modeConfigEl, modeDescEl);
    if (lastState.config) {
      modeConfigEl.querySelectorAll("input[name], select[name]").forEach(inp => {
        if (lastState.config[inp.name] !== undefined) inp.value = lastState.config[inp.name];
      });
    }
  }
  if (lastState.mapId && MAPS_META[lastState.mapId]) {
    const wheelState = mapWheelStates.get("modal-map-wheel");
    if (wheelState) setWheelToMap(wheelState, document.getElementById("modal-map-wheel"), lastState.mapId, document.getElementById("modal-map-desc"));
  }

  const rc = lastState.roomConfig || {};
  const setChecked = (id, val) => { const el = document.getElementById(prefix + id); if (el) el.checked = !!val; };
  const setVal = (id, val) => { const el = document.getElementById(prefix + id); if (el && val !== undefined && val !== null) el.value = val; };

  setChecked("powerups-toggle", rc.powerupsEnabled);
  setVal("powerup-interval", rc.powerupIntervalSec);
  setChecked("teams-toggle", lastState.teamsEnabled);
  setChecked("push-toggle", lastState.pushEnabled);
  setChecked("shrink-toggle", rc.shrinkEnabled);
  setVal("shrink-mode-select", rc.shrinkMode);
  setVal("shrink-interval", rc.shrinkIntervalSec);
  document.getElementById(prefix + "shrink-options-wrap").style.display = rc.shrinkEnabled ? "block" : "none";
  document.getElementById(prefix + "shrink-custom-wrap").style.display = rc.shrinkMode === "custom" ? "block" : "none";
  document.getElementById(prefix + "powerup-interval-wrap").style.display = rc.powerupsEnabled ? "block" : "none";

  setChecked("hide-attack-toggle", rc.hideAttackFromOthers);
  setChecked("two-weapon-toggle", rc.twoWeaponHand);
  const modifiersListEl = document.getElementById(prefix + "map-modifiers-list");
  if (modifiersListEl) {
    const active = lastState.mapModifiers || [];
    modifiersListEl.querySelectorAll(".map-modifier-toggle").forEach(el => { el.checked = active.includes(el.dataset.id); });
    const modOverrides = rc.modifierOverrides || {};
    modifiersListEl.querySelectorAll(".mm-tunable").forEach(inp => {
      const val = modOverrides[inp.dataset.id] && modOverrides[inp.dataset.id][inp.dataset.field];
      if (val !== undefined) inp.value = val;
    });
  }

  setVal("adv-starting-hp", lastState.startingHP);
  setVal("adv-respawn-delay", rc.respawnDelaySec);
  setVal("adv-respawn-hp-percent", rc.respawnHpPercent);
  setVal("adv-attack-window", rc.attackWindowSec);
  setVal("adv-turn-gap", rc.turnGapSec);
  setVal("adv-move-cooldown", lastState.moveCooldownMs);
  setVal("adv-damage-mult", rc.damageMultiplier);
  setVal("adv-barrel-damage", rc.barrelDamage);
  setVal("adv-powerup-max", rc.powerupMaxOnMap);
  setChecked("adv-weapon-no-repeat", rc.weaponNoRepeat);
  setChecked("adv-mine-visible", lastState.mineVisibleToAll);
  setVal("adv-telegraph-mult", rc.telegraphMultiplier);
  setVal("adv-buff-duration", rc.buffDurationSec);
  setVal("adv-mud-mult", lastState.mudSlowMultiplier);
  setVal("adv-spawn-protection", rc.spawnProtectionSec);
  setVal("adv-passive-regen", rc.passiveRegenPerSec);

  const weightsListId = prefix + "attack-weights-list";
  if (document.getElementById(weightsListId)) {
    buildAttackWeightsEditor(weightsListId);
    if (rc.attackWeightOverrides) {
      const container = document.getElementById(weightsListId);
      container.querySelectorAll(".aw-input").forEach(inp => {
        const w = rc.attackWeightOverrides[inp.dataset.id];
        if (w !== undefined) inp.value = Math.round(w * 100);
      });
      updateAttackProbabilities(weightsListId);
    }
  }
}

document.getElementById("btn-toggle-end-settings").addEventListener("click", () => {
  const form = document.getElementById("end-settings-form");
  const btn = document.getElementById("btn-toggle-end-settings");
  const nowVisible = form.style.display === "none";
  if (nowVisible) populateSettingsFromLiveState("end-");
  form.style.display = nowVisible ? "block" : "none";
  btn.textContent = nowVisible ? "⚙️ Masquer les paramètres" : "⚙️ Modifier les paramètres";
});
document.getElementById("btn-restart").addEventListener("click", () => {
  const { mode, config } = gatherFullConfig("end-");
  saveLastSettings({ mode, config });
  ws.send(JSON.stringify({ type: "start", mode, config }));
});

// ---------- Modes de jeu personnalisés (préréglages complets, enregistrés sur l'appareil) ----------
const CUSTOM_MODES_KEY = "capnaval_custom_modes";
function loadCustomModes() {
  try { const l = JSON.parse(localStorage.getItem(CUSTOM_MODES_KEY) || "[]"); return Array.isArray(l) ? l : []; }
  catch (e) { return []; }
}
function saveCustomModesList(list) { try { localStorage.setItem(CUSTOM_MODES_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ } }

let editingCustomModeIndex = null;
function renderCustomModesList() {
  const container = document.getElementById("custom-modes-list");
  if (!container) return;
  const presets = loadCustomModes();
  if (!presets.length) { container.innerHTML = `<p class="hint" style="font-size:12px">Aucun préréglage enregistré pour l'instant.</p>`; return; }
  container.innerHTML = presets.map((p, i) => `
    <div class="custom-mode-row">
      <span class="custom-mode-name">${escapeHtml(p.name)}</span>
      <button type="button" class="player-manage-btn custom-mode-load" data-i="${i}" title="Charger">📂</button>
      <button type="button" class="player-manage-btn custom-mode-edit" data-i="${i}" title="Modifier">✏️</button>
      <button type="button" class="player-manage-btn custom-mode-delete" data-i="${i}" title="Supprimer">✕</button>
    </div>`).join("");
  container.querySelectorAll(".custom-mode-load").forEach(btn => {
    btn.addEventListener("click", () => {
      const preset = loadCustomModes()[parseInt(btn.dataset.i)];
      if (preset) applySavedSettings("", { mode: preset.mode, config: preset.config });
    });
  });
  container.querySelectorAll(".custom-mode-edit").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.dataset.i);
      const preset = loadCustomModes()[i];
      if (!preset) return;
      applySavedSettings("", { mode: preset.mode, config: preset.config });
      editingCustomModeIndex = i;
      document.getElementById("custom-mode-name").value = preset.name;
      document.getElementById("btn-save-custom-mode").textContent = "💾 Mettre à jour";
      document.getElementById("btn-cancel-edit-custom-mode").style.display = "block";
      document.getElementById("custom-mode-name").scrollIntoView({ block: "center" });
    });
  });
  container.querySelectorAll(".custom-mode-delete").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.dataset.i);
      const list = loadCustomModes();
      list.splice(i, 1);
      saveCustomModesList(list);
      if (editingCustomModeIndex === i) resetCustomModeEditState();
      renderCustomModesList();
    });
  });
}
function resetCustomModeEditState() {
  editingCustomModeIndex = null;
  document.getElementById("custom-mode-name").value = "";
  document.getElementById("btn-save-custom-mode").textContent = "💾 Enregistrer";
  document.getElementById("btn-cancel-edit-custom-mode").style.display = "none";
}
document.getElementById("btn-cancel-edit-custom-mode").addEventListener("click", resetCustomModeEditState);
document.getElementById("btn-save-custom-mode").addEventListener("click", () => {
  const nameInput = document.getElementById("custom-mode-name");
  const name = nameInput.value.trim();
  if (!name) return;
  const { mode, config } = gatherFullConfig("");
  const list = loadCustomModes();
  if (editingCustomModeIndex !== null && list[editingCustomModeIndex]) {
    list[editingCustomModeIndex] = { name, mode, config };
  } else {
    list.push({ name, mode, config });
  }
  saveCustomModesList(list);
  resetCustomModeEditState();
  renderCustomModesList();
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
    telegraphMultiplier: val("adv-telegraph-mult"),
    buffDurationSec: val("adv-buff-duration"),
    mudSlowMultiplier: val("adv-mud-mult"),
    spawnProtectionSec: val("adv-spawn-protection"),
    passiveRegenPerSec: val("adv-passive-regen"),
    attackWeights: readAttackWeights(prefix + "attack-weights-list"),
    attackOverrides: readAttackOverrides(prefix + "attack-weights-list"),
  };
}

// ---------- Probabilité de chaque attaque + réglages fins ----------
const TUNABLE_LABELS = {
  damage: "Dégâts", heal: "Soin", size: "Taille de zone", ticks: "Durée (ticks)",
  slowMs: "Ralentissement (ms)", rootMs: "Immobilisation (ms)", traceTicks: "Durée de la trace (ticks)",
  distance: "Portée (cases)", hits: "Nombre d'impacts", telegraphMs: "Temps d'esquive (ms)",
  fireDamage: "Dégâts du feu", fireTicks: "Durée du feu (ticks)",
  dropDamage: "Dégâts par case toxique", dropTicks: "Durée par case (ticks)", drops: "Nombre de cases toxiques",
  chainHops: "Nombre de rebonds", chainFalloff: "Affaiblissement par rebond", range: "Portée",
  perMinute: "Occurrences par minute", zombieHp: "PV des ombres", explosionDamage: "Dégâts d'explosion",
};

// ---------- Modificateurs de carte (cumulables), avec réglages fins dépliables ----------
function buildMapModifiersList(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const ids = Object.keys(MAP_MODIFIERS_META);
  if (!ids.length) return;
  container.innerHTML = ids.map(id => {
    const m = MAP_MODIFIERS_META[id];
    const ranges = MODIFIER_TUNABLE_RANGES[id] || {};
    const tunableKeys = Object.keys(ranges);
    const hasTunables = tunableKeys.length > 0;
    const tunablesHtml = tunableKeys.map(key => {
      const [min, max, def] = ranges[key];
      const step = key === "perMinute" ? 0.5 : 1;
      return `<label class="field aw-tunable-field">
        <span>${TUNABLE_LABELS[key] || key}</span>
        <input type="number" class="mm-tunable" data-id="${id}" data-field="${key}" min="${min}" max="${max}" step="${step}" value="${def}">
      </label>`;
    }).join("");
    return `
    <div class="attack-row" data-id="${id}">
      <div class="attack-row-main">
        <span class="attack-row-name">${m.icon || ""} ${escapeHtml(m.label)}</span>
        <label class="toggle-switch toggle-switch-sm"><input type="checkbox" class="map-modifier-toggle" data-id="${id}"><span class="toggle-slider"></span></label>
        ${hasTunables ? `<button type="button" class="attack-row-expand" data-id="${id}" aria-label="Réglages fins">▸</button>` : `<span class="attack-row-expand-spacer"></span>`}
      </div>
      ${hasTunables ? `<div class="attack-row-tunables">${tunablesHtml}</div>` : ""}
    </div>`;
  }).join("");

  container.querySelectorAll(".attack-row-expand").forEach(btn => {
    btn.addEventListener("click", () => btn.closest(".attack-row").classList.toggle("expanded"));
  });
}
// Renvoie {ids: [...modificateurs actifs], overrides: {id: {champ: valeur}}}
function readMapModifiers(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return { ids: [], overrides: {} };
  const ids = [...container.querySelectorAll(".map-modifier-toggle")].filter(el => el.checked).map(el => el.dataset.id);
  const overrides = {};
  container.querySelectorAll(".mm-tunable").forEach(inp => {
    const id = inp.dataset.id, field = inp.dataset.field;
    if (inp.value === "") return;
    overrides[id] = overrides[id] || {};
    overrides[id][field] = parseFloat(inp.value);
  });
  return { ids, overrides };
}

function buildAttackWeightsEditor(containerId) {
  const container = document.getElementById(containerId);
  if (!container || !ATTACKS_LIST.length) return;
  container.innerHTML = ATTACKS_LIST.map(a => {
    const tunableKeys = Object.keys(a.tunables || {});
    const hasTunables = tunableKeys.length > 0;
    const tunablesHtml = tunableKeys.map(key => {
      const step = key === "chainFalloff" ? 0.05 : 1;
      return `<label class="field aw-tunable-field">
        <span>${TUNABLE_LABELS[key] || key}</span>
        <input type="number" class="aw-tunable" data-id="${a.id}" data-field="${key}" step="${step}" value="${a.tunables[key]}">
      </label>`;
    }).join("");
    return `
    <div class="attack-row" data-id="${a.id}">
      <div class="attack-row-main">
        <span class="attack-row-name">${ATTACK_ICON[a.id] || ""} ${escapeHtml(a.name)}</span>
        <label class="toggle-switch toggle-switch-sm"><input type="checkbox" class="aw-enabled" data-id="${a.id}" checked><span class="toggle-slider"></span></label>
        <input type="number" class="aw-input" data-id="${a.id}" min="0" max="500" step="25" value="100">
        <span class="aw-prob" data-id="${a.id}">—</span>
        ${hasTunables ? `<button type="button" class="attack-row-expand" data-id="${a.id}" aria-label="Réglages fins">▸</button>` : `<span class="attack-row-expand-spacer"></span>`}
      </div>
      ${hasTunables ? `<div class="attack-row-tunables">${tunablesHtml}</div>` : ""}
    </div>`;
  }).join("");

  container.querySelectorAll(".aw-input").forEach(inp => {
    inp.addEventListener("input", () => {
      const row = inp.closest(".attack-row");
      const chk = row.querySelector(".aw-enabled");
      const isZero = inp.value === "" || parseFloat(inp.value) === 0;
      if (chk) { chk.checked = !isZero; row.classList.toggle("aw-disabled", isZero); }
      updateAttackProbabilities(containerId);
    });
  });
  container.querySelectorAll(".aw-enabled").forEach(chk => {
    chk.addEventListener("change", () => {
      const row = chk.closest(".attack-row");
      const numInput = row.querySelector(".aw-input");
      if (chk.checked) {
        numInput.value = (numInput.dataset.prev && numInput.dataset.prev !== "0") ? numInput.dataset.prev : "100";
      } else {
        if (numInput.value && numInput.value !== "0") numInput.dataset.prev = numInput.value;
        numInput.value = "0";
      }
      row.classList.toggle("aw-disabled", !chk.checked);
      updateAttackProbabilities(containerId);
    });
  });
  container.querySelectorAll(".attack-row-expand").forEach(btn => {
    btn.addEventListener("click", () => btn.closest(".attack-row").classList.toggle("expanded"));
  });
  updateAttackProbabilities(containerId);
}

function updateAttackProbabilities(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const rows = ATTACKS_LIST.map(a => {
    const chk = container.querySelector(`.aw-enabled[data-id="${a.id}"]`);
    const enabled = chk ? chk.checked : true;
    const inp = container.querySelector(`.aw-input[data-id="${a.id}"]`);
    const pct = enabled && inp && inp.value !== "" ? parseFloat(inp.value) : 0;
    return { id: a.id, weight: (a.weight || 1) * Math.max(0, pct) / 100 };
  });
  const total = rows.reduce((s, r) => s + r.weight, 0);
  rows.forEach(r => {
    const el = container.querySelector(`.aw-prob[data-id="${r.id}"]`);
    if (!el) return;
    const prob = total > 0 ? (r.weight / total) * 100 : 0;
    el.textContent = "≈" + (prob > 0 && prob < 1 ? prob.toFixed(2) : prob.toFixed(1)) + "%";
  });
}

function readAttackWeights(containerId) {
  const container = document.getElementById(containerId);
  const weights = {};
  if (!container) return weights;
  container.querySelectorAll(".aw-input").forEach(inp => {
    const id = inp.dataset.id;
    const chk = container.querySelector(`.aw-enabled[data-id="${id}"]`);
    weights[id] = (chk && !chk.checked) ? 0 : inp.value;
  });
  return weights;
}

function readAttackOverrides(containerId) {
  const container = document.getElementById(containerId);
  const overrides = {};
  if (!container) return overrides;
  container.querySelectorAll(".aw-tunable").forEach(inp => {
    if (inp.value === "") return;
    const id = inp.dataset.id, field = inp.dataset.field;
    if (!overrides[id]) overrides[id] = {};
    overrides[id][field] = inp.value;
  });
  return overrides;
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
let nukeCinematicPlaying = false;
function render() {
  if (!lastState) return;
  if (nukeCinematicPlaying) return; // on ne montre rien tant que la cinématique n'est pas finie
  if (lastState.status === "lobby") {
    releaseWakeLock();
    renderLobby();
    lastKnownStatus = "lobby";
    return;
  }
  if (lobbyStartLogStop) { lobbyStartLogStop(); lobbyStartLogStop = null; document.getElementById("lobby-status").textContent = ""; }
  if (lastState.status === "ended") {
    releaseWakeLock();
    renderEndScreen();
    lastKnownStatus = "ended";
    return;
  }
  if (lastKnownStatus !== "playing") { startCountdownOverlay(); buildReactionBar(); requestWakeLock(); }
  lastKnownStatus = "playing";
  showScreen("screen-game");
  renderBoard();
  renderHud();
  renderPlayersPanel();
  const isHost = myId === lastState.hostId;
  document.getElementById("btn-end-match").style.display = isHost ? "block" : "none";
  document.getElementById("btn-leave-game").style.display = isHost ? "none" : "block";
}

// ---------- Empêcher l'écran de s'éteindre pendant la partie ----------
let wakeLock = null;
async function requestWakeLock() {
  try {
    if (!("wakeLock" in navigator)) return;
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch (e) { /* pas grave, juste un confort */ }
}
function releaseWakeLock() {
  if (wakeLock) { try { wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !wakeLock && lastState && lastState.status === "playing") requestWakeLock();
});

// ---------- Cinématique de la bombe nucléaire ----------
function sfxNukeSiren() {
  const ctx = ensureAudio(); if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.connect(gain); gain.connect(ctx.destination);
  const now = ctx.currentTime;
  const cycles = 3, cycleDur = 0.5;
  osc.frequency.setValueAtTime(300, now);
  for (let i = 0; i < cycles; i++) {
    const t0 = now + i * cycleDur;
    osc.frequency.linearRampToValueAtTime(760, t0 + cycleDur / 2);
    osc.frequency.linearRampToValueAtTime(300, t0 + cycleDur);
  }
  gain.gain.setValueAtTime(0.16, now);
  gain.gain.setValueAtTime(0.16, now + cycles * cycleDur - 0.1);
  gain.gain.exponentialRampToValueAtTime(0.001, now + cycles * cycleDur + 0.1);
  osc.start(now);
  osc.stop(now + cycles * cycleDur + 0.15);
}
function sfxNukeBlast() {
  playNoise(0.9, 0.28);
  playTone(60, 0.8, "sine", 0.22);
}

// ---------- Tremblement d'écran + vibration du Séisme ----------
function sfxEarthquakeRumble() {
  playNoise(0.5, 0.16);
  playTone(45, 0.5, "sine", 0.18);
  setTimeout(() => playTone(38, 0.35, "sine", 0.14), 180);
}

function playEarthquakeShake() {
  const el = document.getElementById("screen-game");
  if (el) {
    el.classList.remove("earthquake-shake");
    void el.offsetWidth; // force le navigateur à relancer l'animation même si elle vient de jouer
    el.classList.add("earthquake-shake");
    setTimeout(() => el.classList.remove("earthquake-shake"), 600);
  }
  sfxEarthquakeRumble();
  vibrate([60, 40, 60, 40, 100, 40, 80, 40, 60]);
}

// ---------- Cinématique de la bombe nucléaire ----------
// Le clignotement jaune/orange/rouge reste confiné à la carte ; seul le flash
// blanc final envahit tout l'écran, reste au moins 5s, puis s'estompe doucement.
function positionNukeOverlayOnBoard(overlay) {
  const board = document.getElementById("board");
  if (!board) { positionNukeOverlayFullscreen(overlay); return; }
  const r = board.getBoundingClientRect();
  overlay.style.left = r.left + "px";
  overlay.style.top = r.top + "px";
  overlay.style.width = r.width + "px";
  overlay.style.height = r.height + "px";
  overlay.style.borderRadius = "14px";
}
function positionNukeOverlayFullscreen(overlay) {
  overlay.style.left = "0"; overlay.style.top = "0";
  overlay.style.width = "100%"; overlay.style.height = "100%";
  overlay.style.borderRadius = "0";
}

function playNukeCinematic() {
  nukeCinematicPlaying = true;
  const overlay = document.getElementById("nuke-overlay");
  overlay.className = "nuke-overlay";
  overlay.style.removeProperty("opacity"); // laisse le CSS (dont .nuke-fade) contrôler l'opacité de bout en bout
  overlay.style.display = "flex";
  positionNukeOverlayOnBoard(overlay);
  sfxNukeSiren();
  vibrate([80, 60, 80, 60, 80]);

  const WARN_STEP_MS = 500, PREFLASH_MS = 160, BACK_TO_RED_MS = 220, WHITE_HOLD_MS = 5200, FADE_MS = 1400;
  setTimeout(() => { overlay.className = "nuke-overlay nuke-orange"; positionNukeOverlayOnBoard(overlay); }, WARN_STEP_MS);
  setTimeout(() => { overlay.className = "nuke-overlay nuke-red"; positionNukeOverlayOnBoard(overlay); }, WARN_STEP_MS * 2);

  // Faux départ : un flash blanc bref, toujours confiné à la carte, qui retombe
  // au rouge — comme une amorce avant la vraie explosion.
  const preflashAt = WARN_STEP_MS * 2 + 600;
  setTimeout(() => {
    overlay.className = "nuke-overlay nuke-preflash";
    playTone(1200, 0.07, "square", 0.1);
  }, preflashAt);
  const backToRedAt = preflashAt + PREFLASH_MS;
  setTimeout(() => {
    overlay.className = "nuke-overlay nuke-red";
    positionNukeOverlayOnBoard(overlay);
  }, backToRedAt);

  const whiteAt = backToRedAt + BACK_TO_RED_MS;
  setTimeout(() => {
    overlay.className = "nuke-overlay nuke-white";
    positionNukeOverlayFullscreen(overlay);
    sfxNukeBlast();
    vibrate([150, 80, 250]);
  }, whiteAt);
  setTimeout(() => { overlay.classList.add("nuke-fade"); }, whiteAt + WHITE_HOLD_MS);
  setTimeout(() => {
    overlay.style.display = "none";
    overlay.classList.remove("nuke-fade");
    nukeCinematicPlaying = false;
    render(); // la partie est déjà résolue côté serveur : on affiche enfin le résultat
  }, whiteAt + WHITE_HOLD_MS + FADE_MS);
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
  if (!wasAlreadyEnded) {
    document.getElementById("end-settings-form").style.display = "none";
    document.getElementById("btn-toggle-end-settings").textContent = "⚙️ Modifier les paramètres";
  }
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
          <span class="dot" style="background:${displayColor(p.color)}"></span>
          <span class="pname">${escapeHtml(p.pseudo)}${isWinner ? " 🏆" : ""}</span>
          ${teamBadge(p)}
          <span class="hint" style="margin-left:auto">${statLine(p, lastState.mode)}</span>
        </div>
        <div class="hint" style="font-size:11px;padding-left:24px">
          ${p.damageDealt} dégâts infligés · ${p.damageTaken} subis · ${p.timesKO} K.O. subi(s)
        </div>`;
      list.appendChild(li);
    });

  renderEndAwards();

  const isHost = myId === lastState.hostId;
  document.getElementById("end-host-controls").style.display = isHost ? "block" : "none";
  document.getElementById("end-wait").style.display = isHost ? "none" : "block";
}

function renderEndAwards() {
  const wrap = document.getElementById("end-awards");
  if (!wrap) return;
  const players = lastState.players || [];
  const awards = [];

  const topBy = (key) => players.reduce((best, p) => (p[key] || 0) > (best ? best[key] || 0 : -1) ? p : best, null);

  const mostKills = topBy("eliminations");
  if (mostKills && mostKills.eliminations > 0) awards.push({ icon: "⚔️", title: "Bourreau", detail: `${mostKills.eliminations} élimination${mostKills.eliminations > 1 ? "s" : ""}`, p: mostKills });

  const hardestHit = topBy("biggestHit");
  if (hardestHit && hardestHit.biggestHit > 0) awards.push({ icon: "💥", title: "Coup le plus violent", detail: `${hardestHit.biggestHit} dégâts en un coup`, p: hardestHit });

  const mostDamageTaken = topBy("damageTaken");
  if (mostDamageTaken && mostDamageTaken.damageTaken > 0) awards.push({ icon: "🩸", title: "Souffre-douleur", detail: `${mostDamageTaken.damageTaken} dégâts subis`, p: mostDamageTaken });

  const fastestKillers = players.filter(p => p.firstKillAt && lastState.matchStartedAt);
  if (fastestKillers.length) {
    const fastest = fastestKillers.reduce((best, p) => (p.firstKillAt < best.firstKillAt ? p : best));
    const secs = Math.max(0, Math.round((fastest.firstKillAt - lastState.matchStartedAt) / 1000));
    awards.push({ icon: "⚡", title: "K.O. éclair", detail: `premier K.O. en ${secs}s`, p: fastest });
  }

  const toughest = players.filter(p => p.timesKO === 0);
  if (toughest.length && toughest.length < players.length) {
    awards.push({ icon: "🛡️", title: "Increvable", detail: "jamais mis K.O.", p: toughest[0] });
  }

  if (!awards.length) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = `<p class="hint" style="font-size:12px;margin:14px 0 6px">Récompenses de la partie</p>` +
    awards.map(a => `
      <div class="award-row">
        <span class="award-icon">${a.icon}</span>
        <span class="award-text">
          <span class="award-title">${a.title}</span>
          <span class="award-detail">${escapeHtml(a.p.pseudo)} · ${a.detail}</span>
        </span>
      </div>`).join("");
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
  if (me && me.alive && generalSettings.showAdjacentCells) {
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
  (obstacles.heal || []).forEach(({ x, y }) => {
    const c = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
    if (c) c.classList.add("tile-heal");
  });
  (obstacles.teleport || []).forEach(({ x, y }) => {
    const c = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
    if (c) c.classList.add("tile-teleport");
  });
  (obstacles.breakable || []).forEach(({ x, y }) => {
    const c = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
    if (c) c.classList.add("tile-breakable");
  });
  (obstacles.lightningRod || []).forEach(({ x, y }) => {
    const c = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
    if (c) c.classList.add("tile-rod");
  });
  (obstacles.bush || []).forEach(({ x, y }) => {
    const c = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
    if (c) c.classList.add("tile-bush");
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
    if (h.type === "poison" || h.type === "frost" || h.type === "fire" || h.type === "healzone") {
      const cls = h.type === "poison" ? "hazard-poison" : h.type === "frost" ? "hazard-frost" : h.type === "fire" ? "hazard-fire" : "hazard-heal";
      const half = Math.floor(h.size/2);
      for (let dx=-half; dx<=h.size-1-half; dx++) for (let dy=-half; dy<=h.size-1-half; dy++) {
        const cc = board.querySelector(`.cell[data-x="${h.x+dx}"][data-y="${h.y+dy}"]`);
        if (cc) cc.classList.add(cls);
      }
    }
  });

  // Capture du drapeau : bases (toujours visibles) + drapeaux (à leur position actuelle)
  (lastState.flags || []).forEach(f => {
    const baseCell = board.querySelector(`.cell[data-x="${f.baseX}"][data-y="${f.baseY}"]`);
    if (baseCell) baseCell.classList.add("flag-base", "flag-base-" + f.team);
    if (!f.carrierId) {
      const flagCell = board.querySelector(`.cell[data-x="${f.x}"][data-y="${f.y}"]`);
      if (flagCell) {
        const el = document.createElement("div");
        el.className = "flag-marker flag-marker-" + f.team;
        el.textContent = "🚩";
        flagCell.appendChild(el);
      }
    }
  });

  // Cimetière : ombres sans nom qui rôdent sur la carte
  (lastState.zombies || []).forEach(z => {
    const cell = board.querySelector(`.cell[data-x="${z.x}"][data-y="${z.y}"]`);
    if (cell) {
      const el = document.createElement("div");
      el.className = "zombie-marker";
      el.textContent = "🧟";
      cell.appendChild(el);
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
      const pid = p.id;
      el.querySelector(".pseudo-label").addEventListener("click", (e) => {
        if (pid !== myId) return;
        e.stopPropagation();
        handleOwnPseudoClick();
      });
    }
    el.style.background = displayColor(p.color);
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
    el.classList.toggle("hidden-in-bush", !!p.hidden && p.alive);

    const prev = prevPlayerStats.get(p.id);
    const respawned = !!(prev && prev.alive === false && p.alive === true);
    const skipGlide = isNew || respawned || noGlideFor.has(p.id);

    const cellFull = cellGeometry.track + cellGeometry.gap;
    const pSize = p.size || 1;
    const left = p.x * cellFull + 2;
    const top = p.y * cellFull + 2;
    const size = Math.max(4, pSize * cellGeometry.track + (pSize - 1) * cellGeometry.gap - 4);
    el.style.width = size + "px";
    el.style.height = size + "px";
    el.classList.toggle("boss-token", pSize > 1);

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
function computeEffectiveCooldown(me) {
  let cd = lastState.moveCooldownMs || 800;
  const mudMult = lastState.mudSlowMultiplier || 2;
  const onMud = ((lastState.obstacles && lastState.obstacles.mud) || []).some(m => m.x === me.x && m.y === me.y);
  const slowed = !!(me.slowedUntil && me.slowedUntil > Date.now());
  if (onMud || slowed) cd *= mudMult;
  const hasSpeed = !!(me.speedUntil && me.speedUntil > Date.now());
  if (hasSpeed) cd = Math.round(cd * 0.5);
  return { cd, hasSpeed };
}

function updateEnergyBar() {
  const me = lastState.players.find(p => p.id === myId);
  const fill = document.getElementById("energy-fill");
  if (!me || !fill) return;
  const posKey = me.x + "," + me.y;
  if (lastMyPosKey !== null && posKey !== lastMyPosKey && me.alive) {
    const { cd, hasSpeed } = computeEffectiveCooldown(me);
    fill.style.background = hasSpeed ? "#facc15" : "#3b82f6";
    fill.style.transition = "none";
    fill.style.width = "100%";
    void fill.offsetWidth; // force le navigateur à appliquer avant de relancer la transition
    fill.style.transition = `width ${cd}ms linear`;
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
  const bannerText = document.getElementById("turn-banner-text");
  const turn = lastState.turn;
  if (turn) {
    const isMe = turn.playerId === myId;
    const turnKey = turn.playerId + ":" + turn.attackId + ":" + turn.deadline;
    banner.classList.toggle("my-turn", isMe);
    if (turnKey !== lastTurnKey) {
      lastTurnKey = turnKey;
      runSlotMachine(bannerText, turn, isMe);
    }
    updateAltWeaponPicker(turn, isMe);
  } else {
    lastTurnKey = null;
    bannerText.textContent = "En attente du prochain tour…";
    banner.classList.remove("my-turn");
    stopTargeting();
    document.getElementById("alt-weapon-picker").style.display = "none";
  }
  updateTurnTimerBar();

  const me = lastState.players.find(p => p.id === myId);
  if (me) {
    const isBossMe = lastState.bossId && me.id === lastState.bossId;
    const myMaxHp = isBossMe ? Math.round((lastState.startingHP || 100) * (lastState.bossHpMultiplier || 1)) : (lastState.startingHP || 100);
    const pct = Math.max(0, Math.min(100, Math.round((me.hp / myMaxHp) * 100)));
    const fill = document.querySelector(".my-hp-fill");
    fill.style.width = pct + "%";
    fill.style.background = pct > 50 ? "var(--hp-full)" : pct > 20 ? "var(--hp-mid)" : "var(--hp-low)";

    if (lastMyHp !== null && me.hp < lastMyHp) {
      let pattern = 100;
      if (me.hp === 0) pattern = [80, 60, 120];
      else if (recentHazardFlag === "explosion") pattern = [60, 40, 60, 40, 60];
      else if (recentHazardFlag === "mine") pattern = [40, 30, 40];
      vibrate(pattern);
    }
    lastMyHp = me.hp;
  }
}

// Effet "machine à sous" : les icônes d'armes défilent brièvement avant de se
// figer sur celle réellement tirée au sort — rend le tirage plus excitant.
function runSlotMachine(banner, turn, isMe) {
  const p = lastState.players.find(pl => pl.id === turn.playerId);
  const who = isMe ? "À toi de jouer" : `${p ? p.pseudo : "Un joueur"} prépare`;

  if (!isMe && !turn.attackId) {
    // Arme cachée aux autres (option activée par défaut) : pas de machine à sous,
    // juste un message générique — le suspense reste entier jusqu'au tir.
    banner.textContent = `${who} une attaque… 🤫`;
    return;
  }

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

// Main de 2 armes : laisse le joueur actif basculer entre les deux armes
// tirées au sort, avant de viser. Invisible pour les autres (arme cachée).
let altPickerKey = null;
function updateAltWeaponPicker(turn, isMe) {
  const picker = document.getElementById("alt-weapon-picker");
  if (!isMe || !turn.altAttackId) { picker.style.display = "none"; altPickerKey = null; return; }
  const key = turn.attackId + ":" + turn.altAttackId + ":" + turn.deadline;
  if (key === altPickerKey) return; // déjà construit pour ce tour, évite de perdre le focus/anim au clic
  altPickerKey = key;
  const renderChoice = (id, name, active) => `
    <button type="button" class="alt-weapon-choice${active ? " active" : ""}" data-id="${id}">
      ${ATTACK_ICON[id] || ""} ${escapeHtml(name)}${active ? " ✓" : ""}
    </button>`;
  picker.innerHTML = renderChoice(turn.attackId, turn.attackName, true) + renderChoice(turn.altAttackId, turn.altAttackName, false);
  picker.querySelectorAll(".alt-weapon-choice").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return;
      ws.send(JSON.stringify({ type: "chooseWeapon", attackId: btn.dataset.id }));
    });
  });
  picker.style.display = "flex";
}

function renderPlayersPanel() {
  const list = document.getElementById("game-players");
  list.innerHTML = "";
  lastState.players
    .slice()
    .sort((a,b) => (b.id===myId)-(a.id===myId))
    .forEach(p => {
    const li = document.createElement("li");
    const isBoss = lastState.bossId && p.id === lastState.bossId;
    const carriedFlag = (lastState.flags || []).find(f => f.carrierId === p.id);
    const maxHp = isBoss ? Math.round((lastState.startingHP || 100) * (lastState.bossHpMultiplier || 1)) : (lastState.startingHP || 100);
    const pct = Math.max(0, Math.min(100, Math.round((p.hp / maxHp) * 100)));
    const barColor = pct > 50 ? "var(--hp-full)" : pct > 20 ? "var(--hp-mid)" : "var(--hp-low)";
    const stat = lastState.mode && lastState.mode !== "survivor" ? statLine(p, lastState.mode) : "";
    const discoTxt = p.connected === false ? " · déconnecté" : "";
    const bossTag = isBoss ? " 👑" : "";
    const botTag = p.isBot ? " 🤖" : "";
    const flagTag = carriedFlag ? " 🚩" : "";
    li.innerHTML = `<span class="dot" style="background:${displayColor(p.color)}"></span>
      ${teamBadge(p)}
      <span class="pname">${escapeHtml(p.pseudo)}${bossTag}${botTag}${flagTag}${p.id===myId?" · toi":""}${!p.alive?" · K.O.":""}${stat?` · ${stat}`:""}${discoTxt}</span>
      <span class="hpbar"><span class="hpbar-fill" style="width:${pct}%;background:${barColor}"></span></span>`;
    if (isBoss) li.classList.add("boss-row");
    if (p.connected === false) li.style.opacity = "0.5";
    list.appendChild(li);
  });
}

// ---------- Sons (synthétisés, pas de fichier audio à héberger) ----------
let audioCtx = null;
function vibrate(pattern) {
  if (generalSettings.reduceMotion || !generalSettings.vibrationEnabled || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
}
function ensureAudio() {
  if (!generalSettings.soundEnabled) return null;
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
  if (message.includes("piège explosif")) flagRecentHazard("mine");
  if (message.includes("tonneau explose")) flagRecentHazard("explosion");
  if (message.includes("explose") || message.includes("piège explosif")) sfxExplosion();
  else if (message.includes("récupère un bonus")) sfxPickup();
  else if (message.includes("est K.O.")) sfxKO();
}

// Petite flèche qui file du lanceur jusqu'à la case la plus loin touchée,
// puis déclenche les impacts habituels le long du trajet.
// ---------- Réactions emoji ----------
function buildReactionBar() {
  const bar = document.getElementById("reaction-bar");
  if (!bar) return;
  const emojis = generalSettings.reactionEmojis && generalSettings.reactionEmojis.length ? generalSettings.reactionEmojis : DEFAULT_REACTION_EMOJIS;
  bar.innerHTML = emojis.map(e => `<button type="button" class="reaction-btn" data-emoji="${e}">${e}</button>`).join("");
  bar.querySelectorAll(".reaction-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "reaction", emoji: btn.dataset.emoji }));
      showFloatingReaction(myId, btn.dataset.emoji);
    });
  });
}

function showFloatingReaction(byId, emoji) {
  const layer = document.getElementById("player-layer");
  if (!layer || !cellGeometry.track) return;
  const p = lastState && lastState.players.find(pl => pl.id === byId);
  const el = document.createElement("div");
  el.className = "reaction-float";
  el.textContent = emoji;
  if (p) {
    const left = p.x * (cellGeometry.track + cellGeometry.gap) + cellGeometry.track / 2;
    const top = p.y * (cellGeometry.track + cellGeometry.gap);
    el.style.left = left + "px";
    el.style.top = top + "px";
  } else {
    el.style.left = "50%";
    el.style.top = "10%";
  }
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

// Éclair en zigzag qui relie le lanceur à chaque point d'impact successif,
// avec un flash de zone (qui "s'étend") à chaque case touchée.
function playChainLightning(groups, casterId) {
  const points = (groups || []).map(g => g[0]).filter(Boolean);
  if (!points.length || !cellGeometry.track) { flashCells(points, "chainLightning"); return; }
  const layer = document.getElementById("player-layer");
  if (!layer) return;
  const caster = lastState.players.find(p => p.id === casterId);
  const cellFull = cellGeometry.track + cellGeometry.gap;
  const toPx = (cx, cy) => ({ x: cx * cellFull + cellGeometry.track / 2, y: cy * cellFull + cellGeometry.track / 2 });

  const chain = [caster ? toPx(caster.x, caster.y) : toPx(points[0].x, points[0].y)];
  points.forEach(p => chain.push(toPx(p.x, p.y)));

  const STEP_MS = 150;
  for (let i = 0; i < chain.length - 1; i++) {
    setTimeout(() => drawLightningBolt(layer, chain[i], chain[i + 1]), i * STEP_MS);
  }
  points.forEach((p, i) => {
    setTimeout(() => flashCells([p], "chainLightning"), i * STEP_MS + 90);
  });
}

function drawLightningBolt(layer, from, to) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "lightning-bolt-svg");
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len; // normale pour le jitter perpendiculaire au trait
  const segments = 5;
  let d = `M ${from.x} ${from.y} `;
  for (let s = 1; s < segments; s++) {
    const t = s / segments;
    const jitter = (Math.random() - 0.5) * 16;
    d += `L ${from.x + dx * t + nx * jitter} ${from.y + dy * t + ny * jitter} `;
  }
  d += `L ${to.x} ${to.y}`;
  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", d);
  path.setAttribute("class", "lightning-bolt-path");
  svg.appendChild(path);
  layer.appendChild(svg);
  playTone(1400, 0.06, "square", 0.1);
  setTimeout(() => svg.remove(), 280);
}

function playArrowShot(cells, casterId) {
  if (!cells || !cells.length || !cellGeometry.track) { flashCells(cells, "arrow"); return; }
  const caster = lastState.players.find(p => p.id === casterId);
  const layer = document.getElementById("player-layer");
  if (!layer || !caster) { flashCells(cells, "arrow"); return; }
  const cellFull = cellGeometry.track + cellGeometry.gap;
  const toPx = (cx, cy) => ({ left: cx * cellFull + cellGeometry.track / 2, top: cy * cellFull + cellGeometry.track / 2 });
  const start = toPx(caster.x, caster.y);
  const last = cells[cells.length - 1];
  const end = toPx(last.x, last.y);
  const angle = Math.atan2(end.top - start.top, end.left - start.left) * (180 / Math.PI);

  const arrow = document.createElement("div");
  arrow.className = "arrow-shot";
  arrow.textContent = "➤";
  arrow.style.left = start.left + "px";
  arrow.style.top = start.top + "px";
  arrow.style.transform = `translate(-50%,-50%) rotate(${angle}deg)`;
  layer.appendChild(arrow);
  void arrow.offsetWidth;
  arrow.style.left = end.left + "px";
  arrow.style.top = end.top + "px";
  playTone(950, 0.09, "square", 0.12);

  setTimeout(() => {
    arrow.remove();
    flashCells(cells, "arrow");
  }, 220);
}

// Événements des modificateurs de carte (météorite, orage, séisme, pluie acide) :
// réutilise les impacts et effets existants, avec le bon thème visuel/sonore.
function playMapEvent(kind, cells) {
  if (kind === "earthquakeMod") { playEarthquakeShake(); flashCells(cells, kind); return; }
  if (kind === "storm") { playStormBolt(cells); return; }
  flashCells(cells, kind);
}

// Orage : un éclair spectaculaire tombe du ciel jusqu'à la case frappée,
// bien plus visible qu'un simple flash perdu sur une seule case.
function playStormBolt(cells) {
  const target = (cells || [])[0];
  if (!target || !cellGeometry.track) { flashCells(cells, "storm"); return; }
  const layer = document.getElementById("player-layer");
  if (!layer) return;
  const cellFull = cellGeometry.track + cellGeometry.gap;
  const to = { x: target.x * cellFull + cellGeometry.track / 2, y: target.y * cellFull + cellGeometry.track / 2 };
  const from = { x: to.x, y: -40 };
  drawLightningBolt(layer, from, to);
  setTimeout(() => flashCells(cells, "storm"), 90);
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
// ---------- Geste de déverrouillage des codes secrets ----------
// Avant tout code, il faut taper 3 fois sur son propre pseudo (au-dessus de
// son jeton) — sinon les glissements suivants ne comptent pour aucun code.
let cheatUnlockStage = 0; // 0 = verrouillé, 2 = déverrouillé
let pseudoClickCount = 0;
let pseudoClickTimer = null;
function handleOwnPseudoClick() {
  pseudoClickCount++;
  clearTimeout(pseudoClickTimer);
  pseudoClickTimer = setTimeout(() => { pseudoClickCount = 0; }, 1200);
  if (pseudoClickCount >= 3) {
    pseudoClickCount = 0;
    clearTimeout(pseudoClickTimer);
    cheatUnlockStage = 2;
    cheatCodeBuffer = [];
    vibrate(30);
  }
}

function onCellClick(x, y) {
  if (dragMoved) { dragMoved = false; return; } // c'était un glissement, pas un tap de ciblage
  if (targetingAttackId) { onTargetClick(x, y); return; }
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

// ---------- Codes secrets (séquences de glissement) ----------
const CHEAT_CODES = [
  { seq: ["up", "down", "up", "down", "left", "right", "left", "right", "right"], action: "nukeConfirm" },
  { seq: ["down", "up", "down", "down", "down", "up"], action: "panel" },
  { seq: ["up", "down", "down", "up", "right", "right"], action: "buffPanel" },
];
const CHEAT_BUFFER_MAX = Math.max(...CHEAT_CODES.map(c => c.seq.length));
let cheatCodeBuffer = [];

function recordCheatCodeInput(dir) {
  if (cheatUnlockStage !== 2) return; // le geste (coin haut-gauche puis bas-droite) doit précéder
  cheatCodeBuffer.push(dir);
  if (cheatCodeBuffer.length > CHEAT_BUFFER_MAX) cheatCodeBuffer.shift();
  for (const code of CHEAT_CODES) {
    const tail = cheatCodeBuffer.slice(-code.seq.length);
    if (tail.length !== code.seq.length) continue;
    if (code.seq.every((d, i) => d === tail[i])) {
      cheatCodeBuffer = [];
      cheatUnlockStage = 0; // se reverrouille : il faudra refaire le geste pour le prochain code
      vibrate(code.action === "nukeConfirm" ? [40, 40, 40, 40, 120] : 60);
      if (code.action === "nukeConfirm") openNukeConfirmPanel();
      else if (code.action === "buffPanel") openBuffPanel();
      else openSecretAttackPanel();
      return;
    }
  }
}

function openNukeConfirmPanel() {
  document.getElementById("nuke-confirm-panel").style.display = "flex";
}
document.getElementById("btn-nuke-confirm-no").addEventListener("click", () => {
  document.getElementById("nuke-confirm-panel").style.display = "none";
});
document.getElementById("btn-nuke-confirm-yes").addEventListener("click", () => {
  ws.send(JSON.stringify({ type: "cheatCode", code: "nuke" }));
  document.getElementById("nuke-confirm-panel").style.display = "none";
});

function openBuffPanel() {
  document.getElementById("buff-panel").style.display = "flex";
}
document.getElementById("btn-close-buff-panel").addEventListener("click", () => {
  document.getElementById("buff-panel").style.display = "none";
});
document.querySelectorAll(".buff-choice").forEach(btn => {
  btn.addEventListener("click", () => {
    ws.send(JSON.stringify({ type: "cheatCode", code: "buff", buff: btn.dataset.buff }));
    document.getElementById("buff-panel").style.display = "none";
  });
});

function openSecretAttackPanel() {
  const list = document.getElementById("secret-attack-list");
  list.innerHTML = ATTACKS_LIST.map(a => `
    <button type="button" class="secret-attack-choice" data-id="${a.id}">${ATTACK_ICON[a.id] || ""} ${escapeHtml(a.name)}</button>
  `).join("");
  list.querySelectorAll(".secret-attack-choice").forEach(btn => {
    btn.addEventListener("click", () => {
      ws.send(JSON.stringify({ type: "cheatCode", code: "choose", attackId: btn.dataset.id }));
      document.getElementById("secret-attack-panel").style.display = "none";
    });
  });
  document.getElementById("secret-attack-panel").style.display = "flex";
}
document.getElementById("btn-close-secret-panel").addEventListener("click", () => {
  document.getElementById("secret-attack-panel").style.display = "none";
});

function handleSwipeMove(dx, dy) {
  if (!lastState) return;
  const me = lastState.players.find(p => p.id === myId);
  if (!me || !me.alive) return;
  let x = me.x, y = me.y, dir;
  if (Math.abs(dx) > Math.abs(dy)) { dir = dx > 0 ? "right" : "left"; x += dx > 0 ? 1 : -1; }
  else { dir = dy > 0 ? "down" : "up"; y += dy > 0 ? 1 : -1; }
  recordCheatCodeInput(dir);
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
  if (meta.target === "direction") {
    const me = lastState.players.find(p => p.id === myId);
    if (!me) return;
    const dx = x - me.x, dy = y - me.y;
    if (dx === 0 && dy === 0) return; // tap sur sa propre case : ambigu, on attend un tap plus clair
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
    ws.send(JSON.stringify({ type: "attack", dir }));
    stopTargeting();
    return;
  }
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
