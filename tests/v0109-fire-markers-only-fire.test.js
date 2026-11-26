'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Engine = require('../src/simulation-engine.js');
const Validator = require('../src/plan-validator.js');
const Library = require('../src/building-library.js');

const appSource = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const sceneSource = fs.readFileSync(path.join(__dirname, '../src/scene3d.js'), 'utf8');
const visibilityFunction = appSource.match(/function isItemVisibleInScenario\(item, scenario\) \{[^}]*\}/);
assert.ok(visibilityFunction, '2D visibility helper must exist');
const visible = vm.runInNewContext(`(${visibilityFunction[0]})`);
const items = [
  {id:'room',type:'room',x:20,y:20,w:150,h:130,people:5},
  {id:'door',type:'door',x:170,y:90,width:1.2},
  {id:'exit',type:'exit',x:170,y:90,width:1.2},
  {id:'fire',type:'hazard',name:'Огнище (тест)',x:70,y:70,radius:15,spread:true,spreadSpeed:.2,maxRadius:40}
];
const project = scenario => ({format:'evacuation-simulator',settings:{scenario,pxPerMeter:25,
  floodGroundRiseEnabled:false,floodMaxHeightMeters:4,floodRiseMetersPerSecond:.2},
  floors:[{name:'Първи етаж',items:structuredClone(items)}]});

test('2D only shows fire markers for fire; all non-fire scenarios keep rooms/exits visible',()=>{
  for(const scenario of ['quake','flood','lockdown']){
    assert.equal(visible(items[3],scenario),false,scenario);
    assert.deepEqual(items.filter(item=>visible(item,scenario)).map(item=>item.type),['room','door','exit']);
  }
  assert.equal(visible(items[3],'fire'),true);
});

test('drawing, selection and size handles all respect the same fire marker visibility',()=>{
  assert.match(appSource,/isItemVisibleInScenario\(item, project\.settings\.scenario\)\)\.forEach/);
  assert.match(appSource,/if \(!isItemVisibleInScenario\(item, project\.settings\.scenario\)\) continue;/);
  assert.match(appSource,/if \(!item \|\| !isItemVisibleInScenario\(item, project\.settings\.scenario\)\) return;/);
  assert.match(appSource,/button\.disabled = !fireScenario;/);
  assert.match(sceneSource,/if\(!state && scenario==='fire'\)/);
});

test('pre-existing fire source remains in project but does not affect flood or quake',()=>{
  for(const scenario of ['quake','flood','lockdown']){
    const p=project(scenario);
    const model=Engine.buildModel(p);
    assert.equal(p.floors[0].items.some(x=>x.type==='hazard'),true,'stored marker remains');
    assert.equal(model.hazardSpread.length,0,scenario);
    assert.equal(model.hazardSources.length,0,scenario);
    assert.equal(model.floors[0].hazards.length,0,scenario);
  }
  const fire=Engine.buildModel(project('fire'));
  assert.equal(fire.hazardSpread.length,1);
  assert.equal(fire.hazardSources.length,1);
});

test('validator checks flame location only for fire scenarios',()=>{
  const remote={...items[3],x:850,y:530};
  const p=project('fire');p.floors[0].items[3]=remote;
  assert.ok(Validator.validate(p).issues.some(i=>i.code==='hazard-detached'));
  for(const scenario of ['quake','flood','lockdown']){
    p.settings.scenario=scenario;
    const issues=Validator.validate(p).issues;
    assert.ok(!issues.some(i=>i.code==='hazard-detached'||i.code==='hazard-trapped'||i.code==='no-hazard'),scenario);
  }
});

test('new library flood templates do not generate obsolete fire-origin symbols',()=>{
  const p=Library.generate({preset:'school',seed:43,hazard:'flood'});
  assert.equal(p.settings.scenario,'flood');
  assert.equal(p.floors.flatMap(f=>f.items).filter(x=>x.type==='hazard').length,0);
  const fire=Library.generate({preset:'school',seed:43,hazard:'fire'});
  assert.ok(fire.floors.flatMap(f=>f.items).some(x=>x.type==='hazard'));
});
