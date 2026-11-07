/* Praetorians HD Remaster main menu, rebuilt from the Remaster's own TorusUI
   artwork (exported from the user's PAKs into assets/menu-original). Screens
   are laid out on a 1920x1080 page, as in the original, scaled to the window. */
import {createScreenStore} from './state-manager.js';
import {loadCatalog} from './catalog.js?v=languages-20261105';

const I18n=window.PraetoriansI18n;
await I18n.ready();
I18n.bind(document.body);

const $ = id => document.getElementById(id);
const html = s => String(s ?? '').replace(/[&<>"']/g, char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const ui = $('menuApp');
const store = createScreenStore('main');
const RenderBudget=window.PraetoriansRenderBudget;
const defaultOptions = {difficulty:'facile', edgeScroll:true, shadows:true, explored:true, music:75, effects:85, language:'fr', reduceMotion:false, voices:true, announcer:true};
let options={...defaultOptions};
try { options={...options,...JSON.parse(localStorage.getItem('praetorians.menu.options') || '{}')}; } catch { /* storage optional */ }
options.language=I18n.language;
let catalog={campaign:[],multiplayer:[]}, selectedCampaign='SP_TUTORIAL_1', selectedSkirmish='MP_2_1', selectedMulti='MP_2_1';
let gameStarted=false, launching=false, note='', roomName='Praetorians', slots=4, roomMap='MP_2_1';
const skirmish=window.PraetoriansSkirmishSetup;
const skirmishDrafts=new Map();
try {
 const saved=JSON.parse(localStorage.getItem('praetorians.skirmish.setup')||'{}');
 if(typeof saved.map==='string')selectedSkirmish=saved.map;
 for(const [id,players] of Object.entries(saved.drafts||{}))if(Array.isArray(players))skirmishDrafts.set(id,players);
}catch{ /* storage optional */ }
const skirmishCapacity=()=>skirmish.capacity(byId(catalog.multiplayer,selectedSkirmish)?.players);
function skirmishPlayers(){
 const max=skirmishCapacity();
 if(!skirmishDrafts.has(selectedSkirmish))skirmishDrafts.set(selectedSkirmish,skirmish.createPlayers(max));
 return skirmishDrafts.get(selectedSkirmish);
}
function saveSkirmish(){try{localStorage.setItem('praetorians.skirmish.setup',JSON.stringify({map:selectedSkirmish,drafts:Object.fromEntries(skirmishDrafts)}));}catch{}}
function renameCpus(players){players.forEach((player,i)=>{if(i)player.name='CPU'+i;});return players;}
const saveOptions=()=>{try{localStorage.setItem('praetorians.menu.options',JSON.stringify(options));}catch{}};
const byId=(items,id)=>items.find(x=>x.id===id)||items[0];
const isMenuOpen=()=>!ui.hidden;
const ART='assets/menu-original/Game/TorusUI/';
// Heraldry identifies a team, independently of every member's civilization.
const teamEmblems=[null,
 {icon:'01',name:'Main'}, {icon:'02',name:'Lyre'}, {icon:'03',name:'Nœud'}, {icon:'04',name:'Triquetra'},
 {icon:'05',name:'Aigle'}, {icon:'06',name:'Œil'}, {icon:'07',name:'Méandre'}, {icon:'08',name:'Ankh'}];
const difficultyLabels={facile:'FACILE',normal:'NORMAL',difficile:'DIFFICILE',master:'MASTER'};
const difficultyLevels={facile:1,normal:2,difficile:3,master:4};
const difficultyDescriptions={
 facile:'Développement lent. Défend ses villages, réagit tard et lance rarement des attaques.',
 normal:'Développement régulier. Petits raids et défense réactive.',
 difficile:'Expansion rapide. Attaques coordonnées, contre-attaques et défense solide.',
 master:'Expansion fulgurante. Attaques préparées et pression constante sur vos positions.'
};
if(!Object.hasOwn(difficultyLabels,options.difficulty))options.difficulty=defaultOptions.difficulty;
const names={main:'MENU PRINCIPAL',single:'UN JOUEUR',campaign:'CAMPAGNE',skirmish:'ESCARMOUCHE',skirmishSetup:'CONFIGURER L’ESCARMOUCHE',multiplayer:'MULTIJOUEUR',multiMaps:'SÉLECTIONNER UNE CARTE',createRoom:'CRÉER UNE PARTIE',lobby:'PARTIES DISPONIBLES',loadGame:'CHARGER PARTIE',loadSequence:'CHARGER SÉQUENCE',options:'OPTIONS',credits:'CRÉDITS',pause:'PAUSE'};
const button=(label,action,className='m-item',extra='')=>`<button type="button" class="${className}" data-action="${html(action)}" ${extra}>${html(label)}</button>`;
const pill=(label,action,extra='')=>button(label,action,'m-pill',extra);
// Centred menu: optional gold heading, the choices, and the pill below them.
const column=(heading,items,below)=>`<div class="m-panel m-panel-small"></div><div class="m-column">${heading?`<div class="m-heading">${html(heading)}</div>`:''}${items.map(([label,action])=>button(label,action)).join('')}${below?`<div class="m-column-pill">${below}</div>`:''}</div>`;
// RETOUR / LANCER style buttons in the bottom corners of the page.
const corners=(left,right)=>`${left?`<div class="m-corner m-corner-left">${pill(left[0],left[1])}</div>`:''}${right?`<div class="m-corner m-corner-right">${pill(right[0],right[1],right[2]||'')}</div>`:''}`;
const list=(entries,current,action,label=entry=>entry.title)=>`<div class="m-list" role="listbox">${entries.map(entry=>`<button role="option" aria-selected="${entry.id===current}" type="button" class="m-list-item${entry.id===current?' current':''}" data-action="${action}" data-value="${html(entry.id)}">${html(label(entry))}</button>`).join('')}</div>`;
const paragraphs=text=>String(text||'').split(/\n\s*\n/).map(p=>`<p>${html(p)}</p>`).join('');
const mapArt=entry=>{
 if(!entry)return '';
 const helper=window.PraetoriansMapVillageMarkers,info=entry.mapInfo;
 const villages=(info?.villages||[]).map(village=>({village,p:helper?.project(village,info.width,info.depth)})).filter(marker=>marker.p);
 return `<div class="m-map-art" data-map-id="${html(entry.id)}"><img class="m-map-base" src="${html(entry.art)}" alt="Aperçu de ${html(entry.title)} · ${villages.length} villages" onerror="this.onerror=null;${entry.fallback?`this.src='${html(entry.fallback)}'`:`this.style.visibility='hidden'`}"><svg class="m-map-villages" viewBox="0 0 720 448" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${villages.map(({village,p})=>`<image class="m-map-village" href="${helper.ICON}" x="${p.x-18}" y="${p.y-15.75}" width="36" height="31.5" data-world-x="${village.x}" data-world-z="${village.z}"><title>${html(village.name)}</title></image>`).join('')}</svg></div>`;
};
const social=()=>`<div class="m-social" aria-hidden="true">${['Newsletter','Facebook','Twitch','Twitter','Youtube'].map(name=>`<img src="${ART}SocialMediaIcons/${name}.png" alt="">`).join('')}</div>`;
const widePanel=content=>`<div class="m-panel m-panel-wide"></div><div class="m-content">${content}</div>`;
function renderMain(){return column(null,[['UN JOUEUR','single'],['MULTIJOUEUR','multiplayer'],['OPTIONS','options'],['CRÉDITS','credits']],pill('QUITTER','quit'));}
function renderSingle(){return column('UN JOUEUR',[['CAMPAGNE','campaign'],['CHARGER PARTIE','loadGame'],['CHARGER SÉQUENCE','loadSequence'],['ESCARMOUCHE','skirmish'],['ATELIER D’ANIMATIONS','animationWorkshop']],pill('RETOUR','back'));}
function renderMultiplayer(){return column('MULTIJOUEUR',[['RECHERCHER UNE PARTIE','lobby'],['CRÉER UNE PARTIE','createRoom'],['SÉLECTIONNER UNE CARTE','multiMaps']],pill('RETOUR','back'));}
function renderPause(){return column('PAUSE',[['REPRENDRE','resume'],['OPTIONS','options'],['MENU PRINCIPAL','exitGame']],pill('REPRENDRE','resume'));}
function renderCampaign(){
 const entry=byId(catalog.campaign,selectedCampaign);
 const briefing=entry?.description?paragraphs(entry.description):'<p class="m-muted">Briefing indisponible.</p>';
 return `<div class="m-panel m-panel-wide"></div>
  <div class="m-missions"><div class="m-subheading">CHOISIR UNE MISSION</div>${list(catalog.campaign,selectedCampaign,'pickCampaign')}</div>
  <div class="m-divider m-divider-campaign"></div>
  <div class="m-briefing"><div class="m-title">CAMPAGNE</div><div class="m-mission-name">${html(entry?.title)}</div><div class="m-text">${briefing}</div>
   <div class="m-difficulty"><div class="m-subheading">DIFFICULTÉ</div><button type="button" class="m-difficulty-value" data-action="cycleDifficulty" title="${html(difficultyDescriptions[options.difficulty])} · Cliquer pour changer la difficulté" aria-label="Difficulté : ${html(difficultyLabels[options.difficulty])}. Cliquer pour changer.">${difficultyLabels[options.difficulty]}<span class="m-banner" aria-hidden="true"></span></button>${options.difficulty==='master'?'<p class="m-campaign-ai-note">Master reprend les renforts et scripts Difficile en campagne.</p>':''}</div></div>
  <img class="m-campaign-art" src="${html(entry?.art)}" alt="Carte de la campagne" onerror="this.style.visibility='hidden'">
  ${corners(['RETOUR','back'],['LANCER','launchCampaign'])}`;
}
function mapPicker(current,action,accept){
 const entry=byId(catalog.multiplayer,current);
 return `<div class="m-panel m-panel-small"></div>
  <div class="m-maps"><div class="m-subheading">SÉLECTIONNER UNE CARTE</div>${list(catalog.multiplayer,current,action,item=>item.label||item.title)}</div>
  <div class="m-divider m-divider-maps"></div>
  ${mapArt(entry)}
  ${corners(['RETOUR','back'],['ACCEPTER',accept,entry?'':'disabled'])}`;
}
function renderSkirmish(){
 return mapPicker(selectedSkirmish,'pickSkirmish','configureSkirmish');
}
function renderSkirmishSetup(){
 const entry=byId(catalog.multiplayer,selectedSkirmish),players=skirmishPlayers(),max=skirmishCapacity(),canStart=skirmish.hasOpponents(players);
 const selector=(player,index,field,values,extra='')=>`<select data-player-index="${index}" data-player-field="${field}" aria-label="${html(({color:'Couleur',team:'Équipe',race:'Race'})[field]+' de '+player.name)}" ${extra}>${values.map(([value,label])=>`<option value="${html(value)}" ${String(player[field])===String(value)?'selected':''}>${html(label)}</option>`).join('')}</select>`;
 const teamControl=(player,index)=>{
  const count=player.team?players.filter(member=>member.team===player.team).length:1,emblem=teamEmblems[player.team];
  const description=player.team?`Équipe ${player.team} · ${count} joueur${count>1?'s':''} · ${emblem.name}`:'Indépendant · 1 joueur';
  return `<div class="m-player-team" data-team="${player.team}">
   <span class="m-team-members" role="img" aria-label="${html(description)}" data-member-count="${count}">${Array.from({length:count},()=>`<img src="${ART}MainMenu/TeamPlayerIcon.png" alt="" aria-hidden="true">`).join('')}</span>
   <span class="m-team-emblem" title="${html(description)} · Choisir un blason pour rejoindre une équipe">
    ${emblem?`<img src="${ART}MainMenu/BannerIcon_${emblem.icon}.png" alt="" aria-hidden="true">`:'<span aria-hidden="true">—</span>'}
    ${selector(player,index,'team',[[0,'— Indépendant'],...teamEmblems.slice(1).map((item,i)=>[i+1,`${item.name} · Équipe ${i+1}`])],'title="Choisir le blason de l’équipe. Même blason : alliés."')}
   </span></div>`;
 };
 return `<div class="m-panel m-panel-wide"></div>
  <section class="m-skirmish-details" aria-label="Détails de la carte">
   <div class="m-title">ESCARMOUCHE</div><div class="m-subheading m-map-details-heading">DÉTAILS DE LA CARTE</div>
   ${mapArt(entry)}<div class="m-skirmish-map-name">${html(entry?.label||entry?.title)}</div>
   <div class="m-skirmish-difficulty"><div class="m-subheading">DIFFICULTÉ</div><div class="m-difficulty-choices" role="group" aria-label="Difficulté de l’IA">${Object.entries(difficultyLabels).map(([value,label])=>button(label,'setSkirmishDifficulty','m-difficulty-choice'+(value==='master'?' m-difficulty-master':''),`data-value="${value}" aria-pressed="${options.difficulty===value}" aria-describedby="skirmishDifficultyDescription" title="${html(difficultyDescriptions[value])}"`)).join('')}</div><p id="skirmishDifficultyDescription" class="m-difficulty-description" role="status">${html(difficultyDescriptions[options.difficulty])}</p></div>
  </section><div class="m-divider m-divider-skirmish"></div>
  <section class="m-skirmish-roster" aria-label="Joueurs de l’escarmouche">
   <div class="m-player-head" aria-hidden="true"><span>NOM DU JOUEUR</span><span>COULEUR</span><span>ÉQUIPE</span><span>RACE</span><span>×</span></div>
   ${players.map((player,index)=>`<div class="m-player-row${index===0?' m-human-player':''}" data-player-index="${index}">
    ${index===0?`<input id="skirmishPlayerName" class="m-player-name" aria-label="Nom du joueur" maxlength="40" autocomplete="off" spellcheck="false" value="${html(player.name)}">`:`<span class="m-player-name">${html(player.name)}</span>`}
    <div class="m-player-color">${selector(player,index,'color',skirmish.COLORS.map((color,i)=>[i,color.label]),`style="--player-color:${skirmish.COLORS[player.color].hex}" title="Couleur : ${html(skirmish.COLORS[player.color].label)}"`)}</div>
    ${teamControl(player,index)}
    <div class="m-player-race">${selector(player,index,'race',skirmish.RACES.map(race=>[race.id,race.label.toLocaleUpperCase('fr')]))}</div>
    <div class="m-player-remove">${index?`<button type="button" data-action="removeSkirmishCpu" data-value="${index}" aria-label="Retirer ${html(player.name)}" ${players.length<=2?'disabled title="Au moins un CPU est nécessaire"':''}><img src="${ART}MainMenu/RemoveIcon.png" alt=""></button>`:''}</div>
   </div>`).join('')}
   <div class="m-team-help${canStart?'':' m-setup-invalid'}" role="status">${canStart?'Même blason : alliés · Personnages : nombre de joueurs · — : indépendant': 'Choisissez au moins une équipe adverse pour démarrer.'}</div>
  </section>
  <div class="m-corner m-corner-left">${pill('RETOUR','back')}</div>
  <div class="m-corner m-corner-right m-corner-group">${pill('AJOUTER CPU','addSkirmishCpu',players.length>=max?'disabled title="Tous les emplacements de la carte sont occupés"':'')}${pill('DÉMARRER UNE PARTIE','launchSkirmish',canStart?'':'disabled')}</div>`;
}
const renderMultiMaps=()=>mapPicker(selectedMulti,'pickMulti','acceptMap');
function renderLobby(){return `${widePanel(`<div class="m-title">PARTIES DISPONIBLES</div><div class="menu-table-head"><span>NOM DE LA PARTIE</span><span>DÉTAILS DE LA CARTE</span><span>JOUEURS</span></div><div class="menu-table-empty"><strong>AUCUNE PARTIE DISPONIBLE</strong><p>La liste de serveurs est vide : aucun service multijoueur n’est encore connecté à cette reconstruction.</p></div>`)}<div class="m-corner m-corner-left">${pill('RETOUR','back')}</div><div class="m-corner m-corner-right m-corner-group">${pill('CRÉER','createRoom')}${pill('ACTUALISER','refresh')}${pill('REJOINDRE','join','disabled title="Un serveur de jeu est nécessaire"')}</div>`;}
function renderCreateRoom(){const entry=byId(catalog.multiplayer,roomMap);return `${widePanel(`<div class="m-title">CRÉER UNE PARTIE</div><div class="m-two-columns"><div><label class="menu-field">NOM DE LA PARTIE<input id="roomName" maxlength="48" value="${html(roomName)}" autocomplete="off"/></label><label class="menu-field">JOUEURS MAXIMUM<select id="roomSlots">${[2,4,6,8].map(n=>`<option value="${n}" ${n===slots?'selected':''}>${n}</option>`).join('')}</select></label><div class="menu-field">CARTE : <span>${html(entry?.label||entry?.title)}</span><br>${pill('CHOISIR UNE CARTE','multiMaps')}</div></div><div class="m-room-art">${mapArt(entry)}<p class="m-muted">Configuration locale uniquement : l’hébergement réseau sera ajouté avec le serveur multijoueur.</p></div></div>`)}${corners(['RETOUR','back'],['CRÉER','hostRoom','disabled title="Le serveur multijoueur n’est pas encore implémenté"'])}`;}
function renderEmpty(kind){return `${widePanel(`<div class="m-title">${html(names[kind])}</div><p class="m-muted">${kind==='loadGame'?'Aucune sauvegarde de campagne disponible dans cette reconstruction.':'Aucune séquence sauvegardée disponible. Le système de sauvegarde sera ajouté avec les missions.'}</p>`)}${corners(['RETOUR','back'])}`;}
function renderOptions(){return `${widePanel(`<div class="m-title">OPTIONS</div><div class="menu-options-columns"><div><label class="m-render-budget">${html(I18n.text('LTEXT_GUI_LANGUAGE','Langue'))}<select data-setting="language" aria-label="${html(I18n.text('LTEXT_GUI_LANGUAGE','Langue'))}" data-i18n-ignore>${I18n.languages.map(lang=>`<option value="${html(lang.id)}" ${options.language===lang.id?'selected':''}>${html(lang.name)}</option>`).join('')}</select></label><p class="m-muted">${html(I18n.translateLabel('Text and available voices change immediately.'))}</p>${I18n.languages.find(lang=>lang.id===I18n.language)?.missionTextLanguage!==I18n.language?`<p class="m-language-fallback">${html(I18n.translateLabel('Les textes de mission restent en français si le pack traduit n’est pas installé.'))}</p>`:''}<div class="m-subheading">AFFICHAGE</div>
 <label class="m-render-budget">Limite d’images / seconde<select aria-label="Limite d’images par seconde" data-setting="fpsLimit">${[[30,'30 FPS · économie GPU'],[60,'60 FPS · équilibré'],[90,'90 FPS'],[120,'120 FPS'],['display','Synchronisation écran · caméra fluide']].map(([value,label])=>`<option value="${value}" ${RenderBudget.read().fps===value?'selected':''}>${label}</option>`).join('')}</select></label>
 <label class="m-render-budget">Résolution 3D<select aria-label="Résolution 3D" data-setting="renderScale">${[[1,'100% · netteté d’origine'],[.85,'85% · allégée'],[.75,'75% · économie GPU']].map(([value,label])=>`<option value="${value}" ${RenderBudget.read().renderScale===value?'selected':''}>${label}</option>`).join('')}</select></label>
 <p class="m-render-hint">Synchronisation écran : fluidité maximale, GPU parfois plus sollicité. 30 FPS : économie, mouvement moins fluide.</p>
 <label><input type="checkbox" data-setting="shadows" ${options.shadows?'checked':''}/> Ombres douces</label>
 <label><input type="checkbox" data-setting="explored" ${options.explored?'checked':''}/> Ombres du terrain exploré</label></div><div><div class="m-subheading">SON</div><label>Musique <input aria-label="Volume de la musique" data-setting="music" type="range" min="0" max="100" value="${options.music}"/> ${options.music}%</label><label>Effets sonores <input aria-label="Volume des effets" data-setting="effects" type="range" min="0" max="100" value="${options.effects}"/> ${options.effects}%</label><label><input type="checkbox" data-setting="voices" ${options.voices?'checked':''}/> Réponses des troupes (sélection et ordres)</label><label><input type="checkbox" data-setting="announcer" ${options.announcer?'checked':''}/> Messages vocaux (attaques, entraînement et constructions terminés)</label><p class="m-muted">Les volumes sont mémorisés et appliqués en jeu (musique, effets, voix).</p><div class="m-subheading">INTERFACE</div><label><input type="checkbox" data-setting="edgeScroll" ${options.edgeScroll?'checked':''}/> Défilement au bord de l’écran</label><label><input type="checkbox" data-setting="reduceMotion" ${options.reduceMotion?'checked':''}/> Réduire les animations des menus</label></div></div><div class="menu-options-actions">${pill('PLEIN ÉCRAN','fullscreen')}${pill('RÉTABLIR PAR DÉFAUT','resetOptions')}</div>`)}${corners(['RETOUR','back'],['APPLIQUER','applyOptions'])}`;}
function renderCredits(){return `${widePanel(`<div class="m-title">CRÉDITS</div><div class="m-credits"><p>Praetorians HD Remaster</p><p>Reconstruction expérimentale dans Babylon.js, utilisant vos propres fichiers de jeu.</p><p>Jeu original et ressources : leurs créateurs et ayants droit respectifs.</p><p>Moteur 3D : Babylon.js</p><p class="m-muted">Projet non officiel · Aucun contenu d’origine n’est distribué avec ce correctif.</p></div>`)}${corners(['RETOUR','back'])}`;}
function renderPage(screen){
 switch(screen){case 'main':return renderMain();case 'single':return renderSingle();case 'campaign':return renderCampaign();case 'skirmish':return renderSkirmish();case 'skirmishSetup':return renderSkirmishSetup();case 'multiplayer':return renderMultiplayer();case 'multiMaps':return renderMultiMaps();case 'createRoom':return renderCreateRoom();case 'lobby':return renderLobby();case 'loadGame':case 'loadSequence':return renderEmpty(screen);case 'options':return renderOptions();case 'credits':return renderCredits();case 'pause':return renderPause();default:return renderMain();}
}
// The 1920x1080 page keeps the original proportions at any window size.
function fit(){ui.style.setProperty('--m-scale',String(Math.min(innerWidth/1920,innerHeight/1080)));}
addEventListener('resize',fit);
function render(){
 const screen=store.current;
 ui.innerHTML=`<img class="m-background" src="${ART}MainMenu/MenuBackground.png" alt=""><div class="m-page" role="region" aria-label="${html(names[screen]||'Menu')}">
  <img class="m-logo" alt="Praetorians HD Remaster" src="${ART}MainMenu/PretoreansHD_final.png">
  ${renderPage(screen)}
  <img class="m-eagle" alt="" src="${ART}MainMenu/EagleIcon.png">
  ${screen==='main'?social():''}
  <div class="menu-status" role="status" aria-live="polite">${note?html(note):''}</div></div>`;
 ui.classList.toggle('menu-motion-reduced',Boolean(options.reduceMotion));
 ui.dataset.screen=screen;fit();
 // Keep the chosen mission or map in view, as the original list does.
 ui.querySelector('.m-list-item.current')?.scrollIntoView({block:'nearest'});
}
function feedback(message) { note=message;const slot=ui.querySelector('.menu-status');if(slot)slot.textContent=message; }
function reflectOptions(){
 const game=window.praetorians;game?.troopVoices?.setEnabled({answers:options.voices!==false,messages:options.announcer!==false});game?.sound?.setVolume((options.effects??85)/100);game?.sound?.setMusicVolume((options.music??75)/100);
 const mapping=[['shadows','shadows'],['visibility','explored'],['edgeScroll','edgeScroll']];
 for(const [id,key] of mapping){const input=$(id);if(input){input.checked=!!options[key];input.dispatchEvent(new Event('change',{bubbles:true}));}}
}
const startTutorial=()=>startMission('SP_TUTORIAL_1');
// Any campaign mission or skirmish map (assets/missions/<id>.json). A game
// already running is replaced by reloading the page into the new one.
async function startMission(id,extra={}){
 if(launching)return;
 const settings={mission:id,difficulty:difficultyLevels[options.difficulty]||1,...extra};
 if(gameStarted||document.querySelector('script[data-game-entry]')){
  const url=new URL(location.href);url.search='';url.searchParams.set('launch','mission');
  for(const [key,value] of Object.entries(settings))url.searchParams.set(key,typeof value==='object'?JSON.stringify(value):String(value));
  location.assign(url.toString());return;
 }
 window.PraetoriansLaunch=settings;
 note='';ui.hidden=true;$('game').hidden=false;
 if(gameStarted){ reflectOptions();return; }
 launching=true;
 try {
  if(!document.querySelector('script[data-game-entry]')){
   const script=document.createElement('script');script.src='main.js?v=formation-hud-20261106';script.dataset.gameEntry='true';
   await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=()=>reject(new Error('main.js cannot be loaded'));document.body.append(script);});
  }
  gameStarted=true;
  const check=()=>{if(window.praetorians){reflectOptions();return true;}return false;};
  if(!check()){let attempts=0;const interval=setInterval(()=>{if(check()||++attempts>120)clearInterval(interval);},250);}
 }catch(error){ui.hidden=false;feedback('Impossible de charger la mission : '+error.message);}finally{launching=false;}
}
function closeMenu(){if(!gameStarted){store.reset('main');return;}ui.hidden=true;$('game').hidden=false;$('renderCanvas')?.focus();}
function openPause(){if(!gameStarted)return;store.reset('pause');ui.hidden=false;}
function exitGame(){ui.hidden=false;store.reset('main');}
function activate(action,value){
 switch(action){
  case 'single':case 'campaign':case 'skirmish':case 'multiplayer':case 'multiMaps':case 'lobby':case 'createRoom':case 'loadGame':case 'loadSequence':case 'options':case 'credits':store.go(action);break;
  case 'back':if(store.current==='pause'){closeMenu();}else if(store.previous==='pause'&&store.current==='options')store.back();else store.back();break;
  case 'pickCampaign':selectedCampaign=value;render();break;
  case 'cycleDifficulty':{const order=Object.keys(difficultyLabels);options.difficulty=order[(order.indexOf(options.difficulty)+1)%order.length];saveOptions();render();break;}
  case 'pickSkirmish':selectedSkirmish=value;saveSkirmish();render();break;
  case 'configureSkirmish':if(!catalog.multiplayer.some(entry=>entry.id===selectedSkirmish))break;skirmishDrafts.set(selectedSkirmish,skirmish.normalizePlayers(skirmishPlayers(),skirmishCapacity()));saveSkirmish();store.go('skirmishSetup');break;
  case 'setSkirmishDifficulty':if(Object.hasOwn(difficultyLabels,value)){options.difficulty=value;saveOptions();render();ui.querySelector(`[data-action="setSkirmishDifficulty"][data-value="${value}"]`)?.focus();}break;
  case 'addSkirmishCpu':{
   const players=skirmishPlayers();if(players.length>=skirmishCapacity())break;
   players.push({name:'CPU'+players.length,race:'RANDOM',team:0,color:skirmish.COLORS.findIndex((_,i)=>!players.some(player=>player.color===i))});
   saveSkirmish();render();ui.querySelector(`[data-player-field="race"][data-player-index="${players.length-1}"]`)?.focus();break;
  }
  case 'removeSkirmishCpu':{
   const players=skirmishPlayers(),index=Number(value);if(players.length<=2||!Number.isInteger(index)||index<1||index>=players.length)break;
   players.splice(index,1);renameCpus(players);saveSkirmish();render();ui.querySelector(`[data-action="removeSkirmishCpu"][data-value="${Math.min(index,players.length-1)}"]:not(:disabled)`)?.focus();break;
  }
  case 'pickMulti':selectedMulti=value;render();break;
  case 'acceptMap':roomMap=selectedMulti;store.back();break;
  case 'launchCampaign':startMission(selectedCampaign);break;
  case 'launchTutorial':startTutorial();break;
  case 'launchSkirmish':{if(!catalog.multiplayer.some(entry=>entry.id===selectedSkirmish))break;const players=skirmishPlayers();if(!skirmish.hasOpponents(players))break;saveSkirmish();const resolved=skirmish.prepareLaunch(players,skirmishCapacity());startMission(selectedSkirmish,{players:resolved,race:resolved[0].race,opponents:resolved.length-1});break;}
  case 'resume':closeMenu();break;
  case 'animationWorkshop':window.open('animation-workshop.html','_blank','noopener');break;
  case 'exitGame':exitGame();break;
  case 'refresh':feedback('Aucun serveur connecté. La liste ne peut pas encore être actualisée.');break;
  case 'hostRoom':case 'join':feedback('Le multijoueur nécessite un serveur et une synchronisation réseau.');break;
  case 'applyOptions':saveOptions();reflectOptions();feedback('Options enregistrées.');break;
  case 'resetOptions':options={...defaultOptions};I18n.setLanguage(defaultOptions.language);saveOptions();RenderBudget.write(RenderBudget.DEFAULT);window.praetorians?.renderBudget?.apply(RenderBudget.DEFAULT);render();break;
  case 'fullscreen':(document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen())?.catch(()=>feedback('Utilisez F11 pour le plein écran.'));break;
  case 'quit':feedback('Pour fermer cet onglet, utilisez Ctrl+W ou le bouton de fermeture du navigateur.');break;
 }
}
ui.addEventListener('click',event=>{
 const target=event.target.closest('button[data-action]');if(!target||target.disabled)return;
 activate(target.dataset.action,target.dataset.value);
});
ui.addEventListener('change',event=>{
 const field=event.target,setting=field.dataset.setting;
 if(setting==='fpsLimit'||setting==='renderScale'){
  const value={...RenderBudget.read(),[setting==='fpsLimit'?'fps':'renderScale']:field.value==='display'?'display':Number(field.value)};
  RenderBudget.write(value);window.praetorians?.renderBudget?.apply(value);
  render();ui.querySelector(`[data-setting="${setting}"]`)?.focus();return;
 }
 if(field.dataset.playerField){
  const key=field.dataset.playerField,index=Number(field.dataset.playerIndex),players=skirmishPlayers(),player=players[index];
  if(!player||!['color','team','race'].includes(key))return;
  const value=key==='race'?field.value:Number(field.value);
  if(key==='color'){const other=players.find((candidate,i)=>i!==index&&candidate.color===value);if(other)other.color=player.color;}
  player[key]=value;skirmishDrafts.set(selectedSkirmish,skirmish.normalizePlayers(players,skirmishCapacity()));saveSkirmish();render();
  ui.querySelector(`select[data-player-index="${index}"][data-player-field="${key}"]`)?.focus();return;
 }
 if(setting==='language'){
  field.disabled=true;
  I18n.setLanguage(field.value).catch(error=>{console.warn('Language change',error);render();feedback('Impossible de charger cette langue.');});return;
 }
 if(setting){options[setting]=field.type==='checkbox'?field.checked:field.type==='range'?Number(field.value):field.value;saveOptions();render();reflectOptions();}
 if(field.id==='roomSlots')slots=Number(field.value);
});
ui.addEventListener('input',event=>{if(event.target.id==='roomName')roomName=event.target.value;if(event.target.id==='skirmishPlayerName'){skirmishPlayers()[0].name=event.target.value.slice(0,40);saveSkirmish();}});
document.addEventListener('keydown',event=>{
 if(event.key!=='Escape')return;
 if(ui.hidden){if(gameStarted){event.preventDefault();openPause();}return;}
 event.preventDefault();if(store.current==='main'){if(gameStarted)closeMenu();}else if(store.current==='pause')closeMenu();else store.back();
},true);
store.onChange(()=>{note='';render();});
window.PraetoriansMenu={isOpen:isMenuOpen,openPause,openMain:exitGame,close:closeMenu,launchTutorial:startTutorial,get screen(){return store.current;}};
let catalogLanguageTurn=0;
I18n.onChange(()=>{
 options.language=I18n.language;saveOptions();render();reflectOptions();
 const turn=++catalogLanguageTurn;
 loadCatalog().then(value=>{if(turn===catalogLanguageTurn){catalog=value;if(store.current!=='options')render();}}).catch(error=>console.warn('Localized map catalog',error));
});
const initialCatalogTurn=catalogLanguageTurn;
loadCatalog().then(value=>{if(initialCatalogTurn!==catalogLanguageTurn)return;catalog=value;selectedCampaign=byId(catalog.campaign,selectedCampaign)?.id||'SP_TUTORIAL_1';selectedSkirmish=byId(catalog.multiplayer,selectedSkirmish)?.id||selectedSkirmish;for(const entry of catalog.multiplayer)if(skirmishDrafts.has(entry.id))skirmishDrafts.set(entry.id,skirmish.normalizePlayers(skirmishDrafts.get(entry.id),entry.players));render();}).catch(error=>{console.warn('Menu catalog',error);render();});
render();


{
 const params=new URLSearchParams(location.search),launch=params.get('launch');
 if(launch==='tutorial1'||launch==='mission'){
  const extra={};
  for(const key of ['race','opponents','difficulty'])if(params.has(key))extra[key]=key==='race'?params.get(key):Number(params.get(key));
  for(const key of ['players','opponentRaces'])try{const value=JSON.parse(params.get(key)||'null');if(Array.isArray(value))extra[key]=value;}catch{ /* Ignore malformed old launch links. */ }
  const id=launch==='tutorial1'?'SP_TUTORIAL_1':params.get('mission')||'SP_TUTORIAL_1';
  history.replaceState(null,'',location.pathname);
  startMission(id,extra);
 }
}
