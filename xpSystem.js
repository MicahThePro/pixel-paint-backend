// XP and Leaderboard System for PixelPaintParty
// Handles daily XP rewards, streaks, and leaderboard management

class XPSystem {
    constructor() {
        this.playerXPData = new Map(); // playerId -> XP data
        this.leaderboard = new Map(); // username -> leaderboard entry
        this.dailyRewards = this.initializeDailyRewards();
        this.dataFile = 'xp_data.json';
        this.leaderboardFile = 'leaderboard.json';
        this.loadData();
    }

    initializeDailyRewards() {
        // Daily rewards that increase with streak
        return {
            baseXP: 50,                    // Base daily XP
            streakMultiplier: 0.1,         // 10% increase per consecutive day
            maxStreakBonus: 3.0,           // Maximum 300% bonus (30 days)
            weeklyBonus: 100,              // Extra XP every 7 days
            monthlyBonus: 500,             // Extra XP every 30 days
            perfectWeekBonus: 200,         // Bonus for 7 consecutive days
            perfectMonthBonus: 1000        // Bonus for 30 consecutive days
        };
    }

    // Load XP and leaderboard data from files
    loadData() {
        try {
            const fs = require('fs');
            
            // Load XP data
            if (fs.existsSync(this.dataFile)) {
                const xpData = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
                this.playerXPData = new Map(Object.entries(xpData));
            }
            
            // Load leaderboard data
            if (fs.existsSync(this.leaderboardFile)) {
                const leaderboardData = JSON.parse(fs.readFileSync(this.leaderboardFile, 'utf8'));
                this.leaderboard = new Map(Object.entries(leaderboardData));
            }
            
            console.log('✅ XP System data loaded successfully');
        } catch (error) {
            console.error('❌ Error loading XP data:', error);
        }
    }

    // Save XP and leaderboard data to files
    saveData() {
        try {
            const fs = require('fs');
            
            // Save XP data
            const xpDataObj = Object.fromEntries(this.playerXPData);
            fs.writeFileSync(this.dataFile, JSON.stringify(xpDataObj, null, 2));
            
            // Save leaderboard data
            const leaderboardObj = Object.fromEntries(this.leaderboard);
            fs.writeFileSync(this.leaderboardFile, JSON.stringify(leaderboardObj, null, 2));
            
            console.log('💾 XP System data saved successfully');
        } catch (error) {
            console.error('❌ Error saving XP data:', error);
        }
    }

    // Initialize player XP data
    initializePlayer(playerId, username) {
        if (!this.playerXPData.has(playerId)) {
            const playerData = {
                totalXP: 0,
                dailyXP: 0,                    // XP from daily rewards only
                achievementXP: 0,              // XP from achievements
                currentStreak: 0,
                longestStreak: 0,
                lastLoginDate: null,
                username: username,
                joinDate: new Date().toISOString(),
                totalLogins: 0
            };
            this.playerXPData.set(playerId, playerData);
            console.log(`🎮 Initialized XP data for player ${username} (${playerId})`);
        }
        return this.playerXPData.get(playerId);
    }

    // Check and award daily XP
    checkDailyReward(playerId, username) {
        const playerData = this.initializePlayer(playerId, username);
        const today = new Date().toDateString();
        const lastLogin = playerData.lastLoginDate ? new Date(playerData.lastLoginDate).toDateString() : null;
        
        // If already got today's reward, return current data
        if (lastLogin === today) {
            return {
                alreadyClaimed: true,
                currentStreak: playerData.currentStreak,
                totalXP: playerData.totalXP,
                dailyXP: playerData.dailyXP
            };
        }

        // Check if streak continues or breaks
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toDateString();
        
        let streakBroken = false;
        if (lastLogin && lastLogin !== yesterdayStr) {
            // Missed a day - streak broken!
            streakBroken = true;
            const lostXP = playerData.dailyXP;
            
            // Reset daily XP and streak
            playerData.dailyXP = 0;
            playerData.currentStreak = 0;
            playerData.totalXP -= lostXP;
            
            console.log(`💔 Streak broken for ${username}! Lost ${lostXP} daily XP`);
        }

        // Award today's XP
        const reward = this.calculateDailyReward(playerData.currentStreak);
        
        // Update player data
        playerData.currentStreak += 1;
        playerData.longestStreak = Math.max(playerData.longestStreak, playerData.currentStreak);
        playerData.lastLoginDate = new Date().toISOString();
        playerData.totalLogins += 1;
        playerData.dailyXP += reward.totalXP;
        playerData.totalXP += reward.totalXP;
        
        // Update username in case it changed
        playerData.username = username;
        
        // Update leaderboard entry
        this.updateLeaderboard(playerId, username, playerData.totalXP);
        
        // Save data
        this.saveData();
        
        console.log(`🎉 Daily reward for ${username}: ${reward.totalXP} XP (Streak: ${playerData.currentStreak})`);
        
        return {
            alreadyClaimed: false,
            streakBroken: streakBroken,
            lostXP: streakBroken ? playerData.dailyXP : 0,
            reward: reward,
            newStreak: playerData.currentStreak,
            totalXP: playerData.totalXP,
            dailyXP: playerData.dailyXP
        };
    }

    // Calculate daily reward based on streak
    calculateDailyReward(currentStreak) {
        const rewards = this.dailyRewards;
        
        // Base XP with streak multiplier
        const streakBonus = Math.min(currentStreak * rewards.streakMultiplier, rewards.maxStreakBonus);
        const baseXP = Math.floor(rewards.baseXP * (1 + streakBonus));
        
        let bonusXP = 0;
        let bonuses = [];
        
        // Weekly bonus (every 7 days)
        if ((currentStreak + 1) % 7 === 0) {
            bonusXP += rewards.weeklyBonus;
            bonuses.push(`Weekly Bonus: +${rewards.weeklyBonus} XP`);
        }
        
        // Monthly bonus (every 30 days)
        if ((currentStreak + 1) % 30 === 0) {
            bonusXP += rewards.monthlyBonus;
            bonuses.push(`Monthly Bonus: +${rewards.monthlyBonus} XP`);
        }
        
        // Perfect week bonus (exactly 7 consecutive days)
        if (currentStreak + 1 === 7) {
            bonusXP += rewards.perfectWeekBonus;
            bonuses.push(`Perfect Week: +${rewards.perfectWeekBonus} XP`);
        }
        
        // Perfect month bonus (exactly 30 consecutive days)
        if (currentStreak + 1 === 30) {
            bonusXP += rewards.perfectMonthBonus;
            bonuses.push(`Perfect Month: +${rewards.perfectMonthBonus} XP`);
        }
        
        return {
            baseXP: baseXP,
            bonusXP: bonusXP,
            totalXP: baseXP + bonusXP,
            streakMultiplier: Math.round(streakBonus * 100),
            bonuses: bonuses,
            nextDayXP: Math.floor(rewards.baseXP * (1 + Math.min((currentStreak + 1) * rewards.streakMultiplier, rewards.maxStreakBonus)))
        };
    }

    // Award XP for achievements
    awardAchievementXP(playerId, achievementRarity) {
        const playerData = this.playerXPData.get(playerId);
        if (!playerData) return 0;
        
        const xpValues = {
            common: 25,
            rare: 50,
            epic: 100,
            legendary: 250,
            mythic: 500
        };
        
        const xp = xpValues[achievementRarity] || 10;
        playerData.achievementXP += xp;
        playerData.totalXP += xp;
        
        // Update leaderboard
        this.updateLeaderboard(playerId, playerData.username, playerData.totalXP);
        this.saveData();
        
        console.log(`🏆 Achievement XP awarded: ${xp} XP for ${achievementRarity} achievement`);
        return xp;
    }

    // Update leaderboard entry
    updateLeaderboard(playerId, username, totalXP) {
        // Remove old entry if username changed
        const playerData = this.playerXPData.get(playerId);
        if (playerData && playerData.username !== username) {
            // Username changed - remove from leaderboard
            this.leaderboard.delete(playerData.username);
            console.log(`🔄 Removed ${playerData.username} from leaderboard due to username change`);
        }
        
        // Add/update current entry
        this.leaderboard.set(username, {
            playerId: playerId,
            username: username,
            totalXP: totalXP,
            lastUpdate: new Date().toISOString()
        });
    }

    // Remove player from leaderboard (when username changes)
    removeFromLeaderboard(username) {
        if (this.leaderboard.has(username)) {
            this.leaderboard.delete(username);
            this.saveData();
            console.log(`❌ Removed ${username} from leaderboard`);
            return true;
        }
        return false;
    }

    // Get top leaderboard entries
    getLeaderboard(limit = 50) {
        const entries = Array.from(this.leaderboard.values())
            .sort((a, b) => b.totalXP - a.totalXP)
            .slice(0, limit);
        
        return entries.map((entry, index) => ({
            rank: index + 1,
            username: entry.username,
            totalXP: entry.totalXP,
            lastUpdate: entry.lastUpdate
        }));
    }

    // Get player's leaderboard position
    getPlayerRank(username) {
        const sortedEntries = Array.from(this.leaderboard.values())
            .sort((a, b) => b.totalXP - a.totalXP);
        
        const playerIndex = sortedEntries.findIndex(entry => entry.username === username);
        return playerIndex >= 0 ? playerIndex + 1 : null;
    }

    // Get player XP data
    getPlayerXP(playerId) {
        return this.playerXPData.get(playerId) || null;
    }

    // Get XP statistics
    getXPStats() {
        const allPlayers = Array.from(this.playerXPData.values());
        
        return {
            totalPlayers: allPlayers.length,
            totalXPAwarded: allPlayers.reduce((sum, player) => sum + player.totalXP, 0),
            averageXP: allPlayers.length > 0 ? Math.round(allPlayers.reduce((sum, player) => sum + player.totalXP, 0) / allPlayers.length) : 0,
            longestStreak: Math.max(...allPlayers.map(player => player.longestStreak), 0),
            activeStreaks: allPlayers.filter(player => player.currentStreak > 0).length
        };
    }

    // Clean up old/inactive players (optional maintenance)
    cleanupOldPlayers(daysInactive = 90) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysInactive);
        
        let cleaned = 0;
        for (const [playerId, playerData] of this.playerXPData.entries()) {
            const lastLogin = new Date(playerData.lastLoginDate);
            if (lastLogin < cutoffDate) {
                this.playerXPData.delete(playerId);
                this.leaderboard.delete(playerData.username);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            this.saveData();
            console.log(`🧹 Cleaned up ${cleaned} inactive players`);
        }
        
        return cleaned;
    }
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = XPSystem;
}