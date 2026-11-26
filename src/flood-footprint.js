/*
 * A shared 2D/3D footprint for the level-based educational flood model.
 * The water level is shared across the floor, but its *drawing* is confined to
 * the union of interior room and corridor rectangles (never the empty space
 * inside their overall bounding box, and never courtyard rectangles).
 */
(function(root,factory){
  const api=factory();
  root.EvacFloodFootprint=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function unionRectangles(input){
    const rects=(Array.isArray(input)?input:[]).filter(r=>r&&
      [r.x,r.y,r.w,r.h].every(v=>Number.isFinite(Number(v)))&&
      Number(r.w)>0&&Number(r.h)>0).map(r=>({
        x:Number(r.x),y:Number(r.y),w:Number(r.w),h:Number(r.h)
      }));
    if(!rects.length)return [];
    // Sweep the x coordinate of every rectangle edge. The union of the y
    // intervals in each strip is disjoint by construction. Merge identical
    // intervals across consecutive strips to reduce the number of water boxes.
    const xs=[...new Set(rects.flatMap(r=>[r.x,r.x+r.w]))].sort((a,b)=>a-b);
    const finished=[],active=new Map();
    for(let i=0;i<xs.length-1;i++){
      const x=xs[i],end=xs[i+1];
      if(end-x<=1e-9)continue;
      const ranges=rects.filter(r=>r.x<=x+1e-9&&r.x+r.w>=end-1e-9)
        .map(r=>[r.y,r.y+r.h]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
      const merged=[];
      for(const range of ranges){
        const last=merged[merged.length-1];
        if(last&&range[0]<=last[1]+1e-9)last[1]=Math.max(last[1],range[1]);
        else merged.push([...range]);
      }
      const next=new Map();
      for(const [low,high] of merged){
        const key=low+'|'+high;
        const previous=active.get(key);
        if(previous&&Math.abs(previous.x+previous.w-x)<1e-9){
          previous.w=end-previous.x;
          next.set(key,previous);
        }else{
          next.set(key,{x,y:low,w:end-x,h:high-low});
        }
      }
      for(const [key,tile] of active)if(!next.has(key))finished.push(tile);
      active.clear();
      for(const [key,tile] of next)active.set(key,tile);
    }
    finished.push(...active.values());
    return finished;
  }
  function interiorRects(floor){
    return ((floor&&floor.spaces)||[]).filter(space=>space&&space.rect&&
      space.item&&['room','corridor'].includes(space.item.type))
      .map(space=>space.rect);
  }
  // Stable simulation models keep their room geometry, so share cached tiles
  // between repeated 2D frames and 3D playback without recalculating unions.
  const cache=new WeakMap();
  function tilesForFloor(floor){
    if(!floor)return [];
    if(!cache.has(floor))cache.set(floor,unionRectangles(interiorRects(floor)));
    return cache.get(floor);
  }
  return {unionRectangles,interiorRects,tilesForFloor};
});
