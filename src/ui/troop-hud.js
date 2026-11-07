/* Troop HUD: a standard floating over each troop, and the selection panel.

   Standards show over a troop while it is selected or fighting (and a few
   seconds after it was last hit), and over every troop in cover (forest,
   tall grass) that the player can see: its emblem on a pennant in its army's
   colour, its soldiers left, and two bars - life (the living soldiers'
   average, as the original shows it) and endurance. Losses leave a pale
   trail that drains after them; hits shake the standard; a troop low on
   life pulses red, one out of breath blinks blue; kills rise as "+1".

   The selection panel, laid out as the HD Remaster's: one troop - its
   portrait with life and endurance bars under it, its name and soldiers
   "INFANTERIE AUXILIAIRE (30/30)", "POINTS DE VIE: 1000 / 1000" in green,
   "ENDURANCE: 1000 / 1000" in blue, "VICTIMES: 0", its formation choices and ability icons
   (gold when used automatically); several - a row of portraits each with
   its two upright bars (click: that troop alone; Ctrl/Shift-click: drop it
   from the selection), and below them every ability of the selection.

   main.js gives info(squad) -> {hp, hpMax, stamina, staminaMax, count, max,
   kills, colour, icon, name, side, selected, fighting, abilities:[{id, icon,
   title, auto}], formations:[{id, icon, title, active, disabled, reason}], stats}
   and project(squad) -> {x, y} in CSS pixels, or null
   off screen. A village or a centurion also gives: stLabel/stText (the
   village's POPULATION line), level ("NIVEAU 0 (PROCHAIN : 0/200)") and
   queue: the seven recruitment slots [{icon, title, progress}|null]; a
   click on a slot calls onQueue(index). */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansTroopHud=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const pct=(v,max)=>max>0?Math.max(0,Math.min(100,100*v/max)):0;
 const el=(tag,cls,parent)=>{const e=document.createElement(tag);if(cls)e.className=cls;parent?.appendChild(e);return e;};
 // Bars write their width only when it changes by a visible amount.
 function setWidth(node,value,last,key){const v=Math.round(value*2)/2;if(last[key]!==v){last[key]=v;node.style.width=v+'%';}}
 // ---- Standards over the troops ------------------------------------------------
 function banners({container}){
  const layer=el('div','tb-layer',container);
  const shown=new Map();
  function make(squad,info){
   const root=el('div','tb',layer),inner=el('div','tb-inner',root);
   const standard=el('div','tb-standard',inner),cloth=el('div','tb-cloth',standard);
   const icon=el('img','tb-icon',cloth);icon.alt='';icon.draggable=false;
   el('i','tb-finial',standard);
   const plate=el('div','tb-plate',inner),count=el('span','tb-count',plate),bars=el('div','tb-bars',plate);
   const hp=el('div','tb-bar tb-hp',bars),trail=el('i','tb-trail',hp),hpFill=el('i','tb-fill',hp);
   const st=el('div','tb-bar tb-st',bars),stFill=el('i','tb-fill',st);
   root.dataset.side=info.side;
   return {root,inner,cloth,icon,count,trail,hpFill,stFill,st,last:{},hpSeen:null,kills:info.kills,leaving:0};
  }
  function pop(b,text){const p=el('span','tb-pop',b.inner);p.textContent=text;setTimeout(()=>p.remove(),1400);}
  function update(squads,info,project){
   const now=performance.now(),seen=new Set(),placed=[];
   // Nearest the viewer first; a standard that would cover another one
   // already placed rises above it.
   const wanted=[];
   for(const squad of squads){
    // Selected, fighting, or in cover (forest, tall grass) where the player
    // can see it: troops hidden by the trees still show their standard.
    const i=info(squad);if(!i||!(i.selected||i.fighting||i.covered))continue;
    const at=project(squad);if(at)wanted.push({squad,i,at});
   }
   wanted.sort((a,b)=>b.at.y-a.at.y);
   for(const {squad,i,at} of wanted){
    for(let k=0;k<6&&placed.some(o=>Math.abs(o.x-at.x)<74&&Math.abs(o.y-at.y)<50);k++)at.y-=52;
    placed.push({x:at.x,y:at.y});
    seen.add(squad);
    let b=shown.get(squad);
    if(!b){b=make(squad,i);shown.set(squad,b);}
    if(b.leaving){b.leaving=0;b.root.classList.remove('tb-out');}
    b.root.style.transform=`translate3d(${at.x.toFixed(1)}px,${at.y.toFixed(1)}px,0)`;
    b.root.style.zIndex=String(Math.round(at.y));
    if(b.last.icon!==i.icon){b.last.icon=i.icon;b.icon.src=i.icon;}
    if(b.last.colour!==i.colour){b.last.colour=i.colour;b.root.style.setProperty('--tb-colour',i.colour);}
    if(b.last.count!==i.count){b.last.count=i.count;b.count.textContent=i.count;}
    const life=pct(i.hp,i.hpMax);
    setWidth(b.hpFill,life,b.last,'hp');setWidth(b.trail,life,b.last,'trail');
    b.root.style.setProperty('--tb-life',(life/100).toFixed(2));
    b.st.hidden=!(i.staminaMax>0);if(i.staminaMax>0)setWidth(b.stFill,pct(i.stamina,i.staminaMax),b.last,'st');
    b.root.classList.toggle('tb-sel',!!i.selected);
    b.root.classList.toggle('tb-fight',!!i.fighting);
    b.root.classList.toggle('tb-low',life<35);
    b.root.classList.toggle('tb-tired',!!i.exhausted);
    // Losses: a shake; kills: "+1" rising.
    const lives=i.hp*i.count;
    if(b.hpSeen!==null&&lives<b.hpSeen-1){
     if(now-(b.hitAt||0)>350){b.hitAt=now;b.inner.classList.remove('tb-hit');void b.inner.offsetWidth;b.inner.classList.add('tb-hit');}
    }
    b.hpSeen=lives;
    if(i.kills>b.kills){pop(b,`+${i.kills-b.kills}`);b.kills=i.kills;}
   }
   for(const [squad,b] of shown){
    if(seen.has(squad))continue;
    // Losing sight or concealment must remove enemy information immediately,
    // rather than leaving its standard readable during the normal fade-out.
    if(squad.side==='enemy'&&!squad.visible){b.root.remove();shown.delete(squad);continue;}
    if(!b.leaving){b.leaving=now;b.root.classList.add('tb-out');}
    else if(now-b.leaving>260){b.root.remove();shown.delete(squad);}
   }
  }
  function clear(){for(const b of shown.values())b.root.remove();shown.clear();}
  return {update,clear};
 }
 // ---- Selection panel ------------------------------------------------------------
 const ICONS={
  attack:'<svg viewBox="0 0 24 24"><path d="M3 21l4-1 11-11-3-3L4 17zM14 5l3-3 5 5-3 3z"/></svg>',
  ranged:'<svg viewBox="0 0 24 24"><path d="M4 20c9-2 14-7 16-16-3 6-8 11-16 16zM3 21l7-7M17 3h4v4"/></svg>',
  shield:'<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/></svg>',
  arrows:'<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5zM8 9l8 6M16 9l-8 6"/></svg>',
  speed:'<svg viewBox="0 0 24 24"><path d="M5 18h14M7 14l3-8h3l1 4 4 1v3"/></svg>',
  vision:'<svg viewBox="0 0 24 24"><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12zm10-3a3 3 0 100 6 3 3 0 000-6z"/></svg>',
  life:'<svg viewBox="0 0 24 24"><path d="M12 21s-8-5.5-8-11a4.5 4.5 0 018-3 4.5 4.5 0 018 3c0 5.5-8 11-8 11z"/></svg>'
 };
 // Formation choices sit before abilities beside the portrait. A disabled
 // choice explains itself without issuing an order; ability auto-use keeps
 // its separate right-click behavior.
 function abilityRow(row,list,last,onAbility,onToggleAuto,onFormation,onDisabled){
  const key=JSON.stringify(list.map(a=>[a.id,a.icon,a.title,a.auto,a.active,a.disabled,a.reason]));
  if(last.abilities===key)return;last.abilities=key;
  row.replaceChildren(...list.map(a=>{
   const formation=a.id.startsWith('formation:');
   const b=document.createElement('button');b.type='button';b.className='sel-ability'+(formation?' sel-formation':'')+(a.auto?' sel-auto':'')+(a.active?' sel-active':'')+(a.disabled?' sel-off':'');
   b.dataset.command=a.id;
   b.style.setProperty('--art',`url('${new URL(a.icon,document.baseURI).href}')`);b.title=a.title+(a.disabled&&a.reason?'\n'+a.reason:a.auto===undefined?'':a.auto?' · automatique (clic droit : désactiver)':' · clic droit : automatique');
   b.setAttribute('aria-label',a.title);
   b.setAttribute('aria-disabled',String(!!a.disabled));
   if(formation)b.setAttribute('aria-pressed',String(!!a.active));
   b.addEventListener('click',()=>{if(a.disabled){if(a.reason)onDisabled?.(a.reason);return;}(formation?onFormation:onAbility)?.(a.id);});
   b.addEventListener('contextmenu',e=>{e.preventDefault();if(!formation&&!a.disabled&&a.auto!==undefined)onToggleAuto?.(a.id);});
   return b;
  }));
 }
 const QUEUE_SLOTS=7;
 // The recruitment queue: seven slots, the first with its progress bar.
 function queueRow(row,queue,last,onQueue){
  const key=queue.map(q=>q?q.icon:'').join('|');
  if(last.queue!==key){
   last.queue=key;
   row.replaceChildren(...Array.from({length:QUEUE_SLOTS},(_,k)=>{
    const q=queue[k],b=document.createElement('button');b.type='button';b.className='sel-slot'+(q?' sel-slot-full':'');
    if(q){b.style.setProperty('--art',`url('${new URL(q.icon,document.baseURI).href}')`);b.title=q.title+' · clic : retirer';b.setAttribute('aria-label',q.title);
     b.addEventListener('click',()=>onQueue?.(k));const bar=document.createElement('i');bar.className='sel-slot-bar';b.appendChild(bar);}
    else b.disabled=true;
    return b;
   }));
  }
  [...row.children].forEach((b,k)=>{const bar=b.querySelector('.sel-slot-bar');if(bar){const v=Math.round((queue[k]?.progress||0)*100);if(bar._v!==v){bar._v=v;bar.style.width=v+'%';}}});
 }
 function panel({single,strip,onPick,onAbility,onToggleAuto,onQueue,onFormation,onDisabled}){
  const parts={
   portrait:single.querySelector('#selectionPortrait'),name:single.querySelector('#selectionName'),count:single.querySelector('#selectionCount'),
   kills:single.querySelector('#selectionKills'),hpText:single.querySelector('#selectionHp'),stText:single.querySelector('#selectionSt'),
   stLine:single.querySelector('.sel-st'),hpFill:single.querySelector('.sel-mini-hp b'),stFill:single.querySelector('.sel-mini-st b'),
   stBar:single.querySelector('.sel-mini-st'),frame:single.querySelector('.sel-portrait'),abilities:single.querySelector('#selectionAbilities'),
   hpLabel:single.querySelector('#selectionHpLabel'),stLabel:single.querySelector('#selectionStLabel'),killsLine:single.querySelector('.sel-kills'),
   level:single.querySelector('#selectionLevel'),queue:single.querySelector('#selectionQueue')};
  const cardsRow=strip.querySelector('.ss-cards'),stripAbilities=strip.querySelector('.ss-abilities');
  const last={},stripLast={},cards=new Map();
  function showOne(i){
   single.hidden=false;strip.hidden=true;
   if(last.icon!==i.icon){last.icon=i.icon;parts.portrait.src=i.icon;}
   if(last.name!==i.name){last.name=i.name;parts.name.textContent=i.name;}
   // A single man (a centurion, a scout) shows no count, as in the HD.
   parts.count.hidden=i.count==null||i.max===1;
   if(!parts.count.hidden){parts.count.textContent=`(${i.count}/${i.max})`;parts.count.classList.toggle('sel-losses',i.count<i.max);}
   parts.killsLine.hidden=i.kills==null;if(i.kills!=null)parts.kills.textContent=i.kills;
   parts.hpLabel.textContent=i.hpLabel||'Points de vie';parts.stLabel.textContent=i.stLabel||'Endurance';
   parts.level.hidden=!i.level;if(i.level)parts.level.textContent=i.level;
   const life=pct(i.hp,i.hpMax);
   setWidth(parts.hpFill,life,last,'hp');parts.frame.style.setProperty('--sel-life',(life/100).toFixed(2));
   parts.hpText.textContent=`${Math.round(i.hp)} / ${i.hpMax}`;
   const st=i.staminaMax>0||!!i.stText;parts.stLine.hidden=!st;parts.stBar.hidden=!(i.staminaMax>0);
   if(i.stText)parts.stText.textContent=i.stText;
   else if(st){setWidth(parts.stFill,pct(i.stamina,i.staminaMax),last,'st');parts.stText.textContent=`${Math.round(i.stamina)} / ${i.staminaMax}`;}
   parts.stLine.classList.toggle('sel-tired',!!i.exhausted);
   // A building site's low life is only how far it has risen.
   parts.frame.classList.toggle('sel-low',life<35&&!i.building);
   if(last.statsFor!==i.key){last.statsFor=i.key;parts.frame.title=(i.stats||[]).map(r=>`${r.label} : ${r.value}`).join('\n');}
   // A village or a centurion shows its recruitment queue in place of abilities.
   const queued=Array.isArray(i.queue);parts.queue.hidden=!queued;
   abilityRow(parts.abilities,queued?[]:[...(i.formations||[]),...(i.abilities||[])],last,onAbility,onToggleAuto,onFormation,onDisabled);
   if(queued)queueRow(parts.queue,i.queue,last,onQueue);
  }
  function showMany(list){
   single.hidden=true;strip.hidden=false;last.statsFor=null;
   const keep=new Set();let at=0;
   for(const i of list){
    keep.add(i.key);
    let c=cards.get(i.key);
    if(!c){
     const root=el('button','sc');root.type='button';
     const img=el('img','sc-icon',root);img.alt='';img.draggable=false;
     const count=el('span','sc-count',root),bars=el('span','sc-bars',root);
     const hp=el('i','sc-bar sc-hp',bars),hpFill=el('b','',hp),st=el('i','sc-bar sc-st',bars),stFill=el('b','',st);
     root.addEventListener('click',e=>onPick(i.key,e.ctrlKey||e.shiftKey||e.metaKey));
     c={root,img,count,hpFill,st,stFill,last:{}};cards.set(i.key,c);
    }
    // Moved only when out of place: re-inserting a card restarts its
    // entrance animation (the strip flashed at every refresh).
    if(cardsRow.children[at]!==c.root)cardsRow.insertBefore(c.root,cardsRow.children[at]||null);
    at++;
    if(c.last.icon!==i.icon){c.last.icon=i.icon;c.img.src=i.icon;}
    c.count.textContent=i.count;c.root.title=`${i.name} (${i.count}/${i.max}) · Victimes : ${i.kills}`;
    const life=pct(i.hp,i.hpMax);
    c.hpFill.style.height=life.toFixed(1)+'%';c.root.style.setProperty('--sc-life',(life/100).toFixed(2));
    c.st.hidden=!(i.staminaMax>0);if(i.staminaMax>0)c.stFill.style.height=pct(i.stamina,i.staminaMax).toFixed(1)+'%';
    c.root.classList.toggle('sc-low',life<35);c.root.classList.toggle('sc-fighting',!!i.fighting);
   }
   for(const [key,c] of cards)if(!keep.has(key)){c.root.remove();cards.delete(key);}
   // Formation choices precede every ability of the selection, once each.
   const seen=new Map();for(const i of list)for(const f of i.formations||[])if(!seen.has(f.id))seen.set(f.id,f);
   for(const i of list)for(const a of i.abilities||[])if(!seen.has(a.id))seen.set(a.id,a);
   abilityRow(stripAbilities,[...seen.values()],stripLast,onAbility,onToggleAuto,onFormation,onDisabled);
  }
  function show(list){
   if(!list.length){single.hidden=true;strip.hidden=true;return;}
   if(list.length===1)showOne(list[0]);else showMany(list);
  }
  return {show};
 }
 return {banners,panel,ICONS};
});
