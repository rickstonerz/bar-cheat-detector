#!/usr/bin/env node
// Find bot farms - multiple bots with identical timing in same game
const { AnalysisDB } = require('./database');

async function main() {
    const db = new AnalysisDB('./bar_analysis.db');
    await db.ready;

    // Find games with multiple suspicious players at same interval
    const farms = db.db.exec(`
        SELECT
            g.game_id,
            g.map_name,
            g.start_time,
            gp.top_interval_ms,
            COUNT(*) as bot_count,
            GROUP_CONCAT(gp.player_name || ' (' || ROUND(gp.top_interval_pct,1) || '%)') as players
        FROM game_players gp
        JOIN games g ON g.game_id = gp.game_id
        WHERE gp.top_interval_pct > 25
          AND gp.suspicion_score >= 100
        GROUP BY g.game_id, gp.top_interval_ms
        HAVING COUNT(*) >= 3
        ORDER BY bot_count DESC, g.start_time DESC
    `);

    if (farms.length > 0 && farms[0].values.length > 0) {
        console.log('BOT FARMS DETECTED - 3+ players with IDENTICAL interval timing in same game:\n');

        for (const row of farms[0].values) {
            const [gameId, map, time, interval, count, players] = row;
            console.log('═'.repeat(80));
            console.log(`FARM: ${count} BOTS @ ${interval}ms interval`);
            console.log(`Game: ${time?.substring(0,16)} on ${map}`);
            console.log(`Players:`);
            players.split(',').forEach(p => console.log(`  - ${p.trim()}`));
        }
        console.log('\n' + '═'.repeat(80));
        console.log(`Total bot farm instances found: ${farms[0].values.length}`);
    } else {
        console.log('No farms with 3+ bots found');
    }

    // Now find twin pairs
    console.log('\n\n');
    console.log('BOT TWIN PAIRS - 2 players with nearly identical timing signatures:\n');

    const twins = db.db.exec(`
        SELECT
            g.start_time,
            gp1.player_name as player1,
            gp2.player_name as player2,
            gp1.top_interval_ms as interval_ms,
            gp1.top_interval_pct as p1_pct,
            gp2.top_interval_pct as p2_pct,
            ABS(gp1.top_interval_pct - gp2.top_interval_pct) as pct_diff,
            gp1.suspicion_score as p1_score,
            gp2.suspicion_score as p2_score
        FROM game_players gp1
        JOIN game_players gp2 ON gp1.game_id = gp2.game_id AND gp1.user_id < gp2.user_id
        JOIN games g ON g.game_id = gp1.game_id
        WHERE gp1.top_interval_pct > 28
          AND gp2.top_interval_pct > 28
          AND gp1.top_interval_ms = gp2.top_interval_ms
          AND ABS(gp1.top_interval_pct - gp2.top_interval_pct) < 3
          AND gp1.suspicion_score >= 100
          AND gp2.suspicion_score >= 100
        ORDER BY pct_diff ASC
        LIMIT 50
    `);

    if (twins.length > 0 && twins[0].values.length > 0) {
        console.log('Date              | Player 1             | Player 2             | Interval | Match');
        console.log('-'.repeat(95));

        for (const row of twins[0].values) {
            const [time, p1, p2, ms, pct1, pct2, diff, sc1, sc2] = row;
            console.log(
                `${time?.substring(0,16)} | ` +
                `${(p1 || '').padEnd(20)} | ` +
                `${(p2 || '').padEnd(20)} | ` +
                `${ms}ms    | ` +
                `${pct1?.toFixed(1)}% vs ${pct2?.toFixed(1)}%`
            );
        }
    }

    db.close();
}

main().catch(err => console.error('Error:', err));
