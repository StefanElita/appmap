'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../src/simulation-engine.js');
const S=require('../src/simulation-runner.js');
const Security=require('../src/security-incident.js');
const Scene=require('../src/scene3d.js');
const root=path.join(__dirname,'..');
const quakeProject=(withFurniture=true,withExit=true)=>({
  format:'evacuation-simulator',
  settings:{scenario:'quake',pxPerMeter:25,quakeShakingSeconds:12,
    preMovement:0,populationProfiles:{children:0,older:0,limited:0}},
  floors:[{name:'Етаж 1',items:[
    {id:'room',type:'room',x:40,y:40,w:220,h:180,people:1},
    {id:'person',type:'people',x:100,y:110,count:1},
    ...(withFurniture?[{id:'desk',type:'furniture',furnitureType:'desk',x:90,y:88,w:48,h:35}]:[]),
    ...(withExit?[{id:'exit',type:'exit',x:260,y:125,width:1.3}]:[])
  ]}]
});
function advanceTo(sim,t){while(sim.time+1e-8<t&&!sim.finished)sim.advance(Math.min(.25,t-sim.time));return sim.snapshot();}
test('new security scenario has a neutral starter marker location on the current floor',()=>{
  const floors=[
    {items:[{type:'room',x:30,y:40,w:200,h:120}]},
    {items:[{type:'room',x:80,y:55,w:100,h:90},
      {type:'corridor',x:90,y:200,w:400,h:70}]}];
  assert.deepEqual(Security.starterLocation(floors,0),{floor:0,x:130,y:100});
  assert.deepEqual(Security.starterLocation(floors,1),{floor:1,x:290,y:235});
  assert.deepEqual(Security.starterLocation([{items:[]}]),{floor:0,x:450,y:295});
  const app=fs.readFileSync(path.join(root,'src/app.js'),'utf8');
  assert.match(app,/function ensureSecurityMarker\(/);
  assert.match(app,/if\(next==='lockdown' && ensureSecurityMarker\(\)\)/);
  assert.match(app,/if \(ensureSecurityMarker\(\)\)/);
  assert.match(app,/scene3dController\.open\(\)/);
});
test('security marker remains an independent, red 3D figure before playback',()=>{
  const p={settings:{scenario:'lockdown',securityEnhancedEnabled:true},floors:[{items:[
    {id:'r',type:'room',x:60,y:60,w:250,h:180,people:0},
    {id:'t',type:'threat',x:120,y:120,entryAtSeconds:0}
  ]}]};
  const model=E.buildModel(p);
  assert.equal(model.threatMarkers.length,1);
  const drawn=[];
  const ctx={createLinearGradient(){return{addColorStop(){}}},fillRect(){},beginPath(){},
    moveTo(){},lineTo(){},closePath(){},fill(){}};
  const canvas={clientWidth:420,clientHeight:260,width:0,height:0,
    getContext(type){return type==='2d'?ctx:null}};
  const renderer=new Scene.Scene3D(canvas);
  renderer.setProject(p,model);
  renderer._drawSoftware=meshes=>drawn.push(meshes);
  renderer.draw(null,0);
  assert.ok(drawn.length>0);
  assert.ok(drawn[0][2].length>200, 'red marker creates an actual person mesh without civilian agents');
  assert.ok(drawn[0][4].length>100, 'red marker also creates the location beacon');
  renderer.dispose();
});
test('quake with nearby desk: begins motion DURING the shaking, then shelters',()=>{
  const prev=Math.random;Math.random=()=>.5;
  try{
    const sim=S.createSimulation(E.buildModel(quakeProject()));
    const agent=sim.agents.find(a=>a.groupLabel)||sim.agents[0];
    assert.equal(agent.quakeRefuge!=null,true);
    const start={x:agent.x,y:agent.y};
    const shaking=advanceTo(sim,.75);
    assert.equal(shaking.quakeShaking,true);
    assert.equal(agent.state,'moving');
    assert.ok(Math.hypot(agent.x-start.x,agent.y-start.y)>.5);
    advanceTo(sim,3);
    assert.equal(agent.state,'sheltering');
    assert.equal(agent.refugeKind,'under-desk');
    assert.equal(agent.started,false);
    advanceTo(sim,12);
    assert.equal(agent.started,true);
    assert.notEqual(agent.state,'sheltering');
  }finally{Math.random=prev;}
});
test('quake without furniture still shows cover posture immediately and no evacuation during shake',()=>{
  const prev=Math.random;Math.random=()=>.5;
  try{
    const sim=S.createSimulation(E.buildModel(quakeProject(false)));
    advanceTo(sim,.5);
    assert.ok(sim.agents.length>0);
    for(const a of sim.agents){
      assert.equal(a.state,'sheltering');
      assert.equal(a.refugeKind,'protective-shelter');
      assert.equal(a.started,false);
    }
    advanceTo(sim,12);
    assert.ok(sim.agents.some(a=>a.started));
  }finally{Math.random=prev;}
});
test('quake without an available exit still displays protection instead of terminating at t=0',()=>{
  const sim=S.createSimulation(E.buildModel(quakeProject(false,false)));
  assert.equal(sim.finished,false);
  assert.equal(sim.snapshot().noRoute,0);
  const middle=advanceTo(sim,4);
  assert.equal(middle.quakeShaking,true);
  assert.ok(sim.agents.every(a=>a.state==='sheltering'));
  const end=advanceTo(sim,20);
  assert.equal(end.quakeShaking,false);
  assert.equal(end.noRoute,sim.agents.length);
});
