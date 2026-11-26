'use strict';

/* ============================================================
 * Evacuation Simulator v0.10.0 — UI / editor / simulation glue
 * ============================================================ */

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const SVG_W = 900;
const SVG_H = 590;
const APP_VERSION = '0.11.10';
const Extras = window.EvacExtras;
const Security = window.EvacSecurity;
const AUTOSAVE_KEY = 'evacuation-simulator:autosave:v3';
const desktop = window.evacuationDesktop || null;
const EvacSim = window.EvacSim || {};
const Furnishing = window.EvacFurnishing || null;
const LabelLayout = window.EvacLabelLayout || null;
const Materials = window.EvacMaterials || { MATERIALS: {}, DEFAULT: "standard", get: () => ({name:"Бетон",color:"#7c92a4"}) };
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
let simHistory = [];
let replayIndex = -1;
let lastTableAt = 0;
let spaceDown = false;
let idCounter = 0;
let attachmentMeta = new Map();
let toastTimer = null;
let history = { past: [], future: [] };
let tourActive = false;
let tourIndex = 0;
let tourElement = null;
let scene3dController = null;
let smartImportController = null;
let selectedAgentId = null;
let libraryPresetId = 'school';
let workspaceView = 'project';
let chosenMaterialId = 'wood';

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
      fireSpreadMultiplier: 0.8,
      fireExposureLimitSeconds: 35,
      showSpread: true,
      dynamicRouting: true,
      fireExitSafetyMeters: 2,
      showSmoke: true,
      showHeatmap: false,
      showMovementEffects: false,
      smokeFactor: 2.2,
      smokeSlowdown: 0.55,
      smokeVisibilityMeters: 5,
      populationProfiles: { children: 15, older: 15, limited: 0 },
      windDirection: 0, windStrength: 0, waitForAssistance: true, allowFireElevator: false,
      ...Extras.defaults,
      ...Security.defaults,
      securityEnhancedEnabled: true,
      ...EvacDisasters.defaults
    },
    floors: [{ id: uid(), name: 'Етаж 1', items: [], backdrop: null }],
    attachments: [],
    baseline: null
  };
}

function sanitizeProject(raw) {
  if (!raw || raw.format !== 'evacuation-simulator' || !Array.isArray(raw.floors) || !raw.floors.length) {
    throw new Error('Невалиден файл на проект.');
  }
  const base = emptyProject();
  const settings = Extras.normalize(Object.assign({}, base.settings, raw.settings || {}));
  Object.assign(settings, EvacDisasters.normalize(settings));
  Object.assign(settings, Security.normalize(settings));
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
  settings.fireSpreadMultiplier = clamp(num(settings.fireSpreadMultiplier, 0.8), 0.2, 1.5);
  settings.fireExposureLimitSeconds = clamp(num(settings.fireExposureLimitSeconds, 35), 5, 600);
  settings.showSpread = settings.showSpread !== false;
  settings.dynamicRouting = settings.dynamicRouting !== false;
  settings.fireExitSafetyMeters = clamp(num(settings.fireExitSafetyMeters, 2), 0.5, 10);
  settings.showSmoke = settings.showSmoke !== false;
  settings.showHeatmap = settings.showHeatmap === true;
  settings.showMovementEffects = settings.showMovementEffects === true;
  settings.smokeFactor = clamp(num(settings.smokeFactor, 2.2), 1, 5);
  settings.smokeSlowdown = clamp(num(settings.smokeSlowdown, 0.55), 0.2, 1);
  settings.smokeVisibilityMeters = clamp(num(settings.smokeVisibilityMeters, 5), 1, 30);
  settings.windDirection = ((num(settings.windDirection, 0) % 360) + 360) % 360;
  settings.windStrength = clamp(num(settings.windStrength, 0), 0, 0.8);
  settings.waitForAssistance = settings.waitForAssistance !== false;
  settings.allowFireElevator = settings.allowFireElevator === true;
  const mix = settings.populationProfiles || {};
  settings.populationProfiles = { children: clamp(num(mix.children, 15), 0, 100), older: clamp(num(mix.older, 15), 0, 100), limited: clamp(num(mix.limited, 0), 0, 100) };
  if (Object.values(settings.populationProfiles).reduce((a,b) => a+b, 0) > 100) {
    const total = Object.values(settings.populationProfiles).reduce((a,b) => a+b, 0);
    Object.keys(settings.populationProfiles).forEach(k => settings.populationProfiles[k] = settings.populationProfiles[k] * 100 / total);
  }

  const floors = raw.floors.map((floor, index) => {
    const items = (Array.isArray(floor && floor.items) ? floor.items : []).filter(Boolean).map(item => {
      const it = Object.assign({}, item);
      it.id = it.id == null ? uid() : it.id;
      it.type = it.type || 'room';
      it.x = num(it.x, 0);
      it.y = num(it.y, 0);
      if (it.type === 'room' || it.type === 'corridor' || it.type === 'courtyard' || it.type === 'surface' || it.type === 'reference') {
        it.w = Math.max(12, num(it.w, 80));
        it.h = Math.max(12, num(it.h, 60));
        it.width = clamp(num(it.width, 1.2), 0.2, 20);
        it.people = Math.max(0, Math.round(num(it.people, 0)));
        it.teachers = Math.max(0, Math.round(num(it.teachers, 0)));
        it.name = it.name || (it.type === 'room' ? 'Помещение' : it.type === 'courtyard' ? 'Общ двор' : it.type === 'surface' ? 'Повърхност' : 'Коридор');
        it.buildingId = String(it.buildingId || (it.type === 'courtyard' ? 'външна зона' : 'A')).slice(0, 40);
        it.materialId = Materials.MATERIALS[it.materialId] ? it.materialId : (it.type === 'surface' ? 'wood' : 'standard');
      } else if (it.type === 'furniture') {
        it.furnitureType = Furnishing && Furnishing.TYPES[it.furnitureType] ? it.furnitureType : 'desk';
        it.w = clamp(num(it.w, 28), 7, 180);
        it.h = clamp(num(it.h, 17), 7, 180);
        it.name = it.name || (Furnishing ? Furnishing.TYPES[it.furnitureType].label : 'Мебел');
      } else if (it.type === 'threat') {
        it.name = it.name || 'Опасен човек · учебен символ';
        it.entryAtSeconds=clamp(num(it.entryAtSeconds,0),0,3600);
      } else if (it.type === 'wall') {
        it.x2 = clamp(num(it.x2, it.x + 60), 0, SVG_W);
        it.y2 = clamp(num(it.y2, it.y), 0, SVG_H);
        it.thickness = clamp(num(it.thickness, 0.2), 0.05, 2);
        it.name = it.name || 'Стена';
        it.materialId = Materials.isKnown(it.materialId) ? it.materialId : 'standard';
      } else if (it.type === 'people') {
        it.count = Math.max(0, Math.round(num(it.count, 0)));
        it.name = it.name || 'Група';
      } else if (it.type === 'hazard') {
        it.radius = clamp(num(it.radius, 27), 6, 600);
        it.spread = it.spread !== false;
        if (it.spreadSpeed != null) it.spreadSpeed = clamp(num(it.spreadSpeed, 0.4), 0.02, 10);
        it.maxRadius = clamp(num(it.maxRadius, 30), 1, 500);
        it.name = it.name || 'Опасна зона';
        // Version 0.11.6 and earlier: the library's default test fire used
        // .03 while newly added fire markers used .4. Upgrade that known
        // library preset only; preserve deliberate user-defined values.
        if (/^Огнище \(тест\)$/.test(it.name) &&
            Math.abs(num(it.spreadSpeed, settings.spreadSpeed)-0.03)<1e-6) {
          it.spreadSpeed=settings.spreadSpeed;
          if(Math.abs(it.maxRadius-15)<1e-6)it.maxRadius=30;
        }
      } else if (['door','opening','exit','stairs','elevator','safezone'].includes(it.type)) {
        it.width = clamp(num(it.width, 1.2), 0.2, 10);
        if (it.type === 'door') {
          it.doorState = ['open','closed','locked','damaged','automatic'].includes(it.doorState) ? it.doorState : 'open';
          it.fireDoorClosed = it.fireDoorClosed === true;
          it.fireDoorCloseAtSeconds = clamp(num(it.fireDoorCloseAtSeconds, 0), 0, 3600);
        }
        it.name = it.name || ({door:'Врата',opening:'Отвор',exit:'Изход',stairs:'Стълбище',elevator:'Асансьор',safezone:'Безопасна зона'}[it.type]);
      } else if (['vent','window','ventshaft'].includes(it.type)) {
        it.name = it.name || ({vent:'Вентилатор',window:'Прозорец',ventshaft:'Вентилационна шахта'}[it.type]);
        it.strength = clamp(num(it.strength,0.5),0,0.8);
        it.direction = ((num(it.direction,0)%360)+360)%360;
        it.open = it.open !== false;
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
    attachments,
    baseline: raw.baseline && typeof raw.baseline === 'object' ? Object.assign({}, raw.baseline) : null
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
    ensureSecurityMarker(); // Restore older threat projects that have no marker.
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
  renderScenarioExtras();
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

// Огнищата са обекти на пожарния сценарий. Запазват се при смяна на
// сценария, но не се показват или избират при наводнение/земетресение.
function isItemVisibleInScenario(item, scenario) {
  return (item.type !== 'hazard' || scenario === 'fire') &&
    (item.type !== 'threat' || scenario === 'lockdown');
}

// Keep the security scenario usable without requiring users to know about an
// extra placement tool. Adds one movable, editable marker only when missing.
// The user can still add multiple markers or move/delete the starter marker.
function ensureSecurityMarker(){
  if(!project || project.settings.scenario!=='lockdown')return false;
  if(project.floors.some(f=>(f.items||[]).some(it=>it.type==='threat')))return false;
  const at=Security && Security.starterLocation
    ? Security.starterLocation(project.floors,currentFloor)
    : {floor:currentFloor,x:450,y:295};
  const floor=project.floors[at.floor]||project.floors[0];
  if(!floor)return false;
  floor.items.push({id:uid(),type:'threat',name:'Обозначител на заплаха (премести ме)',
    x:at.x,y:at.y,entryAtSeconds:0});
  return true;
}

function setTool(nextTool) {
  if (nextTool === 'hazard' && project && project.settings.scenario !== 'fire') {
    showToast('Огнища се поставят само в сценарий „Пожар“.');
    return;
  }
  tool = nextTool;
  if (nextTool === 'surface' && workspaceView !== 'advanced') switchWorkspace('advanced');
  document.querySelectorAll('.tool[data-tool], .mini-tool[data-tool]').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
  const hints = {
    select: 'Избери обект, за да го преместиш. Плъзни за преместване; Alt + плъзгане — панорама.',
    room: 'Плъзни правоъгълник за помещение или щракни два пъти (начален и краен ъгъл).',
    corridor: 'Плъзни правоъгълник за коридор или щракни два пъти.',
    door: 'Щракни на границата между помещение и коридор, за да поставиш врата.',
    exit: 'Щракни върху външна стена/коридор за авариен изход.',
    stairs: 'Щракни върху коридор. Еднаквите позиции на различните етажи се свързват.',
    people: 'Щракни, за да поставиш група хора с въведените брой и име.',
    furniture: 'Щракни върху плана, за да добавиш избраната мебел. Обзавеждане на цяла стая: избери стаята и натисни „Обзаведи“.', 
    hazard: 'Щракни, за да добавиш огнище в сценарий „Пожар“.',
    vent: 'Постави аспиратор/вентилатор. Работи при включена вентилация.',
    window: 'Постави прозорец. Избери го, за да го отвориш или затвориш.',
    ventshaft: 'Постави вентилационна шахта за учебния модел на дим.',
    wall: 'Плъзни линия между началото и края на стената; дебелината се задава в редактора.',
    opening: 'Щракни върху стена между две помещения за отвор.',
    elevator: 'Постави асансьор до коридор; еднаквите идентификатори на шахтата се свързват.',
    safezone: 'Постави зона за изчакване на помощ до коридор.',
    courtyard: 'Изчертай общ двор като правоъгълник; добави врати и външни изходи за свързване.',
    surface: 'Advanced Build: очертай правоъгълна зона с избрания материал. Зоните променят скоростта и разпространението на опасностите.'
  };
  $('toolHint').textContent = hints[tool] || '';
  $('canvasNote').textContent = tool === 'select' ? 'РАБОТНА ЗОНА · ИЗБОР И ПРЕМЕСТВАНЕ' : 'РАБОТНА ЗОНА · ЩРАКНИ ЗА ДОБАВЯНЕ';
  svg.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  draft = null;
  draw();
}

function updateScenarioUI() {
  const fireScenario = project.settings.scenario === 'fire';
  document.querySelectorAll('.tool[data-tool="hazard"], .mini-tool[data-tool="hazard"]').forEach(button => {
    button.disabled = !fireScenario;
    button.title = fireScenario ? 'Добави огнище (H)' : 'Огнища се поставят само в сценарий „Пожар“';
  });
  if (!fireScenario && tool === 'hazard') setTool('select');
  if (!fireScenario && selectedItem() && selectedItem().type === 'hazard') {
    selectedId = null;
    renderObjectEditor();
  }
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
  renderScenarioExtras();
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
  if ($('showSmoke')) $('showSmoke').checked = project.settings.showSmoke !== false;
  if ($('showHeatmap')) $('showHeatmap').checked = project.settings.showHeatmap === true;
  $('gridRect').setAttribute('width', SVG_W);
  $('gridRect').setAttribute('height', SVG_H);
  const defs = svg.querySelector('defs');
  if (defs) defs.querySelectorAll('[data-hazard-source-clip]').forEach(el => el.remove());

  Array.from(svg.children).forEach(child => {
    if (child.tagName.toLowerCase() === 'defs' || child.id === 'gridRect') return;
    child.remove();
  });

  const backdropLayer = svgEl('g', { class: 'layer backdrop' });
  svg.append(backdropLayer);
  drawBackdrop(backdropLayer);

  const modelForExitStatus = activeSim ? activeSim.model : getPreviewModel();
  const currentStateForExits = activeSim ? displayState() : null;
  const blockedAtThisTime = currentStateForExits ? currentStateForExits.blockedExits || [] :
    (modelForExitStatus && modelForExitStatus.exits || []).filter(e => e.blocked);
  const blockedExitRefs = new Set(blockedAtThisTime
    .filter(e => e.floor === currentFloor)
    .map(e => String((modelForExitStatus && modelForExitStatus.nodes.get(e.id) || {}).refId)));
  // An imported image can contain many small classrooms; hiding colliding
  // captions keeps the actual plan legible until a room is selected.
  const labelLayout = LabelLayout ? LabelLayout.analyze(floor.items, { hasBackdrop: !!floor.backdrop }) : { compact: false };
  const compactLabels = labelLayout.compact;
  if ($('canvasNote')) $('canvasNote').textContent = compactLabels
    ? 'ПРЕТРУПАН ПЛАН · ЩРАКНИ ВЪРХУ СТАЯ ЗА ПОДРОБНОСТИ'
    : 'РАБОТНА ЗОНА · ЩРАКНИ ЗА ДОБАВЯНЕ';
  const spaceLayer = svgEl('g', { class: 'layer spaces' });
  floor.items.filter(item => ['room','corridor','courtyard','reference'].includes(item.type)).forEach(item => {
    const node = createObjectNode(item, blockedExitRefs, compactLabels);
    if (node) spaceLayer.append(node);
  });
  svg.append(spaceLayer);
  const materialsLayer = svgEl('g', { class: 'layer material-overlays' });
  floor.items.filter(item => item.type === 'surface').forEach(item => {
    const node = createObjectNode(item, null, compactLabels);
    if (node) materialsLayer.append(node);
  });
  svg.append(materialsLayer);
  const objectLayer = svgEl('g', { class: 'layer objects' });
  floor.items.filter(item => !['surface','room','corridor','courtyard','reference'].includes(item.type) &&
    !(item.type==='threat' && activeSim && displayState()) &&
    isItemVisibleInScenario(item, project.settings.scenario)).forEach(item => {
    const node = createObjectNode(item, blockedExitRefs, compactLabels);
    if (node) objectLayer.append(node);
  });
  svg.append(objectLayer);

  const heatLayer = svgEl('g', { class: 'layer heatmap' });
  drawHeatmap(heatLayer);
  svg.append(heatLayer);

  const spreadLayer = svgEl('g', { class: 'layer spread' });
  drawSpread(spreadLayer);
  svg.append(spreadLayer);

  const smokeLayer = svgEl('g', { class: 'layer smoke' });
  drawSmoke(smokeLayer);
  svg.append(smokeLayer);

  const securityLayer=svgEl('g',{class:'layer security-overlays','pointer-events':'none'});
  drawSecurityIndicators(securityLayer);
  svg.append(securityLayer);

  const routeLayer = svgEl('g', { class: 'layer routes' });
  drawRoutes(routeLayer);
  svg.append(routeLayer);

  const motionLayer = svgEl('g', { class: 'layer movement-effects' });
  drawMovementEffects(motionLayer);
  svg.append(motionLayer);

  const agentLayer = svgEl('g', { class: 'layer agents' });
  drawAgents(agentLayer);
  svg.append(agentLayer);
  renderTrackingPanel();

  const draftLayer = svgEl('g', { class: 'layer draft' });
  drawDraft(draftLayer);
  svg.append(draftLayer);

  if (compactLabels) drawSelectedRoomLabel(svg);

  const handleLayer = svgEl('g', { class: 'layer handles' });
  drawHandles(handleLayer);
  svg.append(handleLayer);

  drawScaleBar();
  // Shake the entire 2D plan as one unit; no room-by-room radial propagation.
  // This offset affects only the rendering, not routes or simulation coordinates.
  const replayState=displayState();
  const quakeMotion=project.settings.scenario==='quake' && replayState && window.EvacDisasters
    ? window.EvacDisasters.quakeShakeAt(project.settings,replayState.time) : null;
  svg.style.transform=quakeMotion && quakeMotion.active
    ? `translate(${(quakeMotion.x*project.settings.pxPerMeter).toFixed(2)}px, ${(quakeMotion.z*project.settings.pxPerMeter).toFixed(2)}px)` : '';
  $('objectCount').textContent = floor.items.length + ' обекта';
  updateCoordsText(null);
}

/** In dense layouts show only the clicked room's details, in one stable badge.
 *  Keep the badge off the plan's rooms and never intercept editing clicks. */
function drawSelectedRoomLabel(layer) {
  const item = selectedItem();
  if (!item || !['room', 'corridor', 'courtyard'].includes(item.type)) return;
  const name = String(item.name || 'Помещение');
  const subtitle = LabelLayout ? LabelLayout.captionFor(item) : (num(item.people, 0) + ' хора');
  const card = svgEl('g', { class: 'selected-room-label', 'pointer-events': 'none', 'aria-label': name });
  const x = SVG_W - 335, y = 12, w = 322, h = 66;
  card.append(svgEl('rect', {x, y, width:w, height:h, rx:9,
    fill:'#0c1728', 'fill-opacity':'.97', stroke:'#42d3c5', 'stroke-width':1.6}));
  // An overly long OCR name remains complete in the object editor on the right.
  const maxTextWidth = w - 30;
  let displayName = name;
  while (displayName.length > 1 && LabelLayout && LabelLayout.widthEstimate(displayName, 14) > maxTextWidth) {
    displayName = displayName.slice(0, -1);
  }
  if (displayName !== name) displayName = displayName.trimEnd() + '…';
  card.append(svgEl('text', {x:x+14, y:y+24, fill:'#ebf8ff', 'font-size':14,
    'font-weight':700}, displayName));
  card.append(svgEl('text', {x:x+14, y:y+43, fill:'#a7c2d9', 'font-size':11}, subtitle));
  card.append(svgEl('text', {x:x+14, y:y+57, fill:'#66d6c9', 'font-size':9},
    'Избрана стая · подробности в редактора'));
  layer.append(card);
}

function createObjectNode(item, blockedExitRefs, compactLabels) {
  const g = svgEl('g', {
    class: 'object' + (sameId(item.id, selectedId) ? ' selected' : ''),
    'data-id': item.id,
    'data-type': item.type
  });
  if(item.type==='threat' && activeSim && displayState() &&
     displayState().time < num(item.entryAtSeconds,0))return g;
  if (item.type === 'reference') {
    g.append(svgEl('rect', { x:item.x, y:item.y, width:item.w, height:item.h, rx:2,
      fill:'#ffcd72', 'fill-opacity':.025, stroke:'#f5bb57', 'stroke-width':3,
      'stroke-dasharray':'12 7' }));
    if (!compactLabels) g.append(svgEl('text', { x:item.x+8, y:item.y+20, fill:'#ffe4ae',
      'font-size':12,'font-weight':700,stroke:'#09121e','stroke-width':3,'paint-order':'stroke' },
      item.name || 'Ориентировъчен контур — НЕ Е ПЛАН'));
  } else if (item.type === 'surface') {
    const mat = Materials.get(item.materialId);
    g.append(svgEl('rect', { x:item.x, y:item.y, width:item.w, height:item.h, rx:4,
      fill:mat.color, 'fill-opacity':0.35, stroke:mat.color, 'stroke-width':2,
      'stroke-dasharray':'7 4' }));
    if (!compactLabels && !item.generatedByLibrary) g.append(svgEl('text', {x:item.x+7,y:item.y+19, fill:'#f8fbff',
      'font-size':12, 'font-weight':700, stroke:'#0b1220','stroke-width':2,'paint-order':'stroke'},
      '▧ ' + mat.name));
  } else if (item.type === 'room' || item.type === 'corridor' || item.type === 'courtyard') {
    const material = item.materialId && Materials.MATERIALS[item.materialId] ? Materials.get(item.materialId) : null;
    const rect = svgEl('rect', {
      x: item.x, y: item.y, width: item.w, height: item.h, rx: 8,
      fill: material && item.materialId !== 'standard' ? material.color : (item.type === 'room' ? '#24364d' : item.type === 'courtyard' ? '#1b4d3a' : '#1c4050'),
      'fill-opacity': material && item.materialId !== 'standard' ? .55 : 1,
      stroke: item.type === 'room' ? '#58718f' : item.type === 'courtyard' ? '#43d49a' : '#3f7a8c',
      'stroke-width': 2
    });
    g.append(rect);
    if (!compactLabels) g.append(svgEl('text', {
      x: item.x + 12, y: item.y + 23, fill: '#dce8f8', 'font-size': 14, 'font-weight': 600
    }, item.name || (item.type === 'room' ? 'Помещение' : item.type === 'courtyard' ? 'Общ двор' : 'Коридор')));
    const sub = item.type === 'room'
      ? (num(item.people, 0) + ' хора · ' + num(item.teachers, 0) + ' уч. · ' + num(item.width, 1.2) + ' м')
      : (item.type === 'courtyard' ? 'външна зона' : num(item.width, 1.2) + ' м ширина') + ' · ' + (item.buildingId || 'A');
    if (!compactLabels) g.append(svgEl('text', {
      x: item.x + 12, y: item.y + 41, fill: '#91a4bf', 'font-size': 11
    }, sub + (material && item.materialId !== 'standard' ? ' · ' + material.name : '')));
  } else if (item.type === 'wall') {
    g.append(svgEl('line', { x1: item.x, y1: item.y, x2: item.x2, y2: item.y2,
      stroke: item.materialId && item.materialId !== 'standard' ? Materials.get(item.materialId).color : '#d1ddea', 'stroke-width': Math.max(3, num(item.thickness, 0.2) * project.settings.pxPerMeter),
      'stroke-linecap': 'square' }));
    if (!compactLabels && !item.generatedByLibrary) g.append(svgEl('text', { x: (item.x + item.x2) / 2 + 4, y: (item.y + item.y2) / 2 - 8,
      fill: '#d1ddea', 'font-size': 10 }, item.name || 'Стена'));
  } else if (item.type === 'furniture') {
    const moved=(project.settings.scenario==='lockdown' && activeSim && displayState() &&
      (displayState().securityFurniture||[]).find(f=>String(f.id)===String(item.id)&&f.floor===currentFloor))||null;
    const fx=moved?moved.x:item.x, fy=moved?moved.y:item.y;
    const preset = Furnishing && Furnishing.TYPES[item.furnitureType] || {label:'Мебел',color:'#b99375'};
    g.append(svgEl('rect',{x:fx,y:fy,width:item.w,height:item.h,rx:item.furnitureType==='chair'?5:2,
      fill:preset.color,stroke:'#e3d0b7','stroke-width':1.1,opacity:.95}));
    if(item.furnitureType==='bed'){
      g.append(svgEl('rect',{x:fx+2,y:fy+3,width:item.w*.21,height:item.h-6,rx:4,fill:'#eef5ff'}));
    }else if(item.furnitureType==='desk'||item.furnitureType==='table'){
      g.append(svgEl('line',{x1:fx+4,y1:fy+item.h-4,x2:fx+item.w-4,y2:fy+item.h-4,
        stroke:'#654a36','stroke-width':1.1}));
    }else if(item.furnitureType==='chair'){
      g.append(svgEl('line',{x1:fx+2,y1:fy+3,x2:fx+item.w-2,y2:fy+3,
        stroke:'#e6f1ff','stroke-width':2}));
    }
    g.append(svgEl('title',{},item.name||preset.label));
  } else if (item.type === 'people') {
    g.append(svgEl('circle', {
      cx: item.x, cy: item.y, r: 10, fill: '#639cff', stroke: '#bcd3ff', 'stroke-width': 1.5
    }));
    if (!compactLabels) g.append(svgEl('text', {
      x: item.x + 14, y: item.y + 4, fill: '#cfe0f6', 'font-size': 12
    }, (num(item.count, 0) + ' души')));
  } else if (item.type === 'threat') {
    // The saved point stays unchanged; positions on replay come from the snapshot.
    const st=displayState();
    const moving=st && (st.securityMarkers||[]).find(m=>sameId(m.id,item.id));
    const tx=moving?moving.x:item.x,ty=moving?moving.y:item.y;
    g.append(svgEl('circle',{cx:tx,cy:ty,r:19,fill:'#7f263c66',stroke:'#ff536c',
      'stroke-width':3,'stroke-dasharray':'4 3'}));
    g.append(svgEl('circle',{cx:tx,cy:ty-6,r:5,fill:'#ff536c'}));
    g.append(svgEl('path',{d:`M ${tx-7} ${ty+9} Q ${tx-7} ${ty-2} ${tx} ${ty-1} Q ${tx+7} ${ty-2} ${tx+7} ${ty+9} Z`,fill:'#ff536c'}));
    if (!compactLabels) g.append(svgEl('text',{x:tx+23,y:ty+4,fill:'#ff9fae','font-weight':700,'font-size':12},
      item.name||'Опасен човек (учебен символ)'));
  } else if (item.type === 'hazard') {
    const radius = Math.max(6, num(item.radius, 27));
    const sources = currentFloorData().items.filter(i => ['room','corridor','courtyard'].includes(i.type));
    const inside = sources.filter(i => item.x >= i.x && item.x <= i.x+i.w &&
      item.y >= i.y && item.y <= i.y+i.h).sort((a,b)=>a.w*a.h-b.w*b.h)[0];
    let clipUrl = null;
    const defs = svg.querySelector('defs');
    if (inside && defs) {
      const id = 'hazardSourceClip_' + String(item.id).replace(/[^a-zA-Z0-9_-]/g, '_');
      const clip = svgEl('clipPath', { id, 'data-hazard-source-clip': '1' });
      clip.append(svgEl('rect', {x:inside.x,y:inside.y,width:inside.w,height:inside.h}));
      defs.append(clip);
      clipUrl = 'url(#' + id + ')';
    }
    const flameMarker = {cx: item.x, cy: item.y, r: radius, fill: '#ff657a22', stroke: '#ff657a',
      'stroke-width': 2, 'stroke-dasharray': '5 4'};
    if (clipUrl) flameMarker['clip-path'] = clipUrl;
    g.append(svgEl('circle', flameMarker));
    g.append(svgEl('text', {
      x: item.x - 5, y: item.y + 6, fill: '#ff9aa8', 'font-size': 19, 'font-weight': 800
    }, '!'));
    if (!compactLabels) g.append(svgEl('text', {
      x: item.x + radius + 6, y: item.y + 4, fill: '#ff9aa8', 'font-size': 11
    }, (item.name || 'Опасна зона') + ' · ' + (radius / (project.settings.pxPerMeter || 25)).toFixed(1) + ' м'));
  } else {
    let icon = '▱';
    let color = '#f5bb57';
    const unsafeExit = item.type === 'exit' && blockedExitRefs && blockedExitRefs.has(String(item.id));
    if (item.type === 'exit') { icon = unsafeExit ? '×' : '⇧'; color = unsafeExit ? '#ff657a' : '#42d3c5'; }
    if (item.type === 'stairs') { icon = '▤'; color = '#8c7cff'; }
    if (item.type === 'elevator') { icon = '▣'; color = '#ffbb71'; }
    if (item.type === 'safezone') { icon = '◎'; color = '#43d49a'; }
    if (item.type === 'opening') { icon = '◫'; color = '#79d9ea'; }
    if (item.type === 'door' && item.fireDoorClosed === true) { icon = '▣'; color = '#fa8069'; }
    if (item.type === 'door' && ['locked','damaged'].includes(item.doorState)) { icon = '×';color='#ff657a'; }
    if (item.type === 'door' && project.settings.scenario==='lockdown' && displayState()) {
      const d=(displayState().securityDoors||[]).find(d=>d.floor===currentFloor&&sameId(d.id,item.id));
      if(d && d.progress>0){icon=d.closed?'▣':'◧';color=d.closed?'#b69bff':'#f4cf83';}
    }
    if (item.type === 'vent') { icon='◌';color='#63d8ff'; }
    if (item.type === 'window') { icon=item.open===false?'▣':'▢';color='#ffe28a'; }
    if (item.type === 'ventshaft') { icon='▥';color='#7fe6da'; }
    const radius = pointSizeRadius(item);
    g.append(svgEl('circle', {
      cx: item.x, cy: item.y, r: radius, fill: color + '22', stroke: color, 'stroke-width': 2
    }));
    g.append(svgEl('text', {
      x: item.x, y: item.y + 1, fill: color, 'font-size': Math.round(clamp(radius * 1.15, 13, 26)),
      'font-weight': 800, 'text-anchor': 'middle', 'dominant-baseline': 'middle'
    }, icon));
    if (!compactLabels) g.append(svgEl('text', {
      x: item.x + radius + 5, y: item.y + 4, fill: '#b8c8dc', 'font-size': 11
    }, (item.name || (item.type === 'door' ? 'Врата' : item.type === 'exit' ? 'Изход' : 'Стълбище')) + (['vent','window','ventshaft'].includes(item.type)?'':' · ' + num(item.width, 1.2).toFixed(1) + ' м') + (unsafeExit ? ' · ОПАСЕН' : '') + (item.type === 'door' && item.fireDoorClosed ? ' · затваря се при ' + num(item.fireDoorCloseAtSeconds, 0) + ' s' : '')));
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
  if (!item || !isItemVisibleInScenario(item, project.settings.scenario)) return;
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
  if (!['room','corridor','courtyard','surface','furniture'].includes(item.type)) return;
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
  if (draft.type === 'wall') {
    layer.append(svgEl('line', { class: 'draft', x1: draft.startX, y1: draft.startY,
      x2: draft.currentX, y2: draft.currentY, 'stroke-width': 5 }));
    return;
  }
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
  if (!project.settings.showSpread && !['flood','quake'].includes(project.settings.scenario)) return;
  const scenario = project.settings.scenario;
  if(scenario==='quake'){
    const state=displayState();
    if(state && state.quakeShaking){
      layer.append(svgEl('text',{x:24,y:45,fill:'#dbd4ff','font-size':18,'font-weight':700,
        'pointer-events':'none'},'ЗЕМЕТРЕСЕНИЕ · M '+num(state.quakeMagnitude,0).toFixed(1)+' · ВСИЧКИ ЕТАЖИ'));
    }
    if(state && state.buildingCollapsed){
      layer.append(svgEl('rect',{x:0,y:0,width:SVG_W,height:SVG_H,fill:'#825b49',
        'fill-opacity':.32,'pointer-events':'none'}));
      layer.append(svgEl('text',{x:24,y:45,fill:'#ffdeba','font-size':26,'font-weight':700,
        'pointer-events':'none'},'УСЛОВНО СРУТВАНЕ · УЧЕБЕН МОДЕЛ'));
    }
    return;
  }
  if (scenario !== 'fire' && scenario !== 'flood') return;
  const model = activeSim ? activeSim.model : getPreviewModel();
  const floorInfo = model && model.floors ? model.floors[currentFloor] : null;
  const hazards = (floorInfo && floorInfo.hazards) || [];
  const spreadInfo = (model && model.hazardSpread) || [];
  const defs = svg.querySelector('defs');
  const pxPerMeter = model.pxPerMeter || project.settings.pxPerMeter || 25;
  const st = displayState();
  const time = st ? st.time : 0;
  if(scenario==='flood'){
    const water=EvacSim.floodStatusAt(model,time);
    const level=water.level;
    const depth=Math.max(0,level-currentFloor*(model.floorHeight||3.2));
    if(depth>0.001){
      // Same floor-wide height for every room, but no water polygons beyond
      // the union of interior rooms and corridors. Matches the 3D renderer.
      const tiles=EvacFloodFootprint.tilesForFloor(floorInfo);
      for(const tile of tiles){
        layer.append(svgEl('rect',{x:tile.x,y:tile.y,width:tile.w,height:tile.h,
          fill:'#37a8ee','fill-opacity':Math.min(.60,.17+depth*.11),
          'pointer-events':'none'}));
      }
      layer.append(svgEl('text',{x:14,y:28,fill:'#c8eaff','font-size':16,
        'font-weight':700,'pointer-events':'none'},
        'Наводнение — целият етаж '+(currentFloor+1)+' · ниво '+level.toFixed(2)+' м'));
    }
    // Flood has no radial/local water patches, even if hazard objects exist.
    return;
  }
  if (!hazards.length || !spreadInfo.length) return;
  const color = scenario === 'flood' ? '#63b3ff' : '#ff7a45';
  const live = (st && st.spread) || [];
  let clipSeq = 0;
  hazards.forEach(h => {
    const meta = spreadInfo.find(s => sameId(s.refId, h.item.id));
    if (!meta) return;
    // Fire is now a separate circular wavefront INSIDE EACH reached room.
    // No full-room tint on first arrival and no wall-crossing radial overlay.
    if (scenario === 'fire' && EvacSim.firePatchesAt) {
      const patches = EvacSim.firePatchesAt(model, meta, time);
      patches.forEach(p => {
        const clip = spreadClipUrl(defs, 'spreadClip' + (clipSeq++), [p.rect]);
        if (!clip) return;
        layer.append(svgEl('circle', {
          cx: p.x, cy: p.y, r: p.radiusPx,
          'clip-path': clip, fill: '#ff723e', 'fill-opacity': .29,
          stroke: '#ffb05f', 'stroke-width': 1.7,
          'pointer-events': 'none'
        }));
        // Smaller, hotter centre visibly follows the growing flame front.
        layer.append(svgEl('circle', {
          cx: p.x, cy: p.y, r: p.radiusPx * .59,
          'clip-path': clip, fill: '#ff3c27', 'fill-opacity': .18,
          'pointer-events': 'none'
        }));
      });
      return;
    }
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
    if (radius > h.radius + 2 && reachedClip) {
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
      if (!forecastClip) return;
      layer.append(svgEl('circle', {
        cx: h.x, cy: h.y, r: forecast, 'clip-path': forecastClip,
        fill: 'none', stroke: color, 'stroke-width': 1, 'stroke-dasharray': '2 8', opacity: 0.55
      }));
    });
  });
}

function mixHex(from, to, t) {
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const k = clamp(t, 0, 1);
  const r = Math.round(((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * k));
  const g = Math.round(((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * k));
  const bl = Math.round((a & 255) + (((b & 255) - (a & 255)) * k));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
}

function drawSecurityIndicators(layer) {
  if(!project || project.settings.scenario!=='lockdown')return;
  const st=displayState();
  if(st && Array.isArray(st.securityMarkers)){
    st.securityMarkers.filter(m=>m.floor===currentFloor).forEach(m=>{
      layer.append(svgEl('circle',{cx:m.x,cy:m.y,r:19,fill:'#7f263c66',
        stroke:'#ff536c','stroke-width':3,'stroke-dasharray':'4 3'}));
      layer.append(svgEl('circle',{cx:m.x,cy:m.y-6,r:5,fill:'#ff536c'}));
      if(m.motionStatus==='blocked')layer.append(svgEl('text',{x:m.x+22,y:m.y-9,
        fill:'#ff9b9b','font-size':10},'препятствие')); 
      layer.append(svgEl('path',{d:`M ${m.x-7} ${m.y+9} Q ${m.x-7} ${m.y-2} ${m.x} ${m.y-1} Q ${m.x+7} ${m.y-2} ${m.x+7} ${m.y+9} Z`,fill:'#ff536c'}));
    });
  }
  if(!st || (st.securityLevel!=='emergency' && st.securityLevel!=='warning'))return;
  (st.securityDoors||[]).filter(d=>d.floor===currentFloor&&d.progress>0).forEach(d=>{
    layer.append(svgEl('circle',{cx:d.x,cy:d.y-19,r:9,fill:d.locked?'#42336c':'#484033',
      stroke:d.locked?'#c4a8ff':'#e7c281','stroke-width':1.4}));
    layer.append(svgEl('text',{x:d.x,y:d.y-15,fill:'#f1e8ff','font-size':12,
      'font-weight':700,'text-anchor':'middle'},d.closed?'×':'◧'));
  });
  (st.securityRooms||[]).filter(r=>r.floor===currentFloor).forEach(r=>{
    layer.append(svgEl('circle',{cx:r.x,cy:r.y,r:13,fill:'#647df922',
      stroke:'#9eaeff','stroke-width':2,'stroke-dasharray':'4 4',
      'pointer-events':'none'}));
    layer.append(svgEl('text',{x:r.x+16,y:r.y-9,fill:'#b8c7ff','font-size':10,
      'pointer-events':'none'},'защитно изчакване'));
  });
}

function drawHeatmap(layer) {
  if (!project.settings.showHeatmap || !activeSim) return;
  const agents = displayAgents().filter(a =>
    a.floor === currentFloor && a.state !== 'safe' && a.state !== 'sheltered' && a.state !== 'no-route');
  if (!agents.length) return;
  const spaces = currentFloorData().items.filter(i => i.type === 'room' || i.type === 'corridor');
  if (!spaces.length) return;
  const cell = 25;
  const buckets = new Map();
  agents.forEach(agent => {
    const ix = Math.floor(agent.x / cell);
    const iy = Math.floor(agent.y / cell);
    const key = ix + ':' + iy;
    const entry = buckets.get(key) || { x: ix * cell, y: iy * cell, count: 0 };
    entry.count += 1;
    buckets.set(key, entry);
  });
  // Цветовете са по абсолютна плътност, не по максимума в кадъра.
  buckets.forEach(entry => {
    const inside = spaces.some(s =>
      entry.x + cell > s.x && entry.x < s.x + s.w && entry.y + cell > s.y && entry.y < s.y + s.h);
    if (!inside) return;
    const cellMeters = cell / Math.max(2, project.settings.pxPerMeter || 25);
    const density = entry.count / Math.max(.01, cellMeters * cellMeters);
    const t = clamp(density / 4, 0.03, 1);
    const color = t < 0.5
      ? mixHex('#43d49a', '#f5bb57', t / 0.5)
      : mixHex('#f5bb57', '#ff657a', (t - 0.5) / 0.5);
    layer.append(svgEl('rect', {
      x: entry.x, y: entry.y, width: cell, height: cell,
      fill: color, opacity: (0.12 + t * 0.4).toFixed(3),
      'pointer-events': 'none'
    }));
  });
}

function drawSmoke(layer) {
  if (!project.settings.showSmoke || project.settings.scenario !== 'fire') return;
  const model = activeSim ? activeSim.model : previewModel;
  const spreads = (model && model.smokeSpread) || [];
  if (!spreads.length) return;
  const defs = svg.querySelector('defs');
  const pxPerMeter = model.pxPerMeter || project.settings.pxPerMeter || 25;
  const state = displayState();
  const time = state ? state.time : 0;
  const live = (state && state.smoke) || [];
  let clipSeq = 0;
  spreads.forEach(h => {
    if (h.floor !== currentFloor) return;
    const liveEntry = live.find(s => sameId(s.refId, h.refId));
    const radius = liveEntry ? Math.max(h.baseRadius, liveEntry.radiusPx) : h.baseRadius;
    const reachedRects = spreadRectsAt(model, h, time);
    const clip = spreadClipUrl(defs, 'smokeClip' + (clipSeq++), reachedRects);
    if (radius > h.baseRadius + 2) {
      layer.append(svgEl('circle', {
        cx: h.x, cy: h.y, r: radius, 'clip-path': clip,
        fill: '#9aa7b8', 'fill-opacity': 0.27,
        stroke: '#b9c4d2', 'stroke-width': 1.2, 'stroke-dasharray': '4 4',
        'pointer-events': 'none'
      }));
    }
    layer.append(svgEl('circle', {
      cx: h.x, cy: h.y, r: Math.max(14, h.baseRadius), 'clip-path': clip,
      fill: '#9aa7b8', 'fill-opacity': 0.33, stroke: '#c6d0dc',
      'stroke-width': 1, 'stroke-dasharray': '3 3', 'pointer-events': 'none'
    }));
    layer.append(svgEl('text', {
      x: h.x, y: h.y - radius - 6, fill: '#c6d0dc', 'font-size': 9,
      'text-anchor': 'middle', 'pointer-events': 'none'
    }, 'дим ' + (radius / pxPerMeter).toFixed(1) + ' м'));
  });
}

function drawRoutes(layer) {  if (!project.settings.showRoutes) return;
  const model = activeSim ? activeSim.model : getPreviewModel();
  if (!model || !model.groups) return;
  model.groups.forEach((group, index) => {
    const routeAgent=activeSim&&activeSim.agents.find(a=>a.groupIndex===index);
    if (!routeAgent && group.status === 'no-route' && group.floor === currentFloor) {
      const source = model.nodes.get(group.nodeId);
      if (source) {
        layer.append(svgEl('circle', {
          cx: source.x, cy: source.y, r: 15, fill: 'none', stroke: '#ff657a',
          'stroke-width': 2, 'stroke-dasharray': '4 3'
        }));
      }
      return;
    }
    if ((!group.route || !group.route.steps || !group.route.steps.length) && !(routeAgent&&routeAgent.legs.length)) return;
    const color = sameId(group.refId, selectedId) ? palette[0] : palette[index % palette.length];
    const opacity = sameId(group.refId, selectedId) ? 0.95 : 0.34;
    const width = sameId(group.refId, selectedId) ? 2.6 : 1.5;
    const polylines = [];
    let current = [];
    const routeSegments=routeAgent && routeAgent.legs.length
      ? routeAgent.legs.map(leg=>({a:leg.from,b:leg.to}))
      : group.route.steps.map(step=>({a:model.nodes.get(step.from),b:model.nodes.get(step.to)}));
    routeSegments.forEach(segment => {
      const {a,b}=segment;
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

function drawMovementEffects(layer) {
  if(!activeSim)return;
  const samples=simHistory;
  const last=replayIndex>=0?replayIndex:samples.length-1;
  const focus=selectedAgentId;
  if(project.settings.showMovementEffects){
    const agents=displayAgents().filter(a=>a.floor===currentFloor && a.state!=='safe' && a.state!=='fatal');
    const buckets=new Map();
    agents.forEach(a=>{
      const key=Math.floor(a.x/36)+':'+Math.floor(a.y/36);
      const b=buckets.get(key)||{x:Math.floor(a.x/36)*36,y:Math.floor(a.y/36)*36,n:0};
      b.n++;buckets.set(key,b);
    });
    buckets.forEach(b=>{
      if(b.n<4)return;
      layer.append(svgEl('rect',{x:b.x,y:b.y,width:36,height:36,rx:8,
        fill:b.n>=12?'#ff657a':'#f5bb57',opacity:Math.min(.5,.13+b.n*.025),
        'pointer-events':'none'}));
    });
    // Short tails/arrowheads reflect measured, recorded positions, not hypothetical routes.
    const stride=Math.max(1,Math.ceil(agents.length/180));
    agents.filter((_,i)=>i%stride===0).forEach(a=>{
      const pts=[];
      for(let j=Math.max(0,last-8);j<=last;j+=2){
        const entry=samples[j]&&samples[j].agents.find(b=>b.id===a.id && b.floor===currentFloor);
        if(entry)pts.push(entry);
      }
      if(pts.length<2)return;
      layer.append(svgEl('polyline',{points:pts.map(p=>p.x+','+p.y).join(' '),fill:'none',
        stroke:'#6ac6ff','stroke-width':1.6,opacity:.55,'pointer-events':'none'}));
      const prev=pts[pts.length-2],end=pts[pts.length-1];
      const ang=Math.atan2(end.y-prev.y,end.x-prev.x);
      if(Math.hypot(end.x-prev.x,end.y-prev.y)>4){
        const x=end.x-7*Math.cos(ang),y=end.y-7*Math.sin(ang);
        layer.append(svgEl('path',{d:`M ${end.x} ${end.y} L ${x-3*Math.sin(ang)} ${y+3*Math.cos(ang)} L ${x+3*Math.sin(ang)} ${y-3*Math.cos(ang)} Z`,
          fill:'#99ddff',opacity:.75,'pointer-events':'none'}));
      }
    });
  }
  if(focus!=null&&last>=0){
    const points=[];
    for(let j=0;j<=last;j++){
      const a=samples[j]&&samples[j].agents.find(a=>a.id===focus&&a.floor===currentFloor);
      if(a)points.push(a);
    }
    if(points.length>1)layer.append(svgEl('polyline',{points:points.map(p=>p.x+','+p.y).join(' '),
      fill:'none',stroke:'#ffe079','stroke-width':3,opacity:.92,'stroke-linejoin':'round','pointer-events':'none'}));
  }
}
function renderTrackingPanel(){
  const el=$('trackAgentInfo');if(!el)return;
  if(!activeSim || selectedAgentId==null){el.textContent='Няма избран човек. Стартирай симулацията и щракни върху фигура.';return;}
  const a=displayAgents().find(a=>a.id===selectedAgentId);
  if(!a){el.textContent='Човек №'+selectedAgentId+' не е намерен.';return;}
  const state=displayState();
  const states={waiting:'изчаква',moving:'движи се',queued:'на опашка',safe:'евакуиран',
    sheltered:'изчаква помощ',sheltering:'отива към укритие',fatal:'извън симулацията',
    'no-route':'няма маршрут'};
  const seconds=state?Number(state.time).toFixed(1):'0.0';
  const refugeLabel=a.refugeKind==='under-desk' && a.state==='sheltering'?'укрива се под чин/маса':
    a.refugeKind==='elevated-furniture' && a.state==='sheltered'?'изчаква върху повдигната мебел (не е евакуиран)':
    (states[a.state]||a.state);
  el.textContent='№'+a.id+' · '+(a.groupLabel||'група')+' · '+refugeLabel+
    ' · етаж '+(a.floor+1)+' · t='+seconds+' s · позиция ('+Math.round(a.x)+', '+Math.round(a.y)+')'+
    (a.routeReason?' · '+a.routeReason:'')+(a.rerouteAt!=null?' [при '+Number(a.rerouteAt).toFixed(1)+' s]':'');
}

function drawAgents(layer) {
  if (!activeSim) return;
  const agents = displayAgents().filter(a => a.floor === currentFloor);
  const visualActors=project.settings.scenario==='lockdown' && displayState()
    ? (displayState().securityPeople||[]):[];
  const visualMap=new Map(visualActors.map(a=>[String(a.id),a]));
  const step = Math.max(1, Math.ceil(agents.length / 500));
  for (let i = 0; i < agents.length; i += step) {
    const original=agents[i],visual=visualMap.get(String(original.id));
    const agent=visual?{...original,...visual}:original;
    let color = '#b8d7ff';
    let radius = 4;
    if (agent.state === 'queued') { color = '#f5bb57'; radius = 5; }
    else if (agent.state === 'waiting') { color = '#91a4bf'; radius = 3; }
    else if (agent.state === 'sheltering') { color = '#8c7cff'; radius = 4; }
    else if (agent.state === 'sheltered') { color = '#8c7cff'; radius = 3.5; }
    else if (agent.state === 'safe') { color = '#43d49a'; radius = 3.5; }
    else if (agent.state === 'no-route') { color = '#ff657a'; radius = 4; }
    else if (agent.state === 'fatal') { color = '#000000'; radius = 4.5; }
    let x = agent.x;
    let y = agent.y;
    if (agent.state === 'safe' || (agent.state === 'sheltered' && agent.refugeKind!=='elevated-furniture')) {
      const angle = agent.id * 2.39996;
      const radiusOffset = 5 + (agent.id % 9);
      x += Math.cos(angle) * radiusOffset;
      y += Math.sin(angle) * radiusOffset;
    }
    if (agent.id===selectedAgentId) {
      layer.append(svgEl('circle',{cx:x,cy:y,r:radius+7,fill:'none',stroke:'#f9e06b',
        'stroke-width':2.5,'stroke-dasharray':'3 2','pointer-events':'none'}));
    }
    if(agent.refugeKind && ['sheltering','sheltered'].includes(agent.state)) {
      layer.append(svgEl('circle',{cx:x,cy:y,r:radius+4,fill:'none',stroke:'#c8a1ff',
        'stroke-width':2,'stroke-dasharray':'3 2','pointer-events':'none'}));
      if(project.settings.scenario==='quake')
        layer.append(svgEl('path',{d:`M ${x-5} ${y-8} L ${x} ${y-12} L ${x+5} ${y-8}`,
          fill:'none',stroke:'#eee0ff','stroke-width':1.6,'pointer-events':'none'}));
    }
    layer.append(svgEl('circle', {
      class: 'agent', cx: x, cy: y, r: radius, fill: color, opacity: 0.9,
      stroke: agent.state === 'fatal' ? '#e8eef5' : 'none',
      'stroke-width': agent.state === 'fatal' ? 1 : 0
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

function displayState() {
  if (replayIndex >= 0 && simHistory[replayIndex]) return simHistory[replayIndex].state;
  return lastSimState;
}

function displayAgents() {
  if (replayIndex >= 0 && simHistory[replayIndex]) return simHistory[replayIndex].agents;
  return activeSim ? activeSim.agents : [];
}

function buildChartSvgMarkup(width, height) {
  const w = Math.max(180, width || 300);
  const h = Math.max(90, height || 132);
  const pad = { l: 30, r: 8, t: 12, b: 20 };
  const samples = simHistory;
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const total = samples.length ? Math.max(1, samples[samples.length - 1].state.total) : Math.max(1, totalPeople());
  const maxTime = samples.length ? Math.max(1, samples[samples.length - 1].state.time) : 1;
  const px = t => pad.l + (t / maxTime) * plotW;
  const py = v => pad.t + plotH - (Math.min(v, total) / total) * plotH;
  const fmtShort = s => s >= 60 ? Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0') : Math.round(s) + 's';
  let out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="Графика на евакуацията">';
  out += '<rect x="0" y="0" width="' + w + '" height="' + h + '" rx="8" fill="#0d1726"/>';
  [0, 0.25, 0.5, 0.75, 1].forEach(frac => {
    const y = pad.t + plotH * (1 - frac);
    out += '<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (w - pad.r) + '" y2="' + y.toFixed(1) + '" stroke="#1f3048" stroke-width="1"/>';
    out += '<text x="' + (pad.l - 6) + '" y="' + (y + 3).toFixed(1) + '" fill="#6f839e" font-size="8" text-anchor="end">' + Math.round(total * frac) + '</text>';
  });
  out += '<text x="' + pad.l + '" y="' + (h - 5) + '" fill="#6f839e" font-size="8">0</text>';
  out += '<text x="' + (w - pad.r) + '" y="' + (h - 5) + '" fill="#6f839e" font-size="8" text-anchor="end">' + fmtShort(maxTime) + '</text>';
  if (samples.length > 1) {
    const safePts = samples.map(s => px(s.state.time).toFixed(1) + ',' + py(s.state.safe).toFixed(1)).join(' ');
    const hazardPts = samples.map(s => px(s.state.time).toFixed(1) + ',' + py(s.state.inHazard || 0).toFixed(1)).join(' ');
    const smokePts = samples.map(s => px(s.state.time).toFixed(1) + ',' + py(s.state.inSmoke || 0).toFixed(1)).join(' ');
    out += '<polyline points="' + safePts + '" fill="none" stroke="#43d49a" stroke-width="2" stroke-linejoin="round"/>';
    out += '<polyline points="' + hazardPts + '" fill="none" stroke="#ff657a" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.9"/>';
    out += '<polyline points="' + smokePts + '" fill="none" stroke="#9aa7b8" stroke-width="1.2" stroke-dasharray="1 3" opacity="0.85"/>';
    const last = samples[samples.length - 1].state;
    out += '<circle cx="' + px(last.time).toFixed(1) + '" cy="' + py(last.safe).toFixed(1) + '" r="3" fill="#43d49a"/>';
    if (replayIndex >= 0 && samples[replayIndex]) {
      const st = samples[replayIndex].state;
      out += '<line x1="' + px(st.time).toFixed(1) + '" y1="' + pad.t + '" x2="' + px(st.time).toFixed(1) + '" y2="' + (pad.t + plotH) + '" stroke="#42d3c5" stroke-width="1.5" stroke-dasharray="2 3"/>';
      out += '<circle cx="' + px(st.time).toFixed(1) + '" cy="' + py(st.safe).toFixed(1) + '" r="3.5" fill="#42d3c5"/>';
    }
  } else {
    out += '<text x="' + (w / 2) + '" y="' + (h / 2) + '" fill="#91a4bf" font-size="10" text-anchor="middle">Няма достатъчно данни</text>';
  }
  out += '<text x="' + pad.l + '" y="9" fill="#43d49a" font-size="8">— евакуирани</text>';
  out += '<text x="' + (pad.l + 62) + '" y="9" fill="#ff657a" font-size="8">– – в опасност</text>';
  out += '<text x="' + (pad.l + 128) + '" y="9" fill="#9aa7b8" font-size="8">··· в дим</text>';
  out += '</svg>';
  return out;
}

function renderChart() {
  const box = $('simChart');
  if (!box) return;
  box.innerHTML = simHistory.length ? buildChartSvgMarkup(280, 132) : '<p class="note">Стартирай симулация, за да видиш графика на евакуацията.</p>';
}

function updateReplayControls() {
  const range = $('replayRange');
  const liveBtn = $('replayLive');
  const label = $('replayTime');
  if (!range) return;
  const has = simHistory.length > 0;
  range.disabled = !has || simHistory.length < 2;
  range.max = String(Math.max(0, simHistory.length - 1));
  if (replayIndex < 0) range.value = String(Math.max(0, simHistory.length - 1));
  else range.value = String(replayIndex);
  if (liveBtn) liveBtn.disabled = !has;
  const prevBtn = $('replayPrev');
  const nextBtn = $('replayNext');
  const current = replayIndex >= 0 ? replayIndex : Math.max(0, simHistory.length - 1);
  if (prevBtn) prevBtn.disabled = !has || current <= 0;
  if (nextBtn) nextBtn.disabled = !has || current >= simHistory.length - 1;
  if (label) {
    if (!has) label.textContent = '—';
    else {
      const sample = replayIndex >= 0 ? simHistory[replayIndex] : simHistory[simHistory.length - 1];
      const st = sample && sample.state;
      if (st) label.textContent = (replayIndex >= 0 ? 'преглед · ' : 'живо · ') +
        (EvacSim.formatTime ? EvacSim.formatTime(st.time) : Math.round(st.time) + ' s') +
        ' · евакуирани ' + st.safe + '/' + st.total + ' · изчакващи ' + st.sheltered;
      else label.textContent = '—';
    }
  }
}

function recordSimHistory(state) {
  if (!activeSim || !state) return;
  const last = simHistory[simHistory.length - 1];
  if (last && state.time - last.state.time < 0.45 && !state.finished) return;
  simHistory.push({
    state,
    agents: activeSim.agents.map(a => ({ id: a.id, floor: a.floor, x: a.x, y: a.y, state: a.state,
      profile: a.profile, fatalAt: a.fatalAt, groupLabel:a.groupLabel, routeReason:a.routeReason,
      rerouteAt:a.rerouteAt, goal:a.goal }))
  });
  if (simHistory.length > 900) {
    simHistory.shift();
    if (replayIndex > 0) replayIndex -= 1;
  }
  renderChart();
  updateReplayControls();
}

function renderReplayViews() {
  draw();
  updateStats();
  updateSpreadPanel();
  renderBottlenecks();
  renderSimFloorInfo();
  renderRouteTable();
  renderChart();
  updateReplayControls();
}

function setReplayIndex(value) {
  if (!simHistory.length) return;
  const max = simHistory.length - 1;
  const idx = clamp(Math.round(num(value, max)), 0, max);
  replayIndex = idx >= max ? -1 : idx;
  renderReplayViews();
  setStatus(replayIndex < 0 ? 'Показва се текущото/последното състояние.' : 'Преглед на минал момент от симулацията.');
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
  const state = activeSim ? (displayState() || activeSim.snapshot()) : null;
  const total = state ? state.total : totalPeople();
  const safe = state ? state.safe : 0;
  const queued = state ? state.counts.queued : 0;
  const progress = state ? state.progress : 0;
  $('sPeople').textContent = total;
  $('sSafe').textContent = safe;
  $('sSheltered').textContent = state ? (state.sheltered || 0) : 0;
  $('sQueued').textContent = queued;
  $('sFatal').textContent = state ? (state.fatal || 0) : 0;
  $('sTime').textContent = EvacSim.formatTime ? EvacSim.formatTime(state ? state.time : 0) : ((state ? state.time : 0).toFixed(1) + ' s');
  $('sProgress').textContent = Math.round(progress * 100) + '%';
  $('bar').style.width = (progress * 100).toFixed(1) + '%';
  const systems = $('systemStateLive');
  if (systems) {
    const securityLive=$('securityScenarioLive');
    if(securityLive && project.settings.scenario==='lockdown'){
      const levels={normal:'Нормална дейност',warning:'Установена заплаха',
        emergency:'Аварийна процедура',legacy:'Класически режим'};
      securityLive.textContent=state?'Състояние: '+(levels[state.securityLevel]||'Нормална дейност')+
        ' · известени '+(state.securityNotified||0)+
        ' · съобщение: '+({none:'няма',pending:'предстои',sent:'подадено',confirmed:'потвърдено',assistance:'помощ в сценария'}[state.securityHelpStatus]||'—'):
        'Състояние: нормална дейност · започни симулацията за събития.';
    }
    const live = state && state.systems;
    systems.textContent = live
      ? 'Системи: аларма ' + (live.alarmActive?'активна':live.alarmsEnabled?'изчаква':'изкл.') +
        ' · спринклери ' + (live.sprinklersActive?'активни':live.sprinklersEnabled?'изчакват':'изкл.') +
        ' · вентилация ' + (live.ventilationEnabled?'вкл.':'изкл.') +
        ' · събития ' + (live.events||[]).length
      : 'Допълнителните системи се показват след стартиране на симулация.';
  }
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
  const state = displayState();
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
    if (live && live.fatal) badge = '<span class="badge bad">' + live.fatal + ' загинали · ' + live.evacuated + ' евакуирани</span>';
    else if (group.status === 'no-route') badge = '<span class="badge bad">без маршрут</span>';
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
  if(scenario==='flood'){
    const water=EvacSim.floodStatusAt(model,displayState()?displayState().time:0);
    const title=document.createElement('p');title.className='note';
    title.textContent='Наводнение на целия етаж · ниво '+water.level.toFixed(2)+' м · залети помещения: '+
      water.floodedRoomCount+'. Максимална височина: '+
      (project.settings.floodMaxHeightMeters==null?'не е зададена':project.settings.floodMaxHeightMeters+' м')+'.';
    box.append(title);
    return;
  }
  if (!spreads.length) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'Няма опасни зони с разпространение. Добави опасна зона (H) и задай скорост/обхват.';
    box.append(p);
    return;
  }
  const pxPerMeter = model.pxPerMeter || project.settings.pxPerMeter || 25;
  const state = displayState();
  const time = state ? state.time : 0;
  const fmt = EvacSim.formatTime || (s => Math.round(s) + ' s');
  spreads.forEach(h => {
    const block = document.createElement('div');
    block.className = 'spread-block';
    const head = document.createElement('div');
    head.className = 'spread-head';
    head.textContent = h.label + ' · ет. ' + (h.floor + 1);
    block.append(head);
    const liveEntry = state && state.spread ? state.spread.find(s => sameId(s.refId, h.refId)) : null;
    const radiusPx = liveEntry ? liveEntry.radiusPx : h.baseRadius;
    const meta = document.createElement('div');
    meta.className = 'note';
    meta.textContent = scenario === 'fire'
      ? 'Скорост ' + h.speed.toFixed(2) + ' м/с · локален огнен фронт във всяко помещение · макс. път ' + h.maxRadius + ' м' + (state ? ' · ' + fmt(time) : '')
      : 'Скорост ' + h.speed.toFixed(2) + ' м/с · обхват ' + (radiusPx / pxPerMeter).toFixed(1) + ' м от макс. ' + h.maxRadius + ' м' + (state ? ' · ' + fmt(time) : '');
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
  if (scenario === 'fire') {
    const doors = (model.floors || []).flatMap(f => (f.doors || [])
      .filter(d => d.item && d.item.type === 'door' && d.item.fireDoorClosed === true)
      .map(d => ({name:d.item.name || 'Врата',floor:f.index,
        at:clamp(num(d.item.fireDoorCloseAtSeconds,0),0,3600)})));
    if (doors.length) {
      const block = document.createElement('div');
      block.className = 'spread-block';
      const head = document.createElement('div');
      head.className = 'spread-head';
      head.textContent = 'Противопожарни врати · учебен режим';
      block.append(head);
      doors.forEach(door => {
        const elapsed = time - door.at;
        const stage = elapsed < 0 ? 'преди затваряне'
          : elapsed < 5 ? 'задържа преминаването на огъня (5 s)'
          : elapsed < 25 ? 'пропуска огъня с 40% от скоростта (20 s)'
          : 'отново нормална скорост на преминаване';
        const line = document.createElement('div');
        line.className = 'note';
        line.textContent = door.name + ' · ет. ' + (door.floor + 1) +
          ' · затваряне на ' + door.at + ' s · ' + stage;
        block.append(line);
      });
      box.append(block);
    }
  }
  const smoke = (model && model.smokeSpread) || [];
  if (smoke.length) {
    const block = document.createElement('div');
    block.className = 'spread-block';
    const head = document.createElement('div');
    head.className = 'spread-head';
    head.style.color = '#c6d0dc';
    head.textContent = 'Дим · по-бърз от огъня';
    block.append(head);
    smoke.forEach(s => {
      const entry = state && state.smoke ? state.smoke.find(x => sameId(x.refId, s.refId)) : null;
      const radiusPx = entry ? entry.radiusPx : s.baseRadius;
      const line = document.createElement('div');
      line.className = 'note';
      line.textContent = 'ет. ' + (s.floor + 1) + ' · обхват ' + (radiusPx / pxPerMeter).toFixed(1) + ' м от макс. ' + s.maxRadius.toFixed(0) + ' м · ' + s.speed.toFixed(2) + ' м/с';
      block.append(line);
    });
    const slow = Math.round((state && state.smokeSlowdown ? state.smokeSlowdown : (model.smokeSlowdown || 0.55)) * 100);
    const slowNote = document.createElement('p');
    slowNote.className = 'note';
    slowNote.textContent = 'В дим хората се движат с ' + slow + '% от нормалната скорост.';
    block.append(slowNote);
    box.append(block);
  }
  if (state && state.inHazard > 0) {
    const alert = document.createElement('div');
    alert.className = 'spread-alert';
    alert.textContent = '⚠ В обхвата на опасността: ' + state.inHazard + ' души (текущ кадър).';
    box.append(alert);
  }
  if (state && state.inSmoke > 0) {
    const alert = document.createElement('div');
    alert.className = 'spread-alert smoke-alert';
    alert.textContent = '☁ В дим: ' + state.inSmoke + ' души · примерна видимост до ' + (project.settings.smokeVisibilityMeters || 5) + ' м (забавени).';
    box.append(alert);
  }
  const foot = document.createElement('p');
  foot.className = 'note';
  foot.textContent = 'Огънят се разпространява през проходимите връзки, не през плътни стени. Затворените противопожарни врати забавят огъня през тях по учебна схема 5 s стоп → 20 s на 40% → нормално; димът се отчита отделно. Динамичното пренасочване може да премести хората по обходен маршрут.';
  box.append(foot);
}

function renderBottlenecks() {
  const box = $('bottleneckBox');
  if (!box) return;
  const state = displayState();
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
  const agents = displayAgents();
  const counts = project.floors.map((_, fi) => agents.filter(a => a.floor === fi && !['safe', 'sheltered', 'no-route', 'fatal'].includes(a.state)).length);
  const totalActive = counts.reduce((s, n) => s + n, 0);
  const state = displayState();
  el.textContent = 'На етаж ' + (currentFloor + 1) + ': ' + counts[currentFloor] + ' активни · в сградата: ' + totalActive + ' · евакуирани: ' + ((state && state.safe) || 0) + ' · изчакващи: ' + ((state && state.sheltered) || 0) + ' · загинали: ' + ((state && state.fatal) || 0);
}

function runValidator(openDialog) {
  if (!project) return null;
  if (!window.PlanValidator) {
    showToast('Валидаторът не е зареден.', true);
    return null;
  }
  const result = PlanValidator.validate(project,{routeModel:getPreviewModel()});
  const summary = $('validatorSummary');
  if (summary) {
    summary.textContent = (result.ok ? '✓ ' : '⚠ ') + result.summaryText;
    summary.classList.toggle('okline', result.ok);
    summary.classList.toggle('warnline', !result.ok);
  }
  const counts = $('validatorCounts');
  if (counts) {
    counts.innerHTML = '<span class="v-error">' + result.counts.error + ' грешки</span> · ' +
      '<span class="v-warning">' + result.counts.warning + ' предупреждения</span> · ' +
      '<span class="v-info">' + result.counts.info + ' бележки</span>' +
      (result.ok ? ' · <span class="v-ok">планът е използваем</span>' : '');
  }
  const list = $('validatorList');
  if (list) {
    list.replaceChildren();
    if (!result.issues.length) {
      const ok = document.createElement('div');
      ok.className = 'validator-empty';
      ok.textContent = '✓ Няма открити проблеми. Планът е готов за учебна симулация.';
      list.append(ok);
    } else {
      const labels = { error: 'грешка', warning: 'внимание', info: 'бележка' };
      result.issues.forEach(issue => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'validator-item ' + issue.severity;
        const sev = document.createElement('span');
        sev.className = 'vi-sev';
        sev.textContent = labels[issue.severity] || issue.severity;
        const text = document.createElement('span');
        text.className = 'vi-text';
        text.textContent = issue.message;
        if (issue.floor != null) {
          const meta = document.createElement('span');
          meta.className = 'vi-meta';
          meta.textContent = 'Етаж ' + (issue.floor + 1) + (issue.itemType ? ' · ' + (TYPE_LABELS[issue.itemType] || issue.itemType) : '');
          text.append(meta);
        }
        row.append(sev, text);
        row.addEventListener('click', () => focusValidatorIssue(issue));
        list.append(row);
      });
    }
  }
  if (openDialog) {
    const dialog = $('validatorDialog');
    if (dialog && !dialog.open) dialog.showModal();
  }
  return result;
}

function focusValidatorIssue(issue) {
  if (!issue) return;
  if (issue.floor != null && project.floors[issue.floor]) currentFloor = issue.floor;
  selectedId = issue.itemId != null ? issue.itemId : null;
  closeDialog('validatorDialog');
  refreshFloorSelect();
  renderObjectEditor();
  updateBackdropPanel();
  draw();
  updateStats();
  if (selectedId != null) {
    setStatus('Избран проблем: ' + issue.message);
    showToast('Обектът е избран на плана.');
  } else {
    setStatus('Проблем: ' + issue.message);
  }
}

function refreshAnalysis() {
  renderWarnings();
  renderRouteTable();
  renderBottlenecks();
  updateSpreadPanel();
  if (window.PlanValidator) runValidator(false);
}

/* ----------------------------- object editor ----------------------------- */

const TYPE_LABELS = {
  reference: 'Референция (не е етажен план)',
  room: 'Помещение',
  surface: 'Повърхност / материал',
  corridor: 'Коридор',
  door: 'Врата',
  exit: 'Авариен изход',
  stairs: 'Стълбище',
  people: 'Група хора',
  furniture: 'Мебел / препятствие',
  threat: 'Символ на опасен човек (без моделиране на нападение)',
  hazard: 'Опасна зона',
  vent: 'Вентилатор / аспиратор', window: 'Прозорец', ventshaft: 'Вентилационна шахта',
  wall: 'Стена', opening: 'Отвор', elevator: 'Асансьор', safezone: 'Безопасна зона', courtyard: 'Общ двор'
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

function addSelectField(parent,label,value,values,callback){
  const wrap=document.createElement('div');wrap.className='full';
  const text=document.createElement('label');text.textContent=label;
  const sel=document.createElement('select');
  values.forEach(([key,title])=>{const option=document.createElement('option');option.value=key;option.textContent=title;sel.append(option);});
  sel.value=value;sel.addEventListener('change',()=>{pushHistory();callback(sel.value);markDirty();draw();refreshAnalysis();});
  wrap.append(text,sel);parent.append(wrap);return sel;
}

function addMaterialField(parent, item) {
  const wrap = document.createElement('div'); wrap.className = 'full';
  const label = document.createElement('label'); label.textContent = 'Материал / повърхност';
  const select = document.createElement('select');
  Object.entries(Materials.MATERIALS).forEach(([id, mat]) => {
    const opt = document.createElement('option'); opt.value = id; opt.textContent = mat.name;
    select.append(opt);
  });
  select.value = item.materialId || Materials.DEFAULT;
  select.addEventListener('change', () => {
    if (isSimActive()) return;
    pushHistory(); item.materialId = select.value;
    markDirty(); draw(); refreshAnalysis();
  });
  wrap.append(label, select); parent.append(wrap);
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

  if (['room','corridor','courtyard','surface','reference'].includes(item.type)) {
    addField(grid, 'Име', item.name || '', { full: true }, value => { item.name = value; });
    if (item.type !== 'reference') addMaterialField(grid, item);
    if (item.type === 'room') {
      addField(grid, 'Хора', item.people || 0, { type: 'number', min: 0, step: 1 }, value => { item.people = Math.max(0, Math.round(num(value, 0))); });
      addField(grid, 'Учители', item.teachers || 0, { type: 'number', min: 0, step: 1 }, value => { item.teachers = Math.max(0, Math.round(num(value, 0))); });
    }
    addField(grid, 'Сграда / зона', item.buildingId || 'A', { full: true }, value => { item.buildingId = String(value || 'A').slice(0, 40); });
    addField(grid, 'Ширина (м)', item.width || 1.2, { type: 'number', min: 0.2, max: 20, step: 0.1 }, value => { item.width = clamp(num(value, 1.2), 0.2, 20); });
    addField(grid, 'X', Math.round(item.x), { type: 'number', step: 1 }, value => { item.x = clamp(num(value, item.x), 0, SVG_W - item.w); });
    addField(grid, 'Y', Math.round(item.y), { type: 'number', step: 1 }, value => { item.y = clamp(num(value, item.y), 0, SVG_H - item.h); });
    addField(grid, 'Ширина (px)', Math.round(item.w), { type: 'number', min: 12, step: 1 }, value => { item.w = clamp(num(value, item.w), 12, SVG_W - item.x); });
    addField(grid, 'Височина (px)', Math.round(item.h), { type: 'number', min: 12, step: 1 }, value => { item.h = clamp(num(value, item.h), 12, SVG_H - item.y); });
  } else if (item.type === 'furniture') {
    addField(grid,'Име',item.name||'Мебел',{full:true},v=>{item.name=v;});
    addSelectField(grid,'Вид мебел',item.furnitureType||'desk',
      Object.entries(Furnishing ? Furnishing.TYPES : {}).map(([id,t])=>[id,t.label]),v=>{item.furnitureType=v;});
    for(const key of ['x','y','w','h'])addField(grid,key.toUpperCase(),Math.round(item[key]),
      {type:'number',min:key==='w'||key==='h'?7:0,max:key==='x'||key==='w'?900:590,step:1},
      v=>{item[key]=clamp(num(v,item[key]),key==='w'||key==='h'?7:0,key==='x'||key==='w'?900:590);});
    const info=document.createElement('p');info.className='note full';
    info.textContent='Препятствие за движението; маршрутите заобикалят мебелите. Чин/маса може да служи за условно укритие при земетресение.';grid.append(info);
  } else if (item.type === 'wall') {
    addField(grid, 'Име', item.name || 'Стена', { full: true }, value => { item.name = value; });
    addMaterialField(grid, item);
    addField(grid, 'Дебелина (м)', item.thickness || 0.2, { type: 'number', min: 0.05, max: 2, step: 0.05 }, value => { item.thickness = clamp(num(value, 0.2), 0.05, 2); });
    ['x','y','x2','y2'].forEach(key => addField(grid, key.toUpperCase(), Math.round(item[key]),
      { type: 'number', min: 0, step: 1 }, value => { item[key] = clamp(num(value, item[key]), 0, key.includes('x') ? SVG_W : SVG_H); }));
  } else if (item.type === 'threat') {
    addField(grid,'Етикет',item.name||'Опасен човек (учебен символ)',{full:true},v=>{item.name=v;});
    addField(grid,'X',Math.round(item.x),{type:'number',min:0,max:SVG_W},v=>{item.x=clamp(num(v,item.x),0,SVG_W);});
    addField(grid,'Y',Math.round(item.y),{type:'number',min:0,max:SVG_H},v=>{item.y=clamp(num(v,item.y),0,SVG_H);});
    addField(grid,'Поява в сценария (сек.)',num(item.entryAtSeconds,0),{type:'number',min:0,max:3600,step:1},v=>{item.entryAtSeconds=clamp(num(v,0),0,3600);});
    const note=document.createElement('p');note.className='note full';note.textContent='В разширения сценарий обозначителят се придвижва схематично между случайни точки. Не симулира преследване, нападение или реален достъп през врати.';grid.append(note);
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
  } else if (['vent','window','ventshaft'].includes(item.type)) {
    addField(grid,'Име',item.name||'',{full:true},v=>{item.name=v;});
    addField(grid,'X',Math.round(item.x),{type:'number',min:0,max:900},v=>{item.x=clamp(num(v,item.x),0,900);});
    addField(grid,'Y',Math.round(item.y),{type:'number',min:0,max:590},v=>{item.y=clamp(num(v,item.y),0,590);});
    addField(grid,'Интензитет',num(item.strength,.5),{type:'number',min:0,max:.8,step:.1},v=>{item.strength=clamp(num(v,.5),0,.8);});
    addField(grid,'Посока на въздуха (°)',num(item.direction,0),{type:'number',min:0,max:359,step:5},v=>{item.direction=clamp(num(v,0),0,359);});
    if(item.type==='ventshaft') addField(grid,'Идентификатор на шахтата',item.shaft||'V1',{placeholder:'напр. V1'},v=>{item.shaft=String(v||'V1').trim().slice(0,40)||'V1';});
    if(item.type==='window') addCheckbox(grid,'Отворен прозорец',item.open!==false,v=>{item.open=v;});
  } else {
    addField(grid, 'Име', item.name || '', { full: true }, value => { item.name = value; });
    addField(grid, 'Ширина (м)', item.width || 1.2, { type: 'number', min: 0.2, max: 10, step: 0.1 }, value => { item.width = clamp(num(value, 1.2), 0.2, 10); });
    addRange(grid, 'Плъзгач за размер', num(item.width, 1.2), 0.3, 10, 0.1, v => v.toFixed(1) + ' м', value => { item.width = clamp(value, 0.2, 10); });
    addField(grid, 'X', Math.round(item.x), { type: 'number', step: 1 }, value => { item.x = clamp(num(value, item.x), 0, SVG_W); });
    addField(grid, 'Y', Math.round(item.y), { type: 'number', step: 1 }, value => { item.y = clamp(num(value, item.y), 0, SVG_H); });
    if (item.type === 'door') {
      addSelectField(grid, 'Режим на вратата', item.doorState || 'open', [
        ['open','Отворена'],['closed','Затворена (отваряема)'],['locked','Заключена'],
        ['damaged','Повредена'],['automatic','Автоматична (затваря при събитие)']
      ],value => { item.doorState = value; });
      addCheckbox(grid, 'Затворена противопожарна врата (забавя огъня)', item.fireDoorClosed === true, value => { item.fireDoorClosed = value; });
      addField(grid, 'Затвори на секунда', num(item.fireDoorCloseAtSeconds, 0),
        { type: 'number', min: 0, max: 3600, step: 1 }, value => {
          item.fireDoorCloseAtSeconds = clamp(num(value, 0), 0, 3600);
        });
      const doorHint = document.createElement('p');
      doorHint.className = 'note full';
      doorHint.textContent = 'При пожар: след затварянето няма преминаване на огъня през вратата 5 s; после 20 s на 40% скорост; след това нормално. Хората могат да използват вратата за евакуация.';
      grid.append(doorHint);
    }
    if (item.type === 'stairs' || item.type === 'elevator') {
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
    if (!isItemVisibleInScenario(item, project.settings.scenario)) continue;
    if (item.type === 'wall') {
      const dx = item.x2 - item.x, dy = item.y2 - item.y;
      const length2 = dx * dx + dy * dy;
      const t = length2 ? clamp(((point.x - item.x) * dx + (point.y - item.y) * dy) / length2, 0, 1) : 0;
      if (Math.hypot(point.x - item.x - t * dx, point.y - item.y - t * dy) < 12) return item;
    } else if (item.type === 'reference') {
      const inside = point.x >= item.x - 9 && point.x <= item.x + item.w + 9 &&
        point.y >= item.y - 9 && point.y <= item.y + item.h + 9;
      const onEdge = Math.min(Math.abs(point.x-item.x),Math.abs(point.x-item.x-item.w),
        Math.abs(point.y-item.y),Math.abs(point.y-item.y-item.h)) <= 10;
      if (inside && onEdge) return item;
    } else if (['room','corridor','courtyard','surface','furniture'].includes(item.type)) {
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
  if (!['room','corridor','furniture'].includes(item.type)) return;
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
    // The plan stays read-only while running; clicking a live 2D agent tracks it.
    const near=displayAgents().filter(a=>a.floor===currentFloor).map(a=>({a,dist:Math.hypot(point.x-a.x,point.y-a.y)}))
      .sort((a,b)=>a.dist-b.dist)[0];
    if(near && near.dist<=13){
      selectedAgentId=near.a.id; $('trackAgentId').value=String(selectedAgentId);
      renderTrackingPanel();draw();return;
    }
    // Reading room information remains possible during a running simulation,
    // but the geometry stays locked. Give people priority over room selection.
    const roomAtPoint = currentFloorData().items
      .filter(item => ['room','corridor','courtyard'].includes(item.type) &&
        point.x >= item.x && point.x <= item.x + item.w &&
        point.y >= item.y && point.y <= item.y + item.h)
      .sort((a,b) => a.w*a.h - b.w*b.h)[0];
    if (roomAtPoint) { selectedId = roomAtPoint.id; draw(); return; }
    showToast('По време на симулацията можеш да избираш хора и стаи, но не и да редактираш плана.');
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
  if (tool === 'room' || tool === 'corridor' || tool === 'courtyard' || tool === 'wall' || tool === 'surface') {
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
    const rect = ['room', 'corridor', 'courtyard','surface'].includes(item.type) ? { w: item.w, h: item.h } : null;
    const target = clampPoint({ x: nx, y: ny }, rect);
    if (target.x === item.x && target.y === item.y) return;
    if (!interaction.committed) {
      pushHistorySnapshot(interaction.snapshot);
      interaction.committed = true;
    }
    if (item.type === 'wall') { item.x2 += target.x - item.x; item.y2 += target.y - item.y; }
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
  if (type === 'courtyard' && (!input || /^класна стая/i.test(input))) return 'Общ двор';
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
  if (draft.type === 'wall') {
    if (Math.hypot(point.x - startX, point.y - startY) < 12) { draft = null; draw(); return; }
    pushHistory();
    const wall = { id: uid(), type: 'wall', x: startX, y: startY,
      x2: clamp(snapValue(point.x), 0, SVG_W), y2: clamp(snapValue(point.y), 0, SVG_H),
      thickness: 0.2, name: nextPointName('Стена', 'wall') };
    currentFloorData().items.push(wall);
    selectedId = wall.id;
    draft = null;
    markDirty(); renderObjectEditor(); draw(); refreshAnalysis();
    return;
  }
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
    name: type === 'surface' ? (Materials.get(chosenMaterialId).name + ' · зона') : newNameFor(type),
    people: type === 'room' ? Math.max(0, Math.round(num($('peopleCount').value, 0))) : 0,
    teachers: type === 'room' ? Math.max(0, Math.round(num($('teacherCount').value, 0))) : 0,
    buildingId: type === 'courtyard' ? 'външна зона' : 'A',
    materialId: type === 'surface' ? chosenMaterialId : 'standard'
  };
  currentFloorData().items.push(item);
  selectedId = item.id;
  draft = null;
  markDirty();
  renderObjectEditor();
  draw();
  updateStats();
  refreshAnalysis();
  addLog('Добавен ' + (type === 'room' ? 'помещение' : type === 'surface' ? 'материал' : 'коридор') + ' „' + item.name + '“.');
}

function createPointItem(type, point) {
  if (isSimActive()) {
    showToast('Спри симулацията, за да редактираш.');
    return;
  }
  const target = clampPoint({ x: snapValue(point.x), y: snapValue(point.y) });
  const item = { id: uid(), type, x: target.x, y: target.y };
  if (['door','opening','exit','stairs','elevator','safezone'].includes(type)) {
    item.width = clamp(num($('width').value, 1.2), 0.2, 10);
    item.name = nextPointName(({door:'Врата',opening:'Отвор',exit:'Изход',stairs:'Стълбище',elevator:'Асансьор',safezone:'Безопасна зона'})[type], type);
    if (type === 'elevator') item.shaft = 'L1';
  } else if (type === 'threat') {
    if(project.settings.scenario!=='lockdown')return showToast('Символът е само за сценарий „Заплаха / блокиране“.',true);
    item.name=nextPointName('Опасен човек · учебен символ','threat');
  } else if (type === 'people') {
    item.count = Math.max(1, Math.round(num($('peopleCount').value, 1)));
    item.name = $('groupName').value.trim() || nextPointName('Група', 'people');
  } else if (type === 'furniture') {
    if (!Furnishing) return;
    item.furnitureType = $('furnitureType').value || 'desk';
    const preset = Furnishing.TYPES[item.furnitureType] || Furnishing.TYPES.desk;
    item.w=preset.w; item.h=preset.h;
    item.name=preset.label;
    item.x=clamp(target.x-preset.w/2,0,SVG_W-preset.w);
    item.y=clamp(target.y-preset.h/2,0,SVG_H-preset.h);
  } else if (['vent','window','ventshaft'].includes(type)) {
    item.name = nextPointName(({vent:'Вентилатор',window:'Прозорец',ventshaft:'Вент. шахта'})[type],type);
    item.strength=.5;item.direction=0;item.open=true;
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
  if(type==='hazard'||type==='threat')renderScenarioExtras();
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

function installCollapsiblePanels(){
  // Accessible disclosure controls for crowded sidebars; keep IDs, event
  // handlers and live editor nodes intact rather than cloning their DOM.
  const alwaysOpen=new Set(['selectedObjectPanel','disasterScenarioSettings']);
  const defaults=new Set(['Сграда','Инструменти','Сценарий']);
  document.querySelectorAll('.side > .group, .rightpanel > .group').forEach((group,index)=>{
    const heading=group.querySelector(':scope > h3');
    if(!heading || group.querySelector(':scope > .group-fold'))return;
    const title=heading.textContent.trim(), expanded=alwaysOpen.has(group.id)||defaults.has(title);
    const button=document.createElement('button');button.type='button';button.className='group-fold';
    button.textContent=title;button.setAttribute('aria-expanded',String(expanded));
    const panel=document.createElement('div');panel.id='group-fold-body-'+index;
    panel.className='group-fold-body';panel.hidden=!expanded;
    button.setAttribute('aria-controls',panel.id);
    heading.replaceWith(button);
    while(button.nextSibling)panel.appendChild(button.nextSibling);
    group.appendChild(panel);group.classList.toggle('group-collapsed',!expanded);
    button.addEventListener('click',()=>{
      const open=button.getAttribute('aria-expanded')!=='true';
      button.setAttribute('aria-expanded',String(open));panel.hidden=!open;
      group.classList.toggle('group-collapsed',!open);
    });
  });
}

function syncSimButtons() {
  const running = isSimActive();
  $('run').textContent = running ? '↻ Рестарт' : '▶ Стартирай';
  $('pause').disabled = !running;
  $('pause').textContent = simPaused ? '▶ Продължи' : 'Ⅱ Пауза';
  $('stop').disabled = !activeSim;
  if($('restartSimulation'))$('restartSimulation').hidden=!(activeSim && activeSim.finished);
  $('preMovement').disabled = running;
  document.querySelectorAll('.scenario').forEach(el => {
    el.style.opacity = running ? '.6' : '';
    el.style.pointerEvents = running ? 'none' : '';
  });
}

function startSimulation() {
  const scenario = project.settings.scenario;
  if(scenario==='flood'){
    const field=$('exFloodMax');
    const requestedHeight=Number(field.value);
    if(!field.value.trim() || !field.validity.valid ||
       !Number.isFinite(requestedHeight) || requestedHeight<0.1 || requestedHeight>30){
      $('floodHeightError').textContent='Задължително въведи максимална височина (0,1–30 м).';
      field.focus();
      showToast('Въведи максималната височина на наводнението.',true);
      setStatus('Не е зададена валидна максимална височина на водата.');
      return;
    }
    // Also accept an entered number immediately when starting with Enter,
    // before the input has dispatched its change/blur event.
    if(project.settings.floodMaxHeightMeters!==requestedHeight){
      project.settings.floodMaxHeightMeters=requestedHeight;
      markDirty();
    }
  }
  if (activeSim) stopSimulation(true);
  if (ensureSecurityMarker()) {
    markDirty();
    showToast('Добавен е начален обозначител на заплаха. Можеш да го преместиш.');
  }
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
    // Still run: agents should be recorded as having no safe exit, not vanish
    // because the simulator refused to start.
    showToast('Няма безопасен изход — симулацията ще отчете хората без маршрут.', true);
  }
  activeSim = EvacSim.createSimulation(model, { preMovement });
  selectedAgentId = null;
  lastSimState = activeSim.snapshot();
  lastSimReport = null;
  simPaused = false;
  simAccumulator = 0;
  lastTableAt = 0;
  simHistory = [];
  replayIndex = -1;
  recordSimHistory(lastSimState);
  const labels = EvacSim.SCENARIO_LABELS || {};
  setStatus('Симулацията се изпълнява · ' + (labels[scenario] || scenario) +
    (lastSimState.blockedExits && lastSimState.blockedExits.length ? ' · опасни изходи: ' + lastSimState.blockedExits.length : '') + '.');
  $('report').textContent = 'Симулацията е в ход. Изчакай резултата или натисни „Стоп“.';
  addLog('Стартирана симулация · ' + (labels[scenario] || scenario) + ' · ' + model.totalPeople + ' души.');
  syncSimButtons();
  updateStats();
  renderSimFloorInfo();
  renderBottlenecks();
  refreshFloorSelect();
  renderChart();
  updateReplayControls();
  renderCompare();
  draw();
  clearInterval(simTimer);
  simTimer = setInterval(simTick, 100);
}

function simTick() {
  if (!activeSim || simPaused || activeSim.finished) return;
  const previousBlocked = new Set((lastSimState && lastSimState.blockedExits || []).map(exit => exit.id));
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
  const newHazards = (lastSimState.blockedExits || []).filter(exit => !previousBlocked.has(exit.id));
  if (newHazards.length) {
    const label = newHazards.map(e => e.label).join(', ');
    addLog('Опасен изход: ' + label + '. Хората търсят алтернативен маршрут.');
    setStatus('Опасен изход: ' + label + ' · проверка за други маршрути.');
  }
  if (activeSim && activeSim.finished) {
    finishSimulation();
    return;
  }
  recordSimHistory(lastSimState);
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
    renderCompare();
  }
}

function finishSimulation() {
  if (!activeSim) return;
  clearInterval(simTimer);
  simTimer = null;
  simPaused = false;
  lastSimState = activeSim.snapshot();
  lastSimReport = buildSimulationReport(lastSimState, activeSim.model);
  recordSimHistory(lastSimState);
  setStatus(lastSimReport.finishedText);
  $('report').textContent = lastSimReport.text;
  addLog(lastSimReport.log);
  syncSimButtons();
  updateStats();
  renderBottlenecks();
  renderRouteTable();
  updateSpreadPanel();
  renderSimFloorInfo();
  renderChart();
  updateReplayControls();
  renderCompare();
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
    if(state.helpCall)text+=' Възрастен (участник №'+state.helpCallerId+') подава учебен сигнал за помощ на 112 (само визуално съобщение, без реално обаждане).';
    text+=' Обозначители на заплаха, видими към края: '+(state.threatMarkersActive||0)+'.';
    log = 'Симулацията приключи (укриване): ' + sheltered + '/' + total + ' за ' + fmt(state.time) + '.';
    finishedText = 'Симулацията приключи: защитно укриване.';
  } else {
    text = 'Евакуирани ' + safe + ' от ' + total + ' души за ' + fmt(state.time) + ' (симулационно време). Средно време: ' + avg + '.';
    if (noRoute) text += ' ' + noRoute + ' души са без достъпен маршрут.';
    if (state.fatal) text += ' Загинали (условен модел на излагане на огън): ' + state.fatal + '.';
    if (bottleneck) {
      text += ' Най-натоварена точка: ' + bottleneck.label + ' (опашка до ' + bottleneck.maxQueue + ', капацитет ' + bottleneck.capacity.toFixed(2) + ' д/с).';
    }
    if (state.reroutes) text += ' Динамично пренасочване: ' + state.reroutes + ' пъти.';
    if (state.blockedExits && state.blockedExits.length) text += ' Опасни/блокирани изходи: ' + state.blockedExits.map(e => e.label).join(', ') + '.';
    if (state.inSmoke) text += ' В дим в края: ' + state.inSmoke + ' души.';
    if(state.scenario==='flood' && state.waterLevelMeters>0) text+=' Ниво на водата: '+state.waterLevelMeters.toFixed(2)+' м над терена.';
    if(state.quakeCollapseAtSeconds!=null)text+=' Време на условно срутване: '+Math.round(state.quakeCollapseAtSeconds)+' сек.';
    if(state.buildingCollapsed)text+=' Настъпи условно срутване; хората в сградата са отбелязани като нуждаещи се от помощ.';
    text += ' Това е учебен модел, а не прогноза за реално време.';
    log = 'Симулацията приключи: ' + safe + '/' + total + ' за ' + fmt(state.time) + (noRoute ? ', без маршрут: ' + noRoute : '') + (state.fatal ? ', загинали: ' + state.fatal : '') + '.';
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

function simSummary(state) {
  if (!state) return null;
  return {
    time: state.time,
    evacuated: state.safe,
    total: state.total,
    noRoute: state.noRoute,
    fatal: state.fatal || 0,
    averageTime: state.averageTime,
    worstQueue: state.bottlenecks && state.bottlenecks[0] ? state.bottlenecks[0].maxQueue : 0,
    scenario: state.scenario
  };
}

function renderCompare() {
  const box = $('compareBox');
  if (!box) return;
  const base = project && project.baseline;
  if (!base) {
    box.innerHTML = '<p class="note">Пусни симулация и запази резултата като база, после промени плана и сравни.</p>';
    return;
  }
  const current = simSummary(displayState());
  const fmt = EvacSim.formatTime || (s => (s || 0).toFixed(1) + ' s');
  const rows = [
    { label: '% евакуирани', base: (100 * base.evacuated / Math.max(1, base.total)).toFixed(1) + '%',
      current: current ? (100 * current.evacuated / Math.max(1, current.total)).toFixed(1) + '%' : '—',
      delta: current ? 100 * (current.evacuated / Math.max(1, current.total) - base.evacuated / Math.max(1, base.total)) : null,
      digits: 1, unit: ' п.п.', lower: false },
    { label: 'Евакуирани', base: base.evacuated + '/' + base.total, current: current ? current.evacuated + '/' + current.total : '—',
      delta: current ? current.evacuated - base.evacuated : null, digits: 0, unit: '', lower: false },
    { label: 'Време', base: fmt(base.time), current: current ? fmt(current.time) : '—',
      delta: current ? current.time - base.time : null, digits: 1, unit: ' s', lower: true },
    { label: 'Средно време', base: base.averageTime == null ? '—' : fmt(base.averageTime),
      current: current && current.averageTime != null ? fmt(current.averageTime) : '—',
      delta: current && current.averageTime != null && base.averageTime != null ? current.averageTime - base.averageTime : null,
      digits: 1, unit: ' s', lower: true },
    { label: 'Загинали', base: String(base.fatal || 0), current: current ? String(current.fatal || 0) : '—',
      delta: current ? (current.fatal || 0) - (base.fatal || 0) : null, digits: 0, unit: '', lower: true },
    { label: 'Без маршрут', base: String(base.noRoute), current: current ? String(current.noRoute) : '—',
      delta: current ? current.noRoute - base.noRoute : null, digits: 0, unit: '', lower: true },
    { label: 'Най-голяма опашка', base: String(base.worstQueue || 0), current: current ? String(current.worstQueue || 0) : '—',
      delta: current ? (current.worstQueue || 0) - (base.worstQueue || 0) : null, digits: 0, unit: '', lower: true }
  ];
  let html = '<table><tr><th>Показател</th><th>База</th><th>Сега</th><th>Δ</th></tr>';
  rows.forEach(row => {
    let deltaText = '—';
    let cls = '';
    if (row.delta != null && Math.abs(row.delta) > 0.0001) {
      deltaText = (row.delta > 0 ? '+' : '') + row.delta.toFixed(row.digits) + row.unit;
      const better = row.lower ? row.delta < 0 : row.delta > 0;
      cls = better ? 'good' : 'bad';
    }
    html += '<tr><td>' + escapeHtml(row.label) + '</td><td>' + escapeHtml(row.base) +
      '</td><td>' + escapeHtml(row.current) + '</td><td class="' + cls + '">' + escapeHtml(deltaText) + '</td></tr>';
  });
  html += '</table>';
  const when = base.recordedAt ? new Date(base.recordedAt).toLocaleString('bg-BG') : '';
  html += '<p class="compare-base">База: ' + escapeHtml(base.label || '—') + (when ? ' · ' + escapeHtml(when) : '') + '</p>';
  box.innerHTML = html;
}

function saveBaseline() {
  const state = displayState();
  if (!state) {
    showToast('Пусни симулация, преди да запазиш база.', true);
    return;
  }
  project.baseline = Object.assign(simSummary(state), {
    label: project.projectName || 'Проект',
    scenario: state.scenario,
    recordedAt: nowIso()
  });
  markDirty();
  renderCompare();
  addLog('Запазен е A/B базов резултат: ' + state.safe + '/' + state.total + ' за ' + (EvacSim.formatTime ? EvacSim.formatTime(state.time) : state.time.toFixed(1) + ' s') + '.');
  showToast('Резултатът е запазен като база.');
}

function clearBaseline() {
  if (!project.baseline) return;
  delete project.baseline;
  markDirty();
  renderCompare();
  addLog('A/B базата е изчистена.');
  showToast('Базата е изчистена.');
}

function pauseSimulation() {  if (!activeSim || activeSim.finished) return;
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
  selectedAgentId = null;
  simPaused = false;
  simAccumulator = 0;
  lastSimState = null;
  lastSimReport = null;
  simHistory = [];
  replayIndex = -1;
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
  renderChart();
  updateReplayControls();
  renderCompare();
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
  clone.querySelectorAll('.handle, .draft, .selected-room-label').forEach(el => el.remove());
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
    clone.append(svgEl('text', { x: 20, y: 636, fill: '#91a4bf', 'font-size': 11 }, (floor.name || '') + ' · учебен прототип v0.8.0 · ' + (project.settings.pxPerMeter || 25) + ' px = 1 m'));
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
    summaryRows.push(['Загинали (учебен модел)', String(state.fatal || 0)]);
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
      escapeHtml(st ? (st.fatal ? st.fatal + ' загинали / ' + st.people : st.status === 'done' ? 'готово' : st.status === 'no-route' ? 'без маршрут' : st.evacuated + '/' + st.people) : (group.status === 'no-route' ? 'без маршрут' : 'маршрут')) + '</td></tr>';
  }).join('');
  const warnings = (model.warnings || []).map(w => '<li>' + escapeHtml(w) + '</li>').join('');
  const html = '<h1>Evacuation Simulator — отчет</h1>' +
    '<div class="meta">Учебен прототип v0.8.0 · не е сертифициран инструмент за проектиране</div>' +
    '<h2>Обобщение</h2>' + summaryTable +
    (floorSections || '') +
    '<h2>Маршрути</h2><table><tr><th>Група</th><th>Хора</th><th>Етаж</th><th>Изход</th><th>Очаквано време</th><th>Статус</th></tr>' + (groupRows || '<tr><td colspan="6">Няма групи.</td></tr>') + '</table>' +
    '<h2>Проверки</h2><ul>' + (warnings || '<li>Няма забележки.</li>') + '</ul>' +
    '<p class="disclaimer">Резултатите са от опростен учебен модел с граф на достъпност, капацитет на врати/изходи/стълбища и опашки. Те моделират дим и стени само схематично и не отчитат структурни повреди, психология на тълпата или сертифицирани инженерни изчисления. Реалните евакуационни планове трябва да се изготвят и проверяват от компетентни специалисти.</p>';
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
  $('setFireSpeedMultiplier').value = Math.round(project.settings.fireSpreadMultiplier * 100);
  $('setFireExposureLimit').value = project.settings.fireExposureLimitSeconds;
  $('setSmokeFactor').value = project.settings.smokeFactor;
  $('setSmokeSlowdown').value = Math.round(project.settings.smokeSlowdown * 100);
  $('setSmokeVisibility').value = project.settings.smokeVisibilityMeters;
  $('setShowSmoke').checked = project.settings.showSmoke !== false;
  $('setShowHeatmap').checked = project.settings.showHeatmap === true;
  $('setMovementEffects').checked = project.settings.showMovementEffects === true;
  $('setDynamicRouting').checked = project.settings.dynamicRouting !== false;
  $('setFireExitSafety').value = project.settings.fireExitSafetyMeters == null ? 2 : project.settings.fireExitSafetyMeters;
  $('setWindDirection').value = project.settings.windDirection || 0;
  $('setWindStrength').value = project.settings.windStrength || 0;
  $('setWaitForAssistance').checked = project.settings.waitForAssistance !== false;
  $('setAllowFireElevator').checked = project.settings.allowFireElevator === true;
  $('setAutosave').checked = project.settings.autosave !== false;
  $('setShowRoutes').checked = project.settings.showRoutes !== false;
  $('setShowGrid').checked = project.settings.showGrid !== false;
  $('setSnap').checked = project.settings.snap !== false;
  $('setPreMovementDefault').value = project.settings.preMovement == null ? '' : project.settings.preMovement;
  const mix = project.settings.populationProfiles || { children: 15, older: 15, limited: 0 };
  ['children', 'older', 'limited'].forEach(k => $('profile-' + k).value = mix[k] || 0);
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
  const mix = Object.fromEntries(['children', 'older', 'limited'].map(k => [k, clamp(num($('profile-' + k).value, 0), 0, 100)]));
  if (mix.children + mix.older + mix.limited > 100) {
    showToast('Сборът на профилите не може да надвишава 100%.');
    return;
  }
  project.settings.populationProfiles = mix;
  project.settings.autosave = $('setAutosave').checked;
  project.settings.showRoutes = $('setShowRoutes').checked;
  project.settings.showGrid = $('setShowGrid').checked;
  project.settings.snap = $('setSnap').checked;
  project.settings.spreadSpeed = clamp(num($('setSpreadSpeed').value, 0.4), 0.02, 10);
  project.settings.fireSpreadMultiplier = clamp(num($('setFireSpeedMultiplier').value, 80) / 100, 0.2, 1.5);
  project.settings.fireExposureLimitSeconds = clamp(num($('setFireExposureLimit').value, 35), 5, 600);
  project.settings.smokeFactor = clamp(num($('setSmokeFactor').value, 2.2), 1, 5);
  project.settings.smokeSlowdown = clamp(num($('setSmokeSlowdown').value, 55) / 100, 0.2, 1);
  project.settings.smokeVisibilityMeters = clamp(num($('setSmokeVisibility').value, 5), 1, 30);
  project.settings.showSmoke = $('setShowSmoke').checked;
  project.settings.showHeatmap = $('setShowHeatmap').checked;
  project.settings.showMovementEffects = $('setMovementEffects').checked;
  project.settings.dynamicRouting = $('setDynamicRouting').checked;
  project.settings.fireExitSafetyMeters = clamp(num($('setFireExitSafety').value, 2), 0.5, 10);
  project.settings.windDirection = clamp(num($('setWindDirection').value, 0), 0, 359);
  project.settings.windStrength = clamp(num($('setWindStrength').value, 0), 0, 0.8);
  project.settings.waitForAssistance = $('setWaitForAssistance').checked;
  project.settings.allowFireElevator = $('setAllowFireElevator').checked;
  project.settings.showSpread = project.settings.showSpread !== false;
  const preRaw = $('setPreMovementDefault').value.trim();
  project.settings.preMovement = preRaw === '' ? null : Math.max(0, num(preRaw, 0));
  autosaveEnabled = project.settings.autosave;
  if (!autosaveEnabled) clearTimeout(saveTimer);
  markDirty();
  updateHeader();
  updateScenarioUI();
  $('showSmoke').checked = project.settings.showSmoke;
  $('showHeatmap').checked = project.settings.showHeatmap;
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
  currentFloor = 0;
  const addedDefaultMarker=ensureSecurityMarker();
  if (name) {
    project.projectName = name.replace(/\.evac\.json$/i, '').replace(/\.json$/i, '');
  }
  currentFloor = 0;
  selectedId = null;
  history = { past: [], future: [] };
  previewModel = null;
  revision++;
  attachmentMeta.clear();
  dirty = addedDefaultMarker;
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
    limitedPercent: $('libIncludeLimited').checked ? clamp(num($('libLimitedPercent').value, 5), 0, 70) : 0,
    hazard: $('libHazard').value,
    includeFurniture: $('libModeFurnished').checked,
    includeAdvanced: $('libModeAdvanced').checked,
    includeAlarms: $('libIncludeAlarms').checked,
    includeSprinklers: $('libIncludeSprinklers').checked,
    includeTimeline: $('libIncludeTimeline').checked
  };
}

// Standard = no enhancements; furniture and advanced materials are combinable.
function changeLibraryMode(changedId) {
  const standard=$('libModeStandard'),furnished=$('libModeFurnished'),advanced=$('libModeAdvanced');
  if(changedId==='libModeStandard' && standard.checked) {
    furnished.checked=false;advanced.checked=false;
  } else {
    standard.checked=!(furnished.checked||advanced.checked);
  }
  updateLibrarySummary();
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
  const opts = libraryOptions();
  const count = (type) => testProject.floors.reduce((n,f) => n + f.items.filter(it=>it.type===type).length,0);
  const variant = opts.includeFurniture && opts.includeAdvanced ? 'обзаведена + Advanced Build' :
    opts.includeFurniture ? 'обзаведена' : opts.includeAdvanced ? 'Advanced Build' : 'стандартна';
  box.textContent = BuildingLibrary.summaryText(testProject) + ' · вариант: ' + variant +
    ' · мебели: ' + count('furniture') + ' · материални зони: ' + count('surface') +
    ' · тухлени стени: ' + count('wall') + ' · ограничена подвижност: ' + opts.limitedPercent +
    '% · аларма ' + (opts.includeAlarms?'ДА':'НЕ') + ' · спринклери ' + (opts.includeSprinklers?'ДА':'НЕ') + ' · seed ' + opts.seed;
}

function openLibraryDialog() {
  if (!window.BuildingLibrary) {
    showToast('Библиотеката с тестови сгради не е заредена.', true);
    return;
  }
  renderLibraryPresets();
  changeLibraryMode('');
  $('libLimitedPercent').disabled = !$('libIncludeLimited').checked;
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
  project = sanitizeProject(generated);
  project.settings.alarmsEnabled = $('libIncludeAlarms').checked;
  project.settings.sprinklersEnabled = $('libIncludeSprinklers').checked;
  project.settings.scenarioCreatorEnabled = $('libIncludeTimeline').checked;
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

/* -------------------------- v0.8 data exports -------------------------- */
async function exportSimCsv() {
  if (!simHistory.length) {
    showToast('Първо стартирай симулация, за да има времеви редове.', true);
    return;
  }
  const head = ['time_s', 'total', 'evacuated', 'sheltered_waiting_help', 'queued',
    'moving', 'waiting', 'no_route', 'fatal', 'in_hazard', 'in_smoke', 'evacuated_pct', 'reroutes'];
  const rows = simHistory.map(({ state: s }) => [
    s.time.toFixed(2), s.total, s.safe, s.sheltered, s.counts.queued,
    s.counts.moving, s.counts.waiting, s.noRoute, s.fatal || 0,
    s.inHazard, s.inSmoke, (s.total ? s.safe / s.total * 100 : 0).toFixed(2), s.reroutes
  ]);
  // BOM + semicolon delimiter work well with Bulgarian Excel locale.
  const csv = '\uFEFF' + [head.join(';'), ...rows.map(row => row.join(';'))].join('\r\n') + '\r\n';
  const name = safeFileName((project.projectName || 'evacuation') + '_timeseries', 'timeseries') + '.csv';
  await saveBinary(name, toBase64Utf8(csv), [{ name: 'CSV (Excel)', extensions: ['csv'] }]);
}

/* -------------------------- test building suite -------------------------- */
async function runAllBuildingTests() {
  const btn = $('runAllTests');
  const box = $('allTestsResults');
  if (!window.BuildingLibrary) { showToast('Библиотеката не е заредена.', true); return; }
  btn.disabled = true;
  box.innerHTML = '<p class="note">Изпълнение на проверки…</p>';
  const rows = [];
  try {
    for (const preset of BuildingLibrary.PRESETS) {
      // Отстъпване към интерфейса, за да не замръзне таблицата.
      await new Promise(resolve => setTimeout(resolve, 0));
      let status = 'НЕ', detail = '';
      try {
        const generated = BuildingLibrary.generate({ preset: preset.id, seed: 12345 });
        const model = EvacSim.buildModel(generated, { scenario: 'quake' });
        const sim = EvacSim.createSimulation(model, { preMovement: 0, timeout: 500 });
        let state = sim.snapshot();
        for (let i = 0; i < 250 && !sim.finished; i++) state = sim.advance(2);
        const counted = state.safe + state.sheltered + state.noRoute + (state.fatal || 0) + state.counts.moving + state.counts.queued + state.counts.waiting + state.counts.sheltering;
        const valid = model.groups.length > 0 && model.exits.length > 0 && model.totalPeople > 0 &&
          counted === state.total && Number.isFinite(state.time) &&
          (state.safe > 0 || state.sheltered > 0);
        status = valid ? 'МИНАТО' : 'НЕУСПЕШНО';
        detail = state.safe + '/' + state.total + ' евакуирани · ' +
          model.exits.length + ' изхода · ' + (state.noRoute || 0) + ' без маршрут';
      } catch (e) { status = 'ГРЕШКА'; detail = String(e.message || e); }
      rows.push({ name: preset.title, status, detail });
      box.innerHTML = '<table class="route-table"><tr><th>Сграда</th><th>Тест</th><th>Резултат</th></tr>' +
        rows.map(r => '<tr><td>' + escapeHtml(r.name) + '</td><td>' + escapeHtml(r.status) +
          '</td><td>' + escapeHtml(r.detail) + '</td></tr>').join('') + '</table>';
    }
    const failed = rows.filter(r => r.status !== 'МИНАТО').length;
    box.insertAdjacentHTML('beforeend', '<p class="note">Тестови сценарии: ' + rows.length +
      ' · минали: ' + (rows.length - failed) + ' · неуспешни: ' + failed +
      '. Учебни автоматични проверки, не инженерна валидация.</p>');
    addLog('Тестови сгради: ' + (rows.length - failed) + '/' + rows.length + ' успешни проверки.');
  } finally { btn.disabled = false; }
}

/* -------------------------- DXF (ASCII, 2D) -------------------------- */
async function importDxfPlan() {
  if (isSimActive()) { showToast('Спри симулацията преди импорт.'); return; }
  try {
    let text = null;
    if (desktop && desktop.pickFiles && desktop.readFile) {
      const result = await desktop.pickFiles();
      if (!result || result.canceled || !result.files || !result.files.length) return;
      const candidate = result.files.find(file => extOf(file.name) === 'dxf');
      if (!candidate) throw new Error('Избери ASCII DXF файл (.dxf). PDF се използва като подложка чрез „Прикачи файл“.');
      const data = await desktop.readFile(candidate.path);
      if (!data || !data.ok) throw new Error(data && data.error || 'Неуспешно четене на DXF.');
      text = atob(String(data.dataUrl).split(',')[1] || '');
    } else {
      const file = await new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.dxf';
        input.onchange = () => resolve(input.files && input.files[0]);
        input.click();
      });
      if (!file) return;
      text = await file.text();
    }
    const result = window.DxfLite.toPlan(text);
    if (!result.items.length) throw new Error('Не са разпознати поддържани 2D елементи.');
    const message = 'DXF: намерени ' + result.rooms + ' правоъгълни помещения и ' + result.walls +
      ' линии за стени. Да се добавят към текущия етаж? Врати, изходи и брой хора се задават ръчно.';
    if (!confirm(message)) return;
    pushHistory();
    result.items.forEach(it => { it.id = uid(); currentFloorData().items.push(it); });
    markDirty();
    afterProjectChanged();
    showToast('DXF импорт: добавени ' + result.items.length + ' елемента.');
    addLog(message);
  } catch (e) {
    showToast('DXF импорт: ' + e.message, true);
    addLog('DXF импорт неуспешен: ' + e.message);
  }
}

/* --------------------------- Smart Import v0.10.0 --------------------------- */
function commitSmartImport({items, fileInfo, scaleLimited, mode, backdropScale}) {
  if (isSimActive()) { showToast('Спри симулацията.', true); return false; }
  if (!items || !items.length) return false;
  pushHistory();
  const floor = currentFloorData();
  items.forEach(it => floor.items.push(Object.assign({ id: uid() }, it)));
  if (fileInfo && fileInfo.path) {
    let attachment = project.attachments.find(a => a.path === fileInfo.path);
    if (!attachment) {
      attachment = { id:uid(), name:fileInfo.name, path:fileInfo.path,
        ext:extOf(fileInfo.name),size:fileInfo.size||0,addedAt:nowIso() };
      project.attachments.push(attachment);
    }
    attachmentMeta.set(attachment.id, {dataUrl:fileInfo.dataUrl,
      width:0,height:0,size:fileInfo.size||0,missing:false });
    // Use native dimensions for correct aspect ratio and consistent backdrop mapping.
    imageSize(fileInfo.dataUrl).then(dim => {
      const meta = attachmentMeta.get(attachment.id);
      if (meta) {meta.width=dim.width;meta.height=dim.height;}
      draw();
    });
    if (!floor.backdrop) floor.backdrop = {attachmentId:attachment.id,kind:'image',
      opacity:.28,scale:clamp(num(backdropScale,1),0.1,3),x:0,y:0,rotation:0,visible:true};
  }
  selectedId = items.length ? floor.items[floor.items.length-1].id : null;
  markDirty();afterProjectChanged();
  const message = mode === 'facade' ?
    'Ориентировъчен контур от фасада — помещения и хора НЕ са извлечени.' :
    'Smart Import: добавени '+items.length+' обекта, включително ръчно поставените. Провери връзките и мащаба.';
  showToast(message); addLog(message);
  if (scaleLimited) addLog('Smart Import: изображението е побрано в работната зона; провери реалния мащаб.');
  // Run the project validator after the Smart Import dialog has closed.
  if(mode==='plan')setTimeout(()=>{
    const result=runValidator(true);
    if(result)addLog('Автоматична проверка след импорт: '+result.summaryText+
      '. Провери помещения без врати, липсващи изходи и групи без маршрут.');
  },0);
  return true;
}

/* ----------------------------- animated 3D viewer ----------------------------- */
function open3DAnimation() {
  if (!scene3dController) {
    showToast('3D визуализацията не е заредена.', true);
    return;
  }
  if(ensureSecurityMarker()){markDirty();refreshAnalysis();draw();}
  scene3dController.open();
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
  const tools = { v: 'select', r: 'room', c: 'corridor', d: 'door', e: 'exit', s: 'stairs', p: 'people', h: 'hazard', w: 'wall', o: 'opening', l: 'elevator', z: 'safezone', g: 'courtyard', m:'surface', f:'furniture' };
  if (/^[1-9]$/.test(key) && !event.ctrlKey && !event.metaKey && !isSimActive()) {
    const index = Number(key) - 1;
    if (index < project.floors.length) {
      event.preventDefault(); currentFloor = index; selectedId = null;
      afterProjectChanged();
    }
    return;
  }
  if (['arrowleft','arrowright','arrowup','arrowdown'].includes(key) && selectedItem() && !isSimActive()) {
    event.preventDefault();
    const item = selectedItem();
    const distance = event.shiftKey ? 10 : 1;
    const dx = key === 'arrowleft' ? -distance : key === 'arrowright' ? distance : 0;
    const dy = key === 'arrowup' ? -distance : key === 'arrowdown' ? distance : 0;
    pushHistory();
    if (item.type === 'wall') { item.x2 += dx; item.y2 += dy; }
    item.x = clamp(item.x + dx, 0, SVG_W);
    item.y = clamp(item.y + dy, 0, SVG_H);
    markDirty(); renderObjectEditor(); draw(); refreshAnalysis();
    return;
  }
  if (tools[key] && !event.ctrlKey && !event.metaKey && !event.altKey && !isSimActive()) {
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
    text: 'Тук виждаш общо хора, евакуирани, чакащи в опашка, симулационно време и процент обработени от учебния модел. Изчакващите помощ се отчитат отделно.'
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

function renderMaterialDetails() {
  const select = $('buildMaterial');
  if (!select) return;
  const m = Materials.get(select.value);
  chosenMaterialId = select.value;
  const div = $('materialDetails');
  if (!div) return;
  div.replaceChildren();
  const swatch = document.createElement('span'); swatch.className = 'material-swatch'; swatch.style.background = m.color;
  const title = document.createElement('strong'); title.textContent = m.name;
  const desc = document.createElement('div'); desc.className = 'note'; desc.textContent = m.note;
  const info = document.createElement('div'); info.className = 'material-factors';
  info.textContent = 'Ходене ×' + m.walk.toFixed(2) + ' · Пожар ×' + m.fire.toFixed(2) +
    ' · Вода ×' + m.flood.toFixed(2) + ' · Дим ×' + m.smoke.toFixed(2);
  div.append(swatch, title, desc, info);
}

function setupMaterials() {
  const select = $('buildMaterial'); if (!select) return;
  select.replaceChildren();
  Object.entries(Materials.MATERIALS).forEach(([id, m]) => {
    const opt = document.createElement('option'); opt.value = id; opt.textContent = m.name; select.append(opt);
  });
  select.value = chosenMaterialId;
  select.addEventListener('change', renderMaterialDetails);
  $('startSurfaceTool').addEventListener('click', () => {
    if (isSimActive()) { showToast('Спри симулацията, за да редактираш.'); return; }
    setTool('surface');
  });
  const guide=$('materialGuideBody');
  if(guide){
    guide.replaceChildren();
    for(const [id,m] of Object.entries(Materials.MATERIALS)){
      const tr=document.createElement('tr');tr.tabIndex=0;tr.title=m.note;
      const label=document.createElement('td');
      const swatch=document.createElement('i');swatch.className='material-swatch';swatch.style.background=m.color;
      label.append(swatch,document.createTextNode(' '+m.name));tr.append(label);
      for(const val of [m.walk,m.fire,m.smoke,m.flood,m.wet]){
        const td=document.createElement('td');td.textContent='×'+val.toFixed(2);
        td.className=val>1.01?'factor-up':val<.99?'factor-down':'';tr.append(td);
      }
      tr.addEventListener('click',()=>{select.value=id;renderMaterialDetails();});
      guide.append(tr);
    }
  }
  renderMaterialDetails();
}

// The preview uses the standard base speed. Individual ignitions may specify
// their own base speed; the percentage still scales ALL ignitions in the engine.
function updateFireSpeedPreview(percent){
  const value=clamp(num(percent,80),20,150);
  const base=project ? clamp(num(project.settings.spreadSpeed,0.4),0.02,10) : 0.4;
  $('fireSpeedEffective').textContent='Стандартно огнище: ~'+(base*value/100).toFixed(2).replace('.',',')+' м/сек. · '+
    (value<80?'по-бавно от стандартното':value>80?'по-бързо от стандартното':'стандартна настройка');
}

// Optional systems / timeline. No legacy project is changed unless the user opts in.
function renderScenarioExtras(){
  if(!project || !$('exAlarms'))return;
  const s=project.settings;
  const disasterFields={exFloodRise:'floodRiseMetersPerSecond',
    exFloodMax:'floodMaxHeightMeters',exFloodStart:'floodStartSeconds',
    exQuakeMagnitude:'quakeMagnitude',exQuakeDuration:'quakeShakingSeconds',
    exQuakeCollapse:'quakeCollapseEnabled',exCollapseAt:'quakeCollapseAtSeconds',
    exHelpCall:'threatHelpCallEnabled',exHelpCallAt:'threatHelpCallAtSeconds',
    exSecurityEnhanced:'securityEnhancedEnabled',exSecurityRoam:'securityRoamEnabled',
    exSecurityRoomVisuals:'securityRoomVisualsEnabled',
    exSecurityWarningAt:'securityWarningAtSeconds',exSecurityEmergencyAt:'securityEmergencyAtSeconds',
    exSecurityEvacuationPercent:'securityEvacuationPercent',
    exSecurityRoamPeriod:'securityRoamPeriodSeconds',
    exSecurityHelpConfirm:'securityHelpConfirmSeconds',exSecurityHelpArrival:'securityHelpArrivalSeconds'};
  for(const [id,key] of Object.entries(disasterFields)){
    const field=$(id);if(!field)continue;
    if(field.type==='checkbox')field.checked=!!s[key];
    else field.value=id==='exSecurityEvacuationPercent'?'0':(s[key]==null?'':s[key]);
  }
  ['fire','flood','quake','threat'].forEach((key)=>{
    const section=$(key+'ScenarioSettings');if(section)section.hidden=(s.scenario!==(key==='threat'?'lockdown':key));
  });
  // Magnitudes 9 and 10 have fixed scenario-time collapse moments.
  // Keep the saved 8–8.9 custom timer intact for switching magnitudes back.
  const automaticAt=EvacDisasters.automaticCollapseAt(s);
  const autoCollapse=Number.isFinite(automaticAt);
  $('exQuakeCollapse').disabled=autoCollapse;
  $('exQuakeCollapse').checked=autoCollapse || !!s.quakeCollapseEnabled;
  $('exCollapseAt').disabled=autoCollapse;
  if(autoCollapse)$('exCollapseAt').value=String(automaticAt);
  $('quakeCollapseInfo').textContent=autoCollapse
    ? 'Автоматично: магнитуд '+Math.round(EvacDisasters.normalize(s).quakeMagnitude)+' → '+Math.round(automaticAt/60)+' мин. симулационно време (всички етажи едновременно).'
    : 'Магнитуд 8–8.9: избери срутване и въведи време; под 8 срутване не се прилага.';
  const fireCount=$('fireIgnitionCount');if(fireCount)fireCount.textContent='Огнища в плана: '+
    project.floors.reduce((sum,f)=>sum+(f.items||[]).filter(item=>item.type==='hazard').length,0);
  const firePercent=Math.round(clamp(num(s.fireSpreadMultiplier,0.8),0.2,1.5)*100);
  $('exFireSpeedMultiplier').value=String(firePercent);
  $('exFireSpeedSlider').value=String(firePercent);
  updateFireSpeedPreview(firePercent);
  const fields={exAlarms:'alarmsEnabled',exAlarmAt:'alarmAtSeconds',exSprinklers:'sprinklersEnabled',
    exSprinklerAt:'sprinklerAtSeconds',exSprinklerFactor:'sprinklerFactor',
    exBehavior:'behaviorEnabled',exHesitant:'hesitantPercent',exFollowers:'followerPercent',
    exGroupTogether:'groupTogether',exVentilation:'ventilationEnabled',exVentStrength:'ventilationStrength',exVentDirection:'ventilationDirection',
    exTimeline:'scenarioCreatorEnabled'};
  Object.entries(fields).forEach(([id,key])=>{const el=$(id);if(!el)return;
    if(el.type==='checkbox')el.checked=!!s[key];
    else el.value=key==='sprinklerFactor'?Math.round(100*num(s[key],.55)):s[key];
  });
  $('exAddEvent').disabled=!s.scenarioCreatorEnabled;
  const list=$('scenarioEventList');list.replaceChildren();
  if(!s.scenarioCreatorEnabled){const note=document.createElement('p');note.className='note';note.textContent='Изключено — няма автоматични събития.';list.append(note);return;}
  const typeNames={ignition:'Започва пожар',alarm:'Пожарна аларма',sprinkler:'Спринклери',
    'door-close':'Затваряне на врата','door-open':'Отваряне на врата','door-lock':'Заключване на врата',ventilation:'Пуска се вентилация'};
  (s.timelineEvents||[]).forEach((event,index)=>{
    const row=document.createElement('div');row.className='scenario-event';
    const typeLabel=document.createElement('label');typeLabel.textContent='Събитие';
    const type=document.createElement('select');
    Object.entries(typeNames).forEach(([key,title])=>{const option=document.createElement('option');option.value=key;option.textContent=title;type.append(option);});
    type.value=event.type;typeLabel.append(type);
    const timeLabel=document.createElement('label');timeLabel.textContent='На сек.';
    const time=document.createElement('input');time.type='number';time.min=0;time.max=3600;time.step=1;time.value=event.atSeconds;timeLabel.append(time);
    const remove=document.createElement('button');remove.className='small danger';remove.textContent='×';remove.title='Премахни събитие';
    const targetLabel=document.createElement('label');targetLabel.className='event-target';targetLabel.textContent='Обект';
    const target=document.createElement('select');
    function targets(){
      target.replaceChildren();const opts=[['','Всички / първи подходящ']];
      project.floors.forEach((floor,fi)=>(floor.items||[]).forEach(item=>{
        const acceptable=type.value==='ignition'?'hazard':type.value.startsWith('door-')?'door':null;
        if(acceptable && item.type===acceptable)opts.push([String(item.id),(item.name||item.type)+' · ет. '+(fi+1)]);
      }));
      opts.forEach(([id,name])=>{const option=document.createElement('option');option.value=id;option.textContent=name;target.append(option);});
      target.value=opts.some(x=>x[0]===event.targetId)?event.targetId:'';
    }
    targets();targetLabel.append(target);
    type.addEventListener('change',()=>{pushHistory();event.type=type.value;event.targetId='';markDirty();renderScenarioExtras();});
    time.addEventListener('change',()=>{pushHistory();event.atSeconds=clamp(num(time.value,0),0,3600);markDirty();renderScenarioExtras();});
    target.addEventListener('change',()=>{pushHistory();event.targetId=target.value;markDirty();});
    remove.addEventListener('click',()=>{pushHistory();s.timelineEvents.splice(index,1);markDirty();renderScenarioExtras();});
    row.append(typeLabel,timeLabel,remove,targetLabel);list.append(row);
  });
}
function bindScenarioExtras(){
  // Edit the existing global fire multiplier: it affects every ignition,
  // including an ignition with a per-source spreadSpeed override.
  const fireNumber=$('exFireSpeedMultiplier');
  const fireSlider=$('exFireSpeedSlider');
  function previewFireSpeed(source,target){
    target.value=source.value;
    updateFireSpeedPreview(source.value);
  }
  fireSlider.addEventListener('input',()=>previewFireSpeed(fireSlider,fireNumber));
  fireNumber.addEventListener('input',()=>{
    if(fireNumber.value.trim())previewFireSpeed(fireNumber,fireSlider);
  });
  function saveFireSpeed(source){
    if(isSimActive()){
      showToast('Спри симулацията, за да промениш скоростта на огъня.');
      renderScenarioExtras();
      return;
    }
    if(!source.value.trim() || !Number.isFinite(Number(source.value))){
      showToast('Въведи скорост между 20% и 150%.',true);
      renderScenarioExtras();
      return;
    }
    const percent=Math.round(clamp(Number(source.value),20,150));
    if(Math.abs(project.settings.fireSpreadMultiplier-percent/100)>0.0001){
      pushHistory();
      project.settings.fireSpreadMultiplier=percent/100;
      markDirty();
      refreshAnalysis();
      draw();
    }
    renderScenarioExtras();
  }
  fireSlider.addEventListener('change',()=>saveFireSpeed(fireSlider));
  fireNumber.addEventListener('change',()=>saveFireSpeed(fireNumber));
  // The info buttons only reveal supplementary guidance; inputs remain usable at all times.
  document.querySelectorAll('#disasterScenarioSettings .scenario-info-toggle').forEach(button=>{
    const panel=$(button.getAttribute('aria-controls'));
    if(!panel)return;
    button.addEventListener('click',()=>{
      const expanded=button.getAttribute('aria-expanded')==='true';
      panel.hidden=expanded;
      button.setAttribute('aria-expanded',String(!expanded));
      button.title=expanded?'Покажи информация':'Скрий информация';
    });
  });
  const fields={exAlarms:'alarmsEnabled',exAlarmAt:'alarmAtSeconds',exSprinklers:'sprinklersEnabled',
    exSprinklerAt:'sprinklerAtSeconds',exSprinklerFactor:'sprinklerFactor',
    exBehavior:'behaviorEnabled',exHesitant:'hesitantPercent',exFollowers:'followerPercent',
    exGroupTogether:'groupTogether',exVentilation:'ventilationEnabled',exVentStrength:'ventilationStrength',exVentDirection:'ventilationDirection',
    exTimeline:'scenarioCreatorEnabled'};
  const disasterFields={exFloodRise:'floodRiseMetersPerSecond',
    exFloodMax:'floodMaxHeightMeters',exFloodStart:'floodStartSeconds',
    exQuakeMagnitude:'quakeMagnitude',exQuakeDuration:'quakeShakingSeconds',
    exQuakeCollapse:'quakeCollapseEnabled',exCollapseAt:'quakeCollapseAtSeconds',
    exHelpCall:'threatHelpCallEnabled',exHelpCallAt:'threatHelpCallAtSeconds',
    exSecurityEnhanced:'securityEnhancedEnabled',exSecurityRoam:'securityRoamEnabled',
    exSecurityRoomVisuals:'securityRoomVisualsEnabled',
    exSecurityWarningAt:'securityWarningAtSeconds',exSecurityEmergencyAt:'securityEmergencyAtSeconds',
    exSecurityEvacuationPercent:'securityEvacuationPercent',
    exSecurityRoamPeriod:'securityRoamPeriodSeconds',
    exSecurityHelpConfirm:'securityHelpConfirmSeconds',exSecurityHelpArrival:'securityHelpArrivalSeconds'};
  for(const [id,key] of Object.entries(disasterFields))$(id).addEventListener('change',e=>{
    if(isSimActive()){showToast('Спри симулацията, за да редактираш.');renderScenarioExtras();return;}
    pushHistory();const el=e.target;
    const value=el.type==='checkbox'?el.checked:(id==='exFloodMax' && el.value.trim()===''?null:num(el.value,0));
    const candidate=Object.assign({},project.settings,{[key]:value});
    Object.assign(project.settings,EvacDisasters.normalize(candidate));
    Object.assign(project.settings,Security.normalize(candidate));
    markDirty();renderScenarioExtras();refreshAnalysis();draw();
  });
  $('exFloodMax').addEventListener('input',()=>{
    const input=$('exFloodMax'),error=$('floodHeightError');
    error.textContent=input.value.trim() && input.validity.valid?'':'Посочи валидна максимална височина (0,1–30 м).';
  });
  $('addFireIgnition').addEventListener('click',()=>{
    if(isSimActive())return showToast('Първо спри симулацията.');
    document.querySelector('.tool[data-tool="hazard"]').click();
    showToast('Щракни в помещението, за да добавиш още едно огнище.');
  });
  $('addThreatMarker').addEventListener('click',()=>{
    if(isSimActive())return showToast('Първо спри симулацията.');
    document.querySelector('.tool[data-tool="threat"]').click();
    showToast('Щракни, за да добавиш предупредителен символ.');
  });
  Object.entries(fields).forEach(([id,key])=>$(id).addEventListener('change',e=>{
    if(isSimActive()){showToast('Спри симулацията, за да редактираш.');renderScenarioExtras();return;}
    pushHistory();const el=e.target;
    project.settings[key]=el.type==='checkbox'?el.checked:key==='sprinklerFactor'?clamp(num(el.value,55)/100,.1,1):
      key==='ventilationStrength'?clamp(num(el.value,.45),0,.8):
      key==='ventilationDirection'?clamp(num(el.value,0),0,359):clamp(num(el.value,0),0,3600);
    if(key==='hesitantPercent'||key==='followerPercent'){
      const hs=project.settings.hesitantPercent,fo=project.settings.followerPercent;
      if(hs+fo>100) project.settings.followerPercent=Math.max(0,100-hs);
    }
    markDirty();renderScenarioExtras();refreshAnalysis();draw();
  }));
  $('exAddEvent').addEventListener('click',()=>{
    if(isSimActive()||!project.settings.scenarioCreatorEnabled)return;
    pushHistory();project.settings.timelineEvents.push({id:'evt'+uid(),type:'alarm',atSeconds:10,targetId:''});
    markDirty();renderScenarioExtras();
  });
}

function switchWorkspace(view) {
  if (!['project','scenarios','advanced','reports'].includes(view)) return;
  workspaceView = view;
  const main = $('appMain'); if (main) main.dataset.page = view;
  document.querySelectorAll('.nav-link[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
    if (btn.dataset.view === view) btn.setAttribute('aria-current','page');
    else btn.removeAttribute('aria-current');
  });
  const scroller = view === 'project' || view === 'advanced' ? document.querySelector('.side') : document.querySelector('.rightpanel');
  if (scroller) scroller.scrollTop = 0;
  const expandGroup=(group)=>{
    const toggle=group&&group.querySelector(':scope > .group-fold');
    if(toggle&&toggle.getAttribute('aria-expanded')==='false')toggle.click();
  };
  if(view==='advanced')expandGroup($('advancedBuildPanel'));
  if (view === 'reports') {
    const report = $('report');
    if(report){expandGroup(report.closest('.group'));report.closest('.group').scrollIntoView({block:'start'});}
  }
}

function bindWorkspaceNavigation() {
  document.querySelectorAll('.nav-link[data-view]').forEach(btn =>
    btn.addEventListener('click', () => switchWorkspace(btn.dataset.view)));
  const actions = {
    library: () => $('openLibrary').click(),
    'smart-import': () => $('openSmartImport').click(),
    '3d': () => $('openIso').click(),
    validate: () => $('validatePlan').click(),
    settings: () => $('openSettings').click(),
    help: () => $('openHelp').click()
  };
  document.querySelectorAll('.nav-link[data-action]').forEach(btn => btn.addEventListener('click', () => {
    const callback = actions[btn.dataset.action]; if (callback) callback();
  }));
}

function bindEvents() {
  setupMaterials();
  if(Furnishing){
    const types=$('furnitureType');
    Object.entries(Furnishing.TYPES).forEach(([id,t])=>{
      const opt=document.createElement('option');opt.value=id;opt.textContent=t.label;types.append(opt);
    });
    $('placeSingleFurniture').addEventListener('click',()=>{
      if(isSimActive()) return showToast('Спри симулацията, за да редактираш.',true);
      setTool('furniture');
      showToast('Избери място върху плана за мебел: '+Furnishing.TYPES[$('furnitureType').value].label);
    });
    $('furnishSelected').addEventListener('click',()=>{
      if(isSimActive())return showToast('Спри симулацията, за да редактираш.',true);
      const room=selectedItem();
      if(!room||room.type!=='room')return showToast('Първо избери помещение в 2D плана.',true);
      const want=Math.round(clamp(num($('furnitureSeats').value,12),0,100));
      const arrangement=Furnishing.layout(room,$('furniturePreset').value,want);
      if(!arrangement.furniture.length)return showToast('Помещението е прекалено малко за тази подредба.',true);
      pushHistory();
      arrangement.furniture.forEach(it=>currentFloorData().items.push(Object.assign({id:uid()},it)));
      if($('furnitureAddPeople').checked){
        // Clear room's built-in people to avoid double counting (preserve total).
        const existing=Math.max(0,(room.people||0)+(room.teachers||0));
        const target=existing||want;
        room.people=0;room.teachers=0;
        Furnishing.peopleForSeats(arrangement.seats,target,'Място').forEach(it=>
          currentFloorData().items.push(Object.assign({id:uid()},it)));
        const unseated=target-Math.min(target,arrangement.seats.length);
        if(unseated>0)currentFloorData().items.push({id:uid(),type:'people',
          name:'Останали хора в помещението',x:room.x+room.w*.5,y:room.y+room.h*.5,count:unseated});
      }
      markDirty();draw();renderObjectEditor();updateStats();refreshAnalysis();
      showToast('Добавени '+arrangement.furniture.length+' мебели. Симулацията ще ги заобикаля.');
    });
  }
  $('trackAgentGo').addEventListener('click',()=>{
    const id=Math.floor(Number($('trackAgentId').value));
    if(!activeSim||!Number.isInteger(id)||id<1||!displayAgents().some(a=>a.id===id))
      return showToast('Въведи номер на съществуващ човек от симулацията.',true);
    selectedAgentId=id;const a=displayAgents().find(a=>a.id===id);
    if(a.floor!==currentFloor){currentFloor=a.floor;refreshFloorSelect();}
    renderTrackingPanel();draw();
  });
  $('trackAgentClear').addEventListener('click',()=>{selectedAgentId=null;$('trackAgentId').value='';draw();});
  bindWorkspaceNavigation();
  bindScenarioExtras();
  document.querySelectorAll('.tool[data-tool], .mini-tool[data-tool]').forEach(btn => {
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
  $('openIso').addEventListener('click', open3DAnimation);
  $('smartImportShortcut').addEventListener('click', () => $('openSmartImport').click());

  installCollapsiblePanels();
  $('run').addEventListener('click', startSimulation);
  $('pause').addEventListener('click', pauseSimulation);
  $('stop').addEventListener('click', () => stopSimulation(false));
  $('restartSimulation').addEventListener('click',()=>{stopSimulation(false);setStatus('Върнато начално състояние · готово за нова симулация.');});
  $('speedSelect').addEventListener('change', () => { simAccumulator = 0; });

  ['showSmoke', 'showHeatmap'].forEach(id => {
    $(id).addEventListener('change', event => {
      project.settings[id] = event.target.checked;
      markDirty(); draw();
    });
  });
  $('miniHeat').addEventListener('click', () => {
    $('showHeatmap').checked = !project.settings.showHeatmap;
    $('showHeatmap').dispatchEvent(new Event('change'));
  });
  $('miniSmoke').addEventListener('click', () => {
    $('showSmoke').checked = !project.settings.showSmoke;
    $('showSmoke').dispatchEvent(new Event('change'));
  });
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
      if(next==='flood')project.settings.floodGroundRiseEnabled=true;
      if(next==='lockdown' && ensureSecurityMarker())
        showToast('Добавен е червен обозначител на заплаха. Можеш да го преместиш в плана.');
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
  ['libModeStandard','libModeFurnished','libModeAdvanced'].forEach(id=>
    $(id).addEventListener('change',()=>changeLibraryMode(id)));
  ['libIncludeAlarms','libIncludeSprinklers','libIncludeTimeline'].forEach(id => $(id).addEventListener('change', updateLibrarySummary));
  $('libIncludeLimited').addEventListener('change', () => {
    $('libLimitedPercent').disabled = !$('libIncludeLimited').checked;
    updateLibrarySummary();
  });
  ['libSeed', 'libFloors', 'libRooms', 'libPeople', 'libHazard', 'libLimitedPercent'].forEach(id => {
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
  $('runAllTests').addEventListener('click', runAllBuildingTests);
  $('importDxf').addEventListener('click', importDxfPlan);
  $('checkUpdates').addEventListener('click', () => {
    $('updateStatus').textContent = 'Няма конфигуриран подписан инсталатор и update сървър. Виж RELEASE.md в архива.';
    showToast('Автоматичното обновяване още не е активирано.');
  });
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
  $('exportCsv').addEventListener('click', () => openExportDialog('csv'));

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
      if (format === 'csv') {
        await exportSimCsv();
      } else if (format === 'pdf' || scope === 'all') {
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
  if (window.EvacSmartImportUI && window.EvacSmartImport) {
    smartImportController = new window.EvacSmartImportUI.Controller({
      desktop, getPxPerMeter: () => project ? project.settings.pxPerMeter : 25,
      isSimActive, toast: showToast, commit: commitSmartImport
    });
  }
  if (window.EvacScene3DUI) {
    scene3dController = new window.EvacScene3DUI.Controller({
      getProject: () => project,
      buildModel: () => getPreviewModel(),
      getSimulation: () => activeSim,
      getLiveState: () => lastSimState,
      getHistory: () => simHistory,
      isPaused: () => simPaused,
      start: () => startSimulation(),
      restart: () => stopSimulation(false),
      pause: () => pauseSimulation(),
      toast: showToast
    });
  }
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
  addLog('Evacuation Simulator v0.10.0 — учебен прототип.');
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



