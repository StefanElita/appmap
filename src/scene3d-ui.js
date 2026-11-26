/* UI controller for live/replay 3D visualization. No external dependencies. */
(function (root, factory) {
  const api=factory(root.EvacScene3D);
  root.EvacScene3DUI=api;
  if(typeof module==='object' && module.exports) module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(engine){
  'use strict';
  const $=id=>document.getElementById(id);
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function labelSeconds(t){
    const seconds=Math.max(0,Number(t)||0);
    const minutes=Math.floor(seconds/60);
    return minutes+':'+String(Math.floor(seconds%60)).padStart(2,'0')+'.'+Math.floor((seconds%1)*10);
  }

  class Controller {
    constructor(options){
      this.options=options;
      this.dialog=$('scene3dDialog');
      this.canvas=$('scene3dCanvas');
      this.scene=null;
      this.frameHandle=null;
      this.lastFrameAt=0;
      this.lastHudAt=0;
      this.replayTime=null; // null = follow the simulation; number = replay history
      this.replayPlaying=false;
      this.smoothed=new Map();
      this.headingHistory=new Map();
      this.lastLiveTime=-1;
      this.recorder=null;
      this.recordChunks=[];
      this.pointer=null;
      this._bind();
    }
    _bind(){
      $('scene3dRestartSimulation').addEventListener('click',()=>{
        this.stopRecording();
        this.replayTime=null;this.replayPlaying=false;
        this.smoothed.clear();this.headingHistory.clear();this.lastLiveTime=-1;
        if(this.options.restart)this.options.restart();
        if(this.scene)this.scene.setProject(this.options.getProject(),this.options.buildModel());
        this._populateAgents();this.updateButtons();
      });
      $('scene3dStart').addEventListener('click',()=>{
        this.stopRecording();
        this.replayTime=null;
        this.replayPlaying=false;
        this.smoothed.clear(); this.headingHistory.clear(); this.lastLiveTime=-1;
        this.options.start();
        this._populateAgents();
        this.updateButtons();
      });
      $('scene3dPlay').addEventListener('click',()=>{
        const sim=this.options.getSimulation();
        const history=this.options.getHistory();
        if(this.replayTime===null && sim && !sim.finished){
          this.options.pause();
        }else if(history.length>1){
          const end=history[history.length-1].state.time;
          if(this.replayTime===null || this.replayTime>=end-.01)
            this.replayTime=history[0].state.time;
          this.replayPlaying=!this.replayPlaying;
        }else if(!sim){
          this.options.start();
        }
        this.updateButtons();
      });
      $('scene3dLive').addEventListener('click',()=>{
        this.replayTime=null;
        this.replayPlaying=false;
        this.smoothed.clear();this.headingHistory.clear();
        this.updateButtons();
      });
      $('scene3dTimeline').addEventListener('input',event=>{
        const history=this.options.getHistory();
        if(!history.length)return;
        const start=history[0].state.time, end=history[history.length-1].state.time;
        this.replayTime=start+(end-start)*Number(event.target.value)/1000;
        this.replayPlaying=false;
        this.updateButtons();
      });
      $('scene3dFloor').addEventListener('change',event=>{
        if(this.scene) this.scene.setFloor(event.target.value);
      });
      $('scene3dWalls').addEventListener('change',event=>{
        if(this.scene) this.scene.setWalls(event.target.value);
      });
      $('scene3dQuality').addEventListener('change',event=>{
        if(this.scene)this.scene.setQuality(event.target.value);
      });
      $('scene3dSmoke').addEventListener('change',event=>{
        if(this.scene)this.scene.setSmokeVisible(event.target.checked);
      });
      $('scene3dCameraMode').addEventListener('change',()=>this._applyCamera());
      $('scene3dFollowAgent').addEventListener('change',()=>this._applyCamera());
      $('scene3dReset').addEventListener('click',()=>{if(this.scene)this.scene.resetCamera();$('scene3dCameraMode').value='orbit';});
      $('scene3dFocus').addEventListener('click',()=>{
        if(!this.scene||!this.scene.focusOnPeople(this._getFrame()))
          this.options.toast('Няма активни хора за фокусиране.',true);
      });
      $('scene3dPhoto').addEventListener('click',()=>{
        if(!this.scene)return;
        this.scene.draw(this._getFrame(),performance.now());
        this.canvas.toBlob(blob=>{
          if(blob)this._save(blob,'3D-kadar.png');
          else this.options.toast('PNG кадърът не може да се запази.',true);
        },'image/png');
      });
      $('scene3dRecord').addEventListener('click',()=>this.recorder?this.stopRecording():this.startRecording());
      this.canvas.addEventListener('pointerdown',ev=>{
        if(ev.button!==0 && ev.button!==2)return;
        this.pointer={x:ev.clientX,y:ev.clientY,id:ev.pointerId,pan:ev.shiftKey||ev.button===2};
        this.canvas.setPointerCapture(ev.pointerId);
      });
      this.canvas.addEventListener('pointermove',ev=>{
        if(!this.pointer||ev.pointerId!==this.pointer.id||!this.scene)return;
        const dx=ev.clientX-this.pointer.x,dy=ev.clientY-this.pointer.y;
        if(this.pointer.pan) this.scene.pan(dx,dy,this.canvas.clientHeight);
        else {
          this.scene.orbit(dx,dy);
          if(this.scene.cameraMode!=='orbit'){
            this.scene.setCameraMode('orbit');$('scene3dCameraMode').value='orbit';
          }
        }
        this.pointer.x=ev.clientX;this.pointer.y=ev.clientY;
      });
      this.canvas.addEventListener('contextmenu',ev=>ev.preventDefault());
      const clearPointer=()=>{this.pointer=null;};
      this.canvas.addEventListener('pointerup',clearPointer);
      this.canvas.addEventListener('pointercancel',clearPointer);
      this.canvas.addEventListener('wheel',ev=>{
        ev.preventDefault();
        if(this.scene)this.scene.zoom(Math.exp(ev.deltaY*.001));
      },{passive:false});
      this.canvas.addEventListener('dblclick',()=>{if(this.scene)this.scene.resetCamera();});
      this.dialog.addEventListener('close',()=>this.close());
    }
    _applyCamera(){if(this.scene)this.scene.setCameraMode($('scene3dCameraMode').value,$('scene3dFollowAgent').value);}
    _populateAgents(){
      const select=$('scene3dFollowAgent');const previous=select.value;select.replaceChildren();
      const first=document.createElement('option');first.value='';first.textContent='Първият активен';select.append(first);
      const sim=this.options.getSimulation();const agents=(sim&&sim.agents)||[];
      agents.slice(0,700).forEach(a=>{const option=document.createElement('option');option.value=String(a.id);option.textContent='#'+a.id+' · '+(a.groupLabel||'Група');select.append(option);});
      if(Array.from(select.options).some(o=>o.value===previous)) select.value=previous;
      this._applyCamera();
    }
    open(){
      if(!this.scene){
        try{this.scene=new engine.Scene3D(this.canvas);}catch(e){
          this.options.toast('3D визуализация: '+e.message,true);
          return;
        }
      }
      const project=this.options.getProject();
      const sim=this.options.getSimulation();
      this.scene.setProject(project,sim?sim.model:this.options.buildModel());
      this.scene.setWalls($('scene3dWalls').value);
      this.scene.setQuality($('scene3dQuality').value);
      this.scene.setSmokeVisible($('scene3dSmoke').checked);
      this._populateAgents();
      const floor=$('scene3dFloor');
      floor.replaceChildren();
      const all=document.createElement('option');all.value='all';all.textContent='Всички етажи';floor.append(all);
      project.floors.forEach((f,i)=>{
        const option=document.createElement('option');option.value=String(i);
        option.textContent=f.name||'Етаж '+(i+1);floor.append(option);
      });
      floor.value='all';
      this.replayTime=null;this.replayPlaying=false;
      this.smoothed.clear();this.headingHistory.clear();this.lastLiveTime=-1;
      if(!this.dialog.open)this.dialog.showModal();
      this.lastFrameAt=0;
      this.updateButtons();
      this._loop(performance.now());
    }
    close(){
      if(this.frameHandle!==null){cancelAnimationFrame(this.frameHandle);this.frameHandle=null;}
      this.stopRecording();
      this.replayPlaying=false;
      if(this.scene){this.scene.dispose();this.scene=null;}
    }
    _getFrame(){
      const history=this.options.getHistory();
      if(this.replayTime!==null && history.length){
        return engine.sampleAtTime(history,this.replayTime);
      }
      const sim=this.options.getSimulation();
      if(!sim)return null;
      const st=this.options.getLiveState()||sim.snapshot();
      const agents=sim.agents;
      // Smooth the discrete simulation ticks to video frame rate.
      // This changes only the rendering, never the physics or statistics.
      if(st.time<this.lastLiveTime){this.smoothed.clear();this.headingHistory.clear();}
      this.lastLiveTime=st.time;
      const moved=agents.map(a=>{
        let p=this.smoothed.get(a.id);
        const old=p?{x:p.x,y:p.y}:null;
        // Snap to the final position when the agent stops permanently.
        if(a.state==='fatal') p={x:a.x,y:a.y,floor:a.floor};
        if(!p||Math.hypot(p.x-a.x,p.y-a.y)>140||Math.abs(p.floor-a.floor)>1)
          p={x:a.x,y:a.y,floor:a.floor};
        else {
          const blend=.23;
          p.x+=(a.x-p.x)*blend; p.y+=(a.y-p.y)*blend;
          p.floor+=(a.floor-p.floor)*blend;
        }
        let heading=this.headingHistory.get(a.id)||{x:0,y:1};
        const vx=old?p.x-old.x:0,vy=old?p.y-old.y:0;
        if(a.state==='moving'&&Math.hypot(vx,vy)>.015){
          heading={x:vx,y:vy};this.headingHistory.set(a.id,heading);
        }
        this.smoothed.set(a.id,p);
        return {id:a.id,x:p.x,y:p.y,floor:a.floor,floorBlend:p.floor,
          state:a.state,profile:a.profile,fatalAt:a.fatalAt,refugeKind:a.refugeKind,
          headingX:heading.x,headingY:heading.y};
      });
      return {state:st,agents:moved,time:st.time};
    }
    _loop(ts){
      if(!this.dialog.open||!this.scene)return;
      if(this.scene.software && this.lastFrameAt && ts-this.lastFrameAt<36){
        this.frameHandle=requestAnimationFrame(t=>this._loop(t));return;
      }
      const dt=this.lastFrameAt?Math.min(.12,(ts-this.lastFrameAt)/1000):0;
      this.lastFrameAt=ts;
      const history=this.options.getHistory();
      if(this.replayTime!==null&&this.replayPlaying&&history.length){
        const speed=Number($('scene3dPlaybackSpeed').value)||1;
        const end=history[history.length-1].state.time;
        this.replayTime=Math.min(end,this.replayTime+dt*speed);
        if(this.replayTime>=end){
          this.replayPlaying=false;
          if(this.recorder)this.stopRecording();
        }
      }
      const frame=this._getFrame();
      if(ts-this.lastHudAt>900)this._populateAgents();
      this.scene.draw(frame,ts);
      if(ts-this.lastHudAt>160){
        this.lastHudAt=ts;
        this.updateHud(frame);
        this.updateButtons();
      }
      this.frameHandle=requestAnimationFrame(t=>this._loop(t));
    }
    updateHud(frame){
      const history=this.options.getHistory();
      const st=frame&&frame.state;
      $('scene3dTime').textContent=st?labelSeconds(frame.time):'0:00.0';
      $('scene3dSafe').textContent=st?(st.safe+st.sheltered)+' / '+st.total:'—';
      $('scene3dQueue').textContent=st?String(st.counts.queued):'—';
      $('scene3dFatal').textContent=st?String(st.fatal||0):'0';
      $('scene3dDanger').textContent=st?String(st.inHazard||0)+' / '+String(st.inSmoke||0):'—';
      $('scene3dShown').textContent=this.scene?String(this.scene.lastDrawCount):'0';
      const viewMode=this.replayTime!==null?'Възпроизвеждане от запис':
        this.options.getSimulation()?(this.options.getSimulation().finished?'Завършена симулация':'Симулация на живо'):
        '3D план — стартирай симулацията';
      $('scene3dMode').textContent='3D STUDIO · '+viewMode;
      $('scene3dRenderer').textContent=this.scene?(this.scene.software?'Canvas 3D':'WebGL 3D'):'3D';
      const slider=$('scene3dTimeline');
      slider.disabled=history.length<2;
      if(history.length){
        const start=history[0].state.time,end=history[history.length-1].state.time;
        const t=frame?frame.time:end;
        slider.value=String(end>start?Math.round(clamp((t-start)/(end-start)*1000,0,1000)):0);
        $('scene3dTimelineEnd').textContent=labelSeconds(end);
      }else{
        slider.value='0';$('scene3dTimelineEnd').textContent='0:00.0';
      }
      const msg=$('scene3dInfo');
      msg.textContent=!st?'Планът е зареден. Натисни „Стартирай 3D“, за да видиш движението.':
        'Цветове: синьо — движение · жълто — опашка · зелено — излезли · лилаво — безопасна зона · червено — без маршрут · черно — загинали (учебен модел). ' +
        (st.blockedExits && st.blockedExits.length ? 'Опасни изходи: ' + st.blockedExits.map(e => e.label).join(', ') + '. ' : '') +
        (st.waterLevelMeters>0?'Вода над терена: '+st.waterLevelMeters.toFixed(2)+' м. ':'')+
        (st.quakeShaking?'Земетресение — цялата сграда се разклаща едновременно. ':'')+
        (st.quakeCollapseAtSeconds!=null && !st.buildingCollapsed?'Условно срутване в '+labelSeconds(st.quakeCollapseAtSeconds)+' симулационно време. ':'')+
        (st.buildingCollapsed?'УСЛОВНО СРУТВАНЕ — учебна визуализация. ':'')+
        (st.helpCall?'Учебно съобщение: възрастен (участник №'+st.helpCallerId+') потърси помощ на 112; не е извършено обаждане. ':'')+
        (st.threatMarkersActive?'Обозначители на заплаха: '+st.threatMarkersActive+'. ':'')+
        (st.securityLevel && st.securityLevel!=='legacy'?'Състояние: '+
          ({normal:'нормално',warning:'предупреждение',emergency:'аварийна процедура'}[st.securityLevel]||st.securityLevel)+'. ':'')+
        (st.securityHelpStatus==='confirmed'?'Учебният сигнал за помощ е потвърден. ':'')+
        (st.securityHelpStatus==='assistance'?'Помощ пристига в учебния сценарий. ':'')+
        (this.scene&&frame.agents.length>this.scene.renderBudget
          ?'Показана е извадка от хората за плавна анимация.':'');
    }
    updateButtons(){
      const sim=this.options.getSimulation(),hist=this.options.getHistory();
      $('scene3dRestartSimulation').hidden=!(sim&&sim.finished);
      const play=$('scene3dPlay');
      if(this.replayTime===null&&sim&&!sim.finished){
        play.textContent=this.options.isPaused()?'▶ Продължи живо':'Ⅱ Пауза живо';
      }else if(hist.length>1){
        play.textContent=this.replayPlaying?'Ⅱ Пауза на записа':'▶ Пусни запис';
      }else play.textContent='▶ Пусни симулация';
      $('scene3dLive').disabled=!sim||this.replayTime===null;
      $('scene3dRecord').disabled=!this.recorder&&(!sim||!sim.finished||hist.length<2||!this.canvas.captureStream||typeof MediaRecorder==='undefined');
      $('scene3dRecord').textContent=this.recorder?'■ Завърши видеото':'● Запиши WebM';
    }
    startRecording(){
      const history=this.options.getHistory();
      if(!this.options.getSimulation()||!this.options.getSimulation().finished||history.length<2||!this.canvas.captureStream||typeof MediaRecorder==='undefined'){
        this.options.toast('За видео първо проведи симулация с поне два запазени кадъра.',true);return;
      }
      try{
        const stream=this.canvas.captureStream(30);
        const type=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm']
          .find(m=>MediaRecorder.isTypeSupported(m))||'';
        const recorder=new MediaRecorder(stream,type?{mimeType:type}:{ });
        this.recordChunks=[];
        recorder.ondataavailable=event=>{if(event.data&&event.data.size)this.recordChunks.push(event.data);};
        recorder.onstop=()=>{
          stream.getTracks().forEach(track=>track.stop());
          if(this.recordChunks.length){
            const blob=new Blob(this.recordChunks,{type:'video/webm'});
            this._save(blob,'Evacuation-Simulator-3D.webm');
            this.options.toast('3D видеото е готово за запазване.');
          }
          this.recordChunks=[];
        };
        recorder.onerror=()=>{this.options.toast('Неуспешен запис на 3D видео.',true);};
        this.replayTime=history[0].state.time;
        this.replayPlaying=true;
        this.recorder=recorder;
        recorder.start(1000);
        this.updateButtons();
      }catch(error){this.options.toast('Запис на видео: '+error.message,true);}
    }
    stopRecording(){
      if(!this.recorder)return;
      const recorder=this.recorder;this.recorder=null;
      if(recorder.state!=='inactive')recorder.stop();
      this.updateButtons();
    }
    _save(blob,name){
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=url;link.download=name;
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
  }
  return {Controller,labelSeconds};
});
