/*
 * Evacuation Simulator v0.5.0 — building library
 * Процедурно генерирани учебни сгради за тестове и демонстрации.
 * Всяка сграда е съвместима с формата на проекта (.evac.json).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BuildingLibrary = Object.assign(root.BuildingLibrary || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '0.5.0';
  const SVG_W = 900;
  const SVG_H = 590;

  const PRESETS = [
    {
      id: 'school',
      title: 'Училище',
      description: 'Двуетажна учебна сграда с класни стаи от двете страни на коридор, 3+3 стаи на етаж.',
      floors: 2,
      roomsPerSide: 3,
      people: 24,
      teachers: 1,
      roomHeight: 170,
      roomPrefix: 'Класна стая',
      hazard: 'fire',
      doorWidth: 1.2
    },
    {
      id: 'office',
      title: 'Офис сграда',
      description: 'Триетажна офис сграда с 4+4 офиса на етаж и централно стълбище.',
      floors: 3,
      roomsPerSide: 4,
      people: 8,
      teachers: 0,
      roomHeight: 160,
      roomPrefix: 'Офис',
      hazard: 'fire',
      doorWidth: 1.0
    },
    {
      id: 'hotel',
      title: 'Хотел',
      description: 'Четириетажен хотел с 5+5 стаи на етаж — добър тест за вертикална евакуация.',
      floors: 4,
      roomsPerSide: 5,
      people: 2,
      teachers: 0,
      roomHeight: 160,
      roomPrefix: 'Стая',
      hazard: 'fire',
      doorWidth: 1.0
    },
    {
      id: 'hospital',
      title: 'Болница',
      description: 'Триетажна болница с по-малко хора в стая и широки коридори.',
      floors: 3,
      roomsPerSide: 4,
      people: 6,
      teachers: 0,
      roomHeight: 160,
      roomPrefix: 'Стая',
      hazard: 'flood',
      doorWidth: 1.2
    },
    {
      id: 'mall',
      title: 'Търговски център',
      description: 'Двуетажен обект с големи помещения и много хора — тест за тесни места.',
      floors: 2,
      roomsPerSide: 2,
      people: 40,
      teachers: 0,
      roomHeight: 170,
      roomPrefix: 'Магазин',
      hazard: 'fire',
      doorWidth: 1.6
    }
  ];

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clampInt(value, fallback, min, max) {
    const n = Math.round(num(value, fallback));
    return Math.max(min, Math.min(max, n));
  }

  function createRng(seed) {
    let state = (Number(seed) >>> 0) || 1;
    return function () {
      state += 0x6D2B79F5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function getPreset(id) {
    return PRESETS.find(p => p.id === id) || PRESETS[0];
  }

  function roomName(prefix, floorIndex, roomIndex) {
    const room = (floorIndex + 1) * 100 + roomIndex + 1;
    return prefix + ' ' + room;
  }

  function buildFloor(preset, floorIndex, options, rng, uid) {
    const roomsPerSide = options.roomsPerSide;
    const corridorX = 150;
    const corridorW = 600;
    const corridorY = 250;
    const corridorH = 90;
    const gap = 8;
    const cellW = corridorW / roomsPerSide;
    const roomH = options.roomHeight;
    const topBottom = corridorY - 10;
    const bottomTop = corridorY + corridorH + 10;
    const topY = topBottom - roomH;
    const bottomY = bottomTop;
    const doorWidth = preset.doorWidth || 1.2;
    const items = [];

    items.push({
      id: uid(),
      type: 'corridor',
      name: 'Коридор ' + (floorIndex + 1),
      x: corridorX, y: corridorY, w: corridorW, h: corridorH,
      width: 1.8
    });

    const rooms = [];
    for (let i = 0; i < roomsPerSide; i++) {
      const x = Math.round(corridorX + i * cellW + gap / 2);
      const w = Math.round(cellW - gap);
      const topName = roomName(preset.roomPrefix, floorIndex, i);
      const bottomName = roomName(preset.roomPrefix, floorIndex, roomsPerSide + i + 0);
      rooms.push({
        id: uid(),
        type: 'room',
        name: topName,
        x, y: Math.round(topY), w, h: roomH,
        people: options.people,
        teachers: options.teachers,
        width: 1.2
      });
      rooms.push({
        id: uid(),
        type: 'room',
        name: bottomName,
        x, y: Math.round(bottomY), w, h: roomH,
        people: options.people,
        teachers: options.teachers,
        width: 1.2
      });
      items.push(rooms[rooms.length - 2], rooms[rooms.length - 1]);
      items.push({
        id: uid(),
        type: 'door',
        name: 'Врата ' + topName,
        x: Math.round(x + w / 2), y: Math.round(corridorY - 5),
        width: doorWidth
      });
      items.push({
        id: uid(),
        type: 'door',
        name: 'Врата ' + bottomName,
        x: Math.round(x + w / 2), y: Math.round(corridorY + corridorH + 5),
        width: doorWidth
      });
    }

    items.push({
      id: uid(),
      type: 'exit',
      name: 'Изход ляв ' + (floorIndex + 1),
      x: corridorX + 14, y: Math.round(corridorY + corridorH / 2),
      width: 1.2
    });
    items.push({
      id: uid(),
      type: 'exit',
      name: 'Изход десен ' + (floorIndex + 1),
      x: corridorX + corridorW - 14, y: Math.round(corridorY + corridorH / 2),
      width: 1.2
    });
    items.push({
      id: uid(),
      type: 'stairs',
      name: 'Стълбище ' + (floorIndex + 1),
      x: Math.round(corridorX + corridorW / 2),
      y: Math.round(corridorY + corridorH / 2),
      width: 1.6
    });

    return { id: uid(), name: 'Етаж ' + (floorIndex + 1), items, rooms };
  }

  function generate(input) {
    const opts = input || {};
    const preset = getPreset(opts.preset);
    const seed = clampInt(opts.seed, 1, 1, 999999);
    const floorsCount = clampInt(opts.floors, preset.floors, 1, 6);
    const roomsPerSide = clampInt(opts.roomsPerSide, preset.roomsPerSide, 1, 5);
    const people = clampInt(opts.people, preset.people, 0, 200);
    const roomHeight = clampInt(opts.roomHeight, preset.roomHeight, 110, 170);
    const hazardType = opts.hazard == null ? preset.hazard : String(opts.hazard);
    const hazardEnabled = hazardType === 'fire' || hazardType === 'flood';
    const rng = createRng(seed * 7919 + preset.id.length * 131 + roomsPerSide * 17 + floorsCount * 29);
    let idSeq = 0;
    const uid = () => 'lib' + seed + '-' + (++idSeq);

    const options = { roomsPerSide, people, teachers: preset.teachers || 0, roomHeight };
    const floors = [];
    for (let fi = 0; fi < floorsCount; fi++) {
      const floor = buildFloor(preset, fi, options, rng, uid);
      floors.push(floor);
    }

    if (hazardEnabled) {
      const hazardFloor = floors[0];
      const rooms = hazardFloor.rooms;
      let target = rooms.find(r => num(r.people, 0) === 0) || null;
      if (!target) {
        target = rooms[Math.floor(rng() * rooms.length)] || null;
        if (target) {
          target.people = 0;
          target.teachers = 0;
          target.name = 'Склад (тест)';
        }
      }
      if (target) {
        const radiusPx = Math.round(Math.max(24, Math.min(target.w, target.h) * 0.22));
        hazardFloor.items.push({
          id: uid(),
          type: 'hazard',
          name: hazardType === 'flood' ? 'Наводнение (тест)' : 'Огнище (тест)',
          x: Math.round(target.x + target.w / 2),
          y: Math.round(target.y + target.h / 2),
          radius: radiusPx,
          spread: true,
          spreadSpeed: hazardType === 'flood' ? 0.55 : 0.4,
          maxRadius: 35
        });
      }
    }

    floors.forEach(floor => {
      delete floor.rooms;
      floor.backdrop = null;
    });

    const scenario = hazardType === 'flood' ? 'flood' : 'fire';
    const totalRoomCount = floors.length * roomsPerSide * 2;
    return {
      format: 'evacuation-simulator',
      version: VERSION,
      projectName: preset.title + ' · тест #' + seed,
      updatedAt: new Date().toISOString(),
      settings: {
        pxPerMeter: 25,
        floorHeight: 3.2,
        walkSpeed: 1.25,
        specificFlow: 1.3,
        preMovement: null,
        scenario,
        autosave: true,
        showRoutes: true,
        showGrid: true,
        snap: true,
        spreadSpeed: 0.4,
        showSpread: true
      },
      floors,
      attachments: [],
      meta: {
        generator: 'building-library',
        preset: preset.id,
        seed,
        rooms: totalRoomCount,
        peoplePerRoom: people
      }
    };
  }

  function describe(project) {
    const floors = (project && project.floors) || [];
    const summary = { floors: floors.length, rooms: 0, corridors: 0, doors: 0, exits: 0, stairs: 0, hazards: 0, people: 0 };
    floors.forEach(floor => {
      (floor.items || []).forEach(item => {
        if (!item) return;
        if (item.type === 'room') {
          summary.rooms += 1;
          summary.people += num(item.people, 0) + num(item.teachers, 0);
        } else if (item.type === 'corridor') summary.corridors += 1;
        else if (item.type === 'door') summary.doors += 1;
        else if (item.type === 'exit') summary.exits += 1;
        else if (item.type === 'stairs') summary.stairs += 1;
        else if (item.type === 'hazard') summary.hazards += 1;
        else if (item.type === 'people') summary.people += num(item.count, 0);
      });
    });
    return summary;
  }

  function summaryText(project) {
    const s = describe(project);
    return s.floors + ' етаж(а) · ' + s.rooms + ' помещения · ' + s.doors + ' врати · ' +
      s.exits + ' изхода · ' + s.stairs + ' стълбища' +
      (s.hazards ? ' · ' + s.hazards + ' опасна зона' : ' · без опасност') +
      ' · ' + s.people + ' души';
  }

  function randomSeed() {
    return Math.floor(Math.random() * 900000) + 100000;
  }

  return {
    VERSION,
    SVG_W,
    SVG_H,
    PRESETS,
    generate,
    describe,
    summaryText,
    randomSeed,
    getPreset
  };
});
