--!nonstrict
-- Studio-only server test. No command remotes or playable simulation.
local HttpService=game:GetService("HttpService")
local root=game:GetService("ReplicatedStorage"):WaitForChild("OneMoreMove")
local Grid=require(root:WaitForChild("Grid"))
local Legacy=require(root:WaitForChild("Ai"))
local folder=script.Parent
local Tactical=require(folder:WaitForChild("Tactical"))(Grid)
local Corpus=require(folder:WaitForChild("AiFixtures"))
local check=require(folder:WaitForChild("TacticalCheck"))
script:SetAttribute("Result","RUNNING")
local start=os.clock()
local ok,result=pcall(check,Grid,Tactical,Legacy,Corpus,function(index,total)
	-- Yield only between fixtures so the Studio script does not exhaust its time slice.
	if index%10==0 then task.wait() end
	if index%50==0 then print(string.format("TACTICAL_PROGRESS %d/%d",index,total)) end
end)
if not ok then
	script:SetAttribute("Result","FAIL")
	error("TACTICAL_FAIL "..tostring(result),0)
end
result.elapsedSeconds=os.clock()-start
result.runtime="Roblox Studio server"
script:SetAttribute("Result","PASS")
print("TACTICAL_PASS "..HttpService:JSONEncode(result))
