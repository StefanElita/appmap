'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../src/simulation-engine.js');
const Sim = require('../src/simulation-runner.js');
const Scene = require('../src/scene3d.js');

function plan({scenario='fire', people=2, withExit=true, spread=true, initialRadius=12, settings={}}={}) {
  const items = [
    {id:'r1',type:'room',x:10,y:10,w:160,h:120,people,name:'Помещение'},
    {id:'f1',type:'hazard',x:25,y:75,radius:initialRadius,spread,spreadSpeed:.4,maxRadius:40}
  ];
  if(withExit) items.push({id:'e1',type:'exit',x:165,y:75,width:1.4});
  return {format:'evacuation-simulator', settings:{scenario,pxPerMeter:25,preMovement:100,
    populationProfiles:{children:0,older:0,limited:0},fireExposureLimitSeconds:5,...settings},
  floors:[{id:'fl',name:'Етаж 1',items}]};
}

test('fire defaults to 80% of original speed even for explicit hazard speed; smoke remains faster',()=>{
  const model=Engine.buildModel(plan());
  assert.ok(Math.abs(model.hazardSpread[0].speed-.32)<1e-9);
  assert.ok(model.smokeSpread[0].speed>model.hazardSpread[0].speed);
  assert.ok(Math.abs(Engine.buildModel(plan({settings:{fireSpreadMultiplier:1}})).hazardSpread[0].speed-.4)<1e-9);
  assert.equal(Engine.buildModel(plan({scenario:'flood'})).hazardSpread.length,0); // flood is now floor-wide
});

test('prolonged fire exposure creates fatal, immobile agents excluded from evacuated totals',()=>{
  const model=Engine.buildModel(plan({initialRadius:240}));
  const sim=Sim.createSimulation(model,{timeout:40});
  const initialPositions=sim.agents.map(a=>({x:a.x,y:a.y}));
  for(let t=0;t<4;t++){
    const state=sim.advance(1);
    assert.equal(state.fatal,0);
    assert.equal(state.safe,0);
    assert.equal(state.total,2);
  }
  const end=sim.advance(1);
  assert.equal(end.time,5);
  assert.equal(end.fatal,2);
  assert.equal(end.counts.fatal,2);
  assert.equal(end.safe,0);
  assert.equal(end.progress,0);
  assert.equal(end.inHazard,0); // live-exposure counters exclude terminal states
  assert.equal(end.groupStats[0].fatal,2);
  assert.equal(sim.finished,true);
  sim.agents.forEach((a,i)=>{
    assert.equal(a.state,'fatal');
    assert.equal(a.fatalAt,5);
    assert.equal(a.fireExposureSeconds,5);
    assert.deepEqual({x:a.x,y:a.y},initialPositions[i]);
  });
  assert.equal(sim.advance(2).fatal,2);
});

test('agent without a route remains in the fire simulation until the outcome is resolved',()=>{
  const model=Engine.buildModel(plan({withExit:false,people:1,initialRadius:240}));
  const sim=Sim.createSimulation(model);
  assert.equal(sim.snapshot().noRoute,1);
  assert.equal(sim.advance(1).noRoute,1);
  assert.equal(sim.finished,false);
  for(let i=0;i<4;i++)sim.advance(1);
  assert.equal(sim.snapshot().fatal,1);
  assert.equal(sim.snapshot().noRoute,0);
  assert.equal(sim.finished,true);
});

test('non-fire scenarios never produce fatalities from the same hazard item',()=>{
  const model=Engine.buildModel(plan({scenario:'quake',people:1}));
  const sim=Sim.createSimulation(model,{preMovement:0,timeout:120});
  while(!sim.finished)sim.advance(2);
  assert.equal(sim.snapshot().fatal,0);
  assert.equal(sim.snapshot().safe,1);
});

test('3D replay changes color/state at fatalAt and pins the final position',()=>{
  const history=[
    {state:{time:4,fatal:0}, agents:[{id:1,profile:'adult',x:10,y:10,floor:0,state:'moving',fatalAt:null}]},
    {state:{time:6,fatal:1}, agents:[{id:1,profile:'adult',x:14,y:14,floor:0,state:'fatal',fatalAt:5}]}
  ];
  const before=Scene.sampleAtTime(history,4.9).agents[0];
  assert.equal(before.state,'moving');
  const at=Scene.sampleAtTime(history,5).agents[0];
  assert.equal(at.state,'fatal');
  assert.equal(at.x,14);
  assert.equal(at.y,14);
  assert.equal(Scene.sampleAtTime(history,5.8).agents[0].x,14);
});
