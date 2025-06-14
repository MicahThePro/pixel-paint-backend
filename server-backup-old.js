﻿const express = require('express');
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

// Challenge Words List (1000+ words for drawing prompts)
const challengeWords = [
"cat", "dog", "house", "tree", "car", "sun", "moon", "star", "flower", "bird",
"fish", "apple", "book", "chair", "table", "window", "door", "key", "heart", "smile",
"rainbow", "cloud", "mountain", "ocean", "beach", "castle", "crown", "sword", "shield", "dragon",
"unicorn", "butterfly", "bee", "spider", "snake", "elephant", "lion", "tiger", "bear", "rabbit",
"horse", "cow", "pig", "sheep", "chicken", "duck", "frog", "turtle", "penguin", "owl",
"eagle", "shark", "whale", "dolphin", "octopus", "crab", "starfish", "mushroom", "rose", "tulip",
"sunflower", "cactus", "palm", "pizza", "burger", "cake", "cookie", "ice cream", "coffee", "tea",
"banana", "orange", "strawberry", "grape", "cherry", "pineapple", "watermelon", "carrot", "broccoli", "corn",
"bicycle", "airplane", "train", "boat", "rocket", "helicopter", "bus", "truck", "motorcycle", "skateboard",
"guitar", "piano", "drum", "violin", "microphone", "camera", "computer", "phone", "television", "radio",
"lamp", "clock", "mirror", "pillow", "blanket", "umbrella", "hat", "shoes", "glasses", "watch",
"necklace", "ring", "crown", "diamond", "treasure", "map", "compass", "telescope", "microscope", "robot",
"alien", "spaceship", "planet", "comet", "galaxy", "volcano", "island", "waterfall", "bridge", "lighthouse",
"windmill", "barn", "fence", "garden", "playground", "swing", "slide", "seesaw", "balloon", "kite",
"snowman", "snowflake", "icicle", "campfire", "tent", "backpack", "flashlight", "candle", "lantern", "torch",
"magic", "wand", "crystal", "potion", "spell", "witch", "wizard", "fairy", "angel", "ghost",
"pumpkin", "witch hat", "cauldron", "broom", "spider web", "bat", "skull", "skeleton", "zombie", "mummy",
"pirate", "treasure chest", "parrot", "ship", "anchor", "sail", "flag", "cannon", "sword fight", "island",
"knight", "armor", "helmet", "lance", "banner", "siege", "catapult", "drawbridge", "moat", "tower",
"princess", "prince", "king", "queen", "throne", "scepter", "orb", "royal", "court", "palace",
"ninja", "samurai", "katana", "shuriken", "mask", "stealth", "shadow", "temple", "pagoda", "dojo",
"cowboy", "sheriff", "badge", "lasso", "boots", "hat", "horse", "saddle", "cactus", "desert",
"astronaut", "space suit", "helmet", "moon landing", "flag", "crater", "earth", "satellite", "station", "probe",
"detective", "magnifying glass", "footprint", "clue", "mystery", "case", "evidence", "suspect", "witness", "crime",
"doctor", "stethoscope", "bandage", "medicine", "hospital", "ambulance", "nurse", "surgery", "patient", "clinic",
"teacher", "blackboard", "chalk", "lesson", "student", "desk", "pencil", "eraser", "ruler", "notebook",
"chef", "apron", "knife", "cutting board", "recipe", "ingredient", "oven", "stove", "pot", "pan",
"artist", "paintbrush", "palette", "easel", "canvas", "sculpture", "sketch", "drawing", "masterpiece", "gallery",
"musician", "concert", "stage", "audience", "melody", "rhythm", "harmony", "note", "scale", "chord",
"athlete", "trophy", "medal", "stadium", "track", "field", "goal", "score", "team", "victory",
"farmer", "tractor", "plow", "harvest", "crop", "seed", "soil", "irrigation", "greenhouse", "scarecrow",
"fisherman", "rod", "reel", "bait", "hook", "net", "boat", "lake", "river", "catch",
"builder", "hammer", "nail", "saw", "drill", "blueprint", "foundation", "beam", "brick", "cement",
"mechanic", "wrench", "screwdriver", "engine", "oil", "tire", "brake", "gear", "transmission", "repair",
"pilot", "cockpit", "runway", "takeoff", "landing", "altitude", "navigation", "radar", "control tower", "flight",
"sailor", "mast", "deck", "cabin", "navigation", "compass", "anchor", "port", "starboard", "voyage",
"firefighter", "hose", "ladder", "helmet", "truck", "hydrant", "smoke", "rescue", "emergency", "alarm",
"police", "badge", "handcuffs", "patrol", "siren", "investigation", "arrest", "law", "justice", "court",
"scientist", "lab", "experiment", "hypothesis", "research", "discovery", "invention", "formula", "equation", "theory",
"engineer", "blueprint", "design", "prototype", "circuit", "wire", "component", "system", "technology", "innovation",
"photographer", "lens", "flash", "tripod", "portrait", "landscape", "exposure", "focus", "frame", "darkroom",
"journalist", "interview", "article", "headline", "newspaper", "press", "media", "story", "report", "scoop",
"librarian", "shelf", "catalog", "reference", "archive", "manuscript", "index", "database", "research", "knowledge",
"archaeologist", "dig", "artifact", "fossil", "excavation", "ruins", "ancient", "civilization", "discovery", "history",
"veterinarian", "animal", "examination", "treatment", "vaccine", "surgery", "clinic", "care", "health", "medicine",
"dentist", "tooth", "filling", "crown", "x-ray", "drill", "floss", "brush", "hygiene", "smile",
"optometrist", "eye", "vision", "glasses", "contact", "examination", "chart", "lens", "prescription", "sight",
"barber", "scissors", "razor", "trim", "shave", "haircut", "salon", "style", "mirror", "chair",
"tailor", "needle", "thread", "fabric", "pattern", "seam", "button", "zipper", "alteration", "fitting",
"baker", "dough", "flour", "yeast", "oven", "bread", "pastry", "cake", "cookie", "frosting",
"gardener", "shovel", "rake", "hoe", "watering can", "seeds", "soil", "compost", "pruning", "bloom",
"janitor", "broom", "mop", "bucket", "cleaning", "vacuum", "trash", "recycling", "maintenance", "hygiene",
"security", "guard", "camera", "monitor", "patrol", "alarm", "badge", "radio", "checkpoint", "surveillance",
"cashier", "register", "receipt", "change", "transaction", "customer", "payment", "scanner", "till", "counter",
"waiter", "menu", "order", "tray", "service", "tip", "table", "restaurant", "kitchen", "customer",
"delivery", "package", "truck", "route", "address", "signature", "cargo", "shipping", "logistics", "warehouse",
"travel", "suitcase", "passport", "ticket", "journey", "destination", "vacation", "hotel", "flight", "adventure",
"camping", "tent", "sleeping bag", "campfire", "marshmallow", "hiking", "trail", "wilderness", "nature", "outdoors",
"fishing", "rod", "reel", "bait", "tackle", "boat", "lake", "catch", "patience", "tranquil",
"hunting", "rifle", "scope", "camouflage", "deer", "duck", "forest", "track", "season", "license",
"skiing", "slope", "lift", "poles", "boots", "snow", "mountain", "alpine", "powder", "downhill",
"swimming", "pool", "lane", "stroke", "dive", "goggle", "cap", "lap", "freestyle", "backstroke",
"running", "track", "marathon", "sprint", "hurdle", "finish", "time", "pace", "endurance", "training",
"cycling", "bike", "helmet", "pedal", "gear", "chain", "wheel", "road", "trail", "speed",
"basketball", "hoop", "court", "dribble", "shoot", "pass", "rebound", "dunk", "free throw", "team",
"football", "field", "goal", "touchdown", "quarterback", "pass", "run", "tackle", "helmet", "stadium",
"baseball", "bat", "ball", "glove", "base", "home run", "strike", "pitch", "catch", "diamond",
"soccer", "goal", "kick", "pass", "dribble", "header", "penalty", "corner", "offside", "referee",
"tennis", "racket", "ball", "court", "serve", "volley", "net", "ace", "deuce", "match",
"golf", "club", "ball", "tee", "green", "hole", "putt", "drive", "iron", "sand trap",
"boxing", "glove", "ring", "punch", "jab", "hook", "uppercut", "round", "referee", "corner",
"wrestling", "mat", "pin", "takedown", "grapple", "hold", "submission", "referee", "weight", "championship",
"martial arts", "belt", "kata", "sparring", "dojo", "sensei", "uniform", "discipline", "technique", "meditation",
"gymnastics", "beam", "vault", "rings", "parallel bars", "floor", "routine", "flexibility", "strength", "grace",
"ice skating", "rink", "blade", "figure", "spin", "jump", "glide", "grace", "cold", "performance",
"roller skating", "wheel", "rink", "speed", "derby", "trick", "balance", "fun", "music", "disco",
"surfing", "board", "wave", "ocean", "beach", "curl", "ride", "balance", "wetsuit", "tide",
"sailing", "boat", "wind", "sail", "mast", "tack", "regatta", "harbor", "anchor", "breeze",
"kayaking", "paddle", "river", "rapid", "calm", "stroke", "navigate", "current", "adventure", "nature",
"rock climbing", "rope", "harness", "cliff", "grip", "anchor", "belay", "route", "summit", "challenge",
"hiking", "trail", "backpack", "boots", "map", "compass", "summit", "valley", "ridge", "wilderness",
"photography", "camera", "lens", "shot", "frame", "exposure", "light", "shadow", "portrait", "landscape",
"painting", "brush", "canvas", "palette", "color", "stroke", "texture", "composition", "light", "shadow",
"drawing", "pencil", "paper", "sketch", "line", "shade", "proportion", "perspective", "detail", "artistic",
"sculpture", "clay", "chisel", "marble", "bronze", "form", "texture", "dimension", "artistic", "creation",
"pottery", "wheel", "clay", "glaze", "kiln", "bowl", "vase", "ceramic", "craft", "artistic",
"weaving", "loom", "thread", "pattern", "textile", "fabric", "tapestry", "craft", "traditional", "artistic",
"knitting", "needle", "yarn", "stitch", "pattern", "sweater", "scarf", "blanket", "craft", "cozy",
"sewing", "machine", "needle", "thread", "fabric", "pattern", "seam", "hem", "button", "zipper",
"embroidery", "hoop", "needle", "thread", "pattern", "stitch", "decorative", "fabric", "artistic", "detailed",
"quilting", "patch", "pattern", "layer", "stitch", "blanket", "traditional", "craft", "geometric", "colorful",
"woodworking", "saw", "chisel", "plane", "sandpaper", "stain", "varnish", "joint", "craft", "furniture",
"metalworking", "forge", "hammer", "anvil", "fire", "iron", "steel", "craft", "blacksmith", "tool",
"jewelry", "gold", "silver", "gem", "ring", "necklace", "bracelet", "earring", "precious", "beautiful",
"glassblowing", "furnace", "pipe", "molten", "shape", "cool", "delicate", "artistic", "transparent", "craft",
"cooking", "recipe", "ingredient", "flavor", "spice", "herb", "technique", "taste", "aroma", "delicious",
"baking", "oven", "flour", "sugar", "butter", "egg", "recipe", "rise", "golden", "sweet",
"grilling", "barbecue", "flame", "smoke", "char", "marinade", "outdoor", "summer", "sizzle", "savory",
"brewing", "hops", "barley", "yeast", "fermentation", "barrel", "craft", "flavor", "foam", "refreshing",
"wine making", "grape", "barrel", "fermentation", "vintage", "cellar", "tasting", "bouquet", "cork", "elegant",
"gardening", "soil", "seed", "water", "sun", "growth", "bloom", "harvest", "natural", "peaceful",
"composting", "organic", "decompose", "nutrient", "soil", "recycle", "earth", "sustainable", "natural", "green",
"beekeeping", "hive", "honey", "pollen", "swarm", "queen", "worker", "hexagon", "sweet", "natural",
"bird watching", "binocular", "nest", "migration", "species", "feather", "song", "habitat", "nature", "peaceful",
"stargazing", "telescope", "constellation", "planet", "meteor", "galaxy", "universe", "night", "wonder", "infinite",
"reading", "book", "page", "chapter", "story", "character", "plot", "knowledge", "imagination", "quiet",
"writing", "pen", "paper", "word", "sentence", "paragraph", "story", "creative", "expression", "thought",
"poetry", "verse", "rhyme", "metaphor", "rhythm", "emotion", "beauty", "language", "artistic", "expressive",
"storytelling", "narrative", "character", "plot", "beginning", "middle", "end", "moral", "tradition", "oral",
"dancing", "rhythm", "movement", "grace", "expression", "music", "partner", "step", "flow", "artistic",
"singing", "voice", "melody", "harmony", "lyrics", "emotion", "performance", "microphone", "stage", "beautiful",
"acting", "character", "role", "script", "stage", "audience", "emotion", "performance", "theater", "dramatic",
"magic", "trick", "illusion", "wand", "rabbit", "hat", "disappear", "amazing", "wonder", "entertainment",
"juggling", "ball", "pin", "club", "rhythm", "coordination", "skill", "entertainment", "circus", "balance",
"acrobatics", "flip", "tumble", "balance", "strength", "flexibility", "performance", "circus", "amazing", "graceful",
"meditation", "peace", "calm", "breath", "mindful", "serene", "quiet", "inner", "spiritual", "centered",
"yoga", "pose", "stretch", "balance", "breath", "flexibility", "strength", "peace", "harmony", "wellness",
"exercise", "fitness", "health", "strength", "endurance", "sweat", "energy", "vitality", "movement", "wellness",
"stretching", "flexibility", "muscle", "warm-up", "cool-down", "range", "motion", "relaxation", "health", "wellness",
"massage", "relaxation", "muscle", "tension", "relief", "therapeutic", "healing", "wellness", "calm", "soothing",
"spa", "relaxation", "treatment", "facial", "massage", "wellness", "luxury", "pamper", "rejuvenate", "peaceful",
"sauna", "heat", "steam", "sweat", "relaxation", "wooden", "hot", "cleansing", "therapeutic", "wellness",
"beach", "sand", "wave", "sun", "ocean", "seashell", "tide", "vacation", "relaxation", "paradise",
"mountain", "peak", "valley", "ridge", "summit", "hiking", "view", "majestic", "nature", "elevation",
"forest", "tree", "wildlife", "trail", "peaceful", "green", "shade", "natural", "ecosystem", "serene",
"desert", "sand", "dune", "cactus", "hot", "dry", "vast", "oasis", "survival", "barren",
"jungle", "dense", "vine", "canopy", "wildlife", "humid", "green", "adventure", "exotic", "mysterious",
"prairie", "grass", "wide", "open", "wind", "horizon", "peaceful", "natural", "vast", "simple",
"tundra", "cold", "frozen", "barren", "arctic", "ice", "harsh", "survival", "white", "desolate",
"wetland", "marsh", "swamp", "water", "wildlife", "ecosystem", "bird", "habitat", "natural", "protected",
"coral reef", "colorful", "underwater", "fish", "tropical", "ecosystem", "beautiful", "delicate", "marine", "vibrant",
"cave", "dark", "echo", "stalactite", "stalagmite", "underground", "exploration", "mysterious", "cool", "hidden",
"waterfall", "cascade", "mist", "power", "natural", "beautiful", "flow", "rock", "pool", "majestic",
"geyser", "eruption", "hot", "steam", "natural", "wonder", "power", "earth", "spectacular", "rare",
"volcano", "lava", "eruption", "magma", "ash", "crater", "power", "destruction", "creation", "fire",
"earthquake", "shake", "tremor", "fault", "plate", "power", "natural", "disaster", "movement", "earth",
"tornado", "wind", "spiral", "destruction", "power", "storm", "funnel", "weather", "dangerous", "force",
"hurricane", "wind", "rain", "storm", "eye", "destruction", "power", "weather", "spiral", "dangerous",
"blizzard", "snow", "wind", "cold", "white", "storm", "visibility", "winter", "harsh", "frozen",
"thunderstorm", "lightning", "thunder", "rain", "wind", "dark", "electric", "power", "storm", "dramatic",
"rainbow", "color", "arc", "beautiful", "rain", "sun", "prism", "spectrum", "hope", "magical",
"aurora", "northern", "lights", "color", "sky", "magnetic", "beautiful", "rare", "wonder", "celestial",
"comet", "tail", "orbit", "ice", "space", "bright", "celestial", "visitor", "rare", "beautiful",
"meteor", "shooting", "star", "space", "rock", "bright", "trail", "wish", "celestial", "brief",
"eclipse", "shadow", "moon", "sun", "rare", "celestial", "event", "darkness", "alignment", "wonder",
"constellation", "star", "pattern", "sky", "mythology", "navigation", "beautiful", "ancient", "celestial", "story",
"galaxy", "star", "spiral", "universe", "vast", "space", "milky", "way", "cosmic", "infinite",
"planet", "orbit", "solar", "system", "round", "space", "world", "celestial", "body", "exploration",
"satellite", "orbit", "space", "communication", "artificial", "technology", "signal", "earth", "transmission", "modern",
"space station", "orbit", "research", "laboratory", "astronaut", "international", "technology", "science", "space", "cooperation",
"rocket", "launch", "space", "fuel", "engine", "exploration", "technology", "power", "thrust", "mission",
"spacecraft", "vehicle", "space", "exploration", "technology", "mission", "crew", "journey", "adventure", "future",
"time travel", "past", "future", "machine", "science", "fiction", "adventure", "paradox", "temporal", "journey",
"teleportation", "instant", "transport", "science", "fiction", "beam", "molecular", "travel", "futuristic", "convenient",
"invisibility", "unseen", "hidden", "cloak", "disappear", "stealth", "secret", "power", "magic", "science fiction",
"super strength", "power", "muscle", "lift", "strong", "hero", "ability", "incredible", "force", "superhuman",
"flying", "soar", "sky", "freedom", "bird", "airplane", "height", "weightless", "dream", "liberation",
"underwater", "submarine", "ocean", "deep", "pressure", "explore", "marine", "diving", "aquatic", "blue",
"underground", "tunnel", "cave", "mine", "subway", "basement", "hidden", "dark", "earth", "below",
"skyscraper", "tall", "building", "city", "elevator", "view", "modern", "architecture", "steel", "glass",
"bridge", "span", "river", "connection", "engineering", "arch", "suspension", "crossing", "structure", "impressive",
"tunnel", "underground", "passage", "through", "mountain", "engineering", "dark", "travel", "connection", "boring",
"dam", "water", "concrete", "power", "hydroelectric", "reservoir", "engineering", "massive", "control", "structure",
"lighthouse", "beacon", "navigation", "shore", "warning", "ships", "tall", "light", "safety", "coastal",
"windmill", "wind", "power", "grain", "flour", "blades", "renewable", "energy", "rural", "traditional",
"solar panel", "sun", "energy", "electricity", "renewable", "clean", "power", "technology", "environment", "sustainable",
"wind turbine", "wind", "energy", "electricity", "renewable", "clean", "power", "blades", "generator", "tall",
"nuclear", "power", "plant", "energy", "electricity", "reactor", "uranium", "steam", "cooling", "atomic",
"oil rig", "drilling", "petroleum", "ocean", "platform", "extraction", "fuel", "energy", "offshore", "industrial",
"mine", "excavation", "coal", "metal", "ore", "underground", "extraction", "industrial", "tunnel", "dangerous",
"factory", "manufacturing", "production", "assembly", "industrial", "machinery", "worker", "goods", "smoke", "busy",
"warehouse", "storage", "goods", "inventory", "distribution", "large", "boxes", "logistics", "shipping", "industrial",
"farm", "agriculture", "crop", "livestock", "rural", "barn", "tractor", "harvest", "food", "peaceful",
"ranch", "cattle", "horse", "cowboy", "rural", "open", "range", "livestock", "western", "wide",
"vineyard", "grape", "wine", "row", "harvest", "rural", "scenic", "agriculture", "rolling", "hills",
"orchard", "fruit", "tree", "harvest", "rural", "apple", "cherry", "peach", "agriculture", "seasonal",
"greenhouse", "plants", "controlled", "environment", "agriculture", "glass", "growing", "temperature", "humidity", "cultivation",
"laboratory", "science", "research", "experiment", "equipment", "white", "coat", "discovery", "analysis", "sterile",
"observatory", "telescope", "astronomy", "star", "research", "dome", "celestial", "observation", "science", "discovery",
"museum", "artifact", "history", "culture", "education", "exhibit", "preservation", "knowledge", "learning", "heritage",
"library", "book", "knowledge", "quiet", "study", "research", "shelf", "reading", "learning", "peaceful",
"school", "education", "student", "teacher", "classroom", "learning", "knowledge", "desk", "book", "future",
"university", "higher", "education", "student", "professor", "research", "degree", "campus", "knowledge", "academic",
"hospital", "medical", "care", "doctor", "nurse", "patient", "healing", "treatment", "health", "emergency",
"pharmacy", "medicine", "prescription", "health", "care", "pill", "treatment", "healing", "drug", "wellness",
"clinic", "medical", "care", "doctor", "patient", "health", "treatment", "examination", "healing", "wellness",
"courthouse", "justice", "law", "judge", "trial", "legal", "government", "order", "fairness", "authority",
"police station", "law", "enforcement", "safety", "security", "officer", "protection", "crime", "justice", "order",
"fire station", "firefighter", "emergency", "rescue", "safety", "truck", "ladder", "siren", "protection", "service",
"post office", "mail", "letter", "package", "delivery", "stamp", "communication", "service", "postal", "government",
"bank", "money", "finance", "savings", "loan", "vault", "security", "transaction", "economy", "business",
"restaurant", "food", "dining", "chef", "waiter", "menu", "kitchen", "delicious", "service", "social",
"cafe", "coffee", "relaxation", "social", "casual", "beverage", "pastry", "atmosphere", "meeting", "comfortable",
"bakery", "bread", "pastry", "cake", "fresh", "oven", "flour", "sweet", "delicious", "warm",
"grocery store", "food", "shopping", "aisle", "checkout", "cart", "fresh", "variety", "daily", "necessity",
"mall", "shopping", "store", "retail", "consumer", "variety", "entertainment", "social", "commercial", "busy",
"market", "vendor", "fresh", "produce", "local", "community", "bargain", "variety", "social", "traditional",
"gas station", "fuel", "car", "pump", "travel", "convenience", "highway", "service", "automobile", "stop",
"hotel", "accommodation", "travel", "vacation", "comfort", "service", "luxury", "temporary", "hospitality", "rest",
"airport", "airplane", "travel", "departure", "arrival", "terminal", "runway", "luggage", "journey", "international",
"train station", "railway", "platform", "departure", "arrival", "travel", "commute", "schedule", "transportation", "journey",
"bus stop", "public", "transportation", "schedule", "commute", "urban", "convenient", "affordable", "regular", "community",
"subway", "underground", "train", "urban", "transportation", "tunnel", "platform", "commute", "efficient", "metro",
"taxi", "ride", "transportation", "urban", "convenient", "driver", "fare", "door", "service", "quick",
"parking", "car", "space", "urban", "meter", "ticket", "garage", "lot", "vehicle", "storage",
"playground", "children", "play", "swing", "slide", "fun", "laughter", "community", "recreation", "childhood",
"park", "green", "space", "recreation", "peaceful", "nature", "walking", "relaxation", "community", "trees",
"zoo", "animal", "wildlife", "conservation", "education", "family", "exhibit", "habitat", "protection", "learning",
"aquarium", "fish", "marine", "underwater", "education", "conservation", "tank", "ocean", "colorful", "peaceful",
"circus", "entertainment", "performer", "acrobat", "clown", "tent", "ring", "audience", "amazing", "spectacle",
"theater", "performance", "actor", "stage", "audience", "drama", "comedy", "entertainment", "cultural", "artistic",
"concert", "music", "performer", "audience", "stage", "sound", "entertainment", "rhythm", "melody", "live",
"stadium", "sport", "audience", "team", "competition", "large", "crowd", "cheer", "event", "excitement",
"gym", "fitness", "exercise", "equipment", "health", "strength", "training", "workout", "wellness", "active",
"spa", "relaxation", "wellness", "massage", "treatment", "luxury", "peaceful", "rejuvenation", "pamper", "tranquil",
"cemetery", "peaceful", "memorial", "respect", "quiet", "remembrance", "grave", "stone", "flowers", "eternal",
"church", "worship", "spiritual", "community", "faith", "prayer", "peace", "sacred", "tradition", "gathering",
"temple", "worship", "spiritual", "sacred", "meditation", "peace", "tradition", "architecture", "religious", "serene",
"mosque", "worship", "spiritual", "Islamic", "prayer", "minaret", "community", "faith", "sacred", "peaceful",
"synagogue", "worship", "Jewish", "spiritual", "community", "faith", "tradition", "sacred", "prayer", "cultural",
"monument", "memorial", "history", "honor", "remembrance", "stone", "statue", "respect", "commemoration", "permanent",
"statue", "sculpture", "art", "bronze", "marble", "memorial", "honor", "artistic", "public", "monument",
"fountain", "water", "decorative", "peaceful", "splash", "beauty", "public", "relaxing", "artistic", "refreshing",
"garden", "flower", "peaceful", "beauty", "nature", "color", "fragrance", "cultivation", "tranquil", "artistic",
"maze", "puzzle", "path", "challenge", "hedge", "lost", "find", "way", "confusing", "adventure",
"labyrinth", "path", "spiritual", "journey", "meditation", "center", "ancient", "walking", "peaceful", "symbolic"
];

app.use(express.static(path.join(__dirname, '..')));

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
        console.log(`🎨 Paint request: (${x},${y}) color:${color} by ${player ? player.name : 'unknown'}`);
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
                console.log(`📊 Score transfer: ${previousOwner} -1, ${player.name} +1`);
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

    // Track challenge winner (if there are results and a clear winner)
    if (challengeMode.results.length > 0) {
        const winner = challengeMode.results[0];
        if (winner.voteCount > 0) { // Only count as winner if they received votes
            // Winner determined - could add future winner tracking here
        }
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

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
