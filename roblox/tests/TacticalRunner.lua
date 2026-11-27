--!nonstrict
-- Standalone Luau runner, never mapped into the playable Roblox place.
local Grid=require("./Grid")
local Tactical=require("./Tactical")(Grid)
local Corpus=require("./AiFixtures")
local Legacy=require("./Ai")
local function equal(a,b,path)
	if type(a)~=type(b) then error(path..": type mismatch "..typeof(a).." vs "..typeof(b),2) end
	if type(a)=="table" then
		for k,v in pairs(a) do equal(v,b[k],path.."."..tostring(k)) end
		for k,v in pairs(b) do if a[k]==nil then error(path.."."..tostring(k)..": missing key",2) end end
	elseif a~=b then error(path..": "..tostring(a).." vs "..tostring(b),2) end
end
local count,changed,legacyDifferences=0,0,0
local byPolicy={}
for _,fixture in ipairs(Corpus.fixtures) do
	local walls={}
	for _,k in ipairs(fixture.walls) do walls[k]=true end
	local state={player=fixture.player,portal=fixture.portal,walls=walls,enemies=fixture.enemies,difficulty=fixture.difficulty,allowDiagonalEscape=fixture.allowDiagonalEscape}
	local legacy=Legacy.plan(state)
	local legacyMatches=pcall(equal,legacy,fixture.expected.baseline.enemies,fixture.id.."/shipping")
	if not legacyMatches then legacyDifferences+=1 end
	for _,policy in ipairs(Corpus.contract.policyNames) do
		local actual=Tactical.plan(state,fixture.config,fixture.tuning,policy)
		local expected=fixture.expected[policy]
		equal(actual,expected,fixture.id.."/"..policy)
		equal(Tactical.plan(state,fixture.config,fixture.tuning,policy),expected,fixture.id.."/repeat/"..policy)
		count+=1
		byPolicy[policy]=(byPolicy[policy] or 0)+1
	end
	if fixture.category=="actual-changed" then changed+=1 end
end
assert(#Corpus.fixtures==375 and count==1125 and changed==32)
print(string.format("PASS: %d fixtures, %d exact planner comparisons, %d changed-state fixtures, %d shipping legacy differences",#Corpus.fixtures,count,changed,legacyDifferences))
for _,policy in ipairs(Corpus.contract.policyNames) do print(policy..": "..byPolicy[policy]) end
