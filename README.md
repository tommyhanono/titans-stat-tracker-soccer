# ⚽ Titans Stat Tracker — Soccer

A mobile-first Progressive Web App (PWA) for tracking real-time soccer match statistics. Built for the **Football Titans** team.

![screenshot](https://img.shields.io/badge/PWA-ready-brightgreen) ![lang](https://img.shields.io/badge/language-Vanilla%20JS-yellow) ![lang](https://img.shields.io/badge/UI-Spanish-blue)

---

## Features

### 🎮 Live Match Tracking
- **Clock counts up** — soccer style, with stoppage time display (e.g. `45:00+1:23`)
- **Half management** — 1st Half, 2nd Half, Extra Time with one-tap advance
- **Rival score** — quick +/− buttons to track the opponent

### ⚽ Shot Tracking (per player)
| Type | Description |
|------|-------------|
| **Gol** | Open play shot |
| **Tiro Libre** | Free kick from anywhere |
| **Penal** | Penalty spot |

Each shot is recorded as **made** or **missed**, with accuracy % in the stats table.

### 📊 Player Statistics
- Asistencias, Recuperaciones, Faltas Recibidas, Fuera de Lugar
- Faltas Cometidas, Pérdidas, Tarjetas Amarillas, Tarjetas Rojas
- 2 yellow cards → automatic red card + expulsion
- Minutes played tracked per player while on field

### 🏅 Player Positions
Assign **GK · DEF · MED · DEL** to each player. Color-coded badges appear on player cards and the stats table.

### ↕ Substitutions
Log who comes in and who goes out, stamped with the match minute. Shown in the action log and printed in the match report.

### ⚽ Penalty Shootout Mode
Dedicated modal with kick-by-kick table, player selector for Titans side, live score display, automatic winner detection (including sudden death), and undo support.

### 📅 Season Statistics
Accumulates data across multiple games in `localStorage`:
- **W / D / L** record
- Goals scored and conceded
- Per-player totals: goals, assists, recoveries, fouls, cards
- Full game history with date, opponent, and result

### 📋 Match Report
Generates a printable HTML report in a new tab with:
- Scoreboard and result
- Executive summary with top scorer, top assist, effectiveness %
- Full individual stats table
- Substitution log
- Tactical recommendations

### 💾 Persistence & PWA
- Auto-saved to `localStorage` with a 1.5 s debounce
- Service Worker for **offline use** (cache-first strategy)
- Installable on iOS and Android as a home screen app
- Undo up to 20 actions

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/tommyhanono/titans-stat-tracker-soccer.git
cd titans-stat-tracker-soccer

# Serve locally (any static server works)
python3 -m http.server 8081
# → open http://localhost:8081
```

No build step. No dependencies. Just open `index.html`.

---

## Project Structure

```
titans-stat-tracker-soccer/
├── index.html      # App shell & all modals
├── app.js          # All logic — state, rendering, events
├── style.css       # Dark theme, responsive layout
├── sw.js           # Service Worker (cache-first, ftt-v3)
├── manifest.json   # PWA manifest
├── icon-192.svg    # App icon (soccer ball)
└── icon-512.svg    # App icon (large)
```

---

## How to Use

1. **Type a match name** in the top bar and set the rival name via the report prompt or rival score label
2. **Tap a player** from the left panel to select them — their badge appears at the top
3. **Assign a position** (GK / DEF / MED / DEL) from the row that appears below the badge
4. **Toggle on/off field** with the green/white circle button on each player card
5. **Record stats** using the shot buttons (right panel) or the stat buttons
6. **Start the clock** with ▶ Iniciar — it counts up automatically
7. **Substitutions** — tap ↕ Sust. to swap a player in/out
8. **Penalty shootout** — tap ⚽ Penales for the dedicated shootout mode
9. **End of match** — tap 📋 Reporte for a printable summary, or 📅 Temporada → 💾 Guardar to save to the season
10. **New game** — tap 🔄 Nuevo; you'll be offered to save to the season first

---

## Tech Stack

| | |
|---|---|
| **Framework** | None — Vanilla HTML / CSS / JavaScript |
| **Storage** | `localStorage` (`ftt-v1` for match, `ftt-season-v1` for season) |
| **Offline** | Service Worker (`ftt-v3` cache) |
| **Language** | Spanish (UI) |
| **Target** | Mobile-first, works on desktop |

---

## License

MIT — free to use and adapt for your team.
