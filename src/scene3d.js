/*
 * Evacuation Simulator — dependency-free WebGL 3D playback.
 * Uses the real editor geometry and simulation snapshots. Coordinates, profile
 * sizes and smoke colors are illustrative; this is NOT a fire/egress engineering model.
 */
(function (root, factory) {
  const api = factory();
  root.EvacScene3D = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const finite = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
  const DisasterPresets=(typeof globalThis!=='undefined'&&globalThis.EvacDisasters) ||
    (typeof require==='function'?require('./disaster-presets.js'):null);
  const FloodFootprint=(typeof globalThis!=='undefined'&&globalThis.EvacFloodFootprint) ||
    (typeof require==='function'?require('./flood-footprint.js'):null);
  const rgba = (hex, a) => {
    const s = hex.replace('#', '');
    return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255,
      parseInt(s.slice(4, 6), 16) / 255, a == null ? 1 : a];
  };
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0];
  }
  function lookAt(eye, at) {
    function normal(v) {
      const len = Math.hypot(...v) || 1;
      return v.map(n => n / len);
    }
    function cross(a, b) {
      return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }
    const z = normal(eye.map((v, i) => v - at[i]));
    const x = normal(cross([0, 1, 0], z));
    const y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -x.reduce((s, v, i) => s + v * eye[i], 0),
      -y.reduce((s, v, i) => s + v * eye[i], 0),
      -z.reduce((s, v, i) => s + v * eye[i], 0), 1];
  }
  function multiply(a, b) {
    const m = new Array(16).fill(0);
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++) m[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    return m;
  }
  function sampleAtTime(history, time) {
    if (!history || !history.length) return null;
    const t = clamp(finite(time, 0), history[0].state.time, history[history.length - 1].state.time);
    let lo = 0, hi = history.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (history[mid].state.time <= t) lo = mid;
      else hi = mid - 1;
    }
    const a = history[lo];
    const b = history[Math.min(lo + 1, history.length - 1)];
    if (a === b || b.state.time <= a.state.time) {
      const previous=history[Math.max(0,lo-1)];
      const previousById=new Map(previous.agents.map(person=>[person.id,person]));
      return {state:a.state,time:t,agents:a.agents.map(agent=>{
        const old=previousById.get(agent.id);
        return {...agent,headingX:old?agent.x-old.x:finite(agent.headingX,0),
          headingY:old?agent.y-old.y:finite(agent.headingY,0)};
      })};
    }
    const mix = clamp((t - a.state.time) / (b.state.time - a.state.time), 0, 1);
    const destination = new Map(b.agents.map(agent => [agent.id, agent]));
    return {
      state: mix < .5 ? a.state : b.state,
      time: t,
      agents: a.agents.map(agent => {
        const other = destination.get(agent.id);
        if (!other) return agent;
        const becomesFatal = other.state === 'fatal';
        const fatalTime = Number.isFinite(other.fatalAt) ? other.fatalAt : b.state.time;
        const fatalNow = agent.state === 'fatal' || (becomesFatal && t >= fatalTime);
        // After the recorded event the figure is motionless; no interpolation
        // through its last position, and no early color change before the event.
        return {
          id: agent.id,
          profile: agent.profile || other.profile,
          state: fatalNow ? 'fatal' : (becomesFatal ? agent.state : (mix < 0.5 ? agent.state : other.state)),
          fatalAt: other.fatalAt,
          x: fatalNow ? other.x : agent.x + (other.x - agent.x) * mix,
          y: fatalNow ? other.y : agent.y + (other.y - agent.y) * mix,
          floor: fatalNow ? other.floor : (agent.floor === other.floor ? agent.floor : (mix < 0.5 ? agent.floor : other.floor)),
          floorBlend: fatalNow ? other.floor : agent.floor + (other.floor - agent.floor) * mix,
          refugeKind: other.refugeKind || agent.refugeKind,
          headingX: fatalNow ? 0 : (other.x-agent.x),
          headingY: fatalNow ? 0 : (other.y-agent.y)
        };
      })
    };
  }

  class Mesh {
    constructor() { this.data = []; }
    vertex(p, color) { this.data.push(p[0], p[1], p[2], ...color); }
    tri(a, b, c, color) { this.vertex(a, color); this.vertex(b, color); this.vertex(c, color); }
    quad(a, b, c, d, color) { this.tri(a, b, c, color); this.tri(a, c, d, color); }
    box(x, y, z, w, h, d, color) {
      if (w <= 0 || h <= 0 || d <= 0) return;
      const p = [[x,y,z], [x+w,y,z], [x+w,y,z+d], [x,y,z+d]];
      const q = p.map(v => [v[0],y+h,v[2]]);
      const tint = (v) => [color[0] * v, color[1] * v, color[2] * v, color[3]];
      this.quad(q[0], q[3], q[2], q[1], tint(1.13));
      this.quad(p[0],p[1],p[2],p[3],tint(.6));
      for (let i = 0; i < 4; i++) this.quad(p[i],q[i],q[(i+1)%4],p[(i+1)%4],tint(i%2 ? .75 : .93));
    }
    wall(ax, az, bx, bz, bottom, height, thickness, color) {
      const dx = bx-ax, dz = bz-az, len = Math.hypot(dx,dz);
      if (len < .005) return;
      const nx = -dz / len * thickness / 2, nz = dx / len * thickness / 2;
      const p = [[ax+nx,bottom,az+nz],[bx+nx,bottom,bz+nz],
        [bx-nx,bottom,bz-nz],[ax-nx,bottom,az-nz]];
      const q = p.map(v => [v[0],bottom+height,v[2]]);
      this.quad(q[0],q[3],q[2],q[1],color);
      for (let i = 0; i < 4; i++) {
        const shade = i % 2 ? .76 : .98;
        this.quad(p[i], q[i], q[(i+1)%4], p[(i+1)%4],
          [color[0]*shade, color[1]*shade, color[2]*shade, color[3]]);
      }
    }
    disc(x, y, z, r, color, segments) {
      if (r <= .001) return;
      const n = segments || 20;
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2, b = (i+1) / n * Math.PI * 2;
        this.tri([x,y,z], [x+Math.cos(a)*r,y,z+Math.sin(a)*r],
          [x+Math.cos(b)*r,y,z+Math.sin(b)*r], color);
      }
    }
    // Clip the circular fire front to one rectangular room. Both the WebGL
    // mesh and the software renderer use these same triangles; no fire disc
    // is permitted to extend through the room boundaries / solid walls.
    discClipped(x, y, z, radius, rect, scale, color) {
      if (!rect || radius <= .00001) return;
      let poly=Array.from({length:48}, (_,i)=>{
        const a=i*Math.PI*2/48;
        return [x+Math.cos(a)*radius,z+Math.sin(a)*radius];
      });
      const minX=(rect.x-450)/scale, maxX=(rect.x+rect.w-450)/scale;
      const minZ=(rect.y-295)/scale, maxZ=(rect.y+rect.h-295)/scale;
      const boundaries=[
        [p=>p[0]>=minX,(a,b)=>[minX,a[1]+(b[1]-a[1])*(minX-a[0])/(b[0]-a[0])]],
        [p=>p[0]<=maxX,(a,b)=>[maxX,a[1]+(b[1]-a[1])*(maxX-a[0])/(b[0]-a[0])]],
        [p=>p[1]>=minZ,(a,b)=>[a[0]+(b[0]-a[0])*(minZ-a[1])/(b[1]-a[1]),minZ]],
        [p=>p[1]<=maxZ,(a,b)=>[a[0]+(b[0]-a[0])*(maxZ-a[1])/(b[1]-a[1]),maxZ]]
      ];
      boundaries.forEach(([inside,intersect])=>{
        if(!poly.length)return;
        const next=[];
        let a=poly[poly.length-1];
        poly.forEach(b=>{
          const ia=inside(a),ib=inside(b);
          if(ia!==ib)next.push(intersect(a,b));
          if(ib)next.push(b);
          a=b;
        });
        poly=next;
      });
      if(poly.length<3)return;
      for(let i=1;i<poly.length-1;i++)this.tri(
        [poly[0][0],y,poly[0][1]], [poly[i][0],y,poly[i][1]],
        [poly[i+1][0],y,poly[i+1][1]], color);
    }
    cone(x, y, z, radius, height, color, n) {
      const count = n || 9;
      for (let i = 0; i < count; i++) {
        const a = i/count*Math.PI*2, b = (i+1)/count*Math.PI*2;
        this.tri([x+Math.cos(a)*radius,y,z+Math.sin(a)*radius],
          [x+Math.cos(b)*radius,y,z+Math.sin(b)*radius],
          [x,y+height,z], [color[0]*(.77 + i/count*.15), color[1], color[2],color[3]]);
      }
    }
    // Faceted curves use only triangles, so they work in both WebGL and the
    // canvas/software renderer without external 3D libraries or textures.
    ellipsoid(cx, cy, cz, rx, ry, rz, color, segments=10, rings=6) {
      if (rx<=0 || ry<=0 || rz<=0) return;
      const shade=(factor)=>[clamp(color[0]*factor,0,1),clamp(color[1]*factor,0,1),clamp(color[2]*factor,0,1),color[3]];
      for(let i=0;i<rings;i++){
        const t0=-Math.PI/2+i*Math.PI/rings,t1=-Math.PI/2+(i+1)*Math.PI/rings;
        for(let j=0;j<segments;j++){
          const a=j*Math.PI*2/segments,b=(j+1)*Math.PI*2/segments;
          const pt=(t,ang)=>[cx+Math.cos(t)*Math.cos(ang)*rx,cy+Math.sin(t)*ry,
            cz+Math.cos(t)*Math.sin(ang)*rz];
          const lit=shade(.74+.24*Math.max(0,Math.cos(a)*.7+Math.sin(a)*.25)+.06*Math.sin(t0));
          this.quad(pt(t0,a),pt(t0,b),pt(t1,b),pt(t1,a),lit);
        }
      }
    }
    // A capped tapered cylinder for joints, arms, legs, railing and handles.
    tube(a, b, radiusA, radiusB, color, segments=8) {
      const axis=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
      const length=Math.hypot(...axis);
      if(length<.00001)return;
      const u=axis.map(v=>v/length);
      const helper=Math.abs(u[1])>.92?[1,0,0]:[0,1,0];
      let right=[u[1]*helper[2]-u[2]*helper[1],u[2]*helper[0]-u[0]*helper[2],u[0]*helper[1]-u[1]*helper[0]];
      const norm=Math.hypot(...right)||1;right=right.map(v=>v/norm);
      const depth=[u[1]*right[2]-u[2]*right[1],u[2]*right[0]-u[0]*right[2],u[0]*right[1]-u[1]*right[0]];
      const circle=(center,r,theta)=>center.map((v,k)=>v+r*(Math.cos(theta)*right[k]+Math.sin(theta)*depth[k]));
      for(let i=0;i<segments;i++){
        const t=i*Math.PI*2/segments, next=(i+1)*Math.PI*2/segments;
        const tint=.72+.27*Math.max(0,Math.cos(t)*.75+Math.sin(t)*.25);
        const c=[color[0]*tint,color[1]*tint,color[2]*tint,color[3]];
        this.quad(circle(a,radiusA,t),circle(a,radiusA,next),circle(b,radiusB,next),circle(b,radiusB,t),c);
        this.tri(a,circle(a,radiusA,next),circle(a,radiusA,t),c);
        this.tri(b,circle(b,radiusB,t),circle(b,radiusB,next),c);
      }
    }
    orientedBox(x,y,z,w,h,d,dirX,dirZ,color){
      if(w<=0||h<=0||d<=0)return;
      const len=Math.hypot(dirX,dirZ)||1;
      const f=[dirX/len,dirZ/len],r=[f[1],-f[0]];
      const p=(sx,sy,sz)=>[x+sx*w/2*r[0]+sz*d/2*f[0],y+sy*h/2,
        z+sx*w/2*r[1]+sz*d/2*f[1]];
      const bottom=[p(-1,-1,-1),p(1,-1,-1),p(1,-1,1),p(-1,-1,1)];
      const top=[p(-1,1,-1),p(1,1,-1),p(1,1,1),p(-1,1,1)];
      const c=(m)=>[clamp(color[0]*m,0,1),clamp(color[1]*m,0,1),clamp(color[2]*m,0,1),color[3]];
      this.quad(...top,c(1.12));this.quad(...bottom,c(.55));
      for(let i=0;i<4;i++)this.quad(bottom[i],bottom[(i+1)%4],top[(i+1)%4],top[i],c(i%2?.72:.91));
    }
    // Thin vertically oriented wheel, with central hub and subtle rim.
    wheel(cx,cy,cz,sideX,sideZ,r,color,segments=12,hubColor){
      const a=[cx-sideX*.034,cy,cz-sideZ*.034],b=[cx+sideX*.034,cy,cz+sideZ*.034];
      this.tube(a,b,r,r,color,segments);
      const hub=hubColor||rgba('#9caebb');
      this.tube([cx-sideX*.045,cy,cz-sideZ*.045],[cx+sideX*.045,cy,cz+sideZ*.045],r*.21,r*.21,hub,8);
    }
  }

  const PROFILE_HEIGHT=Object.freeze({children:1.23,older:1.58,limited:1.35,adult:1.72});
  const STATUS_COLOR=Object.freeze({waiting:'#7e9bb8',notified:'#f5bb57',queued:'#facd70',moving:'#57c5f5',
    safe:'#39e3a1',sheltered:'#b99cff',sheltering:'#b99cff','no-route':'#ff7782',fatal:'#080808'});
  const SHIRTS=['#426f96','#a05c68','#4f917a','#bb9368','#6f69a1','#668eaa','#ba7860','#5b8c92'];
  const TROUSERS=['#283747','#3d414c','#424a5d','#61564f','#2b4a5b'];
  const SKINS=['#f2c9a7','#d9a685','#9e6b4b','#76513c','#eac0a5','#b98462'];
  const HAIRS=['#282e37','#654936','#9d7954','#b8b6b0','#352722'];
  function personColors(agent){
    const id=Math.abs(Math.trunc(finite(agent.id,0)));
    if(agent.state==='fatal')return {shirt:rgba('#000000'),pants:rgba('#000000'),skin:rgba('#000000'),hair:rgba('#000000'),shoe:rgba('#000000')};
    if(agent.state==='threat')return {shirt:rgba('#e72f53'),pants:rgba('#571b30'),skin:rgba('#b89286'),hair:rgba('#3c1427'),shoe:rgba('#360c19')};
    const pick=(array,k)=>rgba(array[(id*k+Math.floor(id/7))%array.length]);
    return {shirt:pick(SHIRTS,7),pants:pick(TROUSERS,3),skin:pick(SKINS,5),
      hair:pick(HAIRS,11),shoe:rgba('#1b2938')};
  }
  // Human animations are generated from actual simulation positions and replay
  // time. Nothing here affects routing, collision, exposure or other physics.
  function drawPerson(mesh,agent,opts={}){
    const x=finite(opts.x,0),y=finite(opts.y,0),z=finite(opts.z,0);
    const time=finite(opts.time,0),id=finite(agent.id,0);
    const profile=agent.profile==='child'?'children':agent.profile||'adult';
    const isLimited=profile==='limited';
    const fatal=agent.state==='fatal';
    const moving=agent.state==='moving'&&!fatal;
    const height=PROFILE_HEIGHT[profile]||PROFILE_HEIGHT.adult;
    let dx=finite(agent.headingX,0),dz=finite(agent.headingY,0);
    if(Math.hypot(dx,dz)<.05){
      const angle=id*2.3999632297;dx=Math.sin(angle);dz=Math.cos(angle);
    }
    const len=Math.hypot(dx,dz);dx/=len;dz/=len;
    const right=[dz,-dx],forward=[dx,dz];
    const at=(side,up,front=0)=>[x+right[0]*side+forward[0]*front,
      y+up,z+right[1]*side+forward[1]*front];
    const c=personColors(agent);
    const detail=opts.detail==='fast'?6:opts.detail==='high'?12:9;
    // Non-graphic compact figure underneath a desk during the initial earthquake phase.
    if(['under-desk','protective-shelter'].includes(agent.refugeKind) &&
        ['sheltering','sheltered'].includes(agent.state)){
      mesh.disc(x,y-.008,z,.24,rgba('#b99cff',.3),12);
      mesh.ellipsoid(x,y+.24,z,.23,.19,.20,c.shirt,detail,5);
      mesh.ellipsoid(x,y+.43,z+.04,.13,.13,.13,c.skin,detail,5);
      mesh.ellipsoid(x,y+.51,z+.04,.13,.065,.13,c.hair,detail,4);
      return;
    }
    const phase=time*(isLimited?6.4:profile==='older'?7.2:9.0)+id*.73;
    const gait=moving?(isLimited?.12:profile==='older'?.6:1):0;
    const swing=Math.sin(phase)*.19*gait;
    const sway=Math.abs(Math.sin(phase))*.023*gait;
    // Soft ground contact shadow + unobtrusive state ring. All-black fatal
    // figures have no bright marker (per the visual convention in v0.9.1).
    const marker=rgba(fatal?'#000000':STATUS_COLOR[agent.state]||STATUS_COLOR.waiting,fatal?.27:.24);
    mesh.disc(x,y-.009,z,isLimited?.43:.30,rgba(fatal?'#000000':'#030911',.21),14);
    mesh.disc(x,y-.007,z,isLimited?.38:.265,marker,14);
    if(isLimited){
      // Seated figure with a schematic mobility chair. It is a visual profile,
      // not a claim that every mobility-limited evacuee uses a wheelchair.
      const chair=rgba(fatal?'#000000':'#4c6575'),frame=rgba(fatal?'#000000':'#a6bac6');
      const cushion=rgba(fatal?'#000000':'#263b4b');
      mesh.orientedBox(...[x,y+.47,z,.62,.09,.53,dx,dz,cushion]);
      mesh.orientedBox(...[x-forward[0]*.20,y+.82,z-forward[1]*.20,.62,.66,.095,dx,dz,chair]);
      for(const side of [-1,1]){
        const wp=at(side*.355,.285,0);
        mesh.wheel(wp[0],wp[1],wp[2],right[0],right[1],.285,rgba(fatal?'#000000':'#222a35'),detail+2,fatal?rgba('#000000'):undefined);
        mesh.tube(at(side*.265,.55,-.20),at(side*.285,.55,.20),.025,.025,frame,6);
      }
      mesh.orientedBox(...[x+forward[0]*.34,y+.21,z+forward[1]*.34,.41,.045,.24,dx,dz,frame]);
      const torsoBase=at(0,.62,0),torsoTop=at(0,1.04,.025);
      mesh.tube(torsoBase,torsoTop,.205,.235,c.shirt,detail);
      mesh.ellipsoid(...at(0,1.19,.025),.13,.15,.13,c.skin,detail,5);
      mesh.ellipsoid(...at(0,1.29,0),.132,.073,.13,c.hair,detail,4);
      for(const side of [-1,1]){
        const shoulder=at(side*.205,1.025,.025),hand=at(side*.255,.59,.10);
        mesh.tube(shoulder,at(side*.245,.83,.09),.079,.06,c.shirt,detail);
        mesh.tube(at(side*.245,.83,.09),hand,.06,.042,c.skin,detail);
        mesh.ellipsoid(...hand,.052,.054,.05,c.skin,detail,4);
      }
    } else {
      const torsoBase=at(0,height*.46+sway),torsoTop=at(0,height*.77+sway);
      mesh.tube(torsoBase,torsoTop,height*.114,height*.145,c.shirt,detail);
      mesh.ellipsoid(...at(0,height*.88+sway),height*.091,height*.10,height*.09,c.skin,detail,5);
      mesh.ellipsoid(...at(0,height*.967+sway,-.018),height*.093,height*.049,height*.092,c.hair,detail,4);
      // A slight waist band and neck keep the silhouette readable at distance.
      mesh.tube(at(0,height*.447+sway),at(0,height*.473+sway),height*.115,height*.117,c.pants,detail);
      mesh.tube(at(0,height*.765+sway),at(0,height*.826+sway),height*.039,height*.040,c.skin,detail);
      for(const side of [-1,1]){
        const hip=at(side*height*.063,height*.44+sway),
          knee=at(side*height*.078,height*.245,side*swing*.45+.025),
          ankle=at(side*height*.082,height*.065,side*swing);
        mesh.tube(hip,knee,height*.056,height*.047,c.pants,detail);
        mesh.tube(knee,ankle,height*.047,height*.041,c.pants,detail);
        const foot=at(side*height*.082,height*.044,side*swing+.064);
        mesh.orientedBox(foot[0],foot[1],foot[2],height*.112,height*.068,height*.19,dx,dz,c.shoe);
        const shoulder=at(side*height*.136,height*.742+sway),
          elbow=at(side*height*.153,height*.592+sway,-side*swing*.64),
          wrist=at(side*height*.14,height*.474+sway,-side*swing);
        mesh.tube(shoulder,elbow,height*.048,height*.043,c.shirt,detail);
        mesh.tube(elbow,wrist,height*.040,height*.028,c.skin,detail);
        mesh.ellipsoid(wrist[0],wrist[1],wrist[2],height*.031,height*.033,height*.031,c.skin,detail,4);
      }
    }
  }

  function openingsOnLine(floor, x1, z1, x2, z2, scale) {
    const dx=x2-x1, dz=z2-z1, len=Math.hypot(dx,dz);
    const intervals=[];
    if (!len) return intervals;
    (floor.items || []).forEach(item => {
      if (!['door','exit','opening'].includes(item.type)) return;
      const t=((finite(item.x,0)-x1)*dx+(finite(item.y,0)-z1)*dz)/(len*len);
      const p=clamp(t,0,1);
      if (Math.hypot(x1+dx*p-item.x,z1+dz*p-item.y)>Math.max(12,scale*.22)) return;
      const half=Math.max(.3,finite(item.width,1.2)) * scale / (2*len);
      intervals.push([clamp(p-half,0,1),clamp(p+half,0,1)]);
    });
    return intervals.sort((a,b) => a[0]-b[0]);
  }
  function splitWall(mesh, floor, ax, az, bx, bz, height, thickness, color, scale, floorY) {
    const gaps=openingsOnLine(floor,ax,az,bx,bz,scale);
    let pos=0;
    function section(a,b) {
      if (b-a<.005) return;
      mesh.wall((ax+(bx-ax)*a-450)/scale,(az+(bz-az)*a-295)/scale,
        (ax+(bx-ax)*b-450)/scale,(az+(bz-az)*b-295)/scale,
        floorY,height,thickness,color);
    }
    gaps.forEach(([a,b]) => { if(a>pos) section(pos,a); pos=Math.max(pos,b); });
    if (pos<1) section(pos,1);
  }

  function doorAlongX(floor,item){
    let best=Infinity, alongX=true;
    for(const other of floor.items||[]){
      if(!['room','corridor'].includes(other.type)) continue;
      const xx=finite(other.x,0),yy=finite(other.y,0);
      const ww=Math.max(.01,finite(other.w,0)),hh=Math.max(.01,finite(other.h,0));
      const px=finite(item.x,0),py=finite(item.y,0);
      const dx=Math.min(Math.abs(px-xx),Math.abs(px-xx-ww));
      const dz=Math.min(Math.abs(py-yy),Math.abs(py-yy-hh));
      const xRange=px>=xx-15&&px<=xx+ww+15;
      const zRange=py>=yy-15&&py<=yy+hh+15;
      if(xRange&&dz<best){best=dz;alongX=true;}
      if(zRange&&dx<best){best=dx;alongX=false;}
    }
    return alongX;
  }
  function doorFrame(mesh, floor, item, base, scale, shade){
    const x=(finite(item.x,0)-450)/scale,z=(finite(item.y,0)-295)/scale;
    const alongX=doorAlongX(floor,item);
    const w=clamp(finite(item.width,1.1),.7,3.5);
    const frame=rgba(shade||'#d4dfe0'),leaf=rgba('#a97852');
    const top=base+2.14;
    if(alongX){
      mesh.box(x-w/2-.055,base+.02,z-.065,.11,2.11,.13,frame);
      mesh.box(x+w/2-.055,base+.02,z-.065,.11,2.11,.13,frame);
      mesh.box(x-w/2-.055,top-.10,z-.065,w+.11,.13,.13,frame);
      const hx=x-w/2;
      // Door leaf is swung into the room; the aperture itself remains open.
      // Door leaf is drawn dynamically for each replay frame.
    }else{
      mesh.box(x-.065,base+.02,z-w/2-.055,.13,2.11,.11,frame);
      mesh.box(x-.065,base+.02,z+w/2-.055,.13,2.11,.11,frame);
      mesh.box(x-.065,top-.10,z-w/2-.055,.13,.13,w+.11,frame);
      const hz=z-w/2;
      // Door leaf is drawn dynamically for each replay frame.
    }
  }
  function exitFrame(mesh, floor, item,base,scale){
    const x=(finite(item.x,0)-450)/scale,z=(finite(item.y,0)-295)/scale;
    const alongX=doorAlongX(floor,item),w=clamp(finite(item.width,1.3),.8,3.5);
    const mint=rgba('#4cf0b5'),dark=rgba('#1e6d66');
    if(alongX){
      mesh.box(x-w/2,base+.02,z-.06,.09,2.22,.12,dark);
      mesh.box(x+w/2-.09,base+.02,z-.06,.09,2.22,.12,dark);
      mesh.box(x-w/2,base+2.13,z-.06,w,.13,.12,mint);
      mesh.box(x-.40,base+2.36,z-.09,.8,.30,.14,mint);
    } else {
      mesh.box(x-.06,base+.02,z-w/2,.12,2.22,.09,dark);
      mesh.box(x-.06,base+.02,z+w/2-.09,.12,2.22,.09,dark);
      mesh.box(x-.06,base+2.13,z-w/2,.12,.13,w,mint);
      mesh.box(x-.09,base+2.36,z-.40,.14,.30,.8,mint);
    }
    // Ground-level beacon: clearly distinguish safe exits without relying on text.
    mesh.disc(x,base+.035,z,.38,rgba('#23ffad',.22),16);
  }


  // Reusable low-poly furniture mesh for both ordinary scenes and time-based
  // educational room-activity visualization. The source item never changes.
  function drawFurnitureMesh(mesh,item,x,y,z,scale){
    const tw=clamp(finite(item.w,28)/scale,.12,6),td=clamp(finite(item.h,17)/scale,.12,6);
    const colors={desk:'#ad855d',chair:'#5b93b7',table:'#bd9972',bed:'#c4d0dd',shelf:'#9e89ad',sofa:'#91ac9e'};
    const color=rgba(colors[item.furnitureType]||'#aa927a');
    const top=item.furnitureType==='chair'?.43:item.furnitureType==='bed'?.48:item.furnitureType==='shelf'?1.25:.76;
    mesh.box(x,y+top-.07,z,tw,.11,td,color);
    if(item.furnitureType==='bed'){
      mesh.box(x+.025,y+top+.03,z+.025,tw*.20,.14,td-.05,rgba('#ecf2fa'));
    }else if(item.furnitureType==='chair'){
      mesh.box(x,y+top,z,tw,.43,.065,rgba('#a3c7dc'));
    }else if(item.furnitureType==='shelf'){
      mesh.box(x,y+.035,z,tw,1.1,.08,rgba('#715d82'));
    }else{
      const leg=rgba('#74635d');
      for(const dx of [.05,Math.max(.06,tw-.07)]){
        for(const dz of [.05,Math.max(.06,td-.07)]){
          mesh.box(x+dx,y+.04,z+dz,.055,top-.10,.055,leg);
        }
      }
    }
  }

  // Shared, deduplicated smoke footprint for 3D. The simulation decides when a
  // space is reached; this is intentionally just an unobtrusive visual overlay.
  // It must not suggest that smoke crosses sealed walls or unconnected rooms.
  function smokeCoverageRooms(model, smokeLists, floorVisible = () => true) {
    if (!model || !model.nodes || !Array.isArray(smokeLists)) return [];
    const seen = new Set(), rooms = [];
    smokeLists.forEach(smoke => (smoke.reached || []).forEach(arrival => {
      const node = model.nodes.get(arrival.nodeId);
      if (!node || node.kind !== 'space' || node.spaceType === 'courtyard' || !node.rect ||
          !floorVisible(node.floor) || seen.has(node.id)) return;
      const r = node.rect;
      if (!(finite(r.w, 0) > 0 && finite(r.h, 0) > 0)) return;
      seen.add(node.id);
      rooms.push({ nodeId: node.id, floor: node.floor, rect: r });
    }));
    return rooms;
  }

  // Very thin translucent gray wash and a soft border on affected floors.
  // Keep it BELOW flame fronts and the feet of the characters; smoke must not
  // turn the scene opaque or obscure the paths and exit signs.
  function drawSmokeFootprint(mesh, rooms, scale, floorHeight) {
    const fill = rgba('#aeb8c1', .32), rim = rgba('#d4dbe1', .39);
    rooms.forEach(({floor,rect}) => {
      const x=(rect.x-450)/scale, z=(rect.y-295)/scale;
      const w=rect.w/scale, d=rect.h/scale, base=floor*floorHeight;
      mesh.box(x,base+.036,z,w,.010,d,fill);
      const edge=Math.min(.055,w/8,d/8);
      if(edge>.005){
        mesh.box(x,base+.047,z,w,.008,edge,rim);
        mesh.box(x,base+.047,z+d-edge,w,.008,edge,rim);
        mesh.box(x,base+.047,z,edge,.008,d,rim);
        mesh.box(x+w-edge,base+.047,z,edge,.008,d,rim);
      }
    });
  }

  // Only draw foundation under places actually present in the plan. The old
  // 900x590 platform made compact or imported buildings look like tiny islands
  // on a huge slab. Merge the floor rectangles so overlaps do not flicker.
  function floorFootprint(items) {
    const rects=(items||[]).filter(i=>['room','corridor','courtyard','surface'].includes(i.type) &&
      [i.x,i.y,i.w,i.h].every(v=>Number.isFinite(Number(v)))&&i.w>0&&i.h>0)
      .map(i=>({x:+i.x,y:+i.y,w:+i.w,h:+i.h}));
    return FloodFootprint ? FloodFootprint.unionRectangles(rects) : rects;
  }
  function sceneBounds(project, floorMode='all') {
    const all=[];
    (project&&project.floors||[]).forEach((floor,fi)=>{
      if(floorMode!=='all'&&fi!==Number(floorMode))return;
      for(const rect of floorFootprint(floor.items)) all.push(rect);
    });
    if(!all.length)return {x:0,y:0,w:900,h:590,empty:true};
    const x=Math.min(...all.map(r=>r.x)), y=Math.min(...all.map(r=>r.y));
    return {x,y,w:Math.max(...all.map(r=>r.x+r.w))-x,
      h:Math.max(...all.map(r=>r.y+r.h))-y,empty:false};
  }

  class Scene3D {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl', { alpha: false, antialias: true, preserveDrawingBuffer: true }) ||
        canvas.getContext('experimental-webgl', { alpha: false, antialias: true, preserveDrawingBuffer: true });
      this.software=!gl;
      if(!gl){
        this.ctx=canvas.getContext('2d',{alpha:false});
        if(!this.ctx)throw new Error('Не може да се създаде 3D графичен контекст.');
        this.gl=null;
        this.project=null;this.model=null;this.floorMode='all';this.walls=true;this.wallMode='cutaway';
        this.yaw=-.7;this.pitch=.65;this.distance=43;this.zoomScale=1;this.focusTarget=null;this.sceneCenter=[0,0,0];
        this.staticOpaque=[];this.staticAlpha=[];this.lastDrawCount=0;this.quality='balanced';this.cameraMode='orbit';this.followAgentId='';this.showSmoke=true;
        return;
      }
      this.gl = gl;
      const vs = `attribute vec3 aPosition; attribute vec4 aColor;
        uniform mat4 uMVP; varying vec4 vColor; varying float vFog;
        void main() { vec4 clip = uMVP * vec4(aPosition, 1.0);
          gl_Position = clip; vColor = aColor;
          vFog = clamp((clip.w - 34.0) / 105.0, 0.0, 0.30); }`;
      const fs = `precision mediump float; varying vec4 vColor; varying float vFog;
        void main() { vec3 fogColor = vec3(0.038, 0.069, 0.102);
          gl_FragColor = vec4(mix(vColor.rgb, fogColor, vFog), vColor.a); }`;
      function shader(type, code) {
        const s=gl.createShader(type); gl.shaderSource(s,code); gl.compileShader(s);
        if (!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      }
      const program=gl.createProgram();
      gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));
      gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      this.program=program;
      this.position=gl.getAttribLocation(program,'aPosition');
      this.color=gl.getAttribLocation(program,'aColor');
      this.mvp=gl.getUniformLocation(program,'uMVP');
      this.buffer=gl.createBuffer();
      this.project=null; this.model=null; this.floorMode='all'; this.walls=true;this.wallMode='cutaway';
      this.yaw=-.7; this.pitch=.65; this.distance=43; this.zoomScale=1;this.focusTarget=null;this.sceneCenter=[0,0,0];
      this.staticOpaque=[]; this.staticAlpha=[];
      this.lastDrawCount=0;this.quality='balanced';this.cameraMode='orbit';this.followAgentId='';this.showSmoke=true;
      gl.clearColor(.038,.069,.102,1);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    }
    setProject(project, model) {
      this.project=project;
      this.model=model||null;
      this.floorMode='all';
      this.zoomScale=1;this.focusTarget=null;this.sceneCenter=[0,0,0];
      this.rebuild();
    }
    setFloor(mode) { this.floorMode=mode;this.focusTarget=null;this.zoomScale=1; this.rebuild(); }
    setWalls(mode) {
      this.wallMode=mode===false||mode==='none'?'none':mode==='full'?'full':'cutaway';
      this.walls=this.wallMode!=='none';this.rebuild();
    }
    setQuality(mode) { this.quality=['fast','balanced','high'].includes(mode)?mode:'balanced'; }
    setSmokeVisible(value) { this.showSmoke=value!==false; }
    setCameraMode(mode,agentId){this.cameraMode=['orbit','top','follow','pov'].includes(mode)?mode:'orbit';this.followAgentId=String(agentId||'');}
    chooseCameraAgent(frame){
      const agents=(frame&&frame.agents)||[];
      return agents.find(a=>this.followAgentId&&String(a.id)===this.followAgentId) ||
        agents.find(a=>a.state==='moving') || agents.find(a=>a.state!=='safe'&&a.state!=='fatal') || agents[0] || null;
    }
    get renderBudget() {
      return this.software
        ? ({fast:90,balanced:38,high:20}[this.quality]||38)
        : ({fast:400,balanced:175,high:230}[this.quality]||175);
    }
    orbit(dx,dy) { this.yaw+=dx*.008; this.pitch=clamp(this.pitch+dy*.008,.15,1.45); }
    pan(dx,dy,viewHeight=500) {
      // Shift/right drag pans the camera across an imported floor plan.
      const step=this.distance*this.zoomScale*Math.tan(Math.PI/7)/Math.max(100,viewHeight)*2;
      const vx=dx*step,vz=dy*step;
      const base=this.focusTarget||this.sceneCenter||[0,0,0];
      this.focusTarget=[base[0]-Math.cos(this.yaw)*vx-Math.sin(this.yaw)*vz,
        base[1],base[2]+Math.sin(this.yaw)*vx-Math.cos(this.yaw)*vz];
      return this.focusTarget;
    }
    zoom(amount) { this.zoomScale=clamp(this.zoomScale*amount,.3,4); }
    resetCamera() { this.yaw=-.7; this.pitch=.65; this.zoomScale=1;this.focusTarget=null;this.cameraMode='orbit'; }
    focusOnPeople(frame) {
      const agents=(frame&&frame.agents||[]).filter(a=>this.floorVisible(a.floor)&&a.state!=='safe');
      if(!agents.length)return false;
      const total=agents.reduce((acc,a)=>{
        acc[0]+=(finite(a.x,450)-450)/this.scale;
        acc[1]+=finite(a.floor,0)*this.floorHeight;
        acc[2]+=(finite(a.y,295)-295)/this.scale;
        return acc;
      },[0,0,0]);
      this.focusTarget=total.map(v=>v/agents.length);
      this.zoomScale=clamp(14.5/this.distance,.33,1);
      this.yaw=-.62;this.pitch=.39;
      return true;
    }
    get scale() { return Math.max(2,finite(this.project && this.project.settings.pxPerMeter,25)); }
    get floorHeight() { return Math.max(1,finite(this.project && this.project.settings.floorHeight,3.2)); }
    floorVisible(fi) { return this.floorMode==='all'||Number(this.floorMode)===fi; }
    rebuild() {
      const project=this.project;
      if (!project) return;
      const scale=this.scale, height=this.floorHeight;
      const a=new Mesh(), alpha=new Mesh();
      const floors=project.floors||[];
      floors.forEach((floor,fi) => {
        if(!this.floorVisible(fi)) return;
        const y=fi*height;
        const tiles=floorFootprint(floor.items);
        const platform=tiles.length?tiles:[{x:0,y:0,w:900,h:590}];
        for(const tile of platform){
          const px=(tile.x-450)/scale,pz=(tile.y-295)/scale;
          if(fi===0 || this.floorMode!=='all'){
            a.box(px,y-.18,pz,tile.w/scale,.15,tile.h/scale,rgba('#384653'));
          }else{
            alpha.box(px,y-.18,pz,tile.w/scale,.15,tile.h/scale,rgba('#64778a',.25));
          }
        }
        (floor.items||[]).forEach(item => {
          const x=(finite(item.x,0)-450)/scale, z=(finite(item.y,0)-295)/scale;
          if (item.type==='surface') {
            const w=Math.max(.1,finite(item.w,80))/scale, d=Math.max(.1,finite(item.h,60))/scale;
            const mat=(typeof globalThis!=='undefined'&&globalThis.EvacMaterials&&globalThis.EvacMaterials.get(item.materialId))||null;
            a.box(x,y+.025,z,w,.015,d,rgba(mat ? mat.color : '#bc8757',.9));
          } else if (['room','corridor','courtyard'].includes(item.type)) {
            const w=Math.max(.1,finite(item.w,80))/scale, d=Math.max(.1,finite(item.h,60))/scale;
            const mat=(typeof globalThis!=='undefined'&&globalThis.EvacMaterials&&globalThis.EvacMaterials.get(item.materialId))||null;
            const color=mat&&item.materialId!=='standard'?mat.color:item.type==='room'?'#738c98':item.type==='courtyard'?'#4b7868':'#657d87';
            if (this.floorMode==='all' && fi>0)
              alpha.box(x,y-.008,z,w,.028,d,rgba(color,.42));
            else a.box(x,y-.008,z,w,.028,d,rgba(color));
            // Polished edge detail avoids the flat paper-model appearance.
            const rim=rgba(item.type==='courtyard'?'#80aa89':'#a7c3cb',.69);
            a.box(x,y+.024,z,w,.011,.019,rim);
            a.box(x,y+.024,z+d-.019,w,.011,.019,rim);
            a.box(x,y+.024,z,.019,.011,d,rim);
            a.box(x+w-.019,y+.024,z,.019,.011,d,rim);
            if (this.walls && item.type!=='courtyard') {
              const wallHeight=this.wallMode==='full'?2.72:.92;
              const col=rgba(item.type==='room'?'#dce7e6':'#c1d7df',this.wallMode==='full'?.25:.33);
              const cap=rgba('#a3c7cc',.70);
              const ax=item.x, az=item.y, bx=item.x+item.w, bz=item.y+item.h;
              [[ax,az,bx,az],[bx,az,bx,bz],[bx,bz,ax,bz],[ax,bz,ax,az]].forEach(([x1,z1,x2,z2])=>{
                splitWall(alpha,floor,x1,z1,x2,z2,wallHeight,.09,col,scale,y+.01);
                splitWall(alpha,floor,x1,z1,x2,z2,.032,.095,cap,scale,y+wallHeight+.01);
              });
            }
          } else if(item.type==='furniture') {
            if(!(project.settings&&project.settings.scenario==='lockdown'))
              drawFurnitureMesh(a,item,x,y,z,scale);
          } else if(item.type==='wall' && this.walls) {
            const wallHeight=this.wallMode==='full'?2.72:.92;
            splitWall(alpha,floor,item.x,item.y,item.x2,item.y2,wallHeight,
              Math.max(.08,finite(item.thickness,.2)),rgba(item.materialId==='brick'?'#b16c55':'#e1e9e8',this.wallMode==='full'?.55:.46),scale,y+.02);
            splitWall(alpha,floor,item.x,item.y,item.x2,item.y2,.045,
              Math.max(.08,finite(item.thickness,.2)),rgba('#c4d4d7',.8),scale,y+wallHeight+.02);
          } else if(['door','opening','exit','stairs','elevator','safezone'].includes(item.type)) {
            if(item.type==='door'){
              doorFrame(a,floor,item,y,scale);
            }else if(item.type==='exit'){
              exitFrame(a,floor,item,y,scale);
            }else if(item.type==='opening'){
              a.box(x-.36,y+.032,z-.055,.72,.026,.11,rgba('#d6dde3'));
            }else if(item.type==='stairs'){
              // Low-profile treads and two handrails mark vertical circulation.
              for(let n=0;n<6;n++)
                a.box(x-.65,y+.035+n*.105,z-.7+n*.23,1.3,.10,.23,rgba(n%2?'#95a3b0':'#b2bec8'));
              for(const side of [-1,1]){
                const sx=x+side*.63;
                a.tube([sx,y+.72,z-.78],[sx,y+1.29,z+.68],.038,.038,rgba('#b4cee0'),8);
              }
            }else if(item.type==='elevator'){
              a.box(x-.64,y+.028,z-.60,1.28,.06,1.20,rgba('#6f8491'));
              a.box(x-.64,y+.04,z-.62,.10,2.1,.10,rgba('#a9c3cc'));
              a.box(x+.54,y+.04,z-.62,.10,2.1,.10,rgba('#a9c3cc'));
              a.box(x-.64,y+2.07,z-.62,1.28,.10,.10,rgba('#a9c3cc'));
              a.box(x-.58,y+.035,z-.61,1.16,2.01,.035,rgba('#738a98',.75));
              a.box(x-.04,y+.11,z-.58,.08,1.85,.035,rgba('#b7c5cd'));
            }else if(item.type==='safezone'){
              a.disc(x,y+.035,z,.78,rgba('#43dba6',.24),24);
              a.tube([x-.64,y+.035,z],[x-.64,y+.45,z],.035,.035,rgba('#5cdeae'));
              a.box(x-.79,y+.44,z-.07,.30,.20,.12,rgba('#6cf3c4'));
            }
          }
        });
      });
      this.staticOpaque=a.data;
      this.staticAlpha=alpha.data;
      const bounds=sceneBounds(project,this.floorMode);
      const centerHeight=this.floorMode==='all'?(floors.length-1)*height*.5:Number(this.floorMode)*height;
      this.sceneCenter=[(bounds.x+bounds.w/2-450)/scale,centerHeight,(bounds.y+bounds.h/2-295)/scale];
      const span=Math.max(bounds.w/scale,bounds.h/scale);
      this.distance=Math.max(8.5,span*(.91+Math.max(0,floors.length-1)*.10)+centerHeight*.35);
      this.bounds=bounds;
    }
    draw(frame, now) {
      if(!this.project) return;
      const canvas=this.canvas,gl=this.gl;
      const width=Math.max(1,Math.round(canvas.clientWidth*Math.min(typeof devicePixelRatio==='number'?devicePixelRatio:1,2)));
      const height=Math.max(1,Math.round(canvas.clientHeight*Math.min(typeof devicePixelRatio==='number'?devicePixelRatio:1,2)));
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
      const totalHeight=(this.project.floors.length-1)*this.floorHeight;
      let target=this.focusTarget||this.sceneCenter||[0,this.floorMode==='all'?totalHeight*.5:Number(this.floorMode)*this.floorHeight,0];
      const dist=this.distance*this.zoomScale;
      let eye=[target[0]+Math.sin(this.yaw)*Math.cos(this.pitch)*dist,
        target[1]+Math.sin(this.pitch)*dist,target[2]+Math.cos(this.yaw)*Math.cos(this.pitch)*dist];
      if(this.cameraMode==='top'){
        eye=[target[0],target[1]+Math.max(8,dist),target[2]+.001];
      }
      if(['follow','pov'].includes(this.cameraMode) && frame && frame.agents && frame.agents.length){
        const subject=this.chooseCameraAgent(frame);
        if(subject){
          const bx=(finite(subject.x,450)-450)/this.scale, bz=(finite(subject.y,295)-295)/this.scale;
          const by=finite(subject.floor,0)*this.floorHeight;
          let dx=finite(subject.headingX,0),dz=finite(subject.headingY,1);
          const len=Math.hypot(dx,dz)||1;dx/=len;dz/=len;
          if(this.cameraMode==='pov') {eye=[bx,by+1.57,bz];target=[bx+dx*7,by+1.57,bz+dz*7];}
          else {eye=[bx-dx*4.4,by+3.3,bz-dz*4.4];target=[bx+dx*1.2,by+1.2,bz+dz*1.2];}
        }
      }
      const mvp=multiply(perspective(Math.PI/3.5,width/height,.06,500),lookAt(eye,target));
      if(!this.software){
        gl.viewport(0,0,width,height);
        gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
        gl.enableVertexAttribArray(this.position);gl.enableVertexAttribArray(this.color);
        gl.vertexAttribPointer(this.position,3,gl.FLOAT,false,28,0);
        gl.vertexAttribPointer(this.color,4,gl.FLOAT,false,28,12);
        gl.uniformMatrix4fv(this.mvp,false,new Float32Array(mvp));
      }
      const drawData=(data,transparent)=>{
        if(!data.length||this.software)return;
        gl.depthMask(!transparent);
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(shakeMesh(data)),gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES,0,data.length/7);
      };
      const t=finite(frame && frame.time,0), ms=finite(now,0);
      const disaster=DisasterPresets;
      const settings=this.project.settings||{};
      const collapseAt=settings.scenario==='quake'&&disaster?disaster.collapseAt(settings):Infinity;
      const quakeMotion=settings.scenario==='quake'&&disaster?disaster.quakeShakeAt(settings,t):null;
      // Finish the five-second schematic lowering AT the scheduled time, so
      // the full collapse is visible in the last replay frame (not after the
      // simulation has already stopped).
      const collapseLead=Number.isFinite(collapseAt)?Math.min(5,collapseAt):0;
      const collapseScale=collapseLead>0
        ?1-.92*clamp((t-(collapseAt-collapseLead))/collapseLead,0,1):1;
      // Global geometric shift: every visible storey, person, wall, door and
      // object moves together. This is not a room-by-room hazard front.
      const shakeMesh=data=>{
        if(!quakeMotion || !quakeMotion.active || !data.length)return data;
        const out=data.slice();
        for(let i=0;i<out.length;i+=7){
          out[i]+=quakeMotion.x+out[i+1]*quakeMotion.tilt;
          out[i+2]+=quakeMotion.z;
        }
        return out;
      };
      // Schematic 3D lowering of the structure, not a mechanical collapse model.
      const collapseMesh=data=>{
        if(collapseScale===1)return data;
        const result=data.slice();for(let i=1;i<result.length;i+=7)result[i]*=collapseScale;
        return result;
      };
      const buildingMesh=collapseMesh(this.staticOpaque), wallMesh=collapseMesh(this.staticAlpha);
      drawData(buildingMesh,false);
      const people=new Mesh(), effects=new Mesh(), animatedDoors=new Mesh();
      const scale=this.scale, fh=this.floorHeight;
      const agents=(frame && frame.agents)||[];
      const stride=Math.max(1,Math.ceil(agents.length/this.renderBudget));
      this.lastDrawCount=0;
      const visualActors=(frame&&frame.state&&frame.state.securityPeople)||[];
      const visualActorMap=new Map(visualActors.map(a=>[String(a.id),a]));
      for(let i=0;i<agents.length;i+=stride) {
        const initial=agents[i],visual=visualActorMap.get(String(initial.id));
        const ag=visual?{...initial,...visual,headingX:visual.x-initial.x,
          headingY:visual.y-initial.y}:initial;
        if(!this.floorVisible(ag.floor)) continue;
        const x=(finite(ag.x,450)-450)/scale,z=(finite(ag.y,295)-295)/scale;
        const raised=ag.refugeKind==='elevated-furniture' && ag.state==='sheltered' ? .77 : 0;
        const y=(finite(ag.floorBlend,finite(ag.floor,0))*fh+.055+raised)*collapseScale;
        drawPerson(people,ag,{x,y,z,time:t,detail:this.quality});
        this.lastDrawCount++;
      }
      // Abstract, non-graphic moving warning indicators. No attack mechanics.
      if((this.project.settings||{}).scenario==='lockdown'){
        const security=(typeof globalThis!=='undefined'&&globalThis.EvacSecurity)||null;
        const markers=this.model&&security
          ? security.markerPositions(this.model.threatMarkers,this.model.floors,t,this.project.settings)
          : (this.project.floors||[]).flatMap((fl,fi)=>(fl.items||[])
              .filter(item=>item.type==='threat'&&t>=finite(item.entryAtSeconds,0))
              .map(item=>({...item,floor:fi})));
        markers.forEach((marker,i)=>{
          if(!this.floorVisible(marker.floor))return;
          const x=(finite(marker.x,450)-450)/scale,z=(finite(marker.y,295)-295)/scale;
          const y=(marker.floor*fh+.055)*collapseScale;
          drawPerson(people,{id:-(99+i),profile:'adult',state:'threat',
            headingX:finite(marker.headingX,0),headingY:finite(marker.headingY,1)},
            {x,y,z,time:t,detail:this.quality});
          // A conspicuous, translucent location beacon stays visible in 3D
          // even when the camera is zoomed out (pure educational annotation).
          const pulse=.72+.14*Math.sin(t*3+i);
          effects.disc(x,y+.012,z,.65,rgba('#f32b57',pulse*.43),20);
          effects.ellipsoid(x,y+2.07,z,.15,.23,.15,rgba('#ff5376',pulse),12,7);
          if(marker.motionStatus==='blocked')
            effects.ellipsoid(x,y+2.44,z,.10,.10,.10,rgba('#ffbd68',.82),10,5);
        });
      }
      const stateForDoors=(frame&&frame.state)||null;
      // Physically separate animated leaves from architectural static frames.
      // Hinges rotate on open/close. Locked and damaged doors block route graph edges.
      (this.project.floors||[]).forEach((floor,fi)=>{
        if(!this.floorVisible(fi))return;
        (floor.items||[]).filter(item=>item.type==='door').forEach(door=>{
          const extras=(typeof globalThis!=='undefined'&&globalThis.EvacExtras)||null;
          const st=extras?extras.doorState(this.project.settings,door,t):(door.doorState||'open');
          const x=(finite(door.x,0)-450)/scale,z=(finite(door.y,0)-295)/scale;
          const w=clamp(finite(door.width,1.1),.7,3.5);
          const alongX=doorAlongX(floor,door);
          const closed=st!=='open';
          const trainingDoor=(this.project.settings||{}).scenario==='lockdown'&&stateForDoors&&
            (stateForDoors.securityDoors||[]).find(d=>d.floor===fi&&String(d.id)===String(door.id));
          // Simple opening motion for timeline events (0.8-second transition).
          let openFactor=closed?0:1;
          if(extras && this.project.settings && this.project.settings.scenarioCreatorEnabled){
            const event=(this.project.settings.timelineEvents||[]).filter(e=>
              (e.type==='door-open'||e.type==='door-close'||e.type==='door-lock') &&
              (!e.targetId||String(e.targetId)===String(door.id)) && e.atSeconds<=t)
              .sort((a,b)=>a.atSeconds-b.atSeconds).pop();
            if(event){const fraction=clamp((t-event.atSeconds)/.8,0,1);
              openFactor=event.type==='door-open'?fraction:1-fraction;}
          }
          if(trainingDoor)openFactor=(st==='open'?1-trainingDoor.progress:0);
          const angle=1.12*openFactor;
          const leafColor=trainingDoor&&trainingDoor.locked?'#7562bf':
            st==='locked'?'#a04656':st==='damaged'?'#be7861':'#a97852';
          if(alongX){
            const hx=x-w/2;animatedDoors.wall(hx,z,hx+Math.cos(angle)*w*.89,z+Math.sin(angle)*w*.89,
              fi*fh+.07,1.95,.06,rgba(leafColor));
          }else{
            const hz=z-w/2;animatedDoors.wall(x,hz,x+Math.sin(angle)*w*.89,hz+Math.cos(angle)*w*.89,
              fi*fh+.07,1.95,.06,rgba(leafColor));
          }
        });
      });
      drawData(collapseMesh(animatedDoors.data),false);
      let securityFurnitureMesh=[];
      if((this.project.settings||{}).scenario==='lockdown'){
        const movable=new Mesh();
        const security=(typeof globalThis!=='undefined'&&globalThis.EvacSecurity) ||
          (typeof require==='function'?require('./security-incident.js'):null);
        const positioned=frame&&frame.state&&Array.isArray(frame.state.securityFurniture)
          ? frame.state.securityFurniture
          : this.model&&security?security.furniturePositions(this.model,t,this.project.settings):[];
        const furnitureLookup=new Map(positioned.map(f=>[String(f.floor)+':'+String(f.id),f]));
        (this.project.floors||[]).forEach((fl,fi)=>{
          if(!this.floorVisible(fi))return;
          (fl.items||[]).filter(item=>item.type==='furniture').forEach(item=>{
            const f=furnitureLookup.get(fi+':'+String(item.id));
            drawFurnitureMesh(movable,item,((f?f.x:finite(item.x,0))-450)/scale,
              fi*fh,((f?f.y:finite(item.y,0))-295)/scale,scale);
          });
        });
        securityFurnitureMesh=collapseMesh(movable.data);
        drawData(securityFurnitureMesh,false);
      }
      drawData(people.data,false);
      // Cutaway walls are translucent so occupants remain visible from outside.
      drawData(wallMesh,true);
      const state=(frame&&frame.state)||null;
      const scenario=(state&&state.scenario)||(this.project.settings&&this.project.settings.scenario)||'fire';
      const hazardLists=state&&state.spread||[];
      const smokeLists=state&&state.smoke||[];
      const model=this.model;
      if(scenario==='lockdown' && state){
        if(state.securityLevel==='warning'||state.securityLevel==='emergency'){
          // Soft warning beacons are only a visualization; no hardware signals.
          const pulse=.35+.18*Math.sin(t*3.5);
          (this.project.floors||[]).forEach((fl,fi)=>{
            if(!this.floorVisible(fi))return;
            (fl.items||[]).filter(it=>it.type==='exit').forEach(it=>{
              effects.ellipsoid((finite(it.x,450)-450)/scale,fi*fh+2.45,
                (finite(it.y,295)-295)/scale,.18,.13,.18,
                rgba(state.securityLevel==='emergency'?'#ffbc59':'#f6d58d',pulse),10,5);
            });
          });
        }
        if(state.securityLevel==='emergency'){
          // Generic, non-functional room safety cue. Furniture obstacles retain
          // their ordinary movement effect, but no barricade tactics are modeled.
          (state.securityRooms||[]).forEach(r=>{
            if(!this.floorVisible(r.floor))return;
            const x=(r.x-450)/scale,z=(r.y-295)/scale,y=r.floor*fh+.10;
            effects.box(x-.30,y,z-.12,.60,.24,.24,rgba('#8094df',.52));
            effects.disc(x,y+.01,z,.5,rgba('#8fa7ed',.24),16);
          });
        }
      }
      if(scenario==='flood'){
        const water=this.model && typeof globalThis!=='undefined' && globalThis.EvacSim && globalThis.EvacSim.floodStatusAt
          ? globalThis.EvacSim.floodStatusAt(this.model,t):null;
        if(water){
          (this.model.floors||[]).forEach((fl,fi)=>{
            if(!this.floorVisible(fi))return;
            const depth=Math.max(0,water.level-fi*fh);
            if(depth<=.002)return;
            // A SINGLE level advances across the whole storey at once. Draw
            // its volume only inside the actual interior footprint, rather
            // than as a bounding box that spills over yards and empty gaps.
            // The sweep merges overlaps, so translucent tiles do not stack.
            const tiles=FloodFootprint.tilesForFloor(fl);
            const h=Math.min(depth,fh);
            for(const tile of tiles){
              effects.box((tile.x-450)/scale,fi*fh+.025,(tile.y-295)/scale,
                tile.w/scale,Math.max(.001,h-.025),tile.h/scale,rgba('#39aeed',.30));
            }
          });
        }
      }
      if(collapseScale<1){
        // Dust clouds denote a generic structural event; no injury graphics.
        (this.project.floors||[]).forEach((fl,fi)=>{
          if(fi>2 || !this.floorVisible(fi))return;
          const dust=1-collapseScale;
          effects.ellipsoid(0,.45+fi*.1,0,3+dust*4,.25+dust*.65,2.4+dust*3,rgba('#bca89a',.16),12,5);
        });
      }
      if(this.project.settings && this.project.settings.alarmsEnabled && state && state.systems && state.systems.alarmActive){
        (this.project.floors||[]).forEach((fl,fi)=>{if(!this.floorVisible(fi))return;
          (fl.items||[]).filter(a=>a.type==='exit').forEach(item=>{
            const x=(item.x-450)/scale,z=(item.y-295)/scale;
            effects.ellipsoid(x,fi*fh+2.4,z,.17,.10,.17,rgba('#ff6161',.7),9,4);
          });
        });
      }
      if(state && state.systems && state.systems.sprinklersActive){
        (this.project.floors||[]).forEach((fl,fi)=>{if(!this.floorVisible(fi))return;
          (fl.items||[]).filter(a=>a.type==='room').slice(0,45).forEach(item=>{
            const x=(item.x+item.w/2-450)/scale,z=(item.y+item.h/2-295)/scale;
            effects.cone(x,fi*fh+1.8,z,.38,.12,rgba('#62cffa',.25),7);
          });
        });
      }
      const highlightReached=(entries,color,alpha) => {
        if(!model||!model.nodes) return;
        const used=new Set();
        entries.forEach(arrival => {
          if(used.has(arrival.nodeId)) return;
          used.add(arrival.nodeId);
          const node=model.nodes.get(arrival.nodeId);
          if(!node || node.kind!=='space' || !node.rect || !this.floorVisible(node.floor)) return;
          const rect=node.rect;
          effects.box((rect.x-450)/scale,node.floor*fh+.032,(rect.y-295)/scale,
            rect.w/scale,.018,rect.h/scale,rgba(color,alpha));
        });
      };
      hazardLists.forEach(h => {
        // Flooding is level-based, never drawn as local hazard circles.
        if(scenario==='flood')return;
        if(scenario==='fire') {
          const meta=model && model.hazardSpread && model.hazardSpread.find(s=>String(s.refId)===String(h.refId));
          // Recompute at the interpolated replay time for truly smooth growth,
          // including when the saved agent frames have larger time intervals.
          const engine=(typeof globalThis!=='undefined' && globalThis.EvacSim)||null;
          const patches=meta && engine && engine.firePatchesAt
            ? engine.firePatchesAt(model,meta,t) : (h.patches||[]);
          patches.forEach(p=>{
            if(!this.floorVisible(p.floor) || !p.rect || p.radiusPx<=0)return;
            const x=(p.x-450)/scale,z=(p.y-295)/scale;
            const y=p.floor*fh+.055;
            const r=p.radiusPx/scale;
            effects.discClipped(x,y,z,r,p.rect,scale,rgba('#f96935',.48));
            effects.discClipped(x,y+.01,z,r*.65,p.rect,scale,rgba('#f9a345',.29));
            // Keep the decorative flames inside the room and the active front.
            const margin=Math.min(4,p.rect.w/4,p.rect.h/4);
            const cx=clamp(p.x,p.rect.x+margin,p.rect.x+p.rect.w-margin);
            const cy=clamp(p.y,p.rect.y+margin,p.rect.y+p.rect.h-margin);
            if(Math.hypot(cx-p.x,cy-p.y)<=p.radiusPx) {
              const wobble=Math.sin(ms*.006+cx*.1)*.08;
              const fx=(cx-450)/scale,fz=(cy-295)/scale;
              effects.cone(fx,y,fz,.24,.76+wobble,rgba('#ff762d',.86),11);
              effects.cone(fx,y+.08,fz,.135,.51+wobble*.5,rgba('#ffd076',.92),10);
              effects.ellipsoid(fx,y+.23,fz,.18,.19,.18,rgba('#f8a04d',.24),9,5);
              if(p.radiusPx>18) {
                const nx=clamp(cx+p.radiusPx*.4,p.rect.x+margin,p.rect.x+p.rect.w-margin);
                const ny=clamp(cy+p.radiusPx*.2,p.rect.y+margin,p.rect.y+p.rect.h-margin);
                if(Math.hypot(nx-p.x,ny-p.y)<=p.radiusPx)
                  effects.cone((nx-450)/scale,y,(ny-295)/scale,.18,.55+Math.sin(ms*.005)*.06,rgba('#ff6a2e',.72),8);
              }
            }
          });
        } else {
          if(this.floorVisible(h.floor)) {
            const x=(h.x-450)/scale,z=(h.y-295)/scale,y=h.floor*fh+.055;
            effects.disc(x,y,z,Math.max(.13,Math.min(.32,h.baseRadius/scale*.22)),rgba('#3688fa',.22));
          }
          highlightReached(h.reached||[],'#3688fa',.21);
        }
      });
      if(this.project.settings && this.project.settings.ventilationEnabled){
        (this.project.floors||[]).forEach((fl,fi)=>{if(!this.floorVisible(fi))return;
          (fl.items||[]).filter(a=>['vent','window','ventshaft'].includes(a.type)).forEach(item=>{
            const x=(item.x-450)/scale,z=(item.y-295)/scale,y=fi*fh+.1;
            effects.ellipsoid(x,y+.1,z,.20,.12,.20,rgba('#71d9ff',.55),8,4);
            if(item.type!=='window'||item.open!==false) effects.cone(x,y+.12,z,.22,.42,rgba('#9aeefc',.25),8);
          });
        });
      }
      // The gray overlay follows the SAME reached rooms as the underlying
      // smoke model. It stays on the floor, so occupants and exit markings
      // remain readable. No smoke overlay for non-fire scenarios.
      if(scenario==='fire' && this.showSmoke){
        const regions=smokeCoverageRooms(model,smokeLists,fi=>this.floorVisible(fi));
        drawSmokeFootprint(effects,regions,scale,fh);
        // Sparse wisps add a little depth, without putting a thick gray fog
        // curtain in front of the people or covering an entire floor at once.
        regions.slice(0,32).forEach(({floor,rect},i)=>{
          const x=(rect.x+rect.w/2-450)/scale,z=(rect.y+rect.h/2-295)/scale;
          const r=Math.min(.58,rect.w/scale*.23,rect.h/scale*.23);
          if(r<.09)return;
          const drift=Math.sin(ms*.0007+i*2.4)*Math.min(.14,r*.20);
          effects.ellipsoid(x+drift,floor*fh+.17,z,r,.12,r*.82,
            rgba('#a5aeb7',.085),8,4);
        });

      }
      // Closed fire doors turn red in live/replay at their configured closing time.
      if(scenario==='fire') (this.project.floors||[]).forEach((floor,fi)=>{
        if(!this.floorVisible(fi))return;
        (floor.items||[]).filter(i=>i.type==='door'&&i.fireDoorClosed===true).forEach(door=>{
          if(!state || t+1e-6<finite(door.fireDoorCloseAtSeconds,0))return;
          const x=(finite(door.x,0)-450)/scale,z=(finite(door.y,0)-295)/scale;
          const w=clamp(finite(door.width,1.1),.7,3.5);
          const alongX=doorAlongX(floor,door);
          effects.wall(alongX?x-w/2:x,alongX?z:z-w/2,
            alongX?x+w/2:x,alongX?z:z+w/2,fi*fh+.04,1.98,.07,rgba('#bc5a52',.94));
        });
      });
      // If the simulation has not started, show the sources without inventing spread.
      if(!state && scenario==='fire') this.project.floors.forEach((floor,fi)=>{
        if(!this.floorVisible(fi))return;
        (floor.items||[]).filter(i=>i.type==='hazard').forEach(h=>{
          const x=(h.x-450)/scale,z=(h.y-295)/scale,y=fi*fh+.08;
          effects.disc(x,y,z,Math.max(.16,finite(h.radius,25)/scale),rgba('#fd755d',.18));
          if(scenario==='fire') effects.cone(x,y,z,.26,.64,rgba('#ff9f43',.85));
        });
      });
      drawData(effects.data,true);
      if(this.software)this._drawSoftware([buildingMesh,collapseMesh(animatedDoors.data),people.data,wallMesh,effects.data,...(securityFurnitureMesh.length?[securityFurnitureMesh]:[])].map(shakeMesh),mvp,width,height);
      else gl.depthMask(true);
    }
    _drawSoftware(meshes,mvp,width,height){
      const ctx=this.ctx;
      const gradient=ctx.createLinearGradient(0,0,0,height);
      gradient.addColorStop(0,'#203a50');gradient.addColorStop(.62,'#101f31');gradient.addColorStop(1,'#081421');
      ctx.globalAlpha=1;ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
      const faces=[];
      const projectVertex=(data,p)=>{
        const x=data[p],y=data[p+1],z=data[p+2];
        const w=mvp[3]*x+mvp[7]*y+mvp[11]*z+mvp[15];
        if(w<.07)return null;
        const nx=(mvp[0]*x+mvp[4]*y+mvp[8]*z+mvp[12])/w;
        const ny=(mvp[1]*x+mvp[5]*y+mvp[9]*z+mvp[13])/w;
        const nz=(mvp[2]*x+mvp[6]*y+mvp[10]*z+mvp[14])/w;
        return [(nx*.5+.5)*width,(.5-ny*.5)*height,nz];
      };
      for(const data of meshes){
        for(let p=0;p+20<data.length;p+=21){
          const a=projectVertex(data,p),b=projectVertex(data,p+7),c=projectVertex(data,p+14);
          if(!a||!b||!c)continue;
          const minX=Math.min(a[0],b[0],c[0]),maxX=Math.max(a[0],b[0],c[0]);
          const minY=Math.min(a[1],b[1],c[1]),maxY=Math.max(a[1],b[1],c[1]);
          if(maxX<0||minX>width||maxY<0||minY>height)continue;
          faces.push({a,b,c,depth:(a[2]+b[2]+c[2])/3,
            color:[data[p+3],data[p+4],data[p+5],data[p+6]]});
        }
      }
      faces.sort((a,b)=>b.depth-a.depth);
      ctx.lineJoin='round';
      for(const face of faces){
        const [r,g,b,opacity]=face.color;
        ctx.globalAlpha=opacity;
        ctx.fillStyle='rgb('+Math.min(255,Math.round(r*255))+','+
          Math.min(255,Math.round(g*255))+','+Math.min(255,Math.round(b*255))+')';
        ctx.beginPath();ctx.moveTo(face.a[0],face.a[1]);
        ctx.lineTo(face.b[0],face.b[1]);ctx.lineTo(face.c[0],face.c[1]);
        ctx.closePath();ctx.fill();
      }
      ctx.globalAlpha=1;
    }
    dispose() {
      if(this.gl){this.gl.deleteBuffer(this.buffer);this.gl.deleteProgram(this.program);}
    }
  }

  return { Scene3D, Mesh, drawPerson, personColors, doorAlongX, sampleAtTime,
    smokeCoverageRooms, drawSmokeFootprint, floorFootprint, sceneBounds,
    perspective, lookAt, multiply, openingsOnLine };
});
