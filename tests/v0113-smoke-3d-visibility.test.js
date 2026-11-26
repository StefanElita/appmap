'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {Scene3D, Mesh, smokeCoverageRooms, drawSmokeFootprint} = require('../src/scene3d.js');

const spaces = new Map([
  ['r1', {id:'r1',kind:'space',floor:0,rect:{x:100,y:90,w:120,h:75}}],
  ['r2', {id:'r2',kind:'space',floor:0,rect:{x:275,y:90,w:90,h:80}}],
  ['upstairs',{id:'upstairs',kind:'space',floor:1,rect:{x:100,y:90,w:110,h:70}}],
  ['door',{id:'door',kind:'door',floor:0,x:200,y:120}],
  ['yard',{id:'yard',kind:'space',spaceType:'courtyard',floor:0,rect:{x:20,y:10,w:680,h:450}}]
]);
const model={nodes:spaces};
const smoke=[{
  floor:0,x:140,y:125,
  reached:[{nodeId:'r1',time:0},{nodeId:'door',time:0},{nodeId:'yard',time:0},{nodeId:'r1',time:0}]
}, {
  floor:0,x:300,y:100,
  reached:[{nodeId:'r1',time:0},{nodeId:'r2',time:5},{nodeId:'upstairs',time:6}]
}];

function contains(rect,x,z){
  return x>=rect.x-1e-8&&x<=rect.x+rect.w+1e-8 &&
    z>=rect.y-1e-8&&z<=rect.y+rect.h+1e-8;
}

test('gray smoke footprint follows reached spaces only, deduplicates sources and obeys selected floor',()=>{
  const all=smokeCoverageRooms(model,smoke);
  assert.deepEqual(all.map(r=>r.nodeId),['r1','r2','upstairs']);
  assert.deepEqual(smokeCoverageRooms(model,smoke,fi=>fi===0).map(r=>r.nodeId),['r1','r2']);
  assert.deepEqual(smokeCoverageRooms(model,[{reached:[]}]),[]);
  const mesh=new Mesh();drawSmokeFootprint(mesh,all,25,3.2);
  assert.ok(mesh.data.length>0);
  assert.equal(mesh.data.length%21,0);
  assert.ok(mesh.data.every(Number.isFinite));
  const rects=all.map(r=>r.rect);
  for(let i=0;i<mesh.data.length;i+=7){
    const px=mesh.data[i]*25+450,pz=mesh.data[i+2]*25+295;
    assert.ok(rects.some(r=>contains(r,px,pz)),`smoke outside its room at ${px},${pz}`);
    assert.ok(mesh.data[i+6] <= .4, 'overlay should be light, not opaque');
  }
});

test('3D floor smoke is visible in fire, switchable off, and never appears in unrelated scenarios',()=>{
  const ctx={createLinearGradient(){return{addColorStop(){}}},fillRect(){},beginPath(){},
    moveTo(){},lineTo(){},closePath(){},fill(){}};
  const canvas={clientWidth:400,clientHeight:240,width:0,height:0,
    getContext(type){return type==='2d'?ctx:null;}};
  const scene=new Scene3D(canvas);
  const project={settings:{scenario:'fire',pxPerMeter:25,floorHeight:3.2},floors:[
    {items:[{id:'a',type:'room',x:100,y:90,w:120,h:75},
      {id:'b',type:'room',x:275,y:90,w:90,h:80}]}
  ]};
  scene.setProject(project,model);
  scene._drawSoftware=meshes=>{scene.effectsForTest=meshes[4];};
  const frame=scenario=>({time:6,agents:[],state:{time:6,scenario,smoke,spread:[]}});
  scene.draw(frame('fire'),6000);
  const visible=scene.effectsForTest.slice();
  assert.ok(visible.length>0, 'visible smoke must produce gray overlay');
  assert.ok(visible.some((_,i)=>i%7===6&&visible[i]>.2));
  scene.setSmokeVisible(false);
  scene.draw(frame('fire'),6000);
  assert.equal(scene.effectsForTest.length,0,'turning the 3D effect off must not change simulation data');
  assert.equal(smoke.length,2,'simulation snapshots must be unchanged');
  scene.setSmokeVisible(true);
  scene.draw(frame('flood'),6000);
  assert.equal(scene.effectsForTest.length,0,'non-fire scenario must not render a stale smoke snapshot');
  scene.dispose();
});

test('3D smoke checkbox appears in replay controls and connects to renderer only',()=>{
  const root=path.resolve(__dirname,'../src');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'scene3d-ui.js'),'utf8');
  assert.match(html,/<input id="scene3dSmoke" type="checkbox" checked>/);
  assert.match(js,/scene3dSmoke.*addEventListener\('change'/);
  assert.match(js,/setSmokeVisible\(event\.target\.checked\)/);
  assert.match(js,/setSmokeVisible\(\$\('scene3dSmoke'\)\.checked\)/);
});
