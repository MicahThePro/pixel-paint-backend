# 🎨 Pixel Paint Party - Backend

This is the official backend server powering **Pixel Paint Party**, the real-time multiplayer painting game where chaos meets creativity.

## ✨ Features

* 🎮 Real-time multiplayer pixel painting with `Socket.IO`
* 🧍 Player tracking, name management, and live user list
* 🧠 XP and Achievement systems (supports multiple variations)
* 📸 Player reporting system with screenshot support
* 🚫 Anti-spam protection, ban logic, and kick handling
* 💾 Persistent player data and score tracking
* 🛠 Multiple server versions (`server.js`, `server-new.js`, `server-with-rooms.js`, etc.)

## 🚀 Deployment

Designed for Railway, Render, Cyclic, and other Node-friendly hosting platforms.

### ✅ Recommended Files for Deployment

Use **`server.js`** as the main entry point. The other files are backups or experimental versions.

## 🔐 Environment Variables

* `PORT` — Automatically set by most platforms (e.g. Railway)
* *(Optional)* `RAILWAY_STATIC_URL`, `NODE_ENV`, etc., if used in advanced deployments

## 📡 WebSocket API

Handles real-time communication with all connected clients:

* `join` — User connects and joins the game
* `paint` — Transmit brush stroke data
* `report` — Player reports another user
* `score` — Server broadcasts updated scores

## 🧪 Local Development

To run locally on port `3000`:

```bash
npm install
npm start
```

Make sure to install dependencies before starting. If running experimental versions like `server-new.js`, rename or run directly.

## 📁 Project Structure (Partial)

```
pixel-paint-backend/
├── server.js             # Main production server
├── server-new.js         # Experimental feature server
├── xpSystem.js           # XP system logic
├── achievementSystem.js  # Achievements backend
├── achievements.json     # JSON data for achievements
├── Procfile              # Deployment config (Railway)
├── package.json          # Project metadata and dependencies
├── README.md             # This file
```

## 🧼 Notes

* There are some duplicate or backup files (like `xpsystem.js`, `achievementsystem.js`, etc.).
* Only **`server.js`** is used in live deployments.
* Feel free to customize and tweak servers for different game modes!

---

LET THE PIXEL PARTY BEGIN 🎉
