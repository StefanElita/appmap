'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Smart=require('../src/smart-import.js');
const {Scene3D,floorFootprint,sceneBounds}=require('../src/scene3d.js');
function shadowedPlan(drop=55){
  const w=480,h=240,data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const k=(y*w+x)*4,lum=Math.round(88+x*145/w+(y-120)*.04);
    data[k]=data[k+1]=data[k+2]=lum;data[k+3]=255;
  }
  const ink=(x,y,ww,hh)=>{for(let yy=y;yy<y+hh;yy++)for(let xx=x;xx<x+ww;xx++){
    const k=(yy*w+xx)*4;for(let c=0;c<3;c++)data[k+c]=Math.max(0,data[k+c]-drop);
  }};
  ink(25,30,430,4);ink(25,195,430,4);ink(25,30,4,170);ink(451,30,4,170);
  ink(175,30,4,170);ink(313,30,4,170);
  return {width:w,height:h,data};
}
function canvas(){
  const context={createLinearGradient(){return{addColorStop(){}};},fillRect(){},beginPath(){},
    moveTo(){},lineTo(){},closePath(){},fill(){}};
  return {clientWidth:600,clientHeight:380,width:0,height:0,getContext(kind){return kind==='2d'?context:null;}};
}
test('local contrast correction preserves RGBA data and does not change source pixels',()=>{
  const picture=shadowedPlan(),original=picture.data.slice();
  const corrected=Smart.enhancePlanContrast(picture);
  assert.equal(corrected.width,picture.width);
  assert.equal(corrected.height,picture.height);
  assert.notEqual(corrected.data,picture.data);
  assert.deepEqual(picture.data,original);
  assert.ok(corrected.data.every((v,i)=>i%4!==3||v===255));
  assert.ok(corrected.data.every(Number.isFinite));
});
test('shadow compensation can recover a partition missed by fixed-threshold scans',()=>{
  const photo=shadowedPlan(55);
  assert.equal(Smart.assessPicture(photo).photographedPlan,true);
  const old=Smart.detectRooms(photo,{adaptive:false});
  const enhanced=Smart.detectRooms(photo,{adaptive:true});
  assert.ok(enhanced.regions.length>=3,'the three classroom rectangles are recovered');
  assert.ok(enhanced.regions.length>old.regions.length,'local contrast improves this uneven-exposure sample');
  assert.ok(enhanced.regions.every(r=>r.confidence<1 && r.source==='photo-multi-threshold'));
});
test('optional adaptive room detection never removes all originally visible rooms',()=>{
  for(const drop of [40,55,70,85,110]){
    const photo=shadowedPlan(drop);
    const old=Smart.detectRooms(photo,{adaptive:false});
    const enhanced=Smart.detectRooms(photo,{adaptive:true});
    assert.ok(enhanced.regions.length>=old.regions.length,'drop='+drop);
  }
});
test('desk candidate combination stays review-only and never auto-selects a furniture item',()=>{
  const w=330,h=180,data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y*w+x)*4,v=Math.round(155+x*.12);
    data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;
  }
  function drawRect(x,y){for(let py=y;py<y+13;py++)for(let px=x;px<x+15;px++){
    if(py===y||py===y+12||px===x||px===x+14){const i=(py*w+px)*4;
      data[i]=data[i+1]=data[i+2]=67;}
  }}
  for(let row=0;row<3;row++)for(let col=0;col<4;col++)drawRect(49+col*44,50+row*31);
  const img={width:w,height:h,data};
  const rooms=[{x:27,y:27,w:260,h:133,selected:true,use:'classroom'}];
  const single=Smart.detectDeskSymbols(img,rooms,{adaptive:false});
  const combined=Smart.detectDeskSymbols(img,rooms,{adaptive:true});
  assert.ok(combined.length>=single.length);
  assert.ok(combined.length>=8);
  assert.ok(combined.every(m=>m.selected===false && m.furnitureType==='desk' && m.confidence<.8));
});
test('3D geometry union does not fill courtyards or empty gaps between separate rooms',()=>{
  const parts=floorFootprint([{type:'room',x:100,y:100,w:80,h:70},
    {type:'room',x:145,y:100,w:85,h:70},
    {type:'corridor',x:310,y:120,w:120,h:45}]);
  const area=parts.reduce((a,r)=>a+r.w*r.h,0);
  assert.equal(area,130*70+120*45);
  assert.equal(parts.some(p=>p.x<310&&p.x+p.w>310&&p.y<=120),false);
  const b=sceneBounds({floors:[{items:[{type:'room',x:100,y:100,w:130,h:70},
    {type:'room',x:310,y:120,w:120,h:45}]}]});
  assert.deepEqual({x:b.x,y:b.y,w:b.w,h:b.h},{x:100,y:100,w:330,h:70});
});
test('3D camera auto-frames real geometry and allows top-down and panning',()=>{
  const scene=new Scene3D(canvas());
  scene.setProject({settings:{pxPerMeter:25,floorHeight:3.2,scenario:'fire'},floors:[
    {items:[{type:'room',x:450,y:300,w:140,h:90}]}]},null);
  assert.ok(scene.distance<18,'small plan does not inherit a giant virtual floor');
  assert.deepEqual(scene.bounds,{x:450,y:300,w:140,h:90,empty:false});
  assert.equal(scene.sceneCenter[0],2.8);
  const expected=scene.sceneCenter.slice();
  scene.setCameraMode('top');assert.equal(scene.cameraMode,'top');
  const pan=scene.pan(50,-20,400);assert.ok(Number.isFinite(pan[0]));
  assert.notDeepEqual(pan,expected);
  scene.draw(null,0);
  scene.resetCamera();
  assert.equal(scene.cameraMode,'orbit');
  assert.equal(scene.focusTarget,null);
  assert.deepEqual(scene.sceneCenter,expected,'camera reset preserves the actual building centre');
  scene.dispose();
});
test('Smart Import and 3D Studio expose new, reviewed interactions without duplicate control ids',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../src/index.html'),'utf8');
  const ui=fs.readFileSync(path.resolve(__dirname,'../src/smart-import-ui.js'),'utf8');
  const renderer=fs.readFileSync(path.resolve(__dirname,'../src/scene3d-ui.js'),'utf8');
  const ids=[...html.matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size);
  assert.match(html,/id="smartAdaptive"/);
  assert.match(html,/value="top"/);
  assert.match(ui,/enhance|smartAdaptive/);
  assert.match(ui,/hit\.selected=!hit\.selected/);
  assert.match(renderer,/scene\.pan\(dx,dy/);
});
