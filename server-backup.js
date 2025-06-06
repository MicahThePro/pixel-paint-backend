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
        scores.set(name, { score: 0, color });
        socket.emit('fullBoard', gameBoard);
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
        console.log(`🎨 Paint request: (${x},${y}) color:${color} by ${player ? player.name : 'unknown'}`);
        if (!player) return;

        const previousOwner = pixelOwners[y][x];
        const currentPixelColor = gameBoard[y][x];
        
        // Update the pixel
        gameBoard[y][x] = color;
        pixelOwners[y][x] = player.name;
        
        // Handle scoring based on pixel ownership
        if (!previousOwner || previousOwner === '') {
            // New pixel - player gains 1 point
            updateScore(player.name, 1);
        } else if (previousOwner !== player.name) {
            // Taking over someone else's pixel - they lose 1, you gain 1
            updateScore(previousOwner, -1);
            updateScore(player.name, 1);
            console.log(`📊 Score transfer: ${previousOwner} -1, ${player.name} +1`);
        }
        // If painting over your own pixel, no score change
        
        io.emit('boardUpdate', { x, y, color, playerName: player.name });
    });

    // Handle cursor movement
    socket.on('cursorMove', (data) => {
        const player = players.get(socket.id);
        if (!player) return;
        
        // Broadcast cursor position to all other players
        socket.broadcast.emit('cursorUpdate', {
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
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                if (pixelOwners[y][x] === name) {
                    gameBoard[y][x] = '';
                    pixelOwners[y][x] = '';
                    io.emit('boardUpdate', { x, y, color: '#ffffff', playerName: name });
                }
            }
        }
        updateScores();
    });

    // Clear entire canvas (admin/general clear)
    socket.on('clearCanvas', () => {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                gameBoard[y][x] = '';
                pixelOwners[y][x] = ''; // Also clear pixel ownership
            }
        }
        // Send the cleared board to all clients
        io.emit('fullBoard', gameBoard);
        updateScores();
    });

    socket.on('submitReport', (reportData) => {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const reportFilename = path.join(reportsDir, `report-${timestamp}.json`);
            const canvasFilename = path.join(reportsDir, `canvas-${timestamp}.png`);

            console.log('Received report data:', reportData);
            console.log('Saving to:', reportFilename);

            // Auto-ban for specific keywords in the reason or description
            const banKeywords = ['explicit', 'nsfw', 'inappropriate content', 'offensive'];
            const shouldAutoBan = banKeywords.some(keyword => 
                reportData.description.toLowerCase().includes(keyword) || 
                reportData.reason.toLowerCase().includes(keyword)
            );

            if (shouldAutoBan) {
                // Find the reported player's socket
                let reportedSocket = null;
                let reportedPattern = null;
                players.forEach((player, socketId) => {
                    if (player.name === reportData.reportedPlayer) {
                        const socket = io.sockets.sockets.get(socketId);
                        if (socket) {
                            reportedSocket = socket;
                            reportedPattern = socket.userPattern;
                        }
                    }
                });

                if (reportedSocket && reportedPattern) {
                    // Ban IP
                    bans.ips.add(reportedSocket.clientIp);
                    // Ban username
                    bans.names.add(reportedPattern.name.toLowerCase());
                    // Store pattern
                    bans.patterns.set(reportedPattern.name.toLowerCase(), {
                        name: reportedPattern.name,
                        color: reportedPattern.color,
                        banTime: Date.now()
                    });

                    // Save bans to file
                    saveBans();

                    // Disconnect the banned user
                    reportedSocket.emit('banned', { reason: 'You have been banned for inappropriate behavior.' });
                    reportedSocket.disconnect();
                }
            }

            // Save the canvas image
            const base64Data = reportData.canvas.replace(/^data:image\/png;base64,/, '');
            fs.writeFileSync(canvasFilename, base64Data, 'base64');

            // Save the report data with additional information
            const reportInfo = {
                ...reportData,
                canvas: `canvas-${timestamp}.png`,
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
            // Notify other players that this player disconnected (for cursor cleanup)
            socket.broadcast.emit('playerDisconnected', { playerName: player.name });
            
            // Clear all pixels drawn by this player
            for (let y = 0; y < GRID_SIZE; y++) {
                for (let x = 0; x < GRID_SIZE; x++) {
                    if (pixelOwners[y][x] === player.name) {
                        gameBoard[y][x] = '';
                        pixelOwners[y][x] = '';
                        // Notify all clients about the cleared pixel
                        io.emit('boardUpdate', { x, y, color: '#ffffff', playerName: 'system' });
                    }
                }
            }
            
            players.delete(socket.id);
            scores.delete(player.name);
            updateScores();
            io.emit('playerListUpdate', Array.from(players.values()));
            
            console.log(`User ${player.name} disconnected - their drawings have been cleared`);
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

function updateScores() {
    const scoreArray = Array.from(scores.entries()).map(([name, data]) => ({
        name,
        score: data.score,
        color: data.color
    })).sort((a, b) => b.score - a.score);
    
    io.emit('scoreUpdate', scoreArray);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
