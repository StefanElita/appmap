/* Educational disaster presets, never normative safety guidance. */
(function(root,factory){
 const api=factory(); if(typeof module==='object'&&module.exports)module.exports=api;
 root.EvacDisasters=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
 const number=(x,d)=>Number.isFinite(Number(x))?Number(x):d;
 const defaults=Object.freeze({
   floodGroundRiseEnabled:true, floodRiseMetersPerSecond:0.06,
   floodMaxHeightMeters:null, floodStartSeconds:0,
   quakeMagnitude:6.0, quakeShakingSeconds:12,
   quakeCollapseEnabled:false, quakeCollapseAtSeconds:55,
   threatHelpCallEnabled:true, threatHelpCallAtSeconds:12
 });
 function normalize(s){const x=Object.assign({},defaults,s||{});
   // Whole-floor rising water is the only flood mode (never a radial hazard).
   x.floodGroundRiseEnabled=x.scenario==='flood'||x.floodGroundRiseEnabled===true;
   x.floodRiseMetersPerSecond=clamp(number(x.floodRiseMetersPerSecond,.06),.005,1);
   const cap=x.floodMaxHeightMeters;
   // Missing or invalid cap must remain empty. It must be explicitly provided.
   x.floodMaxHeightMeters=cap==null||String(cap).trim()===''||!Number.isFinite(Number(cap))||Number(cap)<.1||Number(cap)>30
     ?null:Number(cap);
   x.floodStartSeconds=clamp(number(x.floodStartSeconds,0),0,3600);
   x.quakeMagnitude=clamp(number(x.quakeMagnitude,6.0),1,10);
   x.quakeShakingSeconds=clamp(number(x.quakeShakingSeconds,12),2,180);
   x.quakeCollapseEnabled=x.quakeCollapseEnabled===true;
   x.quakeCollapseAtSeconds=clamp(number(x.quakeCollapseAtSeconds,55),5,3600);
   x.threatHelpCallEnabled=x.threatHelpCallEnabled!==false;
   x.threatHelpCallAtSeconds=clamp(number(x.threatHelpCallAtSeconds,12),0,3600);
   return x;
 }
 function waterLevel(s,time){const x=normalize(s);
   return x.floodGroundRiseEnabled && x.floodMaxHeightMeters!=null ? Math.min(x.floodMaxHeightMeters,
     Math.max(0,number(time,0)-x.floodStartSeconds)*x.floodRiseMetersPerSecond):0;
 }
 function waterDepth(s,floor,time){return Math.max(0,waterLevel(s,time)-Math.max(0,number(floor,0))*number(s&&s.floorHeight,3.2));}
 function quakePolicy(s,floor,travelTime,medianTravel){const x=normalize(s),m=x.quakeMagnitude;
   // Only simulated shelter/evacuation decisions; no doorway recommendation.
   if(m<3) return travelTime>=Math.max(8,medianTravel) ? 'temporary-cover' : 'evacuate-after-shaking';
   if(m<6) return floor>0 ? 'stay-sheltered' : 'evacuate-after-shaking';
   return 'evacuate-after-shaking';
 }
 // Magnitude 9+ automatically schedules a WHOLE-BUILDING structural event.
 // Values between 9 and 10 are rounded to the nearest whole magnitude;
 // 9 -> 5:00, 10 -> 3:00 (simulation time, not wall-clock minutes).
 // For magnitude 8–8.9 the older opt-in custom timer is retained.
 function automaticCollapseAt(s){
   const m=normalize(s).quakeMagnitude;
   if(m<9)return Infinity;
   return Math.round(m)>=10 ? 180 : 300;
 }
 function collapseAt(s){
   const x=normalize(s),automatic=automaticCollapseAt(x);
   return Number.isFinite(automatic)?automatic:(x.quakeMagnitude>=8&&x.quakeCollapseEnabled?x.quakeCollapseAtSeconds:Infinity);
 }
 // The whole structure (all storeys, walls, people and furniture) shares the
 // same visual shake offset. Never represents a wave from room to room.
 function quakeShakeAt(s,time){
   const x=normalize(s),t=number(time,0),duration=x.quakeShakingSeconds;
   if(t<=0||t>=duration||x.quakeMagnitude<=0)return {x:0,z:0,tilt:0,active:false};
   const envelope=Math.min(1,t/.6,(duration-t)/.8);
   const strength=clamp(x.quakeMagnitude/10,.05,1)*envelope;
   const a=Math.sin(t*15.2)+.34*Math.sin(t*25.1);
   const b=Math.sin(t*12.8+1.4)+.25*Math.sin(t*21.7);
   return {x:.17*strength*a,z:.15*strength*b,
     tilt:.008*strength*Math.sin(t*8.5),active:true};
 }
 return {defaults,normalize,waterLevel,waterDepth,quakePolicy,collapseAt,automaticCollapseAt,quakeShakeAt};
});
