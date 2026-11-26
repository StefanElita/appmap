from pathlib import Path
p=Path('/mnt/data/evac_v0114_security')
def replace(name,a,b):
 f=p/name;s=f.read_text();assert a in s,(name,a[:100]);f.write_text(s.replace(a,b,1))
replace('src/app.js', '''  const smokeLayer = svgEl('g', { class: 'layer smoke' });
  drawSmoke(smokeLayer);
  svg.append(smokeLayer);''','''  const smokeLayer = svgEl('g', { class: 'layer smoke' });
  drawSmoke(smokeLayer);
  svg.append(smokeLayer);

  const securityLayer=svgEl('g',{class:'layer security-overlays','pointer-events':'none'});
  drawSecurityIndicators(securityLayer);
  svg.append(securityLayer);''')
replace('src/scene3d.js',"waiting:'#7e9bb8',queued:'#facd70',moving:'#57c5f5'", "waiting:'#7e9bb8',notified:'#f5bb57',queued:'#facd70',moving:'#57c5f5'")
replace('src/scene3d.js', '''      // Static visually distinct threat figure for lockdown training only. No attacker behavior.
      if((this.project.settings||{}).scenario==='lockdown'){
        (this.project.floors||[]).forEach((fl,fi)=>{
          if(!this.floorVisible(fi))return;
          (fl.items||[]).filter(item=>item.type==='threat' && t>=finite(item.entryAtSeconds,0)).forEach(item=>{
            const x=(finite(item.x,450)-450)/scale,z=(finite(item.y,295)-295)/scale;
            const y=(fi*fh+.055)*collapseScale;
            drawPerson(people,{id:-99,profile:'adult',state:'threat',headingX:0,headingY:1},
              {x,y,z,time:t,detail:this.quality});
            effects.disc(x,y+.01,z,.55,rgba('#f32b57',.55),20);
          });
        });
      }''','''      // Abstract, non-graphic moving warning indicators. No attack mechanics.
      if((this.project.settings||{}).scenario==='lockdown'){
        const security=(typeof globalThis!=='undefined'&&globalThis.EvacSecurity)||null;
        const markers=this.model&&security
          ? security.markerPositions(this.model.threatMarkers,this.model.floors,t,this.project.settings)
          : (this.project.floors||[]).flatMap((fl,fi)=>(fl.items||[])
              .filter(item=>item.type==='threat'&&t>=finite(item.entryAtSeconds,0))
              .map(item=>({...item,floor:fi})));
        markers.forEach((marker,i)=>{
          if(!this.floorVisible(marker.floor))return;
          const x=(finite(marker.x,450)-450)/scale,z=(finite(marker.y,295)-295)/scale;
          const y=(marker.floor*fh+.055)*collapseScale;
          drawPerson(people,{id:-(99+i),profile:'adult',state:'threat',headingX:0,headingY:1},
            {x,y,z,time:t,detail:this.quality});
          effects.disc(x,y+.012,z,.56,rgba('#f32b57',.33),20);
        });
      }''')
replace('src/scene3d.js', '''      const model=this.model;
      if(scenario==='flood'){''', '''      const model=this.model;
      if(scenario==='lockdown' && state){
        if(state.securityLevel==='warning'||state.securityLevel==='emergency'){
          // Soft warning beacons are only a visualization; no hardware signals.
          const pulse=.35+.18*Math.sin(t*3.5);
          (this.project.floors||[]).forEach((fl,fi)=>{
            if(!this.floorVisible(fi))return;
            (fl.items||[]).filter(it=>it.type==='exit').forEach(it=>{
              effects.ellipsoid((finite(it.x,450)-450)/scale,fi*fh+2.45,
                (finite(it.y,295)-295)/scale,.18,.13,.18,
                rgba(state.securityLevel==='emergency'?'#ffbc59':'#f6d58d',pulse),10,5);
            });
          });
        }
        if(state.securityLevel==='emergency'){
          // Generic, non-functional room safety cue. Furniture obstacles retain
          // their ordinary movement effect, but no barricade tactics are modeled.
          (state.securityRooms||[]).forEach(r=>{
            if(!this.floorVisible(r.floor))return;
            const x=(r.x-450)/scale,z=(r.y-295)/scale,y=r.floor*fh+.10;
            effects.box(x-.30,y,z-.12,.60,.24,.24,rgba('#8094df',.52));
            effects.disc(x,y+.01,z,.5,rgba('#8fa7ed',.24),16);
          });
        }
      }
      if(scenario==='flood'){''')
replace('src/scene3d-ui.js', '''        (st.threatMarkersActive?'Предупредителни символи: '+st.threatMarkersActive+'. ':'')+''', '''        (st.threatMarkersActive?'Обозначители на заплаха: '+st.threatMarkersActive+'. ':'')+
        (st.securityLevel && st.securityLevel!=='legacy'?'Състояние: '+
          ({normal:'нормално',warning:'предупреждение',emergency:'аварийна процедура'}[st.securityLevel]||st.securityLevel)+'. ':'')+
        (st.securityHelpStatus==='confirmed'?'Учебният сигнал за помощ е потвърден. ':'')+
        (st.securityHelpStatus==='assistance'?'Помощ пристига в учебния сценарий. ':'')+''')
replace('src/styles.css', '''label.inline { display: flex; align-items: center; gap: 8px; color: var(--txt); font-size: 12px; }''','''label.inline { display: flex; align-items: center; gap: 8px; color: var(--txt); font-size: 12px; }
.scenario-event-readout { border:1px solid #435879; background:#192940; color:#e0eaff;
  border-radius:8px; padding:9px 10px; font-size:12px; margin-top:8px; line-height:1.55; }
#threatScenarioSettings .scenario-param-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }''')
# Version surfaces
replace('package.json','"version": "0.11.3"','"version": "0.11.4"')
replace('package-lock.json','"version": "0.11.3"','"version": "0.11.4"')
