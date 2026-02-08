#!/usr/bin/env node
// Find the Farmers - Detect bot operators by correlation analysis
// Theory: Bot operators play on "main" accounts alongside their bot farms
// Signal: High bot encounter rate + elevated personal suspicion score
//
// DISCLAIMER: This is theoretical/experimental. High correlation does not
// prove someone is a bot operator. Use for investigation, not accusation.

const { DemoParser } = require('sdfz-demo-parser');
const { AnalysisDB } = require('./database');
const fs = require('fs');

const KNOWN_BOTS = ['Pengawin', 'ChaseChase', 'FennyBarka', 'still_xhimi',
                    'toasterbath', 'GrowTall', 'Biggus_Dikkus', 'nightowl7403',
                    'Savagery', 'TadpoleAngel37', '404neo', 'RayLewis', 'StratDieter',
                    'Daedalus777', 'nullaegy', 'Supraamann', 'BustinMakesMe'];
// VERIFIED HUMANS (false positives - removed from bot list):
// - Jaysic: 170ms pattern but plays badly, talks human, verified by rickcoder
// - HotDawg: High burst but low interval concentration, OS44 elite player
// - ZaddyZenith: OS18 air specialist, 200ms pattern = air micro rhythm, not automation

const files = fs.readdirSync('replays').filter(f => f.endsWith('.sdfz'));

console.log('═'.repeat(60));
console.log('FIND THE FARMERS - Bot Operator Detection');
console.log('═'.repeat(60));
console.log('\nTheory: Players who frequently appear WITH bots AND have');
console.log('elevated suspicion scores may be bot operators.\n');
console.log('Analyzing', files.length, 'replays...\n');

const playerStats = {};

async function run() {
    // First pass: count bot encounters for each player
    for (const file of files) {
        try {
            const parser = new DemoParser({ verbose: false });
            const demo = await parser.parseDemo('replays/' + file);
            const names = demo.info.players.map(p => p.name);
            const lowerNames = names.map(n => n.toLowerCase());

            const botsInGame = KNOWN_BOTS.filter(b => lowerNames.includes(b.toLowerCase()));

            for (const name of names) {
                if (KNOWN_BOTS.map(b => b.toLowerCase()).includes(name.toLowerCase())) continue;

                if (!playerStats[name]) {
                    playerStats[name] = { games: 0, gamesWithBots: 0, botNames: {} };
                }
                playerStats[name].games++;

                if (botsInGame.length > 0) {
                    playerStats[name].gamesWithBots++;
                    for (const bot of botsInGame) {
                        playerStats[name].botNames[bot] = (playerStats[name].botNames[bot] || 0) + 1;
                    }
                }
            }
        } catch (e) {}
    }

    // Load suspicion scores from database
    let db;
    try {
        db = new AnalysisDB('./bar_analysis.db');
        await db.ready;
    } catch (e) {
        console.log('Warning: Could not load database for suspicion scores');
    }

    // Calculate farmer score for each player
    const farmers = [];

    for (const [name, stats] of Object.entries(playerStats)) {
        if (stats.games < 5) continue; // Need minimum games

        const botEncounterRate = (stats.gamesWithBots / stats.games) * 100;

        // Get suspicion score from DB if available
        let suspicionScore = 0;
        if (db) {
            try {
                const result = db.db.exec(`
                    SELECT AVG(gp.suspicion_score) as avg_score
                    FROM game_players gp
                    JOIN players p ON gp.player_id = p.id
                    WHERE LOWER(p.name) = LOWER('${name.replace(/'/g, "''")}')
                `);
                if (result[0] && result[0].values[0][0]) {
                    suspicionScore = result[0].values[0][0];
                }
            } catch (e) {}
        }

        // Farmer score = bot encounter rate * suspicion multiplier
        // High encounter + high suspicion = likely farmer
        const suspicionMultiplier = suspicionScore > 50 ? 2 : suspicionScore > 20 ? 1.5 : 1;
        const farmerScore = botEncounterRate * suspicionMultiplier;

        if (botEncounterRate >= 10 || (botEncounterRate >= 5 && suspicionScore >= 50)) {
            farmers.push({
                name,
                games: stats.games,
                botEncounterRate,
                suspicionScore,
                farmerScore,
                topBots: Object.entries(stats.botNames)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([bot, count]) => `${bot}(${count})`)
            });
        }
    }

    // Sort by farmer score
    farmers.sort((a, b) => b.farmerScore - a.farmerScore);

    console.log('POTENTIAL BOT OPERATORS:');
    console.log('(High bot encounter rate + elevated suspicion score)\n');
    console.log('Player'.padEnd(20) + 'Games'.padStart(6) + '  Bot%'.padStart(6) +
                '  Score'.padStart(7) + '  Farmer'.padStart(8) + '  Plays With');
    console.log('─'.repeat(75));

    for (const f of farmers.slice(0, 25)) {
        const flag = f.farmerScore >= 50 ? ' 🚨' : f.farmerScore >= 25 ? ' ⚠️' : '';
        console.log(
            f.name.substring(0, 19).padEnd(20) +
            f.games.toString().padStart(6) +
            (f.botEncounterRate.toFixed(1) + '%').padStart(6) +
            f.suspicionScore.toFixed(0).padStart(7) +
            f.farmerScore.toFixed(0).padStart(8) + flag +
            '  ' + f.topBots.join(', ')
        );
    }

    console.log('\n' + '═'.repeat(60));
    console.log('LEGEND:');
    console.log('  Bot% = How often they play in games with known bots');
    console.log('  Score = Their personal suspicion score (0-100+)');
    console.log('  Farmer = Combined score (high = likely operator)');
    console.log('\n⚠️  DISCLAIMER: This is theoretical. Correlation ≠ causation.');
    console.log('    Use for investigation only, not accusation.');
    console.log('═'.repeat(60));
}

run().catch(console.error);
