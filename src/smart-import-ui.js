'use strict';
/* UI for reviewing automated hypotheses before adding ANY geometry to the project. */
(function(root) {
  const Smart = root.EvacSmartImport;
  const Sketch = root.EvacSketchTools;
  const $ = id => document.getElementById(id);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  class Controller {
    constructor(options) {
      this.options = options;
      this.dialog = $('smartImportDialog');
      this.canvas = $('smartCanvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      this.image = null;
      this.imageData = null;
      this.fileInfo = null;
      this.regions = [];
      this.openings = [];
      this.facade = null;
      this.drag = null;
      this.markers = [];
      this.sketchTool = 'room';
      this.actions = [];
      this._bind();
    }
    _bind() {
      $('openSmartImport').addEventListener('click', () => {
        if (this.options.isSimActive()) return this.options.toast('Спри симулацията преди импорт.', true);
        this.dialog.showModal();
      });
      $('smartPick').addEventListener('click', () => this._pick());
      $('smartBrowserFile').addEventListener('change', async event => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        try { await this._load(file.name, await this._readBrowser(file), null, file.size); }
        catch (e) { this.options.toast('Изображение: ' + e.message, true); }
        event.target.value = '';
      });
      $('smartAnalyze').addEventListener('click', () => this.analyze());
      $('smartSelectAllDesks').addEventListener('click',()=>{
        this.markers.filter(m=>m.source==='detected-desk').forEach(m=>m.selected=true);
        this.render();
      });
      $('smartClearAllDesks').addEventListener('click',()=>{
        this.markers.filter(m=>m.source==='detected-desk').forEach(m=>m.selected=false);
        this.render();
      });
      $('smartMode').addEventListener('change', () => this.analyze());
      $('smartThreshold').addEventListener('change', () => this.analyze());
      $('smartAdaptive').addEventListener('change', () => this.analyze());
      $('smartAddPeople').addEventListener('change', () => this.render());
      $('smartAddFurniture').addEventListener('change', () => this.render());
      $('smartWidthMeters').addEventListener('change', () => {
        this.regions.forEach(r => {
          if (!r.manualCount && this.imageData)
            r.count = Smart.estimateOccupancy(r,r.use,this.imageData.width,this._meters());
        });
        this.render();
      });
      $('smartClearRegions').addEventListener('click', () => {
        this.regions = [];this.openings=[];this.markers=[];this.facade=null;this.actions=[];this.render();
      });
      document.querySelectorAll('[data-sketch-tool]').forEach(button => button.addEventListener('click',()=>{
        this.sketchTool=button.dataset.sketchTool;this.render();
      }));
      $('smartUndo').addEventListener('click',()=>{
        const previous=this.actions.pop();
        if(previous){const index=previous.collection.indexOf(previous.item);
          if(index>=0)previous.collection.splice(index,1);this.render();}
      });
      $('smartApply').addEventListener('click', () => this.apply());
      this.canvas.addEventListener('pointerdown', event => {
        if (!this.imageData) return;
        event.preventDefault();
        const point=this._point(event),facade=$('smartMode').value==='facade';
        if(!facade && this.sketchTool==='room'){
          // Review directly on the preview: click a proposed desk or opening
          // to confirm/reject it, instead of hunting through a long list.
          const proposals=[...this.markers.filter(m=>m.source==='detected-desk'),
            ...this.openings.filter(m=>!m.manual)];
          const hit=proposals.find(m=>Math.hypot(m.x-point.x,m.y-point.y)<
            Math.max(9,Math.min(15,(m.w||12)*.8)));
          if(hit){hit.selected=!hit.selected;this.render();return;}
        }
        if(!facade && this.sketchTool!=='room'){
          if(this.sketchTool==='erase'){
            const found=Sketch.nearestMarker(point,[...this.markers,...this.openings],18);
            if(found){const list=this.markers.includes(found)?this.markers:this.openings;
              list.splice(list.indexOf(found),1);}
            else {const index=this.regions.findIndex(r=>point.x>=r.x&&point.y>=r.y&&point.x<=r.x+r.w&&point.y<=r.y+r.h);
              if(index>=0)this.regions.splice(index,1);}
          } else if(this.sketchTool==='furniture'){
            const kind=$('smartSketchFurniture').value;
            const preset=root.EvacFurnishing && root.EvacFurnishing.TYPES[kind];
            if(preset){const f={kind:'furniture',furnitureType:kind,x:Math.round(point.x),y:Math.round(point.y),
              w:preset.w,h:preset.h,manual:true,selected:true};
              this.markers.push(f);this.actions.push({collection:this.markers,item:f});}
          } else {
            const kind=this.sketchTool;
            const mark=Sketch.createMarker(kind,point,this.regions,{
              peopleCount:Number($('smartManualPeopleCount').value)||1});
            if(mark){const list=kind==='people'?this.markers:this.openings;
              list.push(mark);this.actions.push({collection:list,item:mark});}
            else if(['stairs','safezone'].includes(kind)){
              const extra={kind,x:Math.round(point.x),y:Math.round(point.y),manual:true,selected:true};
              this.markers.push(extra);this.actions.push({collection:this.markers,item:extra});
            }
          }
          this.render();return;
        }
        this.drag = { start: point, end: point };
        try { this.canvas.setPointerCapture(event.pointerId); } catch (_) {}
      });
      this.canvas.addEventListener('pointermove', event => {
        if (!this.drag) return;
        this.drag.end = this._point(event);
        this.draw();
      });
      this.canvas.addEventListener('pointerup', event => {
        if (!this.drag) return;
        this.drag.end = this._point(event);
        const rect = this._rect(this.drag.start, this.drag.end);
        this.drag = null;
        if (rect.w >= 12 && rect.h >= 12) {
          if ($('smartMode').value === 'facade') this.facade = Object.assign(rect, { source: 'manual', confidence: 1 });
          else {const item=Object.assign(rect, { source: 'manual', confidence: 1, selected: true,
            use: 'classroom', count: Smart.estimateOccupancy(rect, 'classroom', this.imageData.width, this._meters()) });
            this.regions.push(item);this.actions.push({collection:this.regions,item});}
        }
        this.refreshOpenings();
        this.render();
      });
      this.canvas.addEventListener('pointercancel', () => { this.drag = null; this.draw(); });
    }
    _point(event) {
      const bounds = this.canvas.getBoundingClientRect();
      return { x: clamp((event.clientX - bounds.left) / bounds.width * this.canvas.width, 0, this.canvas.width),
        y: clamp((event.clientY - bounds.top) / bounds.height * this.canvas.height, 0, this.canvas.height) };
    }
    _rect(a, b) {
      return { x: Math.round(Math.min(a.x, b.x)), y: Math.round(Math.min(a.y, b.y)),
        w: Math.round(Math.abs(a.x - b.x)), h: Math.round(Math.abs(a.y - b.y)) };
    }
    _meters() { return clamp(Number($('smartWidthMeters').value) || 24, 3, 200); }
    async _pick() {
      if (this.options.desktop && this.options.desktop.pickFiles && this.options.desktop.readFile) {
        try {
          const selected = await this.options.desktop.pickFiles();
          if (!selected || selected.canceled || !selected.files || !selected.files.length) return;
          const file = selected.files.find(f => /\.(png|jpe?g|webp|bmp)$/i.test(f.name));
          if (!file) throw new Error('Избери PNG, JPG, WebP или BMP изображение.');
          if (file.size > 16 * 1024 * 1024) throw new Error('Изображението трябва да е под 16 MB.');
          const result = await this.options.desktop.readFile(file.path);
          if (!result || !result.ok) throw new Error(result && result.error || 'Неуспешно четене.');
          await this._load(file.name, result.dataUrl, file.path, file.size);
        } catch (e) { this.options.toast('Smart Import: ' + e.message, true); }
      } else $('smartBrowserFile').click();
    }
    _readBrowser(file) {
      if (file.size > 16 * 1024 * 1024) return Promise.reject(new Error('Изображението трябва да е под 16 MB.'));
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Файлът не се чете.'));
        reader.readAsDataURL(file);
      });
    }
    async _load(name, dataUrl, filePath, size) {
      if (!/^data:image\/(png|jpeg|webp|bmp|x-ms-bmp);base64,/i.test(dataUrl)) throw new Error('Неподдържан формат на изображение.');
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Изображението е невалидно.'));
        image.src = dataUrl;
      });
      const factor = Math.min(1, 940 / image.naturalWidth, 680 / image.naturalHeight,
        Math.sqrt(600000 / (image.naturalWidth * image.naturalHeight)));
      this.canvas.width = Math.max(1, Math.round(image.naturalWidth * factor));
      this.canvas.height = Math.max(1, Math.round(image.naturalHeight * factor));
      this.ctx.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
      const data = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      const assessed = Smart.assessPicture(data);
      this.image = image;
      this.imageData = data;
      this.markers=[];this.actions=[];
      this.fileInfo = { name, dataUrl, path: filePath, size };
      $('smartMode').value = assessed.likelyPlan ? 'plan' : 'facade';
      $('smartFileName').textContent = name + ' · ' + image.naturalWidth + ' × ' + image.naturalHeight +
        ' · ' + assessed.note;
      this.analyze();
    }
    analyze() {
      if (!this.imageData) return this.render();
      try {
        if ($('smartMode').value === 'plan') {
          const result = Smart.detectRooms(this.imageData, { threshold: Number($('smartThreshold').value),adaptive:$('smartAdaptive').checked });
          this.regions = result.regions.map((region, i) => {
            const ratio = Math.max(region.w / region.h, region.h / region.w);
            const use = ratio > 3.15 ? 'corridor' : region.w * region.h > this.imageData.width * this.imageData.height * .18 ? 'hall' : 'classroom';
            return Object.assign({}, region, { selected: true, use,
              count: Smart.estimateOccupancy(region, use, this.imageData.width, this._meters()), label: 'Зона ' + (i + 1) });
          });
          this.facade = null;this.actions=[];
          // Suggestions stay UNCHECKED. Unlike auto-furnishing, these contours
          // are inferred from the actual imported picture and need confirmation.
          this.markers = Smart.detectDeskSymbols ? Smart.detectDeskSymbols(this.imageData,this.regions,{adaptive:$('smartAdaptive').checked}) : [];
          this.refreshOpenings();
        } else {
          this.regions = [];
          this.openings = [];this.markers=[];this.actions=[];
          this.facade = Smart.estimateFacadeBounds(this.imageData);
        }
      } catch (e) { this.options.toast('Анализ: ' + e.message, true); }
      this.render();
    }
    refreshOpenings() {
      const manual=this.openings.filter(o=>o.manual);
      this.openings = this.imageData && $('smartMode').value === 'plan' && Smart.detectOpenings
        ? [...Smart.detectOpenings(this.imageData, this.regions, {threshold:Number($('smartThreshold').value)}),...manual] : manual;
    }
    draw() {
      const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (!this.image) {
        ctx.fillStyle = '#122236'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#bacbe0'; ctx.textAlign = 'center';ctx.font='18px sans-serif';
        ctx.fillText('Избери изображение за анализ', w / 2, h / 2);ctx.textAlign='left';
        return;
      }
      ctx.drawImage(this.image, 0, 0, w, h);
      const facade = $('smartMode').value === 'facade';
      const drawBox = (r, index, active) => {
        ctx.save();
        ctx.lineWidth = Math.max(2, Math.min(w, h) / 220);
        ctx.strokeStyle = active ? '#19dba7' : '#f39954';
        ctx.fillStyle = active ? 'rgba(18,185,139,0.085)' : 'rgba(250,140,70,.035)';
        ctx.setLineDash(r.source === 'manual' ? [] : [8, 5]);
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.setLineDash([]);
        const labelH=Math.min(22,Math.max(12,Math.round(r.h*.19)));
        ctx.fillStyle = 'rgba(7,23,39,.87)';
        ctx.fillRect(r.x, r.y, Math.min(r.w, 130), labelH);
        ctx.fillStyle = '#e7fbf9';
        ctx.font = 'bold '+Math.min(11,Math.max(8,labelH-3))+'px sans-serif';
        ctx.fillText(facade ? 'КОНТУР' : 'Помещение ' + (index + 1), r.x + 3, r.y + labelH - 3, Math.max(0, r.w - 6));
        if (!facade && active && $('smartAddPeople').checked && r.count > 0) {
          ctx.beginPath(); ctx.arc(r.x + r.w * .5, r.y + r.h * .55, 7, 0, Math.PI * 2);
          ctx.fillStyle='#3165f6';ctx.fill(); ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
        }
        ctx.restore();
      };
      if (facade && this.facade) drawBox(this.facade, 0, true);
      else if (!facade) this.regions.forEach((r, i) => drawBox(r, i, r.selected));
      if (!facade) this.openings.forEach(o => {
        ctx.save();ctx.lineWidth=2;ctx.strokeStyle=o.selected?'#28e6d2':'#ffd67b';
        ctx.fillStyle=o.selected?'#0f615e':'#45351b';
        ctx.beginPath();ctx.arc(o.x,o.y,8,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.fillStyle='#fff';ctx.font='bold 10px sans-serif';ctx.textAlign='center';
        ctx.fillText(({door:'D',exit:'E',window:'W'})[o.kind]||'?',o.x,o.y+3);ctx.textAlign='left';ctx.restore();
      });
      if(!facade)this.markers.forEach(m=>{
        ctx.save();
        const colors={people:'#5ca5ff',stairs:'#ffcb73',safezone:'#59e5b4',furniture:'#d9a874'};
        ctx.fillStyle=colors[m.kind]||'#fff';ctx.strokeStyle='#071829';ctx.lineWidth=2;
        if(m.kind==='furniture'){
          if(m.source==='detected-desk'){
            ctx.setLineDash(m.selected?[]:[3,2]);
            ctx.strokeStyle=m.selected?'#29e7bc':'#ffc172';
            ctx.lineWidth=m.selected?2:1;
            ctx.fillStyle=m.selected?'rgba(21,201,147,.2)':'rgba(255,188,96,.08)';
          }
          ctx.fillRect(m.x-m.w/2,m.y-m.h/2,m.w,m.h);
          ctx.strokeRect(m.x-m.w/2,m.y-m.h/2,m.w,m.h);
          ctx.setLineDash([]);
        }else{ctx.beginPath();ctx.arc(m.x,m.y,10,0,2*Math.PI);ctx.fill();ctx.stroke();}
        ctx.fillStyle='#071829';ctx.textAlign='center';ctx.font='bold 11px sans-serif';
        if(m.source!=='detected-desk')
          ctx.fillText(({people:String(m.count),stairs:'S',safezone:'Z',furniture:'F'})[m.kind]||'?',m.x,m.y+4);
        ctx.restore();
      });
      if (this.drag) {
        const r = this._rect(this.drag.start, this.drag.end);
        ctx.save();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.setLineDash([4,3]);ctx.strokeRect(r.x,r.y,r.w,r.h);ctx.restore();
      }
    }
    render() {
      this.draw();
      const roomList = $('smartRegions'); roomList.replaceChildren();
      const facade = $('smartMode').value === 'facade';
      document.querySelectorAll('[data-sketch-tool]').forEach(button=>{
        button.classList.toggle('active',button.dataset.sketchTool===this.sketchTool);
        button.setAttribute('aria-pressed',String(button.dataset.sketchTool===this.sketchTool));
        button.disabled=facade;
      });
      const instruction={room:'Плъзни правоъгълник за ново помещение.',door:'Щракни върху стена за врата.',
        exit:'Щракни върху външен край за изход.',window:'Щракни върху стена за прозорец.',
        people:'Щракни там, където искаш да има хора. Задай брой над снимката.',
        stairs:'Щракни за стълбище.',safezone:'Щракни за зона за изчакване.',
        furniture:'Щракни за поставяне на мебел.',erase:'Щракни върху предложението за изтриване.'};
      $('smartToolHint').textContent=facade?'Фасада: плъзни за ориентировъчен външен контур.':instruction[this.sketchTool];
      $('smartPlanOptions').hidden = facade;
      $('smartAddPeople').disabled = facade;
      $('smartAddFurniture').disabled = facade;
      const openingList=$('smartOpenings');openingList.replaceChildren();
      if(!facade){
        if(!this.openings.length){
          const empty=document.createElement('p');empty.className='note';empty.textContent='Няма достатъчно надеждни прекъсвания в стените. Избери „Врата“ или „Прозорец“ над скицата и постави ръчно още преди импорта.';
          openingList.append(empty);
        }
        this.openings.forEach((o,i)=>{
          const row=document.createElement('div');row.className='smart-opening-row';
          const label=document.createElement('label');label.className='inline';
          const check=document.createElement('input');check.type='checkbox';check.checked=o.selected;
          check.addEventListener('change',()=>{o.selected=check.checked;this.draw();});
          label.append(check,document.createTextNode(' '+(o.manual?'Поставено ръчно':'Предложение')+' '+(i+1)+(o.manual?'':' · '+Math.round(o.confidence*100)+'%')));
          const kind=document.createElement('select');kind.title='Потвърди вида на отвора';
          for(const [id,name] of [['door','Врата'],['window','Прозорец'],['exit','Изход']]){
            const opt=document.createElement('option');opt.value=id;opt.textContent=name;kind.append(opt);
          }
          kind.value=o.kind;kind.addEventListener('change',()=>{o.kind=kind.value;this.draw();});
          row.append(label,kind);openingList.append(row);
        });
      }
      const proposedDesks=this.markers.filter(m=>m.source==='detected-desk');
      const confirmedDesks=proposedDesks.filter(m=>m.selected).length;
      $('smartDeskSummary').textContent=proposedDesks.length
        ? 'Намерени '+proposedDesks.length+' възможни символа за чинове/маси · потвърдени '+confirmedDesks+
          '. Жълтите контури са предложения; зелените ще се добавят. Коригирай всяко предложение поотделно.'
        : 'Не са разпознати повтарящи се символи за чинове. Можеш да добавиш мебел ръчно върху снимката.';
      $('smartSelectAllDesks').disabled=!proposedDesks.length;
      $('smartClearAllDesks').disabled=!confirmedDesks;
      const manualList=$('smartManualObjects');manualList.replaceChildren();
      this.markers.forEach((mark,index)=>{
        const row=document.createElement('div');row.className='smart-manual-row';
        const label=document.createElement('span');
        if(mark.source==='detected-desk'){
          const check=document.createElement('input');check.type='checkbox';check.checked=!!mark.selected;
          check.title='Потвърди разпознат чин';
          check.addEventListener('change',()=>{mark.selected=check.checked;this.draw();this.render();});
          row.append(check);
          label.textContent='Предложен чин '+(mark.roomIndex+1)+' · '+Math.round(mark.confidence*100)+'%';
        }else label.textContent=({people:'● Хора',furniture:'▣ Мебел',stairs:'▥ Стълби',safezone:'◎ Зона'})[mark.kind]||mark.kind;
        row.append(label);
        if(mark.kind==='furniture'&&mark.source==='detected-desk'){
          const kind=document.createElement('select');kind.title='Вид мебел';
          const types=root.EvacFurnishing&&root.EvacFurnishing.TYPES||{};
          Object.entries(types).forEach(([name,preset])=>{
            const o=document.createElement('option');o.value=name;o.textContent=preset.label;kind.append(o);
          });
          kind.value=mark.furnitureType;
          kind.addEventListener('change',()=>{mark.furnitureType=kind.value;this.draw();});
          row.append(kind);
        }
        if(mark.kind==='people'){
          const count=document.createElement('input');count.type='number';count.min=1;count.max=500;count.value=mark.count;
          count.title='Брой хора';count.addEventListener('change',()=>{
            mark.count=clamp(Math.round(Number(count.value)||1),1,500);this.draw();});
          row.append(count);
        }
        const remove=document.createElement('button');remove.type='button';remove.className='small';remove.textContent='×';remove.title='Премахни';
        remove.addEventListener('click',()=>{this.markers.splice(index,1);this.render();});row.append(remove);manualList.append(row);
      });
      if(!this.markers.length){const hint=document.createElement('p');hint.className='note';
        hint.textContent='Все още няма ръчно поставени обекти. Избери инструмент над скицата.';manualList.append(hint);}
      $('smartThresholdLabel').textContent = $('smartThreshold').value;
      if (!this.imageData) {
        $('smartSummary').textContent = 'Първо избери изображение.';
        $('smartApply').disabled = true;
        return;
      }
      if (facade) {
        $('smartSummary').textContent = 'ФАСАДА: очертава се само видим приблизителен контур. Скритите стаи и местата на хората не могат да се определят от тази снимка.';
        const note = document.createElement('p');note.className='note';
        note.textContent = 'Плъзни върху изображението, за да поправиш очертанието. Импортът добавя само визуална референция, без помещения или хора. За евакуация зареди план на етажа или нарисувай стаите.';
        roomList.append(note);
      } else {
        $('smartSummary').textContent = this.regions.length ?
          ('Намерени ' + this.regions.length + ' предполагаеми помещения. ' +
          ($('smartAdaptive').checked?'Подобреният контраст е включен. ':'') +
          'Кликни върху кандидат за врата/чин за потвърждение; провери очертанията и мащаба.') :
          'Не са намерени сигурни затворени помещения. Можеш да промениш прага или да очертаеш помещения ръчно с плъзгане.';
        this.regions.forEach((r, index) => {
          const card = document.createElement('div');card.className='smart-region';
          const header = document.createElement('label');header.className='inline';
          const checked = document.createElement('input');checked.type='checkbox';checked.checked=r.selected;
          checked.addEventListener('change', () => { r.selected=checked.checked;this.refreshOpenings();this.render(); });
          header.append(checked, document.createTextNode('Помещение ' + (index+1) +
            (r.source==='manual'?' · ръчно':' · оценка '+Math.round(r.confidence*100)+'%')));
          const use = document.createElement('select');use.title='Предназначение на помещението';
          Object.entries(Smart.USES).forEach(([k, val]) => {
            const option=document.createElement('option');option.value=k;option.textContent=val.label;use.append(option);
          });
          use.value=r.use;
          use.addEventListener('change', () => {
            r.use=use.value;
            r.manualCount=false;
            r.count=Smart.estimateOccupancy(r,r.use,this.imageData.width,this._meters());
            count.value=r.count;this.draw();
          });
          const countLabel = document.createElement('label');countLabel.textContent='Предложени хора (редактируемо)';
          const count = document.createElement('input');count.type='number';count.min='0';count.max='500';count.step='1';count.value=r.count;
          count.addEventListener('change', () => {r.count=clamp(Math.round(Number(count.value)||0),0,500);r.manualCount=true;count.value=r.count;this.draw();});
          countLabel.append(count);
          const row = document.createElement('div');row.className='smart-region-row';row.append(use,countLabel);
          const remove = document.createElement('button');remove.className='small ghost';remove.textContent='✕';remove.title='Премахни предложението';
          remove.addEventListener('click', () => {this.regions.splice(index,1);this.refreshOpenings();this.render();});
          card.append(header,row,remove);roomList.append(card);
        });
      }
      $('smartApply').disabled = facade ? !this.facade : !this.regions.some(r => r.selected);
    }
    apply() {
      if (!this.imageData || this.options.isSimActive()) return;
      const mode = $('smartMode').value;
      const meters = this._meters();
      const ppm = this.options.getPxPerMeter();
      const items = [];
      let scaleLimited = false;
      const mapper = r => {
        const mapped = Smart.toSceneRect(r,this.imageData.width,this.imageData.height,meters,ppm);
        scaleLimited ||= mapped.scaleLimited;
        return mapped;
      };
      if (mode === 'facade') {
        if (!this.facade) return this.options.toast('Очертаи видимия контур, преди да продължиш.', true);
        const r=mapper(this.facade);
        items.push({ type:'reference', name:'Фасада — ориентировъчен контур (не е план)',
          x:r.x,y:r.y,w:r.w,h:r.h,sourceKind:'facade' });
      } else {
        this.regions.filter(r=>r.selected).forEach((region,index)=>{
          const rect=mapper(region);
          const type=region.use==='corridor'?'corridor':'room';
          const name=Smart.USES[region.use].label+' '+(index+1)+' · за проверка';
          items.push({type,name,x:rect.x,y:rect.y,w:rect.w,h:rect.h,width:1.2,
            people:0,teachers:0,materialId:'standard',buildingId:'A',
            importedFromImage:true,approximate:true });
          const hasRecognizedFurniture=this.markers.some(m=>m.kind==='furniture'&&m.selected&&
            m.source==='detected-desk'&&m.x>=region.x&&m.y>=region.y&&
            m.x<=region.x+region.w&&m.y<=region.y+region.h);
          const furnitureOn=$('smartAddFurniture').checked && !hasRecognizedFurniture && type==='room' && root.EvacFurnishing;
          const arrangement=furnitureOn ? root.EvacFurnishing.layout(rect,region.use,Math.min(36,region.count||12)) : null;
          if(arrangement) items.push(...arrangement.furniture.map(f=>Object.assign({},f,{importedFromImage:true})));
          if ($('smartAddPeople').checked && region.count>0 && type==='room') {
            if(arrangement && arrangement.seats.length){
              const seated=root.EvacFurnishing.peopleForSeats(arrangement.seats,region.count,'Място '+(index+1));
              items.push(...seated.map(p=>Object.assign({},p,{importedFromImage:true})));
              const remainder=region.count-seated.length;
              if(remainder>0)items.push({type:'people',name:'Допълнителна група '+(index+1),
                x:Math.round(rect.x+rect.w*.5),y:Math.round(rect.y+rect.h*.55),count:remainder,
                importedFromImage:true,approximate:true});
            }else items.push({type:'people',name:'Предложено разположение '+(index+1),
              x:Math.round(rect.x+rect.w*.5),y:Math.round(rect.y+rect.h*.55),count:region.count,
              importedFromImage:true,approximate:true });
          }
        });
        items.push(...Sketch.toSceneItems(this.openings,this.markers,mapper,meters,this.imageData.width));
      }
      if (!items.length) return;
      const detail=mode==='facade' ? 'Само визуален контур без хора.' :
        'Потвърдените или ръчно добавени врати, изходи и хора се прехвърлят заедно със скицата. Провери маршрутите.';
      if (!confirm('Добавяне на '+items.length+' обекта към текущия етаж?\n'+detail+'\nПровери мащаба и всички елементи преди симулация.')) return;
      // Keep the visible backdrop aligned pixel-for-pixel with proposed geometry.
      const full = Smart.toSceneRect({x:0,y:0,w:this.imageData.width,h:this.imageData.height},
        this.imageData.width,this.imageData.height,meters,ppm);
      const defaultFit = Math.min(900 / this.imageData.width,590 / this.imageData.height) * .9;
      const backdropScale = full.w / (this.imageData.width * defaultFit);
      const success=this.options.commit({items, fileInfo: this.fileInfo, scaleLimited, mode, backdropScale});
      if (success) this.dialog.close();
    }
  }
  root.EvacSmartImportUI = { Controller };
})(window);
