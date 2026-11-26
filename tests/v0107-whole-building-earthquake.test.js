'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const D=require('../src/disaster-presets.js');
const E=require('../src/simulation-engine.js');
const S=require('../src/simulation-runner.js');
const {Scene3D}=require('../src/scene3d.js');

const project=(magnitude,extra={})=>({format:'evacuation-simulator',settings:{scenario:'quake',
  pxPerMeter:25,floorHeight:3.2,quakeMagnitude:magnitude,quakeShakingSeconds:12,
  populationProfiles:{children:0,older:0,limited:0},...extra},floors:[
  {name:'Партер',items:[{type:'room',id:'a',x:40,y:40,w:180,h:140,people:2},
    {type:'exit',id:'out',x:215,y:110,width:1.5}]},
  {name:'Втори етаж',items:[{type:'room',id:'b',x:40,y:40,w:180,h:140,people:1}]}]});
const stepTo=(sim,seconds)=>{while(sim.time+1e-7<seconds&&!sim.finished)sim.advance(Math.min(2,seconds-sim.time));return sim.snapshot();};

test('magnitude 9 and 10 automatically select 300 s or 180 s, rounded at 9.5',()=>{
  for(const [m,sec] of [[9,300],[9.4,300],[9.49,300],[9.5,180],[9.6,180],[9.9,180],[10,180]]){
    assert.equal(D.collapseAt({quakeMagnitude:m,quakeCollapseEnabled:false,quakeCollapseAtSeconds:10}),sec,m);
    assert.equal(D.automaticCollapseAt({quakeMagnitude:m}),sec,m);
  }
  assert.equal(D.normalize({quakeMagnitude:10}).quakeMagnitude,10);
  assert.equal(D.collapseAt({quakeMagnitude:8.9,quakeCollapseEnabled:false}),Infinity);
  assert.equal(D.collapseAt({quakeMagnitude:8.9,quakeCollapseEnabled:true,quakeCollapseAtSeconds:123}),123);
  assert.equal(D.collapseAt({quakeMagnitude:7.9,quakeCollapseEnabled:true}),Infinity);
});

test('whole building shakes together, from time zero, without a radial room hazard',()=>{
  const before=D.quakeShakeAt({quakeMagnitude:10,quakeShakingSeconds:14},0);
  const moving=D.quakeShakeAt({quakeMagnitude:10,quakeShakingSeconds:14},2.2);
  const finished=D.quakeShakeAt({quakeMagnitude:10,quakeShakingSeconds:14},14);
  assert.equal(before.active,false);assert.equal(finished.active,false);
  assert.equal(moving.active,true);assert.ok(Math.abs(moving.x)+Math.abs(moving.z)>0);
  assert.deepEqual(D.quakeShakeAt({quakeMagnitude:10,quakeShakingSeconds:14},2.2),moving);
  const sim=S.createSimulation(E.buildModel(project(9.2)),{preMovement:0});
  assert.equal(sim.snapshot().quakeCollapseAtSeconds,300);
  assert.equal(stepTo(sim,2).quakeShaking,true);
  assert.equal(stepTo(sim,16).quakeShaking,false);
  assert.equal(sim.agents.length,3);
});

test('9.2 quake runs to 5:00 despite completed movement; 9.7 ends after 3:00',()=>{
  for(const [mag,second] of [[9.2,300],[9.7,180]]){
    const sim=S.createSimulation(E.buildModel(project(mag,{quakeShakingSeconds:3})),{preMovement:0});
    const first=stepTo(sim,second-1);
    assert.equal(first.buildingCollapsed,false);
    assert.equal(first.finished,false,'the record must not stop before its timed event');
    const last=stepTo(sim,second);
    assert.equal(last.buildingCollapsed,true);
    assert.equal(last.finished,true);
    assert.equal(last.quakeCollapseAtSeconds,second);
    assert.equal(last.time,second);
  }
});

test('3D software renderer applies the same world shake to building and people',()=>{
  const ctx={createLinearGradient(){return{addColorStop(){}};},fillRect(){},beginPath(){},
    moveTo(){},lineTo(){},closePath(){},fill(){}};
  const canvas={clientWidth:400,clientHeight:300,width:0,height:0,
    getContext(name){return name==='2d'?ctx:null;}};
  const scene=new Scene3D(canvas);
  const p=project(9.4,{quakeShakingSeconds:12});
  scene.setProject(p,E.buildModel(p));
  let captured;
  scene._drawSoftware=(meshes)=>{captured=meshes;};
  const frame=t=>({time:t,agents:[{id:1,x:90,y:90,floor:0,state:'waiting',profile:'adult'}],
    state:{time:t,scenario:'quake',spread:[],smoke:[]}});
  scene.draw(frame(0),0);const at0=captured.map(x=>x.slice());
  scene.draw(frame(2.2),2200);const at2=captured.map(x=>x.slice());
  const quake=D.quakeShakeAt(p.settings,2.2);
  // Assert identical offset is applied to a structural vertex and a person vertex.
  for(const meshIdx of [0,2]){
    assert.ok(at0[meshIdx].length>20);
    assert.ok(Math.abs(at2[meshIdx][0]-at0[meshIdx][0]-(quake.x+at0[meshIdx][1]*quake.tilt))<1e-5);
    assert.ok(Math.abs(at2[meshIdx][2]-at0[meshIdx][2]-quake.z)<1e-5);
  }
  scene.draw(frame(12),12000);const at12=captured.map(x=>x.slice());
  assert.deepEqual(at12[0],at0[0]);
  // Collapse has visible phases BEFORE the simulation ends at 5:00.
  scene.draw(frame(295),295000);const at295=captured.map(x=>x.slice());
  scene.draw(frame(297.5),297500);const at297=captured.map(x=>x.slice());
  scene.draw(frame(300),300000);const at300=captured.map(x=>x.slice());
  assert.equal(at295[0][1],at0[0][1]);
  assert.ok(Math.abs(at297[0][1])<Math.abs(at295[0][1]));
  assert.ok(Math.abs(at300[0][1])<Math.abs(at297[0][1]));
  scene.dispose();
});

test('quake UI shows fixed time at 9+, preserves optional collapse for 8–8.9',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
  const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
  assert.match(html,/id="exQuakeMagnitude"[^>]+max="10"/);
  assert.match(html,/id="quakeCollapseInfo"/);
  assert.match(app,/EvacDisasters\.automaticCollapseAt\(s\)/);
  assert.match(app,/\$\('exCollapseAt'\)\.disabled=autoCollapse/);
  assert.match(app,/svg\.style\.transform=quakeMotion/);
  assert.match(app,/ВСИЧКИ ЕТАЖИ/);
});

// Regression for the 2D editor: other tests normally don't import browser app.js.
test('browser editor JavaScript remains syntactically valid',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
  assert.doesNotThrow(()=>new vm.Script(js,{filename:'app.js'}));
});
