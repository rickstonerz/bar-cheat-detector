#!/usr/bin/env node
// Report generator - query and analyze player data
const { AnalysisDB } = require('./database');

const DB_PATH = './bar_analysis.db';
let db = null;

const VERIFIED_HUMANS = {
    343377: 'rickcoder'
};

async function initDB() {
    db = new AnalysisDB(DB_PATH);
    await db.ready;
}

function printHelp() {
    console.log(`
BAR Cheat Detection - Report Generator

Usage: node report.js <command> [options]

Commands:
  suspicious [limit]     Show most suspicious players (default: 20)
  player <name|userId>   Show detailed report for a player
  compare <name1> <name2> Compare two players
  baseline               Show population baseline stats
  flags [severity]       Show recent flags (CRITICAL, HIGH, MEDIUM, LOW)
  games [limit]          Show recently analyzed games
  export                 Export suspicious players to CSV

Examples:
  node report.js suspicious 10
  node report.js player rickcoder
  node report.js player 343377
  node report.js compare rickcoder Whittakker
  node report.js flags CRITICAL
`);
}

function showSuspicious(limit = 20) {
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('MOST SUSPICIOUS PLAYERS');
    console.log('══════════════════════════════════════════════════════════════\n');

    const players = db.getSuspiciousPlayers(limit);

    if (players.length === 0) {
        console.log('No data yet. Analyze some replays first.');
        return;
    }

    console.log('Rank  Name                 Games  Avg Score  Critical  High   Status');
    console.log('─'.repeat(75));

    players.forEach((p, i) => {
        if (p.avg_suspicion_score === null) return;

        const verified = VERIFIED_HUMANS[p.user_id] ? '[HUMAN]' : '';
        const status = p.avg_suspicion_score >= 100 ? '🚨 INVESTIGATE' :
                      p.avg_suspicion_score >= 50 ? '⚠️  SUSPICIOUS' :
                      p.avg_suspicion_score >= 20 ? '🔶 WATCH' :
                      p.avg_suspicion_score > 0 ? '📋 MINOR' : '✅ CLEAN';

        console.log(
            `${(i + 1).toString().padStart(4)}  ` +
            `${p.name.padEnd(20)} ` +
            `${(p.games_analyzed || 0).toString().padStart(5)}  ` +
            `${(p.avg_suspicion_score?.toFixed(1) || '0').padStart(9)}  ` +
            `${(p.critical_flags || 0).toString().padStart(8)}  ` +
            `${(p.high_flags || 0).toString().padStart(4)}   ` +
            `${status} ${verified}`
        );
    });
}

function showPlayer(identifier) {
    // Try to find by name or userId
    const result = db.db.exec(`
        SELECT * FROM players
        WHERE name LIKE '%${identifier}%' OR user_id = ${parseInt(identifier) || 0}
    `);

    if (result.length === 0 || result[0].values.length === 0) {
        console.log(`Player not found: ${identifier}`);
        return;
    }

    const columns = result[0].columns;
    const row = result[0].values[0];
    const player = {};
    columns.forEach((col, i) => player[col] = row[i]);

    const verified = VERIFIED_HUMANS[player.user_id] ? ' [VERIFIED HUMAN - BASELINE]' : '';

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(`PLAYER REPORT: ${player.name}${verified}`);
    console.log('══════════════════════════════════════════════════════════════\n');

    console.log(`User ID: ${player.user_id}`);
    console.log(`First seen: ${player.first_seen}`);
    console.log(`Last seen: ${player.last_seen}`);
    console.log(`Total games analyzed: ${player.total_games}`);
    console.log(`Total flags: ${player.total_flags}`);
    console.log(`Average suspicion score: ${player.avg_suspicion_score?.toFixed(1) || 'N/A'}`);

    // Get game history
    const history = db.getPlayerHistory(player.user_id);

    if (history.length > 0) {
        console.log('\n── Game History ────────────────────────────────────────────\n');
        console.log('Date                Map                      APM   Score  Flags');
        console.log('─'.repeat(70));

        for (const game of history.slice(0, 10)) {
            console.log(
                `${game.start_time.substring(0, 16)}  ` +
                `${(game.map_name || '').substring(0, 22).padEnd(22)}  ` +
                `${(game.apm?.toFixed(1) || '?').padStart(5)}  ` +
                `${(game.suspicion_score || 0).toString().padStart(5)}  ` +
                `${JSON.parse(game.flags_json || '[]').length}`
            );
        }
    }

    // Get recent flags
    const flags = db.getPlayerFlags(player.user_id, 20);

    if (flags.length > 0) {
        console.log('\n── Recent Flags ───────────────────────────────────────────\n');

        for (const flag of flags) {
            const icon = flag.severity === 'CRITICAL' ? '🚨' :
                        flag.severity === 'HIGH' ? '⚠️' :
                        flag.severity === 'MEDIUM' ? '🔶' : '📋';
            console.log(`${icon} [${flag.severity}] ${flag.message}`);
            console.log(`   Game: ${flag.start_time?.substring(0, 10)} on ${flag.map_name}`);
        }
    }

    // Calculate percentiles
    if (history.length > 0) {
        const latestGame = history[0];
        console.log('\n── Comparative Analysis ───────────────────────────────────\n');

        const apmPercentile = db.getMetricPercentile('apm', latestGame.apm);
        const fastPercentile = db.getMetricPercentile('fast_pct', latestGame.fast_pct);
        const topIntervalPercentile = db.getMetricPercentile('top_interval_pct', latestGame.top_interval_pct);

        console.log(`APM (${latestGame.apm?.toFixed(1)}): ${apmPercentile.toFixed(0)}th percentile`);
        console.log(`Fast actions (${latestGame.fast_pct?.toFixed(1)}%): ${fastPercentile.toFixed(0)}th percentile`);
        console.log(`Top interval concentration (${latestGame.top_interval_pct?.toFixed(1)}%): ${topIntervalPercentile.toFixed(0)}th percentile`);
    }
}

function comparePlayers(name1, name2) {
    const r1 = db.db.exec(`SELECT * FROM players WHERE name LIKE '%${name1}%'`);
    const r2 = db.db.exec(`SELECT * FROM players WHERE name LIKE '%${name2}%'`);

    if (r1.length === 0 || r1[0].values.length === 0) {
        console.log(`Player not found: ${name1}`);
        return;
    }
    if (r2.length === 0 || r2[0].values.length === 0) {
        console.log(`Player not found: ${name2}`);
        return;
    }

    const cols = r1[0].columns;
    const p1 = {};
    const p2 = {};
    cols.forEach((col, i) => {
        p1[col] = r1[0].values[0][i];
        p2[col] = r2[0].values[0][i];
    });

    const h1 = db.getPlayerHistory(p1.user_id);
    const h2 = db.getPlayerHistory(p2.user_id);

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(`COMPARISON: ${p1.name} vs ${p2.name}`);
    console.log('══════════════════════════════════════════════════════════════\n');

    const verified1 = VERIFIED_HUMANS[p1.user_id] ? ' [VERIFIED HUMAN]' : '';
    const verified2 = VERIFIED_HUMANS[p2.user_id] ? ' [VERIFIED HUMAN]' : '';

    console.log(`                    ${p1.name.padEnd(20)}${verified1}`);
    console.log(`                    ${p2.name.padEnd(20)}${verified2}`);
    console.log('─'.repeat(60));
    console.log(`Games analyzed:     ${(p1.total_games || 0).toString().padEnd(20)}${p2.total_games || 0}`);
    console.log(`Avg suspicion:      ${(p1.avg_suspicion_score?.toFixed(1) || 'N/A').padEnd(20)}${p2.avg_suspicion_score?.toFixed(1) || 'N/A'}`);
    console.log(`Total flags:        ${(p1.total_flags || 0).toString().padEnd(20)}${p2.total_flags || 0}`);

    if (h1.length > 0 && h2.length > 0) {
        const avg = (arr, key) => arr.reduce((a, b) => a + (b[key] || 0), 0) / arr.length;

        console.log(`\nAverage metrics:`);
        console.log(`  APM:              ${avg(h1, 'apm').toFixed(1).padEnd(20)}${avg(h2, 'apm').toFixed(1)}`);
        console.log(`  Ultra-fast %:     ${avg(h1, 'ultra_fast_pct').toFixed(2).padEnd(20)}${avg(h2, 'ultra_fast_pct').toFixed(2)}`);
        console.log(`  Fast %:           ${avg(h1, 'fast_pct').toFixed(2).padEnd(20)}${avg(h2, 'fast_pct').toFixed(2)}`);
        console.log(`  Top interval %:   ${avg(h1, 'top_interval_pct').toFixed(2).padEnd(20)}${avg(h2, 'top_interval_pct').toFixed(2)}`);
        console.log(`  CV:               ${avg(h1, 'coeff_variation').toFixed(3).padEnd(20)}${avg(h2, 'coeff_variation').toFixed(3)}`);
    }
}

function showBaseline() {
    const baseline = db.getBaselineStats();

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('POPULATION BASELINE STATISTICS');
    console.log('══════════════════════════════════════════════════════════════\n');

    if (!baseline || baseline.sample_size === 0) {
        console.log('No data yet. Analyze some replays first.');
        return;
    }

    console.log(`Sample size: ${baseline.sample_size} player-games`);
    console.log(`\nTiming metrics:`);
    console.log(`  Average APM: ${baseline.avg_apm?.toFixed(1)}`);
    console.log(`  Average ultra-fast %: ${baseline.avg_ultra_fast?.toFixed(2)}%`);
    console.log(`  Average very-fast %: ${baseline.avg_very_fast?.toFixed(2)}%`);
    console.log(`  Average fast %: ${baseline.avg_fast?.toFixed(2)}%`);
    console.log(`  Average CV: ${baseline.avg_cv?.toFixed(3)}`);
    console.log(`\nPeriodicity:`);
    console.log(`  Average top interval concentration: ${baseline.avg_top_interval_pct?.toFixed(2)}%`);
}

function showFlags(severity = null) {
    let query = `
        SELECT f.*, p.name, g.map_name, g.start_time
        FROM flags f
        JOIN players p ON f.user_id = p.user_id
        JOIN games g ON f.game_id = g.game_id
    `;

    if (severity) {
        query += ` WHERE f.severity = ?`;
    }

    query += ` ORDER BY g.start_time DESC LIMIT 50`;

    const stmt = db.db.prepare(query);
    const flags = severity ? stmt.all(severity) : stmt.all();

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(`RECENT FLAGS${severity ? ` (${severity})` : ''}`);
    console.log('══════════════════════════════════════════════════════════════\n');

    if (flags.length === 0) {
        console.log('No flags found.');
        return;
    }

    for (const flag of flags) {
        const icon = flag.severity === 'CRITICAL' ? '🚨' :
                    flag.severity === 'HIGH' ? '⚠️' :
                    flag.severity === 'MEDIUM' ? '🔶' : '📋';
        console.log(`${icon} ${flag.name}: ${flag.message}`);
        console.log(`   ${flag.start_time?.substring(0, 16)} on ${flag.map_name}`);
    }
}

function showGames(limit = 10) {
    const stmt = db.db.prepare(`
        SELECT * FROM games ORDER BY start_time DESC LIMIT ?
    `);
    const games = stmt.all(limit);

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('RECENTLY ANALYZED GAMES');
    console.log('══════════════════════════════════════════════════════════════\n');

    if (games.length === 0) {
        console.log('No games analyzed yet.');
        return;
    }

    for (const game of games) {
        console.log(`${game.start_time?.substring(0, 16)} - ${game.map_name}`);
        console.log(`  Duration: ${(game.duration_ms / 1000 / 60).toFixed(1)} min, Engine: ${game.engine_version}`);
        console.log(`  File: ${game.filename}`);
    }
}

function exportCSV() {
    const players = db.getSuspiciousPlayers(1000);
    const lines = ['name,user_id,games,avg_score,total_flags,critical_flags,high_flags,verified'];

    for (const p of players) {
        if (p.avg_suspicion_score === null) continue;
        const verified = VERIFIED_HUMANS[p.user_id] ? 'yes' : 'no';
        lines.push(`"${p.name}",${p.user_id},${p.games_analyzed || 0},${p.avg_suspicion_score?.toFixed(1) || 0},${p.total_flags || 0},${p.critical_flags || 0},${p.high_flags || 0},${verified}`);
    }

    const filename = `bar_suspicious_${new Date().toISOString().slice(0, 10)}.csv`;
    require('fs').writeFileSync(filename, lines.join('\n'));
    console.log(`Exported ${players.length} players to ${filename}`);
}

// Main
async function main() {
    await initDB();

    const command = process.argv[2];
    const args = process.argv.slice(3);

    switch (command) {
        case 'suspicious':
            showSuspicious(parseInt(args[0]) || 20);
            break;
        case 'player':
            if (!args[0]) {
                console.log('Usage: node report.js player <name|userId>');
            } else {
                showPlayer(args[0]);
            }
            break;
        case 'compare':
            if (args.length < 2) {
                console.log('Usage: node report.js compare <name1> <name2>');
            } else {
                comparePlayers(args[0], args[1]);
            }
            break;
        case 'baseline':
            showBaseline();
            break;
        case 'flags':
            showFlags(args[0]);
            break;
        case 'games':
            showGames(parseInt(args[0]) || 10);
            break;
        case 'export':
            exportCSV();
            break;
        default:
            printHelp();
    }

    db.close();
}

main().catch(err => console.error('Error:', err));
