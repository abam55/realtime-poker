# Realtime Poker / Online Casino

Browser-based multiplayer casino with Texas Hold'em and Blackjack. Built with vanilla HTML, CSS, and JavaScript, synced via Firebase Realtime Database.

## Features

- Account login, guest play, and lobby with public room browser
- Texas Hold'em (8-player rooms) and Blackjack vs the dealer
- Real-time chat (room, global, DMs, group chats), leaderboards, and admin tools
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
styles.css   — UI styling
script.js    — game logic, Firebase sync, auth, chat, blackjack engine
LICENSE.md
```
