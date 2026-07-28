--!strict

local Config = require(script.Parent.Config)
local Rng = require(script.Parent.Rng)

export type Position = { x: number, y: number }
export type PositionSet = { [string]: boolean }
export type EnemyLike = { x: number, y: number }

local Grid = {}

function Grid.key(position: Position): string
	return string.format("%d,%d", position.x, position.y)
end

function Grid.fromKey(key: string): Position
	local xText, yText = string.match(key, "^(-?%d+),(-?%d+)$")
	assert(xText ~= nil and yText ~= nil, "invalid position key")
	return {
		x = tonumber(xText) :: number,
		y = tonumber(yText) :: number,
	}
end

function Grid.same(left: Position, right: Position): boolean
	return left.x == right.x and left.y == right.y
end

function Grid.inBounds(position: Position): boolean
	return position.x >= 0
		and position.x < Config.GridSize
		and position.y >= 0
		and position.y < Config.GridSize
end

function Grid.manhattan(left: Position, right: Position): number
	return math.abs(left.x - right.x) + math.abs(left.y - right.y)
end

function Grid.neighbors(position: Position): { Position }
	return {
		{ x = position.x, y = position.y - 1 },
		{ x = position.x - 1, y = position.y },
		{ x = position.x + 1, y = position.y },
		{ x = position.x, y = position.y + 1 },
	}
end

function Grid.copySet(source: PositionSet): PositionSet
	local result: PositionSet = {}
	for key, value in source do
		if value then
			result[key] = true
		end
	end
	return result
end

function Grid.enemySet(enemies: { EnemyLike }): PositionSet
	local result: PositionSet = {}
	for _, enemy in enemies do
		result[Grid.key(enemy)] = true
	end
	return result
end

function Grid.reachableOrdered(start: Position, blocked: PositionSet): ({ Position }, PositionSet)
	local visited: PositionSet = { [Grid.key(start)] = true }
	local queue: { Position } = { start }
	local cursor = 1

	while cursor <= #queue do
		local current = queue[cursor]
		cursor += 1
		for _, candidate in Grid.neighbors(current) do
			if not Grid.inBounds(candidate) then
				continue
			end
			local key = Grid.key(candidate)
			if blocked[key] or visited[key] then
				continue
			end
			visited[key] = true
			table.insert(queue, candidate)
		end
	end

	return queue, visited
end

function Grid.reachable(start: Position, blocked: PositionSet): PositionSet
	local _, visited = Grid.reachableOrdered(start, blocked)
	return visited
end

function Grid.shortestDistance(from: Position, to: Position, blocked: PositionSet): number
	if Grid.same(from, to) then
		return 0
	end

	local targetKey = Grid.key(to)
	local visited: PositionSet = { [Grid.key(from)] = true }
	local queue: { { position: Position, distance: number } } = {
		{ position = from, distance = 0 },
	}
	local cursor = 1

	while cursor <= #queue do
		local item = queue[cursor]
		cursor += 1
		for _, candidate in Grid.neighbors(item.position) do
			if not Grid.inBounds(candidate) then
				continue
			end
			local key = Grid.key(candidate)
			if visited[key] then
				continue
			end
			if key == targetKey then
				return item.distance + 1
			end
			if blocked[key] then
				continue
			end
			visited[key] = true
			table.insert(queue, {
				position = candidate,
				distance = item.distance + 1,
			})
		end
	end

	return math.huge
end

function Grid.shortestDistanceToAny(from: Position, targets: { Position }, blocked: PositionSet): number
	if #targets == 0 then
		return math.huge
	end

	local targetKeys: PositionSet = {}
	for _, target in targets do
		targetKeys[Grid.key(target)] = true
	end

	local visited: PositionSet = { [Grid.key(from)] = true }
	local queue: { { position: Position, distance: number } } = {
		{ position = from, distance = 0 },
	}
	local cursor = 1

	while cursor <= #queue do
		local item = queue[cursor]
		cursor += 1
		if targetKeys[Grid.key(item.position)] then
			return item.distance
		end
		for _, candidate in Grid.neighbors(item.position) do
			if not Grid.inBounds(candidate) then
				continue
			end
			local key = Grid.key(candidate)
			if blocked[key] or visited[key] then
				continue
			end
			visited[key] = true
			table.insert(queue, {
				position = candidate,
				distance = item.distance + 1,
			})
		end
	end

	return math.huge
end

function Grid.countEscapes(
	position: Position,
	walls: PositionSet,
	enemies: PositionSet,
	allowDiagonal: boolean
): number
	local count = 0
	for _, candidate in Grid.neighbors(position) do
		if not Grid.inBounds(candidate) then
			continue
		end
		local key = Grid.key(candidate)
		if not walls[key] and not enemies[key] then
			count += 1
		end
	end

	if not allowDiagonal then
		return count
	end

	local diagonals = {
		{ x = position.x - 1, y = position.y - 1 },
		{ x = position.x + 1, y = position.y - 1 },
		{ x = position.x - 1, y = position.y + 1 },
		{ x = position.x + 1, y = position.y + 1 },
	}

	for _, candidate in diagonals do
		if not Grid.inBounds(candidate) then
			continue
		end
		local key = Grid.key(candidate)
		if walls[key] or enemies[key] then
			continue
		end
		local horizontal = Grid.key({ x = candidate.x, y = position.y })
		local vertical = Grid.key({ x = position.x, y = candidate.y })
		if not walls[horizontal] and not walls[vertical] then
			count += 1
		end
	end

	return count
end

function Grid.buildWalls(
	generator: Rng.Generator,
	player: Position,
	enemies: { EnemyLike },
	portal: Position?,
	count: number,
	fallback: PositionSet?
): PositionSet
	local avoid: PositionSet = { [Grid.key(player)] = true }
	for _, enemy in enemies do
		avoid[Grid.key(enemy)] = true
	end
	if portal then
		avoid[Grid.key(portal)] = true
	end

	local passable = Config.GridSize * Config.GridSize - count
	local minimumReachable = math.max(Config.MinimumReachableTiles, math.floor(passable * 0.5))

	for _ = 1, 400 do
		local walls: PositionSet = {}
		local wallCount = 0
		while wallCount < count do
			local position = {
				x = generator:NextInteger(Config.GridSize),
				y = generator:NextInteger(Config.GridSize),
			}
			local key = Grid.key(position)
			if not avoid[key] and not walls[key] then
				walls[key] = true
				wallCount += 1
			end
		end

		local ordered = Grid.reachableOrdered(player, walls)
		if #ordered >= minimumReachable and Grid.countEscapes(player, walls, {}, false) >= 2 then
			return walls
		end
	end

	return fallback and Grid.copySet(fallback) or {}
end

return table.freeze(Grid)
