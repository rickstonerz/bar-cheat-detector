#!/usr/bin/env node
// Hostage Game Detector - Finds games where players are trapped by failed surrender votes
const { DemoParser } = require('sdfz-demo-parser');
const fs = require('fs');
const path = require('path');

async function analyzeHostage(filepath) {
    const parser = new DemoParser({ verbose: false });

    const votes = [];
    const players = {};

    parser.onPacket.add((packet) => {
        // Track player names
        if (packet.name === 'PLAYERNAME' && packet.data) {
            players[packet.data.playerNum] = packet.data.playerName;
        }

        // Track server/host messages (fromId 255)
        if (packet.name === 'CHAT' && packet.data && packet.data.fromId === 255) {
            const msg = packet.data.message || '';
            const time = Math.floor(packet.actualGameTime / 60);

            // Detect resign vote calls
            if (msg.toLowerCase().includes('called a vote for command') &&
                msg.toLowerCase().includes('resign')) {
                const match = msg.match(/resign (\w+)/i);
                votes.push({
                    minute: time,
                    type: 'RESIGN_CALLED',
                    player: match ? match[1] : 'unknown',
                    result: null
                });
            }

            // Detect vote results
            if (msg.toLowerCase().includes('vote for command') &&
                msg.toLowerCase().includes('resign')) {
                if (msg.toLowerCase().includes('failed')) {
                    if (votes.length > 0 && votes[votes.length - 1].result === null) {
                        votes[votes.length - 1].result = 'FAILED';
                    }
                } else if (msg.toLowerCase().includes('passed')) {
                    if (votes.length > 0 && votes[votes.length - 1].result === null) {
                        votes[votes.length - 1].result = 'PASSED';
                    }
                }
            }
        }
    });

    const demo = await parser.parseDemo(filepath);
    const duration = Math.floor(demo.info.meta.durationMs / 1000 / 60);

    // Calculate hostage metrics
    const failedVotes = votes.filter(v => v.result === 'FAILED').length;
    const totalVotes = votes.length;
    const firstVoteTime = votes.length > 0 ? votes[0].minute : null;
    const trappedTime = firstVoteTime !== null ? duration - firstVoteTime : 0;

    // Hostage score: failed votes * trapped time
    const hostageScore = failedVotes * trappedTime;
    const isHostage = failedVotes >= 3 && trappedTime >= 10;

    return {
        filename: path.basename(filepath),
        map: demo.info.meta.map,
        duration,
        votes,
        failedVotes,
        totalVotes,
        firstVoteTime,
        trappedTime,
        hostageScore,
        isHostage
    };
}

async function main() {
    const target = process.argv[2] || 'replays';

    console.log('═'.repeat(60));
    console.log('HOSTAGE GAME DETECTOR');
    console.log('═'.repeat(60));

    let files = [];
    if (fs.statSync(target).isDirectory()) {
        files = fs.readdirSync(target)
            .filter(f => f.endsWith('.sdfz'))
            .map(f => path.join(target, f));
    } else {
        files = [target];
    }

    const hostageGames = [];

    for (const file of files) {
        try {
            const result = await analyzeHostage(file);

            if (result.failedVotes > 0) {
                hostageGames.push(result);

                if (result.isHostage) {
                    console.log('\n🚨 HOSTAGE GAME DETECTED:');
                } else if (result.failedVotes >= 2) {
                    console.log('\n⚠️  Possible hostage:');
                } else {
                    console.log('\n📋 Failed vote(s):');
                }

                console.log(`   File: ${result.filename}`);
                console.log(`   Map: ${result.map}`);
                console.log(`   Duration: ${result.duration} min`);
                console.log(`   Failed surrenders: ${result.failedVotes}`);
                console.log(`   First vote at: ${result.firstVoteTime} min`);
                console.log(`   Trapped time: ${result.trappedTime} min`);
                console.log(`   Hostage score: ${result.hostageScore}`);

                console.log('   Vote timeline:');
                for (const v of result.votes) {
                    const icon = v.result === 'FAILED' ? '❌' : v.result === 'PASSED' ? '✓' : '?';
                    console.log(`      ${icon} [${v.minute}m] ${v.player} resign - ${v.result || 'PENDING'}`);
                }
            }
        } catch (err) {
            console.error(`Error processing ${file}: ${err.message}`);
        }
    }

    console.log('\n' + '═'.repeat(60));
    console.log('SUMMARY');
    console.log('═'.repeat(60));
    console.log(`Games analyzed: ${files.length}`);
    console.log(`Games with failed votes: ${hostageGames.length}`);
    console.log(`Confirmed hostage games: ${hostageGames.filter(g => g.isHostage).length}`);

    if (hostageGames.filter(g => g.isHostage).length > 0) {
        console.log('\n🚨 WORST HOSTAGE GAMES:');
        hostageGames
            .filter(g => g.isHostage)
            .sort((a, b) => b.hostageScore - a.hostageScore)
            .slice(0, 5)
            .forEach(g => {
                console.log(`   ${g.failedVotes} failed votes, ${g.trappedTime}min trapped - ${g.map}`);
            });
    }
}

main().catch(console.error);
