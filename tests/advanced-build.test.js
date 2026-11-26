'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../src/simulation-engine.js');
const Materials = require('../src/material-library.js');
const Library = require('../src/building-library.js');
const Sim = require('../src/simulation-runner.js');

const rect = (id,x,y,w,h,people=0,materialId='standard') =>
  ({id,type:'room',x,y,w,h,name:id,people,materialId,width:1.8});
const p = (items,scenario='fire') => ({format:'evacuation-simulator',
  settings:{pxPerMeter:25,scenario,walkSpeed:1.25,preMovement:0,fireSpreadMultiplier:1},
  floors:[{id:'f',name:'Етаж 1',items}]});
function roomArrival(material,scenario='fire',overlay=false) {
  const items = [rect('a',10,20,100,100,0,'standard'),rect('b',120,20,100,100,0,material),
    {id:'d',type:'door',x:115,y:70,width:1.4},
    {id:'f',type:'hazard',x:60,y:70,radius:9,spread:true,spreadSpeed:0.9,maxRadius:100}];
  if (overlay) items.push({id:'s',type:'surface',x:125,y:25,w:95,h:95,materialId:'carpet'});
  const model=Engine.buildModel(p(items,scenario));
  const spread = scenario==='fire' ? model.hazardSpread[0] : model.hazardSpread[0];
  return {time: spread.arrivals.find(x=>x.nodeId==='f0:space:b').time, model};
}

test('ten selectable advanced build materials include a neutral legacy baseline', () => {
  assert.equal(Object.keys(Materials.MATERIALS).length,10);
  assert.equal(Materials.DEFAULT,'standard');
  assert.equal(Materials.spread('standard','fire'),1);
  assert.equal(Materials.speed('standard','flood'),1);
  assert.equal(Materials.get('unknown').name,Materials.get('standard').name);
});

test('wood propagates fire faster than concrete without allowing wall penetration', () => {
  const wood=roomArrival('wood'), concrete=roomArrival('concrete');
  assert.ok(wood.time<concrete.time, `wood ${wood.time} < concrete ${concrete.time}`);
  const items=[rect('a',10,20,100,100),rect('b',120,20,100,100),
    {id:'f',type:'hazard',x:60,y:70,radius:9,spread:true,spreadSpeed:1,maxRadius:100}];
  assert.equal(Engine.buildModel(p(items)).hazardSpread[0].arrivals.find(a=>a.nodeId==='f0:space:b'),undefined);
});

test('drawn material patch overrides default room surface in a sufficiently covered area',()=>{
  const {model}=roomArrival('standard','fire',true);
  assert.equal(model.nodes.get('f0:space:b').materialId,'carpet');
  assert.equal(model.nodes.get('f0:space:a').materialId,'standard');
  assert.ok(roomArrival('standard','fire',true).time<roomArrival('standard').time);
});

test('material properties affect walking speed in flood and quake scenarios',()=>{
  const items=[rect('r',10,30,160,120,8,'tile'),
    {id:'e',type:'exit',x:162,y:85,width:2.0}];
  const wet=Engine.buildModel(p(items,'flood'));
  const dry=Engine.buildModel(p(items,'quake'));
  const wetEdge=wet.edges.find(e=>e.kind==='exit');
  const dryEdge=dry.edges.find(e=>e.kind==='exit');
  assert.ok(wetEdge.speedFactor<dryEdge.speedFactor);
  const sim=Sim.createSimulation(wet,{preMovement:0,timeout:300});
  while(!sim.finished && sim.time<300) sim.advance(1);
  assert.equal(sim.snapshot().safe,8);
});

test('library offers 15 presets and all generate evacuation models with routes',()=>{
  assert.equal(Library.PRESETS.length,15);
  for (const preset of Library.PRESETS) {
    const m=Engine.buildModel(Library.generate({preset:preset.id,seed:123}),{scenario:'quake'});
    assert.ok(m.groups.length>0,preset.id);
    assert.ok(m.groups.some(g=>g.route),preset.id);
  }
});
