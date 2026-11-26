'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../src/simulation-engine.js');
const S=require('../src/simulation-runner.js');
const Security=require('../src/security-incident.js');

const fixture=()=>({
  format:'evacuation-simulator',
  settings:{scenario:'lockdown',pxPerMeter:25,preMovement:0,
    populationProfiles:{children:0,older:0,limited:0},
    securityEnhancedEnabled:true,securityRoamEnabled:true,securityRoomVisualsEnabled:true,
    securityWarningAtSeconds:2,securityEmergencyAtSeconds:5,securityEvacuationPercent:50,
    securityRoamPeriodSeconds:6,threatHelpCallEnabled:true,threatHelpCallAtSeconds:7,
    securityHelpConfirmSeconds:9,securityHelpArrivalSeconds:15},
  floors:[{name:'Етаж 1',items:[
    {id:'r1',type:'room',x:25,y:25,w:200,h:150,people:10},
    {id:'r2',type:'room',x:250,y:25,w:220,h:150,people:10},
    {id:'c1',type:'corridor',x:25,y:170,w:500,h:75},
    {id:'d1',type:'door',x:125,y:175,width:1.2},
    {id:'d2',type:'door',x:350,y:175,width:1.2},
    {id:'out',type:'exit',x:35,y:205,width:1.8},
    {id:'t1',type:'threat',x:480,y:200,entryAtSeconds:0},
    {id:'t2',type:'threat',x:495,y:210,entryAtSeconds:12},
    {id:'f1',type:'furniture',furnitureType:'desk',x:80,y:65,w:50,h:24}
  ]}]
});
const toTime=(sim,t)=>{while(!sim.finished&&sim.time<t-1e-9)sim.advance(Math.min(2,t-sim.time));return sim.snapshot()};
test('security settings normalize valid time windows, percentages and switches',()=>{
 const s=Security.normalize({securityEnhancedEnabled:true,securityWarningAtSeconds:9,
  securityEmergencyAtSeconds:2,securityEvacuationPercent:190,securityRoamPeriodSeconds:1});
 assert.equal(s.securityWarningAtSeconds,9);
 assert.equal(s.securityEmergencyAtSeconds,9);
 assert.equal(s.securityEvacuationPercent,100);
 assert.equal(s.securityRoamPeriodSeconds,75);
 assert.equal(Security.level(s,8),'normal');
 assert.equal(Security.level(s,9),'emergency');
 assert.equal(Security.level({},50),'legacy');
});
test('marker motion is predictable, is bounded to the floor and does not change saved positions',()=>{
 const p=fixture(),m=E.buildModel(p),source=m.threatMarkers.map(t=>({...t}));
 const first=Security.markerPositions(source,m.floors,0,m.settings);
 const next=Security.markerPositions(source,m.floors,4,m.settings);
 assert.equal(first.length,1);
 assert.equal(next.length,1);
 assert.notDeepEqual(first[0],next[0]);
 assert.deepEqual(Security.markerPositions(source,m.floors,4,m.settings),next);
 assert.equal(source[0].x,480);
 assert.equal(Security.markerPositions(source,m.floors,13,m.settings).length,2);
 assert.equal(Security.markerPositions(source,m.floors,13,{securityEnhancedEnabled:false}).length,2);
});
test('warning, emergency, visual room indicator and help timeline are snapshotted',()=>{
 const model=E.buildModel(fixture()),sim=S.createSimulation(model);
 assert.equal(sim.snapshot().securityLevel,'normal');
 assert.equal(toTime(sim,3).securityLevel,'warning');
 const emergency=toTime(sim,6);
 assert.equal(emergency.securityLevel,'emergency');
 assert.equal(emergency.securityNotified,20);
 assert.ok(emergency.securityRooms.some(r=>r.id==='r1'));
 assert.equal(toTime(sim,7).securityHelpStatus,'sent');
 assert.equal(toTime(sim,10).securityHelpStatus,'confirmed');
 assert.equal(toTime(sim,15).securityHelpStatus,'assistance');
});
test('people shelter in their rooms without moving toward the threat marker',()=>{
 const sim=S.createSimulation(E.buildModel(fixture()));
 assert.equal(sim.agents.filter(a=>a.securityAction==='evacuate').length,0);
 const st=toTime(sim,240);
 assert.equal(st.safe,0);assert.equal(st.sheltered,20);
 assert.equal(st.total,20);assert.equal(st.fatal,0);
 assert.equal(st.finished,true);
});
test('without accessible exit the safety exercise shows waiting instead of fake evacuation',()=>{
 const p=fixture();p.floors[0].items=p.floors[0].items.filter(a=>a.type!=='exit');
 const sim=S.createSimulation(E.buildModel(p));
 const st=toTime(sim,45);
 assert.equal(st.safe,0);assert.equal(st.sheltered,20);
 assert.ok(sim.agents.every(a=>a.securityAction==='shelter'));
});
test('old projects without enhanced mode retain static marker and shelter behavior',()=>{
 const p=fixture();delete p.settings.securityEnhancedEnabled;
 const m=E.buildModel(p),sim=S.createSimulation(m);
 assert.equal(Security.markerPositions(m.threatMarkers,m.floors,2,m.settings)[0].x,480);
 assert.equal(sim.snapshot().securityLevel,'legacy');
 const st=toTime(sim,20);
 assert.equal(st.safe,0);assert.equal(st.sheltered,20);
});
test('UI and replay renderer include warning controls and non-graphic cues',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
 for(const id of ['exSecurityEnhanced','exSecurityWarningAt','exSecurityEmergencyAt',
   'exSecurityRoam','exSecurityRoomVisuals','exSecurityEvacuationPercent','securityScenarioLive'])
   assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.includes('security-incident.js'));
 const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
 const renderer=fs.readFileSync(path.join(__dirname,'../src/scene3d.js'),'utf8');
 assert.match(app,/drawSecurityIndicators\(securityLayer\)/);
 assert.match(renderer,/security\.markerPositions\(/);
 assert.match(renderer,/state\.securityRooms/);
 assert.match(renderer,/state\.securityLevel/);
});
test('software 3D renders the enhanced incident frame without WebGL',()=>{
 const Scene=require('../src/scene3d.js');
 const ctx={createLinearGradient(){return {addColorStop(){}};},fillRect(){},beginPath(){},
   moveTo(){},lineTo(){},closePath(){},fill(){}};
 const canvas={clientWidth:420,clientHeight:280,width:0,height:0,
   getContext(type){return type==='2d'?ctx:null;}};
 const p=fixture(),m=E.buildModel(p),sim=S.createSimulation(m);
 const st=toTime(sim,8);
 const scene=new Scene.Scene3D(canvas);
 scene.setProject(p,m);
 scene.draw({state:st,time:st.time,agents:sim.agents.map(a=>({id:a.id,x:a.x,y:a.y,
   floor:a.floor,state:a.state,profile:a.profile}))},8000);
 assert.ok(canvas.width>0&&canvas.height>0);
 assert.equal(scene.lastDrawCount,20);
 scene.dispose();
});
