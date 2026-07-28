--!strict

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local root = ReplicatedStorage:WaitForChild("OneMoreMove")
local Simulation = require(root:WaitForChild("Simulation"))

local remotes = root:FindFirstChild("Remotes")
if not remotes then
	remotes = Instance.new("Folder")
	remotes.Name = "Remotes"
	remotes.Parent = root
end

local commandRemote = remotes:FindFirstChild("Command") :: RemoteEvent?
if not commandRemote then
	commandRemote = Instance.new("RemoteEvent")
	commandRemote.Name = "Command"
	commandRemote.Parent = remotes
end

local stateRemote = remotes:FindFirstChild("State") :: RemoteEvent?
if not stateRemote then
	stateRemote = Instance.new("RemoteEvent")
	stateRemote.Name = "State"
	stateRemote.Parent = remotes
end

local sessions: { [Player]: Simulation.State } = {}
local runSequences: { [Player]: number } = {}
local lastCommandAt: { [Player]: number } = {}
local minimumCommandInterval = 0.04

local function nextRunId(player: Player): number
	local nextValue = (runSequences[player] or 0) + 1
	runSequences[player] = nextValue
	return nextValue
end

local function randomSeed(player: Player): number
	local timePart = DateTime.now().UnixTimestampMillis % 4294967296
	return bit32.bxor(timePart, player.UserId % 4294967296)
end

local function dailySeed(): number
	return math.floor(DateTime.now().UnixTimestamp / 86400)
end

local function sendState(player: Player, message: string?)
	local state = sessions[player]
	if not state then
		return
	end
	stateRemote:FireClient(player, Simulation.snapshot(state), message)
end

local function startRun(player: Player, mode: string, requestedDifficulty: unknown, requestedSeed: unknown)
	local previous = sessions[player]
	local difficulty = if typeof(requestedDifficulty) == "string" then requestedDifficulty else "standard"
	if difficulty ~= "standard" and difficulty ~= "hard" and difficulty ~= "hardcore" then
		difficulty = "standard"
	end

	local seed: number
	if mode == "daily" then
		seed = dailySeed()
	elseif mode == "replay" and previous then
		seed = previous.seed
	elseif mode == "manual" and typeof(requestedSeed) == "number" then
		seed = math.floor(requestedSeed) % 4294967296
	else
		mode = "new"
		seed = randomSeed(player)
	end

	sessions[player] = Simulation.newRun(seed, difficulty :: Simulation.Difficulty, string.upper(mode), nextRunId(player))
	sendState(player)
end

local function commandAllowed(player: Player): boolean
	local now = workspace:GetServerTimeNow()
	local previous = lastCommandAt[player] or 0
	if now - previous < minimumCommandInterval then
		return false
	end
	lastCommandAt[player] = now
	return true
end

commandRemote.OnServerEvent:Connect(function(player: Player, payload: unknown)
	if not commandAllowed(player) or typeof(payload) ~= "table" then
		return
	end

	local data = payload :: { [string]: any }
	if data.type == "start" then
		startRun(player, tostring(data.mode or "new"), data.difficulty, data.seed)
		return
	end

	local state = sessions[player]
	if not state then
		startRun(player, "new", "standard", nil)
		return
	end
	if data.runId ~= state.runId or data.expectedTurn ~= state.turns then
		sendState(player, "State resynchronized")
		return
	end

	local command: Simulation.Command
	if data.type == "move" then
		command = {
			type = "move",
			dx = data.dx,
			dy = data.dy,
		}
	elseif data.type == "ability" then
		command = {
			type = "ability",
			ability = data.ability,
		}
	elseif data.type == "endTimeFreeze" then
		command = { type = "endTimeFreeze" }
	else
		return
	end

	local accepted, reason = Simulation.applyCommand(state, command, workspace:GetServerTimeNow())
	sendState(player, if accepted then nil else reason)
end)

Players.PlayerAdded:Connect(function(player)
	startRun(player, "new", "standard", nil)
end)

Players.PlayerRemoving:Connect(function(player)
	sessions[player] = nil
	runSequences[player] = nil
	lastCommandAt[player] = nil
end)

for _, player in Players:GetPlayers() do
	task.spawn(startRun, player, "new", "standard", nil)
end
