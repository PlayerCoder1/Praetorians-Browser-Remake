/* The game side of the mission scripts: every function the 24 campaign
   scripts call, by its original name (Content/DATA/Varios/Def/FunScript.h),
   built on a `world` the game provides (main.js), the villages and the CPU.

   Notable pieces:
   * Camera orders are queued (EncolaTrayectoriaCamara, EncolarPausaCamara,
     EncolarColocarYMirarPunto, EncolarMirarEnteCamara, IntroducirLocucion)
     in groups closed by IntroducirPuntoSincronia, and played in order by
     EjecutarOrdenesCamara: within a group the camera moves and the voices
     speak side by side. PonerHandleBoolACamara(h) fires h at the end,
     PonerHandleEsperaSincronizacion(h) at every synchronisation point.
   * Mission objectives (AgregarObjetivoMision...) are keyed by their handle.
   * Vigilar*(name, type, h) watch the player's interface actions and fire h.
   * Unknown or decorative functions return neutral values. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansScriptGame=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const val=v=>v&&v.ref?v.value:v;
 const str=v=>{v=val(v);return v==null?'':String(v);};
 const num=v=>{v=val(v);return typeof v==='number'?v:v===true?1:v===false?0:Number(v)||0;};
 const yes=v=>{v=val(v);return !!v&&v!==0&&v!=='';};
 const lower=s=>String(s||'').toLowerCase();
 function create({world,villages,cpu}){
  const W=world;
  // ---- Mission objectives ----------------------------------------------------------
  const objectives=[];
  const objective=h=>objectives.find(o=>o.handle===h);
  const listObjectives=()=>objectives.filter(o=>!o.removed).map(o=>({text:W.text(o.key),state:o.state}));
  const syncObjectives=()=>W.ui.objectives(listObjectives());
  function setObjective(h,state){
   const o=objective(h);if(!o||o.state===state)return;
   o.state=state;syncObjectives();
   if(state!=='open')W.ui.notice((state==='done'?'Objectif accompli : ':'Objectif échoué : ')+W.text(o.key),state);
  }
  // ---- Camera orders and voices ------------------------------------------------------
  let group={camera:[],voices:[]},queue=[],playing=null,syncHandle=null;
  const endHandles=[];
  const flush=()=>{if(group.camera.length||group.voices.length)queue.push(group);group={camera:[],voices:[]};};
  // ---- Interface watchers (tutorials) -----------------------------------------------
  const watchers=[];
  const watch=kind=>(name,type,h)=>{watchers.push({kind,name:str(name)||null,type:str(type)||null,handle:val(h)});};
  function notify(kind,data={}){
   for(let i=watchers.length-1;i>=0;i--){
    const w=watchers[i];if(w.kind!==kind)continue;
    if(w.type&&!(data.types||[]).some(t=>lower(t)===lower(w.type)))continue;
    if(w.name&&!(data.names||[]).some(n=>lower(n)===lower(w.name)))continue;
    if(w.handle)w.handle.fired=true;
    watchers.splice(i,1);
   }
  }
  // ---- Tutorial panel ----------------------------------------------------------------
  const lessons=[];let panel=null;
  // ---- Helpers -----------------------------------------------------------------------------
  const troop=name=>W.troop(str(name));
  const group_=name=>W.group(str(name));
  const civSquads=civ=>W.squads().filter(s=>lower(s.civ)===lower(str(civ)));
  const soldiers=list=>list.reduce((n,s)=>n+(W.alive(s)?s.members.length:0),0);
  const inZone=(s,zone)=>s.members.some(m=>W.inZone(zone,m.x,m.z));
  const civName=name=>W.civ(str(name))?.name||str(name);
  const handleFor=civ=>({type:'Civ',civ:civName(civ)});
  const tips=[];
  const library={
   // ---- Objectives
   AgregarObjetivoMision(h,key){h=val(h);if(!h)return;const o=objective(h);if(o){o.key=str(key);o.removed=false;}else objectives.push({handle:h,key:str(key),state:'open'});syncObjectives();},
   IndicarObjetivoCumplido(h){setObjective(val(h),'done');},
   IndicarObjetivoFracasado(h){setObjective(val(h),'failed');},
   IndicarObjetivoPendiente(h){setObjective(val(h),'open');},
   EliminarObjetivoMision(h){const o=objective(val(h));if(o){o.removed=true;syncObjectives();}},
   ObjetivosMisionCambiados(){W.ui.notice('Objectifs mis à jour');W.ui.openObjectives();},
   FinalizarMision(success){W.end(yes(success),listObjectives());},
   IntroducirTip(text,title){tips.push({text:str(text),title:str(title)});},
   MensajeChat(...args){W.log('chat',args.map(str).join(' '));},
   MensajeLocucionado(sound,key){W.ui.message(W.text(str(key)));if(str(sound))W.sound.speak(str(sound));},
   AvisoCivilizacion(civ,x,z){W.ping(civName(civ),num(x),num(z));},
   // ---- Presentation, cinema, camera
   ActivarPresentacion(on,title,place,h){
    h=val(h);
    if(yes(on)){W.ui.presentation(W.text(str(title)),W.text(str(place)));if(h)W.after(7.5,()=>{h.fired=true;});}
    else W.ui.presentation(null);
   },
   ActivarCinemascope(on){W.ui.cinema(yes(on));},
   PararLogica(on){W.pause(yes(on));},
   PonerHandleInterrupcion(h){W.setInterrupt(val(h));},
   DarPosicionCamara(x,z){const p=W.camera.position();if(x?.ref)x.value=p.x;if(z?.ref)z.value=p.z;},
   MirarAPunto(x,z){W.camera.lookAt(num(x),num(z));},
   IntroducirPonerModoJuegoCamara(on){group.camera.push({gameMode:yes(on)});},
   EncolaTrayectoriaCamara(name,fromCurrent,toGame,tIn,tOut){group.camera.push({route:str(name),blendIn:yes(fromCurrent)?num(tIn):0,blendOut:yes(toGame)?num(tOut):0});},
   EncolarPausaCamara(ms){group.camera.push({pause:num(ms)});},
   EncolarColocarYMirarPunto(name){group.camera.push({point:str(name)});},
   EncolarMirarEnteCamara(name){group.camera.push({entity:str(name)});},
   EncolarTrayectoriaMirarEnteCamara(name,fromCurrent,toGame,tIn,tOut){group.camera.push({entity:str(name),blendIn:yes(fromCurrent)?num(tIn):1});},
   IntroducirLocucion(sound,key,ms){group.voices.push({sound:str(sound),text:str(key),ms:num(ms)});},
   IntroducirPuntoSincronia(){flush();},
   EjecutarOrdenesCamara(){
    flush();const groups=queue;queue=[];
    if(playing)playing.cancel();
    const job=W.camera.run(groups,{
     onSync(){if(syncHandle)syncHandle.fired=true;},
     onEnd(){if(playing===job)playing=null;for(const h of endHandles.splice(0))h.fired=true;}
    });
    playing=job.done?null:job;
    if(job.done)for(const h of endHandles.splice(0))h.fired=true;
   },
   PonerHandleBoolACamara(h){h=val(h);if(!h)return;if(playing)endHandles.push(h);else h.fired=true;},
   PonerHandleEsperaSincronizacion(h){syncHandle=val(h);},
   VaciarOrdenesCamara(){queue=[];group={camera:[],voices:[]};if(playing){playing.cancel();playing=null;}for(const h of endHandles.splice(0))h.fired=true;},
   VaciarLocuciones(){W.sound.silence();W.ui.subtitle('');},
   // ---- Tutorial panel and watchers
   CrearPanelTutorial(skip,next){skip=val(skip);next=val(next);panel={skip,next};lessons.length=0;
    W.ui.tutorial.on(()=>{if(next)next.fired=true;},()=>{if(skip)skip.fired=true;});},
   IntroducirPasoTutorial(text,goal){lessons.push({text:str(text),goal:str(goal)});},
   AvanzarPasoTutorial(n){const i=Math.max(0,Math.min(lessons.length-1,Math.round(num(n))));const l=lessons[i];if(l)W.ui.tutorial.show(i,lessons.length,W.text(l.text),W.text(l.goal));},
   DestruirPanelTutorial(){W.ui.tutorial.hide();panel=null;},
   QuitarVigilanciaHandleBool(h){h=val(h);for(let i=watchers.length-1;i>=0;i--)if(watchers[i].handle===h)watchers.splice(i,1);},
   VigilarInterfazSeleccion:watch('select'),VigilarInterfazCajaSeleccion:watch('boxSelect'),
   VigilarCrearGrupo:watch('groupCreated'),VigilarSeleccionarGrupo:watch('groupSelected'),
   VigilarOrdenCorrer:watch('run'),VigilarOrdenOrientar:watch('face'),VigilarOrdenMoverOrientar:watch('face'),
   VigilarOrdenUnir:watch('merge'),VigilarOrdenHabilidadEspecial:watch('ability'),
   VigilarEntrenamientoAcabado:watch('trained'),VigilarConstruccionAcabada:watch('built'),VigilarConstruccionMaquinaAcabada:watch('machineBuilt'),
   VigilarOrdenConstruirGuarnicion:watch('garrisonOrder'),VigilarOrdenTransformarALigera:watch('degrade'),VigilarOrdenTransformarACenturion:watch('promote'),
   // ---- Sound and weather
   LanzarSonido(code){W.sound.play(str(code));},
   ModificarLluvia(amount,lightning){W.rain(Math.max(0,Math.min(1,num(amount)/100)),num(lightning)/100);},
   LanzarRelampago(){W.lightning();},
   // ---- Visibility
   IluminarZona(x,y,z,r,ms){W.reveal(num(x),num(z),num(r),num(ms));},
   IluminarZonaOnOff(x,y,z,r,name,on){W.revealNamed(str(name),num(x),num(z),num(r),yes(on));},
   HacerVisibleTropa(name,on){const s=troop(name);if(s)W.setVisible(s,yes(on));},
   HacerVisibleGrupoTropas(name,on){for(const s of group_(name))W.setVisible(s,yes(on));},
   HacerVisibleCivilizacion(civ,on){for(const s of civSquads(civ))W.setVisible(s,yes(on));},
   HacerVisibleTropasObjetivo(o,on,...names){o=val(o);const list=names.length?names.map(n=>troop(n)).filter(Boolean):o?cpu.squadsOf(o):[];for(const s of list)W.setVisible(s,yes(on));},
   VisualizarGrupoMiniMapa(name,on){for(const s of group_(name))W.setVisible(s,yes(on));},
   VisibleTropaDeOtraCiv(mine,other){return W.sees(civName(mine),civName(other));},
   // ---- Restrictions
   IntroducirRestriccionUnidad(order,type,civ){W.restrict(str(order),str(type),str(civ),true);},
   QuitarRestriccionUnidad(order,type,civ){W.restrict(str(order),str(type),str(civ),false);},
   IntroducirRestriccionEstructura(order,type,civ){W.restrict(str(order),str(type),str(civ),true);},
   QuitarRestriccionEstructura(order,type,civ){W.restrict(str(order),str(type),str(civ),false);},
   // ---- Civilizations and sides
   DarCivilizacion(name){return handleFor(name);},
   CrearAlianzaPorNombre(a,b){W.setAlliance(civName(a),civName(b),true);},
   RomperAlianzaPorNombre(a,b){W.setAlliance(civName(a),civName(b),false);},
   EstanAliadas(a,b){return W.allied(civName(a),civName(b));},
   NeutralizarCivilizacion(civ,on){W.setNeutral(civName(civ),yes(on));},
   CambiarBandoPorGrupo(name,civ){for(const s of group_(name))if(W.alive(s))W.changeCiv(s,civName(civ));},
   CambiarBando(from,to){for(const s of civSquads(from))if(W.alive(s))W.changeCiv(s,civName(to));},
   CambiarBandoEstructura(name,civ){villages.setOwner(str(name),civName(civ))||W.setStructureOwner(str(name),civName(civ));},
   CambiarBandoFortaleza(name,civ){W.setStructureOwner(str(name),civName(civ));},
   LiberarUnidad(name,type,civ){const s=troop(name);if(s)W.changeCiv(s,civName(civ));},
   ReclutarTropasCerca(name,civ,radius){
    const leader=troop(name);if(!leader||!W.alive(leader))return false;
    const c=W.centroid(leader);let any=false;
    for(const s of civSquads(civ))if(W.alive(s)&&Math.hypot(W.centroid(s).x-c.x,W.centroid(s).z-c.z)<=num(radius)){W.changeCiv(s,leader.civ);any=true;}
    return any;
   },
   CivilizacionEstaKO(civ){return soldiers(civSquads(civ))===0&&!villages.owned(civName(civ)).length;},
   DarPotenciaCivilizacion(civ){return civSquads(civ).reduce((n,s)=>n+(W.alive(s)?s.members.length*(W.power(s.type)||100):0),0);},
   DarDificultadMision(){return W.difficulty;},
   // ---- Troops and groups
   EstaTropaViva(name){const s=troop(name);return !!s&&W.alive(s);},
   EstaEnteVivo(name){const s=troop(name);if(s)return W.alive(s);const st=W.structure(str(name));return !!st&&!st.destroyed;},
   TropaEstaEnCivilizacion(name,civ){const s=troop(name);return !!s&&lower(s.civ)===lower(civName(civ));},
   DarUnidadesVivas(civ){return soldiers(civSquads(civ));},
   DarUnidadesMuertas(civ){return civSquads(civ).reduce((n,s)=>n+(s.fallen||0),0);},
   DarUnidadesMatadas(civ){return W.kills(civName(civ));},
   DarTropasVivasDeGrupo(name){return group_(name).filter(s=>W.alive(s)).length;},
   DarTropasMuertasDeGrupo(name){return group_(name).filter(s=>!W.alive(s)).length;},
   DarTropasVivasGrupoYTipo(name,type){return group_(name).filter(s=>W.alive(s)&&lower(s.type)===lower(str(type))).length;},
   DarVidaGrupo(name){return soldiers(group_(name));},
   TropaRecibeDanyo(name){const s=troop(name);return !!s&&W.damaged(s);},
   GrupoSiendoAtacado(name){return group_(name).some(s=>W.alive(s)&&(W.inCombat(s)||W.damaged(s)));},
   HanEntradoCivilizacionesEnZona(zone,...civs){const names=civs.map(c=>lower(civName(c)));return W.squads().some(s=>W.alive(s)&&names.includes(lower(s.civ))&&inZone(s,str(zone)));},
   HaEntradoCivilizacionPorNombre(zone,mask){return W.squads().some(s=>W.alive(s)&&s.civ===W.humanCiv&&inZone(s,str(zone)));},
   HaEntradoTropaEnZona(zone,name){const s=troop(name);return !!s&&W.alive(s)&&inZone(s,str(zone));},
   DarNumUnidadesEnZona(civ,zone){let n=0;for(const s of civSquads(civ))if(W.alive(s))for(const m of s.members)if(W.inZone(str(zone),m.x,m.z))n++;return n;},
   DarPorcentajeTropasEnZona(civ,zone){const list=civSquads(civ).filter(s=>W.alive(s));const total=soldiers(list);if(!total)return 0;
    let n=0;for(const s of list)for(const m of s.members)if(W.inZone(str(zone),m.x,m.z))n++;return 100*n/total;},
   HayTipoUnidadEnZona(type,zone){return W.squads().some(s=>W.alive(s)&&lower(s.type)===lower(str(type))&&inZone(s,str(zone)));},
   CrearTropa(civ,type,units,x,z,r,name,groupName){return !!W.spawn(civName(civ),str(type),Math.max(1,Math.round(num(units))),num(x),num(z),num(r),str(name)||null,str(groupName)||null);},
   TropaSigueRutaPredefinida(name,route){const s=troop(name);if(s)W.followRoute(s,str(route));},
   GrupoTropasSeguirRutaPredefinida(name,route){for(const s of group_(name))if(W.alive(s))W.followRoute(s,str(route));},
   OrdenarTropaMantenerPosicion(name,on){const s=troop(name);if(s)W.hold(s,yes(on));},
   CivilizacionSetMantenerPosicion(civ,on){for(const s of civSquads(civ))W.hold(s,yes(on));},
   SetActitudAgresiva(name,on){const s=troop(name);if(s)W.setAggressive(s,yes(on));},
   SetActitudAgresivaGrupo(name,on){for(const s of group_(name))W.setAggressive(s,yes(on));},
   SetMoverFisicoTropa(){},SetMoverFisicoGrupoTropas(){},
   InteractuarTropaConEnte(name,target){
    const s=troop(name);if(!s||!W.alive(s))return;
    const t=troop(target);if(t&&W.alive(t)&&W.isHostile(s.civ,t.civ)){W.attack(s,t);return;}
    // A watchtower: the troop goes in.
    if(!t&&W.enterStructure?.(s,str(target)))return;
    const place=villages.find(str(target))||W.structure(str(target))||(t&&W.centroid(t));
    if(place)W.moveTo(s,place.x,place.z,false);
   },
   AtacarEnte(attacker,target){
    const list=troop(attacker)?[troop(attacker)]:group_(attacker);
    const t=troop(target);const place=t?null:(villages.find(str(target))||W.structure(str(target)));
    for(const s of list){if(!W.alive(s))continue;if(t)W.attack(s,t);else if(place)W.moveTo(s,place.x,place.z,true);}
   },
   TodosAlAtaque(civ){cpu.attackAll(civName(civ));},
   PonerVidaEnte(name,life){W.setLife(str(name),num(life));},
   PonerFuegoEnte(name,fire){W.setFire(str(name),num(fire));},
   HayAlgunaEstructuraIncendiandose(type){return !!W.burning?.(str(type));},
   QuitarEfectosHabilidades(){},SetHabilidadAutomatica(){},DarExpCiv(){},DarExpCenturion(){},DarPHCiv(civ,points){W.honour(civName(civ),num(points));},
   MaxTropasCiv(){},AnyadirGrupoTropasACivilizacion(name,civ){for(const s of group_(name))W.changeCiv(s,civName(civ));return true;},
   PonerSecuenciaEnte(){},PonerGeometriaEnte(){},ActivarInferioridad(){},EstaCivilizacionCurada(){return true;},
   // ---- Villages and structures
   EstaPuebloConquistado(civ,name){const v=villages.find(str(name));return !!v&&lower(v.owner)===lower(civName(civ));},
   DarNumPueblosConqDestr(civ,...names){const c=civName(civ);return names.filter(n=>villages.find(str(n))?.owner===c).length;},
   EstructuraDestruida(name){return !!W.structure(str(name))?.destroyed;},
   EsEstructuraAtacada(name){return !!W.structure(str(name))?.attacked;},
   // Optional civilization: built by that civilization.
   EstaPuenteConstruido(name,civ){const st=W.structure(str(name));return !!st?.built&&(civ==null||!st.builtBy||lower(st.builtBy)===lower(civName(civ)));},
   EstaConstruyendoPuente(civ){return !!W.buildingBridge?.(civ==null?null:civName(civ));},
   ConstruirGuarnicion(name,village){const s=troop(name),v=villages.find(str(village));if(s&&v)W.buildGarrison?.(s,v);},
   // ---- CPU strategies and objectives
   CrearEstrategiaScript(){return cpu.strategy('script');},
   CrearEstrategiaEscaramuza(){return cpu.strategy('skirmish');},
   AsignarEstrategia(civ,s){civ=val(civ);return cpu.assign(civ?.civ||str(civ),val(s));},
   StartEstrategia(s){cpu.start(val(s));},
   SetValue(s,name,...values){s=val(s);if(s)s.params[str(name)]=values.map(val);},
   SetParamEstrategia(s,name,...values){s=val(s);if(s)s.params[str(name)]=values.map(val);},
   CrearObjetivo(s,kind,...args){return cpu.objective(val(s),str(kind),args.map(val));},
   CrearTactica(s,kind,...args){return cpu.objective(val(s),str(kind),args.map(val));},
   AnyadirObjetivo(s,o){return cpu.addObjective(val(s),val(o));},
   AnyadirTactica(s,o){return cpu.addObjective(val(s),val(o));},
   AnyadirGrupoAObjetivo(o,...names){o=val(o);if(!o)return false;for(const n of names)o.groups.add(str(n));return true;},
   AnyadirGrupoATactica(o,...names){o=val(o);if(!o)return false;for(const n of names)o.groups.add(str(n));return true;},
   AnyadirTropaAObjetivo(o,...names){o=val(o);if(!o)return false;for(const n of names)o.troops.add(str(n));return true;},
   AnyadirTropasCivilizacionAObjetivo(o,...civs){o=val(o);if(!o)return false;for(const c of civs)o.civs.add(civName(c));return true;},
   SetParamObjetivo(o,name,...values){
    o=val(o);if(!o)return;values=values.map(val);name=str(name);
    if(name==='ParametrosTacticas'){o.params.ParametrosTacticas??={};o.params.ParametrosTacticas[str(values[0])]=values[1];}
    else o.params[name]=values.length>1?values:values[0];
   },
   SetParamTactica(o,name,...values){o=val(o);if(o)o.params[str(name)]=values.length>1?values.map(val):val(values[0]);},
   CambiarObjetivo(o,kind,...args){cpu.change(val(o),str(kind),args.map(val));},
   ProhibirObjetivo(s,kind,on){s=val(s);if(s)for(const o of s.objectives)if(o.kind===str(kind))o.forbidden=yes(on);return true;},
   DarObjetivo2CPU(o,on){o=val(o);if(o)o.active=yes(on);},
   ObjetivoGetParamBOOL(o,name){o=val(o);if(!o)return false;name=str(name);return name in o.params?yes(o.params[name]):name==='Terminado'||name==='Cumplido'?o.done:false;},
   ObjetivoGetParamFLOAT(o,name){o=val(o);return o?num(o.params[str(name)]):0;},
   ObjetivoGetParamHANDLE(o,name){o=val(o);if(!o)return null;name=str(name);return name==='MiEstrategia'?o.strategy:o.params[name]??null;},
   SetDelayEntrenamientoTropasPueblo(s,name,ms){s=val(s);if(s)s.delays.set(str(name),num(ms));},
   SetDelayEntrenamientoTropasPueblo_DOS(s,name,ms){s=val(s);if(s)s.delays.set(str(name),num(ms));},
   SetEntrenamientoPueblo(s,name,on){s=val(s);if(s)s.training.set(str(name),yes(on));},
   ResetGruposTropasAEntrenar(){},
   EjecutarPlanificador(s,on){s=val(s);if(s&&yes(on)&&!s.planner){s.kind='skirmish';cpu.assign(s.civ,s);}},
   HuirAPuebloAliadoMasCercano(o,x,z){
    o=val(o);if(!o)return null;
    const civ=o.strategy?.civ,list=cpu.squadsOf(o);if(!list.length)return null;
    const c=W.centroid(list[0]);
    const refuge=villages.owned(civ).sort((a,b)=>Math.hypot(a.x-c.x,a.z-c.z)-Math.hypot(b.x-c.x,b.z-c.z))[0];
    cpu.change(o,'Retirada',refuge?[refuge.x,refuge.z]:[num(x),num(z)]);
    return o;
   }
  };
  return {library,notify,objectives,listObjectives,tips,watchers,get playing(){return playing;}};
 }
 return {create};
});
