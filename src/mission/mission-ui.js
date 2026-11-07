/* Mission interface: the tutorial panel (lesson text, objective, next and
   close), mission objectives, the chapter presentation, cinema bars with
   subtitles, rain and the end screen. Texts are the HD Remaster's localised
   strings, whose <span color="#RGB">...</> markup is rendered as colour. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansMissionUI=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const escape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 // TorusUI rich text -> HTML: colour spans, line breaks; everything else escaped.
 function richText(text){
  let html='',open=0;
  for(const part of String(text||'').replace(/\r\n?/g,'\n').split(/(<span color="#[0-9a-fA-F]{3,8}">|<\/>)/)){
   const colour=/^<span color="(#[0-9a-fA-F]{3,8})">$/.exec(part);
   if(colour){html+=`<span style="color:${colour[1]}">`;open++;}
   else if(part==='</>'){if(open){html+='</span>';open--;}}
   else html+=escape(part).replace(/\n/g,'<br>');
  }
  return html+'</span>'.repeat(open);
 }
 const plain=text=>String(text||'').replace(/<span color="#[0-9a-fA-F]{3,8}">|<\/>/g,'').replace(/\r?\n/g,' ').trim();
 function create(host){
  const el=(tag,cls,parent=host)=>{const e=document.createElement(tag);if(cls)e.className=cls;parent.appendChild(e);return e;};
  // ---- Tutorial panel -------------------------------------------------------
  const panel=el('section','tutorial-panel');panel.hidden=true;panel.setAttribute('aria-label','Tutoriel');
  const head=el('div','tutorial-head',panel),counter=el('span','tutorial-counter',head),objective=el('span','tutorial-objective',head);
  const minimise=el('button','tutorial-minimise',head);minimise.type='button';minimise.textContent='−';minimise.title='Réduire';
  const body=el('div','tutorial-body',panel);
  const foot=el('div','tutorial-foot',panel);
  const close=el('button','tutorial-button',foot);close.type='button';close.textContent='Fermer le tutoriel';
  const next=el('button','tutorial-button primary',foot);next.type='button';next.textContent='Suivant ▸';
  let handlers={next:()=>{},close:()=>{}};
  next.addEventListener('click',()=>handlers.next());close.addEventListener('click',()=>handlers.close());
  minimise.addEventListener('click',()=>{const small=panel.classList.toggle('minimised');minimise.textContent=small?'+':'−';minimise.title=small?'Agrandir':'Réduire';});
  const tutorial={
   show(index,total,text,goal){
    panel.hidden=false;counter.textContent=`${index+1}/${total}`;objective.textContent=plain(goal).toUpperCase();
    body.innerHTML=richText(text);next.hidden=index>=total-1;
    panel.classList.remove('flash');void panel.offsetWidth;panel.classList.add('flash');
   },
   hide(){panel.hidden=true;},
   on(next,close){handlers={next,close};},
   get element(){return panel;}
  };
  // ---- Objectives -----------------------------------------------------------
  const list=el('section','mission-objectives');list.hidden=true;
  const listTitle=el('h2','',list);listTitle.textContent='Objectifs';
  const items=el('ol','',list);
  const toggle=el('button','objectives-toggle');toggle.type='button';toggle.textContent='Objectifs';toggle.hidden=true;
  toggle.addEventListener('click',()=>{list.hidden=!list.hidden;});
  const notices=el('div','mission-notices');
  function notice(text,kind=''){
   const n=el('div','mission-notice '+kind,notices);n.innerHTML=richText(text);
   setTimeout(()=>n.classList.add('leaving'),5200);setTimeout(()=>n.remove(),6000);
  }
  const objectives={
   set(entries){
    toggle.hidden=!entries.length;items.innerHTML='';
    for(const o of entries){const li=el('li',o.state,items);li.innerHTML=richText(o.text);}
   },
   notice,
   open(){list.hidden=false;},
   toggle(){if(!toggle.hidden)list.hidden=!list.hidden;}   // F9
  };
  // ---- Cinema bars, subtitles, presentation ---------------------------------
  const bars=el('div','cinema-bars');el('i','top',bars);el('i','bottom',bars);
  const subtitle=el('div','cinema-subtitle',bars);
  const skip=el('div','cinema-skip',bars);skip.textContent='Échap : passer';
  let skipHandler=null;skip.addEventListener('click',()=>skipHandler?.());
  const cinema={
   on(enabled){host.classList.toggle('cinema',!!enabled);if(!enabled)subtitle.innerHTML='';},
   say(text){subtitle.innerHTML=text?richText(text):'';},
   onSkip(fn){skipHandler=fn;},
   get active(){return host.classList.contains('cinema');}
  };
  const card=el('div','presentation');card.hidden=true;
  const cardTitle=el('h1','',card),cardPlace=el('p','',card);
  function presentation(title,place){
   card.hidden=false;cardTitle.innerHTML=richText(title);cardPlace.innerHTML=richText(place);
   card.classList.remove('shown');void card.offsetWidth;card.classList.add('shown');
  }
  presentation.hide=()=>{card.classList.remove('shown');setTimeout(()=>{card.hidden=true;},700);};
  // ---- Rain -----------------------------------------------------------------
  const rain=el('canvas','rain-layer');rain.hidden=true;
  let drops=[],raining=0,rainFrame=null;
  function rainLoop(){
   const w=rain.width=rain.clientWidth,h=rain.height=rain.clientHeight,ctx=rain.getContext('2d');
   // A grey veil and slanting streaks (ModificarLluvia).
   ctx.clearRect(0,0,w,h);ctx.fillStyle=`rgba(40,48,58,${.16*raining})`;ctx.fillRect(0,0,w,h);
   ctx.strokeStyle='rgba(210,220,235,.4)';ctx.lineWidth=1.2;ctx.beginPath();
   const wanted=Math.round(raining*700);while(drops.length<wanted)drops.push({x:Math.random(),y:Math.random(),s:.9+Math.random()*.6});
   drops.length=Math.min(drops.length,wanted);
   for(const d of drops){d.y+=.025*d.s;d.x-=.004*d.s;if(d.y>1){d.y-=1;d.x=Math.random();}if(d.x<0)d.x+=1;ctx.moveTo(d.x*w,d.y*h);ctx.lineTo(d.x*w-4*d.s,d.y*h+16*d.s);}
   ctx.stroke();rainFrame=raining>0?requestAnimationFrame(rainLoop):null;
  }
  function setRain(amount){raining=Math.max(0,Math.min(1,amount));rain.hidden=raining<=0;if(raining>0&&!rainFrame)rainFrame=requestAnimationFrame(rainLoop);}
  // ---- End of mission -------------------------------------------------------
  const end=el('div','mission-end');end.hidden=true;
  const endTitle=el('h1','',end),endList=el('ol','',end),endActions=el('div','mission-end-actions',end);
  const again=el('button','tutorial-button primary',endActions);again.type='button';again.textContent='Rejouer';
  const menu=el('button','tutorial-button',endActions);menu.type='button';menu.textContent='Menu principal';
  again.addEventListener('click',()=>location.reload());
  menu.addEventListener('click',()=>{location.href=location.pathname;});
  // onContinue: the results screen follows; its one button (Continuer) and a
  // click anywhere go on to it.
  const onward=el('button','tutorial-button primary',endActions);onward.type='button';onward.textContent='Continuer';onward.hidden=true;
  function finish(victory,entries,{onContinue=null}={}){
   end.hidden=false;end.classList.toggle('victory',!!victory);endTitle.textContent=victory?'VICTOIRE':'DÉFAITE';
   endList.innerHTML='';for(const o of entries){const li=el('li',o.state,endList);li.innerHTML=richText(o.text);}
   again.hidden=menu.hidden=!!onContinue;onward.hidden=!onContinue;
   if(onContinue){onward.onclick=end.onclick=()=>onContinue();}
  }
  return {tutorial,objectives,cinema,presentation,setRain,finish,richText,plain};
 }
 return {create,richText,plain};
});
