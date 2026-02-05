#!/usr/bin/env node
// Download all replays for a specific player
const https = require('https');
const fs = require('fs');
const path = require('path');

const REPLAYS_DIR = './replays';
const API_BASE = 'https://api.bar-rts.com';
const STORAGE_BASE = 'https://storage.uk.cloud.ovh.net/v1/AUTH_10286efc0d334efd917d476d7183232e/BAR/demos';

async function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function downloadFile(url, filepath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filepath);
        https.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                // Follow redirect
                https.get(res.headers.location, (res2) => {
                    res2.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                }).on('error', reject);
            } else {
                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }
        }).on('error', reject);
    });
}

async function main() {
    const playerName = process.argv[2];
    const limit = parseInt(process.argv[3]) || 50;

    if (!playerName) {
        console.log('Usage: node download-player.js <playerName> [limit]');
        console.log('Example: node download-player.js rickcoder 100');
        return;
    }

    console.log(`Fetching replays for player: ${playerName}`);

    // Ensure replays directory exists
    if (!fs.existsSync(REPLAYS_DIR)) {
        fs.mkdirSync(REPLAYS_DIR, { recursive: true });
    }

    // Fetch replay list
    const apiUrl = `${API_BASE}/replays?players=${encodeURIComponent(playerName)}&limit=${limit}&hasBots=false`;
    console.log(`API: ${apiUrl}`);

    const response = await fetchJSON(apiUrl);
    console.log(`Found ${response.data.length} replays`);

    let downloaded = 0;
    let skipped = 0;

    for (const replay of response.data) {
        // Get full replay details to get filename
        const detailUrl = `${API_BASE}/replays/${replay.id}`;
        let details;

        try {
            details = await fetchJSON(detailUrl);
        } catch (e) {
            console.log(`  Error fetching details for ${replay.id}: ${e.message}`);
            continue;
        }

        const fileName = details.fileName;
        if (!fileName) {
            console.log(`  No filename for ${replay.id}`);
            continue;
        }

        const localPath = path.join(REPLAYS_DIR, fileName);

        // Skip if already downloaded
        if (fs.existsSync(localPath)) {
            console.log(`  Skip (exists): ${fileName}`);
            skipped++;
            continue;
        }

        const downloadUrl = `${STORAGE_BASE}/${encodeURIComponent(fileName)}`;
        console.log(`  Downloading: ${fileName}`);

        try {
            await downloadFile(downloadUrl, localPath);
            downloaded++;
            console.log(`    OK (${downloaded}/${response.data.length})`);
        } catch (e) {
            console.log(`    Error: ${e.message}`);
        }

        // Small delay to be nice to the server
        await new Promise(r => setTimeout(r, 500));
    }

    console.log(`\nDone! Downloaded: ${downloaded}, Skipped: ${skipped}`);
}

main().catch(err => console.error('Error:', err));
