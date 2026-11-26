'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../src/simulation-engine.js');
const Sim = require('../src/simulation-runner.js');

// A corridor with two connected exits. Fire starts near the left exit but
// never comes close to the right exit because its maximum reach is 4 metres.
function corridorProject({x=175,y=175,maxRadius=4,safety=2,secondExit=true,scenario='fire',people=6}={}) {
  const items = [
    {id:'hall',type:'corridor',name:'Коридор',x:100,y:100,w:400,h:100},
    {id:'people',type:'people',name:'Група',x:240,y:150,count:people},
    {id:'left',type:'exit',name:'Ляв изход',x:100,y:150,width:1.2},
    {id:'flame',type:'hazard',x,y,radius:6,spread:true,maxRadius,spreadSpeed:1}
  ];
  if (secondExit) items.splice(3,0,{id:'right',type:'exit',name:'Десен изход',x:540,y:150,width:1.2});
  return {format:'evacuation-simulator',settings:{scenario,pxPerMeter:25,preMovement:0,
    spreadSpeed:1,fireSpreadMultiplier:1,fireExposureLimitSeconds:200,
    fireExitSafetyMeters:safety,populationProfiles:{children:0,older:0,limited:0}},
  floors:[{id:'floor',items}]};
}

function simulate(project,maxTime=60) {
  const m=Engine.buildModel(project);
  const s=Sim.createSimulation(m,{preMovement:0,timeout:maxTime});
  let state=s.snapshot();
  for (let i=0;i<maxTime*4 && !s.finished;i++) state=s.advance(.25);
  return {m,s,state};
}

test('изход на под 2 метра от огъня е опасен още при старта и се избира друг',()=>{
  const m=Engine.buildModel(corridorProject({x:130,y:165}));
  assert.equal(m.exits[0].blocked,true);
  assert.equal(m.exits[0].blockedReason,'fire-near');
  assert.equal(m.exits[1].blocked,false);
  assert.equal(m.nodes.get(m.groups[0].route.exitId).label,'Десен изход');
  assert.equal(Engine.fireNearExit(m,m.exits[0],0),true);
});

test('по време на движение хората изоставят опасния изход и използват алтернативата',()=>{
  const model=Engine.buildModel(corridorProject());
  assert.equal(model.nodes.get(model.groups[0].route.exitId).label,'Ляв изход');
  const sim=Sim.createSimulation(model,{preMovement:0,timeout:60});
  let state=sim.snapshot(), switched=false;
  for (let i=0;i<200 && !sim.finished;i++) {
    state=sim.advance(.25);
    if (state.reroutes && !switched) {
      switched=true;
      assert.equal(model.exits[0].blockedReason,'fire-near');
      assert.equal(model.exits[1].blocked,false);
      assert.ok(sim.agents.every(a=>a.legs.at(-1).toNode==='f0:exit:right'));
    }
  }
  assert.equal(switched,true);
  assert.equal(state.safe,6);
  assert.equal(state.noRoute,0);
  assert.ok(state.reroutes>=6);
  assert.equal(state.blockedExits[0].reason,'fire-near');
});

test('при липса на алтернативен изход хората не се броят като евакуирани',()=>{
  const {s,state}=simulate(corridorProject({x:130,y:165,secondExit:false}),30);
  assert.equal(state.safe,0);
  assert.equal(state.noRoute,6);
  assert.ok(s.agents.every(a=>a.state==='no-route'));
});

test('пожар зад стена не блокира геометрично близък, но недостъпен изход',()=>{
  const p={format:'evacuation-simulator',settings:{scenario:'fire',pxPerMeter:25,preMovement:0,fireExitSafetyMeters:2},floors:[{id:'f',items:[
    {id:'first',type:'room',x:10,y:20,w:100,h:100},
    {id:'second',type:'room',x:120,y:20,w:100,h:100,people:1},
    {id:'wall',type:'wall',x:115,y:0,x2:115,y2:150},
    {id:'exit',type:'exit',x:125,y:70},
    {id:'fire',type:'hazard',x:110,y:70,radius:5,spread:true,spreadSpeed:1,maxRadius:20}
  ]}]};
  const m=Engine.buildModel(p);
  assert.equal(m.hazardSpread[0].exits.length,0);
  assert.equal(m.exits[0].blocked,false);
  Engine.updateHazardBlocking(m,60);
  assert.equal(m.exits[0].blocked,false);
  assert.equal(m.groups[0].route.exitId,m.exits[0].id);
});

test('настройката за близост променя момента, когато изходът се отбелязва като опасен',()=>{
  const at2=Engine.buildModel(corridorProject({x:175,y:175,safety:2}));
  const at4=Engine.buildModel(corridorProject({x:175,y:175,safety:4}));
  assert.equal(at2.exits[0].blocked,false);
  assert.equal(at4.exits[0].blocked,true);
  Engine.updateHazardBlocking(at2,1.25);
  assert.equal(at2.exits[0].blocked,true);
});

test('при земетресение не се прилага противопожарна близост',()=>{
  const m=Engine.buildModel(corridorProject({x:130,y:165,scenario:'quake'}));
  assert.equal(!!m.exits[0].blocked,false);
  assert.equal(Engine.fireNearExit(m,m.exits[0],0),false);
});

test('затворена противопожарна врата забавя и предупреждението за опасен изход',()=>{
  function twoRooms(closed) {
    return {format:'evacuation-simulator',settings:{scenario:'fire',pxPerMeter:25,
      fireExitSafetyMeters:2,fireSpreadMultiplier:1,spreadSpeed:3},floors:[{id:'f',items:[
      {id:'first',type:'room',x:10,y:20,w:100,h:100},
      {id:'second',type:'room',x:120,y:20,w:100,h:100},
      {id:'wall',type:'wall',x:115,y:10,x2:115,y2:135},
      {id:'door',type:'door',x:115,y:70,fireDoorClosed:closed},
      {id:'exit',type:'exit',x:210,y:70},
      {id:'flame',type:'hazard',x:60,y:70,radius:8,spread:true,spreadSpeed:3,maxRadius:80}
    ]}]};
  }
  const open=Engine.buildModel(twoRooms(false));
  const closed=Engine.buildModel(twoRooms(true));
  Engine.updateHazardBlocking(open,1.5);
  Engine.updateHazardBlocking(closed,1.5);
  assert.equal(open.exits[0].blockedReason,'fire-near');
  assert.equal(closed.exits[0].blocked,false);
  Engine.updateHazardBlocking(closed,6.9);
  assert.equal(closed.exits[0].blockedReason,'fire-near');
});
