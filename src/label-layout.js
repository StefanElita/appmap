'use strict';

/* Automatic label decluttering for compact and photo-imported floor plans.
 * Geometry is in SVG plan units (900 x 590), not screen pixels, so export and
 * zoom use the same collision decisions. This module has no DOM dependency.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EvacLabelLayout = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const spaceTypes = new Set(['room', 'corridor', 'courtyard']);
  function widthEstimate(text, fontSize) {
    // Cyrillic glyphs are generally wider than short Latin labels.
    return Array.from(String(text == null ? '' : text)).reduce((sum, char) =>
      sum + (char === ' ' ? fontSize * .34 : /[.,:;\-]/.test(char) ? fontSize * .32 : fontSize * .57), 0);
  }
  function captionFor(item) {
    const width = Number(item.width) || 1.2;
    return item.type === 'room'
      ? (Number(item.people) || 0) + ' хора · ' + (Number(item.teachers) || 0) + ' уч. · ' + width.toFixed(1) + ' м'
      : item.type === 'courtyard' ? 'външна зона' : width.toFixed(1) + ' м ширина';
  }
  function collides(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }
  function analyze(items, opts) {
    const options = opts || {};
    const spaces = (items || []).filter(x => x && spaceTypes.has(x.type));
    const bounds = spaces.map(item => {
      const label = String(item.name || (item.type === 'room' ? 'Помещение' : 'Коридор'));
      const sub = captionFor(item);
      const labelW = Math.max(widthEstimate(label, 14), widthEstimate(sub, 11));
      return { x: (Number(item.x) || 0) + 12, y: (Number(item.y) || 0) + 6,
        w: labelW + 4, h: 42, room: item,
        overflow: labelW + 25 > (Number(item.w) || 0) || (Number(item.h) || 0) < 50 };
    });
    let overlappingLabels = 0;
    for (let i = 0; i < bounds.length; i++) {
      for (let j = i + 1; j < bounds.length; j++) {
        if (collides(bounds[i], bounds[j])) overlappingLabels++;
      }
    }
    const overflowingLabels = bounds.filter(b => b.overflow).length;
    // A single narrow room should not make a whole otherwise legible plan compact.
    // Two cramped spaces, any overlapping name, or a busy scanned backdrop do.
    const compact = Boolean(overlappingLabels > 0 || overflowingLabels >= 2 ||
      (options.hasBackdrop && spaces.length >= 8 && overflowingLabels > 0));
    return { compact, overlappingLabels, overflowingLabels, spaceCount: spaces.length };
  }
  return { analyze, captionFor, widthEstimate };
});
