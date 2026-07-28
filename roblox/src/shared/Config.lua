--!strict

local Config = {
	GridSize = 10,
	InitialWalls = 10,
	InitialEnemies = 2,
	InitialSpawnInterval = 10,
	SpawnRampSpeed = 15,
	PortalFirstTurn = 15,
	WallAddEveryStages = 5,
	WallMaximum = 30,
	GlobalCooldownSeconds = 30,
	MinimumReachableTiles = 18,
	MaximumEnemies = 6,

	Difficulty = {
		standard = {
			turnDelay = 0.15,
			showIntent = true,
			spawnFloor = 3,
			chaseWeight = 1,
			interceptWeight = 1,
			trapWeight = 1,
			commitLockTurns = 1,
			squeezeBonus = 2,
		},
		hard = {
			turnDelay = 0.12,
			showIntent = true,
			spawnFloor = 3,
			chaseWeight = 1,
			interceptWeight = 2,
			trapWeight = 2,
			commitLockTurns = 2,
			squeezeBonus = 5,
		},
		hardcore = {
			turnDelay = 0.08,
			showIntent = false,
			spawnFloor = 2,
			chaseWeight = 1,
			interceptWeight = 3,
			trapWeight = 3,
			commitLockTurns = 3,
			squeezeBonus = 9,
		},
	},
}

return table.freeze(Config)
