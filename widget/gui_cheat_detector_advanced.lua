--------------------------------------------------------------------------------
-- BAR REAL-TIME CHEAT DETECTOR WIDGET (ADVANCED)
-- Monitors ALL players and logs suspicious activity to file
--
-- Features:
--   - Real-time detection of automation patterns
--   - Monitors all visible player actions
--   - Logs suspicious activity to file for later analysis
--   - Identifies bot twins (players with matching patterns)
--
-- Author: rickcoder + Claude
-- License: GPL-2.0
--------------------------------------------------------------------------------

function widget:GetInfo()
    return {
        name      = "Cheat Detector Advanced",
        desc      = "Real-time detection with logging and multi-player monitoring",
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
    ULTRA_FAST_MS = 50,
    VERY_FAST_MS = 100,
    FAST_MS = 150,

    -- Suspicious intervals (keyboard repeat, common bot timings)
    SUSPICIOUS_INTERVALS = {170, 130, 200, 100, 30, 33},
    INTERVAL_TOLERANCE = 5,

    -- Alert thresholds
    PERIODICITY_CRITICAL = 30,  -- 30%+ at one interval
    PERIODICITY_HIGH = 20,
    ULTRA_FAST_CRITICAL = 10,   -- 10%+ ultra-fast
    ULTRA_FAST_HIGH = 5,
    BURST_EXTREME = 50,         -- 50+ actions/sec
    BURST_HIGH = 30,

    -- Rolling window
    WINDOW_SIZE = 300,
    UPDATE_INTERVAL = 30,  -- frames

    -- Logging
    LOG_ENABLED = true,
    LOG_FILE = "cheat_detector_log.txt",
}

--------------------------------------------------------------------------------
-- State
--------------------------------------------------------------------------------

local gameFrame = 0
local gameStartTime = 0
local mapName = "Unknown"

-- Per-player tracking: playerID -> { actions[], metrics{} }
local playerData = {}
local myPlayerID = nil

-- UI
local showWindow = true
local selectedTab = "self"  -- "self", "all", "suspects"
local suspectList = {}

--------------------------------------------------------------------------------
-- Utility
--------------------------------------------------------------------------------

local function GetGameTimeMs()
    return gameFrame * 33.333
end

local function Log(msg)
    if not CONFIG.LOG_ENABLED then return end
    local timestamp = os.date("%Y-%m-%d %H:%M:%S")
    local logLine = string.format("[%s] [Frame %d] %s\n", timestamp, gameFrame, msg)

    -- Write to Spring log
    Spring.Echo("[CheatDetector] " .. msg)

    -- Also write to file
    local file = io.open(CONFIG.LOG_FILE, "a")
    if file then
        file:write(logLine)
        file:close()
    end
end

local function InitPlayerData(playerID)
    if not playerData[playerID] then
        local name, active, spectator, teamID = Spring.GetPlayerInfo(playerID)
        playerData[playerID] = {
            name = name or ("Player" .. playerID),
            teamID = teamID,
            spectator = spectator,
            actions = {},
            lastActionTime = 0,
            intervalCounts = {},
            metrics = {
                totalActions = 0,
                apm = 0,
                ultraFastPct = 0,
                fastPct = 0,
                topInterval = 0,
                topIntervalPct = 0,
                maxBurstRate = 0,
                suspicionScore = 0,
                flags = {},
            },
        }
    end
    return playerData[playerID]
end

local function RecordPlayerAction(playerID, actionType)
    local pd = InitPlayerData(playerID)
    local now = GetGameTimeMs()
    local interval = now - pd.lastActionTime

    if pd.lastActionTime > 0 and interval > 0 and interval < 10000 then
        table.insert(pd.actions, {
            time = now,
            interval = interval,
            type = actionType,
        })

        local ri = math.floor(interval / 10) * 10
        pd.intervalCounts[ri] = (pd.intervalCounts[ri] or 0) + 1

        -- Trim to window
        while #pd.actions > CONFIG.WINDOW_SIZE do
            local removed = table.remove(pd.actions, 1)
            local oldRi = math.floor(removed.interval / 10) * 10
            if pd.intervalCounts[oldRi] then
                pd.intervalCounts[oldRi] = pd.intervalCounts[oldRi] - 1
                if pd.intervalCounts[oldRi] <= 0 then
                    pd.intervalCounts[oldRi] = nil
                end
            end
        end
    end

    pd.lastActionTime = now
    pd.metrics.totalActions = pd.metrics.totalActions + 1
end

local function AnalyzePlayer(playerID)
    local pd = playerData[playerID]
    if not pd or #pd.actions < 10 then return end

    local total = #pd.actions
    local ultraFast, fast = 0, 0

    for _, action in ipairs(pd.actions) do
        if action.interval <= CONFIG.ULTRA_FAST_MS then ultraFast = ultraFast + 1 end
        if action.interval <= CONFIG.FAST_MS then fast = fast + 1 end
    end

    pd.metrics.ultraFastPct = (ultraFast / total) * 100
    pd.metrics.fastPct = (fast / total) * 100

    -- Top interval
    local topCount, topInterval = 0, 0
    for interval, count in pairs(pd.intervalCounts) do
        if count > topCount then
            topCount = count
            topInterval = interval
        end
    end
    pd.metrics.topInterval = topInterval
    pd.metrics.topIntervalPct = (topCount / total) * 100

    -- APM
    if #pd.actions >= 2 then
        local windowMs = pd.actions[#pd.actions].time - pd.actions[1].time
        if windowMs > 0 then
            pd.metrics.apm = (#pd.actions / windowMs) * 60000
        end
    end

    -- Burst rate
    local maxBurst = 0
    for i = 1, #pd.actions do
        local burst = 1
        local startTime = pd.actions[i].time
        for j = i + 1, #pd.actions do
            if pd.actions[j].time - startTime <= 1000 then
                burst = burst + 1
            else break end
        end
        if burst > maxBurst then maxBurst = burst end
    end
    pd.metrics.maxBurstRate = maxBurst

    -- Generate flags
    pd.metrics.flags = {}
    pd.metrics.suspicionScore = 0

    -- Check suspicious intervals
    for _, susInterval in ipairs(CONFIG.SUSPICIOUS_INTERVALS) do
        local matchCount = 0
        for interval, count in pairs(pd.intervalCounts) do
            if math.abs(interval - susInterval) <= CONFIG.INTERVAL_TOLERANCE then
                matchCount = matchCount + count
            end
        end
        local matchPct = (matchCount / total) * 100

        if matchPct >= CONFIG.PERIODICITY_CRITICAL then
            table.insert(pd.metrics.flags, {
                severity = "CRITICAL",
                msg = string.format("%.1f%% at %dms", matchPct, susInterval),
            })
            pd.metrics.suspicionScore = pd.metrics.suspicionScore + 100
        elseif matchPct >= CONFIG.PERIODICITY_HIGH then
            table.insert(pd.metrics.flags, {
                severity = "HIGH",
                msg = string.format("%.1f%% at %dms", matchPct, susInterval),
            })
            pd.metrics.suspicionScore = pd.metrics.suspicionScore + 25
        end
    end

    -- Ultra-fast check
    if pd.metrics.ultraFastPct >= CONFIG.ULTRA_FAST_CRITICAL then
        table.insert(pd.metrics.flags, {severity = "CRITICAL", msg = string.format("%.1f%% ultra-fast", pd.metrics.ultraFastPct)})
        pd.metrics.suspicionScore = pd.metrics.suspicionScore + 100
    elseif pd.metrics.ultraFastPct >= CONFIG.ULTRA_FAST_HIGH then
        table.insert(pd.metrics.flags, {severity = "HIGH", msg = string.format("%.1f%% ultra-fast", pd.metrics.ultraFastPct)})
        pd.metrics.suspicionScore = pd.metrics.suspicionScore + 25
    end

    -- Burst check
    if pd.metrics.maxBurstRate >= CONFIG.BURST_EXTREME then
        table.insert(pd.metrics.flags, {severity = "CRITICAL", msg = string.format("%d/sec burst", pd.metrics.maxBurstRate)})
        pd.metrics.suspicionScore = pd.metrics.suspicionScore + 100
    elseif pd.metrics.maxBurstRate >= CONFIG.BURST_HIGH then
        table.insert(pd.metrics.flags, {severity = "HIGH", msg = string.format("%d/sec burst", pd.metrics.maxBurstRate)})
        pd.metrics.suspicionScore = pd.metrics.suspicionScore + 25
    end

    -- Log if suspicious
    if pd.metrics.suspicionScore >= 50 and gameFrame % 900 == 0 then  -- Log every 30 sec
        Log(string.format("SUSPECT: %s - Score: %d, APM: %.1f, TopInterval: %dms (%.1f%%), Burst: %d/sec",
            pd.name, pd.metrics.suspicionScore, pd.metrics.apm,
            pd.metrics.topInterval, pd.metrics.topIntervalPct, pd.metrics.maxBurstRate))
    end
end

local function FindTwins()
    -- Find players with suspiciously similar timing patterns in current game
    local twins = {}
    local ids = {}
    for pid, _ in pairs(playerData) do
        table.insert(ids, pid)
    end

    for i = 1, #ids do
        for j = i + 1, #ids do
            local p1 = playerData[ids[i]]
            local p2 = playerData[ids[j]]

            if p1 and p2 and p1.metrics.topInterval == p2.metrics.topInterval
               and math.abs(p1.metrics.topIntervalPct - p2.metrics.topIntervalPct) < 5
               and p1.metrics.topIntervalPct > 20 and p2.metrics.topIntervalPct > 20
               and p1.metrics.suspicionScore >= 50 and p2.metrics.suspicionScore >= 50 then
                table.insert(twins, {
                    player1 = p1.name,
                    player2 = p2.name,
                    interval = p1.metrics.topInterval,
                    pct1 = p1.metrics.topIntervalPct,
                    pct2 = p2.metrics.topIntervalPct,
                })
                Log(string.format("BOT TWINS DETECTED: %s & %s - Both at %dms (%.1f%% vs %.1f%%)",
                    p1.name, p2.name, p1.metrics.topInterval, p1.metrics.topIntervalPct, p2.metrics.topIntervalPct))
            end
        end
    end
    return twins
end

--------------------------------------------------------------------------------
-- Callins
--------------------------------------------------------------------------------

function widget:Initialize()
    myPlayerID = Spring.GetMyPlayerID()
    mapName = Game.mapName or "Unknown"
    gameStartTime = os.time()

    Log("========================================")
    Log("CHEAT DETECTOR INITIALIZED")
    Log("Map: " .. mapName)
    Log("========================================")

    -- Initialize tracking for all players
    local playerList = Spring.GetPlayerList()
    for _, pid in ipairs(playerList) do
        InitPlayerData(pid)
    end
end

function widget:Shutdown()
    Log("========================================")
    Log("CHEAT DETECTOR SHUTDOWN - FINAL REPORT")
    Log("========================================")

    for pid, pd in pairs(playerData) do
        if pd.metrics.totalActions > 0 then
            Log(string.format("Player: %s | Actions: %d | Score: %d | TopInterval: %dms (%.1f%%)",
                pd.name, pd.metrics.totalActions, pd.metrics.suspicionScore,
                pd.metrics.topInterval, pd.metrics.topIntervalPct))
        end
    end

    local twins = FindTwins()
    if #twins > 0 then
        Log("BOT TWINS FOUND IN THIS GAME:")
        for _, twin in ipairs(twins) do
            Log(string.format("  %s <-> %s @ %dms", twin.player1, twin.player2, twin.interval))
        end
    end
end

function widget:GameFrame(n)
    gameFrame = n

    if n % CONFIG.UPDATE_INTERVAL == 0 then
        for pid, _ in pairs(playerData) do
            AnalyzePlayer(pid)
        end

        -- Update suspect list
        suspectList = {}
        for pid, pd in pairs(playerData) do
            if pd.metrics.suspicionScore >= 50 then
                table.insert(suspectList, {
                    playerID = pid,
                    name = pd.name,
                    score = pd.metrics.suspicionScore,
                    topInterval = pd.metrics.topInterval,
                    topIntervalPct = pd.metrics.topIntervalPct,
                })
            end
        end
        table.sort(suspectList, function(a, b) return a.score > b.score end)
    end
end

-- Track my commands
function widget:CommandNotify(cmdID, cmdParams, cmdOpts)
    RecordPlayerAction(myPlayerID, "command")
    return false
end

function widget:SelectionChanged(selectedUnits)
    RecordPlayerAction(myPlayerID, "selection")
end

-- Track other players' unit commands (synced events visible to us)
function widget:UnitCommand(unitID, unitDefID, unitTeam, cmdID, cmdParams, cmdOpts, cmdTag)
    -- Find player who owns this team
    local playerList = Spring.GetPlayerList(unitTeam)
    if playerList and #playerList > 0 then
        RecordPlayerAction(playerList[1], "unit_command")
    end
end

function widget:KeyRelease(key)
    if key == 0x78 then  -- F9
        showWindow = not showWindow
    elseif key == 0x31 then  -- 1
        selectedTab = "self"
    elseif key == 0x32 then  -- 2
        selectedTab = "all"
    elseif key == 0x33 then  -- 3
        selectedTab = "suspects"
    end
    return false
end

--------------------------------------------------------------------------------
-- Drawing
--------------------------------------------------------------------------------

function widget:DrawScreen()
    if not showWindow then return end

    local vsx, vsy = Spring.GetViewGeometry()
    local x = vsx - 350
    local y = vsy - 200  -- Moved down to avoid game menu overlap
    local width = 330
    local lineHeight = 16

    -- Background
    gl.Color(0, 0, 0, 0.85)
    gl.Rect(x - 10, y - 400, x + width + 10, y + 10)

    -- Title
    gl.Color(1, 1, 1, 1)
    gl.Text("CHEAT DETECTOR [ADVANCED]", x, y - 18, 16, "o")

    -- Tabs
    y = y - 40
    local tabs = {"self", "all", "suspects"}
    local tabX = x
    for _, tab in ipairs(tabs) do
        if selectedTab == tab then
            gl.Color(0, 0.7, 1, 1)
        else
            gl.Color(0.5, 0.5, 0.5, 1)
        end
        gl.Text("[" .. tab:upper() .. "]", tabX, y, 12, "o")
        tabX = tabX + 80
    end

    y = y - 25
    gl.Color(0.4, 0.4, 0.4, 1)
    gl.Rect(x, y, x + width, y + 1)
    y = y - 10

    if selectedTab == "self" then
        -- Show own stats
        local pd = playerData[myPlayerID]
        if pd then
            local m = pd.metrics

            local function DrawLine(label, value, warn)
                gl.Color(warn and 1 or 0.8, warn and 0.5 or 0.8, warn and 0.5 or 0.8, 1)
                gl.Text(label, x, y, 13, "o")
                gl.Text(value, x + 180, y, 13, "o")
                y = y - lineHeight
            end

            DrawLine("Actions:", tostring(m.totalActions), false)
            DrawLine("APM:", string.format("%.1f", m.apm), m.apm > 200)
            DrawLine("Ultra-fast (<50ms):", string.format("%.1f%%", m.ultraFastPct), m.ultraFastPct > 5)
            DrawLine("Fast (<150ms):", string.format("%.1f%%", m.fastPct), m.fastPct > 15)
            DrawLine("Top Interval:", string.format("%dms (%.1f%%)", m.topInterval, m.topIntervalPct), m.topIntervalPct > 20)
            DrawLine("Max Burst:", string.format("%d/sec", m.maxBurstRate), m.maxBurstRate > 30)
            DrawLine("Suspicion Score:", tostring(m.suspicionScore), m.suspicionScore >= 50)

            y = y - 10
            if #m.flags > 0 then
                gl.Color(1, 1, 1, 1)
                gl.Text("FLAGS:", x, y, 13, "o")
                y = y - lineHeight
                for i, flag in ipairs(m.flags) do
                    if i > 4 then break end
                    local c = flag.severity == "CRITICAL" and {1,0,0} or flag.severity == "HIGH" and {1,0.5,0} or {1,1,0}
                    gl.Color(c[1], c[2], c[3], 1)
                    gl.Text("[" .. flag.severity .. "] " .. flag.msg, x, y, 11, "o")
                    y = y - lineHeight
                end
            else
                gl.Color(0, 1, 0, 1)
                gl.Text("No flags - you're clean!", x, y, 13, "o")
            end
        end

    elseif selectedTab == "suspects" then
        -- Show suspect list
        if #suspectList == 0 then
            gl.Color(0, 1, 0, 1)
            gl.Text("No suspects detected", x, y, 14, "o")
        else
            gl.Color(1, 0.3, 0.3, 1)
            gl.Text("SUSPECTS IN THIS GAME:", x, y, 14, "o")
            y = y - lineHeight * 1.5

            for i, sus in ipairs(suspectList) do
                if i > 10 then break end
                local color = sus.score >= 100 and {1, 0, 0} or {1, 0.5, 0}
                gl.Color(color[1], color[2], color[3], 1)
                gl.Text(string.format("%d. %s", i, sus.name), x, y, 12, "o")
                gl.Color(0.7, 0.7, 0.7, 1)
                gl.Text(string.format("Score: %d | %dms (%.0f%%)", sus.score, sus.topInterval, sus.topIntervalPct), x + 120, y, 11, "o")
                y = y - lineHeight
            end

            -- Show twins
            y = y - 10
            local twins = FindTwins()
            if #twins > 0 then
                gl.Color(1, 0, 1, 1)
                gl.Text("BOT TWINS:", x, y, 13, "o")
                y = y - lineHeight
                for _, twin in ipairs(twins) do
                    gl.Color(1, 0.5, 1, 1)
                    gl.Text(string.format("%s <-> %s @ %dms", twin.player1, twin.player2, twin.interval), x, y, 11, "o")
                    y = y - lineHeight
                end
            end
        end

    else  -- all
        -- Show all players
        gl.Color(1, 1, 1, 1)
        gl.Text("ALL PLAYERS:", x, y, 14, "o")
        y = y - lineHeight * 1.5

        local count = 0
        for pid, pd in pairs(playerData) do
            if count >= 12 then break end
            if pd.metrics.totalActions > 0 and not pd.spectator then
                local color = pd.metrics.suspicionScore >= 100 and {1, 0, 0}
                           or pd.metrics.suspicionScore >= 50 and {1, 0.5, 0}
                           or pd.metrics.suspicionScore >= 20 and {1, 1, 0}
                           or {0.5, 1, 0.5}
                gl.Color(color[1], color[2], color[3], 1)
                gl.Text(pd.name:sub(1, 16), x, y, 11, "o")
                gl.Color(0.7, 0.7, 0.7, 1)
                gl.Text(string.format("S:%d Int:%dms(%.0f%%)", pd.metrics.suspicionScore, pd.metrics.topInterval, pd.metrics.topIntervalPct), x + 100, y, 10, "o")
                y = y - lineHeight
                count = count + 1
            end
        end
    end

    -- Footer
    gl.Color(0.4, 0.4, 0.4, 1)
    gl.Text("F9:Toggle | 1:Self 2:All 3:Suspects", x, y - 30, 10, "o")
end
