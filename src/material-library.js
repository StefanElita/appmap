/* Advanced Build materials — illustrative multipliers, not certified engineering data. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EvacMaterials = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MATERIALS = Object.freeze({
    standard: { name:'Стандартна (неутрална)', color:'#31465f', fire:1, smoke:1, flood:1, walk:1, wet:1, quake:1, note:'Без промяна на вече съществуващата симулация.' },
    concrete: { name:'Бетон', color:'#7c92a4', fire:0.55, smoke:1, flood:0.95, walk:1, wet:0.95, quake:1, note:'Слабо влияние върху разпространението на огън.' },
    tile:     { name:'Плочки', color:'#a3c7ce', fire:0.72, smoke:1, flood:0.95, walk:1.03, wet:0.65, quake:1, note:'При наводнение движението е по-бавно (хлъзгаво).' },
    wood:     { name:'Дърво', color:'#bc8757', fire:1.3, smoke:1.08, flood:1.05, walk:1, wet:0.85, quake:0.95, note:'Опростено по-бързо разпространение на пожар.' },
    brick:    { name:'Тухла', color:'#b16c55', fire:0.62, smoke:0.98, flood:1.02, walk:1, wet:0.9, quake:0.95, note:'Учебен коефициент за тухлена повърхност; не е реален клас на огнеустойчивост.' },
    carpet:   { name:'Килим', color:'#985b8f', fire:1.45, smoke:1.15, flood:1.25, walk:0.92, wet:0.7, quake:0.9, note:'Пожарът и водата достигат зоната по-бързо.' },
    metal:    { name:'Метал', color:'#8da2b8', fire:0.8, smoke:1, flood:0.85, walk:1, wet:0.75, quake:0.95, note:'Ниско условно влияние върху огъня.' },
    rubber:   { name:'Гума', color:'#637884', fire:1.1, smoke:1.05, flood:0.9, walk:0.95, wet:0.9, quake:1, note:'Сцеплението остава по-добро при мокра настилка.' },
    grass:    { name:'Трева', color:'#4b9770', fire:1.3, smoke:1.05, flood:1.15, walk:0.86, wet:0.65, quake:0.95, note:'Външна повърхност с по-бавно движение.' },
    gravel:   { name:'Чакъл', color:'#a69d84', fire:0.7, smoke:1, flood:0.85, walk:0.72, wet:0.7, quake:0.85, note:'Бавна евакуация върху неравен терен.' }
  });
  const DEFAULT = 'standard';
  function get(id) { return MATERIALS[id] || MATERIALS[DEFAULT]; }
  function isKnown(id) { return Object.prototype.hasOwnProperty.call(MATERIALS, id); }
  function overlap(a, b) {
    return Math.max(0, Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)) *
      Math.max(0, Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  }
  function surfaceForSpace(space, surfaces) {
    let best = null, area = 0;
    for (const s of surfaces || []) {
      const a = overlap(space, s);
      if (a > area) { area = a; best = s; }
    }
    return best && area >= Math.max(100, space.w * space.h * .3) && isKnown(best.materialId)
      ? best.materialId : (isKnown(space.materialId) ? space.materialId : DEFAULT);
  }
  function speed(id, scenario) {
    const m = get(id);
    return m.walk * (scenario === 'flood' ? m.wet : scenario === 'quake' ? m.quake : 1);
  }
  function spread(id, scenario) {
    const m = get(id);
    return Math.max(.25, Math.min(2.5, scenario === 'fire' ? m.fire : scenario === 'flood' ? m.flood : m.smoke));
  }
  return { MATERIALS, DEFAULT, get, isKnown, overlap, surfaceForSpace, speed, spread };
});
