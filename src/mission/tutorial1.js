/* Tutorial 1 "Al Sur de los Alpes" (SP_TUTORIAL_1.trg, JuanD, April 2002),
   ported trigger by trigger. Each original Trigger keeps its name, its
   condition and its actions; the lesson counter (fcontador), the nextstep /
   accion handles and the "shown, not skipped" flag (mostrarTrayectoria)
   behave as in the original. The game object supplies world queries, orders
   and the interface (see main.js, missionApi). */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansTutorial1=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const LESSONS=19;
 const EXIT_TROOPS=['GAL_INFL_2','GAL_INFL_3','GAL_INFL_4','GAL_ARQ_2'];
 function create(game){
  const T=key=>game.text(key),ui=game.ui;
  const state={fcontador:0,mostrarTrayectoria:false,llegadaSalida:false,enemigoDestruido:false,
   nextstep:false,accion:false,skiptutorial:false,ended:false};
  // ---- Mission objectives (AgregarObjetivoMision etc.) ------------------------
  const objectives=new Map();
  const sync=()=>ui.objectives.set([...objectives.values()]);
  function addObjective(id,key){objectives.set(id,{text:T(key),state:'open'});sync();}
  function setObjective(id,result){
   const o=objectives.get(id);if(!o||o.state!=='open')return;
   o.state=result;sync();
   ui.objectives.notice((result==='done'?'Objectif accompli : ':'Objectif échoué : ')+o.text,result);
  }
  // ---- Triggers: active flag, condition, actions; one run at a time -----------
  const triggers=new Map();
  function trigger(name,active,when,run){triggers.set(name,{name,active,when,run,busy:false});}
  const activate=name=>{const t=triggers.get(name);if(t)t.active=true;};
  const deactivate=name=>{const t=triggers.get(name);if(t)t.active=false;};
  const destroy=name=>triggers.delete(name);
  // ---- Watched player actions (Vigilar*): one at a time, raising accion -------
  let watcher=null;
  function watch(kind,filter={}){watcher={kind,filter};}
  function unwatch(){watcher=null;}           // QuitarVigilanciaHandleBool(accion)
  function onAction(kind,data={}){
   if(!watcher||watcher.kind!==kind)return;
   if(watcher.filter.type&&!data.types?.includes(watcher.filter.type))return;
   watcher=null;state.accion=true;
  }
  const lesson=index=>{
   const id=String(index).padStart(2,'0');
   ui.tutorial.show(index,LESSONS,T(`LTEXT_TUTORIAL1_LECCION_${id}_TXT`),T(`LTEXT_TUTORIAL1_LECCION_${id}_OBJ`));
  };
  const allDead=names=>names.every(name=>!game.alive(name));
  // Camera flights: the route flies in from the game camera, holds, and the
  // last step returns to it (IntroducirPonerModoJuegoCamara).
  async function flight(steps,reveal){
   if(reveal)game.reveal(...reveal);
   const from=game.camera.position();
   game.armEscape();game.cinema(true);
   const result=await game.cinematic(steps);
   if(result.skipped)game.camera.lookAt(from.x,from.z);
   game.cinema(false);
   return result;
  }

  //////////////////////////////////////////////////////////
  // Main: presentation
  trigger('Main',true,()=>true,async()=>{destroy('Main');activate('Presentacion');});
  trigger('Presentacion',false,()=>true,async()=>{
   destroy('Presentacion');
   game.armEscape();game.cinema(true);
   ui.presentation(T('LTEXT_TUTORIAL1_PRESENTACION_TITULO'),T('LTEXT_TUTORIAL1_PRESENTACION_LUGAR'));
   await game.waitOrEscape(9000);
   ui.presentation.hide();game.cinema(false);
   activate('Main2');
  });
  //////////////////////////////////////////////////////////
  // Main2: mission set-up
  trigger('Main2',false,()=>true,async()=>{
   destroy('Main2');
   addObjective('reunirse','LTEXT_TUTORIAL1_OBJETIVO_00_TXT');
   addObjective('mataMata','LTEXT_TUTORIAL1_OBJETIVO_01_TXT');
   // Scenario restrictions; some are lifted during the tutorial.
   for(const order of ['ORDEN_CONSTRUIR','ORDEN_REPARAR','ORDEN_TRANSFORMAR_A_LIGERA','ORDEN_TRANSFORMAR_A_CENTURION',
    'ORDEN_ROMPER_TROPA','ORDEN_DISTRIBUIR_TROPAS','ORDEN_UNIR_TROPAS'])game.restrict(order,true);
   for(const name of ['Explorador','AtaqueSalida','LlegadaSalida','EnemigoDestruido','CazaFinal','TirarPaAlante','InicioTutorial','Skip'])activate(name);
   game.rain(0);
   game.setAggressive('GRUPO_ARRIBA',false);
   game.setAggressive('GRUPO_SALIDA',false);
  });
  //////////////////////////////////////////////////////////
  // Tutorial panel
  trigger('InicioTutorial',false,()=>true,async()=>{
   destroy('InicioTutorial');
   state.fcontador=0;
   await game.wait(2000);
   ui.tutorial.on(()=>{state.nextstep=true;},()=>{state.skiptutorial=true;});
   lesson(state.fcontador);
   watch('select',{type:'INFANTERIA_LIGERA'});
   activate('Accion');activate('Next');
  });
  // Next lesson: each time nextstep is raised.
  trigger('Next',false,()=>state.nextstep,async()=>{
   state.fcontador++;lesson(state.fcontador);
   state.nextstep=false;unwatch();
   if(state.mostrarTrayectoria)game.chime();
   const f=state.fcontador;
   if(f===1){watch('select',{type:'PIQUERO'});activate('Accion');}
   else if(f===2){watch('select',{type:'ARQUERO'});activate('Accion');}
   else if(f===3){watch('boxSelect');activate('Accion');}
   else if(f===4){watch('groupCreated');activate('Accion');}
   else if(f===5){watch('groupSelected');activate('Accion');}
   else if(f===6){watch('select');activate('Accion');}
   else if(f===7){activate('MoverARampa');}
   else if(f===8){deactivate('MoverARampa');destroy('MoverARampa');watch('run');activate('Accion');}
   else if(f===9){watch('face');activate('Accion');}
   else if(f===10){game.rain(.5);activate('Vado');}                       // rain in the valley
   else if(f===11){deactivate('Vado');destroy('Vado');game.rain(0);activate('CruzarVado');}
   else if(f===12){
    deactivate('CruzarVado');destroy('CruzarVado');
    if(state.mostrarTrayectoria&&game.alive('GAL_INFL_1'))
     await flight([{route:'PUENTE',blendIn:2},{pause:3000},{route:'PUENTE',blendOut:1}],[62,70,5,10000]);
    activate('AsegurarPuente');
   }
   else if(f===13){
    game.restrict('ORDEN_UNIR_TROPAS',false);
    deactivate('AsegurarPuente');destroy('AsegurarPuente');
    watch('merge');activate('Accion');
   }
   else if(f===14){
    game.restrict('ORDEN_DISTRIBUIR_TROPAS',false);game.restrict('ORDEN_ROMPER_TROPA',false);
    activate('Bosque');
   }
   else if(f===15){
    if(state.mostrarTrayectoria)
     await flight([{route:'BOSQUE_DENSO_1',blendIn:2},{pause:3000},{route:'BOSQUE_DENSO_2',blendOut:1}],[40,14,10,10000]);
    deactivate('Bosque');destroy('Bosque');
    activate('Emboscada');
   }
   else if(f===16){
    deactivate('Emboscada');destroy('Emboscada');
    if(state.mostrarTrayectoria)await flight([{route:'ARRIBA',blendIn:2},{pause:3000},{route:'ARRIBA',blendOut:1}]);
    activate('ExplorarAlturas');
   }
   else if(f===17){deactivate('ExplorarAlturas');destroy('ExplorarAlturas');activate('AsegurarSalida');}
   else{deactivate('AsegurarSalida');destroy('AsegurarSalida');}
   // Skipped lessons do not replay their camera flights later.
   state.mostrarTrayectoria=false;
  });
  // A watched action was performed.
  trigger('Accion',false,()=>state.accion,async()=>{
   deactivate('Accion');state.mostrarTrayectoria=true;state.accion=false;state.nextstep=true;
  });
  const lessonDone=name=>{deactivate(name);state.mostrarTrayectoria=true;state.nextstep=true;};
  trigger('MoverARampa',false,()=>game.civInZone('Romanos','RAMPA'),()=>lessonDone('MoverARampa'));
  trigger('Vado',false,()=>game.civInZone('Romanos','VADO'),()=>lessonDone('Vado'));
  trigger('CruzarVado',false,()=>game.troopInZone('EXPLORADOR','VADO_2'),()=>lessonDone('CruzarVado'));
  trigger('AsegurarPuente',false,()=>!game.alive('GAL_INFL_1'),()=>lessonDone('AsegurarPuente'));
  trigger('Bosque',false,()=>game.civInZone('Romanos','BOSQUE'),()=>{deactivate('TirarPaAlante');lessonDone('Bosque');});
  trigger('Emboscada',false,()=>!game.alive('GAL_ARQ_1'),async()=>{
   const pasoActual=state.fcontador;deactivate('Emboscada');
   await game.wait(3000);
   if(pasoActual===state.fcontador){state.mostrarTrayectoria=true;state.nextstep=true;}
  });
  trigger('ExplorarAlturas',false,()=>game.hawkInZone('ARRIBA'),()=>lessonDone('ExplorarAlturas'));
  trigger('AsegurarSalida',false,()=>allDead(EXIT_TROOPS),()=>lessonDone('AsegurarSalida'));
  //////////////////////////////////////////////////////////
  // The guide: the army reaches the ford, he introduces himself and joins.
  trigger('Explorador',false,()=>game.civInZone('Romanos','VADO'),async()=>{
   deactivate('Explorador');destroy('Explorador');
   setObjective('reunirse','done');
   await game.wait(1000);
   game.pause(true);
   await flight([
    {route:'EXPLORADOR',blendIn:1,voices:[
     {sound:'0110',text:'LTEXT_TUTORIAL1_EVENTO1_00_TXT',ms:2000},{ms:100},
     {sound:'0111',text:'LTEXT_TUTORIAL1_EVENTO1_01_TXT',ms:6000}]},
    {route:'EXPLORADOR_2'}]);
   game.pause(false);
   game.joinPlayer('EXPLORADOR');
   addObjective('exploradorVivo','LTEXT_TUTORIAL1_OBJETIVO_02_TXT');
   addObjective('llegadaSalida','LTEXT_TUTORIAL1_OBJETIVO_03_TXT');
   ui.objectives.notice('Nouveaux objectifs');ui.objectives.open();
  });
  // The Gauls at the exit counter-attack when any of them is hurt.
  trigger('AtaqueSalida',false,()=>EXIT_TROOPS.some(name=>game.damaged(name)),async()=>{
   game.setAggressive('GRUPO_ARRIBA',true);game.setAggressive('GRUPO_SALIDA',true);
   game.followRoute('GRUPO_SALIDA','SALIDA');
   deactivate('AtaqueSalida');destroy('AtaqueSalida');
  });
  // Rushing ahead past the bridge jumps the tutorial to the forest lesson.
  trigger('TirarPaAlante',false,()=>state.fcontador!==14&&game.civInZone('Romanos','BOSQUE'),async()=>{
   state.fcontador=14;
   for(const name of ['TirarPaAlante','MoverARampa','Vado','CruzarVado'])deactivate(name);
   for(const order of ['ORDEN_ROMPER_TROPA','ORDEN_DISTRIBUIR_TROPAS','ORDEN_UNIR_TROPAS'])game.restrict(order,false);
   state.mostrarTrayectoria=true;state.nextstep=true;
  });
  // Closing the tutorial panel ends the lessons; the mission goes on.
  trigger('Skip',false,()=>state.skiptutorial,async()=>{
   for(const name of ['Next','Skip','Accion','MoverARampa','Vado','AsegurarPuente','Bosque','Emboscada','ExplorarAlturas','AsegurarSalida']){deactivate(name);destroy(name);}
   unwatch();ui.tutorial.hide();
   for(const order of ['ORDEN_ROMPER_TROPA','ORDEN_DISTRIBUIR_TROPAS','ORDEN_UNIR_TROPAS'])game.restrict(order,false);
  });
  //////////////////////////////////////////////////////////
  // Victory and defeat
  trigger('CondicionesDeVictoria',true,
   ()=>!game.alive('EXPLORADOR')||(game.soldiers('Galos')===0&&state.llegadaSalida)||game.soldiers('Romanos')<=1,
   async()=>{
    deactivate('CondicionesDeVictoria');destroy('CondicionesDeVictoria');
    let victory=false;
    if(game.soldiers('Romanos')<=1&&!state.llegadaSalida&&game.alive('EXPLORADOR')){
     setObjective('llegadaSalida','failed');setObjective('mataMata','failed');
    }else if(game.alive('EXPLORADOR')){
     setObjective('exploradorVivo','done');setObjective('mataMata','done');victory=true;
    }else setObjective('exploradorVivo','failed');
    state.ended=true;
    await game.wait(2500);
    game.end(victory,[...objectives.values()]);
   });
  trigger('LlegadaSalida',false,()=>game.troopInZone('EXPLORADOR','SALIDA'),async()=>{
   setObjective('llegadaSalida','done');state.llegadaSalida=true;
   deactivate('LlegadaSalida');destroy('LlegadaSalida');
  });
  trigger('EnemigoDestruido',false,()=>game.soldiers('Galos')===0,async()=>{
   setObjective('mataMata','done');state.enemigoDestruido=true;
   deactivate('EnemigoDestruido');destroy('EnemigoDestruido');
  });
  // Final hunt: once the exit guard has fallen, every Gaul hunts the army.
  trigger('CazaFinal',false,()=>game.groupAlive('GRUPO_SALIDA')===0,async()=>{
   game.hunt('TODOS');game.revealGroup('TODOS');destroy('CazaFinal');
  });

  function update(){
   if(state.ended&&!triggers.size)return;
   for(const t of [...triggers.values()]){
    if(!t.active||t.busy)continue;
    let fire=false;try{fire=!!t.when();}catch(error){console.warn('trigger condition',t.name,error);}
    if(!fire)continue;
    t.busy=true;
    Promise.resolve().then(t.run).catch(error=>console.error('trigger',t.name,error)).finally(()=>{t.busy=false;});
   }
  }
  return {update,onAction,state,triggers,get lesson(){return state.fcontador;}};
 }
 return {create,LESSONS};
});
