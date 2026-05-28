'use strict';

const STORAGE_KEY = 'ftt-v1';
const SEASON_KEY  = 'ftt-season-v1';
const MAX_HIST    = 20;
const SAVE_DELAY  = 1500;

const HALF_OFFSET = { 1: 0, 2: 45 * 60, 3: 90 * 60 };
const HALF_LIMIT  = { 1: 45 * 60, 2: 45 * 60, 3: 30 * 60 };
const HALF_NAME   = { 1: '1T', 2: '2T', 3: 'TE' };
const POSITIONS   = ['', 'GK', 'DEF', 'MED', 'DEL'];
const POS_LABEL   = { '': '—', GK: 'GK', DEF: 'DEF', MED: 'MED', DEL: 'DEL' };

const DEFAULT_PLAYERS = [
  'Jugador 1','Jugador 2','Jugador 3','Jugador 4',
  'Jugador 5','Jugador 6','Jugador 7','Jugador 8',
  'Jugador 9','Jugador 10','Jugador 11'
];

const SHOT_LABEL = { goles: 'Gol', tirosLibres: 'Tiro Libre', penales: 'Penal' };
const STAT_LABEL = {
  asistencias: 'Asistencia', faltasCometidas: 'Falta Cometida',
  faltasRecibidas: 'Falta Recibida', tarjetasAmarillas: 'Tarjeta Amarilla',
  tarjetasRojas: 'Tarjeta Roja', fueraLugar: 'Fuera de Lugar',
  recuperaciones: 'Recuperación', perdidas: 'Pérdida'
};

// ── Global state ──────────────────────────────────────────
let S          = null;
let LOG        = [];
let clockTimer = null;
let saveTimer  = null;
let tableOpen  = false;

// Penalty shootout state (lives outside S — it's a temp mode)
let PS = { titans: [], rival: [] };

// ── Player stats ──────────────────────────────────────────
function mkStats() {
  return {
    golesM: 0, golesA: 0,
    tirosLibresM: 0, tirosLibresA: 0,
    penalesM: 0, penalesA: 0,
    asistencias: 0, faltasCometidas: 0, faltasRecibidas: 0,
    tarjetasAmarillas: 0, tarjetasRojas: 0,
    fueraLugar: 0, recuperaciones: 0, perdidas: 0
  };
}

function initState(players) {
  const stats = {}, secs = {}, onField = {}, elim = {}, positions = {};
  players.forEach(p => {
    stats[p]     = mkStats();
    secs[p]      = 0;
    onField[p]   = false;
    elim[p]      = false;
    positions[p] = '';
  });
  return {
    gameName: 'Partido', rival: 'Rival',
    half: 1, secsElapsed: 0, clockRunning: false,
    rivalScore: 0, players: [...players],
    stats, secs, onField, elim, positions,
    substitutions: [],   // [{ min, playerOut, playerIn }]
    selected: null, history: []
  };
}

// ── Persistence ───────────────────────────────────────────
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, SAVE_DELAY);
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ S, LOG })); } catch(_) {}
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    S = d.S; LOG = d.LOG || [];
    // Migrate older saves that lack new fields
    if (!S.positions)     S.positions     = Object.fromEntries(S.players.map(p => [p, '']));
    if (!S.substitutions) S.substitutions = [];
    return true;
  } catch(_) { return false; }
}

// ── Undo ──────────────────────────────────────────────────
function snap() {
  return JSON.parse(JSON.stringify({
    stats: S.stats, onField: S.onField, elim: S.elim,
    secs: S.secs, rivalScore: S.rivalScore,
    positions: S.positions, substitutions: S.substitutions
  }));
}

function pushSnap() {
  S.history.push(snap());
  if (S.history.length > MAX_HIST) S.history.shift();
}

function undo() {
  if (!S.history.length) { toast('Nada que deshacer'); return; }
  const prev = S.history.pop();
  Object.assign(S, prev);
  LOG.shift();
  render();
  debouncedSave();
  toast('Acción deshecha ↩');
}

// ── Clock ─────────────────────────────────────────────────
function fmt(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function displayTime() {
  return fmt((HALF_OFFSET[S.half] || 0) + S.secsElapsed);
}

function tick() {
  S.secsElapsed++;
  S.players.forEach(p => {
    if (S.onField[p] && !S.elim[p]) S.secs[p] = (S.secs[p] || 0) + 1;
  });
  renderClock();
  debouncedSave();
}

function toggleClock() {
  if (S.clockRunning) {
    clearInterval(clockTimer); clockTimer = null;
    S.clockRunning = false;
  } else {
    clockTimer = setInterval(tick, 1000);
    S.clockRunning = true;
  }
  renderClockBtn();
}

function nextHalf() {
  if (S.half >= 3) { toast('Ya estás en Tiempo Extra'); return; }
  if (S.clockRunning) toggleClock();
  S.half++;
  S.secsElapsed = 0;
  addLog(`─── ${HALF_NAME[S.half]} iniciado ───`);
  renderClock(); renderClockBtn();
  debouncedSave();
}

// ── Players ───────────────────────────────────────────────
function selectPlayer(name) {
  S.selected = name;
  renderBadge();
  renderPlayers();
  renderPositionSelector();
}

function toggleField(name) {
  if (S.elim[name]) { toast(`${name} está expulsado`); return; }
  S.onField[name] = !S.onField[name];
  addLog(`${name} ${S.onField[name] ? '▶ entró al campo' : '⬅ salió del campo'}`);
  renderBadge(); renderPlayers(); debouncedSave();
}

function addPlayer() {
  const name = prompt('Nombre del nuevo jugador:');
  if (!name?.trim()) return;
  const n = name.trim();
  if (S.players.includes(n)) { toast('Ese jugador ya existe'); return; }
  S.players.push(n);
  S.stats[n]     = mkStats();
  S.secs[n]      = 0;
  S.onField[n]   = false;
  S.elim[n]      = false;
  S.positions[n] = '';
  addLog(`➕ Jugador agregado: ${n}`);
  render(); debouncedSave();
}

function removePlayer() {
  if (!S.selected) { toast('Selecciona un jugador primero'); return; }
  if (!confirm(`¿Remover a "${S.selected}" del partido?`)) return;
  const name = S.selected;
  S.players = S.players.filter(p => p !== name);
  delete S.stats[name]; delete S.secs[name];
  delete S.onField[name]; delete S.elim[name]; delete S.positions[name];
  S.selected = S.players[0] || null;
  addLog(`➖ Jugador removido: ${name}`);
  render(); debouncedSave();
}

// ── Positions ─────────────────────────────────────────────
function setPosition(name, pos) {
  if (!name) return;
  S.positions[name] = pos;
  renderPlayers();
  renderPositionSelector();
  renderBadge();
  debouncedSave();
}

function renderPositionSelector() {
  const container = document.getElementById('position-selector');
  if (!container) return;
  if (!S.selected) { container.classList.add('hidden'); return; }
  container.classList.remove('hidden');
  const cur = S.positions[S.selected] || '';
  container.querySelectorAll('.pos-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pos === cur);
  });
}

// ── Substitutions ─────────────────────────────────────────
function openSubModal() {
  const outSel = document.getElementById('sub-out-select');
  const inSel  = document.getElementById('sub-in-select');
  if (!outSel || !inSel) return;

  // Players that can come OUT: on field and not eliminated
  const canOut = S.players.filter(p => S.onField[p] && !S.elim[p]);
  // Players that can come IN: not on field and not eliminated
  const canIn  = S.players.filter(p => !S.onField[p] && !S.elim[p]);

  if (!canOut.length) { toast('No hay jugadores en el campo'); return; }
  if (!canIn.length)  { toast('No hay jugadores disponibles en banca'); return; }

  outSel.innerHTML = canOut.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  inSel.innerHTML  = canIn.map(p  => `<option value="${esc(p)}">${esc(p)}</option>`).join('');

  document.getElementById('sub-modal').classList.remove('hidden');
}

function closeSubModal() {
  document.getElementById('sub-modal').classList.add('hidden');
}

function confirmSub() {
  const playerOut = document.getElementById('sub-out-select').value;
  const playerIn  = document.getElementById('sub-in-select').value;
  if (!playerOut || !playerIn || playerOut === playerIn) {
    toast('Selecciona jugadores distintos'); return;
  }
  pushSnap();
  S.onField[playerOut] = false;
  S.onField[playerIn]  = true;
  const minuto = displayTime();
  S.substitutions.push({ min: minuto, playerOut, playerIn });
  addLog(`↕ Sustitución [${minuto}]: ${playerOut} → ${playerIn}`);
  closeSubModal();
  renderPlayers(); renderBadge();
  debouncedSave();
  toast(`↕ ${playerOut} → ${playerIn}`);
}

// ── Stats ─────────────────────────────────────────────────
function requirePlayer() {
  if (!S.selected)        { toast('Selecciona un jugador primero'); return false; }
  if (S.elim[S.selected]) { toast(`${S.selected} está expulsado 🟥`); return false; }
  return true;
}

function recordShot(type, made, btnEl) {
  if (!requirePlayer()) return;
  pushSnap();
  const p = S.selected;
  if (made) {
    S.stats[p][`${type}M`]++;
    S.stats[p][`${type}A`]++;
    addLog(`⚽ ${p} — ${SHOT_LABEL[type]} ANOTADO`);
    flashEl(btnEl, 'flash-green');
    pulseScore();
  } else {
    S.stats[p][`${type}A`]++;
    addLog(`✗ ${p} — ${SHOT_LABEL[type]} fallado`);
    flashEl(btnEl, 'flash-red');
  }
  renderScore(); renderBadge(); renderTableIfOpen(); debouncedSave();
}

function recordStat(type, btnEl) {
  if (!requirePlayer()) return;
  const p = S.selected;
  if (type === 'tarjetasAmarillas') { handleYellow(p, btnEl); return; }
  if (type === 'tarjetasRojas')     { handleDirectRed(p, btnEl); return; }
  pushSnap();
  S.stats[p][type]++;
  addLog(`${p} — ${STAT_LABEL[type]}`);
  flashEl(btnEl, type === 'perdidas' || type === 'faltasCometidas' ? 'flash-red' : 'flash-blue');
  renderBadge(); renderTableIfOpen(); debouncedSave();
}

function handleYellow(name, btnEl) {
  pushSnap();
  S.stats[name].tarjetasAmarillas++;
  flashEl(btnEl, 'flash-yellow');
  if (S.stats[name].tarjetasAmarillas >= 2) {
    S.stats[name].tarjetasRojas++;
    expulsar(name, '2ª Amarilla → Roja automática');
  } else {
    addLog(`🟨 ${name} — Tarjeta Amarilla (${S.stats[name].tarjetasAmarillas}/2)`);
    renderBadge();
  }
  renderTableIfOpen(); debouncedSave();
}

function handleDirectRed(name, btnEl) {
  if (S.elim[name]) { toast(`${name} ya está expulsado`); return; }
  pushSnap();
  S.stats[name].tarjetasRojas++;
  flashEl(btnEl, 'flash-red');
  expulsar(name, 'Tarjeta Roja Directa');
  renderTableIfOpen(); debouncedSave();
}

function expulsar(name, razon) {
  S.elim[name]    = true;
  S.onField[name] = false;
  if (S.selected === name) S.selected = null;
  addLog(`🟥 ${name} EXPULSADO — ${razon}`);
  renderBadge(); renderPlayers(); renderPositionSelector();
  toast(`${name} expulsado 🟥`);
}

// ── Score ─────────────────────────────────────────────────
function teamScore() {
  return S.players.reduce((n, p) => {
    const st = S.stats[p];
    return n + (st.golesM || 0) + (st.tirosLibresM || 0) + (st.penalesM || 0);
  }, 0);
}

// ── Log ───────────────────────────────────────────────────
function addLog(msg) {
  LOG.unshift(`[${displayTime()}] ${msg}`);
  if (LOG.length > 60) LOG.pop();
  renderLog();
}

// ── Visual feedback ───────────────────────────────────────
function flashEl(el, cls) {
  if (!el) return;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 450);
}

function pulseScore() {
  const el = document.getElementById('team-score');
  if (!el) return;
  el.classList.add('score-pulse');
  setTimeout(() => el.classList.remove('score-pulse'), 600);
}

// ── Render ────────────────────────────────────────────────
function render() {
  renderClock(); renderClockBtn(); renderScore(); renderRivalLabel();
  renderBadge(); renderPlayers(); renderLog();
  renderPositionSelector(); renderTableIfOpen();
  const inp = document.getElementById('game-name');
  if (inp) inp.value = S.gameName || '';
}

function renderClock() {
  const el = document.getElementById('clock');
  const hi = document.getElementById('half-pill');
  if (!el) return;
  const limit  = HALF_LIMIT[S.half] || 45 * 60;
  const over   = S.secsElapsed > limit;
  const base   = HALF_OFFSET[S.half] || 0;
  const normal = fmt(base + Math.min(S.secsElapsed, limit));
  el.textContent = over ? `${normal}+${fmt(S.secsElapsed - limit)}` : normal;
  el.classList.toggle('overtime', over);
  hi.textContent = HALF_NAME[S.half];
}

function renderClockBtn() {
  const btn = document.getElementById('btn-clock');
  if (!btn) return;
  btn.textContent = S.clockRunning ? '⏸ Pausar' : '▶ Iniciar';
  btn.classList.toggle('running', S.clockRunning);
}

function renderScore() {
  const ts = document.getElementById('team-score');
  const rs = document.getElementById('rival-score');
  if (ts) ts.textContent = teamScore();
  if (rs) rs.textContent = S.rivalScore;
}

function renderRivalLabel() {
  const el = document.getElementById('rival-lbl');
  if (el) el.textContent = (S.rival || 'RIVAL').toUpperCase().slice(0, 10);
}

function renderBadge() {
  const nameEl   = document.getElementById('active-name');
  const statusEl = document.getElementById('active-status');
  const avatarEl = document.getElementById('badge-avatar');
  if (!nameEl) return;

  if (!S.selected) {
    nameEl.textContent   = 'Selecciona un jugador';
    statusEl.textContent = '— toca un jugador para registrar estadísticas —';
    if (avatarEl) { avatarEl.textContent = '?'; avatarEl.className = ''; }
    renderPositionSelector();
    return;
  }

  const n   = S.selected;
  const st  = S.stats[n];
  const idx = S.players.indexOf(n) + 1;
  const pos = S.positions[n] || '';

  if (avatarEl) {
    avatarEl.textContent = idx || '?';
    avatarEl.className   = S.elim[n] ? 'expulsado' : S.onField[n] ? 'on-field' : '';
  }

  nameEl.textContent = n + (pos ? `  [${pos}]` : '');

  const parts = [];
  if (S.elim[n])          parts.push('🟥 EXPULSADO');
  else if (S.onField[n])  parts.push('🟢 En campo');
  else                    parts.push('⚪ Banca');

  if (st.tarjetasAmarillas === 1) parts.push('🟨 1 amarilla');
  if (st.tarjetasAmarillas >= 2)  parts.push('🟨🟨 2 amarillas');

  const gol = (st.golesM || 0) + (st.tirosLibresM || 0) + (st.penalesM || 0);
  if (gol > 0)            parts.push(`⚽ ${gol} gol${gol > 1 ? 'es' : ''}`);
  if (st.asistencias > 0) parts.push(`🅰️ ${st.asistencias}`);

  statusEl.textContent = parts.join('  ·  ');
  renderPositionSelector();
}

function renderPlayers() {
  const c = document.getElementById('player-list');
  if (!c) return;
  c.innerHTML = S.players.map((p, i) => {
    const sel  = S.selected === p;
    const on   = S.onField[p] && !S.elim[p];
    const dead = S.elim[p];
    const am   = S.stats[p]?.tarjetasAmarillas || 0;
    const gol  = (S.stats[p]?.golesM||0)+(S.stats[p]?.tirosLibresM||0)+(S.stats[p]?.penalesM||0);
    const pos  = S.positions[p] || '';

    let cardBadge = '';
    if (dead || am >= 2)   cardBadge = '<span class="pi-card red">🟥</span>';
    else if (am === 1)     cardBadge = '<span class="pi-card yellow">🟨</span>';

    const golBadge = gol > 0 ? `<span class="pi-goals">⚽${gol}</span>` : '';
    const posBadge = pos ? `<span class="pi-pos pos-${pos}">${pos}</span>` : '';

    return `<div class="pi${sel?' selected':''}${dead?' elim':''}${on?' on-field':''}">
      <button class="pi-sel" data-player="${esc(p)}" data-action="select">
        <span class="pi-num">${i+1}</span>
        <span class="pi-name">${esc(p)}</span>
        ${posBadge}${cardBadge}${golBadge}
      </button>
      <button class="pi-field${on?' on':''}" data-player="${esc(p)}" data-action="field"
              title="${on?'Sacar del campo':'Poner en campo'}">${on?'🟢':'⚪'}</button>
    </div>`;
  }).join('');
}

function renderLog() {
  const c = document.getElementById('log-entries');
  if (!c) return;
  if (!LOG.length) { c.innerHTML = '<div class="log-empty">Sin acciones aún</div>'; return; }
  c.innerHTML = LOG.map(e => `<div class="log-entry">${esc(e)}</div>`).join('');
}

function renderTableIfOpen() {
  if (!tableOpen) return;
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('stats-tbody');
  if (!tbody) return;
  tbody.innerHTML = S.players.map(p => {
    const st  = S.stats[p];
    const min = Math.floor((S.secs[p] || 0) / 60);
    const gol = (st.golesM||0)+(st.tirosLibresM||0)+(st.penalesM||0);
    const pct = (m, a) => a > 0 ? Math.round(m/a*100)+'%' : '—';
    const pos = S.positions[p] || '—';
    return `<tr class="${S.elim[p]?'row-elim':S.onField[p]?'row-on':''}">
      <td class="scol"><span class="tbl-num">${S.players.indexOf(p)+1}</span>${esc(p)}</td>
      <td><span class="tbl-pos pos-${pos}">${pos}</span></td>
      <td>${min}</td>
      <td class="td-bold">${gol}</td>
      <td>${st.golesM}/${st.golesA}</td>
      <td>${st.tirosLibresM}/${st.tirosLibresA}</td>
      <td>${st.penalesM}/${st.penalesA}</td>
      <td>${pct(st.golesM,st.golesA)}</td>
      <td>${pct(st.tirosLibresM,st.tirosLibresA)}</td>
      <td>${pct(st.penalesM,st.penalesA)}</td>
      <td>${st.asistencias}</td>
      <td>${st.faltasCometidas}</td>
      <td>${st.faltasRecibidas}</td>
      <td class="${st.tarjetasAmarillas>0?'c-am':''}">${st.tarjetasAmarillas}</td>
      <td class="${st.tarjetasRojas>0?'c-ro':''}">${st.tarjetasRojas}</td>
      <td>${st.fueraLugar}</td>
      <td>${st.recuperaciones}</td>
      <td>${st.perdidas}</td>
    </tr>`;
  }).join('');
}

// ── Penalty Shootout ──────────────────────────────────────
function openPenaltyModal() {
  PS = { titans: [], rival: [] };
  populatePenaltyPlayerSelect();
  renderPenaltyTable();
  document.getElementById('pen-winner').classList.add('hidden');
  document.getElementById('penalty-modal').classList.remove('hidden');
}

function closePenaltyModal() {
  document.getElementById('penalty-modal').classList.add('hidden');
}

function populatePenaltyPlayerSelect() {
  const sel = document.getElementById('pen-player-select');
  if (!sel) return;
  sel.innerHTML = S.players
    .filter(p => !S.elim[p])
    .map(p => `<option value="${esc(p)}">${esc(p)}</option>`)
    .join('');
}

function addPenaltyKick(team, made) {
  if (team === 'titans') {
    const player = document.getElementById('pen-player-select')?.value || '—';
    PS.titans.push({ player, made });
    addLog(`⚽ Penal ${made ? '✓' : '✗'} — Titans (${player})`);
  } else {
    PS.rival.push({ made });
    addLog(`⚽ Penal ${made ? '✓' : '✗'} — ${S.rival || 'Rival'}`);
  }
  renderPenaltyTable();
  checkPenaltyWinner();
}

function undoPenaltyKick() {
  // Remove last kick from whichever team kicked last
  if (PS.titans.length > PS.rival.length) PS.titans.pop();
  else if (PS.rival.length > 0) PS.rival.pop();
  else if (PS.titans.length > 0) PS.titans.pop();
  LOG.shift();
  renderPenaltyTable();
  document.getElementById('pen-winner').classList.add('hidden');
}

function penScore() {
  const t = PS.titans.filter(k => k.made).length;
  const r = PS.rival.filter(k => k.made).length;
  return { t, r };
}

function checkPenaltyWinner() {
  const { t, r } = penScore();
  const maxKicks = Math.max(PS.titans.length, PS.rival.length);
  if (maxKicks < 3) return; // need at least 3 kicks per side for meaningful check

  const tRemaining = Math.max(0, 5 - PS.titans.length);
  const rRemaining = Math.max(0, 5 - PS.rival.length);

  const winnerEl = document.getElementById('pen-winner');
  // Titans wins if rival can't catch up
  if (t > r + rRemaining && PS.titans.length >= PS.rival.length) {
    winnerEl.textContent = `🏆 ¡TITANS GANA ${t}–${r}!`;
    winnerEl.className   = 'pen-winner win-titans';
  // Rival wins if titans can't catch up
  } else if (r > t + tRemaining && PS.rival.length >= PS.titans.length) {
    winnerEl.textContent = `💀 ${S.rival || 'Rival'} gana ${r}–${t}`;
    winnerEl.className   = 'pen-winner win-rival';
  } else if (PS.titans.length >= 5 && PS.rival.length >= 5 && PS.titans.length === PS.rival.length) {
    if (t === r) {
      winnerEl.textContent = '🔄 Muerte súbita — continúa...';
      winnerEl.className   = 'pen-winner win-draw';
    } else if (t > r) {
      winnerEl.textContent = `🏆 ¡TITANS GANA ${t}–${r}!`;
      winnerEl.className   = 'pen-winner win-titans';
    } else {
      winnerEl.textContent = `💀 ${S.rival || 'Rival'} gana ${r}–${t}`;
      winnerEl.className   = 'pen-winner win-rival';
    }
  } else { winnerEl.classList.add('hidden'); return; }
  winnerEl.classList.remove('hidden');
}

function renderPenaltyTable() {
  const { t, r } = penScore();
  const scoreEl = document.getElementById('pen-score-display');
  if (scoreEl) scoreEl.textContent = `Titans ${t} — ${r} ${S.rival || 'Rival'}`;

  const tbody = document.getElementById('penalty-tbody');
  if (!tbody) return;

  const maxRows = Math.max(PS.titans.length, PS.rival.length, 5);
  let rows = '';
  for (let i = 0; i < maxRows; i++) {
    const tk = PS.titans[i];
    const rk = PS.rival[i];
    const tCell = tk
      ? `<span class="pen-player">${esc(tk.player)}</span> <span class="pen-result ${tk.made?'made':'miss'}">${tk.made?'✓':'✗'}</span>`
      : '<span class="pen-empty">·</span>';
    const rCell = rk
      ? `<span class="pen-result ${rk.made?'made':'miss'}">${rk.made?'✓':'✗'}</span>`
      : '<span class="pen-empty">·</span>';
    rows += `<tr><td class="pen-num">${i+1}</td><td class="pen-t">${tCell}</td><td class="pen-sep">│</td><td class="pen-r">${rCell}</td></tr>`;
  }
  tbody.innerHTML = rows;
}

// ── Season Stats ──────────────────────────────────────────
function loadSeason() {
  try {
    return JSON.parse(localStorage.getItem(SEASON_KEY)) || { games: [] };
  } catch(_) { return { games: [] }; }
}

function saveGameToSeason() {
  const season = loadSeason();
  const ts = teamScore();
  const game = {
    id:         Date.now(),
    date:       new Date().toLocaleDateString('es'),
    name:       S.gameName || 'Partido',
    rival:      S.rival || 'Rival',
    teamScore:  ts,
    rivalScore: S.rivalScore,
    result:     ts > S.rivalScore ? 'V' : ts < S.rivalScore ? 'D' : 'E',
    playerStats: Object.fromEntries(S.players.map(p => [p, {
      ...S.stats[p],
      mins: Math.floor((S.secs[p]||0)/60),
      pos:  S.positions[p] || ''
    }]))
  };
  season.games.push(game);
  localStorage.setItem(SEASON_KEY, JSON.stringify(season));
  toast('Partido guardado en temporada 📅');
  renderSeasonContent();
}

function clearSeason() {
  if (!confirm('¿Limpiar todas las estadísticas de temporada? Esta acción no se puede deshacer.')) return;
  localStorage.removeItem(SEASON_KEY);
  renderSeasonContent();
  toast('Temporada limpiada 🗑️');
}

function openSeasonModal() {
  renderSeasonContent();
  document.getElementById('season-modal').classList.remove('hidden');
}

function closeSeasonModal() {
  document.getElementById('season-modal').classList.add('hidden');
}

function renderSeasonContent() {
  const container = document.getElementById('season-content');
  if (!container) return;
  const season = loadSeason();
  const games  = season.games || [];

  if (!games.length) {
    container.innerHTML = '<div class="season-empty">No hay partidos guardados aún.<br>Juega un partido y toca <b>💾 Guardar partido actual</b>.</div>';
    return;
  }

  // Record summary
  const wins   = games.filter(g => g.result === 'V').length;
  const draws  = games.filter(g => g.result === 'E').length;
  const losses = games.filter(g => g.result === 'D').length;
  const gf     = games.reduce((n, g) => n + g.teamScore, 0);
  const gc     = games.reduce((n, g) => n + g.rivalScore, 0);

  // Accumulate per-player stats across all games
  const allPlayers = [...new Set(games.flatMap(g => Object.keys(g.playerStats)))];
  const totals = {};
  allPlayers.forEach(p => {
    totals[p] = { mins:0, gol:0, ast:0, rec:0, fc:0, am:0, ro:0 };
  });
  games.forEach(g => {
    Object.entries(g.playerStats).forEach(([p, st]) => {
      if (!totals[p]) totals[p] = { mins:0, gol:0, ast:0, rec:0, fc:0, am:0, ro:0 };
      totals[p].mins += st.mins || 0;
      totals[p].gol  += (st.golesM||0)+(st.tirosLibresM||0)+(st.penalesM||0);
      totals[p].ast  += st.asistencias || 0;
      totals[p].rec  += st.recuperaciones || 0;
      totals[p].fc   += st.faltasCometidas || 0;
      totals[p].am   += st.tarjetasAmarillas || 0;
      totals[p].ro   += st.tarjetasRojas || 0;
    });
  });

  const sortedPlayers = allPlayers.sort((a,b) => totals[b].gol - totals[a].gol);

  const gameRows = [...games].reverse().map(g => {
    const icon = g.result === 'V' ? '✅' : g.result === 'D' ? '❌' : '➖';
    return `<tr>
      <td>${g.date}</td>
      <td>${esc(g.name)}</td>
      <td>vs ${esc(g.rival)}</td>
      <td>${g.teamScore}–${g.rivalScore}</td>
      <td>${icon} ${g.result === 'V' ? 'Victoria' : g.result === 'D' ? 'Derrota' : 'Empate'}</td>
    </tr>`;
  }).join('');

  const playerRows = sortedPlayers.map(p => {
    const t = totals[p];
    return `<tr>
      <td style="text-align:left;font-weight:600">${esc(p)}</td>
      <td>${t.mins}</td><td class="td-bold">${t.gol}</td>
      <td>${t.ast}</td><td>${t.rec}</td>
      <td>${t.fc}</td>
      <td class="${t.am>0?'c-am':''}">${t.am}</td>
      <td class="${t.ro>0?'c-ro':''}">${t.ro}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="season-record">
      <div class="sr-card wins">  <div class="sr-v">${wins}</div>  <div class="sr-l">Victorias</div></div>
      <div class="sr-card draws"> <div class="sr-v">${draws}</div> <div class="sr-l">Empates</div></div>
      <div class="sr-card losses"><div class="sr-v">${losses}</div><div class="sr-l">Derrotas</div></div>
      <div class="sr-card gf">   <div class="sr-v">${gf}</div>    <div class="sr-l">Goles A favor</div></div>
      <div class="sr-card gc">   <div class="sr-v">${gc}</div>    <div class="sr-l">Goles En contra</div></div>
    </div>

    <div class="season-section-title">Historial de Partidos</div>
    <div class="table-scroll">
      <table class="season-tbl">
        <thead><tr><th>Fecha</th><th>Partido</th><th>Rival</th><th>Resultado</th><th>Estado</th></tr></thead>
        <tbody>${gameRows}</tbody>
      </table>
    </div>

    <div class="season-section-title">Estadísticas Acumuladas</div>
    <div class="table-scroll">
      <table class="season-tbl">
        <thead><tr><th>Jugador</th><th>MIN</th><th>GOL</th><th>AST</th><th>REC</th><th>FC</th><th>T.AM</th><th>T.RO</th></tr></thead>
        <tbody>${playerRows}</tbody>
      </table>
    </div>
  `;
}

// ── Report ────────────────────────────────────────────────
function generateReport() {
  const rival = prompt('Nombre del equipo rival:', S.rival || 'Rival') || S.rival || 'Rival';
  S.rival = rival; renderRivalLabel();

  const ts = teamScore(), rs = S.rivalScore;
  const result = ts > rs ? 'Victoria' : ts < rs ? 'Derrota' : 'Empate';
  const rColor = ts > rs ? '#27ae60' : ts < rs ? '#c0392b' : '#f39c12';

  const pd = S.players.map(p => {
    const st   = S.stats[p];
    const min  = Math.floor((S.secs[p] || 0) / 60);
    const gol  = (st.golesM||0)+(st.tirosLibresM||0)+(st.penalesM||0);
    const totalA = (st.golesA||0)+(st.tirosLibresA||0)+(st.penalesA||0);
    return { p, min, gol, totalA, st, pos: S.positions[p]||'' };
  });

  const totalGol  = pd.reduce((n,x) => n+x.gol, 0);
  const totalTiro = pd.reduce((n,x) => n+x.totalA, 0);
  const efect     = totalTiro > 0 ? Math.round(totalGol/totalTiro*100) : 0;
  const totalFC   = pd.reduce((n,x) => n+x.st.faltasCometidas, 0);
  const totalPerd = pd.reduce((n,x) => n+x.st.perdidas, 0);
  const totalCard = pd.reduce((n,x) => n+x.st.tarjetasAmarillas+x.st.tarjetasRojas, 0);
  const totalAST  = pd.reduce((n,x) => n+x.st.asistencias, 0);
  const totalREC  = pd.reduce((n,x) => n+x.st.recuperaciones, 0);

  const topGol = [...pd].sort((a,b) => b.gol-a.gol)[0];
  const topAST = [...pd].sort((a,b) => b.st.asistencias-a.st.asistencias)[0];
  const topREC = [...pd].sort((a,b) => b.st.recuperaciones-a.st.recuperaciones)[0];

  // Substitutions section
  const subSection = S.substitutions.length
    ? `<h2>Sustituciones</h2><ul>${S.substitutions.map(s =>
        `<li>[${s.min}] <b>${esc(s.playerOut)}</b> salió → <b>${esc(s.playerIn)}</b> entró</li>`
      ).join('')}</ul>`
    : '';

  const tableRows = pd.map(({p, min, gol, st, pos}) => {
    const pT  = st.golesA>0        ? Math.round(st.golesM/st.golesA*100)+'%'              : '—';
    const pTL = st.tirosLibresA>0  ? Math.round(st.tirosLibresM/st.tirosLibresA*100)+'%' : '—';
    const pP  = st.penalesA>0      ? Math.round(st.penalesM/st.penalesA*100)+'%'          : '—';
    return `<tr>
      <td style="text-align:left;font-weight:600">${pos?`<span style="background:#333;color:#aaa;padding:1px 5px;border-radius:3px;font-size:.8em">${pos}</span> `:''  }${esc(p)}</td>
      <td>${min}</td><td><b>${gol}</b></td>
      <td>${st.golesM}/${st.golesA}</td><td>${st.tirosLibresM}/${st.tirosLibresA}</td><td>${st.penalesM}/${st.penalesA}</td>
      <td>${pT}</td><td>${pTL}</td><td>${pP}</td>
      <td>${st.asistencias}</td><td>${st.faltasCometidas}</td><td>${st.faltasRecibidas}</td>
      <td style="color:${st.tarjetasAmarillas>0?'#e6b800':'inherit'}">${st.tarjetasAmarillas}</td>
      <td style="color:${st.tarjetasRojas>0?'#c0392b':'inherit'}">${st.tarjetasRojas}</td>
      <td>${st.fueraLugar}</td><td>${st.recuperaciones}</td><td>${st.perdidas}</td>
    </tr>`;
  }).join('');

  const recom = [];
  if (efect < 30)    recom.push('Mejorar la definición — practicar tiro al arco en entrenamiento.');
  if (totalPerd > 5) recom.push('Reducir pérdidas de balón — mejorar distribución bajo presión.');
  if (totalFC > 10)  recom.push('Reducir faltas cometidas para evitar tiros libres en contra.');
  if (totalCard > 3) recom.push('Mejorar la disciplina — alto número de tarjetas en este partido.');
  if (result === 'Victoria') recom.push('Excelente rendimiento colectivo — mantener el nivel.');
  if (result === 'Derrota')  recom.push('Analizar las fases defensivas y ofensivas del partido.');
  recom.push('Continuar reforzando la comunicación y el trabajo en equipo.');

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Reporte — ${esc(S.gameName)}</title>
<style>*{box-sizing:border-box}body{font-family:-apple-system,Arial,sans-serif;max-width:980px;margin:0 auto;padding:28px;color:#222}
h1{color:#c0392b;text-align:center;font-size:1.8em;margin-bottom:2px}h2{color:#2c3e50;border-bottom:3px solid #c0392b;padding-bottom:6px;margin-top:30px}
.sub{text-align:center;color:#888;margin-bottom:20px}.scoreboard{text-align:center;background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;border-radius:16px;padding:24px;margin:20px 0}
.scoreboard .teams{display:flex;justify-content:center;align-items:center;gap:20px;font-size:3em;font-weight:800}.scoreboard .result{font-size:1.2em;margin-top:8px;color:${rColor};font-weight:700}
.cards{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin:16px 0}.card{background:#f8f9fa;border:1px solid #dee2e6;border-radius:10px;padding:12px 18px;text-align:center;min-width:80px}
.card .v{font-size:1.8em;font-weight:800;color:#c0392b}.card .l{font-size:.78em;color:#666;margin-top:3px}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:.8em}th{background:#2c3e50;color:white;padding:7px 5px;white-space:nowrap;font-size:.78em}
td{padding:5px;border-bottom:1px solid #eee;text-align:center}tr:nth-child(even){background:#f9f9f9}
.recs{background:#eef6ff;border-left:4px solid #3498db;padding:14px 18px;border-radius:4px}.recs ul{margin:8px 0 0 18px}.recs li{margin:5px 0;line-height:1.5}
.no-print{text-align:center;margin-bottom:20px}.pbtn{background:#c0392b;color:white;border:none;padding:12px 28px;font-size:1em;border-radius:8px;cursor:pointer;font-weight:600}
@media print{.no-print{display:none}}</style></head><body>
<div class="no-print"><button class="pbtn" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button></div>
<h1>⚽ Football Titans Tracker</h1><p class="sub">${esc(S.gameName)} · ${new Date().toLocaleDateString('es')}</p>
<div class="scoreboard"><div class="teams">Titans ${ts} — ${rs} ${esc(rival)}</div><div class="result">${result}</div></div>
<h2>Resumen Ejecutivo</h2>
<p>El equipo ${result==='Victoria'?'consiguió una <b>victoria</b>':result==='Derrota'?'cayó en <b>derrota</b>':'<b>igualó</b>'} ${ts}–${rs} ante ${esc(rival)}.
${topGol?.gol>0?`Máximo goleador: <b>${esc(topGol.p)}</b> con ${topGol.gol} gol${topGol.gol>1?'es':''}.`:'El equipo no anotó goles.'}
${topAST?.st.asistencias>0?`<b>${esc(topAST.p)}</b> lideró en asistencias con ${topAST.st.asistencias}.`:''}
Efectividad de tiro: <b>${efect}%</b> (${totalGol}/${totalTiro}).
${totalCard>0?`Se recibieron <b>${totalCard}</b> tarjeta${totalCard>1?'s':''}.`:'Sin tarjetas — excelente disciplina. ✅'}</p>
<h2>Estadísticas del Equipo</h2>
<div class="cards">
<div class="card"><div class="v">${totalGol}</div><div class="l">Goles</div></div>
<div class="card"><div class="v">${totalTiro}</div><div class="l">Tiros</div></div>
<div class="card"><div class="v">${efect}%</div><div class="l">Efectividad</div></div>
<div class="card"><div class="v">${totalAST}</div><div class="l">Asistencias</div></div>
<div class="card"><div class="v">${totalREC}</div><div class="l">Recuperaciones</div></div>
<div class="card"><div class="v">${totalPerd}</div><div class="l">Pérdidas</div></div>
<div class="card"><div class="v">${totalFC}</div><div class="l">Faltas Comet.</div></div>
<div class="card"><div class="v">${totalCard}</div><div class="l">Tarjetas</div></div>
</div>
${subSection}
<h2>Estadísticas Individuales</h2>
<table><thead><tr><th>Jugador</th><th>MIN</th><th>GOL</th><th>T M/A</th><th>TL M/A</th><th>P M/A</th>
<th>%T</th><th>%TL</th><th>%P</th><th>AST</th><th>FC</th><th>FR</th><th>T.AM</th><th>T.RO</th><th>FUERA</th><th>REC</th><th>PERD</th>
</tr></thead><tbody>${tableRows}</tbody></table>
<h2>Mejores del Partido</h2>
${topGol?.gol>0?`<p>⚽ <b>Máximo Goleador:</b> ${esc(topGol.p)} — ${topGol.gol} gol${topGol.gol>1?'es':''}</p>`:''}
${topAST?.st.asistencias>0?`<p>🅰️ <b>Mejor Asistidor:</b> ${esc(topAST.p)} — ${topAST.st.asistencias}</p>`:''}
${topREC?.st.recuperaciones>0?`<p>🛡️ <b>Más Recuperaciones:</b> ${esc(topREC.p)} — ${topREC.st.recuperaciones}</p>`:''}
<h2>Recomendaciones</h2>
<div class="recs"><ul>${recom.map(r=>`<li>${r}</li>`).join('')}</ul></div>
<p style="text-align:center;color:#bbb;margin-top:30px;font-size:.75em">Football Titans Tracker · ${new Date().toLocaleString('es')}</p>
</body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html); w.document.close();
}

// ── New Game ──────────────────────────────────────────────
function newGame() {
  if (!confirm('¿Iniciar nuevo partido? Las estadísticas actuales se borrarán.')) return;
  // Offer to save to season first
  if (teamScore() > 0 || S.rivalScore > 0) {
    if (confirm('¿Guardar este partido en la temporada antes de continuar?')) {
      saveGameToSeason();
    }
  }
  const rival = prompt('Nombre del equipo rival:', S.rival || 'Rival') || 'Rival';
  const name  = prompt('Nombre del partido:', 'Partido') || 'Partido';
  if (S.clockRunning) toggleClock();
  const players = [...S.players];
  const oldPos  = { ...S.positions };
  S = initState(players);
  // Preserve positions across games
  players.forEach(p => { if (oldPos[p]) S.positions[p] = oldPos[p]; });
  S.rival = rival; S.gameName = name;
  LOG = []; PS = { titans: [], rival: [] };
  render(); persist();
  toast('¡Nuevo partido iniciado! ⚽');
}

// ── Save / Load ───────────────────────────────────────────
function saveGame() { persist(); toast('Guardado ✓'); }

function loadGame() {
  if (!confirm('¿Cargar la última partida guardada?')) return;
  if (loadFromStorage()) {
    if (S.clockRunning) { S.clockRunning = false; clockTimer = null; }
    render(); toast('Partida cargada ✓');
  } else {
    toast('No hay partida guardada');
  }
}

// ── Toast ─────────────────────────────────────────────────
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2800);
}

// ── Utility ───────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// ── Events ────────────────────────────────────────────────
function bindEvents() {
  // Clock
  document.getElementById('btn-clock').addEventListener('click', toggleClock);
  document.getElementById('btn-half').addEventListener('click', nextHalf);

  // Player list (event delegation — no inline onclick)
  document.getElementById('player-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();
    const p = btn.dataset.player;
    if (btn.dataset.action === 'select') selectPlayer(p);
    if (btn.dataset.action === 'field')  toggleField(p);
  });

  // Position selector
  document.getElementById('position-selector').addEventListener('click', e => {
    const btn = e.target.closest('.pos-btn');
    if (!btn || !S.selected) return;
    setPosition(S.selected, btn.dataset.pos);
  });

  // Control buttons
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-save').addEventListener('click', saveGame);
  document.getElementById('btn-load').addEventListener('click', loadGame);
  document.getElementById('btn-report').addEventListener('click', generateReport);
  document.getElementById('btn-new').addEventListener('click', newGame);
  document.getElementById('btn-add').addEventListener('click', addPlayer);
  document.getElementById('btn-remove').addEventListener('click', removePlayer);
  document.getElementById('btn-sub').addEventListener('click', openSubModal);
  document.getElementById('btn-penalty').addEventListener('click', openPenaltyModal);
  document.getElementById('btn-season').addEventListener('click', openSeasonModal);

  // Stats table toggle
  document.getElementById('btn-table').addEventListener('click', () => {
    tableOpen = !tableOpen;
    document.getElementById('stats-panel').classList.toggle('hidden', !tableOpen);
    document.getElementById('btn-table').classList.toggle('active', tableOpen);
    if (tableOpen) renderTable();
  });
  document.getElementById('btn-close-table').addEventListener('click', () => {
    tableOpen = false;
    document.getElementById('stats-panel').classList.add('hidden');
    document.getElementById('btn-table').classList.remove('active');
  });

  // Game name & rival score
  document.getElementById('game-name').addEventListener('input', e => {
    S.gameName = e.target.value; debouncedSave();
  });
  document.getElementById('rival-minus').addEventListener('click', () => {
    if (S.rivalScore > 0) { S.rivalScore--; renderScore(); debouncedSave(); }
  });
  document.getElementById('rival-plus').addEventListener('click', () => {
    S.rivalScore++; renderScore(); debouncedSave();
  });

  // Shot buttons
  document.querySelectorAll('.sbtn.made').forEach(btn =>
    btn.addEventListener('click', () => recordShot(btn.dataset.type, true, btn)));
  document.querySelectorAll('.sbtn.missed').forEach(btn =>
    btn.addEventListener('click', () => recordShot(btn.dataset.type, false, btn)));

  // Stat buttons
  document.querySelectorAll('.stbtn').forEach(btn =>
    btn.addEventListener('click', () => recordStat(btn.dataset.stat, btn)));

  // Substitution modal
  document.getElementById('sub-confirm').addEventListener('click', confirmSub);
  document.getElementById('sub-cancel').addEventListener('click', closeSubModal);
  document.getElementById('sub-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('sub-modal')) closeSubModal();
  });

  // Penalty modal
  document.getElementById('pen-titans-made').addEventListener('click', () => addPenaltyKick('titans', true));
  document.getElementById('pen-titans-miss').addEventListener('click', () => addPenaltyKick('titans', false));
  document.getElementById('pen-rival-made').addEventListener('click',  () => addPenaltyKick('rival', true));
  document.getElementById('pen-rival-miss').addEventListener('click',  () => addPenaltyKick('rival', false));
  document.getElementById('pen-undo').addEventListener('click', undoPenaltyKick);
  document.getElementById('pen-close').addEventListener('click', closePenaltyModal);
  document.getElementById('penalty-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('penalty-modal')) closePenaltyModal();
  });

  // Season modal
  document.getElementById('season-save').addEventListener('click', saveGameToSeason);
  document.getElementById('season-clear').addEventListener('click', clearSeason);
  document.getElementById('season-close').addEventListener('click', closeSeasonModal);
  document.getElementById('season-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('season-modal')) closeSeasonModal();
  });
}

// ── Init ─────────────────────────────────────────────────
function init() {
  if (!loadFromStorage()) {
    S = initState(DEFAULT_PLAYERS);
  } else if (S.clockRunning) {
    S.clockRunning = false; clockTimer = null;
  }
  bindEvents();
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
