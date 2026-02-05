# BAR Real-Time Cheat Detector Widget

Real-time detection of automation/bot patterns in Beyond All Reason.

## Features

- **Live monitoring** of command timing patterns
- **170ms keyboard repeat detection** (most common bot signature)
- **Ultra-fast action detection** (<50ms between actions)
- **Burst rate analysis** (impossible human speeds)
- **Bot twin detection** (players with identical timing = same bot farm)
- **Logging** to file for post-game analysis

## Installation

### Step 1: Find your BAR widgets folder

**Windows:**
```
C:\Users\<YOUR_USERNAME>\Documents\My Games\Beyond All Reason\data\LuaUI\Widgets\
```

**Linux:**
```
~/.spring/LuaUI/Widgets/
```

**macOS:**
```
~/Library/Application Support/Spring/LuaUI/Widgets/
```

### Step 2: Copy the widget file

Copy one or both files:
- `gui_cheat_detector.lua` - Basic version (monitors your own actions)
- `gui_cheat_detector_advanced.lua` - Advanced version (monitors all players + logging)

### Step 3: Enable in-game

1. Start BAR
2. Press **F11** to open the widget menu
3. Find "Cheat Detector" or "Cheat Detector Advanced"
4. Check the box to enable it

## Usage

### Basic Version
- Widget displays in top-right corner
- Shows your own timing metrics in real-time
- Press **F9** to toggle visibility

### Advanced Version
- Press **F9** to toggle visibility
- Press **1** for SELF tab (your stats)
- Press **2** for ALL tab (all players)
- Press **3** for SUSPECTS tab (flagged players + bot twins)

## What It Detects

### Suspicious Patterns

| Pattern | Meaning |
|---------|---------|
| **170ms interval** | Keyboard repeat rate automation |
| **130ms interval** | Common bot timing |
| **100/200ms intervals** | Round-number automation |
| **30-33ms interval** | Game-tick perfect timing |

### Alert Levels

| Score | Level | Meaning |
|-------|-------|---------|
| 0-19 | CLEAN | Normal human play |
| 20-49 | WATCH | Slightly elevated patterns |
| 50-99 | WARNING | Suspicious patterns detected |
| 100+ | SUSPICIOUS | Strong automation indicators |

### Critical Flags

- **30%+ actions at one interval** = Almost certainly automated
- **10%+ ultra-fast actions** = Inhuman reaction times
- **50+ actions/sec burst** = Physically impossible

## Log File

The advanced version writes to `cheat_detector_log.txt` in your BAR directory.

Log entries include:
- Suspect alerts with metrics
- Bot twin detections
- End-of-game summary for all players

## Understanding the Metrics

### Your Baseline (Human)
Based on rickcoder's verified human data:
- Top interval concentration: ~5-15%
- Ultra-fast actions: ~0%
- Score variance: 0-50 (varies game to game)

### Bot Signatures
Based on detected bots (Pengawin, Jaysic, etc.):
- Top interval concentration: 30-45% (at exactly 170ms)
- Consistent scores EVERY game (can't turn off the cheat)
- Often appear in pairs/groups with matching patterns

## Source Code

This widget is open source. Contribute at:
https://github.com/your-repo/bar-cheat-detector

## Credits

- **rickcoder** - Concept, testing, human baseline data
- **Claude** - Implementation assistance
- **BAR Community** - For the game we love

## License

GPL-2.0 - Same as BAR
