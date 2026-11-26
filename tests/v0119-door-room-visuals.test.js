'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Engine=require('../src/simulation-engine.js');
const Runner=require('../src/simulation-runner.js');
const Security=require('../src/security-incident.js');
const Scene=require('../src/scene3d.js');

const example=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/demo-security-interior-v0.11.8.evac.json'),'utf8'));
const frame=(sim,time)=>{
 while(!sim.finished&&sim.time<time-1e-9)sim.advance(Math.min(.5,time-sim.time));
 return sim.snapshot();
};

test('occupied rooms close their existing door leaves progressively, without changing the project',()=>{
 const project=example(),original=JSON.stringify(project.floors);
 const model=Engine.buildModel(project);
 const before=Security.doorPositions(model,0,project.settings);
 const during=Security.doorPositions(model,.7,project.settings);
 const after=Security.doorPositions(model,2,project.settings);
 assert.deepEqual(before.map(d=>d.id),['door-101','door-102']);
 assert.ok(before.every(d=>d.progress===0&&d.status==='open'));
 assert.ok(during.every(d=>d.progress>0&&d.progress<1&&d.status==='closing'));
 assert.ok(after.every(d=>d.progress===1&&d.closed&&d.locked));
 assert.equal(JSON.stringify(project.floors),original);
});

test('door response is absent in an empty classroom and absent with visuals disabled',()=>{
 const project=example();project.floors[0].items.find(i=>i.id==='room-102').people=0;
 const model=Engine.buildModel(project);
 assert.deepEqual(Security.doorPositions(model,10,project.settings).map(d=>d.id),['door-101']);
 assert.deepEqual(Security.doorPositions(model,10,{...project.settings,securityRoomVisualsEnabled:false}),[]);
 assert.deepEqual(Security.doorPositions(model,10,{...project.settings,securityEnhancedEnabled:false}),[]);
});

test('actual classroom furniture animates nearer the entrance zone without creating new items',()=>{
 const project=example(),orig=JSON.stringify(project.floors);
 const model=Engine.buildModel(project);
 const init=Security.furniturePositions(model,0,project.settings);
 const mid=Security.furniturePositions(model,3,project.settings);
 const done=Security.furniturePositions(model,10,project.settings);
 assert.equal(done.length,init.length);
 assert.deepEqual(done.map(v=>v.id),init.map(v=>v.id));
 assert.ok(done.filter(v=>v.adjusted).length>=2);
 assert.ok(mid.some((v,i)=>v.x!==init[i].x||v.y!==init[i].y));
 assert.ok(done.every(v=>{
   const space=model.floors[v.floor].spaces.find(s=>s.item.id===v.roomId);
   return !space||(v.x>=space.rect.x&&v.y>=space.rect.y&&v.x+v.w<=space.rect.x+space.rect.w&&v.y+v.h<=space.rect.y+space.rect.h);
 }));
 assert.equal(JSON.stringify(project.floors),orig,'no geometry mutations');
});

test('the figures follow existing moving desks for display, and their simulation positions remain untouched',()=>{
 const project=example(),model=Engine.buildModel(project),sim=Runner.createSimulation(model);
 const start=sim.agents.map(a=>({id:a.id,x:a.x,y:a.y,state:a.state}));
 const st=frame(sim,4);
 assert.equal(st.securityDoors.filter(d=>d.locked).length,2);
 assert.ok(st.securityPeople.length>=2,'existing figures are used for the visual');
 const ids=new Set(sim.agents.map(a=>a.id));
 assert.ok(st.securityPeople.every(a=>ids.has(a.id)&&a.state==='moving'));
 assert.ok(st.securityPeople.some(a=>{
  const simActor=sim.agents.find(b=>b.id===a.id);
  return Math.hypot(a.x-simActor.x,a.y-simActor.y)>5;
 }));
 assert.deepEqual(sim.agents.map(a=>({id:a.id,x:a.x,y:a.y,state:a.state})),
  start.map(a=>({...a,state:sim.agents.find(b=>b.id===a.id).state})));
 assert.deepEqual(Security.actorPositions(model,sim.agents,11,project.settings,st.securityFurniture),[]);
});

test('no doors are invented in plans with furniture but no placed entrance',()=>{
 const project=example();project.floors[0].items=project.floors[0].items.filter(i=>i.type!=='door');
 const model=Engine.buildModel(project);
 assert.deepEqual(Security.doorPositions(model,20,project.settings),[]);
 const furniture=Security.furniturePositions(model,6,project.settings);
 assert.ok(furniture.length>0);
 assert.ok(furniture.every(f=>f.originalX!=null&&f.originalY!=null));
});

test('different floors are kept independent and only real door ids appear',()=>{
 const project=example(),floor=JSON.parse(JSON.stringify(project.floors[0]));
 floor.id='floor-2';floor.items=floor.items.map(item=>({...item,id:'upper-'+item.id}));
 project.floors.push(floor);
 const model=Engine.buildModel(project),doors=Security.doorPositions(model,8,project.settings);
 assert.equal(doors.length,4);
 assert.equal(doors.filter(d=>d.floor===0).length,2);
 assert.equal(doors.filter(d=>d.floor===1).length,2);
});

test('software 3D door leaf changes shape as visual closing happens, without changing the building mesh',()=>{
 const ctx={createLinearGradient(){return {addColorStop(){}};},fillRect(){},beginPath(){},
  moveTo(){},lineTo(){},closePath(){},fill(){}};
 const canvas={clientWidth:480,clientHeight:310,width:0,height:0,getContext(type){return type==='2d'?ctx:null;}};
 const project=example(),model=Engine.buildModel(project),sim=Runner.createSimulation(model);
 const scene=new Scene.Scene3D(canvas);scene.setProject(project,model);
 let before,after;
 scene._drawSoftware=(meshes)=>{if(!before)before=meshes;else after=meshes;};
 const makeFrame=()=>({time:sim.time,state:sim.snapshot(),agents:sim.agents});
 scene.draw(makeFrame(),0);
 frame(sim,4);scene.draw(makeFrame(),4000);
 assert.ok(before[1].length>0,'doors are present in the dynamic door mesh');
 assert.notDeepEqual(before[1],after[1],'door leaves rotate and recolor during closing');
 assert.deepEqual(before[0],after[0],'building geometry is unchanged');
 assert.ok(after[5].length>0,'source furniture appears in the scene');
 scene.dispose();
});

test('a separate existing classroom figure approaches its door during closing, then returns',()=>{
 const p=example(),model=Engine.buildModel(p),sim=Runner.createSimulation(model);
 const base=sim.agents.find(a=>a.id===3);
 const approach=Security.actorPositions(model,sim.agents,1,p.settings,
   Security.furniturePositions(model,1,p.settings)).find(a=>a.id===3);
 const after=Security.actorPositions(model,sim.agents,3.3,p.settings,
   Security.furniturePositions(model,3.3,p.settings)).find(a=>a.id===3);
 const door=model.doorItems.find(d=>d.id==='door-101');
 assert.ok(approach,'door closing is visibly associated with a real figure');
 assert.ok(Math.hypot(approach.x-door.x,approach.y-door.y)<
   Math.hypot(base.x-door.x,base.y-door.y),'person moves toward the existing door');
 assert.equal(after,undefined,'person returns to the initial shelter animation');
});
