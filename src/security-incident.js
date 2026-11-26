/* Educational security-incident response visualization.
 * Abstract marker motion and shelter indicators; never models an assault,
 * targets occupants, calculates a tactical access route, or tests real barriers.
 */
(function(root,factory){
  const api=factory(); root.EvacSecurity=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const cap=(n,a,b)=>Math.max(a,Math.min(b,n));
 const number=(v,d)=>v==null||v===''||!Number.isFinite(Number(v))?d:Number(v);
 const defaults=Object.freeze({
   securityEnhancedEnabled:false,
   securityRoamEnabled:true,
   securityRoomVisualsEnabled:true,
   securityWarningAtSeconds:0,
   securityEmergencyAtSeconds:1,
   securityEvacuationPercent:0,
   securityRoamPeriodSeconds:105,
   securityHelpConfirmSeconds:30,
   securityHelpArrivalSeconds:180
 });
 function normalize(raw){
   const s=Object.assign({},defaults,raw||{});
   ['securityEnhancedEnabled','securityRoamEnabled','securityRoomVisualsEnabled'].forEach(k=>s[k]=s[k]===true);
   s.securityWarningAtSeconds=cap(number(s.securityWarningAtSeconds,0),0,3600);
   s.securityEmergencyAtSeconds=cap(number(s.securityEmergencyAtSeconds,1),s.securityWarningAtSeconds,3600);
   s.securityEvacuationPercent=cap(number(s.securityEvacuationPercent,0),0,100);
   s.securityRoamPeriodSeconds=cap(number(s.securityRoamPeriodSeconds,105),75,360);
   s.securityHelpConfirmSeconds=cap(number(s.securityHelpConfirmSeconds,30),0,3600);
   s.securityHelpArrivalSeconds=cap(number(s.securityHelpArrivalSeconds,180),s.securityHelpConfirmSeconds,3600);
   return Object.fromEntries(Object.keys(defaults).map(k=>[k,s[k]]));
 }
 function level(settings,time){
   const s=normalize(settings);
   if(!s.securityEnhancedEnabled)return 'legacy';
   if(time<s.securityWarningAtSeconds)return 'normal';
   if(time<s.securityEmergencyAtSeconds)return 'warning';
   return 'emergency';
 }
 function hash(input){let h=2166136261;for(const ch of String(input)){h=Math.imul(h^ch.charCodeAt(0),16777619);}return h>>>0;}
 function point(rect){return {x:rect.x+rect.w*.5,y:rect.y+rect.h*.5};}
 // A neutral starter location so the marker never silently disappears just
 // because the user switched scenarios without first placing it by hand.
 // Prefer corridors for discoverability; no occupant or access targeting.
 function starterLocation(floors,preferredFloor=0){
   const all=Array.isArray(floors)?floors:[];
   const sequence=[preferredFloor,...all.map((_,i)=>i)].filter((fi,i,arr)=>
     Number.isInteger(fi)&&fi>=0&&fi<all.length&&arr.indexOf(fi)===i);
   for(const fi of sequence)for(const type of ['corridor','room']){
     const shapes=(all[fi]&&all[fi].items)||[];
     const spaces=shapes.filter(item=>item&&item.type===type&&
       Number.isFinite(Number(item.x))&&Number.isFinite(Number(item.y))&&
       Number(item.w)>0&&Number(item.h)>0);
     if(spaces.length){
       const rect=spaces.sort((a,b)=>b.w*b.h-a.w*a.h)[0];
       return {floor:fi,...point(rect)};
     }
   }
   return {floor:sequence[0]||0,x:450,y:295};
 }
 // Slow, strictly illustrative marker: it stays inside a single corridor
 // rectangle. Floors change only at a matched staircase location represented
 // inside a corridor on every traversed floor. It never targets occupants,
 // enters rooms, finds access routes, or interacts with doors/barriers.
 function markerPositions(markers,floors,time,settings){
   const s=normalize(settings), storeys=Array.isArray(floors)?floors:[];
   const inside=(p,r)=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h;
   const clampPoint=(p,r)=>({x:cap(p.x,r.x+Math.min(3,r.w/4),r.x+r.w-Math.min(3,r.w/4)),
     y:cap(p.y,r.y+Math.min(3,r.h/4),r.y+r.h-Math.min(3,r.h/4))});
   const rooms=(fi,type)=>((storeys[fi]&&storeys[fi].spaces)||[])
     .filter(space=>space.item&&space.item.type===type)
     .map(space=>space.rect).filter(r=>r&&r.w>12&&r.h>12);
   const corridors=fi=>rooms(fi,'corridor');
   const nearest=(rects,p)=>rects.slice().sort((a,b)=>{
     const q=clampPoint(p,a),v=clampPoint(p,b);
     return Math.hypot(p.x-q.x,p.y-q.y)-Math.hypot(p.x-v.x,p.y-v.y);
   })[0]||null;
   const stairPoints=(fi)=>((storeys[fi]&&storeys[fi].stairs)||[])
     .map(st=>({x:number(st.x,NaN),y:number(st.y,NaN)}))
     .filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&corridors(fi).some(r=>inside(p,r)));
   const matched=(fi,p)=>stairPoints(fi).find(q=>Math.hypot(q.x-p.x,q.y-p.y)<20)||null;
   const crossesWall=(floor,a,b)=>((floor&&floor.walls)||[]).some(w=>{
     if(![w.x,w.y,w.x2,w.y2].every(Number.isFinite))return false;
     const c={x:w.x,y:w.y},d={x:w.x2,y:w.y2};
     const cross=(u,v,t)=>(v.x-u.x)*(t.y-u.y)-(v.y-u.y)*(t.x-u.x);
     const a1=cross(a,b,c),a2=cross(a,b,d),b1=cross(c,d,a),b2=cross(c,d,b);
     return a1*a2<0 && b1*b2<0;
   });
   return (markers||[]).filter(marker=>time>=number(marker.entryAtSeconds,0)).map(marker=>{
     const baseFloor=cap(Math.floor(number(marker.floor,0)),0,Math.max(0,storeys.length-1));
     const original={x:number(marker.x,450),y:number(marker.y,295)};
     const withinRoom=rooms(baseFloor,'room').find(r=>inside(original,r));
     const withinCorridor=corridors(baseFloor).find(r=>inside(original,r));
     const baseCorridor=withinCorridor||nearest(corridors(baseFloor),original);
     const room=baseCorridor||withinRoom||nearest(rooms(baseFloor,'room'),original);
     const label=marker.name||'Обозначител на заплаха';
     if(!s.securityEnhancedEnabled||!s.securityRoamEnabled||!room)
       return {id:marker.id,floor:baseFloor,...original,label,moving:false};
     let floorsToVisit=[baseFloor], stair=null;
     // Only a continuous shaft in adjacent floors is allowed to trigger a
     // schematic storey change. No coordinate-only jumps through walls.
     for(const p of (baseCorridor ? stairPoints(baseFloor) : [])){
       if(!inside(p,baseCorridor)||crossesWall(storeys[baseFloor],original,p))continue;
       let low=baseFloor,high=baseFloor;
       while(low>0 && matched(low-1,p))low--;
       while(high<storeys.length-1 && matched(high+1,p))high++;
       if(high>low && (!stair || high-low>stair.high-stair.low))
         stair={p,low,high};
     }
     if(stair){
       floorsToVisit=[];
       for(let i=stair.low;i<=stair.high;i++)floorsToVisit.push(i);
       // A traversal back along adjacent floors, never last -> first.
       for(let i=stair.high-1;i>stair.low;i--)floorsToVisit.push(i);
       const first=floorsToVisit.indexOf(baseFloor);
       floorsToVisit=floorsToVisit.slice(first).concat(floorsToVisit.slice(0,first));
     }
     const elapsed=Math.max(0,time-number(marker.entryAtSeconds,0));
     const period=s.securityRoamPeriodSeconds;
     const stage=Math.floor(elapsed/period);
     const phase=(elapsed%period)/period;
     const floor=floorsToVisit[stage%floorsToVisit.length];
     let selected=room;
     let start=clampPoint(original,selected);
     if(stair){
       const stairs=matched(floor,stair.p);
       selected=corridors(floor).find(r=>inside(stairs||stair.p,r))||selected;
       start=clampPoint(stairs||stair.p,selected);
     }
     // Out and back along one straight, fully walkable corridor section.
     // Max 90 px each way across >=75 s: comfortably walking-speed or less.
     const alongX=selected.w>=selected.h;
     const maxTravel=Math.min(90,(alongX?selected.w:selected.h)*.42);
     const center=point(selected);
     const direction=alongX?(start.x<=center.x?1:-1):(start.y<=center.y?1:-1);
     let end=clampPoint({x:start.x+(alongX?direction*maxTravel:0),
       y:start.y+(!alongX?direction*maxTravel:0)},selected);
     // If a manually drawn wall splits this corridor, the visual marker
     // stops instead of navigating or crossing the barrier.
     if(stair && stage===0){
       const initial=clampPoint(original,selected);
       if(!crossesWall(storeys[floor],initial,start)){
         end=start;start=initial;
       }
     }
     // A generic collision response: approach an impassable line without
     // crossing it, pause, then retrace the same corridor segment. This is
     // NOT path search, room selection or an adversarial response model.
     let blocked=false;
     if(crossesWall(storeys[floor],start,end)){
       blocked=true;
       let lo=0,hi=1;
       for(let k=0;k<20;k++){
         const mid=(lo+hi)*.5;
         const candidate={x:start.x+(end.x-start.x)*mid,y:start.y+(end.y-start.y)*mid};
         if(crossesWall(storeys[floor],start,candidate))hi=mid;else lo=mid;
       }
       const safe=Math.max(0,lo-.025);
       end={x:start.x+(end.x-start.x)*safe,y:start.y+(end.y-start.y)*safe};
     }
     const outbound=stair&&stage===0;
     const factor=outbound?Math.min(1,phase/.83):
       phase<.37?phase/.37:phase<.62?1:(1-phase)/.38;
     const paused=outbound?phase>=.83:phase>=.37&&phase<.62;
     return {id:marker.id,floor,x:start.x+(end.x-start.x)*factor,
       y:start.y+(end.y-start.y)*factor,headingX:paused?0:(end.x-start.x)*(phase>.62?-1:1),
       headingY:paused?0:(end.y-start.y)*(phase>.62?-1:1),label,moving:!paused,
       motionStatus:paused?(blocked?'blocked':'paused'):'walking'};
   });
 }
 function roomIndicators(model,settings){
   const s=normalize(settings);
   if(!s.securityEnhancedEnabled||!s.securityRoomVisualsEnabled)return [];
   const agentsByRoom=new Set((model.groups||[]).map(g=>String(g.refId)));
   const results=[];
   (model.floors||[]).forEach((floor,fi)=>{
     const furniture=(model.furnitureByFloor&&model.furnitureByFloor.get(fi))||[];
     (floor.spaces||[]).forEach(space=>{
       const rect=space.rect, id=String(space.item&&space.item.id||space.node&&space.node.id);
       if(!rect||!agentsByRoom.has(id))return;
       const furnitureCount=furniture.filter(f=>{
         const x=number(f.x,0)+number(f.w,0)/2,y=number(f.y,0)+number(f.h,0)/2;
         return x>=rect.x&&x<=rect.x+rect.w&&y>=rect.y&&y<=rect.y+rect.h;
       }).length;
       if(space.item&&space.item.type==='room')results.push({id,floor:fi,x:rect.x+rect.w/2,y:rect.y+rect.h/2,
         furnitureCount,label:'Защитно изчакване · учебен символ'});
     });
   });
   return results;
 }
 // Door and classroom activity visuals. These have no collision, resistance,
 // adversary behaviour or routing effects. They depict a fictional drill only.
 function occupiedRooms(model){
   const occupied=new Set((model.groups||[]).filter(g=>g.peopleCount>0)
     .map(g=>String(g.refId)));
   const found=[];
   (model.floors||[]).forEach((floor,fi)=>{
     (floor.spaces||[]).forEach(space=>{
       if(space.item&&space.item.type==='room'&&space.rect&&occupied.has(String(space.item.id)))
         found.push({floor:fi,id:String(space.item.id),rect:space.rect});
     });
   });
   return found;
 }
 function doorForRoom(model,room){
   const r=room.rect;
   const candidates=(model.doorItems||[]).filter(d=>d.floor===room.floor&&d.type==='door')
     .map(d=>{
       const x=number(d.x,NaN),y=number(d.y,NaN);
       if(!Number.isFinite(x)||!Number.isFinite(y))return null;
       const options=[
         {side:'top',distance:Math.abs(y-r.y),aligned:x>=r.x-8&&x<=r.x+r.w+8},
         {side:'bottom',distance:Math.abs(y-r.y-r.h),aligned:x>=r.x-8&&x<=r.x+r.w+8},
         {side:'left',distance:Math.abs(x-r.x),aligned:y>=r.y-8&&y<=r.y+r.h+8},
         {side:'right',distance:Math.abs(x-r.x-r.w),aligned:y>=r.y-8&&y<=r.y+r.h+8}];
       options.sort((a,b)=>a.distance-b.distance);
       const side=options[0];
       if(!side.aligned||side.distance>15)return null;
       return {id:d.id,floor:room.floor,roomId:room.id,x,y,side:side.side,
         distance:side.distance,originalState:d.doorState||'open'};
     }).filter(Boolean).sort((a,b)=>a.distance-b.distance);
   return candidates[0]||null;
 }
 function doorPositions(model,time,settings){
   if(!model||!Array.isArray(model.floors))return [];
   const s=normalize(settings);
   if(!s.securityEnhancedEnabled||!s.securityRoomVisualsEnabled)return [];
   const phase=cap((Math.max(0,time)-s.securityWarningAtSeconds)/1.6,0,1);
   const placed=new Map();
   for(const room of occupiedRooms(model)){
     const door=doorForRoom(model,room);
     if(!door)continue;
     const key=door.floor+':'+String(door.id);
     if(placed.has(key))continue;
     const alreadyClosed=door.originalState==='closed'||door.originalState==='locked';
     const progress=alreadyClosed?1:phase*phase*(3-2*phase);
     placed.set(key,{...door,progress,closed:progress>=1,
       locked:progress>=1 && door.originalState!=='damaged',
       status:progress>=1?'closed':progress>0?'closing':'open'});
   }
   return [...placed.values()];
 }
 // The drill reuses up to four source furniture objects per occupied room.
 // They are chosen by visual distance to its drawn entrance. This is an
 // illustrative layout cue, NOT a mechanically effective barricade model:
 // moved furniture never affects doors, collision, routing or marker motion.
 function classroomFurniturePlan(model){
   const picked=new Map();
   for(const room of occupiedRooms(model)){
     const door=doorForRoom(model,room);
     if(!door)continue;
     const r=room.rect,margin=3,gap=4;
     const inside=((model.furnitureByFloor&&model.furnitureByFloor.get(room.floor))||[])
       .filter(f=>{
         const w=Math.max(0,number(f.w,0)),h=Math.max(0,number(f.h,0));
         const x=number(f.x,0)+w/2,y=number(f.y,0)+h/2;
         return w>0&&h>0&&w<=r.w-2*margin&&h<=r.h-2*margin&&
           x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h;
       })
       .sort((a,b)=>{
         const dist=f=>Math.hypot(number(f.x,0)+number(f.w,0)/2-door.x,
           number(f.y,0)+number(f.h,0)/2-door.y);
         return dist(a)-dist(b)||String(a.id).localeCompare(String(b.id));
       }).slice(0,4);
     // Compact 2x2 visual group just inside the room. A small visible inset
     // keeps the rendered meshes inside the room and is not a door-fit rule.
     const rows=[];
     for(let i=0;i<inside.length;i+=2)rows.push(inside.slice(i,i+2));
     let depth=0;
     for(let ri=0;ri<rows.length;ri++){
       const row=rows[ri],horizontal=door.side==='top'||door.side==='bottom';
       const major=Math.max(...row.map(f=>number(horizontal?f.h:f.w,0)));
       const cross=row.reduce((n,f)=>n+number(horizontal?f.w:f.h,0),0)+gap*(row.length-1);
       let position=(horizontal?door.x:door.y)-cross/2;
       // Keep each group within the source rectangle rather than in a
       // corridor; the setting does not change navigability in any way.
       const minCross=horizontal?r.x+margin:r.y+margin;
       const maxCross=horizontal?r.x+r.w-margin:r.y+r.h-margin;
       position=cap(position,minCross,Math.max(minCross,maxCross-cross));
       for(let col=0;col<row.length;col++){
         const f=row[col],w=number(f.w,0),h=number(f.h,0);
         const x=horizontal?position:
           door.side==='left'?r.x+margin+depth:r.x+r.w-margin-depth-major;
         const y=horizontal?(door.side==='top'?r.y+margin+depth:r.y+r.h-margin-depth-major):position;
         const goalX=cap(x,r.x+margin,Math.max(r.x+margin,r.x+r.w-w-margin));
         const goalY=cap(y,r.y+margin,Math.max(r.y+margin,r.y+r.h-h-margin));
         picked.set(room.floor+':'+String(f.id),{room,door,index:ri*2+col,goalX,goalY});
         position+=(horizontal?w:h)+gap;
       }
       depth+=major+gap;
     }
   }
   return picked;
 }
 function furniturePositions(model,time,settings){
   if(!model||!Array.isArray(model.floors))return [];
   const s=normalize(settings),active=s.securityEnhancedEnabled&&s.securityRoomVisualsEnabled;
   const stage=active?cap((Math.max(0,time)-s.securityWarningAtSeconds-1.0)/5,0,1):0;
   const progress=stage*stage*(3-2*stage);
   const rooms=occupiedRooms(model);
   const chosen=active?classroomFurniturePlan(model):new Map();
   const results=[];
   model.floors.forEach((floor,fi)=>{
     const items=(model.furnitureByFloor&&model.furnitureByFloor.get(fi))||[];
     items.forEach(item=>{
       const x=number(item.x,0),y=number(item.y,0);
       const w=Math.max(0,number(item.w,0)),h=Math.max(0,number(item.h,0));
       const cx=x+w/2,cy=y+h/2;
       const room=rooms.find(room=>room.floor===fi&&cx>=room.rect.x&&cx<=room.rect.x+room.rect.w&&
         cy>=room.rect.y&&cy<=room.rect.y+room.rect.h);
       const picked=chosen.get(fi+':'+String(item.id));
       let goalX=picked?picked.goalX:x,goalY=picked?picked.goalY:y;
       if(active&&room&&!picked&&!doorForRoom(model,room)){
         // Older sketches without doors keep their original interior-only cue.
         const r=room.rect,margin=6;
         goalX=cap(x+cap((r.x+r.w/2-cx)*.23,-24,24),r.x+margin,
           Math.max(r.x+margin,r.x+r.w-w-margin));
         goalY=cap(y+cap((r.y+r.h/2-cy)*.23,-24,24),r.y+margin,
           Math.max(r.y+margin,r.y+r.h-h-margin));
       }
       const adjusted=active&&!!room&&progress>0&&(Math.abs(goalX-x)+Math.abs(goalY-y)>.1);
       results.push({id:item.id,floor:fi,type:item.furnitureType||'desk',w,h,
         x:x+(goalX-x)*progress,y:y+(goalY-y)*progress,
         originalX:x,originalY:y,progress:adjusted?progress:0,
         roomId:room?room.id:null,movingActor:!!picked,adjusted});
     });
   });
   return results;
 }
 // Associate already simulated people with the furniture visual, without
 // changing person counts, source agent coordinates or their protective status.
 function actorPositions(model,agents,time,settings,furniture){
   const s=normalize(settings);
   if(!s.securityEnhancedEnabled||!s.securityRoomVisualsEnabled)return [];
   const elapsed=time-s.securityWarningAtSeconds;
   if(elapsed<0||elapsed>=8.5)return [];
   const rooms=occupiedRooms(model);
   const all=Array.isArray(agents)?agents:[];
   const output=[];
   for(const room of rooms){
     const roomFurniture=(furniture||[]).filter(f=>f.floor===room.floor&&f.roomId===room.id&&f.movingActor);
     const members=all.filter(a=>a.floor===room.floor&&model.groups[a.groupIndex]&&
       String(model.groups[a.groupIndex].refId)===room.id&&a.profile!=='limited');
     roomFurniture.slice(0,Math.min(members.length,4)).forEach((f,i)=>{
       const actor=members[i];
       const r=room.rect;
       const targetX=cap(f.x+f.w/2-8,r.x+9,r.x+r.w-9);
       const targetY=cap(f.y+f.h/2+Math.min(8,f.h*.25),r.y+9,r.y+r.h-9);
       // During the initial beat the figure walks up to the furniture; later
       // it follows its animated position, then resumes protective waiting.
       const fraction=elapsed<1?cap(elapsed,0,1):elapsed<6?1:cap((8.5-elapsed)/2.5,0,1);
       const smooth=fraction*fraction*(3-2*fraction);
       output.push({id:actor.id,floor:actor.floor,
         x:actor.spawnX+(targetX-actor.spawnX)*smooth,
         y:actor.spawnY+(targetY-actor.spawnY)*smooth,
         state:'moving',refugeKind:null});
     });
     // Another existing figure visually approaches the room's door while its
     // leaf closes. This is a simple animation, not an access or lock model.
     const door=doorForRoom(model,room);
     const closer=door&&members[roomFurniture.length];
     if(closer && elapsed<3.2){
       const r=room.rect;
       const px=cap(door.x,r.x+12,r.x+r.w-12);
       const py=cap(door.y,r.y+12,r.y+r.h-12);
       const fraction=elapsed<1.5?cap(elapsed/1.5,0,1):
         elapsed<2?1:cap((3.2-elapsed)/1.2,0,1);
       const eased=fraction*fraction*(3-2*fraction);
       output.push({id:closer.id,floor:closer.floor,
         x:closer.spawnX+(px-closer.spawnX)*eased,
         y:closer.spawnY+(py-closer.spawnY)*eased,
         state:'moving',refugeKind:null});
     }
   }
   return output;
 }
 function helpStatus(settings,time,hasAdult){
   const s=normalize(settings),sent=number(settings&&settings.threatHelpCallAtSeconds,12);
   if(!hasAdult||settings&&settings.threatHelpCallEnabled===false)return 'none';
   if(time<sent)return 'pending';
   if(!s.securityEnhancedEnabled)return 'sent';
   if(time<s.securityHelpConfirmSeconds)return 'sent';
   if(time<s.securityHelpArrivalSeconds)return 'confirmed';
   return 'assistance';
 }
 return {defaults,normalize,level,markerPositions,starterLocation,roomIndicators,doorPositions,furniturePositions,actorPositions,helpStatus};
});
