/*
 * Evacuation Simulator v0.6.0 — agent / flow runner
 * Всеки човек е агент; вратите, изходите и стълбищата са "пропусквателни" точки
 * с капацитет (души/секунда), което създава опашки и реалистично забавяне.
 */
(function (root, factory) {
  let engine = root.EvacSim;
  if (!engine && typeof require === 'function') {
    try { engine = require('./simulation-engine.js'); } catch (e) { engine = {}; }
  }
  const api = factory(engine || {});
  root.EvacSim = Object.assign(root.EvacSim || {}, api);
  if (typeof module === 'object' && module.exports) module.exports = root.EvacSim;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine) {
  'use strict';

  const Extras = (typeof globalThis !== 'undefined' && globalThis.EvacExtras) ||
    (typeof require === 'function' ? require('./scenario-extras.js') : null);
  const DEFAULTS = engine.DEFAULTS || { pxPerMeter: 25, walkSpeed: 1.25, specificFlow: 1.3 };
  const Security=(typeof globalThis!=='undefined'&&globalThis.EvacSecurity) ||
    (typeof require==='function'?require('./security-incident.js'):null);
  const Disasters = (typeof globalThis !== 'undefined' && globalThis.EvacDisasters) ||
    (typeof require === 'function' ? require('./disaster-presets.js') : null);
  const DEFAULT_DELAYS = engine.DEFAULT_DELAYS || { fire: 30, quake: 15, flood: 20, lockdown: 0 };
  const FurnitureNav = (typeof globalThis !== 'undefined' && globalThis.EvacFurnitureNav) ||
    (typeof require === 'function' ? require('./furniture-navigation.js') : null);
  const clamp = engine.helpers ? engine.helpers.clamp : (v, a, b) => Math.max(a, Math.min(b, v));
  const num = engine.helpers ? engine.helpers.num : (v, f) => Number.isFinite(Number(v)) ? Number(v) : f;

  function spawnPoint(group) {
    const spawn = group.spawn || { type: 'point', x: 0, y: 0, spread: 10 };
    if (spawn.type === 'rect') {
      const r = spawn.rect;
      const m = Math.min(spawn.margin == null ? 12 : spawn.margin, Math.max(0, Math.min(r.w, r.h) / 4));
      return {
        x: r.x + m + Math.random() * Math.max(1, r.w - m * 2),
        y: r.y + m + Math.random() * Math.max(1, r.h - m * 2),
        floor: group.floor
      };
    }
    const spread = spawn.spread == null ? 14 : spawn.spread;
    return {
      x: spawn.x + (Math.random() * 2 - 1) * spread,
      y: spawn.y + (Math.random() * 2 - 1) * spread,
      floor: group.floor
    };
  }

  function edgeLabel(model, edge) {
    const a = model.nodes.get(edge.a);
    const b = model.nodes.get(edge.b);
    if (!a || !b) return 'връзка';
    const al = a.label || a.kind || 'възел';
    const bl = b.label || b.kind || 'възел';
    return al + ' → ' + bl;
  }

  function legsFromRoute(model, route) {
    if (!route || !route.steps || !route.steps.length) return [];
    const legs = [];
    route.steps.forEach(step => {
      const a = model.nodes.get(step.from);
      const b = model.nodes.get(step.to);
      if (!a || !b) return;
      legs.push({
        from: { x: a.x, y: a.y, floor: a.floor },
        to: { x: b.x, y: b.y, floor: b.floor },
        distance: Math.max(0.02, step.edge.distance),
        gateId: step.edge.gateId || null,
        speedFactor: step.edge.speedFactor || 1,
        kind: step.edge.kind || 'opening',
        edgeId: step.edge.id,
        fromNode: step.from,
        toNode: step.to
      });
    });
    return legs;
  }

  function buildRouteLegs(model, group) {
    if (!group.route) return [];
    return legsFromRoute(model, group.route);
  }

  function createSimulation(model, options) {
    options = options || {};
    if (!model) throw new Error('Липсва симулационен модел.');
    const scenario = model.scenario || 'fire';
    const lockdown = scenario === 'lockdown';
    const pxPerMeter = Math.max(2, num(model.pxPerMeter, 25));
    const walkSpeed = Math.max(0.2, num(model.walkSpeed, 1.25));
    const defaultDelay = DEFAULT_DELAYS[scenario] == null ? 0 : DEFAULT_DELAYS[scenario];
    const settingDelay = model.settings && model.settings.preMovement != null ? num(model.settings.preMovement, defaultDelay) : defaultDelay;
    const preMovement = options.preMovement != null ? Math.max(0, num(options.preMovement, settingDelay)) : Math.max(0, settingDelay);
    const shelterAfter = options.shelterAfter != null ? Math.max(1, num(options.shelterAfter, 5)) : 5;
    const timeout = options.timeout != null ? Math.max(30, num(options.timeout, 1800)) : 1800;

    const gates = new Map();
    model.edges.forEach(edge => {
      if (!edge.gateId) return;
      let gate = gates.get(edge.gateId);
      if (!gate) {
        gate = {
          id: edge.gateId,
          label: edgeLabel(model, edge),
          kind: edge.kind,
          floor: edge.floor,
          capacity: edge.capacity,
          credits: Math.min(1, edge.capacity),
          waiting: 0,
          maxQueue: 0,
          queueTime: 0,
          passed: 0
        };
        gates.set(edge.gateId, gate);
      } else {
        gate.capacity = Math.min(gate.capacity, edge.capacity);
      }
    });
    if (scenario === 'quake') {
      gates.forEach(gate => {
        if (gate.kind === 'stairs' || gate.kind === 'stairs-vertical') gate.capacity *= 0.7;
      });
    }

    const groups = model.groups || [];
    const routeLegsByGroup = groups.map(group => FurnitureNav
      ? FurnitureNav.detourLegs(buildRouteLegs(model,group),model.furnitureByFloor,pxPerMeter)
      : buildRouteLegs(model,group));
    const groupStats = groups.map((g, index) => ({
      index,
      id: g.id,
      label: g.label,
      floor: g.floor,
      people: g.peopleCount,
      evacuated: 0,
      sheltered: 0,
      noRoute: 0,
      fatal: 0,
      active: 0,
      done: 0,
      status: g.status,
      estimatedTime: g.estimatedTime,
      refId: g.refId
    }));

    const rawMix = (model.settings && model.settings.populationProfiles) || {};
    const profileMix = ['children', 'older', 'limited'].map(k => Math.max(0, num(rawMix[k], ({children:15,older:15,limited:0})[k])));
    const profileTotal = profileMix.reduce((a,b) => a+b, 0);
    const normalizedMix = profileTotal > 100 ? profileMix.map(v => v / profileTotal * 100) : profileMix;
    const profileTypes = ['children', 'older', 'limited'];
    const profileSpeeds = { children: 0.85, older: 0.7, limited: 0.45, adult: 1 };
    const profileReaction = { children: 1.15, older: 1.3, limited: 1.6, adult: 1 };
    const agents = [];
    const behavior = model.settings || {};
    const securitySettings=Security?Security.normalize(behavior):{securityEnhancedEnabled:false};
    const enhancedSecurity=lockdown && securitySettings.securityEnhancedEnabled;
    const quakeDuration = scenario === 'quake' && Disasters ? Disasters.normalize(behavior).quakeShakingSeconds : 0;
    const collapseAt = scenario === 'quake' && Disasters ? Disasters.collapseAt(behavior) : Infinity;
    const travelTimes=groups.map(g=>g.route?g.route.travelTime:Infinity).filter(Number.isFinite).sort((a,b)=>a-b);
    const medianTravel=travelTimes.length?travelTimes[Math.floor(travelTimes.length/2)]:0;
    let buildingCollapsed=false;
    const alarmAt = scenario === 'fire' && Extras ? Extras.alarmTime(behavior) : Infinity;
    let agentSeq = 0;
    const refugeOccupancy=new Map();
    function reserveRefuge(point,localFurniture,kind,maxDistance){
      if(!FurnitureNav)return null;
      // Do not choose a desk in a different room through a solid wall.
      const floor=model.floors[point.floor];
      const rooms=(floor&&floor.spaces)||[];
      const inside=(r,p)=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h;
      const room=rooms.filter(r=>inside(r.rect,point))
        .sort((a,b)=>a.rect.w*a.rect.h-b.rect.w*b.rect.h)[0];
      // No travel to unknown rooms during shaking.
      if(kind==='quake'&&!room)return null;
      const eligible=(localFurniture||[]).filter(f=>{
        const capacity=f.furnitureType==='table'?2:1;
        return (refugeOccupancy.get(f)||0)<capacity &&
          (!room || inside(room.rect,FurnitureNav.center(f)));
      });
      const refuge=FurnitureNav.findRefuge(point,eligible,kind,maxDistance);
      if(refuge)refugeOccupancy.set(refuge.furniture,(refugeOccupancy.get(refuge.furniture)||0)+1);
      return refuge;
    }
    groups.forEach((group, groupIndex) => {
      const baseLegs = routeLegsByGroup[groupIndex] || [];
      for (let i = 0; i < group.peopleCount; i++) {
        // Deterministic stratified assignment prevents small groups from being all one profile.
        const fraction = ((i + 0.5) / Math.max(1, group.peopleCount)) * 100;
        let threshold = 0;
        let profile = 'adult';
        for (let k = 0; k < profileTypes.length; k++) {
          threshold += normalizedMix[k];
          if (fraction < threshold) { profile = profileTypes[k]; break; }
        }
        const spawn = spawnPoint(group);
        const behaviorPhase = ((i+.5)/Math.max(1,group.peopleCount))*100;
        const behavioral = behavior.behaviorEnabled === true
          ? behaviorPhase < num(behavior.hesitantPercent,15) ? 'hesitant'
            : behaviorPhase < num(behavior.hesitantPercent,15)+num(behavior.followerPercent,12) ? 'follower' : 'responsive'
          : 'responsive';
        // Трудноподвижните могат да отидат до зона за изчакване на помощ.
        // Те НЕ се броят за евакуирани от сградата.
        const waitingRoute = profile === 'limited' && model.settings.waitForAssistance !== false && engine.routeToSafeZone
          ? engine.routeToSafeZone(model, group.nodeId) : null;
        const useSafeZone = !!(waitingRoute && waitingRoute.steps && waitingRoute.steps.length);
        const localFurniture=model.furnitureByFloor && model.furnitureByFloor.get(spawn.floor) || [];
        const quakePolicy=scenario==='quake' && Disasters
          ? Disasters.quakePolicy(behavior,spawn.floor,group.route ? group.route.travelTime : Infinity,medianTravel)
          : null;
        const quakeRefuge=scenario==='quake'
          ? reserveRefuge(spawn,localFurniture,'quake',pxPerMeter*2.5) : null;
        const floodRefuge=scenario==='flood' && !baseLegs.length
          ? reserveRefuge(spawn,localFurniture,'flood',pxPerMeter*9) : null;
        const securityEvacuates=false; // Stay inside rooms during the warning exercise; no automatic evacuation toward a marker.
        const securityRoute=securityEvacuates && engine.routeFromNode
          ? engine.routeFromNode(model,group.nodeId):null;
        let selectedLegs = enhancedSecurity && securityEvacuates && securityRoute
          ? legsFromRoute(model,securityRoute)
          : useSafeZone ? legsFromRoute(model, waitingRoute) : baseLegs;
        if(useSafeZone && FurnitureNav)selectedLegs=FurnitureNav.detourLegs(selectedLegs,model.furnitureByFloor,pxPerMeter);
        if(floodRefuge){
          const target=floodRefuge.point;
          selectedLegs=[{from:{x:spawn.x,y:spawn.y,floor:spawn.floor},
            to:{x:target.x,y:target.y,floor:spawn.floor},
            distance:Math.max(.02,Math.hypot(target.x-spawn.x,target.y-spawn.y)/pxPerMeter),
            gateId:null,speedFactor:.70,kind:'furniture-refuge',edgeId:null,fromNode:null,toNode:null}];
        }
        const legs = selectedLegs.map(leg => ({
          from: Object.assign({}, leg.from),
          to: Object.assign({}, leg.to),
          distance: leg.distance,
          gateId: leg.gateId,
          speedFactor: leg.speedFactor,
          kind: leg.kind,
          edgeId: leg.edgeId,
          fromNode: leg.fromNode,
          toNode: leg.toNode
        }));
        if (legs.length) {
          const first = legs[0].from;
          const spawnDistance = Math.hypot(spawn.x - first.x, spawn.y - first.y) / pxPerMeter;
          if (spawnDistance > 0.03) {
            legs.unshift({
              from: { x: spawn.x, y: spawn.y, floor: spawn.floor },
              to: { x: first.x, y: first.y, floor: first.floor },
              distance: spawnDistance,
              gateId: null,
              speedFactor: 1,
              kind: 'spawn',
              edgeId: null,
              fromNode: null,
              toNode: legs[0].fromNode || group.nodeId
            });
          }
        }
        const collisionAwareLegs=FurnitureNav
          ? FurnitureNav.detourLegs(legs,model.furnitureByFloor,pxPerMeter) : legs;
        const noRoute = !lockdown && !collisionAwareLegs.length;
        const delayJitter = 0.85 + Math.random() * 0.3;
        const naturalDelay = lockdown ? Math.random() * Math.max(1, preMovement * 0.3)
          : preMovement * delayJitter * profileReaction[profile];
        const alertDelay = Number.isFinite(alarmAt) ? alarmAt + 2.5 * profileReaction[profile] : Infinity;
        let startDelay = enhancedSecurity
          ? securitySettings.securityWarningAtSeconds
          : Math.min(naturalDelay, alertDelay);
        // The evacuation route starts AFTER shaking; nearby protective action
        // is handled separately at the beginning of the shake.
        if(scenario==='quake') startDelay=Math.max(startDelay,quakeDuration);
        if (behavioral === 'hesitant') startDelay += 8;
        if (behavioral === 'follower') startDelay += 4;
        agents.push({
          id: ++agentSeq,
          groupIndex,
          profile,
          behavior: behavioral,
          securityAction: enhancedSecurity && securityEvacuates && collisionAwareLegs.length ? 'evacuate' : 'shelter',
          goal: floodRefuge ? 'furniture-refuge' : useSafeZone ? 'safezone' : 'exit',
          refugeKind: enhancedSecurity && securitySettings.securityWarningAtSeconds===0 ? 'protective-shelter' : floodRefuge ? 'elevated-furniture' : quakeRefuge ? 'under-desk' :
            scenario==='quake' ? 'protective-shelter' : null,
          quakeRefuge: quakeRefuge && quakeRefuge.point,
          quakePolicy,
          refugeStart: {x:spawn.x,y:spawn.y},
          speedMultiplier: profileSpeeds[profile],
          groupId: group.id,
          groupLabel: group.label,
          routeReason: enhancedSecurity ? (securityEvacuates && collisionAwareLegs.length ?
              'Евакуация след учебно предупреждение и указание.' :
              'Защитно изчакване след учебно предупреждение.') : floodRefuge ? 'Няма достъпен път към по-високо/изход; временно изчакване върху мебел (учебен модел, не гарантира безопасност).' :
            noRoute ? 'Няма безопасен маршрут от началната точка.' :
            (useSafeZone ? 'Избран маршрут към зона за изчакване.' : 'Първоначално избран маршрут към изход.'),
          rerouteAt: null,
          floor: spawn.floor,
          x: spawn.x,
          y: spawn.y,
          spawnX: spawn.x,
          spawnY: spawn.y,
          nodeId: group.nodeId,
          legs: collisionAwareLegs,
          legIndex: 0,
          progress: 0,
          entered: false,
          gates: Object.create(null),
          started: enhancedSecurity && securitySettings.securityWarningAtSeconds===0,
          startedAt: enhancedSecurity && securitySettings.securityWarningAtSeconds===0 ? 0 : null,
          startDelay,
          state: enhancedSecurity && securitySettings.securityWarningAtSeconds===0 ? 'sheltering' :
            noRoute && scenario!=='quake' ? 'no-route' : 'waiting',
          doneAt: noRoute && scenario!=='quake' ? 0 : null,
          fireExposureSeconds: 0,
          fatalAt: null
        });
      }
    });

    const helpCaller = agents.find(a=>a.profile==='adult'||a.profile==='older') || null;
    const securityRooms=enhancedSecurity && Security ? Security.roomIndicators(model,behavior) : [];

    // Optional group cohesion: members of each source room/group start together
    // and travel at a shared pace. This is a simple family/group abstraction.
    if (behavior.groupTogether === true) {
      const byGroup = new Map();
      agents.forEach(a => { if (!byGroup.has(a.groupIndex)) byGroup.set(a.groupIndex,[]); byGroup.get(a.groupIndex).push(a); });
      byGroup.forEach(members => {
        const slowest = Math.min(...members.map(a=>a.speedMultiplier));
        const latest = Math.max(...members.map(a=>a.startDelay));
        members.forEach(a => { a.speedMultiplier = slowest; a.startDelay = latest; });
      });
    }

    const dynamicRouting = options.dynamicRouting != null
      ? !!options.dynamicRouting
      : model.dynamicRouting !== false;
    let rerouteCount = 0;
    let nextHazardCheck = 0;

    let time = 0;
    let finished = agents.length === 0;
    let timedOut = false;
    let smokeNow = [];
    const fireExposureLimitSeconds = clamp(num(model.settings && model.settings.fireExposureLimitSeconds, 35), 5, 600);

    function routeNeedsReroute(agent) {
      if (!agent || !agent.legs) return false;
      for (let i = agent.legIndex; i < agent.legs.length; i++) {
        const destination = model.nodes.get(agent.legs[i].toNode);
        if (destination && destination.isExit && destination.blocked) return true;
        const edgeId = agent.legs[i].edgeId;
        if (edgeId == null) continue;
        const edge = model.edges[edgeId];
        if (edge && edge.blocked) return true;
      }
      return false;
    }

    function rerouteAgent(agent) {
      if (!dynamicRouting || !engine.routeFromNode) return false;
      if (!agent || agent.state === 'safe' || agent.state === 'sheltered' || agent.state === 'no-route' || agent.state === 'fatal') return false;
      const route = agent.goal === 'safezone' && engine.routeToSafeZone
        ? engine.routeToSafeZone(model, agent.nodeId) : engine.routeFromNode(model, agent.nodeId);
      const next = route ? (FurnitureNav ? FurnitureNav.detourLegs(legsFromRoute(model,route),model.furnitureByFloor,pxPerMeter) : legsFromRoute(model,route)) : [];
      if(!next.length && scenario==='flood' && agent.goal==='exit'){
        const furniture=model.furnitureByFloor && model.furnitureByFloor.get(agent.floor)||[];
        const refuge=reserveRefuge(agent,furniture,'flood',pxPerMeter*9);
        if(refuge){
          agent.legs=[{from:{x:agent.x,y:agent.y,floor:agent.floor},
            to:{x:refuge.point.x,y:refuge.point.y,floor:agent.floor},
            distance:Math.max(.02,Math.hypot(agent.x-refuge.point.x,agent.y-refuge.point.y)/pxPerMeter),
            gateId:null,speedFactor:.7,kind:'furniture-refuge',edgeId:null,toNode:null}];
          agent.goal='furniture-refuge';agent.refugeKind='elevated-furniture';
          agent.legIndex=0;agent.progress=0;agent.entered=false;
          agent.routeReason='Водата блокира маршрута; временно изчакване върху мебел (учебен модел).';
          agent.rerouteAt=time;rerouteCount++;return true;
        }
      }
      if (!next.length) return false;
      const startNode = model.nodes.get(agent.nodeId);
      if (startNode) {
        const away = Math.hypot(agent.x - startNode.x, agent.y - startNode.y) / pxPerMeter;
        if (away > 0.03) {
          next.unshift({
            from: { x: agent.x, y: agent.y, floor: agent.floor },
            to: { x: startNode.x, y: startNode.y, floor: startNode.floor },
            distance: away,
            gateId: null,
            speedFactor: 1,
            kind: 'spawn',
            edgeId: null,
            fromNode: null,
            toNode: agent.nodeId
          });
        }
      }
      agent.legs = next;
      agent.legIndex = 0;
      agent.progress = 0;
      agent.entered = false;
      agent.routeReason='Промяна на маршрута: опасен изход или блокиран проход.';
      agent.rerouteAt=time;
      rerouteCount += 1;
      return true;
    }

    function rerouteAffectedAgents() {
      agents.forEach(agent => {
        if (agent.state === 'safe' || agent.state === 'sheltered' || agent.state === 'fatal' || agent.state === 'no-route') return;
        if (!routeNeedsReroute(agent)) return;
        if (!rerouteAgent(agent)) {
          // No alternative is available. Do not keep walking to the fire.
          agent.legs = [];
          agent.state = 'no-route';
          agent.routeReason='Опасен изход/препятствие, не е намерен алтернативен маршрут.';
          agent.rerouteAt=time;
          agent.doneAt = time;
        }
      });
    }

    function refreshGroupRoutes() {
      groups.forEach(group => {
        const route = engine.routeFromNode ? engine.routeFromNode(model, group.nodeId) : null;
        group.route = route;
        group.status = route ? 'ok' : 'no-route';
        group.travelTime = route ? route.travelTime : null;
        group.estimatedTime = route ? route.travelTime + preMovement : null;
      });
    }

    function finishAgent(agent, state) {
      if (agent.state === 'safe' || agent.state === 'sheltered' || agent.state === 'fatal') return;
      agent.state = state;
      agent.doneAt = time;
      if (agent.legs.length) {
        const last = agent.legs[agent.legs.length - 1];
        agent.x = last.to.x;
        agent.y = last.to.y;
        agent.floor = last.to.floor;
      }
    }

    function stepAgent(agent, dt) {
      let timeLeft = dt;
      let guard = 0;
      while (timeLeft > 1e-7 && guard++ < 14) {        if (agent.legIndex >= agent.legs.length) {
          finishAgent(agent, ['safezone','furniture-refuge'].includes(agent.goal) ? 'sheltered' : 'safe');
          return;
        }
        const leg = agent.legs[agent.legIndex];
        if (!agent.entered) {
          if (leg.gateId && !agent.gates[leg.gateId]) {
            const gate = gates.get(leg.gateId);
            if (gate) {
              if (gate.credits < 1) {
                gate.waiting += 1;
                agent.state = 'queued';
                return;
              }
              gate.credits -= 1;
              gate.passed += 1;
              agent.gates[leg.gateId] = true;
            }
          }
          agent.entered = true;
        }
        if (leg.furnitureBlocked) {
          agent.state='no-route';agent.routeReason='Пътят е възпрепятстван от обзавеждането.';
          agent.doneAt=time;return;
        }
        if (!(leg.distance > 0)) {
          agent.legIndex += 1;
          agent.progress = 0;
          agent.entered = false;
          continue;
        }
        let smokePenalty = agentInSmoke(agent, smokeNow)
          ? Math.max(0.2, Math.min(1, num(model.settings && model.settings.smokeSlowdown, 0.55)))
          : 1;
        if (smokePenalty < 1 && behavior.ventilationEnabled) {
          const nearExtraction = (model.ventilationFixtures || []).some(v =>
            v.floor === agent.floor && (v.type === 'vent' || v.type === 'ventshaft' || (v.type === 'window' && v.open !== false)) &&
            Math.hypot(v.x-agent.x,v.y-agent.y) < 100);
          if (nearExtraction) smokePenalty = Math.min(1, smokePenalty + .2 * num(behavior.ventilationStrength,.45));
        }
        const waterDepth = scenario==='flood' && engine.floodDepthAt && behavior.floodGroundRiseEnabled
          ? engine.floodDepthAt(model,agent.floor,agent.x,agent.y,time) : 0;
        const waterPenalty = waterDepth>0 ? Math.max(.3,1-waterDepth*.25) : 1;
        const speed = Math.max(0.05, walkSpeed * (agent.speedMultiplier || 1) * (leg.speedFactor || 1) * smokePenalty * waterPenalty);
        const legTime = leg.distance / speed;
        const remainingTime = Math.max(0, legTime * (1 - agent.progress));
        if (timeLeft >= remainingTime) {
          timeLeft -= remainingTime;
          agent.progress = 1;
          agent.x = leg.to.x;
          agent.y = leg.to.y;
          agent.floor = leg.to.floor;
          if (leg.toNode) agent.nodeId = leg.toNode;
          agent.legIndex += 1;
          agent.progress = 0;
          agent.entered = false;
          if (routeNeedsReroute(agent)) {
            if (!rerouteAgent(agent)) {
              agent.state = 'no-route';
              agent.routeReason='Маршрутът е блокиран по време на движение; няма алтернатива.';
              agent.rerouteAt=time;
              agent.doneAt = time;
              return;
            }
          }
          if (agent.legIndex >= agent.legs.length) {
            finishAgent(agent, ['safezone','furniture-refuge'].includes(agent.goal) ? 'sheltered' : 'safe');
            return;
          }
        } else {
          agent.progress += timeLeft / legTime;
          agent.x = leg.from.x + (leg.to.x - leg.from.x) * agent.progress;
          agent.y = leg.from.y + (leg.to.y - leg.from.y) * agent.progress;
          agent.floor = leg.from.floor;
          agent.state = 'moving';
          return;
        }
      }
    }

    function updateGroupStats() {
      groupStats.forEach(gs => {
        gs.evacuated = 0;
        gs.sheltered = 0;
        gs.noRoute = 0;
        gs.fatal = 0;
        gs.active = 0;
      });
      agents.forEach(agent => {
        const gs = groupStats[agent.groupIndex];
        if (!gs) return;
        if (agent.state === 'safe') gs.evacuated += 1;
        else if (agent.state === 'sheltered') gs.sheltered += 1;
        else if (agent.state === 'no-route') gs.noRoute += 1;
        else if (agent.state === 'fatal') gs.fatal += 1;
        else gs.active += 1;
      });
      groupStats.forEach(gs => {
        gs.done = gs.evacuated + gs.sheltered + gs.noRoute + gs.fatal;
        if (gs.done >= gs.people && gs.people > 0) {
          gs.status = gs.noRoute >= gs.people ? 'no-route' : 'done';
        } else if (gs.active > 0) {
          gs.status = 'active';
        }
      });
    }

    function spreadSnapshot() {
      const list = model.hazardSpread || [];
      if (!list.length) return [];
      return list.map(h => {
        const localTime = Extras ? Extras.fireClock(model.settings,time,h.startAt||0) : time;
        const maxPx = h.baseRadius + h.maxRadius * pxPerMeter;
        const radiusPx = localTime < 0 ? 0 : Math.min(maxPx, h.baseRadius + h.speed * localTime * pxPerMeter);
        const reached = localTime < 0 ? [] : h.arrivals.filter(a => a.time <= localTime);
        const next = h.arrivals.find(a => a.time > localTime) || null;
        return {
          id: h.id,
          refId: h.refId,
          label: h.label,
          floor: h.floor,
          x: h.x,
          y: h.y,
          baseRadius: h.baseRadius,
          startAt: h.startAt || 0,
          speed: h.speed,
          maxRadius: h.maxRadius,
          originNodeId: h.originNodeId || null,
          radiusPx,
          reached,
          next,
          arrivals: h.arrivals,
          exits: h.exits,
          patches: engine.firePatchesAt ? engine.firePatchesAt(model, h, time) : []
        };
      });
    }

    function smokeRadius(meta, seconds) {
      const elapsed = Extras ? Extras.smokeClock(model.settings,seconds,meta.startAt||0) : seconds;
      const maxPx = meta.baseRadius + meta.maxRadius * pxPerMeter;
      return elapsed < 0 ? 0 : Math.min(maxPx, meta.baseRadius + meta.speed * elapsed * pxPerMeter);
    }

    function smokeSnapshot() {
      const list = model.smokeSpread || [];
      if (!list.length) return [];
      return list.map(h => ({
        id: h.id,
        refId: h.refId,
        label: h.label,
        floor: h.floor,
        x: h.x,
        y: h.y,
        baseRadius: h.baseRadius,
        startAt: h.startAt || 0,
        speed: h.speed,
        maxRadius: h.maxRadius,
        originNodeId: h.originNodeId || null,
        radiusPx: smokeRadius(h, time),
        reached: h.arrivals.filter(a => a.time <= (Extras ? Extras.smokeClock(model.settings,time,h.startAt||0) : time)),
        arrivals: h.arrivals
      }));
    }

    function agentInSmoke(agent, list) {
      if (!list || !list.length) return false;
      return list.some(s => {
        if (s.floor !== agent.floor && !(s.reached || []).some(r => r.floor === agent.floor)) return false;
        // Използва графа: стаите, до които димът не е стигнал през врати,
        // не се считат задимени само защото попадат в радиуса на кръга.
        const node = model.nodes.get(agent.nodeId);
        const reached = new Set((s.reached || []).map(r => r.nodeId));
        if (node && reached.has(node.id)) return true;
        if (node && node.kind === 'space') return false;
        return agent.floor === s.floor && Math.hypot(agent.x - s.x, agent.y - s.y) <= s.radiusPx;
      });
    }

    // A base-radius ignition cannot reach a person through a solid wall merely
    // because that person's map coordinates are close to the ignition point.
    function insideSourceRoom(agent, source) {
      if (source.floor !== agent.floor ||
          Math.hypot(agent.x - source.x, agent.y - source.y) > source.baseRadius) return false;
      const origin = model.nodes.get(source.originNodeId);
      if (!origin || !origin.rect) return true; // old plans without room geometry
      const r = origin.rect;
      return agent.x >= r.x && agent.x <= r.x + r.w &&
        agent.y >= r.y && agent.y <= r.y + r.h;
    }

    // The fire model is an educational abstraction; this time threshold is NOT
    // a validated prediction of injury or survival. Smoke alone does not count.
    function agentInFire(agent, spread) {
      return spread.some(h => {
        if (engine.pointInFirePatches && Array.isArray(h.patches))
          return engine.pointInFirePatches(h.patches, agent.floor, agent.x, agent.y);
        return insideSourceRoom(agent, h) ||
          (h.reached || []).some(r => r.nodeId === agent.nodeId && r.floor === agent.floor);
      });
    }

    // A stranded agent can still become exposed when an advancing fire reaches
    // their room. Do not end the simulation prematurely in that case.
    function fireCanReach(agent) {
      if (scenario !== 'fire') return false;
      const potential = (model.hazardSpread || []).some(h =>
        (h.fronts || []).some(f => {
          const r = f.rect;
          return f.floor === agent.floor &&
            (!r || (agent.x >= r.x && agent.x <= r.x+r.w &&
                     agent.y >= r.y && agent.y <= r.y+r.h)) &&
            Math.hypot(agent.x-f.x,agent.y-f.y) <= f.maxRadiusPx;
        })
      );
      // Fixed (non-spreading) sources still expose anyone initially inside.
      return potential || (model.hazardSources || []).some(h =>
        h.speed === 0 && insideSourceRoom(agent, h));
    }

    function snapshot() {
      updateGroupStats();
      const counts = { safe: 0, sheltered: 0, noRoute: 0, fatal: 0, moving: 0, queued: 0, waiting: 0, sheltering: 0 };
      let doneTime = 0;
      let doneCount = 0;
      agents.forEach(agent => {
        if (agent.state === 'safe') counts.safe += 1;
        else if (agent.state === 'sheltered') counts.sheltered += 1;
        else if (agent.state === 'no-route') counts.noRoute += 1;
        else if (agent.state === 'fatal') counts.fatal += 1;
        else if (agent.state === 'moving') counts.moving += 1;
        else if (agent.state === 'queued') counts.queued += 1;
        else if (agent.state === 'sheltering') counts.sheltering += 1;
        else counts.waiting += 1;
        if (agent.doneAt != null && (agent.state === 'safe' || agent.state === 'sheltered')) {
          doneTime += agent.doneAt;
          doneCount += 1;
        }
      });
      const total = model.totalPeople || agents.length;
      const finishedPeople = counts.safe + counts.sheltered;
      const bottlenecks = Array.from(gates.values())
        .filter(gate => gate.maxQueue > 1 || gate.queueTime > 2)
        .sort((a, b) => b.maxQueue - a.maxQueue || b.queueTime - a.queueTime)
        .slice(0, 6)
        .map(gate => ({
          label: gate.label,
          kind: gate.kind,
          floor: gate.floor,
          capacity: gate.capacity,
          maxQueue: gate.maxQueue,
          queueTime: gate.queueTime,
          passed: gate.passed
        }));
      const spread = spreadSnapshot();
      const smoke = smokeSnapshot();
      let inHazard = 0;
      if (spread.length) {
        agents.forEach(agent => {
          if (agent.state === 'safe' || agent.state === 'sheltered' || agent.state === 'no-route' || agent.state === 'fatal') return;
          if (agentInFire(agent, spread)) inHazard += 1;
        });
      }
      let inSmoke = 0;
      if (smoke.length) {
        agents.forEach(agent => {
          if (agent.state === 'safe' || agent.state === 'sheltered' || agent.state === 'no-route' || agent.state === 'fatal') return;
          if (agentInSmoke(agent, smoke)) inSmoke += 1;
        });
      }
      return {
        time,
        finished,
        timedOut,
        total,
        counts,
        safe: counts.safe,
        sheltered: counts.sheltered,
        noRoute: counts.noRoute,
        fatal: counts.fatal,
        fireExposureLimitSeconds,
        progress: total ? Math.min(1, finishedPeople / total) : 0,
        averageTime: doneCount ? doneTime / doneCount : null,
        groupStats: groupStats.map(gs => Object.assign({}, gs)),
        bottlenecks,
        spread,
        smoke,
        inHazard:scenario==='flood' && Disasters
          ? agents.filter(a=>!['safe','sheltered','fatal'].includes(a.state) && engine.floodDepthAt &&
              engine.floodDepthAt(model,a.floor,a.x,a.y,time)>.1).length + inHazard
          : inHazard,
        inSmoke,
        waterLevelMeters:scenario==='flood'&&Disasters ? Disasters.waterLevel(behavior,time) : 0,
        floodPortalsActive: scenario==='flood'&&engine.floodStatusAt ? engine.floodStatusAt(model,time).activePortals.length : 0,
        floodedRooms: scenario==='flood'&&engine.floodStatusAt ? engine.floodStatusAt(model,time).floodedRoomCount : 0,
        buildingCollapsed,
        quakeMagnitude:scenario==='quake'?num(behavior.quakeMagnitude,4.5):null,
        quakeShaking:scenario==='quake' && Disasters ? Disasters.quakeShakeAt(behavior,time).active : false,
        quakeCollapseAtSeconds:scenario==='quake' && Number.isFinite(collapseAt) ? collapseAt : null,
        threatMarkersActive:scenario==='lockdown'?(model.threatMarkers||[]).filter(m=>time>=num(m.entryAtSeconds,0)).length:0,
        securityLevel:lockdown&&Security?Security.level(behavior,time):null,
        securityMarkers:lockdown&&Security?Security.markerPositions(model.threatMarkers,model.floors,time,behavior):[],
        securityRooms:lockdown && Security && ['warning','emergency'].includes(Security.level(behavior,time))?securityRooms:[],
        securityFurniture:lockdown && Security ? Security.furniturePositions(model,time,behavior):[],
        securityDoors:lockdown && Security ? Security.doorPositions(model,time,behavior):[],
        securityPeople:lockdown && Security ? Security.actorPositions(model,agents,time,behavior,
          Security.furniturePositions(model,time,behavior)):[],
        securityNotified:lockdown && enhancedSecurity && time>=securitySettings.securityWarningAtSeconds?agents.length:0,
        securityHelpStatus:lockdown && Security?Security.helpStatus(behavior,time,!!helpCaller):'none',
        helpCall:scenario==='lockdown'&&!!helpCaller&&behavior.threatHelpCallEnabled!==false&&time>=num(behavior.threatHelpCallAtSeconds,12),
        helpCallerId:scenario==='lockdown'&&helpCaller&&behavior.threatHelpCallEnabled!==false&&time>=num(behavior.threatHelpCallAtSeconds,12)?helpCaller.id:null,
        smokeVisibilityMeters: num(model.settings && model.settings.smokeVisibilityMeters, 5),
        smokeSlowdown: Math.max(0.2, Math.min(1, num(model.settings && model.settings.smokeSlowdown, 0.55))),
        reroutes: rerouteCount,
        blockedExits: model.exits.filter(exit => exit.blocked).map(exit => ({
          id: exit.id, label: exit.label, floor: exit.floor,
          reason: exit.blockedReason || 'hazard'
        })),
        dynamicRouting,
        systems: { alarmsEnabled: behavior.alarmsEnabled === true, alarmActive: time >= alarmAt,
          sprinklersEnabled: behavior.sprinklersEnabled === true,
          sprinklersActive: !!(Extras && time >= Extras.sprinklerTime(behavior)),
          ventilationEnabled: behavior.ventilationEnabled === true,
          events: behavior.scenarioCreatorEnabled ? (behavior.timelineEvents||[]).filter(e=>e.atSeconds<=time).map(e=>({type:e.type,atSeconds:e.atSeconds,targetId:e.targetId})) : [] },
        profiles: agents.reduce((result, agent) => { result[agent.profile] = (result[agent.profile] || 0) + 1; return result; }, {}),
        scenario,
        lockdown,
        preMovement
      };
    }

    function advance(dt) {
      if (finished) return snapshot();
      const step = clamp(num(dt, 0), 0, 2);
      if (step <= 0) return snapshot();
      time += step;
      if(!buildingCollapsed && time>=collapseAt){
        buildingCollapsed=true;
        for(const agent of agents){
          if(agent.state==='safe'||agent.state==='fatal'||agent.state==='no-route')continue;
          agent.state='no-route';agent.doneAt=time;agent.legs=[];
          agent.routeReason='Условно срутване на сградата: позицията е неизвестна, нужда от помощ.';
        }
      }
      smokeNow = smokeSnapshot();
      const fireNow = scenario === 'fire' ? spreadSnapshot() : [];

      if (dynamicRouting && !lockdown && engine.updateHazardBlocking && time + 1e-9 >= nextHazardCheck) {
        nextHazardCheck = time + 0.5;
        const hazardState = engine.updateHazardBlocking(model, time);
        if (hazardState.changed) {
          rerouteAffectedAgents();
          refreshGroupRoutes();
        }
      }

      gates.forEach(gate => {
        const cap = Math.max(1, gate.capacity);
        gate.credits = Math.min(cap, gate.credits + gate.capacity * step);
        gate.waiting = 0;
      });

      for (const agent of agents) {
        if (agent.state === 'safe' || agent.state === 'sheltered' || agent.state === 'fatal') continue;
        if (scenario === 'fire' && (fireNow.length ? agentInFire(agent, fireNow) :
          (model.hazardSources || []).some(h => time >= num(h.startAt, 0) && insideSourceRoom(agent, h)))) {
          agent.fireExposureSeconds += step;
          if (agent.fireExposureSeconds >= fireExposureLimitSeconds) {
            agent.state = 'fatal';
            agent.fatalAt = time;
            agent.doneAt = time;
            continue; // Stays at the current position, no movement or gate usage.
          }
        }
        if (agent.state === 'no-route') continue;
        if (scenario==='quake' && agent.quakePolicy==='stay-sheltered' && time>=quakeDuration){
          agent.state='sheltered'; agent.refugeKind=agent.quakeRefuge?'under-desk':'protective-shelter';
          agent.routeReason='Учебно изчакване на етажа; не се отчита като евакуация.';
          agent.doneAt=time;continue;
        }
        if(!agent.started && scenario==='quake' && time<quakeDuration){
          // Drop / Cover / Hold On during shaking. Only a VERY NEARBY desk in
          // the same room is represented by short motion; no running outside.
          if(agent.quakeRefuge){
            const coverTime=Math.max(.7,Math.min(2,quakeDuration*.25));
            const fraction=clamp(time/coverTime,0,1);
            agent.x=agent.refugeStart.x+(agent.quakeRefuge.x-agent.refugeStart.x)*fraction;
            agent.y=agent.refugeStart.y+(agent.quakeRefuge.y-agent.refugeStart.y)*fraction;
            agent.state=fraction<1?'moving':'sheltering';
            agent.refugeKind=fraction<1?null:'under-desk';
            agent.routeReason='Реакция по време на труса: прикриване под близка здрава маса (учебен модел).';
          }else{
            agent.state='sheltering';
            agent.refugeKind='protective-shelter';
            agent.routeReason='Реакция по време на труса: приклякане и защита на главата на място.';
          }
          continue;
        }
        if (!agent.started) {
          if (time < agent.startDelay) {
            if(scenario==='quake'){
              agent.state='sheltering';
              agent.refugeKind=agent.quakeRefuge?'under-desk':'protective-shelter';
            }else agent.state = enhancedSecurity && time>=securitySettings.securityWarningAtSeconds
              ? 'notified' : 'waiting';
            continue;
          }
          agent.started = true;
          agent.startedAt = time;
          // After shaking, connect evacuation to the ACTUAL cover position.
          // Rebase the first leg even when no 'spawn' leg was initially needed.
          if(scenario==='quake' && agent.legs.length){
            const first=agent.legs[0];first.from={x:agent.x,y:agent.y,floor:agent.floor};
            first.distance=Math.hypot(first.from.x-first.to.x,first.from.y-first.to.y)/pxPerMeter;
          }
          if(scenario==='quake')agent.refugeKind=null;
          if (dynamicRouting && routeNeedsReroute(agent)) {
            if (!rerouteAgent(agent)) agent.legs = [];
          }
        }
        if (lockdown && enhancedSecurity) {
          if(agent.securityAction==='evacuate' && agent.legs.length){
            stepAgent(agent,step);continue;
          }
          agent.refugeKind='protective-shelter';
          if(time-agent.startedAt>=shelterAfter){agent.state='sheltered';agent.doneAt=time;}
          else agent.state='sheltering';
          continue;
        }
        if (lockdown) {
          agent.refugeKind='protective-shelter';
          if (time - agent.startedAt >= shelterAfter) {
            agent.state = 'sheltered';
            agent.doneAt = time;
          } else {
            agent.state = 'sheltering';
          }
          continue;
        }
        if (!agent.legs.length) {
          agent.state = 'no-route';
          agent.routeReason='Опасен изход/препятствие, не е намерен алтернативен маршрут.';
          agent.rerouteAt=time;
          agent.doneAt = time;
          continue;
        }
        stepAgent(agent, step);
      }

      gates.forEach(gate => {
        if (gate.waiting > gate.maxQueue) gate.maxQueue = gate.waiting;
        gate.queueTime += gate.waiting * step;
      });

      updateGroupStats();
      const allDone = agents.every(agent =>
        agent.state === 'safe' || agent.state === 'sheltered' || agent.state === 'fatal' ||
        (agent.state === 'no-route' && !fireCanReach(agent))
      );
      const upcomingThreatEvents=lockdown && (
        (enhancedSecurity && time < securitySettings.securityEmergencyAtSeconds) ||
        (enhancedSecurity && Security && Security.helpStatus(behavior,time,!!helpCaller)!=='none' &&
          time < securitySettings.securityHelpArrivalSeconds) ||
        (!!helpCaller && behavior.threatHelpCallEnabled!==false && time<num(behavior.threatHelpCallAtSeconds,12)) ||
        (model.threatMarkers||[]).some(marker=>num(marker.entryAtSeconds,0)>time) ||
        (enhancedSecurity && securitySettings.securityRoamEnabled && (model.threatMarkers||[]).length>0 &&
          time < Math.min(timeout-1,securitySettings.securityRoamPeriodSeconds *
            Math.max(2,Math.min(5,model.floors.length+1)))));
      if (allDone && !(scenario==='quake' && collapseAt<Infinity && !buildingCollapsed) &&
          !upcomingThreatEvents) finished = true;
      if (time >= timeout) {
        timedOut = true;
        finished = true;
      }
      return snapshot();
    }

    updateGroupStats();
    return {
      model,
      agents,
      gates,
      scenario,
      lockdown,
      preMovement,
      dynamicRouting,
      get time() { return time; },
      get finished() { return finished; },
      get timedOut() { return timedOut; },
      get reroutes() { return rerouteCount; },
      advance,
      snapshot,
      getState: snapshot
    };
  }

  return { createSimulation };
});
