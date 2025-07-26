const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
origin: [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://pixel-paint-party.netlify.app",
  "https://pixel-paint-backend.onrender.com",
],
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

// Challenge Mode Data
const challengeWords = [
    "cat", "dog", "house", "tree", "car", "sun", "moon", "star", "flower", "bird",
    "fish", "butterfly", "rainbow", "cloud", "mountain", "ocean", "apple", "banana",
    "pizza", "cake", "robot", "rocket", "castle", "crown", "heart", "smile", "eye",
    "dragon", "unicorn", "elephant", "lion", "tiger", "bear", "whale", "shark",
    "guitar", "piano", "drum", "microphone", "camera", "book", "pencil", "paintbrush",
    "umbrella", "balloon", "kite", "bicycle", "airplane", "boat", "train", "bus",
    "shoe", "hat", "glasses", "watch", "ring", "key", "door", "window", "chair",
    "table", "bed", "lamp", "clock", "phone", "computer", "television", "radio",
    "fire", "ice", "lightning", "wind", "earth", "water", "forest", "desert",
    "volcano", "island", "bridge", "tower", "pyramid", "statue", "fountain", "garden",
    "playground", "school", "hospital", "library", "museum", "theater", "restaurant", "store",
    "strawberry", "orange", "grape", "pineapple", "watermelon", "carrot", "broccoli", "corn",
    "hamburger", "hotdog", "sandwich", "soup", "salad", "cookie", "donut", "ice cream",
    "soccer ball", "basketball", "tennis ball", "baseball", "football", "golf ball", "bowling ball", "volleyball",
    "sword", "shield", "bow", "arrow", "hammer", "wrench", "scissors", "knife",
    "compass", "map", "treasure", "coin", "gem", "diamond", "pearl", "crystal",
    "witch", "wizard", "knight", "princess", "king", "queen", "pirate", "ninja",
    "ghost", "vampire", "zombie", "mummy", "skeleton", "spider", "bat", "owl",
    "penguin", "polar bear", "seal", "walrus", "dolphin", "octopus", "jellyfish", "starfish",
    "crab", "lobster", "shrimp", "seahorse", "turtle", "frog", "snake", "lizard",
    "monkey", "gorilla", "panda", "koala", "kangaroo", "giraffe", "zebra", "hippo",
    "rhino", "buffalo", "deer", "rabbit", "squirrel", "mouse", "hamster", "guinea pig",
    "chicken", "duck", "goose", "turkey", "peacock", "flamingo", "parrot", "eagle",
    "hawk", "crow", "robin", "sparrow", "hummingbird", "woodpecker", "pelican", "seagull",
    "rose", "tulip", "daisy", "sunflower", "lily", "orchid", "cactus", "mushroom",
    "cherry", "peach", "plum", "lemon", "lime", "coconut", "avocado", "tomato",
    "potato", "onion", "garlic", "pepper", "cucumber", "lettuce", "spinach", "celery",
    "bread", "cheese", "milk", "butter", "egg", "bacon", "chicken", "beef",
    "pasta", "rice", "beans", "nuts", "honey", "sugar", "salt", "pepper",
    "coffee", "tea", "juice", "soda", "water", "wine", "beer", "cocktail",
    "fork", "spoon", "knife", "plate", "bowl", "cup", "glass", "bottle",
    "pan", "pot", "oven", "stove", "refrigerator", "microwave", "toaster", "blender",
    "vacuum", "broom", "mop", "bucket", "sponge", "towel", "soap", "shampoo",
    "toothbrush", "toothpaste", "mirror", "comb", "brush", "razor", "perfume", "makeup",
    "dress", "shirt", "pants", "skirt", "jacket", "coat", "sweater", "t-shirt",
    "jeans", "shorts", "underwear", "socks", "stockings", "tie", "scarf", "gloves",
    "boots", "sandals", "sneakers", "heels", "slippers", "flip-flops", "clogs", "moccasins",
    "necklace", "bracelet", "earrings", "brooch", "pendant", "chain", "locket", "charm",
    "backpack", "purse", "wallet", "suitcase", "briefcase", "handbag", "luggage", "duffel bag",
    "tent", "sleeping bag", "backpack", "compass", "flashlight", "rope", "axe", "fishing rod",
    "campfire", "marshmallow", "hot dog", "s'mores", "hiking boots", "canoe", "kayak", "paddle",
    "anchor", "sail", "mast", "deck", "cabin", "port", "starboard", "bow",
    "engine", "wheel", "tire", "brake", "gas", "oil", "battery", "headlight",
    "windshield", "mirror", "horn", "seatbelt", "steering wheel", "dashboard", "trunk", "hood",
    "runway", "cockpit", "wing", "propeller", "jet", "helicopter", "parachute", "landing gear",
    "track", "platform", "station", "conductor", "passenger", "cargo", "locomotive", "caboose",
    "saddle", "bridle", "horseshoe", "stable", "barn", "pasture", "fence", "gate",
    "flower pot", "watering can", "shovel", "rake", "hoe", "pruners", "gloves", "wheelbarrow",
    "nest", "egg", "feather", "wing", "beak", "claw", "tail", "fur",
    "scale", "fin", "gill", "tentacle", "shell", "horn", "antler", "mane",
    "telescope", "microscope", "calculator", "ruler", "eraser", "stapler", "paperclip", "rubber band",
    "envelope", "stamp", "postcard", "letter", "package", "box", "tape", "string",
    "candle", "match", "lighter", "flashlight", "lantern", "torch", "spotlight", "laser",
    "battery", "charger", "cable", "plug", "socket", "switch", "button", "knob",
    "thermometer", "scale", "timer", "alarm", "bell", "whistle", "siren", "horn",
    "flag", "banner", "sign", "poster", "billboard", "label", "tag", "sticker",
    "medal", "trophy", "ribbon", "certificate", "diploma", "degree", "award", "prize",
    "game", "toy", "puzzle", "doll", "action figure", "board game", "card game", "video game",
    "dice", "chess", "checkers", "backgammon", "monopoly", "scrabble", "uno", "poker",
    "yo-yo", "kite", "frisbee", "ball", "jump rope", "hula hoop", "skateboard", "roller skates",
    "swing", "slide", "seesaw", "monkey bars", "sandbox", "merry-go-round", "ferris wheel", "roller coaster",
    "circus", "clown", "juggler", "acrobat", "tightrope", "trapeze", "lion tamer", "ringmaster",
    "magic", "wand", "hat", "rabbit", "dove", "cards", "coin", "crystal ball",
    "birthday", "party", "cake", "candles", "presents", "balloons", "confetti", "streamers",
    "wedding", "bride", "groom", "ring", "bouquet", "veil", "tuxedo", "dress",
    "christmas", "santa", "reindeer", "sleigh", "present", "tree", "ornament", "star",
    "halloween", "pumpkin", "jack-o-lantern", "ghost", "witch", "vampire", "zombie", "candy",
    "easter", "bunny", "egg", "basket", "carrot", "chocolate", "peeps", "lily",
    "valentine", "heart", "cupid", "arrow", "rose", "chocolate", "card", "love",
    "fireworks", "sparkler", "rocket", "explosion", "celebration", "parade", "festival", "carnival",
    "beach", "sand", "waves", "seashell", "starfish", "crab", "lighthouse", "pier",
    "winter", "snow", "snowman", "snowflake", "icicle", "sled", "skis", "ice skates",
    "spring", "flower", "bud", "leaf", "rain", "puddle", "rainbow", "butterfly",
    "summer", "sun", "beach", "swimming", "ice cream", "barbecue", "picnic", "vacation",
    "autumn", "leaves", "acorn", "pumpkin", "harvest", "scarecrow", "haystack", "cornfield"
];

let challengeMode = {
    active: false,
    players: new Map(), // playerId -> {name, color, canvas: Array, submitted: boolean}
    currentWord: '',
    startTime: null,
    duration: 180000, // 3 minutes in milliseconds
    phase: 'waiting', // 'waiting', 'drawing', 'voting', 'results'
    submissions: new Map(), // playerId -> canvas data
    votes: new Map(), // voterId -> {targetId, rating}
    results: [],
    timer: null,
    // New voting system properties
    votingOrder: [], // Array of playerIds in voting order
    currentVotingIndex: 0, // Current submission being voted on
    currentSubmissionVotes: new Map(), // voterId -> rating for current submission
    votingTimer: 15000 // 15 seconds per submission
};

// Guess Mode Data
let guessMode = {
    active: false,
    players: new Map(), // playerId -> {name, color, isDrawer: boolean, hasGuessed: boolean, guessTime: number}
    currentWord: '',
    currentDrawer: null, // playerId of current drawer
    drawingStartTime: null,
    drawingDuration: 120000, // 2 minutes per drawing
    canvas: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('')), // Shared canvas for current drawing
    phase: 'waiting', // 'waiting', 'drawing', 'results'
    roundNumber: 0,
    playerOrder: [], // Array of playerIds for turn rotation
    currentPlayerIndex: 0,
    correctGuessers: [], // Array of {playerId, playerName, guessTime}
    timer: null,
    autoProgressTimer: null
};



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
        
        // Notify all players that someone joined
        io.emit('playerJoined', { playerName: name });
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

        const previousOwner = pixelOwners[y][x];
        const currentPixelColor = gameBoard[y][x];
        
        // Update the pixel
        gameBoard[y][x] = color;
        pixelOwners[y][x] = player.name;
        
        // Handle scoring based on pixel ownership and whether it's an eraser action
        const isEraserAction = color === '#ffffff';
        
        if (isEraserAction) {
            // Eraser logic: only deduct points if the pixel was the user's own color
            if (previousOwner === player.name && currentPixelColor !== '#ffffff' && currentPixelColor !== '') {
                // User is erasing their own colored pixel - deduct 1 point
                updateScore(player.name, -1);
                console.log(`🧽 Eraser: ${player.name} lost 1 point for erasing own pixel`);
            }
            // No points gained or lost for erasing empty pixels or others' pixels
            
            // For eraser, don't assign ownership - set pixel owner to empty
            pixelOwners[y][x] = '';
        } else {
            // Normal paint logic
            if (!previousOwner || previousOwner === '') {
                // New pixel - player gains 1 point
                updateScore(player.name, 1);
            } else if (previousOwner !== player.name) {
                // Taking over someone else's pixel - they lose 1, you gain 1
                updateScore(previousOwner, -1);
                updateScore(player.name, 1);
            }
            // If painting over your own pixel, no score change
        }
        
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

    // Challenge Mode Handlers
    socket.on('joinChallenge', () => {
        const player = players.get(socket.id);
        if (!player) return;

        // Add player to challenge mode regardless of phase
        challengeMode.players.set(socket.id, {
            name: player.name,
            color: player.color,
            canvas: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('')),
            submitted: false,
            waiting: challengeMode.active && challengeMode.phase !== 'waiting' // Mark as waiting if round is active
        });

        // Send appropriate response based on current phase
        if (challengeMode.active && challengeMode.phase !== 'waiting') {
            // Player joins during active round - put them in waiting state
            socket.emit('challengeWaiting', { 
                phase: challengeMode.phase,
                playerCount: Array.from(challengeMode.players.values()).filter(p => !p.waiting).length,
                timeLeft: challengeMode.phase === 'drawing' ? getRemainingTime() : null
            });
        } else {
            // Normal join
            socket.emit('challengeJoined', { 
                phase: challengeMode.phase,
                word: challengeMode.phase === 'drawing' ? challengeMode.currentWord : null,
                timeLeft: challengeMode.phase === 'drawing' ? getRemainingTime() : null
            });
        }

        // Start challenge if we have 2+ players and not already active
        if (challengeMode.players.size >= 2 && !challengeMode.active) {
            startChallenge();
        }

        // Send updated challenge lobby
        broadcastChallengeLobby();
    });

    socket.on('requestChallengeStatus', () => {
        // Send current challenge status to requesting player (even if they're not in challenge mode)
        const lobbyData = {
            playerCount: challengeMode.players.size,
            phase: challengeMode.phase,
            active: challengeMode.active,
            players: Array.from(challengeMode.players.values()).map(p => ({
                name: p.name,
                color: p.color,
                submitted: p.submitted
            }))
        };

        if (challengeMode.phase === 'drawing') {
            lobbyData.word = challengeMode.currentWord;
            lobbyData.timeLeft = getRemainingTime();
        }

        socket.emit('challengeLobbyUpdate', lobbyData);
    });

    socket.on('leaveChallenge', () => {
        challengeMode.players.delete(socket.id);
        
        // If we drop below 2 players during voting or results, end the challenge
        if (challengeMode.players.size < 2 && challengeMode.active && 
            (challengeMode.phase === 'voting' || challengeMode.phase === 'results')) {
            endChallenge();
        }
        
        broadcastChallengeLobby();
    });

    socket.on('challengePaint', (data) => {
        if (!challengeMode.players.has(socket.id) || challengeMode.phase !== 'drawing') return;
        
        const { x, y, color } = data;
        const challengePlayer = challengeMode.players.get(socket.id);
        
        // Update player's personal canvas
        challengePlayer.canvas[y][x] = color;
        
        // Send update to that player only
        socket.emit('challengeCanvasUpdate', { x, y, color });
    });

    socket.on('submitChallengeDrawing', () => {
        if (!challengeMode.players.has(socket.id) || challengeMode.phase !== 'drawing') return;
        
        const challengePlayer = challengeMode.players.get(socket.id);
        challengePlayer.submitted = true;
        challengeMode.submissions.set(socket.id, challengePlayer.canvas);
        
        socket.emit('drawingSubmitted');
        
        // Check if all players have submitted
        const allSubmitted = Array.from(challengeMode.players.values()).every(p => p.submitted);
        if (allSubmitted) {
            startVoting();
        }
    });

    socket.on('voteChallenge', (data) => {
        if (!challengeMode.players.has(socket.id) || challengeMode.phase !== 'voting') return;
        
        const { rating } = data;
        const currentPlayerId = challengeMode.votingOrder[challengeMode.currentVotingIndex];
        
        // Don't allow voting for yourself
        if (currentPlayerId === socket.id) return;
        
        // Store vote for current submission
        challengeMode.currentSubmissionVotes.set(socket.id, rating);
        
        // Notify player that vote was received
        socket.emit('voteReceived');
        
        // Check if all eligible players have voted on current submission
        const eligibleVoters = Array.from(challengeMode.players.keys()).filter(id => id !== currentPlayerId);
        const allVoted = eligibleVoters.every(voterId => challengeMode.currentSubmissionVotes.has(voterId));
        
        if (allVoted) {
            // All players voted, move to next submission immediately
            if (challengeMode.timer) {
                clearTimeout(challengeMode.timer);
                challengeMode.timer = null;
            }
            finishVotingOnCurrentSubmission();
        }
    });

    // Guess Mode Handlers
    socket.on('joinGuess', () => {
        const player = players.get(socket.id);
        if (!player) return;

        // Add player to guess mode
        guessMode.players.set(socket.id, {
            name: player.name,
            color: player.color,
            isDrawer: false,
            hasGuessed: false,
            guessTime: null
        });

        // Send appropriate response based on current phase
        if (guessMode.active && guessMode.phase !== 'waiting') {
            // Player joins during active round - put them in waiting state
            socket.emit('guessWaiting', { 
                phase: guessMode.phase,
                drawerName: guessMode.currentDrawer ? guessMode.players.get(guessMode.currentDrawer)?.name : null,
                playerCount: guessMode.players.size - 1, // Exclude current drawer
                timeLeft: guessMode.phase === 'drawing' ? getGuessRemainingTime() : null
            });
        } else {
            // Normal join
            socket.emit('guessJoined', { 
                phase: guessMode.phase
            });
        }

        // Start guess game if we have 2+ players and not already active
        if (guessMode.players.size >= 2 && !guessMode.active) {
            startGuessGame();
        }

        // Send updated guess lobby
        broadcastGuessLobby();
    });

    socket.on('requestGuessStatus', () => {
        // Send current guess status to requesting player
        const lobbyData = {
            playerCount: guessMode.players.size,
            phase: guessMode.phase,
            active: guessMode.active,
            players: Array.from(guessMode.players.values()).map(p => ({
                name: p.name,
                color: p.color,
                isDrawer: p.isDrawer,
                hasGuessed: p.hasGuessed
            }))
        };

        if (guessMode.phase === 'drawing' && guessMode.currentDrawer) {
            const drawerPlayer = guessMode.players.get(guessMode.currentDrawer);
            lobbyData.drawerName = drawerPlayer?.name;
            lobbyData.timeLeft = getGuessRemainingTime();
        }

        socket.emit('guessLobbyUpdate', lobbyData);
    });

    socket.on('leaveGuess', () => {
        const wasDrawer = guessMode.players.get(socket.id)?.isDrawer;
        guessMode.players.delete(socket.id);
        
        // If the drawer left, end the current round
        if (wasDrawer && guessMode.active) {
            endCurrentGuessRound();
        }
        
        // If we drop below 2 players, end the game
        if (guessMode.players.size < 2 && guessMode.active) {
            endGuessGame();
        }
        
        broadcastGuessLobby();
    });

    socket.on('guessPaint', (data) => {
        if (!guessMode.players.has(socket.id) || guessMode.phase !== 'drawing') return;
        
        const guessPlayer = guessMode.players.get(socket.id);
        if (!guessPlayer.isDrawer) return; // Only drawer can paint
        
        const { x, y, color } = data;
        
        // Update shared canvas
        guessMode.canvas[y][x] = color;
        
        // Send update to all players in guess mode
        io.to(Array.from(guessMode.players.keys())).emit('guessCanvasUpdate', { x, y, color });
    });

    socket.on('submitGuess', (data) => {
        if (!guessMode.players.has(socket.id) || guessMode.phase !== 'drawing') return;
        
        const guessPlayer = guessMode.players.get(socket.id);
        if (guessPlayer.isDrawer || guessPlayer.hasGuessed) return; // Drawer can't guess, and can't guess twice
        
        const { guess } = data;
        const isCorrect = guess.toLowerCase().trim() === guessMode.currentWord.toLowerCase();
        
        if (isCorrect) {
            // Mark player as having guessed correctly
            guessPlayer.hasGuessed = true;
            guessPlayer.guessTime = Date.now() - guessMode.drawingStartTime;
            
            // Add to correct guessers list
            guessMode.correctGuessers.push({
                playerId: socket.id,
                playerName: guessPlayer.name,
                guessTime: guessPlayer.guessTime
            });
            
            // Notify all players
            io.to(Array.from(guessMode.players.keys())).emit('guessSubmitted', {
                playerName: guessPlayer.name,
                guess: guess,
                isCorrect: true
            });
            
            // Check if all non-drawer players have guessed correctly
            const nonDrawerPlayers = Array.from(guessMode.players.values()).filter(p => !p.isDrawer);
            const allGuessed = nonDrawerPlayers.every(p => p.hasGuessed);
            
            if (allGuessed) {
                // All players guessed correctly, end round early
                endCurrentGuessRound();
            }
        } else {
            // Wrong guess
            io.to(Array.from(guessMode.players.keys())).emit('guessSubmitted', {
                playerName: guessPlayer.name,
                guess: guess,
                isCorrect: false
            });
        }
    });

    socket.on('disconnect', () => {
        const player = players.get(socket.id);
        if (player) {
            // Notify other players that this player disconnected (for cursor cleanup)
            socket.broadcast.emit('playerDisconnected', { playerName: player.name });
            
            // Notify all players that someone left
            io.emit('playerLeft', { playerName: player.name });
            
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

        // Handle challenge mode disconnect
        if (challengeMode.players.has(socket.id)) {
            challengeMode.players.delete(socket.id);
            challengeMode.votes.delete(socket.id);
            challengeMode.submissions.delete(socket.id);
            
            // End challenge if too few players
            if (challengeMode.players.size < 2 && challengeMode.active) {
                endChallenge();
            }
            
            broadcastChallengeLobby();
        }

        // Handle guess mode disconnect
        if (guessMode.players.has(socket.id)) {
            const wasDrawer = guessMode.players.get(socket.id)?.isDrawer;
            guessMode.players.delete(socket.id);
            
            // If the drawer left, end the current round
            if (wasDrawer && guessMode.active) {
                endCurrentGuessRound();
            }
            
            // End guess game if too few players
            if (guessMode.players.size < 2 && guessMode.active) {
                endGuessGame();
            }
            
            broadcastGuessLobby();
        }
    });
});

// Challenge Mode Helper Functions
function startChallenge() {
    challengeMode.active = true;
    challengeMode.phase = 'drawing';
    challengeMode.currentWord = challengeWords[Math.floor(Math.random() * challengeWords.length)];
    challengeMode.startTime = Date.now();
    challengeMode.submissions.clear();
    challengeMode.votes.clear();
    challengeMode.results = [];

    // Reset all player submission status and move waiting players into the round
    for (let player of challengeMode.players.values()) {
        player.submitted = false;
        player.canvas = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(''));
        player.waiting = false; // Move waiting players into the active round
    }

    // Start drawing timer
    challengeMode.timer = setTimeout(() => {
        startVoting();
    }, challengeMode.duration);

    // Notify all challenge players
    io.to(Array.from(challengeMode.players.keys())).emit('challengeStarted', {
        word: challengeMode.currentWord,
        duration: challengeMode.duration
    });

    broadcastChallengeLobby();
}

function startVoting() {
    if (challengeMode.timer) {
        clearTimeout(challengeMode.timer);
        challengeMode.timer = null;
    }

    challengeMode.phase = 'voting';
    challengeMode.votes.clear();
    challengeMode.currentSubmissionVotes.clear();
    challengeMode.currentVotingIndex = 0;

    // Prepare voting order (shuffle submissions for fairness)
    challengeMode.votingOrder = Array.from(challengeMode.submissions.keys());
    // Shuffle the array
    for (let i = challengeMode.votingOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [challengeMode.votingOrder[i], challengeMode.votingOrder[j]] = [challengeMode.votingOrder[j], challengeMode.votingOrder[i]];
    }

    if (challengeMode.votingOrder.length === 0) {
        // No submissions, skip to results
        showResults();
        return;
    }

    // Start voting on first submission
    startVotingOnCurrentSubmission();
}

function startVotingOnCurrentSubmission() {
    if (challengeMode.currentVotingIndex >= challengeMode.votingOrder.length) {
        // All submissions voted on, show results
        showResults();
        return;
    }

    challengeMode.currentSubmissionVotes.clear();
    const currentPlayerId = challengeMode.votingOrder[challengeMode.currentVotingIndex];
    const currentPlayer = challengeMode.players.get(currentPlayerId);
    const currentSubmission = challengeMode.submissions.get(currentPlayerId);

    if (!currentPlayer || !currentSubmission) {
        // Skip to next submission if data is missing
        challengeMode.currentVotingIndex++;
        startVotingOnCurrentSubmission();
        return;
    }

    // Notify all players about current submission to vote on
    for (let playerId of challengeMode.players.keys()) {
        const isOwnSubmission = playerId === currentPlayerId;
        io.to(playerId).emit('votingOnSubmission', {
            word: challengeMode.currentWord,
            submission: {
                playerId: currentPlayerId,
                playerName: currentPlayer.name,
                canvas: currentSubmission
            },
            isOwnSubmission: isOwnSubmission,
            currentIndex: challengeMode.currentVotingIndex + 1,
            totalSubmissions: challengeMode.votingOrder.length,
            timeLeft: challengeMode.votingTimer
        });
    }

    // Start timer for this submission
    challengeMode.timer = setTimeout(() => {
        finishVotingOnCurrentSubmission();
    }, challengeMode.votingTimer);

    broadcastChallengeLobby();
}

function finishVotingOnCurrentSubmission() {
    // Store votes for current submission
    const currentPlayerId = challengeMode.votingOrder[challengeMode.currentVotingIndex];
    
    // Calculate average rating for current submission
    let totalRating = 0;
    let voteCount = 0;
    
    for (let [voterId, rating] of challengeMode.currentSubmissionVotes) {
        totalRating += rating;
        voteCount++;
        // Also store in main votes map for final results
        challengeMode.votes.set(`${voterId}-${currentPlayerId}`, { targetId: currentPlayerId, rating });
    }

    // Move to next submission
    challengeMode.currentVotingIndex++;
    
    // Small delay before next submission
    setTimeout(() => {
        startVotingOnCurrentSubmission();
    }, 1000);
}

function showResults() {
    if (challengeMode.timer) {
        clearTimeout(challengeMode.timer);
        challengeMode.timer = null;
    }

    challengeMode.phase = 'results';

    // Calculate results
    const playerScores = new Map();
    
    // Initialize scores for all players
    for (let playerId of challengeMode.players.keys()) {
        playerScores.set(playerId, { totalRating: 0, voteCount: 0, averageRating: 0 });
    }

    // Calculate average ratings
    for (let vote of challengeMode.votes.values()) {
        const targetScore = playerScores.get(vote.targetId);
        if (targetScore) {
            targetScore.totalRating += vote.rating;
            targetScore.voteCount++;
        }
    }

    // Calculate averages and create results array
    challengeMode.results = [];
    for (let [playerId, scoreData] of playerScores) {
        const player = challengeMode.players.get(playerId);
        if (player && challengeMode.submissions.has(playerId)) {
            scoreData.averageRating = scoreData.voteCount > 0 ? scoreData.totalRating / scoreData.voteCount : 0;
            challengeMode.results.push({
                playerId,
                playerName: player.name,
                canvas: challengeMode.submissions.get(playerId),
                averageRating: Math.round(scoreData.averageRating * 100) / 100,
                voteCount: scoreData.voteCount
            });
        }
    }

    // Sort by average rating (highest first)
    challengeMode.results.sort((a, b) => b.averageRating - a.averageRating);

    // Track challenge winner
    if (challengeMode.results.length > 0) {
        // Winner determined - could add future winner tracking here
    }

    // Notify all players of results
    io.to(Array.from(challengeMode.players.keys())).emit('challengeResults', {
        word: challengeMode.currentWord,
        results: challengeMode.results
    });

    // Show results for 10 seconds, then restart if enough players
    challengeMode.timer = setTimeout(() => {
        if (challengeMode.players.size >= 2) {
            startChallenge();
        } else {
            endChallenge();
        }
    }, 10000);

    broadcastChallengeLobby();
}

function endChallenge() {
    if (challengeMode.timer) {
        clearTimeout(challengeMode.timer);
        challengeMode.timer = null;
    }

    challengeMode.active = false;
    challengeMode.phase = 'waiting';
    challengeMode.currentWord = '';
    challengeMode.startTime = null;
    challengeMode.submissions.clear();
    challengeMode.votes.clear();
    challengeMode.results = [];
    challengeMode.votingOrder = [];
    challengeMode.currentVotingIndex = 0;
    challengeMode.currentSubmissionVotes.clear();

    // Notify all remaining players
    io.to(Array.from(challengeMode.players.keys())).emit('challengeEnded');

    broadcastChallengeLobby();
}

function broadcastChallengeLobby() {
    const activePlayers = Array.from(challengeMode.players.values()).filter(p => !p.waiting);
    const waitingPlayers = Array.from(challengeMode.players.values()).filter(p => p.waiting);
    
    const lobbyData = {
        playerCount: challengeMode.players.size,
        activePlayerCount: activePlayers.length,
        waitingPlayerCount: waitingPlayers.length,
        phase: challengeMode.phase,
        active: challengeMode.active,
        players: activePlayers.map(p => ({
            name: p.name,
            color: p.color,
            submitted: p.submitted
        }))
    };

    if (challengeMode.phase === 'drawing') {
        lobbyData.word = challengeMode.currentWord;
        lobbyData.timeLeft = getRemainingTime();
    }

    // Send regular lobby update to active players
    const activePlayerIds = Array.from(challengeMode.players.keys()).filter(id => 
        !challengeMode.players.get(id).waiting
    );
    if (activePlayerIds.length > 0) {
        io.to(activePlayerIds).emit('challengeLobbyUpdate', lobbyData);
    }

    // Send waiting update to waiting players
    const waitingPlayerIds = Array.from(challengeMode.players.keys()).filter(id => 
        challengeMode.players.get(id).waiting
    );
    if (waitingPlayerIds.length > 0) {
        io.to(waitingPlayerIds).emit('waitingLobbyUpdate', {
            phase: challengeMode.phase,
            activePlayerCount: activePlayers.length,
            timeLeft: challengeMode.phase === 'drawing' ? getRemainingTime() : null
        });
    }
}

function getRemainingTime() {
    if (!challengeMode.startTime) return 0;
    const elapsed = Date.now() - challengeMode.startTime;
    return Math.max(0, challengeMode.duration - elapsed);
}

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

// Guess Mode Helper Functions
function startGuessGame() {
    guessMode.active = true;
    guessMode.phase = 'waiting';
    guessMode.roundNumber = 0;
    guessMode.playerOrder = Array.from(guessMode.players.keys());
    guessMode.currentPlayerIndex = 0;
    
    // Start first round
    startNextGuessRound();
}

function startNextGuessRound() {
    if (guessMode.players.size < 2) {
        endGuessGame();
        return;
    }
    
    guessMode.roundNumber++;
    guessMode.phase = 'drawing';
    guessMode.currentWord = challengeWords[Math.floor(Math.random() * challengeWords.length)];
    guessMode.drawingStartTime = Date.now();
    guessMode.correctGuessers = [];
    
    // Clear canvas for new round
    guessMode.canvas = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(''));
    
    // Reset all players
    for (let player of guessMode.players.values()) {
        player.isDrawer = false;
        player.hasGuessed = false;
        player.guessTime = null;
    }
    
    // Set current drawer
    if (guessMode.currentPlayerIndex >= guessMode.playerOrder.length) {
        guessMode.currentPlayerIndex = 0;
    }
    
    // Find next valid drawer (player still in game)
    let attempts = 0;
    while (attempts < guessMode.playerOrder.length) {
        const currentPlayerId = guessMode.playerOrder[guessMode.currentPlayerIndex];
        if (guessMode.players.has(currentPlayerId)) {
            guessMode.currentDrawer = currentPlayerId;
            guessMode.players.get(currentPlayerId).isDrawer = true;
            break;
        }
        guessMode.currentPlayerIndex = (guessMode.currentPlayerIndex + 1) % guessMode.playerOrder.length;
        attempts++;
    }
    
    if (!guessMode.currentDrawer) {
        endGuessGame();
        return;
    }
    
    // Start drawing timer
    guessMode.timer = setTimeout(() => {
        endCurrentGuessRound();
    }, guessMode.drawingDuration);
    
    // Notify all players
    const drawerPlayer = guessMode.players.get(guessMode.currentDrawer);
    for (let [playerId, player] of guessMode.players) {
        if (player.isDrawer) {
            // Notify drawer
            io.to(playerId).emit('guessStarted', {
                isDrawer: true,
                word: guessMode.currentWord,
                duration: guessMode.drawingDuration
            });
        } else {
            // Notify guessers
            io.to(playerId).emit('guessStarted', {
                isDrawer: false,
                drawerName: drawerPlayer.name,
                duration: guessMode.drawingDuration
            });
        }
    }
    
    broadcastGuessLobby();
}

function endCurrentGuessRound() {
    if (guessMode.timer) {
        clearTimeout(guessMode.timer);
        guessMode.timer = null;
    }
    
    guessMode.phase = 'results';
    
    // Create results data
    const results = {
        word: guessMode.currentWord,
        drawerName: guessMode.players.get(guessMode.currentDrawer)?.name,
        correctGuessers: guessMode.correctGuessers.sort((a, b) => a.guessTime - b.guessTime), // Fastest first
        totalPlayers: guessMode.players.size - 1 // Exclude drawer
    };
    
    // Notify all players of results
    io.to(Array.from(guessMode.players.keys())).emit('guessResults', results);
    
    // Move to next drawer
    guessMode.currentPlayerIndex = (guessMode.currentPlayerIndex + 1) % guessMode.playerOrder.length;
    
    // Auto-progress to next round after 8 seconds if 2+ players remain
    guessMode.autoProgressTimer = setTimeout(() => {
        if (guessMode.players.size >= 2) {
            // Set phase to waiting to allow new players to join
            guessMode.phase = 'waiting';
            broadcastGuessLobby();
            
            // Start next round after 15 seconds to give plenty of time for new players to join
            setTimeout(() => {
                if (guessMode.players.size >= 2) {
                    startNextGuessRound();
                } else {
                    endGuessGame();
                }
            }, 15000);
        } else {
            endGuessGame();
        }
    }, 8000);
    
    broadcastGuessLobby();
}

function endGuessGame() {
    if (guessMode.timer) {
        clearTimeout(guessMode.timer);
        guessMode.timer = null;
    }
    
    if (guessMode.autoProgressTimer) {
        clearTimeout(guessMode.autoProgressTimer);
        guessMode.autoProgressTimer = null;
    }
    
    guessMode.active = false;
    guessMode.phase = 'waiting';
    guessMode.currentWord = '';
    guessMode.currentDrawer = null;
    guessMode.drawingStartTime = null;
    guessMode.canvas = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(''));
    guessMode.roundNumber = 0;
    guessMode.playerOrder = [];
    guessMode.currentPlayerIndex = 0;
    guessMode.correctGuessers = [];
    
    // Notify all remaining players
    io.to(Array.from(guessMode.players.keys())).emit('guessEnded');
    
    broadcastGuessLobby();
}

function broadcastGuessLobby() {
    const lobbyData = {
        playerCount: guessMode.players.size,
        phase: guessMode.phase,
        active: guessMode.active,
        players: Array.from(guessMode.players.values()).map(p => ({
            name: p.name,
            color: p.color,
            isDrawer: p.isDrawer,
            hasGuessed: p.hasGuessed
        }))
    };
    
    if (guessMode.phase === 'drawing' && guessMode.currentDrawer) {
        const drawerPlayer = guessMode.players.get(guessMode.currentDrawer);
        lobbyData.drawerName = drawerPlayer?.name;
        lobbyData.timeLeft = getGuessRemainingTime();
        lobbyData.roundNumber = guessMode.roundNumber;
    }
    
    // Send lobby update to ALL connected players (not just those in guess mode)
    // This ensures that players viewing the guess modal but not yet joined also get updates
    io.emit('guessLobbyUpdate', lobbyData);
}

function getGuessRemainingTime() {
    if (!guessMode.drawingStartTime) return 0;
    const elapsed = Date.now() - guessMode.drawingStartTime;
    return Math.max(0, guessMode.drawingDuration - elapsed);
}



const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});