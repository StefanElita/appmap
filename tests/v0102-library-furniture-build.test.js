'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const Library=require('../src/building-library');
const Materials=require('../src/material-library');
const Engine=require('../src/simulation-engine');
const Furnishing=require('../src/furnishing');
function get(project,type){return project.floors.flatMap(f=>f.items.filter(i=>i.type===type));}
function population(project){return get(project,'room').reduce((n,r)=>n+(r.people||0)+(r.teachers||0),0)+get(project,'people').reduce((n,p)=>n+p.count,0);}

test('the standard library mode preserves unchanged geometry and contains no extra furnishing or Advanced Build patches',()=>{
 for (const preset of Library.PRESETS) {
  const a=Library.generate({preset:preset.id,seed:87});
  const b=Library.generate({preset:preset.id,seed:87,includeFurniture:false,includeAdvanced:false});
  assert.deepEqual(a.floors,b.floors,preset.id);
  assert.equal(get(a,'furniture').length,0,preset.id);
  assert.equal(get(a,'wall').length,0,preset.id);
  assert.equal(get(a,'surface').length,0,preset.id);
  assert.equal(a.meta.furnishings,false);
  assert.equal(a.meta.advancedBuild,false);
 }
});

test('furnished-only mode adds editable furnishing to all 15 presets and leaves population unchanged',()=>{
 for (const preset of Library.PRESETS) {
  const base=Library.generate({preset:preset.id,seed:91});
  const result=Library.generate({preset:preset.id,seed:91,includeFurniture:true});
  const furniture=get(result,'furniture');
  assert.ok(furniture.length>0,preset.id);
  assert.equal(population(result),population(base),preset.id);
  assert.equal(get(result,'wall').length,0,preset.id);
  assert.equal(get(result,'surface').length,0,preset.id);
  const ids=result.floors.flatMap(f=>f.items.map(i=>i.id));
  assert.equal(new Set(ids).size,ids.length,'unique IDs '+preset.id);
  for(const it of furniture){
   assert.ok(Furnishing.TYPES[it.furnitureType],it.furnitureType);
   assert.ok(it.w>0 && it.h>0 && Number.isFinite(it.x) && Number.isFinite(it.y));
  }
 }
});

test('advanced-only mode adds brick walls and distinct effective surface materials, without adding furniture',()=>{
 assert.equal(Materials.isKnown('brick'),true);
 for(const preset of Library.PRESETS){
  const generated=Library.generate({preset:preset.id,seed:91,includeAdvanced:true});
  const walls=get(generated,'wall'),surfaces=get(generated,'surface');
  assert.equal(surfaces.length,get(generated,'room').length,preset.id);
  assert.equal(walls.length,5*get(generated,'room').length,preset.id);
  assert.ok(walls.every(w=>w.materialId==='brick' && w.thickness>0));
  assert.ok(surfaces.every(s=>Materials.isKnown(s.materialId)));
  assert.equal(get(generated,'furniture').length,0);
  const model=Engine.buildModel(generated,{scenario:'fire'});
  assert.ok(model.nodes.size>0,preset.id);
  for(const floor of generated.floors){
   const example=floor.items.find(i=>i.type==='room');
   const node=model.nodes.get('f'+generated.floors.indexOf(floor)+':space:'+example.id);
   assert.ok(node && node.materialId!=='standard',preset.id);
  }
 }
});

test('both mode checkboxes may be enabled together, and the generated simulation still has routes',()=>{
 for (const preset of Library.PRESETS){
  const project=Library.generate({preset:preset.id,seed:128,includeFurniture:true,includeAdvanced:true});
  assert.ok(get(project,'furniture').length>0,preset.id);
  assert.ok(get(project,'wall').length>0,preset.id);
  assert.ok(get(project,'surface').length>0,preset.id);
  assert.equal(project.meta.furnishings,true);
  assert.equal(project.meta.advancedBuild,true);
  const model=Engine.buildModel(project,{scenario:'quake'});
  assert.ok(model.groups.some(g=>g.route),preset.id);
 }
});

test('library mode selection and single furniture placement are available in the real interface',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
 const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
 const css=fs.readFileSync(path.join(__dirname,'../src/styles.css'),'utf8');
 for(const id of ['libModeStandard','libModeFurnished','libModeAdvanced','placeSingleFurniture','furnishSelected','furnitureType']) {
  assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.ok(html.includes('id="libModeStandard" type="checkbox" checked'));
 assert.ok(app.includes('changeLibraryMode(id)'));
 assert.ok(app.includes('includeFurniture: $(\'libModeFurnished\').checked'));
 assert.ok(app.includes('includeAdvanced: $(\'libModeAdvanced\').checked'));
 assert.ok(app.includes("$('placeSingleFurniture').addEventListener('click'"));
 assert.ok(app.includes("setTool('furniture')"));
 assert.ok(css.includes('.library-build-choices'));
});
