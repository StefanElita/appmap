'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const Smart=require('../src/smart-import');const Furnishing=require('../src/furnishing');
const Validator=require('../src/plan-validator');const Engine=require('../src/simulation-engine');
const Runner=require('../src/simulation-runner');
function drawing(w=280,h=140){const data=new Uint8ClampedArray(w*h*4);
 for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=255;data[i+3]=255;}
 const px=(x,y)=>{const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=0;};
 const horizontal=(y,from,to)=>{for(let x=from;x<=to;x++)for(let k=0;k<3;k++)px(x,y+k);};
 const vertical=(x,from,to)=>{for(let y=from;y<=to;y++)for(let k=0;k<3;k++)px(x+k,y);};
 return {data:{width:w,height:h,data},horizontal,vertical};}
test('detects a visible wall gap as an unselected door hypothesis',()=>{
 const img=drawing();img.horizontal(18,20,255);img.horizontal(117,20,255);
 img.vertical(20,18,118);img.vertical(255,18,118);img.vertical(137,18,58);img.vertical(137,78,118);
 const rooms=[{x:21,y:21,w:118,h:96,selected:true},{x:139,y:21,w:114,h:96,selected:true}];
 const found=Smart.detectOpenings(img.data,rooms);
 assert.ok(found.some(o=>o.kind==='door'&&o.y>58&&o.y<78));
 assert.ok(found.every(o=>o.selected===false));
 assert.ok(found.every(o=>o.confidence<.8));
});
test('gap-free wall never creates an invented door',()=>{
 const img=drawing();img.vertical(137,18,118);img.horizontal(18,20,255);img.horizontal(117,20,255);
 const rooms=[{x:21,y:21,w:118,h:96},{x:139,y:21,w:114,h:96}];
 assert.equal(Smart.detectOpenings(img.data,rooms).filter(o=>o.kind==='door').length,0);
});
test('exterior gap is proposed only as an unconfirmed window',()=>{
 const img=drawing();img.horizontal(18,20,255);img.horizontal(117,20,255);
 img.vertical(20,18,118);img.vertical(255,18,52);img.vertical(255,70,118);
 const found=Smart.detectOpenings(img.data,[{x:22,y:22,w:234,h:96}]);
 assert.ok(found.some(o=>o.kind==='window'&&o.y>52&&o.y<71));
 assert.ok(found.every(o=>!o.selected));
});
test('furniture stays inside room; optional people use seats without double-counting',()=>{
 const r={x:55,y:60,w:245,h:180};const result=Furnishing.layout(r,'classroom',12);
 assert.ok(result.furniture.length>=12);assert.ok(result.seats.length>=6);
 assert.ok(result.furniture.every(f=>f.x>=r.x&&f.y>=r.y&&f.x+f.w<=r.x+r.w&&f.y+f.h<=r.y+r.h));
 const people=Furnishing.peopleForSeats(result.seats,5,'Seat');
 assert.equal(people.length,5);assert.equal(people.reduce((n,x)=>n+x.count,0),5);
 assert.equal(Furnishing.peopleForSeats(result.seats,0).length,0);
});
test('small rooms and furniture-only objects do not silently introduce people',()=>{
 assert.deepEqual(Furnishing.layout({x:0,y:0,w:25,h:25},'classroom',20),{furniture:[],seats:[]});
 assert.equal(Furnishing.layout({x:20,y:20,w:220,h:135},'library',12).seats.length,0);
});
test('no-route groups are reported when model graph is supplied',()=>{
 const project={settings:{scenario:'fire',pxPerMeter:25},floors:[{name:'test',items:[
 {id:'r',type:'room',x:100,y:100,w:150,h:100,people:2,teachers:0},
 {id:'e',type:'exit',x:740,y:400,width:1.2}]}]};
 const model=Engine.buildModel(project);
 const issues=Validator.validate(project,{routeModel:model}).issues;
 assert.ok(issues.some(i=>i.code==='people-no-route'));
});
test('agent snapshots expose reroute reason without changing outcomes',()=>{
 const project={settings:{scenario:'fire',pxPerMeter:25,preMovement:0},floors:[{name:'Floor',items:[
 {id:'r',type:'room',x:50,y:50,w:230,h:150,people:2},
 {id:'e',type:'exit',x:280,y:140,width:2}]}]};
 const sim=Runner.createSimulation(Engine.buildModel(project),{preMovement:0});
 assert.ok(sim.agents.length>0);
 assert.ok(sim.agents.every(a=>typeof a.routeReason==='string'));
});
test('new controls and asset order are preserved; IDs stay unique',()=>{
 const base=path.resolve(__dirname,'../src');const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const app=fs.readFileSync(path.join(base,'app.js'),'utf8');
 const ids=[...html.matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)].map(m=>m[1]);
 assert.equal(new Set(ids).size,ids.length);
 for(const id of ['smartOpenings','smartAddFurniture','furnishSelected','furnitureType','trackAgentId',
   'trackAgentGo','trackAgentInfo','trackAgentClear','setMovementEffects','materialGuideBody'])
   assert.ok(ids.includes(id),`missing ${id}`);
 assert.ok(html.indexOf('furnishing.js')<html.indexOf('smart-import-ui.js'));
 assert.ok(app.includes('selectedAgentId')&&app.includes('showMovementEffects'));
 assert.ok(app.includes('renderTrackingPanel')&&app.includes('drawMovementEffects'));
});
