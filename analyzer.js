// Core analysis engine
const { DemoParser } = require('sdfz-demo-parser');
const path = require('path');

class ReplayAnalyzer {
    constructor(db = null) {
        this.db = db;
        this.playerData = {};
        this.flags = {};
        this.gameInfo = null;
        this.baseline = null;
    }

    async analyze(demoPath, options = {}) {
        this.playerData = {};
        this.flags = {};

        const parser = new DemoParser({
            verbose: false,
            excludePackets: []
        });

        // Capture all relevant packets
        parser.onPacket.add((packet) => {
            if (!packet.data) return;
            const playerId = packet.data.playerNum;
            if (playerId === undefined) return;

            if (!this.playerData[playerId]) {
                this.playerData[playerId] = {
                    commands: [],
                    selections: [],
                    allActions: [],
                    commandTypes: {}
                };
            }

            const pd = this.playerData[playerId];
            const time = packet.actualGameTime * 1000;

            if (packet.name === "COMMAND") {
                const cmdName = packet.data.command?.cmdName || "UNKNOWN";
                pd.commands.push({ time, cmdName, data: packet.data.command });
                pd.allActions.push({ time, type: "command", cmdName });
                pd.commandTypes[cmdName] = (pd.commandTypes[cmdName] || 0) + 1;
            }

            if (packet.name === "SELECT") {
                const unitCount = packet.data.selectedUnitIds?.length || 0;
                pd.selections.push({ time, unitCount, unitIds: packet.data.selectedUnitIds });
                pd.allActions.push({ time, type: "select", unitCount });
            }
        });

        const demo = await parser.parseDemo(demoPath);
        this.gameInfo = demo;

        // Load baseline from DB if available
        if (this.db) {
            this.baseline = this.db.getBaselineStats();
        }

        // Check if already analyzed
        if (this.db && this.db.gameExists(demo.info.meta.gameId)) {
            if (!options.force) {
                return { skipped: true, gameId: demo.info.meta.gameId };
            }
        }

        // Build player info map
        const playerInfo = {};
        for (const player of demo.info.players) {
            playerInfo[player.playerId] = player;
        }

        const results = {
            gameId: demo.info.meta.gameId,
            filename: path.basename(demoPath),
            mapName: demo.info.meta.map,
            durationMs: demo.info.meta.durationMs,
            startTime: demo.info.meta.startTime,
            engineVersion: demo.header.versionString,
            players: []
        };

        // Store game in DB
        if (this.db) {
            this.db.insertGame(results);
        }

        // Analyze each player
        for (const [playerId, data] of Object.entries(this.playerData)) {
            const info = playerInfo[playerId];
            if (!info || data.allActions.length < 20) continue;

            this.flags[playerId] = [];

            const playerResult = this.analyzePlayer(playerId, data, demo, info);
            results.players.push(playerResult);

            // Store in DB
            if (this.db) {
                this.db.upsertPlayer(info.userId, info.name);
                this.db.insertGamePlayer({
                    gameId: demo.info.meta.gameId,
                    userId: info.userId,
                    playerName: info.name,
                    skill: info.skill,
                    rank: info.rank,
                    teamId: info.teamId,
                    allyTeamId: info.allyTeamId,
                    ...playerResult.stats,
                    suspicionScore: playerResult.suspicionScore,
                    flags: playerResult.flags
                });

                // Store individual flags
                for (const flag of playerResult.flags) {
                    this.db.insertFlag(
                        demo.info.meta.gameId,
                        info.userId,
                        flag.severity,
                        flag.category || 'general',
                        flag.message,
                        flag.value || 0
                    );
                }

                this.db.updatePlayerStats(info.userId);
            }
        }

        return results;
    }

    analyzePlayer(playerId, data, demo, info) {
        const duration = demo.info.meta.durationMs / 1000 / 60;
        const flags = [];

        // Basic stats
        const totalActions = data.allActions.length;
        const apm = totalActions / duration;

        // Timing analysis
        const intervals = [];
        for (let i = 1; i < data.allActions.length; i++) {
            const delta = data.allActions[i].time - data.allActions[i-1].time;
            if (delta > 0 && delta < 10000) intervals.push(delta);
        }

        let stats = {
            totalActions,
            totalCommands: data.commands.length,
            totalSelections: data.selections.length,
            apm,
            avgIntervalMs: 0,
            stddevIntervalMs: 0,
            coeffVariation: 0,
            ultraFastPct: 0,
            veryFastPct: 0,
            fastPct: 0,
            topIntervalMs: 0,
            topIntervalPct: 0
        };

        if (intervals.length > 10) {
            const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            const stdDev = Math.sqrt(intervals.reduce((sum, x) => sum + Math.pow(x - avg, 2), 0) / intervals.length);
            const coeffVar = stdDev / avg;

            const ultraFast = intervals.filter(t => t <= 33).length;
            const veryFast = intervals.filter(t => t <= 50).length;
            const fast = intervals.filter(t => t <= 100).length;

            // Periodicity analysis
            const roundedIntervals = intervals.map(i => Math.round(i / 10) * 10);
            const frequency = {};
            for (const interval of roundedIntervals) {
                frequency[interval] = (frequency[interval] || 0) + 1;
            }
            const topEntry = Object.entries(frequency).sort((a, b) => b[1] - a[1])[0];

            stats = {
                ...stats,
                avgIntervalMs: avg,
                stddevIntervalMs: stdDev,
                coeffVariation: coeffVar,
                ultraFastPct: (ultraFast / intervals.length) * 100,
                veryFastPct: (veryFast / intervals.length) * 100,
                fastPct: (fast / intervals.length) * 100,
                topIntervalMs: parseInt(topEntry[0]),
                topIntervalPct: (topEntry[1] / intervals.length) * 100
            };

            // Generate flags based on analysis
            this.checkTimingFlags(stats, flags, intervals);
            this.checkPeriodicityFlags(stats, flags, frequency, intervals.length);
            this.checkBurstFlags(data, flags);
            this.checkConsistencyFlags(data, flags, demo);
            this.checkSelectionFlags(data, flags);

            // Compare to baseline if available
            if (this.baseline && this.baseline.sample_size > 10) {
                this.checkBaselineFlags(stats, flags);
            }
        }

        // Calculate suspicion score
        let suspicionScore = 0;
        for (const flag of flags) {
            if (flag.severity === 'CRITICAL') suspicionScore += 100;
            if (flag.severity === 'HIGH') suspicionScore += 25;
            if (flag.severity === 'MEDIUM') suspicionScore += 10;
            if (flag.severity === 'LOW') suspicionScore += 3;
        }

        return {
            playerId,
            userId: info.userId,
            name: info.name,
            skill: info.skill,
            rank: info.rank,
            stats,
            flags,
            suspicionScore
        };
    }

    checkTimingFlags(stats, flags, intervals) {
        // Ultra-fast actions
        if (stats.ultraFastPct > 10) {
            flags.push({
                severity: 'CRITICAL',
                category: 'timing',
                message: `${stats.ultraFastPct.toFixed(1)}% actions at game tick limit (≤33ms)`,
                value: stats.ultraFastPct
            });
        } else if (stats.ultraFastPct > 3) {
            flags.push({
                severity: 'HIGH',
                category: 'timing',
                message: `${stats.ultraFastPct.toFixed(1)}% actions at game tick limit (≤33ms)`,
                value: stats.ultraFastPct
            });
        }

        // Very fast actions
        if (stats.veryFastPct > 15) {
            flags.push({
                severity: 'HIGH',
                category: 'timing',
                message: `${stats.veryFastPct.toFixed(1)}% very fast actions (≤50ms)`,
                value: stats.veryFastPct
            });
        } else if (stats.veryFastPct > 5) {
            flags.push({
                severity: 'MEDIUM',
                category: 'timing',
                message: `${stats.veryFastPct.toFixed(1)}% very fast actions (≤50ms)`,
                value: stats.veryFastPct
            });
        }

        // Fast actions
        if (stats.fastPct > 20) {
            flags.push({
                severity: 'HIGH',
                category: 'timing',
                message: `${stats.fastPct.toFixed(1)}% fast actions (≤100ms)`,
                value: stats.fastPct
            });
        } else if (stats.fastPct > 10) {
            flags.push({
                severity: 'MEDIUM',
                category: 'timing',
                message: `${stats.fastPct.toFixed(1)}% fast actions (≤100ms)`,
                value: stats.fastPct
            });
        }

        // Low variance (bot-like consistency)
        if (stats.coeffVariation < 0.3 && intervals.length > 50) {
            flags.push({
                severity: 'HIGH',
                category: 'consistency',
                message: `Suspiciously consistent timing (CV: ${stats.coeffVariation.toFixed(3)})`,
                value: stats.coeffVariation
            });
        } else if (stats.coeffVariation < 0.5 && intervals.length > 50) {
            flags.push({
                severity: 'LOW',
                category: 'consistency',
                message: `Low timing variance (CV: ${stats.coeffVariation.toFixed(3)})`,
                value: stats.coeffVariation
            });
        }
    }

    checkPeriodicityFlags(stats, flags, frequency, totalIntervals) {
        // High concentration on single interval
        if (stats.topIntervalPct > 30) {
            flags.push({
                severity: 'CRITICAL',
                category: 'periodicity',
                message: `${stats.topIntervalPct.toFixed(1)}% of actions at exactly ${stats.topIntervalMs}ms interval`,
                value: stats.topIntervalPct
            });
        } else if (stats.topIntervalPct > 20) {
            flags.push({
                severity: 'HIGH',
                category: 'periodicity',
                message: `${stats.topIntervalPct.toFixed(1)}% of actions at ${stats.topIntervalMs}ms interval`,
                value: stats.topIntervalPct
            });
        } else if (stats.topIntervalPct > 15) {
            flags.push({
                severity: 'MEDIUM',
                category: 'periodicity',
                message: `${stats.topIntervalPct.toFixed(1)}% of actions at ${stats.topIntervalMs}ms interval`,
                value: stats.topIntervalPct
            });
        }

        // Suspiciously round intervals
        const roundIntervals = [100, 200, 250, 500, 1000];
        for (const ri of roundIntervals) {
            const count = frequency[ri] || 0;
            const pct = (count / totalIntervals) * 100;
            if (pct > 10) {
                flags.push({
                    severity: 'LOW',
                    category: 'periodicity',
                    message: `${pct.toFixed(1)}% actions at exactly ${ri}ms (suspiciously round)`,
                    value: pct
                });
            }
        }
    }

    checkBurstFlags(data, flags) {
        const actions = data.allActions;
        if (actions.length < 20) return;

        const burstWindow = 500;
        let maxRate = 0;
        let burstStart = 0;

        for (let i = 1; i < actions.length; i++) {
            if (actions[i].time - actions[burstStart].time > burstWindow) {
                const burstSize = i - burstStart;
                const burstDuration = actions[i-1].time - actions[burstStart].time;
                if (burstDuration > 0 && burstSize >= 5) {
                    const rate = burstSize / (burstDuration / 1000);
                    maxRate = Math.max(maxRate, rate);
                }
                burstStart = i;
            }
        }

        if (maxRate > 30) {
            flags.push({
                severity: 'CRITICAL',
                category: 'burst',
                message: `Extreme burst rate: ${maxRate.toFixed(1)} actions/sec`,
                value: maxRate
            });
        } else if (maxRate > 20) {
            flags.push({
                severity: 'HIGH',
                category: 'burst',
                message: `High burst rate: ${maxRate.toFixed(1)} actions/sec`,
                value: maxRate
            });
        } else if (maxRate > 15) {
            flags.push({
                severity: 'MEDIUM',
                category: 'burst',
                message: `Elevated burst rate: ${maxRate.toFixed(1)} actions/sec`,
                value: maxRate
            });
        }
    }

    checkConsistencyFlags(data, flags, demo) {
        const actions = data.allActions;
        if (actions.length < 100) return;

        const segments = 5;
        const segmentSize = Math.floor(actions.length / segments);
        const segmentAvgs = [];

        for (let s = 0; s < segments; s++) {
            const start = s * segmentSize;
            const end = start + segmentSize;
            const segActions = actions.slice(start, end);

            const intervals = [];
            for (let i = 1; i < segActions.length; i++) {
                const delta = segActions[i].time - segActions[i-1].time;
                if (delta > 0 && delta < 5000) intervals.push(delta);
            }

            if (intervals.length > 0) {
                const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                segmentAvgs.push(avg);
            }
        }

        if (segmentAvgs.length >= 3) {
            const avgRange = Math.max(...segmentAvgs) - Math.min(...segmentAvgs);
            const overallAvg = segmentAvgs.reduce((a, b) => a + b, 0) / segmentAvgs.length;
            const consistency = avgRange / overallAvg;

            if (consistency < 0.15 && actions.length > 200) {
                flags.push({
                    severity: 'HIGH',
                    category: 'consistency',
                    message: `Suspiciously consistent across game segments (${(consistency*100).toFixed(1)}% variance)`,
                    value: consistency
                });
            } else if (consistency < 0.25 && actions.length > 200) {
                flags.push({
                    severity: 'LOW',
                    category: 'consistency',
                    message: `Low variance across game segments (${(consistency*100).toFixed(1)}% variance)`,
                    value: consistency
                });
            }
        }
    }

    checkSelectionFlags(data, flags) {
        const selections = data.selections;
        if (selections.length < 10) return;

        let rapidLargeSelections = 0;
        for (let i = 1; i < selections.length; i++) {
            const delta = selections[i].time - selections[i-1].time;
            if (delta < 100 && selections[i].unitCount > 10 && selections[i-1].unitCount > 10) {
                rapidLargeSelections++;
            }
        }

        if (rapidLargeSelections > 10) {
            flags.push({
                severity: 'HIGH',
                category: 'selection',
                message: `${rapidLargeSelections} rapid large selection changes`,
                value: rapidLargeSelections
            });
        } else if (rapidLargeSelections > 5) {
            flags.push({
                severity: 'MEDIUM',
                category: 'selection',
                message: `${rapidLargeSelections} rapid large selection changes`,
                value: rapidLargeSelections
            });
        }
    }

    checkBaselineFlags(stats, flags) {
        if (!this.baseline) return;

        // Compare to population baseline
        if (stats.ultraFastPct > this.baseline.avg_ultra_fast * 3 && stats.ultraFastPct > 1) {
            flags.push({
                severity: 'MEDIUM',
                category: 'comparative',
                message: `Ultra-fast rate ${(stats.ultraFastPct / this.baseline.avg_ultra_fast).toFixed(1)}x above average`,
                value: stats.ultraFastPct / this.baseline.avg_ultra_fast
            });
        }

        if (stats.topIntervalPct > this.baseline.avg_top_interval_pct * 2 && stats.topIntervalPct > 10) {
            flags.push({
                severity: 'MEDIUM',
                category: 'comparative',
                message: `Periodicity ${(stats.topIntervalPct / this.baseline.avg_top_interval_pct).toFixed(1)}x above average`,
                value: stats.topIntervalPct / this.baseline.avg_top_interval_pct
            });
        }
    }
}

module.exports = { ReplayAnalyzer };
