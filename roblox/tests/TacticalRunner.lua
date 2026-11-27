--!nonstrict
-- Standalone Luau entry point. The conformance assertions are shared with Studio.
local Grid=require("./Grid")
local Tactical=require("./Tactical")(Grid)
local Corpus=require("./AiFixtures")
local Legacy=require("./Ai")
local check=require("./TacticalCheck")
local Simulation=require("./Simulation")
local integrate=require("./IntegrationCheck")
local result=check(Grid,Tactical,Legacy,Corpus)
print(string.format("PASS: %d fixtures, %d exact planner comparisons, %d changed-state fixtures, %d shipping legacy differences",result.fixtures,result.comparisons,result.changedFixtures,result.legacyDifferences))
for _,policy in ipairs(Corpus.contract.policyNames) do print(policy..": "..result.byPolicy[policy]) end
for _,difficulty in ipairs({"standard","hard","hardcore"}) do
	local profile=result.byDifficulty[difficulty]
	print(string.format("Shipping comparison %s: %d differences of %d fixtures",difficulty,profile.legacyDifferences,profile.fixtures))
end

local integration=integrate(Grid,Simulation,Tactical,Legacy,Corpus)
print(string.format("INTEGRATION_PASS: %d fixture commands, %d skipped, %d changed-state commands, %d ability cases, %d legacy command pairs",integration.fixtureCommands,integration.skippedFixtures,integration.changedFixtures,integration.abilityCases,integration.legacyCommands))
for reason,count in pairs(integration.skipReasons) do print("Integration skip "..reason..": "..count) end
