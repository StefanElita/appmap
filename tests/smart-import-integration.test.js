'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.resolve(__dirname,'../src');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
const app=fs.readFileSync(path.join(base,'app.js'),'utf8');

test('Smart Import assets load before UI and application code',()=>{
  const a=html.indexOf('<script src="smart-import.js"');
  const b=html.indexOf('<script src="smart-import-ui.js"');
  const c=html.indexOf('<script src="app.js"');
  assert.ok(a>0 && b>a && c>b);
});

test('Smart Import dialog controls are present and IDs unique',()=>{
  const ids=[...html.matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const id of ['openSmartImport','smartImportDialog','smartPick','smartCanvas',
    'smartRegions','smartApply','smartAddPeople','smartWidthMeters','smartMode'])
    assert.ok(ids.includes(id),`missing ${id}`);
});

test('Facade references have a separate visual object and cannot be treated as room by default',()=>{
  assert.ok(app.includes("item.type === 'reference'"));
  assert.ok(app.includes("item.type === 'room' || item.type === 'corridor'"));
  assert.ok(app.includes("sourceKind:'facade'" )===false); // handled in the UI before commit
  const ui=fs.readFileSync(path.join(base,'smart-import-ui.js'),'utf8');
  assert.ok(ui.includes("type:'reference'"));
  assert.ok(ui.includes("people:0,teachers:0"));
});
