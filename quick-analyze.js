#!/usr/bin/env node
// Quick single-game analyzer - no database required
const { ReplayAnalyzer } = require('./analyzer');
const path = require('path');

const file = process.argv[2] || 'replays/2026-02-05_06-46-10-469_Supreme Isthmus v2.1_2025.06.12.sdfz';

async function main() {
    console.log('═'.repeat(60));
    console.log('QUICK GAME ANALYSIS');
    console.log('═'.repeat(60));

    const analyzer = new ReplayAnalyzer(null); // No DB
    const result = await analyzer.analyze(file, { skipDb: true });

    console.log(`\nGame: ${path.basename(file)}`);
    console.log(`Map: ${result.mapName}`);
    console.log(`Duration: ${(result.durationMs / 1000 / 60).toFixed(1)} minutes`);
    console.log('\n' + '─'.repeat(60));
    console.log('Player'.padEnd(22) + 'Score'.padStart(7) + '  Top Interval       Status');
    console.log('─'.repeat(60));

    let suspectCount = 0;
    const sorted = result.players.sort((a, b) => b.suspicionScore - a.suspicionScore);

    for (const p of sorted) {
        const status = p.suspicionScore >= 100 ? '🚨 BOT' :
                       p.suspicionScore >= 50 ? '⚠️  SUSPECT' :
                       p.suspicionScore >= 20 ? '🔶 WATCH' : '✓  Clean';

        if (p.suspicionScore >= 50) suspectCount++;

        const interval = p.topInterval ? `${p.topInterval}ms (${p.topIntervalPct.toFixed(1)}%)` : 'N/A';

        console.log(
            p.name.padEnd(22) +
            p.suspicionScore.toString().padStart(7) +
            '  ' + interval.padEnd(17) +
            status
        );
    }

    console.log('─'.repeat(60));

    const totalPlayers = result.players.length;
    console.log(`\nSuspicious (score >= 50): ${suspectCount} / ${totalPlayers}`);
    if (suspectCount > 0) {
        console.log(`Bot percentage: ~${((suspectCount / totalPlayers) * 100).toFixed(0)}%`);
    }

    // Show flags for top suspects
    const topSuspects = sorted.filter(p => p.suspicionScore >= 50).slice(0, 5);
    if (topSuspects.length > 0) {
        console.log('\n' + '═'.repeat(60));
        console.log('TOP SUSPECT FLAGS:');
        console.log('═'.repeat(60));

        for (const p of topSuspects) {
            console.log(`\n${p.name} (Score: ${p.suspicionScore}):`);
            for (const flag of p.flags.slice(0, 4)) {
                const icon = flag.severity === 'CRITICAL' ? '🚨' :
                            flag.severity === 'HIGH' ? '⚠️' : '🔶';
                console.log(`  ${icon} [${flag.severity}] ${flag.message}`);
            }
        }
    }
}

main().catch(err => console.error('Error:', err.message));
