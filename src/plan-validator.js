/*
 * Evacuation Simulator v0.6.0 — plan validator
 * Проверява плана за типични учебни грешки: стаи без врата, изолирани
 * помещения, откачени изходи/стълбища, застъпващи се обекти и др.
 * Не заменя инженерна проверка — само помага за тестовите планове.
 */
(function (root, factory) {
  const helpers = root.EvacSim && root.EvacSim.helpers;
  const api = factory(helpers || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PlanValidator = Object.assign(root.PlanValidator || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (helpers) {
  'use strict';

  const VERSION = '0.6.0';
  const clamp = helpers.clamp || ((v, a, b) => Math.max(a, Math.min(b, v)));
  const num = helpers.num || ((v, f) => Number.isFinite(Number(v)) ? Number(v) : f);
  const getWidth = helpers.getWidth || ((item, fallback) => clamp(num(item && item.width, fallback), 0.2, 10));
  const itemPeople = helpers.itemPeople || (item => {
    if (!item) return 0;
    if (item.type === 'people') return num(item.count, 0);
    if (item.type === 'room') return num(item.people, 0) + num(item.teachers, 0);
    return 0;
  });

  const DOOR_REACH = 55;
  const EXIT_REACH = 80;
  const STAIR_REACH = 100;
  const PEOPLE_REACH = 80;
  const SPREAD_REACH = 90;

  function pointRectDistance(point, rect) {
    if (!point || !rect) return Infinity;
    const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.w));
    const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.h));
    return Math.hypot(dx, dy);
  }

  function rectOf(item) {
    const x = Math.min(num(item.x, 0), num(item.x, 0) + num(item.w, 0));
    const y = Math.min(num(item.y, 0), num(item.y, 0) + num(item.h, 0));
    const w = Math.abs(num(item.w, 0));
    const h = Math.abs(num(item.h, 0));
    return { x, y, w, h };
  }

  function overlapArea(a, b) {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return ix * iy;
  }

  function floorItems(floor) {
    return Array.isArray(floor && floor.items) ? floor.items.filter(item => item && item.type) : [];
  }

  function labelOf(item, fallback) {
    if (!item) return fallback || 'обект';
    return item.name || fallback || (item.type === 'room' ? 'Помещение' : item.type === 'corridor' ? 'Коридор' : 'обект');
  }

  function issue(code, severity, floor, item, message, extra) {
    return Object.assign({
      code,
      severity,
      floor,
      itemId: item ? item.id : null,
      itemType: item ? item.type : null,
      label: labelOf(item, ''),
      message
    }, extra || {});
  }

  function validate(project, options) {
    const opts = options || {};
    const floors = Array.isArray(project && project.floors) ? project.floors : [];
    const scenario = (project && project.settings && project.settings.scenario) || 'fire';
    const issues = [];
    let roomCount = 0;
    let doorCount = 0;
    let exitCount = 0;
    let stairCount = 0;
    let hazardCount = 0;
    let peopleTotal = 0;

    if (!floors.length) {
      issues.push(issue('no-floors', 'error', 0, null, 'Проектът няма нито един етаж.'));
      return summarize(issues);
    }

    floors.forEach((floor, fi) => {
      const items = floorItems(floor);
      const spaces = items.filter(i => i.type === 'room' || i.type === 'corridor');
      const doors = items.filter(i => i.type === 'door');
      const exits = items.filter(i => i.type === 'exit');
      const stairs = items.filter(i => i.type === 'stairs');
      const hazards = scenario === 'fire' ? items.filter(i => i.type === 'hazard') : [];
      const groups = items.filter(i => i.type === 'people');
      const floorLabel = 'ет. ' + (fi + 1);
      roomCount += spaces.filter(i => i.type === 'room').length;
      doorCount += doors.length;
      exitCount += exits.length;
      stairCount += stairs.length;
      hazardCount += hazards.length;

      if (!spaces.length) {
        issues.push(issue('floor-empty', 'warning', fi, null, 'Етаж ' + (fi + 1) + ' е празен — няма помещения или коридори.'));
        return;
      }

      spaces.forEach(space => {
        const rect = rectOf(space);
        const name = labelOf(space, 'Помещение');
        const people = itemPeople(space);
        peopleTotal += people;
        if (rect.w < 12 || rect.h < 12) {
          issues.push(issue('space-tiny', 'warning', fi, space,
            '„' + name + '“ е много малък (' + Math.round(rect.w) + '×' + Math.round(rect.h) + ' px).'));
        }
        const doorNear = doors.some(d => pointRectDistance(d, rect) <= DOOR_REACH);
        const exitNear = exits.some(e => pointRectDistance(e, rect) <= EXIT_REACH);
        const stairNear = stairs.some(s => pointRectDistance(s, rect) <= STAIR_REACH);
        if (!doorNear && !exitNear && !stairNear) {
          issues.push(issue('space-isolated', 'error', fi, space,
            '„' + name + '“ (' + floorLabel + ') няма врата, изход или стълбище' +
            (people ? ' — ' + people + ' души са в капан.' : '.')));
        }
        if (space.type === 'room' && !people) {
          issues.push(issue('room-empty', 'info', fi, space, '„' + name + '“ е без хора — само за тестове.'));
        }
        if (space.type === 'corridor' && !doors.length && !exits.length && !stairs.length) {
          issues.push(issue('corridor-unused', 'warning', fi, space, 'Коридорът „' + name + '“ не води до врата, изход или стълбище.'));
        }
      });

      doors.forEach(door => {
        const near = spaces.map(s => pointRectDistance(door, rectOf(s))).filter(d => d <= DOOR_REACH);
        if (!near.length) {
          issues.push(issue('door-detached', 'error', fi, door,
            'Врата „' + labelOf(door, 'Врата') + '“ (' + floorLabel + ') не е на границата на помещение или коридор.'));
        } else if (near.length === 1) {
          issues.push(issue('door-one-side', 'warning', fi, door,
            'Врата „' + labelOf(door, 'Врата') + '“ води само към едно помещение (задънена улица).'));
        }
        if (getWidth(door, 0.9) < 0.6) {
          issues.push(issue('door-narrow', 'warning', fi, door,
            'Врата „' + labelOf(door, 'Врата') + '“ е много тясна (' + getWidth(door, 0.9).toFixed(2) + ' м).'));
        }
      });

      exits.forEach(exit => {
        const dist = Math.min.apply(null, spaces.map(s => pointRectDistance(exit, rectOf(s))).concat([Infinity]));
        if (dist > EXIT_REACH) {
          issues.push(issue('exit-detached', 'error', fi, exit,
            'Изход „' + labelOf(exit, 'Изход') + '“ (' + floorLabel + ') не е близо до помещение или коридор.'));
        }
        if (getWidth(exit, 1.2) < 0.8) {
          issues.push(issue('exit-narrow', 'warning', fi, exit,
            'Изход „' + labelOf(exit, 'Изход') + '“ е тесен (' + getWidth(exit, 1.2).toFixed(2) + ' м) и ще създаде опашка.'));
        }
      });

      stairs.forEach(stair => {
        const dist = Math.min.apply(null, spaces.map(s => pointRectDistance(stair, rectOf(s))).concat([Infinity]));
        if (dist > STAIR_REACH) {
          issues.push(issue('stairs-detached', 'error', fi, stair,
            'Стълбище „' + labelOf(stair, 'Стълбище') + '“ (' + floorLabel + ') не е близо до помещение или коридор.'));
        }
      });

      groups.forEach(group => {
        const dist = Math.min.apply(null, spaces.map(s => pointRectDistance(group, rectOf(s))).concat([Infinity]));
        if (dist > PEOPLE_REACH) {
          issues.push(issue('people-detached', 'warning', fi, group,
            'Групата „' + labelOf(group, 'Хора') + '“ е далеч от помещение/коридор.'));
        }
      });

      hazards.forEach(hazard => {
        const nearest = spaces
          .map(s => ({ space: s, distance: pointRectDistance(hazard, rectOf(s)) }))
          .sort((a, b) => a.distance - b.distance)[0];
        if (!nearest || nearest.distance > SPREAD_REACH) {
          issues.push(issue('hazard-detached', 'warning', fi, hazard,
            'Опасната зона „' + labelOf(hazard, 'Опасна зона') + '“ е далеч от помещение — разпространението е неясно.'));
        } else if (hazard.spread !== false) {
          const rect = rectOf(nearest.space);
          const connects = doors.some(d => pointRectDistance(d, rect) <= DOOR_REACH) ||
            exits.some(e => pointRectDistance(e, rect) <= EXIT_REACH) ||
            stairs.some(s => pointRectDistance(s, rect) <= STAIR_REACH);
          if (!connects) {
            issues.push(issue('hazard-trapped', 'info', fi, hazard,
              'Разпространението от „' + labelOf(hazard, 'Опасна зона') + '“ ще остане само в едно помещение (няма врата/изход).'));
          }
        }
      });

      for (let i = 0; i < spaces.length; i++) {
        for (let j = i + 1; j < spaces.length; j++) {
          const a = rectOf(spaces[i]);
          const b = rectOf(spaces[j]);
          const overlap = overlapArea(a, b);
          if (overlap <= 4) continue;
          const smaller = Math.min(a.w * a.h, b.w * b.h);
          if (smaller > 0 && overlap / smaller > 0.3) {
            issues.push(issue('spaces-overlap', 'warning', fi, spaces[j],
              '„' + labelOf(spaces[i]) + '“ и „' + labelOf(spaces[j]) + '“ се застъпват значително.'));
          }
        }
      }
    });

    // Optionally verify actual path connectivity, not only geometric proximity.
    // The application supplies its current simulation graph; other callers can
    // keep using the validator without passing a model.
    if (opts.routeModel && scenario !== 'lockdown') {
      for (const group of opts.routeModel.groups || []) {
        if (group.peopleCount <= 0 || group.status !== 'no-route') continue;
        const floor = clamp(group.floor||0,0,floors.length-1);
        const item = floorItems(floors[floor]).find(it=>String(it.id)===String(group.refId))||null;
        issues.push(issue('people-no-route','error',floor,item,
          'Група „'+(group.label||'Хора')+'“ ('+group.peopleCount+' души) няма достъпен маршрут до безопасен изход.'));
      }
    }

    const totalPeople = peopleTotal;
    if (scenario !== 'lockdown') {
      if (!exitCount) issues.push(issue('no-exit', 'error', 0, null, 'Няма добавен авариен изход.'));
      if (!doorCount && spacesAny(floors)) {
        issues.push(issue('no-doors', 'warning', 0, null, 'Няма добавени врати — връзките между помещенията са само през застъпване.'));
      }
    }
    if (!totalPeople) issues.push(issue('no-people', 'warning', 0, null, 'Няма хора за евакуация.'));
    if (!hazardCount && scenario === 'fire') {
      issues.push(issue('no-hazard', 'info', 0, null, 'Няма опасна зона — сценарият е само евакуация.'));
    }
    if (!roomCount) issues.push(issue('no-rooms', 'error', 0, null, 'Няма помещения — има само коридори.'));

    return summarize(issues);
  }

  function spacesAny(floors) {
    return floors.some(floor => floorItems(floor).some(i => i.type === 'room' || i.type === 'corridor'));
  }

  const SEVERITY_WEIGHT = { error: 0, warning: 1, info: 2 };

  function summarize(issues) {
    issues.sort((a, b) => (SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity]) || (a.floor - b.floor));
    const counts = { error: 0, warning: 0, info: 0 };
    issues.forEach(i => { counts[i.severity] = (counts[i.severity] || 0) + 1; });
    return {
      version: VERSION,
      issues,
      counts,
      total: issues.length,
      ok: counts.error === 0,
      summaryText: counts.error + ' грешки · ' + counts.warning + ' предупреждения · ' + counts.info + ' бележки'
    };
  }

  return {
    VERSION,
    validate,
    pointRectDistance
  };
});
