'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../src/simulation-engine.js');
const S=require('../src/simulation-runner.js');
const D=require('../src/disaster-presets.js');
function room(id,x,y,people=0){return {type:'room',id,x,y,w:160,h:130,people};}
function project(scenario,settings={},floors){
 return {format:'evacuation-simulator',settings:{pxPerMeter:25,scenario,
  populationProfiles:{children:0,older:0,limited:0},...settings},
  floors:floors||[{name:'Партер',items:[room('a',40,50,3),{type:'exit',id:'out',x:192,y:110,width:1.4}]}]};
}
function stepTo(sim,at){while(sim.time+1e-7<at&&!sim.finished)sim.advance(Math.min(2,at-sim.time));return sim.snapshot();}

test('multiple independent fire sources, including different ignition times and floors',()=>{
 const p=project('fire',{scenarioCreatorEnabled:true,timelineEvents:[{type:'ignition',atSeconds:12,targetId:'fire-b'}]},[
  {name:'Партер',items:[room('r0',30,40,3),{type:'exit',id:'out',x:185,y:105,width:1.2},
    {type:'hazard',id:'fire-a',x:50,y:70,radius:8,spread:true,maxRadius:12}]},
  {name:'Етаж 2',items:[room('r1',30,40,3),{type:'hazard',id:'fire-b',x:60,y:90,radius:8,spread:true,maxRadius:12}]}
 ]);
 const m=E.buildModel(p);assert.equal(m.hazardSpread.length,2);
 assert.equal(m.smokeSpread.length,2);
 assert.deepEqual(m.hazardSpread.map(f=>f.startAt),[0,12]);
 assert.ok(E.firePatchesAt(m,m.hazardSpread[0],6).length);
 assert.deepEqual(E.firePatchesAt(m,m.hazardSpread[1],6),[]);
 assert.ok(E.firePatchesAt(m,m.hazardSpread[1],14).length);
});

test('ground water rises over time, stops at the cap and respects floor height',()=>{
 const s={floodGroundRiseEnabled:true,floodRiseMetersPerSecond:.2,floodMaxHeightMeters:3.5,
   floodStartSeconds:5,floorHeight:3};
 assert.equal(D.waterLevel(s,3),0);
 assert.equal(D.waterLevel(s,10),1);
 assert.equal(D.waterLevel(s,50),3.5);
 assert.equal(D.waterDepth(s,1,50),.5);
 assert.equal(D.waterDepth(s,2,50),0);
 assert.equal(D.waterLevel({},200),0);
});

test('ground rising flood closes submerged exit during live simulation',()=>{
 const p=project('flood',{floodGroundRiseEnabled:true,floodRiseMetersPerSecond:.25,
   floodMaxHeightMeters:2,preMovement:30});
 const model=E.buildModel(p),sim=S.createSimulation(model,{preMovement:30});
 assert.equal(sim.snapshot().waterLevelMeters,0);
 const atTwo=stepTo(sim,2);assert.ok(atTwo.waterLevelMeters>.4);
 const atFour=stepTo(sim,4);assert.equal(atFour.blockedExits.length,1);
 assert.equal(atFour.blockedExits[0].reason,'rising-water');
 assert.ok(atFour.inHazard>0);
 assert.equal(atFour.safe,0);
});

test('quake preset behavior changes at specified magnitude boundaries',()=>{
 assert.equal(D.quakePolicy({quakeMagnitude:2.5},0,40,12),'temporary-cover');
 assert.equal(D.quakePolicy({quakeMagnitude:2.5},0,5,12),'evacuate-after-shaking');
 assert.equal(D.quakePolicy({quakeMagnitude:4.5},1,5,12),'stay-sheltered');
 assert.equal(D.quakePolicy({quakeMagnitude:4.5},0,5,12),'evacuate-after-shaking');
 assert.equal(D.quakePolicy({quakeMagnitude:6.2},1,5,12),'evacuate-after-shaking');
});

test('at magnitude 4.5 upper-floor occupants remain sheltered and are not counted as evacuated',()=>{
 const floors=[{name:'Партер',items:[room('bottom',30,30),{id:'out',type:'exit',x:180,y:100,width:1.5},
  {id:'st0',type:'stairs',x:70,y:100,width:1.3,shaft:'S'}]},
  {name:'Етаж 2',items:[room('upper',30,30,4),{id:'st1',type:'stairs',x:70,y:100,width:1.3,shaft:'S'}]}];
 const m=E.buildModel(project('quake',{quakeMagnitude:4.5,quakeShakingSeconds:7},floors));
 const sim=S.createSimulation(m,{preMovement:0});
 const state=stepTo(sim,15);
 assert.equal(state.sheltered,4);
 assert.equal(state.safe,0);
 assert.equal(state.finished,true);
});

test('magnitude 8+ conditional collapse occurs at user second, with non-graphic no-route status',()=>{
 const m=E.buildModel(project('quake',{quakeMagnitude:8.4,quakeCollapseEnabled:true,
   quakeCollapseAtSeconds:8,quakeShakingSeconds:15}));
 const sim=S.createSimulation(m,{preMovement:0});
 assert.equal(stepTo(sim,6).buildingCollapsed,false);
 const st=stepTo(sim,8);
 assert.equal(st.buildingCollapsed,true);
 assert.equal(st.noRoute,3);
 assert.equal(st.safe,0);
 assert.equal(st.finished,true);
 assert.ok(sim.agents.every(a=>a.routeReason.includes('срутване')));
 assert.equal(D.collapseAt({quakeMagnitude:7.9,quakeCollapseEnabled:true}),Infinity);
});

test('collapse remains viewable at selected time even after occupants evacuate beforehand',()=>{
 const m=E.buildModel(project('quake',{quakeMagnitude:8.5,quakeCollapseEnabled:true,
   quakeCollapseAtSeconds:20,quakeShakingSeconds:2}));
 const sim=S.createSimulation(m,{preMovement:0});
 const st=stepTo(sim,20);
 assert.equal(st.buildingCollapsed,true);
 assert.ok(st.safe>=0);
});

test('multiple stationary threat markers activate at configured times; phone call is only a UI event',()=>{
 const p=project('lockdown',{threatHelpCallEnabled:true,threatHelpCallAtSeconds:10},[
  {name:'Партер',items:[room('r',30,30,2),
   {type:'threat',id:'first',x:60,y:50,entryAtSeconds:0},
   {type:'threat',id:'second',x:130,y:50,entryAtSeconds:15}]}
 ]);
 const model=E.buildModel(p);assert.equal(model.threatMarkers.length,2);
 const sim=S.createSimulation(model,{preMovement:0});
 assert.equal(sim.snapshot().threatMarkersActive,1);
 assert.equal(stepTo(sim,11).helpCall,true);
 assert.equal(stepTo(sim,16).threatMarkersActive,2);
 assert.equal(sim.snapshot().total,2);
 assert.equal(sim.agents.length,2); // threat markers aren't civilian agents
});

test('disaster settings are present in actual UI, renderer and object editor',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
 const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
 const scene=fs.readFileSync(path.join(__dirname,'../src/scene3d.js'),'utf8');
 for(const id of ['exFloodRise','exFloodMax','exQuakeMagnitude','exQuakeCollapse','exCollapseAt','exHelpCall','addFireIgnition','addThreatMarker'])
   assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(app.includes('EvacSim.floodStatusAt')); // v0.10.5: only exterior-connected rooms are wet
 assert.ok(app.includes('renderScenarioExtras();'));
 assert.ok(scene.includes('collapseMesh(this.staticOpaque)'));
 assert.ok(scene.includes('floodStatusAt(this.model,t')); // 3D uses the same exterior flood status
});

test('help call is shown only if an adult participant exists',()=>{
 const p=project('lockdown',{threatHelpCallEnabled:true,threatHelpCallAtSeconds:6,
    populationProfiles:{children:100,older:0,limited:0}},[
    {name:'Тестова стая',items:[room('r',20,30,2)]}]);
 const sim=S.createSimulation(E.buildModel(p),{preMovement:0,shelterAfter:20});
 const st=stepTo(sim,9);assert.equal(st.helpCall,false);assert.equal(st.helpCallerId,null);
});
