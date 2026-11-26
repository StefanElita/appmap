'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Labels = require('../src/label-layout.js');
const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');

function room(id, x, y, w, h, name='Класна стая за проверка') {
  return {id, type:'room', name, x, y, w, h, people:25, teachers:1};
}

test('dense photo-imported classrooms hide all overlapping captions by default', () => {
  const items = Array.from({length:16}, (_,i) => room(i, 50 + (i%8)*55, 130 + Math.floor(i/8)*70, 50, 65));
  const result = Labels.analyze(items, {hasBackdrop:true});
  assert.equal(result.compact, true);
  assert.equal(result.spaceCount, 16);
  assert.ok(result.overlappingLabels > 0);
  assert.ok(result.overflowingLabels >= 2);
});

test('regular readable rooms continue to show captions', () => {
  const items = [
    room('a',20,20,300,130,'Стая 1'),
    room('b',350,20,300,130,'Стая 2')
  ];
  assert.equal(Labels.analyze(items).compact,false);
  assert.equal(Labels.analyze([]).compact,false);
});

test('one unusual small room does not hide all names on an otherwise spacious floor', () => {
  const items=[room('a',10,20,30,45), room('b',450,20,250,150,'Офис')];
  assert.equal(Labels.analyze(items).compact,false);
});

test('selection badge exists, caption hiding covers room and accessory labels', () => {
  assert.ok(html.indexOf('src="label-layout.js"')>0);
  assert.ok(html.indexOf('src="label-layout.js"')<html.indexOf('src="app.js"'));
  assert.match(app,/if \(compactLabels\) drawSelectedRoomLabel\(svg\)/);
  assert.match(app,/function drawSelectedRoomLabel\(layer\)/);
  assert.match(app,/\['room', 'corridor', 'courtyard'\]\.includes\(item\.type\)/);
  assert.match(app,/if \(!compactLabels\) g\.append\(svgEl\('text'/);
  assert.match(app,/selectedId = hit\.id;[\s\S]*?renderObjectEditor\(\);\s*draw\(\);/);
  assert.doesNotThrow(() => new vm.Script(app,{filename:'app.js'}));
  assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(__dirname,'../src/label-layout.js'),'utf8')));
});

test('compact renderer removes room names, statistics and door descriptions but keeps shapes/icons', () => {
  const begin=app.indexOf('function createObjectNode(');
  const end=app.indexOf('\nfunction pointSizeRadius(',begin);
  assert.ok(begin>=0 && end>begin);
  const ctx={
    svgEl:(tag,attrs,text)=>({tag,attrs,text,children:[],append(child){this.children.push(child);}}),
    Materials:{MATERIALS:{},get:()=>({color:'#aaa'})}, Furnishing:null,
    selectedId:'none',sameId:(a,b)=>a===b,
    num:(v,d)=>Number.isFinite(Number(v))?Number(v):d,
    clamp:(v,lo,hi)=>Math.max(lo,Math.min(hi,v)),
    pointSizeRadius:()=>14,
    project:{settings:{pxPerMeter:25}},
    currentFloorData:()=>({items:[]}),svg:{querySelector:()=>null}
  };
  const create=vm.runInNewContext(app.slice(begin,end)+'\ncreateObjectNode;',ctx);
  const sample=room('r1',10,10,80,60);
  const normal=create(sample,null,false);
  const compact=create(sample,null,true);
  assert.equal(normal.children.filter(x=>x.tag==='text').length,2);
  assert.equal(compact.children.filter(x=>x.tag==='text').length,0);
  assert.equal(compact.children.filter(x=>x.tag==='rect').length,1);
  const door={type:'door',id:'d1',x:50,y:35,width:1.2,name:'Врата към стая 1'};
  assert.equal(create(door,null,false).children.filter(x=>x.tag==='text').length,2);
  const doorCompact=create(door,null,true);
  assert.equal(doorCompact.children.filter(x=>x.tag==='circle').length,1);
  assert.equal(doorCompact.children.filter(x=>x.tag==='text').length,1); // icon only
});

test('clicking a room shows one badge with its name and information', () => {
  const begin=app.indexOf('function drawSelectedRoomLabel(');
  const end=app.indexOf('\nfunction createObjectNode(',begin);
  const selected=room('x',100,100,60,80,'Класна стая 12 за проверка');
  const ctx={
    selectedItem:()=>selected, LabelLayout:Labels,SVG_W:900,SVG_H:590,
    num:(v,d)=>Number(v)||d,
    svgEl:(tag,attrs,text)=>({tag,attrs,text,children:[],append(child){this.children.push(child);}})
  };
  const fn=vm.runInNewContext(app.slice(begin,end)+'\ndrawSelectedRoomLabel;',ctx);
  const layer={children:[],append(x){this.children.push(x);}};
  fn(layer);
  assert.equal(layer.children.length,1);
  const card=layer.children[0];
  assert.equal(card.attrs['pointer-events'],'none');
  assert.ok(card.children.some(x=>x.tag==='text' && x.text.includes('Класна стая 12')));
  assert.ok(card.children.some(x=>x.tag==='text' && x.text.includes('25 хора')));
});

test('export omits the floating selection badge',()=>{
  assert.match(app,/querySelectorAll\('\.handle, \.draft, \.selected-room-label'\)/);
});
