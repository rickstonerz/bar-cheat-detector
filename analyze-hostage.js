// Analyze the hostage game
const fs = require('fs');
const pako = require('pako');
const { DemoParser } = require('sdfz-demo-parser');

const file = 'replays/2026-02-05_06-46-10-469_Supreme Isthmus v2.1_2025.06.12.sdfz';
const compressed = fs.readFileSync(file);
const decompressed = pako.inflate(compressed);

const parser = new DemoParser({ verbose: false });

const interestingPackets = [];
const playerActions = {};

parser.onPacket.add((packet) => {
  // Track all packet types
  const name = packet.name;
  const time = packet.actualGameTime || 0;

  // Look for interesting packets
  if (name && (
    name.includes('CHAT') ||
    name.includes('VOTE') ||
    name.includes('RESIGN') ||
    name.includes('SURRENDER') ||
    name.includes('ALLIANCE') ||
    name.includes('TEAM')
  )) {
    interestingPackets.push({ time, name, data: packet.data });
  }

  // Count actions per player over time (to see activity drop-off)
  if (packet.data && packet.data.playerNum !== undefined) {
    const pid = packet.data.playerNum;
    const minute = Math.floor(time / 60);
    if (!playerActions[pid]) playerActions[pid] = {};
    if (!playerActions[pid][minute]) playerActions[pid][minute] = 0;
    playerActions[pid][minute]++;
  }
});

const result = parser.parse(decompressed.buffer);

console.log('═'.repeat(60));
console.log('HOSTAGE GAME ANALYSIS');
console.log('═'.repeat(60));
console.log('\nGame duration:', (result.header.gameTime / 60).toFixed(1), 'minutes');

// Show teams
console.log('\nPlayers:');
const playerMap = {};
result.header.players.forEach(p => {
  if (!p.isSpectator) {
    playerMap[p.id] = p;
    console.log('  [' + p.team + '] ' + p.name);
  }
});

// Show activity over time for each player
console.log('\n' + '─'.repeat(60));
console.log('ACTIVITY OVER TIME (actions per minute):');
console.log('─'.repeat(60));

const totalMinutes = Math.ceil(result.header.gameTime / 60);
const timeSlots = [0, 10, 20, 30, 40, 50];

// Header
let header = 'Player'.padEnd(20);
timeSlots.forEach(t => { if (t < totalMinutes) header += ('min ' + t).padStart(8); });
console.log(header);

// Per player activity
Object.keys(playerActions).forEach(pid => {
  const p = playerMap[pid];
  if (!p) return;

  let row = p.name.substring(0, 18).padEnd(20);
  timeSlots.forEach(t => {
    if (t < totalMinutes) {
      const actions = playerActions[pid][t] || 0;
      row += actions.toString().padStart(8);
    }
  });
  console.log(row);
});

// Show last 20 minutes activity to see who was still playing
console.log('\n' + '─'.repeat(60));
console.log('LATE GAME ACTIVITY (last 20 minutes):');
console.log('─'.repeat(60));

const lateStart = Math.max(0, totalMinutes - 20);
for (let m = lateStart; m < totalMinutes; m++) {
  let active = [];
  Object.keys(playerActions).forEach(pid => {
    const p = playerMap[pid];
    if (p && playerActions[pid][m] > 10) {
      active.push(p.name);
    }
  });
  if (active.length > 0) {
    console.log('Minute ' + m + ': ' + active.join(', '));
  }
}

console.log('\n' + '─'.repeat(60));
console.log('INTERESTING PACKETS (votes, chat, etc):');
console.log('─'.repeat(60));
interestingPackets.forEach(p => {
  const mins = Math.floor(p.time / 60);
  const secs = Math.floor(p.time % 60);
  console.log('[' + mins + ':' + secs.toString().padStart(2, '0') + '] ' + p.name);
});

if (interestingPackets.length === 0) {
  console.log('(none found in replay data)');
}
