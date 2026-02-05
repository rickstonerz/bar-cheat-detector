// Database module using sql.js (pure JS SQLite)
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let SQL = null;

class AnalysisDB {
    constructor(dbPath = './bar_analysis.db') {
        this.dbPath = dbPath;
        this.db = null;
        this.ready = this.init();
    }

    async init() {
        if (!SQL) {
            SQL = await initSqlJs();
        }

        try {
            if (fs.existsSync(this.dbPath)) {
                const buffer = fs.readFileSync(this.dbPath);
                this.db = new SQL.Database(buffer);
            } else {
                this.db = new SQL.Database();
            }
            this.initSchema();
        } catch (err) {
            console.error('DB init error:', err);
            this.db = new SQL.Database();
            this.initSchema();
        }
    }

    initSchema() {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS players (
                user_id INTEGER PRIMARY KEY,
                name TEXT,
                first_seen TEXT,
                last_seen TEXT,
                total_games INTEGER DEFAULT 0,
                total_flags INTEGER DEFAULT 0,
                avg_suspicion_score REAL DEFAULT 0,
                notes TEXT
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS games (
                game_id TEXT PRIMARY KEY,
                filename TEXT,
                map_name TEXT,
                duration_ms INTEGER,
                start_time TEXT,
                analyzed_at TEXT,
                engine_version TEXT
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS game_players (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id TEXT,
                user_id INTEGER,
                player_name TEXT,
                skill TEXT,
                rank INTEGER,
                team_id INTEGER,
                ally_team_id INTEGER,
                total_actions INTEGER,
                total_commands INTEGER,
                total_selections INTEGER,
                apm REAL,
                avg_interval_ms REAL,
                stddev_interval_ms REAL,
                coeff_variation REAL,
                ultra_fast_pct REAL,
                very_fast_pct REAL,
                fast_pct REAL,
                top_interval_ms INTEGER,
                top_interval_pct REAL,
                suspicion_score INTEGER,
                flags_json TEXT,
                FOREIGN KEY (game_id) REFERENCES games(game_id),
                FOREIGN KEY (user_id) REFERENCES players(user_id)
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS flags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id TEXT,
                user_id INTEGER,
                severity TEXT,
                category TEXT,
                message TEXT,
                value REAL,
                FOREIGN KEY (game_id) REFERENCES games(game_id),
                FOREIGN KEY (user_id) REFERENCES players(user_id)
            )
        `);

        // Create indexes if they don't exist
        try {
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(user_id)`);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_game_players_game ON game_players(game_id)`);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_flags_user ON flags(user_id)`);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_flags_severity ON flags(severity)`);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_players_score ON players(avg_suspicion_score DESC)`);
        } catch (e) {
            // Indexes may already exist
        }

        this.save();
    }

    save() {
        const data = this.db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(this.dbPath, buffer);
    }

    upsertPlayer(userId, name) {
        const existing = this.db.exec(`SELECT 1 FROM players WHERE user_id = ${userId}`);

        if (existing.length > 0 && existing[0].values.length > 0) {
            this.db.run(`
                UPDATE players SET
                    name = '${name.replace(/'/g, "''")}',
                    last_seen = datetime('now'),
                    total_games = total_games + 1
                WHERE user_id = ${userId}
            `);
        } else {
            this.db.run(`
                INSERT INTO players (user_id, name, first_seen, last_seen, total_games)
                VALUES (${userId}, '${name.replace(/'/g, "''")}', datetime('now'), datetime('now'), 1)
            `);
        }
        this.save();
    }

    insertGame(gameData) {
        this.db.run(`
            INSERT OR REPLACE INTO games (game_id, filename, map_name, duration_ms, start_time, analyzed_at, engine_version)
            VALUES ('${gameData.gameId}', '${gameData.filename?.replace(/'/g, "''")}', '${gameData.mapName?.replace(/'/g, "''")}',
                    ${gameData.durationMs}, '${gameData.startTime}', datetime('now'), '${gameData.engineVersion}')
        `);
        this.save();
    }

    gameExists(gameId) {
        const result = this.db.exec(`SELECT 1 FROM games WHERE game_id = '${gameId}'`);
        return result.length > 0 && result[0].values.length > 0;
    }

    insertGamePlayer(data) {
        const flagsJson = JSON.stringify(data.flags || []).replace(/'/g, "''");
        this.db.run(`
            INSERT INTO game_players (
                game_id, user_id, player_name, skill, rank, team_id, ally_team_id,
                total_actions, total_commands, total_selections, apm,
                avg_interval_ms, stddev_interval_ms, coeff_variation,
                ultra_fast_pct, very_fast_pct, fast_pct,
                top_interval_ms, top_interval_pct, suspicion_score, flags_json
            ) VALUES (
                '${data.gameId}', ${data.userId}, '${data.playerName?.replace(/'/g, "''")}',
                '${data.skill}', ${data.rank || 0}, ${data.teamId || 0}, ${data.allyTeamId || 0},
                ${data.totalActions || 0}, ${data.totalCommands || 0}, ${data.totalSelections || 0},
                ${data.apm || 0}, ${data.avgIntervalMs || 0}, ${data.stddevIntervalMs || 0},
                ${data.coeffVariation || 0}, ${data.ultraFastPct || 0}, ${data.veryFastPct || 0},
                ${data.fastPct || 0}, ${data.topIntervalMs || 0}, ${data.topIntervalPct || 0},
                ${data.suspicionScore || 0}, '${flagsJson}'
            )
        `);
        this.save();
    }

    insertFlag(gameId, userId, severity, category, message, value) {
        this.db.run(`
            INSERT INTO flags (game_id, user_id, severity, category, message, value)
            VALUES ('${gameId}', ${userId}, '${severity}', '${category}', '${message.replace(/'/g, "''")}', ${value || 0})
        `);
        this.save();
    }

    updatePlayerStats(userId) {
        const flagCount = this.db.exec(`SELECT COUNT(*) FROM flags WHERE user_id = ${userId}`);
        const avgScore = this.db.exec(`SELECT AVG(suspicion_score) FROM game_players WHERE user_id = ${userId}`);

        const flags = flagCount.length > 0 ? flagCount[0].values[0][0] : 0;
        const score = avgScore.length > 0 ? avgScore[0].values[0][0] : 0;

        this.db.run(`
            UPDATE players SET
                total_flags = ${flags},
                avg_suspicion_score = ${score || 0}
            WHERE user_id = ${userId}
        `);
        this.save();
    }

    getSuspiciousPlayers(limit = 20) {
        const result = this.db.exec(`
            SELECT p.*,
                   COUNT(DISTINCT gp.game_id) as games_analyzed,
                   SUM(CASE WHEN f.severity = 'CRITICAL' THEN 1 ELSE 0 END) as critical_flags,
                   SUM(CASE WHEN f.severity = 'HIGH' THEN 1 ELSE 0 END) as high_flags
            FROM players p
            LEFT JOIN game_players gp ON p.user_id = gp.user_id
            LEFT JOIN flags f ON p.user_id = f.user_id
            GROUP BY p.user_id
            ORDER BY p.avg_suspicion_score DESC
            LIMIT ${limit}
        `);

        if (result.length === 0) return [];

        const columns = result[0].columns;
        return result[0].values.map(row => {
            const obj = {};
            columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        });
    }

    getPlayerHistory(userId) {
        const result = this.db.exec(`
            SELECT gp.*, g.map_name, g.start_time
            FROM game_players gp
            JOIN games g ON gp.game_id = g.game_id
            WHERE gp.user_id = ${userId}
            ORDER BY g.start_time DESC
        `);

        if (result.length === 0) return [];

        const columns = result[0].columns;
        return result[0].values.map(row => {
            const obj = {};
            columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        });
    }

    getPlayerFlags(userId, limit = 100) {
        const result = this.db.exec(`
            SELECT f.*, g.map_name, g.start_time
            FROM flags f
            JOIN games g ON f.game_id = g.game_id
            WHERE f.user_id = ${userId}
            ORDER BY g.start_time DESC
            LIMIT ${limit}
        `);

        if (result.length === 0) return [];

        const columns = result[0].columns;
        return result[0].values.map(row => {
            const obj = {};
            columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        });
    }

    getMetricPercentile(metric, value) {
        const result = this.db.exec(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN ${metric} <= ${value} THEN 1 ELSE 0 END) as below
            FROM game_players
            WHERE ${metric} IS NOT NULL
        `);

        if (result.length === 0 || result[0].values[0][0] === 0) return 50;

        const total = result[0].values[0][0];
        const below = result[0].values[0][1];
        return (below / total) * 100;
    }

    getBaselineStats() {
        const result = this.db.exec(`
            SELECT
                AVG(apm) as avg_apm,
                AVG(ultra_fast_pct) as avg_ultra_fast,
                AVG(very_fast_pct) as avg_very_fast,
                AVG(fast_pct) as avg_fast,
                AVG(coeff_variation) as avg_cv,
                AVG(top_interval_pct) as avg_top_interval_pct,
                COUNT(*) as sample_size
            FROM game_players
        `);

        if (result.length === 0) return { sample_size: 0 };

        const columns = result[0].columns;
        const row = result[0].values[0];
        const obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return obj;
    }

    close() {
        this.save();
    }
}

module.exports = { AnalysisDB };
