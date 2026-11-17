/*
 * Evacuation Simulator v0.4.0 — agent / flow runner
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

  const DEFAULTS = engine.DEFAULTS || { pxPerMeter: 25, walkSpeed: 1.25, specificFlow: 1.3 };
  const DEFAULT_DELAYS = engine.DEFAULT_DELAYS || { fire: 30, quake: 15, flood: 20, lockdown: 0 };
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

  function buildRouteLegs(model, group) {
    if (!group.route || !group.route.steps || !group.route.steps.length) return [];
    const legs = [];
    group.route.steps.forEach(step => {
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
        edgeId: step.edge.id
      });
    });
    return legs;
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
    const routeLegsByGroup = groups.map(group => buildRouteLegs(model, group));
    const groupStats = groups.map((g, index) => ({
      index,
      id: g.id,
      label: g.label,
      floor: g.floor,
      people: g.peopleCount,
      evacuated: 0,
      sheltered: 0,
      noRoute: 0,
      active: 0,
      done: 0,
      status: g.status,
      estimatedTime: g.estimatedTime,
      refId: g.refId
    }));

    const agents = [];
    let agentSeq = 0;
    groups.forEach((group, groupIndex) => {
      const baseLegs = routeLegsByGroup[groupIndex] || [];
      for (let i = 0; i < group.peopleCount; i++) {
        const spawn = spawnPoint(group);
        const legs = baseLegs.map(leg => ({
          from: Object.assign({}, leg.from),
          to: Object.assign({}, leg.to),
          distance: leg.distance,
          gateId: leg.gateId,
          speedFactor: leg.speedFactor,
          kind: leg.kind,
          edgeId: leg.edgeId
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
              edgeId: null
            });
          }
        }
        const noRoute = !lockdown && !legs.length;
        const delayJitter = 0.85 + Math.random() * 0.3;
        agents.push({
          id: ++agentSeq,
          groupIndex,
          groupId: group.id,
          groupLabel: group.label,
          floor: spawn.floor,
          x: spawn.x,
          y: spawn.y,
          spawnX: spawn.x,
          spawnY: spawn.y,
          legs,
          legIndex: 0,
          progress: 0,
          entered: false,
          gates: Object.create(null),
          started: false,
          startedAt: null,
          startDelay: lockdown ? Math.random() * Math.max(1, preMovement * 0.3) : preMovement * delayJitter,
          state: noRoute ? 'no-route' : 'waiting',
          doneAt: noRoute ? 0 : null
        });
      }
    });

    let time = 0;
    let finished = agents.length === 0;
    let timedOut = false;

    function finishAgent(agent, state) {
      if (agent.state === 'safe' || agent.state === 'sheltered') return;
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
      while (timeLeft > 1e-7 && guard++ < 14) {
        if (agent.legIndex >= agent.legs.length) {
          finishAgent(agent, 'safe');
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
        if (!(leg.distance > 0)) {
          agent.legIndex += 1;
          agent.progress = 0;
          agent.entered = false;
          continue;
        }
        const speed = Math.max(0.05, walkSpeed * (leg.speedFactor || 1));
        const legTime = leg.distance / speed;
        const remainingTime = Math.max(0, legTime * (1 - agent.progress));
        if (timeLeft >= remainingTime) {
          timeLeft -= remainingTime;
          agent.progress = 1;
          agent.x = leg.to.x;
          agent.y = leg.to.y;
          agent.floor = leg.to.floor;
          agent.legIndex += 1;
          agent.progress = 0;
          agent.entered = false;
          if (agent.legIndex >= agent.legs.length) {
            finishAgent(agent, 'safe');
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
        gs.active = 0;
      });
      agents.forEach(agent => {
        const gs = groupStats[agent.groupIndex];
        if (!gs) return;
        if (agent.state === 'safe') gs.evacuated += 1;
        else if (agent.state === 'sheltered') gs.sheltered += 1;
        else if (agent.state === 'no-route') gs.noRoute += 1;
        else gs.active += 1;
      });
      groupStats.forEach(gs => {
        gs.done = gs.evacuated + gs.sheltered + gs.noRoute;
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
        const maxPx = h.baseRadius + h.maxRadius * pxPerMeter;
        const radiusPx = Math.min(maxPx, h.baseRadius + h.speed * time * pxPerMeter);
        const reached = h.arrivals.filter(a => a.time <= time);
        const next = h.arrivals.find(a => a.time > time) || null;
        return {
          id: h.id,
          refId: h.refId,
          label: h.label,
          floor: h.floor,
          x: h.x,
          y: h.y,
          baseRadius: h.baseRadius,
          speed: h.speed,
          maxRadius: h.maxRadius,
          radiusPx,
          reached,
          next,
          arrivals: h.arrivals,
          exits: h.exits
        };
      });
    }

    function snapshot() {
      updateGroupStats();
      const counts = { safe: 0, sheltered: 0, noRoute: 0, moving: 0, queued: 0, waiting: 0, sheltering: 0 };
      let doneTime = 0;
      let doneCount = 0;
      agents.forEach(agent => {
        if (agent.state === 'safe') counts.safe += 1;
        else if (agent.state === 'sheltered') counts.sheltered += 1;
        else if (agent.state === 'no-route') counts.noRoute += 1;
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
      let inHazard = 0;
      if (spread.length) {
        agents.forEach(agent => {
          if (agent.state === 'safe' || agent.state === 'sheltered' || agent.state === 'no-route') return;
          if (spread.some(s => s.floor === agent.floor && Math.hypot(agent.x - s.x, agent.y - s.y) <= s.radiusPx)) inHazard += 1;
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
        progress: total ? Math.min(1, finishedPeople / total) : 0,
        averageTime: doneCount ? doneTime / doneCount : null,
        groupStats: groupStats.map(gs => Object.assign({}, gs)),
        bottlenecks,
        spread,
        inHazard,
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

      gates.forEach(gate => {
        const cap = Math.max(1, gate.capacity);
        gate.credits = Math.min(cap, gate.credits + gate.capacity * step);
        gate.waiting = 0;
      });

      for (const agent of agents) {
        if (agent.state === 'safe' || agent.state === 'sheltered' || agent.state === 'no-route') continue;
        if (!agent.started) {
          if (time < agent.startDelay) {
            agent.state = 'waiting';
            continue;
          }
          agent.started = true;
          agent.startedAt = time;
        }
        if (lockdown) {
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
        agent.state === 'safe' || agent.state === 'sheltered' || agent.state === 'no-route'
      );
      if (allDone) finished = true;
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
      get time() { return time; },
      get finished() { return finished; },
      get timedOut() { return timedOut; },
      advance,
      snapshot,
      getState: snapshot
    };
  }

  return { createSimulation };
});
