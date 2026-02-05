--------------------------------------------------------------------------------
-- BAR REAL-TIME CHEAT DETECTOR WIDGET
-- Analyzes player command timing to detect automation/bots
--
-- Detects:
--   - 170ms keyboard repeat automation
--   - Ultra-fast actions (<50ms between commands)
--   - Inhuman burst rates (>30 actions/sec)
--   - Suspicious periodicity patterns
--
-- Author: rickcoder + Claude
-- License: GPL-2.0
--------------------------------------------------------------------------------

function widget:GetInfo()
    return {
        name      = "Cheat Detector",
        desc      = "Real-time detection of suspicious command timing patterns",
        author    = "rickcoder",
        date      = "2026-01-27",
        license   = "GPL-2.0",
        layer     = 0,
        enabled   = true,
    }
end

--------------------------------------------------------------------------------
-- Configuration
--------------------------------------------------------------------------------

local CONFIG = {
    -- Detection thresholds
    ULTRA_FAST_MS = 50,        -- Actions faster than this are suspicious
    VERY_FAST_MS = 100,        -- Very fast threshold
    FAST_MS = 150,             -- Fast threshold

    -- Periodicity detection
    SUSPICIOUS_INTERVALS = {
        [170] = true,  -- Keyboard repeat rate
        [130] = true,  -- Common bot interval
        [200] = true,  -- Round number (suspicious)
        [100] = true,  -- Round number (very suspicious)
    },
    INTERVAL_TOLERANCE = 5,    -- ms tolerance for interval matching

    -- Thresholds for flags
    PERIODICITY_THRESHOLD = 0.20,  -- 20% at one interval = suspicious
    ULTRA_FAST_THRESHOLD = 0.05,   -- 5% ultra-fast = suspicious
    FAST_THRESHOLD = 0.15,         -- 15% fast = suspicious
    BURST_RATE_THRESHOLD = 30,     -- 30 actions/sec = suspicious

    -- UI settings
    WINDOW_SIZE = 500,   -- Rolling window of actions to analyze
    UPDATE_INTERVAL = 30, -- Frames between UI updates (1 second at 30fps)
    SHOW_ALL_PLAYERS = false, -- Show stats for all visible players
}

--------------------------------------------------------------------------------
-- State
--------------------------------------------------------------------------------

local myPlayerID = nil
local myTeamID = nil
local gameFrame = 0

-- Action history: { timestamp_ms, action_type }
local actionHistory = {}
local lastActionTime = 0

-- Calculated metrics (updated periodically)
local metrics = {
    totalActions = 0,
    apm = 0,
    ultraFastPct = 0,
    veryFastPct = 0,
    fastPct = 0,
    topInterval = 0,
    topIntervalPct = 0,
    maxBurstRate = 0,
    suspicionScore = 0,
    flags = {},
}

-- For interval analysis
local intervalCounts = {}

-- UI state
local lastUpdateFrame = 0
local showWindow = true

-- Font/drawing
local fontSize = 14
local fontSizeLarge = 18

--------------------------------------------------------------------------------
-- Utility Functions
--------------------------------------------------------------------------------

local function GetGameTimeMs()
    -- Convert game frames to milliseconds (30 fps = 33.33ms per frame)
    return gameFrame * 33.333
end

local function GetRealTimeMs()
    return Spring.GetTimer() and select(1, Spring.DiffTimers(Spring.GetTimer(), Spring.GetTimer())) * 1000 or GetGameTimeMs()
end

local function RecordAction(actionType)
    local now = GetGameTimeMs()
    local interval = now - lastActionTime

    if lastActionTime > 0 and interval > 0 and interval < 10000 then
        table.insert(actionHistory, {
            time = now,
            interval = interval,
            type = actionType,
        })

        -- Track interval distribution
        local roundedInterval = math.floor(interval / 10) * 10  -- Round to 10ms
        intervalCounts[roundedInterval] = (intervalCounts[roundedInterval] or 0) + 1

        -- Trim history to window size
        while #actionHistory > CONFIG.WINDOW_SIZE do
            local removed = table.remove(actionHistory, 1)
            local ri = math.floor(removed.interval / 10) * 10
            if intervalCounts[ri] then
                intervalCounts[ri] = intervalCounts[ri] - 1
                if intervalCounts[ri] <= 0 then
                    intervalCounts[ri] = nil
                end
            end
        end
    end

    lastActionTime = now
    metrics.totalActions = metrics.totalActions + 1
end

local function AnalyzeMetrics()
    if #actionHistory < 10 then
        return  -- Not enough data
    end

    local ultraFast = 0
    local veryFast = 0
    local fast = 0
    local total = #actionHistory

    -- Analyze intervals
    for _, action in ipairs(actionHistory) do
        if action.interval <= CONFIG.ULTRA_FAST_MS then
            ultraFast = ultraFast + 1
        end
        if action.interval <= CONFIG.VERY_FAST_MS then
            veryFast = veryFast + 1
        end
        if action.interval <= CONFIG.FAST_MS then
            fast = fast + 1
        end
    end

    metrics.ultraFastPct = (ultraFast / total) * 100
    metrics.veryFastPct = (veryFast / total) * 100
    metrics.fastPct = (fast / total) * 100

    -- Find top interval
    local topCount = 0
    local topInterval = 0
    for interval, count in pairs(intervalCounts) do
        if count > topCount then
            topCount = count
            topInterval = interval
        end
    end
    metrics.topInterval = topInterval
    metrics.topIntervalPct = (topCount / total) * 100

    -- Calculate APM from recent window
    if #actionHistory >= 2 then
        local windowStart = actionHistory[1].time
        local windowEnd = actionHistory[#actionHistory].time
        local windowMinutes = (windowEnd - windowStart) / 60000
        if windowMinutes > 0 then
            metrics.apm = #actionHistory / windowMinutes
        end
    end

    -- Calculate burst rate (max actions in any 1-second window)
    local maxBurst = 0
    for i = 1, #actionHistory do
        local burstCount = 1
        local startTime = actionHistory[i].time
        for j = i + 1, #actionHistory do
            if actionHistory[j].time - startTime <= 1000 then
                burstCount = burstCount + 1
            else
                break
            end
        end
        if burstCount > maxBurst then
            maxBurst = burstCount
        end
    end
    metrics.maxBurstRate = maxBurst

    -- Generate flags and calculate suspicion score
    metrics.flags = {}
    metrics.suspicionScore = 0

    -- Check for suspicious periodicity
    for susInterval, _ in pairs(CONFIG.SUSPICIOUS_INTERVALS) do
        local matchCount = 0
        for interval, count in pairs(intervalCounts) do
            if math.abs(interval - susInterval) <= CONFIG.INTERVAL_TOLERANCE then
                matchCount = matchCount + count
            end
        end
        local matchPct = (matchCount / total) * 100

        if matchPct >= 30 then
            table.insert(metrics.flags, {
                severity = "CRITICAL",
                msg = string.format("%.1f%% actions at %dms interval", matchPct, susInterval),
            })
            metrics.suspicionScore = metrics.suspicionScore + 100
        elseif matchPct >= 20 then
            table.insert(metrics.flags, {
                severity = "HIGH",
                msg = string.format("%.1f%% actions at %dms interval", matchPct, susInterval),
            })
            metrics.suspicionScore = metrics.suspicionScore + 25
        elseif matchPct >= 15 then
            table.insert(metrics.flags, {
                severity = "MEDIUM",
                msg = string.format("%.1f%% actions at %dms interval", matchPct, susInterval),
            })
            metrics.suspicionScore = metrics.suspicionScore + 10
        end
    end

    -- Check ultra-fast actions
    if metrics.ultraFastPct >= 10 then
        table.insert(metrics.flags, {
            severity = "CRITICAL",
            msg = string.format("%.1f%% ultra-fast actions (<%dms)", metrics.ultraFastPct, CONFIG.ULTRA_FAST_MS),
        })
        metrics.suspicionScore = metrics.suspicionScore + 100
    elseif metrics.ultraFastPct >= 5 then
        table.insert(metrics.flags, {
            severity = "HIGH",
            msg = string.format("%.1f%% ultra-fast actions (<%dms)", metrics.ultraFastPct, CONFIG.ULTRA_FAST_MS),
        })
        metrics.suspicionScore = metrics.suspicionScore + 25
    end

    -- Check fast actions
    if metrics.fastPct >= 20 then
        table.insert(metrics.flags, {
            severity = "HIGH",
            msg = string.format("%.1f%% fast actions (<%dms)", metrics.fastPct, CONFIG.FAST_MS),
        })
        metrics.suspicionScore = metrics.suspicionScore + 25
    end

    -- Check burst rate
    if metrics.maxBurstRate >= 50 then
        table.insert(metrics.flags, {
            severity = "CRITICAL",
            msg = string.format("Extreme burst: %d actions/sec", metrics.maxBurstRate),
        })
        metrics.suspicionScore = metrics.suspicionScore + 100
    elseif metrics.maxBurstRate >= CONFIG.BURST_RATE_THRESHOLD then
        table.insert(metrics.flags, {
            severity = "HIGH",
            msg = string.format("High burst: %d actions/sec", metrics.maxBurstRate),
        })
        metrics.suspicionScore = metrics.suspicionScore + 25
    end
end

--------------------------------------------------------------------------------
-- Widget Callins
--------------------------------------------------------------------------------

function widget:Initialize()
    myPlayerID = Spring.GetMyPlayerID()
    myTeamID = Spring.GetMyTeamID()
    Spring.Echo("[CheatDetector] Initialized - monitoring your actions")
end

function widget:Shutdown()
    Spring.Echo("[CheatDetector] Shutdown - final stats:")
    Spring.Echo(string.format("  Total actions: %d", metrics.totalActions))
    Spring.Echo(string.format("  APM: %.1f", metrics.apm))
    Spring.Echo(string.format("  Suspicion score: %d", metrics.suspicionScore))
end

function widget:GameFrame(n)
    gameFrame = n

    -- Periodic metric update
    if n - lastUpdateFrame >= CONFIG.UPDATE_INTERVAL then
        lastUpdateFrame = n
        AnalyzeMetrics()
    end
end

-- Track when player issues commands
function widget:CommandNotify(cmdID, cmdParams, cmdOpts)
    RecordAction("command")
    return false  -- Don't consume the command
end

-- Track selection changes
function widget:SelectionChanged(selectedUnits)
    RecordAction("selection")
end

-- Track key presses (for hotkey detection)
function widget:KeyPress(key, mods, isRepeat)
    if not isRepeat then
        RecordAction("keypress")
    end
    return false
end

-- Toggle window with F9
function widget:KeyRelease(key)
    if key == 0x78 then  -- F9
        showWindow = not showWindow
    end
    return false
end

--------------------------------------------------------------------------------
-- Drawing
--------------------------------------------------------------------------------

function widget:DrawScreen()
    if not showWindow then return end

    local vsx, vsy = Spring.GetViewGeometry()
    local x = vsx - 320
    local y = vsy - 200  -- Moved down to avoid game menu overlap
    local width = 300
    local lineHeight = 18

    -- Background
    gl.Color(0, 0, 0, 0.7)
    gl.Rect(x - 10, y - 280, x + width + 10, y + 10)

    -- Title
    gl.Color(1, 1, 1, 1)
    gl.Text("CHEAT DETECTOR", x, y - 20, fontSizeLarge, "o")

    -- Status indicator
    local statusColor, statusText
    if metrics.suspicionScore >= 100 then
        statusColor = {1, 0, 0, 1}
        statusText = "SUSPICIOUS"
    elseif metrics.suspicionScore >= 50 then
        statusColor = {1, 0.5, 0, 1}
        statusText = "WARNING"
    elseif metrics.suspicionScore >= 20 then
        statusColor = {1, 1, 0, 1}
        statusText = "WATCH"
    else
        statusColor = {0, 1, 0, 1}
        statusText = "CLEAN"
    end

    gl.Color(unpack(statusColor))
    gl.Text(statusText, x + width - 80, y - 20, fontSizeLarge, "o")

    -- Divider
    y = y - 40
    gl.Color(0.5, 0.5, 0.5, 1)
    gl.Rect(x, y, x + width, y + 1)
    y = y - 10

    -- Metrics
    gl.Color(0.8, 0.8, 0.8, 1)

    local function DrawMetric(label, value, warning)
        if warning then
            gl.Color(1, 0.5, 0.5, 1)
        else
            gl.Color(0.8, 0.8, 0.8, 1)
        end
        gl.Text(label .. ":", x, y, fontSize, "o")
        gl.Text(value, x + 160, y, fontSize, "o")
        y = y - lineHeight
    end

    DrawMetric("Actions", tostring(metrics.totalActions), false)
    DrawMetric("APM", string.format("%.1f", metrics.apm), metrics.apm > 200)
    DrawMetric("Ultra-fast (<50ms)", string.format("%.1f%%", metrics.ultraFastPct), metrics.ultraFastPct > 5)
    DrawMetric("Fast (<150ms)", string.format("%.1f%%", metrics.fastPct), metrics.fastPct > 15)
    DrawMetric("Top Interval", string.format("%dms (%.1f%%)", metrics.topInterval, metrics.topIntervalPct),
               metrics.topIntervalPct > 20 and CONFIG.SUSPICIOUS_INTERVALS[metrics.topInterval])
    DrawMetric("Max Burst", string.format("%d/sec", metrics.maxBurstRate), metrics.maxBurstRate > 30)
    DrawMetric("Suspicion Score", tostring(metrics.suspicionScore), metrics.suspicionScore >= 50)

    -- Divider
    y = y - 10
    gl.Color(0.5, 0.5, 0.5, 1)
    gl.Rect(x, y, x + width, y + 1)
    y = y - 10

    -- Flags
    if #metrics.flags > 0 then
        gl.Color(1, 1, 1, 1)
        gl.Text("FLAGS:", x, y, fontSize, "o")
        y = y - lineHeight

        for i, flag in ipairs(metrics.flags) do
            if i > 5 then break end  -- Show max 5 flags

            if flag.severity == "CRITICAL" then
                gl.Color(1, 0, 0, 1)
            elseif flag.severity == "HIGH" then
                gl.Color(1, 0.5, 0, 1)
            elseif flag.severity == "MEDIUM" then
                gl.Color(1, 1, 0, 1)
            else
                gl.Color(0.7, 0.7, 0.7, 1)
            end

            gl.Text("[" .. flag.severity .. "] " .. flag.msg, x, y, fontSize - 2, "o")
            y = y - lineHeight
        end
    else
        gl.Color(0, 1, 0, 1)
        gl.Text("No flags - looking good!", x, y, fontSize, "o")
    end

    -- Footer
    gl.Color(0.5, 0.5, 0.5, 1)
    gl.Text("Press F9 to toggle", x, y - 30, fontSize - 2, "o")
end

--------------------------------------------------------------------------------
-- End
--------------------------------------------------------------------------------
