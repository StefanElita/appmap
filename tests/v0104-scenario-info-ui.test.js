'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const dir=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(dir,'src/index.html'),'utf8');
const js=fs.readFileSync(path.join(dir,'src/app.js'),'utf8');
const css=fs.readFileSync(path.join(dir,'src/styles.css'),'utf8');
const scenarios=[
  ['fire','fireScenarioHelp','addFireIgnition','fireIgnitionCount'],
  ['flood','floodScenarioHelp','exFloodRise','exFloodMax','exFloodStart'],
  ['quake','quakeScenarioHelp','exQuakeMagnitude','exQuakeDuration','exQuakeCollapse','exCollapseAt'],
  ['threat','threatScenarioHelp','addThreatMarker','exHelpCall','exHelpCallAt']
];

test('four scenarios show their action and editable parameters, with descriptions hidden by default',()=>{
  for(const [scenario,helpId,...fields] of scenarios){
    const start=html.indexOf(`<section id="${scenario}ScenarioSettings"`);
    const end=html.indexOf('</section>',start);
    assert.ok(start>0 && end>start,`missing ${scenario} scenario`);
    const block=html.slice(start,end);
    assert.match(block,new RegExp(`class="scenario-info-toggle"[^>]+aria-expanded="false"[^>]+aria-controls="${helpId}"`));
    const helpIndex=block.indexOf(`id="${helpId}" hidden`);
    assert.ok(helpIndex>0,`help for ${scenario} must initially be hidden`);
    for(const id of fields){
      const i=block.indexOf(`id="${id}"`);
      assert.ok(i>=0 && i<helpIndex,`${id} is missing or hidden inside help text`);
    }
  }
  assert.match(css,/\.scenario-help-panel\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('clicking information buttons reveals and hides help without altering input values',()=>{
  const start=js.indexOf('  // The info buttons only reveal supplementary guidance;');
  const end=js.indexOf('  const fields=',start);
  assert.ok(start>0 && end>start);
  const handlers=js.slice(start,end);
  const panels=new Map();
  const buttons=[];
  for(const [,helpId] of scenarios){
    const panel={hidden:true};panels.set(helpId,panel);
    const attrs={'aria-controls':helpId,'aria-expanded':'false'};
    const events={};
    const button={
      title:'Покажи информация',
      getAttribute:(key)=>attrs[key],
      setAttribute:(key,value)=>{attrs[key]=value;},
      addEventListener:(name,callback)=>{events[name]=callback;}
    };
    buttons.push({button,attrs,events,panel});
  }
  const document={querySelectorAll:(selector)=>{
    assert.equal(selector,'#disasterScenarioSettings .scenario-info-toggle');
    return buttons.map(item=>item.button);
  }};
  vm.runInNewContext(`(function(){${handlers}})()`,{document,$:(id)=>panels.get(id)});
  const originalInput={value:'6.2',onchange:()=>{}};
  for(const {attrs,events,panel,button} of buttons){
    assert.equal(typeof events.click,'function');
    assert.equal(panel.hidden,true);
    events.click();
    assert.equal(panel.hidden,false);
    assert.equal(attrs['aria-expanded'],'true');
    assert.equal(button.title,'Скрий информация');
    assert.equal(originalInput.value,'6.2');
    events.click();
    assert.equal(panel.hidden,true);
    assert.equal(attrs['aria-expanded'],'false');
    assert.equal(button.title,'Покажи информация');
  }
});

test('no duplicate IDs among the advanced scenario controls and panels',()=>{
  const start=html.indexOf('<div class="group" id="disasterScenarioSettings">');
  const end=html.indexOf('<div class="group" id="scenarioExtras">',start);
  const ids=Array.from(html.slice(start,end).matchAll(/\bid="([^"]+)"/g),m=>m[1]);
  assert.equal(ids.length,new Set(ids).size);
});
