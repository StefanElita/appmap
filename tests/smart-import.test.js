'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Smart = require('../src/smart-import.js');

function image(width, height, background) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i*4] = background[0];data[i*4+1] = background[1];
    data[i*4+2] = background[2];data[i*4+3] = 255;
  }
  return { width, height, data };
}
function fill(img, x1,y1,x2,y2,color) {
  for (let y=y1;y<=y2;y++) for(let x=x1;x<=x2;x++) {
    const i=(y*img.width+x)*4;
    img.data[i]=color[0];img.data[i+1]=color[1];img.data[i+2]=color[2];
  }
}
test('high-contrast closed floor plan yields two separate editable room proposals',()=>{
  const img=image(360,250,[255,255,255]);
  const black=[0,0,0];
  fill(img,28,22,330,27,black);fill(img,28,211,330,216,black);
  fill(img,28,22,33,216,black);fill(img,325,22,330,216,black);
  fill(img,175,22,180,216,black);
  // A door-sized gap in one wall is bridged by morphological dilation.
  fill(img,175,105,180,109,[255,255,255]);
  const classified=Smart.assessPicture(img);
  assert.equal(classified.likelyPlan,true);
  const result=Smart.detectRooms(img,{wallGrow:3});
  assert.equal(result.regions.length,2,JSON.stringify(result.regions));
  assert.ok(result.regions.every(r=>r.confidence>.5));
  const rect=Smart.toSceneRect(result.regions[0],img.width,img.height,18,25);
  assert.ok(rect.x>=0 && rect.y>=0 && rect.x+rect.w<=900 && rect.y+rect.h<=590);
});

test('a missing wall does not create invented interior rooms',()=>{
  const img=image(300,180,[255,255,255]);
  fill(img,25,25,260,29,[0,0,0]);
  fill(img,25,25,29,155,[0,0,0]);
  fill(img,25,152,260,156,[0,0,0]);
  assert.equal(Smart.detectRooms(img).regions.length,0);
});

test('photo heuristic reports facade photos rather than fabricating floorplan',()=>{
  const img=image(320,240,[122,181,235]);
  fill(img,65,65,270,208,[118,111,106]);
  assert.equal(Smart.assessPicture(img).likelyPlan,false);
  const box=Smart.estimateFacadeBounds(img);
  assert.ok(box && box.x <= 90 && box.y <= 85 && box.w > 150);
  assert.equal(box.source,'facade-guess');
});

test('occupancy proposals are editable educational suggestions and empty for corridors/storage',()=>{
  const region={x:10,y:20,w:100,h:80};
  assert.equal(Smart.estimateOccupancy(region,'corridor',400,20),0);
  assert.equal(Smart.estimateOccupancy(region,'storage',400,20),0);
  assert.ok(Smart.estimateOccupancy(region,'classroom',400,20)>Smart.estimateOccupancy(region,'office',400,20));
});

test('overlarge image is refused rather than exhausting app memory',()=>{
  const img=image(10,10,[255,255,255]);
  assert.throws(()=>Smart.detectRooms({width:1800,height:1800,data:img.data}), /Невалидни пиксели/);
});
