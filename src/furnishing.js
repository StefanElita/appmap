'use strict';
/* Optional, schematic furniture and seating suggestions. Geometry is visual only;
 * it is NOT certified occupancy capacity, collision or accessibility analysis.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EvacFurnishing = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  const TYPES = Object.freeze({
    desk: { label:'Чин / бюро', color:'#bf9572', w:28,h:17 },
    chair: { label:'Стол', color:'#65a9d0', w:12,h:12 },
    table: { label:'Маса', color:'#c9a57d', w:39,h:24 },
    bed: { label:'Легло', color:'#a8b7d9', w:49,h:25 },
    shelf: { label:'Шкаф / рафт', color:'#8d779d', w:38,h:12 },
    sofa: { label:'Диван', color:'#8eab94', w:44,h:20 }
  });
  const PRESETS = Object.freeze({
    classroom:'Класна стая', office:'Офис', meeting:'Заседателна', dwelling:'Жилищна',
    library:'Библиотека', hall:'Зала', other:'Свободно'
  });
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function layout(room,preset,requested) {
    if (!room || !Number.isFinite(room.w) || !Number.isFinite(room.h) || room.w<45 || room.h<38) return {furniture:[],seats:[]};
    const kind=PRESETS[preset]?preset:'other';
    const target=clamp(Math.round(requested == null ? 12 : (Number(requested)||0)),0,120);
    const furniture=[],seats=[];
    if (target === 0) return {furniture,seats};
    const margin=14;
    const usableW=room.w-2*margin, usableH=room.h-2*margin;
    const push=(type,x,y,w,h)=>{
      if (x<room.x+6||y<room.y+6||x+w>room.x+room.w-6||y+h>room.y+room.h-6) return false;
      furniture.push({type:'furniture',kind,x:Math.round(x),y:Math.round(y),w:Math.round(w),h:Math.round(h),furnitureType:type,
        name:TYPES[type].label,approximate:true});return true;
    };
    if (kind==='corridor'||kind==='storage') return {furniture,seats};
    if (kind==='dwelling') {
      if (usableW>=70 && usableH>=45) {
        push('bed',room.x+margin+4,room.y+margin+4,Math.min(65,usableW*.48),Math.min(31,usableH*.5));
        push('table',room.x+room.w-margin-45,room.y+margin+4,33,23);
        seats.push({x:room.x+room.w-margin-25,y:room.y+margin+42});
      }
      return {furniture,seats:seats.slice(0,target||2)};
    }
    const rows=kind==='meeting'?2:Math.max(1,Math.floor(usableH/(kind==='hall'?31:42)));
    const cols=Math.max(1,Math.floor(usableW/(kind==='hall'?38:48)));
    const max=Math.min(100,rows*cols,target);
    for (let n=0;n<max;n++) {
      const col=n%cols,row=Math.floor(n/cols);
      const cx=room.x+margin+(col+.5)*usableW/cols;
      const cy=room.y+margin+(row+.5)*usableH/rows;
      const type=kind==='library'?'shelf':kind==='meeting'?'table':kind==='hall'?'chair':'desk';
      const dw=Math.min(TYPES[type].w,usableW/cols*.76),dh=Math.min(TYPES[type].h,usableH/rows*.43);
      if (type!=='chair') push(type,cx-dw/2,cy-dh/2,dw,dh);
      if (kind!=='library') {
        const sy=cy+Math.max(6,dh/2+5);
        const sw=11;
        if (sy+sw/2<room.y+room.h-5) {
          push('chair',cx-sw/2,sy-sw/2,sw,sw);
          seats.push({x:Math.round(cx),y:Math.round(sy)});
        }
      }
    }
    return {furniture,seats};
  }
  function peopleForSeats(seats, count, label) {
    // Explicit group markers only; the room itself must have people=0 so numbers aren't duplicated.
    const n=clamp(Math.round(Number(count)||0),0,seats.length);
    return seats.slice(0,n).map((s,i)=>({type:'people',x:s.x,y:s.y,count:1,name:(label||'Място')+' '+(i+1),approximate:true}));
  }
  return {TYPES,PRESETS,layout,peopleForSeats};
});
