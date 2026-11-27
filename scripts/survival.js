"use strict";

// Empirical partial-identification bounds, not confidence intervals.
// A run that reached the threshold is known positive. An earlier terminal
// death is known negative. A run that stopped alive earlier is unknown.
function reachedBounds(rows,turn){
  if(!Array.isArray(rows)||!rows.length||!Number.isSafeInteger(turn)||turn<1)throw Error("Invalid threshold or sample");
  let reached=0,notReached=0,unknown=0;
  for(const row of rows){
    if(!Number.isSafeInteger(row.turns)||row.turns<0||typeof row.dead!=="boolean"||row.censored!==!row.dead)throw Error("Invalid survival observation");
    if(row.turns>=turn)reached++;
    else if(row.dead)notReached++;
    else unknown++;
  }
  return {turn,runs:rows.length,reached,notReached,unknown,lower:reached/rows.length,upper:(reached+unknown)/rows.length};
}

function matchedThresholds(left,right,thresholds){
  const bySeed=new Map(right.map(r=>[r.seed,r]));
  if(!left.length||left.length!==right.length||bySeed.size!==right.length||new Set(left.map(r=>r.seed)).size!==left.length||left.some(r=>!bySeed.has(r.seed)))throw Error("Invalid matched sample");
  return thresholds.map(turn=>{
    const a=reachedBounds(left,turn),b=reachedBounds(right,turn);
    // Positive delta means right is easier at the selected threshold.
    // Unknown outcomes are allowed either value; no censoring independence assumption.
    return {turn,left:a,right:b,deltaLower:(b.reached-a.reached-a.unknown)/a.runs,deltaUpper:(b.reached+b.unknown-a.reached)/a.runs};
  });
}

module.exports={reachedBounds,matchedThresholds};
