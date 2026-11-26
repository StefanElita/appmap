'use strict';
/* Manual corrections placed on the image BEFORE importing the plan. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.EvacSketchTools=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function snapToWall(point,rooms,tolerance=23){
    let best=null,bestDistance=Infinity;
    for(const r of rooms||[]){if(r.selected===false)continue;
      const candidates=[{x:clamp(point.x,r.x,r.x+r.w),y:r.y,side:'top'},
        {x:clamp(point.x,r.x,r.x+r.w),y:r.y+r.h,side:'bottom'},
        {x:r.x,y:clamp(point.y,r.y,r.y+r.h),side:'left'},
        {x:r.x+r.w,y:clamp(point.y,r.y,r.y+r.h),side:'right'}];
      for(const c of candidates){const d=Math.hypot(point.x-c.x,point.y-c.y);
        if(d<bestDistance){bestDistance=d;best=c;}}
    }
    return best && bestDistance<=tolerance?best:null;
  }
  function createMarker(kind,point,rooms,{peopleCount=1,widthPixels=20}={}){
    if(!['door','exit','window','people'].includes(kind))return null;
    let loc={x:Math.round(point.x),y:Math.round(point.y)};
    if(kind!=='people'){
      const snapped=snapToWall(loc,rooms);
      if(snapped)loc={x:Math.round(snapped.x),y:Math.round(snapped.y),side:snapped.side};
    }
    if(kind==='people')return {kind:'people',x:loc.x,y:loc.y,count:clamp(Math.round(peopleCount)||1,1,500),selected:true,manual:true};
    return {kind,x:loc.x,y:loc.y,side:loc.side||null,selected:true,manual:true,
      gapPx:clamp(Number(widthPixels)||20,6,140),confidence:1};
  }
  function nearestMarker(point,markers,radius=15){
    let hit=null,dist=radius;
    for(const marker of markers||[]){const d=Math.hypot(point.x-marker.x,point.y-marker.y);
      if(d<=dist){dist=d;hit=marker;}}
    return hit;
  }
  function toSceneItems(openings,markers,mapper,meters,imageWidth){
    const items=[];
    for(const [index,o] of (openings||[]).filter(o=>o.selected).entries()){
      const point=mapper({x:o.x,y:o.y,w:1,h:1});
      const width=clamp((o.gapPx||18)*(meters/imageWidth),.5,3);
      items.push({type:o.kind,name:(o.manual?'Ръчно поставен ':'Потвърдено предложение ')+(index+1),
        x:point.x,y:point.y,width,doorState:'open',open:true,
        importedFromImage:true,approximate:!o.manual,confidence:o.confidence});
    }
    for(const [index,m] of (markers||[]).filter(m=>m.selected!==false).entries()){
      const point=mapper({x:m.x,y:m.y,w:1,h:1});
      if(m.kind==='people')items.push({type:'people',name:'Добавени хора '+(index+1),
        x:point.x,y:point.y,count:clamp(Number(m.count)||1,1,500),importedFromImage:true});
      else if(m.kind==='furniture'){
        const dims=mapper({x:m.x-m.w/2,y:m.y-m.h/2,w:m.w,h:m.h});
        items.push({type:'furniture',name:'Мебел от скицата',furnitureType:m.furnitureType,
          x:dims.x,y:dims.y,w:dims.w,h:dims.h,importedFromImage:true});
      }else if(['stairs','safezone'].includes(m.kind))items.push({type:m.kind,
        name:'Ръчно поставено '+m.kind,x:point.x,y:point.y,width:1.2,importedFromImage:true});
    }
    return items;
  }
  return {snapToWall,createMarker,nearestMarker,toSceneItems};
});
