/* Rolling performance history. Graph values are the highest frame in each
   100 ms bin, so a single slow frame stays visible. All CPU times are measured
   on the browser's main thread; render is submission time, not GPU time. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansPerformanceHud=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const WINDOW_MS=30000,BIN_MS=100,CAPACITY=301,HISTOGRAM_LIMIT=1000;
 const METRICS=['interval','frame','simulation','combat','motion','cpu','world','batches','render','hud','steps'];
 const SERIES=[
  {key:'interval',label:'Frame interval',colour:'#f4c56a',visible:true},
  {key:'frame',label:'Frame CPU',colour:'#80cfff',visible:true},
  {key:'simulation',label:'Simulation',colour:'#c2a3ff',visible:true},
  {key:'motion',label:'Army motion',colour:'#ff99af',visible:false},
  {key:'cpu',label:'AI',colour:'#a7d976',visible:false},
  {key:'batches',label:'Batches CPU',colour:'#e5a1ed',visible:false},
  {key:'render',label:'Render CPU',colour:'#63dac5',visible:false}
 ];
 const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:0;
 const clock=()=>typeof performance!=='undefined'?performance.now():Date.now();

 function createHistory(){
  const ring=new Array(CAPACITY);let latest=null,breakNext=false;
  function record(sample,nowMs){
   if(!sample||!Number.isFinite(nowMs))return false;
   // Ignore an out-of-order producer rather than corrupting the live ring.
   if(latest!==null&&nowMs<latest)return false;
   latest=nowMs;
   const tick=Math.floor(nowMs/BIN_MS),index=((tick%CAPACITY)+CAPACITY)%CAPACITY;
   let bin=ring[index];
   if(!bin){bin={histogram:new Uint32Array(HISTOGRAM_LIMIT+2)};ring[index]=bin;}
   if(bin.tick!==tick){
    bin.tick=tick;bin.time=tick*BIN_MS;bin.count=0;bin.sum=0;bin.spikes=0;bin.histogramMax=0;bin.histogram.fill(0);bin.breakBefore=breakNext;
    for(const key of METRICS)bin[key]=0;
   }else if(breakNext)bin.breakBefore=true;
   breakNext=false;
   const interval=finite(sample.interval);
   bin.count++;bin.sum+=interval;if(interval>50)bin.spikes++;
   const bucket=Math.min(HISTOGRAM_LIMIT+1,Math.ceil(interval));
   bin.histogram[bucket]++;bin.histogramMax=Math.max(bin.histogramMax,bucket);
   for(const key of METRICS)bin[key]=Math.max(bin[key],finite(sample[key]));
   return true;
  }
  function snapshot(nowMs=latest===null?0:latest){
   const end=Number.isFinite(nowMs)?nowMs:(latest||0),start=end-WINDOW_MS;
   const selected=ring.filter(bin=>bin&&bin.time+BIN_MS>start&&bin.time<=end).sort((a,b)=>a.time-b.time);
   const histogram=new Uint32Array(HISTOGRAM_LIMIT+2),bins=[];
   let count=0,sum=0,max=0,spikes=0,histogramMax=0;
   for(const bin of selected){
    const point={time:bin.time,count:bin.count,breakBefore:bin.breakBefore};
    for(const key of METRICS)point[key]=bin[key];
    bins.push(point);count+=bin.count;sum+=bin.sum;max=Math.max(max,bin.interval);spikes+=bin.spikes;
    histogramMax=Math.max(histogramMax,bin.histogramMax);
    for(let i=0;i<=bin.histogramMax;i++)histogram[i]+=bin.histogram[i];
   }
   let p95=0,p95Overflow=false;
   if(count){
    const rank=Math.ceil(count*.95);let seen=0;
    for(let i=0;i<=histogramMax;i++)if((seen+=histogram[i])>=rank){p95=i;p95Overflow=i>HISTOGRAM_LIMIT;break;}
   }
   return {windowMs:WINDOW_MS,binMs:BIN_MS,start,end,bins,stats:{count,fps:sum>0?1000*count/sum:0,p95,p95Overflow,max,spikes}};
  }
  return {record,snapshot,clear(){ring.fill(undefined);latest=null;breakNext=false;},resetClock(){breakNext=true;},get latest(){return latest;}};
 }

 function create({root,canvas,onVisibilityChange,getContext}={}){
  if(!root)throw new Error('Performance HUD requires a root element.');
  const doc=root.ownerDocument||document,history=createHistory();
  const make=(tag,cls,parent,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;if(parent)parent.appendChild(node);return node;};
  root.classList.add('perf-panel');root.setAttribute('aria-label','Performance graph');
  const header=make('div','perf-header',root),heading=make('div','perf-heading',header);
  make('strong','',heading,'Performance');make('span','perf-subtitle',heading,'Live · last 30 seconds');
  const subtitle=heading.querySelector('.perf-subtitle'),controls=make('div','perf-controls',header);
  function button(text,title,callback){const node=make('button','perf-button',controls,text);node.type='button';node.title=title;node.addEventListener('click',callback);return node;}
  let visible=!root.hidden,frozen=null,lastDraw=-Infinity,hoverX=null,plot=null,destroyed=false;
  const active=new Set(SERIES.filter(s=>s.visible).map(s=>s.key));
  const freezeButton=button('Freeze','Freeze graph while the game keeps running',()=>setFrozen(!frozen));
  button('Clear','Clear the recorded performance history',clear);
  button('Export','Download performance history as JSON',()=>{
   const blob=new Blob([exportJson()],{type:'application/json'}),url=URL.createObjectURL(blob),link=doc.createElement('a');
   link.href=url;link.download='praetorians-performance.json';doc.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  const closeButton=button('×','Hide performance graph (F3)',()=>setVisible(false));closeButton.setAttribute('aria-label','Hide performance graph');
  const summary=make('div','perf-summary',root),statNodes={};
  for(const [key,label] of [['fps','FPS avg'],['p95','Frame p95 ≈'],['max','Peak frame'],['spikes','Frames >50 ms']]){
   const stat=make('div','perf-stat',summary);statNodes[key]=make('strong','',stat,'—');make('span','',stat,label);
  }
  summary.title='Last 30 seconds. Frame p95 is rounded up to 1 ms. A spike is one frame interval above 50 ms.';
  const chartWrap=make('div','perf-chart-wrap',root);
  if(!canvas)canvas=make('canvas','perf-canvas',chartWrap);else{canvas.classList.add('perf-canvas');chartWrap.appendChild(canvas);}
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Rolling frame times in milliseconds. Each point preserves the highest frame in a 100 millisecond bin.');
  const tooltip=make('div','perf-tooltip',chartWrap);tooltip.hidden=true;tooltip.setAttribute('role','status');
  const legend=make('div','perf-legend',root);
  for(const series of SERIES){
   const label=make('label','perf-key',legend),input=make('input','',label);input.type='checkbox';input.checked=active.has(series.key);input.setAttribute('aria-label',series.label);
   const swatch=make('i','',label);swatch.style.backgroundColor=series.colour;make('span','',label,series.label);
   input.addEventListener('change',()=>{if(input.checked)active.add(series.key);else active.delete(series.key);render();});
  }
  make('div','perf-help',root,'16.7 ms = 60 FPS · 33.3 ms = 30 FPS · Hover to inspect peaks');
  make('div','perf-help perf-note',root,'Frame interval includes GPU/browser waiting; render is CPU submission time.');
  const ctx=canvas.getContext('2d');

  function currentSnapshot(){return frozen||history.snapshot();}
  function getSnapshot(){
   const value=currentSnapshot();return {...value,frozen:!!frozen,visible,bins:value.bins.map(bin=>({...bin})),stats:{...value.stats}};
  }
  function exportJson(){return JSON.stringify({format:'praetorians-performance-v1',...getSnapshot(),...(getContext?{context:getContext()}:{}),units:'milliseconds',aggregation:'Maximum per metric in each 100 ms bin. Per-window stats count individual frames.',p95:'Frame interval rounded up to 1 ms; values beyond 1000 ms are reported as an overflow bucket.',render:'CPU submission time, not GPU execution time.'},null,2);}
  function updateTooltip(snapshot){
   if(hoverX===null||!plot||!snapshot.bins.length){tooltip.hidden=true;return;}
   const time=snapshot.start+Math.max(0,Math.min(1,(hoverX-plot.left)/plot.width))*WINDOW_MS;
   let nearest=snapshot.bins[0];for(const bin of snapshot.bins)if(Math.abs(bin.time-time)<Math.abs(nearest.time-time))nearest=bin;
   const ms=value=>value.toFixed(1)+' ms',age=Math.max(0,(snapshot.end-nearest.time)/1000);
   tooltip.textContent=`${age.toFixed(1)} s ago · ${nearest.count} frame${nearest.count===1?'':'s'}\nFrame interval ${ms(nearest.interval)} · Frame CPU ${ms(nearest.frame)}\nSimulation ${ms(nearest.simulation)} (combat ${ms(nearest.combat)}, motion ${ms(nearest.motion)}, AI ${ms(nearest.cpu)}, world ${ms(nearest.world)})\nBatches ${ms(nearest.batches)} · Render CPU ${ms(nearest.render)} · HUD ${ms(nearest.hud)}\nSimulation steps: ${nearest.steps} · Values are independent bin peaks`;
   tooltip.hidden=false;tooltip.style.left=Math.max(0,Math.min(hoverX-140,plot.totalWidth-290))+'px';
  }
  function draw(snapshot){
   const stats=snapshot.stats;
   statNodes.fps.textContent=stats.count?stats.fps.toFixed(0):'—';statNodes.p95.textContent=stats.count?(stats.p95Overflow?'>1000':stats.p95)+' ms':'—';
   statNodes.max.textContent=stats.count?stats.max.toFixed(1)+' ms':'—';statNodes.spikes.textContent=String(stats.spikes);
   if(!ctx)return;
   const bounds=canvas.getBoundingClientRect(),width=Math.max(240,Math.round(bounds.width||360)),height=Math.max(120,Math.round(bounds.height||150));
   const dpr=Math.min(2,typeof window!=='undefined'?(window.devicePixelRatio||1):1);
   if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
   ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
   const left=40,right=9,top=14,bottom=23,w=width-left-right,h=height-top-bottom;
   let peak=50;
   for(const bin of snapshot.bins)for(const key of active)peak=Math.max(peak,bin[key]);
   const ceiling=Math.max(50,Math.ceil(peak*1.12/10)*10),x=time=>left+(time-snapshot.start)/WINDOW_MS*w,y=value=>top+h-Math.min(ceiling,value)/ceiling*h;
   plot={left,width:w,totalWidth:width};
   ctx.font='10px sans-serif';ctx.lineWidth=1;ctx.textBaseline='middle';
   for(const value of [0,16.7,33.3,ceiling]){
    const py=y(value);ctx.strokeStyle=value===0||value===ceiling?'rgba(202,215,234,.2)':'rgba(202,215,234,.35)';ctx.setLineDash(value===16.7||value===33.3?[3,3]:[]);
    ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(width-right,py);ctx.stroke();ctx.fillStyle='#b9c4d3';ctx.textAlign='right';ctx.fillText(value===ceiling?Math.round(value)+'':value.toFixed(value%1?1:0),left-5,py);
   }
   ctx.setLineDash([]);ctx.textAlign='left';ctx.fillText('ms',1,top-8);
   for(const age of [30,20,10,0]){ctx.textAlign=age===30?'left':age===0?'right':'center';ctx.fillText(age===0?'now':'−'+age+'s',left+(30-age)/30*w,height-7);}
   ctx.save();ctx.beginPath();ctx.rect(left,top,w,h+1);ctx.clip();
   for(const series of SERIES){
    if(!active.has(series.key))continue;
    ctx.strokeStyle=series.colour;ctx.fillStyle=series.colour;ctx.lineWidth=series.key==='interval'?1.7:1.2;ctx.beginPath();let previous=null;
    for(const bin of snapshot.bins){
     const px=x(Math.min(snapshot.end,bin.time+BIN_MS/2)),py=y(bin[series.key]);
     if(!previous||bin.breakBefore||bin.time-previous.time>BIN_MS*2)ctx.moveTo(px,py);else ctx.lineTo(px,py);
     previous=bin;
    }
    ctx.stroke();
    // Individual points remain visible when there is only one bin or a gap.
    for(const bin of snapshot.bins){const value=bin[series.key];if(value>0){ctx.beginPath();ctx.arc(x(Math.min(snapshot.end,bin.time+BIN_MS/2)),y(value),series.key==='interval'&&value>50?2.5:1.2,0,Math.PI*2);ctx.fill();}}
   }
   if(hoverX!==null){ctx.strokeStyle='rgba(255,255,255,.5)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(hoverX,top);ctx.lineTo(hoverX,top+h);ctx.stroke();}
   ctx.restore();updateTooltip(snapshot);
  }
  function render(){if(!visible||destroyed)return;draw(currentSnapshot());lastDraw=clock();}
  function record(sample,nowMs=clock()){
   if(destroyed||!history.record(sample,nowMs))return;
   // No canvas or DOM writes while hidden or frozen.
   if(visible&&!frozen&&(lastDraw===-Infinity||nowMs-lastDraw>=BIN_MS)){draw(history.snapshot());lastDraw=nowMs;}
  }
  function setVisible(value){
   value=!!value;const changed=visible!==value;visible=value;root.hidden=!value;
   if(value)render();else{hoverX=null;tooltip.hidden=true;}
   if(changed&&typeof onVisibilityChange==='function')onVisibilityChange(value);
  }
  function setFrozen(value){
   value=!!value;if(value===!!frozen)return;
   frozen=value?history.snapshot():null;freezeButton.textContent=value?'Resume':'Freeze';freezeButton.setAttribute('aria-pressed',String(value));
   subtitle.textContent=value?'Frozen · game keeps running':'Live · last 30 seconds';render();
  }
  function clear(){history.clear();if(frozen)frozen=history.snapshot();hoverX=null;tooltip.hidden=true;lastDraw=-Infinity;render();}
  function pointerMove(event){const bounds=canvas.getBoundingClientRect();hoverX=event.clientX-bounds.left;render();}
  function pointerLeave(){hoverX=null;tooltip.hidden=true;render();}
  canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerleave',pointerLeave);
  freezeButton.setAttribute('aria-pressed','false');setVisible(visible);
  return {record,setVisible,isVisible:()=>visible,setFrozen,isFrozen:()=>!!frozen,clear,resetClock:()=>history.resetClock(),getSnapshot,exportJson,render,
   destroy(){destroyed=true;canvas.removeEventListener('pointermove',pointerMove);canvas.removeEventListener('pointerleave',pointerLeave);root.replaceChildren();}};
 }
 return {create,createHistory,WINDOW_MS,BIN_MS,CAPACITY};
});
