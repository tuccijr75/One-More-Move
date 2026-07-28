--!strict

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TestService = game:GetService("TestService")

local root = ReplicatedStorage:WaitForChild("OneMoreMove")
local Grid = require(root:WaitForChild("Grid"))
local Simulation = require(root:WaitForChild("Simulation"))

local expectedWalls = {
	{ x = 5, y = 0 },
	{ x = 6, y = 0 },
	{ x = 1, y = 1 },
	{ x = 6, y = 3 },
	{ x = 1, y = 6 },
	{ x = 2, y = 7 },
	{ x = 6, y = 7 },
	{ x = 9, y = 7 },
	{ x = 7, y = 8 },
	{ x = 5, y = 9 },
}

local expectedEnemies = {
	{ x = 9, y = 9 },
	{ x = 3, y = 0 },
}

local snapshot = Simulation.snapshot(Simulation.newRun(777, "standard", "PARITY", 1))
assert(#snapshot.walls == #expectedWalls, "seed 777 wall count differs from canonical JavaScript")
for index, expected in expectedWalls do
	assert(Grid.same(snapshot.walls[index], expected), string.format("seed 777 wall %d differs", index))
end
assert(#snapshot.enemies == #expectedEnemies, "seed 777 enemy count differs from canonical JavaScript")
for index, expected in expectedEnemies do
	assert(Grid.same(snapshot.enemies[index], expected), string.format("seed 777 enemy %d differs", index))
end

TestService:Message("[One More Move] JavaScript/Luau seed 777 fixture passed")
