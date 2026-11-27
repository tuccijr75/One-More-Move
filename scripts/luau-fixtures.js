"use strict";
// Generate a standalone test directory. The only source transformation is
// dependency addressing: Roblox script.Parent imports become Luau CLI imports.
const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const root=path.resolve(__dirname,"..");
const out=path.join(root,"dist/lab/luau");
fs.mkdirSync(out,{recursive:true});
for(const name of ["Config","Rng","Grid","Ai"]){
  const src=fs.readFileSync(path.join(root,"roblox/src/shared",name+".lua"),"utf8");
  const imports=[...src.matchAll(/require\(script\.Parent\.([A-Za-z]+)\)/g)];
  assert.equal(imports.length,["Grid","Ai"].includes(name)?2:0,"unexpected dependency contract "+name);
  const cli=src.replace(/require\(script\.Parent\.([A-Za-z]+)\)/g,(_,dep)=>'require("./'+dep+'")');
  assert.equal(cli.replace(/require\("\.\/([A-Za-z]+)"\)/g,(_,dep)=>"require(script.Parent."+dep+")"),src,"non-import source transformation");
  fs.writeFileSync(path.join(out,name+".luau"),cli);
}
for(const name of ["Tactical","TacticalCheck","TacticalRunner"])fs.copyFileSync(path.join(root,"roblox/tests",name+".lua"),path.join(out,name+".luau"));
fs.copyFileSync(path.join(root,"dist/lab/AiFixtures.lua"),path.join(out,"AiFixtures.luau"));
console.log("Standalone Luau fixture directory generated; shipping sources unchanged.");
