# Pixel Paint Party - Backend

This is the backend server for the multiplayer pixel painting game.

## Features
- Real-time multiplayer painting with Socket.IO
- Player management and scoring
- Reporting system with screenshots
- Anti-spam and ban management
- Persistent data storage

## Deployment
This backend is designed to be deployed on Railway, Render, or Cyclic.

## Environment Variables
- `PORT` - Server port (auto-set by hosting platforms)

## API Endpoints
- WebSocket connection for real-time game communication
- Handles player joins, painting events, reports, and scoring

## Local Development
```bash
npm install
npm start
```

Server runs on port 3000 locally.
