/* The end of a game, as the HD Remaster's results screen
   (TorusMainMenuSkirmishComplete_BP): over the menu's map backdrop
   (MenuBackground) and panel (MenuPanel), "VICTOIRE !" and one banner per
   army in its colour - whole with its gold fringe for the winners
   (GUI/Menus/Graficos/PlayerWin0..7), torn for the vanquished
   (PlayerLose0..7) - bearing its emblem (TorusUI BannerIcon_NN), its name and
   VICTIMES, PERTES, UNITÉS FORMÉES, VILLAGE(S), DURÉE PARTIE and SCORE, with
   QUITTER below. The banners drop in one after another, the winners' sway in
   the wind under drifting embers, and the figures count up.

   Stats: kills and losses are soldiers; trained, soldiers trained in villages;
   villages, those held at the end. SCORE is this port's own measure (the
   original's formula is not in its data): 5 a kill, 1 a soldier trained, 25 a
   village held, less 1 a loss.

   main.js calls show({victory, seconds, players:[{name, colour (0-7), won,
   emblem (1-11), race, stats:{kills, losses, trained, villages}}]}). */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansResults=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const ART='assets/menu-original/Game/';
 const LABELS={victory:'Victoire !',defeat:'Échec !',kills:'Victimes',losses:'Pertes',trained:'Unités formées',
  villages:'Village(s)',time:'Durée partie',score:'Score',quit:'Quitter',replay:'Relancer mission'};
 function score({kills=0,losses=0,trained=0,villages=0}={}){return Math.max(0,Math.round(5*kills+trained+25*villages-losses));}
 function duration(seconds){
  const s=Math.max(0,Math.floor(Number(seconds)||0));
  return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');
 }
 // Each race's emblems (TorusUI BannerIcon_NN), its armies taking them in turn:
 // the Roman eagle first, the Gallic wolf, the Egyptian eye.
 const EMBLEMS={ROMANOS:[11,5,10,7],BARBAROS:[9,4,3,2],EGIPCIOS:[6,8,1]};
 function emblems(players){
  const used=new Map();
  return players.map(p=>{
   if(p.emblem)return p.emblem;
   const list=EMBLEMS[p.race]||[1,2,3,4,5,6,7,8,9,10,11],k=used.get(p.race)||0;used.set(p.race,k+1);
   return list[k%list.length];
  });
 }
 const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const reduced=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 function create({host=document.body,labels={},onQuit=()=>{},onReplay=null}={}){
  const L={...LABELS,...labels};
  let root=null,frame=0;
  function countUp(nodes,start){
   const run=now=>{
    let busy=false;
    for(const n of nodes){
     const t=Math.max(0,Math.min(1,(now-start-n.delay)/n.span));if(t<1)busy=true;
     const v=Math.round(n.to*(1-Math.pow(1-t,3)));if(n.shown!==v){n.shown=v;n.el.textContent=v;}
     if(t>=1&&!n.done){n.done=true;n.el.classList.add('rb-landed');}
    }
    frame=busy?requestAnimationFrame(run):0;
   };
   frame=requestAnimationFrame(run);
  }
  // Banners as wide as the panel allows (the HD's 285 px for two armies).
  function fit(){
   if(!root)return;
   const row=root.querySelector('.results-banners'),n=row.children.length||1;
   // --hd-px: 1 px at 1920 px wide, from .5 to 1.3 (hd-style.css).
   const hd=Math.min(1.3,Math.max(.5,innerWidth/1920)),room=row.clientWidth/n-16,height=row.clientHeight*.98;
   const width=Math.max(90,Math.min(285*hd,room,height*285/524));
   row.style.setProperty('--bw',width+'px');
  }
  function show({victory=true,seconds=0,players=[]}={}){
   hide();
   const marks=emblems(players),still=reduced();
   root=document.createElement('div');root.className='results'+(victory?' results-won':' results-lost')+(still?' results-still':'');
   root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label',victory?L.victory:L.defeat);
   const time=duration(seconds);
   const banners=players.map((p,i)=>{
    const total=score(p.stats),colour=Math.max(0,Math.min(7,p.colour|0));
    const rows=[['kills',p.stats.kills],['losses',p.stats.losses],['trained',p.stats.trained],['villages',p.stats.villages]]
     .map(([k,v])=>`<div class="rb-row"><dt>${esc(L[k])}</dt><dd data-to="${Math.max(0,v|0)}">0</dd></div>`).join('');
    return `<figure class="rb ${p.won?'rb-win':'rb-lose'}${p.human?' rb-you':''}" style="--i:${i}">
     <div class="rb-swing"><img class="rb-cloth" src="${ART}GUI/Menus/Graficos/${p.won?'PlayerWin':'PlayerLose'}${colour}.png" alt="" draggable="false">
      <figcaption class="rb-text">
       <img class="rb-emblem" src="${ART}TorusUI/MainMenu/BannerIcon_${String(marks[i]).padStart(2,'0')}.png" alt="" draggable="false">
       <strong class="rb-name">${esc(p.name)}</strong>
       <dl>${rows}<div class="rb-row rb-time"><dt>${esc(L.time)}</dt><dd>${time}</dd></div>
        <div class="rb-row rb-score"><dt>${esc(L.score)}</dt><dd data-to="${total}">0</dd></div></dl>
      </figcaption></div></figure>`;
   }).join('');
   const motes=still?'':Array.from({length:28},(_,k)=>`<i style="--x:${(k*37)%100};--d:${(k*53)%9};--s:${6+(k*29)%7}"></i>`).join('');
   root.innerHTML=`<img class="results-bg" src="${ART}TorusUI/MainMenu/MenuBackground.png" alt="" draggable="false">
    <div class="results-motes" aria-hidden="true">${victory?motes:''}</div>
    <section class="results-panel">
     <h1 class="results-title"><span>${esc(victory?L.victory:L.defeat)}</span></h1>
     <div class="results-banners" style="--n:${players.length}">${banners}</div>
    </section>
    <div class="results-actions">
     <button type="button" class="results-button" data-action="quit">${esc(L.quit)}</button>
     ${onReplay?`<button type="button" class="results-button" data-action="replay">${esc(L.replay)}</button>`:''}
    </div>`;
   root.querySelector('[data-action="quit"]').addEventListener('click',()=>onQuit());
   root.querySelector('[data-action="replay"]')?.addEventListener('click',()=>onReplay());
   host.appendChild(root);
   fit();addEventListener('resize',fit);
   requestAnimationFrame(()=>root?.classList.add('results-in'));
   // Each banner's figures count up once it has dropped in; the score last.
   const nodes=[];
   root.querySelectorAll('.rb').forEach((banner,i)=>{
    banner.querySelectorAll('dd[data-to]').forEach((el,k,all)=>{
     const last=k===all.length-1;
     nodes.push({el,to:Number(el.dataset.to)||0,delay:still?0:1200+i*320+k*140+(last?260:0),span:still?1:(last?1300:900),shown:-1});
    });
   });
   countUp(nodes,performance.now());
   root.querySelector('[data-action="quit"]').focus({preventScroll:true});
   return root;
  }
  function hide(){
   if(frame)cancelAnimationFrame(frame);frame=0;
   removeEventListener('resize',fit);
   root?.remove();root=null;
  }
  return {show,hide,setLabels(labels){Object.assign(L,labels);},get element(){return root;}};
 }
 return {create,score,duration,emblems,LABELS};
});
