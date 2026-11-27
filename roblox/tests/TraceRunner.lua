--!nonstrict
-- Strict cross-runtime trace gate; report first mismatch per trace before failing.
local Grid=require("./Grid")
local Config=require("./Config")
local Simulation=require("./Simulation")
local Tactical=require("./Tactical")(Grid)
local Corpus=require("./TraceFixtures")
local tuning={gapFillBonus=3,escapePenalty=1.5}
local function candidate(s)
	local base=Config.Difficulty[s.difficulty]
	local pressure=math.min(1.3,1+0.02*(s.stage-1))
	local cfg=table.clone(base)
	cfg.trapWeight=base.trapWeight*pressure
	cfg.interceptWeight=base.interceptWeight*pressure
	local policy=if s.difficulty=="hardcore" then "tactical-v4" elseif s.difficulty=="hard" then "tactical-v2" else "baseline"
	return Tactical.plan({player=s.player,portal=s.portal,walls=s.walls,enemies=s.enemies,difficulty=s.difficulty,allowDiagonalEscape=s.tokens.diag>0},cfg,tuning,policy).enemies
end
local function view(s)
	local walls={}
	for k in pairs(s.walls) do table.insert(walls,k) end
	table.sort(walls)
	return {player=s.player,walls=walls,enemies=s.enemies,playerTrail=s.playerTrail,wallCount=s.wallCount,nextEnemyId=s.nextEnemyId,
		turns=s.turns,stage=s.stage,portal=s.portal,nextPortalTurn=s.nextPortalTurn,nextSpawnTurn=s.nextSpawnTurn,gameOver=s.gameOver,deathCause=s.deathCause,
		hasExtraLife=s.hasExtraLife,tokens=s.tokens,phaseUsed=s.phaseUsed,phaseArmed=s.phaseArmed,wallIgnoreArmed=s.wallIgnoreArmed,freezeNext=s.freezeNext,
		timeFreezeMovesRemaining=s.timeFreezeMovesRemaining,cooldownUntil=s.cooldownUntil*1000}
end
local function equal(a,b)
	if type(a)~=type(b) then return false end
	if type(a)~="table" then return a==b end
	for k,v in pairs(a) do if not equal(v,b[k]) then return false end end
	for k in pairs(b) do if a[k]==nil then return false end end
	return true
end
local function differences(actual,expected)
	local out={}
	for k,v in pairs(actual) do
		-- Time conversion is the only tolerated numerical rounding (1e-6 ms).
		if k=="cooldownUntil" and type(expected[k])=="number" and math.abs(v-expected[k])<=0.000001 then continue end
		if not equal(v,expected[k]) then table.insert(out,k) end
	end
	for k in pairs(expected) do if actual[k]==nil then table.insert(out,k) end end
	table.sort(out)
	return out
end
local naturalMatched,naturalCommands,naturalDiverged=0,0,0
local forcedMatched,forcedTransitions,forcedDiverged=0,0,0
local fields={}
local function record(kind,seed,difficulty,index,diff)
	for _,field in ipairs(diff) do fields[field]=(fields[field] or 0)+1 end
	print(string.format("TRACE_DIFF %s seed=%d profile=%s step=%d fields=%s",kind,seed,difficulty,index,table.concat(diff,",")))
end
for _,run in ipairs(Corpus.naturalRuns) do
	local s=Simulation.newRun(run.seed,run.difficulty,"PARITY",1)
	local diff=differences(view(s),run.initial)
	if #diff>0 then record("initial",run.seed,run.difficulty,0,diff);naturalDiverged+=1;continue end
	local matched=true
	for i,step in ipairs(run.steps) do
		local accepted=Simulation.applyCommand(s,step.command,step.atMs/1000,candidate)
		local d=differences(view(s),step.expected)
		if accepted~=step.accepted then table.insert(d,"accepted") end
		if #d>0 then record("natural",run.seed,run.difficulty,i,d);naturalDiverged+=1;matched=false;break end
		naturalCommands+=1
	end
	if matched then naturalMatched+=1 end
end
for _,run in ipairs(Corpus.forcedRuns) do
	local s=Simulation.newRun(run.seed,"standard","PARITY",1)
	local diff=differences(view(s),run.initial)
	if #diff>0 then record("forced-initial",run.seed,"standard",0,diff);forcedDiverged+=1;continue end
	local matched=true
	for i,step in ipairs(run.steps) do
		-- Align clock and explicit JS-generated portal; consume one RNG draw for
		-- the known successful JS portal selection (not a portal-generator test).
		s.turns=step.generated.turns;s.portal=table.clone(step.generated.portal)
		s.rng:NextNumber()
		s.player=table.clone(step.prior)
		local dx,dy=s.portal.x-s.player.x,s.portal.y-s.player.y
		local accepted=Simulation.applyCommand(s,{type="move",dx=dx,dy=dy},0,candidate)
		assert(accepted,"forced portal input rejected")
		local d=differences(view(s),step.expected)
		if #d>0 then record("forced",run.seed,"standard",i,d);forcedDiverged+=1;matched=false;break end
		forcedTransitions+=1
	end
	if matched then forcedMatched+=1 end
end
assert(naturalMatched+naturalDiverged==#Corpus.naturalRuns)
assert(forcedMatched+forcedDiverged==#Corpus.forcedRuns)
print(string.format("TRACE_AUDIT naturalMatched=%d naturalDiverged=%d matchedCommands=%d forcedMatched=%d forcedDiverged=%d matchedTransitions=%d",naturalMatched,naturalDiverged,naturalCommands,forcedMatched,forcedDiverged,forcedTransitions))
local keys={}
for k in pairs(fields) do table.insert(keys,k) end
table.sort(keys)
for _,k in ipairs(keys) do print("TRACE_FIELD "..k.."="..fields[k]) end
local expectedCommands,expectedTransitions=0,0
for _,run in ipairs(Corpus.naturalRuns) do expectedCommands+=#run.steps end
for _,run in ipairs(Corpus.forcedRuns) do expectedTransitions+=#run.steps end
assert(#Corpus.naturalRuns==36 and #Corpus.forcedRuns==12,"trace corpus coverage changed")
assert(naturalDiverged==0 and forcedDiverged==0,"full-state trace divergence")
assert(naturalCommands==expectedCommands and forcedTransitions==expectedTransitions,"incomplete trace execution")
print(string.format("TRACE_PASS: %d natural runs, %d exact commands, %d forced chains, %d exact stage transitions",naturalMatched,naturalCommands,forcedMatched,forcedTransitions))
-- The forced chains end at the supplied corpus boundary; they do not certify survival or portal generation.
