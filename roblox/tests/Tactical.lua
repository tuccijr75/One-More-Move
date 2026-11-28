--!nonstrict
-- Isolated reference port of app/ai.js baseline, tactical-v2 and tactical-v4.
-- Inject the canonical Grid module; never called by the live server.
return function(Grid)
	local key, same, manhattan = Grid.key, Grid.same, Grid.manhattan
	local function rankCompare(a,b)
		for i=1,math.max(#a,#b) do
			local x,y=a[i] or 0,b[i] or 0
			if x<y then return -1 end
			if x>y then return 1 end
		end
		return 0
	end
	local function stableSort(items,cmp)
		for i=2,#items do
			local item,j=items[i],i-1
			while j>=1 and cmp(item,items[j])<0 do
				items[j+1]=items[j]
				j-=1
			end
			items[j+1]=item
		end
		return items
	end
	local function finite(n)
		return n==n and n>-math.huge and n<math.huge
	end
	local function legal(s,pos)
		local result={}
		for _,tile in ipairs(Grid.neighbors(pos)) do
			if Grid.inBounds(tile) and not s.walls[key(tile)] then table.insert(result,tile) end
		end
		return result
	end
	local function blocked(s,index,hypothetical)
		local result=Grid.copySet(s.walls)
		for i,e in ipairs(s.enemies) do
			if i~=index then result[key(e)]=true
			elseif hypothetical then result[key(hypothetical)]=true end
		end
		return result
	end
	local function assign(s)
		local targets=legal(s,s.player)
		local available,assignments={},{}
		for _,tile in ipairs(targets) do available[key(tile)]=true end
		for i,e in ipairs(s.enemies) do
			local obstacles=blocked(s,i,nil)
			local ranked={}
			for _,tile in ipairs(targets) do
				if available[key(tile)] then
					table.insert(ranked,{tile=tile,distance=Grid.shortestDistance(e,tile,obstacles)})
				end
			end
			stableSort(ranked,function(a,b)
				return rankCompare({a.distance,a.tile.y,a.tile.x},{b.distance,b.tile.y,b.tile.x})
			end)
			local first=ranked[1]
			if first and finite(first.distance) then
				assignments[i]=first.tile
				available[key(first.tile)]=nil
			end
		end
		return assignments
	end
	local function stationary(e,stun)
		local result=table.clone(e)
		result.stunned=stun
		result.intentX=nil
		result.intentY=nil
		result.intentLock=0
		return result
	end
	local function moved(e,tile,cfg)
		local result=table.clone(e)
		result.x,result.y=tile.x,tile.y
		result.intentX,result.intentY=tile.x-e.x,tile.y-e.y
		result.intentLock=cfg.commitLockTurns
		return result
	end
	local function evaluate(s,i,tile,cfg,tuning,assigned)
		local e=s.enemies[i]
		local obstacles=blocked(s,i,tile)
		obstacles[key(s.player)]=nil
		local currentBlocked=blocked(s,i,nil)
		currentBlocked[key(s.player)]=nil
		local currentDistance=Grid.shortestDistance(e,s.player,currentBlocked)
		local distance=Grid.shortestDistance(tile,s.player,obstacles)
		local tier=if distance<currentDistance then 0 elseif distance==currentDistance then 1 else 2
		local occupied,duplicate={},0
		for j,other in ipairs(s.enemies) do
			occupied[key(if j==i then tile else other)]=true
			if i~=j and manhattan(tile,other)<=1 then duplicate+=1 end
		end
		local escapes=Grid.countEscapes(s.player,s.walls,occupied,s.allowDiagonalEscape)
		local intercept=if assigned then Grid.shortestDistance(tile,assigned,obstacles) else Grid.shortestDistanceToAny(tile,legal(s,s.player),obstacles)
		local follows=e.intentLock>0 and e.intentX==tile.x-e.x and e.intentY==tile.y-e.y
		local coordination=escapes*cfg.trapWeight+intercept*cfg.interceptWeight+duplicate*math.max(0,tuning.gapFillBonus/2)-(if escapes<=1 then cfg.squeezeBonus else 0)
		return {target=tile,rank={tier,distance,coordination,if follows then 0 else 1,tile.y,tile.x},nextEnemy=moved(e,tile,cfg)}
	end
	local function proposal(s,i,cfg,tuning,assignments)
		local e=s.enemies[i]
		if e.stunned>0 then return {target=e,rank={9,9,9,i-1},nextEnemy=stationary(e,e.stunned-1)} end
		local candidates=legal(s,e)
		for _,tile in ipairs(candidates) do
			if same(tile,s.player) then return {target=tile,rank={-1,0,0,i-1},nextEnemy=moved(e,tile,cfg)} end
		end
		if #candidates==0 then return {target=e,rank={8,8,8,i-1},nextEnemy=stationary(e,e.stunned)} end
		local ranked={}
		for _,tile in ipairs(candidates) do table.insert(ranked,evaluate(s,i,tile,cfg,tuning,assignments[i])) end
		stableSort(ranked,function(a,b) return rankCompare(a.rank,b.rank) end)
		local first=ranked[1]
		table.insert(first.rank,i-1)
		return first
	end
	local function resolve(current,proposals)
		local origin,winners,moving={},{},{}
		for i,e in ipairs(current) do origin[key(e)]=i end
		for i,p in ipairs(proposals) do
			local k=key(p.target)
			local prior=winners[k]
			if not prior or rankCompare(p.rank,proposals[prior].rank)<0 then winners[k]=i end
		end
		for _,i in pairs(winners) do if not same(proposals[i].target,current[i]) then moving[i]=true end end
		local changed=true
		while changed do
			changed=false
			for i=1,#current do
				if moving[i] then
					local occupant=origin[key(proposals[i].target)]
					if occupant and occupant~=i and not moving[occupant] then moving[i]=nil;changed=true end
				end
			end
		end
		local enemies,tiles,occupied={},{},{}
		for i,e in ipairs(current) do
			local p=proposals[i]
			local result=if moving[i] or same(p.target,e) then table.clone(p.nextEnemy) else stationary(e,e.stunned)
			local k=key(result)
			assert(not occupied[k],"duplicate final destination")
			occupied[k]=true
			enemies[i]=result
			if not same(e,result) then table.insert(tiles,k) end
		end
		table.sort(tiles)
		return {enemies=enemies,intentTiles=tiles}
	end
	local function baseline(s,cfg,tuning)
		local assignments,proposals=assign(s),{}
		for i=1,#s.enemies do proposals[i]=proposal(s,i,cfg,tuning,assignments) end
		return resolve(s.enemies,proposals)
	end
	local function projection(s,horizon)
		local exits=legal(s,s.player)
		local seen={[key(s.player)]=true}
		for _,tile in ipairs(exits) do seen[key(tile)]=true end
		local frontier,projected=exits,{}
		for _=2,horizon do
			local nextFrontier={}
			for _,tile in ipairs(frontier) do
				for _,candidate in ipairs(legal(s,tile)) do
					local k=key(candidate)
					if not seen[k] then
						seen[k]=true
						table.insert(nextFrontier,candidate)
						table.insert(projected,candidate)
					end
				end
			end
			frontier=nextFrontier
		end
		return exits,projected
	end
	local function mask(tile,targets,reach)
		local result=0
		for i,target in ipairs(targets) do
			if manhattan(tile,target)<=reach then result=bit32.bor(result,bit32.lshift(1,i-1)) end
		end
		return result
	end
	local function bits(n)
		local result=0
		while n~=0 do n=bit32.band(n,n-1);result+=1 end
		return result
	end
	local function options(s,i,cfg,tuning,assignments,exits,projected)
		local e=s.enemies[i]
		local function option(p,motion,closing,kill)
			local active=p.nextEnemy.stunned==0
			p.moved,p.closing,p.kill=motion,closing,kill
			p.occupied=mask(p.target,exits,0)
			p.threat=if active then mask(p.target,exits,1) else p.occupied
			p.projected=mask(p.target,projected,if active then 1 else 0)
			p.coordination=if finite(p.rank[3]) then p.rank[3] else 10000
			return p
		end
		if e.stunned>0 then return {option(proposal(s,i,cfg,tuning,assignments),0,0,0)} end
		local kills,others={},{}
		for _,tile in ipairs(legal(s,e)) do
			local p=evaluate(s,i,tile,cfg,tuning,assignments[i])
			table.insert(if same(tile,s.player) then kills else others,p)
		end
		stableSort(others,function(a,b) return rankCompare(a.rank,b.rank) end)
		local allowed={}
		for _,p in ipairs(kills) do table.insert(allowed,p) end
		local best=others[1]
		for _,p in ipairs(others) do
			if p.rank[1]==best.rank[1] and p.rank[2]==best.rank[2] then table.insert(allowed,p) end
		end
		local choices={}
		for _,p in ipairs(allowed) do
			table.insert(choices,option(p,1,if p.rank[1]==0 then 1 else 0,if same(p.target,s.player) then 1 else 0))
		end
		table.insert(choices,option({target=e,rank={9,9,9,i-1},nextEnemy=stationary(e,e.stunned)},0,0,0))
		return choices
	end
	local plan
	local function replyPressure(s,choices,cfg,tuning)
		local enemies=resolve(s.enemies,choices).enemies
		local occupied=Grid.enemySet(enemies)
		local worst,surviving,calls={0,0,0},0,0
		for _,player in ipairs(legal(s,s.player)) do
			if occupied[key(player)] then continue end
			local value
			if s.portal and same(player,s.portal) then value={2,0,0}
			else
				local nextState=table.clone(s)
				nextState.player,nextState.enemies=player,enemies
				local response=plan(nextState,cfg,tuning,"tactical-v2").enemies
				calls+=1
				local intercepted=false
				for _,e in ipairs(response) do if e.stunned==0 and same(e,player) then intercepted=true end end
				if intercepted then value={0,0,0}
				else
					local clearance=if #response>0 then math.huge else 20
					for _,e in ipairs(response) do clearance=math.min(clearance,manhattan(e,player)) end
					value={1,Grid.countEscapes(player,s.walls,Grid.enemySet(response),false),clearance}
				end
			end
			if value[1]>0 then surviving+=1 end
			if rankCompare(value,worst)>0 then worst=value end
		end
		return {rank={worst[1],worst[2],worst[3],surviving},calls=calls}
	end
	plan=function(s,cfg,tuning,policy)
		assert(policy=="baseline" or policy=="tactical-v2" or policy=="tactical-v4","unknown policy")
		if policy=="baseline" then return baseline(s,cfg,tuning) end
		local horizon=({standard=1,hard=2,hardcore=3})[s.difficulty]
		assert(horizon,"unknown difficulty")
		if s.difficulty=="standard" then
			local result=baseline(s,cfg,tuning)
			result.diagnostics={horizon=horizon,mode="control",combinations=0}
			return result
		end
		assert(#s.enemies<=6,"team cap")
		local assignments=assign(s)
		local exits,projected=projection(s,horizon)
		local adversarial=false
		if policy=="tactical-v4" and s.difficulty=="hardcore" then
			for _,e in ipairs(s.enemies) do
				if e.stunned==0 and manhattan(e,s.player)<=4 then adversarial=true;break end
			end
		end
		local candidates={}
		for i=1,#s.enemies do candidates[i]=options(s,i,cfg,tuning,assignments,exits,projected) end
		local reserved,selected,beam={},{},{}
		local best,bestRank,combinations=nil,nil,0
		local function search(i,kills,closing,motion,occupied,threat,project,coordination)
			if i>#candidates then
				combinations+=1
				local a,b,c=bits(occupied),bits(threat),bits(project)
				local rank=if s.difficulty=="hard" then {-kills,-closing,-motion,-a,-b,-c,coordination} else {-kills,-closing,-motion,-b,-c,-a,coordination}
				if not bestRank or rankCompare(rank,bestRank)<0 then bestRank=rank;best=table.clone(selected) end
				if adversarial then
					local index=nil
					for j,entry in ipairs(beam) do if rankCompare(rank,entry.rank)<0 then index=j;break end end
					if index then table.insert(beam,index,{choices=table.clone(selected),rank=rank})
					elseif #beam<4 then table.insert(beam,{choices=table.clone(selected),rank=rank}) end
					if #beam>4 then table.remove(beam) end
				end
				return
			end
			for _,p in ipairs(candidates[i]) do
				local k=key(p.target)
				if reserved[k] then continue end
				reserved[k]=true;table.insert(selected,p)
				search(i+1,kills+p.kill,closing+p.closing,motion+p.moved,bit32.bor(occupied,p.occupied),bit32.bor(threat,p.threat),bit32.bor(project,p.projected),coordination+p.coordination)
				table.remove(selected);reserved[k]=nil
			end
		end
		search(1,0,0,0,0,0,0,0)
		assert(best and bestRank,"no joint assignment")
		local strictRank=bestRank
		local forecast,strictForecast,responseCalls,examined=nil,nil,0,0
		if adversarial and strictRank[1]==0 then
			local eligible={}
			for _,entry in ipairs(beam) do
				if entry.rank[1]==strictRank[1] and entry.rank[2]==strictRank[2] and entry.rank[3]==strictRank[3] then table.insert(eligible,entry) end
			end
			if #eligible>1 then
				local initial=replyPressure(s,best,cfg,tuning)
				forecast,strictForecast=initial.rank,initial.rank
				responseCalls,examined=initial.calls,1
				for i=2,#eligible do
					local entry=eligible[i]
					local evaluation=replyPressure(s,entry.choices,cfg,tuning)
					responseCalls+=evaluation.calls;examined+=1
					if rankCompare(evaluation.rank,forecast)<0 then best,bestRank,forecast=entry.choices,entry.rank,evaluation.rank end
				end
			end
		end
		local result=resolve(s.enemies,best)
		local diagnostics={horizon=horizon,mode="joint",combinations=combinations,rank=bestRank}
		if policy=="tactical-v4" and s.difficulty=="hardcore" then
			diagnostics.strictRank,diagnostics.forecast,diagnostics.strictForecast=strictRank,forecast,strictForecast
			diagnostics.responseCalls,diagnostics.examined=responseCalls,examined
		end
		result.diagnostics=diagnostics
		return result
	end
	return table.freeze({plan=plan})
end
