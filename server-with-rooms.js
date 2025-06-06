const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const path = require('path');
const fs = require('fs');

// Create necessary directories
const reportsDir = path.join(__dirname, 'reports');
const bansDir = path.join(__dirname, 'bans');
if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);
if (!fs.existsSync(bansDir)) fs.mkdirSync(bansDir);

// Load or initialize bans data
let bans = {
    ips: new Set(),
    names: new Set(),
    patterns: new Map() // Store user patterns for detection
};

// Load existing bans
const bansFile = path.join(bansDir, 'bans.json');
if (fs.existsSync(bansFile)) {
    try {
        const data = JSON.parse(fs.readFileSync(bansFile, 'utf8'));
        bans.ips = new Set(data.ips || []);
        bans.names = new Set(data.names || []);
        bans.patterns = new Map(data.patterns || []);
    } catch (error) {
        console.error('Error loading bans file:', error);
    }
}

// Save bans to file
function saveBans() {
    try {
        const data = {
            ips: Array.from(bans.ips),
            names: Array.from(bans.names),
            patterns: Array.from(bans.patterns)
        };
        fs.writeFileSync(bansFile, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving bans file:', error);
    }
}

const GRID_SIZE = 100;
let gameBoard = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(''));
let pixelOwners = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('')); // Track who drew each pixel
let players = new Map();
let scores = new Map();

// Room management
let rooms = new Map();

// Initialize main room
rooms.set('main', {
    code: 'main',
    name: 'Main Room',
    owner: null,
    capacity: Infinity,
    isPrivate: false,
    players: new Set(),
    board: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('')),
    pixelOwners: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('')),
    scores: new Map()
});

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function getPlayerRoom(socketId) {
    for (let [roomCode, room] of rooms.entries()) {
        if (room.players.has(socketId)) {
            return roomCode;
        }
    }
    return null;
}

app.use(express.static(path.join(__dirname)));

io.on('connection', (socket) => {
    console.log('A user connected');
    
    // Get IP address (works with both direct connections and proxies)
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    socket.clientIp = clientIp;

    // Check if IP is banned
    if (bans.ips.has(clientIp)) {
        socket.emit('banned', { reason: 'Your IP address has been banned for inappropriate behavior.' });
        socket.disconnect();
        return;
    }

    socket.on('join', (data) => {
        const { name, color } = data;
        console.log(`🎮 Player joining: ${name} with color ${color}`);

        // Check if name is banned
        if (bans.names.has(name.toLowerCase())) {
            socket.emit('banned', { reason: 'This username has been banned for inappropriate behavior.' });
            socket.disconnect();
            return;
        }

        // Store user pattern data
        const userPattern = {
            name: name.toLowerCase(),
            color: color,
            ip: socket.clientIp,
            joinTime: Date.now()
        };

        // Check for pattern matching (repeated offenders)
        let patternMatch = false;
        bans.patterns.forEach((pattern, key) => {
            if (pattern.color === color || 
                pattern.name.toLowerCase().includes(name.toLowerCase()) ||
                name.toLowerCase().includes(pattern.name.toLowerCase())) {
                patternMatch = true;
            }
        });

        if (patternMatch) {
            socket.emit('banned', { reason: 'Your behavior pattern matches a banned user.' });
            socket.disconnect();
            return;
        }

        // Store the pattern for this connection
        socket.userPattern = userPattern;

        players.set(socket.id, { name, color });
        
        // Join main room by default
        const mainRoom = rooms.get('main');
        mainRoom.players.add(socket.id);
        mainRoom.scores.set(name, { score: 0, color });
        
        socket.currentRoom = 'main';
        socket.join('main');
        
        socket.emit('fullBoard', mainRoom.board);
        socket.emit('roomJoined', {
            roomCode: 'main',
            roomName: 'Main Room',
            isOwner: false,
            capacity: Infinity,
            playerCount: mainRoom.players.size,
            board: mainRoom.board,
            scores: Object.fromEntries(mainRoom.scores)
        });
        
        updateScores();
        io.emit('playerListUpdate', Array.from(players.values()));
    });

    // Allow viewing the board without joining
    socket.on('requestBoard', () => {
        socket.emit('fullBoard', gameBoard);
    });

    // Allow requesting current scores without joining
    socket.on('requestScores', () => {
        updateScores();
    });

    socket.on('paint', (data) => {
        const { x, y, color } = data;
        const player = players.get(socket.id);
        if (!player) return;

        const roomCode = socket.currentRoom || 'main';
        const room = rooms.get(roomCode);
        if (!room) return;

        const previousOwner = room.pixelOwners[y][x];
        const currentPixelColor = room.board[y][x];
        
        // Update the pixel
        room.board[y][x] = color;
        room.pixelOwners[y][x] = player.name;
        
        // Handle scoring based on pixel ownership
        if (!previousOwner || previousOwner === '') {
            // New pixel - player gains 1 point
            console.log(`🎯 ${player.name} painted new pixel at (${x}, ${y}) - +1 point`);
            updateRoomScore(roomCode, player.name, 1);
        } else if (previousOwner !== player.name) {
            // Taking over someone else's pixel - they lose 1, you gain 1
            console.log(`⚔️ ${player.name} took over ${previousOwner}'s pixel at (${x}, ${y}) - transfer: ${previousOwner} -1, ${player.name} +1`);
            updateRoomScore(roomCode, previousOwner, -1);
            updateRoomScore(roomCode, player.name, 1);
        }
        // If painting over your own pixel, no score change
        
        io.to(roomCode).emit('boardUpdate', { x, y, color, playerName: player.name });
    });

    // Handle cursor movement
    socket.on('cursorMove', (data) => {
        const player = players.get(socket.id);
        if (!player) return;
        
        const roomCode = socket.currentRoom || 'main';
        // Broadcast cursor position to other players in the same room
        socket.broadcast.to(roomCode).emit('cursorUpdate', {
            x: data.x,
            y: data.y,
            gridX: data.gridX,
            gridY: data.gridY,
            playerName: player.name,
            color: player.color
        });
    });

    // Room management handlers
    socket.on('createRoom', (data) => {
        const { name, capacity, isPrivate, playerName } = data;
        const player = players.get(socket.id);
        if (!player) return;

        let roomCode;
        do {
            roomCode = generateRoomCode();
        } while (rooms.has(roomCode));

        const newRoom = {
            code: roomCode,
            name: name,
            owner: socket.id,
            capacity: capacity,
            isPrivate: isPrivate,
            players: new Set([socket.id]),
            board: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('')),
            pixelOwners: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('')),
            scores: new Map([[playerName, { score: 0, color: player.color }]])
        };

        rooms.set(roomCode, newRoom);

        // Leave current room
        if (socket.currentRoom) {
            const oldRoom = rooms.get(socket.currentRoom);
            if (oldRoom) {
                oldRoom.players.delete(socket.id);
                oldRoom.scores.delete(playerName);
                socket.leave(socket.currentRoom);
                io.to(socket.currentRoom).emit('roomPlayerUpdate', { playerCount: oldRoom.players.size });
            }
        }

        // Join new room
        socket.currentRoom = roomCode;
        socket.join(roomCode);

        socket.emit('roomCreated', {
            roomCode: roomCode,
            roomName: name,
            capacity: capacity,
            playerCount: 1
        });

        console.log(`Room ${roomCode} created by ${playerName}`);
    });

    socket.on('joinRoom', (data) => {
        const { roomCode, playerName } = data;
        const player = players.get(socket.id);
        if (!player) return;

        const room = rooms.get(roomCode);
        if (!room) {
            socket.emit('roomError', { message: 'Room not found!' });
            return;
        }

        if (room.players.size >= room.capacity) {
            socket.emit('roomError', { message: 'Room is full!' });
            return;
        }

        // Leave current room
        if (socket.currentRoom) {
            const oldRoom = rooms.get(socket.currentRoom);
            if (oldRoom) {
                oldRoom.players.delete(socket.id);
                oldRoom.scores.delete(playerName);
                socket.leave(socket.currentRoom);
                io.to(socket.currentRoom).emit('roomPlayerUpdate', { playerCount: oldRoom.players.size });
            }
        }

        // Join new room
        room.players.add(socket.id);
        room.scores.set(playerName, { score: 0, color: player.color });
        socket.currentRoom = roomCode;
        socket.join(roomCode);

        socket.emit('roomJoined', {
            roomCode: roomCode,
            roomName: room.name,
            isOwner: room.owner === socket.id,
            capacity: room.capacity,
            playerCount: room.players.size,
            board: room.board,
            scores: Object.fromEntries(room.scores)
        });

        io.to(roomCode).emit('roomPlayerUpdate', { playerCount: room.players.size });

        console.log(`${playerName} joined room ${roomCode}`);
    });

    socket.on('getRoomPlayers', (roomCode) => {
        const room = rooms.get(roomCode);
        if (!room) return;

        const playerNames = [];
        for (let socketId of room.players) {
            const player = players.get(socketId);
            if (player) {
                playerNames.push(player.name);
            }
        }

        socket.emit('roomPlayers', { players: playerNames });
    });

    socket.on('kickPlayer', (data) => {
        const { roomCode, playerToKick, reason } = data;
        const room = rooms.get(roomCode);
        if (!room || room.owner !== socket.id) {
            socket.emit('roomError', { message: 'Only room owners can kick players!' });
            return;
        }

        // Find the player's socket
        let targetSocket = null;
        for (let socketId of room.players) {
            const player = players.get(socketId);
            if (player && player.name === playerToKick) {
                targetSocket = io.sockets.sockets.get(socketId);
                break;
            }
        }

        if (targetSocket) {
            // Remove from room
            room.players.delete(targetSocket.id);
            room.scores.delete(playerToKick);
            
            // Move to main room
            const mainRoom = rooms.get('main');
            mainRoom.players.add(targetSocket.id);
            mainRoom.scores.set(playerToKick, { score: 0, color: players.get(targetSocket.id).color });
            
            targetSocket.leave(roomCode);
            targetSocket.join('main');
            targetSocket.currentRoom = 'main';

            // Notify all players
            io.to(roomCode).emit('playerKicked', { kickedPlayer: playerToKick, reason });
            targetSocket.emit('roomJoined', {
                roomCode: 'main',
                roomName: 'Main Room',
                isOwner: false,
                capacity: Infinity,
                playerCount: mainRoom.players.size,
                board: mainRoom.board,
                scores: Object.fromEntries(mainRoom.scores)
            });

            io.to(roomCode).emit('roomPlayerUpdate', { playerCount: room.players.size });
            io.to('main').emit('roomPlayerUpdate', { playerCount: mainRoom.players.size });

            console.log(`${playerToKick} was kicked from room ${roomCode} by room owner`);
        }
    });

    socket.on('clearRoomCanvas', (data) => {
        const { roomCode } = data;
        const room = rooms.get(roomCode);
        if (!room || room.owner !== socket.id) {
            socket.emit('roomError', { message: 'Only room owners can clear the canvas!' });
            return;
        }

        // Clear the room's board
        room.board = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(''));
        room.pixelOwners = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(''));
        
        // Reset all scores in the room
        for (let [playerName, playerData] of room.scores) {
            room.scores.set(playerName, { score: 0, color: playerData.color });
        }

        // Notify all players in the room
        io.to(roomCode).emit('canvasCleared', { 
            board: room.board,
            scores: Object.fromEntries(room.scores)
        });

        console.log(`Canvas cleared in room ${roomCode} by room owner`);
    });

    socket.on('clearMyPixels', (data) => {
        const { name } = data;
        const roomCode = socket.currentRoom || 'main';
        const room = rooms.get(roomCode);
        if (!room) return;
        
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                if (room.pixelOwners[y][x] === name) {
                    room.board[y][x] = '';
                    room.pixelOwners[y][x] = '';
                    io.to(roomCode).emit('boardUpdate', { x, y, color: '#ffffff', playerName: name });
                }
            }
        }
        updateRoomScores(roomCode);
    });

    // Clear entire canvas (admin/general clear)
    socket.on('clearCanvas', () => {
        const roomCode = socket.currentRoom || 'main';
        const room = rooms.get(roomCode);
        if (!room) return;
        
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                room.board[y][x] = '';
                room.pixelOwners[y][x] = '';
                io.to(roomCode).emit('boardUpdate', { x, y, color: '#ffffff', playerName: 'system' });
            }
        }
        updateRoomScores(roomCode);
    });

    // Report system
    socket.on('report', (data) => {
        try {
            console.log('📢 Report received:', data);
            
            const reportData = {
                reportedPlayer: data.reportedPlayer,
                reason: data.reason,
                reporterInfo: {
                    ip: socket.clientIp,
                    userAgent: socket.handshake.headers['user-agent']
                },
                timestamp: new Date().toISOString(),
                roomCode: socket.currentRoom || 'main'
            };
            
            const timestamp = Date.now();
            const reportFilename = path.join(reportsDir, `report-${timestamp}.json`);
            
            const reportInfo = {
                ...reportData,
                files: {
                    report: `report-${timestamp}.json`,
                    canvas: `canvas-${timestamp}.png`
                },
                serverTimestamp: timestamp,
                gameState: {
                    totalPlayers: players.size,
                    reportedPlayerPresent: Array.from(players.values()).some(p => p.name === reportData.reportedPlayer)
                }
            };
            fs.writeFileSync(reportFilename, JSON.stringify(reportInfo, null, 2));
            
            console.log(`Report saved: ${reportFilename}`);
            socket.emit('reportConfirmed', { success: true, message: 'Report submitted successfully' });
        } catch (error) {
            console.error('Error saving report:', error);
            socket.emit('reportConfirmed', { success: false, message: 'Failed to submit report' });
        }
    });

    socket.on('disconnect', () => {
        const player = players.get(socket.id);
        if (player) {
            const roomCode = socket.currentRoom || 'main';
            const room = rooms.get(roomCode);
            
            // Notify other players in the same room that this player disconnected (for cursor cleanup)
            socket.broadcast.to(roomCode).emit('playerDisconnected', { playerName: player.name });
            
            if (room) {
                // Remove player from room
                room.players.delete(socket.id);
                room.scores.delete(player.name);
                
                // Clear all pixels drawn by this player in this room
                for (let y = 0; y < GRID_SIZE; y++) {
                    for (let x = 0; x < GRID_SIZE; x++) {
                        if (room.pixelOwners[y][x] === player.name) {
                            room.board[y][x] = '';
                            room.pixelOwners[y][x] = '';
                            // Notify all clients in this room about the cleared pixel
                            io.to(roomCode).emit('boardUpdate', { x, y, color: '#ffffff', playerName: 'system' });
                        }
                    }
                }
                
                // If this was the room owner and room isn't main, assign new owner or delete room
                if (room.owner === socket.id && roomCode !== 'main') {
                    if (room.players.size > 0) {
                        // Assign ownership to first remaining player
                        const newOwner = room.players.values().next().value;
                        room.owner = newOwner;
                        io.to(roomCode).emit('roomOwnerChanged', { newOwner: players.get(newOwner)?.name });
                    } else {
                        // Delete empty room
                        rooms.delete(roomCode);
                        console.log(`Room ${roomCode} deleted - no players remaining`);
                    }
                }
                
                // Update player count for remaining players
                io.to(roomCode).emit('roomPlayerUpdate', { playerCount: room.players.size });
            }
            
            players.delete(socket.id);
            updateScores();
            io.emit('playerListUpdate', Array.from(players.values()));
            
            console.log(`User ${player.name} disconnected from room ${roomCode} - their drawings have been cleared`);
        }
    });
});

function updateScore(playerName, points) {
    const playerScore = scores.get(playerName);
    if (playerScore) {
        playerScore.score += points;
        // Ensure score doesn't go below 0
        if (playerScore.score < 0) {
            playerScore.score = 0;
        }
        updateScores();
    }
}

function updateRoomScore(roomCode, playerName, points) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const playerScore = room.scores.get(playerName);
    if (playerScore) {
        playerScore.score += points;
        // Ensure score doesn't go below 0
        if (playerScore.score < 0) {
            playerScore.score = 0;
        }
        updateRoomScores(roomCode);
    }
}

function updateScores() {
    const scoreArray = Array.from(scores.entries()).map(([name, data]) => ({
        name,
        score: data.score,
        color: data.color
    })).sort((a, b) => b.score - a.score);
    
    io.emit('scoreUpdate', scoreArray);
}

function updateRoomScores(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const scoreArray = Array.from(room.scores.entries()).map(([name, data]) => ({
        name,
        score: data.score,
        color: data.color
    })).sort((a, b) => b.score - a.score);
    
    io.to(roomCode).emit('scoreUpdate', scoreArray);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`🚀 Pixel Paint Party server with rooms running on port ${PORT}`);
});
