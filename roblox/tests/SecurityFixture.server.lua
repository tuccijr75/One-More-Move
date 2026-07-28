--!strict

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TestService = game:GetService("TestService")

local root = ReplicatedStorage:WaitForChild("OneMoreMove")
local Simulation = require(root:WaitForChild("Simulation"))

local state = Simulation.newRun(8080, "standard", "SECURITY", 1)
state.player = { x = 5, y = 5 }
state.walls = {}
state.enemies = {}

local acceptedFraction = Simulation.applyCommand(state, { type = "move", dx = 0.5, dy = 0 }, 1)
assert(not acceptedFraction, "fractional movement was accepted")
assert(state.player.x == 5 and state.player.y == 5, "fractional movement mutated player state")

local nan = 0 / 0
local acceptedNaN = Simulation.applyCommand(state, { type = "move", dx = nan, dy = 0 }, 2)
assert(not acceptedNaN, "NaN movement was accepted")
assert(state.player.x == 5 and state.player.y == 5, "NaN movement mutated player state")

local acceptedLarge = Simulation.applyCommand(state, { type = "move", dx = 2, dy = 0 }, 3)
assert(not acceptedLarge, "oversized movement was accepted")
assert(state.player.x == 5 and state.player.y == 5, "oversized movement mutated player state")

TestService:Message("[One More Move] malformed command fixture passed")
