#!/usr/bin/env node
// Watch for new replay files and analyze automatically
const chokidar = require('chokidar');
const { AnalysisDB } = require('./database');
const { ReplayAnalyzer } = require('./analyzer');
const path = require('path');

const REPLAYS_DIR = process.argv[2] || './replays';
const DB_PATH = './bar_analysis.db';

const VERIFIED_HUMANS = {
    343377: 'rickcoder'
};

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║        BAR CHEAT DETECTION - FILE WATCHER                    ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`\nWatching: ${path.resolve(REPLAYS_DIR)}`);
console.log('Drop .sdfz files to analyze automatically.\n');
console.log('Press Ctrl+C to stop.\n');

const db = new AnalysisDB(DB_PATH);

async function analyzeFile(filepath) {
    const filename = path.basename(filepath);

    if (!filename.endsWith('.sdfz')) {
        return;
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`New replay detected: ${filename}`);
    console.log(`Time: ${new Date().toLocaleString()}`);

    try {
        const analyzer = new ReplayAnalyzer(db);
        const result = await analyzer.analyze(filepath);

        if (result.skipped) {
            console.log(`Already analyzed: ${result.gameId}`);
            return;
        }

        console.log(`Game ID: ${result.gameId}`);
        console.log(`Map: ${result.mapName}`);
        console.log(`Duration: ${(result.durationMs / 1000 / 60).toFixed(1)} minutes`);

        // Print results
        const suspicious = result.players
            .filter(p => p.suspicionScore > 0)
            .sort((a, b) => b.suspicionScore - a.suspicionScore);

        if (suspicious.length > 0) {
            console.log(`\nFlagged players:`);
            for (const p of suspicious) {
                const verified = VERIFIED_HUMANS[p.userId] ? ' [VERIFIED]' : '';
                const level = p.suspicionScore >= 100 ? '🚨 INVESTIGATE' :
                             p.suspicionScore >= 50 ? '⚠️  SUSPICIOUS' :
                             p.suspicionScore >= 20 ? '🔶 WATCH' : '📋 MINOR';
                console.log(`  ${level} ${p.name}${verified}: Score ${p.suspicionScore}`);

                for (const flag of p.flags.slice(0, 3)) {
                    const icon = flag.severity === 'CRITICAL' ? '🚨' :
                                flag.severity === 'HIGH' ? '⚠️' :
                                flag.severity === 'MEDIUM' ? '🔶' : '📋';
                    console.log(`      ${icon} ${flag.message}`);
                }
            }
        } else {
            console.log(`\nNo suspicious activity detected.`);
        }

        console.log(`\nAnalysis stored in database.`);

    } catch (err) {
        console.error(`Error analyzing: ${err.message}`);
    }
}

// Set up file watcher
const watcher = chokidar.watch(REPLAYS_DIR, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
    }
});

watcher
    .on('add', filepath => {
        if (filepath.endsWith('.sdfz')) {
            analyzeFile(filepath);
        }
    })
    .on('error', error => console.error(`Watcher error: ${error}`));

// Handle shutdown
process.on('SIGINT', () => {
    console.log('\n\nShutting down...');
    watcher.close();
    db.close();
    process.exit(0);
});
