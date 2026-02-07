#!/usr/bin/env node
// Compare bot encounter rates across players
const { DemoParser } = require('sdfz-demo-parser');
const fs = require('fs');

const KNOWN_BOTS = ['Pengawin', 'ChaseChase', 'FennyBarka', 'still_xhimi',
                    'toasterbath', 'GrowTall', 'Biggus_Dikkus', 'nightowl7403',
                    'Savagery', 'TadpoleAngel37', '404neo', 'RayLewis', 'StratDieter'];

const TARGET = process.argv[2] || 'rickcoder';
const BASELINE_PLAYERS = ['DigitalTurnip', 'Virign', 'UncleSteve', 'kirinokirino',
                          'Filoman35', 'discord_ian', 'tenguntan', 'Grindan',
                          'Lethenar', 'Neutro'];

const files = fs.readdirSync('replays').filter(f => f.endsWith('.sdfz'));

console.log('═'.repeat(60));
console.log('BASELINE COMPARISON: Bot Encounter Rates');
console.log('═'.repeat(60));
console.log('\nAnalyzing', files.length, 'replays...\n');

const playerStats = {};

async function run() {
    for (const file of files) {
        try {
            const parser = new DemoParser({ verbose: false });
            const demo = await parser.parseDemo('replays/' + file);
            const names = demo.info.players.map(p => p.name);
            const lowerNames = names.map(n => n.toLowerCase());

            // Count bots in this game
            const botsInGame = KNOWN_BOTS.filter(b => lowerNames.includes(b.toLowerCase())).length;

            // Track stats for each player of interest
            const allPlayers = [TARGET, ...BASELINE_PLAYERS];

            for (const player of allPlayers) {
                if (lowerNames.includes(player.toLowerCase())) {
                    if (!playerStats[player]) {
                        playerStats[player] = { games: 0, gamesWithBots: 0, totalBots: 0 };
                    }
                    playerStats[player].games++;
                    if (botsInGame > 0) {
                        playerStats[player].gamesWithBots++;
                        playerStats[player].totalBots += botsInGame;
                    }
                }
            }
        } catch (e) {}
    }

    console.log('Player'.padEnd(20) + 'Games'.padStart(7) + '  Bot Games'.padStart(11) + '  Bot Rate'.padStart(10));
    console.log('─'.repeat(55));

    // Sort by games played
    const sorted = Object.entries(playerStats).sort((a, b) => b[1].games - a[1].games);

    let baselineTotal = 0;
    let baselineBots = 0;

    for (const [name, stats] of sorted) {
        const rate = ((stats.gamesWithBots / stats.games) * 100).toFixed(1);
        const isTarget = name.toLowerCase() === TARGET.toLowerCase();
        const marker = isTarget ? ' ← TARGET' : '';

        console.log(
            name.padEnd(20) +
            stats.games.toString().padStart(7) +
            stats.gamesWithBots.toString().padStart(11) +
            (rate + '%').padStart(10) +
            marker
        );

        if (!isTarget) {
            baselineTotal += stats.games;
            baselineBots += stats.gamesWithBots;
        }
    }

    const targetStats = playerStats[TARGET];
    const baselineRate = (baselineBots / baselineTotal) * 100;
    const targetRate = targetStats ? (targetStats.gamesWithBots / targetStats.games) * 100 : 0;

    console.log('\n' + '═'.repeat(60));
    console.log('RESULTS:');
    console.log('═'.repeat(60));
    console.log(`\n${TARGET}'s bot encounter rate: ${targetRate.toFixed(1)}%`);
    console.log(`Baseline average (${BASELINE_PLAYERS.length} players): ${baselineRate.toFixed(1)}%`);

    const diff = targetRate - baselineRate;
    console.log(`\nDifference: ${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`);

    if (diff > 5) {
        console.log('\n⚠️  WARNING: Target encounters bots MORE than average!');
    } else if (diff < -5) {
        console.log('\n✓ Target encounters bots LESS than average');
    } else {
        console.log('\n✓ Bot encounter rate is NORMAL - no targeting detected');
    }
}

run();
