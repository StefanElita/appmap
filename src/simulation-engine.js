/*
 * Evacuation Simulator v0.6.0 — simulation engine (graph + routing)
 * Учебен модел. Не е валидиран физически/инженерен инструмент.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EvacSim = Object.assign(root.EvacSim || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '0.10.9';
  const Security=(typeof globalThis!=='undefined' && globalThis.EvacSecurity) ||
    (typeof require==='function' ? require('./security-incident.js') : null);
  const Disasters = (typeof globalThis !== 'undefined' && globalThis.EvacDisasters) ||
    (typeof require === 'function' ? require('./disaster-presets.js') : null);
  const Extras = (typeof globalThis !== 'undefined' && globalThis.EvacExtras) ||
    (typeof require === 'function' ? require('./scenario-extras.js') : null);
  const Materials = (typeof globalThis !== 'undefined' && globalThis.EvacMaterials) ||
    (typeof require === 'function' ? require('./material-library.js') : null);

  const DEFAULTS = {
    pxPerMeter: 25,
    floorHeight: 3.2,
    walkSpeed: 1.25,
    specificFlow: 1.3,
    preMovement: null,
    scenario: 'fire',
    spreadSpeed: 0.4,
    fireSpreadMultiplier: 0.8, // 20% slower fire, including per-source speeds
    fireExposureLimitSeconds: 35, // fictional training threshold, not a medical model
    showSpread: true,
    dynamicRouting: true,
    fireExitSafetyMeters: 2, // evacuate via another exit before flames reach a nearby exit
    smokeFactor: 2.2,
    smokeSlowdown: 0.55,
    smokeVisibilityMeters: 5,
    populationProfiles: { children: 15, older: 15, limited: 0 },
    windDirection: 0, windStrength: 0, allowFireElevator: false,
    ...((Extras && Extras.defaults) || {}),
    ...((Disasters && Disasters.defaults) || {})
  };
  const DEFAULT_DELAYS = { fire: 30, quake: 15, flood: 20, lockdown: 0 };
  const SCENARIO_LABELS = {
    fire: 'Пожар',
    quake: 'Земетресение',
    flood: 'Наводнение',
    lockdown: 'Заплаха / блокиране'
  };

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function pxDist(a, b) {
    return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
  }
  function pointRectDistance(p, r) {
    const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
    const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
    return Math.hypot(dx, dy);
  }
  function overlapSize(a, b) {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return { ix, iy, area: ix * iy };
  }
  function segmentPointDistance(a, b, p) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    if (len2 < 0.0001) return pxDist(a, p);
    let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
    t = clamp(t, 0, 1);
    return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
  }
  function normalizeRect(item) {
    return {
      x: num(item.x, 0),
      y: num(item.y, 0),
      w: Math.max(12, num(item.w, 80)),
      h: Math.max(12, num(item.h, 60))
    };
  }
  function getWidth(item, fallback) {
    const w = num(item && item.width, fallback == null ? 0.9 : fallback);
    return clamp(w, 0.2, 20);
  }
  function itemPeople(item) {
    if (!item) return 0;
    if (item.type === 'people') return Math.max(0, Math.round(num(item.count, 0)));
    if (item.type === 'room') {
      return Math.max(0, Math.round(num(item.people, 0))) + Math.max(0, Math.round(num(item.teachers, 0)));
    }
    return 0;
  }

  class MinHeap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(priority, value) {
      const a = this.a;
      a.push({ priority, value });
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].priority <= a[i].priority) break;
        [a[p], a[i]] = [a[i], a[p]];
        i = p;
      }
    }
    pop() {
      const a = this.a;
      if (!a.length) return null;
      const top = a[0];
      const last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        while (true) {
          const l = i * 2 + 1;
          const r = l + 1;
          let best = i;
          if (l < a.length && a[l].priority < a[best].priority) best = l;
          if (r < a.length && a[r].priority < a[best].priority) best = r;
          if (best === i) break;
          [a[best], a[i]] = [a[i], a[best]];
          i = best;
        }
      }
      return [top.priority, top.value];
    }
  }

  function shortestPath(model, startId, targetIds) {
    if (!model || !model.nodes.has(startId)) return null;
    const targets = new Set(targetIds || []);
    if (!targets.size) return null;
    const dist = new Map([[startId, 0]]);
    const prev = new Map();
    const visited = new Set();
    const heap = new MinHeap();
    heap.push(0, startId);

    while (heap.size) {
      const item = heap.pop();
      if (!item) break;
      const d = item[0];
      const u = item[1];
      if (visited.has(u)) continue;
      visited.add(u);

      if (targets.has(u)) {
        const path = [u];
        const steps = [];
        let cur = u;
        while (prev.has(cur)) {
          const p = prev.get(cur);
          steps.unshift({ from: p.node, to: cur, edge: p.edge });
          path.unshift(p.node);
          cur = p.node;
        }
        const edgeTime = steps.reduce((sum, step) => {
          return sum + step.edge.distance / Math.max(0.05, model.walkSpeed * (step.edge.speedFactor || 1));
        }, 0);
        const distance = steps.reduce((sum, step) => sum + step.edge.distance, 0);
        return { path, steps, distance, travelTime: edgeTime, exitId: u, cost: d };
      }

      const adj = model.adjacency.get(u) || [];
      for (const edgeId of adj) {
        const edge = model.edges[edgeId];
        if (!edge || edge.blocked) continue;
        const v = edge.a === u ? edge.b : edge.a;
        if (visited.has(v)) continue;
        const cost = edge.distance / Math.max(0.05, edge.speedFactor || 1);
        const nd = d + cost;
        if (nd < (dist.get(v) == null ? Infinity : dist.get(v))) {
          dist.set(v, nd);
          prev.set(v, { node: u, edge });
          heap.push(nd, v);
        }
      }
    }
    return null;
  }

  // Training-only door resistance schedule. Closing is configured on each door:
  // for 5 s flame propagation cannot pass; next 20 s it traverses this door
  // at 40% of normal speed; afterwards this door no longer slows the flame.
  // The schedule affects fire crossing only, not the occupants' escape route.
  function fireDoorArrival(startTime, normalDuration, closeAt) {
    let t = Math.max(0, num(startTime, 0));
    let remaining = Math.max(0, num(normalDuration, 0));
    const at = Math.max(0, num(closeAt, 0));
    const slowStart = at + 5, normalStart = at + 25;
    if (t < at) {
      const progress = Math.min(remaining, at - t);
      t += progress; remaining -= progress;
      if (remaining <= 1e-9) return t;
    }
    if (t < slowStart) t = slowStart;
    if (t < normalStart) {
      const progress = Math.min(remaining, (normalStart - t) * 0.4);
      t += progress / 0.4; remaining -= progress;
      if (remaining <= 1e-9) return t;
    }
    return t + remaining;
  }

  function hazardArrivals(model, startId, speed, maxDistance, wind, hazardType) {
    if (!model || !model.nodes.has(startId)) return [];
    const limit = Math.max(1, num(maxDistance, 30));
    const travel = Math.max(0.02, num(speed, 0.4));
    const direction = (num(wind && wind.direction, 0) * Math.PI) / 180;
    const strength = clamp(num(wind && wind.strength, 0), 0, 0.8);
    const best = new Map([[startId, 0]]);
    const visited = new Set();
    const bestFrom = new Map();
    const arrivals = [];
    const heap = new MinHeap();
    heap.push(0, { nodeId: startId, distance: 0 });
    while (heap.size) {
      const item = heap.pop();
      if (!item) break;
      const t = item[0], current = item[1], u = current.nodeId;
      if (visited.has(u)) continue;
      visited.add(u);
      if (current.distance > limit + 0.001) continue;
      const node = model.nodes.get(u);
      if (!node) continue;
      arrivals.push({
        nodeId: u,
        label: node.label || node.kind || 'възел',
        kind: node.kind,
        floor: node.floor,
        x: node.x,
        y: node.y,
        distance: current.distance,
        time: t,
        fromNodeId: bestFrom.get(u) ? bestFrom.get(u).nodeId : null,
        fromEdgeId: bestFrom.get(u) ? bestFrom.get(u).edgeId : null
      });
      const adj = model.adjacency.get(u) || [];
      for (const edgeId of adj) {
        const edge = model.edges[edgeId];
        if (!edge || edge.blocksSpread || edge.kind === 'opening') continue;
        // Never spread through geometric wall contacts. Explicit door/opening,
        // exit and stair edges are the only allowed inter-space connections.
        const v = edge.a === u ? edge.b : edge.a;
        if (visited.has(v)) continue;
        const other = model.nodes.get(v);
        if (!other) continue;
        const dx = other.x - node.x, dy = other.y - node.y;
        const len = Math.hypot(dx, dy) || 1;
        const alignment = (dx * Math.cos(direction) + dy * Math.sin(direction)) / len;
        const effectiveDistance = edge.distance / Math.max(0.2, 1 + strength * alignment);
        const nextDistance = current.distance + effectiveDistance;
        if (nextDistance > limit + 0.001) continue;
        // Advanced Build: the entered room's surface changes the rate of spread.
        // Multipliers are illustrative educational controls, not physical fire equations.
        const targetMaterial = other.kind === 'space' ? other.materialId : node.kind === 'space' ? node.materialId : 'standard';
        const rate = Materials ? Materials.spread(targetMaterial, hazardType) : 1;
        let normalDuration = effectiveDistance / Math.max(0.02, travel * rate);
        if (hazardType === 'smoke' && model.settings.ventilationEnabled && other.kind === 'space') {
          const extract = (model.ventilationFixtures || []).filter(v => v.floor === other.floor &&
            (v.type === 'vent' || v.type === 'ventshaft' || (v.type === 'window' && v.open !== false)) &&
            other.rect && pointRectDistance(v, other.rect) < 25)
            .reduce((total,v) => total + clamp(num(v.strength,.5),0,.8),0);
          normalDuration *= 1 + Math.min(2,extract) * clamp(num(model.settings.ventilationStrength,.45),0,.8);
        }
        // Resist only on exiting the door node, once per crossing, so the
        // effect is not counted twice for the two room->door->room graph edges.
        const nextTime = hazardType === 'fire' && node.kind === 'door' &&
          edge.kind === 'door' && edge.fireDoorClosed
          ? fireDoorArrival(t, normalDuration, edge.fireDoorCloseAtSeconds)
          : t + normalDuration;
        if (nextTime + 1e-9 < (best.get(v) == null ? Infinity : best.get(v))) {
          best.set(v, nextTime);
          bestFrom.set(v, { nodeId: u, edgeId });
          heap.push(nextTime, { nodeId: v, distance: nextDistance });
        }
      }
    }
    arrivals.sort((a, b) => a.time - b.time);
    return arrivals;
  }

  // Optional matched ventilation shafts offer a smoke-only cross-floor path.
  // Does not add evacuation routes or fire paths. Educational approximation.
  function throughSmokeShafts(model, original, speed, limit, wind) {
    if (!model.settings.ventilationEnabled) return original;
    const shafts = (model.ventilationFixtures||[]).filter(v=>v.type==='ventshaft');
    if (shafts.length < 2) return original;
    const best = new Map(original.map(a=>[a.nodeId,a]));
    function closestSpace(v) {
      const floor=model.floors[v.floor];
      if (!floor) return null;
      return (floor.spaces||[]).slice().sort((a,b)=>pointRectDistance(v,a.rect)-pointRectDistance(v,b.rect))[0];
    }
    shafts.forEach(from=>{
      const near=closestSpace(from), origin=near&&best.get(near.node.id);
      if (!origin || pointRectDistance(from,near.rect)>50) return;
      shafts.forEach(to=>{
        if (to.floor === from.floor || String(from.shaft||'V1')!==String(to.shaft||'V1'))return;
        const target=closestSpace(to);
        if (!target || pointRectDistance(to,target.rect)>50) return;
        const verticalDistance=Math.abs(to.floor-from.floor)*Math.max(1,model.floorHeight);
        const distance=origin.distance+verticalDistance;
        if (distance>limit) return;
        const transferTime=verticalDistance/Math.max(.04,speed)*.85;
        const nearby=hazardArrivals(model,target.node.id,speed,limit-distance,wind,'smoke');
        nearby.forEach(r=>{
          const arrival=Object.assign({},r,{distance:distance+r.distance,time:origin.time+transferTime+r.time});
          const older=best.get(arrival.nodeId);
          if (!older || older.time>arrival.time)best.set(arrival.nodeId,arrival);
        });
      });
    });
    return [...best.values()].sort((a,b)=>a.time-b.time);
  }

  // Each reached room has a LOCAL circular front. Its centre is the physical
  // ignition point (first room) or the doorway/transition through which flame
  // enters (later rooms). Reaching a graph node no longer burns its full room.
  // Distances, delays and materials are illustrative rather than CFD physics.
  function makeFireFronts(model, hazard, arrivals, wind) {
    const fronts = [];
    const pxPerMeter = model.pxPerMeter;
    const direction = num(wind && wind.direction, 0) * Math.PI / 180;
    const strength = clamp(num(wind && wind.strength, 0), 0, 0.8);
    const byId = new Map(arrivals.map(a => [a.nodeId, a]));
    arrivals.filter(a => a.kind === 'space').forEach(a => {
      const room = model.nodes.get(a.nodeId);
      if (!room || !room.rect) return;
      const initial = a.nodeId === hazard.originNodeId;
      const from = initial ? null : model.nodes.get(a.fromNodeId);
      const prev = initial ? null : byId.get(a.fromNodeId);
      const edge = !initial && a.fromEdgeId != null ? model.edges[a.fromEdgeId] : null;
      if (!initial && (!from || !prev || !edge)) return;
      const rate = Materials ? Materials.spread(room.materialId, 'fire') : 1;
      const dx = from ? room.x - from.x : 0, dy = from ? room.y - from.y : 0;
      const length = Math.hypot(dx, dy);
      const align = length ? (dx * Math.cos(direction) + dy * Math.sin(direction)) / length : 0;
      const effectiveSpeed = Math.max(.02, hazard.speed * rate * Math.max(.2, 1 + strength * align));
      const normalDuration = from ? (length / pxPerMeter) / effectiveSpeed : 0;
      // Delayed fire door passage: seed the front only after it has overcome
      // the closure, rather than at the time the room node is reached.
      const startTime = initial ? 0 : Math.max(prev.time, a.time - normalDuration);
      const entryDistance = initial ? 0 : Math.max(0, a.distance - edge.distance);
      const remaining = Math.max(0, hazard.maxRadius - entryDistance);
      const maxRadiusPx = (initial ? hazard.baseRadius : 0) + remaining * pxPerMeter;
      fronts.push({
        nodeId: a.nodeId, floor: room.floor, rect: room.rect,
        x: initial ? hazard.x : from.x,
        y: initial ? hazard.y : from.y,
        startTime, speedPx: effectiveSpeed * pxPerMeter,
        initialRadius: initial ? hazard.baseRadius : 0,
        maxRadiusPx, origin: initial
      });
    });
    return fronts;
  }

  function firePatchesAt(model, source, seconds) {
    if (!source || !Array.isArray(source.fronts)) return [];
    const t = Extras ? Extras.fireClock(model && model.settings, seconds, source.startAt || 0) : Math.max(0, num(seconds, 0));
    if (t < 0) return [];
    return source.fronts.map(front => {
      const elapsed = t - front.startTime;
      const radiusPx = elapsed < 0 ? 0 : Math.max(0, Math.min(front.maxRadiusPx,
        front.initialRadius + front.speedPx * elapsed));
      return Object.assign({}, front, { radiusPx });
    }).filter(p => p.radiusPx > 0.0001);
  }

  function pointInFirePatches(patches, floor, x, y, bufferPx) {
    return (patches || []).some(p => {
      if (p.floor !== floor || p.radiusPx <= 0) return false;
      const r = p.rect;
      if (r && (x < r.x || x > r.x+r.w || y < r.y || y > r.y+r.h)) return false;
      return Math.hypot(x-p.x,y-p.y) <= p.radiusPx + Math.max(0,num(bufferPx,0));
    });
  }

  // An exterior opening is a window, door or exit on an outside edge of an
  // enclosed room. Doors between two rooms are NOT exterior. This remains a
  // geometric approximation: plans have no 3D wall topology, so the user may
  // explicitly mark an opening as exterior or interior in the object editor.
  function exteriorFloodEntries(items, pixelsPerMeter) {
    const rooms = (items || []).filter(item => item && ['room','corridor'].includes(item.type))
      .map(item => ({ item, rect: normalizeRect(item) }));
    const fixtures = (items || []).filter(item => item && ['window','door','exit'].includes(item.type));
    const margin = clamp(num(pixelsPerMeter,25)*0.65, 10, 18);
    const step = Math.max(9, num(pixelsPerMeter,25)*0.5);
    const inside = (r,x,y) => x>=r.x+.05 && x<=r.x+r.w-.05 && y>=r.y+.05 && y<=r.y+r.h-.05;
    const entries=[];
    fixtures.forEach(item => {
      if (item.floodExterior === false) return;
      const x=num(item.x,0), y=num(item.y,0);
      const sides=[];
      rooms.forEach(room=>{
        const r=room.rect;
        if (y>=r.y-3 && y<=r.y+r.h+3) {
          sides.push({room,d:Math.abs(x-r.x),dx:-1,dy:0});
          sides.push({room,d:Math.abs(x-(r.x+r.w)),dx:1,dy:0});
        }
        if (x>=r.x-3 && x<=r.x+r.w+3) {
          sides.push({room,d:Math.abs(y-r.y),dx:0,dy:-1});
          sides.push({room,d:Math.abs(y-(r.y+r.h)),dx:0,dy:1});
        }
      });
      sides.sort((a,b)=>a.d-b.d);
      let found=null;
      for(const side of sides){
        if (side.d>margin) break;
        // Test relative to the actual room edge, even when the editor marker
        // is displaced a few pixels toward either side of the wall.
        const r=side.room.rect;
        const edgeX=side.dx<0?r.x:side.dx>0?r.x+r.w:x;
        const edgeY=side.dy<0?r.y:side.dy>0?r.y+r.h:y;
        const ix=edgeX-side.dx*step, iy=edgeY-side.dy*step;
        const ox=edgeX+side.dx*step, oy=edgeY+side.dy*step;
        if (!inside(r,ix,iy)) continue;
        if (rooms.some(other=>other!==side.room && inside(other.rect,ox,oy))) continue;
        found={id:String(item.id),kind:item.type,roomId:String(side.room.item.id),x,y,opening:item};
        break;
      }
      // Explicitly chosen exterior opening: attach to its nearest enclosed
      // space even if a rough hand-drawn plan did not align the marker exactly.
      if (!found && item.floodExterior === true && rooms.length) {
        const nearest=rooms.slice().sort((a,b)=>pointRectDistance({x,y},a.rect)-pointRectDistance({x,y},b.rect))[0];
        if (pointRectDistance({x,y},nearest.rect)<=90)
          found={id:String(item.id),kind:item.type,roomId:String(nearest.item.id),x,y,opening:item};
      }
      if(found)entries.push(found);
    });
    return entries;
  }

  // Whole-building exterior flood: every room/corridor on a reached floor is
  // submerged at the same time and has the same water surface elevation.
  // Openings are optional markers for display, never gates for the water.
  // This intentionally differs from local fire spread and wall topology.
  function floodStatusAt(model, seconds) {
    const level = model && Disasters && model.scenario==='flood'
      ? Disasters.waterLevel(model.settings, seconds) : 0;
    const wetSpaces = new Set();
    const activePortals = [];
    if (!model || model.scenario!=='flood' || level<=0)
      return {level, wetSpaces, activePortals, floodedRoomCount:0};
    const cache=model._floodStatusCache;
    if(cache && cache.seconds===seconds && cache.level===level)return cache.status;
    const floorHeight=Math.max(1,num(model.floorHeight,3.2));
    (model.floors||[]).forEach((floor,fi)=>{
      if(level<=fi*floorHeight+0.001)return;
      (floor.spaces||[]).forEach(space=>{
        if(space.item.type!=='courtyard')wetSpaces.add(space.node.id);
      });
    });
    // Kept only for informative metadata; no openings are required for flooding.
    (model.floodPortals||[]).forEach(portal=>{
      if(level>portal.floor*floorHeight+0.001)activePortals.push(portal);
    });
    const status={level,wetSpaces,activePortals,floodedRoomCount:wetSpaces.size};
    model._floodStatusCache={seconds,level,status};
    return status;
  }

  function floodDepthAt(model, floor, x, y, seconds) {
    if(!model || model.scenario!=='flood' || !(model.floors||[])[floor])return 0;
    // A common water level covers *all* rooms and exits of a submerged floor.
    // x/y intentionally have no bearing on the water depth.
    const state=floodStatusAt(model,seconds);
    return Math.max(0,state.level-floor*Math.max(1,num(model.floorHeight,3.2)));
  }

  function buildModel(project, options) {
    const projectSettings = (project && project.settings) || {};
    const settings = Extras.normalize(Object.assign({}, DEFAULTS, projectSettings, options || {}));
    Object.assign(settings, Disasters ? Disasters.normalize(settings) : {});
    Object.assign(settings, Security ? Security.normalize(settings) : {});
    const pxPerMeter = clamp(num(settings.pxPerMeter, 25), 2, 300);
    const floorHeight = clamp(num(settings.floorHeight, 3.2), 1, 20);
    const walkSpeed = clamp(num(settings.walkSpeed, 1.25), 0.2, 3);
    const specificFlow = clamp(num(settings.specificFlow, 1.3), 0.1, 5);
    const spreadSpeed = clamp(num(settings.spreadSpeed, 0.4), 0.02, 10);
    const fireSpreadMultiplier = clamp(num(settings.fireSpreadMultiplier, 0.8), 0.2, 1.5);
    const fireExposureLimitSeconds = clamp(num(settings.fireExposureLimitSeconds, 35), 5, 600);
    const showSpread = settings.showSpread !== false;
    const scenario = settings.scenario || 'fire';
    const dynamicRouting = settings.dynamicRouting !== false;
    const fireExitSafetyMeters = clamp(num(settings.fireExitSafetyMeters, 2), 0.5, 10);
    const smokeFactor = clamp(num(settings.smokeFactor, 2.2), 1, 5);
    const smokeSlowdown = clamp(num(settings.smokeSlowdown, 0.55), 0.2, 1);
    const smokeVisibilityMeters = clamp(num(settings.smokeVisibilityMeters, 5), 1, 30);
    const windDirection = num(settings.windDirection, 0);
    const windStrength = clamp(num(settings.windStrength, 0), 0, 0.8);
    const fireElevatorsAllowed = scenario !== 'fire' || settings.allowFireElevator === true;
    const wind = { direction: windDirection, strength: windStrength };
    const flowAngle = (num(settings.ventilationDirection,0)*Math.PI)/180;
    const fireWindX = Math.cos(windDirection*Math.PI/180)*windStrength;
    const fireWindY = Math.sin(windDirection*Math.PI/180)*windStrength;
    const extraction = settings.ventilationEnabled ? clamp(num(settings.ventilationStrength,.45),0,.8)*.65 : 0;
    const smokeX = fireWindX + Math.cos(flowAngle)*extraction;
    const smokeY = fireWindY + Math.sin(flowAngle)*extraction;
    const smokeWind = {direction:Math.atan2(smokeY,smokeX)*180/Math.PI,
      strength:Math.min(.8,Math.hypot(smokeX,smokeY))};
    const floors = Array.isArray(project && project.floors) ? project.floors : [];

    const model = {
      version: VERSION,
      settings: { pxPerMeter, floorHeight, walkSpeed, specificFlow, spreadSpeed, fireSpreadMultiplier, fireExposureLimitSeconds, showSpread, scenario, preMovement: settings.preMovement, dynamicRouting, fireExitSafetyMeters, smokeFactor, smokeSlowdown, smokeVisibilityMeters, populationProfiles: settings.populationProfiles, windDirection, windStrength, allowFireElevator: settings.allowFireElevator === true, waitForAssistance: settings.waitForAssistance !== false,
        alarmsEnabled: settings.alarmsEnabled, alarmAtSeconds: settings.alarmAtSeconds,
        sprinklersEnabled: settings.sprinklersEnabled, sprinklerAtSeconds: settings.sprinklerAtSeconds, sprinklerFactor: settings.sprinklerFactor,
        scenarioCreatorEnabled: settings.scenarioCreatorEnabled, timelineEvents: settings.timelineEvents,
        behaviorEnabled: settings.behaviorEnabled, hesitantPercent: settings.hesitantPercent, followerPercent: settings.followerPercent,
        groupTogether: settings.groupTogether, ventilationEnabled: settings.ventilationEnabled,
        ventilationDirection: settings.ventilationDirection, ventilationStrength: settings.ventilationStrength,
        floodGroundRiseEnabled:settings.floodGroundRiseEnabled, floodRiseMetersPerSecond:settings.floodRiseMetersPerSecond,
        floodMaxHeightMeters:settings.floodMaxHeightMeters, floodStartSeconds:settings.floodStartSeconds,
        quakeMagnitude:settings.quakeMagnitude, quakeShakingSeconds:settings.quakeShakingSeconds,
        quakeCollapseEnabled:settings.quakeCollapseEnabled, quakeCollapseAtSeconds:settings.quakeCollapseAtSeconds,
        threatHelpCallEnabled:settings.threatHelpCallEnabled, threatHelpCallAtSeconds:settings.threatHelpCallAtSeconds,
        ...Security.normalize(settings) },
      nodes: new Map(),
      edges: [],
      adjacency: new Map(),
      floors: [],
      groups: [],
      furnitureByFloor: new Map(),
      threatMarkers: [],
      exits: [],
      safeZones: [],
      warnings: [],
      hazardSpread: [],
      smokeSpread: [],
      hazardSources: [],
      doorItems: [],
      ventilationFixtures: [],
      floodPortals: [],
      floodGroundHasEntry: false,
      totalPeople: 0,
      scenario,
      dynamicRouting,
      pxPerMeter,
      floorHeight,
      walkSpeed,
      specificFlow,
      spreadSpeed,
      showSpread,
      mutated: false
    };

    let nodeSeq = 0;
    function addNode(data) {
      const node = Object.assign({ id: 'n' + (++nodeSeq), kind: 'space', floor: 0, x: 0, y: 0 }, data);
      model.nodes.set(node.id, node);
      return node;
    }
    function addEdge(a, b, props) {
      const na = model.nodes.get(a);
      const nb = model.nodes.get(b);
      if (!na || !nb) return null;
      const width = clamp(num(props && props.width, 0.9), 0.2, 20);
      const distance = props && props.distance != null
        ? Math.max(0.02, num(props.distance, 0.1))
        : Math.max(0.02, pxDist(na, nb) / pxPerMeter);
      const edge = Object.assign({
        id: model.edges.length,
        a, b,
        distance,
        width,
        capacity: Math.max(0.05, specificFlow * width),
        speedFactor: 1,
        gateId: null,
        kind: 'opening',
        floor: Math.min(na.floor, nb.floor),
        refId: null,
        blocked: false,
        blockedBy: null
      }, props || {});
      if (edge.capacity == null) edge.capacity = Math.max(0.05, specificFlow * edge.width);
      edge.capacity = Math.max(0.05, num(edge.capacity, specificFlow * edge.width));
      model.edges.push(edge);
      if (!model.adjacency.has(a)) model.adjacency.set(a, []);
      if (!model.adjacency.has(b)) model.adjacency.set(b, []);
      model.adjacency.get(a).push(edge.id);
      model.adjacency.get(b).push(edge.id);
      return edge;
    }
    function warn(text) {
      if (!text) return;
      if (model.warnings.indexOf(text) === -1) model.warnings.push(text);
    }

    /* ---- 1. Стълбищни шахти: свързване на еднакви позиции между етажите ---- */
    const stairEntries = [];
    const liftEntries = [];
    floors.forEach((floor, fi) => {
      const items = Array.isArray(floor && floor.items) ? floor.items : [];
      items.forEach(item => {
        if (item && item.type === 'elevator') {
          liftEntries.push({ floorIndex: fi, item, x: num(item.x, 0), y: num(item.y, 0) });
        }
        if (item && item.type === 'stairs') {
          stairEntries.push({ floorIndex: fi, item, x: num(item.x, 0), y: num(item.y, 0) });
        }
      });
    });
    const shafts = [];
    const shaftsById = new Map();
    function distanceToShaft(entry, shaft) {
      return Math.hypot(entry.x - shaft.x, entry.y - shaft.y);
    }
    stairEntries.forEach(entry => {
      let shaft = null;
      if (entry.item.shaft && shaftsById.has(entry.item.shaft)) {
        const candidate = shaftsById.get(entry.item.shaft);
        if (!candidate.floors.has(entry.floorIndex)) shaft = candidate;
      }
      if (!shaft) {
        const candidates = shafts
          .filter(s => !s.floors.has(entry.floorIndex) && distanceToShaft(entry, s) <= 150)
          .sort((a, b) => distanceToShaft(entry, a) - distanceToShaft(entry, b));
        if (candidates.length) shaft = candidates[0];
      }
      if (!shaft) {
        let id = entry.item.shaft || ('S' + (shafts.length + 1));
        let suffix = 1;
        while (shaftsById.has(id)) id = (entry.item.shaft || 'S') + '-' + (++suffix);
        shaft = { id, x: entry.x, y: entry.y, floors: new Set(), members: [] };
        shafts.push(shaft);
        shaftsById.set(id, shaft);
      }
      shaft.members.push(entry);
      shaft.floors.add(entry.floorIndex);
      const n = shaft.members.length;
      shaft.x = ((shaft.x * (n - 1)) + entry.x) / n;
      shaft.y = ((shaft.y * (n - 1)) + entry.y) / n;
      entry.shaft = shaft;
      if (entry.item.shaft !== shaft.id) {
        entry.item.shaft = shaft.id;
        model.mutated = true;
      }
    });

    /* ---- 2. Възли и локални връзки по етажи ---- */
    floors.forEach((floor, fi) => {
      const items = Array.isArray(floor && floor.items) ? floor.items : [];
      const spaces = [];
      const doors = [];
      const exits = [];
      const stairs = [];
      const hazards = [];
      const lifts = [];
      const safeZones = [];
      const walls = [];
      const surfaces = items.filter(x => x && x.type === 'surface');
      model.furnitureByFloor.set(fi,items.filter(x => x && x.type === 'furniture').map(f => Object.assign({floor:fi},f)));
      if(scenario==='lockdown')items.filter(x=>x&&x.type==='threat').forEach(t=>model.threatMarkers.push(Object.assign({floor:fi,entryAtSeconds:0},t)));
      items.filter(x => x && ['vent','window','ventshaft'].includes(x.type)).forEach(item =>
        model.ventilationFixtures.push(Object.assign({floor:fi}, item)));
      items.filter(x => x && x.type === 'door').forEach(item =>
        model.doorItems.push(Object.assign({floor:fi}, item)));

      items.forEach(item => {
        if (!item || !item.type) return;
        if (item.type === 'room' || item.type === 'corridor' || item.type === 'courtyard') {
          const rect = normalizeRect(item);
          spaces.push({ item, rect });
        } else if (item.type === 'wall') walls.push(item);
        else if (item.type === 'elevator') lifts.push({ item, x: num(item.x, 0), y: num(item.y, 0) });
        else if (item.type === 'safezone') safeZones.push({ item, x: num(item.x, 0), y: num(item.y, 0) });
        else if (item.type === 'door' || item.type === 'opening') doors.push({ item, x: num(item.x, 0), y: num(item.y, 0) });
        else if (item.type === 'exit') exits.push({ item, x: num(item.x, 0), y: num(item.y, 0) });
        else if (item.type === 'stairs') stairs.push({ item, x: num(item.x, 0), y: num(item.y, 0) });
        else if (item.type === 'hazard') {
          // Огнищата са валидни само в пожарния сценарий.
          // Наводнението използва общото водно ниво, не локални опасни зони.
          if (scenario !== 'fire') return;
          const spread = item.spread !== false;
          // A single fire multiplier also affects hazards with an explicit speed.
          const legacyLibraryFire = /^Огнище \(тест\)$/.test(String(item.name || '')) &&
            Math.abs(num(item.spreadSpeed, spreadSpeed) - 0.03) < 1e-6;
          // Old library samples were saved with an unintended 0.03 m/s value;
          // bring only those samples to the shared default. Explicit custom
          // per-source rates remain supported for advanced scenarios.
          const rawSpeed = legacyLibraryFire ? spreadSpeed :
            clamp(num(item.spreadSpeed, spreadSpeed), 0.02, 10);
          const speed = scenario === 'fire' ? Math.max(0.02, rawSpeed * fireSpreadMultiplier) : rawSpeed;
          const maxRadius = clamp(num(item.maxRadius, 30), 1, 500);
          hazards.push({
            item,
            x: num(item.x, 0),
            y: num(item.y, 0),
            radius: Math.max(6, num(item.radius, 27)),
            spread,
            speed,
            maxRadius
          });
        }
      });

      spaces.forEach(s => {
        s.node = addNode({
          id: 'f' + fi + ':space:' + s.item.id,
          kind: 'space',
          spaceType: s.item.type,
          floor: fi,
          x: s.rect.x + s.rect.w / 2,
          y: s.rect.y + s.rect.h / 2,
          rect: s.rect,
          refId: s.item.id,
          label: s.item.name || (s.item.type === 'room' ? 'Помещение' : s.item.type === 'courtyard' ? 'Общ двор' : 'Коридор'),
          buildingId: s.item.buildingId || (s.item.type === 'courtyard' ? 'външна зона' : 'A'),
          width: getWidth(s.item, 0.9),
          materialId: Materials ? Materials.surfaceForSpace(s.item, surfaces) : (s.item.materialId || 'standard')
        });
      });

      // Явните стени забраняват само автоматични връзки, които ги пресичат.
      // Врата/отвор остава изричен преход през стена.
      function intersectsWall(a, b) {
        function orient(p, q, r) { return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x); }
        return walls.some(w => {
          const c = { x: num(w.x, 0), y: num(w.y, 0) };
          const d = { x: num(w.x2, c.x), y: num(w.y2, c.y) };
          return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
        });
      }
      const doorPairs = new Set();
      function pairKey(a, b) {
        const x = String(a.item.id);
        const y = String(b.item.id);
        return x < y ? x + '|' + y : y + '|' + x;
      }
      function nearestSpaces(point, limit) {
        return spaces
          .map(s => ({ space: s, distance: pointRectDistance(point, s.rect) }))
          .filter(x => x.distance <= limit)
          .sort((a, b) => a.distance - b.distance);
      }
      function connectSpaceToDoor(space, door) {
        const width = Math.min(door.item.width ? getWidth(door.item, 0.9) : 0.9, space.node.width || 0.9);
        addEdge(space.node.id, door.node.id, {
          distance: Math.max(0.1, pxDist(space.node, door.node) / pxPerMeter),
          width,
          capacity: specificFlow * width,
          speedFactor: 0.9,
          gateId: 'door:' + door.node.id,
          kind: door.item.type === 'opening' ? 'opening-explicit' : 'door',
          doorState: door.item.doorState || 'open',
          doorItemId: door.item.id,
          fireDoorClosed: door.item.type === 'door' && door.item.fireDoorClosed === true,
          fireDoorCloseAtSeconds: clamp(num(door.item.fireDoorCloseAtSeconds, 0), 0, 3600),
          floor: fi,
          refId: door.item.id
        });
      }

      doors.forEach(door => {
        door.node = addNode({
          id: 'f' + fi + ':door:' + door.item.id,
          kind: 'door', floor: fi, x: door.x, y: door.y,
          refId: door.item.id,
          label: door.item.name || (door.item.type === 'opening' ? 'Отвор' : 'Врата'),
          width: getWidth(door.item, 0.9),
          fireDoorClosed: door.item.type === 'door' && door.item.fireDoorClosed === true,
          fireDoorCloseAtSeconds: clamp(num(door.item.fireDoorCloseAtSeconds, 0), 0, 3600)
        });
        let near = nearestSpaces(door.node, 55);
        if (!near.length) near = nearestSpaces(door.node, 220).slice(0, 2);
        if (near.length >= 2) {
          connectSpaceToDoor(near[0].space, door);
          connectSpaceToDoor(near[1].space, door);
          doorPairs.add(pairKey(near[0].space, near[1].space));
        } else if (near.length === 1) {
          connectSpaceToDoor(near[0].space, door);
          warn('Врата „' + door.node.label + '“ на етаж ' + (fi + 1) + ' е свързана само с едно помещение (задънена улица).');
        } else {
          warn('Врата „' + door.node.label + '“ на етаж ' + (fi + 1) + ' не е близо до помещение или коридор.');
        }
      });

      exits.forEach(exit => {
        exit.node = addNode({
          id: 'f' + fi + ':exit:' + exit.item.id,
          kind: 'exit', floor: fi, x: exit.x, y: exit.y,
          refId: exit.item.id,
          label: exit.item.name || 'Авариен изход',
          width: getWidth(exit.item, 1.2),
          isExit: true
        });
        let near = nearestSpaces(exit.node, 80);
        if (!near.length) near = nearestSpaces(exit.node, 320);
        if (near.length) {
          const s = near[0].space;
          if (near[0].distance > 80) warn('Изход „' + exit.node.label + '“ на етаж ' + (fi + 1) + ' е далеч от помещение/коридор.');
          const width = Math.min(exit.node.width, s.node.width || exit.node.width);
          addEdge(s.node.id, exit.node.id, {
            distance: Math.max(0.1, pxDist(s.node, exit.node) / pxPerMeter),
            width,
            capacity: specificFlow * width,
            speedFactor: 1,
            gateId: 'exit:' + exit.node.id,
            kind: 'exit',
            floor: fi,
            refId: exit.item.id
          });
        } else {
          warn('Изход „' + exit.node.label + '“ на етаж ' + (fi + 1) + ' не е свързан с помещение/коридор.');
        }
        model.exits.push(exit.node);
      });

      stairs.forEach(stair => {
        const shaft = stair.item.shaft && shaftsById.get(stair.item.shaft) ? shaftsById.get(stair.item.shaft) : null;
        stair.node = addNode({
          id: 'f' + fi + ':stairs:' + stair.item.id,
          kind: 'stairs', floor: fi, x: stair.x, y: stair.y,
          refId: stair.item.id,
          label: stair.item.name || ('Стълбище ' + (shaft ? shaft.id : '')),
          width: getWidth(stair.item, 1.2),
          shaft: shaft ? shaft.id : null
        });
        const stairEntry = stairEntries.find(e => e.floorIndex === fi && e.item === stair.item);
        if (stairEntry) stairEntry.node = stair.node;
        let near = nearestSpaces(stair.node, 100);
        if (!near.length) near = nearestSpaces(stair.node, 320);
        if (near.length) {
          const s = near[0].space;
          if (near[0].distance > 100) warn('Стълбище „' + stair.node.label + '“ на етаж ' + (fi + 1) + ' е далеч от помещение/коридор.');
          const width = Math.min(stair.node.width, s.node.width || stair.node.width);
          addEdge(s.node.id, stair.node.id, {
            distance: Math.max(0.1, pxDist(s.node, stair.node) / pxPerMeter),
            width,
            capacity: specificFlow * width * 0.8,
            speedFactor: 0.8,
            gateId: 'stair:' + stair.node.id,
            kind: 'stairs',
            floor: fi,
            refId: stair.item.id
          });
        } else {
          warn('Стълбище „' + stair.node.label + '“ на етаж ' + (fi + 1) + ' не е свързано с помещение/коридор.');
        }
      });

      for (let i = 0; i < spaces.length; i++) {
        for (let j = i + 1; j < spaces.length; j++) {
          const a = spaces[i];
          const b = spaces[j];
          if (doorPairs.has(pairKey(a, b))) continue;
          if (intersectsWall(a.node, b.node)) continue;
          const ov = overlapSize(a.rect, b.rect);
          if (ov.area < 4) continue;
          const widthPx = Math.max(ov.ix, ov.iy);
          if (widthPx < 4) continue;
          const width = clamp(widthPx / pxPerMeter, 0.8, 3);
          addEdge(a.node.id, b.node.id, {
            distance: Math.max(0.15, pxDist(a.node, b.node) / pxPerMeter),
            width,
            capacity: specificFlow * width,
            speedFactor: 1,
            gateId: 'opening:' + pairKey(a, b),
            kind: 'opening',
            blocksSpread: true,
            floor: fi
          });
          doorPairs.add(pairKey(a, b));
        }
      }

      // Безопасните зони са крайна точка за изчакване, но НЕ изход от сградата.
      safeZones.forEach(zone => {
        const node = addNode({ id: 'f' + fi + ':safezone:' + zone.item.id, kind: 'safezone',
          floor: fi, x: zone.x, y: zone.y, refId: zone.item.id, label: zone.item.name || 'Безопасна зона' });
        const near = nearestSpaces(node, 120)[0];
        if (near) addEdge(near.space.node.id, node.id, {
          width: 1.5, gateId: 'safezone:' + node.id, kind: 'safezone', floor: fi,
          distance: Math.max(0.1, pxDist(near.space.node, node) / pxPerMeter) });
        else warn('Безопасна зона на етаж ' + (fi + 1) + ' няма връзка с помещение.');
        model.safeZones.push(node);
      });
      lifts.forEach(lift => {
        const node = addNode({ id: 'f' + fi + ':elevator:' + lift.item.id, kind: 'elevator',
          floor: fi, x: lift.x, y: lift.y, refId: lift.item.id,
          shaft: lift.item.shaft || 'L1', label: lift.item.name || 'Асансьор', width: getWidth(lift.item, 1.1) });
        const entry = liftEntries.find(e => e.item === lift.item && e.floorIndex === fi);
        if (entry) entry.node = node;
        const near = nearestSpaces(node, 120)[0];
        if (near && fireElevatorsAllowed) addEdge(near.space.node.id, node.id, {
          width: node.width, capacity: specificFlow * node.width * 0.55,
          gateId: 'lift:' + node.id, kind: 'elevator', floor: fi,
          distance: Math.max(0.1, pxDist(near.space.node, node) / pxPerMeter) });
        if (scenario === 'fire' && !fireElevatorsAllowed)
          warn('Асансьор „' + node.label + '“ не участва в маршрута при пожар.');
      });
      model.floors[fi] = { index: fi, name: floor && floor.name || ('Етаж ' + (fi + 1)), spaces, doors, exits, stairs, hazards, lifts, safeZones, walls, surfaces };
    });

    /* ---- 3. Вертикални връзки между стълбищата ---- */
    shafts.forEach(shaft => {
      const members = shaft.members.slice().sort((a, b) => a.floorIndex - b.floorIndex);
      if (members.length < 2) {
        warn('Стълбище „' + shaft.id + '“ не свързва етажи (има само един етаж).');
        return;
      }
      for (let i = 0; i < members.length - 1; i++) {
        const a = members[i];
        const b = members[i + 1];
        const diff = Math.abs(b.floorIndex - a.floorIndex);
        if (diff < 1) continue;
        const width = Math.min(a.node.width || 1.2, b.node.width || 1.2);
        addEdge(a.node.id, b.node.id, {
          distance: Math.max(0.5, floorHeight * diff),
          width,
          capacity: specificFlow * width * 0.7,
          speedFactor: 0.55,
          gateId: 'stairv:' + shaft.id + ':' + Math.min(a.floorIndex, b.floorIndex),
          kind: 'stairs-vertical',
          floor: Math.min(a.floorIndex, b.floorIndex),
          refId: shaft.id
        });
      }
    });

    // Свързваме асансьорни шахти само в разрешените учебни сценарии.
    if (fireElevatorsAllowed) {
      const byShaft = new Map();
      liftEntries.filter(x => x.node).forEach(entry => {
        const shaft = String(entry.item.shaft || 'L1');
        if (!byShaft.has(shaft)) byShaft.set(shaft, []);
        byShaft.get(shaft).push(entry);
      });
      byShaft.forEach(entries => {
        entries.sort((a, b) => a.floorIndex - b.floorIndex);
        for (let i = 1; i < entries.length; i++) {
          const a = entries[i - 1], b = entries[i];
          const diff = b.floorIndex - a.floorIndex;
          if (diff < 1) continue;
          const width = Math.min(a.node.width, b.node.width);
          addEdge(a.node.id, b.node.id, {
            distance: Math.max(0.5, floorHeight * diff), width, kind: 'elevator-vertical',
            gateId: 'liftv:' + (a.item.shaft || 'L1') + ':' + a.floorIndex,
            capacity: Math.min(1.4, specificFlow * width * 0.45), speedFactor: 1.2,
            floor: a.floorIndex
          });
        }
      });
    }

    // Advanced Build: movement speed reacts to surfaces on the connected spaces.
    // Applied after all graph edges are built, before routing or simulation.
    if (Materials) model.edges.forEach(edge => {
      const a = model.nodes.get(edge.a), b = model.nodes.get(edge.b);
      const space = b && b.kind === 'space' ? b : a && a.kind === 'space' ? a : null;
      if (space) edge.speedFactor *= Materials.speed(space.materialId, scenario);
    });

    /* ---- 3b. Разпространение на опасности (пожар / вода) ---- */
    if (scenario === 'fire') {
      const allSpaces = model.floors.reduce((sum, fl) => sum + ((fl.spaces && fl.spaces.length) || 0), 0);
      model.floors.forEach(fl => {
        (fl.hazards || []).forEach(h => {
          if (!h.spread) return;
          let origin = null;
          let best = Infinity;
          fl.spaces.forEach(s => {
            const d = pointRectDistance({ x: h.x, y: h.y }, s.rect);
            if (d < best) {
              best = d;
              origin = s.node;
            }
          });
          if (!origin) {
            model.nodes.forEach(node => {
              if (node.floor !== fl.index) return;
              const d = pxDist(node, { x: h.x, y: h.y });
              if (d < best) {
                best = d;
                origin = node;
              }
            });
          }
          if (!origin) return;
          const ignitionAt = scenario === 'fire' && Extras ? Extras.ignitionTime(settings, h.item.id) : 0;
          const arrivals = hazardArrivals(model, origin.id, h.speed, h.maxRadius, wind, scenario);
          const targets = arrivals.filter(a => {
            const node = model.nodes.get(a.nodeId);
            return node && (node.kind === 'exit' || node.kind === 'stairs' || node.kind === 'space');
          });
          const info = {
            id: h.item.id,
            refId: h.item.id,
            label: h.item.name || 'Опасна зона',
            floor: fl.index,
            x: h.x,
            y: h.y,
            baseRadius: h.radius,
            startAt: ignitionAt,
            speed: h.speed,
            maxRadius: h.maxRadius,
            originNodeId: origin.id,
            arrivals: targets,
            fronts: scenario === 'fire' ? makeFireFronts(model, { x: h.x, y: h.y, speed: h.speed, baseRadius: h.radius, maxRadius: h.maxRadius, originNodeId: origin.id }, arrivals, wind) : [],
            exits: targets.filter(a => a.kind === 'exit'),
            reachableSpaces: targets.filter(a => a.kind === 'space').length,
            totalSpaces: allSpaces,
            blockedSpaces: Math.max(0, allSpaces - targets.filter(a => a.kind === 'space').length)
          };
          model.hazardSpread.push(info);
          if (scenario === 'fire') {
            const smokeSpeed = Math.max(0.05, num(h.speed, spreadSpeed) * smokeFactor);
            const smokeMaxRadius = Math.max(6, num(h.maxRadius, 12) * smokeFactor);
            const smokeArrivals = throughSmokeShafts(model,
              hazardArrivals(model, origin.id, smokeSpeed, smokeMaxRadius, smokeWind, 'smoke'),
              smokeSpeed, smokeMaxRadius, smokeWind)
              .filter(a => {
                const node = model.nodes.get(a.nodeId);
                return node && (node.kind === 'exit' || node.kind === 'stairs' || node.kind === 'space');
              });
            model.smokeSpread.push({
              id: 'smoke:' + h.item.id,
              refId: h.item.id,
              label: 'Дим · ' + (h.item.name || 'огнище'),
              floor: fl.index,
              x: h.x,
              y: h.y,
              baseRadius: h.radius,
              startAt: ignitionAt,
              speed: smokeSpeed,
              maxRadius: smokeMaxRadius,
              originNodeId: origin.id,
              arrivals: smokeArrivals,
              exits: smokeArrivals.filter(a => a.kind === 'exit'),
              reachableSpaces: smokeArrivals.filter(a => a.kind === 'space').length,
              totalSpaces: allSpaces,
              blockedSpaces: Math.max(0, allSpaces - smokeArrivals.filter(a => a.kind === 'space').length)
            });
          }
          if (info.reachableSpaces <= 1 && fl.spaces.length > 1) {
            warn('Разпространението от „' + info.label + '“ е ограничено от стени: няма врата/изход към други помещения.');
          }
          const firstExit = info.exits.slice().sort((a, b) => a.time - b.time)[0];
          if (firstExit) {
            const word = scenario === 'flood' ? 'Водата' : 'Пожарът';
            warn(word + ' от „' + info.label + '“ може да достигне изход „' + firstExit.label + '“ за около ' + Math.round(firstExit.time) + ' s.');
          }
        });
      });
    }

    // Exterior openings may be recorded for information, but whole-floor
    // flooding works even in fully sealed rooms without windows or doors.
    if(scenario==='flood'){
      floors.forEach((floor,fi)=>{
        exteriorFloodEntries(floor&&floor.items,pxPerMeter).forEach(opening=>
          model.floodPortals.push({floor:fi,id:opening.id,kind:opening.kind,
            roomId:opening.roomId,x:opening.x,y:opening.y}));
      });
      model.floodGroundHasEntry=true;
    }

    /* ---- 4. Групи хора ---- */
    floors.forEach((floor, fi) => {
      const items = Array.isArray(floor && floor.items) ? floor.items : [];
      const spaces = (model.floors[fi] && model.floors[fi].spaces) || [];
      spaces.forEach(s => {
        if (s.item.type !== 'room') return;
        const count = itemPeople(s.item);
        if (!count) return;
        model.groups.push({
          id: 'g:room:' + s.item.id,
          refId: s.item.id,
          floor: fi,
          nodeId: s.node.id,
          label: s.item.name || 'Помещение',
          peopleCount: count,
          spawn: { type: 'rect', rect: s.rect, margin: 12 },
          kind: 'room'
        });
      });
      items.forEach(item => {
        if (!item || item.type !== 'people') return;
        const count = Math.max(0, Math.round(num(item.count, 0)));
        if (!count) return;
        const point = { x: num(item.x, 0), y: num(item.y, 0) };
        let nearest = spaces
          .map(s => ({ space: s, distance: pointRectDistance(point, s.rect) }))
          .sort((a, b) => a.distance - b.distance)[0];
        let nodeId = null;
        if (nearest && nearest.distance <= 80) {
          nodeId = nearest.space.node.id;
        } else if (nearest) {
          const src = addNode({
            id: 'f' + fi + ':source:' + item.id,
            kind: 'source', floor: fi, x: point.x, y: point.y,
            refId: item.id,
            label: item.name || 'Група хора'
          });
          addEdge(src.id, nearest.space.node.id, {
            distance: Math.max(0.2, pxDist(point, nearest.space.node) / pxPerMeter),
            width: 2,
            capacity: 5,
            speedFactor: 1,
            gateId: 'source:' + src.id,
            kind: 'source',
            floor: fi,
            refId: item.id
          });
          nodeId = src.id;
          if (nearest.distance > 150) warn('Група „' + (item.name || 'без име') + '“ е далеч от помещение/коридор.');
        } else {
          const src = addNode({
            id: 'f' + fi + ':source:' + item.id,
            kind: 'source', floor: fi, x: point.x, y: point.y,
            refId: item.id,
            label: item.name || 'Група хора'
          });
          nodeId = src.id;
          warn('Група „' + (item.name || 'без име') + '“ не е свързана с помещение/коридор.');
        }
        model.groups.push({
          id: 'g:people:' + item.id,
          refId: item.id,
          floor: fi,
          nodeId,
          label: item.name || 'Група хора',
          peopleCount: count,
          spawn: { type: 'point', x: point.x, y: point.y, spread: 18 },
          kind: 'people'
        });
      });
    });
    model.totalPeople = model.groups.reduce((sum, g) => sum + g.peopleCount, 0);

    /* ---- 5. Опасни зони: блокиране на маршрути ---- */
    const hazardActive = scenario === 'fire';
    if (hazardActive) {
      floors.forEach((floor, fi) => {
        const hazards = (model.floors[fi] && model.floors[fi].hazards) || [];
        hazards.forEach(h => {
          const center = { x: h.x, y: h.y };
          const radius = h.radius;
          model.hazardSources.push({
            floor: fi,
            x: h.x,
            y: h.y,
            baseRadius: h.radius,
            speed: h.spread ? h.speed : 0,
            maxRadius: h.spread ? h.maxRadius : 0,
            startAt: scenario === 'fire' && Extras ? Extras.ignitionTime(settings, h.item.id) : 0,
            originNodeId: null,
            refId: h.item.id
          });
          const sourceSpace = (model.floors[fi].spaces || []).slice().sort((a, b) =>
            pointRectDistance(center, a.rect) - pointRectDistance(center, b.rect))[0];
          const sourceNodeId = sourceSpace ? sourceSpace.node.id : null;
          model.hazardSources[model.hazardSources.length - 1].originNodeId = sourceNodeId;
          model.edges.forEach(edge => {
            const a = model.nodes.get(edge.a);
            const b = model.nodes.get(edge.b);
            if (!a || !b || !sourceNodeId) return;
            // The initial radius cannot ignite an unrelated room through its wall.
            if (edge.a !== sourceNodeId && edge.b !== sourceNodeId) return;
            if (num(model.hazardSources[model.hazardSources.length - 1].startAt,0) <= 0 && segmentPointDistance(a, b, center) <= radius + 8) {
              edge.blocked = true;
              edge.blockedBy = h.item.id;
            }
          });
          model.exits.forEach(exit => {
            if (num(model.hazardSources[model.hazardSources.length - 1].startAt,0) <= 0 && exit.floor === fi && (model.adjacency.get(sourceNodeId) || []).some(id => {
              const e = model.edges[id];
              return e && (e.a === exit.id || e.b === exit.id);
            }) && pxDist(exit, center) <= radius + 12) {
              exit.blocked = true;
              warn('Изход „' + exit.label + '“ е в опасната зона и е недостъпен.');
            }
          });
        });
      });
    }

    /* ---- 6. Проверки и маршрути ---- */
    if (scenario !== 'lockdown' && !model.exits.length) warn('Няма добавен авариен изход.');
    if (!model.groups.length) warn('Няма хора за евакуация. Добави хора в помещение или отделна група.');
    model.exits.forEach(exit => {
      if (!model.adjacency.get(exit.id) || !model.adjacency.get(exit.id).length) {
        warn('Изход „' + exit.label + '“ няма връзка с планa.');
      }
    });
    model.floors.forEach(fl => {
      fl.spaces.forEach(s => {
        const adj = model.adjacency.get(s.node.id) || [];
        if (!adj.length) warn('Помещение/коридор „' + s.node.label + '“ на етаж ' + (fl.index + 1) + ' е изолирано (няма врата, изход или връзка).');
      });
    });

    // Enforce locked/damaged doors at the start, even without any hazard.
    updateDoorBlocking(model,0);
    // Apply the same proximity check at t=0, before computing first routes.
    if (scenario === 'fire' && model.hazardSources.length) {
      updateHazardBlocking(model, 0);
      model.exits.filter(e => e.blockedReason === 'fire-near').forEach(e =>
        warn('Изход „' + e.label + '“ е твърде близо до пожар — избери алтернативен маршрут.')
      );
    }
    if(scenario==='flood' && settings.floodGroundRiseEnabled) updateHazardBlocking(model,0);
    const activeExits = model.exits.filter(e => !e.blocked);
    const preMovement = settings.preMovement == null ? DEFAULT_DELAYS[scenario] : num(settings.preMovement, DEFAULT_DELAYS[scenario] || 0);
    model.groups.forEach(group => {
      if (scenario === 'lockdown') {
        group.status = 'shelter';
        group.route = null;
        group.travelTime = 0;
        group.estimatedTime = 0;
        return;
      }
      const route = shortestPath(model, group.nodeId, activeExits.map(e => e.id));
      group.route = route;
      group.status = route ? 'ok' : 'no-route';
      group.travelTime = route ? route.travelTime : null;
      group.estimatedTime = route ? route.travelTime + preMovement : null;
      if (!route) warn('За група „' + group.label + '“ няма достъпен маршрут до изход.');
    });

    if (model.warnings.length > 24) model.warnings = model.warnings.slice(0, 24);
    model.activeExits = activeExits;
    return model;
  }

  function updateDoorBlocking(model, seconds) {
    if (!model || !Extras) return;
    const lookup = new Map((model.doorItems || []).map(d => [String(d.id),d]));
    model.edges.forEach(edge => {
      if (edge.doorItemId == null) return;
      if (String(edge.blockedBy || '').startsWith('door:')) { edge.blocked = false; edge.blockedBy = null; }
      const door = lookup.get(String(edge.doorItemId));
      if (!door) return;
      const state = Extras.doorState(model.settings,door,seconds);
      edge.doorCurrentState = state;
      if (state === 'locked' || state === 'damaged') {
        edge.blocked = true; edge.blockedBy = 'door:' + state;
      }
    });
  }

  // An exit becomes unsuitable BEFORE flames reach the exit itself. We only
  // inspect the exit's connected graph edges and the corresponding fire-arrival
  // times: a visually close fire BEHIND a solid wall must not close an exit.
  // The threshold is a fictional training parameter (metres), not a code limit.
  function fireNearExit(model, exit, seconds) {
    if (!model || model.scenario !== 'fire' || !exit) return false;
    const margin = clamp(num(model.settings && model.settings.fireExitSafetyMeters, 2), 0.5, 10);
    const adjacent = (model.adjacency.get(exit.id) || []).map(id => model.edges[id]).filter(Boolean);
    if (!adjacent.length) return false;
    const t = Math.max(0, num(seconds, 0));
    const scale = Math.max(2, num(model.pxPerMeter, 25));
    // A source which already burns right beside this exit should block it
    // immediately, even if the first graph edge is several metres long.
    for (const source of model.hazardSources || []) {
      if (source.floor !== exit.floor || !source.originNodeId) continue;
      const effective = Extras ? Extras.fireClock(model.settings,t,source.startAt || 0) : t;
      if (effective < 0) continue;
      const sharesSpace = adjacent.some(edge => edge.a === source.originNodeId || edge.b === source.originNodeId);
      if (sharesSpace) {
        const advancingRadius = Math.min(Math.max(0, num(source.maxRadius, 0)),
          Math.max(0, num(source.speed, 0)) * effective) * scale;
        if (pxDist(source, exit) <= num(source.baseRadius, 0) + advancingRadius + margin * scale) return true;
      }
    }
    // As the front travels toward an exit, close it when the front is within
    // `margin` metres along a real, connected exit edge. This respects walls,
    // closed-door delays and the configured maximum spread distance.
    for (const fire of model.hazardSpread || []) {
      const localTime = Extras ? Extras.fireClock(model.settings,t,fire.startAt || 0) : t;
      if (localTime < 0) continue;
      const exitArrival = (fire.exits || []).find(a => a.nodeId === exit.id);
      const nodes = new Map((fire.arrivals || []).map(a => [a.nodeId, a]));
      for (const edge of adjacent) {
        if (edge.blocksSpread) continue;
        const otherId = edge.a === exit.id ? edge.b : edge.a;
        // The source room is represented by a centre point in the graph;
        // physical proximity from the actual source coordinates (above) is
        // more accurate than assuming the whole room ignites at its centre.
        if (otherId === fire.originNodeId) continue;
        const arrival = nodes.get(otherId);
        if (!arrival || arrival.floor !== exit.floor) continue;
        const needed = Math.max(0, edge.distance - margin);
        if (arrival.distance + needed > fire.maxRadius + 1e-6) continue;
        const travelSeconds = exitArrival && exitArrival.time > arrival.time
          ? exitArrival.time - arrival.time
          : edge.distance / Math.max(0.02, num(fire.speed, 0.4));
        const approachAt = arrival.time + travelSeconds * needed / Math.max(0.02, edge.distance);
        if (localTime + 1e-9 >= approachAt) return true;
      }
    }
    return false;
  }

  function applyRisingWater(model,seconds){
    if(model.scenario!=='flood'||!model.settings.floodGroundRiseEnabled||!Disasters)return;
    const level=floodStatusAt(model,seconds).level;
    // Every exit on the submerged floor is affected by the same water level.
    // The 0.7 m blockage threshold is an adjustable-in-code TRAINING shortcut.
    for(const exit of model.exits){
      if(floodDepthAt(model,exit.floor,exit.x,exit.y,seconds)>=0.7){
        exit.blocked=true;exit.blockedReason='rising-water';
        for(const edgeId of model.adjacency.get(exit.id)||[]){
          const edge=model.edges[edgeId];if(edge){edge.blocked=true;edge.blockedBy='rising-water';}
        }
      }
    }
    return level;
  }

  /* Преизчислява блокираните от опасността ребра/изходи за дадено симулационно време.
     Използва се от runner-а за динамично пренасочване на маршрутите. */
  function updateHazardBlocking(model, seconds) {
    if (!model || !Array.isArray(model.hazardSources) || !model.hazardSources.length) {
      if (model) {
        const before = new Set(model.edges.filter(e => e.blocked).map(e=>e.id));
        model.edges.forEach(e=>{ if(e.blockedBy==='rising-water'){e.blocked=false;e.blockedBy=null;} });
        model.exits.forEach(exit=>{if(exit.blockedReason==='rising-water'){exit.blocked=false;exit.blockedReason=null;} });
        updateDoorBlocking(model, seconds);
        applyRisingWater(model,seconds);
        model.activeExits=model.exits.filter(e=>!e.blocked);
        return { changed: model.edges.some(e=>e.blocked!==before.has(e.id)), blockedEdges: model.edges.filter(e=>e.blocked).length, activeExits:model.activeExits };
      }
      return { changed:false, blockedEdges:0, activeExits:[] };
    }
    const t = Math.max(0, num(seconds, 0));
    const pxPerMeter = Math.max(2, num(model.pxPerMeter, 25));
    const blockedEdgesBefore = new Set();
    model.edges.forEach(edge => { if (edge.blocked) blockedEdgesBefore.add(edge.id); });
    const blockedExitsBefore = new Set(model.exits.filter(exit => exit.blocked).map(exit => exit.id));

    model.edges.forEach(edge => { edge.blocked = false; edge.blockedBy = null; });
    updateDoorBlocking(model, t);
    model.exits.forEach(exit => { exit.blocked = false; exit.blockedReason = null; });

    model.hazardSources.forEach(h => {
      const localTime = model.scenario === 'fire' && Extras ? Extras.fireClock(model.settings,t,h.startAt || 0) : t;
      if (localTime < 0) return;
      const center = { x: h.x, y: h.y };
      const spread = (model.hazardSpread || []).find(x => String(x.refId) === String(h.refId));
      const reached = new Set((spread && spread.arrivals || []).filter(a => a.time <= localTime).map(a => a.nodeId));
      // Началната опасност обхваща локалното огнище. По-нататъшното
      // разпространение следва само достъпните през отвори възли.
      // Това предотвратява преминаване през плътни стени по геометричен радиус.
      model.edges.forEach(edge => {
        const a = model.nodes.get(edge.a), b = model.nodes.get(edge.b);
        if (!a || !b) return;
        const touchesFloor = a.floor === h.floor || b.floor === h.floor || edge.floor === h.floor;
        const initial = touchesFloor && h.originNodeId &&
          (edge.a === h.originNodeId || edge.b === h.originNodeId) &&
          segmentPointDistance(a, b, center) <= h.baseRadius + 8;
        if (initial || (reached.has(edge.a) && reached.has(edge.b))) {
          edge.blocked = true;
          edge.blockedBy = h.refId;
        }
      });
      model.exits.forEach(exit => {
        if ((exit.floor === h.floor && model.edges.some(e =>
          (e.a === h.originNodeId && e.b === exit.id) ||
          (e.b === h.originNodeId && e.a === exit.id)) &&
          pxDist(exit, center) <= h.baseRadius + 12) || reached.has(exit.id)) {
          exit.blocked = true;
          exit.blockedReason = 'hazard';
        }
      });
    });

    // Proactive fire-exit avoidance: mark the exit AND its approach edges so
    // current routes, including queued/moving agents, are invalidated at once.
    model.exits.forEach(exit => {
      if (!exit.blocked && fireNearExit(model, exit, t)) {
        exit.blocked = true;
        exit.blockedReason = 'fire-near';
      }
      if (exit.blocked) {
        (model.adjacency.get(exit.id) || []).forEach(id => {
          const edge = model.edges[id];
          if (!edge) return;
          edge.blocked = true;
          edge.blockedBy = exit.blockedReason === 'fire-near' ? 'fire-near-exit:' + exit.refId : edge.blockedBy || 'hazard-exit:' + exit.refId;
        });
      }
    });

    applyRisingWater(model,t);
    let newBlockedEdge = false;
    for (const edge of model.edges) {
      if (edge.blocked !== blockedEdgesBefore.has(edge.id)) { newBlockedEdge = true; break; }
    }
    const activeExits = model.exits.filter(exit => !exit.blocked);
    const blockedExitsNow = new Set(model.exits.filter(exit => exit.blocked).map(exit => exit.id));
    const newBlockedExit = Array.from(blockedExitsNow).some(id => !blockedExitsBefore.has(id)) || Array.from(blockedExitsBefore).some(id=>!blockedExitsNow.has(id));
    model.activeExits = activeExits;
    return {
      changed: newBlockedEdge || newBlockedExit,
      blockedEdges: model.edges.filter(edge => edge.blocked).length,
      activeExits
    };
  }

  function routeToSafeZone(model, nodeId) {
    if (!model || !model.safeZones || !model.safeZones.length) return null;
    return shortestPath(model, nodeId, model.safeZones.map(z => z.id));
  }

  function routeFromNode(model, nodeId) {
    if (!model || (model.scenario === 'lockdown' && model.settings.securityEnhancedEnabled !== true)) return null;
    const exits = (model.activeExits || model.exits.filter(exit => !exit.blocked)).map(exit => exit.id);
    if (!exits.length) return null;
    return shortestPath(model, nodeId, exits);
  }

  function routeForGroup(model, group) {
    if (!group) return null;
    if (group.route) return group.route;
    if (model.scenario === 'lockdown') return null;
    return routeFromNode(model, group.nodeId);
  }

  function formatTime(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    if (s < 60) return s.toFixed(1) + ' s';
    const m = Math.floor(s / 60);
    const r = Math.round(s % 60);
    return m + ' min ' + (r < 10 ? '0' : '') + r + ' s';
  }

  return {
    VERSION,
    DEFAULTS,
    DEFAULT_DELAYS,
    SCENARIO_LABELS,
    buildModel,
    shortestPath,
    routeFromNode,
    routeToSafeZone,
    updateHazardBlocking,
    fireNearExit,
    routeForGroup,
    formatTime,
    fireDoorArrival,
    exteriorFloodEntries,
    floodStatusAt,
    floodDepthAt,
    firePatchesAt,
    updateDoorBlocking,
    pointInFirePatches,
    helpers: { num, clamp, pxDist, pointRectDistance, overlapSize, segmentPointDistance, normalizeRect, getWidth, itemPeople }
  };
});
