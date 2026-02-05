--------------------------------------------------------------------------------
-- BAR CHEAT DETECTOR - SPECTATOR MODE
-- Optimized for watching games and detecting bots in real-time
--
-- USE THIS WHEN SPECTATING - watches ALL players simultaneously
--
-- Author: rickcoder + Claude
-- License: GPL-2.0
--------------------------------------------------------------------------------

function widget:GetInfo()
    return {
        name      = "Cheat Detector [SPECTATOR]",
        desc      = "Real-time bot detection while spectating - monitors ALL players",
        author    = "rickcoder",
        date      = "2026-01-27",
        license   = "GPL-2.0",
        layer     = 1000,
        enabled   = true,
    }
end

--------------------------------------------------------------------------------
-- Configuration
--------------------------------------------------------------------------------

local CONFIG = {
    SUSPICIOUS_INTERVALS = {170, 130, 200, 100, 30, 33},
    INTERVAL_TOLERANCE = 5,
    WINDOW_SIZE = 200,
    UPDATE_INTERVAL = 15,  -- Update twice per second

    -- Thresholds
    PERIODICITY_CRITICAL = 30,
    PERIODICITY_HIGH = 20,
    BURST_EXTREME = 50,
    BURST_HIGH = 30,

    -- Logging
    LOG_ENABLED = true,
}

--------------------------------------------------------------------------------
-- State
--------------------------------------------------------------------------------

local gameFrame = 0
local isSpectator = false
local myPlayerID = nil
local myTeamID = nil

-- Track all teams/players: teamID -> { actions[], metrics{}, playerName }
local teamData = {}

-- UI
local showWindow = true
local suspectList = {}

--------------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------------

local function GetGameTimeMs()
    return gameFrame * 33.333
end

local function Log(msg)
    if CONFIG.LOG_ENABLED then
        Spring.Echo("[CheatDetector-Spec] " .. msg)
    end
end

local function GetTeamPlayerName(teamID)
    local playerList = Spring.GetPlayerList(teamID, true)
    if playerList and #playerList > 0 then
        local name = Spring.GetPlayerInfo(playerList[1])
        return name or ("Team" .. teamID)
    end
    -- Check if it's an AI
    local _, leader, _, isAI, _, name = Spring.GetTeamInfo(teamID)
    if isAI then
        return name or ("AI-" .. teamID)
    end
    return "Team" .. teamID
end

local function InitTeamData(teamID)
    if not teamData[teamID] then
        teamData[teamID] = {
            name = GetTeamPlayerName(teamID),
            actions = {},
            lastActionTime = 0,
            intervalCounts = {},
            metrics = {
                totalActions = 0,
                apm = 0,
                topInterval = 0,
                topIntervalPct = 0,
                maxBurstRate = 0,
                suspicionScore = 0,
                flags = {},
            },
        }
    end
    return teamData[teamID]
end

local function RecordTeamAction(teamID, actionType)
    local td = InitTeamData(teamID)
    local now = GetGameTimeMs()
    local interval = now - td.lastActionTime

    if td.lastActionTime > 0 and interval > 0 and interval < 5000 then
        table.insert(td.actions, {
            time = now,
            interval = interval,
            type = actionType,
        })

        local ri = math.floor(interval / 10) * 10
        td.intervalCounts[ri] = (td.intervalCounts[ri] or 0) + 1

        while #td.actions > CONFIG.WINDOW_SIZE do
            local removed = table.remove(td.actions, 1)
            local oldRi = math.floor(removed.interval / 10) * 10
            if td.intervalCounts[oldRi] then
                td.intervalCounts[oldRi] = td.intervalCounts[oldRi] - 1
                if td.intervalCounts[oldRi] <= 0 then
                    td.intervalCounts[oldRi] = nil
                end
            end
        end
    end

    td.lastActionTime = now
    td.metrics.totalActions = td.metrics.totalActions + 1
end

local function AnalyzeTeam(teamID)
    local td = teamData[teamID]
    if not td or #td.actions < 10 then return end

    local total = #td.actions

    -- Top interval
    local topCount, topInterval = 0, 0
    for interval, count in pairs(td.intervalCounts) do
        if count > topCount then
            topCount = count
            topInterval = interval
        end
    end
    td.metrics.topInterval = topInterval
    td.metrics.topIntervalPct = (topCount / total) * 100

    -- APM
    if #td.actions >= 2 then
        local windowMs = td.actions[#td.actions].time - td.actions[1].time
        if windowMs > 0 then
            td.metrics.apm = (#td.actions / windowMs) * 60000
        end
    end

    -- Burst rate
    local maxBurst = 0
    for i = 1, #td.actions do
        local burst = 1
        local startTime = td.actions[i].time
        for j = i + 1, #td.actions do
            if td.actions[j].time - startTime <= 1000 then
                burst = burst + 1
            else break end
        end
        if burst > maxBurst then maxBurst = burst end
    end
    td.metrics.maxBurstRate = maxBurst

    -- Generate flags
    td.metrics.flags = {}
    td.metrics.suspicionScore = 0

    -- Check suspicious intervals
    for _, susInterval in ipairs(CONFIG.SUSPICIOUS_INTERVALS) do
        local matchCount = 0
        for interval, count in pairs(td.intervalCounts) do
            if math.abs(interval - susInterval) <= CONFIG.INTERVAL_TOLERANCE then
                matchCount = matchCount + count
            end
        end
        local matchPct = (matchCount / total) * 100

        if matchPct >= CONFIG.PERIODICITY_CRITICAL then
            table.insert(td.metrics.flags, {
                severity = "CRITICAL",
                msg = string.format("%.0f%% @ %dms", matchPct, susInterval),
            })
            td.metrics.suspicionScore = td.metrics.suspicionScore + 100
        elseif matchPct >= CONFIG.PERIODICITY_HIGH then
            table.insert(td.metrics.flags, {
                severity = "HIGH",
                msg = string.format("%.0f%% @ %dms", matchPct, susInterval),
            })
            td.metrics.suspicionScore = td.metrics.suspicionScore + 25
        end
    end

    -- Burst check
    if td.metrics.maxBurstRate >= CONFIG.BURST_EXTREME then
        table.insert(td.metrics.flags, {severity = "CRITICAL", msg = string.format("%d/s burst", td.metrics.maxBurstRate)})
        td.metrics.suspicionScore = td.metrics.suspicionScore + 100
    elseif td.metrics.maxBurstRate >= CONFIG.BURST_HIGH then
        table.insert(td.metrics.flags, {severity = "HIGH", msg = string.format("%d/s burst", td.metrics.maxBurstRate)})
        td.metrics.suspicionScore = td.metrics.suspicionScore + 25
    end
end

local function FindTwins()
    local twins = {}
    local teamIDs = {}
    for tid, _ in pairs(teamData) do
        table.insert(teamIDs, tid)
    end

    for i = 1, #teamIDs do
        for j = i + 1, #teamIDs do
            local t1 = teamData[teamIDs[i]]
            local t2 = teamData[teamIDs[j]]

            if t1 and t2
               and t1.metrics.topInterval == t2.metrics.topInterval
               and t1.metrics.topInterval > 0
               and math.abs(t1.metrics.topIntervalPct - t2.metrics.topIntervalPct) < 5
               and t1.metrics.topIntervalPct > 20 and t2.metrics.topIntervalPct > 20
               and t1.metrics.suspicionScore >= 50 and t2.metrics.suspicionScore >= 50 then
                table.insert(twins, {
                    name1 = t1.name,
                    name2 = t2.name,
                    interval = t1.metrics.topInterval,
                })
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
    local _, _, spec = Spring.GetPlayerInfo(myPlayerID)
    isSpectator = spec

    if isSpectator then
        Log("SPECTATOR MODE ACTIVE - Monitoring all players")
    else
        Log("PLAYER MODE - Monitoring all visible unit commands")
    end

    -- Initialize all teams
    local teamList = Spring.GetTeamList()
    for _, teamID in ipairs(teamList) do
        if teamID ~= Spring.GetGaiaTeamID() then
            InitTeamData(teamID)
        end
    end
end

function widget:Shutdown()
    Log("=== FINAL SUSPECT REPORT ===")
    for _, td in pairs(teamData) do
        if td.metrics.suspicionScore >= 50 then
            Log(string.format("SUSPECT: %s - Score: %d, Interval: %dms (%.0f%%)",
                td.name, td.metrics.suspicionScore, td.metrics.topInterval, td.metrics.topIntervalPct))
        end
    end

    local twins = FindTwins()
    for _, twin in ipairs(twins) do
        Log(string.format("BOT TWINS: %s <-> %s @ %dms", twin.name1, twin.name2, twin.interval))
    end
end

function widget:GameFrame(n)
    gameFrame = n

    if n % CONFIG.UPDATE_INTERVAL == 0 then
        -- Analyze all teams
        for teamID, _ in pairs(teamData) do
            AnalyzeTeam(teamID)
        end

        -- Update suspect list
        suspectList = {}
        for teamID, td in pairs(teamData) do
            if td.metrics.totalActions > 20 then
                table.insert(suspectList, {
                    teamID = teamID,
                    name = td.name,
                    score = td.metrics.suspicionScore,
                    topInterval = td.metrics.topInterval,
                    topIntervalPct = td.metrics.topIntervalPct,
                    apm = td.metrics.apm,
                    burst = td.metrics.maxBurstRate,
                    flags = td.metrics.flags,
                })
            end
        end
        table.sort(suspectList, function(a, b) return a.score > b.score end)
    end
end

-- This fires for ALL unit commands we can see (including other players in spectator mode)
function widget:UnitCommand(unitID, unitDefID, unitTeam, cmdID, cmdParams, cmdOpts, cmdTag)
    if unitTeam and unitTeam ~= Spring.GetGaiaTeamID() then
        RecordTeamAction(unitTeam, "command")
    end
end

-- Also track unit creation (build orders)
function widget:UnitCreated(unitID, unitDefID, unitTeam, builderID)
    if unitTeam and unitTeam ~= Spring.GetGaiaTeamID() and builderID then
        RecordTeamAction(unitTeam, "build")
    end
end

-- Track unit orders given
function widget:UnitCmdDone(unitID, unitDefID, unitTeam, cmdID, cmdParams, cmdOpts, cmdTag)
    if unitTeam and unitTeam ~= Spring.GetGaiaTeamID() then
        RecordTeamAction(unitTeam, "cmd_done")
    end
end

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
    local x = vsx - 380
    local y = vsy - 200  -- Moved down to avoid game menu overlap
    local width = 360
    local lineHeight = 18

    -- Calculate window height based on content
    local contentLines = 4 + math.min(#suspectList, 12) + 3
    local twins = FindTwins()
    if #twins > 0 then
        contentLines = contentLines + 2 + #twins
    end
    local windowHeight = contentLines * lineHeight + 40

    -- Background
    gl.Color(0, 0, 0, 0.9)
    gl.Rect(x - 10, y - windowHeight, x + width + 10, y + 10)

    -- Title with mode indicator
    gl.Color(0, 1, 1, 1)
    local modeText = isSpectator and "[SPECTATING]" or "[PLAYING]"
    gl.Text("CHEAT DETECTOR " .. modeText, x, y - 18, 15, "o")

    y = y - 40

    -- Summary line
    local suspectCount = 0
    for _, s in ipairs(suspectList) do
        if s.score >= 50 then suspectCount = suspectCount + 1 end
    end

    if suspectCount > 0 then
        gl.Color(1, 0.3, 0.3, 1)
        gl.Text(string.format("SUSPECTS DETECTED: %d", suspectCount), x, y, 14, "o")
    else
        gl.Color(0, 1, 0, 1)
        gl.Text("No suspects - all players look clean", x, y, 14, "o")
    end

    y = y - 25

    -- Divider
    gl.Color(0.4, 0.4, 0.4, 1)
    gl.Rect(x, y, x + width, y + 1)
    y = y - 15

    -- Player list header
    gl.Color(0.7, 0.7, 0.7, 1)
    gl.Text("Player", x, y, 11, "o")
    gl.Text("Score", x + 140, y, 11, "o")
    gl.Text("Interval", x + 190, y, 11, "o")
    gl.Text("APM", x + 270, y, 11, "o")
    gl.Text("Burst", x + 310, y, 11, "o")
    y = y - lineHeight

    -- Player rows
    for i, player in ipairs(suspectList) do
        if i > 12 then break end

        -- Color by suspicion level
        local color
        if player.score >= 100 then
            color = {1, 0, 0, 1}  -- Red
        elseif player.score >= 50 then
            color = {1, 0.5, 0, 1}  -- Orange
        elseif player.score >= 20 then
            color = {1, 1, 0, 1}  -- Yellow
        else
            color = {0.5, 1, 0.5, 1}  -- Green
        end

        gl.Color(unpack(color))
        gl.Text(player.name:sub(1, 18), x, y, 12, "o")

        gl.Color(0.9, 0.9, 0.9, 1)
        gl.Text(tostring(player.score), x + 140, y, 12, "o")
        gl.Text(string.format("%dms(%.0f%%)", player.topInterval, player.topIntervalPct), x + 180, y, 11, "o")
        gl.Text(string.format("%.0f", player.apm), x + 270, y, 11, "o")
        gl.Text(string.format("%d/s", player.burst), x + 310, y, 11, "o")

        y = y - lineHeight
    end

    -- Bot twins section
    if #twins > 0 then
        y = y - 10
        gl.Color(1, 0, 1, 1)
        gl.Text("BOT TWINS DETECTED:", x, y, 13, "o")
        y = y - lineHeight

        for _, twin in ipairs(twins) do
            gl.Color(1, 0.5, 1, 1)
            gl.Text(string.format("%s <-> %s @ %dms", twin.name1:sub(1,12), twin.name2:sub(1,12), twin.interval), x, y, 11, "o")
            y = y - lineHeight
        end
    end

    -- Footer
    y = y - 10
    gl.Color(0.4, 0.4, 0.4, 1)
    gl.Text("F9: Toggle | Red=Bot Orange=Suspicious Green=Clean", x, y, 10, "o")
end
