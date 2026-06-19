# Realtime Poker

Browser-based Texas Hold'em with multiplayer rooms, real-time sync, and hand evaluation. Built with vanilla HTML/CSS/JS and Firebase Realtime Database.

## Features

- Create or join rooms (2–5 players)
- Blinds, betting rounds, and automatic hand resolution
- Live game state synced across clients
- Responsive table UI

## Run locally

Open `index.html` in a browser, or serve the folder with any static file server:

```bash
npx serve .
```

Firebase config is in `script.js`. Replace it with your own Firebase project credentials if you fork this repo.

## Project structure

```
index.html   — layout and screens
styles.css   — table and UI styling
script.js    — game logic, Firebase sync, hand evaluation
LICENSE.md
```
