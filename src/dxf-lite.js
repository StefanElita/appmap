/* ASCII DXF 2D importer: LINE / LWPOLYLINE ONLY; geometry heuristics for demos. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DxfLite = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function entities(text) {
    if (typeof text !== 'string' || text.length > 12 * 1024 * 1024) throw new Error('DXF файлът е твърде голям (лимит 12 MB).');
    const lines = text.replace(/\r/g, '').split('\n');
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i].trim()), lines[i + 1].trim()]);
    const objects = [];
    let inEntities = false;
    let current = null;
    function push() { if (current) objects.push(current); current = null; }
    for (const [code, value] of pairs) {
      if (code === 0 && value === 'SECTION') { push(); inEntities = false; continue; }
      if (code === 2 && value === 'ENTITIES') { inEntities = true; continue; }
      if (code === 0 && value === 'ENDSEC') { push(); inEntities = false; continue; }
      if (!inEntities) continue;
      if (code === 0) { push(); if (value === 'LINE' || value === 'LWPOLYLINE') current = { type: value, pairs: [] }; }
      else if (current) current.pairs.push([code, value]);
    }
    push();
    const geometries = [];
    objects.forEach(obj => {
      if (obj.type === 'LINE') {
        const read = code => Number((obj.pairs.find(p => p[0] === code) || [null, NaN])[1]);
        const points = [{ x: read(10), y: read(20) }, { x: read(11), y: read(21) }];
        if (points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) geometries.push({ kind: 'line', points });
      } else {
        const pts = [];
        let flag = 0;
        obj.pairs.forEach(([code, raw]) => {
          if (code === 70) flag = Number(raw) || 0;
          if (code === 10) pts.push({ x: Number(raw), y: NaN });
          if (code === 20 && pts.length) pts[pts.length - 1].y = Number(raw);
        });
        const valid = pts.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (valid.length > 1) geometries.push({ kind: flag & 1 ? 'closed' : 'polyline', points: valid });
      }
    });
    return geometries;
  }
  function toPlan(text, options) {
    const geoms = entities(text);
    const points = geoms.flatMap(g => g.points);
    if (!points.length) throw new Error('DXF не съдържа поддържани 2D LINE/LWPOLYLINE елементи.');
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min(840 / Math.max(1, maxX - minX), 530 / Math.max(1, maxY - minY));
    const pos = p => ({ x: Math.round(30 + (p.x - minX) * scale), y: Math.round(560 - (p.y - minY) * scale) });
    const items = [];
    const maxItems = Math.max(1, Math.min(2000, Number(options && options.maxItems) || 600));
    const addWall = (a, b) => {
      if (items.length >= maxItems) return;
      const p = pos(a), q = pos(b);
      if (Math.hypot(p.x - q.x, p.y - q.y) < 3) return;
      items.push({ type: 'wall', x: p.x, y: p.y, x2: q.x, y2: q.y, thickness: 0.2, name: 'DXF стена' });
    };
    let rooms = 0;
    geoms.forEach(g => {
      const pts = g.points;
      if (g.kind === 'closed' && pts.length === 4 && items.length < maxItems) {
        const xx = [...new Set(pts.map(p => p.x.toFixed(6)))];
        const yy = [...new Set(pts.map(p => p.y.toFixed(6)))];
        if (xx.length === 2 && yy.length === 2) {
          const p = pts.map(pos);
          const x = Math.min(...p.map(v => v.x)), y = Math.min(...p.map(v => v.y));
          const w = Math.max(...p.map(v => v.x)) - x, h = Math.max(...p.map(v => v.y)) - y;
          if (w >= 12 && h >= 12) {
            items.push({ type: 'room', x, y, w, h, width: 1.2, people: 0, teachers: 0,
              name: 'DXF помещение ' + (++rooms), buildingId: 'A' });
            return;
          }
        }
      }
      for (let i = 1; i < pts.length; i++) addWall(pts[i - 1], pts[i]);
      if (g.kind === 'closed') addWall(pts[pts.length - 1], pts[0]);
    });
    return { items, rooms, walls: items.filter(i => i.type === 'wall').length, sourceEntities: geoms.length };
  }
  return { entities, toPlan };
});
