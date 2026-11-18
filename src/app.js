'use strict';

/* ============================================================
 * Evacuation Simulator v0.5.0 — UI / editor / simulation glue
 * ============================================================ */

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const SVG_W = 900;
const SVG_H = 590;
const APP_VERSION = '0.5.0';
const AUTOSAVE_KEY = 'evacuation-simulator:autosave:v3';
const desktop = window.evacuationDesktop || null;
const EvacSim = window.EvacSim || {};
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']);
const svg = $('floor');
const PDF_EXT = new Set(['pdf']);

let project = null;
let currentFloor = 0;
let selectedId = null;
let tool = 'select';
let draft = null;
let interaction = null;
let view = { x: 0, y: 0, w: SVG_W, h: SVG_H };
let previewModel = null;
let revision = 0;
let dirty = false;
let autosaveEnabled = true;
let lastAutosaveAt = null;
let saveTimer = null;
let editingSession = null;
let backdropEditSession = null;
let activeSim = null;
let simTimer = null;
let simPaused = false;
let simAccumulator = 0;
let lastSimState = null;
let lastSimReport = null;
let lastTableAt = 0;
let spaceDown = false;
let idCounter = 0;
let attachmentMeta = new Map();
let toastTimer = null;
let history = { past: [], future: [] };
let tourActive = false;
let tourIndex = 0;
let tourElement = null;
let libraryPresetId = 'school';

const palette = ['#42d3c5', '#639cff', '#f5bb57', '#8c7cff', '#43d49a', '#ff9f6e', '#d68cff', '#7ee0ff'];

function uid() {
  idCounter += 1;
  return Date.now() + idCounter + Math.random();
}
function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function sameId(a, b) { return String(a) === String(b); }
function nowIso() { return new Date().toISOString(); }
function timeNow() {
  return new Date().toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function basename(p) {
  return String(p || '').split(/[\\/]/).pop() || '';
}
function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}
function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
function showToast(text, isError) {
  const el = $('toast');
  if (!el) return;
  el.textContent = text;
  el.className = 'show' + (isError ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3600);
}
function addLog(text) {
  const log = $('log');
  if (!log) return;
  const line = '• ' + timeNow() + '  ' + String(text);
  log.textContent = line + '\n' + log.textContent;
  const lines = log.textContent.split('\n');
  if (lines.length > 120) log.textContent = lines.slice(0, 120).join('\n');
}
function setStatus(text) {
  const el = $('status');
  if (el) el.textContent = text;
}

/* ----------------------------- project ----------------------------- */

function emptyProject() {
  return {
    format: 'evacuation-simulator',
    version: APP_VERSION,
    projectName: 'Нов проект',
    updatedAt: nowIso(),
    settings: {
      pxPerMeter: 25,
      floorHeight: 3.2,
      walkSpeed: 1.25,
      specificFlow: 1.3,
      preMovement: null,
      scenario: 'fire',
      autosave: true,
      showRoutes: true,
      showGrid: true,
      snap: true,
      spreadSpeed: 0.4,
      showSpread: true
    },
    floors: [{ id: uid(), name: 'Етаж 1', items: [], backdrop: null }],
    attachments: []
  };
}

function sanitizeProject(raw) {
  if (!raw || raw.format !== 'evacuation-simulator' || !Array.isArray(raw.floors) || !raw.floors.length) {
    throw new Error('Невалиден файл на проект.');
  }
  const base = emptyProject();
  const settings = Object.assign({}, base.settings, raw.settings || {});
  settings.pxPerMeter = clamp(num(settings.pxPerMeter, 25), 2, 300);
  settings.floorHeight = clamp(num(settings.floorHeight, 3.2), 1, 20);
  settings.walkSpeed = clamp(num(settings.walkSpeed, 1.25), 0.2, 3);
  settings.specificFlow = clamp(num(settings.specificFlow, 1.3), 0.1, 5);
  settings.preMovement = settings.preMovement == null || settings.preMovement === '' ? null : Math.max(0, num(settings.preMovement, 0));
  settings.scenario = ['fire', 'quake', 'flood', 'lockdown'].includes(settings.scenario) ? settings.scenario : 'fire';
  settings.autosave = settings.autosave !== false;
  settings.showRoutes = settings.showRoutes !== false;
  settings.showGrid = settings.showGrid !== false;
  settings.snap = settings.snap !== false;
  settings.spreadSpeed = clamp(num(settings.spreadSpeed, 0.4), 0.02, 10);
  settings.showSpread = settings.showSpread !== false;

  const floors = raw.floors.map((floor, index) => {
    const items = (Array.isArray(floor && floor.items) ? floor.items : []).filter(Boolean).map(item => {
      const it = Object.assign({}, item);
      it.id = it.id == null ? uid() : it.id;
      it.type = it.type || 'room';
      it.x = num(it.x, 0);
      it.y = num(it.y, 0);
      if (it.type === 'room' || it.type === 'corridor') {
        it.w = Math.max(12, num(it.w, 80));
        it.h = Math.max(12, num(it.h, 60));
        it.width = clamp(num(it.width, 1.2), 0.2, 20);
        it.people = Math.max(0, Math.round(num(it.people, 0)));
        it.teachers = Math.max(0, Math.round(num(it.teachers, 0)));
        it.name = it.name || (it.type === 'room' ? 'Помещение' : 'Коридор');
      } else if (it.type === 'people') {
        it.count = Math.max(0, Math.round(num(it.count, 0)));
        it.name = it.name || 'Група';
      } else if (it.type === 'hazard') {
        it.radius = clamp(num(it.radius, 27), 6, 600);
        it.spread = it.spread !== false;
        if (it.spreadSpeed != null) it.spreadSpeed = clamp(num(it.spreadSpeed, 0.4), 0.02, 10);
        it.maxRadius = clamp(num(it.maxRadius, 30), 1, 500);
        it.name = it.name || 'Опасна зона';
      } else if (it.type === 'door' || it.type === 'exit' || it.type === 'stairs') {
        it.width = clamp(num(it.width, 1.2), 0.2, 10);
        it.name = it.name || (it.type === 'door' ? 'Врата' : it.type === 'exit' ? 'Изход' : 'Стълбище');
      }
      return it;
    });
    return {
      id: floor && floor.id != null ? floor.id : uid(),
      name: floor && floor.name || ('Етаж ' + (index + 1)),
      items,
      backdrop: floor && floor.backdrop && floor.backdrop.attachmentId ? Object.assign({}, floor.backdrop) : null
    };
  });

  const attachments = (Array.isArray(raw.attachments) ? raw.attachments : [])
    .filter(a => a && a.path)
    .map(a => ({
      id: a.id == null ? uid() : a.id,
      name: a.name || basename(a.path),
      path: a.path,
      ext: a.ext || extOf(a.path),
      size: num(a.size, 0),
      addedAt: a.addedAt || nowIso()
    }));
  if (raw.pdfReference && typeof raw.pdfReference === 'string' && !attachments.some(a => a.path === raw.pdfReference)) {
    attachments.push({
      id: uid(),
      name: basename(raw.pdfReference),
      path: raw.pdfReference,
      ext: 'pdf',
      size: 0,
      addedAt: nowIso()
    });
  }

  return {
    format: 'evacuation-simulator',
    version: APP_VERSION,
    projectName: raw.projectName || 'Зареден проект',
    updatedAt: raw.updatedAt || nowIso(),
    settings,
    floors,
    attachments
  };
}

function totalPeople() {
  const helper = EvacSim.helpers && EvacSim.helpers.itemPeople;
  return project.floors.reduce((sum, floor) =>
    sum + floor.items.reduce((s, item) => s + (helper ? helper(item) : (item.type === 'people' ? num(item.count, 0) : item.type === 'room' ? num(item.people, 0) + num(item.teachers, 0) : 0)), 0), 0);
}

function currentFloorData() {
  return project.floors[currentFloor] || project.floors[0];
}

function findItemById(id) {
  if (id == null) return null;
  for (const floor of project.floors) {
    const item = floor.items.find(x => sameId(x.id, id));
    if (item) return { floor, item };
  }
  return null;
}

function selectedItem() {
  const floor = currentFloorData();
  return floor ? floor.items.find(x => sameId(x.id, selectedId)) || null : null;
}

/* ----------------------------- history ----------------------------- */

function snapshotState() {
  return JSON.stringify({ project, currentFloor });
}

function pushHistorySnapshot(snapshot) {
  if (!snapshot) return;
  if (history.past.length && history.past[history.past.length - 1] === snapshot) return;
  history.past.push(snapshot);
  if (history.past.length > 60) history.past.shift();
  history.future.length = 0;
  updateHistoryButtons();
}

function pushHistory() {
  pushHistorySnapshot(snapshotState());
}

function updateHistoryButtons() {
  if ($('undo')) $('undo').disabled = !history.past.length;
  if ($('redo')) $('redo').disabled = !history.future.length;
}

function undo() {
  if (!history.past.length) return;
  stopSimulation(true);
  history.future.push(snapshotState());
  const snap = JSON.parse(history.past.pop());
  try {
    project = sanitizeProject(snap.project);
    currentFloor = clamp(num(snap.currentFloor, 0), 0, project.floors.length - 1);
  } catch (e) {
    showToast('Неуспешна отмяна: ' + e.message, true);
    return;
  }
  selectedId = null;
  previewModel = null;
  revision++;
  autosaveEnabled = project.settings.autosave !== false;
  dirty = true;
  afterProjectChanged();
  addLog('Отменено действие.');
  showToast('Отменено');
}

function redo() {
  if (!history.future.length) return;
  stopSimulation(true);
  history.past.push(snapshotState());
  const snap = JSON.parse(history.future.pop());
  try {
    project = sanitizeProject(snap.project);
    currentFloor = clamp(num(snap.currentFloor, 0), 0, project.floors.length - 1);
  } catch (e) {
    showToast('Неуспешно повторение: ' + e.message, true);
    return;
  }
  selectedId = null;
  previewModel = null;
  revision++;
  autosaveEnabled = project.settings.autosave !== false;
  dirty = true;
  afterProjectChanged();
  addLog('Повторено действие.');
  showToast('Повторено');
}

/* ----------------------------- autosave ----------------------------- */

function updateHeader() {
  if (!$('projectNameLabel')) return;
  $('projectNameLabel').textContent = project.projectName || 'Нов проект';
  $('dirtyPill').textContent = dirty ? '● Неозаписан' : '● Записан';
  $('dirtyPill').className = 'pill ' + (dirty ? 'warn' : 'ok');
  if (!autosaveEnabled) {
    $('autosavePill').textContent = 'Авто-запис: изкл.';
    $('autosavePill').className = 'pill';
  } else if (lastAutosaveAt) {
    $('autosavePill').textContent = 'Авто-запис: ' + lastAutosaveAt;
    $('autosavePill').className = 'pill ok';
  } else {
    $('autosavePill').textContent = 'Авто-запис: вкл.';
    $('autosavePill').className = 'pill ok';
  }
  $('scalePill').textContent = project.settings.pxPerMeter + ' px = 1 m';
  if ($('showRoutes')) $('showRoutes').checked = !!project.settings.showRoutes;
  if ($('showSpread')) $('showSpread').checked = project.settings.showSpread !== false;
}

function scheduleAutosave() {
  if (!autosaveEnabled) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeAutosave, 500);
}

function writeAutosave() {
  if (!autosaveEnabled) return;
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
      savedAt: nowIso(),
      project,
      currentFloor
    }));
    lastAutosaveAt = timeNow();
    updateHeader();
  } catch (e) {
    addLog('Авто-записът е неуспешен: ' + e.message);
  }
}

function restoreAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    project = sanitizeProject(data.project);
    currentFloor = clamp(num(data.currentFloor, 0), 0, project.floors.length - 1);
    autosaveEnabled = project.settings.autosave !== false;
    lastAutosaveAt = data.savedAt ? new Date(data.savedAt).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;
    dirty = true;
    return true;
  } catch (e) {
    return false;
  }
}

function clearAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
    lastAutosaveAt = null;
    updateHeader();
    updateAutosaveInfo();
    addLog('Авто-записът е изчистен.');
    showToast('Авто-записът е изчистен.');
  } catch (e) {
    showToast('Грешка: ' + e.message, true);
  }
}

function updateAutosaveInfo() {
  const el = $('autosaveInfo');
  if (!el) return;
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) {
      el.textContent = 'Няма запазен авто-запис.';
      return;
    }
    const data = JSON.parse(raw);
    const size = formatBytes(new Blob([raw]).size);
    el.textContent = 'Авто-запис от ' + new Date(data.savedAt).toLocaleString('bg-BG') + ' · ' + size + ' · ' + (data.project && data.project.projectName || 'проект');
  } catch (e) {
    el.textContent = 'Авто-записът не може да бъде прочетен.';
  }
}

/* ----------------------------- common UI ----------------------------- */

function markDirty() {
  revision++;
  previewModel = null;
  dirty = true;
  project.updatedAt = nowIso();
  updateHeader();
  scheduleAutosave();
}

function afterProjectChanged() {
  updateHeader();
  refreshFloorSelect();
  updateScenarioUI();
  renderObjectEditor();
  renderAttachments();
  renderWarnings();
  renderRouteTable();
  renderBottlenecks();
  updateSpreadPanel();
  updateBackdropPanel();
  updateHistoryButtons();
  draw();
  updateStats();
  scheduleAutosave();
}

function setTool(nextTool) {
  tool = nextTool;
  document.querySelectorAll('.tool').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
  const hints = {
    select: 'Избери обект, за да го преместиш. Плъзни за преместване; Alt + плъзгане — панорама.',
    room: 'Плъзни правоъгълник за помещение или щракни два пъти (начален и краен ъгъл).',
    corridor: 'Плъзни правоъгълник за коридор или щракни два пъти.',
    door: 'Щракни на границата между помещение и коридор, за да поставиш врата.',
    exit: 'Щракни върху външна стена/коридор за авариен изход.',
    stairs: 'Щракни върху коридор. Еднаквите позиции на различните етажи се свързват.',
    people: 'Щракни, за да поставиш група хора с въведените брой и име.',
    hazard: 'Щракни, за да маркираш опасна зона (пожар/вода).'
  };
  $('toolHint').textContent = hints[tool] || '';
  $('canvasNote').textContent = tool === 'select' ? 'РАБОТНА ЗОНА · ИЗБОР И ПРЕМЕСТВАНЕ' : 'РАБОТНА ЗОНА · ЩРАКНИ ЗА ДОБАВЯНЕ';
  svg.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  draft = null;
  draw();
}

function updateScenarioUI() {
  document.querySelectorAll('.scenario').forEach(el => el.classList.toggle('selected', el.dataset.scenario === project.settings.scenario));
  const labels = EvacSim.SCENARIO_LABELS || { fire: 'Пожар', quake: 'Земетресение', flood: 'Наводнение', lockdown: 'Заплаха / блокиране' };
  const defaults = EvacSim.DEFAULT_DELAYS || { fire: 30, quake: 15, flood: 20, lockdown: 0 };
  const def = defaults[project.settings.scenario] == null ? 0 : defaults[project.settings.scenario];
  const pre = $('preMovement');
  if (pre) {
    pre.value = project.settings.preMovement == null ? '' : project.settings.preMovement;
    pre.placeholder = 'автоматично (' + def + ' s)';
  }
  $('scenarioNote').textContent = labels[project.settings.scenario] + ': ' + def + ' s реакция по подразбиране.' +
    (project.settings.scenario === 'lockdown' ? ' Режимът завършва със защитно укриване.' : '');
}

function refreshFloorSelect() {
  const select = $('floorSelect');
  if (!select) return;
  const activeCounts = activeSim ? project.floors.map((_, fi) => activeSim.agents.filter(a => a.floor === fi && a.state !== 'safe' && a.state !== 'sheltered').length) : null;
  select.replaceChildren();
  project.floors.forEach((floor, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    const count = activeCounts ? ' · ' + activeCounts[index] : '';
    option.textContent = (floor.name || ('Етаж ' + (index + 1))) + count;
    select.append(option);
  });
  select.value = String(currentFloor);
  $('floorTitle').textContent = currentFloorData().name || ('Етаж ' + (currentFloor + 1));
}

/* ----------------------------- rendering ----------------------------- */

function svgEl(tag, attrs, text) {
  const el = document.createElementNS(NS, tag);
  if (attrs) {
    Object.entries(attrs).forEach(([key, value]) => {
      if (value == null) return;
      el.setAttribute(key, value);
    });
  }
  if (text != null) el.textContent = text;
  return el;
}

function applyView() {
  svg.setAttribute('viewBox', view.x + ' ' + view.y + ' ' + view.w + ' ' + view.h);
  const pct = Math.round((SVG_W / view.w) * 100);
  $('zoomFit').textContent = pct + '%';
}

function zoomAt(factor, point) {
  const p = point || { x: view.x + view.w / 2, y: view.y + view.h / 2 };
  const newW = clamp(view.w / factor, 120, 2200);
  const newH = newW * (SVG_H / SVG_W);
  const rx = (p.x - view.x) / view.w;
  const ry = (p.y - view.y) / view.h;
  view = {
    x: p.x - rx * newW,
    y: p.y - ry * newH,
    w: newW,
    h: newH
  };
  applyView();
  draw();
}

function fitView() {
  view = { x: 0, y: 0, w: SVG_W, h: SVG_H };
  applyView();
  draw();
}

function svgPoint(event) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}

function snapValue(value) {
  return project.settings.snap ? Math.round(value / 10) * 10 : value;
}

function clampPoint(point, rect) {
  if (rect) {
    return {
      x: clamp(point.x, 0, Math.max(0, SVG_W - rect.w)),
      y: clamp(point.y, 0, Math.max(0, SVG_H - rect.h))
    };
  }
  return { x: clamp(point.x, 0, SVG_W), y: clamp(point.y, 0, SVG_H) };
}

function draw() {
  if (!project) return;
  const floor = currentFloorData();
  if (!floor) return;
  $('floorTitle').textContent = floor.name || ('Етаж ' + (currentFloor + 1));
  $('gridRect').style.display = project.settings.showGrid ? '' : 'none';
  $('gridRect').setAttribute('width', SVG_W);
  $('gridRect').setAttribute('height', SVG_H);

  Array.from(svg.children).forEach(child => {
    if (child.tagName.toLowerCase() === 'defs' || child.id === 'gridRect') return;
    child.remove();
  });

  const backdropLayer = svgEl('g', { class: 'layer backdrop' });
  svg.append(backdropLayer);
  drawBackdrop(backdropLayer);

  const objectLayer = svgEl('g', { class: 'layer objects' });
  floor.items.forEach(item => {
    const node = createObjectNode(item);
    if (node) objectLayer.append(node);
  });
  svg.append(objectLayer);

  const spreadLayer = svgEl('g', { class: 'layer spread' });
  drawSpread(spreadLayer);
  svg.append(spreadLayer);

  const routeLayer = svgEl('g', { class: 'layer routes' });
  drawRoutes(routeLayer);
  svg.append(routeLayer);

  const agentLayer = svgEl('g', { class: 'layer agents' });
  drawAgents(agentLayer);
  svg.append(agentLayer);

  const draftLayer = svgEl('g', { class: 'layer draft' });
  drawDraft(draftLayer);
  svg.append(draftLayer);

  const handleLayer = svgEl('g', { class: 'layer handles' });
  drawHandles(handleLayer);
  svg.append(handleLayer);

  drawScaleBar();
  $('objectCount').textContent = floor.items.length + ' обекта';
  updateCoordsText(null);
}

function createObjectNode(item) {
  const g = svgEl('g', {
    class: 'object' + (sameId(item.id, selectedId) ? ' selected' : ''),
    'data-id': item.id,
    'data-type': item.type
  });
  if (item.type === 'room' || item.type === 'corridor') {
    const rect = svgEl('rect', {
      x: item.x, y: item.y, width: item.w, height: item.h, rx: 8,
      fill: item.type === 'room' ? '#24364d' : '#1c4050',
      stroke: item.type === 'room' ? '#58718f' : '#3f7a8c',
      'stroke-width': 2
    });
    g.append(rect);
    g.append(svgEl('text', {
      x: item.x + 12, y: item.y + 23, fill: '#dce8f8', 'font-size': 14, 'font-weight': 600
    }, item.name || (item.type === 'room' ? 'Помещение' : 'Коридор')));
    const sub = item.type === 'room'
      ? (num(item.people, 0) + ' хора · ' + num(item.teachers, 0) + ' уч. · ' + num(item.width, 1.2) + ' м')
      : (num(item.width, 1.2) + ' м ширина');
    g.append(svgEl('text', {
      x: item.x + 12, y: item.y + 41, fill: '#91a4bf', 'font-size': 11
    }, sub));
  } else if (item.type === 'people') {
    g.append(svgEl('circle', {
      cx: item.x, cy: item.y, r: 10, fill: '#639cff', stroke: '#bcd3ff', 'stroke-width': 1.5
    }));
    g.append(svgEl('text', {
      x: item.x + 14, y: item.y + 4, fill: '#cfe0f6', 'font-size': 12
    }, (num(item.count, 0) + ' души')));
  } else if (item.type === 'hazard') {
    const radius = Math.max(6, num(item.radius, 27));
    g.append(svgEl('circle', {
      cx: item.x, cy: item.y, r: radius, fill: '#ff657a33', stroke: '#ff657a',
      'stroke-width': 2, 'stroke-dasharray': '5 4'
    }));
    g.append(svgEl('text', {
      x: item.x - 5, y: item.y + 6, fill: '#ff9aa8', 'font-size': 19, 'font-weight': 800
    }, '!'));
    g.append(svgEl('text', {
      x: item.x + radius + 6, y: item.y + 4, fill: '#ff9aa8', 'font-size': 11
    }, (item.name || 'Опасна зона') + ' · ' + (radius / (project.settings.pxPerMeter || 25)).toFixed(1) + ' м'));
  } else {
    let icon = '▱';
    let color = '#f5bb57';
    if (item.type === 'exit') { icon = '⇧'; color = '#42d3c5'; }
    if (item.type === 'stairs') { icon = '▤'; color = '#8c7cff'; }
    const radius = pointSizeRadius(item);
    g.append(svgEl('circle', {
      cx: item.x, cy: item.y, r: radius, fill: color + '22', stroke: color, 'stroke-width': 2
    }));
    g.append(svgEl('text', {
      x: item.x, y: item.y + 1, fill: color, 'font-size': Math.round(clamp(radius * 1.15, 13, 26)),
      'font-weight': 800, 'text-anchor': 'middle', 'dominant-baseline': 'middle'
    }, icon));
    g.append(svgEl('text', {
      x: item.x + radius + 5, y: item.y + 4, fill: '#b8c8dc', 'font-size': 11
    }, (item.name || (item.type === 'door' ? 'Врата' : item.type === 'exit' ? 'Изход' : 'Стълбище')) + ' · ' + num(item.width, 1.2).toFixed(1) + ' м'));
  }
  return g;
}

function pointSizeRadius(item) {
  if (!item) return 13;
  if (item.type === 'hazard') return Math.max(6, num(item.radius, 27));
  const base = item.type === 'exit' ? 9 : item.type === 'stairs' ? 10 : 8;
  return clamp(base + clamp(num(item.width, 1.2), 0.2, 10) * 4.5, 10, 55);
}

function pointWidthFromRadius(item, radius) {
  const base = item.type === 'exit' ? 9 : item.type === 'stairs' ? 10 : 8;
  return clamp((radius - base) / 4.5, 0.2, 10);
}


function drawHandles(layer) {
  const item = selectedItem();
  if (!item) return;
  if (item.type === 'door' || item.type === 'exit' || item.type === 'stairs' || item.type === 'hazard') {
    const radius = pointSizeRadius(item);
    layer.append(svgEl('circle', {
      class: 'handle size-handle', 'data-handle': 'size',
      cx: item.x + radius + 8, cy: item.y, r: 5.5
    }));
    layer.append(svgEl('line', {
      x1: item.x + radius, y1: item.y, x2: item.x + radius + 5, y2: item.y,
      stroke: '#42d3c5', 'stroke-width': 1, 'stroke-dasharray': '2 2'
    }));
    return;
  }
  if (item.type !== 'room' && item.type !== 'corridor') return;
  const handles = [
    ['nw', item.x, item.y], ['ne', item.x + item.w, item.y],
    ['sw', item.x, item.y + item.h], ['se', item.x + item.w, item.y + item.h]
  ];
  handles.forEach(([name, x, y]) => {
    layer.append(svgEl('rect', {
      class: 'handle', 'data-handle': name,
      x: x - 5, y: y - 5, width: 10, height: 10, rx: 2
    }));
  });
}

function drawDraft(layer) {
  if (!draft) return;
  const x = Math.min(draft.startX, draft.currentX);
  const y = Math.min(draft.startY, draft.currentY);
  const w = Math.abs(draft.currentX - draft.startX);
  const h = Math.abs(draft.currentY - draft.startY);
  layer.append(svgEl('rect', {
    class: 'draft', x, y, width: Math.max(1, w), height: Math.max(1, h), rx: 6
  }));
  if (w > 20 && h > 20) {
    layer.append(svgEl('text', {
      x: x + 6, y: y - 6, fill: '#42d3c5', 'font-size': 11
    }, Math.round(w / project.settings.pxPerMeter * 10) / 10 + ' × ' + Math.round(h / project.settings.pxPerMeter * 10) / 10 + ' м'));
  }
}

function drawScaleBar() {
  const pxPerMeter = project.settings.pxPerMeter || 25;
  const meters = pxPerMeter * 5 <= 260 ? 5 : 2;
  const length = meters * pxPerMeter;
  const x = 20;
  const y = SVG_H - 25;
  const g = svgEl('g', { class: 'scalebar' });
  g.append(svgEl('line', { x1: x, y1: y, x2: x + length, y2: y, stroke: '#8ba0bc', 'stroke-width': 2 }));
  g.append(svgEl('line', { x1: x, y1: y - 5, x2: x, y2: y + 5, stroke: '#8ba0bc', 'stroke-width': 2 }));
  g.append(svgEl('line', { x1: x + length, y1: y - 5, x2: x + length, y2: y + 5, stroke: '#8ba0bc', 'stroke-width': 2 }));
  g.append(svgEl('text', { x: x, y: y - 8, fill: '#8ba0bc', 'font-size': 10 }, meters + ' m'));
  g.append(svgEl('text', { x: x + length - 55, y: y - 8, fill: '#6f839e', 'font-size': 9 }, pxPerMeter + ' px/m'));
  svg.append(g);
}

function clearSpreadClips() {
  const defs = svg.querySelector('defs');
  if (defs) defs.querySelectorAll('[data-spread-clip]').forEach(el => el.remove());
}

function spreadClipUrl(defs, id, rects) {
  if (!defs || !rects.length) return null;
  const clip = svgEl('clipPath', { id, 'data-spread-clip': '1' });
  rects.forEach(r => clip.append(svgEl('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 8 })));
  defs.append(clip);
  return 'url(#' + id + ')';
}

function spreadRectsAt(model, meta, seconds) {
  const floorInfo = model && model.floors ? model.floors[meta.floor] : null;
  if (!floorInfo || !floorInfo.spaces) return [];
  const times = new Map();
  (meta.arrivals || []).forEach(a => {
    if (times.get(a.nodeId) == null || a.time < times.get(a.nodeId)) times.set(a.nodeId, a.time);
  });
  return floorInfo.spaces
    .filter(s => {
      const t = times.get(s.node.id);
      return t != null && t <= seconds + 0.001;
    })
    .map(s => s.rect);
}

function drawSpread(layer) {
  clearSpreadClips();
  if (!project.settings.showSpread) return;
  const scenario = project.settings.scenario;
  if (scenario !== 'fire' && scenario !== 'flood') return;
  const model = activeSim ? activeSim.model : (previewModel || getPreviewModel());
  const floorInfo = model && model.floors ? model.floors[currentFloor] : null;
  const hazards = (floorInfo && floorInfo.hazards) || [];
  const spreadInfo = (model && model.hazardSpread) || [];
  if (!hazards.length || !spreadInfo.length) return;
  const defs = svg.querySelector('defs');
  const pxPerMeter = model.pxPerMeter || project.settings.pxPerMeter || 25;
  const time = lastSimState ? lastSimState.time : 0;
  const color = scenario === 'flood' ? '#63b3ff' : '#ff7a45';
  const live = (lastSimState && lastSimState.spread) || [];
  let clipSeq = 0;
  hazards.forEach(h => {
    const meta = spreadInfo.find(s => sameId(s.refId, h.item.id));
    if (!meta) return;
    const liveEntry = live.find(s => sameId(s.refId, h.item.id));
    const maxPx = h.radius + meta.maxRadius * pxPerMeter;
    const radius = liveEntry ? Math.max(h.radius, liveEntry.radiusPx) : h.radius;
    const reachedRects = spreadRectsAt(model, meta, time);
    const reachedClip = spreadClipUrl(defs, 'spreadClip' + (clipSeq++), reachedRects);
    reachedRects.forEach(r => {
      layer.append(svgEl('rect', {
        x: r.x, y: r.y, width: r.w, height: r.h, rx: 8,
        fill: color, 'fill-opacity': 0.06, stroke: color, 'stroke-opacity': 0.3,
        'stroke-width': 1, 'stroke-dasharray': '3 5'
      }));
    });
    if (radius > h.radius + 2) {
      layer.append(svgEl('circle', {
        cx: h.x, cy: h.y, r: radius, 'clip-path': reachedClip,
        fill: color + '22', stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': '5 5'
      }));
      layer.append(svgEl('text', {
        x: h.x, y: h.y - radius - 7, fill: color, 'font-size': 10, 'text-anchor': 'middle',
        'font-weight': 700
      }, 'обхват ' + (radius / pxPerMeter).toFixed(1) + ' м'));
    }
    [30, 60, 120].forEach(dt => {
      const forecast = Math.min(maxPx, h.radius + meta.speed * (time + dt) * pxPerMeter);
      if (forecast <= h.radius + 6) return;
      const forecastClip = spreadClipUrl(defs, 'spreadClip' + (clipSeq++), spreadRectsAt(model, meta, time + dt));
      layer.append(svgEl('circle', {
        cx: h.x, cy: h.y, r: forecast, 'clip-path': forecastClip,
        fill: 'none', stroke: color, 'stroke-width': 1, 'stroke-dasharray': '2 8', opacity: 0.55
      }));
      layer.append(svgEl('text', {
        x: h.x + 6, y: h.y - forecast - 4, fill: color, 'font-size': 9, opacity: 0.85
      }, '+' + dt + ' s'));
    });
  });
}

function drawRoutes(layer) {
  if (!project.settings.showRoutes) return;
  const model = activeSim ? activeSim.model : getPreviewModel();
  if (!model || !model.groups) return;
  model.groups.forEach((group, index) => {
    if (group.status === 'no-route' && group.floor === currentFloor) {
      const source = model.nodes.get(group.nodeId);
      if (source) {
        layer.append(svgEl('circle', {
          cx: source.x, cy: source.y, r: 15, fill: 'none', stroke: '#ff657a',
          'stroke-width': 2, 'stroke-dasharray': '4 3'
        }));
      }
      return;
    }
    if (!group.route || !group.route.steps || !group.route.steps.length) return;
    const color = sameId(group.refId, selectedId) ? palette[0] : palette[index % palette.length];
    const opacity = sameId(group.refId, selectedId) ? 0.95 : 0.34;
    const width = sameId(group.refId, selectedId) ? 2.6 : 1.5;
    const polylines = [];
    let current = [];
    group.route.steps.forEach(step => {
      const a = model.nodes.get(step.from);
      const b = model.nodes.get(step.to);
      if (!a || !b) return;
      const aHere = a.floor === currentFloor;
      const bHere = b.floor === currentFloor;
      if (aHere && bHere) {
        if (!current.length) current.push([a.x, a.y]);
        current.push([b.x, b.y]);
      } else if (aHere && !bHere) {
        if (!current.length) current.push([a.x, a.y]);
        current.push([a.x, a.y]);
        polylines.push(current);
        current = [];
      } else if (!aHere && bHere) {
        current = [[b.x, b.y]];
      }
    });
    if (current.length > 1) polylines.push(current);
    polylines.forEach(points => {
      layer.append(svgEl('polyline', {
        class: 'route',
        points: points.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '),
        stroke: color,
        'stroke-width': width,
        'stroke-dasharray': sameId(group.refId, selectedId) ? '0' : '7 6',
        opacity
      }));
    });
  });
}

function drawAgents(layer) {
  if (!activeSim) return;
  const agents = activeSim.agents.filter(a => a.floor === currentFloor);
  const step = Math.max(1, Math.ceil(agents.length / 500));
  for (let i = 0; i < agents.length; i += step) {
    const agent = agents[i];
    let color = '#b8d7ff';
    let radius = 4;
    if (agent.state === 'queued') { color = '#f5bb57'; radius = 5; }
    else if (agent.state === 'waiting') { color = '#91a4bf'; radius = 3; }
    else if (agent.state === 'sheltering') { color = '#8c7cff'; radius = 4; }
    else if (agent.state === 'sheltered') { color = '#8c7cff'; radius = 3.5; }
    else if (agent.state === 'safe') { color = '#43d49a'; radius = 3.5; }
    else if (agent.state === 'no-route') { color = '#ff657a'; radius = 4; }
    let x = agent.x;
    let y = agent.y;
    if (agent.state === 'safe' || agent.state === 'sheltered') {
      const angle = agent.id * 2.39996;
      const radiusOffset = 5 + (agent.id % 9);
      x += Math.cos(angle) * radiusOffset;
      y += Math.sin(angle) * radiusOffset;
    }
    layer.append(svgEl('circle', {
      class: 'agent', cx: x, cy: y, r: radius, fill: color, opacity: 0.9
    }));
  }
}

function updateCoordsText(point) {
  const el = $('coords');
  if (!el) return;
  if (!point) {
    el.textContent = 'x: — · y: —';
    return;
  }
  el.textContent = 'x: ' + Math.round(point.x) + ' · y: ' + Math.round(point.y) + ' · ' + project.settings.pxPerMeter + ' px/m';
}

function getPreviewModel() {
  if (!previewModel) {
    previewModel = EvacSim.buildModel(project);
    if (previewModel && previewModel.mutated) {
      scheduleAutosave();
      refreshFloorSelect();
    }
  }
  return previewModel;
}

/* ----------------------------- stats / reports ----------------------------- */

function updateStats() {
  const state = activeSim ? (lastSimState || activeSim.snapshot()) : null;
  const total = state ? state.total : totalPeople();
  const safe = state ? state.safe + state.sheltered : 0;
  const queued = state ? state.counts.queued : 0;
  const progress = state ? state.progress : 0;
  $('sPeople').textContent = total;
  $('sSafe').textContent = safe;
  $('sQueued').textContent = queued;
  $('sTime').textContent = EvacSim.formatTime ? EvacSim.formatTime(state ? state.time : 0) : ((state ? state.time : 0).toFixed(1) + ' s');
  $('sProgress').textContent = Math.round(progress * 100) + '%';
  $('bar').style.width = (progress * 100).toFixed(1) + '%';
}

function renderWarnings() {
  const list = $('warningsList');
  if (!list) return;
  const model = activeSim ? activeSim.model : getPreviewModel();
  const warnings = (model && model.warnings) || [];
  list.replaceChildren();
  if (!warnings.length) {
    const li = document.createElement('li');
    li.className = 'okline';
    li.textContent = 'Няма забележки.';
    list.append(li);
    return;
  }
  warnings.slice(0, 16).forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    list.append(li);
  });
}

function renderRouteTable() {
  const box = $('routeTable');
  if (!box) return;
  const model = activeSim ? activeSim.model : getPreviewModel();
  const groups = model && model.groups || [];
  if (!groups.length) {
    box.innerHTML = '<p class="note">Добави хора, за да се изчислят маршрути.</p>';
    return;
  }
  const state = lastSimState;
  const table = document.createElement('table');
  table.className = 'route-table';
  const head = document.createElement('tr');
  ['Група', 'Хора', 'Изход', 'Време', 'Статус'].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    head.append(th);
  });
  table.append(head);
  const statsByGroup = new Map((state && state.groupStats || []).map(g => [g.id, g]));
  groups.slice(0, 30).forEach(group => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.title = 'Избери групата на плана';
    tr.addEventListener('click', () => selectGroup(group));
    const est = group.estimatedTime != null ? EvacSim.formatTime(group.estimatedTime) : '—';
    const live = statsByGroup.get(group.id);
    let badge = '<span class="badge ok">маршрут</span>';
    if (group.status === 'no-route') badge = '<span class="badge bad">без маршрут</span>';
    else if (group.status === 'shelter') badge = '<span class="badge">укриване</span>';
    else if (live && live.status === 'done') badge = '<span class="badge done">готово</span>';
    else if (live && live.status === 'active') badge = '<span class="badge live">' + (live.evacuated + live.sheltered) + '/' + live.people + '</span>';
    const cells = [
      group.label,
      String(group.peopleCount),
      group.route ? (model.nodes.get(group.route.exitId) || {}).label || 'изход' : '—',
      est,
      badge
    ];
    cells.forEach((value, i) => {
      const td = document.createElement('td');
      if (i === 4) td.innerHTML = value;
      else td.textContent = value;
      tr.append(td);
    });
    table.append(tr);
  });
  box.replaceChildren(table);
}

function selectGroup(group) {
  if (!group) return;
  currentFloor = clamp(group.floor, 0, project.floors.length - 1);
  selectedId = group.refId;
  refreshFloorSelect();
  renderObjectEditor();
  draw();
}

function updateSpreadPanel() {
  const box = $('spreadPanel');
  if (!box) return;
  const scenario = project.settings.scenario;
  if (scenario !== 'fire' && scenario !== 'flood') {
    box.replaceChildren();
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'Проследяването на разпространението е активно при сценарии „Пожар“ и „Наводнение“.';
    box.append(p);
    return;
  }
  const model = activeSim ? activeSim.model : getPreviewModel();
  const spreads = (model && model.hazardSpread) || [];
  box.replaceChildren();
  if (!spreads.length) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'Няма опасни зони с разпространение. Добави опасна зона (H) и задай скорост/обхват.';
    box.append(p);
    return;
  }
  const pxPerMeter = model.pxPerMeter || project.settings.pxPerMeter || 25;
  const time = lastSimState ? lastSimState.time : 0;
  const fmt = EvacSim.formatTime || (s => Math.round(s) + ' s');
  spreads.forEach(h => {
    const block = document.createElement('div');
    block.className = 'spread-block';
    const head = document.createElement('div');
    head.className = 'spread-head';
    head.textContent = h.label + ' · ет. ' + (h.floor + 1);
    block.append(head);
    const liveEntry = lastSimState && lastSimState.spread ? lastSimState.spread.find(s => sameId(s.refId, h.refId)) : null;
    const radiusPx = liveEntry ? liveEntry.radiusPx : h.baseRadius;
    const meta = document.createElement('div');
    meta.className = 'note';
    meta.textContent = 'Скорост ' + h.speed.toFixed(2) + ' м/с · обхват ' + (radiusPx / pxPerMeter).toFixed(1) + ' м от макс. ' + h.maxRadius + ' м' + (lastSimState ? ' · ' + fmt(time) : '');
    block.append(meta);
    if (h.totalSpaces) {
      const reach = document.createElement('div');
      reach.className = 'note';
      reach.textContent = 'През врати/изходи: ' + h.reachableSpaces + ' от ' + h.totalSpaces + ' помещения/коридори' +
        (h.blockedSpaces ? ' · ' + h.blockedSpaces + ' извън обхвата или зад стени' : '');
      block.append(reach);
    }
    const targets = h.arrivals.filter(a => a.time > 0.05 && (a.kind === 'space' || a.kind === 'exit' || a.kind === 'stairs'));
    if (!targets.length) {
      const none = document.createElement('p');
      none.className = 'note';
      none.textContent = 'Няма достижими помещения/изходи в зададения обхват.';
      block.append(none);
    } else {
      const list = document.createElement('ul');
      list.className = 'spread-list';
      targets.slice(0, 7).forEach(a => {
        const li = document.createElement('li');
        const reached = a.time <= time;
        li.className = (reached ? 'reached' : '') + (a.kind === 'exit' ? ' exit' : '');
        const name = document.createElement('span');
        name.textContent = (a.kind === 'exit' ? '⇧ ' : a.kind === 'stairs' ? '▤ ' : '') + a.label;
        const eta = document.createElement('em');
        eta.textContent = reached ? 'достигнато' : 'след ~' + Math.max(1, Math.ceil(a.time - time)) + ' s';
        li.append(name, eta);
        list.append(li);
      });
      block.append(list);
      if (targets.length > 7) {
        const more = document.createElement('div');
        more.className = 'note';
        more.textContent = '+ още ' + (targets.length - 7) + ' обекта в обхвата';
        block.append(more);
      }
    }
    box.append(block);
  });
  if (lastSimState && lastSimState.inHazard > 0) {
    const alert = document.createElement('div');
    alert.className = 'spread-alert';
    alert.textContent = '⚠ В обхвата на опасността: ' + lastSimState.inHazard + ' души (текущ кадър).';
    box.append(alert);
  }
  const foot = document.createElement('p');
  foot.className = 'note';
  foot.textContent = 'Опасността се движи само през врати, изходи и стълбища — стените я спират. Прогнозата е приблизителна; маршрутите не се преизчисляват автоматично.';
  box.append(foot);
}

function renderBottlenecks() {
  const box = $('bottleneckBox');
  if (!box) return;
  const state = lastSimState;
  if (!state || !state.bottlenecks || !state.bottlenecks.length) {
    box.innerHTML = '<p class="note">Няма данни за опашки. Стартирай симулация.</p>';
    return;
  }
  const title = document.createElement('div');
  title.className = 'note';
  title.innerHTML = '<strong>Най-натоварени точки</strong>';
  box.replaceChildren(title);
  state.bottlenecks.slice(0, 4).forEach(b => {
    const row = document.createElement('div');
    row.className = 'note';
    row.style.margin = '4px 0';
    row.textContent = '• ' + b.label + ' — опашка до ' + b.maxQueue + ', ' + b.capacity.toFixed(2) + ' д/с';
    box.append(row);
  });
}

function renderSimFloorInfo() {
  const el = $('simFloorInfo');
  if (!el) return;
  if (!activeSim) {
    el.textContent = 'Показва се етажът, който редактираш.';
    return;
  }
  const counts = project.floors.map((_, fi) => activeSim.agents.filter(a => a.floor === fi && a.state !== 'safe' && a.state !== 'sheltered' && a.state !== 'no-route').length);
  const totalActive = counts.reduce((s, n) => s + n, 0);
  el.textContent = 'На етаж ' + (currentFloor + 1) + ': ' + counts[currentFloor] + ' активни · в сградата: ' + totalActive + ' · в безопасност: ' + ((lastSimState && lastSimState.safe + lastSimState.sheltered) || 0);
}

function refreshAnalysis() {
  renderWarnings();
  renderRouteTable();
  renderBottlenecks();
  updateSpreadPanel();
}

/* ----------------------------- object editor ----------------------------- */

const TYPE_LABELS = {
  room: 'Помещение',
  corridor: 'Коридор',
  door: 'Врата',
  exit: 'Авариен изход',
  stairs: 'Стълбище',
  people: 'Група хора',
  hazard: 'Опасна зона'
};

function beginEditSession() {
  if (!editingSession) editingSession = { snapshot: snapshotState(), committed: false };
}

function commitEditSession() {
  if (editingSession && editingSession.committed) {
    addLog('Редактиран обект.');
    scheduleAutosave();
    refreshAnalysis();
  }
  editingSession = null;
}

function updateSelectionButtons() {
  const has = !!selectedItem();
  if ($('duplicateSelected')) $('duplicateSelected').disabled = !has;
  if ($('deleteSelected')) $('deleteSelected').disabled = !has;
}

function addField(parent, label, value, options, onInput) {
  const opts = options || {};
  const wrap = document.createElement('div');
  if (opts.full) wrap.className = 'full';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  wrap.append(labelEl);
  const input = document.createElement('input');
  input.type = opts.type || 'text';
  if (opts.min != null) input.min = opts.min;
  if (opts.max != null) input.max = opts.max;
  if (opts.step != null) input.step = opts.step;
  if (opts.placeholder != null) input.placeholder = opts.placeholder;
  input.value = value == null ? '' : value;
  input.addEventListener('focus', beginEditSession);
  input.addEventListener('input', () => {
    if (editingSession && !editingSession.committed) {
      pushHistorySnapshot(editingSession.snapshot);
      editingSession.committed = true;
    }
    onInput(input.value, input);
    markDirty();
    draw();
    updateStats();
  });
  input.addEventListener('blur', commitEditSession);
  wrap.append(input);
  parent.append(wrap);
  return input;
}

function addRange(parent, label, value, min, max, step, format, onInput) {
  const wrap = document.createElement('div');
  wrap.className = 'full';
  const labelEl = document.createElement('label');
  labelEl.textContent = label + ' ';
  const out = document.createElement('span');
  out.className = 'range-value';
  out.textContent = format(value);
  labelEl.append(out);
  wrap.append(labelEl);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  input.addEventListener('focus', beginEditSession);
  input.addEventListener('input', () => {
    if (editingSession && !editingSession.committed) {
      pushHistorySnapshot(editingSession.snapshot);
      editingSession.committed = true;
    }
    const v = clamp(num(input.value, value), min, max);
    out.textContent = format(v);
    onInput(v, input);
    markDirty();
    draw();
    updateStats();
  });
  input.addEventListener('blur', commitEditSession);
  wrap.append(input);
  parent.append(wrap);
  return input;
}

function addCheckbox(parent, label, checked, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'inline full';
  wrap.style.marginTop = '8px';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!checked;
  input.addEventListener('change', () => {
    pushHistory();
    onChange(input.checked);
    markDirty();
    draw();
    updateStats();
    refreshAnalysis();
  });
  wrap.append(input, document.createTextNode(' ' + label));
  parent.append(wrap);
  return input;
}

function renderObjectEditor() {
  const box = $('objectEditor');
  if (!box) return;
  const item = selectedItem();
  updateSelectionButtons();
  box.replaceChildren();
  if (!item) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'Няма избран обект. Щракни върху обект от плана.';
    box.append(p);
    return;
  }
  const head = document.createElement('p');
  head.className = 'note';
  head.style.margin = '0 0 4px';
  head.innerHTML = '<strong>' + escapeHtml(TYPE_LABELS[item.type] || item.type) + '</strong> · ID ' + escapeHtml(item.id);
  box.append(head);
  const grid = document.createElement('div');
  grid.className = 'field-grid';
  box.append(grid);
  const pxPerMeter = project.settings.pxPerMeter || 25;

  if (item.type === 'room' || item.type === 'corridor') {
    addField(grid, 'Име', item.name || '', { full: true }, value => { item.name = value; });
    if (item.type === 'room') {
      addField(grid, 'Хора', item.people || 0, { type: 'number', min: 0, step: 1 }, value => { item.people = Math.max(0, Math.round(num(value, 0))); });
      addField(grid, 'Учители', item.teachers || 0, { type: 'number', min: 0, step: 1 }, value => { item.teachers = Math.max(0, Math.round(num(value, 0))); });
    }
    addField(grid, 'Ширина (м)', item.width || 1.2, { type: 'number', min: 0.2, max: 20, step: 0.1 }, value => { item.width = clamp(num(value, 1.2), 0.2, 20); });
    addField(grid, 'X', Math.round(item.x), { type: 'number', step: 1 }, value => { item.x = clamp(num(value, item.x), 0, SVG_W - item.w); });
    addField(grid, 'Y', Math.round(item.y), { type: 'number', step: 1 }, value => { item.y = clamp(num(value, item.y), 0, SVG_H - item.h); });
    addField(grid, 'Ширина (px)', Math.round(item.w), { type: 'number', min: 12, step: 1 }, value => { item.w = clamp(num(value, item.w), 12, SVG_W - item.x); });
    addField(grid, 'Височина (px)', Math.round(item.h), { type: 'number', min: 12, step: 1 }, value => { item.h = clamp(num(value, item.h), 12, SVG_H - item.y); });
  } else if (item.type === 'people') {
    addField(grid, 'Име', item.name || '', { full: true }, value => { item.name = value; });
    addField(grid, 'Брой', item.count || 0, { type: 'number', min: 0, max: 1000, step: 1 }, value => { item.count = Math.max(0, Math.round(num(value, 0))); });
    addField(grid, 'X', Math.round(item.x), { type: 'number', step: 1 }, value => { item.x = clamp(num(value, item.x), 0, SVG_W); });
    addField(grid, 'Y', Math.round(item.y), { type: 'number', step: 1 }, value => { item.y = clamp(num(value, item.y), 0, SVG_H); });
  } else if (item.type === 'hazard') {
    const maxHazardMeters = Math.max(20, Math.ceil(600 / pxPerMeter));
    addField(grid, 'Име', item.name || '', { full: true }, value => { item.name = value; });
    addField(grid, 'Радиус (м)', (num(item.radius, 27) / pxPerMeter).toFixed(2), { type: 'number', min: 0.2, max: maxHazardMeters, step: 0.1 }, value => { item.radius = clamp(num(value, 1.2) * pxPerMeter, 6, 600); });
    addRange(grid, 'Плъзгач за радиус', (num(item.radius, 27) / pxPerMeter), 0.3, maxHazardMeters, 0.1, v => v.toFixed(1) + ' м', value => { item.radius = clamp(value * pxPerMeter, 6, 600); });
    addField(grid, 'X', Math.round(item.x), { type: 'number', step: 1 }, value => { item.x = clamp(num(value, item.x), 0, SVG_W); });
    addField(grid, 'Y', Math.round(item.y), { type: 'number', step: 1 }, value => { item.y = clamp(num(value, item.y), 0, SVG_H); });
    addCheckbox(grid, 'Разпространява се във времето', item.spread !== false, value => { item.spread = value; });
    addField(grid, 'Скорост (м/с)', item.spreadSpeed == null ? '' : item.spreadSpeed, { type: 'number', min: 0.02, max: 10, step: 0.05, placeholder: 'автоматично (' + (project.settings.spreadSpeed || 0.4) + ')' }, value => {
      const raw = String(value || '').trim();
      if (raw === '') delete item.spreadSpeed;
      else item.spreadSpeed = clamp(num(raw, 0.4), 0.02, 10);
    });
    addField(grid, 'Макс. обхват (м)', item.maxRadius == null ? 30 : item.maxRadius, { type: 'number', min: 1, max: 500, step: 1 }, value => { item.maxRadius = clamp(num(value, 30), 1, 500); });
  } else {
    addField(grid, 'Име', item.name || '', { full: true }, value => { item.name = value; });
    addField(grid, 'Ширина (м)', item.width || 1.2, { type: 'number', min: 0.2, max: 10, step: 0.1 }, value => { item.width = clamp(num(value, 1.2), 0.2, 10); });
    addRange(grid, 'Плъзгач за размер', num(item.width, 1.2), 0.3, 10, 0.1, v => v.toFixed(1) + ' м', value => { item.width = clamp(value, 0.2, 10); });
    addField(grid, 'X', Math.round(item.x), { type: 'number', step: 1 }, value => { item.x = clamp(num(value, item.x), 0, SVG_W); });
    addField(grid, 'Y', Math.round(item.y), { type: 'number', step: 1 }, value => { item.y = clamp(num(value, item.y), 0, SVG_H); });
    if (item.type === 'stairs') {
      addField(grid, 'Шахта', item.shaft || '', { placeholder: 'автоматично' }, value => {
        const cleaned = String(value || '').trim();
        if (cleaned) item.shaft = cleaned;
        else delete item.shaft;
      });
    }
  }
  const hint = document.createElement('p');
  hint.className = 'note';
  hint.style.marginTop = '6px';
  hint.textContent = item.type === 'stairs'
    ? 'Плъзни кръгчето вдясно от стълбището, за да промениш размера. Стълбищата с еднаква шахта/позиция се свързват между етажите.'
    : (item.type === 'door' || item.type === 'exit' || item.type === 'hazard')
      ? 'Плъзни кръгчето вдясно от обекта (или използвай плъзгача), за да промениш размера.'
      : 'Промените се записват автоматично и могат да се отменят с Ctrl+Z.';
  box.append(hint);
}

function deleteSelected() {
  const item = selectedItem();
  if (!item) return;
  if (isSimActive()) { showToast('Спри симулацията, за да редактираш.'); return; }
  const floor = currentFloorData();
  pushHistory();
  floor.items = floor.items.filter(x => !sameId(x.id, item.id));
  selectedId = null;
  markDirty();
  renderObjectEditor();
  draw();
  updateStats();
  refreshAnalysis();
  addLog('Изтрит обект: ' + (TYPE_LABELS[item.type] || item.type) + '.');
}

function duplicateSelected() {
  const item = selectedItem();
  if (!item) return;
  if (isSimActive()) { showToast('Спри симулацията, за да редактираш.'); return; }
  pushHistory();
  const copy = clone(item);
  copy.id = uid();
  copy.name = (copy.name || TYPE_LABELS[item.type] || 'Обект') + ' копие';
  if (copy.type === 'stairs') delete copy.shaft;
  if (copy.type === 'room' || copy.type === 'corridor') {
    copy.x = clamp(copy.x + 20, 0, Math.max(0, SVG_W - copy.w));
    copy.y = clamp(copy.y + 20, 0, Math.max(0, SVG_H - copy.h));
  } else {
    copy.x = clamp(copy.x + 20, 0, SVG_W);
    copy.y = clamp(copy.y + 20, 0, SVG_H);
  }
  currentFloorData().items.push(copy);
  selectedId = copy.id;
  markDirty();
  renderObjectEditor();
  draw();
  refreshAnalysis();
  addLog('Дублиран обект.');
}

/* ----------------------------- editor interaction ----------------------------- */

function hitTest(point) {
  const items = currentFloorData().items;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type === 'room' || item.type === 'corridor') {
      if (point.x >= item.x && point.x <= item.x + item.w && point.y >= item.y && point.y <= item.y + item.h) return item;
    } else if (item.type === 'hazard') {
      if (Math.hypot(point.x - item.x, point.y - item.y) <= Math.max(6, num(item.radius, 27))) return item;
    } else if (Math.hypot(point.x - item.x, point.y - item.y) <= 24) {
      return item;
    }
  }
  return null;
}

function startPan(event) {
  interaction = {
    kind: 'pan',
    startClient: { x: event.clientX, y: event.clientY },
    view: { x: view.x, y: view.y, w: view.w, h: view.h }
  };
  svg.classList.add('panning');
  try { svg.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
}

function startResize(event, point, corner) {
  const item = selectedItem();
  if (!item) return;
  if (corner === 'size') {
    if (!(item.type === 'door' || item.type === 'exit' || item.type === 'stairs' || item.type === 'hazard')) return;
    interaction = {
      kind: 'resizePoint',
      item,
      snapshot: snapshotState(),
      committed: false
    };
    try { svg.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
    return;
  }
  if (item.type !== 'room' && item.type !== 'corridor') return;
  interaction = {
    kind: 'resize',
    item,
    corner,
    origin: { x: item.x, y: item.y, w: item.w, h: item.h },
    snapshot: snapshotState(),
    committed: false
  };
  try { svg.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
}

function onPointerDown(event) {
  if (!project || event.button === 2) return;
  const point = svgPoint(event);
  if (isSimActive()) {
    showToast('Спри симулацията, за да редактираш плана.');
    return;
  }
  if (event.button === 1 || event.altKey || spaceDown) {
    event.preventDefault();
    startPan(event);
    return;
  }
  if (tool === 'select') {
    const handle = event.target && event.target.getAttribute && event.target.getAttribute('data-handle');
    if (handle) {
      startResize(event, point, handle);
      return;
    }
    const hit = hitTest(point);
    if (hit) {
      selectedId = hit.id;
      interaction = {
        kind: 'drag',
        item: hit,
        startPoint: point,
        origin: { x: hit.x, y: hit.y },
        snapshot: snapshotState(),
        committed: false
      };
      renderObjectEditor();
      draw();
      try { svg.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
      return;
    }
    selectedId = null;
    renderObjectEditor();
    updateBackdropPanel();
    draw();
    startPan(event);
    return;
  }
  if (tool === 'room' || tool === 'corridor') {
    if (draft) {
      finishDraft(point);
      return;
    }
    draft = {
      startX: snapValue(point.x),
      startY: snapValue(point.y),
      currentX: snapValue(point.x),
      currentY: snapValue(point.y),
      type: tool
    };
    interaction = { kind: 'draft' };
    try { svg.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
    draw();
    return;
  }
  createPointItem(tool, point);
}

function onPointerMove(event) {
  const point = svgPoint(event);
  updateCoordsText(point);
  if (!interaction) return;
  if (interaction.kind === 'pan') {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = (event.clientX - interaction.startClient.x) * view.w / rect.width;
    const dy = (event.clientY - interaction.startClient.y) * view.h / rect.height;
    view.x = interaction.view.x - dx;
    view.y = interaction.view.y - dy;
    applyView();
    draw();
    return;
  }
  if (interaction.kind === 'draft' && draft) {
    draft.currentX = snapValue(point.x);
    draft.currentY = snapValue(point.y);
    draw();
    return;
  }
  if (interaction.kind === 'drag' && interaction.item) {
    const item = interaction.item;
    const nx = snapValue(interaction.origin.x + (point.x - interaction.startPoint.x));
    const ny = snapValue(interaction.origin.y + (point.y - interaction.startPoint.y));
    const rect = item.type === 'room' || item.type === 'corridor' ? { w: item.w, h: item.h } : null;
    const target = clampPoint({ x: nx, y: ny }, rect);
    if (target.x === item.x && target.y === item.y) return;
    if (!interaction.committed) {
      pushHistorySnapshot(interaction.snapshot);
      interaction.committed = true;
    }
    item.x = target.x;
    item.y = target.y;
    markDirty();
    draw();
    return;
  }
  if (interaction.kind === 'resizePoint' && interaction.item) {
    const item = interaction.item;
    const distance = Math.hypot(point.x - item.x, point.y - item.y);
    if (item.type === 'hazard') {
      const nextRadius = Math.round(clamp(distance, 6, 600));
      if (nextRadius === item.radius) return;
      if (!interaction.committed) {
        pushHistorySnapshot(interaction.snapshot);
        interaction.committed = true;
      }
      item.radius = nextRadius;
    } else {
      const nextWidth = Math.round(pointWidthFromRadius(item, distance) * 20) / 20;
      if (Math.abs(nextWidth - num(item.width, 1.2)) < 0.001) return;
      if (!interaction.committed) {
        pushHistorySnapshot(interaction.snapshot);
        interaction.committed = true;
      }
      item.width = nextWidth;
    }
    markDirty();
    draw();
    return;
  }
  if (interaction.kind === 'resize' && interaction.item) {
    const item = interaction.item;
    const origin = interaction.origin;
    const corner = interaction.corner;
    const sx = snapValue(point.x);
    const sy = snapValue(point.y);
    let x = origin.x;
    let y = origin.y;
    let w = origin.w;
    let h = origin.h;
    if (corner.indexOf('e') !== -1) w = clamp(sx - origin.x, 30, SVG_W - origin.x);
    if (corner.indexOf('s') !== -1) h = clamp(sy - origin.y, 20, SVG_H - origin.y);
    if (corner.indexOf('w') !== -1) {
      x = clamp(sx, 0, origin.x + origin.w - 30);
      w = origin.x + origin.w - x;
    }
    if (corner.indexOf('n') !== -1) {
      y = clamp(sy, 0, origin.y + origin.h - 20);
      h = origin.y + origin.h - y;
    }
    if (x === item.x && y === item.y && w === item.w && h === item.h) return;
    if (!interaction.committed) {
      pushHistorySnapshot(interaction.snapshot);
      interaction.committed = true;
    }
    item.x = x;
    item.y = y;
    item.w = w;
    item.h = h;
    markDirty();
    draw();
  }
}

function onPointerUp(event) {
  if (!interaction) return;
  if (interaction.kind === 'draft' && draft) {
    const dx = Math.abs(draft.currentX - draft.startX);
    const dy = Math.abs(draft.currentY - draft.startY);
    if (dx > 8 || dy > 8) {
      finishDraft({ x: draft.currentX, y: draft.currentY });
    } else {
      addLog('Избери втори ъгъл за ' + (draft.type === 'room' ? 'помещението' : 'коридора') + '.');
    }
  }
  if (interaction.kind === 'drag' && interaction.committed) {
    addLog('Преместен обект.');
    renderObjectEditor();
    refreshAnalysis();
  }
  if (interaction.kind === 'resize' && interaction.committed) {
    addLog('Променен размер.');
    renderObjectEditor();
    refreshAnalysis();
  }
  if (interaction.kind === 'resizePoint' && interaction.committed) {
    addLog('Променен размер на обект.');
    renderObjectEditor();
    refreshAnalysis();
  }
  if (interaction.kind === 'pan') svg.classList.remove('panning');
  try { svg.releasePointerCapture(event.pointerId); } catch (e) { /* ignore */ }
  interaction = null;
}

function newNameFor(type) {
  const input = $('groupName').value.trim();
  if (type === 'corridor' && (!input || /^класна стая/i.test(input))) return 'Коридор';
  if (input) return input;
  return type === 'room' ? 'Помещение' : 'Коридор';
}

function nextPointName(prefix, type) {
  return prefix + ' ' + (currentFloorData().items.filter(item => item.type === type).length + 1);
}

function finishDraft(point) {
  if (!draft) return;
  const startX = draft.startX;
  const startY = draft.startY;
  let x = Math.min(startX, point.x);
  let y = Math.min(startY, point.y);
  let w = Math.abs(point.x - startX);
  let h = Math.abs(point.y - startY);
  const minW = draft.type === 'room' ? 40 : 35;
  const minH = draft.type === 'room' ? 30 : 25;
  if (w < 8 || h < 8) {
    draft = null;
    draw();
    addLog('Чертането е отменено: нужен е по-голям правоъгълник.');
    return;
  }
  w = Math.max(minW, w);
  h = Math.max(minH, h);
  x = clamp(x, 0, SVG_W - w);
  y = clamp(y, 0, SVG_H - h);
  w = Math.min(w, SVG_W - x);
  h = Math.min(h, SVG_H - y);
  const type = draft.type;
  pushHistory();
  const item = {
    id: uid(),
    type,
    x: snapValue(x),
    y: snapValue(y),
    w: snapValue(w),
    h: snapValue(h),
    width: clamp(num($('width').value, 1.2), 0.2, 20),
    name: newNameFor(type),
    people: type === 'room' ? Math.max(0, Math.round(num($('peopleCount').value, 0))) : 0,
    teachers: type === 'room' ? Math.max(0, Math.round(num($('teacherCount').value, 0))) : 0
  };
  currentFloorData().items.push(item);
  selectedId = item.id;
  draft = null;
  markDirty();
  renderObjectEditor();
  draw();
  updateStats();
  refreshAnalysis();
  addLog('Добавен ' + (type === 'room' ? 'помещение' : 'коридор') + ' „' + item.name + '“.');
}

function createPointItem(type, point) {
  if (isSimActive()) {
    showToast('Спри симулацията, за да редактираш.');
    return;
  }
  const target = clampPoint({ x: snapValue(point.x), y: snapValue(point.y) });
  const item = { id: uid(), type, x: target.x, y: target.y };
  if (type === 'door' || type === 'exit' || type === 'stairs') {
    item.width = clamp(num($('width').value, 1.2), 0.2, 10);
    item.name = nextPointName(type === 'door' ? 'Врата' : type === 'exit' ? 'Изход' : 'Стълбище', type);
  } else if (type === 'people') {
    item.count = Math.max(1, Math.round(num($('peopleCount').value, 1)));
    item.name = $('groupName').value.trim() || nextPointName('Група', 'people');
  } else if (type === 'hazard') {
    item.radius = clamp(num($('hazardRadius').value, 1.2) * project.settings.pxPerMeter, 6, 600);
    item.spread = true;
    item.maxRadius = 30;
    item.name = nextPointName('Опасна зона', 'hazard');
  } else {
    return;
  }
  pushHistory();
  currentFloorData().items.push(item);
  selectedId = item.id;
  markDirty();
  renderObjectEditor();
  draw();
  updateStats();
  refreshAnalysis();
  addLog('Добавен обект: ' + (TYPE_LABELS[type] || type) + '.');
}

/* ----------------------------- floors ----------------------------- */

function addFloor() {
  if (isSimActive()) { showToast('Спри симулацията, за да редактираш.'); return; }
  pushHistory();
  project.floors.push({ id: uid(), name: 'Етаж ' + (project.floors.length + 1), items: [], backdrop: null });
  currentFloor = project.floors.length - 1;
  selectedId = null;
  markDirty();
  afterProjectChanged();
  addLog('Добавен етаж.');
}

function renameFloor() {
  const floor = currentFloorData();
  const name = prompt('Име на етажа:', floor.name || ('Етаж ' + (currentFloor + 1)));
  if (name === null) return;
  const cleaned = name.trim();
  if (!cleaned || cleaned === floor.name) return;
  pushHistory();
  floor.name = cleaned;
  markDirty();
  afterProjectChanged();
  addLog('Етажът е преименуван на „' + cleaned + '“.');
}

function duplicateFloor() {
  if (isSimActive()) { showToast('Спри симулацията, за да редактираш.'); return; }
  const source = currentFloorData();
  const copy = {
    id: uid(),
    name: (source.name || 'Етаж') + ' (копие)',
    items: source.items.map(item => {
      const cloned = clone(item);
      cloned.id = uid();
      if (cloned.type === 'stairs') delete cloned.shaft;
      return cloned;
    }),
    backdrop: source.backdrop ? clone(source.backdrop) : null
  };
  pushHistory();
  project.floors.splice(currentFloor + 1, 0, copy);
  currentFloor += 1;
  selectedId = null;
  markDirty();
  afterProjectChanged();
  addLog('Дублиран етаж.');
}

function removeFloor() {
  if (project.floors.length < 2) {
    showToast('Проектът трябва да има поне един етаж.', true);
    return;
  }
  if (!confirm('Да се премахне ли текущият етаж и всички негови обекти?')) return;
  stopSimulation(true);
  pushHistory();
  project.floors.splice(currentFloor, 1);
  currentFloor = clamp(currentFloor - 1, 0, project.floors.length - 1);
  selectedId = null;
  markDirty();
  afterProjectChanged();
  addLog('Премахнат етаж.');
}

/* ----------------------------- simulation ----------------------------- */

function isSimActive() {
  return !!(activeSim && !activeSim.finished);
}

function syncSimButtons() {
  const running = isSimActive();
  $('run').textContent = running ? '↻ Рестарт' : '▶ Стартирай';
  $('pause').disabled = !running;
  $('pause').textContent = simPaused ? '▶ Продължи' : 'Ⅱ Пауза';
  $('stop').disabled = !activeSim;
  $('preMovement').disabled = running;
  document.querySelectorAll('.scenario').forEach(el => {
    el.style.opacity = running ? '.6' : '';
    el.style.pointerEvents = running ? 'none' : '';
  });
}

function startSimulation() {
  if (activeSim) stopSimulation(true);
  const scenario = project.settings.scenario;
  const preRaw = $('preMovement').value.trim();
  const preMovement = preRaw === '' ? undefined : Math.max(0, num(preRaw, 0));
  const model = EvacSim.buildModel(project, { scenario, preMovement });
  if (model.mutated) scheduleAutosave();
  previewModel = model;
  renderWarnings();
  renderRouteTable();
  if (!model.groups.length) {
    setStatus('Няма хора за евакуация. Добави хора в помещение или отделна група.');
    showToast('Няма хора за евакуация.', true);
    return;
  }
  if (scenario !== 'lockdown' && !model.exits.length) {
    setStatus('Няма добавен авариен изход. Добави поне един изход или използвай режим за укриване.');
    showToast('Добави авариен изход.', true);
    return;
  }
  if (scenario !== 'lockdown' && !model.activeExits.length) {
    setStatus('Всички изходи са блокирани от опасни зони. Провери плана.');
    showToast('Всички изходи са блокирани.', true);
    return;
  }
  activeSim = EvacSim.createSimulation(model, { preMovement });
  lastSimState = activeSim.snapshot();
  lastSimReport = null;
  simPaused = false;
  simAccumulator = 0;
  lastTableAt = 0;
  const labels = EvacSim.SCENARIO_LABELS || {};
  setStatus('Симулацията се изпълнява · ' + (labels[scenario] || scenario) + '.');
  $('report').textContent = 'Симулацията е в ход. Изчакай резултата или натисни „Стоп“.';
  addLog('Стартирана симулация · ' + (labels[scenario] || scenario) + ' · ' + model.totalPeople + ' души.');
  syncSimButtons();
  updateStats();
  renderSimFloorInfo();
  renderBottlenecks();
  refreshFloorSelect();
  draw();
  clearInterval(simTimer);
  simTimer = setInterval(simTick, 100);
}

function simTick() {
  if (!activeSim || simPaused || activeSim.finished) return;
  const speed = Number($('speedSelect').value) || 4;
  if (speed < 1) {
    simAccumulator += speed;
    if (simAccumulator < 1) return;
    simAccumulator -= 1;
    lastSimState = activeSim.advance(0.1);
  } else {
    const steps = Math.max(1, Math.round(speed));
    for (let i = 0; i < steps; i++) {
      if (!activeSim || activeSim.finished) break;
      lastSimState = activeSim.advance(0.1);
    }
  }
  if (activeSim && activeSim.finished) {
    finishSimulation();
    return;
  }
  updateStats();
  renderSimFloorInfo();
  draw();
  const now = Date.now();
  if (now - lastTableAt > 450) {
    lastTableAt = now;
    renderBottlenecks();
    renderRouteTable();
    updateSpreadPanel();
    refreshFloorSelect();
  }
}

function finishSimulation() {
  if (!activeSim) return;
  clearInterval(simTimer);
  simTimer = null;
  simPaused = false;
  lastSimState = activeSim.snapshot();
  lastSimReport = buildSimulationReport(lastSimState, activeSim.model);
  setStatus(lastSimReport.finishedText);
  $('report').textContent = lastSimReport.text;
  addLog(lastSimReport.log);
  syncSimButtons();
  updateStats();
  renderBottlenecks();
  renderRouteTable();
  updateSpreadPanel();
  renderSimFloorInfo();
  draw();
  refreshFloorSelect();
  showToast('Симулацията приключи.');
}

function buildSimulationReport(state, model) {
  const labels = EvacSim.SCENARIO_LABELS || {};
  const fmt = EvacSim.formatTime || (s => (s || 0).toFixed(1) + ' s');
  const scenario = labels[state.scenario] || state.scenario;
  const total = state.total;
  const safe = state.safe;
  const sheltered = state.sheltered;
  const noRoute = state.noRoute;
  const avg = state.averageTime == null ? '—' : fmt(state.averageTime);
  const bottleneck = state.bottlenecks && state.bottlenecks[0];
  let text;
  let log;
  let finishedText;
  if (state.lockdown) {
    text = 'Учебен режим на защитно укриване: ' + sheltered + ' от ' + total + ' души са в укритие за ' + fmt(state.time) + '.';
    log = 'Симулацията приключи (укриване): ' + sheltered + '/' + total + ' за ' + fmt(state.time) + '.';
    finishedText = 'Симулацията приключи: защитно укриване.';
  } else {
    text = 'Евакуирани ' + safe + ' от ' + total + ' души за ' + fmt(state.time) + ' (симулационно време). Средно време: ' + avg + '.';
    if (noRoute) text += ' ' + noRoute + ' души са без достъпен маршрут.';
    if (bottleneck) {
      text += ' Най-натоварена точка: ' + bottleneck.label + ' (опашка до ' + bottleneck.maxQueue + ', капацитет ' + bottleneck.capacity.toFixed(2) + ' д/с).';
    }
    text += ' Това е учебен модел, а не прогноза за реално време.';
    log = 'Симулацията приключи: ' + safe + '/' + total + ' за ' + fmt(state.time) + (noRoute ? ', без маршрут: ' + noRoute : '') + '.';
    finishedText = 'Симулацията приключи.' + (noRoute ? ' Има групи без маршрут.' : '');
  }
  if (state.timedOut) text += ' Симулацията е спряна по лимит от ' + fmt(state.time) + '.';
  const noRouteGroups = (model.groups || []).filter(g => g.status === 'no-route').map(g => g.label);
  if (noRouteGroups.length) text += ' Групи без маршрут: ' + noRouteGroups.slice(0, 6).join(', ') + (noRouteGroups.length > 6 ? '…' : '') + '.';
  return {
    scenario,
    text,
    log,
    finishedText,
    state,
    model
  };
}

function pauseSimulation() {
  if (!activeSim || activeSim.finished) return;
  simPaused = !simPaused;
  setStatus(simPaused ? 'Симулацията е на пауза.' : 'Симулацията продължава...');
  addLog(simPaused ? 'Симулацията е на пауза.' : 'Симулацията продължава.');
  syncSimButtons();
}

function stopSimulation(silent) {
  clearInterval(simTimer);
  simTimer = null;
  const hadSim = !!activeSim;
  activeSim = null;
  simPaused = false;
  simAccumulator = 0;
  lastSimState = null;
  lastSimReport = null;
  $('report').textContent = 'Няма проведена симулация.';
  if (!silent) {
    setStatus('Симулацията е спряна. Можеш да редактираш.');
    if (hadSim) addLog('Симулацията е спряна.');
  } else {
    setStatus('Готово за симулация.');
  }
  syncSimButtons();
  updateStats();
  renderSimFloorInfo();
  renderBottlenecks();
  refreshFloorSelect();
  renderRouteTable();
  updateSpreadPanel();
  draw();
}

/* ----------------------------- attachments / backdrop ----------------------------- */

const pendingLoads = new Map();

function isImageAttachment(a) { return !!(a && IMAGE_EXT.has(String(a.ext || extOf(a.name)).toLowerCase())); }
function isPdfAttachment(a) { return !!(a && PDF_EXT.has(String(a.ext || extOf(a.name)).toLowerCase())); }
function isBackdropCapable(a) { return isImageAttachment(a) || isPdfAttachment(a); }
function attachmentById(id) { return project.attachments.find(a => sameId(a.id, id)) || null; }

function imageSize(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 900, height: img.naturalHeight || 590 });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
}

function loadAttachmentData(a) {
  if (!a) return Promise.resolve(null);
  const existing = attachmentMeta.get(a.id);
  if (existing) return Promise.resolve(existing);
  if (pendingLoads.has(a.id)) return pendingLoads.get(a.id);
  if (!desktop || !desktop.readFile) {
    const meta = { missing: true, error: 'Четенето на файлове работи само в desktop приложението.' };
    attachmentMeta.set(a.id, meta);
    return Promise.resolve(meta);
  }
  const promise = (async () => {
    try {
      const result = await desktop.readFile(a.path);
      if (!result || !result.ok) {
        const meta = { missing: true, error: result && result.error || 'Файлът не е достъпен.' };
        attachmentMeta.set(a.id, meta);
        return meta;
      }
      const meta = { dataUrl: result.dataUrl, size: result.size, missing: false };
      if (isImageAttachment(a)) {
        const dim = await imageSize(result.dataUrl);
        meta.width = dim.width;
        meta.height = dim.height;
      }
      attachmentMeta.set(a.id, meta);
      return meta;
    } catch (e) {
      const meta = { missing: true, error: e.message };
      attachmentMeta.set(a.id, meta);
      return meta;
    } finally {
      pendingLoads.delete(a.id);
    }
  })();
  pendingLoads.set(a.id, promise);
  return promise;
}

async function validateAttachments() {
  if (!desktop || !desktop.statFile) {
    renderAttachments();
    return;
  }
  for (const attachment of project.attachments) {
    try {
      const result = await desktop.statFile(attachment.path);
      if (!result.exists) attachmentMeta.set(attachment.id, { missing: true, error: 'Файлът липсва.' });
      else if (result.size != null) attachment.size = result.size;
    } catch (e) {
      attachmentMeta.set(attachment.id, { missing: true, error: e.message });
    }
  }
  renderAttachments();
  updateBackdropPanel();
  draw();
}

function renderAttachments() {
  const box = $('attachmentsList');
  const status = $('fileStatus');
  if (!box) return;
  box.replaceChildren();
  if (!project.attachments.length) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'PDF, PNG, JPG, SVG, DOCX, XLSX, TXT и др. Могат да се отварят; изображения и PDF — и като подложка.';
    box.append(p);
    if (status) status.textContent = 'Няма прикачени материали.';
    return;
  }
  let missing = 0;
  project.attachments.forEach(attachment => {
    const meta = attachmentMeta.get(attachment.id);
    const isMissing = !!(meta && meta.missing);
    if (isMissing) missing += 1;
    const row = document.createElement('div');
    row.className = 'file-row';
    const ico = document.createElement('div');
    ico.className = 'file-ico' + (isPdfAttachment(attachment) ? ' pdf' : isImageAttachment(attachment) ? ' img' : '');
    ico.textContent = (attachment.ext || extOf(attachment.name) || 'FILE').toUpperCase().slice(0, 4);
    row.append(ico);
    const main = document.createElement('div');
    main.className = 'file-main';
    const name = document.createElement('div');
    name.className = 'file-name' + (isMissing ? ' missing' : '');
    name.textContent = attachment.name || basename(attachment.path);
    name.title = attachment.path;
    main.append(name);
    const metaLine = document.createElement('div');
    metaLine.className = 'file-meta';
    metaLine.textContent = (isMissing ? 'липсва · ' : '') + formatBytes(attachment.size) + ' · ' + (attachment.ext || extOf(attachment.name) || 'файл');
    main.append(metaLine);
    row.append(main);
    const actions = document.createElement('div');
    actions.className = 'file-actions';
    const openBtn = document.createElement('button');
    openBtn.textContent = '↗';
    openBtn.title = 'Отвори с програмата по подразбиране';
    openBtn.addEventListener('click', () => openAttachment(attachment.id));
    actions.append(openBtn);
    if (isBackdropCapable(attachment)) {
      const backdropBtn = document.createElement('button');
      backdropBtn.textContent = '▣';
      backdropBtn.title = 'Използвай като подложка на текущия етаж';
      backdropBtn.addEventListener('click', () => setBackdrop(attachment.id));
      actions.append(backdropBtn);
    }
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.title = 'Премахни от проекта';
    removeBtn.addEventListener('click', () => removeAttachment(attachment.id));
    actions.append(removeBtn);
    row.append(actions);
    box.append(row);
  });
  if (status) {
    status.textContent = project.attachments.length + ' материала' + (missing ? ' · ' + missing + ' липсващи' : '') + ' · файловете не се вграждат в JSON проекта.';
  }
}

async function attachFiles() {
  if (!desktop || !desktop.pickFiles) {
    showToast('Прикачването на файлове работи в desktop приложението.', true);
    return;
  }
  try {
    const result = await desktop.pickFiles();
    if (!result || result.canceled || !result.files || !result.files.length) return;
    const added = [];
    for (const file of result.files) {
      if (project.attachments.some(a => a.path === file.path)) continue;
      added.push({
        id: uid(),
        name: file.name || basename(file.path),
        path: file.path,
        ext: (file.ext || extOf(file.path)).toLowerCase(),
        size: num(file.size, 0),
        addedAt: nowIso()
      });
    }
    if (!added.length) {
      showToast('Тези файлове вече са прикачени.');
      return;
    }
    pushHistory();
    project.attachments.push(...added);
    markDirty();
    renderAttachments();
    addLog('Прикачени ' + added.length + ' файл(а).');
    showToast('Прикачени ' + added.length + ' файл(а).');
  } catch (e) {
    showToast('Грешка при прикачване: ' + e.message, true);
  }
}

async function openAttachment(id) {
  const attachment = attachmentById(id);
  if (!attachment) return;
  const meta = attachmentMeta.get(id);
  if (meta && meta.missing) {
    showToast('Файлът липсва на диска: ' + attachment.path, true);
    return;
  }
  if (!desktop || !desktop.openExternal) {
    showToast('Отварянето работи в desktop приложението.', true);
    return;
  }
  try {
    const error = await desktop.openExternal(attachment.path);
    if (error) showToast('Файлът не може да бъде отворен: ' + error, true);
  } catch (e) {
    showToast('Грешка: ' + e.message, true);
  }
}

function removeAttachment(id) {
  const attachment = attachmentById(id);
  if (!attachment) return;
  if (!confirm('Да се премахне ли „' + attachment.name + '“ от проекта? Самият файл на диска не се изтрива.')) return;
  pushHistory();
  project.attachments = project.attachments.filter(a => !sameId(a.id, id));
  project.floors.forEach(floor => {
    if (floor.backdrop && sameId(floor.backdrop.attachmentId, id)) floor.backdrop = null;
  });
  attachmentMeta.delete(id);
  markDirty();
  renderAttachments();
  updateBackdropPanel();
  draw();
  addLog('Премахнат материал: ' + attachment.name + '.');
}

function setBackdrop(id) {
  const attachment = attachmentById(id);
  if (!attachment) return;
  if (!isBackdropCapable(attachment)) {
    showToast('Само изображения и PDF могат да се използват като подложка.', true);
    return;
  }
  if (isSimActive()) {
    showToast('Спри симулацията, за да смениш подложката.');
    return;
  }
  pushHistory();
  currentFloorData().backdrop = {
    attachmentId: attachment.id,
    kind: isPdfAttachment(attachment) ? 'pdf' : 'image',
    opacity: 0.45,
    scale: 1,
    x: 0,
    y: 0,
    rotation: 0,
    visible: true
  };
  markDirty();
  updateBackdropPanel();
  draw();
  addLog('Подложка: ' + attachment.name + '.');
  showToast('Подложката е зададена. Настрой прозрачност и мащаб.');
}

function clearBackdrop() {
  const floor = currentFloorData();
  if (!floor.backdrop) return;
  pushHistory();
  floor.backdrop = null;
  markDirty();
  updateBackdropPanel();
  draw();
  addLog('Премахната подложка.');
}

function updateBackdropPanel() {
  const panel = $('backdropPanel');
  if (!panel) return;
  const floor = currentFloorData();
  const backdrop = floor && floor.backdrop;
  if (!backdrop) {
    panel.style.display = 'none';
    const host = $('pdfBackdrop');
    if (host) host.replaceChildren();
    return;
  }
  const attachment = attachmentById(backdrop.attachmentId);
  panel.style.display = '';
  const name = $('backdropName');
  if (name) {
    name.textContent = attachment
      ? (attachment.name + ' · ' + (backdrop.kind === 'pdf' ? 'PDF подложка' : 'изображение'))
      : 'Липсващ файл за подложката.';
    if (backdrop.kind === 'pdf') name.textContent += ' · PDF не се вгражда в SVG/PNG експорта.';
  }
  const opacity = Math.round((backdrop.opacity == null ? 0.45 : backdrop.opacity) * 100);
  $('backdropOpacity').value = opacity;
  $('backdropOpacityVal').textContent = opacity + '%';
  const scale = Math.round((backdrop.scale == null ? 1 : backdrop.scale) * 100);
  $('backdropScale').value = scale;
  $('backdropScaleVal').textContent = scale + '%';
  $('backdropX').value = Math.round(num(backdrop.x, 0));
  $('backdropY').value = Math.round(num(backdrop.y, 0));
  const rotation = Math.round(num(backdrop.rotation, 0));
  $('backdropRotation').value = rotation;
  $('backdropRotationVal').textContent = rotation + '°';
  $('backdropVisible').checked = backdrop.visible !== false;
  $('backdropOpen').disabled = !attachment;
}

function beginBackdropEdit() {
  if (!backdropEditSession) backdropEditSession = { snapshot: snapshotState(), committed: false };
}
function commitBackdropEditSnapshot() {
  if (backdropEditSession && !backdropEditSession.committed) {
    pushHistorySnapshot(backdropEditSession.snapshot);
    backdropEditSession.committed = true;
  }
}
function endBackdropEdit() {
  if (backdropEditSession && backdropEditSession.committed) {
    addLog('Променена подложка.');
    scheduleAutosave();
  }
  backdropEditSession = null;
}

function updateBackdropLabels() {
  const floor = currentFloorData();
  const b = floor && floor.backdrop;
  if (!b) return;
  $('backdropOpacityVal').textContent = Math.round((b.opacity || 0) * 100) + '%';
  $('backdropScaleVal').textContent = Math.round((b.scale || 1) * 100) + '%';
  $('backdropRotationVal').textContent = Math.round(b.rotation || 0) + '°';
}

function drawBackdrop(layer) {
  const floor = currentFloorData();
  const backdrop = floor && floor.backdrop;
  const host = $('pdfBackdrop');
  if (!backdrop || backdrop.visible === false) {
    if (host) host.replaceChildren();
    return;
  }
  const attachment = attachmentById(backdrop.attachmentId);
  if (!attachment) return;
  if (backdrop.kind === 'pdf' || isPdfAttachment(attachment)) {
    renderPdfBackdrop(backdrop, attachment);
    return;
  }
  if (host) host.replaceChildren();
  const meta = attachmentMeta.get(attachment.id);
  if (!meta) {
    loadAttachmentData(attachment).then(() => {
      const still = currentFloorData().backdrop;
      if (still && sameId(still.attachmentId, attachment.id)) draw();
    });
    return;
  }
  if (meta.missing || !meta.dataUrl) return;
  const naturalW = meta.width || 900;
  const naturalH = meta.height || 590;
  const fit = Math.min(SVG_W / naturalW, SVG_H / naturalH) * 0.9;
  const scale = num(backdrop.scale, 1);
  const w = naturalW * fit * scale;
  const h = naturalH * fit * scale;
  const cx = SVG_W / 2 + num(backdrop.x, 0);
  const cy = SVG_H / 2 + num(backdrop.y, 0);
  const angle = num(backdrop.rotation, 0);
  layer.append(svgEl('image', {
    href: meta.dataUrl,
    x: cx - w / 2,
    y: cy - h / 2,
    width: w,
    height: h,
    opacity: num(backdrop.opacity, 0.45),
    preserveAspectRatio: 'xMidYMid meet',
    transform: angle ? 'rotate(' + angle + ' ' + cx + ' ' + cy + ')' : null
  }));
}

function renderPdfBackdrop(backdrop, attachment) {
  const host = $('pdfBackdrop');
  if (!host) return;
  const meta = attachmentMeta.get(attachment.id);
  if (!meta) {
    loadAttachmentData(attachment).then(() => {
      const still = currentFloorData().backdrop;
      if (still && sameId(still.attachmentId, attachment.id)) draw();
    });
    return;
  }
  if (meta.missing || !meta.dataUrl) return;
  let embed = host.querySelector('embed');
  if (!embed || embed.dataset.attachmentId !== String(attachment.id)) {
    host.replaceChildren();
    embed = document.createElement('embed');
    embed.type = 'application/pdf';
    embed.dataset.attachmentId = String(attachment.id);
    embed.src = meta.dataUrl + '#toolbar=0&navpanes=0&scrollbar=0&view=FitH';
    host.append(embed);
  }
  const scale = num(backdrop.scale, 1);
  const w = SVG_W * scale;
  const h = SVG_H * scale;
  const cx = SVG_W / 2 + num(backdrop.x, 0);
  const cy = SVG_H / 2 + num(backdrop.y, 0);
  embed.style.position = 'absolute';
  embed.style.left = ((cx - w / 2) / SVG_W * 100) + '%';
  embed.style.top = ((cy - h / 2) / SVG_H * 100) + '%';
  embed.style.width = (w / SVG_W * 100) + '%';
  embed.style.height = (h / SVG_H * 100) + '%';
  embed.style.border = '0';
  embed.style.background = 'transparent';
  embed.style.opacity = num(backdrop.opacity, 0.45);
  embed.style.transform = 'rotate(' + num(backdrop.rotation, 0) + 'deg)';
  embed.style.transformOrigin = 'center';
  embed.style.pointerEvents = 'none';
}

/* ----------------------------- export ----------------------------- */

function safeFileName(value, fallback) {
  const cleaned = String(value || fallback || 'export').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80);
  return cleaned || 'export';
}

function svgToPngDataUrl(svgText, width, height) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width || 1800;
        canvas.height = height || 1320;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0b1220';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG изображението не може да бъде заредено.'));
    };
    img.src = url;
  });
}

function buildExportSvg(options) {
  const opts = options || {};
  const floor = currentFloorData();
  const clone = svg.cloneNode(true);
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  clone.setAttribute('xmlns', NS);
  clone.setAttribute('viewBox', '0 0 900 660');
  clone.querySelectorAll('.handle, .draft').forEach(el => el.remove());
  clone.querySelectorAll('.object.selected').forEach(el => el.classList.remove('selected'));
  if (!opts.routes) clone.querySelectorAll('.routes').forEach(el => el.remove());
  if (!opts.agents) clone.querySelectorAll('.agents').forEach(el => el.remove());
  const bg = svgEl('rect', { x: 0, y: 0, width: 900, height: 660, fill: '#0b1220' });
  const gridRect = clone.querySelector('#gridRect');
  if (gridRect) clone.insertBefore(bg, gridRect);
  else clone.insertBefore(bg, clone.firstChild);
  if (opts.legend !== false) {
    clone.append(svgEl('rect', { x: 0, y: 590, width: 900, height: 70, fill: '#0e1828' }));
    clone.append(svgEl('line', { x1: 0, y1: 590, x2: 900, y2: 590, stroke: '#263750', 'stroke-width': 1 }));
    clone.append(svgEl('text', { x: 20, y: 617, fill: '#e8effa', 'font-size': 16, 'font-weight': 700 }, project.projectName || 'Evacuation Simulator'));
    clone.append(svgEl('text', { x: 20, y: 636, fill: '#91a4bf', 'font-size': 11 }, (floor.name || '') + ' · учебен прототип v0.5.0 · ' + (project.settings.pxPerMeter || 25) + ' px = 1 m'));
    clone.append(svgEl('text', { x: 20, y: 651, fill: '#6f839e', 'font-size': 10 }, 'Легенда: помещение · коридор · врата · изход · стълбище · хора · опасна зона · безопасност · маршрут'));
    clone.append(svgEl('text', { x: 690, y: 617, fill: '#91a4bf', 'font-size': 10 }, new Date().toLocaleString('bg-BG')));
    const activeBackdrop = floor.backdrop;
    if (activeBackdrop && activeBackdrop.kind === 'pdf') {
      clone.append(svgEl('text', { x: 690, y: 636, fill: '#f5bb57', 'font-size': 10 }, 'PDF подложката не е включена в експорта'));
    }
  }
  return new XMLSerializer().serializeToString(clone);
}

function renderFloorSvg(floorIndex, options) {
  const previousFloor = currentFloor;
  const previousSelection = selectedId;
  const previousDraft = draft;
  currentFloor = clamp(floorIndex, 0, project.floors.length - 1);
  selectedId = null;
  draft = null;
  draw();
  let svgText = '';
  try {
    svgText = buildExportSvg(options || {});
  } finally {
    currentFloor = previousFloor;
    selectedId = previousSelection;
    draft = previousDraft;
    draw();
  }
  return svgText;
}

async function saveBinary(defaultName, base64, filters) {
  if (desktop && desktop.saveBinary) {
    const result = await desktop.saveBinary({ defaultName, base64, filters });
    if (result && result.canceled) return false;
    if (result && result.error) throw new Error(result.error);
    addLog('Експортиран файл: ' + (result && result.filePath ? basename(result.filePath) : defaultName));
    showToast('Файлът е запазен.');
    return true;
  }
  const mime = defaultName.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : defaultName.toLowerCase().endsWith('.png') ? 'image/png' : 'application/octet-stream';
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  addLog('Експортиран файл: ' + defaultName);
  showToast('Файлът е изтеглен.');
  return true;
}

async function exportCurrentFloor(format, options) {
  const opts = options || {};
  const floorName = safeFileName(currentFloorData().name, 'floor-' + (currentFloor + 1));
  const svgText = renderFloorSvg(currentFloor, opts);
  if (format === 'svg') {
    const name = safeFileName((project.projectName || 'evacuation') + '_' + floorName, 'evacuation') + '.svg';
    await saveBinary(name, toBase64Utf8(svgText), [{ name: 'SVG изображение', extensions: ['svg'] }]);
    return;
  }
  if (format === 'png') {
    const dataUrl = await svgToPngDataUrl(svgText, 1800, 1320);
    const base64 = dataUrl.split(',')[1] || '';
    const name = safeFileName((project.projectName || 'evacuation') + '_' + floorName, 'evacuation') + '.png';
    await saveBinary(name, base64, [{ name: 'PNG изображение', extensions: ['png'] }]);
    return;
  }
  throw new Error('Непознат формат за експорт.');
}

async function buildPrintReport(scope, options) {
  const opts = options || {};
  const model = getPreviewModel();
  const state = lastSimState;
  const floorIndexes = scope === 'all' ? project.floors.map((_, i) => i) : [currentFloor];
  const maps = [];
  for (const fi of floorIndexes) {
    const svgText = renderFloorSvg(fi, opts);
    const png = await svgToPngDataUrl(svgText, 1800, 1320);
    maps.push({ floor: fi, png });
  }
  const labels = EvacSim.SCENARIO_LABELS || {};
  const scenario = labels[project.settings.scenario] || project.settings.scenario;
  const fmt = EvacSim.formatTime || (s => (s || 0).toFixed(1) + ' s');
  const summaryRows = [
    ['Проект', project.projectName || '—'],
    ['Сценарий', scenario],
    ['Общо хора', String(model.totalPeople || totalPeople())],
    ['Етажи', String(project.floors.length)],
    ['Мащаб', (project.settings.pxPerMeter || 25) + ' px = 1 m'],
    ['Дата', new Date().toLocaleString('bg-BG')]
  ];
  if (state) {
    summaryRows.push(['Евакуирани', String(state.safe)]);
    summaryRows.push(['Укрити', String(state.sheltered)]);
    summaryRows.push(['Без маршрут', String(state.noRoute)]);
    summaryRows.push(['Симулационно време', fmt(state.time)]);
    summaryRows.push(['Средно време', state.averageTime == null ? '—' : fmt(state.averageTime)]);
  }
  const summaryTable = '<table>' + summaryRows.map(([k, v]) => '<tr><th>' + escapeHtml(k) + '</th><td>' + escapeHtml(v) + '</td></tr>').join('') + '</table>';
  const floorSections = maps.map(({ floor, png }) => {
    const data = project.floors[floor];
    const people = data.items.reduce((s, item) => s + (EvacSim.helpers ? EvacSim.helpers.itemPeople(item) : 0), 0);
    const exits = data.items.filter(i => i.type === 'exit').length;
    const stairs = data.items.filter(i => i.type === 'stairs').length;
    return '<section class="print-floor"><h2>' + escapeHtml(data.name || ('Етаж ' + (floor + 1))) + '</h2>' +
      '<div class="meta">' + people + ' души · ' + exits + ' изхода · ' + stairs + ' стълбища · ' + data.items.length + ' обекта</div>' +
      '<img src="' + png + '" alt="' + escapeHtml(data.name || '') + '">' +
      '<p class="note">Схематична карта. Маршрутите и хората са от последната симулация, ако има такава.</p></section>';
  }).join('');
  const groupRows = (model.groups || []).map(group => {
    const exitNode = group.route ? model.nodes.get(group.route.exitId) : null;
    const st = state && state.groupStats ? state.groupStats.find(g => g.id === group.id) : null;
    return '<tr><td>' + escapeHtml(group.label) + '</td><td>' + group.peopleCount + '</td><td>' + (group.floor + 1) + '</td><td>' +
      escapeHtml(exitNode ? exitNode.label : '—') + '</td><td>' + (group.estimatedTime == null ? '—' : fmt(group.estimatedTime)) + '</td><td>' +
      escapeHtml(st ? (st.status === 'done' ? 'готово' : st.status === 'no-route' ? 'без маршрут' : st.evacuated + '/' + st.people) : (group.status === 'no-route' ? 'без маршрут' : 'маршрут')) + '</td></tr>';
  }).join('');
  const warnings = (model.warnings || []).map(w => '<li>' + escapeHtml(w) + '</li>').join('');
  const html = '<h1>Evacuation Simulator — отчет</h1>' +
    '<div class="meta">Учебен прототип v0.5.0 · не е сертифициран инструмент за проектиране</div>' +
    '<h2>Обобщение</h2>' + summaryTable +
    (floorSections || '') +
    '<h2>Маршрути</h2><table><tr><th>Група</th><th>Хора</th><th>Етаж</th><th>Изход</th><th>Очаквано време</th><th>Статус</th></tr>' + (groupRows || '<tr><td colspan="6">Няма групи.</td></tr>') + '</table>' +
    '<h2>Проверки</h2><ul>' + (warnings || '<li>Няма забележки.</li>') + '</ul>' +
    '<p class="disclaimer">Резултатите са от опростен учебен модел с граф на достъпност, капацитет на врати/изходи/стълбища и опашки. Те не отчитат дим, структурни повреди, реална геометрия на стени, психология на тълпата или сертифицирани инженерни изчисления. Реалните евакуационни планове трябва да се изготвят и проверяват от компетентни специалисти.</p>';
  const report = $('printReport');
  report.innerHTML = html;
  await Promise.all(Array.from(report.querySelectorAll('img')).map(img => img.decode ? img.decode().catch(() => {}) : Promise.resolve()));
  return report.innerHTML;
}

async function exportPdfReport(scope, options) {
  const html = await buildPrintReport(scope, options);
  if (!html) return;
  if (desktop && desktop.exportPdf) {
    const name = safeFileName((project.projectName || 'evacuation') + '_report', 'evacuation_report') + '.pdf';
    const result = await desktop.exportPdf({ defaultName: name });
    if (result && result.canceled) return;
    if (result && result.error) throw new Error(result.error);
    addLog('Експортиран PDF отчет: ' + (result && result.filePath ? basename(result.filePath) : name));
    showToast('PDF отчетът е запазен.');
  } else {
    window.print();
  }
}

function openExportDialog(format) {
  if (format) {
    const radio = document.querySelector('input[name="exportFormat"][value="' + format + '"]');
    if (radio) radio.checked = true;
  }
  syncExportScope();
  const dialog = $('exportDialog');
  if (dialog && !dialog.open) dialog.showModal();
}

function syncExportScope() {
  const selected = document.querySelector('input[name="exportFormat"]:checked');
  const format = selected ? selected.value : 'svg';
  const scope = $('exportScope');
  if (!scope) return;
  Array.from(scope.options).forEach(option => {
    if (option.value === 'all') option.disabled = format !== 'pdf';
  });
  if (format !== 'pdf') scope.value = 'current';
}

/* ----------------------------- settings ----------------------------- */

function openSettings() {
  $('setScale').value = project.settings.pxPerMeter;
  $('setFloorHeight').value = project.settings.floorHeight;
  $('setWalkSpeed').value = project.settings.walkSpeed;
  $('setFlow').value = project.settings.specificFlow;
  $('setSpreadSpeed').value = project.settings.spreadSpeed;
  $('setAutosave').checked = project.settings.autosave !== false;
  $('setShowRoutes').checked = project.settings.showRoutes !== false;
  $('setShowGrid').checked = project.settings.showGrid !== false;
  $('setSnap').checked = project.settings.snap !== false;
  $('setPreMovementDefault').value = project.settings.preMovement == null ? '' : project.settings.preMovement;
  updateAutosaveInfo();
  const dialog = $('settingsDialog');
  if (dialog && !dialog.open) dialog.showModal();
}

function saveSettings() {
  pushHistory();
  project.settings.pxPerMeter = clamp(num($('setScale').value, 25), 2, 300);
  project.settings.floorHeight = clamp(num($('setFloorHeight').value, 3.2), 1, 20);
  project.settings.walkSpeed = clamp(num($('setWalkSpeed').value, 1.25), 0.2, 3);
  project.settings.specificFlow = clamp(num($('setFlow').value, 1.3), 0.1, 5);
  project.settings.autosave = $('setAutosave').checked;
  project.settings.showRoutes = $('setShowRoutes').checked;
  project.settings.showGrid = $('setShowGrid').checked;
  project.settings.snap = $('setSnap').checked;
  project.settings.spreadSpeed = clamp(num($('setSpreadSpeed').value, 0.4), 0.02, 10);
  project.settings.showSpread = project.settings.showSpread !== false;
  const preRaw = $('setPreMovementDefault').value.trim();
  project.settings.preMovement = preRaw === '' ? null : Math.max(0, num(preRaw, 0));
  autosaveEnabled = project.settings.autosave;
  if (!autosaveEnabled) clearTimeout(saveTimer);
  markDirty();
  updateHeader();
  updateScenarioUI();
  refreshAnalysis();
  draw();
  updateStats();
  const dialog = $('settingsDialog');
  if (dialog && dialog.open) dialog.close();
  addLog('Настройките са запазени.');
  showToast('Настройките са запазени.');
  if (autosaveEnabled) scheduleAutosave();
}

/* ----------------------------- save / open ----------------------------- */

function pickTextFile(accept) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept || '';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result) });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}

async function saveProjectFile() {
  try {
    project.version = APP_VERSION;
    project.updatedAt = nowIso();
    const payload = clone(project);
    if (desktop && desktop.saveProject) {
      const result = await desktop.saveProject(payload);
      if (!result || result.canceled) return;
      project.projectName = basename(result.filePath) || project.projectName;
      dirty = false;
      updateHeader();
      writeAutosave();
      updateAutosaveInfo();
      addLog('Проектът е запазен: ' + project.projectName);
      showToast('Проектът е запазен.');
    } else {
      const name = safeFileName(project.projectName, 'evacuation-project') + '.evac.json';
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      dirty = false;
      updateHeader();
      addLog('Проектът е изтеглен: ' + name);
      showToast('Проектът е изтеглен.');
    }
  } catch (e) {
    showToast('Грешка при запис: ' + e.message, true);
    addLog('Грешка при запис: ' + e.message);
  }
}

function loadProjectPayload(raw, name) {
  stopSimulation(true);
  project = sanitizeProject(raw);
  if (name) {
    project.projectName = name.replace(/\.evac\.json$/i, '').replace(/\.json$/i, '');
  }
  currentFloor = 0;
  selectedId = null;
  history = { past: [], future: [] };
  previewModel = null;
  revision++;
  attachmentMeta.clear();
  dirty = false;
  autosaveEnabled = project.settings.autosave !== false;
  afterProjectChanged();
  fitView();
  updateAutosaveInfo();
  writeAutosave();
  validateAttachments();
  addLog('Зареден проект: ' + project.projectName);
  showToast('Проектът е зареден.');
}

async function openProjectFile() {
  try {
    if (desktop && desktop.openProject) {
      const result = await desktop.openProject();
      if (!result || result.canceled) return;
      loadProjectPayload(result.project, basename(result.filePath));
    } else {
      const picked = await pickTextFile('.json,.evac,.evac.json');
      if (!picked) return;
      loadProjectPayload(JSON.parse(picked.text), picked.name);
    }
  } catch (e) {
    showToast('Неуспешно отваряне: ' + e.message, true);
    addLog('Неуспешно отваряне: ' + e.message);
  }
}

function newProject() {
  if ((dirty || project.floors.some(f => f.items.length)) && !confirm('Да се създаде ли нов празен проект? Неозаписаните промени ще бъдат загубени.')) return;
  stopSimulation(true);
  project = emptyProject();
  currentFloor = 0;
  selectedId = null;
  history = { past: [], future: [] };
  previewModel = null;
  revision++;
  attachmentMeta.clear();
  dirty = false;
  autosaveEnabled = project.settings.autosave !== false;
  fitView();
  afterProjectChanged();
  writeAutosave();
  addLog('Създаден нов празен проект.');
  showToast('Нов проект.');
}

/* ----------------------------- sample ----------------------------- */

function createSampleProject() {
  const p = emptyProject();
  p.projectName = 'Учебна сграда — пример';
  p.settings.scenario = 'fire';
  p.settings.preMovement = null;
  const room = (name, x, y, w, h, people, teachers) => ({ id: uid(), type: 'room', name, x, y, w, h, people, teachers, width: 1.2 });
  const corridor = (name, x, y, w, h) => ({ id: uid(), type: 'corridor', name, x, y, w, h, width: 1.8 });
  const door = (name, x, y, width) => ({ id: uid(), type: 'door', name, x, y, width: width == null ? 1.2 : width });
  const exit = (name, x, y, width) => ({ id: uid(), type: 'exit', name, x, y, width: width == null ? 1.2 : width });
  const stairs = (name, x, y, width) => ({ id: uid(), type: 'stairs', name, x, y, width: width == null ? 1.4 : width });
  const hazard = (name, x, y, radius) => ({ id: uid(), type: 'hazard', name, x, y, radius });
  const floor1 = {
    id: uid(),
    name: 'Етаж 1',
    backdrop: null,
    items: [
      corridor('Коридор 1', 150, 250, 600, 80),
      room('Класна стая 101', 150, 80, 240, 170, 24, 1),
      room('Класна стая 102', 430, 80, 240, 170, 26, 1),
      room('Склад', 690, 80, 140, 150, 0, 0),
      door('Врата 101', 270, 250, 1.2),
      door('Врата 102', 550, 250, 1.2),
      door('Врата склад', 760, 240, 1.0),
      exit('Изход ляв', 150, 290, 1.2),
      exit('Изход десен', 750, 290, 1.2),
      stairs('Стълбище 1', 470, 292, 1.4),
      hazard('Огнище в склада', 760, 215, 30)
    ]
  };
  const floor2 = {
    id: uid(),
    name: 'Етаж 2',
    backdrop: null,
    items: [
      corridor('Коридор 2', 150, 250, 600, 80),
      room('Класна стая 201', 150, 80, 240, 170, 22, 1),
      room('Класна стая 202', 430, 80, 240, 170, 24, 1),
      room('Библиотека', 690, 80, 140, 150, 15, 1),
      door('Врата 201', 270, 250, 1.2),
      door('Врата 202', 550, 250, 1.2),
      door('Врата библиотека', 760, 240, 1.0),
      stairs('Стълбище 2', 470, 292, 1.4)
    ]
  };
  p.floors = [floor1, floor2];
  return p;
}

function loadSample() {
  if ((dirty || project.floors.some(f => f.items.length)) && !confirm('Да се зареди ли примерният двуетажен план? Текущите обекти ще бъдат заменени.')) return;
  stopSimulation(true);
  project = createSampleProject();
  currentFloor = 0;
  selectedId = null;
  history = { past: [], future: [] };
  previewModel = null;
  revision++;
  attachmentMeta.clear();
  dirty = true;
  autosaveEnabled = project.settings.autosave !== false;
  fitView();
  afterProjectChanged();
  updateAutosaveInfo();
  writeAutosave();
  addLog('Зареден примерен двуетажен план · ' + totalPeople() + ' души.');
  showToast('Примерният план е зареден. Натисни „Стартирай“.');
}

/* ------------------------- test building library ------------------------- */

function libraryOptions() {
  return {
    preset: libraryPresetId,
    seed: clamp(num($('libSeed').value, 1), 1, 999999),
    floors: clamp(num($('libFloors').value, 2), 1, 6),
    roomsPerSide: clamp(num($('libRooms').value, 3), 1, 5),
    people: clamp(num($('libPeople').value, 24), 0, 200),
    hazard: $('libHazard').value
  };
}

function renderLibraryPresets() {
  const box = $('libraryPresets');
  if (!box || !window.BuildingLibrary) return;
  box.replaceChildren();
  BuildingLibrary.PRESETS.forEach(preset => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'library-card' + (preset.id === libraryPresetId ? ' selected' : '');
    const title = document.createElement('strong');
    title.textContent = preset.title;
    const desc = document.createElement('span');
    desc.textContent = preset.description;
    const meta = document.createElement('em');
    meta.textContent = preset.floors + ' ет. · ' + (preset.roomsPerSide * 2) + ' стаи/ет. · ~' + preset.people + ' души';
    card.append(title, desc, meta);
    card.addEventListener('click', () => {
      libraryPresetId = preset.id;
      $('libFloors').value = preset.floors;
      $('libRooms').value = preset.roomsPerSide;
      $('libPeople').value = preset.people;
      $('libHazard').value = preset.hazard || 'none';
      renderLibraryPresets();
      updateLibrarySummary();
    });
    box.append(card);
  });
}

function updateLibrarySummary() {
  const box = $('libSummary');
  if (!box) return;
  if (!window.BuildingLibrary) {
    box.textContent = 'Модулът за генериране не е зареден.';
    return;
  }
  const testProject = BuildingLibrary.generate(libraryOptions());
  box.textContent = BuildingLibrary.summaryText(testProject) + ' · seed ' + libraryOptions().seed;
}

function openLibraryDialog() {
  if (!window.BuildingLibrary) {
    showToast('Библиотеката с тестови сгради не е заредена.', true);
    return;
  }
  renderLibraryPresets();
  updateLibrarySummary();
  const dialog = $('libraryDialog');
  if (dialog && !dialog.open) dialog.showModal();
}

function generateLibraryBuilding() {
  if (!window.BuildingLibrary) {
    showToast('Библиотеката с тестови сгради не е заредена.', true);
    return;
  }
  if ((dirty || project.floors.some(f => f.items.length)) && !confirm('Да се зареди ли генерираната тестова сграда? Текущите обекти ще бъдат заменени.')) return;
  const generated = BuildingLibrary.generate(libraryOptions());
  stopSimulation(true);
  project = generated;
  currentFloor = 0;
  selectedId = null;
  history = { past: [], future: [] };
  previewModel = null;
  revision++;
  attachmentMeta.clear();
  dirty = true;
  autosaveEnabled = project.settings.autosave !== false;
  fitView();
  afterProjectChanged();
  updateAutosaveInfo();
  writeAutosave();
  closeDialog('libraryDialog');
  addLog('Заредена тестова сграда: ' + project.projectName + ' · ' + totalPeople() + ' души.');
  showToast('Тестовата сграда е заредена. Натисни „Стартирай“.');
}

/* ----------------------------- events ----------------------------- */

function closeDialog(id) {
  const dialog = $(id);
  if (dialog && dialog.open) dialog.close();
}

function onKeyDown(event) {
  if (tourActive) {
    if (event.key === 'Escape') {
      event.preventDefault();
      endTour();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      tourGo(1);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      tourGo(-1);
      return;
    }
  }
  const target = event.target;
  const typing = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  const dialogOpen = !!document.querySelector('dialog[open]');
  if (event.key === ' ' && !typing && !dialogOpen) {
    event.preventDefault();
    spaceDown = true;
    svg.classList.add('panning');
    return;
  }
  if (dialogOpen) return;
  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (key === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (key === 's') {
      event.preventDefault();
      saveProjectFile();
      return;
    }
    if (key === 'o') {
      event.preventDefault();
      openProjectFile();
      return;
    }
  }
  if (typing) return;
  const key = event.key.toLowerCase();
  if (key === 'delete' || key === 'backspace') {
    event.preventDefault();
    deleteSelected();
    return;
  }
  if (key === 'escape') {
    draft = null;
    interaction = null;
    selectedId = null;
    renderObjectEditor();
    updateBackdropPanel();
    draw();
    return;
  }
  const tools = { v: 'select', r: 'room', c: 'corridor', d: 'door', e: 'exit', s: 'stairs', p: 'people', h: 'hazard' };
  if (tools[key]) {
    event.preventDefault();
    setTool(tools[key]);
  }
}

function onKeyUp(event) {
  if (event.key === ' ') {
    spaceDown = false;
    svg.classList.remove('panning');
    svg.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  }
}

const TOUR_STEPS = [
  {
    target: '#loadSample',
    title: 'Примерен план',
    text: 'Най-бързият старт е „Примерен план“. Ще заредиш двуетажна учебна сграда с помещения, коридори, врати, изходи и хора.'
  },
  {
    target: '#openLibrary',
    title: 'Библиотека с тестови сгради',
    text: 'Оттук генерираш училище, офис, хотел, болница или търговски център с избран seed, брой етажи, стаи и хора. Сградите са удобни за тестове и демонстрации.'
  },
  {
    target: '#floorSelect',
    title: 'Етажи',
    text: 'Тук превключваш между етажите. „＋ Етаж“ добавя нов, а „Дублирай“ копира текущия. Стълбищата на еднакви позиции се свързват автоматично.'
  },
  {
    target: '.tool[data-tool="room"]',
    title: 'Помещение',
    text: 'Избери „Помещение“ и плъзни правоъгълник върху плана (или щракни два пъти). След това задай име, хора, учители и ширина.'
  },
  {
    target: '.tool[data-tool="corridor"]',
    title: 'Коридор',
    text: 'Коридорът свързва помещенията. Начертай го по същия начин. Вратите и изходите трябва да попадат върху него.'
  },
  {
    target: '.tool[data-tool="door"]',
    title: 'Врати и размер',
    text: 'Щракни на границата между помещение и коридор, за да сложиш врата. Избери я и плъзни кръгчето вдясно от нея — така променяш ширината. Можеш и с полето/плъзгача „Избран обект“.'
  },
  {
    target: '.tool[data-tool="exit"]',
    title: 'Авариен изход',
    text: 'Изходът е крайна точка на маршрута. Постави го върху коридор или външна стена. Размерът му също се променя с кръгчето или плъзгача.'
  },
  {
    target: '.tool[data-tool="stairs"]',
    title: 'Стълбище',
    text: 'Стълбището свързва етажите. Постави го на еднаква позиция на всеки етаж, за да се получи обща шахта. Размерът влияе на капацитета.'
  },
  {
    target: '#peopleCount',
    title: 'Хора',
    text: 'Задай брой хора и учители, после използвай инструмента „Група хора“ или въведи хората директно в помещение. Тези стойности участват в симулацията.'
  },
  {
    target: '.tool[data-tool="hazard"]',
    title: 'Опасна зона',
    text: 'С инструмента „Опасна зона“ маркираш пожар, вода или блокирана зона. След избиране задай радиус, скорост на разпространение и максимален обхват.'
  },
  {
    target: '#showSpread',
    title: 'Разпространение',
    text: 'Тази отметка показва на картата как опасността расте във времето — плътният кръг е текущият обхват, а пунктираните са прогноза за +30, +60 и +120 секунди. Панелът отдолу показва кои помещения и изходи ще бъдат достигнати.'
  },
  {
    target: '.scenario[data-scenario="fire"]',
    title: 'Сценарии',
    text: 'Избери пожар, земетресение, наводнение или защитно укриване. Сценарият определя реакцията, капацитетите и дали опасните зони блокират маршрути.'
  },
  {
    target: '#run',
    title: 'Стартирай симулацията',
    text: 'Симулацията движи всеки човек по маршрут, отчита капацитета на врати, изходи и стълбища и създава опашки. „Пауза“ и „Стоп“ контролират изпълнението.'
  },
  {
    target: '.bottomstats',
    title: 'Статистика',
    text: 'Тук виждаш общо хора, хора в безопасност, чакащи в опашка, симулационно време и процент завършена евакуация.'
  },
  {
    target: '#objectEditor',
    title: 'Избран обект',
    text: 'Избери обект от плана, за да редактираш името, координатите, хората, ширината, радиуса и разпространението. Промените се записват автоматично.'
  },
  {
    target: '#undo',
    title: 'Отмяна и повторение',
    text: 'Стрелките или Ctrl+Z / Ctrl+Y връщат и повтарят действия. Проектът се записва автоматично, а вдясно виждаш часа на последния авто-запис.'
  },
  {
    target: '#saveProject',
    title: 'Запази проекта',
    text: '„Запази“ създава .evac.json файл, който може да отвориш по-късно. Прикачените файлове се пазят като пътища, не се вграждат в JSON.'
  },
  {
    target: '#exportPdf',
    title: 'Експорт',
    text: 'Експортирай SVG или PNG на текущия етаж, или PDF отчет с всички етажи, статистика, маршрути и проверки.'
  },
  {
    target: '#attachFiles',
    title: 'Материали',
    text: 'Прикачи PDF, снимка, SVG, DOCX, XLSX или TXT. Изображение или PDF може да стане подложка на етажа и да се мащабира, завърта и избледнява.'
  },
  {
    target: '#openSettings',
    title: 'Настройки',
    text: 'Оттук променяш мащаба, височината на етаж, скоростта на ходене, специфичния поток, скоростта на разпространение и авто-записа.'
  },
  {
    target: '.legend',
    title: 'Легенда',
    text: 'Легендата обяснява цветовете и символите. С нея клиентът бързо разбира кой обект какво означава.'
  },
  {
    target: '#tourBtn',
    title: 'Готово!',
    text: 'Това е обучението. Можеш да го пуснеш отново по всяко време с „✦ Обучение“ или от „? Помощ“. Натисни „Готово“, за да започнеш.'
  }
];

function startTour(index) {
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  tourActive = true;
  tourIndex = clamp(num(index, 0), 0, TOUR_STEPS.length - 1);
  $('tourOverlay').hidden = false;
  document.body.classList.add('tour-on');
  showTourStep();
}

function endTour() {
  tourActive = false;
  tourElement = null;
  const overlay = $('tourOverlay');
  if (overlay) overlay.hidden = true;
  document.body.classList.remove('tour-on');
}

function tourGo(delta) {
  if (!tourActive) return;
  const next = tourIndex + delta;
  if (next < 0) return;
  if (next >= TOUR_STEPS.length) {
    endTour();
    showToast('Обучението приключи.');
    return;
  }
  tourIndex = next;
  showTourStep();
}

function showTourStep() {
  if (!tourActive) return;
  const step = TOUR_STEPS[tourIndex];
  if (!step) { endTour(); return; }
  const el = document.querySelector(step.target);
  if (!el) {
    if (tourIndex < TOUR_STEPS.length - 1) { tourIndex += 1; showTourStep(); }
    else endTour();
    return;
  }
  tourElement = el;
  $('tourStepLabel').textContent = (tourIndex + 1) + ' / ' + TOUR_STEPS.length;
  $('tourTitle').textContent = (tourIndex + 1) + '. ' + step.title;
  $('tourText').textContent = step.text;
  $('tourPrev').disabled = tourIndex === 0;
  $('tourNext').textContent = tourIndex === TOUR_STEPS.length - 1 ? 'Готово' : 'Напред →';
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  positionTour();
  requestAnimationFrame(() => {
    positionTour();
    setTimeout(positionTour, 80);
  });
}

function positionTour() {
  if (!tourActive || !tourElement) return;
  const rect = tourElement.getBoundingClientRect();
  if (!rect.width && !rect.height) return;
  const spot = $('tourSpot');
  const tip = $('tourTip');
  const pad = 5;
  spot.style.left = Math.max(0, rect.left - pad) + 'px';
  spot.style.top = Math.max(0, rect.top - pad) + 'px';
  spot.style.width = (rect.width + pad * 2) + 'px';
  spot.style.height = (rect.height + pad * 2) + 'px';
  const tipRect = tip.getBoundingClientRect();
  const gap = 12;
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  let top = rect.bottom + gap;
  if (top + tipRect.height > window.innerHeight - 12) top = rect.top - tipRect.height - gap;
  if (top < 12) top = Math.max(12, window.innerHeight - tipRect.height - 12);
  left = clamp(left, 12, Math.max(12, window.innerWidth - tipRect.width - 12));
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

function bindEvents() {
  document.querySelectorAll('.tool').forEach(btn => {
    btn.addEventListener('click', () => {
      if (isSimActive()) {
        showToast('Спри симулацията, за да редактираш.');
        return;
      }
      setTool(btn.dataset.tool);
    });
  });

  $('floorSelect').addEventListener('change', event => {
    currentFloor = clamp(Number(event.target.value), 0, project.floors.length - 1);
    selectedId = null;
    renderObjectEditor();
    updateBackdropPanel();
    draw();
    updateStats();
    refreshFloorSelect();
  });

  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  $('addFloor').addEventListener('click', addFloor);
  $('renameFloor').addEventListener('click', renameFloor);
  $('duplicateFloor').addEventListener('click', duplicateFloor);
  $('removeFloor').addEventListener('click', removeFloor);
  $('deleteSelected').addEventListener('click', deleteSelected);
  $('duplicateSelected').addEventListener('click', duplicateSelected);
  $('clearFloor').addEventListener('click', () => {
    if (!confirm('Да се изчистят ли всички обекти и подложката на текущия етаж?')) return;
    stopSimulation(true);
    pushHistory();
    const floor = currentFloorData();
    floor.items = [];
    floor.backdrop = null;
    selectedId = null;
    markDirty();
    afterProjectChanged();
    addLog('Изчистен текущ етаж.');
  });

  $('zoomIn').addEventListener('click', () => zoomAt(1.25));
  $('zoomOut').addEventListener('click', () => zoomAt(1 / 1.25));
  $('zoomFit').addEventListener('click', fitView);

  $('run').addEventListener('click', startSimulation);
  $('pause').addEventListener('click', pauseSimulation);
  $('stop').addEventListener('click', () => stopSimulation(false));
  $('speedSelect').addEventListener('change', () => { simAccumulator = 0; });

  $('showRoutes').addEventListener('change', event => {
    project.settings.showRoutes = event.target.checked;
    markDirty();
    draw();
  });

  const showSpreadBox = $('showSpread');
  if (showSpreadBox) {
    showSpreadBox.addEventListener('change', event => {
      project.settings.showSpread = event.target.checked;
      markDirty();
      draw();
      updateSpreadPanel();
    });
  }

  $('preMovement').addEventListener('change', event => {
    const raw = String(event.target.value || '').trim();
    project.settings.preMovement = raw === '' ? null : Math.max(0, num(raw, 0));
    markDirty();
    updateScenarioUI();
    refreshAnalysis();
    draw();
    addLog(raw === '' ? 'Реакцията е автоматична според сценария.' : 'Реакция преди движение: ' + raw + ' s.');
  });

  document.querySelectorAll('.scenario').forEach(el => {
    el.addEventListener('click', () => {
      if (isSimActive()) {
        showToast('Спри симулацията, за да смениш сценария.');
        return;
      }
      const next = el.dataset.scenario;
      if (project.settings.scenario === next) return;
      pushHistory();
      project.settings.scenario = next;
      markDirty();
      updateScenarioUI();
      refreshAnalysis();
      draw();
      const labels = EvacSim.SCENARIO_LABELS || {};
      addLog('Избран сценарий: ' + (labels[next] || next) + '.');
    });
  });

  $('newProject').addEventListener('click', newProject);
  $('loadSample').addEventListener('click', loadSample);
  $('openLibrary').addEventListener('click', openLibraryDialog);
  $('libRandom').addEventListener('click', () => {
    if (!window.BuildingLibrary) return;
    $('libSeed').value = BuildingLibrary.randomSeed();
    updateLibrarySummary();
  });
  $('libGenerate').addEventListener('click', generateLibraryBuilding);
  ['libSeed', 'libFloors', 'libRooms', 'libPeople', 'libHazard'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', updateLibrarySummary);
    el.addEventListener('change', updateLibrarySummary);
  });
  $('openSettings').addEventListener('click', openSettings);
  $('openHelp').addEventListener('click', () => {
    const dialog = $('helpDialog');
    if (dialog && !dialog.open) dialog.showModal();
  });

  $('tourBtn').addEventListener('click', () => startTour(0));
  const startHelpTour = $('startTourFromHelp');
  if (startHelpTour) {
    startHelpTour.addEventListener('click', () => {
      closeDialog('helpDialog');
      startTour(0);
    });
  }
  $('tourNext').addEventListener('click', () => tourGo(1));
  $('tourPrev').addEventListener('click', () => tourGo(-1));
  $('tourSkip').addEventListener('click', endTour);
  window.addEventListener('resize', positionTour);
  document.addEventListener('scroll', positionTour, true);
  $('saveProject').addEventListener('click', saveProjectFile);
  $('openProject').addEventListener('click', openProjectFile);

  $('attachFiles').addEventListener('click', attachFiles);
  $('clearBackdrop').addEventListener('click', clearBackdrop);

  const backdropRange = (id, prop, scale) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('pointerdown', beginBackdropEdit);
    el.addEventListener('focus', beginBackdropEdit);
    el.addEventListener('input', () => {
      const b = currentFloorData().backdrop;
      if (!b) return;
      beginBackdropEdit();
      commitBackdropEditSnapshot();
      const value = Number(el.value);
      b[prop] = scale ? value / 100 : value;
      updateBackdropLabels();
      markDirty();
      draw();
    });
    el.addEventListener('change', endBackdropEdit);
    el.addEventListener('blur', endBackdropEdit);
  };
  backdropRange('backdropOpacity', 'opacity', true);
  backdropRange('backdropScale', 'scale', true);
  backdropRange('backdropRotation', 'rotation', false);

  ['backdropX', 'backdropY'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('focus', beginBackdropEdit);
    el.addEventListener('input', () => {
      const b = currentFloorData().backdrop;
      if (!b) return;
      beginBackdropEdit();
      commitBackdropEditSnapshot();
      const value = Math.round(num(el.value, 0));
      if (id === 'backdropX') b.x = value; else b.y = value;
      markDirty();
      draw();
    });
    el.addEventListener('blur', endBackdropEdit);
  });

  $('backdropVisible').addEventListener('change', event => {
    const b = currentFloorData().backdrop;
    if (!b) return;
    beginBackdropEdit();
    commitBackdropEditSnapshot();
    b.visible = event.target.checked;
    markDirty();
    draw();
    endBackdropEdit();
  });

  $('backdropFit').addEventListener('click', () => {
    const b = currentFloorData().backdrop;
    if (!b) return;
    beginBackdropEdit();
    commitBackdropEditSnapshot();
    b.scale = 1;
    b.x = 0;
    b.y = 0;
    b.rotation = 0;
    markDirty();
    updateBackdropPanel();
    draw();
    endBackdropEdit();
  });

  $('backdropOpen').addEventListener('click', () => {
    const b = currentFloorData().backdrop;
    if (b) openAttachment(b.attachmentId);
  });

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeDialog(btn.dataset.close));
  });

  $('settingsSave').addEventListener('click', saveSettings);
  $('clearAutosave').addEventListener('click', clearAutosave);

  $('exportSvg').addEventListener('click', () => openExportDialog('svg'));
  $('exportPng').addEventListener('click', () => openExportDialog('png'));
  $('exportPdf').addEventListener('click', () => openExportDialog('pdf'));

  document.querySelectorAll('input[name="exportFormat"]').forEach(radio => {
    radio.addEventListener('change', syncExportScope);
  });

  $('exportRun').addEventListener('click', async () => {
    const selected = document.querySelector('input[name="exportFormat"]:checked');
    const format = selected ? selected.value : 'svg';
    const scope = $('exportScope').value;
    const options = {
      routes: $('exportRoutes').checked,
      agents: $('exportAgents').checked,
      legend: $('exportLegend').checked
    };
    closeDialog('exportDialog');
    try {
      if (format === 'pdf' || scope === 'all') {
        await exportPdfReport(scope, options);
      } else {
        await exportCurrentFloor(format, options);
      }
    } catch (e) {
      showToast('Грешка при експорт: ' + e.message, true);
      addLog('Грешка при експорт: ' + e.message);
    }
  });

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);
  svg.addEventListener('pointerleave', () => { if (!interaction) updateCoordsText(null); });
  svg.addEventListener('wheel', event => {
    event.preventDefault();
    zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, svgPoint(event));
  }, { passive: false });
  svg.addEventListener('contextmenu', event => event.preventDefault());
  svg.addEventListener('dblclick', event => {
    if (isSimActive()) return;
    const hit = hitTest(svgPoint(event));
    if (!hit) return;
    selectedId = hit.id;
    renderObjectEditor();
    draw();
    const first = $('objectEditor').querySelector('input');
    if (first) {
      first.focus();
      if (first.select) first.select();
    }
  });

  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('beforeunload', () => {
    if (autosaveEnabled && project) writeAutosave();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && autosaveEnabled && project) writeAutosave();
  });
}

/* ----------------------------- init ----------------------------- */

function init() {
  if (!EvacSim || !EvacSim.buildModel || !EvacSim.createSimulation) {
    document.body.innerHTML = '<main style="padding:40px"><h2>Грешка при зареждане</h2><p>Симулационните модули не са намерени. Провери файловете simulation-engine.js и simulation-runner.js.</p></main>';
    return;
  }
  bindEvents();
  const restored = restoreAutosave();
  if (!restored) {
    project = emptyProject();
    currentFloor = 0;
    autosaveEnabled = project.settings.autosave !== false;
  }
  dirty = restored ? true : false;
  applyView();
  updateHeader();
  updateScenarioUI();
  updateBackdropPanel();
  afterProjectChanged();
  updateAutosaveInfo();
  syncSimButtons();
  setTool('select');
  addLog('Evacuation Simulator v0.5.0 — учебен прототип.');
  if (restored) {
    addLog('Възстановен е авто-запис от ' + (lastAutosaveAt || 'предишен сеанс') + '.');
    showToast('Възстановен е авто-запис.');
  } else {
    addLog('Натисни „Примерен план“, за да започнеш бързо.');
  }
  validateAttachments();
  updateHistoryButtons();
}

init();



