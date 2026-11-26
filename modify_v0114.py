from pathlib import Path
p=Path('/mnt/data/evac_v0114_security')
def edit(name,fn):
 f=p/name;s=f.read_text();z=fn(s);assert z!=s,name;f.write_text(z)
def once(s,a,b):
 assert a in s, f'missing: {a[:120]}'
 return s.replace(a,b,1)

def html(s):
 s=once(s,'<script src="simulation-engine.js"></script>','<script src="security-incident.js"></script>\n<script src="simulation-engine.js"></script>')
 s=once(s,'<button id="addThreatMarker" class="small scenario-primary-action">＋ Добави символ</button>', '''<button id="addThreatMarker" class="small scenario-primary-action">＋ Добави обозначител на заплаха</button>
        <label class="scenario-toggle-line"><input id="exSecurityEnhanced" type="checkbox"> Разширен сценарий с предупреждения и реакции</label>
        <label class="scenario-toggle-line"><input id="exSecurityRoam" type="checkbox" checked> Схематично движение на обозначителите</label>
        <label class="scenario-toggle-line"><input id="exSecurityRoomVisuals" type="checkbox" checked> Показвай защитно изчакване в обзаведени стаи</label>
        <div class="scenario-param-grid">
          <div class="scenario-param-field"><label for="exSecurityWarningAt">Предупреждение (сек.)</label><input id="exSecurityWarningAt" type="number" min="0" max="3600" step="1" value="8"></div>
          <div class="scenario-param-field"><label for="exSecurityEmergencyAt">Аварийна процедура (сек.)</label><input id="exSecurityEmergencyAt" type="number" min="0" max="3600" step="1" value="20"></div>
          <div class="scenario-param-field"><label for="exSecurityEvacuationPercent">Евакуация след указание (%)</label><input id="exSecurityEvacuationPercent" type="number" min="0" max="100" step="5" value="35"></div>
          <div class="scenario-param-field"><label for="exSecurityRoamPeriod">Промяна на точката (сек.)</label><input id="exSecurityRoamPeriod" type="number" min="4" max="60" step="1" value="10"></div>
        </div>
        <div class="scenario-event-readout" id="securityScenarioLive" role="status" aria-live="polite">Състояние: нормална дейност · започни симулацията за събития.</div>''')
 s=once(s,'<div class="scenario-param-field"><label for="exHelpCallAt">Съобщение на секунда</label><input id="exHelpCallAt" type="number" min="0" max="3600" step="1" value="12"></div>', '''<div class="scenario-param-field"><label for="exHelpCallAt">Учебен сигнал (сек.)</label><input id="exHelpCallAt" type="number" min="0" max="3600" step="1" value="12"></div>
          <div class="scenario-param-field"><label for="exSecurityHelpConfirm">Потвърждение (сек.)</label><input id="exSecurityHelpConfirm" type="number" min="0" max="3600" step="1" value="30"></div>
          <div class="scenario-param-field"><label for="exSecurityHelpArrival">Учебно пристигане (сек.)</label><input id="exSecurityHelpArrival" type="number" min="0" max="3600" step="1" value="180"></div>''')
 s=once(s,'Постави един или няколко статични предупредителни символа върху плана. Съобщението за търсене на помощ се показва само в учебната симулация и не се извършва реално обаждане. Не се моделират действия на нападатели или конкретни тактики за укриване.',
 '''Постави един или няколко обозначителя за заплаха. При включен разширен режим те се придвижват схематично между случайни точки на етажа без преследване, насочване към хора или симулиране на нападение. Нивата на тревога преминават от нормална дейност през предупреждение към аварийна процедура. Част от хората могат да се евакуират по общите маршрути, останалите изчакват инструкции. Мебелите в стаите се обозначават само визуално като защитен режим — не се моделират реални барикади. Сигналът до 112 е изцяло симулиран.''')
 return s
edit('src/index.html',html)

def app(s):
 s=once(s,"const APP_VERSION = '0.11.2';","const APP_VERSION = '0.11.4';")
 s=once(s,'const Extras = window.EvacExtras;','const Extras = window.EvacExtras;\nconst Security = window.EvacSecurity;')
 s=once(s,'      ...Extras.defaults,','      ...Extras.defaults,\n      ...Security.defaults,\n      securityEnhancedEnabled: true,')
 s=once(s,'  Object.assign(settings, EvacDisasters.normalize(settings));','  Object.assign(settings, EvacDisasters.normalize(settings));\n  Object.assign(settings, Security.normalize(settings));')
 s=once(s,'''    exHelpCall:'threatHelpCallEnabled',exHelpCallAt:'threatHelpCallAtSeconds'};''', '''    exHelpCall:'threatHelpCallEnabled',exHelpCallAt:'threatHelpCallAtSeconds',
    exSecurityEnhanced:'securityEnhancedEnabled',exSecurityRoam:'securityRoamEnabled',
    exSecurityRoomVisuals:'securityRoomVisualsEnabled',
    exSecurityWarningAt:'securityWarningAtSeconds',exSecurityEmergencyAt:'securityEmergencyAtSeconds',
    exSecurityEvacuationPercent:'securityEvacuationPercent',
    exSecurityRoamPeriod:'securityRoamPeriodSeconds',
    exSecurityHelpConfirm:'securityHelpConfirmSeconds',exSecurityHelpArrival:'securityHelpArrivalSeconds'};''')
 # second in bind
 s=once(s,'''    exHelpCall:'threatHelpCallEnabled',exHelpCallAt:'threatHelpCallAtSeconds'};''', '''    exHelpCall:'threatHelpCallEnabled',exHelpCallAt:'threatHelpCallAtSeconds',
    exSecurityEnhanced:'securityEnhancedEnabled',exSecurityRoam:'securityRoamEnabled',
    exSecurityRoomVisuals:'securityRoomVisualsEnabled',
    exSecurityWarningAt:'securityWarningAtSeconds',exSecurityEmergencyAt:'securityEmergencyAtSeconds',
    exSecurityEvacuationPercent:'securityEvacuationPercent',
    exSecurityRoamPeriod:'securityRoamPeriodSeconds',
    exSecurityHelpConfirm:'securityHelpConfirmSeconds',exSecurityHelpArrival:'securityHelpArrivalSeconds'};''')
 s=once(s,'''    Object.assign(project.settings,EvacDisasters.normalize(candidate));
    markDirty();renderScenarioExtras();refreshAnalysis();draw();''', '''    Object.assign(project.settings,EvacDisasters.normalize(candidate));
    Object.assign(project.settings,Security.normalize(candidate));
    markDirty();renderScenarioExtras();refreshAnalysis();draw();''')
 s=once(s,'''    const value=el.type==='checkbox'?el.checked:(id==='exFloodMax' && el.value.trim()===''?null:num(el.value,0));''', '''    const value=el.type==='checkbox'?el.checked:(id==='exFloodMax' && el.value.trim()===''?null:num(el.value,0));''')
 # Make 2D markers dynamic without mutating project objects.
 s=once(s,'''    // A static, non-graphic visual reference for the protective lockdown exercise.
    g.append(svgEl('circle',{cx:item.x,cy:item.y,r:19,fill:'#7f263c66',stroke:'#ff536c',''', '''    // The saved point stays unchanged; positions on replay come from the snapshot.
    const st=displayState();
    const moving=st && (st.securityMarkers||[]).find(m=>sameId(m.id,item.id));
    const tx=moving?moving.x:item.x,ty=moving?moving.y:item.y;
    g.append(svgEl('circle',{cx:tx,cy:ty,r:19,fill:'#7f263c66',stroke:'#ff536c',''')
 s=once(s,"cx:item.x,cy:item.y-6,r:5,fill:'#ff536c'","cx:tx,cy:ty-6,r:5,fill:'#ff536c'")
 s=once(s,"d:`M ${item.x-7} ${item.y+9} Q ${item.x-7} ${item.y-2} ${item.x} ${item.y-1} Q ${item.x+7} ${item.y-2} ${item.x+7} ${item.y+9} Z`","d:`M ${tx-7} ${ty+9} Q ${tx-7} ${ty-2} ${tx} ${ty-1} Q ${tx+7} ${ty-2} ${tx+7} ${ty+9} Z`")
 s=once(s,"x:item.x+23,y:item.y+4,fill:'#ff9fae'","x:tx+23,y:ty+4,fill:'#ff9fae'")
 # in 2D protected indicators paint as non-selectable overlay in the paint function
 search='''function drawHeatmap(layer) {'''
 addon='''function drawSecurityIndicators(layer) {
  if(!project || project.settings.scenario!=='lockdown')return;
  const st=displayState();
  if(!st || st.securityLevel!=='emergency')return;
  (st.securityRooms||[]).filter(r=>r.floor===currentFloor).forEach(r=>{
    layer.append(svgEl('circle',{cx:r.x,cy:r.y,r:13,fill:'#647df922',
      stroke:'#9eaeff','stroke-width':2,'stroke-dasharray':'4 4',
      'pointer-events':'none'}));
    layer.append(svgEl('text',{x:r.x+16,y:r.y-9,fill:'#b8c7ff','font-size':10,
      'pointer-events':'none'},'защитно изчакване'));
  });
}

'''
 s=once(s,search,addon+search)
 # find drawHeatmap call where layer not name? simple inspect later
 s=once(s,'''  if (systems) {
    const live = state && state.systems;''','''  if (systems) {
    const securityLive=$('securityScenarioLive');
    if(securityLive && project.settings.scenario==='lockdown'){
      const levels={normal:'Нормална дейност',warning:'Установена заплаха',
        emergency:'Аварийна процедура',legacy:'Класически режим'};
      securityLive.textContent=state?'Състояние: '+(levels[state.securityLevel]||'Нормална дейност')+
        ' · известени '+(state.securityNotified||0)+
        ' · съобщение: '+({none:'няма',pending:'предстои',sent:'подадено',confirmed:'потвърдено',assistance:'помощ в сценария'}[state.securityHelpStatus]||'—'):
        'Състояние: нормална дейност · започни симулацията за събития.';
    }
    const live = state && state.systems;''')
 s=once(s,'''    const note=document.createElement('p');note.className='note full';note.textContent='Статичен предупредителен символ. Няма оръжия, тактика на нападател или симулация на нараняване.';grid.append(note);''', '''    const note=document.createElement('p');note.className='note full';note.textContent='В разширения сценарий обозначителят се придвижва схематично между случайни точки. Не симулира преследване, нападение или реален достъп през врати.';grid.append(note);''')
 return s
edit('src/app.js',app)

def engine(s):
 s=once(s, "  const Disasters =", "  const Security=(typeof globalThis!=='undefined' && globalThis.EvacSecurity) ||\n    (typeof require==='function' ? require('./security-incident.js') : null);\n  const Disasters =")
 s=once(s,'''    Object.assign(settings, Disasters ? Disasters.normalize(settings) : {});''','''    Object.assign(settings, Disasters ? Disasters.normalize(settings) : {});
    Object.assign(settings, Security ? Security.normalize(settings) : {});''')
 s=once(s,'''        threatHelpCallEnabled:settings.threatHelpCallEnabled, threatHelpCallAtSeconds:settings.threatHelpCallAtSeconds },''','''        threatHelpCallEnabled:settings.threatHelpCallEnabled, threatHelpCallAtSeconds:settings.threatHelpCallAtSeconds,
        ...Security.normalize(settings) },''')
 return s
edit('src/simulation-engine.js',engine)

def runner(s):
 s=once(s, "  const Disasters =", "  const Security=(typeof globalThis!=='undefined'&&globalThis.EvacSecurity) ||\n    (typeof require==='function'?require('./security-incident.js'):null);\n  const Disasters =")
 s=once(s,'''    const behavior = model.settings || {};''','''    const behavior = model.settings || {};
    const securitySettings=Security?Security.normalize(behavior):{securityEnhancedEnabled:false};
    const enhancedSecurity=lockdown && securitySettings.securityEnhancedEnabled;''')
 s=once(s,'''        let selectedLegs = useSafeZone ? legsFromRoute(model, waitingRoute) : baseLegs;''','''        const securityEvacuates=enhancedSecurity && behaviorPhase < securitySettings.securityEvacuationPercent;
        const securityRoute=securityEvacuates && engine.routeFromNode
          ? engine.routeFromNode(model,group.nodeId):null;
        let selectedLegs = enhancedSecurity && securityEvacuates && securityRoute
          ? legsFromRoute(model,securityRoute)
          : useSafeZone ? legsFromRoute(model, waitingRoute) : baseLegs;''')
 s=once(s, '''        const naturalDelay = lockdown ? Math.random() * Math.max(1, preMovement * 0.3)''','''        const naturalDelay = lockdown ? Math.random() * Math.max(1, preMovement * 0.3)''')
 s=once(s,'''        let startDelay = Math.min(naturalDelay, alertDelay);
        // Regardless''','''        let startDelay = enhancedSecurity
          ? securitySettings.securityEmergencyAtSeconds + (i%5)*1.3*profileReaction[profile]
          : Math.min(naturalDelay, alertDelay);
        // Regardless''')
 s=once(s,'''          behavior: behavioral,
          goal:''','''          behavior: behavioral,
          securityAction: enhancedSecurity && securityEvacuates && collisionAwareLegs.length ? 'evacuate' : 'shelter',
          goal:''')
 s=once(s,'''          routeReason: floodRefuge ?''','''          routeReason: enhancedSecurity ? (securityEvacuates && collisionAwareLegs.length ?
              'Евакуация след учебно предупреждение и указание.' :
              'Защитно изчакване след учебно предупреждение.') : floodRefuge ?''')
 s=once(s,'''    const helpCaller = agents.find(a=>a.profile==='adult'||a.profile==='older') || null;''','''    const helpCaller = agents.find(a=>a.profile==='adult'||a.profile==='older') || null;
    const securityRooms=enhancedSecurity && Security ? Security.roomIndicators(model,behavior) : [];''')
 s=once(s,'''        threatMarkersActive:scenario==='lockdown'?(model.threatMarkers||[]).filter(m=>time>=num(m.entryAtSeconds,0)).length:0,''','''        threatMarkersActive:scenario==='lockdown'?(model.threatMarkers||[]).filter(m=>time>=num(m.entryAtSeconds,0)).length:0,
        securityLevel:lockdown&&Security?Security.level(behavior,time):null,
        securityMarkers:lockdown&&Security?Security.markerPositions(model.threatMarkers,model.floors,time,behavior):[],
        securityRooms:lockdown && Security && Security.level(behavior,time)==='emergency'?securityRooms:[],
        securityNotified:lockdown && enhancedSecurity && time>=securitySettings.securityWarningAtSeconds?agents.length:0,
        securityHelpStatus:lockdown && Security?Security.helpStatus(behavior,time,!!helpCaller):'none',''')
 s=once(s,'''            } else agent.state = 'waiting';
            continue;''','''            } else agent.state = enhancedSecurity && time>=securitySettings.securityWarningAtSeconds
              ? 'notified' : 'waiting';
            continue;''')
 s=once(s,'''        if (lockdown) {
          agent.refugeKind='protective-shelter';''','''        if (lockdown && enhancedSecurity) {
          if(agent.securityAction==='evacuate' && agent.legs.length){
            stepAgent(agent,step);continue;
          }
          agent.refugeKind='protective-shelter';
          if(time-agent.startedAt>=shelterAfter){agent.state='sheltered';agent.doneAt=time;}
          else agent.state='sheltering';
          continue;
        }
        if (lockdown) {
          agent.refugeKind='protective-shelter';''')
 s=once(s,'''      const upcomingThreatEvents=lockdown && (
        (!!helpCaller && behavior.threatHelpCallEnabled!==false && time<num(behavior.threatHelpCallAtSeconds,12)) ||''','''      const upcomingThreatEvents=lockdown && (
        (enhancedSecurity && time < securitySettings.securityEmergencyAtSeconds) ||
        (enhancedSecurity && Security && Security.helpStatus(behavior,time,!!helpCaller)!=='none' &&
          time < securitySettings.securityHelpArrivalSeconds) ||
        (!!helpCaller && behavior.threatHelpCallEnabled!==false && time<num(behavior.threatHelpCallAtSeconds,12)) ||''')
 return s
edit('src/simulation-runner.js',runner)
