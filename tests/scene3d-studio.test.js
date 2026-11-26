'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Mesh,drawPerson,personColors,Scene3D,sampleAtTime,doorAlongX}=require('../src/scene3d.js');

test('3D Studio people contain curved head, torso and individually animated limbs',()=>{
  const mesh=new Mesh();
  drawPerson(mesh,{id:2,profile:'adult',state:'moving',headingX:20,headingY:0},{x:0,y:0,z:0,time:3,detail:'high'});
  assert.ok(mesh.data.length>2000,'detailed character must not be a two-box avatar');
  assert.equal(mesh.data.length%21,0,'triangles are RGB(A) vertices');
  assert.ok(mesh.data.every(Number.isFinite),'all positions/colors are finite');
  const headHeights=[];
  for(let i=0;i<mesh.data.length;i+=7)if(mesh.data[i+1]>1.4)headHeights.push(mesh.data[i+1]);
  assert.ok(headHeights.length>20,'rounded head has many vertices');
});

test('3D walking animation changes limbs but a stationary person does not move',()=>{
  const create=(state,time)=>{
    const m=new Mesh();drawPerson(m,{id:3,profile:'adult',state,headingX:1,headingY:0},
      {x:0,y:0,z:0,time,detail:'balanced'});return m.data;
  };
  assert.notDeepEqual(create('moving',1),create('moving',1.2));
  assert.deepEqual(create('waiting',1),create('waiting',1.2));
});

test('3D motion aligns to the recorded movement direction',()=>{
  const hist=[
    {state:{time:0},agents:[{id:3,x:50,y:75,floor:0,state:'moving'}]},
    {state:{time:2},agents:[{id:3,x:80,y:65,floor:0,state:'moving'}]}
  ];
  const agent=sampleAtTime(hist,1).agents[0];
  assert.equal(agent.headingX,30);
  assert.equal(agent.headingY,-10);
  assert.equal(agent.x,65);
});

test('synthetic character palettes vary deterministically with no external assets',()=>{
  const a=personColors({id:1,state:'moving'}),b=personColors({id:2,state:'moving'});
  assert.deepEqual(personColors({id:1,state:'moving'}),a);
  assert.notDeepEqual(a,b);
});

test('fatal figures stay solid black, including wheelchair visuals',()=>{
  for(const profile of ['adult','children','older','limited']){
    const mesh=new Mesh();drawPerson(mesh,{id:10,profile,state:'fatal'},
      {x:0,y:0,z:0,time:21,detail:'high'});
    for(let i=0;i<mesh.data.length;i+=7){
      assert.equal(mesh.data[i+3],0,`non-black red in ${profile}`);
      assert.equal(mesh.data[i+4],0,`non-black green in ${profile}`);
      assert.equal(mesh.data[i+5],0,`non-black blue in ${profile}`);
    }
  }
});

test('room door frame orientation is based on nearby room edges',()=>{
  const f={items:[{type:'room',x:10,y:10,w:300,h:160}]};
  assert.equal(doorAlongX(f,{x:160,y:170}),true);
  assert.equal(doorAlongX(f,{x:10,y:85}),false);
});

test('software 3D fallback builds and draws detailed scene offline',()=>{
  const ctx={
    createLinearGradient(){return {addColorStop(){}};}, fillRect(){},beginPath(){},
    moveTo(){},lineTo(){},closePath(){},fill(){},
    set fillStyle(v){},set globalAlpha(v){},set lineJoin(v){}
  };
  const canvas={clientWidth:480,clientHeight:300,width:0,height:0,
    getContext(type){return type==='2d'?ctx:null;}};
  const scene=new Scene3D(canvas);
  assert.equal(scene.software,true);
  const project={settings:{pxPerMeter:25,floorHeight:3.2,scenario:'fire'},floors:[
    {items:[{type:'room',x:100,y:100,w:300,h:200},
      {type:'door',x:250,y:100,width:1.2},
      {type:'stairs',x:300,y:220},{type:'exit',x:400,y:200,width:1.5},
      {type:'elevator',x:300,y:300},{type:'safezone',x:100,y:300}]}
  ]};
  scene.setProject(project,null);
  scene.setQuality('high');
  scene.draw({time:4,agents:[{id:1,x:180,y:160,floor:0,state:'moving',profile:'adult',headingX:1,headingY:0}],
    state:{time:4,scenario:'fire',spread:[],smoke:[]}},4000);
  assert.equal(scene.lastDrawCount,1);
  assert.ok(canvas.width>0&&canvas.height>0);
  assert.ok(scene.staticOpaque.length>400);
  scene.dispose();
});

test('3D close-up camera follows active people and restores full overview',()=>{
  const dummyCtx={createLinearGradient(){return {addColorStop(){}};},fillRect(){},
    beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){}};
  const canvas={clientWidth:200,clientHeight:150,getContext(kind){return kind==='2d'?dummyCtx:null;}};
  const scene=new Scene3D(canvas);
  scene.setProject({settings:{pxPerMeter:25,floorHeight:3.2},floors:[{items:[]}]},null);
  const before=scene.distance;
  assert.equal(scene.focusOnPeople({agents:[{x:525,y:295,floor:0,state:'moving'}]}),true);
  assert.equal(scene.focusTarget[0],3);
  assert.equal(scene.focusTarget[2],0);
  assert.ok(scene.zoomScale*before<before);
  scene.resetCamera();assert.equal(scene.focusTarget,null);
  assert.equal(scene.zoomScale,1);
  assert.equal(scene.focusOnPeople(null),false);
});

test('3D wall modes and quality budget remain configurable without changing model',()=>{
  const ctx={};
  const canvas={getContext(t){return t==='2d'?ctx:null;}};
  const scene=new Scene3D(canvas);
  const project={settings:{pxPerMeter:25},floors:[{items:[{type:'room',x:100,y:100,w:200,h:130}]}]};
  scene.setProject(project,null);
  scene.setWalls('cutaway');const cutaway=scene.staticAlpha.length;
  scene.setWalls('full');const full=scene.staticAlpha.length;
  scene.setWalls('none');const hidden=scene.staticAlpha.length;
  assert.ok(cutaway>0&&full>0);
  assert.equal(hidden,0);
  scene.setQuality('fast');const fast=scene.renderBudget;
  scene.setQuality('high');const high=scene.renderBudget;
  assert.ok(high<fast,'detailed meshes cap figure count for responsiveness');
  assert.equal(project.floors[0].items[0].w,200);
});
