const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
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
            patterns: Array.from(bans.patterns.entries())
        };
        fs.writeFileSync(bansFile, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving bans file:', error);
    }
}

const GRID_SIZE = 100;

// Room Management System
const rooms = new Map();
const playerRooms = new Map(); // Track which room each player is in

// Default public servers (always available)
const DEFAULT_PUBLIC_ROOMS = [
    { id: 'lobby-1', name: 'Art Studio', description: 'Main creative space for everyone', type: 'public' },
    { id: 'lobby-2', name: 'Pixel Paradise', description: 'Colorful collaborative canvas', type: 'public' },
    { id: 'lobby-3', name: 'Creative Corner', description: 'Express your artistic side', type: 'public' },
    { id: 'lobby-4', name: 'Paint Party', description: 'Join the fun painting party', type: 'public' },
    { id: 'lobby-5', name: 'Digital Gallery', description: 'Create masterpieces together', type: 'public' }
];

// Initialize default rooms
function initializeRooms() {
    DEFAULT_PUBLIC_ROOMS.forEach(roomInfo => {
        const room = {
            id: roomInfo.id,
            name: roomInfo.name,
            description: roomInfo.description,
            type: 'public',
            code: null,
            creator: 'system',
            createdAt: Date.now(),
            players: new Map(),
            scores: new Map(),
            gameBoard: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('')),
            pixelOwners: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('')),
            challengeMode: {
                active: false,
                players: new Map(),
                currentWord: '',
                startTime: null,
                duration: 180000,
                phase: 'waiting',
                submissions: new Map(),
                votes: new Map(),
                results: [],
                timer: null,
                votingOrder: [],
                currentVotingIndex: 0,
                currentSubmissionVotes: new Map(),
                votingTimer: 15000
            }
        };
        rooms.set(roomInfo.id, room);
    });
    console.log(`✅ Initialized ${DEFAULT_PUBLIC_ROOMS.length} default public rooms`);
}

// Create a new room
function createRoom(roomData) {
    const roomId = roomData.type === 'private' ? 
        `private-${Date.now()}-${Math.random().toString(36).substr(2, 6)}` :
        `public-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    
    const room = {
        id: roomId,
        name: roomData.name,
        description: roomData.description || 'Custom room',
        type: roomData.type,
        code: roomData.code || null,
        creator: roomData.creator,
        createdAt: Date.now(),
        players: new Map(),
        scores: new Map(),
        gameBoard: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('')),
        pixelOwners: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('')),
        challengeMode: {
            active: false,
            players: new Map(),
            currentWord: '',
            startTime: null,
            duration: 180000,
            phase: 'waiting',
            submissions: new Map(),
            votes: new Map(),
            results: [],
            timer: null,
            votingOrder: [],
            currentVotingIndex: 0,
            currentSubmissionVotes: new Map(),
            votingTimer: 15000
        }
    };
    
    rooms.set(roomId, room);
    return room;
}

// Get room list for client
function getRoomList() {
    const roomList = [];
    rooms.forEach(room => {
        roomList.push({
            id: room.id,
            name: room.name,
            description: room.description,
            type: room.type,
            playerCount: room.players.size,
            hasPassword: room.type === 'private' && !!room.code,
            creator: room.creator,
            createdAt: room.createdAt
        });
    });
    
    // Sort: default rooms first, then by creation time
    return roomList.sort((a, b) => {
        if (a.creator === 'system' && b.creator !== 'system') return -1;
        if (a.creator !== 'system' && b.creator === 'system') return 1;
        return b.createdAt - a.createdAt;
    });
}

// Initialize rooms on startup
initializeRooms();

// Challenge Mode Data (shared words across all rooms)
const challengeWords = [
    "cat", "dog", "house", "tree", "car", "sun", "moon", "star", "flower", "bird",
    "fish", "butterfly", "rainbow", "cloud", "mountain", "ocean", "apple", "banana",
    "pizza", "cake", "robot", "rocket", "castle", "crown", "heart", "smile", "eye",
    "dragon", "unicorn", "elephant", "lion", "tiger", "bear", "whale", "shark",
    "guitar", "piano", "drum", "microphone", "camera", "book", "pencil", "paintbrush"
];

app.use(express.static(path.join(__dirname)));

// Debug endpoint to check rooms
app.get('/debug/rooms', (req, res) => {
    const roomList = getRoomList();
    res.json({ 
        totalRooms: rooms.size, 
        roomList: roomList 
    });
});

io.on('connection', (socket) => {
    console.log('🔗 A user connected:', socket.id);
    
    // Get IP address (works with both direct connections and proxies)
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    socket.clientIp = clientIp;

    // Check if IP is banned
    if (bans.ips.has(clientIp)) {
        socket.emit('banned', { reason: 'Your IP address has been banned for inappropriate behavior.' });
        socket.disconnect();
        return;
    }

    // Room management socket handlers
    socket.on('getRoomList', () => {
        console.log('📋 Client requested room list');
        const roomList = getRoomList();
        console.log('📋 Sending room list:', roomList.length, 'rooms');
        socket.emit('roomList', roomList);
    });

    socket.on('createRoom', (data) => {
        console.log('🏗️ Client creating room:', data);
        const { name, description, type, code, creator } = data;
        
        // Validate room data
        if (!name || !creator) {
            socket.emit('roomError', { message: 'Room name and creator are required' });
            return;
        }
        
        if (type === 'private' && !code) {
            socket.emit('roomError', { message: 'Private rooms require a code' });
            return;
        }
        
        try {
            const room = createRoom({ name, description, type, code, creator });
            console.log('✅ Room created successfully:', room.id);
            socket.emit('roomCreated', { roomId: room.id, room: {
                id: room.id,
                name: room.name,
                description: room.description,
                type: room.type,
                playerCount: 0,
                hasPassword: room.type === 'private' && !!room.code,
                creator: room.creator,
                createdAt: room.createdAt
            }});
            
            // Broadcast updated room list to all clients
            io.emit('roomList', getRoomList());
        } catch (error) {
            console.error('❌ Failed to create room:', error);
            socket.emit('roomError', { message: 'Failed to create room' });
        }
    });

    socket.on('joinRoom', (data) => {
        console.log('🚪 Client joining room:', data);
        const { roomId, playerName, playerColor, roomCode } = data;
        
        // Check if IP is banned
        if (bans.ips.has(socket.clientIp)) {
            socket.emit('banned', { reason: 'Your IP address has been banned for inappropriate behavior.' });
            socket.disconnect();
            return;
        }

        // Check if name is banned
        if (bans.names.has(playerName.toLowerCase())) {
            socket.emit('banned', { reason: 'This username has been banned for inappropriate behavior.' });
            socket.disconnect();
            return;
        }

        // Store user pattern data
        const userPattern = {
            name: playerName.toLowerCase(),
            color: playerColor,
            ip: socket.clientIp,
            joinTime: Date.now()
        };

        // Check for pattern matching (repeated offenders)
        let patternMatch = false;
        bans.patterns.forEach((pattern, key) => {
            if (pattern.color === playerColor || 
                pattern.name.toLowerCase().includes(playerName.toLowerCase()) ||
                playerName.toLowerCase().includes(pattern.name.toLowerCase())) {
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

        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('joinError', { message: 'Room not found' });
            return;
        }

        // Check room code for private rooms
        if (room.type === 'private' && room.code !== roomCode) {
            socket.emit('joinError', { message: 'Invalid room code' });
            return;
        }

        // Leave previous room if in one
        const previousRoom = playerRooms.get(socket.id);
        if (previousRoom) {
            const prevRoomData = rooms.get(previousRoom);
            if (prevRoomData) {
                prevRoomData.players.delete(socket.id);
                socket.leave(previousRoom);
                socket.to(previousRoom).emit('playerLeft', { playerName: prevRoomData.players.get(socket.id)?.name });
            }
        }

        // Join new room
        room.players.set(socket.id, { name: playerName, color: playerColor });
        room.scores.set(playerName, { score: 0, color: playerColor });
        playerRooms.set(socket.id, roomId);
        socket.join(roomId);

        // Send room data to player
        socket.emit('roomJoined', { 
            roomId: roomId,
            roomName: room.name,
            gameBoard: room.gameBoard
        });
        
        // Update scores for this room
        updateScores(roomId);
        
        // Notify all players in the room
        io.to(roomId).emit('playerListUpdate', Array.from(room.players.values()));
        socket.to(roomId).emit('playerJoined', { playerName: playerName });
        
        // Update room list for all clients
        io.emit('roomList', getRoomList());
    });

    socket.on('paint', (data) => {
        const { x, y, color } = data;
        const roomId = playerRooms.get(socket.id);
        if (!roomId) return;
        
        const room = rooms.get(roomId);
        if (!room) return;
        
        const player = room.players.get(socket.id);
        if (!player) return;

        const previousOwner = room.pixelOwners[y][x];
        const currentPixelColor = room.gameBoard[y][x];
        
        // Update the pixel
        room.gameBoard[y][x] = color;
        room.pixelOwners[y][x] = player.name;
        
        // Handle scoring based on pixel ownership and whether it's an eraser action
        const isEraserAction = color === '#ffffff';
        
        if (isEraserAction) {
            // Eraser logic: only deduct points if the pixel was the user's own color
            if (previousOwner === player.name && currentPixelColor !== '#ffffff' && currentPixelColor !== '') {
                // User is erasing their own colored pixel - deduct 1 point
                updateScore(roomId, player.name, -1);
                console.log(`🧽 Eraser: ${player.name} lost 1 point for erasing own pixel`);
            }
            // No points gained or lost for erasing empty pixels or others' pixels
            
            // For eraser, don't assign ownership - set pixel owner to empty
            room.pixelOwners[y][x] = '';
        } else {
            // Normal paint logic
            if (!previousOwner || previousOwner === '') {
                // New pixel - player gains 1 point
                updateScore(roomId, player.name, 1);
            } else if (previousOwner !== player.name) {
                // Taking over someone else's pixel - they lose 1, you gain 1
                updateScore(roomId, previousOwner, -1);
                updateScore(roomId, player.name, 1);
            }
            // If painting over your own pixel, no score change
        }
        
        io.to(roomId).emit('boardUpdate', { x, y, color, playerName: player.name });
    });

    // Handle cursor movement
    socket.on('cursorMove', (data) => {
        const roomId = playerRooms.get(socket.id);
        if (!roomId) return;
        
        const room = rooms.get(roomId);
        if (!room) return;
        
        const player = room.players.get(socket.id);
        if (!player) return;
        
        // Broadcast cursor position to all other players in the room
        socket.to(roomId).emit('cursorUpdate', {
            x: data.x,
            y: data.y,
            gridX: data.gridX,
            gridY: data.gridY,
            playerName: player.name,
            color: player.color
        });
    });

    socket.on('clearMyPixels', (data) => {
        const { name } = data;
        const roomId = playerRooms.get(socket.id);
        if (!roomId) return;
        
        const room = rooms.get(roomId);
        if (!room) return;
        
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                if (room.pixelOwners[y][x] === name) {
                    room.gameBoard[y][x] = '';
                    room.pixelOwners[y][x] = '';
                    io.to(roomId).emit('boardUpdate', { x, y, color: '#ffffff', playerName: name });
                }
            }
        }
        updateScores(roomId);
    });

    // Clear entire canvas (admin/general clear)
    socket.on('clearCanvas', () => {
        const roomId = playerRooms.get(socket.id);
        if (!roomId) return;
        
        const room = rooms.get(roomId);
        if (!room) return;
        
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                room.gameBoard[y][x] = '';
                room.pixelOwners[y][x] = ''; // Also clear pixel ownership
            }
        }
        // Send the cleared board to all clients in the room
        io.to(roomId).emit('fullBoard', room.gameBoard);
        updateScores(roomId);
    });

    socket.on('disconnect', () => {
        const roomId = playerRooms.get(socket.id);
        if (!roomId) return;
        
        const room = rooms.get(roomId);
        if (!room) return;
        
        const player = room.players.get(socket.id);
        if (player) {
            // Notify other players that this player disconnected (for cursor cleanup)
            socket.to(roomId).emit('playerDisconnected', { playerName: player.name });
            
            // Notify all players that someone left
            io.to(roomId).emit('playerLeft', { playerName: player.name });
            
            // Clear all pixels drawn by this player
            for (let y = 0; y < GRID_SIZE; y++) {
                for (let x = 0; x < GRID_SIZE; x++) {
                    if (room.pixelOwners[y][x] === player.name) {
                        room.gameBoard[y][x] = '';
                        room.pixelOwners[y][x] = '';
                        // Notify all clients about the cleared pixel
                        io.to(roomId).emit('boardUpdate', { x, y, color: '#ffffff', playerName: 'system' });
                    }
                }
            }
            
            room.players.delete(socket.id);
            room.scores.delete(player.name);
            playerRooms.delete(socket.id);
            updateScores(roomId);
            io.to(roomId).emit('playerListUpdate', Array.from(room.players.values()));
            
            console.log(`User ${player.name} disconnected from room ${room.name} - their drawings have been cleared`);
        }
        
        // Update room list for all clients
        io.emit('roomList', getRoomList());
    });
});

function updateScore(roomId, playerName, points) {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const playerScore = room.scores.get(playerName);
    if (playerScore) {
        playerScore.score += points;
        // Ensure score doesn't go below 0
        if (playerScore.score < 0) {
            playerScore.score = 0;
        }
        updateScores(roomId);
    }
}

function updateScores(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const scoreArray = Array.from(room.scores.entries()).map(([name, data]) => ({
        name,
        score: data.score,
        color: data.color
    })).sort((a, b) => b.score - a.score);
    
    io.to(roomId).emit('scoreUpdate', scoreArray);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
