/* Native HD text tables, saved language preference and incremental DOM labels.
   No per-frame translation pass: only changed UI nodes are inspected. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root?.document)root.PraetoriansI18n=api.create();
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const normalize=s=>String(s??'').normalize('NFC').replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim().toLocaleLowerCase();
 const LABELS={
  'MENU PRINCIPAL':{en:'MAIN MENU'},'UN JOUEUR':{en:'SINGLE PLAYER'},'MULTIJOUEUR':{en:'MULTIPLAYER'},
  'CHARGER PARTIE':{en:'LOAD GAME'},'CHARGER SÉQUENCE':{en:'LOAD REPLAY'},'REPRENDRE':{en:'RESUME'},
  'DÉMARRER UNE PARTIE':{en:'START GAME'},'CRÉER UNE PARTIE':{en:'CREATE GAME'},'RÉTABLIR PAR DÉFAUT':{en:'RESTORE DEFAULTS'},
  'AFFICHAGE':{en:'DISPLAY'},'SON':{en:'SOUND'},'INTERFACE':{en:'INTERFACE'},'LANGUE':{en:'LANGUAGE'},
  'Language':{fr:'Langue'},'Text and available voices change immediately.':{fr:'Les textes et les voix disponibles changent immédiatement.'},
  'Les textes de mission restent en français si le pack traduit n’est pas installé.':{en:'Mission text stays in French when a translated pack is not installed.'},
  'ATELIER D’ANIMATIONS':{en:'ANIMATION WORKSHOP'},'CONFIGURER L’ESCARMOUCHE':{en:'SKIRMISH SETUP'},
  'FACILE':{en:'EASY'},'NORMAL':{en:'MEDIUM'},'DIFFICILE':{en:'HARD'},'MASTER':{en:'MASTER'},
  'Développement lent. Défend ses villages, réagit tard et lance rarement des attaques.':{en:'Slow development. Defends villages, reacts slowly and rarely attacks.'},
  'Développement régulier. Petits raids et défense réactive.':{en:'Steady development. Small raids and responsive defence.'},
  'Expansion rapide. Attaques coordonnées, contre-attaques et défense solide.':{en:'Fast expansion. Coordinated attacks, counterattacks and strong defence.'},
  'Expansion fulgurante. Attaques préparées et pression constante sur vos positions.':{en:'Rapid expansion. Planned attacks and constant pressure on your positions.'},
  'Limite d’images / seconde':{en:'Frame rate limit'},'Limite d’images par seconde':{en:'Frame rate limit'},
  'Résolution 3D':{en:'3D resolution'},'30 FPS · économie GPU':{en:'30 FPS · lower GPU use'},'60 FPS · équilibré':{en:'60 FPS · balanced'},
  'Synchronisation écran · caméra fluide':{en:'Match display · smooth camera'},'100% · netteté d’origine':{en:'100% · native resolution'},
  '85% · allégée':{en:'85% · lighter rendering'},'75% · économie GPU':{en:'75% · lower GPU use'},
  'Synchronisation écran : fluidité maximale, GPU parfois plus sollicité. 30 FPS : économie, mouvement moins fluide.':{en:'Match display for the smoothest camera. 30 FPS uses less GPU but makes movement less smooth.'},
  'Ombres douces':{en:'Soft shadows'},'Ombres du terrain exploré':{en:'Explored terrain shading'},
  'Musique':{en:'Music'},'Effets sonores':{en:'Sound effects'},'Volume de la musique':{en:'Music volume'},'Volume des effets':{en:'Effects volume'},
  'Réponses des troupes (sélection et ordres)':{en:'Unit voices (selection and orders)'},
  'Messages vocaux (attaques, entraînement et constructions terminés)':{en:'Spoken alerts (attacks, training and construction)'},
  'Les volumes sont mémorisés et appliqués en jeu (musique, effets, voix).':{en:'Volume settings are saved and applied in game.'},
  'Défilement au bord de l’écran':{en:'Screen edge scrolling'},'Réduire les animations des menus':{en:'Reduce menu animations'},
  'Options enregistrées.':{en:'Options saved.'},'NOM DU JOUEUR':{en:'PLAYER NAME'},'ÉQUIPE':{en:'TEAM'},'COULEUR':{en:'COLOUR'},
  'RACE':{en:'CIVILIZATION'},'NOM DE LA PARTIE':{en:'GAME NAME'},'DÉTAILS DE LA CARTE':{en:'MAP DETAILS'},
  'ROMAINS':{en:'ROMANS'},'ÉGYPTIENS':{en:'EGYPTIANS'},'BARBARES':{en:'BARBARIANS'},'ALÉATOIRE':{en:'RANDOM'},
  'Même blason : alliés · Personnages : nombre de joueurs · — : indépendant':{en:'Same emblem: allies · Figures: team size · —: independent'},
  'Choisissez au moins une équipe adverse pour démarrer.':{en:'Choose at least one opposing team to start.'},
  'Tutoriel':{en:'Tutorial'},'Fermer le tutoriel':{en:'Close tutorial'},'Suivant ▸':{en:'Next ▸'},'Échap : passer':{en:'Esc: skip'},
  'Réduire':{en:'Minimise'},'Agrandir':{en:'Expand'},'Points de vie':{en:'Health'},'Endurance':{en:'Stamina'},
  'Victoires':{en:'Kills'},'Niveau':{en:'Level'},'Attaque':{en:'Attack'},'Tir':{en:'Ranged'},'Défense':{en:'Defence'},
  'Vitesse':{en:'Speed'},'Vision':{en:'Vision'},'Protection':{en:'Protection'},'Automatique':{en:'Automatic'},
  'Ordres':{en:'Orders'},'Formations':{en:'Formations'},'Aptitudes':{en:'Abilities'},'Construction':{en:'Construction'},
  'Briefing indisponible.':{en:'Briefing unavailable.'},'AUCUNE PARTIE DISPONIBLE':{en:'NO GAMES AVAILABLE'},
  'Aucune séquence sauvegardée disponible. Le système de sauvegarde sera ajouté avec les missions.':{en:'No saved replays available.'},
  'Aucune sauvegarde de campagne disponible dans cette reconstruction.':{en:'No saved campaign games available.'}
 };
 function create({read=async url=>{const r=await fetch(url);if(!r.ok)throw Error('Cannot load '+url);return r.json();},storage=typeof localStorage!=='undefined'?localStorage:null,document:doc=typeof document!=='undefined'?document:null}={}){
  const catalogs=new Map(),reverse=new Map(),labels=new Map(),listeners=new Set(),bindings=new Set();
  let language='fr',languages=[],serial=0,initial;
  const customKey=new Map();
  function registerLabels(entries){for(const [source,values] of Object.entries(entries)){
   const key=normalize(source),entry={...labels.get(key),source,...values};labels.set(key,entry);
   for(const value of Object.values(entry))customKey.set(normalize(value),key);
  }}
  registerLabels(LABELS);
  async function load(code){
   if(!catalogs.has(code))catalogs.set(code,Promise.resolve(read(`data/localization/${code}-game.json`)).then(data=>{
    if(data.labels)registerLabels(Object.fromEntries(Object.entries(data.labels).map(([source,value])=>[source,{[code]:value}])));
    const texts=new Map(Object.entries(data.texts||{}).map(([key,value])=>[key.toLowerCase(),value]));
    for(const [key,value] of texts)if(value&&String(value).length>1&&!reverse.has(normalize(value)))reverse.set(normalize(value),key);
    return texts;
   }).catch(error=>{catalogs.delete(code);throw error;}));
   return catalogs.get(code);
  }
  const loaded=new Map();
  const remember=async code=>{const table=await load(code);loaded.set(code,table);return table;};
  function text(key,fallback=key){const k=String(key??'').toLowerCase();return loaded.get(language)?.get(k)||loaded.get('en')?.get(k)||loaded.get('fr')?.get(k)||fallback;}
  function translateLabel(source){
   const raw=String(source??''),trim=raw.trim();if(!trim||!/[\p{L}]/u.test(trim))return raw;
   const k=normalize(trim),native=reverse.get(k),custom=labels.get(customKey.get(k)||k);
   let value;
   // Prefer the native game's own translations for ordinary labels.
   if(native)value=text(native,trim);
   else if(custom)value=custom[language]||(language==='fr'?custom.fr||custom.source:custom.en||custom.source);
   else if(/[:：]$/.test(trim)){const label=translateLabel(trim.slice(0,-1));if(label!==trim.slice(0,-1))value=label+':';}
   if(value===undefined)return raw;
   if(trim===trim.toLocaleUpperCase()&&trim!==trim.toLocaleLowerCase())value=value.toLocaleUpperCase();
   return raw.slice(0,raw.indexOf(trim))+value+raw.slice(raw.indexOf(trim)+trim.length);
  }
  const originals=new WeakMap();
  function apply(node,attribute=null){
   const current=attribute?node.getAttribute(attribute):node.nodeValue;if(current==null)return;
   let slots=originals.get(node);if(!slots){slots=new Map();originals.set(node,slots);}
   const record=slots.get(attribute),source=record?.last===current?record.source:current;
   const translated=translateLabel(source);slots.set(attribute,{source,last:translated});
   if(translated!==current){if(attribute)node.setAttribute(attribute,translated);else node.nodeValue=translated;}
  }
  const excluded=node=>node.parentElement?.closest('script,style,textarea,pre,code,[data-i18n-ignore]');
  function translate(root){
   if(!root||!doc)return;
   if(root.nodeType===3){if(!excluded(root))apply(root);return;}
   if(root.nodeType!==1&&root.nodeType!==9)return;
   if(root.matches?.('script,style,textarea,pre,code,[data-i18n-ignore]'))return;
   const walker=doc.createTreeWalker(root,4);let node;
   while((node=walker.nextNode()))if(!excluded(node))apply(node);
   const elements=root.nodeType===1?[root,...root.querySelectorAll('[title],[aria-label],[placeholder],[alt]')]:root.querySelectorAll('[title],[aria-label],[placeholder],[alt]');
   for(const el of elements)if(!el.closest('[data-i18n-ignore]'))for(const attr of ['title','aria-label','placeholder','alt'])if(el.hasAttribute(attr))apply(el,attr);
  }
  function bind(root){
   translate(root);const record={root,observer:null};bindings.add(record);
   if(typeof MutationObserver!=='undefined'){
    record.observer=new MutationObserver(changes=>{for(const change of changes){
     if(change.type==='attributes')apply(change.target,change.attributeName);
     else if(change.type==='characterData')translate(change.target);
     else for(const node of change.addedNodes)translate(node);
    }});
    record.observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','placeholder','alt']});
   }
   return ()=>{record.observer?.disconnect();bindings.delete(record);};
  }
  async function change(code,{persist=true}={}){
   const turn=++serial,requested=String(code).replace(/_/g,'-').toLowerCase();
   code=languages.find(item=>item.id.toLowerCase()===requested||(item.aliases||[]).some(alias=>alias.toLowerCase()===requested))?.id||languages.find(item=>item.id.toLowerCase()===requested.split('-')[0])?.id||languages[0]?.id||'fr';
   await remember(code);if(turn!==serial)return false;
   language=code;if(doc)doc.documentElement.lang=code;
   if(persist)try{const options=JSON.parse(storage?.getItem('praetorians.menu.options')||'{}');options.language=code;storage?.setItem('praetorians.menu.options',JSON.stringify(options));}catch{}
   for(const binding of bindings)translate(binding.root);
   for(const listener of listeners)listener(code);
   return true;
  }
  initial=(async()=>{
   const catalog=await read('data/localization/languages.json');languages=catalog.languages;
   await Promise.all(['fr','en'].filter(code=>languages.some(item=>item.id===code)).map(remember));
   let selected=catalog.default||'fr';try{selected=JSON.parse(storage?.getItem('praetorians.menu.options')||'{}').language||selected;}catch{}
   await change(selected,{persist:false});
  })();
  return {ready:()=>initial,setLanguage:async code=>{await initial;return change(code);},text,translateLabel,translate,bind,registerLabels,
   onChange(fn){listeners.add(fn);return ()=>listeners.delete(fn);},get language(){return language;},get languages(){return languages.map(item=>({...item}));}};
 }
 return {create,normalize};
});
