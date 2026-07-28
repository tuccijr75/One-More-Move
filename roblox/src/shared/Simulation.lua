--!strict

local Ai = require(script.Parent.Ai)
local Config = require(script.Parent.Config)
local Grid = require(script.Parent.Grid)
local Rng = require(script.Parent.Rng)

export type Difficulty = "standard" | "hard" | "hardcore"
export type Position = Grid.Position
export type PositionSet = Grid.PositionSet
export type Enemy = Ai.Enemy

export type Tokens = {
	diag: number,
	wall: number,
	freeze: number,
	timeFreeze: number,
}

export type State = {
	runId: number,
	seed: number,
	mode: string,
	difficulty: Difficulty,
	rng: Rng.Generator,
	player: Position,
	playerTrail: { string },
	walls: PositionSet,
	wallCount: number,
	enemies: { Enemy },
	nextEnemyId: number,
	turns: number,
	stage: number,
	portal: Position?,
	nextPortalTurn: number,
	nextSpawnTurn: number,
	gameOver: boolean,
	deathCause: string?,
	hasExtraLife: boolean,
	tokens: Tokens,
	phaseUsed: boolean,
	phaseArmed: boolean,
	wallIgnoreArmed: boolean,
	freezeNext: boolean,
	timeFreezeMovesRemaining: number,
	cooldownUntil: number,
}

export type Command = {
	type: string,
	dx: number?,
	dy: number?,
	ability: string?,
}

local Simulation = {}

local function enemyCountForStage(stage: number): number
	if stage <= 5 then
		return 2
	elseif stage <= 10 then
		return 3
	elseif stage <= 15 then
		return 4
	elseif stage <= 20 then
		return 5
	end
	return Config.MaximumEnemies
end

local function safeSpawnTiles(state: State): { Position }
	local result: { Position } = {}
	local enemies = Grid.enemySet(state.enemies)
	for y = 0, Config.GridSize - 1 do
		for x = 0, Config.GridSize - 1 do
			local tile = { x = x, y = y }
			local edge = x == 0 or y == 0 or x == Config.GridSize - 1 or y == Config.GridSize - 1
			local key = Grid.key(tile)
			if not edge or state.walls[key] or enemies[key] or Grid.same(tile, state.player) then
				continue
			end
			if Grid.manhattan(tile, state.player) <= 1 then
				continue
			end
			local hypothetical = Grid.copySet(enemies)
			hypothetical[key] = true
			if Grid.countEscapes(state.player, state.walls, hypothetical, state.tokens.diag > 0) >= 2 then
				table.insert(result, tile)
			end
		end
	end
	return result
end

local function spawnEnemy(state: State): boolean
	local candidates = safeSpawnTiles(state)
	if #candidates == 0 then
		return false
	end
	local tile = candidates[state.rng:NextInteger(#candidates) + 1]
	local id = state.nextEnemyId
	state.nextEnemyId += 1
	table.insert(state.enemies, {
		id = id,
		x = tile.x,
		y = tile.y,
		stunned = 0,
		intentX = nil,
		intentY = nil,
		intentLock = 0,
	})
	return true
end

local function nextPortalTurn(stage: number, currentTurn: number): number
	local adjustment = math.min(5, math.floor(math.max(0, stage - 1) / 5))
	return currentTurn + math.max(10, Config.PortalFirstTurn - adjustment)
end

local function chooseRevivalTile(state: State): Position?
	local reachable = Grid.reachable(state.player, state.walls)
	local enemies = Grid.enemySet(state.enemies)
	local best: Position? = nil
	local bestDistance = -1
	local bestEscapes = -1
	for key in reachable do
		if enemies[key] then
			continue
		end
		local tile = Grid.fromKey(key)
		local escapes = Grid.countEscapes(tile, state.walls, enemies, false)
		if escapes < 2 then
			continue
		end
		local minimumDistance = Config.GridSize * 2
		for _, enemy in state.enemies do
			minimumDistance = math.min(minimumDistance, Grid.manhattan(enemy, tile))
		end
		if minimumDistance > bestDistance or (minimumDistance == bestDistance and escapes > bestEscapes) then
			best = tile
			bestDistance = minimumDistance
			bestEscapes = escapes
		end
	end
	return best
end

local function handleDeath(state: State, cause: string): boolean
	if state.hasExtraLife then
		local revival = chooseRevivalTile(state)
		if revival then
			state.hasExtraLife = false
			state.player = revival
			table.insert(state.playerTrail, 1, Grid.key(revival))
			if #state.playerTrail > 2 then
				table.remove(state.playerTrail)
			end
			return false
		end
	end
	state.gameOver = true
	state.deathCause = cause
	return true
end

local function spawnPortal(state: State)
	if state.portal or state.turns < state.nextPortalTurn then
		return
	end
	local reachable = Grid.reachable(state.player, state.walls)
	local enemies = Grid.enemySet(state.enemies)
	local candidates: { Position } = {}
	for key in reachable do
		if not enemies[key] then
			local tile = Grid.fromKey(key)
			if not Grid.same(tile, state.player) then
				table.insert(candidates, tile)
			end
		end
	end
	if #candidates == 0 then
		state.nextPortalTurn += 1
		return
	end
	state.portal = candidates[state.rng:NextInteger(#candidates) + 1]
end

local function grantRewards(state: State)
	if state.turns > 0 and state.turns % 12 == 0 then
		local rewardIndex = math.floor(state.turns / 12) % 3
		if rewardIndex == 0 and state.tokens.diag == 0 then
			state.tokens.diag = 1
		elseif rewardIndex == 1 and state.tokens.wall == 0 then
			state.tokens.wall = 1
		elseif rewardIndex == 2 and state.tokens.freeze == 0 then
			state.tokens.freeze = 1
		end
	end
	if state.turns > 0 and state.turns % 50 == 0 and state.tokens.timeFreeze == 0 then
		state.tokens.timeFreeze = 1
	end
end

local function finalizeTurn(state: State)
	state.turns += 1
	spawnPortal(state)
	grantRewards(state)
	if state.turns >= state.nextSpawnTurn then
		if #state.enemies < enemyCountForStage(state.stage) then
			spawnEnemy(state)
		end
		local floor = Config.Difficulty[state.difficulty].spawnFloor
		local interval = math.max(floor, math.floor(Config.SpawnRampSpeed - state.turns / Config.SpawnRampSpeed))
		state.nextSpawnTurn += math.max(1, interval)
	end
end

local function resolveEnemyTurn(state: State)
	if state.freezeNext then
		state.freezeNext = false
		finalizeTurn(state)
		return
	end

	state.enemies = Ai.plan({
		player = state.player,
		walls = state.walls,
		enemies = state.enemies,
		difficulty = state.difficulty,
		allowDiagonalEscape = state.tokens.diag > 0,
	})
	for _, enemy in state.enemies do
		if enemy.stunned == 0 and Grid.same(enemy, state.player) then
			if handleDeath(state, "Intercepted.") then
				return
			end
			break
		end
	end
	local enemies = Grid.enemySet(state.enemies)
	if Grid.countEscapes(state.player, state.walls, enemies, state.tokens.diag > 0) == 0 then
		if handleDeath(state, "No escape.") then
			return
		end
	end
	finalizeTurn(state)
end

local function advanceStage(state: State)
	state.stage += 1
	state.portal = nil
	state.nextPortalTurn = nextPortalTurn(state.stage, state.turns)
	state.enemies = {}
	if state.stage % Config.WallAddEveryStages == 0 then
		state.wallCount = math.min(Config.WallMaximum, state.wallCount + 1)
	end
	state.walls = Grid.buildWalls(state.rng, state.player, {}, nil, state.wallCount, state.walls)
	for _ = 1, enemyCountForStage(state.stage) do
		spawnEnemy(state)
	end
	state.nextSpawnTurn = state.turns + Config.InitialSpawnInterval
	if state.stage % 15 == 0 and not state.hasExtraLife then
		state.hasExtraLife = true
	end
end

local function completeMove(state: State)
	if state.portal and Grid.same(state.player, state.portal) then
		advanceStage(state)
		return
	end
	if state.timeFreezeMovesRemaining > 0 then
		state.timeFreezeMovesRemaining -= 1
		if state.timeFreezeMovesRemaining == 0 then
			resolveEnemyTurn(state)
		end
		return
	end
	resolveEnemyTurn(state)
end

local function move(state: State, dx: number, dy: number, now: number): (boolean, string?)
	if state.gameOver then
		return false, "game over"
	end
	if dx == 0 and dy == 0 or math.abs(dx) > 1 or math.abs(dy) > 1 then
		return false, "invalid direction"
	end

	if state.phaseArmed then
		if dx ~= 0 and dy ~= 0 then
			return false, "phase requires cardinal movement"
		end
		local first = { x = state.player.x + dx, y = state.player.y + dy }
		local second = { x = first.x + dx, y = first.y + dy }
		if not Grid.inBounds(first) or not Grid.inBounds(second) then
			return false, "phase out of bounds"
		end
		if state.walls[Grid.key(first)] or state.walls[Grid.key(second)] then
			return false, "phase blocked"
		end
		for _, enemy in state.enemies do
			if Grid.same(enemy, second) then
				return false, "phase destination occupied"
			elseif Grid.same(enemy, first) then
				enemy.stunned = math.max(enemy.stunned, 1)
			end
		end
		state.phaseArmed = false
		state.phaseUsed = true
		state.player = second
		completeMove(state)
		return true, nil
	end

	local diagonal = dx ~= 0 and dy ~= 0
	if diagonal and state.tokens.diag <= 0 then
		return false, "diagonal unavailable"
	end
	local destination = { x = state.player.x + dx, y = state.player.y + dy }
	if not Grid.inBounds(destination) then
		return false, "out of bounds"
	end
	if diagonal then
		local horizontal = Grid.key({ x = destination.x, y = state.player.y })
		local vertical = Grid.key({ x = state.player.x, y = destination.y })
		if state.walls[horizontal] or state.walls[vertical] then
			return false, "corner blocked"
		end
	end
	local destinationKey = Grid.key(destination)
	local usesWallIgnore = state.walls[destinationKey] and state.wallIgnoreArmed
	if state.walls[destinationKey] and not usesWallIgnore then
		return false, "wall blocked"
	end

	if diagonal then
		state.tokens.diag = 0
		state.cooldownUntil = now + Config.GlobalCooldownSeconds
	end
	if usesWallIgnore then
		state.wallIgnoreArmed = false
	end
	state.player = destination
	table.insert(state.playerTrail, 1, destinationKey)
	if #state.playerTrail > 2 then
		table.remove(state.playerTrail)
	end
	for _, enemy in state.enemies do
		if Grid.same(enemy, destination) then
			handleDeath(state, "Intercepted.")
			return true, nil
		end
	end
	completeMove(state)
	return true, nil
end

local function activate(state: State, ability: string, now: number): (boolean, string?)
	if state.gameOver or now < state.cooldownUntil then
		return false, if state.gameOver then "game over" else "ability cooldown"
	end
	if ability == "wall" and state.tokens.wall > 0 and not state.wallIgnoreArmed then
		state.tokens.wall = 0
		state.wallIgnoreArmed = true
	elseif ability == "freeze" and state.tokens.freeze > 0 and not state.freezeNext then
		state.tokens.freeze = 0
		state.freezeNext = true
	elseif ability == "phase" and not state.phaseUsed and not state.phaseArmed then
		state.phaseArmed = true
	elseif ability == "time" and state.tokens.timeFreeze > 0 and state.timeFreezeMovesRemaining == 0 then
		state.tokens.timeFreeze = 0
		state.timeFreezeMovesRemaining = 2
	else
		return false, "ability unavailable"
	end
	state.cooldownUntil = now + Config.GlobalCooldownSeconds
	return true, nil
end

function Simulation.newRun(seed: number, difficulty: Difficulty, mode: string, runId: number): State
	assert(Config.Difficulty[difficulty] ~= nil, "invalid difficulty")
	local state: State = {
		runId = runId,
		seed = seed % 4294967296,
		mode = mode,
		difficulty = difficulty,
		rng = Rng.new(seed),
		player = { x = 5, y = 5 },
		playerTrail = {},
		walls = {},
		wallCount = Config.InitialWalls,
		enemies = {},
		nextEnemyId = 0,
		turns = 0,
		stage = 1,
		portal = nil,
		nextPortalTurn = Config.PortalFirstTurn,
		nextSpawnTurn = Config.InitialSpawnInterval,
		gameOver = false,
		deathCause = nil,
		hasExtraLife = false,
		tokens = { diag = 0, wall = 0, freeze = 0, timeFreeze = 0 },
		phaseUsed = false,
		phaseArmed = false,
		wallIgnoreArmed = false,
		freezeNext = false,
		timeFreezeMovesRemaining = 0,
		cooldownUntil = 0,
	}
	state.walls = Grid.buildWalls(state.rng, state.player, {}, nil, state.wallCount, nil)
	for _ = 1, Config.InitialEnemies do
		spawnEnemy(state)
	end
	return state
end

function Simulation.applyCommand(state: State, command: Command, now: number): (boolean, string?)
	if command.type == "move" and typeof(command.dx) == "number" and typeof(command.dy) == "number" then
		return move(state, command.dx :: number, command.dy :: number, now)
	elseif command.type == "ability" and typeof(command.ability) == "string" then
		return activate(state, command.ability :: string, now)
	elseif command.type == "endTimeFreeze" and state.timeFreezeMovesRemaining > 0 then
		state.timeFreezeMovesRemaining = 0
		resolveEnemyTurn(state)
		return true, nil
	end
	return false, "invalid command"
end

function Simulation.snapshot(state: State): any
	local walls: { Position } = {}
	for key in state.walls do
		table.insert(walls, Grid.fromKey(key))
	end
	table.sort(walls, function(left, right)
		return left.y < right.y or (left.y == right.y and left.x < right.x)
	end)
	local enemies = table.clone(state.enemies)
	return {
		runId = state.runId,
		seed = state.seed,
		mode = state.mode,
		difficulty = state.difficulty,
		player = { x = state.player.x, y = state.player.y },
		walls = walls,
		enemies = enemies,
		turns = state.turns,
		stage = state.stage,
		portal = if state.portal then { x = state.portal.x, y = state.portal.y } else nil,
		gameOver = state.gameOver,
		deathCause = state.deathCause,
		hasExtraLife = state.hasExtraLife,
		tokens = table.clone(state.tokens),
		phaseAvailable = not state.phaseUsed,
		phaseArmed = state.phaseArmed,
		wallIgnoreArmed = state.wallIgnoreArmed,
		freezeNext = state.freezeNext,
		timeFreezeMovesRemaining = state.timeFreezeMovesRemaining,
		cooldownUntil = state.cooldownUntil,
	}
end

return table.freeze(Simulation)
