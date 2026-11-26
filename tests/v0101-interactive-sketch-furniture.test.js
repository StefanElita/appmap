'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const Sketch=require('../src/sketch-tools');const Nav=require('../src/furniture-navigation');
const Engine=require('../src/simulation-engine');const Runner=require('../src/simulation-runner');
const Scene=require('../src/scene3d');
const room={id:'room',type:'room',x:40,y:40,w:370,h:250,people:0,teachers:0};
const people={id:'people',type:'people',x:80,y:130,count:1};
const desk={id:'desk',type:'furniture',x:115,y:108,w:48,h:35,furnitureType:'desk'};
function project(scenario,withExit=true,items=[]){return {settings:{scenario,pxPerMeter:25,preMovement:12},floors:[{name:'F1',items:structuredClone([room,people,desk,...(withExit?[{id:'exit',type:'exit',x:410,y:170,width:1.2}]:[]),...items])}]};}
test('sketch tools snap manual door / exit to room boundary and allow manual groups',()=>{
 const regions=[{x:20,y:30,w:160,h:90,selected:true}];
 const door=Sketch.createMarker('door',{x:17,y:62},regions);
 const exit=Sketch.createMarker('exit',{x:82,y:27},regions);
 const group=Sketch.createMarker('people',{x:95,y:65},regions,{peopleCount:9});
 assert.equal(door.x,20);assert.equal(door.y,62);assert.equal(door.selected,true);
 assert.equal(exit.y,30);assert.equal(group.count,9);
 assert.equal(Sketch.nearestMarker({x:90,y:63},[group]),group);
});
test('manual sketch objects commit with coordinates and editable people counts',()=>{
 const mapper=r=>({x:r.x*2,y:r.y*2,w:r.w*2,h:r.h*2});
 const manual=[Sketch.createMarker('door',{x:40,y:40},[{x:40,y:40,w:90,h:75}]),
  Sketch.createMarker('exit',{x:130,y:80},[{x:40,y:40,w:90,h:75}])];
 const markers=[Sketch.createMarker('people',{x:64,y:70},[],{peopleCount:4}),
  {kind:'furniture',x:75,y:90,w:30,h:18,furnitureType:'desk'},
  {kind:'stairs',x:130,y:110}];
 const items=Sketch.toSceneItems(manual,markers,mapper,24,360);
 assert.deepEqual(items.map(i=>i.type),['door','exit','people','furniture','stairs']);
 assert.equal(items.find(i=>i.type==='people').count,4);
 assert.equal(items.find(i=>i.type==='people').x,128);
 assert.equal(items.find(i=>i.type==='furniture').w,60);
 assert.ok(items.every(i=>i.importedFromImage===true));
});
test('furniture visibility path never intersects the rectangular desk',()=>{
 const start={x:80,y:125,floor:0},end={x:240,y:125,floor:0};
 const path=Nav.findPath(start,end,[Object.assign({floor:0},desk)]);
 assert.ok(path.length>2,JSON.stringify(path));
 for(let i=1;i<path.length;i++)assert.equal(Nav.intersects(path[i-1],path[i],{x:desk.x-5,y:desk.y-5,w:desk.w+10,h:desk.h+10}),false);
});
test('real simulation adds a furniture detour on a spawn route',()=>{
 const old=Math.random;Math.random=()=>0.5;
 try{
  const model=Engine.buildModel(project('fire'));
  assert.equal(model.furnitureByFloor.get(0).length,1);
  const agent=Runner.createSimulation(model,{preMovement:0}).agents[0];
  assert.ok(agent.legs.some(leg=>leg.kind==='furniture-detour'),agent.legs.map(l=>l.kind).join(','));
 }finally{Math.random=old;}
});
test('earthquake agents briefly take cover under nearby desks and then continue',()=>{
 const old=Math.random;Math.random=()=>0.5;
 try{
  const sim=Runner.createSimulation(Engine.buildModel(project('quake')),{preMovement:12});
  assert.equal(sim.agents[0].refugeKind,'under-desk');
  sim.advance(2);assert.equal(sim.agents[0].state,'sheltering');
  assert.equal(sim.agents[0].goal,'exit');
  for(let i=0;i<90;i++)sim.advance(.5);
  assert.equal(sim.agents[0].state,'safe');
 }finally{Math.random=old;}
});
test('flood without route can use an elevated furniture waiting point without counting evacuation',()=>{
 const old=Math.random;Math.random=()=>0.5;
 try{
  const sim=Runner.createSimulation(Engine.buildModel(project('flood',false)),{preMovement:0});
  assert.equal(sim.agents[0].goal,'furniture-refuge');
  for(let i=0;i<90&&!sim.finished;i++)sim.advance(.5);
  assert.equal(sim.agents[0].state,'sheltered');
  assert.equal(sim.snapshot().safe,0);assert.equal(sim.snapshot().sheltered,1);
 }finally{Math.random=old;}
});
test('one desk has limited waiting capacity',()=>{
 const source=project('flood',false);source.floors[0].items.find(i=>i.id==='people').count=4;
 const old=Math.random;Math.random=()=>0.5;
 try{
  const sim=Runner.createSimulation(Engine.buildModel(source),{preMovement:0});
  assert.equal(sim.agents.filter(a=>a.goal==='furniture-refuge').length,1);
  assert.equal(sim.agents.filter(a=>a.state==='no-route').length,3);
 }finally{Math.random=old;}
});
test('threat marker is visually distinct but never becomes a simulated civilian or moving attacker',()=>{
 const p=project('lockdown',false,[{type:'threat',id:'warning',x:210,y:175,name:'Символ'}]);
 const model=Engine.buildModel(p);const sim=Runner.createSimulation(model);
 assert.equal(model.threatMarkers.length,1);
 assert.equal(sim.agents.length,1);
 assert.notEqual(Scene.personColors({id:99,state:'threat'}).shirt.join(','),Scene.personColors({id:99,state:'waiting'}).shirt.join(','));
});
test('sketch UI and new simulator modules are wired into correct page order',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
 const ui=fs.readFileSync(path.join(__dirname,'../src/smart-import-ui.js'),'utf8');
 const ids=['smartSketchToolbar','smartManualPeopleCount','smartSketchFurniture','smartUndo','smartManualObjects'];
 for(const id of ids)assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.indexOf('sketch-tools.js')<html.indexOf('smart-import-ui.js'));
 assert.ok(html.indexOf('furniture-navigation.js')<html.indexOf('simulation-runner.js'));
 assert.ok(ui.includes('Sketch.toSceneItems')&&ui.includes("this.sketchTool!=='room'"));
});
