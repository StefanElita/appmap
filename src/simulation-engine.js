/*
 * Evacuation Simulator v0.5.0 — simulation engine (graph + routing)
 * Учебен модел. Не е валидиран физически/инженерен инструмент.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EvacSim = Object.assign(root.EvacSim || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '0.5.0';
  const DEFAULTS = {
    pxPerMeter: 25,
    floorHeight: 3.2,
    walkSpeed: 1.25,
    specificFlow: 1.3,
    preMovement: null,
    scenario: 'fire',
    spreadSpeed: 0.4,
    showSpread: true
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

  function hazardArrivals(model, startId, speed, maxDistance) {
    if (!model || !model.nodes.has(startId)) return [];
    const limit = Math.max(1, num(maxDistance, 30));
    const travel = Math.max(0.02, num(speed, 0.4));
    const dist = new Map([[startId, 0]]);
    const visited = new Set();
    const arrivals = [];
    const heap = new MinHeap();
    heap.push(0, startId);
    while (heap.size) {
      const item = heap.pop();
      if (!item) break;
      const d = item[0];
      const u = item[1];
      if (visited.has(u)) continue;
      visited.add(u);
      if (d > limit + 0.001) continue;
      const node = model.nodes.get(u);
      if (!node) continue;
      arrivals.push({
        nodeId: u,
        label: node.label || node.kind || 'възел',
        kind: node.kind,
        floor: node.floor,
        x: node.x,
        y: node.y,
        distance: d,
        time: d / travel
      });
      const adj = model.adjacency.get(u) || [];
      for (const edgeId of adj) {
        const edge = model.edges[edgeId];
        if (!edge) continue;
        /* Огънят/водата минават само през врати, изходи и стълбища.
           Директните контакти между помещения (през стена) се пропускат. */
        if (edge.blocksSpread || edge.kind === 'opening') continue;
        const v = edge.a === u ? edge.b : edge.a;
        if (visited.has(v)) continue;
        const nd = d + edge.distance;
        if (nd > limit) continue;
        if (nd < (dist.get(v) == null ? Infinity : dist.get(v))) {
          dist.set(v, nd);
          heap.push(nd, v);
        }
      }
    }
    arrivals.sort((a, b) => a.time - b.time);
    return arrivals;
  }

  function buildModel(project, options) {
    const projectSettings = (project && project.settings) || {};
    const settings = Object.assign({}, DEFAULTS, projectSettings, options || {});
    const pxPerMeter = clamp(num(settings.pxPerMeter, 25), 2, 300);
    const floorHeight = clamp(num(settings.floorHeight, 3.2), 1, 20);
    const walkSpeed = clamp(num(settings.walkSpeed, 1.25), 0.2, 3);
    const specificFlow = clamp(num(settings.specificFlow, 1.3), 0.1, 5);
    const spreadSpeed = clamp(num(settings.spreadSpeed, 0.4), 0.02, 10);
    const showSpread = settings.showSpread !== false;
    const scenario = settings.scenario || 'fire';
    const floors = Array.isArray(project && project.floors) ? project.floors : [];

    const model = {
      version: VERSION,
      settings: { pxPerMeter, floorHeight, walkSpeed, specificFlow, spreadSpeed, showSpread, scenario, preMovement: settings.preMovement },
      nodes: new Map(),
      edges: [],
      adjacency: new Map(),
      floors: [],
      groups: [],
      exits: [],
      warnings: [],
      hazardSpread: [],
      totalPeople: 0,
      scenario,
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
    floors.forEach((floor, fi) => {
      const items = Array.isArray(floor && floor.items) ? floor.items : [];
      items.forEach(item => {
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

      items.forEach(item => {
        if (!item || !item.type) return;
        if (item.type === 'room' || item.type === 'corridor') {
          const rect = normalizeRect(item);
          spaces.push({ item, rect });
        } else if (item.type === 'door') doors.push({ item, x: num(item.x, 0), y: num(item.y, 0) });
        else if (item.type === 'exit') exits.push({ item, x: num(item.x, 0), y: num(item.y, 0) });
        else if (item.type === 'stairs') stairs.push({ item, x: num(item.x, 0), y: num(item.y, 0) });
        else if (item.type === 'hazard') {
          const spread = item.spread !== false;
          const speed = clamp(num(item.spreadSpeed, spreadSpeed), 0.02, 10);
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
          label: s.item.name || (s.item.type === 'room' ? 'Помещение' : 'Коридор'),
          width: getWidth(s.item, 0.9)
        });
      });

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
          kind: 'door',
          floor: fi,
          refId: door.item.id
        });
      }

      doors.forEach(door => {
        door.node = addNode({
          id: 'f' + fi + ':door:' + door.item.id,
          kind: 'door', floor: fi, x: door.x, y: door.y,
          refId: door.item.id,
          label: door.item.name || 'Врата',
          width: getWidth(door.item, 0.9)
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

      model.floors[fi] = { index: fi, name: floor && floor.name || ('Етаж ' + (fi + 1)), spaces, doors, exits, stairs, hazards };
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

    /* ---- 3b. Разпространение на опасности (пожар / вода) ---- */
    if (scenario === 'fire' || scenario === 'flood') {
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
          const arrivals = hazardArrivals(model, origin.id, h.speed, h.maxRadius);
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
            speed: h.speed,
            maxRadius: h.maxRadius,
            originNodeId: origin.id,
            arrivals: targets,
            exits: targets.filter(a => a.kind === 'exit'),
            reachableSpaces: targets.filter(a => a.kind === 'space').length,
            totalSpaces: allSpaces,
            blockedSpaces: Math.max(0, allSpaces - targets.filter(a => a.kind === 'space').length)
          };
          model.hazardSpread.push(info);
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
    const hazardActive = scenario === 'fire' || scenario === 'flood';
    if (hazardActive) {
      floors.forEach((floor, fi) => {
        const hazards = (model.floors[fi] && model.floors[fi].hazards) || [];
        hazards.forEach(h => {
          const center = { x: h.x, y: h.y };
          const radius = h.radius;
          model.edges.forEach(edge => {
            const a = model.nodes.get(edge.a);
            const b = model.nodes.get(edge.b);
            if (!a || !b) return;
            const touchesFloor = a.floor === fi || b.floor === fi || edge.floor === fi;
            if (!touchesFloor) return;
            if (segmentPointDistance(a, b, center) <= radius + 8) {
              edge.blocked = true;
              edge.blockedBy = h.item.id;
            }
          });
          model.exits.forEach(exit => {
            if (exit.floor === fi && pxDist(exit, center) <= radius + 12) {
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

  function routeForGroup(model, group) {
    if (!group) return null;
    if (group.route) return group.route;
    if (model.scenario === 'lockdown') return null;
    const exits = (model.activeExits || model.exits.filter(e => !e.blocked)).map(e => e.id);
    return shortestPath(model, group.nodeId, exits);
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
    routeForGroup,
    formatTime,
    helpers: { num, clamp, pxDist, pointRectDistance, overlapSize, segmentPointDistance, normalizeRect, getWidth, itemPeople }
  };
});
