'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('../src/simulation-runner.js');
const Engine = require('../src/simulation-engine.js');
const Library = require('../src/building-library.js');
const Dxf = require('../src/dxf-lite.js');

function project(items, scenario = 'quake', settings = {}) {
  return { format: 'evacuation-simulator', floors: [{ id: 'floor-0', name: 'Етаж 1', items }],
    settings: { pxPerMeter:25, scenario, walkSpeed:1.25, ...settings } };
}
function room(id, x, y, w=100, h=100, people=0) {
  return { id, type:'room', x, y, w, h, people, teachers:0, name:id, width:1.4 };
}
function run(model, timeout = 600) {
  const sim = Sim.createSimulation(model,{preMovement:0,timeout});
  let state = sim.snapshot();
  while(!sim.finished && sim.time < timeout) state = sim.advance(2);
  return {sim, state};
}

for (const preset of Library.PRESETS) {
  test('библиотека: ' + preset.title, () => {
    const m = Engine.buildModel(Library.generate({preset:preset.id, seed:42}),{scenario:'quake'});
    const {state} = run(m,600);
    assert.ok(m.groups.length);
    assert.ok(m.exits.length);
    assert.equal(state.safe,m.totalPeople);
    assert.equal(state.noRoute,0);
    assert.equal(state.finished,true);
    assert.equal(state.timedOut,false);
  });
}

test('димът е по-бърз от пожара и има отделни параметри', () => {
  const p = project([
    room('a',10,50,120,110,0), room('b',140,50,120,110,10),
    {id:'ab',type:'door',x:135,y:95,width:1.2},
    {id:'exit',type:'exit',x:255,y:95,width:1.2},
    {id:'fire',type:'hazard',x:30,y:110,radius:8,spread:true,spreadSpeed:0.15,maxRadius:40}
  ],'fire',{smokeFactor:3,smokeSlowdown:0.5,smokeVisibilityMeters:4});
  const m = Engine.buildModel(p);
  assert.equal(m.hazardSpread.length,1);
  assert.equal(m.smokeSpread.length,1);
  assert.ok(m.smokeSpread[0].speed > m.hazardSpread[0].speed);
  assert.equal(m.settings.smokeVisibilityMeters,4);
  const state = Sim.createSimulation(m,{preMovement:0}).snapshot();
  assert.ok(Array.isArray(state.smoke));
});

test('стена блокира автоматична връзка, изричен отвор я възстановява', () => {
  const items = [room('left',20,10,120,100,5), room('right',120,10,120,100),
    {id:'w',type:'wall',x:130,y:0,x2:130,y2:120,thickness:0.2},
    {id:'exit',type:'exit',x:235,y:55,width:1.2}];
  let m=Engine.buildModel(project(items));
  assert.equal(m.groups[0].status,'no-route');
  items.push({id:'open',type:'opening',x:130,y:55,width:1.1});
  m=Engine.buildModel(project(items));
  assert.equal(m.groups[0].status,'ok');
  assert.equal(run(m,250).state.safe,5);
});

test('зона за помощ отчита трудноподвижни като sheltered, НЕ като евакуирани', () => {
  const p=project([room('r',20,30,180,125,10),
    {id:'x',type:'exit',x:190,y:60,width:1.4},
    {id:'z',type:'safezone',x:80,y:90,width:1.2}],
    'quake',{populationProfiles:{children:0,older:0,limited:100},waitForAssistance:true});
  const m=Engine.buildModel(p);
  const {state,sim}=run(m,200);
  assert.equal(sim.agents[0].profile,'limited');
  assert.equal(state.safe,0);
  assert.equal(state.sheltered,10);
  assert.equal(state.progress,1);
});

test('асансьорът е изключен по подразбиране при пожар, разрешен за контраст', () => {
  const p={format:'evacuation-simulator',settings:{scenario:'fire',pxPerMeter:25},floors:[
    {name:'F0', items:[room('r0',20,20,140,100),{id:'exit',type:'exit',x:145,y:65,width:1.2},
      {id:'l0',type:'elevator',x:35,y:65,width:1.1,shaft:'L'}]},
    {name:'F1', items:[room('r1',20,20,140,100,5),{id:'l1',type:'elevator',x:35,y:65,width:1.1,shaft:'L'}]}
  ]};
  assert.equal(Engine.buildModel(p).groups[0].status,'no-route');
  const m=Engine.buildModel(p,{allowFireElevator:true});
  assert.equal(m.groups[0].status,'ok');
  assert.equal(run(m,250).state.safe,5);
});

test('общ двор свързва 2 сгради с външен изход',()=> {
  const items=[room('A',10,50,100,100,3),room('B',580,50,100,100,4),
    {id:'yard',type:'courtyard',x:130,y:40,w:430,h:120,width:3,name:'Общ двор'},
    {id:'da',type:'door',x:120,y:105,width:1.2},
    {id:'db',type:'door',x:570,y:105,width:1.2},
    {id:'gate',type:'exit',x:340,y:105,width:1.8}];
  const m=Engine.buildModel(project(items));
  assert.ok(m.groups.every(g=>g.route));
  assert.equal(run(m,250).state.safe,7);
});

test('вятър влияе върху времената на достигане в посоката', () => {
  const items=[room('left',5,45,100,100),room('center',110,45,100,100),room('right',215,45,100,100),
    {id:'d1',type:'door',x:107,y:95,width:1.2},
    {id:'d2',type:'door',x:212,y:95,width:1.2},
    {id:'out',type:'exit',x:305,y:90,width:1.2},
    {id:'fire',type:'hazard',x:160,y:90,radius:5,spread:true,spreadSpeed:0.2,maxRadius:80}];
  const a=Engine.buildModel(project(items,'fire',{windStrength:0.8,windDirection:0}));
  const b=Engine.buildModel(project(items,'fire',{windStrength:0.8,windDirection:180}));
  const ra=a.hazardSpread[0].arrivals.find(x=>x.nodeId==='f0:space:right');
  const rb=b.hazardSpread[0].arrivals.find(x=>x.nodeId==='f0:space:right');
  assert.ok(ra&&rb);
  assert.ok(ra.time<rb.time,'по посока на вятъра е по-бързо');
});

test('ASCII DXF разпознава правоъгълник и LINE, без зависимост', () => {
  const pairs = [
    [0,'SECTION'],[2,'ENTITIES'],
    [0,'LWPOLYLINE'],[90,4],[70,1],[10,0],[20,0],[10,100],[20,0],
    [10,100],[20,80],[10,0],[20,80],
    [0,'LINE'],[10,100],[20,0],[11,150],[21,0],
    [0,'ENDSEC'],[0,'EOF']
  ];
  const text=pairs.map(([a,b])=>a+'\n'+b).join('\n')+'\n';
  const r=Dxf.toPlan(text);
  assert.equal(r.rooms,1);
  assert.equal(r.walls,1);
  assert.equal(r.items.length,2);
  assert.throws(()=>Dxf.toPlan('bad DXF'),/DXF/);
});
