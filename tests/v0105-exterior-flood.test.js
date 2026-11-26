'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Engine=require('../src/simulation-engine.js');
const Runner=require('../src/simulation-runner.js');
const D=require('../src/disaster-presets.js');

function room(id,x,y){return {id,type:'room',x,y,w:140,h:100,people:0};}
function floor(index,items){return {name:'Етаж '+(index+1),items};}
function world(floors,settings={}){
 return {format:'evacuation-simulator',settings:{scenario:'flood',pxPerMeter:25,floorHeight:3,
  floodGroundRiseEnabled:true,floodStartSeconds:0,floodRiseMetersPerSecond:0.3,
  floodMaxHeightMeters:6.8,preMovement:25,populationProfiles:{children:0,older:0,limited:0},...settings},floors};
}
const at=(model,t)=>Engine.floodStatusAt(model,t);
const wet=(model,t,fi,id)=>at(model,t).wetSpaces.has('f'+fi+':space:'+id);

test('exterior fixtures are detected but an internal connecting door is NOT an inlet',()=>{
 const plan=[room('left',20,20),room('right',160,20),
  {id:'between',type:'door',x:160,y:80},
  {id:'north',type:'window',x:100,y:20},
  {id:'south',type:'window',x:245,y:120},
  {id:'west',type:'exit',x:20,y:75},
  {id:'interior',type:'window',x:160,y:65}];
 const ids=Engine.exteriorFloodEntries(plan,25).map(o=>o.id);
 assert.deepEqual(ids.sort(),['north','south','west'].sort());
});

test('entire ground floor floods simultaneously and water never uses a radial spread',()=>{
 const fl=floor(0,[room('a',20,25),room('b',240,25),
  {type:'window',id:'wa',x:90,y:25}, {type:'door',id:'db',x:380,y:75},
  {type:'exit',id:'ea',x:20,y:70}]);
 const model=Engine.buildModel(world([fl]));
 assert.equal(model.floodPortals.length,3);
 assert.deepEqual(at(model,0).activePortals,[]);
 assert.equal(at(model,0).floodedRoomCount,0);
 assert.equal(at(model,1).activePortals.length,3);
 assert.equal(at(model,1).floodedRoomCount,2);
 assert.ok(wet(model,1,0,'a')&&wet(model,1,0,'b'));
 assert.equal(Engine.floodDepthAt(model,0,35,40,1),0.3);
 assert.equal(model.hazardSpread.length,0);
});

test('upper floors start flooding only when surface rises to their elevation and stop at user limit',()=>{
 const floors=Array.from({length:4},(_,fi)=>floor(fi,[room('r'+fi,20,20),
  {type:'window',id:'w'+fi,x:90,y:20}]));
 const m=Engine.buildModel(world(floors));
 assert.equal(at(m,1).floodedRoomCount,1);
 assert.ok(wet(m,1,0,'r0'));
 assert.equal(wet(m,1,1,'r1'),false);
 assert.ok(wet(m,11,1,'r1'));
 assert.equal(wet(m,11,2,'r2'),false);
 assert.ok(wet(m,21,2,'r2'));
 assert.equal(wet(m,1000,3,'r3'),false);
 assert.equal(at(m,1000).level,6.8);
 assert.ok(Math.abs(Engine.floodDepthAt(m,2,90,45,1000)-0.8)<1e-8);
});

test('no opening is required: whole floors flood when the common level rises',()=>{
 const m=Engine.buildModel(world([floor(0,[room('sealed',20,20)]),
  floor(1,[room('upper',20,20),{id:'w',type:'window',x:90,y:20}])]));
 assert.equal(at(m,2).floodedRoomCount,1);
 assert.equal(at(m,100).floodedRoomCount,2);
 assert.equal(m.hazardSpread.length,0);
});

test('exterior markers remain informational but do not gate whole-floor flooding',()=>{
 const fl=floor(0,[room('one',30,30),room('two',260,30),
  {type:'window',id:'manual',x:100,y:67,floodExterior:true},
  {type:'window',id:'excluded',x:330,y:30,floodExterior:false}]);
 const m=Engine.buildModel(world([fl]));
 assert.deepEqual(m.floodPortals.map(p=>p.id),['manual']);
 assert.ok(wet(m,2,0,'one'));
 assert.equal(wet(m,2,0,'two'),true);
 assert.ok(Engine.floodDepthAt(m,0,310,70,2)>0);
});

test('sealed adjacent room floods simultaneously even behind a solid wall',()=>{
 const fl=floor(0,[room('a',20,20),room('b',160,20),
  {type:'window',id:'window',x:90,y:20},
  {type:'wall',id:'wall',x:160,y:20,x2:160,y2:120}]);
 const m=Engine.buildModel(world([fl]));
 assert.ok(wet(m,5,0,'a'));
 assert.equal(wet(m,5,0,'b'),true);
 assert.ok(Engine.floodDepthAt(m,0,170,60,5)>0); // common level across floor
});

test('a submerged external exit is blocked but a dry second-floor exit remains open',()=>{
 const f0=floor(0,[{...room('a',20,20),people:3},{type:'exit',id:'exit0',x:160,y:70}]);
 const f1=floor(1,[room('b',20,20),{type:'exit',id:'exit1',x:160,y:70}]);
 const m=Engine.buildModel(world([f0,f1],{floodMaxHeightMeters:2,floodRiseMetersPerSecond:0.5}));
 Engine.updateHazardBlocking(m,2);
 assert.equal(m.exits.find(e=>e.refId==='exit0').blockedReason,'rising-water');
 assert.ok(!m.exits.find(e=>e.refId==='exit1').blocked);
 const sim=Runner.createSimulation(m,{preMovement:30});
 sim.advance(2);
 assert.ok(sim.snapshot().floodPortalsActive>=1);
 assert.ok(sim.snapshot().floodedRooms>=1);
});

test('even legacy disabled setting cannot restore local radial flood',()=>{
 const m=Engine.buildModel(world([floor(0,[room('r',20,20),
  {type:'hazard',id:'h',x:55,y:65,radius:10,spread:true,maxRadius:15},
  {type:'exit',id:'x',x:160,y:70}])],{floodGroundRiseEnabled:false}));
 assert.equal(m.hazardSpread.length,0);
 assert.equal(at(m,100).floodedRoomCount,1);
});

test('UI and 3D use common water status, not local flame-like circles',()=>{
 const root=path.join(__dirname,'..','src');
 const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
 const three=fs.readFileSync(path.join(root,'scene3d.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.ok(app.includes('EvacSim.floodStatusAt(model,time)'));
 assert.ok(three.includes('floodStatusAt(this.model,t)'));
 assert.ok(html.includes('Водата залива целия етаж едновременно'));
 assert.ok(html.includes('required aria-describedby="floodHeightError"'));
 assert.ok(html.includes('exFloodMax'));
 assert.doesNotMatch(app,/addSelectField\(grid,'Външен отвор за наводнение'/); // no irrelevant per-opening flood control
});

test('all rooms and corridors share exactly the same time and depth on a flooded storey',()=>{
 const m=Engine.buildModel(world([floor(0,[room('a',20,20),room('b',230,20),
   {id:'wall',type:'wall',x:160,y:20,x2:160,y2:120},
   {id:'hall',type:'corridor',x:440,y:20,w:140,h:100}]),
   floor(1,[room('upper',20,20)])],{floodMaxHeightMeters:2.5}));
 assert.equal(at(m,0).floodedRoomCount,0);
 assert.equal(at(m,1).floodedRoomCount,3);
 assert.ok(Math.abs(Engine.floodDepthAt(m,0,42,42,1)-Engine.floodDepthAt(m,0,285,42,1))<1e-12);
 assert.ok(Math.abs(Engine.floodDepthAt(m,0,45,42,1)-Engine.floodDepthAt(m,0,485,42,1))<1e-12);
 assert.equal(at(m,1000).floodedRoomCount,3);
 assert.equal(at(m,1000).level,2.5);
 assert.equal(Engine.floodDepthAt(m,1,45,42,1000),0);
});

test('missing maximum flood height never silently substitutes a default',()=>{
 const cfg=D.normalize({scenario:'flood',floodGroundRiseEnabled:false,floodMaxHeightMeters:null});
 assert.equal(cfg.floodGroundRiseEnabled,true);
 assert.equal(cfg.floodMaxHeightMeters,null);
 assert.equal(D.waterLevel(cfg,1000),0);
 assert.equal(D.normalize({scenario:'flood',floodMaxHeightMeters:''}).floodMaxHeightMeters,null);
 assert.equal(D.normalize({scenario:'flood',floodMaxHeightMeters:-2}).floodMaxHeightMeters,null);
 const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
 const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
 assert.match(html,/id="exFloodMax"[^>]*required/);
 assert.ok(app.includes("if(scenario==='flood'){\n    const field=$('exFloodMax');"));
});
