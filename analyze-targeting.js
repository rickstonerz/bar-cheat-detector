#!/usr/bin/env node
// Targeting Analysis - Detect if a specific player is being stalked/targeted by bots
const { DemoParser } = require('sdfz-demo-parser');
const fs = require('fs');
const path = require('path');

const TARGET_PLAYER = process.argv[2] || 'rickcoder';

async function analyzeGame(filepath) {
    const parser = new DemoParser({ verbose: false });

    const playerActions = {};
    const playerTeams = {};
    const playerNames = {};

    parser.onPacket.add((packet) => {
        if (packet.name === 'COMMAND' && packet.data) {
            const pid = packet.data.playerNum;
            const time = packet.actualGameTime || 0;
            if (!playerActions[pid]) playerActions[pid] = [];
            playerActions[pid].push({ time, data: packet.data });
        }
    });

    const demo = await parser.parseDemo(filepath);

    // Build player info
    for (const p of demo.info.players) {
        playerNames[p.playerId] = p.name;
        playerTeams[p.playerId] = p.teamId;
    }

    // Find target player
    let targetId = null;
    let targetTeam = null;
    for (const [id, name] of Object.entries(playerNames)) {
        if (name.toLowerCase() === TARGET_PLAYER.toLowerCase()) {
            targetId = parseInt(id);
            targetTeam = playerTeams[id];
            break;
        }
    }

    if (targetId === null) {
        return null; // Target not in this game
    }

    // Get all players in the game
    const allPlayers = Object.keys(playerNames).map(id => ({
        id: parseInt(id),
        name: playerNames[id],
        team: playerTeams[id],
        isEnemy: playerTeams[id] !== targetTeam
    }));

    const enemies = allPlayers.filter(p => p.isEnemy);
    const allies = allPlayers.filter(p => !p.isEnemy && p.id !== targetId);

    return {
        filename: path.basename(filepath),
        map: demo.info.meta.map,
        date: demo.info.meta.startTime,
        duration: Math.floor(demo.info.meta.durationMs / 1000 / 60),
        targetPlayer: TARGET_PLAYER,
        targetTeam,
        enemies: enemies.map(e => e.name),
        allies: allies.map(a => a.name),
        totalPlayers: allPlayers.length
    };
}

async function main() {
    console.log('═'.repeat(60));
    console.log(`TARGETING ANALYSIS FOR: ${TARGET_PLAYER}`);
    console.log('═'.repeat(60));

    const replayDir = 'replays';
    const files = fs.readdirSync(replayDir)
        .filter(f => f.endsWith('.sdfz'))
        .map(f => path.join(replayDir, f));

    console.log(`\nAnalyzing ${files.length} replays...\n`);

    const games = [];
    const playerEncounters = {}; // How many times each player appears with target
    const enemyEncounters = {}; // How many times as enemy
    let totalGames = 0;
    let gamesWithBots = 0;

    for (const file of files) {
        try {
            const result = await analyzeGame(file);
            if (result) {
                games.push(result);
                totalGames++;

                // Track enemy encounters
                for (const enemy of result.enemies) {
                    enemyEncounters[enemy] = (enemyEncounters[enemy] || 0) + 1;
                    playerEncounters[enemy] = (playerEncounters[enemy] || 0) + 1;
                }
                // Track ally encounters
                for (const ally of result.allies) {
                    playerEncounters[ally] = (playerEncounters[ally] || 0) + 1;
                }
            }
        } catch (err) {
            // Skip errored files
        }
    }

    console.log(`Games with ${TARGET_PLAYER}: ${totalGames}`);

    // Find players who appear suspiciously often
    console.log('\n' + '─'.repeat(60));
    console.log('MOST FREQUENT OPPONENTS (potential stalkers):');
    console.log('─'.repeat(60));

    const sortedEnemies = Object.entries(enemyEncounters)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);

    console.log('Player'.padEnd(25) + 'Games vs You'.padStart(12) + '  % of Your Games');
    for (const [name, count] of sortedEnemies) {
        const pct = ((count / totalGames) * 100).toFixed(1);
        const flag = count >= 10 && pct > 5 ? ' ⚠️' : '';
        console.log(name.padEnd(25) + count.toString().padStart(12) + '  ' + pct + '%' + flag);
    }

    // Find suspicious patterns - players who appear WAY more than expected
    console.log('\n' + '─'.repeat(60));
    console.log('ALL FREQUENT ENCOUNTERS (allies + enemies):');
    console.log('─'.repeat(60));

    const sortedAll = Object.entries(playerEncounters)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30);

    for (const [name, count] of sortedAll) {
        const pct = ((count / totalGames) * 100).toFixed(1);
        const enemyCount = enemyEncounters[name] || 0;
        const allyCount = count - enemyCount;
        console.log(
            name.padEnd(22) +
            count.toString().padStart(4) + ' total (' +
            enemyCount + ' enemy, ' + allyCount + ' ally) = ' +
            pct + '%'
        );
    }

    // Timeline analysis - are losses clustered?
    console.log('\n' + '─'.repeat(60));
    console.log('GAME TIMELINE (oldest to newest):');
    console.log('─'.repeat(60));

    games.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Show last 20 games
    const recent = games.slice(-20);
    for (const g of recent) {
        const date = new Date(g.date).toLocaleDateString();
        console.log(`${date}  ${g.duration}min  vs ${g.enemies.length} enemies  ${g.map.substring(0, 25)}`);
    }

    console.log('\n' + '═'.repeat(60));
    console.log('ANALYSIS COMPLETE');
    console.log('═'.repeat(60));
    console.log(`\nTo detect targeting, look for:`);
    console.log(`  - Same players appearing in >10% of your games`);
    console.log(`  - Known bot accounts repeatedly as enemies`);
    console.log(`  - Sudden clusters of losses after specific dates`);
}

main().catch(console.error);
