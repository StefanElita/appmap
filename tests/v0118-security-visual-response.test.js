'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../src/simulation-engine.js');
const Runner=require('../src/simulation-runner.js');
const S=require('../src/security-incident.js');
const Scene=require('../src/scene3d.js');

function fixture(){return {
 format:'evacuation-simulator',settings:{scenario:'lockdown',pxPerMeter:25,
  securityEnhancedEnabled:true,securityRoamEnabled:true,securityRoomVisualsEnabled:true,
  securityWarningAtSeconds:0,securityEmergencyAtSeconds:1,securityRoamPeriodSeconds:100,
  securityHelpConfirmSeconds:20,securityHelpArrivalSeconds:180},
 floors:[{name:'Етаж 1',items:[
  {id:'r1',type:'room',x:20,y:20,w:240,h:125,people:4},
  {id:'corr',type:'corridor',x:20,y:160,w:300,h:50},
  {id:'desk1',type:'furniture',furnitureType:'desk',x:35,y:45,w:38,h:25},
  {id:'desk2',type:'furniture',furnitureType:'desk',x:200,y:70,w:38,h:25},
  {id:'chair',type:'furniture',furnitureType:'chair',x:85,y:90,w:23,h:23},
  {id:'marker',type:'threat',x:70,y:184,entryAtSeconds:0},
  {id:'wall',type:'wall',x:105,y:159,x2:105,y2:212},
  {id:'exit',type:'exit',x:20,y:185,width:1.2}
 ]}]
};}

test('new incidents signal immediately and occupants show their initial protective state',()=>{
 const model=E.buildModel(fixture()),sim=Runner.createSimulation(model);
 const st=sim.snapshot();
 assert.equal(S.level({},0),'legacy');
 assert.equal(st.securityLevel,'warning');
 assert.equal(st.securityNotified,4);
 assert.equal(st.counts.sheltering,4);
 assert.ok(st.securityRooms.some(r=>r.id==='r1'));
 assert.ok(sim.agents.every(a=>a.state==='sheltering'&&a.securityAction==='shelter'));
});
test('actual placed furniture moves within the original occupied room; neither door nor source items change',()=>{
 const p=fixture(),saved=JSON.stringify(p.floors[0].items);
 const model=E.buildModel(p);
 const initial=S.furniturePositions(model,0,p.settings);
 const midway=S.furniturePositions(model,2,p.settings);
 const final=S.furniturePositions(model,5,p.settings);
 assert.equal(initial.length,3);
 assert.deepEqual(initial.map(f=>f.id),['desk1','desk2','chair']);
 assert.ok(initial.every(f=>f.x===f.originalX&&f.y===f.originalY));
 assert.ok(final.some(f=>f.x!==f.originalX||f.y!==f.originalY));
 assert.ok(midway.some((f,i)=>f.x!==initial[i].x));
 for(const f of final){
  assert.ok(f.x>=24&&f.y>=24&&f.x+f.w<=256&&f.y+f.h<=141,`out of room ${f.id}`);
 }
 assert.equal(JSON.stringify(p.floors[0].items),saved,'no edits to original plan');
 assert.deepEqual(S.furniturePositions(model,5,{...p.settings,securityRoomVisualsEnabled:false})
  .map(f=>[f.x,f.y]),initial.map(f=>[f.x,f.y]));
});
test('warning marker pauses before a drawn wall and turns back without crossing or seeking other rooms',()=>{
 const m=E.buildModel(fixture());
 const at=t=>S.markerPositions(m.threatMarkers,m.floors,t,m.settings)[0];
 const start=at(0),near=at(40),turn=at(65),back=at(85);
 assert.ok(start.x<105&&near.x<105&&turn.x<105&&back.x<105);
 assert.equal(near.motionStatus,'blocked');
 assert.equal(turn.motionStatus,'walking');
 assert.ok(back.x<turn.x,'reverses along same corridor');
 assert.equal(at(5).floor,0);
 assert.deepEqual(at(48),at(48),'deterministic frame');
});
test('the runner carries furniture snapshots for 2D and 3D replay at each sampled time',()=>{
 const sim=Runner.createSimulation(E.buildModel(fixture()));
 const original=sim.snapshot().securityFurniture;
 sim.advance(2);
 const moved=sim.snapshot().securityFurniture;
 assert.equal(original.length,3);
 assert.ok(moved.some((item,i)=>item.x!==original[i].x || item.y!==original[i].y));
 assert.ok(moved.every(item=>typeof item.originalX==='number'&&typeof item.originalY==='number'));
});
test('renderer draws movable existing furniture during educational incident without WebGL',()=>{
 const ctx={createLinearGradient(){return {addColorStop(){}};},fillRect(){},beginPath(){},
  moveTo(){},lineTo(){},closePath(){},fill(){}};
 const canvas={clientWidth:450,clientHeight:280,width:0,height:0,
  getContext(kind){return kind==='2d'?ctx:null;}};
 const p=fixture(),m=E.buildModel(p),sim=Runner.createSimulation(m);
 sim.advance(2);
 const st=sim.snapshot(),scene=new Scene.Scene3D(canvas);
 scene.setProject(p,m);
 let furnitureTriangles=0;
 const underlyingDraw=scene._drawSoftware.bind(scene);
 scene._drawSoftware=(meshes,...args)=>{
   assert.equal(meshes.length,6,'dynamic furniture is a separate fallback mesh');
   furnitureTriangles=meshes[5].length/21;
   return underlyingDraw(meshes,...args);
 };
 scene.draw({time:st.time,state:st,agents:sim.agents.map(a=>({id:a.id,x:a.x,y:a.y,
  floor:a.floor,state:a.state,profile:a.profile,refugeKind:a.refugeKind}))},2000);
 assert.ok(furnitureTriangles>6,'original furniture is drawn during software playback');
 assert.ok(canvas.width>0&&canvas.height>0);
 assert.equal(scene.lastDrawCount,4);
 scene.dispose();
});
test('2D/3D views use replay furniture positions and show the new version in UI',()=>{
 const root=path.join(__dirname,'..');
 const app=fs.readFileSync(path.join(root,'src/app.js'),'utf8');
 const scene=fs.readFileSync(path.join(root,'src/scene3d.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'src/index.html'),'utf8');
 assert.match(app,/const fx=moved\?moved\.x:item\.x/);
 assert.match(scene,/drawFurnitureMesh\(movable,item/);
 assert.match(scene,/frame\.state\.securityFurniture/);
 assert.match(html,/v0\.11\.10/);
});
