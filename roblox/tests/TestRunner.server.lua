--!strict

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TestService = game:GetService("TestService")

local root = ReplicatedStorage:WaitForChild("OneMoreMove")
local Ai = require(root:WaitForChild("Ai"))
local Grid = require(root:WaitForChild("Grid"))
local Rng = require(root:WaitForChild("Rng"))
local Simulation = require(root:WaitForChild("Simulation"))

local function expect(condition: boolean, message: string)
	if not condition then
		error(message, 2)
	end
end

local function close(left: number, right: number, tolerance: number?): boolean
	return math.abs(left - right) <= (tolerance or 1e-12)
end

local function testRngParity()
	local expected = {
		0.9797282677609473,
		0.3067522644996643,
		0.484205421525985,
		0.817934412509203,
		0.5094283693470061,
		0.34747186047025025,
		0.07375754183158278,
		0.7663964673411101,
		0.9968264393974096,
		0.8250224851071835,
	}
	local generator = Rng.new(12345)
	for index, value in expected do
		expect(close(generator:NextNumber(), value), string.format("RNG parity failed at value %d", index))
	end
end

local function testSeedDeterminism()
	local left = Simulation.snapshot(Simulation.newRun(777, "standard", "TEST", 1))
	local right = Simulation.snapshot(Simulation.newRun(777, "standard", "TEST", 1))
	expect(#left.walls == #right.walls, "wall counts differ for the same seed")
	for index, wall in left.walls do
		expect(Grid.same(wall, right.walls[index]), "wall layout differs for the same seed")
	end
	for index, enemy in left.enemies do
		expect(Grid.same(enemy, right.enemies[index]), "enemy spawn differs for the same seed")
	end
end

local function testKillPriority()
	local result = Ai.plan({
		player = { x = 5, y = 5 },
		walls = {},
		enemies = {
			{ id = 0, x = 5, y = 4, stunned = 0, intentX = 1, intentY = 0, intentLock = 3 },
			{ id = 1, x = 4, y = 4, stunned = 0, intentX = nil, intentY = nil, intentLock = 0 },
		},
		difficulty = "hardcore",
		allowDiagonalEscape = false,
	})
	expect(result[1].x == 5 and result[1].y == 5, "intent lock overrode an available kill")
end

local function testInvalidDiagonalPreservesReward()
	local state = Simulation.newRun(11, "standard", "TEST", 1)
	state.player = { x = 0, y = 0 }
	state.walls = {}
	state.enemies = {}
	state.tokens.diag = 1
	local accepted = Simulation.applyCommand(state, { type = "move", dx = -1, dy = -1 }, 1)
	expect(not accepted, "out-of-bounds diagonal was accepted")
	expect(state.tokens.diag == 1, "invalid diagonal consumed its reward")
	expect(state.cooldownUntil == 0, "invalid diagonal started the global cooldown")
end

local function testFreezeFinalization()
	local state = Simulation.newRun(12, "standard", "TEST", 1)
	state.player = { x = 5, y = 5 }
	state.walls = {}
	state.enemies = {
		{ id = 0, x = 0, y = 0, stunned = 0, intentX = nil, intentY = nil, intentLock = 0 },
	}
	state.tokens.freeze = 1
	local armed = Simulation.applyCommand(state, { type = "ability", ability = "freeze" }, 1)
	expect(armed, "Freeze Turn could not be armed")
	local moved = Simulation.applyCommand(state, { type = "move", dx = 1, dy = 0 }, 2)
	expect(moved, "move after Freeze Turn was rejected")
	expect(state.turns == 1, "Freeze Turn did not finalize the turn")
	expect(state.enemies[1].x == 0 and state.enemies[1].y == 0, "enemy moved during Freeze Turn")
end

local function testExtraLifeContinuity()
	local state = Simulation.newRun(13, "standard", "TEST", 1)
	state.player = { x = 5, y = 5 }
	state.walls = {}
	state.enemies = {
		{ id = 0, x = 6, y = 4, stunned = 0, intentX = nil, intentY = nil, intentLock = 0 },
	}
	state.hasExtraLife = true
	local moved = Simulation.applyCommand(state, { type = "move", dx = 1, dy = 0 }, 1)
	expect(moved, "revival setup move was rejected")
	expect(not state.gameOver, "extra life failed to prevent game over")
	expect(not state.hasExtraLife, "extra life was not consumed")
	expect(not (state.player.x == 6 and state.player.y == 5), "player remained on the killer tile")
	local escapes = Grid.countEscapes(state.player, state.walls, Grid.enemySet(state.enemies), false)
	expect(escapes >= 2, "revival tile did not preserve two escapes")
end

local function testStageAdvance()
	local state = Simulation.newRun(14, "standard", "TEST", 1)
	state.player = { x = 5, y = 5 }
	state.walls = {}
	state.enemies = {}
	state.portal = { x = 6, y = 5 }
	state.turns = 20
	local moved = Simulation.applyCommand(state, { type = "move", dx = 1, dy = 0 }, 1)
	expect(moved, "portal move was rejected")
	expect(state.stage == 2, "portal did not advance the stage")
	expect(state.portal == nil, "portal persisted after stage advance")
	expect(state.nextSpawnTurn > state.turns, "stage spawn timing was not reset relatively")
end

local function testCollisionStress()
	local generator = Rng.new(9001)
	for iteration = 1, 1000 do
		local player = { x = generator:NextInteger(10), y = generator:NextInteger(10) }
		local occupied = { [Grid.key(player)] = true }
		local enemies = {}
		for id = 0, 5 do
			local tile
			repeat
				tile = { x = generator:NextInteger(10), y = generator:NextInteger(10) }
			until not occupied[Grid.key(tile)]
			occupied[Grid.key(tile)] = true
			table.insert(enemies, {
				id = id,
				x = tile.x,
				y = tile.y,
				stunned = 0,
				intentX = nil,
				intentY = nil,
				intentLock = 0,
			})
		end
		local result = Ai.plan({
			player = player,
			walls = {},
			enemies = enemies,
			difficulty = if iteration % 3 == 0 then "hardcore" elseif iteration % 2 == 0 then "hard" else "standard",
			allowDiagonalEscape = iteration % 2 == 0,
		})
		local destinations = {}
		for _, enemy in result do
			local key = Grid.key(enemy)
			expect(not destinations[key], string.format("duplicate enemy at stress iteration %d", iteration))
			destinations[key] = true
		end
	end
end

local tests = {
	RngParity = testRngParity,
	SeedDeterminism = testSeedDeterminism,
	KillPriority = testKillPriority,
	InvalidDiagonal = testInvalidDiagonalPreservesReward,
	FreezeFinalization = testFreezeFinalization,
	ExtraLife = testExtraLifeContinuity,
	StageAdvance = testStageAdvance,
	CollisionStress = testCollisionStress,
}

local passed = 0
for name, test in tests do
	local success, message = pcall(test)
	if not success then
		TestService:Error(string.format("[One More Move] %s failed: %s", name, tostring(message)))
		error(message)
	end
	passed += 1
	TestService:Message(string.format("[One More Move] %s passed", name))
end

TestService:Message(string.format("[One More Move] %d deterministic tests passed", passed))
