'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Footprint=require('../src/flood-footprint.js');
const Engine=require('../src/simulation-engine.js');
const {Scene3D}=require('../src/scene3d.js');

function contains(r,x,y){
  const e=1e-6;
  return x>=r.x-e&&x<=r.x+r.w+e&&y>=r.y-e&&y<=r.y+r.h+e;
}
function area(rect){return rect.w*rect.h;}

test('union footprint fills rooms and corridors but not gaps or outside yards',()=>{
  const rooms=[{x:10,y:10,w:80,h:60},{x:120,y:10,w:60,h:60},
    {x:10,y:70,w:20,h:70}];
  const tiles=Footprint.unionRectangles(rooms);
  const sum=tiles.reduce((n,r)=>n+area(r),0);
  assert.equal(sum,80*60+60*60+20*70);
  assert.ok(!tiles.some(r=>contains(r,100,30)));
  assert.ok(!tiles.some(r=>contains(r,60,110)));
  assert.ok(tiles.every(r=>r.w>0&&r.h>0));
});

test('overlapping spaces do not double blend flood water',()=>{
  const rooms=[{x:0,y:0,w:100,h:100},{x:40,y:30,w:120,h:80}];
  const tiles=Footprint.unionRectangles(rooms);
  assert.equal(tiles.reduce((n,r)=>n+area(r),0),10000+9600-60*70);
  for(let i=0;i<tiles.length;i++)for(let j=i+1;j<tiles.length;j++){
    const a=tiles[i],b=tiles[j];
    const overlap=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)) *
      Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
    assert.ok(overlap<1e-7,'tiles must not overlap');
  }
});

test('water footprint excludes courtyard and keeps disconnected rooms',()=>{
  const floor={spaces:[
    {item:{type:'room'},rect:{x:25,y:30,w:90,h:60}},
    {item:{type:'corridor'},rect:{x:110,y:30,w:70,h:60}},
    {item:{type:'room'},rect:{x:300,y:150,w:90,h:80}},
    {item:{type:'courtyard'},rect:{x:0,y:0,w:860,h:550}}
  ]};
  const tiles=Footprint.unionRectangles(Footprint.interiorRects(floor));
  assert.ok(tiles.every(r=>r.x>=25&&r.x+r.w<=390));
  assert.ok(!tiles.some(r=>contains(r,250,100)));
  assert.ok(tiles.some(r=>contains(r,30,40)));
  assert.ok(tiles.some(r=>contains(r,310,160)));
});

function project(){return {format:'evacuation-simulator',settings:{
  scenario:'flood',pxPerMeter:25,floorHeight:3.2,
  floodGroundRiseEnabled:true,floodStartSeconds:0,
  floodRiseMetersPerSecond:.5,floodMaxHeightMeters:4.2,
  populationProfiles:{children:0,older:0,limited:0}},floors:[
  {name:'Партер',items:[
    {type:'room',id:'r1',x:40,y:50,w:140,h:100,people:0},
    {type:'room',id:'r2',x:330,y:180,w:110,h:90,people:0},
    {type:'courtyard',id:'court',x:190,y:50,w:125,h:120},
    {type:'exit',id:'exit',x:40,y:105,width:1.3}]},
  {name:'Етаж 2',items:[
    {type:'room',id:'upper',x:65,y:65,w:110,h:95,people:0}]}
  ]};}

test('3D flood mesh vertices stay in interior rooms (no courtyard, no bounding-box spill)',()=>{
  const p=project();const model=Engine.buildModel(p);
  const ctx={createLinearGradient(){return{addColorStop(){}}},fillRect(){},beginPath(){},
    moveTo(){},lineTo(){},closePath(){},fill(){}};
  const canvas={clientWidth:520,clientHeight:400,width:0,height:0,
    getContext(type){return type==='2d'?ctx:null;}};
  const scene=new Scene3D(canvas);scene.setProject(p,model);
  let captured;
  scene._drawSoftware=(meshes)=>{captured=meshes;};
  const atTime=t=>({time:t,agents:[],state:{time:t,scenario:'flood',spread:[],smoke:[]}});
  globalThis.EvacSim=Engine;
  try{
    scene.draw(atTime(2),2000);
    const water=captured[4];
    assert.ok(water.length>100,'water volume must be visible');
    const expected=p.floors[0].items.filter(a=>a.type==='room');
    for(let i=0;i<water.length;i+=7){
      const x=water[i]*25+450,z=water[i+2]*25+295;
      assert.ok(expected.some(r=>contains(r,x,z)),`water leaked outside: ${x}, ${z}`);
      assert.ok(water[i+1]>=.024&&water[i+1]<=1.01);
    }
    // Once the water reaches the next storey, it uses that storey's own rooms.
    scene.draw(atTime(8),8000);
    const all=captured[4];
    assert.ok(all.length>water.length);
    const upper=p.floors[1].items.find(a=>a.type==='room');
    let sawUpper=false;
    for(let i=0;i<all.length;i+=7){
      const x=all[i]*25+450,z=all[i+2]*25+295;
      if(all[i+1]>3.2){
        sawUpper=true;
        assert.ok(contains(upper,x,z),'upper-floor water must remain within its rooms');
      }
    }
    assert.ok(sawUpper);
  } finally { delete globalThis.EvacSim; scene.dispose(); }
});

test('2D and 3D depend on the same union footprint and exclude flood circles',()=>{
  const root=path.resolve(__dirname,'../src');
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const scene=fs.readFileSync(path.join(root,'scene3d.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.ok(app.includes('EvacFloodFootprint.tilesForFloor('));
  assert.ok(scene.includes('FloodFootprint.tilesForFloor('));
  assert.match(scene,/if\(scenario==='flood'\)return;/);
  assert.ok(html.indexOf('src="flood-footprint.js"')<html.indexOf('src="scene3d.js"'));
  assert.doesNotThrow(()=>new vm.Script(app,{filename:'app.js'}));
  assert.doesNotThrow(()=>new vm.Script(scene,{filename:'scene3d.js'}));
});
