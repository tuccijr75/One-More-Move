--!nonstrict
-- Actual Simulation command paths, isolated candidate injection. No live server changes.
return function(Grid,Simulation,Tactical,Legacy,Corpus,onProgress)
	local function equal(a,b,path)
		assert(type(a)==type(b),path..": type mismatch")
		if type(a)=="table" then
			for k,v in pairs(a) do equal(v,b[k],path.."."..tostring(k)) end
			for k in pairs(b) do assert(a[k]~=nil,path..": missing "..tostring(k)) end
		else assert(a==b,path..": "..tostring(a).." vs "..tostring(b)) end
	end
	local function view(s)
		return {player=s.player,portal=s.portal,walls=s.walls,enemies=s.enemies,difficulty=s.difficulty,allowDiagonalEscape=s.tokens.diag>0}
	end
	local function legacy(s)
		return Legacy.plan(view(s))
	end
	local function fresh(difficulty,seed)
		local s=Simulation.newRun(seed or 777,difficulty,"INTEGRATION",1)
		s.walls={};s.enemies={};s.player={x=5,y=5};s.playerTrail={}
		s.nextPortalTurn=10000;s.nextSpawnTurn=10000
		return s
	end
	local function copyEnemies(enemies)
		local out={}
		for i,e in ipairs(enemies) do out[i]=table.clone(e) end
		return out
	end
	local fixtureCount,skipped,changed,plannerCalls=0,0,0,0
	local skipReasons={}
	for index,fixture in ipairs(Corpus.fixtures) do
		local state=fresh(fixture.difficulty)
		state.stage=fixture.stage
		state.wallCount=#fixture.walls
		for _,k in ipairs(fixture.walls) do state.walls[k]=true end
		state.enemies=copyEnemies(fixture.enemies)
		state.portal=fixture.portal and table.clone(fixture.portal) or nil
		state.tokens.diag=if fixture.allowDiagonalEscape then 1 else 0
		local occupied=Grid.enemySet(state.enemies)
		local previous=nil
		for _,tile in ipairs(Grid.neighbors(fixture.player)) do
			if Grid.inBounds(tile) and not state.walls[Grid.key(tile)] and not occupied[Grid.key(tile)] and not (state.portal and Grid.same(tile,state.portal)) then previous=tile;break end
		end
		local reason=if occupied[Grid.key(fixture.player)] then "player-occupied" elseif state.portal and Grid.same(fixture.player,state.portal) then "portal-entry" elseif not previous then "no-legal-predecessor" else nil
		if reason then
			skipped+=1;skipReasons[reason]=(skipReasons[reason] or 0)+1
		else
			state.player=previous
			state.wallIgnoreArmed=state.walls[Grid.key(fixture.player)]==true
			local policy=if fixture.difficulty=="standard" then "baseline" elseif fixture.difficulty=="hard" then "tactical-v2" else "tactical-v4"
			local expected=fixture.expected[policy]
			local calls=0
			local function injected(s)
				calls+=1;plannerCalls+=1
				equal(view(s),{player=fixture.player,portal=fixture.portal,walls=state.walls,enemies=fixture.enemies,difficulty=fixture.difficulty,allowDiagonalEscape=fixture.allowDiagonalEscape},fixture.id.."/adapter")
				local result=Tactical.plan(view(s),fixture.config,fixture.tuning,policy)
				equal(result,expected,fixture.id.."/candidate")
				return result.enemies
			end
			local ok=Simulation.applyCommand(state,{type="move",dx=fixture.player.x-previous.x,dy=fixture.player.y-previous.y},100,injected)
			assert(ok and calls==1,fixture.id..": move must invoke exactly one planner")
			equal(state.enemies,expected.enemies,fixture.id.."/committed-enemies")
			local intercepted=false
			for _,e in ipairs(expected.enemies) do if e.stunned==0 and Grid.same(e,fixture.player) then intercepted=true end end
			if intercepted then assert(state.gameOver and state.turns==0 and state.deathCause=="Intercepted.",fixture.id..": interception must terminate")
			elseif state.gameOver then assert(state.turns==0 and state.deathCause=="No escape.",fixture.id..": unexpected terminal state")
			else assert(state.turns==1,fixture.id..": one accepted ordinary move must complete one turn") end
			fixtureCount+=1
			if fixture.changed then changed+=1 end
		end
		if onProgress then onProgress(index,#Corpus.fixtures) end
	end
	assert(fixtureCount+skipped==375 and fixtureCount>300 and changed>0,"integration coverage")
	-- Dedicated ability/portal paths: a spy planner returns no enemies and counts calls.
	local cases=0
	local function case(name,fn)
		local s=fresh("hardcore")
		local calls=0
		local function spy(_state) calls+=1;return {} end
		local function cmd(command) return Simulation.applyCommand(s,command,100,spy) end
		fn(s,cmd,function() return calls end)
		cases+=1
	end
	case("ordinary",function(s,cmd,calls)
		assert(cmd({type="move",dx=1,dy=0}));assert(calls()==1 and s.turns==1)
	end)
	case("invalid",function(s,cmd,calls)
		assert(not cmd({type="move",dx=2,dy=0}));assert(calls()==0 and s.turns==0)
	end)
	case("freeze",function(s,cmd,calls)
		s.tokens.freeze=1
		assert(cmd({type="ability",ability="freeze"}))
		assert(cmd({type="move",dx=1,dy=0}));assert(calls()==0 and s.turns==1 and not s.freezeNext)
	end)
	case("time-completion",function(s,cmd,calls)
		s.tokens.timeFreeze=1
		assert(cmd({type="ability",ability="time"}))
		assert(cmd({type="move",dx=1,dy=0}));assert(calls()==0 and s.turns==0)
		assert(cmd({type="move",dx=0,dy=1}));assert(calls()==1 and s.turns==1)
	end)
	case("time-early-release",function(s,cmd,calls)
		s.tokens.timeFreeze=1
		assert(cmd({type="ability",ability="time"}))
		assert(cmd({type="move",dx=1,dy=0}))
		assert(cmd({type="endTimeFreeze"}));assert(calls()==1 and s.turns==1)
	end)
	case("time-unused-release",function(s,cmd,calls)
		s.tokens.timeFreeze=1
		assert(cmd({type="ability",ability="time"}))
		assert(cmd({type="endTimeFreeze"}));assert(calls()==0 and s.turns==0)
	end)
	case("phase",function(s,cmd,calls)
		assert(cmd({type="ability",ability="phase"}))
		assert(cmd({type="move",dx=1,dy=0}));assert(calls()==1 and s.phaseUsed and s.player.x==7)
	end)
	case("wall",function(s,cmd,calls)
		s.tokens.wall=1;s.walls["6,5"]=true
		assert(cmd({type="ability",ability="wall"}))
		assert(cmd({type="move",dx=1,dy=0}));assert(calls()==1 and not s.wallIgnoreArmed)
	end)
	case("diagonal",function(s,cmd,calls)
		s.tokens.diag=1
		assert(cmd({type="move",dx=1,dy=1}));assert(calls()==1 and s.tokens.diag==0)
	end)
	case("portal",function(s,cmd,calls)
		s.portal={x=6,y=5}
		assert(cmd({type="move",dx=1,dy=0}));assert(calls()==0 and s.turns==0 and s.stage==2 and s.portal==nil)
	end)
	case("direct-collision",function(s,cmd,calls)
		s.enemies={{id=0,x=6,y=5,stunned=0,intentLock=0}}
		assert(cmd({type="move",dx=1,dy=0}));assert(calls()==0 and s.gameOver)
	end)
	-- Default path versus an explicit legacy adapter, identical seeded command stream.
	local legacyCommands=0
	local commands={{type="move",dx=1,dy=0},{type="move",dx=0,dy=1},{type="move",dx=-1,dy=0},{type="move",dx=0,dy=-1},{type="ability",ability="phase"},{type="move",dx=1,dy=0},{type="ability",ability="time"},{type="endTimeFreeze"},{type="move",dx=2,dy=0}}
	for _,difficulty in ipairs({"standard","hard","hardcore"}) do
		for seed=80001,80010 do
			local a,b=Simulation.newRun(seed,difficulty,"LEGACY",1),Simulation.newRun(seed,difficulty,"LEGACY",1)
			for step=1,36 do
				local command=commands[(step-1)%#commands+1]
				local ar,ae=Simulation.applyCommand(a,command,step*2)
				local br,be=Simulation.applyCommand(b,command,step*2,legacy)
				equal(ar,br,"legacy acceptance");equal(ae,be,"legacy rejection")
				equal(Simulation.snapshot(a),Simulation.snapshot(b),"legacy snapshot")
				equal(a.rng._state,b.rng._state,"legacy RNG")
				legacyCommands+=1
			end
		end
	end
	return {fixtureCommands=fixtureCount,skippedFixtures=skipped,skipReasons=skipReasons,changedFixtures=changed,plannerCalls=plannerCalls,abilityCases=cases,legacyCommands=legacyCommands}
end
