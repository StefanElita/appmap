'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Engine=require('../src/simulation-engine.js');
const Runner=require('../src/simulation-runner.js');
const Security=require('../src/security-incident.js');
const Scene=require('../src/scene3d.js');
const demo=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/demo-security-doors-v0.11.9.evac.json'),'utf8'));

function oneRoom(n){
 const p=demo();
 p.floors[0].items=p.floors[0].items.filter(item=>item.type!=='furniture'||false);
 const position=[
  [95,105],[166,125],[230,115],[98,170],
  [163,185],[235,185],[125,217],
  [215,215],[185,103]
 ];
 for(let i=0;i<n;i++)p.floors[0].items.push({id:'test-furn-'+i,
  type:'furniture',furnitureType:'desk',x:position[i][0],y:position[i][1],w:32,h:20});
 return p;
}
function moved(model,t,settings){return Security.furniturePositions(model,t,settings);}

for(const n of [0,1,2,3,4,7]){
 test(`visual furniture grouping chooses exactly ${Math.min(4,n)} existing items out of ${n}`,()=>{
  const p=oneRoom(n),source=JSON.stringify(p.floors),model=Engine.buildModel(p);
  const at0=moved(model,0,p.settings),final=moved(model,9,p.settings);
  assert.equal(final.length,n,'never invents additional furniture');
  assert.deepEqual(at0.map(f=>f.id),final.map(f=>f.id));
  const picked=final.filter(f=>f.movingActor);
  assert.equal(picked.length,Math.min(n,4));
  assert.equal(new Set(picked.map(f=>f.id)).size,picked.length);
  if(n>4){
   const d=model.doorItems.find(door=>door.id==='door-101');
   const distances=at0.map(f=>({id:f.id,d:Math.hypot(f.x+f.w/2-d.x,f.y+f.h/2-d.y)}));
   const closest=distances.sort((a,b)=>a.d-b.d||a.id.localeCompare(b.id)).slice(0,4).map(v=>v.id).sort();
   assert.deepEqual(picked.map(f=>f.id).sort(),closest,'select four closest by object center');
   assert.ok(final.filter(f=>!f.movingActor).every(f=>f.x===f.originalX&&f.y===f.originalY),
    'other furniture remains in its original place');
  }
  assert.equal(JSON.stringify(p.floors),source,'project layout remains intact');
 });
}

test('compact visual layout forms at most two rows next to the room entry while staying inside',()=>{
 const p=oneRoom(4),m=Engine.buildModel(p),items=moved(m,9,p.settings).filter(f=>f.movingActor);
 assert.equal(items.length,4);
 for(const f of items){
  assert.ok(f.x>=83&&f.y>=93&&f.x+f.w<=317&&f.y+f.h<=252,'inside room interior');
 }
 const byY=items.reduce((acc,f)=>{const y=f.y.toFixed(3);(acc[y]??=[]).push(f);return acc;},{});
 assert.equal(Object.keys(byY).length,2,'two compact rows');
 assert.deepEqual(Object.values(byY).map(row=>row.length).sort(),[2,2]);
 const nearestToEntry=Math.max(...items.map(f=>f.y+f.h));
 assert.ok(nearestToEntry>=251 && nearestToEntry<255,'group visually near entry with small inset');
 for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
  const a=items[i],b=items[j];
  const overlapping=(Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>0.01)&&
   (Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>0.01);
  assert.equal(overlapping,false,`${a.id}/${b.id} should not overlap`);
 }
});

test('four real agents participate in furniture animation; another person may close the door',()=>{
 const p=oneRoom(7),m=Engine.buildModel(p),sim=Runner.createSimulation(m);
 sim.advance(4);
 const f=sim.snapshot().securityFurniture;
 const actors=sim.snapshot().securityPeople;
 assert.equal(f.filter(v=>v.movingActor).length,4);
 const ids=new Set(sim.agents.map(a=>a.id));
 assert.ok(actors.length>=4);
 assert.equal(new Set(actors.map(a=>a.id)).size,actors.length,'each figure has only one visual pose');
 assert.ok(actors.every(a=>ids.has(a.id)));
 assert.ok(f.every(v=>v.originalX!==undefined&&v.originalY!==undefined));
});

test('software renderer receives the four repositioned source meshes',()=>{
 const p=oneRoom(7),m=Engine.buildModel(p),sim=Runner.createSimulation(m);
 sim.advance(9);
 const state=sim.snapshot();
 const ctx={createLinearGradient(){return {addColorStop(){}};},fillRect(){},beginPath(){},
  moveTo(){},lineTo(){},closePath(){},fill(){}};
 const canvas={clientWidth:500,clientHeight:340,width:0,height:0,
  getContext(type){return type==='2d'?ctx:null;}};
 const scene=new Scene.Scene3D(canvas);scene.setProject(p,m);
 let dynamicMesh=[];
 scene._drawSoftware=meshes=>{dynamicMesh=meshes[5]||[];};
 scene.draw({time:sim.time,state,agents:sim.agents},9000);
 assert.ok(dynamicMesh.length>0,'draws existing source furniture in 3D');
 assert.equal(state.securityFurniture.filter(f=>f.movingActor).length,4);
 scene.dispose();
});
