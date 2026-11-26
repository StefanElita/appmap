'use strict';
/* Small educational 2D visibility-graph router for static furniture. No claims of real-world safety. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EvacFurnitureNav = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const center = f => ({x:f.x+f.w/2,y:f.y+f.h/2,floor:f.floor});
  const contains = (r,p) => p.x > r.x && p.x < r.x+r.w && p.y > r.y && p.y < r.y+r.h;
  const expanded = (f,pad=4) => ({x:f.x-pad,y:f.y-pad,w:f.w+pad*2,h:f.h+pad*2});
  function intersects(a,b,r) {
    // Liang-Barsky clipping (strict interior; corner tangency is allowed).
    let lo=0,hi=1;
    const dx=b.x-a.x,dy=b.y-a.y;
    const constraints=[[-dx,a.x-r.x],[dx,r.x+r.w-a.x],[-dy,a.y-r.y],[dy,r.y+r.h-a.y]];
    for(const [p,q] of constraints){
      if(Math.abs(p)<1e-10){if(q<=0)return false;continue;}
      const t=q/p;
      if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
      if(lo>hi)return false;
    }
    return lo<hi-1e-7 && hi>lo+1e-7;
  }
  function findPath(start,end,items,options={}) {
    if(!start||!end)return null;
    const padding=Math.max(2,Number(options.padding)||5);
    const raw=(items||[]).filter(f=>f&&f.type==='furniture'&&f.w>0&&f.h>0&&
      (start.floor==null||f.floor==null||f.floor===start.floor));
    const obstacles=raw.map(f=>expanded(f,padding)).filter(r=>{
      const margin=75;
      return r.x<Math.max(start.x,end.x)+margin && r.x+r.w>Math.min(start.x,end.x)-margin &&
        r.y<Math.max(start.y,end.y)+margin && r.y+r.h>Math.min(start.y,end.y)-margin &&
        !contains(r,start) && !contains(r,end);
    }).slice(0,35);
    const visible=(a,b)=>!obstacles.some(r=>intersects(a,b,r));
    if(visible(start,end))return [start,end];
    const nodes=[start,end];
    const epsilon=.7;
    obstacles.forEach(r=>{
      [[r.x-epsilon,r.y-epsilon],[r.x+r.w+epsilon,r.y-epsilon],
        [r.x+r.w+epsilon,r.y+r.h+epsilon],[r.x-epsilon,r.y+r.h+epsilon]]
        .forEach(([x,y])=>nodes.push({x,y,floor:start.floor}));
    });
    const cost=new Float64Array(nodes.length).fill(Infinity),prev=new Int32Array(nodes.length).fill(-1);
    const done=new Uint8Array(nodes.length);cost[0]=0;
    for(let step=0;step<nodes.length;step++){
      let u=-1;
      for(let i=0;i<nodes.length;i++)if(!done[i]&&(u<0||cost[i]<cost[u]))u=i;
      if(u<0||!Number.isFinite(cost[u]))break;
      if(u===1)break;
      done[u]=1;
      for(let v=0;v<nodes.length;v++){
        if(v===u||done[v]||!visible(nodes[u],nodes[v]))continue;
        const candidate=cost[u]+distance(nodes[u],nodes[v]);
        if(candidate<cost[v]){cost[v]=candidate;prev[v]=u;}
      }
    }
    if(!Number.isFinite(cost[1]))return null;
    const path=[];let n=1;while(n!==-1){path.unshift(nodes[n]);n=prev[n];}
    return path;
  }
  function detourLegs(legs, byFloor, pxPerMeter=25) {
    const result=[];
    for(const leg of legs||[]){
      if(leg.from.floor!==leg.to.floor){result.push(leg);continue;}
      const furniture=byFloor && byFloor.get(leg.from.floor) || [];
      const path=findPath(leg.from,leg.to,furniture);
      if(!path){ // Do not walk through an impassable arrangement.
        result.push(Object.assign({},leg,{furnitureBlocked:true}));continue;
      }
      if(path.length===2){result.push(leg);continue;}
      for(let i=1;i<path.length;i++){
        const last=i===path.length-1;
        result.push(Object.assign({},leg,{
          from: Object.assign({},path[i-1]),to:Object.assign({},path[i]),
          distance:distance(path[i-1],path[i])/Math.max(2,pxPerMeter),
          gateId:last?leg.gateId:null,edgeId:last?leg.edgeId:null,
          toNode:last?leg.toNode:null,kind:last?leg.kind:'furniture-detour'
        }));
      }
    }
    return result;
  }
  function findRefuge(point, furniture, kind, maxDistance=200) {
    const accepted=kind==='quake'?['desk','table']:['desk','table','bed'];
    return (furniture||[]).filter(f=>accepted.includes(f.furnitureType)&&
      (f.floor==null||f.floor===point.floor)&&distance(point,center(f))<=maxDistance)
      .map(f=>({furniture:f,point:center(f),distance:distance(point,center(f))}))
      .sort((a,b)=>a.distance-b.distance)[0]||null;
  }
  return {findPath,detourLegs,findRefuge,intersects,center};
});
