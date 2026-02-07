#!/usr/bin/env node
// Quick targeting analysis
const { DemoParser } = require('sdfz-demo-parser');
const fs = require('fs');

const TARGET = process.argv[2] || 'rickcoder';
const files = fs.readdirSync('replays').filter(f => f.endsWith('.sdfz'));

console.log('Scanning', files.length, 'replays for', TARGET, '...\n');

let gamesPlayed = 0;
const enemyCounts = {};
const allyCounts = {};

async function run() {
    for (const file of files) {
        try {
            const parser = new DemoParser({ verbose: false });
            const demo = await parser.parseDemo('replays/' + file);

            const targetPlayer = demo.info.players.find(p =>
                p.name.toLowerCase() === TARGET.toLowerCase()
            );

            if (!targetPlayer) continue;

            gamesPlayed++;
            const targetTeam = targetPlayer.teamId;

            for (const p of demo.info.players) {
                if (p.name.toLowerCase() === TARGET.toLowerCase()) continue;

                const name = p.name;
                if (p.teamId === targetTeam) {
                    allyCounts[name] = (allyCounts[name] || 0) + 1;
                } else {
                    enemyCounts[name] = (enemyCounts[name] || 0) + 1;
                }
            }

            if (gamesPlayed % 10 === 0) process.stdout.write('.');
        } catch (e) {}
    }

    console.log('\n\n═══════════════════════════════════════════════════════');
    console.log('TARGETING ANALYSIS FOR:', TARGET);
    console.log('═══════════════════════════════════════════════════════');
    console.log('\nTotal games found:', gamesPlayed);

    console.log('\n── MOST FREQUENT ENEMIES ──');
    console.log('(Players who appear as opponents suspiciously often)\n');

    const enemies = Object.entries(enemyCounts).sort((a, b) => b[1] - a[1]);

    console.log('Player'.padEnd(24) + 'Games'.padStart(6) + '   % of Your Games');
    console.log('─'.repeat(50));

    enemies.slice(0, 20).forEach(([name, count]) => {
        const pct = ((count / gamesPlayed) * 100).toFixed(1);
        const flag = pct >= 10 ? ' ⚠️ SUSPICIOUS' : pct >= 5 ? ' ⚡' : '';
        console.log(name.padEnd(24) + count.toString().padStart(6) + '   ' + pct + '%' + flag);
    });

    console.log('\n── MOST FREQUENT ALLIES ──\n');
    const allies = Object.entries(allyCounts).sort((a, b) => b[1] - a[1]);

    allies.slice(0, 10).forEach(([name, count]) => {
        const pct = ((count / gamesPlayed) * 100).toFixed(1);
        console.log(name.padEnd(24) + count.toString().padStart(6) + '   ' + pct + '%');
    });

    // Cross-reference with known bots
    console.log('\n── KNOWN BOT CHECK ──');
    console.log('(Cross-referencing enemies with suspected bot accounts)\n');

    const knownBots = ['Pengawin', 'Jaysic', 'ChaseChase', 'FennyBarka', 'still_xhimi',
                       'toasterbath', 'GrowTall', 'Biggus_Dikkus', 'nightowl7403'];

    let botGames = 0;
    for (const bot of knownBots) {
        const count = enemyCounts[bot] || 0;
        if (count > 0) {
            botGames += count;
            const pct = ((count / gamesPlayed) * 100).toFixed(1);
            console.log('🤖 ' + bot.padEnd(20) + count + ' games (' + pct + '%)');
        }
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('SUMMARY: ' + gamesPlayed + ' games, ' + botGames + ' encounters with known bots');
    console.log('Bot encounter rate: ' + ((botGames / gamesPlayed) * 100).toFixed(1) + '%');
    console.log('═══════════════════════════════════════════════════════');
}

run();
