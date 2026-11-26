'use strict';
/* Smart Import v0.9.9 — offline assistive extraction of simple, high-contrast floor plans.
 * Not OCR, not a trained model, and NEVER infers concealed rooms from facade photos.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EvacSmartImport = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  const USES = Object.freeze({
    classroom: { label: 'Класна стая', perPerson: 2.2, max: 45 },
    office: { label: 'Офис', perPerson: 8, max: 50 },
    meeting: { label: 'Заседателна зала', perPerson: 2.3, max: 100 },
    hall: { label: 'Зала / фоайе', perPerson: 3, max: 150 },
    dwelling: { label: 'Жилищна стая', perPerson: 12, max: 12 },
    library: { label: 'Библиотека', perPerson: 7, max: 60 },
    corridor: { label: 'Коридор (без постоянни хора)', perPerson: Infinity, max: 0 },
    storage: { label: 'Склад (без постоянни хора)', perPerson: Infinity, max: 0 },
    other: { label: 'Друго (ръчно)', perPerson: Infinity, max: 0 }
  });
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function assessPicture(imageData) {
    const { width, height, data } = imageData;
    if (!width || !height || !data || data.length < width * height * 4) throw new Error('Невалидно изображение.');
    const stride = Math.max(1, Math.floor((width * height) / 5000));
    let nearWhite = 0, nearBlack = 0, neutral = 0, sampled = 0, luminanceSum = 0;
    for (let p = 0; p < width * height; p += stride) {
      const i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = (r * 77 + g * 150 + b * 29) / 256;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      luminanceSum += lum;
      nearWhite += lum > 215 && chroma < 38 ? 1 : 0;
      nearBlack += lum < 115 ? 1 : 0;
      neutral += chroma < 35 ? 1 : 0;
      sampled++;
    }
    const whiteFraction = nearWhite / sampled;
    const darkFraction = nearBlack / sampled;
    const neutralFraction = neutral / sampled;
    const meanLuminance = luminanceSum / sampled;
    // A photographed monochrome plan can have *no white pixels at all* because
    // the camera made the paper grey (as in long, low-resolution school plans).
    // Recognize that possibility, but keep all results review-only.
    const photographedPlan = whiteFraction < .45 && neutralFraction > .81 &&
      darkFraction > .035 && darkFraction < .34 && meanLuminance > 95 && meanLuminance < 222;
    const likelyPlan = (whiteFraction >= .48 && neutralFraction >= .65 && darkFraction >= .007) || photographedPlan;
    return { likelyPlan, photographedPlan, whiteFraction, darkFraction, neutralFraction, meanLuminance,
      note: photographedPlan ? 'Вероятно заснет/сканиран план — провери очертанията' :
        likelyPlan ? 'Вероятно чертеж/план' : 'Вероятно фотография или цветен план' };
  }

  // Offline illumination correction for photographed or scanned plans. A local
  // mean compensates for shadows and gray paper, while negative contrast keeps
  // fine dark walls. No neural network, OCR, cloud calls or invented geometry.
  function enhancePlanContrast(imageData, options) {
    const {width:w,height:h,data}=imageData;
    if(!w||!h||!data||data.length<w*h*4)throw new Error('Невалидни пиксели.');
    if(w*h>1500000)throw new Error('Твърде голямо изображение.');
    const o=options||{};
    const radius=clamp(Math.round(Number(o.radius)||Math.min(w,h)*.14),9,44);
    const stride=w+1;
    const sums=new Float64Array((w+1)*(h+1));
    const luminance=new Uint8Array(w*h);
    for(let y=0;y<h;y++){
      let row=0;
      for(let x=0;x<w;x++){
        const pos=y*w+x,k=pos*4;
        const l=(77*data[k]+150*data[k+1]+29*data[k+2])/256;
        luminance[pos]=l;row+=l;
        sums[(y+1)*stride+x+1]=sums[y*stride+x+1]+row;
      }
    }
    const out=new Uint8ClampedArray(w*h*4);
    const strength=clamp(Number(o.strength)||1.65,1.1,2.5);
    for(let y=0;y<h;y++){
      const y0=Math.max(0,y-radius),y1=Math.min(h,y+radius+1);
      for(let x=0;x<w;x++){
        const x0=Math.max(0,x-radius),x1=Math.min(w,x+radius+1);
        const sum=sums[y1*stride+x1]-sums[y0*stride+x1]-sums[y1*stride+x0]+sums[y0*stride+x0];
        const mean=sum/((x1-x0)*(y1-y0));
        const pos=y*w+x,k=pos*4;
        const ink=clamp(232+(luminance[pos]-mean)*strength,0,255);
        out[k]=out[k+1]=out[k+2]=ink;out[k+3]=data[k+3];
      }
    }
    return {width:w,height:h,data:out};
  }

  function detectRoomsOnce(imageData, opts) {
    const { width: w, height: h, data } = imageData;
    if (!w || !h || !data || data.length < w * h * 4) throw new Error('Невалидни пиксели.');
    if (w * h > 1500000) throw new Error('Изображението е твърде голямо за обработка; намали го до 1200 px.');
    const o = opts || {};
    const threshold = clamp(Number.isFinite(+o.threshold) ? +o.threshold : 165, 40, 240);
    const padding = clamp(Number.isFinite(+o.wallGrow) ? Math.round(+o.wallGrow) : 3, 1, 7);
    const minSide = clamp(Number.isFinite(+o.minSide) ? +o.minSide : 22, 12, 180);
    const maxRooms = clamp(Number.isFinite(+o.maxRooms) ? Math.floor(+o.maxRooms) : 35, 1, 100);
    const black = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      if (data[i + 3] < 32) continue;
      const lum = (77 * data[i] + 150 * data[i + 1] + 29 * data[i + 2]) / 256;
      black[p] = lum < threshold ? 1 : 0;
    }
    // Bridge short gaps only inside LONG, nearly straight ink runs. This joins
    // doorway symbols in simple plans without indiscriminately joining text.
    const gapMax = clamp(Math.round(Math.min(w,h) * .065), 5, 24);
    const minRun = clamp(Math.round(Math.min(w,h) * .06), 10, 34);
    function bridgeLines(horizontal) {
      const outer = horizontal ? h : w;
      const inner = horizontal ? w : h;
      const at = (line, n) => horizontal ? line*w+n : n*w+line;
      for (let line=0;line<outer;line++) {
        let cursor=0;
        while (cursor<inner) {
          let run=0;
          while (cursor<inner && black[at(line,cursor)]) {run++;cursor++;}
          if (run<minRun) {cursor++;continue;}
          const start=cursor;
          while (cursor<inner && !black[at(line,cursor)] && cursor-start<=gapMax) cursor++;
          const gapLength=cursor-start;
          let next=0;
          while (cursor+next<inner && black[at(line,cursor+next)]) next++;
          if (gapLength>0 && gapLength<=gapMax && next>=minRun) {
            for (let n=start;n<cursor;n++) black[at(line,n)]=1;
          }
          if (next>0) cursor+=next;
          else if (cursor<=start) cursor++;
        }
      }
    }
    bridgeLines(true);
    bridgeLines(false);
    // Separable dilation closes the remaining narrow strokes and corners.
    const horizontal = new Uint8Array(w * h);
    const blocked = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const base = y * w;
      for (let x = 0; x < w; x++) {
        for (let dx = -padding; dx <= padding; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && black[base + xx]) { horizontal[base + x] = 1; break; }
        }
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let dy = -padding; dy <= padding; dy++) {
          const yy = y + dy;
          if (yy >= 0 && yy < h && horizontal[yy * w + x]) { blocked[y * w + x] = 1; break; }
        }
      }
    }
    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    const regions = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const rootIndex = y * w + x;
        if (visited[rootIndex] || blocked[rootIndex]) continue;
        visited[rootIndex] = 1;
        let head = 0, tail = 1;
        queue[0] = rootIndex;
        let left = x, right = x, top = y, bottom = y, touchesEdge = false;
        while (head < tail) {
          const p = queue[head++];
          const xx = p % w, yy = (p / w) | 0;
          if (xx < left) left = xx;
          if (xx > right) right = xx;
          if (yy < top) top = yy;
          if (yy > bottom) bottom = yy;
          if (xx === 0 || yy === 0 || xx === w - 1 || yy === h - 1) touchesEdge = true;
          if (xx > 0 && !blocked[p - 1] && !visited[p - 1]) { visited[p - 1] = 1; queue[tail++] = p - 1; }
          if (xx < w - 1 && !blocked[p + 1] && !visited[p + 1]) { visited[p + 1] = 1; queue[tail++] = p + 1; }
          if (yy > 0 && !blocked[p - w] && !visited[p - w]) { visited[p - w] = 1; queue[tail++] = p - w; }
          if (yy < h - 1 && !blocked[p + w] && !visited[p + w]) { visited[p + w] = 1; queue[tail++] = p + w; }
        }
        const rw = right - left + 1, rh = bottom - top + 1;
        const rectangularity = tail / (rw * rh);
        if (!touchesEdge && rw >= minSide && rh >= minSide && tail >= minSide * minSide &&
            rw * rh < w * h * .8 && rectangularity > .53) {
          const margin = Math.min(padding + 1, Math.floor(Math.min(rw, rh) / 7));
          regions.push({ x: left - margin, y: top - margin,
            w: rw + 2 * margin, h: rh + 2 * margin,
            confidence: +clamp(rectangularity * .82, 0, .95).toFixed(2),
            source: 'automatic' });
        }
      }
    }
    regions.sort((a, b) => b.w * b.h - a.w * a.h);
    return { regions: regions.slice(0, maxRooms), totalRegions: regions.length,
      classification: assessPicture(imageData) };
  }

  // Photographed drawings require several luminance thresholds: dark walls and
  // faint internal lines cannot both be captured by one fixed black/white cut.
  function detectRooms(imageData, opts) {
    if(!imageData || !imageData.width || !imageData.height || !imageData.data ||
      imageData.data.length < imageData.width*imageData.height*4) throw new Error('Невалидни пиксели.');
    if(imageData.width*imageData.height>1500000) throw new Error('Изображението е твърде голямо за обработка; намали го до 1200 px.');
    const classification = assessPicture(imageData);
    const o = opts || {};
    if ((!classification.photographedPlan && o.adaptive !== true) || o.photoMode === false)
      return detectRoomsOnce(imageData, opts);
    const chosen = clamp(Number.isFinite(+o.threshold) ? +o.threshold : 165, 50, 220);
    const thresholds = [...new Set([92, 110, 130, Math.min(155, chosen)])];
    const suggestions = [];
    const scanOpts={...o,maxRooms:90,minSide:Math.min(22,Math.max(12,Math.round(imageData.height*.075)))};
    for (const t of thresholds) {
      const found = detectRoomsOnce(imageData, {...scanOpts, threshold:t});
      for (const r of found.regions) {
        if (r.w < 24 || r.h < 19 || r.x < 0 || r.y < 0) continue;
        suggestions.push({...r, detectedThreshold:t, detectedMode:'original'});
      }
    }
    // A second, illumination-normalized pass recovers faint partitions under
    // uneven room lighting. Keep both hypotheses and deduplicate geometrically.
    if (o.adaptive !== false) {
      const corrected=enhancePlanContrast(imageData);
      for(const t of [144,179]){
        const found=detectRoomsOnce(corrected,{...scanOpts,threshold:t});
        for(const r of found.regions){
          if(r.w<24||r.h<19||r.x<0||r.y<0)continue;
          suggestions.push({...r,detectedThreshold:t,detectedMode:'adaptive'});
        }
      }
    }
    suggestions.sort((a,b)=> (b.confidence + Math.min(b.w*b.h,8000)/30000) -
      (a.confidence + Math.min(a.w*a.h,8000)/30000));
    const combined=[];
    function overlap(a,b) {
      const area=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*
        Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
      return {iou:area/(a.w*a.h+b.w*b.h-area||1), fraction:area/Math.min(a.w*a.h,b.w*b.h)};
    }
    for(const r of suggestions) {
      const duplicate=combined.find(old=>{
        const o=overlap(old,r);
        // Containing a smaller room is NOT necessarily the same room.
        return o.iou>.48 || (o.fraction>.85 &&
          Math.max(old.w*old.h,r.w*r.h)/Math.min(old.w*old.h,r.w*r.h)<1.48);
      });
      if (duplicate) {duplicate._votes++;continue;}
      combined.push({...r,_votes:1});
    }
    // If a large outer region wraps one or more credible small rooms, suppress
    // it rather than importing overlapping rooms as independent floor space.
    const filtered=combined.filter(a=>!combined.some(b=>a!==b &&
      b.w*b.h < a.w*a.h*.69 && b.w*b.h > a.w*a.h*.38 && overlap(a,b).fraction>.85 && b.confidence >= a.confidence*.85) &&
      !combined.some(b=>a!==b && b.w*b.h>a.w*a.h*1.7 && overlap(a,b).fraction>.88 && b.confidence>a.confidence*.90));
    filtered.sort((a,b)=>a.y-b.y||a.x-b.x);
    const max=clamp(Number.isFinite(+o.maxRooms)?Math.floor(+o.maxRooms):55,1,100);
    const result={regions:filtered.slice(0,max).map(r=>{
      const {_votes,detectedThreshold,detectedMode,...room}=r;
      return {...room,confidence:+clamp(room.confidence+Math.min(_votes-1,3)*.025,.1,.93).toFixed(2),
        source:'photo-multi-threshold'};
    }), totalRegions:filtered.length,classification};
    // Conservative safety net: contrast correction must not silently drop
    // rooms that the original multi-threshold scan already identified.
    if(o.adaptive!==false){
      const baseline=detectRooms(imageData,{...o,adaptive:false});
      if(baseline.regions.length>result.regions.length)return baseline;
    }
    return result;
  }

  // Review-only suggestions for small repeating desk/table symbols. Detect the
  // ink contours INSIDE detected rooms; wall edges and text near boundaries are
  // excluded. This is a heuristic, NOT trained object recognition.
  function detectDeskSymbols(imageData, regions, options) {
    const w=imageData.width,h=imageData.height,data=imageData.data;
    if(!w||!h||!data||data.length<w*h*4) return [];
    const opt=options||{}, found=[];
    const maxTotal=clamp(Number.isFinite(+opt.maxTotal)?+opt.maxTotal:170,1,400);
    const lum=(x,y)=>{const i=(y*w+x)*4;return (77*data[i]+150*data[i+1]+29*data[i+2])/256;};
    for(const [roomIndex,r] of (regions||[]).entries()) {
      if(r.selected===false || r.use==='corridor'||r.use==='storage'||r.w<38||r.h<32) continue;
      const inset=Math.max(4,Math.round(Math.min(r.w,r.h)*.10));
      const x0=Math.max(1,Math.round(r.x+inset)),y0=Math.max(1,Math.round(r.y+inset));
      const x1=Math.min(w-1,Math.round(r.x+r.w-inset)),y1=Math.min(h-1,Math.round(r.y+r.h-inset));
      const rw=x1-x0,rh=y1-y0;
      if(rw<28||rh<22)continue;
      const samples=[];
      for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2)samples.push(lum(x,y));
      samples.sort((a,b)=>a-b);
      // Local percentile adapts to poor exposure and shadows from the camera.
      const paper=samples[Math.floor(samples.length*.83)]||255;
      const cutoff=clamp(paper-(paper>215?28:16),70,238);
      const mask=new Uint8Array(rw*rh),visited=new Uint8Array(rw*rh);
      for(let y=0;y<rh;y++)for(let x=0;x<rw;x++)mask[y*rw+x]=lum(x+x0,y+y0)<cutoff?1:0;
      const queue=new Int32Array(rw*rh),blobs=[];
      for(let y=0;y<rh;y++)for(let x=0;x<rw;x++){
        const start=y*rw+x;if(!mask[start]||visited[start])continue;
        visited[start]=1;let head=0,tail=1;queue[0]=start;
        let minx=x,maxx=x,miny=y,maxy=y;
        while(head<tail){const p=queue[head++],xx=p%rw,yy=(p/rw)|0;
          minx=Math.min(minx,xx);maxx=Math.max(maxx,xx);miny=Math.min(miny,yy);maxy=Math.max(maxy,yy);
          for(const dp of [-rw-1,-rw,-rw+1,-1,1,rw-1,rw,rw+1]){
            const z=p+dp;if(z<0||z>=mask.length||visited[z]||!mask[z])continue;
            const zx=z%rw,zy=(z/rw)|0;
            if(Math.abs(zx-xx)>1||Math.abs(zy-yy)>1)continue;
            visited[z]=1;queue[tail++]=z;
          }
        }
        const bw=maxx-minx+1,bh=maxy-miny+1;
        const maxDim=Math.min(25,Math.max(12,Math.min(r.w,r.h)*.42));
        if(bw<5||bh<5||bw>maxDim||bh>maxDim||tail<12||
          tail>210||bw/bh>3.3||bh/bw>3.3)continue;
        const density=tail/(bw*bh);
        if(density<.14||density>.94)continue;
        blobs.push({x:x0+minx+bw/2,y:y0+miny+bh/2,w:bw,h:bh,density});
      }
      // Real furniture symbols recur with similar dimensions and spacing.
      // Single text glyphs and isolated ink fragments are not auto-proposed.
      const repeated=blobs.map(b=>{
        const near=blobs.filter(c=>c!==b && Math.abs(c.w-b.w)<Math.max(4,b.w*.45) &&
          Math.abs(c.h-b.h)<Math.max(4,b.h*.45) &&
          (Math.abs(c.x-b.x)<Math.max(9,b.w*.6) || Math.abs(c.y-b.y)<Math.max(9,b.h*.65)) &&
          Math.hypot(c.x-b.x,c.y-b.y)<Math.max(65,Math.min(r.w,r.h)*.65));
        return {...b,patternMatches:near.length};
      }).filter(b=>b.patternMatches>=1);
      // Remove overlapping fragments of the same desk symbol before presenting
      // options in the review list.
      const deduplicated=[];
      for(const b of repeated.sort((a,b)=>b.w*b.h-a.w*a.h)){
        if(deduplicated.some(c=>Math.hypot(c.x-b.x,c.y-b.y)<Math.max(6,Math.min(c.w,c.h,b.w,b.h)*.68)))continue;
        deduplicated.push(b);
      }
      for(const b of deduplicated.slice(0,45)){
        if(found.length>=maxTotal)break;
        found.push({kind:'furniture',furnitureType:'desk',x:Math.round(b.x),y:Math.round(b.y),
          w:Math.max(6,b.w),h:Math.max(6,b.h),source:'detected-desk',
          roomIndex,confidence: +clamp(.43+Math.min(b.patternMatches,4)*.055+(b.density>.25?.04:0),.3,.75).toFixed(2),selected:false,manual:false});
      }
      if(found.length>=maxTotal)break;
    }
    if((opt.adaptive===true || (opt.adaptive!==false && assessPicture(imageData).photographedPlan)) && found.length<maxTotal){
      // An independent contrast-normalized pass can recover faint desk outlines.
      // Keep original symbols even when the second pass disagrees; proposals
      // are never selected or imported without an explicit user choice.
      const corrected=enhancePlanContrast(imageData);
      const extras=detectDeskSymbols(corrected,regions,{...opt,adaptive:false});
      for(const candidate of extras){
        const match=found.find(m=>m.roomIndex===candidate.roomIndex &&
          Math.hypot(m.x-candidate.x,m.y-candidate.y)<Math.max(7,Math.min(m.w,m.h)*.6));
        if(match){match.confidence=+clamp(match.confidence+.025,.3,.78).toFixed(2);continue;}
        if(candidate.confidence<.52||found.length>=maxTotal)continue;
        found.push({...candidate,confidence:+clamp(candidate.confidence-.045,.3,.75).toFixed(2)});
      }
    }
    return found;
  }

  function estimateFacadeBounds(imageData) {
    // A rough foreground-vs-sky bounding estimate, NOT an inferred building footprint.
    const { width: w, height: h, data } = imageData;
    if (w < 30 || h < 30) return null;
    function average(x1, x2, y1, y2) {
      const rgb = [0, 0, 0]; let n = 0;
      for (let y = y1; y < y2; y += 3) for (let x = x1; x < x2; x += 3) {
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) rgb[c] += data[i + c]; n++;
      }
      return rgb.map(v => v / Math.max(1, n));
    }
    const t = Math.max(2, Math.round(w * .08));
    const bg = average(0, t, 0, Math.max(2, Math.round(h * .12)));
    const bg2 = average(w - t, w, 0, Math.max(2, Math.round(h * .12)));
    const sky = bg.map((v, i) => (v + bg2[i]) / 2);
    const different = (x, y) => {
      const i = (y * w + x) * 4;
      return Math.hypot(data[i] - sky[0], data[i + 1] - sky[1], data[i + 2] - sky[2]) > 78;
    };
    const top = Math.floor(h * .09), bottom = Math.floor(h * .89);
    let minX = w, maxX = 0, minY = h;
    for (let y = top; y < bottom; y += 4) {
      let row = 0;
      for (let x = Math.floor(w * .08); x < w * .92; x += 4) if (different(x, y)) row++;
      if (row > w * .09 / 4 && y < minY) minY = y;
    }
    const yBegin = Math.max(top, minY === h ? Math.floor(h * .27) : minY);
    for (let x = Math.floor(w * .04); x < w * .96; x += 3) {
      let count = 0, tested = 0;
      for (let y = yBegin; y < bottom; y += 4) { tested++; if (different(x, y)) count++; }
      if (tested && count / tested > .3) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    }
    if (minX >= maxX || minY >= h) return null;
    return { x: minX, y: minY, w: maxX - minX + 1,
      h: bottom - minY, confidence: .2, source: 'facade-guess' };
  }

  function estimateOccupancy(region, use, imageWidth, buildingWidthMeters) {
    const preset = USES[use] || USES.other;
    if (!Number.isFinite(preset.perPerson)) return 0;
    const width = clamp(Number(buildingWidthMeters) || 20, 3, 200);
    const metersPerPixel = width / Math.max(1, imageWidth);
    const area = region.w * region.h * metersPerPixel * metersPerPixel;
    // Educational defaults, NOT regulatory capacity or safe occupancy limits.
    return clamp(Math.round(area / preset.perPerson), 0, preset.max);
  }

  function toSceneRect(region, imageWidth, imageHeight, buildingWidthMeters, pxPerMeter) {
    const ppm = Math.max(1, Number(pxPerMeter) || 25);
    const targetW = clamp(Number(buildingWidthMeters) || 20, 3, 200) * ppm;
    const scale = Math.min(targetW / imageWidth, 792 / imageWidth, 504 / imageHeight);
    const offsetX = (900 - imageWidth * scale) / 2;
    const offsetY = (590 - imageHeight * scale) / 2;
    const x = clamp(offsetX + region.x * scale, 0, 888);
    const y = clamp(offsetY + region.y * scale, 0, 578);
    return { x: Math.round(x), y: Math.round(y),
      w: Math.max(12, Math.min(900 - x, Math.round(region.w * scale))),
      h: Math.max(12, Math.min(590 - y, Math.round(region.h * scale))),
      scaleLimited: targetW > imageWidth * scale + .1 };
  }

  // Low-confidence door swing hints in photographed corridor/classroom plans.
  // Many CAD exports have an arc across a door gap, not a clean empty break.
  // A visible ink stroke ABOVE a blank span of wall supports a suggestion only.
  function detectDoorSwings(imageData,rooms,existing) {
    const {width:w,height:h,data}=imageData;
    if(!assessPicture(imageData).photographedPlan) return [];
    const lit=(x,y)=>{if(x<0||y<0||x>=w||y>=h)return 255;
      const i=(Math.round(y)*w+Math.round(x))*4;
      return (77*data[i]+150*data[i+1]+29*data[i+2])/256;};
    const out=[];
    for(const r of rooms){
      if(r.w<38||r.h<32||r.y<h*.31||r.y>h*.83)continue;
      const peers=rooms.filter(q=>q!==r && Math.abs(q.y-r.y)<23 && Math.abs(q.x-r.x)>r.w*.4);
      if(peers.length<1)continue;
      let best=null;
      for(let x=Math.round(r.x+7);x<r.x+Math.min(40,r.w*.39);x+=2){
        let arc=0,gap=0;
        for(let y=Math.round(r.y)-22;y<r.y-7;y++)if(lit(x,y)<151)arc++;
        for(let y=Math.round(r.y)-6;y<=r.y+1;y++)if(lit(x,y)<122)gap++;
        if(arc<2||gap>3)continue;
        // Some contrast between ink above and white inside a doorway is required.
        const score=arc*.6+(3-gap)*.5;
        if(!best||score>best.score)best={x,y:r.y-2,score};
      }
      if(!best)continue;
      if([...existing,...out].some(o=>Math.hypot(o.x-best.x,o.y-best.y)<19))continue;
      out.push({x:Math.round(best.x),y:Math.round(best.y),kind:'door',selected:false,
        source:'door-swing-hint',confidence:.42,gapPx:12,direction:'h'});
    }
    return out.slice(0,45);
  }

  // Searches raw pixels for visible gaps in long, dark, straight walls.
  // An opening symbol alone cannot reliably distinguish a window from a door;
  // every candidate requires explicit human confirmation in the UI.
  function detectOpenings(imageData, regions, options) {
    const w=imageData.width,h=imageData.height,data=imageData.data;
    if (!w||!h||!data||data.length<w*h*4) return [];
    const rooms=(regions||[]).filter(r=>r.selected!==false);
    const opt=options||{};
    const threshold=clamp(+opt.threshold||155,40,240);
    const minGap=clamp(Math.round(Math.min(w,h)*.014),4,12);
    const candidates=[];
    function isDark(x,y) {
      if(x<0||y<0||x>=w||y>=h)return false;
      const i=(Math.round(y)*w+Math.round(x))*4;
      return (77*data[i]+150*data[i+1]+29*data[i+2])/256<threshold && data[i+3]>32;
    }
    function scan(orientation,coord,from,to,kind) {
      from=Math.max(2,Math.ceil(from+7));to=Math.min((orientation==='v'?h:w)-3,Math.floor(to-7));
      if(to-from<35)return;
      // A perpendicular 7-pixel probe compensates for expanded room boxes.
      const dark=[];
      for(let t=from;t<=to;t++) {
        let n=0;
        for(let d=-5;d<=5;d++) if (orientation==='v'?isDark(coord+d,t):isDark(t,coord+d)) n++;
        dark.push(n>=2);
      }
      const fraction=dark.filter(Boolean).length/dark.length;
      if(fraction<.33)return; // no evidence for a wall here
      for(let i=7;i<dark.length-7;) {
        if(dark[i]) {i++;continue;}
        const start=i;
        while(i<dark.length&&!dark[i])i++;
        const len=i-start;
        if(len<minGap || len>Math.min(45,dark.length*.38))continue;
        const before=dark.slice(Math.max(0,start-8),start).filter(Boolean).length;
        const after=dark.slice(i,Math.min(dark.length,i+8)).filter(Boolean).length;
        if(before<5||after<5)continue;
        const t=from+(start+i)/2;
        const x=orientation==='v'?coord:t,y=orientation==='v'?t:coord;
        if(candidates.some(c=>Math.hypot(c.x-x,c.y-y)<22))continue;
        candidates.push({x:Math.round(x),y:Math.round(y),kind,
          selected:false,source:'detected-gap',confidence:+clamp(.42+fraction*.24,0,.7).toFixed(2),
          gapPx:len,direction:orientation});
      }
    }
    for(let a=0;a<rooms.length;a++) {
      const r=rooms[a];
      for(let b=a+1;b<rooms.length;b++) {
        const q=rooms[b];
        const y1=Math.max(r.y,q.y),y2=Math.min(r.y+r.h,q.y+q.h);
        const x1=Math.max(r.x,q.x),x2=Math.min(r.x+r.w,q.x+q.w);
        const dx=Math.min(Math.abs(r.x+r.w-q.x),Math.abs(q.x+q.w-r.x));
        const dy=Math.min(Math.abs(r.y+r.h-q.y),Math.abs(q.y+q.h-r.y));
        if(y2-y1>35&&dx<24) {
          const edge=Math.abs(r.x+r.w-q.x)<Math.abs(q.x+q.w-r.x)?(r.x+r.w+q.x)/2:(q.x+q.w+r.x)/2;
          scan('v',Math.round(edge),y1,y2,'door');
        }
        if(x2-x1>35&&dy<24) {
          const edge=Math.abs(r.y+r.h-q.y)<Math.abs(q.y+q.h-r.y)?(r.y+r.h+q.y)/2:(q.y+q.h+r.y)/2;
          scan('h',Math.round(edge),x1,x2,'door');
        }
      }
    }
    // On exterior edges a short break may indicate a window. Proposals remain
    // unselected until reviewed; a door to the outside should be changed manually.
    for(const r of rooms){
      const sides=[['v',r.x,r.y,r.y+r.h],['v',r.x+r.w,r.y,r.y+r.h],
        ['h',r.y,r.x,r.x+r.w],['h',r.y+r.h,r.x,r.x+r.w]];
      for(const [sideIndex,[orientation,coord,start,end]] of sides.entries()){
        const internal=rooms.some(q=>q!==r && (orientation==='v'
          ? Math.min(Math.abs(q.x-coord),Math.abs(q.x+q.w-coord))<22 && Math.min(r.y+r.h,q.y+q.h)-Math.max(r.y,q.y)>28
          : Math.min(Math.abs(q.y-coord),Math.abs(q.y+q.h-coord))<22 && Math.min(r.x+r.w,q.x+q.w)-Math.max(r.x,q.x)>28));
        if(!internal) {
          // Repeated classrooms often face an upper central corridor. A gap
          // on their upper side is a plausible *door*, but never auto-accept.
          const likelyCorridorFacing=sideIndex===2 && r.y>h*.30 &&
            rooms.some(q=>q!==r && Math.abs(q.y-r.y)<22 && Math.abs(q.x-r.x)>r.w*.6);
          scan(orientation,Math.round(coord),start,end,likelyCorridorFacing?'door':'window');
        }
      }
    }
    return [...candidates,...detectDoorSwings(imageData,rooms,candidates)].slice(0,70);
  }

  return { USES, assessPicture, enhancePlanContrast, detectRooms, detectDeskSymbols, estimateFacadeBounds, detectOpenings, estimateOccupancy, toSceneRect };
});
