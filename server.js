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
    patterns: new Map()
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

// Room Management System
const rooms = new Map();
const ROOM_CLEANUP_INTERVAL = 300000; // 5 minutes

// Remove old global game state - now handled per room
// The following global variables are replaced by room-specific state:
// - gameBoard, pixelOwners, players, scores
// - challengeMode, guessMode

// Room data structure
function createRoom(roomId) {
    return {
        id: roomId,
        gameBoard: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('')),
        pixelOwners: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('')),
        players: new Map(),
        scores: new Map(),
        lastActivity: Date.now(),
        challengeMode: {
            active: false,
            phase: 'waiting',
            currentWord: '',
            players: new Map(),
            submissions: new Map(),
            votes: new Map(),
            currentSubmissionVotes: new Map(),
            votingOrder: [],
            currentVotingIndex: 0,
            results: [],
            timer: null,
            startTime: null,
            duration: 120000
        },
        guessMode: {
            active: false,
            currentWord: '',
            currentDrawer: null,
            drawingStartTime: null,
            drawingDuration: 120000,
            canvas: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('')),
            phase: 'waiting',
            roundNumber: 0,
            playerOrder: [],
            currentPlayerIndex: 0,
            correctGuessers: [],
            timer: null,
            autoProgressTimer: null,
            players: new Map()
        }
    };
}

// Generate random room code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Get or create room
function getOrCreateRoom(roomId) {
    if (!roomId) {
        roomId = 'main'; // Default room
    }
    
    if (!rooms.has(roomId)) {
        rooms.set(roomId, createRoom(roomId));
        console.log(`📦 Created room: ${roomId}`);
    }
    
    const room = rooms.get(roomId);
    room.lastActivity = Date.now();
    return room;
}

// Clean up empty rooms
function cleanupEmptyRooms() {
    const now = Date.now();
    for (const [roomId, room] of rooms.entries()) {
        if (roomId !== 'main' && room.players.size === 0 && (now - room.lastActivity) > ROOM_CLEANUP_INTERVAL) {
            rooms.delete(roomId);
            console.log(`🗑️ Cleaned up empty room: ${roomId}`);
        }
    }
}

// Clean up empty rooms every 5 minutes
setInterval(cleanupEmptyRooms, ROOM_CLEANUP_INTERVAL);

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

// Legacy global variables removed - now handled per room in room.challengeMode and room.guessMode

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

    // Room management handlers
    socket.on('createRoom', (data) => {
        const { customName, isPrivate } = data;
        const roomId = customName || generateRoomCode();
        const roomName = customName || `Room ${roomId}`;
        
        // Create the room
        const room = getOrCreateRoom(roomId);
        
        // Join the socket to the room
        socket.join(roomId);
        socket.currentRoomId = roomId;
        
        socket.emit('roomCreated', { roomId, roomName });
        console.log(`🏠 Room created: ${roomId} (${roomName})`);
    });

    socket.on('joinRoom', (data) => {
        const { roomId } = data;
        
        if (!roomId) {
            socket.emit('roomError', { message: 'Invalid room code' });
            return;
        }
        
        const room = getOrCreateRoom(roomId);
        
        // Leave current room if in one
        if (socket.currentRoomId) {
            socket.leave(socket.currentRoomId);
        }
        
        // Join new room
        socket.join(roomId);
        socket.currentRoomId = roomId;
        
        const roomName = roomId === 'main' ? 'Main' : `Room ${roomId}`;
        socket.emit('roomJoined', { roomId, roomName });
        
        // Send current room state
        socket.emit('fullBoard', room.gameBoard);
        socket.emit('roomPlayerCount', { count: room.players.size });
        
        console.log(`🔗 User joined room: ${roomId}`);
    });

    socket.on('join', (data) => {
        const { name, color, roomId } = data;
        console.log(`🎮 Player joining: ${name} with color ${color} in room ${roomId || 'main'}`);

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

        // Get or create room
        const currentRoomId = roomId || socket.currentRoomId || 'main';
        const room = getOrCreateRoom(currentRoomId);
        
        // Join socket to room if not already
        if (socket.currentRoomId !== currentRoomId) {
            if (socket.currentRoomId) {
                socket.leave(socket.currentRoomId);
            }
            socket.join(currentRoomId);
            socket.currentRoomId = currentRoomId;
        }

        // Add player to room
        room.players.set(socket.id, { name, color });
        room.scores.set(name, { score: 0, color });
        
        // Send room-specific data
        socket.emit('fullBoard', room.gameBoard);
        updateRoomScores(currentRoomId);
        io.to(currentRoomId).emit('playerListUpdate', Array.from(room.players.values()));
        io.to(currentRoomId).emit('roomPlayerCount', { count: room.players.size });
        
        // Notify room players that someone joined
        socket.to(currentRoomId).emit('playerJoined', { playerName: name });
    });

    // Allow viewing the board without joining
    socket.on('requestBoard', () => {
        const currentRoomId = socket.currentRoomId || 'main';
        const room = getOrCreateRoom(currentRoomId);
        socket.emit('fullBoard', room.gameBoard);
    });

    // Allow requesting current scores without joining
    socket.on('requestScores', () => {
        const currentRoomId = socket.currentRoomId || 'main';
        updateRoomScores(currentRoomId);
    });

    socket.on('paint', (data) => {
        const { x, y, color } = data;
        const currentRoomId = socket.currentRoomId || 'main';
        const room = getOrCreateRoom(currentRoomId);
        const player = room.players.get(socket.id);
        if (!player) return;

        const previousOwner = room.pixelOwners[y][x];
        const currentPixelColor = room.gameBoard[y][x];
        
        // Handle eraser action
        const isEraserAction = color === '#ffffff';
        
        if (isEraserAction) {
            // Eraser logic: only allow erasing your own pixels
            if (previousOwner === player.name && currentPixelColor !== '#ffffff' && currentPixelColor !== '') {
                // User is erasing their own colored pixel - deduct 1 point and clear pixel
                room.gameBoard[y][x] = '';
                room.pixelOwners[y][x] = '';
                updateRoomScore(currentRoomId, player.name, -1);
                console.log(`🧽 Eraser: ${player.name} lost 1 point for erasing own pixel`);
                io.to(currentRoomId).emit('boardUpdate', { x, y, color: '#ffffff', playerName: player.name });
            }
            // If trying to erase empty pixel or someone else's pixel, do nothing
            return;
        } else {
            // Normal paint logic
            room.gameBoard[y][x] = color;
            room.pixelOwners[y][x] = player.name;
            
            if (!previousOwner || previousOwner === '') {
                // New pixel - player gains 1 point
                updateRoomScore(currentRoomId, player.name, 1);
            } else if (previousOwner !== player.name) {
                // Taking over someone else's pixel - they lose 1, you gain 1
                updateRoomScore(currentRoomId, previousOwner, -1);
                updateRoomScore(currentRoomId, player.name, 1);
            }
            // If painting over your own pixel, no score change
            
            io.to(currentRoomId).emit('boardUpdate', { x, y, color, playerName: player.name });
        }
    });

    // Handle cursor movement
    socket.on('cursorMove', (data) => {
        const currentRoomId = socket.currentRoomId || 'main';
        const room = getOrCreateRoom(currentRoomId);
        const player = room.players.get(socket.id);
        if (!player) return;
        
        // Broadcast cursor position to all other players in the same room
        socket.to(currentRoomId).emit('cursorUpdate', {
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
        // Reset all player scores to 0
        scores.clear();
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
        const currentRoomId = socket.currentRoomId || 'main';
        const room = getOrCreateRoom(currentRoomId);
        const player = room.players.get(socket.id);
        if (!player) return;

        // Add player to room's challenge mode regardless of phase
        room.challengeMode.players.set(socket.id, {
            name: player.name,
            color: player.color,
            canvas: Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill('')),
            submitted: false,
            waiting: room.challengeMode.active && room.challengeMode.phase !== 'waiting' // Mark as waiting if round is active
        });

        // Send appropriate response based on current phase
        if (room.challengeMode.active && room.challengeMode.phase !== 'waiting') {
            // Player joins during active round - put them in waiting state
            socket.emit('challengeWaiting', { 
                phase: room.challengeMode.phase,
                playerCount: Array.from(room.challengeMode.players.values()).filter(p => !p.waiting).length,
                timeLeft: room.challengeMode.phase === 'drawing' ? getRoomRemainingTime(currentRoomId) : null
            });
        } else {
            // Normal join
            socket.emit('challengeJoined', { 
                phase: room.challengeMode.phase,
                word: room.challengeMode.phase === 'drawing' ? room.challengeMode.currentWord : null,
                timeLeft: room.challengeMode.phase === 'drawing' ? getRoomRemainingTime(currentRoomId) : null
            });
        }

        // Start challenge if we have 2+ players and not already active
        if (room.challengeMode.players.size >= 2 && !room.challengeMode.active) {
            startRoomChallenge(currentRoomId);
        }

        // Send updated challenge lobby
        broadcastRoomChallengeLobby(currentRoomId);
    });

    socket.on('requestChallengeStatus', () => {
        const currentRoomId = socket.currentRoomId || 'main';
        const room = getOrCreateRoom(currentRoomId);
        
        // Send current room's challenge status to requesting player
        const lobbyData = {
            playerCount: room.challengeMode.players.size,
            phase: room.challengeMode.phase,
            active: room.challengeMode.active,
            players: Array.from(room.challengeMode.players.values()).map(p => ({
                name: p.name,
                color: p.color,
                submitted: p.submitted
            }))
        };

        if (room.challengeMode.phase === 'drawing') {
            lobbyData.word = room.challengeMode.currentWord;
            lobbyData.timeLeft = getRoomRemainingTime(currentRoomId);
        }

        socket.emit('challengeLobbyUpdate', lobbyData);
    });

    socket.on('leaveChallenge', () => {
        const currentRoomId = socket.currentRoomId || 'main';
        const room = getOrCreateRoom(currentRoomId);
        
        room.challengeMode.players.delete(socket.id);
        
        // If we drop below 2 players during voting or results, end the challenge
        if (room.challengeMode.players.size < 2 && room.challengeMode.active && 
            (room.challengeMode.phase === 'voting' || room.challengeMode.phase === 'results')) {
            endRoomChallenge(currentRoomId);
        }
        
        broadcastRoomChallengeLobby(currentRoomId);
    });

    socket.on('challengePaint', (data) => {
        const currentRoomId = socket.currentRoomId || 'main';
        const room = getOrCreateRoom(currentRoomId);
        
        if (!room.challengeMode.players.has(socket.id) || room.challengeMode.phase !== 'drawing') return;
        
        const { x, y, color } = data;
        const challengePlayer = room.challengeMode.players.get(socket.id);
        
        // Update player's personal canvas
        challengePlayer.canvas[y][x] = color;
        
        // Send update to that player only
        socket.emit('challengeCanvasUpdate', { x, y, color });
    });

    socket.on('submitChallengeDrawing', () => {
        const currentRoomId = socket.currentRoomId || 'main';
        const room = getOrCreateRoom(currentRoomId);
        
        if (!room.challengeMode.players.has(socket.id) || room.challengeMode.phase !== 'drawing') return;
        
        const challengePlayer = room.challengeMode.players.get(socket.id);
        challengePlayer.submitted = true;
        room.challengeMode.submissions.set(socket.id, challengePlayer.canvas);
        
        socket.emit('drawingSubmitted');
        
        // Check if all players have submitted
        const allSubmitted = Array.from(room.challengeMode.players.values()).every(p => p.submitted);
        if (allSubmitted) {
            startRoomVoting(currentRoomId);
        }
    });

    socket.on('voteChallenge', (data) => {
        const currentRoomId = socket.currentRoomId || 'main';
        const room = getOrCreateRoom(currentRoomId);
        
        if (!room.challengeMode.players.has(socket.id) || room.challengeMode.phase !== 'voting') return;
        
        const { rating } = data;
        const currentPlayerId = room.challengeMode.votingOrder[room.challengeMode.currentVotingIndex];
        
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
        const currentRoomId = socket.currentRoomId || 'main';
        const room = getOrCreateRoom(currentRoomId);
        const player = room.players.get(socket.id);
        if (!player) return;

        // Add player to room's guess mode
        room.guessMode.players.set(socket.id, {
            name: player.name,
            color: player.color,
            isDrawer: false,
            hasGuessed: false,
            guessTime: null
        });

        // Send appropriate response based on current phase
        if (room.guessMode.active && room.guessMode.phase !== 'waiting') {
            // Player joins during active round - put them in waiting state
            socket.emit('guessWaiting', { 
                phase: room.guessMode.phase,
                drawerName: room.guessMode.currentDrawer ? room.guessMode.players.get(room.guessMode.currentDrawer)?.name : null,
                playerCount: room.guessMode.players.size - 1, // Exclude current drawer
                timeLeft: room.guessMode.phase === 'drawing' ? getRoomGuessRemainingTime(currentRoomId) : null
            });
        } else {
            // Normal join
            socket.emit('guessJoined', { 
                phase: room.guessMode.phase
            });
        }

        // Start guess game if we have 2+ players and not already active
        if (room.guessMode.players.size >= 2 && !room.guessMode.active) {
            startRoomGuessGame(currentRoomId);
        }

        // Send updated guess lobby
        broadcastRoomGuessLobby(currentRoomId);
    });

    socket.on('requestGuessStatus', () => {
        const currentRoomId = socket.currentRoomId || 'main';
        const room = getOrCreateRoom(currentRoomId);
        
        // Send current room's guess status to requesting player
        const lobbyData = {
            playerCount: room.guessMode.players.size,
            phase: room.guessMode.phase,
            active: room.guessMode.active,
            players: Array.from(room.guessMode.players.values()).map(p => ({
                name: p.name,
                color: p.color,
                isDrawer: p.isDrawer,
                hasGuessed: p.hasGuessed
            }))
        };

        if (room.guessMode.phase === 'drawing' && room.guessMode.currentDrawer) {
            const drawerPlayer = room.guessMode.players.get(room.guessMode.currentDrawer);
            lobbyData.drawerName = drawerPlayer?.name;
            lobbyData.timeLeft = getRoomGuessRemainingTime(currentRoomId);
        }

        socket.emit('guessLobbyUpdate', lobbyData);
    });

    socket.on('leaveGuess', () => {
        const currentRoomId = socket.currentRoomId || 'main';
        const room = getOrCreateRoom(currentRoomId);
        
        const wasDrawer = room.guessMode.players.get(socket.id)?.isDrawer;
        room.guessMode.players.delete(socket.id);
        
        // If the drawer left, end the current round
        if (wasDrawer && room.guessMode.active) {
            endCurrentRoomGuessRound(currentRoomId);
        }
        
        // If we drop below 2 players, end the game
        if (room.guessMode.players.size < 2 && room.guessMode.active) {
            endRoomGuessGame(currentRoomId);
        }
        
        broadcastRoomGuessLobby(currentRoomId);
    });

    socket.on('guessPaint', (data) => {
        const currentRoomId = socket.currentRoomId || 'main';
        const room = getOrCreateRoom(currentRoomId);
        
        if (!room.guessMode.players.has(socket.id) || room.guessMode.phase !== 'drawing') return;
        
        const guessPlayer = room.guessMode.players.get(socket.id);
        if (!guessPlayer.isDrawer) return; // Only drawer can paint
        
        const { x, y, color } = data;
        
        // Update shared canvas
        room.guessMode.canvas[y][x] = color;
        
        // Send update to all players in guess mode in this room
        io.to(Array.from(room.guessMode.players.keys())).emit('guessCanvasUpdate', { x, y, color });
    });

    socket.on('submitGuess', (data) => {
        const currentRoomId = socket.currentRoomId || 'main';
        const room = getOrCreateRoom(currentRoomId);
        
        if (!room.guessMode.players.has(socket.id) || room.guessMode.phase !== 'drawing') return;
        
        const guessPlayer = room.guessMode.players.get(socket.id);
        if (guessPlayer.isDrawer || guessPlayer.hasGuessed) return; // Drawer can't guess, and can't guess twice
        
        const { guess } = data;
        const isCorrect = guess.toLowerCase().trim() === room.guessMode.currentWord.toLowerCase();
        
        if (isCorrect) {
            // Mark player as having guessed correctly
            guessPlayer.hasGuessed = true;
            guessPlayer.guessTime = Date.now() - room.guessMode.drawingStartTime;
            
            // Add to correct guessers list
            room.guessMode.correctGuessers.push({
                playerId: socket.id,
                playerName: guessPlayer.name,
                guessTime: guessPlayer.guessTime
            });
            
            // Notify all players in this room
            io.to(Array.from(room.guessMode.players.keys())).emit('guessSubmitted', {
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
        const currentRoomId = socket.currentRoomId || 'main';
        const room = getOrCreateRoom(currentRoomId);
        const player = room.players.get(socket.id);
        
        if (player) {
            // Notify other players in the room that this player disconnected (for cursor cleanup)
            socket.to(currentRoomId).emit('playerDisconnected', { playerName: player.name });
            
            // Notify all players in the room that someone left
            io.to(currentRoomId).emit('playerLeft', { playerName: player.name });
            
            // Clear all pixels drawn by this player in this room
            for (let y = 0; y < GRID_SIZE; y++) {
                for (let x = 0; x < GRID_SIZE; x++) {
                    if (room.pixelOwners[y][x] === player.name) {
                        room.gameBoard[y][x] = '';
                        room.pixelOwners[y][x] = '';
                        // Notify all clients in the room about the cleared pixel
                        io.to(currentRoomId).emit('boardUpdate', { x, y, color: '#ffffff', playerName: 'system' });
                    }
                }
            }
            
            // Remove player from room
            room.players.delete(socket.id);
            room.scores.delete(player.name);
            updateRoomScores(currentRoomId);
            io.to(currentRoomId).emit('playerListUpdate', Array.from(room.players.values()));
            io.to(currentRoomId).emit('roomPlayerCount', { count: room.players.size });
            
            console.log(`User ${player.name} disconnected from room ${currentRoomId} - their drawings have been cleared`);
        }

        // Handle challenge mode disconnect in room
        if (room.challengeMode.players.has(socket.id)) {
            room.challengeMode.players.delete(socket.id);
            room.challengeMode.votes.delete(socket.id);
            room.challengeMode.submissions.delete(socket.id);
            
            // End challenge if too few players
            if (room.challengeMode.players.size < 2 && room.challengeMode.active) {
                endRoomChallenge(currentRoomId);
            }
            
            broadcastRoomChallengeLobby(currentRoomId);
        }

        // Handle guess mode disconnect in room
        if (room.guessMode.players.has(socket.id)) {
            const wasDrawer = room.guessMode.players.get(socket.id)?.isDrawer;
            room.guessMode.players.delete(socket.id);
            
            // If the drawer left, end the current round
            if (wasDrawer && room.guessMode.active) {
                endCurrentRoomGuessRound(currentRoomId);
            }
            
            // End guess game if too few players
            if (room.guessMode.players.size < 2 && room.guessMode.active) {
                endRoomGuessGame(currentRoomId);
            }
            
            broadcastRoomGuessLobby(currentRoomId);
        }
    });
});

// Room-specific helper functions
function updateRoomScore(roomId, playerName, points) {
    const room = getOrCreateRoom(roomId);
    const playerScore = room.scores.get(playerName);
    if (playerScore) {
        playerScore.score += points;
        // Ensure score doesn't go below 0
        if (playerScore.score < 0) {
            playerScore.score = 0;
        }
        
        updateRoomScores(roomId);
    }
}

function updateRoomScores(roomId) {
    const room = getOrCreateRoom(roomId);
    const scoreArray = Array.from(room.scores.entries()).map(([name, data]) => ({
        name,
        score: data.score,
        color: data.color
    })).sort((a, b) => b.score - a.score);
    
    io.to(roomId).emit('scoreUpdate', scoreArray);
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

// Room-specific helper functions
function getRoomRemainingTime(roomId) {
    const room = getOrCreateRoom(roomId);
    if (!room.challengeMode.startTime) return 0;
    const elapsed = Date.now() - room.challengeMode.startTime;
    return Math.max(0, room.challengeMode.duration - elapsed);
}

function getRoomGuessRemainingTime(roomId) {
    const room = getOrCreateRoom(roomId);
    if (!room.guessMode.drawingStartTime) return 0;
    const elapsed = Date.now() - room.guessMode.drawingStartTime;
    return Math.max(0, room.guessMode.drawingDuration - elapsed);
}

function startRoomChallenge(roomId) {
    const room = getOrCreateRoom(roomId);
    room.challengeMode.active = true;
    room.challengeMode.phase = 'drawing';
    room.challengeMode.currentWord = challengeWords[Math.floor(Math.random() * challengeWords.length)];
    room.challengeMode.startTime = Date.now();
    room.challengeMode.submissions.clear();
    room.challengeMode.votes.clear();
    room.challengeMode.results = [];

    // Reset all player submission status and move waiting players into the round
    for (let player of room.challengeMode.players.values()) {
        player.submitted = false;
        player.canvas = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(''));
        player.waiting = false; // Move waiting players into the active round
    }

    // Start drawing timer
    room.challengeMode.timer = setTimeout(() => {
        startRoomVoting(roomId);
    }, room.challengeMode.duration);

    // Notify all challenge players in this room
    io.to(Array.from(room.challengeMode.players.keys())).emit('challengeStarted', {
        word: room.challengeMode.currentWord,
        duration: room.challengeMode.duration
    });

    console.log(`🎨 Challenge started in room ${roomId}: "${room.challengeMode.currentWord}"`);
}

function startRoomVoting(roomId) {
    const room = getOrCreateRoom(roomId);
    room.challengeMode.phase = 'voting';
    
    // Clear the timer
    if (room.challengeMode.timer) {
        clearTimeout(room.challengeMode.timer);
        room.challengeMode.timer = null;
    }

    // Create voting order from submissions
    room.challengeMode.votingOrder = Array.from(room.challengeMode.submissions.keys());
    room.challengeMode.currentVotingIndex = 0;
    
    // Start voting on first submission
    nextRoomVote(roomId);
}

function nextRoomVote(roomId) {
    const room = getOrCreateRoom(roomId);
    
    if (room.challengeMode.currentVotingIndex >= room.challengeMode.votingOrder.length) {
        // All submissions have been voted on, calculate results
        calculateRoomChallengeResults(roomId);
        return;
    }

    const currentPlayerId = room.challengeMode.votingOrder[room.challengeMode.currentVotingIndex];
    const currentPlayerName = room.challengeMode.players.get(currentPlayerId)?.name;
    const currentSubmission = room.challengeMode.submissions.get(currentPlayerId);

    // Clear previous votes for this submission
    room.challengeMode.currentSubmissionVotes.clear();

    // Send current submission to all players for voting
    io.to(Array.from(room.challengeMode.players.keys())).emit('voteSubmission', {
        playerName: currentPlayerName,
        canvas: currentSubmission,
        word: room.challengeMode.currentWord,
        currentIndex: room.challengeMode.currentVotingIndex,
        totalSubmissions: room.challengeMode.votingOrder.length
    });

    // Auto-advance after voting timer
    setTimeout(() => {
        room.challengeMode.currentVotingIndex++;
        nextRoomVote(roomId);
    }, room.challengeMode.votingTimer);
}

function calculateRoomChallengeResults(roomId) {
    const room = getOrCreateRoom(roomId);
    const results = [];
    
    // Calculate average ratings for each player
    for (const [playerId, canvas] of room.challengeMode.submissions) {
        const playerName = room.challengeMode.players.get(playerId)?.name;
        const votes = Array.from(room.challengeMode.votes.values())
            .filter(vote => vote.targetId === playerId)
            .map(vote => vote.rating);
        
        const averageRating = votes.length > 0 ? votes.reduce((a, b) => a + b, 0) / votes.length : 0;
        
        results.push({
            playerId,
            playerName,
            canvas,
            averageRating: Math.round(averageRating * 10) / 10,
            voteCount: votes.length
        });
    }
    
    // Sort by rating (highest first)
    results.sort((a, b) => b.averageRating - a.averageRating);
    room.challengeMode.results = results;
    room.challengeMode.phase = 'results';
    
    // Send results to all players
    io.to(Array.from(room.challengeMode.players.keys())).emit('challengeResults', {
        results: results,
        word: room.challengeMode.currentWord
    });
    
    // Auto-restart after 30 seconds
    setTimeout(() => {
        startRoomChallenge(roomId);
    }, 30000);
}

function endRoomChallenge(roomId) {
    const room = getOrCreateRoom(roomId);
    room.challengeMode.active = false;
    room.challengeMode.phase = 'waiting';
    room.challengeMode.currentWord = '';
    room.challengeMode.startTime = null;
    room.challengeMode.submissions.clear();
    room.challengeMode.votes.clear();
    room.challengeMode.results = [];
    
    if (room.challengeMode.timer) {
        clearTimeout(room.challengeMode.timer);
        room.challengeMode.timer = null;
    }
    
    // Notify all players
    io.to(Array.from(room.challengeMode.players.keys())).emit('challengeEnded');
    broadcastRoomChallengeLobby(roomId);
}

function broadcastRoomChallengeLobby(roomId) {
    const room = getOrCreateRoom(roomId);
    const activePlayers = Array.from(room.challengeMode.players.values()).filter(p => !p.waiting);
    
    const lobbyData = {
        playerCount: room.challengeMode.players.size,
        phase: room.challengeMode.phase,
        active: room.challengeMode.active,
        players: Array.from(room.challengeMode.players.values()).map(p => ({
            name: p.name,
            color: p.color,
            submitted: p.submitted
        })),
        activePlayerCount: activePlayers.length,
        timeLeft: room.challengeMode.phase === 'drawing' ? getRoomRemainingTime(roomId) : null
    };

    io.to(Array.from(room.challengeMode.players.keys())).emit('challengeLobbyUpdate', lobbyData);
}

function startRoomGuessGame(roomId) {
    const room = getOrCreateRoom(roomId);
    room.guessMode.active = true;
    room.guessMode.phase = 'waiting';
    room.guessMode.roundNumber = 0;
    room.guessMode.playerOrder = Array.from(room.guessMode.players.keys());
    room.guessMode.currentPlayerIndex = 0;
    
    // Start first round
    startNextRoomGuessRound(roomId);
}

function startNextRoomGuessRound(roomId) {
    const room = getOrCreateRoom(roomId);
    
    if (room.guessMode.currentPlayerIndex >= room.guessMode.playerOrder.length) {
        // All players have drawn, start new rotation
        room.guessMode.currentPlayerIndex = 0;
        room.guessMode.roundNumber++;
    }
    
    // Reset game state for new round
    room.guessMode.phase = 'drawing';
    room.guessMode.currentWord = challengeWords[Math.floor(Math.random() * challengeWords.length)];
    room.guessMode.currentDrawer = room.guessMode.playerOrder[room.guessMode.currentPlayerIndex];
    room.guessMode.drawingStartTime = Date.now();
    room.guessMode.canvas = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(''));
    room.guessMode.correctGuessers = [];
    
    // Reset player states
    for (let player of room.guessMode.players.values()) {
        player.isDrawer = false;
        player.hasGuessed = false;
        player.guessTime = null;
    }
    
    // Set current drawer
    const drawerPlayer = room.guessMode.players.get(room.guessMode.currentDrawer);
    if (drawerPlayer) {
        drawerPlayer.isDrawer = true;
    }
    
    // Start drawing timer
    room.guessMode.timer = setTimeout(() => {
        endCurrentRoomGuessRound(roomId);
    }, room.guessMode.drawingDuration);
    
    // Notify all players
    io.to(Array.from(room.guessMode.players.keys())).emit('guessRoundStarted', {
        drawerName: drawerPlayer?.name,
        roundNumber: room.guessMode.roundNumber + 1,
        word: drawerPlayer ? room.guessMode.currentWord : null, // Only send word to drawer
        duration: room.guessMode.drawingDuration
    });
    
    // Send word only to drawer
    if (room.guessMode.currentDrawer) {
        io.to(room.guessMode.currentDrawer).emit('guessWord', { word: room.guessMode.currentWord });
    }
}

function endCurrentRoomGuessRound(roomId) {
    const room = getOrCreateRoom(roomId);
    
    if (room.guessMode.timer) {
        clearTimeout(room.guessMode.timer);
        room.guessMode.timer = null;
    }
    
    room.guessMode.phase = 'results';
    
    // Award points based on guess order and speed
    const basePoints = 100;
    room.guessMode.correctGuessers.forEach((guesser, index) => {
        const timeBonus = Math.max(0, 50 - Math.floor(guesser.guessTime / 1000));
        const orderBonus = Math.max(0, 30 - (index * 5));
        const totalPoints = basePoints + timeBonus + orderBonus;
        
        updateRoomScore(roomId, guesser.playerName, totalPoints);
    });
    
    // Award points to drawer if anyone guessed correctly
    if (room.guessMode.correctGuessers.length > 0) {
        const drawerPlayer = room.guessMode.players.get(room.guessMode.currentDrawer);
        if (drawerPlayer) {
            const drawerPoints = 50 + (room.guessMode.correctGuessers.length * 10);
            updateRoomScore(roomId, drawerPlayer.name, drawerPoints);
        }
    }
    
    // Send round results
    io.to(Array.from(room.guessMode.players.keys())).emit('guessRoundEnded', {
        correctWord: room.guessMode.currentWord,
        correctGuessers: room.guessMode.correctGuessers,
        drawerName: room.guessMode.players.get(room.guessMode.currentDrawer)?.name
    });
    
    // Auto-progress to next round after 5 seconds
    room.guessMode.autoProgressTimer = setTimeout(() => {
        room.guessMode.currentPlayerIndex++;
        startNextRoomGuessRound(roomId);
    }, 5000);
}

function endRoomGuessGame(roomId) {
    const room = getOrCreateRoom(roomId);
    room.guessMode.active = false;
    room.guessMode.phase = 'waiting';
    room.guessMode.currentWord = '';
    room.guessMode.currentDrawer = null;
    room.guessMode.drawingStartTime = null;
    room.guessMode.canvas = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(''));
    room.guessMode.correctGuessers = [];
    
    if (room.guessMode.timer) {
        clearTimeout(room.guessMode.timer);
        room.guessMode.timer = null;
    }
    
    if (room.guessMode.autoProgressTimer) {
        clearTimeout(room.guessMode.autoProgressTimer);
        room.guessMode.autoProgressTimer = null;
    }
    
    // Notify all players
    io.to(Array.from(room.guessMode.players.keys())).emit('guessGameEnded');
    broadcastRoomGuessLobby(roomId);
}

function broadcastRoomGuessLobby(roomId) {
    const room = getOrCreateRoom(roomId);
    
    const lobbyData = {
        playerCount: room.guessMode.players.size,
        phase: room.guessMode.phase,
        active: room.guessMode.active,
        players: Array.from(room.guessMode.players.values()).map(p => ({
            name: p.name,
            color: p.color,
            isDrawer: p.isDrawer,
            hasGuessed: p.hasGuessed
        }))
    };

    if (room.guessMode.phase === 'drawing' && room.guessMode.currentDrawer) {
        const drawerPlayer = room.guessMode.players.get(room.guessMode.currentDrawer);
        lobbyData.drawerName = drawerPlayer?.name;
        lobbyData.timeLeft = getRoomGuessRemainingTime(roomId);
    }

    io.to(Array.from(room.guessMode.players.keys())).emit('guessLobbyUpdate', lobbyData);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
