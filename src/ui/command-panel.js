/* Command panel: the HD Remaster's order window, to the right of the
   parchment. Three round category tabs (TorusUI IconCategory_*) - Actions,
   Aptitudes, Construction - over a 4 x 3 grid of square order buttons
   (IconUtil_Base_01 frame, IconUtil_Actions_* / IconUtil_Ability_* art).
   A gold ground (IconUtil_Activated_01) marks the order or attitude in force
   and abilities used automatically; unavailable orders are greyed out.

   main.js describes the panel at each refresh:
     render({tabs:{actions,abilities,construction}, buttons:{<tab>:[button]},
     columns:{<tab>:5}}) - recruitment shows five troop portraits a row.
   button: {id, icon, title, slot (0-11, row by row), disabled, active,
   auto (automatic use: undefined when the ability has none), reason (why it
   is greyed)}. Clicking an enabled button calls onCommand(tab, id);
   a right click on an ability with automatic use calls onToggleAuto(id);
   clicking a greyed one calls onDisabled(reason). Actions get the element
   id "<id>Command" (moveCommand, stopCommand...). */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansCommandPanel=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const TABS=[
  {id:'actions',title:'Actions',glyph:'IconCategory_Actions_01'},
  {id:'abilities',title:'Aptitudes',glyph:'IconCategory_Abilities_01'},
  {id:'construction',title:'Construction',glyph:'IconCategory_Construction_01'}];
 const COLUMNS=4,SLOTS=12;
 // The first tab with something to show, keeping the player's choice.
 function pickTab(current,available){
  if(current&&available[current])return current;
  return TABS.find(t=>available[t.id])?.id||null;
 }
 function create({root,base='assets/hd/interface/',onCommand=()=>{},onToggleAuto=()=>{},onDisabled=()=>{},onTab=()=>{}}={}){
  const doc=root.ownerDocument;
  const el=(tag,cls,parent)=>{const e=doc.createElement(tag);if(cls)e.className=cls;parent?.appendChild(e);return e;};
  root.classList.add('command-panel');
  const tabsBar=el('div','cp-tabs',root);tabsBar.setAttribute('role','tablist');
  const grid=el('div','cp-grid',root);
  const tip=el('div','cp-tip',root.ownerDocument.body);tip.hidden=true;
  const tabButtons=new Map();
  for(const t of TABS){
   const b=el('button','cp-tab',tabsBar);b.type='button';b.dataset.tab=t.id;b.setAttribute('role','tab');b.setAttribute('aria-label',t.title);
   // Absolute: a url() in a custom property resolves against the stylesheet using it.
   b.style.setProperty('--glyph',`url('${new URL(base+t.glyph+'.png',doc.baseURI).href}')`);
   b.addEventListener('click',()=>{if(b.classList.contains('cp-empty'))return;select(t.id,true);});
   hover(b,()=>b.classList.contains('cp-empty')?'':t.title);
   tabButtons.set(t.id,b);
  }
  let tab=null,chosen=null,model={tabs:{},buttons:{}};
  const nodes=new Map();
  function hover(node,text){
   node.addEventListener('pointerenter',()=>{const value=text();if(!value)return;tip.textContent=value;tip.hidden=false;place(node);});
   node.addEventListener('pointerleave',()=>{tip.hidden=true;});
  }
  // The tooltip sits above the hovered button, kept on screen.
  function place(node){
   const r=node.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight,vw=doc.documentElement.clientWidth;
   tip.style.left=`${Math.max(4,Math.min(vw-w-4,r.left+r.width/2-w/2))}px`;tip.style.top=`${Math.max(4,r.top-h-6)}px`;
  }
  function select(id,byPlayer){
   if(byPlayer)chosen=id;
   tab=id;for(const [key,b] of tabButtons){b.classList.toggle('cp-active',key===tab);b.setAttribute('aria-selected',String(key===tab));}
   draw();if(byPlayer)onTab(id);
  }
  function node(tabId,spec){
   const key=tabId+':'+spec.id;let b=nodes.get(key);
   if(!b){
    b=el('button','cp-button',grid);b.type='button';b.dataset.tab=tabId;b.dataset.command=spec.id;
    if(tabId==='actions'&&/^[a-z]+$/.test(spec.id))b.id=spec.id+'Command';
    const art=el('i','cp-art',b);art.setAttribute('aria-hidden','true');
    b.addEventListener('click',()=>{const s=b._spec;if(!s)return;if(s.disabled){if(s.reason)onDisabled(s.reason);return;}onCommand(tabId,s.id);});
    b.addEventListener('contextmenu',e=>{e.preventDefault();const s=b._spec;if(s&&s.auto!==undefined&&!s.disabled)onToggleAuto(s.id);});
    hover(b,()=>{const s=b._spec;if(!s)return '';const auto=s.auto===undefined?'':s.auto?'\nAutomatique · clic droit : désactiver':'\nClic droit : utilisation automatique';return s.title+(s.disabled&&s.reason?`\n${s.reason}`:auto);});
    b._art=art;b._last={};nodes.set(key,b);
   }
   return b;
  }
  function draw(){
   const list=tab?(model.buttons[tab]||[]):[],shown=new Set();
   const columns=model.columns?.[tab]||COLUMNS;
   if(root._columns!==columns){root._columns=columns;root.style.setProperty('--cp-cols',String(columns));root.classList.toggle('cp-wide',columns>COLUMNS);}
   for(const spec of list){
    if(spec.hidden)continue;
    const b=node(tab,spec),last=b._last;b._spec=spec;shown.add(b);
    const slot=Math.max(0,Math.min(columns*3-1,spec.slot|0)),place=slot+'/'+columns;
    if(last.slot!==place){last.slot=place;b.style.gridRow=String(Math.floor(slot/columns)+1);b.style.gridColumn=String(slot%columns+1);}
    if(last.icon!==spec.icon){last.icon=spec.icon;b._art.style.backgroundImage=`url('${base}${spec.icon}.png')`;}
    if(last.title!==spec.title){last.title=spec.title;b.setAttribute('aria-label',spec.title);}
    if(last.portrait!==!!spec.portrait){last.portrait=!!spec.portrait;b.classList.toggle('cp-portrait',!!spec.portrait);}
    const active=!!spec.active||!!spec.auto;
    if(last.active!==active){last.active=active;b.classList.toggle('cp-on',active);}
    if(last.disabled!==!!spec.disabled){last.disabled=!!spec.disabled;b.classList.toggle('cp-disabled',!!spec.disabled);b.setAttribute('aria-disabled',String(!!spec.disabled));}
   }
   for(const b of nodes.values()){const on=shown.has(b);if(b.hidden===on)b.hidden=!on;}
  }
  function render(next){
   model=next||{tabs:{},buttons:{}};
   const available=model.tabs||{};
   for(const [id,b] of tabButtons)b.classList.toggle('cp-empty',!available[id]);
   root.classList.toggle('cp-idle',!Object.values(available).some(Boolean));
   const want=pickTab(chosen,available);
   if(want!==tab)select(want,false);else draw();
  }
  // A new selection opens on the Actions tab, as the game does.
  function reset(){chosen=null;}
  function open(id){if(model.tabs?.[id])select(id,true);}
  return {render,reset,open,get tab(){return tab;},TABS};
 }
 return {create,pickTab,TABS,COLUMNS,SLOTS};
});
