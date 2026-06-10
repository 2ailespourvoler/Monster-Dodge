import { useRef, useEffect, useState, useCallback } from "react";

/* ===========================================================================
   MONSTER DODGE — petit jeu d'arcade (vue du dessus)
   Conception : un garçon de 9 ans.  Réalisation : React + Canvas + Web Audio.
   --------------------------------------------------------------------------
   - Déplacer la voiture rouge à gauche / à droite, éviter les voitures.
   - Vitesse 60 -> 120 km/h. 3 accidents => perdu. Score = durée + casses.
   - BONUS BOUCLIER (cercle bleu) : protège ; son chrono de 8 s ne démarre
     qu'au PREMIER choc. Chaque voiture cassée au bouclier = +50 points.
   - BONUS BOXE (gant) : 10 coups. Flèche HAUT = le gant jaillit sur ressort.
     Il faut viser la bonne distance : trop tôt ou trop tard => raté.
     Chaque voiture cassée au gant = +100 points.
   - SONS : moteur, petit "tic" de déplacement, choc, casse, coup, défaite.
   =========================================================================== */

const W = 360, H = 560, SHOULDER = 30;
const ROAD_W = W - SHOULDER * 2, LANES = 4, LANE_W = ROAD_W / LANES;
const CAR_W = 50, CAR_H = 86, PLAYER_Y = H - 110, PLAYER_SPEED = 320;

const SPEEDS_KMH = [60, 80, 100, 120];
const DESCENT_PX = [170, 230, 290, 350];
const CARS_PER_BAND = [2, 2, 3, 3];
const BAND_GAP = [210, 185, 170, 150];
const SECONDS_PER_LEVEL = 26;     // chaque palier de vitesse dure 26 s (12 s de plus qu'avant)

const SHIELD_TIME = 8;             // durée du bouclier (déclenchée au 1er choc)
const BONUS_EVERY = [14, 20];      // un bonus apparaît toutes les 14-20 s
const PTS_SHIELD = 50, PTS_BOXE = 100;
const BOXE_PUNCHES = 10;
const PUNCH_DUR = 0.22;            // durée d'un coup de poing (s)
const PUNCH_REACH = 95;            // distance que le gant peut atteindre (px)

/* ---- DÉCORS : on traverse plusieurs "biomes" qui défilent et se fondent ---- */
const BIOMES = [
  { name: "Campagne", ground: "#3a8a4a", road: "#3b3f4a", dash: "#f2f2f2", edge: "#ffd23f", decor: "tree",     dark: 0 },
  { name: "Ville",    ground: "#6b7280", road: "#33363f", dash: "#f2f2f2", edge: "#e8e8e8", decor: "building", dark: 0 },
  { name: "Désert",   ground: "#d8b15a", road: "#4a4540", dash: "#fff7e0", edge: "#f2f2f2", decor: "cactus",   dark: 0 },
  { name: "Tunnel",   ground: "#2a2a33", road: "#303038", dash: "#ffd23f", edge: "#7a7a88", decor: "light",    dark: 0.30 },
  { name: "Nuit",     ground: "#16213e", road: "#1b1b2b", dash: "#6ef0ff", edge: "#ff5db1", decor: "star",     dark: 0.18 },
];
const BIOME_TIME = 24, BIOME_TRANS = 3.5;   // durée d'un biome (s) et fondu
const pickBiomeExcept = (cur) => { let i; do { i = (Math.random() * BIOMES.length) | 0; } while (i === cur); return i; };

const hex2rgb = (h) => { h = h.replace("#", ""); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const lerpColor = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`; };
const hash = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

/* ---- ÉCONOMIE : pièces (cassage de voitures), formes payantes, couleur gratuite ---- */
const COIN_SHIELD = 1, COIN_BOXE = 1;        // 1 pièce par voiture cassée (bouclier comme gant)
const SAVE_KEY = "monsterdodge_save_v1";
const DEFAULT_SAVE = { coins: 0, owned: ["berline"], equipped: "berline", color: "#e63946", best: 0, name: "" };
const SHAPES = [                              // SKINS = formes de voiture (s'achètent)
  { id: "berline",  name: "Berline",      price: 0 },
  { id: "sport",    name: "Sport",        price: 50 },
  { id: "police",   name: "Police",       price: 70 },
  { id: "tracteur", name: "Tracteur",     price: 90 },
  { id: "monster",  name: "Monster Truck", price: 130 },
  { id: "f1",       name: "F1",           price: 190 },
];
const COLORS = ["#e63946", "#3a86ff", "#2ec45f", "#ff7a33", "#9d4edd", "#ffcf3f", "#2b2d33", "#ff70a6"];
const PROTECTIONS = [
  { id: "shield", name: "Bouclier prêt",     price: 30 },
  { id: "boxe",   name: "Gant (10 coups)",   price: 35 },
  { id: "repair", name: "Réparation +1 vie", price: 50 },
];
function loadSave() { try { const r = JSON.parse(localStorage.getItem(SAVE_KEY)); if (r && typeof r.coins === "number") return { ...DEFAULT_SAVE, ...r }; } catch (e) {} return { ...DEFAULT_SAVE }; }
function writeSave(d) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch (e) {} }


const PALETTE = ["#4895ef", "#f9c74f", "#90be6d", "#f3722c",
                 "#9d4edd", "#43aa8b", "#ff70a6", "#ffd23f"];

const laneCenter = (l) => SHOULDER + l * LANE_W + LANE_W / 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (a) => a[(Math.random() * a.length) | 0];
const rand = (a, b) => a + Math.random() * (b - a);
const rr = (ctx, x, y, w, h, r) => {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
};

/* ---------------------------- SONS (synthétisés) ------------------------- */
function createAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  const master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
  const noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const eOsc = ctx.createOscillator(); eOsc.type = "sawtooth"; eOsc.frequency.value = 65;
  const eFilt = ctx.createBiquadFilter(); eFilt.type = "lowpass"; eFilt.frequency.value = 420;
  const eGain = ctx.createGain(); eGain.gain.value = 0;
  eOsc.connect(eFilt); eFilt.connect(eGain); eGain.connect(master); eOsc.start();

  const now = () => ctx.currentTime;
  const burst = (freq, q, vol, dur) => {
    const t = now();
    const src = ctx.createBufferSource(); src.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur);
  };
  const tone = (type, f0, f1, vol, dur, at = now()) => {
    const o = ctx.createOscillator(); o.type = type; const g = ctx.createGain();
    o.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(master); o.start(at); o.stop(at + dur + 0.02);
  };

  let sirenNode = null;
  const stopSiren = () => {
    if (!sirenNode) return;
    const t = now();
    try { sirenNode.g.gain.cancelScheduledValues(t); sirenNode.g.gain.setTargetAtTime(0.0001, t, 0.06); sirenNode.o.stop(t + 0.25); } catch (e) {}
    sirenNode = null;
  };
  const startSiren = () => {                                  // wail deux tons sur ~8,5 s
    stopSiren();
    const t = now(); const o = ctx.createOscillator(); o.type = "sawtooth";
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.10, t + 0.06);
    let tt = t; o.frequency.setValueAtTime(600, tt);
    for (let i = 0; i < 21; i++) { o.frequency.linearRampToValueAtTime(i % 2 ? 600 : 920, tt + 0.4); tt += 0.4; }  // ~8,4 s
    g.gain.setValueAtTime(0.10, tt - 0.15); g.gain.exponentialRampToValueAtTime(0.0001, tt);
    o.connect(g); g.connect(master); o.start(t); o.stop(tt + 0.05);
    sirenNode = { o, g };
  };

  return {
    ctx,
    resume() { if (ctx.state === "suspended") ctx.resume(); },
    engineOn(on) { eGain.gain.setTargetAtTime(on ? 0.06 : 0, now(), 0.08); },
    setEngine(level) { eOsc.frequency.setTargetAtTime(62 + level * 16, now(), 0.2); },
    move() { tone("square", 660, 1040, 0.10, 0.05); },        // petit tic gauche/droite
    crash() { burst(700, 0.6, 0.6, 0.28); tone("sine", 130, 40, 0.5, 0.25); },
    explosion() { burst(1300, 0.7, 0.5, 0.35); tone("square", 600, 70, 0.18, 0.3); },
    pickup() { tone("square", 520, 1040, 0.25, 0.16); },
    swing() { burst(1800, 0.4, 0.22, 0.12); },                // gant qui jaillit
    beep() { tone("square", 620, 620, 0.3, 0.16); },          // 3, 2, 1 : trois fois le MÊME son
    sirenStart() { startSiren(); },                           // sirène : son tenu pendant les 8 s
    sirenStop() { stopSiren(); },
    go() {                                                     // GO : un son tenu, continu
      const t = now(), dur = 0.85;
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = 880;
      const o2 = ctx.createOscillator(); o2.type = "square"; o2.frequency.value = 587;
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.0001, t);
      gg.gain.exponentialRampToValueAtTime(0.18, t + 0.03);    // attaque (volume réduit)
      gg.gain.setValueAtTime(0.18, t + dur - 0.14);            // tenue
      gg.gain.exponentialRampToValueAtTime(0.0001, t + dur);   // relâche
      o.connect(gg); o2.connect(gg); gg.connect(master);
      o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
    },
    punchHit() { burst(500, 0.6, 0.45, 0.16); tone("square", 200, 55, 0.4, 0.2); },
    defeat() { const t = now(); [440, 370, 294, 196].forEach((f, i) => tone("triangle", f, f, 0.3, 0.2, t + i * 0.18)); },
  };
}

/* ------------------------------- DESSIN ---------------------------------- */
function drawDecorItem(ctx, type, cx, baseY, h) {
  if (type === "tree") {
    ctx.fillStyle = "#6b4423"; ctx.fillRect(cx - 2, baseY - 10, 4, 12);
    ctx.fillStyle = h > 0.5 ? "#2f7d3a" : "#3a9a4a";
    ctx.beginPath(); ctx.arc(cx, baseY - 16, 9 + h * 3, 0, 7); ctx.fill();
  } else if (type === "building") {
    const bw = 18 + h * 9, bh = 45 + h * 70, x = cx - bw / 2, top = baseY - bh;
    ctx.fillStyle = ["#8a93a3", "#74809a", "#9aa3b3"][(h * 3) | 0]; ctx.fillRect(x, top, bw, bh);
    ctx.fillStyle = "rgba(255,228,150,.85)";
    for (let wy = top + 6; wy < baseY - 6; wy += 11)
      for (let wx = x + 4; wx < x + bw - 4; wx += 8) ctx.fillRect(wx, wy, 4, 6);
  } else if (type === "cactus") {
    ctx.fillStyle = "#3a9a4a";
    ctx.fillRect(cx - 3, baseY - 24, 6, 26);
    if (h > 0.4) { ctx.fillRect(cx - 9, baseY - 14, 6, 4); ctx.fillRect(cx - 9, baseY - 18, 4, 6); }
    if (h < 0.6) { ctx.fillRect(cx + 3, baseY - 20, 6, 4); ctx.fillRect(cx + 5, baseY - 24, 4, 6); }
  } else if (type === "light") {
    const g = ctx.createRadialGradient(cx, baseY - 10, 1, cx, baseY - 10, 12);
    g.addColorStop(0, "rgba(255,225,140,.95)"); g.addColorStop(1, "rgba(255,200,80,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, baseY - 10, 12, 0, 7); ctx.fill();
    ctx.fillStyle = "#ffe08a"; ctx.beginPath(); ctx.arc(cx, baseY - 10, 3, 0, 7); ctx.fill();
  } else if (type === "star") {
    ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.6 * h})`;
    ctx.fillRect(cx - 6, baseY - 34, 2, 2); ctx.fillRect(cx + 5, baseY - 14, 2, 2);
    ctx.fillRect(cx + (h > 0.5 ? 2 : -3), baseY - 50, 1.5, 1.5);
  }
}

function drawDecor(ctx, type, dist, alpha) {
  const GAP = 90, slots = Math.ceil(H / GAP) + 2, period = slots * GAP;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < slots; i++) {
    const y = (i * GAP + dist) % period;
    const rowId = Math.floor((i * GAP + dist) / period) * slots + i;
    drawDecorItem(ctx, type, SHOULDER / 2, y, hash(rowId * 2));
    drawDecorItem(ctx, type, W - SHOULDER / 2, y, hash(rowId * 2 + 1));
  }
  ctx.globalAlpha = 1;
}

/* --- FORMES de véhicule, dessinées centrées en (0,0), avant vers le HAUT --- */
const SHAPE_DRAW = {
  berline(ctx, color) {
    ctx.fillStyle = color; rr(ctx, -25, -43, 50, 86, 12); ctx.fill();
    ctx.fillStyle = "#1c1c22";
    ctx.fillRect(-28, -31, 5, 18); ctx.fillRect(-28, 13, 5, 18); ctx.fillRect(23, -31, 5, 18); ctx.fillRect(23, 13, 5, 18);
    ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.fillRect(-16, -31, 32, 18);
    ctx.fillStyle = "rgba(255,255,255,.3)"; ctx.fillRect(-16, 14, 32, 16);
    ctx.fillStyle = "#fff7cc"; ctx.beginPath(); ctx.arc(-12, -40, 3, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(12, -40, 3, 0, 7); ctx.fill();
  },
  sport(ctx, color) {
    ctx.fillStyle = "#1c1c22";
    ctx.fillRect(-24, -22, 5, 15); ctx.fillRect(-24, 12, 5, 16); ctx.fillRect(19, -22, 5, 15); ctx.fillRect(19, 12, 5, 16);
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(0, -44); ctx.lineTo(19, -18); ctx.lineTo(21, 30); ctx.lineTo(13, 42); ctx.lineTo(-13, 42); ctx.lineTo(-21, 30); ctx.lineTo(-19, -18); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.55)"; rr(ctx, -12, -14, 24, 20, 7); ctx.fill();
    ctx.fillStyle = "#1c1c22"; ctx.fillRect(-20, 38, 40, 5);                 // aileron
    ctx.fillStyle = "#fff7cc"; ctx.beginPath(); ctx.arc(-8, -38, 2.5, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(8, -38, 2.5, 0, 7); ctx.fill();
  },
  police(ctx, color) {
    SHAPE_DRAW.berline(ctx, color);
    ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(-25, -3, 50, 9);   // bande blanche
    ctx.fillStyle = "#e11d2a"; ctx.fillRect(-11, -5, 11, 7);                 // gyrophare rouge
    ctx.fillStyle = "#1763ff"; ctx.fillRect(0, -5, 11, 7);                   // gyrophare bleu
  },
  tracteur(ctx, color) {
    ctx.fillStyle = "#15151a";
    rr(ctx, -27, 6, 13, 32, 5); ctx.fill(); rr(ctx, 14, 6, 13, 32, 5); ctx.fill();   // grosses roues arrière
    rr(ctx, -22, -34, 8, 16, 3); ctx.fill(); rr(ctx, 14, -34, 8, 16, 3); ctx.fill(); // petites roues avant
    ctx.fillStyle = color; rr(ctx, -16, -36, 32, 72, 8); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.85)"; rr(ctx, -12, -30, 24, 10, 3); ctx.fill(); // calandre
    ctx.fillStyle = "rgba(255,255,255,.5)"; rr(ctx, -13, 4, 26, 22, 5); ctx.fill();    // cabine
    ctx.fillStyle = "#444"; ctx.fillRect(-3, -42, 6, 9);                                // pot d'échappement
  },
  monster(ctx, color) {
    ctx.fillStyle = "#15151a";
    const wheel = (x, y) => { rr(ctx, x - 9, y - 15, 18, 30, 6); ctx.fill(); ctx.fillStyle = "#39394a"; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); ctx.fillStyle = "#15151a"; };
    wheel(-22, -25); wheel(22, -25); wheel(-22, 25); wheel(22, 25);
    ctx.fillStyle = color; rr(ctx, -18, -40, 36, 80, 10); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.55)"; rr(ctx, -12, -32, 24, 17, 5); ctx.fill();   // cabine
    ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-12, 4); ctx.lineTo(12, 4); ctx.moveTo(-12, 18); ctx.lineTo(12, 18); ctx.moveTo(-12, 32); ctx.lineTo(12, 32); ctx.stroke();  // benne
    ctx.fillStyle = "#fff7cc"; ctx.beginPath(); ctx.arc(-9, -38, 2.5, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(9, -38, 2.5, 0, 7); ctx.fill();
  },
  f1(ctx, color) {
    ctx.fillStyle = "#1c1c22";
    rr(ctx, -21, -30, 9, 17, 3); ctx.fill(); rr(ctx, 12, -30, 9, 17, 3); ctx.fill();   // roues avant
    rr(ctx, -22, 14, 10, 18, 3); ctx.fill(); rr(ctx, 12, 14, 10, 18, 3); ctx.fill();   // roues arrière
    ctx.fillStyle = color; rr(ctx, -23, -44, 46, 7, 2); ctx.fill();                    // aileron avant
    rr(ctx, -20, 36, 40, 8, 2); ctx.fill();                                            // aileron arrière
    ctx.beginPath();
    ctx.moveTo(0, -41); ctx.lineTo(8, -18); ctx.lineTo(9, 32); ctx.lineTo(-9, 32); ctx.lineTo(-8, -18); ctx.closePath(); ctx.fill();  // coque
    ctx.fillStyle = "rgba(0,0,0,.55)"; rr(ctx, -5, -8, 10, 14, 4); ctx.fill();          // cockpit
  },
};
function drawVehicle(ctx, cx, cy, color, dir, shape) {
  ctx.save(); ctx.translate(cx, cy); if (dir > 0) ctx.rotate(Math.PI);
  (SHAPE_DRAW[shape] || SHAPE_DRAW.berline)(ctx, color);
  ctx.restore();
}

function drawGlove(ctx, cx, cy, scale, color) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(scale, scale);
  ctx.fillStyle = "#eef2ff"; rr(ctx, -11, 9, 22, 11, 4); ctx.fill();      // poignet
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(-12, 2, 6, 0, 7); ctx.fill(); // pouce
  rr(ctx, -13, -12, 26, 22, 11); ctx.fill();                              // poing
  ctx.fillStyle = "rgba(255,255,255,.3)"; ctx.beginPath(); ctx.arc(-4, -5, 5, 0, 7); ctx.fill();
  ctx.restore();
}

function drawSirenIcon(ctx, cx, cy, sc) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc);
  // petits traits rayonnants (bleu/rouge alternés)
  ctx.lineCap = "round"; ctx.lineWidth = 2;
  const rays = [[-17, -4], [-13, -13], [-5, -18], [5, -18], [13, -13], [17, -4]];
  rays.forEach((p, i) => {
    ctx.strokeStyle = i % 2 ? "#e11d2a" : "#1e6bff";
    const a = Math.atan2(p[1], p[0]);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + Math.cos(a) * 5, p[1] + Math.sin(a) * 5); ctx.stroke();
  });
  // dôme : moitié gauche bleue, moitié droite rouge
  const by = 4, R = 11;
  ctx.save(); ctx.beginPath(); ctx.rect(-R - 1, by - R - 1, R + 1, R * 2 + 2); ctx.clip();
  ctx.beginPath(); ctx.arc(0, by, R, Math.PI, 0, true); ctx.closePath(); ctx.fillStyle = "#1e6bff"; ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(0, by - R - 1, R + 1, R * 2 + 2); ctx.clip();
  ctx.beginPath(); ctx.arc(0, by, R, Math.PI, 0, true); ctx.closePath(); ctx.fillStyle = "#e11d2a"; ctx.fill(); ctx.restore();
  // socle noir
  ctx.fillStyle = "#15151a"; rr(ctx, -12, by + 1, 24, 6, 2); ctx.fill();
  ctx.restore();
}

function drawBonus(ctx, b, t) {
  const r = 17 * (1 + 0.08 * Math.sin(t / 120));
  const styles = {
    shield:  { glow: "rgba(120,200,255,.9)",  glow0: "rgba(70,140,255,0)", disc: "#2f86ff", ring: "#dff0ff" },
    retreci: { glow: "rgba(150,240,160,.95)", glow0: "rgba(60,180,90,0)",  disc: "#2ec45f", ring: "#e3ffe9" },
    boxe:    { glow: "rgba(255,180,120,.95)", glow0: "rgba(230,90,40,0)",  disc: "#ff7a33", ring: "#ffe3cf" },
    sirene:  { glow: "rgba(255,200,200,.95)", glow0: "rgba(225,30,30,0)",  disc: "#ffffff", ring: "#e11d2a" },
  };
  const st = styles[b.type];
  const grad = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, r + 8);
  grad.addColorStop(0, st.glow); grad.addColorStop(1, st.glow0);
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(b.x, b.y, r + 8, 0, 7); ctx.fill();
  ctx.fillStyle = st.disc; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 7); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = st.ring; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 7); ctx.stroke();
  if (b.type === "boxe") {
    drawGlove(ctx, b.x, b.y, 0.92, "#ffffff");
  } else if (b.type === "sirene") {
    drawSirenIcon(ctx, b.x, b.y, 0.74);
  } else {
    ctx.fillStyle = "#fff"; ctx.font = "bold 18px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(b.type === "shield" ? "B" : "R", b.x, b.y + 1);
  }
}

function SirenBtnIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 6 A11 11 0 0 0 16 27 Z" fill="#1e6bff" />
      <path d="M16 6 A11 11 0 0 1 16 27 Z" fill="#e11d2a" />
      <rect x="6" y="25" width="20" height="5" rx="2" fill="#111" />
    </svg>
  );
}

function ShapePreview({ shape, color, size = 42 }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const Wp = size, Hp = Math.round(size * 1.35);
    c.width = Wp * dpr; c.height = Hp * dpr;
    const x = c.getContext("2d"); x.scale(dpr, dpr); x.clearRect(0, 0, Wp, Hp);
    const sc = Math.min(Wp / 60, Hp / 100);
    x.save(); x.translate(Wp / 2, Hp / 2); x.scale(sc, sc);
    drawVehicle(x, 0, 0, color, -1, shape); x.restore();
  }, [shape, color, size]);
  return <canvas ref={ref} style={{ width: size, height: Math.round(size * 1.35), display: "block" }} />;
}

function CarIcon({ alive }) {
  const c = alive ? "#e63946" : "#5c5c66";
  return (
    <svg width="26" height="32" viewBox="0 0 26 32" aria-hidden="true">
      <rect x="3" y="2" width="20" height="28" rx="6" fill={c} />
      <rect x="6" y="6" width="14" height="7" rx="2" fill="rgba(255,255,255,.6)" />
      <rect x="6" y="20" width="14" height="6" rx="2" fill="rgba(255,255,255,.3)" />
      {!alive && <path d="M6 8 L20 24 M20 8 L6 24" stroke="#ffd23f" strokeWidth="2.5" />}
    </svg>
  );
}
function GloveBtnIcon({ color = "#fff" }) {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><g fill={color}>
      <rect x="9" y="22" width="14" height="7" rx="3" /><rect x="7" y="6" width="18" height="18" rx="9" />
      <circle cx="7" cy="16" r="5" /></g></svg>
  );
}

export default function App() {
  const canvasRef = useRef(null);
  const g = useRef(null);
  const audioRef = useRef(null);
  const statusRef = useRef("menu");
  const [status, setStatus] = useState("menu");
  const [hud, setHud] = useState({ time: "00:00", speed: 60, lives: 3, score: 0, shield: 0, punches: 0, shrink: 0, siren: 0, coins: 0 });
  const [save, setSave] = useState(() => loadSave());
  const [nameInput, setNameInput] = useState(() => loadSave().name || "");
  const nameInputRef = useRef(nameInput); nameInputRef.current = nameInput;
  const saveRef = useRef(save); saveRef.current = save;     // miroir toujours à jour pour la boucle
  const walletRef = useRef(0);                              // pièces de la partie en cours
  const equippedRef = useRef(save.equipped);                // forme de voiture équipée
  const colorRef = useRef(save.color);                      // couleur équipée (gratuite)
  const activeNameRef = useRef("");                         // nom du joueur en cours (solo ou duel)
  const [tour, setTour] = useState(null);                   // tournoi en cours (solo ou duel)
  const [lastScore, setLastScore] = useState(0);            // score de la dernière partie terminée
  const [duelNames, setDuelNames] = useState(["", ""]);     // saisie des 2 noms (duel)
  const [duelGames, setDuelGames] = useState(5);            // nb de manches par joueur
  const wrapRef = useRef(null);                             // conteneur pour le plein écran
  const dispRef = useRef({ w: W, h: H, dpr: 1 });           // taille affichée de la scène (pour la netteté)
  const [isFs, setIsFs] = useState(false);                  // en plein écran ?
  const [vp, setVp] = useState(() => ({                     // taille de la fenêtre (pour agrandir le jeu)
    w: typeof window !== "undefined" ? window.innerWidth : 400,
    h: typeof window !== "undefined" ? window.innerHeight : 800,
  }));

  const setMode = useCallback((v) => { statusRef.current = v; setStatus(v); }, []);
  const commitSave = useCallback((updater) => { setSave((prev) => { const next = updater(prev); writeSave(next); return next; }); }, []);

  const triggerPunch = useCallback(() => {
    const s = g.current;
    if (!s || statusRef.current !== "playing") return;
    if (s.punches <= 0 || s.punch) return;       // pas de gant, ou coup déjà en cours
    s.punch = { prog: 0, connected: false };
    s.punches -= 1;
    audioRef.current?.swing();
  }, []);

  const triggerSiren = useCallback(() => {
    const s = g.current;
    if (!s || statusRef.current !== "playing") return;
    if (!s.sirenReady || s.siren > 0) return;    // pas de sirène, ou déjà active
    s.siren = 8; s.sirenReady = false;           // ouvre la voie pendant 8 s
    s.sirenLane = clamp(Math.round((s.playerX - SHOULDER - LANE_W / 2) / LANE_W), 0, LANES - 1);  // la voie occupée à l'activation
    audioRef.current?.sirenStart();
  }, []);

  const launchGame = useCallback(() => {           // prépare une partie et lance le décompte
    if (!audioRef.current) audioRef.current = createAudio();
    audioRef.current?.resume();
    walletRef.current = saveRef.current.coins;       // on démarre avec son argent en banque
    equippedRef.current = saveRef.current.equipped;
    colorRef.current = saveRef.current.color;
    const b0 = (Math.random() * BIOMES.length) | 0;  // biome de départ aléatoire
    g.current = {
      playerX: laneCenter(1), lives: 3, invuln: 0,
      cars: [], bonuses: [], particles: [], popups: [],
      gapLane: 1, distSinceBand: BAND_GAP[0], bonusTimer: 6,
      garage: null, garageTimer: 30,
      shield: 0, shieldArmed: false, punches: 0, punch: null, shrink: 0, siren: 0, sirenReady: false, sirenLane: 0,
      scroll: 0, elapsed: 0, score: 0, level: 0,
      worldDist: 0, biomePeriod: 0, biomeIdx: b0, biomeNext: pickBiomeExcept(b0), biomeFlash: 0,
      bg: { ground: BIOMES[b0].ground, road: BIOMES[b0].road, dash: BIOMES[b0].dash, edge: BIOMES[b0].edge, dark: BIOMES[b0].dark, decorA: BIOMES[b0].decor, decorB: BIOMES[b0].decor, blend: 0, name: BIOMES[b0].name },
      cdN: 3, cdT: 0,                                // compte à rebours 3-2-1-GO
      keys: { left: false, right: false, up: false, down: false }, hudT: 0,
    };
    setHud({ time: "00:00", speed: SPEEDS_KMH[0], lives: 3, score: 0, shield: 0, punches: 0, shrink: 0, siren: 0, coins: walletRef.current });
    audioRef.current?.beep();
    setMode("countdown");
  }, [setMode]);

  const startSolo = useCallback(() => {            // lance une partie solo
    const nm = (nameInputRef.current || "").trim().slice(0, 14);
    if (!nm) return;
    if (nm !== saveRef.current.name) commitSave((p) => ({ ...p, name: nm }));
    setTour({ mode: "solo" });
    activeNameRef.current = nm;
    launchGame();
  }, [launchGame, commitSave]);

  const beginDuel = useCallback(() => {            // crée le duel et passe au 1er tour
    const a = (duelNames[0] || "").trim().slice(0, 14), b = (duelNames[1] || "").trim().slice(0, 14);
    if (!a || !b) return;
    setTour({ mode: "duel", gamesPer: duelGames, names: [a, b], scores: [[], []], turn: 0 });
    setMode("turnIntro");
  }, [duelNames, duelGames, setMode]);

  const startTurn = useCallback(() => {            // lance la partie du joueur dont c'est le tour
    const t = tour; if (!t) return;
    activeNameRef.current = t.names ? t.names[t.turn] : "";
    launchGame();
  }, [tour, launchGame]);

  const afterDuelGame = useCallback(() => {        // enregistre le score et décide de la suite
    setTour((t) => {
      if (!t || t.mode !== "duel") return t;
      const scores = [t.scores[0].slice(), t.scores[1].slice()];
      scores[t.turn].push(lastScore);
      const finished = scores[0].length >= t.gamesPer && scores[1].length >= t.gamesPer;
      if (t.turn === 0) { setMode("turnIntro"); return { ...t, scores, turn: 1 }; }     // au tour du joueur 2
      setMode(finished ? "duelEnd" : "standings");                                      // manche complète
      return { ...t, scores, turn: 0 };
    });
  }, [lastScore, setMode]);

  const resumeRun = useCallback(() => {                // sortie du garage : on reprend la route
    walletRef.current = saveRef.current.coins;
    if (g.current) g.current.invuln = 1.5;
    setMode("playing");
  }, [setMode]);

  // achats au garage
  const buyShape = (id) => {
    const sh = SHAPES.find((x) => x.id === id), cur = saveRef.current; if (!sh) return;
    if (cur.owned.includes(id) || cur.coins < sh.price) return;
    equippedRef.current = id;
    commitSave((p) => ({ ...p, coins: p.coins - sh.price, owned: [...p.owned, id], equipped: id }));
  };
  const equipShape = (id) => {
    if (!saveRef.current.owned.includes(id)) return;
    equippedRef.current = id;
    commitSave((p) => ({ ...p, equipped: id }));
  };
  const chooseColor = (hex) => {                 // la couleur est GRATUITE
    colorRef.current = hex;
    commitSave((p) => ({ ...p, color: hex }));
  };
  const buyProtection = (id) => {
    const pr = PROTECTIONS.find((x) => x.id === id), cur = saveRef.current, s = g.current;
    if (!pr || !s || cur.coins < pr.price) return;
    if (id === "repair") { if (s.lives >= 3) return; s.lives = Math.min(3, s.lives + 1); }
    else if (id === "shield") { s.shieldArmed = true; s.shield = 0; }
    else if (id === "boxe") s.punches += BOXE_PUNCHES;
    audioRef.current?.pickup();
    commitSave((p) => ({ ...p, coins: p.coins - pr.price }));
  };

  useEffect(() => {
    const down = (e) => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;  // on tape son nom : ne pas intercepter
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) e.preventDefault();
      const s = g.current; if (!s) return;
      const playing = statusRef.current === "playing";
      if (e.key === "ArrowLeft" || e.key === "a") { if (!s.keys.left && playing) audioRef.current?.move(); s.keys.left = true; }
      if (e.key === "ArrowRight" || e.key === "d") { if (!s.keys.right && playing) audioRef.current?.move(); s.keys.right = true; }
      if (e.key === "ArrowUp" || e.key === "w") { if (!s.keys.up) { s.keys.up = true; triggerPunch(); } }
      if (e.key === "ArrowDown" || e.key === "s") { if (!s.keys.down) { s.keys.down = true; triggerSiren(); } }
    };
    const up = (e) => {
      const s = g.current; if (!s) return;
      if (e.key === "ArrowLeft" || e.key === "a") s.keys.left = false;
      if (e.key === "ArrowRight" || e.key === "d") s.keys.right = false;
      if (e.key === "ArrowUp" || e.key === "w") s.keys.up = false;
      if (e.key === "ArrowDown" || e.key === "s") s.keys.down = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [triggerPunch, triggerSiren]);

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    const onFs = () => setIsFs(!!(document.fullscreenElement || document.webkitFullscreenElement));
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current; if (!el) return;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fsEl) { (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el); }
    else { (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document); }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    canvas.width = W; canvas.height = H;        // résolution ajustée à la taille affichée dans la boucle

    let raf, last = performance.now(), running = true;
    let prevPlaying = false, prevLevel = -1;

    // une voie est "bloquée" si un bonus ou le garage y est près du haut (éviterait de couvrir un bonus)
    const itemNearTop = (s, cx) =>
      s.bonuses.some((b) => Math.abs(b.x - cx) < 8 && b.y < 150) ||
      (s.garage && Math.abs(s.garage.x - cx) < 8 && s.garage.y < 150);
    const carNearTop = (s, cx) => s.cars.some((c) => Math.abs(c.x - cx) < 8 && c.y < 150);

    const spawnBand = (s) => {
      const cands = [0, 1, 2, 3].filter((l) => l !== s.gapLane && !itemNearTop(s, laneCenter(l)) && !(s.siren > 0 && l === s.sirenLane));
      for (let i = cands.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [cands[i], cands[j]] = [cands[j], cands[i]]; }
      for (const lane of cands.slice(0, CARS_PER_BAND[s.level])) {
        const black = Math.random() < 1 / 12;        // ~1 voiture sur 12 est noire
        s.cars.push({ x: laneCenter(lane), y: -CAR_H, color: black ? "#17171c" : pick(PALETTE), black });
      }
      s.gapLane = clamp(s.gapLane + pick([-1, 0, 1]), 0, LANES - 1);
    };
    const explode = (s, x, y, color) => {
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * 7, sp = rand(60, 220);
        s.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.3, 0.6), max: 0.6, size: rand(3, 7), color });
      }
    };
    const addPts = (s, x, y, pts, coins) => {
      s.score += pts;
      walletRef.current += coins;
      s.popups.push({ x, y, text: "+" + coins, life: 0.8, color: "#ffd23f" });
    };

    const loop = (t) => {
      if (!running) return;
      const dt = Math.min((t - last) / 1000, 0.05); last = t;
      const s = g.current;
      const playing = s && statusRef.current === "playing";
      const a = audioRef.current;

      if (a) {
        if (playing && !prevPlaying) { a.engineOn(true); a.setEngine(s.level); prevLevel = s.level; }
        if (!playing && prevPlaying) a.engineOn(false);
        if (playing && s.level !== prevLevel) { a.setEngine(s.level); prevLevel = s.level; }
      }
      prevPlaying = playing;

      // COMPTE À REBOURS avant le départ
      if (s && statusRef.current === "countdown") {
        s.cdT += dt;
        if (s.cdN > 0 && s.cdT >= 0.7) { s.cdT = 0; s.cdN -= 1; if (s.cdN >= 1) a?.beep(); else a?.go(); }
        else if (s.cdN === 0 && s.cdT >= 0.7) { s.cdT = 0; s.elapsed = 0; setMode("playing"); }
      }

      if (playing) {
        s.elapsed += dt;
        s.level = Math.min(3, Math.floor(s.elapsed / SECONDS_PER_LEVEL));
        const descent = DESCENT_PX[s.level];
        s.score += dt * (SPEEDS_KMH[s.level] / 60) * 10;
        s.scroll = (s.scroll + descent * 0.6 * dt) % 40;
        s.worldDist += descent * dt;

        // biome ALÉATOIRE (jamais deux fois le même de suite), avec fondu vers le suivant
        const period = Math.floor(s.elapsed / BIOME_TIME);
        if (period !== s.biomePeriod) {
          s.biomePeriod = period;
          s.biomeIdx = s.biomeNext;                  // ce qu'on voyait en fondu devient le décor courant
          s.biomeNext = pickBiomeExcept(s.biomeIdx); // on tire le prochain, différent
          s.biomeFlash = 2.4;                        // annonce du nouveau décor
        }
        if (s.biomeFlash > 0) s.biomeFlash = Math.max(0, s.biomeFlash - dt);
        const into = s.elapsed - period * BIOME_TIME;
        const blend = into > BIOME_TIME - BIOME_TRANS ? (into - (BIOME_TIME - BIOME_TRANS)) / BIOME_TRANS : 0;
        const BA = BIOMES[s.biomeIdx], BB = BIOMES[s.biomeNext];
        s.bg = {
          ground: lerpColor(BA.ground, BB.ground, blend), road: lerpColor(BA.road, BB.road, blend),
          dash: lerpColor(BA.dash, BB.dash, blend), edge: lerpColor(BA.edge, BB.edge, blend),
          dark: BA.dark + (BB.dark - BA.dark) * blend, decorA: BA.decor, decorB: BB.decor, blend, name: BA.name,
        };
        if (s.shield > 0) { s.shield = Math.max(0, s.shield - dt); if (s.shield <= 0) s.shieldArmed = false; }
        if (s.shrink > 0) s.shrink = Math.max(0, s.shrink - dt);
        if (s.siren > 0) { s.siren = Math.max(0, s.siren - dt); if (s.siren <= 0) a?.sirenStop(); }
        // taille du joueur : 50 % quand le bonus "Rétréci" est actif
        const pscale = s.shrink > 0 ? 0.5 : 1;
        const playerW = CAR_W * pscale, playerH = CAR_H * pscale;
        const frontY = PLAYER_Y - playerH / 2;       // pare-chocs avant (dépend de la taille)

        const dir = (s.keys.right ? 1 : 0) - (s.keys.left ? 1 : 0);
        s.playerX = clamp(s.playerX + dir * PLAYER_SPEED * dt, SHOULDER + CAR_W / 2, W - SHOULDER - CAR_W / 2);

        s.distSinceBand += descent * dt;
        if (s.distSinceBand >= BAND_GAP[s.level]) { s.distSinceBand = 0; spawnBand(s); }
        for (const c of s.cars) c.y += descent * dt;
        if (s.siren > 0) {                              // sirène : on ne libère QUE la voie du joueur
          const lc = laneCenter(s.sirenLane);
          const outDir = s.sirenLane <= (LANES - 1) / 2 ? -1 : 1;
          for (const c of s.cars) {
            if (Math.abs(c.x - lc) < LANE_W * 0.6) c.x = clamp(c.x + outDir * 170 * dt, SHOULDER + CAR_W / 2, W - SHOULDER - CAR_W / 2);
          }
        }

        s.bonusTimer -= dt;
        if (s.bonusTimer <= 0) {
          // on choisit une voie dégagée (pas de voiture en haut) : priorité à la voie du trou
          const free = [s.gapLane, 0, 1, 2, 3].find((l) => !carNearTop(s, laneCenter(l)));
          if (free != null) {
            s.bonuses.push({ x: laneCenter(free), y: -30, type: pick(["boxe", "shield", "retreci", "sirene"]) });
            s.bonusTimer = rand(BONUS_EVERY[0], BONUS_EVERY[1]);
          } else { s.bonusTimer = 0.4; }            // tout est occupé : on réessaie vite
        }
        for (const b of s.bonuses) b.y += descent * dt;
        for (const b of s.bonuses) {
          if (Math.abs(b.x - s.playerX) < CAR_W / 2 + 14 && Math.abs(b.y - PLAYER_Y) < CAR_H / 2 + 14) {
            if (b.type === "shield") { s.shieldArmed = true; s.shield = 0; }   // chrono démarrera au 1er choc
            else if (b.type === "retreci") s.shrink = 10;
            else if (b.type === "sirene") s.sirenReady = true;                 // s'active à la flèche bas
            else s.punches += BOXE_PUNCHES;                                    // les coups s'ADDITIONNENT
            a?.pickup(); b.y = H + 999;
          }
        }
        s.bonuses = s.bonuses.filter((b) => b.y < H + 40);

        // SORTIE vers le GARAGE : on peut y entrer pour dépenser ses pièces
        s.garageTimer -= dt;
        if (s.garageTimer <= 0 && !s.garage) {
          const free = [s.gapLane, 0, 1, 2, 3].find((l) => !carNearTop(s, laneCenter(l)) && !itemNearTop(s, laneCenter(l)));
          if (free != null) { s.garage = { x: laneCenter(free), y: -60 }; s.garageTimer = rand(40, 55); }
          else s.garageTimer = 0.4;
        }
        if (s.garage) {
          s.garage.y += descent * dt;
          if (Math.abs(s.garage.x - s.playerX) < LANE_W / 2 && Math.abs(s.garage.y - PLAYER_Y) < CAR_H / 2 + 22) {
            setSave((p) => { const next = { ...p, coins: walletRef.current }; writeSave(next); return next; });  // on encaisse
            s.cars = []; s.bonuses = []; s.garage = null; s.siren = 0;
            s.distSinceBand = BAND_GAP[s.level]; s.bonusTimer = rand(BONUS_EVERY[0], BONUS_EVERY[1]);
            a?.engineOn(false); a?.sirenStop(); a?.pickup(); setMode("garage");
          } else if (s.garage.y > H + 60) s.garage = null;
        }

        // COUP DE POING : le gant jaillit, détruit UNE voiture s'il l'atteint
        if (s.punch) {
          s.punch.prog += dt / PUNCH_DUR;
          const ext = PUNCH_REACH * Math.sin(Math.min(1, s.punch.prog) * Math.PI);
          const tipY = frontY - 16 - ext;
          if (!s.punch.connected) {
            for (const c of s.cars) {
              if (c.y > H + 999 || c.black) continue;       // une voiture noire ne se casse pas
              if (Math.abs(c.x - s.playerX) < CAR_W / 2 + 8 && tipY > c.y - CAR_H / 2 - 8 && tipY < c.y + CAR_H / 2 + 8) {
                s.punch.connected = true; explode(s, c.x, c.y, c.color); c.y = H + 999;
                addPts(s, c.x, c.y, PTS_BOXE, COIN_BOXE); a?.punchHit(); break;
              }
            }
          }
          if (s.punch.prog >= 1) s.punch = null;
        }

        // COLLISIONS — la voie libérée par la sirène est sûre
        if (s.invuln > 0) s.invuln -= dt;
        const pad = 10;
        const sirenSafe = s.siren > 0 ? laneCenter(s.sirenLane) : null;
        for (const c of s.cars) {
          if (c.y > H + 999) continue;
          if (sirenSafe !== null && Math.abs(c.x - sirenSafe) < LANE_W * 0.55) continue;  // voie ouverte par la sirène
          if (Math.abs(c.x - s.playerX) < (playerW + CAR_W) / 2 - pad && Math.abs(c.y - PLAYER_Y) < (playerH + CAR_H) / 2 - pad) {
            if (c.black) {                                       // VOITURE NOIRE : indestructible et dangereuse
              if (s.invuln <= 0) {
                s.shield = 0; s.shieldArmed = false; s.punches = 0; s.shrink = 0;  // casse TOUS les bonus
                s.lives -= 1; c.y = H + 999; explode(s, c.x, c.y, "#17171c");
                if (s.lives <= 0) {
                  const fscore = Math.floor(s.score); setLastScore(fscore);
                  setSave((p) => { const next = { ...p, coins: walletRef.current, best: Math.max(p.best, fscore) }; writeSave(next); return next; });
                  a?.defeat(); a?.engineOn(false); a?.sirenStop(); setMode("over");
                } else { s.invuln = 1.3; a?.crash(); }
                break;
              }
              continue;                                          // pendant l'invincibilité, on l'ignore
            }
            if (s.shield > 0 || s.shieldArmed) {                 // protégé : la voiture explose
              if (s.shieldArmed && s.shield <= 0) s.shield = SHIELD_TIME;  // <-- le chrono démarre ICI
              explode(s, c.x, c.y, c.color); c.y = H + 999; addPts(s, c.x, c.y, PTS_SHIELD, COIN_SHIELD); a?.explosion();
            } else if (s.invuln <= 0) {                          // touché : on perd une vie
              s.lives -= 1; c.y = H + 999; explode(s, c.x, c.y, "#e63946");
              if (s.lives <= 0) {
                const fscore = Math.floor(s.score); setLastScore(fscore);
                setSave((p) => { const next = { ...p, coins: walletRef.current, best: Math.max(p.best, fscore) }; writeSave(next); return next; });
                a?.defeat(); a?.engineOn(false); a?.sirenStop(); setMode("over");
              }
              else { s.invuln = 1.3; a?.crash(); }
              break;
            }
          }
        }
        s.cars = s.cars.filter((c) => c.y < H + CAR_H);

        for (const p of s.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
        s.particles = s.particles.filter((p) => p.life > 0);
        for (const p of s.popups) { p.y -= 34 * dt; p.life -= dt; }
        s.popups = s.popups.filter((p) => p.life > 0);

        s.hudT += dt;
        if (s.hudT > 0.1) {
          s.hudT = 0;
          const m = String(Math.floor(s.elapsed / 60)).padStart(2, "0");
          const sec = String(Math.floor(s.elapsed % 60)).padStart(2, "0");
          setHud({ time: `${m}:${sec}`, speed: SPEEDS_KMH[s.level], lives: s.lives, score: Math.floor(s.score),
                   shield: s.shield > 0 ? Math.ceil(s.shield) : (s.shieldArmed ? -1 : 0), punches: s.punches,
                   shrink: s.shrink > 0 ? Math.ceil(s.shrink) : 0,
                   siren: s.siren > 0 ? Math.ceil(s.siren) : (s.sirenReady ? -1 : 0), coins: Math.floor(walletRef.current) });
        }
      }

      /* ---------------------------- DESSIN ---------------------------- */
      // résolution interne = taille réellement affichée (× densité d'écran) -> net en plein écran
      const dd = dispRef.current;
      const bw = Math.max(1, Math.round(dd.w * dd.dpr)), bh = Math.max(1, Math.round(dd.h * dd.dpr));
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
      ctx.setTransform(bw / W, 0, 0, bh / H, 0, 0);   // tout le dessin reste en coordonnées 360×560
      const fb = (s && s.bg) ? s.bg : { ground: BIOMES[0].ground, road: BIOMES[0].road, dash: BIOMES[0].dash, edge: BIOMES[0].edge, dark: 0, decorA: "tree", decorB: "tree", blend: 0, name: "" };
      ctx.fillStyle = fb.ground; ctx.fillRect(0, 0, W, H);
      if (s) {                                   // décor des bas-côtés (se fond pendant les transitions)
        drawDecor(ctx, fb.decorA, s.worldDist, 1 - fb.blend);
        if (fb.blend > 0) drawDecor(ctx, fb.decorB, s.worldDist, fb.blend);
      }
      ctx.fillStyle = fb.road; ctx.fillRect(SHOULDER, 0, ROAD_W, H);
      const off = s ? s.scroll : 0;
      ctx.fillStyle = fb.dash;
      for (let l = 1; l < LANES; l++) { const x = SHOULDER + l * LANE_W - 2; for (let y = -40 + off; y < H; y += 40) ctx.fillRect(x, y, 4, 22); }
      ctx.fillStyle = fb.edge; ctx.fillRect(SHOULDER - 3, 0, 3, H); ctx.fillRect(W - SHOULDER, 0, 3, H);

      if (s) {
        for (const c of s.cars) {
          if (c.y >= H + CAR_H) continue;
          drawVehicle(ctx, c.x, c.y, c.color, 1, "berline");
          if (c.black) {                              // contour rouge "danger" qui pulse
            ctx.strokeStyle = `rgba(255,45,45,${0.55 + 0.4 * Math.sin(t / 110)})`; ctx.lineWidth = 3;
            rr(ctx, c.x - CAR_W / 2 - 1, c.y - CAR_H / 2 - 1, CAR_W + 2, CAR_H + 2, 13); ctx.stroke();
          }
        }
        for (const b of s.bonuses) if (b.y < H + 40) drawBonus(ctx, b, t);
        if (s.garage && s.garage.y < H + 60) {     // panneau de sortie "GARAGE"
          const gx = s.garage.x, gy = s.garage.y, gw = LANE_W - 8, gh = 54;
          ctx.fillStyle = "#1f9e8a"; rr(ctx, gx - gw / 2, gy - gh / 2, gw, gh, 10); ctx.fill();
          ctx.fillStyle = "#0d6b5d"; rr(ctx, gx - gw / 2, gy - gh / 2, gw, 18, 10); ctx.fill();
          ctx.fillStyle = "#fff"; ctx.font = "bold 12px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("GARAGE", gx, gy - 4); ctx.font = "bold 16px system-ui"; ctx.fillText("▼", gx, gy + 14);
          ctx.textBaseline = "alphabetic";
        }
        for (const p of s.particles) { ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill(); }
        ctx.globalAlpha = 1;

        if (statusRef.current !== "over" && !(s.invuln > 0 && Math.floor(t / 90) % 2)) {
          const pscale = s.shrink > 0 ? 0.5 : 1;
          const frontY = PLAYER_Y - (CAR_H * pscale) / 2;

          ctx.save();
          ctx.translate(s.playerX, PLAYER_Y); ctx.scale(pscale, pscale); ctx.translate(-s.playerX, -PLAYER_Y);
          drawVehicle(ctx, s.playerX, PLAYER_Y, colorRef.current, -1, equippedRef.current);
          ctx.restore();

          // gant de boxe (au repos ou en train de jaillir sur ressort)
          if (s.punches > 0 || s.punch) {
            const ext = s.punch ? PUNCH_REACH * Math.sin(Math.min(1, s.punch.prog) * Math.PI) : 0;
            const gy = frontY - 16 - ext;
            if (ext > 4) {                       // ressort
              ctx.strokeStyle = "#cfcfcf"; ctx.lineWidth = 3; ctx.beginPath();
              const y0 = frontY, y1 = gy + 12, segs = 6;
              ctx.moveTo(s.playerX, y0);
              for (let i = 1; i <= segs; i++) ctx.lineTo(s.playerX + (i % 2 ? 7 : -7), y0 + (y1 - y0) * i / segs);
              ctx.stroke();
            }
            drawGlove(ctx, s.playerX, gy, 1.25 * pscale, "#e23b3b");
          }

          // bouclier : cercle bleu (visible dès le ramassage)
          if (s.shieldArmed || s.shield > 0) {
            const blink = (s.shield > 0 && s.shield < 2) ? (Math.floor(t / 150) % 2 ? 0.35 : 0.9) : 0.85;
            const rad = 56 + 3 * Math.sin(t / 110);
            ctx.globalAlpha = blink; ctx.lineWidth = 4; ctx.strokeStyle = "#43a6ff";
            ctx.beginPath(); ctx.arc(s.playerX, PLAYER_Y, rad, 0, 7); ctx.stroke();
            ctx.globalAlpha = blink * 0.18; ctx.fillStyle = "#43a6ff";
            ctx.beginPath(); ctx.arc(s.playerX, PLAYER_Y, rad, 0, 7); ctx.fill();
            ctx.globalAlpha = 1;
          }

          // sirène : gyrophare clignotant rouge/bleu + halos qui se propagent
          if (s.siren > 0) {
            const ph = Math.floor(t / 130) % 2;
            const col = ph ? "#e11d2a" : "#1e6bff";
            for (let i = 0; i < 2; i++) {
              const rad = 30 + ((t / 6 + i * 28) % 56);
              ctx.globalAlpha = Math.max(0, 0.5 - rad / 110); ctx.lineWidth = 3; ctx.strokeStyle = col;
              ctx.beginPath(); ctx.arc(s.playerX, PLAYER_Y, rad, 0, 7); ctx.stroke();
            }
            ctx.globalAlpha = 1;
            const lw = 18 * pscale, lh = 8 * pscale;
            ctx.fillStyle = col; rr(ctx, s.playerX - lw / 2, PLAYER_Y - lh / 2 - 3, lw, lh, 3); ctx.fill();
            ctx.fillStyle = ph ? "#1e6bff" : "#e11d2a"; rr(ctx, s.playerX - lw / 2, PLAYER_Y - lh / 2 - 3, lw / 2, lh, 3); ctx.fill();
          }
        }
        for (const p of s.popups) { ctx.globalAlpha = Math.max(0, p.life / 0.8); ctx.fillStyle = p.color || "#fff"; ctx.font = "bold 16px system-ui"; ctx.textAlign = "center"; ctx.fillText(p.text, p.x, p.y); }
        ctx.globalAlpha = 1;

        // ambiance sombre des biomes tunnel / nuit
        if (fb.dark > 0) { ctx.fillStyle = `rgba(0,0,0,${fb.dark})`; ctx.fillRect(0, 0, W, H); }
        // annonce du nouveau décor pendant ~2,4 s
        if (s.biomeFlash > 0 && fb.name) {
          ctx.globalAlpha = Math.min(1, s.biomeFlash / 0.6);
          ctx.fillStyle = "rgba(0,0,0,.45)"; rr(ctx, W / 2 - 92, 150, 184, 40, 12); ctx.fill();
          ctx.fillStyle = "#fff"; ctx.font = "bold 22px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(fb.name, W / 2, 171);
          ctx.globalAlpha = 1; ctx.textBaseline = "alphabetic";
        }

        // COMPTE À REBOURS au centre (3, 2, 1, GO !)
        if (statusRef.current === "countdown") {
          ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.fillRect(0, 0, W, H);
          if (activeNameRef.current) {
            ctx.fillStyle = "#fff"; ctx.font = "bold 24px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText("Au tour de " + activeNameRef.current, W / 2, H / 2 - 90);
          }
          const go = s.cdN === 0;
          const k = go ? 1 : 1.5 - Math.min(0.5, s.cdT * 1.4);     // petit "pop" à chaque chiffre
          ctx.fillStyle = go ? "#7ee29a" : "#ffd23f";
          ctx.font = `bold ${Math.round((go ? 64 : 96) * k)}px system-ui`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(go ? "GO !" : String(s.cdN), W / 2, H / 2);
          ctx.textBaseline = "alphabetic";
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(raf); };
  }, [setMode]);

  // --- mise à l'échelle : la scène occupe le plus de place possible en gardant le ratio 360:560 ---
  const reservedV = (isFs ? 6 : 56) + 92 + (isFs ? 12 : 28);   // titre (si visible) + contrôles + marges
  const availH = Math.max(220, vp.h - reservedV);
  const availW = Math.max(220, vp.w - (isFs ? 12 : 24));
  const stageW = Math.round(Math.min(availW, availH * W / H));
  const stageH = Math.round(stageW * H / W);
  dispRef.current = { w: stageW, h: stageH, dpr: Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2) };

  const wrap = { fontFamily: "system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: isFs ? 8 : 12, padding: isFs ? 6 : 16, color: "#1c1c22", minHeight: "100vh", boxSizing: "border-box", background: isFs ? "#0f1119" : "transparent" };
  const stage = { position: "relative", width: stageW, height: stageH, borderRadius: isFs ? 8 : 18, overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,.35)" };
  const pill = { background: "rgba(20,22,30,.78)", color: "#fff", borderRadius: 12, padding: "6px 12px", fontWeight: 700, lineHeight: 1.1 };
  const label = { fontSize: 10, letterSpacing: 1, opacity: .7, fontWeight: 600 };
  const overlay = { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "rgba(15,17,25,.82)", color: "#fff", textAlign: "center", padding: 24 };
  const btn = { background: "#ffd23f", color: "#1c1c22", border: "none", borderRadius: 12, padding: "14px 28px", fontSize: 18, fontWeight: 800, cursor: "pointer" };
  const tBtn = { flex: 1, background: "rgba(20,22,30,.85)", color: "#fff", border: "none", borderRadius: 14, padding: "16px 0", fontSize: 26, fontWeight: 800, userSelect: "none", touchAction: "none", display: "flex", alignItems: "center", justifyContent: "center" };

  const press = (side, v) => (e) => {
    e.preventDefault(); const s = g.current; if (!s) return;
    if (v && !s.keys[side] && statusRef.current === "playing") audioRef.current?.move();
    s.keys[side] = v;
  };
  const pressPunch = (e) => { e.preventDefault(); triggerPunch(); };
  const pressSiren = (e) => { e.preventDefault(); triggerSiren(); };

  const duelTotals = (t) => [t.scores[0].reduce((a, b) => a + b, 0), t.scores[1].reduce((a, b) => a + b, 0)];
  const DuelTable = (t) => {
    const rounds = Math.max(t.scores[0].length, t.scores[1].length, 1);
    const tot = duelTotals(t);
    const leader = tot[0] > tot[1] ? 0 : tot[1] > tot[0] ? 1 : -1;
    const cell = { padding: "5px 3px", fontSize: 13, textAlign: "center" };
    const head = { ...cell, fontSize: 10, opacity: .6, letterSpacing: .5 };
    const cols = `minmax(58px,1.4fr) repeat(${rounds}, 1fr) auto`;
    return (
      <div style={{ alignSelf: "stretch", background: "rgba(255,255,255,.07)", borderRadius: 12, padding: "8px 10px" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", rowGap: 3, columnGap: 4 }}>
          <div style={{ ...head, textAlign: "left" }}>JOUEUR</div>
          {Array.from({ length: rounds }).map((_, i) => <div key={"h" + i} style={head}>M{i + 1}</div>)}
          <div style={head}>TOTAL</div>
          {[0, 1].map((p) => {
            const win = leader === p;
            return (
              <div key={p} style={{ display: "contents" }}>
                <div style={{ ...cell, textAlign: "left", fontWeight: 700, color: win ? "#ffd23f" : "#fff" }}>
                  {win && "🏆 "}{t.names[p]}
                </div>
                {Array.from({ length: rounds }).map((_, i) => (
                  <div key={p + "-" + i} style={{ ...cell, opacity: t.scores[p][i] == null ? .35 : 1 }}>
                    {t.scores[p][i] == null ? "–" : t.scores[p][i]}
                  </div>
                ))}
                <div style={{ ...cell, fontWeight: 900, color: win ? "#ffd23f" : "#fff" }}>{tot[p]}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  const btn2 = { background: "rgba(255,255,255,.14)", color: "#fff", border: "none", borderRadius: 12, padding: "12px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer" };

  return (
    <div style={wrap} ref={wrapRef}>
      {!isFs && <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, letterSpacing: 1 }}>MONSTER DODGE <span style={{ fontSize: 20 }}>🛻</span></h1>}

      <div style={stage}>
        {status !== "playing" && status !== "countdown" && (
          <button onClick={toggleFullscreen} aria-label={isFs ? "Quitter le plein écran" : "Plein écran"}
            style={{ position: "absolute", top: 8, right: 8, zIndex: 5, width: 36, height: 36, borderRadius: 9,
              border: "none", cursor: "pointer", background: "rgba(20,22,30,.55)", color: "#fff", fontSize: 18,
              display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
            {isFs ? "✕" : "⛶"}
          </button>
        )}
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />

        {status === "playing" && (
          <>
            <div style={{ position: "absolute", top: 10, left: 10, ...pill }}><div style={label}>TEMPS</div>{hud.time}</div>
            <div style={{ position: "absolute", top: 10, right: 10, ...pill, textAlign: "right" }}><div style={label}>VITESSE</div>{hud.speed}<span style={{ fontSize: 11 }}> km/h</span></div>
            <div style={{ position: "absolute", top: 64, left: 10, ...pill }}><div style={label}>SCORE</div>{hud.score}</div>
            <div style={{ position: "absolute", top: 118, left: 10, ...pill }}><div style={label}>PIÈCES</div><span style={{ color: "#ffd23f" }}>●</span> {hud.coins}</div>
            <div style={{ position: "absolute", top: 64, right: 10, display: "flex", gap: 4, background: "rgba(20,22,30,.78)", borderRadius: 12, padding: "6px 8px" }}>
              {[0, 1, 2].map((i) => <CarIcon key={i} alive={i < hud.lives} />)}
            </div>
            <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
              {hud.shield !== 0 && (
                <div style={{ ...pill, background: "rgba(47,134,255,.92)", textAlign: "center" }}>
                  <div style={label}>BOUCLIER</div>{hud.shield === -1 ? "PRÊT" : hud.shield + "s"}
                </div>
              )}
              {hud.punches > 0 && (
                <div style={{ ...pill, background: "rgba(255,122,51,.95)", textAlign: "center" }}>
                  <div style={label}>BOXE</div>{hud.punches} coups
                </div>
              )}
              {hud.shrink > 0 && (
                <div style={{ ...pill, background: "rgba(46,196,95,.95)", textAlign: "center" }}>
                  <div style={label}>RÉTRÉCI</div>{hud.shrink}s
                </div>
              )}
              {hud.siren !== 0 && (
                <div style={{ ...pill, background: "rgba(225,29,42,.95)", textAlign: "center" }}>
                  <div style={label}>SIRÈNE</div>{hud.siren === -1 ? "PRÊTE (↓)" : hud.siren + "s"}
                </div>
              )}
            </div>
          </>
        )}

        {status === "garage" && (
          <div style={{ ...overlay, justifyContent: "flex-start", padding: 14, gap: 8, overflowY: "auto" }}>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 1 }}>🔧 GARAGE</div>
            <div style={{ ...pill, background: "rgba(255,210,63,.95)", color: "#1c1c22", fontSize: 15 }}>
              <span style={{ color: "#c98a00" }}>●</span> {save.coins} pièces
            </div>
            <div style={{ fontSize: 12, opacity: .8 }}>Vies : {g.current ? g.current.lives : 3}/3</div>

            <div style={{ alignSelf: "stretch", marginTop: 2 }}>
              <div style={{ ...label, fontSize: 11, marginBottom: 6 }}>FORMES DE VOITURE</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7 }}>
                {SHAPES.map((sh) => {
                  const owned = save.owned.includes(sh.id), equipped = save.equipped === sh.id, afford = save.coins >= sh.price;
                  return (
                    <button key={sh.id} disabled={!owned && !afford}
                      onClick={() => owned ? equipShape(sh.id) : buyShape(sh.id)}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 4px", borderRadius: 10,
                        border: equipped ? "2px solid #ffd23f" : "2px solid transparent", background: "rgba(255,255,255,.1)",
                        color: "#fff", cursor: (owned || afford) ? "pointer" : "default", opacity: (!owned && !afford) ? .4 : 1 }}>
                      <ShapePreview shape={sh.id} color={save.color} size={38} />
                      <span style={{ fontSize: 10.5, fontWeight: 700, textAlign: "center" }}>{sh.name}</span>
                      <span style={{ fontSize: 10.5, opacity: .85 }}>{equipped ? "Équipé" : owned ? "Équiper" : "● " + sh.price}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ alignSelf: "stretch" }}>
              <div style={{ ...label, fontSize: 11, margin: "4px 0 6px" }}>COULEUR (gratuite)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {COLORS.map((hex) => (
                  <button key={hex} onClick={() => chooseColor(hex)}
                    style={{ width: 30, height: 30, borderRadius: "50%", background: hex, cursor: "pointer",
                      border: save.color === hex ? "3px solid #fff" : "3px solid rgba(255,255,255,.2)" }} />
                ))}
              </div>
            </div>

            <div style={{ alignSelf: "stretch" }}>
              <div style={{ ...label, fontSize: 11, margin: "4px 0 6px" }}>PROTECTIONS (pour cette partie)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {PROTECTIONS.map((pr) => {
                  const afford = save.coins >= pr.price;
                  const dis = !afford || (pr.id === "repair" && g.current && g.current.lives >= 3);
                  return (
                    <button key={pr.id} disabled={dis} onClick={() => buyProtection(pr.id)}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px",
                        borderRadius: 10, border: "none", background: "rgba(255,255,255,.1)", color: "#fff",
                        cursor: dis ? "default" : "pointer", opacity: dis ? .4 : 1, fontSize: 13 }}>
                      <span>{pr.name}</span><span style={{ fontWeight: 800, color: "#ffd23f" }}>● {pr.price}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <button style={{ ...btn, marginTop: 4 }} onClick={resumeRun}>Reprendre la route →</button>
          </div>
        )}

        {status === "menu" && (
          <div style={overlay}>
            <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: 1, lineHeight: 1 }}>MONSTER<br />DODGE</div>
            <div style={{ fontSize: 13, opacity: .85, marginTop: -4 }}>L'autoroute à contresens</div>
            <p style={{ margin: 0, maxWidth: 300, fontSize: 12.5, opacity: .92, lineHeight: 1.5 }}>
              Évite les voitures qui foncent vers toi.<br />
              <b style={{ color: "#7fc0ff" }}>Bouclier</b> : protège et casse les voitures.
              <b style={{ color: "#ffb088" }}> Gant</b> (<b>↑</b>) : vise la distance !
              <b style={{ color: "#7ee29a" }}> Rétréci</b> : 2× plus petit.
              <b style={{ color: "#ff8d8d" }}> Sirène</b> (<b>↓</b>) : ouvre ta voie 8 s.<br />
              <b style={{ color: "#ff5a5a" }}>⚠ Voitures noires</b> : indestructibles, esquive-les !
            </p>
            <div style={{ fontSize: 13, opacity: .9 }}><span style={{ color: "#ffd23f" }}>●</span> {save.coins} pièces · Meilleur : {save.best}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, width: 240, maxWidth: "85%" }}>
              <button style={btn} onClick={() => setMode("solo")}>🚗 Partie solo</button>
              <button style={{ ...btn, background: "#ff8d3f" }} onClick={() => { setDuelNames([save.name || "", ""]); setMode("duelSetup"); }}>⚔️ Duel à 2 joueurs</button>
            </div>
          </div>
        )}

        {status === "solo" && (
          <div style={overlay}>
            <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: 1 }}>PARTIE SOLO</div>
            <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} maxLength={14}
              placeholder="Ton nom de pilote" aria-label="Ton nom"
              style={{ width: 220, maxWidth: "80%", padding: "10px 12px", borderRadius: 10, border: "2px solid rgba(255,255,255,.25)",
                background: "rgba(255,255,255,.1)", color: "#fff", fontSize: 15, textAlign: "center", outline: "none" }} />
            <button style={{ ...btn, opacity: nameInput.trim() ? 1 : .5, cursor: nameInput.trim() ? "pointer" : "default" }}
              disabled={!nameInput.trim()} onClick={startSolo}>C'est parti !</button>
            <div style={{ fontSize: 12, opacity: .7 }}>← → bouger · ↑ coup de poing · ↓ sirène</div>
            <button style={btn2} onClick={() => setMode("menu")}>← Menu</button>
          </div>
        )}

        {status === "duelSetup" && (
          <div style={overlay}>
            <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: 1 }}>⚔️ DUEL</div>
            <div style={{ fontSize: 13, opacity: .85, maxWidth: 280, lineHeight: 1.4 }}>
              Chacun joue à tour de rôle. Le gagnant est celui qui cumule le plus de points !
            </div>
            <input value={duelNames[0]} onChange={(e) => setDuelNames([e.target.value, duelNames[1]])} maxLength={14}
              placeholder="Joueur 1" aria-label="Nom du joueur 1"
              style={{ width: 220, maxWidth: "80%", padding: "10px 12px", borderRadius: 10, border: "2px solid rgba(255,210,63,.5)",
                background: "rgba(255,255,255,.1)", color: "#fff", fontSize: 15, textAlign: "center", outline: "none" }} />
            <input value={duelNames[1]} onChange={(e) => setDuelNames([duelNames[0], e.target.value])} maxLength={14}
              placeholder="Joueur 2" aria-label="Nom du joueur 2"
              style={{ width: 220, maxWidth: "80%", padding: "10px 12px", borderRadius: 10, border: "2px solid rgba(255,141,63,.5)",
                background: "rgba(255,255,255,.1)", color: "#fff", fontSize: 15, textAlign: "center", outline: "none" }} />
            <div style={{ fontSize: 13, opacity: .9 }}>Nombre de manches par joueur :</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[3, 5, 7].map((n) => (
                <button key={n} onClick={() => setDuelGames(n)}
                  style={{ width: 48, padding: "10px 0", borderRadius: 10, fontWeight: 800, fontSize: 16, cursor: "pointer",
                    border: duelGames === n ? "2px solid #ffd23f" : "2px solid transparent",
                    background: duelGames === n ? "rgba(255,210,63,.25)" : "rgba(255,255,255,.1)", color: "#fff" }}>{n}</button>
              ))}
            </div>
            <button style={{ ...btn, opacity: (duelNames[0].trim() && duelNames[1].trim()) ? 1 : .5 }}
              disabled={!(duelNames[0].trim() && duelNames[1].trim())} onClick={beginDuel}>Commencer le duel →</button>
            <button style={btn2} onClick={() => setMode("menu")}>← Menu</button>
          </div>
        )}

        {status === "turnIntro" && tour && tour.mode === "duel" && (
          <div style={overlay}>
            <div style={{ fontSize: 14, opacity: .8, letterSpacing: 1 }}>MANCHE {tour.scores[tour.turn].length + 1} / {tour.gamesPer}</div>
            <div style={{ fontSize: 15, opacity: .85 }}>Passe la manette à</div>
            <div style={{ fontSize: 30, fontWeight: 900, color: tour.turn === 0 ? "#ffd23f" : "#ff8d3f" }}>{tour.names[tour.turn]}</div>
            {(tour.scores[0].length + tour.scores[1].length) > 0 && (
              <div style={{ fontSize: 13, opacity: .8 }}>
                Cumul — {tour.names[0]} : <b>{duelTotals(tour)[0]}</b> · {tour.names[1]} : <b>{duelTotals(tour)[1]}</b>
              </div>
            )}
            <button style={btn} onClick={startTurn}>Prêt ! →</button>
          </div>
        )}

        {status === "over" && tour && tour.mode === "solo" && (
          <div style={overlay}>
            <div style={{ fontSize: 30, fontWeight: 900 }}>Partie terminée</div>
            {save.name && <div style={{ fontSize: 16 }}>Bravo, <b>{save.name}</b> !</div>}
            <div style={{ fontSize: 18 }}>Score : <b>{lastScore}</b></div>
            <div style={{ fontSize: 14, opacity: .8 }}>Meilleur score : {save.best}</div>
            <div style={{ fontSize: 14, opacity: .9 }}><span style={{ color: "#ffd23f" }}>●</span> {save.coins} pièces en banque</div>
            <button style={btn} onClick={launchGame}>Rejouer</button>
            <button style={btn2} onClick={() => setMode("menu")}>← Menu</button>
          </div>
        )}

        {status === "over" && tour && tour.mode === "duel" && (
          <div style={overlay}>
            <div style={{ fontSize: 14, opacity: .8, letterSpacing: 1 }}>MANCHE TERMINÉE</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: tour.turn === 0 ? "#ffd23f" : "#ff8d3f" }}>{tour.names[tour.turn]}</div>
            <div style={{ fontSize: 22 }}>Score de la manche : <b>{lastScore}</b></div>
            <button style={btn} onClick={afterDuelGame}>Continuer →</button>
          </div>
        )}

        {status === "standings" && tour && tour.mode === "duel" && (
          <div style={{ ...overlay, justifyContent: "flex-start", paddingTop: 28, gap: 12, overflowY: "auto" }}>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 1 }}>📊 LE COMBAT</div>
            <div style={{ fontSize: 13, opacity: .8 }}>après {tour.scores[1].length} manche{tour.scores[1].length > 1 ? "s" : ""} sur {tour.gamesPer}</div>
            {DuelTable(tour)}
            {(() => { const tt = duelTotals(tour); const d = Math.abs(tt[0] - tt[1]); const ld = tt[0] === tt[1] ? null : (tt[0] > tt[1] ? 0 : 1);
              return <div style={{ fontSize: 14, opacity: .92 }}>{ld == null ? "Égalité parfaite !" : <span><b style={{ color: ld === 0 ? "#ffd23f" : "#ff8d3f" }}>{tour.names[ld]}</b> mène de {d} point{d > 1 ? "s" : ""}</span>}</div>; })()}
            <button style={btn} onClick={() => setMode("turnIntro")}>Continuer le duel →</button>
          </div>
        )}

        {status === "duelEnd" && tour && tour.mode === "duel" && (
          <div style={{ ...overlay, justifyContent: "flex-start", paddingTop: 28, gap: 12, overflowY: "auto" }}>
            <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: 1 }}>🏁 DUEL TERMINÉ</div>
            {(() => { const tt = duelTotals(tour); const ld = tt[0] === tt[1] ? null : (tt[0] > tt[1] ? 0 : 1);
              return ld == null
                ? <div style={{ fontSize: 22, fontWeight: 900 }}>Égalité ! 🤝</div>
                : <div style={{ fontSize: 24, fontWeight: 900, color: ld === 0 ? "#ffd23f" : "#ff8d3f" }}>🏆 {tour.names[ld]} gagne !</div>; })()}
            {DuelTable(tour)}
            <button style={btn} onClick={() => setMode("duelSetup")}>Rejouer un duel</button>
            <button style={btn2} onClick={() => setMode("menu")}>← Menu</button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, width: stageW, maxWidth: "100%" }}>
        <button style={tBtn} onPointerDown={press("left", true)} onPointerUp={press("left", false)} onPointerLeave={press("left", false)}>←</button>
        <button style={{ ...tBtn, flex: 0.7, background: "rgba(226,59,59,.9)" }} onPointerDown={pressPunch}><GloveBtnIcon /></button>
        <button style={{ ...tBtn, flex: 0.7, background: "#fff" }} onPointerDown={pressSiren}><SirenBtnIcon /></button>
        <button style={tBtn} onPointerDown={press("right", true)} onPointerUp={press("right", false)} onPointerLeave={press("right", false)}>→</button>
      </div>
    </div>
  );
}

