#!/usr/bin/env node
// Main entry point - analyze replays dropped into the folder
const { AnalysisDB } = require('./database');
const { ReplayAnalyzer } = require('./analyzer');
const fs = require('fs');
const path = require('path');

const REPLAYS_DIR = process.argv[2] || './replays';
const DB_PATH = './bar_analysis.db';

// Known verified human accounts (for baseline calibration)
const VERIFIED_HUMANS = {
    343377: 'rickcoder'  // User confirmed human
};

async function analyzeFile(filepath, db) {
    const filename = path.basename(filepath);

    if (!filename.endsWith('.sdfz')) {
        return null;
    }

    console.log(`\nAnalyzing: ${filename}`);

    try {
        const analyzer = new ReplayAnalyzer(db);
        const result = await analyzer.analyze(filepath);

        if (result.skipped) {
            console.log(`  Skipped (already analyzed): ${result.gameId}`);
            return null;
        }

        console.log(`  Game ID: ${result.gameId}`);
        console.log(`  Map: ${result.mapName}`);
        console.log(`  Duration: ${(result.durationMs / 1000 / 60).toFixed(1)} minutes`);
        console.log(`  Players analyzed: ${result.players.length}`);

        // Print suspicious players
        const suspicious = result.players
            .filter(p => p.suspicionScore > 0)
            .sort((a, b) => b.suspicionScore - a.suspicionScore);

        if (suspicious.length > 0) {
            console.log(`\n  Flagged players:`);
            for (const p of suspicious.slice(0, 5)) {
                const verified = VERIFIED_HUMANS[p.userId] ? ' [VERIFIED HUMAN]' : '';
                const level = p.suspicionScore >= 100 ? '🚨' :
                             p.suspicionScore >= 50 ? '⚠️' :
                             p.suspicionScore >= 20 ? '🔶' : '📋';
                console.log(`    ${level} ${p.name}${verified}: Score ${p.suspicionScore} (${p.flags.length} flags)`);
            }
        }

        return result;
    } catch (err) {
        console.error(`  Error: ${err.message}`);
        return null;
    }
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║        BAR CHEAT DETECTION ANALYZER v1.0                     ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');

    // Ensure replays directory exists
    if (!fs.existsSync(REPLAYS_DIR)) {
        fs.mkdirSync(REPLAYS_DIR, { recursive: true });
        console.log(`\nCreated replays directory: ${REPLAYS_DIR}`);
        console.log('Drop .sdfz replay files here and run again.\n');
        return;
    }

    // Initialize database
    const db = new AnalysisDB(DB_PATH);
    await db.ready;

    // Get all replay files
    const files = fs.readdirSync(REPLAYS_DIR)
        .filter(f => f.endsWith('.sdfz'))
        .map(f => path.join(REPLAYS_DIR, f));

    if (files.length === 0) {
        console.log(`\nNo replay files found in ${REPLAYS_DIR}`);
        console.log('Drop .sdfz replay files and run again.\n');
        db.close();
        return;
    }

    console.log(`\nFound ${files.length} replay file(s) to analyze`);

    // Analyze each file
    let analyzed = 0;
    for (const filepath of files) {
        const result = await analyzeFile(filepath, db);
        if (result) analyzed++;
    }

    // Print summary
    console.log('\n' + '═'.repeat(60));
    console.log('ANALYSIS COMPLETE');
    console.log('═'.repeat(60));
    console.log(`Replays analyzed: ${analyzed}`);

    // Get overall suspicious players
    const suspiciousPlayers = db.getSuspiciousPlayers(10);
    if (suspiciousPlayers.length > 0) {
        console.log('\nMost suspicious players across all games:');
        for (const p of suspiciousPlayers) {
            if (p.avg_suspicion_score === null) continue;
            const verified = VERIFIED_HUMANS[p.user_id] ? ' [VERIFIED HUMAN - BASELINE]' : '';
            console.log(`  ${p.name}${verified}`);
            console.log(`    Games: ${p.games_analyzed}, Avg Score: ${p.avg_suspicion_score?.toFixed(1)}, Critical: ${p.critical_flags}, High: ${p.high_flags}`);
        }
    }

    // Show baseline stats
    const baseline = db.getBaselineStats();
    if (baseline && baseline.sample_size > 0) {
        console.log('\nPopulation baseline (for comparison):');
        console.log(`  Sample size: ${baseline.sample_size} player-games`);
        console.log(`  Avg APM: ${baseline.avg_apm?.toFixed(1)}`);
        console.log(`  Avg ultra-fast %: ${baseline.avg_ultra_fast?.toFixed(2)}%`);
        console.log(`  Avg fast %: ${baseline.avg_fast?.toFixed(2)}%`);
        console.log(`  Avg top interval %: ${baseline.avg_top_interval_pct?.toFixed(2)}%`);
    }

    db.close();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
