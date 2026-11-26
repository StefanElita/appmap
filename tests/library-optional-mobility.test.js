'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Library = require('../src/building-library.js');
const Engine = require('../src/simulation-engine.js');
const Runner = require('../src/simulation-runner.js');

test('all library presets default to zero limited-mobility agents', () => {
  assert.equal(Library.PRESETS.length, 15);
  for (const preset of Library.PRESETS) {
    const project = Library.generate({preset: preset.id, seed: 2026});
    assert.equal(project.settings.populationProfiles.limited, 0, preset.id);
    const model = Engine.buildModel(project, {scenario: 'quake'});
    const sim = Runner.createSimulation(model, {preMovement: 0, timeout: 500});
    assert.equal(sim.agents.filter(a => a.profile === 'limited').length, 0, preset.id);
  }
});

test('library user can explicitly add people with limited mobility', () => {
  const project = Library.generate({preset:'school', floors:1, roomsPerSide:2, people:20, seed:2026, limitedPercent:25});
  assert.equal(project.settings.populationProfiles.limited,25);
  const model = Engine.buildModel(project, {scenario: 'quake'});
  const sim = Runner.createSimulation(model, {preMovement: 0});
  assert.ok(sim.agents.some(a=>a.profile==='limited'));
  assert.ok(sim.agents.some(a=>a.profile==='adult'));
});

test('explicit profile settings in existing projects remain effective', () => {
  const project = Library.generate({preset:'office', floors:1, roomsPerSide:2, people:20, seed:2026});
  project.settings.populationProfiles = {children:10,older:10,limited:40};
  const model = Engine.buildModel(project,{scenario:'quake'});
  assert.equal(model.settings.populationProfiles.limited,40);
  const sim = Runner.createSimulation(model, {preMovement:0});
  assert.ok(sim.agents.some(a=>a.profile==='limited'));
});

test('simulation engine default and no-profile fallback do not add limited-mobility people', () => {
  assert.equal(Engine.DEFAULTS.populationProfiles.limited,0);
  const project = Library.generate({preset:'school', floors:1, roomsPerSide:2, people:20, seed:2});
  delete project.settings.populationProfiles;
  const model = Engine.buildModel(project,{scenario:'quake'});
  const sim=Runner.createSimulation(model,{preMovement:0});
  assert.equal(sim.agents.filter(a=>a.profile==='limited').length,0);
});
