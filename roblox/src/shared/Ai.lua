--!strict

local Config = require(script.Parent.Config)
local Grid = require(script.Parent.Grid)

export type Position = Grid.Position
export type PositionSet = Grid.PositionSet
export type Enemy = {
	id: number,
	x: number,
	y: number,
	stunned: number,
	intentX: number?,
	intentY: number?,
	intentLock: number,
}

export type StateView = {
	player: Position,
	walls: PositionSet,
	enemies: { Enemy },
	difficulty: string,
	allowDiagonalEscape: boolean,
}

type Proposal = {
	target: Position,
	rank: { number },
	nextEnemy: Enemy,
}

local Ai = {}

local function compareRank(left: { number }, right: { number }): boolean
	for index = 1, math.max(#left, #right) do
		local a = left[index] or 0
		local b = right[index] or 0
		if a ~= b then
			return a < b
		end
	end
	return false
end

local function blockedSet(state: StateView, excludedIndex: number?, hypothetical: Position?): PositionSet
	local blocked = Grid.copySet(state.walls)
	for index, enemy in state.enemies do
		if excludedIndex and index == excludedIndex then
			if hypothetical then
				blocked[Grid.key(hypothetical)] = true
			end
		else
			blocked[Grid.key(enemy)] = true
		end
	end
	return blocked
end

local function interceptTargets(state: StateView): { Position }
	local targets: { Position } = {}
	for _, position in Grid.neighbors(state.player) do
		if Grid.inBounds(position) and not state.walls[Grid.key(position)] then
			table.insert(targets, position)
		end
	end
	return targets
end

local function assignIntercepts(state: StateView): { [number]: Position }
	local targets = interceptTargets(state)
	local available: PositionSet = {}
	local result: { [number]: Position } = {}
	for _, target in targets do
		available[Grid.key(target)] = true
	end

	for index, enemy in state.enemies do
		local blocked = blockedSet(state, index, nil)
		blocked[Grid.key(state.player)] = nil
		local best: Position? = nil
		local bestDistance = math.huge
		for _, target in targets do
			if not available[Grid.key(target)] then
				continue
			end
			local distance = Grid.shortestDistance(enemy, target, blocked)
			if distance < bestDistance then
				best = target
				bestDistance = distance
			end
		end
		if best then
			result[index] = best
			available[Grid.key(best)] = nil
		end
	end
	return result
end

local function proposalFor(state: StateView, index: number, assignments: { [number]: Position }): Proposal
	local enemy = state.enemies[index]
	local config = Config.Difficulty[state.difficulty]
	if enemy.stunned > 0 then
		return {
			target = { x = enemy.x, y = enemy.y },
			rank = { 9, index },
			nextEnemy = { ...enemy, stunned = enemy.stunned - 1, intentX = nil, intentY = nil, intentLock = 0 },
		}
	end

	local candidates: { Position } = {}
	for _, tile in Grid.neighbors(enemy) do
		if Grid.inBounds(tile) and not state.walls[Grid.key(tile)] then
			table.insert(candidates, tile)
		end
	end

	for _, tile in candidates do
		if Grid.same(tile, state.player) then
			return {
				target = tile,
				rank = { -1, index },
				nextEnemy = {
					...enemy,
					x = tile.x,
					y = tile.y,
					intentX = tile.x - enemy.x,
					intentY = tile.y - enemy.y,
					intentLock = config.commitLockTurns,
				},
			}
		end
	end

	if #candidates == 0 then
		return {
			target = { x = enemy.x, y = enemy.y },
			rank = { 8, index },
			nextEnemy = { ...enemy, intentX = nil, intentY = nil, intentLock = 0 },
		}
	end

	local currentBlocked = blockedSet(state, index, nil)
	currentBlocked[Grid.key(state.player)] = nil
	local currentDistance = Grid.shortestDistance(enemy, state.player, currentBlocked)
	local assigned = assignments[index]
	local best: Proposal? = nil

	for _, tile in candidates do
		local blocked = blockedSet(state, index, tile)
		blocked[Grid.key(state.player)] = nil
		local distance = Grid.shortestDistance(tile, state.player, blocked)
		local chaseTier = if distance < currentDistance then 0 elseif distance == currentDistance then 1 else 2
		local enemySet = Grid.enemySet(state.enemies)
		enemySet[Grid.key(enemy)] = nil
		enemySet[Grid.key(tile)] = true
		local escapes = Grid.countEscapes(state.player, state.walls, enemySet, state.allowDiagonalEscape)
		local interceptDistance = if assigned
			then Grid.shortestDistance(tile, assigned, blocked)
			else Grid.shortestDistanceToAny(tile, interceptTargets(state), blocked)
		local dx = tile.x - enemy.x
		local dy = tile.y - enemy.y
		local followsIntent = enemy.intentLock > 0 and enemy.intentX == dx and enemy.intentY == dy
		local pressure = escapes * config.trapWeight
			+ interceptDistance * config.interceptWeight
			- (if escapes <= 1 then config.squeezeBonus else 0)
		local candidate: Proposal = {
			target = tile,
			rank = { chaseTier, distance, pressure, if followsIntent then 0 else 1, tile.y, tile.x, index },
			nextEnemy = {
				...enemy,
				x = tile.x,
				y = tile.y,
				intentX = dx,
				intentY = dy,
				intentLock = config.commitLockTurns,
			},
		}
		if not best or compareRank(candidate.rank, best.rank) then
			best = candidate
		end
	end
	return best :: Proposal
end

local function resolve(state: StateView, proposals: { Proposal }): { Enemy }
	local originOwner: { [string]: number } = {}
	local groups: { [string]: { number } } = {}
	for index, enemy in state.enemies do
		originOwner[Grid.key(enemy)] = index
	end
	for index, proposal in proposals do
		local key = Grid.key(proposal.target)
		groups[key] = groups[key] or {}
		table.insert(groups[key], index)
	end

	local moving: { [number]: boolean } = {}
	for _, indices in groups do
		table.sort(indices, function(left, right)
			return compareRank(proposals[left].rank, proposals[right].rank)
		end)
		local winner = indices[1]
		if not Grid.same(proposals[winner].target, state.enemies[winner]) then
			moving[winner] = true
		end
	end

	local changed = true
	while changed do
		changed = false
		for index in moving do
			local occupant = originOwner[Grid.key(proposals[index].target)]
			if occupant and occupant ~= index and not moving[occupant] then
				moving[index] = nil
				changed = true
			end
		end
	end

	local result: { Enemy } = {}
	local occupied: PositionSet = {}
	for index, enemy in state.enemies do
		local nextEnemy = if moving[index]
			then proposals[index].nextEnemy
			else { ...enemy, intentX = nil, intentY = nil, intentLock = 0 }
		local key = Grid.key(nextEnemy)
		assert(not occupied[key], "duplicate enemy destination")
		occupied[key] = true
		result[index] = nextEnemy
	end
	return result
end

function Ai.plan(state: StateView): { Enemy }
	local assignments = assignIntercepts(state)
	local proposals: { Proposal } = {}
	for index in state.enemies do
		proposals[index] = proposalFor(state, index, assignments)
	end
	return resolve(state, proposals)
end

return table.freeze(Ai)
