'use strict';

const STORAGE_KEY = 'ftt-v1';
const MAX_HIST    = 20;
const SAVE_DELAY  = 1500;

const HALF_OFFSET = { 1: 0, 2: 45 * 60, 3: 90 * 60 };
const HALF_LIMIT  = { 1: 45 * 60, 2: 45 * 60, 3: 30 * 60 };
const HALF_NAME   = { 1: '1T', 2: '2T', 3: 'TE' };

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

// ── State ──────────────────────────────────────────────────

let S = null;
let LOG = [];
let clockTimer = null;
let saveTimer  = null;
let tableOpen  = false;

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
  const stats = {}, secs = {}, onField = {}, elim = {};
  players.forEach(p => {
    stats[p] = mkStats();
    secs[p] = 0;
    onField[p] = false;
    elim[p] = false;
  });
  return {
    gameName: 'Partido', rival: 'Rival',
    half: 1, secsElapsed: 0, clockRunning: false,
    rivalScore: 0, players: [...players],
    stats, secs, onField, elim,
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
    return true;
  } catch(_) { return false; }
}

// ── Undo ──────────────────────────────────────────────────

function snap() {
  return JSON.parse(JSON.stringify({
    stats: S.stats, onField: S.onField,
    elim: S.elim, secs: S.secs, rivalScore: S.rivalScore
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
  toast('Acción deshecha');
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
  if (S.half >= 3) { toast('Ya es Tiempo Extra'); return; }
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
  renderBadge(); renderPlayers();
}

function toggleField(name) {
  if (S.elim[name]) { toast(`${name} está expulsado`); return; }
  S.onField[name] = !S.onField[name];
  addLog(`${name}: ${S.onField[name] ? 'Entra al campo ⬆' : 'Sale del campo ⬇'}`);
  renderBadge(); renderPlayers(); debouncedSave();
}

function addPlayer() {
  const name = prompt('Nombre del nuevo jugador:');
  if (!name || !name.trim()) return;
  const n = name.trim();
  if (S.players.includes(n)) { toast('Jugador ya existe'); return; }
  S.players.push(n);
  S.stats[n] = mkStats();
  S.secs[n] = 0; S.onField[n] = false; S.elim[n] = false;
  addLog(`Jugador agregado: ${n}`);
  render(); debouncedSave();
}

function removePlayer() {
  if (!S.selected) { toast('Selecciona un jugador primero'); return; }
  if (!confirm(`¿Eliminar a ${S.selected} del partido?`)) return;
  const name = S.selected;
  S.players = S.players.filter(p => p !== name);
  delete S.stats[name]; delete S.secs[name];
  delete S.onField[name]; delete S.elim[name];
  S.selected = S.players[0] || null;
  addLog(`Jugador removido: ${name}`);
  render(); debouncedSave();
}

// ── Stats ─────────────────────────────────────────────────

function requirePlayer() {
  if (!S.selected) { toast('Selecciona un jugador'); return false; }
  if (S.elim[S.selected]) { toast(`${S.selected} está expulsado`); return false; }
  return true;
}

function recordShot(type, made) {
  if (!requirePlayer()) return;
  pushSnap();
  const p = S.selected;
  if (made) {
    S.stats[p][`${type}M`]++;
    S.stats[p][`${type}A`]++;
    addLog(`✓ ${p}: ${SHOT_LABEL[type]} — GOL`);
  } else {
    S.stats[p][`${type}A`]++;
    addLog(`✗ ${p}: ${SHOT_LABEL[type]} — fallado`);
  }
  renderScore(); renderTableIfOpen(); debouncedSave();
}

function recordStat(type) {
  if (!requirePlayer()) return;
  const p = S.selected;
  if (type === 'tarjetasAmarillas') { handleYellow(p); return; }
  if (type === 'tarjetasRojas')     { handleDirectRed(p); return; }
  pushSnap();
  S.stats[p][type]++;
  addLog(`${p}: ${STAT_LABEL[type]}`);
  renderBadge(); renderTableIfOpen(); debouncedSave();
}

function handleYellow(name) {
  pushSnap();
  S.stats[name].tarjetasAmarillas++;
  if (S.stats[name].tarjetasAmarillas >= 2) {
    S.stats[name].tarjetasRojas++;
    expulsar(name, '2 Amarillas → Roja');
  } else {
    addLog(`🟨 ${name}: Tarjeta Amarilla (${S.stats[name].tarjetasAmarillas}/2)`);
    renderBadge();
  }
  renderTableIfOpen(); debouncedSave();
}

function handleDirectRed(name) {
  if (S.elim[name]) { toast(`${name} ya está expulsado`); return; }
  pushSnap();
  S.stats[name].tarjetasRojas++;
  expulsar(name, 'Tarjeta Roja Directa');
  renderTableIfOpen(); debouncedSave();
}

function expulsar(name, razon) {
  S.elim[name] = true;
  S.onField[name] = false;
  if (S.selected === name) S.selected = null;
  addLog(`🟥 ${name}: EXPULSADO — ${razon}`);
  renderBadge(); renderPlayers();
}

// ── Score ─────────────────────────────────────────────────

function teamScore() {
  return S.players.reduce((n, p) => {
    const st = S.stats[p];
    return n + (st.golesM||0) + (st.tirosLibresM||0) + (st.penalesM||0);
  }, 0);
}

// ── Log ───────────────────────────────────────────────────

function addLog(msg) {
  LOG.unshift(`[${displayTime()}] ${msg}`);
  if (LOG.length > 60) LOG.pop();
  renderLog();
}

// ── Render ────────────────────────────────────────────────

function render() {
  renderClock(); renderClockBtn(); renderScore();
  renderBadge(); renderPlayers(); renderLog();
  renderTableIfOpen();
  const nameInput = document.getElementById('game-name');
  if (nameInput) nameInput.value = S.gameName || '';
}

function renderClock() {
  const el = document.getElementById('clock');
  const hi = document.getElementById('half-indicator');
  if (!el) return;
  const limit = HALF_LIMIT[S.half] || 45 * 60;
  const over  = S.secsElapsed > limit;
  const base  = HALF_OFFSET[S.half] || 0;
  const normal = fmt(base + Math.min(S.secsElapsed, limit));
  el.textContent = over ? `${normal}+${fmt(S.secsElapsed - limit)}` : normal;
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

function renderBadge() {
  const nameEl   = document.getElementById('active-name');
  const statusEl = document.getElementById('active-status');
  if (!nameEl) return;
  if (!S.selected) {
    nameEl.textContent   = '— Ninguno seleccionado —';
    statusEl.textContent = '';
    return;
  }
  const n = S.selected, st = S.stats[n];
  nameEl.textContent = n;
  const parts = [];
  if (S.elim[n])       parts.push('🟥 EXPULSADO');
  else if (S.onField[n]) parts.push('🟢 En campo');
  else                   parts.push('⚪ Banca');
  if (st.tarjetasAmarillas > 0) parts.push(`🟨×${st.tarjetasAmarillas}`);
  const g = (st.golesM||0)+(st.tirosLibresM||0)+(st.penalesM||0);
  if (g > 0) parts.push(`⚽${g}`);
  statusEl.textContent = parts.join(' · ');
}

function renderPlayers() {
  const c = document.getElementById('player-list');
  if (!c) return;
  c.innerHTML = S.players.map(p => {
    const sel  = S.selected === p;
    const on   = S.onField[p];
    const dead = S.elim[p];
    return `<div class="pi${sel?' selected':''}${dead?' elim':''}">
      <button class="pi-sel" onclick="selectPlayer(${JSON.stringify(p)})">
        ${esc(p)}${dead?' 🟥':''}
      </button>
      <button class="pi-field${on?' on':''}" onclick="toggleField(${JSON.stringify(p)})">
        ${on?'🟢':'⚪'}
      </button>
    </div>`;
  }).join('');
}

function renderLog() {
  const c = document.getElementById('log-entries');
  if (!c) return;
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
    const min = Math.floor((S.secs[p]||0) / 60);
    const gol = (st.golesM||0)+(st.tirosLibresM||0)+(st.penalesM||0);
    const pct = (m, a) => a > 0 ? Math.round(m/a*100)+'%' : '—';
    const amC = st.tarjetasAmarillas > 0 ? ' class="c-am"' : '';
    const roC = st.tarjetasRojas > 0     ? ' class="c-ro"' : '';
    return `<tr class="${S.elim[p]?'row-elim':''}">
      <td class="scol">${esc(p)}</td>
      <td>${min}</td>
      <td>${gol}</td>
      <td>${st.golesM}/${st.golesA}</td>
      <td>${st.tirosLibresM}/${st.tirosLibresA}</td>
      <td>${st.penalesM}/${st.penalesA}</td>
      <td>${pct(st.golesM,st.golesA)}</td>
      <td>${pct(st.tirosLibresM,st.tirosLibresA)}</td>
      <td>${pct(st.penalesM,st.penalesA)}</td>
      <td>${st.asistencias}</td>
      <td>${st.faltasCometidas}</td>
      <td>${st.faltasRecibidas}</td>
      <td${amC}>${st.tarjetasAmarillas}</td>
      <td${roC}>${st.tarjetasRojas}</td>
      <td>${st.fueraLugar}</td>
      <td>${st.recuperaciones}</td>
      <td>${st.perdidas}</td>
    </tr>`;
  }).join('');
}

// ── Report ────────────────────────────────────────────────

function generateReport() {
  const rival = prompt('Nombre del equipo rival:', S.rival || 'Rival') || S.rival || 'Rival';
  S.rival = rival;

  const ts = teamScore(), rs = S.rivalScore;
  const result = ts > rs ? 'Victoria' : ts < rs ? 'Derrota' : 'Empate';
  const rColor = ts > rs ? '#27ae60' : ts < rs ? '#c0392b' : '#f39c12';

  const pd = S.players.map(p => {
    const st = S.stats[p];
    const min = Math.floor((S.secs[p]||0)/60);
    const gol = (st.golesM||0)+(st.tirosLibresM||0)+(st.penalesM||0);
    const totalA = (st.golesA||0)+(st.tirosLibresA||0)+(st.penalesA||0);
    return { p, min, gol, totalA, st };
  });

  const totalGol  = pd.reduce((n,x) => n+x.gol, 0);
  const totalTiro = pd.reduce((n,x) => n+x.totalA, 0);
  const efect     = totalTiro > 0 ? Math.round(totalGol/totalTiro*100) : 0;
  const totalFC   = pd.reduce((n,x) => n+x.st.faltasCometidas, 0);
  const totalPerd = pd.reduce((n,x) => n+x.st.perdidas, 0);
  const totalCard = pd.reduce((n,x) => n+x.st.tarjetasAmarillas+x.st.tarjetasRojas, 0);
  const totalAST  = pd.reduce((n,x) => n+x.st.asistencias, 0);
  const totalREC  = pd.reduce((n,x) => n+x.st.recuperaciones, 0);

  const topGol = [...pd].sort((a,b)=>b.gol-a.gol)[0];
  const topAST = [...pd].sort((a,b)=>b.st.asistencias-a.st.asistencias)[0];
  const topREC = [...pd].sort((a,b)=>b.st.recuperaciones-a.st.recuperaciones)[0];

  const rows = pd.map(({p,min,gol,st}) => {
    const pctT  = st.golesA>0 ? Math.round(st.golesM/st.golesA*100)+'%' : '—';
    const pctTL = st.tirosLibresA>0 ? Math.round(st.tirosLibresM/st.tirosLibresA*100)+'%' : '—';
    const pctP  = st.penalesA>0 ? Math.round(st.penalesM/st.penalesA*100)+'%' : '—';
    return `<tr>
      <td style="text-align:left;font-weight:600">${esc(p)}</td>
      <td>${min}</td><td><b>${gol}</b></td>
      <td>${st.golesM}/${st.golesA}</td>
      <td>${st.tirosLibresM}/${st.tirosLibresA}</td>
      <td>${st.penalesM}/${st.penalesA}</td>
      <td>${pctT}</td><td>${pctTL}</td><td>${pctP}</td>
      <td>${st.asistencias}</td><td>${st.faltasCometidas}</td><td>${st.faltasRecibidas}</td>
      <td style="color:${st.tarjetasAmarillas>0?'#e6b800':'inherit'}">${st.tarjetasAmarillas}</td>
      <td style="color:${st.tarjetasRojas>0?'#c0392b':'inherit'}">${st.tarjetasRojas}</td>
      <td>${st.fueraLugar}</td><td>${st.recuperaciones}</td><td>${st.perdidas}</td>
    </tr>`;
  }).join('');

  const recom = [];
  if (efect < 30) recom.push('Mejorar la definición — practicar tiro al arco en entrenamiento.');
  if (totalPerd > 5) recom.push('Reducir pérdidas de balón — mejorar la distribución bajo presión.');
  if (totalFC > 10) recom.push('Reducir faltas cometidas para evitar tiros libres en contra.');
  if (totalCard > 3) recom.push('Mejorar la disciplina — alto número de tarjetas.');
  if (result === 'Victoria') recom.push('Excelente rendimiento colectivo — mantener el nivel.');
  if (result === 'Derrota')  recom.push('Analizar fases defensivas y ofensivas para el próximo partido.');
  recom.push('Continuar reforzando la comunicación y el trabajo en equipo.');

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Reporte — ${esc(S.gameName)}</title>
<style>
  body{font-family:-apple-system,Arial,sans-serif;max-width:960px;margin:0 auto;padding:24px;color:#222}
  h1{color:#c0392b;text-align:center;margin-bottom:4px}
  h2{color:#2c3e50;border-bottom:2px solid #c0392b;padding-bottom:6px;margin-top:28px}
  .score{text-align:center;font-size:3.2em;font-weight:700;margin:16px 0 4px}
  .result{text-align:center;font-size:1.5em;font-weight:700;color:${rColor};margin-bottom:20px}
  .cards{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin:16px 0}
  .card{background:#f5f5f5;border:1px solid #ddd;border-radius:10px;padding:14px 20px;text-align:center;min-width:90px}
  .card .v{font-size:2em;font-weight:700;color:#c0392b}
  .card .l{font-size:.8em;color:#666;margin-top:4px}
  table{width:100%;border-collapse:collapse;margin:14px 0;font-size:.8em}
  th{background:#2c3e50;color:white;padding:7px 5px;white-space:nowrap}
  td{padding:5px;border-bottom:1px solid #eee;text-align:center}
  tr:hover{background:#fafafa}
  .recs{background:#eef6ff;border-left:4px solid #3498db;padding:14px 18px;border-radius:4px}
  .recs ul{margin:8px 0 0 18px}
  .recs li{margin:5px 0}
  .no-print{text-align:center;margin-bottom:18px}
  .pbtn{background:#c0392b;color:white;border:none;padding:11px 26px;font-size:1em;border-radius:7px;cursor:pointer}
  @media print{.no-print{display:none}}
</style></head><body>
<div class="no-print"><button class="pbtn" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button></div>
<h1>Football Titans Tracker</h1>
<p style="text-align:center;color:#888;margin-bottom:16px">${esc(S.gameName)} &nbsp;·&nbsp; ${new Date().toLocaleDateString('es')}</p>
<div class="score">Titans ${ts} &nbsp;—&nbsp; ${rs} ${esc(rival)}</div>
<div class="result">${result}</div>

<h2>Resumen Ejecutivo</h2>
<p>
  El equipo ${result === 'Victoria' ? 'consiguió una <b>victoria</b>' : result === 'Derrota' ? 'cayó en <b>derrota</b>' : 'igualó'}
  ${ts}–${rs} ante ${esc(rival)}.
  ${topGol && topGol.gol > 0 ? `Máximo goleador: <b>${esc(topGol.p)}</b> (${topGol.gol} gol${topGol.gol>1?'es':''}).` : 'El equipo no marcó goles.'}
  ${topAST && topAST.st.asistencias > 0 ? `<b>${esc(topAST.p)}</b> lideró en asistencias con ${topAST.st.asistencias}.` : ''}
  Efectividad de tiro: <b>${efect}%</b> (${totalGol}/${totalTiro}).
  ${totalCard > 0 ? `Se recibieron <b>${totalCard}</b> tarjeta${totalCard>1?'s':''}.` : 'Sin tarjetas — excelente disciplina.'}
</p>

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

<h2>Estadísticas Individuales</h2>
<table>
<thead><tr>
  <th>Jugador</th><th>MIN</th><th>GOL</th>
  <th>T M/A</th><th>TL M/A</th><th>P M/A</th>
  <th>%T</th><th>%TL</th><th>%P</th>
  <th>AST</th><th>FC</th><th>FR</th>
  <th>T.AM</th><th>T.RO</th><th>FUERA</th><th>REC</th><th>PERD</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>

<h2>Mejores del Partido</h2>
${topGol && topGol.gol > 0 ? `<p>⚽ <b>Máximo Goleador:</b> ${esc(topGol.p)} — ${topGol.gol} gol${topGol.gol>1?'es':''}</p>` : ''}
${topAST && topAST.st.asistencias > 0 ? `<p>🅰️ <b>Mejor Asistidor:</b> ${esc(topAST.p)} — ${topAST.st.asistencias} asistencia${topAST.st.asistencias>1?'s':''}</p>` : ''}
${topREC && topREC.st.recuperaciones > 0 ? `<p>🛡️ <b>Más Recuperaciones:</b> ${esc(topREC.p)} — ${topREC.st.recuperaciones}</p>` : ''}

<h2>Recomendaciones</h2>
<div class="recs"><ul>${recom.map(r=>`<li>${r}</li>`).join('')}</ul></div>

<p style="text-align:center;color:#aaa;margin-top:30px;font-size:.78em">
  Generado por Football Titans Tracker &nbsp;·&nbsp; ${new Date().toLocaleString('es')}
</p>
</body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

// ── Excel ─────────────────────────────────────────────────

function exportExcel() {
  if (typeof XLSX === 'undefined') { toast('SheetJS no disponible'); return; }
  const header = ['Jugador','MIN','GOL','T-M','T-A','%T','TL-M','TL-A','%TL','P-M','P-A','%P',
                  'AST','FC','FR','T.AM','T.RO','FUERA','REC','PERD'];
  const data = [header, ...S.players.map(p => {
    const st  = S.stats[p];
    const min = Math.floor((S.secs[p]||0)/60);
    const gol = (st.golesM||0)+(st.tirosLibresM||0)+(st.penalesM||0);
    const pct = (m,a) => a > 0 ? Math.round(m/a*100) : 0;
    return [p, min, gol,
      st.golesM, st.golesA, pct(st.golesM,st.golesA),
      st.tirosLibresM, st.tirosLibresA, pct(st.tirosLibresM,st.tirosLibresA),
      st.penalesM, st.penalesA, pct(st.penalesM,st.penalesA),
      st.asistencias, st.faltasCometidas, st.faltasRecibidas,
      st.tarjetasAmarillas, st.tarjetasRojas,
      st.fueraLugar, st.recuperaciones, st.perdidas];
  })];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Estadísticas');
  XLSX.writeFile(wb, `${S.gameName || 'partido'}-stats.xlsx`);
}

// ── New Game ──────────────────────────────────────────────

function newGame() {
  if (!confirm('¿Iniciar nuevo partido? Se borrarán las estadísticas actuales.')) return;
  const rival = prompt('Nombre del equipo rival:') || 'Rival';
  const name  = prompt('Nombre del partido:') || 'Partido';
  if (S.clockRunning) toggleClock();
  const players = [...S.players];
  S = initState(players);
  S.rival = rival; S.gameName = name;
  LOG = [];
  render(); persist();
  toast('Nuevo partido iniciado');
}

// ── Save / Load ───────────────────────────────────────────

function saveGame() {
  persist(); toast('Partida guardada ✓');
}

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
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

// ── Utility ───────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Events ───────────────────────────────────────────────

function bindEvents() {
  document.getElementById('btn-clock').addEventListener('click', toggleClock);
  document.getElementById('btn-half').addEventListener('click', nextHalf);

  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-save').addEventListener('click', saveGame);
  document.getElementById('btn-load').addEventListener('click', loadGame);
  document.getElementById('btn-report').addEventListener('click', generateReport);
  document.getElementById('btn-new').addEventListener('click', newGame);
  document.getElementById('btn-add').addEventListener('click', addPlayer);
  document.getElementById('btn-remove').addEventListener('click', removePlayer);
  document.getElementById('btn-excel').addEventListener('click', exportExcel);

  document.getElementById('btn-table').addEventListener('click', () => {
    tableOpen = !tableOpen;
    document.getElementById('stats-panel').classList.toggle('hidden', !tableOpen);
    document.getElementById('btn-table').classList.toggle('active', tableOpen);
    if (tableOpen) renderTable();
  });

  document.getElementById('game-name').addEventListener('input', e => {
    S.gameName = e.target.value;
    debouncedSave();
  });

  document.getElementById('rival-minus').addEventListener('click', () => {
    if (S.rivalScore > 0) { S.rivalScore--; renderScore(); debouncedSave(); }
  });
  document.getElementById('rival-plus').addEventListener('click', () => {
    S.rivalScore++; renderScore(); debouncedSave();
  });

  document.querySelectorAll('.sbtn.made').forEach(btn =>
    btn.addEventListener('click', () => recordShot(btn.dataset.type, true)));
  document.querySelectorAll('.sbtn.missed').forEach(btn =>
    btn.addEventListener('click', () => recordShot(btn.dataset.type, false)));
  document.querySelectorAll('.stbtn').forEach(btn =>
    btn.addEventListener('click', () => recordStat(btn.dataset.stat)));
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
