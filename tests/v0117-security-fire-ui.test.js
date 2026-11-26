'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Engine=require('../src/simulation-engine.js');
const Runner=require('../src/simulation-runner.js');
const Security=require('../src/security-incident.js');
const dir=path.join(__dirname,'..');
function corridorPlan(floors=1, stair=true){
 return {format:'evacuation-simulator',settings:{scenario:'lockdown',pxPerMeter:25,
   securityEnhancedEnabled:true,securityRoamEnabled:true,securityRoomVisualsEnabled:true,
   securityRoamPeriodSeconds:100,securityEvacuationPercent:100,
   securityWarningAtSeconds:1,securityEmergencyAtSeconds:2,
   securityHelpArrivalSeconds:30,threatHelpCallAtSeconds:5},
   floors:Array.from({length:floors},(_,fi)=>({name:'Етаж '+(fi+1),items:[
     {id:`room${fi}`,type:'room',x:10,y:10,w:220,h:135,people:3},
     {id:`hall${fi}`,type:'corridor',x:20,y:155,w:310,h:50},
     {id:`separate${fi}`,type:'room',x:400,y:10,w:150,h:145,people:1},
     ...(stair?[{id:`stairs${fi}`,type:'stairs',x:50,y:180,width:1.2}]:[]),
     ...(fi===0?[{id:'symbol',type:'threat',x:72,y:183,entryAtSeconds:0}]:[]),
     {id:`exit${fi}`,type:'exit',x:20,y:180,width:1.2}
   ]}))};
}
test('security marker stays in the corridor rectangle without jumping across walls or rooms',()=>{
 const model=Engine.buildModel(corridorPlan(1));
 const speed=[];
 let last=null;
 for(let time=0;time<210;time+=.25){
  const [m]=Security.markerPositions(model.threatMarkers,model.floors,time,model.settings);
  assert.ok(m.x>=20 && m.x<=330 && m.y>=155 && m.y<=205,`outside corridor at ${time}: ${m.x},${m.y}`);
  assert.ok(m.x<400 && m.y>145,'marker never visits separated rooms');
  if(last)speed.push(Math.hypot(m.x-last.x,m.y-last.y)/.25);
  last=m;
 }
 assert.ok(Math.max(...speed)<5,'slow motion with no teleporting on the same floor');
});
test('a manually drawn wall in the corridor blocks the marker rather than being crossed',()=>{
 const p=corridorPlan(1);p.floors[0].items.push({id:'barrier',type:'wall',x:90,y:154,x2:90,y2:207});
 const model=Engine.buildModel(p);
 const first=Security.markerPositions(model.threatMarkers,model.floors,0,model.settings)[0];
 for(let time=10;time<180;time+=10){
   const result=Security.markerPositions(model.threatMarkers,model.floors,time,model.settings)[0];
   assert.ok(result.x<=90,`crossed manually drawn wall at time ${time}`);
   assert.equal(result.floor,0);
 }
 assert.ok(first.x<=90);
});
test('multifloor abstract marker changes floor only at corresponding stairs',()=>{
 const m=Engine.buildModel(corridorPlan(3));
 const samples=[0,99.9,100,130,200,300,400].map(t=>Security.markerPositions(m.threatMarkers,m.floors,t,m.settings)[0]);
 assert.deepEqual(samples.map(s=>s.floor),[0,0,1,1,2,1,0]);
 assert.ok(samples.every(s=>s.x>=20 && s.x<=330 && s.y>=155 && s.y<=205));
 // No stair on upper floor: never teleport between floors.
 const noStairs=Engine.buildModel(corridorPlan(3,false));
 assert.ok([0,100,200,300].every(t=>Security.markerPositions(noStairs.threatMarkers,noStairs.floors,t,noStairs.settings)[0].floor===0));
});
test('security occupants remain inside their rooms even with old high evacuation setting',()=>{
 const p=corridorPlan(2); const model=Engine.buildModel(p),sim=Runner.createSimulation(model);
 const points=sim.agents.map(a=>({x:a.x,y:a.y,floor:a.floor}));
 assert.ok(sim.agents.every(a=>a.securityAction==='shelter'));
 for(let i=0;i<350&&!sim.finished;i++)sim.advance(1);
 assert.equal(sim.snapshot().safe,0);
 assert.equal(sim.snapshot().sheltered,8);
 assert.ok(sim.agents.every((a,i)=>a.x===points[i].x&&a.y===points[i].y&&a.floor===points[i].floor));
 assert.ok(sim.snapshot().securityRooms.some(r=>r.id==='room0'&&r.furnitureCount===0));
 assert.ok(sim.snapshot().securityMarkers[0].floor>=0);
});
test('new and legacy-library fire ignition use the same speed; explicit custom speeds still work',()=>{
 const p={format:'evacuation-simulator',settings:{scenario:'fire',spreadSpeed:.4,fireSpreadMultiplier:.8},
  floors:[{name:'Етаж 1',items:[
   {id:'r',type:'room',x:10,y:10,w:260,h:180,people:0},
   {id:'l',type:'hazard',name:'Огнище (тест)',x:45,y:65,spread:true,spreadSpeed:.03},
   {id:'n',type:'hazard',name:'Опасна зона 2',x:85,y:100,spread:true},
   {id:'c',type:'hazard',name:'Съзнателно зададено огнище',x:100,y:125,spread:true,spreadSpeed:.6}
  ]}]};
 const model=Engine.buildModel(p);
 const byId=Object.fromEntries(model.hazardSources.map(x=>[x.refId,x.speed]));
 assert.equal(byId.l,byId.n);
 assert.ok(Math.abs(byId.l-.32)<1e-9);
 assert.ok(Math.abs(byId.c-.48)<1e-9);
 assert.equal(p.floors[0].items[1].spreadSpeed,.03,'saved source data is not overwritten');
});
test('restart is large, red, shown at completion and resets to original editor state',()=>{
 const html=fs.readFileSync(path.join(dir,'src/index.html'),'utf8');
 const app=fs.readFileSync(path.join(dir,'src/app.js'),'utf8');
 const css=fs.readFileSync(path.join(dir,'src/styles.css'),'utf8');
 assert.match(html,/id="restartSimulation"[^>]+hidden/);
 assert.match(css,/\.restart-finished\s*\{[^}]*background:#c92142/s);
 assert.match(app,/\$\('restartSimulation'\)\.hidden=!?\(/);
 assert.match(app,/\$\('restartSimulation'\)\.addEventListener\('click',\(\)=>\{stopSimulation\(false\)/);
 assert.match(app,/function stopSimulation\(silent\)/);
 assert.match(html,/id="scene3dRestartSimulation"[^>]+hidden/);
 assert.match(fs.readFileSync(path.join(dir,'src/scene3d-ui.js'),'utf8'),/scene3dRestartSimulation/);
});
test('side panels are foldable without re-creating inputs or modifying editor event bindings',()=>{
 const app=fs.readFileSync(path.join(dir,'src/app.js'),'utf8');
 const css=fs.readFileSync(path.join(dir,'src/styles.css'),'utf8');
 assert.match(app,/function installCollapsiblePanels\(/);
 assert.match(app,/querySelectorAll\('\.side > \.group, \.rightpanel > \.group'\)/);
 assert.match(app,/while\(button\.nextSibling\)panel\.appendChild\(button\.nextSibling\)/);
 assert.match(app,/button\.setAttribute\('aria-expanded'/);
 assert.match(css,/\.group-fold-body\[hidden\]/);
});
