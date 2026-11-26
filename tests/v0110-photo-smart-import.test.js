'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const Smart=require('../src/smart-import');const Sketch=require('../src/sketch-tools');
function picture(w=430,h=195,background=171){
  const data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=background;data[i+3]=255;}
  const fill=(x,y,ww,hh,v)=>{for(let yy=Math.max(0,y);yy<Math.min(h,y+hh);yy++)for(let xx=Math.max(0,x);xx<Math.min(w,x+ww);xx++){
    const i=(yy*w+xx)*4;data[i]=data[i+1]=data[i+2]=v;
  }};
  return {width:w,height:h,data,fill};
}
function greyClassrooms(){
  const im=picture(),p=im.fill;
  p(19,33,391,5,44);p(19,165,391,5,44);p(19,33,5,137,44);p(405,33,5,137,44);
  p(213,33,5,137,44);p(213,80,5,9,171);
  // Repeated tiny outlines in a classroom represent possible desks.
  for(let row=0;row<3;row++)for(let col=0;col<4;col++){
    const x=38+col*40,y=61+row*30;
    p(x,y,12,2,120);p(x,y,2,12,120);p(x+10,y,2,12,120);p(x,y+10,12,2,120);
  }
  return im;
}
test('grey, uneven-exposure-style architectural photo is recognized as a plan rather than a facade',()=>{
  const im=greyClassrooms();
  const assessment=Smart.assessPicture(im);
  assert.equal(assessment.photographedPlan,true);assert.equal(assessment.likelyPlan,true);
  assert.ok(Smart.detectRooms(im).regions.length>=1);
});
test('photographed plan offers repeating rectangles as UNCHECKED desk hypotheses',()=>{
  const im=greyClassrooms();const detected=Smart.detectRooms(im);
  const candidates=Smart.detectDeskSymbols(im,detected.regions.map(r=>({...r,selected:true,use:'classroom'})));
  assert.ok(candidates.length>=8,`Found ${candidates.length}`);
  assert.ok(candidates.every(c=>c.kind==='furniture'&&c.furnitureType==='desk'&&c.selected===false));
  assert.ok(candidates.every(c=>c.confidence<.8));
});
test('detected desk suggestions are never imported without user confirmation',()=>{
  const proposal={kind:'furniture',furnitureType:'desk',x:85,y:100,w:10,h:12,selected:false};
  const people={kind:'people',x:90,y:120,count:3,selected:true};
  const mapper=r=>({...r});
  let imported=Sketch.toSceneItems([],[proposal,people],mapper,24,430);
  assert.equal(imported.filter(i=>i.type==='furniture').length,0);
  assert.equal(imported.filter(i=>i.type==='people').length,1);
  proposal.selected=true;
  imported=Sketch.toSceneItems([],[proposal],mapper,24,430);
  assert.equal(imported.filter(i=>i.type==='furniture').length,1);
});
test('door hints from photographed plan stay unconfirmed and cannot become evacuation exits silently',()=>{
  const im=greyClassrooms();const rooms=[
    {x:26,y:50,w:175,h:100,selected:true},
    {x:225,y:50,w:170,h:100,selected:true}
  ];
  // Two door-swing-like strokes adjacent to a pale gap above the wall.
  im.fill(40,31,2,13,70);im.fill(240,31,2,13,70);
  const candidates=Smart.detectOpenings(im,rooms,{threshold:110});
  assert.ok(candidates.every(c=>!c.selected));
  assert.ok(candidates.every(c=>c.kind!=='exit'));
});
test('new desk controls exist and retain unique element IDs and the correct import flow',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../src/index.html'),'utf8');
  const ui=fs.readFileSync(path.resolve(__dirname,'../src/smart-import-ui.js'),'utf8');
  for(const id of ['smartDeskSummary','smartSelectAllDesks','smartClearAllDesks'])
    assert.ok(source.includes('id="'+id+'"'),id);
  const ids=[...source.matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(ui.includes('detectDeskSymbols')&&ui.includes('hasRecognizedFurniture'));
});
