'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Engine = require('../src/simulation-engine.js');
const source = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');

function project(percent = .8) {
  return {
    format: 'evacuation-simulator',
    settings: { scenario: 'fire', spreadSpeed: .4, fireSpreadMultiplier: percent },
    floors: [{ id:'floor', name:'Етаж 1', items: [
      {type:'room', id:'a',x:0,y:0,w:150,h:120,people:3},
      {type:'exit',id:'exit',x:148,y:60,width:1.2},
      {type:'hazard',id:'h1',x:10,y:35,radius:6,spreadSpeed:.4,maxRadius:60},
      {type:'hazard',id:'h2',x:10,y:90,radius:6,spreadSpeed:.6,maxRadius:60}
    ] }]
  };
}

test('fire speed is a visible editable value in the fire scenario, not just in Settings', () => {
  const start=html.indexOf('<section id="fireScenarioSettings"');
  const end=html.indexOf('</section>',start);
  const block=html.slice(start,end);
  assert.ok(start>=0);
  for (const id of ['exFireSpeedMultiplier','exFireSpeedSlider','fireSpeedEffective']) {
    assert.ok(block.includes(`id="${id}"`));
    assert.ok(block.indexOf(`id="${id}"`)<block.indexOf('id="fireScenarioHelp" hidden'));
  }
  assert.match(block,/min="20" max="150"/);
  assert.match(block,/ⓘ|class="scenario-info-toggle"/);
  assert.match(source,/project\.settings\.fireSpreadMultiplier=percent\/100/);
  assert.match(source,/updateFireSpeedPreview\(firePercent\)/);
});

test('the speed control scales all fires even if each ignition has its own base speed', () => {
  const slow = Engine.buildModel(project(.2));
  const normal = Engine.buildModel(project(.8));
  const fast = Engine.buildModel(project(1.5));
  assert.deepEqual(slow.hazardSpread.map(h=>Number(h.speed.toFixed(3))),[.08,.12]);
  assert.deepEqual(normal.hazardSpread.map(h=>Number(h.speed.toFixed(3))),[.32,.48]);
  assert.deepEqual(fast.hazardSpread.map(h=>Number(h.speed.toFixed(3))),[.6,.9]);
  assert.deepEqual(Engine.buildModel(project()).settings.fireSpreadMultiplier,.8);
  const flood=project(1.5);flood.settings.scenario='flood';
  assert.equal(Engine.buildModel(flood).hazardSpread.length,0);
});

test('slider and number field stay synchronized, persist changes, and reject edits during simulation',()=>{
  const start=source.indexOf('  // Edit the existing global fire multiplier:');
  const end=source.indexOf('  // The info buttons only reveal supplementary guidance;',start);
  assert.ok(start>0 && end>start);
  const handlers=source.slice(start,end);
  const elements={};
  for (const id of ['exFireSpeedMultiplier','exFireSpeedSlider']) {
    const events={};
    elements[id]={value:'80',events,addEventListener:(event,cb)=>{events[event]=cb;}};
  }
  const saved={settings:{fireSpreadMultiplier:.8}};
  const count={history:0,dirty:0,analysis:0,draw:0,renders:0,toasts:0};
  let simulation=false;
  const ctx={
    $:id=>elements[id],project:saved,
    isSimActive:()=>simulation,
    showToast:()=>count.toasts++,
    renderScenarioExtras:()=>count.renders++,
    updateFireSpeedPreview:()=>{},
    clamp:(x,min,max)=>Math.max(min,Math.min(max,x)),
    pushHistory:()=>count.history++,markDirty:()=>count.dirty++,
    refreshAnalysis:()=>count.analysis++,draw:()=>count.draw++
  };
  vm.runInNewContext(`(function(){${handlers}})()`,ctx);
  elements.exFireSpeedSlider.value='120';
  elements.exFireSpeedSlider.events.input();
  assert.equal(elements.exFireSpeedMultiplier.value,'120');
  elements.exFireSpeedSlider.events.change();
  assert.equal(saved.settings.fireSpreadMultiplier,1.2);
  assert.equal(count.history,1);
  elements.exFireSpeedMultiplier.value='60';
  elements.exFireSpeedMultiplier.events.input();
  assert.equal(elements.exFireSpeedSlider.value,'60');
  elements.exFireSpeedMultiplier.events.change();
  assert.equal(saved.settings.fireSpreadMultiplier,.6);
  assert.equal(count.history,2);
  elements.exFireSpeedMultiplier.value='400';
  elements.exFireSpeedMultiplier.events.change();
  assert.equal(saved.settings.fireSpreadMultiplier,1.5);
  simulation=true;
  elements.exFireSpeedSlider.value='20';
  elements.exFireSpeedSlider.events.change();
  assert.equal(saved.settings.fireSpreadMultiplier,1.5);
  assert.equal(count.history,3);
  assert.ok(count.toasts>=1);
});
