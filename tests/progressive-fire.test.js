'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/simulation-engine.js');
const Sim = require('../src/simulation-runner.js');

function plan({door=false,closed=false,people=0}={}) {
  const items=[
    {id:'a',type:'room',name:'A',x:10,y:10,w:160,h:160,people},
    {id:'b',type:'room',name:'B',x:180,y:10,w:160,h:160},
    {id:'wall',type:'wall',x:175,y:0,x2:175,y2:200},
    {id:'fire',type:'hazard',x:25,y:25,radius:8,spread:true,spreadSpeed:0.6,maxRadius:60}
  ];
  if(door)items.push({id:'door',type:'door',x:175,y:90,fireDoorClosed:closed});
  return {format:'evacuation-simulator',settings:{scenario:'fire',pxPerMeter:25,
    fireSpreadMultiplier:1,preMovement:100,fireExposureLimitSeconds:5,
    populationProfiles:{children:0,older:0,limited:0}},floors:[{id:'f',items}]};
}
const p=(model,t)=>E.firePatchesAt(model,model.hazardSpread[0],t);

test('огънят тръгва от точката, не оцветява цялата стая веднага',()=>{
  const m=E.buildModel(plan());
  const at0=p(m,0);
  assert.equal(at0.length,1);
  assert.equal(at0[0].x,25);
  assert.equal(at0[0].y,25);
  assert.equal(at0[0].radiusPx,8);
  assert.equal(E.pointInFirePatches(at0,0,30,30),true);
  assert.equal(E.pointInFirePatches(at0,0,135,135),false);
  const at5=p(m,5);
  const at10=p(m,10);
  assert.ok(at5[0].radiusPx>at0[0].radiusPx);
  assert.ok(at10[0].radiusPx>at5[0].radiusPx);
  assert.ok(at10[0].radiusPx<at10[0].maxRadiusPx);
});

test('огънят не навлиза в стая зад плътна стена и при голям радиус',()=>{
  const m=E.buildModel(plan());
  const late=p(m,500);
  assert.equal(late.length,1);
  assert.equal(E.pointInFirePatches(late,0,190,90),false);
  assert.equal(m.hazardSpread[0].fronts.some(f=>f.nodeId==='f0:space:b'),false);
});

test('след вратата новата стая се запалва постепенно от позицията на вратата',()=>{
  const m=E.buildModel(plan({door:true}));
  const b=m.hazardSpread[0].fronts.find(f=>f.nodeId==='f0:space:b');
  assert.ok(b);
  assert.equal(b.x,175);
  assert.equal(b.y,90);
  assert.ok(b.startTime>0);
  assert.equal(p(m,b.startTime-.1).some(f=>f.nodeId===b.nodeId),false);
  const just=p(m,b.startTime+.15).find(f=>f.nodeId===b.nodeId);
  assert.ok(just && just.radiusPx>0 && just.radiusPx<10);
  assert.equal(E.pointInFirePatches([just],0,260,90),false);
  const later=p(m,b.startTime+20).find(f=>f.nodeId===b.nodeId);
  assert.ok(later.radiusPx>just.radiusPx);
  assert.equal(E.pointInFirePatches([later],0,200,90),true);
});

test('затворената врата отлага появата на локалния фронт в съседната стая',()=>{
  const open=E.buildModel(plan({door:true}));
  const closed=E.buildModel(plan({door:true,closed:true}));
  const a=open.hazardSpread[0].fronts.find(f=>f.nodeId==='f0:space:b');
  const b=closed.hazardSpread[0].fronts.find(f=>f.nodeId==='f0:space:b');
  assert.ok(a && b && b.startTime>a.startTime+4);
  assert.equal(p(closed,a.startTime+1).some(f=>f.nodeId===b.nodeId),false);
});

test('излагането започва едва когато локалният фронт достигне човека',()=>{
  const proj=plan({people:1});
  // Place the person deterministically at the centre of the room.
  const random=Math.random;
  Math.random=()=>.5;
  let sim;
  try {sim=Sim.createSimulation(E.buildModel(proj),{preMovement:100,timeout:180});}
  finally {Math.random=random;}
  const agent=sim.agents[0];
  const start=sim.snapshot();
  assert.equal(start.inHazard,0);
  for(let i=0;i<3;i++)sim.advance(1);
  assert.equal(agent.fireExposureSeconds,0);
  assert.equal(sim.snapshot().fatal,0);
  for(let i=0;i<90 && !sim.finished;i++)sim.advance(1);
  assert.ok(agent.fireExposureSeconds>=5);
  assert.equal(agent.state,'fatal');
  assert.equal(agent.x,agent.spawnX);
  assert.equal(agent.y,agent.spawnY);
});
