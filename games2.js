// =====================================================================
// Nouveaux jeux : 4 Solo (Lights Out, Pierres glissantes, Course de dauphins,
// Éclate-bulles), 5 Duo (Hex, Dés menteurs, Pong, Duel de maths, Pendu),
// 4 Multi (Dessine-moi, Imposteur, Course de réflexes, Qui ment ?).
// Chargé après app.js (partage ses variables globales).
// =====================================================================
const $g = (id) => document.getElementById(id);
const SOLO_EXTRA = {};
const PARTY_EXTRA_RENDERERS = {};
const G2_TICKS = [];
setInterval(() => { G2_TICKS.forEach(f => { try { f(); } catch (e) { /* ignore */ } }); }, 200);
function g2Active(id) { const el = $g(id); return !!el && el.classList.contains("active"); }
function g2Bar(barId, endAt, totalMs) {
  const el = $g(barId); if (!el) return;
  el.style.width = Math.max(0, Math.min(100, (endAt - Date.now()) / totalMs * 100)) + "%";
}
function g2Inject(html) { document.querySelector("script[src='app.js']").insertAdjacentHTML("beforebegin", html); }
function g2BindQuit(root) {
  root.querySelectorAll(".duo-quit-btn").forEach(btn => btn.addEventListener("click", () => {
    if (duoWs) { try { duoWs.close(); } catch (e) { /* ignore */ } }
    clearTimeout(duoEndTimer); showScreen("screen-home");
  }));
  root.querySelectorAll(".party-quit-btn").forEach(b => b.addEventListener("click", leaveParty));
}
function g2SoloShell(id, title, hintHtml, bodyHtml, extraBtns) {
  g2Inject(`<section id="screen-solo-${id}" class="screen"><div class="card">
    <h2 class="lobby-title">${title}</h2>
    <p class="hint" style="text-align:center">${hintHtml}</p>
    ${bodyHtml}
    <div class="solo-game-btns">
      <button type="button" id="btn-${id}-restart" class="btn btn-secondary">Nouvelle partie</button>
      <button type="button" id="btn-${id}-quit" class="btn btn-secondary">Retour</button>
    </div></div></section>`);
}
function g2SoloLeave(id, onLeave) {
  $g(`btn-${id}-quit`).addEventListener("click", () => { onLeave && onLeave(); showScreen("screen-solo-hub"); });
}

// ============================ LIGHTS OUT ============================
g2SoloShell("lights", "💡 Lights Out", `Coups : <span id="lo-moves">0</span> · Lumières : <span id="lo-left">0</span>`,
  `<div id="lo-grid" class="lo-grid"></div><p class="hint" style="font-size:12px;text-align:center;margin-top:8px">Touche une case : elle et ses 4 voisines changent d'état. Éteins tout !</p>`);
let loState = null;
function startLightsGame() {
  soloRetryHandler = startLightsGame;
  const N = 5, b = Array.from({ length: N }, () => Array(N).fill(false));
  const press = (r, c) => { [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dr, dc]) => { const y = r + dr, x = c + dc; if (y >= 0 && y < N && x >= 0 && x < N) b[y][x] = !b[y][x]; }); };
  do { for (let i = 0; i < 9 + Math.floor(Math.random() * 6); i++) press(Math.floor(Math.random() * N), Math.floor(Math.random() * N)); } while (b.every(r => r.every(v => !v)));
  loState = { N, b, moves: 0, press, done: false };
  loRender(); showScreen("screen-solo-lights");
}
function loRender() {
  const s = loState, grid = $g("lo-grid");
  if (!grid.children.length) {
    for (let i = 0; i < 25; i++) {
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "lo-cell";
      btn.addEventListener("click", () => {
        if (!loState || loState.done) return;
        loState.press(Math.floor(i / 5), i % 5); loState.moves++; vibrate(8); playTone(300 + (i % 5) * 60, 0.06, "triangle", 0.1); loRender();
        if (loState.b.every(r => r.every(v => !v))) {
          loState.done = true; const m = loState.moves;
          setTimeout(() => showSoloEnd("win", "Tout est éteint !", `Bravo, résolu en ${m} coups.`), 450);
        }
      });
      grid.appendChild(btn);
    }
  }
  let lit = 0;
  for (let i = 0; i < 25; i++) { const on = s.b[Math.floor(i / 5)][i % 5]; grid.children[i].classList.toggle("on", on); if (on) lit++; }
  $g("lo-moves").textContent = s.moves; $g("lo-left").textContent = lit;
}
$g("btn-lights-restart").addEventListener("click", startLightsGame);
g2SoloLeave("lights", () => { loState = null; });
SOLO_EXTRA.lights = startLightsGame;

// ========================= PIERRES GLISSANTES =========================
g2SoloShell("ice", "🧊 Pierres glissantes", `Niveau <span id="ice-level">1</span>/3 · Coups : <span id="ice-moves">0</span>`,
  `<div id="ice-board" class="ice-board"><div id="ice-player" class="ice-player">🐧</div></div>
   <div id="ice-dpad" class="mini-dpad">
     <button type="button" class="mini-dpad-btn mini-dpad-up" data-dir="up">▲</button>
     <div class="mini-dpad-row"><button type="button" class="mini-dpad-btn" data-dir="left">◀</button><button type="button" class="mini-dpad-btn" data-dir="right">▶</button></div>
     <button type="button" class="mini-dpad-btn mini-dpad-down" data-dir="down">▼</button>
   </div>
   <p class="hint" style="font-size:12px;text-align:center;margin-top:6px">Le pingouin glisse jusqu'à un obstacle. Arrête-toi sur ⭐ (elle t'arrête toujours).</p>`);
const ICE_N = 7, ICE_DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
let iceState = null;
function iceSlide(rocks, goal, r, c, d) {
  let moved = false;
  for (;;) {
    const nr = r + d[0], nc = c + d[1];
    if (nr < 0 || nc < 0 || nr >= ICE_N || nc >= ICE_N || rocks.has(nr + "," + nc)) break;
    r = nr; c = nc; moved = true;
    if (r === goal[0] && c === goal[1]) break;
  }
  return { r, c, moved };
}
function iceGen() {
  for (let attempt = 0; attempt < 400; attempt++) {
    const rocks = new Set();
    const nr = 9 + Math.floor(Math.random() * 5);
    while (rocks.size < nr) rocks.add(Math.floor(Math.random() * ICE_N) + "," + Math.floor(Math.random() * ICE_N));
    const free = []; for (let r = 0; r < ICE_N; r++) for (let c = 0; c < ICE_N; c++) if (!rocks.has(r + "," + c)) free.push([r, c]);
    const start = free[Math.floor(Math.random() * free.length)], goal = free[Math.floor(Math.random() * free.length)];
    if (start[0] === goal[0] && start[1] === goal[1]) continue;
    const dist = new Map([[start.join(","), 0]]), q = [start];
    while (q.length) {
      const [r, c] = q.shift(), dd = dist.get(r + "," + c);
      for (const d of Object.values(ICE_DIRS)) {
        const s = iceSlide(rocks, goal, r, c, d), k = s.r + "," + s.c;
        if (s.moved && !dist.has(k)) { dist.set(k, dd + 1); q.push([s.r, s.c]); }
      }
    }
    const opt = dist.get(goal.join(","));
    if (opt >= 4 && opt <= 9) return { rocks, start, goal, opt };
  }
  return { rocks: new Set(["3,1", "1,3", "5,3", "3,5"]), start: [3, 3], goal: [0, 3], opt: 1 };
}
function startIceGame() {
  soloRetryHandler = startIceGame;
  iceState = { level: 0, total: 0, opt: 0, busy: false };
  iceLoadLevel(); showScreen("screen-solo-ice");
}
function iceLoadLevel() {
  const s = iceState, lv = iceGen();
  Object.assign(s, { rocks: lv.rocks, goal: lv.goal, r: lv.start[0], c: lv.start[1], moves: 0, busy: false, levelOpt: lv.opt });
  s.level++; s.opt += lv.opt;
  const board = $g("ice-board");
  board.querySelectorAll(".ice-cell").forEach(e => e.remove());
  for (let r = 0; r < ICE_N; r++) for (let c = 0; c < ICE_N; c++) {
    const d = document.createElement("div"); d.className = "ice-cell";
    if (s.rocks.has(r + "," + c)) { d.classList.add("rock"); d.textContent = "🪨"; }
    else if (r === s.goal[0] && c === s.goal[1]) { d.classList.add("goal"); d.textContent = "⭐"; }
    board.insertBefore(d, $g("ice-player"));
  }
  icePlace(0);
  $g("ice-level").textContent = s.level; $g("ice-moves").textContent = 0;
}
function icePlace(ms) {
  const p = $g("ice-player"), s = iceState;
  p.style.transitionDuration = ms + "ms";
  p.style.left = (s.c * 100 / ICE_N) + "%"; p.style.top = (s.r * 100 / ICE_N) + "%";
}
function iceMove(dir) {
  const s = iceState; if (!s || s.busy || !g2Active("screen-solo-ice")) return;
  const res = iceSlide(s.rocks, s.goal, s.r, s.c, ICE_DIRS[dir]);
  if (!res.moved) { vibrate(10); return; }
  const dist = Math.abs(res.r - s.r) + Math.abs(res.c - s.c);
  s.busy = true; s.r = res.r; s.c = res.c; s.moves++; s.total++;
  $g("ice-moves").textContent = s.moves; icePlace(dist * 90); playTone(500 - dist * 30, 0.1, "sine", 0.1);
  const me = s;
  setTimeout(() => {
    if (iceState !== me) return;
    if (s.r === s.goal[0] && s.c === s.goal[1]) {
      sfxPickup(); vibrate([20, 20, 40]);
      if (s.level >= 3) { const t = s.total, o = s.opt; setTimeout(() => showSoloEnd("win", "Traversée réussie !", `3 niveaux en ${t} coups (le minimum possible : ${o}).`), 250); }
      else setTimeout(() => { if (iceState === me) iceLoadLevel(); }, 500);
    } else s.busy = false;
  }, dist * 90 + 30);
}
document.querySelectorAll("#ice-dpad .mini-dpad-btn").forEach(b => b.addEventListener("click", () => iceMove(b.dataset.dir)));
(function iceSwipe() {
  let sx = 0, sy = 0;
  const board = $g("ice-board");
  board.style.touchAction = "none";
  board.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; });
  board.addEventListener("pointerup", (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    iceMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  });
})();
document.addEventListener("keydown", (e) => { const m = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[e.key]; if (m && g2Active("screen-solo-ice")) { e.preventDefault(); iceMove(m); } });
$g("btn-ice-restart").addEventListener("click", startIceGame);
g2SoloLeave("ice", () => { iceState = null; });
SOLO_EXTRA.ice = startIceGame;

// ========================= COURSE DE DAUPHINS =========================
g2SoloShell("dolphin", "🐬 Course de dauphins", `Distance : <span id="dp-dist">0</span> m — Record : <span id="dp-best">0</span> m`,
  `<canvas id="dp-canvas" width="340" height="190" class="dp-canvas"></canvas>
   <p class="hint" style="font-size:12px;text-align:center;margin-top:6px">Touche l'écran pour sauter par-dessus les 🪨. Évite de sauter quand un 🦅 vole bas !</p>`);
let dpState = null, dpBest = Number(localStorage.getItem("capnaval-dolphin-best") || 0);
const DP_W = 340, DP_H = 190, DP_GROUND = 150;
function startDolphinGame() {
  soloRetryHandler = startDolphinGame;
  dpState = { y: 0, vy: 0, dist: 0, speed: 190, obs: [], nextGap: 0.9, last: performance.now(), dead: false, t: 0 };
  $g("dp-best").textContent = dpBest; $g("dp-dist").textContent = 0;
  showScreen("screen-solo-dolphin");
  const me = dpState; requestAnimationFrame((t) => dpFrame(me, t));
}
function dpJump() {
  const s = dpState; if (!s || s.dead) return;
  if (s.y <= 1) { s.vy = 430; playTone(520, 0.12, "sine", 0.1); vibrate(6); }
}
function dpFrame(s, now) {
  if (dpState !== s || s.dead || !g2Active("screen-solo-dolphin")) return;
  const dt = Math.min(0.05, (now - s.last) / 1000); s.last = now; s.t += dt;
  s.speed = Math.min(420, 190 + s.t * 7);
  s.dist += s.speed * dt / 12;
  s.vy -= 1150 * dt; s.y = Math.max(0, s.y + s.vy * dt); if (s.y === 0 && s.vy < 0) s.vy = 0;
  s.nextGap -= dt;
  if (s.nextGap <= 0) {
    const bird = Math.random() < 0.35 && s.t > 6;
    s.obs.push({ x: DP_W + 20, type: bird ? "bird" : "rock" });
    s.nextGap = (0.8 + Math.random() * 0.8) * (1 + (260 / s.speed) * 0.3) + (bird ? 0.3 : 0);
  }
  s.obs.forEach(o => { o.x -= s.speed * dt; });
  s.obs = s.obs.filter(o => o.x > -40);
  const dx = 60, dw = 24, dh = 22;
  for (const o of s.obs) {
    const ow = 20, oy = o.type === "rock" ? 0 : 38, oh = o.type === "rock" ? 22 : 22;
    const hitX = o.x < dx + dw - 4 && o.x + ow > dx + 4;
    const hitY = s.y < oy + oh - 2 && s.y + dh > oy + 2;
    if (hitX && hitY) { dpDie(s); return; }
  }
  dpDraw(s);
  $g("dp-dist").textContent = Math.floor(s.dist);
  requestAnimationFrame((t) => dpFrame(s, t));
}
function dpDraw(s) {
  const c = $g("dp-canvas").getContext("2d");
  const g = c.createLinearGradient(0, 0, 0, DP_H); g.addColorStop(0, "#7dd3fc"); g.addColorStop(0.7, "#0ea5e9"); g.addColorStop(1, "#075985");
  c.fillStyle = g; c.fillRect(0, 0, DP_W, DP_H);
  c.fillStyle = "rgba(255,255,255,.35)"; const off = (s.dist * 12) % 40;
  for (let x = -off; x < DP_W; x += 40) c.fillRect(x, DP_GROUND + 18, 22, 2);
  c.font = "30px serif"; c.textBaseline = "alphabetic";
  c.save(); c.translate(60 + 12, DP_GROUND - s.y); c.rotate(-Math.max(-0.5, Math.min(0.6, s.vy / 700))); c.scale(-1, 1); c.fillText("🐬", -14, 4); c.restore();
  s.obs.forEach(o => { c.fillText(o.type === "rock" ? "🪨" : "🦅", o.x, DP_GROUND + 4 - (o.type === "rock" ? 0 : 38)); });
}
function dpDie(s) {
  s.dead = true; sfxImpact(); vibrate([40, 30, 80]);
  const m = Math.floor(s.dist);
  if (m > dpBest) { dpBest = m; try { localStorage.setItem("capnaval-dolphin-best", String(m)); } catch (e) { /* ignore */ } }
  setTimeout(() => { if (dpState === s) showSoloEnd(m >= 400 ? "win" : "lose", m >= 400 ? "Grand saut !" : "Plouf !", `Tu as nagé ${m} m (record : ${dpBest} m). Objectif victoire : 400 m.`); }, 350);
}
(function dpInput() {
  const cv = $g("dp-canvas"); cv.style.touchAction = "none";
  cv.addEventListener("pointerdown", dpJump);
  document.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "ArrowUp") && g2Active("screen-solo-dolphin")) { e.preventDefault(); dpJump(); } });
})();
$g("btn-dolphin-restart").addEventListener("click", startDolphinGame);
g2SoloLeave("dolphin", () => { dpState = null; });
SOLO_EXTRA.dolphin = startDolphinGame;

// ============================ ÉCLATE-BULLES ============================
g2SoloShell("bubbles", "🫧 Éclate-bulles", `Score : <span id="bb-score">0</span> / 1000 — ⏱️ <span id="bb-time">60</span>s`,
  `<div id="bb-grid" class="bb-grid"></div><p class="hint" style="font-size:12px;text-align:center;margin-top:6px">Touche un groupe de 2 bulles ou plus de la même couleur : plus il est gros, plus il rapporte (n²).</p>`);
const BB_COLS = 8, BB_ROWS = 9, BB_SYMS = ["●", "▲", "■", "◆"];
let bbState = null;
function startBubblesGame() {
  soloRetryHandler = startBubblesGame;
  const grid = Array.from({ length: BB_ROWS }, () => Array.from({ length: BB_COLS }, () => Math.floor(Math.random() * 4)));
  bbState = { grid, score: 0, left: 60, busy: false };
  const me = bbState;
  bbState.timer = setInterval(() => {
    if (bbState !== me) { clearInterval(me.timer); return; }
    me.left -= 1; $g("bb-time").textContent = Math.max(0, me.left);
    if (me.left <= 0) { clearInterval(me.timer); bbEnd(me); }
  }, 1000);
  bbRender(); showScreen("screen-solo-bubbles");
  $g("bb-time").textContent = 60; $g("bb-score").textContent = 0;
}
function bbRender(popping) {
  const el = $g("bb-grid"), s = bbState;
  if (!el.children.length) {
    for (let r = 0; r < BB_ROWS; r++) for (let c = 0; c < BB_COLS; c++) {
      const b = document.createElement("button"); b.type = "button"; b.className = "bb-cell";
      b.addEventListener("click", () => bbTap(r, c)); el.appendChild(b);
    }
  }
  for (let r = 0; r < BB_ROWS; r++) for (let c = 0; c < BB_COLS; c++) {
    const b = el.children[r * BB_COLS + c], v = s.grid[r][c];
    b.className = "bb-cell bb-c" + v + (popping && popping.has(r + "," + c) ? " bb-pop" : "");
    b.textContent = BB_SYMS[v];
  }
}
function bbGroup(r, c) {
  const g = bbState.grid, v = g[r][c], seen = new Set([r + "," + c]), st = [[r, c]];
  while (st.length) {
    const [y, x] = st.pop();
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dy, dx]) => {
      const ny = y + dy, nx = x + dx, k = ny + "," + nx;
      if (ny >= 0 && nx >= 0 && ny < BB_ROWS && nx < BB_COLS && !seen.has(k) && g[ny][nx] === v) { seen.add(k); st.push([ny, nx]); }
    });
  }
  return seen;
}
function bbTap(r, c) {
  const s = bbState; if (!s || s.busy || s.left <= 0) return;
  const grp = bbGroup(r, c);
  if (grp.size < 2) { vibrate(8); return; }
  s.busy = true; s.score += grp.size * grp.size; $g("bb-score").textContent = s.score;
  playTone(380 + Math.min(grp.size, 14) * 45, 0.1, "sine", 0.12); vibrate(grp.size > 5 ? [15, 10, 20] : 10);
  bbRender(grp);
  setTimeout(() => {
    if (bbState !== s) return;
    for (let x = 0; x < BB_COLS; x++) {
      const col = []; for (let y = BB_ROWS - 1; y >= 0; y--) if (!grp.has(y + "," + x)) col.push(s.grid[y][x]);
      while (col.length < BB_ROWS) col.push(Math.floor(Math.random() * 4));
      for (let y = BB_ROWS - 1, i = 0; y >= 0; y--, i++) s.grid[y][x] = col[i];
    }
    s.busy = false; bbRender();
  }, 150);
}
function bbEnd(s) {
  if (bbState !== s) return;
  const win = s.score >= 1000;
  showSoloEnd(win ? "win" : "lose", win ? "Quel éclat !" : "Temps écoulé !", `Score final : ${s.score} (objectif : 1000).`);
}
$g("btn-bubbles-restart").addEventListener("click", startBubblesGame);
g2SoloLeave("bubbles", () => { if (bbState) clearInterval(bbState.timer); bbState = null; });
SOLO_EXTRA.bubbles = startBubblesGame;

SOLO_GAMES.push(
  { id: "lights", kind: "lights", icon: "💡", label: "Lights Out", desc: "Éteins toutes les lumières : chaque case change aussi ses voisines." },
  { id: "ice", kind: "ice", icon: "🧊", label: "Pierres glissantes", desc: "Glisse sur la glace jusqu'à l'étoile, 3 niveaux à résoudre en un minimum de coups." },
  { id: "dolphin", kind: "dolphin", icon: "🐬", label: "Course de dauphins", desc: "Saute par-dessus les rochers et évite les oiseaux, de plus en plus vite." },
  { id: "bubbles", kind: "bubbles", icon: "🫧", label: "Éclate-bulles", desc: "Fais éclater des groupes de bulles de même couleur : 1000 points en 60 secondes." }
);

// =====================================================================
// ============================== DUO ==================================
// =====================================================================
function g2DuoShell(id, title, bodyHtml) {
  g2Inject(`<section id="screen-duo-${id}" class="screen net-duo"><div class="card">
    <h2 class="lobby-title" style="font-size:18px">${title}</h2>
    <div id="duo-${id}-banner" class="bs-turn-banner">...</div>
    ${bodyHtml}
    <button type="button" class="btn btn-secondary duo-quit-btn" style="margin-top:10px">Abandonner</button>
  </div></section>`);
  g2BindQuit($g(`screen-duo-${id}`));
}
function g2Banner(id, text, mine) { const b = $g(id); b.textContent = text; b.classList.toggle("bs-my-turn", !!mine); }
const oppName = () => (duo.opponent ? duo.opponent.pseudo : "l'adversaire");

// ------------------------------ HEX ------------------------------
g2DuoShell("hex", "⬡ Hex", `<p id="hex-role" class="hint" style="text-align:center;font-size:12px"></p><div id="hex-board" class="hex-board"></div>
  <p class="hint" style="font-size:12px;text-align:center">🔴 relie le haut et le bas · 🔵 relie la gauche et la droite. Pas de match nul possible !</p>`);
(function buildHex() {
  const N = 9, board = $g("hex-board"), W = 100 / (N + (N - 1) / 2 + 0.2);
  board.style.setProperty("--hw", W + "%");
  const totalH = (N - 1) * 0.866 * W + W * 1.1547;
  board.style.paddingBottom = totalH + "%";
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const b = document.createElement("button"); b.type = "button"; b.className = "hex-cell";
    b.style.left = ((c + 0.5 * r) * W + 0.1 * W) + "%"; b.style.top = (r * 0.866 * W / totalH * 100) + "%";
    b.style.width = W + "%"; b.style.paddingBottom = (W * 1.1547) + "%";
    b.addEventListener("click", () => {
      if (!duo || duo.game !== "hex" || duo.status !== "playing" || duo.turn !== myDuoNum || duo.board[r][c]) return;
      sendDuo({ type: "duoHex", r, c }); vibrate(8);
    });
    board.appendChild(b);
  }
})();
let hexPrevCount = 0;
function renderDuoHex() {
  duoShowScreen("screen-duo-hex");
  const myTurn = duo.status === "playing" && duo.turn === myDuoNum;
  g2Banner("duo-hex-banner", duo.status === "ended" ? "Partie terminée" : myTurn ? "⬡ À toi de jouer !" : `En attente de ${oppName()}...`, myTurn);
  $g("hex-role").textContent = myDuoNum === 1 ? "Tu es 🔴 : relie le haut au bas" : "Tu es 🔵 : relie la gauche à la droite";
  const cells = $g("hex-board").children, path = new Set((duo.path || []).map(p => p.join(",")));
  let count = 0;
  for (let r = 0; r < duo.n; r++) for (let c = 0; c < duo.n; c++) {
    const v = duo.board[r][c], el = cells[r * duo.n + c]; if (v) count++;
    el.className = "hex-cell" + (r === 0 || r === duo.n - 1 ? " edge-v" : "") + (c === 0 || c === duo.n - 1 ? " edge-h" : "") + (v === 1 ? " p1" : v === 2 ? " p2" : "") + (duo.last && duo.last[0] === r && duo.last[1] === c ? " last" : "") + (path.has(r + "," + c) ? " win" : "");
  }
  if (count > hexPrevCount) playTone(myTurn ? 330 : 440, 0.08, "triangle", 0.12);
  hexPrevCount = count;
}

// ---------------------------- DÉS MENTEURS ----------------------------
const DICE_FACES = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
g2DuoShell("dice", "🎲 Dés menteurs", `
  <div class="dice-row"><span class="dice-label" id="dice-opp-label">Adversaire</span><div id="dice-opp" class="dice-hand"></div></div>
  <div id="dice-bid" class="dice-bid">—</div>
  <div class="dice-row"><span class="dice-label">Toi</span><div id="dice-me" class="dice-hand"></div></div>
  <div id="dice-controls">
    <div class="dice-pick"><button type="button" id="dice-q-minus" class="btn btn-secondary">−</button><span id="dice-q" class="dice-q">1</span><button type="button" id="dice-q-plus" class="btn btn-secondary">+</button>
      <span class="dice-times">×</span><div id="dice-faces" class="dice-faces"></div></div>
    <div class="solo-game-btns"><button type="button" id="btn-dice-bid" class="btn btn-primary">Annoncer</button><button type="button" id="btn-dice-liar" class="btn btn-secondary">🤥 Menteur !</button></div>
  </div>
  <p id="dice-info" class="hint" style="text-align:center;font-size:12px"></p>
  <p class="hint" style="font-size:11px;text-align:center">Annonce combien de dés montrent une face (dés des 2 joueurs additionnés). Relance plus haut, ou crie « Menteur ! ». Qui perd la manche perd un dé.</p>`);
let diceSel = { q: 1, f: 1 }, diceRoundSeen = -1;
function diceMinBid() { const b = duo.bid; if (!b) return { q: 1, f: 1 }; return b.f < 6 ? { q: b.q, f: b.f + 1 } : { q: b.q + 1, f: 1 }; }
function diceValid(q, f) { const b = duo.bid; return !b || q > b.q || (q === b.q && f > b.f); }
(function buildDice() {
  const faces = $g("dice-faces");
  for (let f = 1; f <= 6; f++) { const b = document.createElement("button"); b.type = "button"; b.className = "dice-face-btn"; b.dataset.f = f; b.textContent = DICE_FACES[f]; b.addEventListener("click", () => { diceSel.f = f; diceUpdate(); }); faces.appendChild(b); }
  $g("dice-q-minus").addEventListener("click", () => { diceSel.q = Math.max(1, diceSel.q - 1); diceUpdate(); });
  $g("dice-q-plus").addEventListener("click", () => { diceSel.q = Math.min(duo.myCount + duo.oppCount, diceSel.q + 1); diceUpdate(); });
  $g("btn-dice-bid").addEventListener("click", () => { if (diceValid(diceSel.q, diceSel.f)) { sendDuo({ type: "duoBid", q: diceSel.q, f: diceSel.f }); vibrate(10); } });
  $g("btn-dice-liar").addEventListener("click", () => { sendDuo({ type: "duoLiar" }); vibrate([20, 20, 40]); });
})();
function diceUpdate() {
  $g("dice-q").textContent = diceSel.q;
  $g("dice-faces").querySelectorAll(".dice-face-btn").forEach(b => b.classList.toggle("active", Number(b.dataset.f) === diceSel.f));
  const myTurn = duo.status === "playing" && duo.phase === "bidding" && duo.turn === myDuoNum;
  $g("btn-dice-bid").disabled = !myTurn || !diceValid(diceSel.q, diceSel.f);
}
function renderDuoDice() {
  duoShowScreen("screen-duo-dice");
  const myTurn = duo.status === "playing" && duo.phase === "bidding" && duo.turn === myDuoNum;
  const key = duo.round * 100 + (duo.bid ? duo.bid.q * 10 + duo.bid.f : 0);
  if (key !== diceRoundSeen) { diceRoundSeen = key; const m = diceMinBid(); diceSel = { q: Math.min(m.q, duo.myCount + duo.oppCount), f: m.f }; }
  $g("dice-opp-label").textContent = `${oppName()} (${duo.oppCount} dé${duo.oppCount > 1 ? "s" : ""})`;
  const rev = duo.phase === "reveal" && duo.reveal;
  const show = (el, dice, face) => { el.innerHTML = dice.map(d => `<span class="die${rev && d === face ? " hit" : ""}">${DICE_FACES[d]}</span>`).join(""); };
  show($g("dice-me"), duo.myDice, rev ? duo.reveal.bid.f : -1);
  if (rev) show($g("dice-opp"), duo.oppDice || duo.reveal.dice[myDuoNum === 1 ? 2 : 1], duo.reveal.bid.f);
  else $g("dice-opp").innerHTML = Array.from({ length: duo.oppCount }, () => `<span class="die hidden">?</span>`).join("");
  $g("dice-bid").textContent = duo.bid ? `${duo.bid.by === myDuoNum ? "Ton annonce" : "Annonce de " + oppName()} : ${duo.bid.q} × ${DICE_FACES[duo.bid.f]}` : "Aucune annonce — à toi ou à lui de commencer";
  $g("dice-controls").style.display = duo.status === "playing" && duo.phase === "bidding" ? "block" : "none";
  $g("btn-dice-liar").disabled = !myTurn || !duo.bid;
  if (rev) {
    const r = duo.reveal, iLost = r.loser === myDuoNum;
    g2Banner("duo-dice-banner", iLost ? "💔 Tu perds un dé" : "🎉 Tu gardes tes dés !", !iLost);
    $g("dice-info").textContent = `Il y avait ${r.total} × ${DICE_FACES[r.bid.f]} (annonce : ${r.bid.q}). ${r.caller === myDuoNum ? "Tu as crié « Menteur ! »" : oppName() + " a crié « Menteur ! »"}.`;
  } else {
    g2Banner("duo-dice-banner", duo.status === "ended" ? "Partie terminée" : myTurn ? "🎲 À toi d'annoncer ou de crier Menteur !" : `En attente de ${oppName()}...`, myTurn);
    $g("dice-info").textContent = `Manche ${duo.round}`;
  }
  diceUpdate();
}

// -------------------------------- PONG --------------------------------
g2DuoShell("pong", "🏓 Pong à 2", `<canvas id="pong-canvas" class="pong-canvas" width="300" height="420"></canvas>
  <p class="hint" style="font-size:12px;text-align:center">Glisse ton doigt pour bouger ta raquette (en bas). Premier à 5 points.</p>`);
let pongMyX = 0.5, pongSent = 0, pongPrevScore = "";
(function pongInput() {
  const cv = $g("pong-canvas"); cv.style.touchAction = "none";
  const move = (e) => {
    const r = cv.getBoundingClientRect(); pongMyX = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const now = Date.now();
    if (duo && duo.game === "pong" && now - pongSent > 25) { pongSent = now; sendDuo({ type: "duoPaddle", x: myDuoNum === 1 ? pongMyX : 1 - pongMyX }); }
  };
  cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); move(e); });
  cv.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "touch") move(e); });
})();
function renderDuoPong() {
  duoShowScreen("screen-duo-pong");
  const cv = $g("pong-canvas"), c = cv.getContext("2d"), W = cv.width, H = cv.height, flip = myDuoNum === 2;
  const vx = (x) => (flip ? 1 - x : x) * W, vy = (y) => (flip ? 1 - y : y) * H;
  c.fillStyle = "#0b1e2b"; c.fillRect(0, 0, W, H);
  c.strokeStyle = "rgba(255,255,255,.2)"; c.setLineDash([8, 8]); c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke(); c.setLineDash([]);
  const pw = duo.pw * W;
  const oppNum = myDuoNum === 1 ? 2 : 1;
  c.fillStyle = "#f87171"; c.fillRect(vx(duo.p[oppNum]) - pw, 8, pw * 2, 9);
  c.fillStyle = "#4ade80"; c.fillRect(pongMyX * W - pw, H - 17, pw * 2, 9);
  c.fillStyle = "#fff"; c.beginPath(); c.arc(vx(duo.bx), vy(duo.by), 7, 0, 7); c.fill();
  c.fillStyle = "rgba(255,255,255,.25)"; c.font = "bold 54px sans-serif"; c.textAlign = "center";
  c.fillText(duo.score[oppNum], W / 2, H / 2 - 28); c.fillText(duo.score[myDuoNum], W / 2, H / 2 + 62);
  if (duo.countdownMs > 0 && duo.status === "playing") { c.fillStyle = "#fff"; c.font = "bold 22px sans-serif"; c.fillText(duo.countdownMs > 1300 ? "Prêt ?" : "Go !", W / 2, H / 2 + 8); }
  const sc = duo.score[1] + "-" + duo.score[2];
  if (pongPrevScore && sc !== pongPrevScore) { vibrate(25); playTone(260, 0.15, "square", 0.1); }
  pongPrevScore = sc;
  g2Banner("duo-pong-banner", duo.status === "ended" ? "Partie terminée" : `Toi ${duo.score[myDuoNum]} — ${duo.score[oppNum]} ${oppName()}`, false);
}

// ----------------------------- DUEL DE MATHS -----------------------------
g2DuoShell("maths", "➗ Duel de maths", `
  <div class="mt-scores"><span id="mt-me">0</span><span class="mt-vs">Q <b id="mt-q">0</b>/10</span><span id="mt-opp">0</span></div>
  <div class="mt-bar"><div id="mt-bar-fill"></div></div>
  <div id="mt-question" class="mt-question">…</div>
  <div id="mt-answer-zone"><input type="number" inputmode="numeric" id="mt-input" class="cr-code-input" placeholder="Ta réponse"><button type="button" id="btn-mt-send" class="btn btn-primary">Valider</button></div>
  <p id="mt-info" class="hint" style="text-align:center;min-height:18px"></p>
  <p class="hint" style="font-size:11px;text-align:center">Le premier qui trouve le bon résultat marque. Une erreur te bloque pour la question.</p>`);
let mtEndAt = 0;
function mtSend() {
  const i = $g("mt-input"); if (!duo || duo.phase !== "question" || duo.locked || i.value === "") return;
  sendDuo({ type: "duoAnswer", n: Number(i.value) }); i.value = ""; vibrate(8);
}
$g("btn-mt-send").addEventListener("click", mtSend);
$g("mt-input").addEventListener("keydown", (e) => { if (e.key === "Enter") mtSend(); });
let mtLastQ = -1;
function renderDuoMaths() {
  duoShowScreen("screen-duo-maths");
  $g("mt-me").textContent = duo.scores[myDuoNum]; $g("mt-opp").textContent = duo.scores[myDuoNum === 1 ? 2 : 1]; $g("mt-q").textContent = duo.qn;
  $g("mt-question").textContent = duo.question ? duo.question + " = ?" : "Prêt ?";
  const q = duo.phase === "question";
  $g("mt-answer-zone").style.display = q ? "block" : "none";
  $g("btn-mt-send").disabled = !q || duo.locked; $g("mt-input").disabled = !q || duo.locked;
  if (q && duo.qn !== mtLastQ) { mtLastQ = duo.qn; $g("mt-input").value = ""; setTimeout(() => { try { $g("mt-input").focus(); } catch (e) { /* ignore */ } }, 50); }
  mtEndAt = q ? Date.now() + duo.timeLeftMs : 0;
  const lr = duo.lastResult;
  if (duo.phase === "result" && lr) $g("mt-info").textContent = lr.by === null ? `⌛ Personne… la réponse était ${lr.answer}` : lr.by === myDuoNum ? `✅ Bien joué ! (${lr.answer})` : `❌ ${oppName()} a été plus rapide (${lr.answer})`;
  else $g("mt-info").textContent = q && duo.locked ? "🔒 Raté ! Attends la prochaine question." : "";
  g2Banner("duo-maths-banner", duo.status === "ended" ? "Partie terminée" : q ? "➗ Vite, vite !" : "Prépare-toi...", q && !duo.locked);
}
G2_TICKS.push(() => { if (g2Active("screen-duo-maths")) { if (mtEndAt) g2Bar("mt-bar-fill", mtEndAt, 12000); else $g("mt-bar-fill").style.width = "0%"; } });

// ------------------------------ PENDU DUO ------------------------------
g2DuoShell("hangman", "🔤 Pendu duo", `
  <svg id="hg-svg" viewBox="0 0 120 130" class="hg-svg"><g stroke="var(--text-dim)" stroke-width="4" fill="none" stroke-linecap="round"><path d="M10 124H70M30 124V10H85V24"/></g>
   <g id="hg-parts" stroke="#f87171" stroke-width="4" fill="none" stroke-linecap="round">
    <circle cx="85" cy="34" r="10"/><path d="M85 44V80"/><path d="M85 52L70 66"/><path d="M85 52L100 66"/><path d="M85 80L72 102"/><path d="M85 80L98 102"/><path d="M80 31h.1M90 31h.1"/></g></svg>
  <div id="hg-word" class="hg-word"></div>
  <p id="hg-info" class="hint" style="text-align:center"></p>
  <div id="hg-set" style="display:none"><input type="text" id="hg-input" class="cr-code-input" maxlength="14" placeholder="Ton mot secret" autocomplete="off"><button type="button" id="btn-hg-set" class="btn btn-primary">Valider le mot</button></div>
  <div id="hg-keys" class="hg-keys"></div>`);
(function buildHang() {
  const k = $g("hg-keys");
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach(l => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = l; b.dataset.l = l;
    b.addEventListener("click", () => { if (duo && duo.phase === "guessing" && duo.turn === myDuoNum) { sendDuo({ type: "duoLetter", l }); vibrate(6); } });
    k.appendChild(b);
  });
  const send = () => { const w = $g("hg-input").value; if (w.replace(/[^A-Za-zÀ-ÿ]/g, "").length >= 3) { sendDuo({ type: "duoWord", word: w }); $g("hg-input").value = ""; } };
  $g("btn-hg-set").addEventListener("click", send);
  $g("hg-input").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
})();
function renderDuoHangman() {
  duoShowScreen("screen-duo-hangman");
  const iGuess = !duo.isSetter, ph = duo.phase;
  const parts = $g("hg-parts").children; for (let i = 0; i < parts.length; i++) parts[i].style.display = i < duo.errors ? "" : "none";
  $g("hg-set").style.display = ph === "setting" && duo.isSetter ? "block" : "none";
  const word = duo.word ? duo.word.split("") : null;
  $g("hg-word").textContent = (word || duo.mask || ["?", "?", "?"]).join(" ");
  $g("hg-keys").style.display = ph === "guessing" || ph === "roundEnd" ? "grid" : "none";
  $g("hg-keys").querySelectorAll("button").forEach(b => {
    const l = b.dataset.l, used = duo.guessed.includes(l), inWord = duo.mask ? duo.mask.includes(l) : false;
    b.disabled = used || ph !== "guessing" || !iGuess;
    b.className = used ? (inWord ? "ok" : "ko") : "";
  });
  const left = duo.max - duo.errors;
  let text, mine = false;
  if (duo.status === "ended") text = "Partie terminée";
  else if (ph === "setting") { text = duo.isSetter ? "✏️ Choisis un mot pour " + oppName() : `${oppName()} choisit un mot...`; mine = duo.isSetter; }
  else if (ph === "guessing") { text = iGuess ? `🔤 À toi de deviner ! (${left} erreur${left > 1 ? "s" : ""} possible${left > 1 ? "s" : ""})` : `${oppName()} devine ton mot...`; mine = iGuess; }
  else { const r = duo.results[duo.results.length - 1]; text = r.found ? `✅ Mot trouvé (${r.errors} erreur${r.errors > 1 ? "s" : ""})` : `💀 Pendu ! Le mot était ${r.word}`; }
  g2Banner("duo-hangman-banner", text, mine);
  $g("hg-info").textContent = `Manche ${duo.round}/2 · Le moins d'erreurs gagne`;
}

Object.assign(DUO_GAME_LABELS, { hex: "⬡ Hex", dice: "🎲 Dés menteurs", pong: "🏓 Pong à 2", maths: "➗ Duel de maths", hangman: "🔤 Pendu duo" });
Object.assign(DUO_NEW_RENDERERS, { hex: renderDuoHex, dice: renderDuoDice, pong: renderDuoPong, maths: renderDuoMaths, hangman: renderDuoHangman });

// =====================================================================
// ============================== MULTI ================================
// =====================================================================
let g2PEnd = 0;
G2_TICKS.push(() => { const s = g2PEnd ? Math.max(0, Math.ceil((g2PEnd - Date.now()) / 1000)) : ""; document.querySelectorAll(".g2-timer").forEach(el => { el.textContent = g2PEnd ? s + " s" : ""; }); });
function g2PartyShell(id, title, bodyHtml) {
  g2Inject(`<section id="screen-party-${id}" class="screen net-party"><div class="card">
    <h2 class="lobby-title" style="font-size:18px">${title}</h2>
    <div id="party-${id}-banner" class="bs-turn-banner">...</div>
    ${bodyHtml}
    <button type="button" class="btn btn-secondary party-quit-btn" style="margin-top:10px">Quitter</button>
  </div></section>`);
  g2BindQuit($g(`screen-party-${id}`));
}
function g2Scores(elId, totals, left) {
  const ul = $g(elId); if (!ul) return;
  ul.innerHTML = party.players.slice().sort((a, b) => (totals[b.id] || 0) - (totals[a.id] || 0)).map(p =>
    `<li><span>${escapeHtml(p.pseudo)}${p.id === party.myId ? " (toi)" : ""}${left && left.includes(p.id) ? " 🚪" : ""}</span><b>${totals[p.id] || 0}</b></li>`).join("");
}

// ----------------------------- DESSINE-MOI -----------------------------
g2PartyShell("draw", "🎨 Dessine-moi", `
  <p class="hint" style="text-align:center;margin:0 0 4px">Manche <span id="dr-round">1</span>/<span id="dr-rounds">1</span> · ⏱️ <span class="g2-timer"></span></p>
  <canvas id="dr-canvas" class="dr-canvas" width="300" height="300"></canvas>
  <div id="dr-tools" class="dr-tools" style="display:none">
    <div id="dr-colors"></div>
    <div id="dr-sizes"><button type="button" data-w="3">•</button><button type="button" data-w="7" class="active">●</button><button type="button" data-w="14">⬤</button></div>
    <button type="button" id="btn-dr-clear" class="btn btn-secondary" style="padding:6px 10px">🗑️</button>
  </div>
  <div id="dr-guess" style="display:none"><div class="dr-guess-row"><input type="text" id="dr-input" class="cr-code-input" placeholder="Ta proposition" maxlength="24" autocomplete="off"><button type="button" id="btn-dr-guess" class="btn btn-primary">OK</button></div></div>
  <ul id="dr-chat" class="dr-chat"></ul>
  <ul id="dr-scores" class="g2-scores"></ul>`);
let drawStrokesLocal = 0, drawRoundSeen = -1, drawColor = "#111827", drawW = 7, drawLastPt = null, drawPending = null, drawFlushT = 0;
function drCtx() { return $g("dr-canvas").getContext("2d"); }
function drClear() { const c = drCtx(); c.fillStyle = "#fff"; c.fillRect(0, 0, 300, 300); drawLastPt = null; }
function drSeg(st) {
  const c = drCtx(), k = 300 / 1000; c.strokeStyle = st.c; c.fillStyle = st.c; c.lineWidth = st.w; c.lineCap = "round"; c.lineJoin = "round";
  const pts = st.pts; if (!pts.length) return;
  if (pts.length === 1) { c.beginPath(); c.arc(pts[0][0] * k, pts[0][1] * k, st.w / 2, 0, 7); c.fill(); return; }
  c.beginPath(); c.moveTo(pts[0][0] * k, pts[0][1] * k); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0] * k, pts[i][1] * k); c.stroke();
}
function partyDrawMessage(msg) {
  if (!$g("dr-canvas")) return;
  if (msg.clear) { drClear(); return; }
  if (party && party.game && party.game.drawer === party.myId) return; // le dessinateur a déjà dessiné en local
  if (msg.stroke) drSeg(msg.stroke);
}
(function drawSetup() {
  const colors = ["#111827", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ffffff"];
  $g("dr-colors").innerHTML = colors.map((c, i) => `<button type="button" data-c="${c}" class="${i === 0 ? "active" : ""}" style="background:${c}"></button>`).join("");
  $g("dr-colors").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { drawColor = b.dataset.c; $g("dr-colors").querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b)); }));
  $g("dr-sizes").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { drawW = Number(b.dataset.w); $g("dr-sizes").querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b)); }));
  $g("btn-dr-clear").addEventListener("click", () => { drClear(); partyAct("clear"); });
  const cv = $g("dr-canvas"); cv.style.touchAction = "none";
  const pt = (e) => { const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / r.width * 1000), Math.round((e.clientY - r.top) / r.height * 1000)]; };
  const canDraw = () => party && party.game && party.game.game === "draw" && party.game.drawer === party.myId && party.game.phase === "drawing";
  const flush = () => {
    if (!drawPending || (drawPending.pts.length < 2 && !drawPending.n)) return;
    partyAct("draw", { pts: drawPending.pts, n: drawPending.n, c: drawColor, w: drawW });
    const last = drawPending.pts[drawPending.pts.length - 1]; drawPending = { n: false, pts: [last] }; drawPending.fresh = true;
  };
  cv.addEventListener("pointerdown", (e) => {
    if (!canDraw()) return; cv.setPointerCapture(e.pointerId);
    const p = pt(e); drawLastPt = p; drawPending = { n: true, pts: [p] }; drSeg({ c: drawColor, w: drawW, pts: [p] });
    clearInterval(drawFlushT); drawFlushT = setInterval(flush, 110);
  });
  cv.addEventListener("pointermove", (e) => {
    if (!drawLastPt || !canDraw()) return;
    const p = pt(e); drSeg({ c: drawColor, w: drawW, pts: [drawLastPt, p] }); drawLastPt = p;
    if (drawPending) { drawPending.pts.push(p); if (drawPending.pts.length >= 55) flush(); }
  });
  const up = () => { if (!drawLastPt) return; flush(); clearInterval(drawFlushT); drawLastPt = null; drawPending = null; };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  const guess = () => { const i = $g("dr-input"); if (i.value.trim()) { partyAct("guess", { text: i.value }); i.value = ""; } };
  $g("btn-dr-guess").addEventListener("click", guess);
  $g("dr-input").addEventListener("keydown", (e) => { if (e.key === "Enter") guess(); });
  drClear();
})();
function renderPartyDraw() {
  duoShowScreen("screen-party-draw");
  const g = party.game, me = party.myId, isDrawer = g.drawer === me, drawing = g.phase === "drawing" && party.status === "playing";
  if (g.round !== drawRoundSeen) { drawRoundSeen = g.round; drClear(); }
  g2PEnd = drawing ? Date.now() + g.timeLeftMs : 0;
  $g("dr-round").textContent = g.round; $g("dr-rounds").textContent = g.rounds;
  let t;
  if (!drawing) t = g.word ? `Le mot était : ${g.word}` : "Partie terminée";
  else if (isDrawer) t = `✏️ Dessine : ${g.word}`;
  else t = `🎨 ${partyName(g.drawer)} dessine : ${g.hint.split("").join(" ")}`;
  g2Banner("party-draw-banner", t, isDrawer && drawing);
  $g("dr-tools").style.display = isDrawer && drawing ? "flex" : "none";
  $g("dr-guess").style.display = !isDrawer && drawing && g.guessed[me] === undefined ? "block" : "none";
  $g("dr-chat").innerHTML = g.chat.map(m => m.ok ? `<li class="ok">✅ ${escapeHtml(partyName(m.id))} a trouvé !</li>` : `<li>${escapeHtml(partyName(m.id))} : ${escapeHtml(m.t)}</li>`).join("");
  g2Scores("dr-scores", g.totals, g.left);
}
PARTY_EXTRA_RENDERERS.draw = renderPartyDraw;

// ------------------------------- IMPOSTEUR -------------------------------
g2PartyShell("imp", "🕵️ Imposteur", `
  <div class="imp-word">Ton mot : <b id="imp-word">?</b></div>
  <p id="imp-info" class="hint" style="text-align:center;font-size:12px"></p>
  <p style="text-align:center;margin:2px 0"><span class="g2-timer"></span></p>
  <ul id="imp-list" class="vote-list"></ul>
  <div id="imp-clue-zone" style="display:none"><div class="dr-guess-row"><input type="text" id="imp-input" class="cr-code-input" maxlength="24" placeholder="Ton indice (1 mot)" autocomplete="off"><button type="button" id="btn-imp-clue" class="btn btn-primary">OK</button></div></div>`);
let impChosen = null, impPhaseSeen = "";
(function impSetup() {
  const send = () => { const i = $g("imp-input"); if (i.value.trim()) { partyAct("clue", { text: i.value }); i.value = ""; } };
  $g("btn-imp-clue").addEventListener("click", send);
  $g("imp-input").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
})();
function renderPartyImpostor() {
  duoShowScreen("screen-party-imp");
  const g = party.game, me = party.myId;
  if (g.phase !== impPhaseSeen) { impPhaseSeen = g.phase; impChosen = null; }
  $g("imp-word").textContent = g.myWord;
  g2PEnd = g.phase === "result" || party.status === "ended" ? 0 : Date.now() + g.timeLeftMs;
  const res = g.phase === "result";
  const list = $g("imp-list"); list.innerHTML = "";
  g.order.forEach(id => {
    const li = document.createElement("li"), btn = document.createElement("button"); btn.type = "button";
    const clue = g.clues[id], out = g.left.includes(id);
    const cnt = res && g.result ? (g.result.counts[id] || 0) : null;
    const tail = res ? `${cnt} vote${cnt > 1 ? "s" : ""}${id === g.imp ? " 🕵️" : ""}` : (g.phase === "clues" ? (clue ? "" : (g.current === id ? "✍️" : "…")) : (g.voted[id] ? "✔️" : ""));
    btn.innerHTML = `<span>${escapeHtml(partyName(id))}${id === me ? " (toi)" : ""}${out ? " 🚪" : ""} ${clue ? "— « " + escapeHtml(clue) + " »" : ""}</span><span>${tail}</span>`;
    if (impChosen === id) btn.classList.add("chosen");
    if (res && id === g.imp) btn.classList.add("top");
    btn.disabled = !(g.phase === "voting" && !res && id !== me && !out && impChosen === null && !g.voted[me]);
    btn.addEventListener("click", () => { impChosen = id; partyAct("vote", { to: id }); vibrate(10); renderPartyImpostor(); });
    li.appendChild(btn); list.appendChild(li);
  });
  $g("imp-clue-zone").style.display = g.phase === "clues" && g.current === me ? "block" : "none";
  let banner, info;
  if (g.phase === "clues") { banner = g.current === me ? "✍️ À toi : donne un indice !" : `✍️ ${partyName(g.current)} donne son indice...`; info = "Chacun donne un indice d'un mot sur son mot. Un joueur a un mot DIFFÉRENT : à toi de le démasquer sans te trahir !"; }
  else if (g.phase === "voting") { banner = impChosen !== null || g.voted[me] ? "Vote enregistré..." : "🗳️ Qui est l'imposteur ?"; info = "Vote pour le joueur que tu soupçonnes."; }
  else { banner = g.result && g.result.caught ? "🎉 Imposteur démasqué !" : "😈 L'imposteur s'en sort !"; info = g.endText || ""; }
  g2Banner("party-imp-banner", banner, g.phase === "clues" && g.current === me);
  $g("imp-info").textContent = info;
}
PARTY_EXTRA_RENDERERS.impostor = renderPartyImpostor;

// --------------------------- COURSE DE RÉFLEXES ---------------------------
g2PartyShell("reflex", "⚡ Course de réflexes", `
  <p class="hint" style="text-align:center;margin:0 0 6px">Manche <span id="rf-round">1</span>/<span id="rf-rounds">5</span></p>
  <button type="button" id="rf-pad" class="rf-pad rf-wait">Attends…</button>
  <ul id="rf-list" class="g2-scores"></ul>`);
let rfVibed = -1;
$g("rf-pad").addEventListener("pointerdown", (e) => { e.preventDefault(); if (party && party.game && party.game.game === "reflex" && party.status === "playing") { partyAct("tap"); vibrate(12); } });
function renderPartyReflex() {
  duoShowScreen("screen-party-reflex");
  const g = party.game, me = party.myId, pad = $g("rf-pad");
  $g("rf-round").textContent = g.round; $g("rf-rounds").textContent = g.rounds;
  const mine = g.phase === "result" && g.taps ? g.taps[me] : undefined, tapped = g.tapped[me];
  let cls = "rf-wait", txt = "Attends le vert…";
  if (g.phase === "go") { cls = "rf-go"; txt = tapped ? "⚡ Tapé !" : "TAPE !"; if (rfVibed !== g.round) { rfVibed = g.round; vibrate([30]); playTone(880, 0.1, "square", 0.12); } }
  else if (g.phase === "wait") { cls = tapped ? "rf-early" : "rf-wait"; txt = tapped ? "Trop tôt ! ❌" : "Attends le vert…"; }
  else { cls = "rf-result"; txt = party.status === "ended" ? "Terminé" : (typeof mine === "number" ? `⚡ ${mine} ms` : "❌ Raté"); }
  pad.className = "rf-pad " + cls; pad.textContent = txt;
  g2Banner("party-reflex-banner", g.phase === "go" ? "⚡ MAINTENANT !" : g.phase === "wait" ? "🔴 Ne tape pas avant le vert !" : "Résultats de la manche", g.phase === "go");
  const ul = $g("rf-list");
  ul.innerHTML = party.players.slice().sort((a, b) => (g.points[b.id] || 0) - (g.points[a.id] || 0)).map(p => {
    const v = g.taps ? g.taps[p.id] : undefined, rp = g.roundPts ? g.roundPts[p.id] : null;
    const detail = g.phase === "result" ? (typeof v === "number" ? `${v} ms (+${rp})` : (v === "early" ? "trop tôt ❌" : "raté ❌")) : (g.tapped[p.id] ? "✔️" : "");
    return `<li><span>${escapeHtml(p.pseudo)}${p.id === me ? " (toi)" : ""}${g.left.includes(p.id) ? " 🚪" : ""} <small>${detail}</small></span><b>${g.points[p.id] || 0}</b></li>`;
  }).join("");
}
PARTY_EXTRA_RENDERERS.reflex = renderPartyReflex;

// -------------------------------- QUI MENT ? --------------------------------
g2PartyShell("liar", "🤥 Qui ment ?", `
  <p class="hint" style="text-align:center;margin:0 0 4px">Tour <span id="lr-round">1</span>/<span id="lr-rounds">1</span> · <span class="g2-timer"></span></p>
  <div id="lr-claim" class="lr-claim"></div>
  <div id="lr-write" style="display:none">
    <textarea id="lr-input" class="lr-input" maxlength="90" placeholder="Une affirmation sur toi (ex : J'ai déjà dormi dans un arbre)"></textarea>
    <div class="lr-truth"><button type="button" data-t="1" class="active">✅ C'est vrai</button><button type="button" data-t="0">❌ C'est faux</button></div>
    <button type="button" id="btn-lr-send" class="btn btn-primary" style="margin-top:6px">Proposer</button>
  </div>
  <div id="lr-vote" class="lr-truth" style="display:none"><button type="button" data-v="1">✅ Vrai</button><button type="button" data-v="0">❌ Faux</button></div>
  <p id="lr-info" class="hint" style="text-align:center;font-size:12px"></p>
  <ul id="lr-scores" class="g2-scores"></ul>`);
let lrTruth = true, lrVoted = null, lrRoundSeen = -1;
$g("lr-write").querySelectorAll(".lr-truth button").forEach(b => b.addEventListener("click", () => { lrTruth = b.dataset.t === "1"; $g("lr-write").querySelectorAll(".lr-truth button").forEach(x => x.classList.toggle("active", x === b)); }));
$g("btn-lr-send").addEventListener("click", () => { const t = $g("lr-input").value.trim(); if (t.length >= 4) { partyAct("claim", { text: t, truth: lrTruth }); $g("lr-input").value = ""; } });
$g("lr-vote").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { lrVoted = b.dataset.v === "1"; partyAct("vote", { v: lrVoted }); vibrate(10); renderPartyLiar(); }));
function renderPartyLiar() {
  duoShowScreen("screen-party-liar");
  const g = party.game, me = party.myId, nar = g.narrator === me;
  if (g.round !== lrRoundSeen) { lrRoundSeen = g.round; lrVoted = null; lrTruth = true; $g("lr-write").querySelectorAll(".lr-truth button").forEach((x, i) => x.classList.toggle("active", i === 0)); }
  g2PEnd = (g.phase === "writing" || g.phase === "voting") && party.status === "playing" ? Date.now() + g.timeLeftMs : 0;
  $g("lr-round").textContent = g.round; $g("lr-rounds").textContent = g.rounds;
  $g("lr-claim").textContent = g.claim ? `« ${g.claim} »` : "";
  $g("lr-write").style.display = g.phase === "writing" && nar ? "block" : "none";
  const canVote = g.phase === "voting" && !nar && lrVoted === null && !g.voted[me];
  $g("lr-vote").style.display = g.phase === "voting" && !nar ? "flex" : "none";
  $g("lr-vote").querySelectorAll("button").forEach(b => { b.disabled = !canVote; b.classList.toggle("active", lrVoted !== null && (b.dataset.v === "1") === lrVoted); });
  let banner, info = "";
  if (g.phase === "writing") { banner = nar ? "✏️ À toi : écris une affirmation sur toi" : `✏️ ${partyName(g.narrator)} écrit une affirmation...`; info = nar ? "Choisis si elle est vraie ou fausse. Les autres devront deviner !" : "Prépare-toi à deviner si c'est vrai ou faux."; }
  else if (g.phase === "voting") { banner = nar ? "Les autres votent..." : "🤔 Vrai ou faux ?"; info = nar ? `Ton affirmation est ${"…"}` : `Selon toi, ${partyName(g.narrator)} dit-il la vérité ?`; if (nar) info = "Attends les votes. Plus tu en trompes, plus tu marques !"; }
  else {
    banner = g.claim ? (g.truth ? "✅ C'était VRAI" : "❌ C'était FAUX") : "⌛ Rien n'a été écrit";
    if (g.claim && g.votes) { const names = Object.keys(g.votes).map(id => `${partyName(Number(id))} ${g.votes[id] === g.truth ? "✅" : "❌"}`); info = `${names.join(" · ")} — ${g.gain.fooled} trompé(s)`; }
  }
  g2Banner("party-liar-banner", banner, nar && g.phase === "writing");
  $g("lr-info").textContent = info;
  g2Scores("lr-scores", g.totals, g.left);
}
PARTY_EXTRA_RENDERERS.liar = renderPartyLiar;

Object.assign(PARTY_GAME_LABELS, { draw: "Dessine-moi", impostor: "l'Imposteur", reflex: "la Course de réflexes", liar: "Qui ment ?" });

Object.assign(GAME_INFO, {"solo:lights": {"icon": "💡", "name": "Lights Out", "what": "Un casse-tête de lumières à éteindre.", "goal": "Éteindre toutes les lumières de la grille.", "how": "Touche une case : elle et ses 4 voisines (haut, bas, gauche, droite) changent d'état. Trouve la bonne suite de coups pour tout éteindre, avec le moins de coups possible."}, "solo:ice": {"icon": "🧊", "name": "Pierres glissantes", "what": "Un puzzle de glisse sur la glace.", "goal": "Atteindre l'étoile ⭐ sur 3 niveaux, avec le moins de coups possible.", "how": "Glisse (ou utilise les flèches) : le pingouin file tout droit jusqu'à heurter une pierre ou un bord. Il ne s'arrête qu'aux obstacles… sauf sur l'étoile qui l'arrête toujours. Chaque niveau est généré et toujours résoluble."}, "solo:dolphin": {"icon": "🐬", "name": "Course de dauphins", "what": "Un jeu de course infinie à un doigt.", "goal": "Nager le plus loin possible (400 m pour gagner).", "how": "Touche l'écran pour sauter par-dessus les rochers 🪨. Attention aux aigles 🦅 qui volent bas : ne saute pas quand l'un d'eux approche ! La vitesse augmente avec la distance."}, "solo:bubbles": {"icon": "🫧", "name": "Éclate-bulles", "what": "Un jeu de combos de bulles chronométré.", "goal": "Atteindre 1000 points en 60 secondes.", "how": "Touche un groupe de 2 bulles ou plus de même couleur (adjacentes) pour les faire éclater. Un groupe de n bulles rapporte n² points : vise les gros groupes ! Les bulles retombent et de nouvelles apparaissent."}, "duo:hex": {"icon": "⬡", "name": "Hex", "what": "Un jeu de stratégie à 2, sans match nul possible.", "goal": "Relier ses deux bords du plateau avec une chaîne de pions.", "how": "🔴 doit relier le haut et le bas, 🔵 la gauche et la droite. À tour de rôle, pose un pion sur une case libre. Bloque l'adversaire tout en construisant ton propre chemin."}, "duo:dice": {"icon": "🎲", "name": "Dés menteurs", "what": "Un jeu de bluff avec 5 dés cachés chacun.", "goal": "Faire perdre tous les dés de l'adversaire.", "how": "Chacun voit ses dés seulement. Annonce « il y a au moins N dés de valeur X » (dés des 2 joueurs additionnés). L'autre surenchérit (plus de dés ou une valeur plus haute) ou crie « Menteur ! ». On révèle : le perdant de la manche perd un dé."}, "duo:pong": {"icon": "🏓", "name": "Pong à 2", "what": "Le classique du ping-pong, en temps réel.", "goal": "Marquer 5 points avant l'adversaire.", "how": "Fais glisser ton doigt pour déplacer ta raquette en bas. Renvoie la balle : plus tu la touches vers le bord de la raquette, plus l'angle est fort. La balle accélère à chaque rebond."}, "duo:maths": {"icon": "➗", "name": "Duel de maths", "what": "Un duel de calcul mental.", "goal": "Marquer le plus de points sur 10 questions.", "how": "Une opération s'affiche pour les deux joueurs. Le premier qui tape le bon résultat marque le point. Une mauvaise réponse te bloque jusqu'à la question suivante."}, "duo:hangman": {"icon": "🔤", "name": "Pendu duo", "what": "Le pendu où chacun choisit le mot de l'autre.", "goal": "Deviner le mot avec le moins d'erreurs possible.", "how": "Manche 1 : le joueur 1 choisit un mot, le joueur 2 devine lettre par lettre (7 erreurs maximum). Manche 2 : on inverse. Celui qui fait le moins d'erreurs gagne."}, "party:draw": {"icon": "🎨", "name": "Dessine-moi", "what": "Un jeu de dessin et de devinettes (2 à 8).", "goal": "Faire deviner son dessin et deviner celui des autres.", "how": "Chaque joueur dessine à son tour (60 s) un mot secret. Les autres tapent leurs propositions : plus tu trouves vite, plus tu marques. Le dessinateur gagne aussi des points quand on le devine."}, "party:impostor": {"icon": "🕵️", "name": "Imposteur", "what": "Un jeu de déduction (3 à 8 joueurs).", "goal": "Démasquer l'imposteur… ou ne pas se faire repérer.", "how": "Tout le monde reçoit le même mot, sauf l'imposteur qui en a un proche. Chacun donne un indice d'un mot, puis tout le monde vote. Les civils gagnent s'ils désignent l'imposteur, sinon c'est lui qui gagne."}, "party:reflex": {"icon": "⚡", "name": "Course de réflexes", "what": "Un duel de rapidité (2 à 8).", "goal": "Totaliser le plus de points sur 5 manches.", "how": "L'écran est rouge : ne touche pas ! Dès qu'il passe au vert, tape le plus vite possible. Taper trop tôt ne rapporte rien. Le plus rapide de la manche marque le plus de points."}, "party:liar": {"icon": "🤥", "name": "Qui ment ?", "what": "Un jeu de bluff entre amis (2 à 8).", "goal": "Savoir deviner qui dit vrai… et tromper les autres.", "how": "À tour de rôle, un joueur écrit une affirmation sur lui et choisit en secret si elle est vraie ou fausse. Les autres votent vrai ou faux. Bonne réponse : +1 point. Tu trompes un joueur : +1 point pour toi."}});
