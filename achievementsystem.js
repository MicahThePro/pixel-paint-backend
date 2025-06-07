// Achievement System Backend Module
// This module handles achievement tracking, validation, and persistence

const EventEmitter = require('events');

class AchievementSystemBackend extends EventEmitter {
    constructor() {
        super();
        this.playerAchievements = new Map(); // playerId -> Set of achievement IDs
        this.playerStats = new Map(); // playerId -> stats object
        this.achievements = this.loadAchievementDefinitions();
        this.dataFile = 'achievements.json';
        this.loadPlayerData();
    }

    // Load achievement definitions (same as frontend but server-side)
    loadAchievementDefinitions() {
        return {
            // Painting Achievements (100 achievements)
            painting: [
                // First achievements
                { id: 'first_pixel', name: 'First Stroke', description: 'Paint your first pixel', rarity: 'common', condition: { type: 'pixels_painted', value: 1 } },
                { id: 'pixel_10', name: 'Getting Started', description: 'Paint 10 pixels', rarity: 'common', condition: { type: 'pixels_painted', value: 10 } },
                { id: 'pixel_100', name: 'Pixel Painter', description: 'Paint 100 pixels', rarity: 'common', condition: { type: 'pixels_painted', value: 100 } },
                { id: 'pixel_500', name: 'Artist', description: 'Paint 500 pixels', rarity: 'rare', condition: { type: 'pixels_painted', value: 500 } },
                { id: 'pixel_1000', name: 'Master Painter', description: 'Paint 1,000 pixels', rarity: 'rare', condition: { type: 'pixels_painted', value: 1000 } },
                { id: 'pixel_5000', name: 'Pixel Virtuoso', description: 'Paint 5,000 pixels', rarity: 'epic', condition: { type: 'pixels_painted', value: 5000 } },
                { id: 'pixel_10000', name: 'Canvas Legend', description: 'Paint 10,000 pixels', rarity: 'epic', condition: { type: 'pixels_painted', value: 10000 } },
                { id: 'pixel_25000', name: 'Pixel Master', description: 'Paint 25,000 pixels', rarity: 'legendary', condition: { type: 'pixels_painted', value: 25000 } },
                { id: 'pixel_50000', name: 'Digital Michelangelo', description: 'Paint 50,000 pixels', rarity: 'legendary', condition: { type: 'pixels_painted', value: 50000 } },
                { id: 'pixel_100000', name: 'Pixel God', description: 'Paint 100,000 pixels', rarity: 'legendary', condition: { type: 'pixels_painted', value: 100000 } },

                // Session-based achievements
                { id: 'session_10', name: 'Quick Session', description: 'Paint 10 pixels in one session', rarity: 'common', condition: { type: 'session_pixels', value: 10 } },
                { id: 'session_50', name: 'Productive Session', description: 'Paint 50 pixels in one session', rarity: 'rare', condition: { type: 'session_pixels', value: 50 } },
                { id: 'session_100', name: 'Marathon Session', description: 'Paint 100 pixels in one session', rarity: 'epic', condition: { type: 'session_pixels', value: 100 } },
                { id: 'session_500', name: 'Painting Frenzy', description: 'Paint 500 pixels in one session', rarity: 'legendary', condition: { type: 'session_pixels', value: 500 } },

                // Speed achievements
                { id: 'speed_10_1min', name: 'Speed Painter', description: 'Paint 10 pixels in 1 minute', rarity: 'rare', condition: { type: 'speed_painting', pixels: 10, time: 60000 } },
                { id: 'speed_25_1min', name: 'Lightning Brush', description: 'Paint 25 pixels in 1 minute', rarity: 'epic', condition: { type: 'speed_painting', pixels: 25, time: 60000 } },
                { id: 'speed_50_1min', name: 'Pixel Rush', description: 'Paint 50 pixels in 1 minute', rarity: 'legendary', condition: { type: 'speed_painting', pixels: 50, time: 60000 } },

                // Color achievements
                { id: 'red_master', name: 'Red Master', description: 'Paint 100 red pixels', rarity: 'common', condition: { type: 'color_usage', color: 'red', value: 100 } },
                { id: 'blue_master', name: 'Blue Master', description: 'Paint 100 blue pixels', rarity: 'common', condition: { type: 'color_usage', color: 'blue', value: 100 } },
                { id: 'green_master', name: 'Green Master', description: 'Paint 100 green pixels', rarity: 'common', condition: { type: 'color_usage', color: 'green', value: 100 } },
                { id: 'rainbow_artist', name: 'Rainbow Artist', description: 'Use all 16 basic colors', rarity: 'epic', condition: { type: 'colors_used', value: 16 } },

                // Daily achievements
                { id: 'daily_painter', name: 'Daily Painter', description: 'Paint for 7 consecutive days', rarity: 'rare', condition: { type: 'consecutive_days', value: 7 } },
                { id: 'weekly_warrior', name: 'Weekly Warrior', description: 'Paint for 30 consecutive days', rarity: 'epic', condition: { type: 'consecutive_days', value: 30 } },
                { id: 'dedication_master', name: 'Dedication Master', description: 'Paint for 100 consecutive days', rarity: 'legendary', condition: { type: 'consecutive_days', value: 100 } }
            ],

            // Social Achievements (75 achievements)
            social: [
                { id: 'first_join', name: 'Welcome!', description: 'Join your first game', rarity: 'common', condition: { type: 'games_joined', value: 1 } },
                { id: 'social_butterfly', name: 'Social Butterfly', description: 'Play with 10 different players', rarity: 'rare', condition: { type: 'unique_players_met', value: 10 } },
                { id: 'community_member', name: 'Community Member', description: 'Play with 50 different players', rarity: 'epic', condition: { type: 'unique_players_met', value: 50 } },
                { id: 'veteran_player', name: 'Veteran Player', description: 'Join 100 games', rarity: 'epic', condition: { type: 'games_joined', value: 100 } },
                { id: 'social_legend', name: 'Social Legend', description: 'Play with 100 different players', rarity: 'legendary', condition: { type: 'unique_players_met', value: 100 } }
            ],

            // Challenge Mode Achievements (75 achievements)
            challenges: [
                { id: 'first_challenge', name: 'Challenge Accepted', description: 'Join your first challenge', rarity: 'common', condition: { type: 'challenges_joined', value: 1 } },
                { id: 'challenger', name: 'Challenger', description: 'Join 10 challenges', rarity: 'rare', condition: { type: 'challenges_joined', value: 10 } },
                { id: 'challenge_veteran', name: 'Challenge Veteran', description: 'Join 50 challenges', rarity: 'epic', condition: { type: 'challenges_joined', value: 50 } },
                { id: 'first_submission', name: 'First Submission', description: 'Submit your first drawing', rarity: 'common', condition: { type: 'challenges_submitted', value: 1 } },
                { id: 'consistent_artist', name: 'Consistent Artist', description: 'Submit 25 drawings', rarity: 'rare', condition: { type: 'challenges_submitted', value: 25 } },
                { id: 'first_vote', name: 'Art Critic', description: 'Vote in your first challenge', rarity: 'common', condition: { type: 'votes_cast', value: 1 } },
                { id: 'active_voter', name: 'Active Voter', description: 'Cast 50 votes', rarity: 'rare', condition: { type: 'votes_cast', value: 50 } },
                { id: 'first_win', name: 'Champion!', description: 'Win your first challenge', rarity: 'epic', condition: { type: 'challenges_won', value: 1 } },
                { id: 'winner', name: 'Consistent Winner', description: 'Win 5 challenges', rarity: 'epic', condition: { type: 'challenges_won', value: 5 } },
                { id: 'challenge_master', name: 'Challenge Master', description: 'Win 25 challenges', rarity: 'legendary', condition: { type: 'challenges_won', value: 25 } }
            ],

            // Time-based Achievements (50 achievements)
            time: [
                { id: 'session_5min', name: 'Quick Visit', description: 'Play for 5 minutes', rarity: 'common', condition: { type: 'session_time', value: 300000 } },
                { id: 'session_30min', name: 'Good Session', description: 'Play for 30 minutes', rarity: 'rare', condition: { type: 'session_time', value: 1800000 } },
                { id: 'session_1hour', name: 'Dedicated Session', description: 'Play for 1 hour', rarity: 'epic', condition: { type: 'session_time', value: 3600000 } },
                { id: 'total_1hour', name: 'Hour Player', description: 'Play for 1 hour total', rarity: 'common', condition: { type: 'total_playtime', value: 3600000 } },
                { id: 'total_10hours', name: 'Dedicated Player', description: 'Play for 10 hours total', rarity: 'rare', condition: { type: 'total_playtime', value: 36000000 } },
                { id: 'total_100hours', name: 'Lifetime Player', description: 'Play for 100 hours total', rarity: 'legendary', condition: { type: 'total_playtime', value: 360000000 } }
            ],

            // Special Achievements (100 achievements)
            special: [
                { id: 'night_owl', name: 'Night Owl', description: 'Paint between midnight and 6 AM', rarity: 'rare', condition: { type: 'time_of_day', start: 0, end: 6 } },
                { id: 'early_bird', name: 'Early Bird', description: 'Paint between 5 AM and 8 AM', rarity: 'rare', condition: { type: 'time_of_day', start: 5, end: 8 } },
                { id: 'weekend_warrior', name: 'Weekend Warrior', description: 'Paint on Saturday and Sunday', rarity: 'common', condition: { type: 'weekend_painting', value: 2 } },
                { id: 'pixel_perfectionist', name: 'Pixel Perfectionist', description: 'Paint in a perfect 10x10 square', rarity: 'epic', condition: { type: 'perfect_square', size: 10 } },
                { id: 'line_artist', name: 'Line Artist', description: 'Paint a straight line of 20 pixels', rarity: 'rare', condition: { type: 'straight_line', length: 20 } },
                { id: 'corner_master', name: 'Corner Master', description: 'Paint in all 4 corners of the canvas', rarity: 'epic', condition: { type: 'all_corners', value: 4 } }
            ],

            // Milestone Achievements (50 achievements)
            milestones: [
                { id: 'canvas_1percent', name: 'Canvas Explorer', description: 'Paint 1% of the canvas', rarity: 'rare', condition: { type: 'canvas_coverage', value: 0.01 } },
                { id: 'canvas_5percent', name: 'Territory Claimer', description: 'Paint 5% of the canvas', rarity: 'epic', condition: { type: 'canvas_coverage', value: 0.05 } },
                { id: 'canvas_10percent', name: 'Canvas Dominator', description: 'Paint 10% of the canvas', rarity: 'legendary', condition: { type: 'canvas_coverage', value: 0.10 } },
                { id: 'score_100', name: 'Century', description: 'Reach 100 points', rarity: 'common', condition: { type: 'score_reached', value: 100 } },
                { id: 'score_500', name: 'High Scorer', description: 'Reach 500 points', rarity: 'rare', condition: { type: 'score_reached', value: 500 } },
                { id: 'score_1000', name: 'Point Master', description: 'Reach 1,000 points', rarity: 'epic', condition: { type: 'score_reached', value: 1000 } }
            ]
        };
    }

    // Initialize player stats
    initializePlayerStats(playerId) {
        if (!this.playerStats.has(playerId)) {
            this.playerStats.set(playerId, {
                pixels_painted: 0,
                session_pixels: 0,
                session_start_time: Date.now(),
                speed_tracking: [],
                colors_used: new Set(),
                consecutive_days: 0,
                last_play_date: null,
                games_joined: 0,
                unique_players_met: new Set(),
                challenges_joined: 0,
                challenges_submitted: 0,
                votes_cast: 0,
                challenges_won: 0,
                total_playtime: 0,
                current_score: 0,
                canvas_pixels_owned: 0,
                weekend_days_played: new Set(),
                corners_painted: new Set(),
                current_session_pixels: [],
                last_paint_time: 0
            });
        }
        if (!this.playerAchievements.has(playerId)) {
            this.playerAchievements.set(playerId, new Set());
        }
    }

    // Track pixel painting
    trackPixelPainted(playerId, x, y, color, timestamp = Date.now()) {
        this.initializePlayerStats(playerId);
        const stats = this.playerStats.get(playerId);
        
        stats.pixels_painted++;
        stats.session_pixels++;
        stats.current_session_pixels.push({ x, y, color, timestamp });
        stats.colors_used.add(color);
        stats.last_paint_time = timestamp;

        // Check for corner painting
        const GRID_SIZE = 100;
        if ((x === 0 && y === 0) || (x === GRID_SIZE-1 && y === 0) || 
            (x === 0 && y === GRID_SIZE-1) || (x === GRID_SIZE-1 && y === GRID_SIZE-1)) {
            stats.corners_painted.add(`${x},${y}`);
        }        // Speed tracking
        stats.speed_tracking.push(timestamp);
        // Keep only last 60 seconds of data
        const oneMinuteAgo = timestamp - 60000;
        stats.speed_tracking = stats.speed_tracking.filter(t => t > oneMinuteAgo);

        return this.checkAchievements(playerId);
    }

    // Track social events
    trackSocialEvent(playerId, eventType, data = {}) {
        this.initializePlayerStats(playerId);
        const stats = this.playerStats.get(playerId);

        switch (eventType) {
            case 'game_joined':
                stats.games_joined++;
                break;
            case 'player_met':
                stats.unique_players_met.add(data.playerName);
                break;
        }

        this.checkAchievements(playerId);
    }

    // Track challenge events
    trackChallengeEvent(playerId, eventType, data = {}) {
        this.initializePlayerStats(playerId);
        const stats = this.playerStats.get(playerId);

        switch (eventType) {
            case 'challenge_joined':
                stats.challenges_joined++;
                break;
            case 'challenge_submitted':
                stats.challenges_submitted++;
                break;
            case 'vote_cast':
                stats.votes_cast++;
                break;
            case 'challenge_won':
                stats.challenges_won++;
                break;
        }

        this.checkAchievements(playerId);
    }

    // Update player score
    updatePlayerScore(playerId, newScore) {
        this.initializePlayerStats(playerId);
        const stats = this.playerStats.get(playerId);
        stats.current_score = newScore;
        this.checkAchievements(playerId);
    }

    // Check all achievements for a player
    checkAchievements(playerId) {
        const stats = this.playerStats.get(playerId);
        const playerAchievements = this.playerAchievements.get(playerId);
        const newAchievements = [];

        // Check all achievement categories
        Object.values(this.achievements).forEach(category => {
            category.forEach(achievement => {
                if (!playerAchievements.has(achievement.id)) {
                    if (this.checkAchievementCondition(stats, achievement.condition)) {
                        playerAchievements.add(achievement.id);
                        newAchievements.push(achievement);
                    }
                }
            });
        });

        return newAchievements;
    }

    // Check if a specific achievement condition is met
    checkAchievementCondition(stats, condition) {
        switch (condition.type) {
            case 'pixels_painted':
                return stats.pixels_painted >= condition.value;
            case 'session_pixels':
                return stats.session_pixels >= condition.value;
            case 'color_usage':
                // Count pixels of specific color
                return stats.current_session_pixels.filter(p => 
                    this.isColorMatch(p.color, condition.color)).length >= condition.value;
            case 'colors_used':
                return stats.colors_used.size >= condition.value;
            case 'games_joined':
                return stats.games_joined >= condition.value;
            case 'unique_players_met':
                return stats.unique_players_met.size >= condition.value;
            case 'challenges_joined':
                return stats.challenges_joined >= condition.value;
            case 'challenges_submitted':
                return stats.challenges_submitted >= condition.value;
            case 'votes_cast':
                return stats.votes_cast >= condition.value;
            case 'challenges_won':
                return stats.challenges_won >= condition.value;
            case 'score_reached':
                return stats.current_score >= condition.value;
            case 'speed_painting':
                return stats.speed_tracking.length >= condition.pixels;
            case 'all_corners':
                return stats.corners_painted.size >= condition.value;
            case 'time_of_day':
                const hour = new Date().getHours();
                return hour >= condition.start && hour < condition.end;
            default:
                return false;
        }
    }

    // Helper function to match colors
    isColorMatch(pixelColor, targetColor) {
        // Simple color matching - could be enhanced
        const colorMap = {
            'red': ['#ff0000', '#ff4444', '#cc0000'],
            'blue': ['#0000ff', '#4444ff', '#0000cc'],
            'green': ['#00ff00', '#44ff44', '#00cc00']
        };
        
        if (colorMap[targetColor]) {
            return colorMap[targetColor].some(color => 
                pixelColor.toLowerCase().includes(color) || color.includes(pixelColor.toLowerCase())
            );
        }
        return false;
    }

    // Get player achievements
    getPlayerAchievements(playerId) {
        const playerAchievements = this.playerAchievements.get(playerId) || new Set();
        const achievementDetails = [];

        Object.values(this.achievements).forEach(category => {
            category.forEach(achievement => {
                if (playerAchievements.has(achievement.id)) {
                    achievementDetails.push(achievement);
                }
            });
        });

        return achievementDetails;
    }

    // Get player stats
    getPlayerStats(playerId) {
        return this.playerStats.get(playerId) || {};
    }

    // Load player data from file
    loadPlayerData() {
        try {
            const fs = require('fs');
            if (fs.existsSync(this.dataFile)) {
                const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
                
                // Restore player achievements
                if (data.achievements) {
                    Object.entries(data.achievements).forEach(([playerId, achievements]) => {
                        this.playerAchievements.set(playerId, new Set(achievements));
                    });
                }

                // Restore player stats
                if (data.stats) {
                    Object.entries(data.stats).forEach(([playerId, stats]) => {
                        // Convert sets back from arrays
                        if (stats.colors_used) stats.colors_used = new Set(stats.colors_used);
                        if (stats.unique_players_met) stats.unique_players_met = new Set(stats.unique_players_met);
                        if (stats.weekend_days_played) stats.weekend_days_played = new Set(stats.weekend_days_played);
                        if (stats.corners_painted) stats.corners_painted = new Set(stats.corners_painted);
                        
                        this.playerStats.set(playerId, stats);
                    });
                }
            }
        } catch (error) {
            console.error('Error loading achievement data:', error);
        }
    }

    // Save player data to file
    savePlayerData() {
        try {
            const fs = require('fs');
            const data = {
                achievements: {},
                stats: {}
            };

            // Convert achievements to serializable format
            this.playerAchievements.forEach((achievements, playerId) => {
                data.achievements[playerId] = Array.from(achievements);
            });

            // Convert stats to serializable format
            this.playerStats.forEach((stats, playerId) => {
                const serializedStats = { ...stats };
                // Convert sets to arrays
                if (serializedStats.colors_used) serializedStats.colors_used = Array.from(serializedStats.colors_used);
                if (serializedStats.unique_players_met) serializedStats.unique_players_met = Array.from(serializedStats.unique_players_met);
                if (serializedStats.weekend_days_played) serializedStats.weekend_days_played = Array.from(serializedStats.weekend_days_played);
                if (serializedStats.corners_painted) serializedStats.corners_painted = Array.from(serializedStats.corners_painted);
                
                data.stats[playerId] = serializedStats;
            });

            fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving achievement data:', error);
        }
    }

    // Reset session stats
    resetSessionStats(playerId) {
        const stats = this.playerStats.get(playerId);
        if (stats) {
            stats.session_pixels = 0;
            stats.session_start_time = Date.now();
            stats.current_session_pixels = [];
            stats.speed_tracking = [];
        }
    }
}

module.exports = AchievementSystemBackend;
