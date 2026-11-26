'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../src/simulation-engine.js');
const Sim = require('../src/simulation-runner.js');

function project({door=false,closed=false,closeAt=0,opening=false,people=0,speed=1,radius=8,fireX=60}={}) {
  const items = [
    {id:'source',type:'room',name:'Горяща стая',x:10,y:20,w:100,h:100},
    {id:'other',type:'room',name:'Съседна стая',x:120,y:20,w:100,h:100,people},
    {id:'wall',type:'wall',x:115,y:10,x2:115,y2:135,thickness:.2},
    {id:'hazard',type:'hazard',x:fireX,y:70,radius,spread:true,spreadSpeed:speed,maxRadius:80}
  ];
  if (door || opening) items.push({id:'middle',type:opening?'opening':'door',x:115,y:70,width:1.2,fireDoorClosed:closed,fireDoorCloseAtSeconds:closeAt});
  items.push({id:'exit',type:'exit',x:210,y:70,width:1.2});
  return {format:'evacuation-simulator',settings:{scenario:'fire',pxPerMeter:25,preMovement:100,
    populationProfiles:{children:0,older:0,limited:0},fireExposureLimitSeconds:5},floors:[{id:'floor',items}]};
}
function arrival(m,id='other',type='fire') {
  const spread = type==='fire' ? m.hazardSpread[0] : m.smokeSpread[0];
  return spread.arrivals.find(a=>a.nodeId==='f0:space:'+id);
}

test('огънят не преминава през стена без врата (дори при голям радиус)', () => {
  const m=Engine.buildModel(project({radius:140,fireX:108}));
  assert.equal(arrival(m),undefined);
  assert.equal(arrival(m,'other','smoke'),undefined);
  const sim=Sim.createSimulation(m,{preMovement:100,timeout:100});
  assert.equal(sim.agents.length,0);
  const source = m.hazardSources[0];
  assert.equal(source.originNodeId,'f0:space:source');
  Engine.updateHazardBlocking(m,0);
  assert.equal(m.exits[0].blocked,false,'изходът зад стена не бива да се блокира по радиус');
});

test('стена с врата пропуска пожар, но затворена врата го забавя',()=>{
  const open=Engine.buildModel(project({door:true,speed:3}));
  const shut=Engine.buildModel(project({door:true,closed:true,speed:3}));
  assert.ok(arrival(open));
  assert.ok(arrival(shut).time>arrival(open).time+4);
  assert.ok(arrival(shut).time>=5);
  assert.ok(arrival(shut,'other','smoke').time===arrival(open,'other','smoke').time,
    'димът остава отделен от механизма на огнеустойчивата врата');
  assert.equal(shut.edges.filter(e=>e.kind==='door').every(e=>e.fireDoorClosed),true);
});

test('точно 5 s пауза, след това 20 s на 40%, после нормална скорост',()=>{
  const arrive=Engine.fireDoorArrival;
  assert.equal(arrive(0,2,0),10,'2 s нормално движение стават 5 s при 40% след 5 s задържане');
  assert.equal(arrive(0,10,0),27,'20 s на 40% дават 8 s нормален еквивалент');
  assert.equal(arrive(20,4,0),27,'при преминаване през границата 25 s скоростта става нормална');
  assert.equal(arrive(26,2,0),28,'след 25 s няма забавяне');
  assert.equal(arrive(2,1,10),3,'преди затваряне скоростта е нормална');
  assert.equal(arrive(10,1,10),17.5,'затваряне на 10 s: 5 s стоп и 2.5 s при 40%');
});

test('затваряне по-късно не променя огъня, който вече е преминал',()=>{
  const open=Engine.buildModel(project({door:true,speed:10}));
  const late=Engine.buildModel(project({door:true,closed:true,closeAt:10,speed:10}));
  assert.ok(arrival(open).time<10);
  assert.ok(Math.abs(arrival(open).time-arrival(late).time)<1e-9);
});

test('отвор без врата не се забавя от настройките за противопожарна врата',()=>{
  const a=Engine.buildModel(project({opening:true,closed:true}));
  const b=Engine.buildModel(project({opening:true,closed:false}));
  assert.ok(Math.abs(arrival(a).time-arrival(b).time)<1e-9);
});

test('човек в съседна стая не се счита за изложен само по радиус през стена',()=>{
  const m=Engine.buildModel(project({people:1,fireX:108,radius:140}));
  const sim=Sim.createSimulation(m,{preMovement:100,timeout:7});
  assert.equal(sim.snapshot().noRoute,0,'човекът има изход от своята стая');
  let state;
  for(let i=0;i<7;i++)state=sim.advance(1);
  assert.equal(state.fatal,0);
  assert.equal(state.inHazard,0);
  assert.equal(sim.agents[0].fireExposureSeconds,0);
});
