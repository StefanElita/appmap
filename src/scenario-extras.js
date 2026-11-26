/* Optional learning scenarios. Values are illustrative, not fire-safety specifications. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EvacExtras = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const types = ['ignition', 'alarm', 'sprinkler', 'door-close', 'door-open', 'door-lock', 'ventilation'];
  const number = (x, d) => Number.isFinite(Number(x)) ? Number(x) : d;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const defaults = Object.freeze({
    alarmsEnabled: false, alarmAtSeconds: 10,
    sprinklersEnabled: false, sprinklerAtSeconds: 18, sprinklerFactor: 0.55,
    scenarioCreatorEnabled: false, timelineEvents: [],
    behaviorEnabled: true, hesitantPercent: 15, followerPercent: 12, groupTogether: false,
    ventilationEnabled: false, ventilationStrength: 0.45, ventilationDirection: 0
  });
  function normalize(settings) {
    const src = settings || {};
    const s = Object.assign({}, defaults, src);
    ['alarmsEnabled','sprinklersEnabled','scenarioCreatorEnabled','groupTogether','ventilationEnabled','behaviorEnabled']
      .forEach(k => s[k] = s[k] === true);
    s.alarmAtSeconds = clamp(number(s.alarmAtSeconds,10),0,3600);
    s.sprinklerAtSeconds = clamp(number(s.sprinklerAtSeconds,18),0,3600);
    s.sprinklerFactor = clamp(number(s.sprinklerFactor,.55),.1,1);
    s.hesitantPercent = clamp(number(s.hesitantPercent,15),0,100);
    s.followerPercent = clamp(number(s.followerPercent,12),0,100);
    if (s.hesitantPercent + s.followerPercent > 100) s.followerPercent = 100 - s.hesitantPercent;
    s.ventilationStrength = clamp(number(s.ventilationStrength,.45),0,.8);
    s.ventilationDirection = ((number(s.ventilationDirection,0)%360)+360)%360;
    s.timelineEvents = Array.isArray(src.timelineEvents) ? src.timelineEvents.slice(0,80)
      .filter(e => e && types.includes(e.type))
      .map((e,i) => ({ id: String(e.id == null ? 'event'+i : e.id).slice(0,60),
        type: e.type, atSeconds: clamp(number(e.atSeconds,0),0,3600),
        targetId: String(e.targetId == null ? '' : e.targetId).slice(0,100) }))
      .sort((a,b) => a.atSeconds-b.atSeconds) : [];
    return s;
  }
  function events(settings,type,targetId){
    if (!settings || !settings.scenarioCreatorEnabled) return [];
    return (settings.timelineEvents || []).filter(e => e.type === type &&
      (!targetId || !e.targetId || String(e.targetId) === String(targetId)));
  }
  function eventTime(settings,type,defaultValue,targetId){
    const rows = events(settings,type,targetId);
    const exact = targetId == null ? rows : rows.filter(e => !e.targetId || String(e.targetId) === String(targetId));
    return exact.length ? exact[0].atSeconds : defaultValue;
  }
  function ignitionTime(settings,itemId){
    if (!settings || !settings.scenarioCreatorEnabled) return 0;
    const rows = events(settings,'ignition',itemId).filter(e => !e.targetId || String(e.targetId) === String(itemId));
    return rows.length ? rows[0].atSeconds : 0;
  }
  function alarmTime(settings){
    if (!settings || !settings.alarmsEnabled) return Infinity;
    return eventTime(settings,'alarm',number(settings.alarmAtSeconds,10));
  }
  function sprinklerTime(settings){
    if (!settings || !settings.sprinklersEnabled) return Infinity;
    return eventTime(settings,'sprinkler',number(settings.sprinklerAtSeconds,18));
  }
  function fireClock(settings,realSeconds,ignitionSeconds){
    const now = number(realSeconds,0), start = number(ignitionSeconds,0);
    if (now < start) return -1;
    const wetAt = sprinklerTime(settings);
    if (wetAt >= now || wetAt === Infinity) return now - start;
    const normal = clamp(wetAt-start,0,now-start);
    return normal + (now-Math.max(wetAt,start)) * clamp(number(settings.sprinklerFactor,.55),.1,1);
  }
  function smokeClock(settings,realSeconds,startAt){
    const elapsed = number(realSeconds,0)-number(startAt,0);
    if (elapsed < 0) return -1;
    // Ventilation extracts smoke in the educational model; lower smoke-clock rate.
    const extraction = settings && settings.ventilationEnabled
      ? (1 - clamp(number(settings.ventilationStrength,.45),0,.8)*.45) : 1;
    const engaged = settings && settings.scenarioCreatorEnabled ? eventTime(settings,'ventilation',0) : 0;
    if (engaged > startAt && engaged < realSeconds)
      return (engaged-startAt) + (realSeconds-engaged)*extraction;
    return elapsed * (engaged <= startAt ? extraction : 1);
  }
  function doorState(settings, door, now) {
    let state = ['open','closed','locked','damaged','automatic'].includes(door && door.doorState)
      ? door.doorState : 'open';
    if (state === 'automatic') state = number(now,0) >= number(door && door.fireDoorCloseAtSeconds,0) ? 'closed' : 'open';
    if (door && door.fireDoorClosed && number(now,0) >= number(door.fireDoorCloseAtSeconds,0)) state = 'closed';
    const rows = settings && settings.scenarioCreatorEnabled ? (settings.timelineEvents||[])
      .filter(e => ['door-close','door-open','door-lock'].includes(e.type) &&
        (!e.targetId || String(e.targetId) === String(door && door.id)) && e.atSeconds <= now)
      .sort((a,b)=>a.atSeconds-b.atSeconds) : [];
    rows.forEach(e => { state = e.type === 'door-open' ? 'open' : e.type === 'door-lock' ? 'locked' : 'closed'; });
    return state;
  }
  return { defaults, types, normalize, eventTime, ignitionTime, alarmTime, sprinklerTime,
    fireClock, smokeClock, doorState };
});
