# ⚽ Campo Aperto (FC Classroom)

[![JavaScript](https://img.shields.io/badge/Language-JavaScript-yellow.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Python](https://img.shields.io/badge/Language-Python-blue.svg)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)

**Campo Aperto** (also known as *FC Classroom*) is a web-based multiplayer football (soccer) game designed to bring the arcade FIFA experience straight to the browser, making it easy and fun to play with school friends or teammates.

---

## 🌟 Key Features

- **Arcade Football Gameplay**: Fast-paced 3D match simulation including custom ball physics, player movement, team tactics, and AI.
- **Multiplayer & Networking**: Real-time multiplayer support via custom relay servers (`server/relay.js` & `src/12_net.js`).
- **Desktop & Web Support**: Play directly in the browser (`shell.html`) or launch as a desktop app powered by Electron.
- **Audio & Visual Experience**: Modular rendering engine (`src/09_render.js`) paired with sound effects (`src/10_audio.js`).
- **Configurable Settings**: In-game customization for tactics, audio, and controls.

---

## 📁 Repository Structure

```text
campo-aperto/
├── .github/workflows/    # CI/CD workflows (e.g., automated releases)
├── desktop/             # Electron entry points (main.js)
├── docs/                # Project documentation (CHANGELOG, ROADMAP, Status)
├── risorse/             # Assets and media resources (icons, audio, graphics)
├── scripts/             # Build and environment check scripts
├── server/              # Relay server for multiplayer session management
├── src/                 # Main game source files (numbered sequence)
│   ├── 01_config.js      # Global settings and configurations
│   ├── 02_database.js    # Player & team data structures
│   ├── 03_ball.js        # Physics engine for ball mechanics
│   ├── 04_player.js      # Player movement and stats
│   ├── 05_team_tactics.js# Formations and tactical AI
│   ├── 06_actions.js     # Passes, shots, and tackles
│   ├── 07_ai.js          # Bot behaviors and decisions
│   ├── 08_match.js       # Match engine, timers, rules, and scoring
│   ├── 09_render.js      # Graphical rendering pipeline
│   ├── 10_audio.js       # Sound manager
│   ├── 11_input.js       # Keyboard and controller input handling
│   ├── 12_net.js         # Peer-to-peer / WebSocket networking
│   ├── 13_settings.js    # User settings and menu logic
│   ├── 14_game.js        # Main game loop entry point
│   └── shell.html        # HTML entry point for browser play
├── tests/               # Python & JS automated unit/browser tests
├── build.js             # Bundling & packaging script
├── package.json         # Node.js dependencies and scripts
└── LEGGIMI.md           # Italian project overview
