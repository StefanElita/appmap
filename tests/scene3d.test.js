const test = require('node:test');
const assert = require('node:assert/strict');
const { sampleAtTime, perspective, lookAt, multiply, openingsOnLine } = require('../src/scene3d.js');

function history() {
  return [
    { state: {time:0, safe:0}, agents:[{id:1, floor:0, x:0, y:0, state:'moving', profile:'adult'}, {id:2, floor:0,x:8,y:8,state:'waiting',profile:'child'}] },
    { state: {time:2, safe:1}, agents:[{id:1, floor:1, x:40, y:80, state:'safe', profile:'adult'}, {id:2, floor:0,x:8,y:8,state:'moving',profile:'child'}] }
  ];
}
test('3D replay interpolates actual agent positions and floor transition', () => {
  const frame=sampleAtTime(history(),1);
  assert.equal(frame.time,1);
  assert.equal(frame.agents[0].x,20);
  assert.equal(frame.agents[0].y,40);
  assert.equal(frame.agents[0].floorBlend,.5);
  assert.equal(frame.agents[0].profile,'adult');
  assert.equal(frame.agents[1].x,8);
  assert.equal(frame.agents[0].state,'safe');
});
test('3D replay clamps timeline and handles empty recording', () => {
  assert.equal(sampleAtTime([],100),null);
  assert.equal(sampleAtTime(history(),-90).agents[0].x,0);
  assert.equal(sampleAtTime(history(),90).agents[0].x,40);
});
test('3D room wall openings match editor doors', () => {
  const floor={items:[{type:'door',x:50,y:0,width:1.2},{type:'hazard',x:24,y:0}]};
  const intervals=openingsOnLine(floor,0,0,100,0,25);
  assert.equal(intervals.length,1);
  assert.ok(intervals[0][0]<.5 && intervals[0][1]>.5);
  assert.equal(openingsOnLine({items:[]},0,0,100,0,25).length,0);
});
test('3D camera view-projection has valid perspective', () => {
  const m=multiply(perspective(Math.PI/3,16/9,.1,300),lookAt([18,15,18],[0,0,0]));
  assert.equal(m.length,16);
  assert.ok(m.every(Number.isFinite));
  assert.ok(m[15]>0);
});
