--!strict

local ContextActionService = game:GetService("ContextActionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")
local rootModules = ReplicatedStorage:WaitForChild("OneMoreMove")
local Config = require(rootModules:WaitForChild("Config"))
local remotes = rootModules:WaitForChild("Remotes")
local commandRemote = remotes:WaitForChild("Command") :: RemoteEvent
local stateRemote = remotes:WaitForChild("State") :: RemoteEvent

local currentState: any = nil
local selectedDifficulty = "standard"
local cells: { Frame } = {}
local abilityButtons: { [string]: TextButton } = {}

local colors = {
	background = Color3.fromRGB(8, 11, 14),
	panel = Color3.fromRGB(15, 28, 37),
	border = Color3.fromRGB(71, 132, 165),
	text = Color3.fromRGB(234, 246, 255),
	muted = Color3.fromRGB(155, 180, 195),
	floor = Color3.fromRGB(7, 7, 8),
	wall = Color3.fromRGB(90, 90, 90),
	player = Color3.fromRGB(58, 123, 213),
	enemy = Color3.fromRGB(196, 54, 54),
	stunned = Color3.fromRGB(106, 174, 255),
	portal = Color3.fromRGB(2, 2, 2),
}

local function rounded(instance: GuiObject, radius: number)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, radius)
	corner.Parent = instance
end

local function stroke(instance: GuiObject, color: Color3?, thickness: number?)
	local outline = Instance.new("UIStroke")
	outline.Color = color or colors.border
	outline.Thickness = thickness or 1
	outline.Parent = instance
	return outline
end

local function button(parent: Instance, text: string): TextButton
	local result = Instance.new("TextButton")
	result.AutoButtonColor = true
	result.BackgroundColor3 = Color3.fromRGB(22, 52, 70)
	result.BorderSizePixel = 0
	result.Font = Enum.Font.GothamBold
	result.Text = text
	result.TextColor3 = colors.text
	result.TextScaled = true
	result.Parent = parent
	rounded(result, 6)
	stroke(result)
	local padding = Instance.new("UIPadding")
	padding.PaddingLeft = UDim.new(0, 5)
	padding.PaddingRight = UDim.new(0, 5)
	padding.Parent = result
	return result
end

local screen = Instance.new("ScreenGui")
screen.Name = "OneMoreMove"
screen.ResetOnSpawn = false
screen.IgnoreGuiInset = false
screen.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
screen.Parent = playerGui

local shell = Instance.new("Frame")
shell.Name = "Shell"
shell.AnchorPoint = Vector2.new(0.5, 0.5)
shell.Position = UDim2.fromScale(0.5, 0.5)
shell.Size = UDim2.fromScale(0.96, 0.96)
shell.BackgroundColor3 = colors.background
shell.BorderSizePixel = 0
shell.Parent = screen

local shellSize = Instance.new("UISizeConstraint")
shellSize.MaxSize = Vector2.new(760, 980)
shellSize.MinSize = Vector2.new(300, 500)
shellSize.Parent = shell

local shellLayout = Instance.new("UIListLayout")
shellLayout.FillDirection = Enum.FillDirection.Vertical
shellLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
shellLayout.Padding = UDim.new(0, 8)
shellLayout.Parent = shell

local hud = Instance.new("Frame")
hud.Name = "HUD"
hud.Size = UDim2.new(1, 0, 0, 72)
hud.BackgroundColor3 = colors.panel
hud.BorderSizePixel = 0
hud.Parent = shell
stroke(hud)

local title = Instance.new("TextLabel")
title.BackgroundTransparency = 1
title.Position = UDim2.new(0, 10, 0, 7)
title.Size = UDim2.new(0.25, -10, 1, -14)
title.Font = Enum.Font.GothamBlack
title.Text = "ONE MORE\nMOVE"
title.TextColor3 = colors.text
title.TextScaled = true
title.Parent = hud

local meta = Instance.new("TextLabel")
meta.BackgroundTransparency = 1
meta.Position = UDim2.new(0.25, 5, 0, 7)
meta.Size = UDim2.new(0.75, -15, 1, -14)
meta.Font = Enum.Font.RobotoMono
meta.Text = "CONNECTING"
meta.TextColor3 = colors.muted
meta.TextScaled = true
meta.TextXAlignment = Enum.TextXAlignment.Right
meta.Parent = hud

local status = Instance.new("TextLabel")
status.Name = "Status"
status.Size = UDim2.new(1, 0, 0, 28)
status.BackgroundColor3 = Color3.fromRGB(11, 22, 30)
status.BorderSizePixel = 0
status.Font = Enum.Font.GothamMedium
status.Text = "Waiting for server state"
status.TextColor3 = colors.muted
status.TextScaled = true
status.Parent = shell
stroke(status)

local boardHolder = Instance.new("Frame")
boardHolder.Name = "BoardHolder"
boardHolder.Size = UDim2.new(1, 0, 1, -292)
boardHolder.BackgroundTransparency = 1
boardHolder.Parent = shell

local aspect = Instance.new("UIAspectRatioConstraint")
aspect.AspectRatio = 1
aspect.DominantAxis = Enum.DominantAxis.Width
aspect.Parent = boardHolder

local board = Instance.new("Frame")
board.Name = "Board"
board.Size = UDim2.fromScale(1, 1)
board.BackgroundColor3 = Color3.new(0, 0, 0)
board.BorderSizePixel = 0
board.Parent = boardHolder
stroke(board, Color3.fromRGB(32, 32, 34), 2)

local grid = Instance.new("UIGridLayout")
grid.CellPadding = UDim2.fromScale(0.006, 0.006)
grid.CellSize = UDim2.fromScale(0.0946, 0.0946)
grid.FillDirectionMaxCells = Config.GridSize
grid.SortOrder = Enum.SortOrder.LayoutOrder
grid.Parent = board

for index = 1, Config.GridSize * Config.GridSize do
	local cell = Instance.new("Frame")
	cell.Name = tostring(index)
	cell.LayoutOrder = index
	cell.BackgroundColor3 = colors.floor
	cell.BorderSizePixel = 0
	cell.Parent = board
	cells[index] = cell
end

local controls = Instance.new("Frame")
controls.Size = UDim2.new(1, 0, 0, 176)
controls.BackgroundTransparency = 1
controls.Parent = shell

local controlLayout = Instance.new("UIListLayout")
controlLayout.FillDirection = Enum.FillDirection.Horizontal
controlLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
controlLayout.Padding = UDim.new(0, 8)
controlLayout.Parent = controls

local movePanel = Instance.new("Frame")
movePanel.Size = UDim2.new(0.46, -4, 1, 0)
movePanel.BackgroundColor3 = colors.panel
movePanel.BorderSizePixel = 0
movePanel.Parent = controls
stroke(movePanel)

local moveGrid = Instance.new("UIGridLayout")
moveGrid.CellPadding = UDim2.fromOffset(4, 4)
moveGrid.CellSize = UDim2.new(1 / 3, -5, 1 / 3, -5)
moveGrid.FillDirectionMaxCells = 3
moveGrid.Parent = movePanel

local directionData = {
	{ "↖", -1, -1 }, { "↑", 0, -1 }, { "↗", 1, -1 },
	{ "←", -1, 0 }, { "•", 0, 0 }, { "→", 1, 0 },
	{ "↙", -1, 1 }, { "↓", 0, 1 }, { "↘", 1, 1 },
}

local function send(payload: { [string]: any })
	if not currentState then
		return
	end
	payload.runId = currentState.runId
	payload.expectedTurn = currentState.turns
	commandRemote:FireServer(payload)
end

for _, data in directionData do
	local moveButton = button(movePanel, data[1] :: string)
	local dx = data[2] :: number
	local dy = data[3] :: number
	if dx == 0 and dy == 0 then
		moveButton.AutoButtonColor = false
		moveButton.BackgroundColor3 = Color3.fromRGB(9, 19, 26)
	else
		moveButton.Activated:Connect(function()
			send({ type = "move", dx = dx, dy = dy })
		end)
	end
end

local actionPanel = Instance.new("Frame")
actionPanel.Size = UDim2.new(0.54, -4, 1, 0)
actionPanel.BackgroundColor3 = colors.panel
actionPanel.BorderSizePixel = 0
actionPanel.Parent = controls
stroke(actionPanel)

local actionGrid = Instance.new("UIGridLayout")
actionGrid.CellPadding = UDim2.fromOffset(4, 4)
actionGrid.CellSize = UDim2.new(0.5, -6, 0.25, -5)
actionGrid.FillDirectionMaxCells = 2
actionGrid.Parent = actionPanel

local function abilityButton(name: string, label: string)
	local result = button(actionPanel, label)
	result.Activated:Connect(function()
		send({ type = "ability", ability = name })
	end)
	abilityButtons[name] = result
end

abilityButton("phase", "Phase")
abilityButton("wall", "Wall Ignore")
abilityButton("freeze", "Freeze Turn")
abilityButton("time", "Time Freeze")

local endTime = button(actionPanel, "End Time Freeze")
endTime.Activated:Connect(function()
	send({ type = "endTimeFreeze" })
end)
abilityButtons.endTime = endTime

local difficultyButton = button(actionPanel, "Difficulty")
difficultyButton.Activated:Connect(function()
	local order = { "standard", "hard", "hardcore" }
	local currentIndex = table.find(order, selectedDifficulty) or 1
	selectedDifficulty = order[currentIndex % #order + 1]
	difficultyButton.Text = string.upper(selectedDifficulty)
end)

local newButton = button(actionPanel, "New")
newButton.Activated:Connect(function()
	commandRemote:FireServer({ type = "start", mode = "new", difficulty = selectedDifficulty })
end)

local dailyButton = button(actionPanel, "Daily")
dailyButton.Activated:Connect(function()
	commandRemote:FireServer({ type = "start", mode = "daily", difficulty = selectedDifficulty })
end)

local replayButton = button(actionPanel, "Replay")
replayButton.Activated:Connect(function()
	commandRemote:FireServer({ type = "start", mode = "replay", difficulty = selectedDifficulty })
end)

local function positionKey(x: number, y: number): string
	return string.format("%d,%d", x, y)
end

local function cellIndex(x: number, y: number): number
	return y * Config.GridSize + x + 1
end

local function render(snapshot: any, message: string?)
	currentState = snapshot
	selectedDifficulty = snapshot.difficulty
	difficultyButton.Text = string.upper(selectedDifficulty)
	meta.Text = string.format(
		"%s  |  SEED %u  |  TURN %d  |  STAGE %d",
		snapshot.difficulty,
		snapshot.seed,
		snapshot.turns,
		snapshot.stage
	)
	status.Text = message or (if snapshot.gameOver then snapshot.deathCause or "Run ended" else snapshot.mode)
	status.TextColor3 = if snapshot.gameOver then Color3.fromRGB(255, 125, 125) else colors.muted

	local walls: { [string]: boolean } = {}
	for _, wall in snapshot.walls do
		walls[positionKey(wall.x, wall.y)] = true
	end
	local enemies: { [string]: any } = {}
	for _, enemy in snapshot.enemies do
		enemies[positionKey(enemy.x, enemy.y)] = enemy
	end

	for y = 0, Config.GridSize - 1 do
		for x = 0, Config.GridSize - 1 do
			local cell = cells[cellIndex(x, y)]
			local key = positionKey(x, y)
			cell.BackgroundColor3 = colors.floor
			for _, child in cell:GetChildren() do
				if child:IsA("UIStroke") then
					child:Destroy()
				end
			end
			if walls[key] then
				cell.BackgroundColor3 = colors.wall
			end
			if snapshot.portal and snapshot.portal.x == x and snapshot.portal.y == y then
				cell.BackgroundColor3 = colors.portal
				stroke(cell, Color3.new(1, 1, 1), 2)
			end
			local enemy = enemies[key]
			if enemy then
				cell.BackgroundColor3 = if enemy.stunned > 0 then colors.stunned else colors.enemy
			end
			if snapshot.player.x == x and snapshot.player.y == y then
				cell.BackgroundColor3 = colors.player
				stroke(cell, Color3.fromRGB(150, 220, 255), 2)
			end
		end
	end

	abilityButtons.phase.Visible = snapshot.phaseAvailable or snapshot.phaseArmed
	abilityButtons.wall.Visible = snapshot.tokens.wall > 0 or snapshot.wallIgnoreArmed
	abilityButtons.freeze.Visible = snapshot.tokens.freeze > 0 or snapshot.freezeNext
	abilityButtons.time.Visible = snapshot.tokens.timeFreeze > 0 or snapshot.timeFreezeMovesRemaining > 0
	abilityButtons.endTime.Visible = snapshot.timeFreezeMovesRemaining > 0
end

stateRemote.OnClientEvent:Connect(render)

local movementActions = {
	MoveUp = { 0, -1, Enum.KeyCode.W, Enum.KeyCode.Up, Enum.KeyCode.DPadUp },
	MoveDown = { 0, 1, Enum.KeyCode.S, Enum.KeyCode.Down, Enum.KeyCode.DPadDown },
	MoveLeft = { -1, 0, Enum.KeyCode.A, Enum.KeyCode.Left, Enum.KeyCode.DPadLeft },
	MoveRight = { 1, 0, Enum.KeyCode.D, Enum.KeyCode.Right, Enum.KeyCode.DPadRight },
	MoveUpLeft = { -1, -1, Enum.KeyCode.Q },
	MoveUpRight = { 1, -1, Enum.KeyCode.E },
	MoveDownLeft = { -1, 1, Enum.KeyCode.Z },
	MoveDownRight = { 1, 1, Enum.KeyCode.C },
}

for actionName, data in movementActions do
	local dx = data[1] :: number
	local dy = data[2] :: number
	local keys: { Enum.KeyCode } = {}
	for index = 3, #data do
		table.insert(keys, data[index] :: Enum.KeyCode)
	end
	ContextActionService:BindAction(actionName, function(_, inputState)
		if inputState == Enum.UserInputState.Begin then
			send({ type = "move", dx = dx, dy = dy })
		end
		return Enum.ContextActionResult.Sink
	end, false, table.unpack(keys))
end

commandRemote:FireServer({ type = "start", mode = "new", difficulty = selectedDifficulty })
