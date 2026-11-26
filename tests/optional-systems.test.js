'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/simulation-engine.js');
const S = require('../src/simulation-runner.js');
const X = require('../src/scenario-extras.js');
const {Scene3D}=require('../src/scene3d.js');
const fs=require('node:fs');
const path=require('node:path');

function project(settings={},fire=true){
  const items=[
    {id:'r',type:'room',name:'Учебна зала',x:80,y:80,w:200,h:140,people:4},
    {id:'hall',type:'corridor',x:80,y:220,w:300,h:55},
    {id:'door',type:'door',x:175,y:220,width:1.2},
    {id:'exit',type:'exit',x:355,y:246,width:1.4}
  ];
  if(fire)items.push({id:'fire',type:'hazard',x:90,y:90,spread:true,radius:6,maxRadius:15,spreadSpeed:.5});
  return {format:'evacuation-simulator',settings:{pxPerMeter:25,preMovement:30,scenario:'fire',
      fireSpreadMultiplier:1,fireExposureLimitSeconds:200,populationProfiles:{children:0,older:0,limited:0},...settings},
    floors:[{id:'f',name:'Етаж 1',items}]};
}

test('alarms / sprinklers / scenario creator are opt-in, even when settings are absent',()=>{
 const m=E.buildModel(project());
 assert.equal(m.settings.alarmsEnabled,false);
 assert.equal(m.settings.sprinklersEnabled,false);
 assert.equal(m.settings.scenarioCreatorEnabled,false);
 assert.equal(X.alarmTime(m.settings),Infinity);
 assert.equal(X.sprinklerTime(m.settings),Infinity);
 assert.equal(X.fireClock(m.settings,12,0),12);
});

test('enabled alarm changes actual agent reaction time; disabled alarm does not',()=>{
 const no=S.createSimulation(E.buildModel(project({alarmsEnabled:false,alarmAtSeconds:5},false)),{preMovement:30});
 const withAlarm=S.createSimulation(E.buildModel(project({alarmsEnabled:true,alarmAtSeconds:5},false)),{preMovement:30});
 assert.ok(no.agents.every(a=>a.startDelay>20));
 assert.ok(withAlarm.agents.every(a=>a.startDelay<20));
 assert.equal(withAlarm.snapshot().systems.alarmsEnabled,true);
 withAlarm.advance(2);assert.equal(withAlarm.snapshot().systems.alarmActive,false);
 withAlarm.advance(2);withAlarm.advance(2);assert.equal(withAlarm.snapshot().systems.alarmActive,true);
});

test('enabled sprinklers reduce progressive fire growth after activation',()=>{
 const dry=E.buildModel(project());
 const wet=E.buildModel(project({sprinklersEnabled:true,sprinklerAtSeconds:4,sprinklerFactor:.3}));
 const dryP=E.firePatchesAt(dry,dry.hazardSpread[0],12)[0];
 const wetP=E.firePatchesAt(wet,wet.hazardSpread[0],12)[0];
 assert.ok(wetP.radiusPx<dryP.radiusPx);
 assert.equal(E.firePatchesAt(wet,wet.hazardSpread[0],2)[0].radiusPx,E.firePatchesAt(dry,dry.hazardSpread[0],2)[0].radiusPx);
});

test('optional timeline defers ignition and its smoke / fire effects',()=>{
 const delayed=E.buildModel(project({scenarioCreatorEnabled:true,timelineEvents:[{type:'ignition',atSeconds:15,targetId:'fire'}]}));
 assert.equal(delayed.hazardSpread[0].startAt,15);
 assert.equal(E.firePatchesAt(delayed,delayed.hazardSpread[0],14).length,0);
 assert.ok(E.firePatchesAt(delayed,delayed.hazardSpread[0],16).length>0);
 const sim=S.createSimulation(delayed,{preMovement:100});
 assert.equal(sim.snapshot().spread[0].reached.length,0);
 assert.equal(sim.snapshot().smoke[0].reached.length,0);
 for(let i=0;i<7;i++)sim.advance(2);
 assert.equal(sim.snapshot().spread[0].radiusPx,0);
 sim.advance(2);
 assert.ok(sim.snapshot().spread[0].radiusPx>0);
 assert.ok(sim.snapshot().smoke[0].reached.length>0);
});

test('locked/damaged doors block routes; timeline locks/unlocks doors without modifying project',()=>{
 const locked=E.buildModel(project({scenario:'quake'},false));
 const d=locked.doorItems[0];d.doorState='locked';
 E.updateDoorBlocking(locked,0);
 assert.ok(locked.edges.filter(e=>e.doorItemId==='door').every(e=>e.blocked));
 assert.equal(E.routeFromNode(locked,locked.groups[0].nodeId),null);
 const withTimeline=E.buildModel(project({scenario:'quake',scenarioCreatorEnabled:true,
  timelineEvents:[{type:'door-lock',targetId:'door',atSeconds:4},{type:'door-open',targetId:'door',atSeconds:12}]},false));
 assert.equal(X.doorState(withTimeline.settings,{id:'door',doorState:'open'},6),'locked');
 assert.equal(X.doorState(withTimeline.settings,{id:'door',doorState:'open'},13),'open');
 E.updateHazardBlocking(withTimeline,6);
 assert.equal(E.routeFromNode(withTimeline,withTimeline.groups[0].nodeId),null);
 E.updateHazardBlocking(withTimeline,13);
 assert.ok(E.routeFromNode(withTimeline,withTimeline.groups[0].nodeId));
});

test('ventilation shifts the educational smoke arrival clock and fixtures are retained',()=>{
 const calm=E.buildModel(project());
 const windy=E.buildModel(project({ventilationEnabled:true,ventilationStrength:.8}));
 assert.ok(X.smokeClock(windy.settings,20,0)<X.smokeClock(calm.settings,20,0));
 const m=E.buildModel(project({ventilationEnabled:true},true));
 assert.ok(m.smokeSpread.length);
 const withVent=project({ventilationEnabled:true},true);
 withVent.floors[0].items.push({id:'v',type:'vent',x:160,y:140,strength:.6});
 const updated=E.buildModel(withVent);
 assert.equal(updated.ventilationFixtures.length,1);
});

test('hesitant and follower agents have distinct reaction times, group cohesion synchronizes them',()=>{
 const raw={behaviorEnabled:true,hesitantPercent:25,followerPercent:25};
 const solo=S.createSimulation(E.buildModel(project(raw,false)),{preMovement:30});
 assert.ok(solo.agents.some(a=>a.behavior==='hesitant'));
 assert.ok(solo.agents.some(a=>a.behavior==='follower'));
 const together=S.createSimulation(E.buildModel(project({...raw,groupTogether:true},false)),{preMovement:30});
 assert.equal(new Set(together.agents.map(a=>a.startDelay)).size,1);
 assert.equal(new Set(together.agents.map(a=>a.speedMultiplier)).size,1);
});

test('3D follow and first-person camera render with software fallback',()=>{
 const ctx={createLinearGradient(){return {addColorStop(){}};},fillRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){}};
 const canvas={clientWidth:400,clientHeight:230,getContext(kind){return kind==='2d'?ctx:null;}};
 const scene=new Scene3D(canvas);
 const p=project({});
 scene.setProject(p,E.buildModel(p));
 const frame={time:2,state:{time:2,scenario:'fire',spread:[],smoke:[]},
   agents:[{id:1,floor:0,x:160,y:160,headingX:3,headingY:2,state:'moving',profile:'adult'}]};
 for (const mode of ['orbit','follow','pov']) {scene.setCameraMode(mode,'1');scene.draw(frame,2000);assert.equal(scene.lastDrawCount,1);}
 scene.dispose();
});

test('UI exposes optional systems and timeline and library opt-in checkboxes',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
 for(const id of ['exAlarms','exSprinklers','exTimeline','exAddEvent','exVentilation','exGroupTogether',
    'scene3dCameraMode','scene3dFollowAgent','exVentDirection','systemStateLive','libIncludeAlarms','libIncludeSprinklers','libIncludeTimeline'])
   assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/<script src="scenario-extras\.js"><\/script>/);
});

test('ventilation shafts carry smoke across floors, without creating fire paths',()=>{
 function twoFloors(on){return {settings:{scenario:'fire',pxPerMeter:25,ventilationEnabled:on,ventilationStrength:.8},
  floors:[
   {name:'Долен етаж',items:[{id:'r1',type:'room',x:50,y:50,w:220,h:140,people:2},
    {id:'h1',type:'hazard',x:100,y:90,spread:true,maxRadius:50,spreadSpeed:.5},
    ...(on?[{id:'v1',type:'ventshaft',shaft:'A',x:100,y:100,strength:.5}]:[])]},
   {name:'Горен етаж',items:[{id:'r2',type:'room',x:50,y:50,w:220,h:140,people:2},
    ...(on?[{id:'v2',type:'ventshaft',shaft:'A',x:100,y:100,strength:.5}]:[])]}
  ]};}
 const without=E.buildModel(twoFloors(false));
 const withShaft=E.buildModel(twoFloors(true));
 assert.equal(without.smokeSpread[0].arrivals.some(a=>a.floor===1),false);
 assert.equal(withShaft.smokeSpread[0].arrivals.some(a=>a.floor===1),true);
 assert.equal(withShaft.hazardSpread[0].arrivals.some(a=>a.floor===1),false);
});

test('an open window slows smoke entering its room in the educational model',()=>{
 function adjacent(open){return {settings:{scenario:'fire',pxPerMeter:25,ventilationEnabled:true,ventilationStrength:.8},
  floors:[{items:[
   {id:'a',type:'room',x:50,y:50,w:200,h:150,people:2},
   {id:'b',type:'room',x:250,y:50,w:200,h:150,people:2},
   {id:'d',type:'door',x:250,y:125,width:2},
   {id:'f',type:'hazard',x:80,y:110,spread:true,maxRadius:50,spreadSpeed:.5},
   ...(open?[{id:'w',type:'window',x:300,y:90,open:true,strength:.8}]:[])
  ]}]};}
 const no=E.buildModel(adjacent(false));
 const yes=E.buildModel(adjacent(true));
 const arrival=(m)=>m.smokeSpread[0].arrivals.find(a=>a.kind==='space' && a.x>250);
 assert.ok(arrival(no));assert.ok(arrival(yes));
 assert.ok(arrival(yes).time>arrival(no).time);
});

test('non-spreading delayed fire does not expose agents before timeline ignition',()=>{
 const p=project({scenarioCreatorEnabled:true, timelineEvents:[{type:'ignition',atSeconds:20,targetId:'fire'}],
   preMovement:100,fireExposureLimitSeconds:3},false);
 p.floors[0].items=p.floors[0].items.filter(i=>i.type!=='door'&&i.type!=='exit');
 p.floors[0].items.push({id:'fire',type:'hazard',x:100,y:110,radius:60,spread:false});
 const m=E.buildModel(p);
 const sim=S.createSimulation(m,{preMovement:100});
 for(let i=0;i<6;i++)sim.advance(2);
 assert.equal(sim.agents.filter(a=>a.fireExposureSeconds>0).length,0);
});
