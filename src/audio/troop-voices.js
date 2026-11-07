/* The troops' spoken answers and the announcer's messages, as in the game.

   Answers (SonidosACKTropas*.dat, FLAG_ACK): a troop answers when it is
   selected or given an order, in its race's voice. The line is named
   I + race (R Romans, G Gauls, E Egyptians) + troop class + situation:
     classes     Z centurion, I medic, E scout, P heavy infantry, L light
                 infantry, A archers, Q pikemen, C heavy cavalry, K horse
                 archers, T catapult, B ballista, W ram, Y siege tower,
                 X ladder (the troop's DefUnidades BASE decides);
     situations  S selected, M move, R run, A attack, T attack at a run,
                 G any other order, N cannot go there; U cannot do that and
                 B cannot build there (these two are filed under class T).
   Each line has a few takes, one picked at random. The first troop of the
   selection answers for it; a new answer cuts the last one short, and the
   same answer is not repeated within a moment (a double click).

   Messages (SonidosInterfaz.dat IAxx): the announcer says a troop, the hero
   or a village is under attack, or that training or a building is
   finished - each at most every 20 seconds.

   Both can be switched off in the menu (OPTIONS, SON). */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansTroopVoices=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const RACE={ROMANOS:'R',BARBAROS:'G',EGIPCIOS:'E'};
 const CLASS={CENTURION:'Z',CENTURION_A_PIE:'Z',MEDICO:'I',EXPLORADOR:'E',MENSAJERO:'E',
  INFANTERIA_PESADA:'P',GLADIADOR:'P',GALO_ESPADON:'P',INFANTERIA_LIGERA:'L',
  ARQUERO:'A',HONDERO:'A',CAZADOR:'A',PIQUERO:'Q',PIQUERO_ELITE:'Q',
  CABALLERIA_PESADA:'C',CABALLERIA_GERMANA:'C',CUADRIGA:'C',CARRO:'C',CABALLERIA_ARQUERA:'K',CABALLERIA_PARTHA:'K',
  CATAPULTA:'T',BALLESTA_MOVIL:'B',ARIETE:'W',TORRE_ASALTO:'Y',ESCALA:'X'};
 const MESSAGES={troop:'IAMT',hero:'IAMH',village:'IAMP',trained:'IAME',built:'IAMC'};
 const MESSAGE_GAP=20,REPEAT_GAP=.35;
 // sound: () => the sound bank (it loads once the game has started).
 function create({sound,units,clock=()=>performance.now()/1000}){
  let answers=true,messages=true,last=null;const said=new Map();
  // The line a troop says in a situation, if its race and class have one.
  function line(squad,situation){
   const unit=units[squad?.type],race=RACE[unit?.race],kind=CLASS[unit?.base],defs=sound()?.defs;
   if(!race||!kind||!defs)return null;
   // A class without its own line answers as light infantry.
   const names=situation==='U'||situation==='B'?[`I${race}T${situation}`]:[`I${race}${kind}${situation}`,`I${race}L${situation}`];
   return names.find(name=>defs[name]&&(!sound()?.has||sound().has(name)))||null;
  }
  // squads: the troops given the order (the first with a voice answers).
  function answer(squads,situation){
   if(!answers)return null;
   for(const squad of [squads].flat()){
    const name=line(squad,situation);if(!name)continue;
    const now=clock();if(last?.name===name&&now-last.at<REPEAT_GAP)return null;
    last={name,at:now};
    sound()?.say(name,'answer',{x:squad.x,z:squad.z});
    return name;
   }
   return null;
  }
  // Load the lines of these troops and the announcer's ahead, so the first
  // answer is not held up by its file.
  function preload(squads){
   const bank=sound();if(!bank?.preload)return;
   const names=new Set(Object.values(MESSAGES));
   for(const squad of squads)for(const situation of 'SMRATGNUB'){const name=line(squad,situation);if(name)names.add(name);}
   bank.preload([...names]);
  }
  function message(kind){
   const name=MESSAGES[kind];if(!messages||!name||!sound()||(sound().has&&!sound().has(name)))return null;
   const now=clock();if(now-(said.get(kind)??-Infinity)<MESSAGE_GAP)return null;
   said.set(kind,now);sound().say(name,'message');
   return name;
  }
  return {answer,message,line,preload,
   setEnabled({answers:a=answers,messages:m=messages}={}){
    answers=!!a;messages=!!m;
    if(!answers)sound()?.stopChannel?.('answer');
    if(!messages)sound()?.stopChannel?.('message');
   },
   get enabled(){return {answers,messages};}};
 }
 return {create,RACE,CLASS,MESSAGES};
});
