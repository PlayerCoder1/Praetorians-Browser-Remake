/* The CPU's armies.

   Mission scripts give a civilization a scripted strategy
   (CrearEstrategiaScript / AsignarEstrategia / StartEstrategia) and
   objectives (CrearObjetivo) for named troop groups (PROPIEDADES "GRUPO X"):
   defend a position, attack a point, conquer a village, send periodic waves,
   hunt, follow a route... Villages the strategy owns can train troops at a
   scripted delay (SetDelayEntrenamientoTropasPueblo); trained troops join the
   objective's generated group (NombreGrupoGenerado).

   Skirmish opponents (and CrearEstrategiaEscaramuza) get a planner instead:
   take the nearest villages, train troops there, attack once strong enough.

   The original planner's code is not in the data files; these behaviours
   follow the objective names, their parameters and the CPU attitude file
   (ActitudCPU/Skirmish.dat), as approximations. */
(function(root,factory){
 const concealment=typeof module==='object'&&module.exports?require('../world/troop-concealment.js'):root.PraetoriansTroopConcealment;
 const api=factory(concealment);if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansCpu=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(Concealment){
 'use strict';
 const THINK=.5,HOLD_RADIUS=14,HOME_SLACK=4;
 const num=v=>typeof v==='number'?v:v===true?1:v===false?0:Number(v)||0;
 const lower=s=>String(s||'').toLowerCase();
 const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
 // Training preferences (ActitudCPU/Skirmish.dat GRUPO_TROPAS_ENTRENAR).
 const PREFERENCE={INFANTERIA_PESADA:35,ARQUERO:25,PIQUERO:5,CABALLERIA_PESADA:6,CABALLERIA_ARQUERA:4,INFANTERIA_LIGERA:12,CATAPULTA:3,BALLESTA_MOVIL:2};
 // Development bonuses change work/training time, never soldiers' health or
 // damage. The planner itself supplies the increasing tactical challenge.
 const PROFILES=Object.freeze([
  null,
  Object.freeze({id:1,name:'Easy',planInterval:6,reactionInterval:3,trainingRate:.65,buildRate:.75,trainEvery:12,expandAfter:9,expansions:1,escort:1,attackAfter:Infinity,waveEvery:Infinity,minAttack:99,maxAttack:0,reserve:.8,rallyTime:0,operationTime:0,memory:8,defendRadius:18,retreatAt:0,adaptive:false}),
  Object.freeze({id:2,name:'Medium',planInterval:3,reactionInterval:1.25,trainingRate:1,buildRate:1,trainEvery:3,expandAfter:0,expansions:1,escort:1,attackAfter:80,waveEvery:70,minAttack:3,maxAttack:3,reserve:.5,rallyTime:0,operationTime:65,memory:15,defendRadius:23,retreatAt:.18,adaptive:false}),
  Object.freeze({id:3,name:'Hard',planInterval:2,reactionInterval:.6,trainingRate:1.35,buildRate:1.2,trainEvery:2,expandAfter:0,expansions:2,escort:2,attackAfter:55,waveEvery:48,minAttack:4,maxAttack:12,reserve:.3,rallyTime:12,operationTime:90,memory:35,defendRadius:28,retreatAt:.33,adaptive:true}),
  Object.freeze({id:4,name:'Master',planInterval:1.5,reactionInterval:.35,trainingRate:1.75,buildRate:1.5,trainEvery:1.5,expandAfter:0,expansions:2,escort:2,attackAfter:35,waveEvery:26,minAttack:4,maxAttack:24,reserve:.18,rallyTime:8,operationTime:70,memory:45,defendRadius:32,retreatAt:.45,adaptive:true})
 ]);
 function profile(level){
  const named={easy:1,facile:1,medium:2,normal:2,hard:3,difficile:3,master:4,maitre:4};
  const n=typeof level==='string'?(named[lower(level)]??Number(level)):Number(level);
  return PROFILES[n>=1&&n<=4?Math.round(n):2];
 }
 function create({world,villages,units,races,random=Math.random}){
  let nextId=1;
  // Main calls beginFrame once before fixed-step catch-up. Standalone users
  // get the same bound per update without having to know about render frames.
  let routeBudget=3,managedFrames=false;
  const strategies=[],objectives=[];
  const squadsOf=o=>{
   const set=new Set();
   for(const g of o.groups)for(const s of world.group(g))set.add(s);
   for(const t of o.troops){const s=world.troop(t);if(s)set.add(s);}
   for(const c of o.civs)for(const s of world.squads())if(s.civ===c)set.add(s);
   return [...set].filter(s=>world.alive(s)&&s.civ===o.strategy.civ);
  };
  // ---- Scripted strategies ---------------------------------------------------
  function strategy(kind='script'){
   const s={id:nextId++,kind,civ:null,objectives:[],params:{},delays:new Map(),training:new Map(),timers:new Map(),started:false,planner:null};
   strategies.push(s);return s;
  }
  function assign(civ,s){if(s&&civ){s.civ=civ;if(s.kind==='skirmish')s.planner=planner(s);}return !!(s&&civ);}
  function objective(s,kind,args){
   const o={id:nextId++,kind:String(kind),args,strategy:s,groups:new Set(),troops:new Set(),civs:new Set(),params:{},active:false,
    done:false,timer:0,waves:0,anchor:null,started:false};
   objectives.push(o);return o;
  }
  function addObjective(s,o){if(s&&o){o.strategy=s;o.active=true;if(!s.objectives.includes(o))s.objectives.push(o);}return !!(s&&o);}
  function change(o,kind,args){if(!o)return;o.kind=String(kind);o.args=args;o.anchor=null;o.started=false;o.done=false;o.timer=0;o.waves=0;}
  // ---- Behaviours ----------------------------------------------------------------
  const HIDDEN_SIGHT=6;
  const hostileNear=(s,point,radius)=>{
   let best=null,bestD=radius;
   const here=world.centroid(s);
   for(const o of world.squads()){
    if(!world.alive(o)||!world.isHostile(s.civ,o.civ))continue;
    const c=world.centroid(o),d=dist(c,point);
    // Troops lying hidden in tall grass are found only by stumbling on them.
    if(Concealment.isHidden(o)&&dist(c,here)>HIDDEN_SIGHT)continue;
    if(d<bestD){bestD=d;best=o;}
   }
   return best;
  };
  const nearestHostile=s=>hostileNear(s,world.centroid(s),Infinity);
  function engageOrReturn(s,anchor,radius){
   if(world.inCombat(s))return;
   const foe=hostileNear(s,anchor,radius);
   if(foe){world.attack(s,foe);return;}
   const c=world.centroid(s);
   if(dist(c,anchor)>HOME_SLACK&&!world.isMoving(s))world.moveTo(s,anchor.x,anchor.z,false);
  }
  function home(s){if(!s._home){const c=world.centroid(s);s._home={x:c.x,z:c.z};}return s._home;}
  function pointOf(o){
   if(o.anchor)return o.anchor;
   const [a,b]=o.args;
   if(typeof a==='number'&&typeof b==='number')return o.anchor={x:a,z:b};
   const named=typeof a==='string'?(villages.find(a)||world.structure(a)||world.zone(a)):null;
   if(named)return o.anchor={x:named.x??named.center?.[0],z:named.z??named.center?.[1]};
   return null;
  }
  const running=o=>!!(o.params.ParametrosTacticas?.AtacarCorriendo||o.params.AtacarCorriendo);
  function wave(o,list){
   for(const s of list){if(!world.inCombat(s))world.setHunting(s,true);}
   o.waves++;
  }
  const BEHAVIOURS={
   DefenderPosicion(o,list){
    const point=pointOf(o);
    for(const s of list)engageOrReturn(s,point||home(s),HOLD_RADIUS);
   },
   DefensaSemiCoordinada(o,list){for(const s of list)engageOrReturn(s,home(s),HOLD_RADIUS+4);},
   MantenerPosicion(o,list){for(const s of list)engageOrReturn(s,home(s),HOLD_RADIUS);},
   DefensaFortaleza(o,list){for(const s of list)engageOrReturn(s,home(s),HOLD_RADIUS);},
   AtacarPunto(o,list){
    const point=pointOf(o);if(!point)return BEHAVIOURS.CazaYCaptura(o,list);
    for(const s of list){
     if(world.inCombat(s))continue;
     const foe=hostileNear(s,world.centroid(s),12);
     if(foe){world.attack(s,foe);continue;}
     if(dist(world.centroid(s),point)>HOME_SLACK+2){if(!world.isMoving(s))world.moveTo(s,point.x,point.z,running(o));}
     else engageOrReturn(s,point,HOLD_RADIUS);
    }
   },
   ConquistaPueblo2(o,list){
    const v=villages.find(o.args[0]);if(!v)return BEHAVIOURS.CazaYCaptura(o,list);
    const point={x:v.x,z:v.z};
    if(v.owner===o.strategy.civ){o.done=true;for(const s of list)engageOrReturn(s,point,HOLD_RADIUS+2);return;}
    seize(v,list,o.strategy.civ,running(o));
   },
   AsaltarCampamento(o,list){
    if(villages.find(o.args[0]))return BEHAVIOURS.ConquistaPueblo2(o,list);
    return pointOf(o)?BEHAVIOURS.AtacarPunto(o,list):BEHAVIOURS.CazaYCaptura(o,list);
   },
   PatrullaOleadasPeriodicas(o,list,dt){
    // Waves at random intervals between the two delays (ms).
    const min=num(o.args[0])||10000,max=Math.max(min,num(o.args[1])||min),limit=num(o.params.MaxNumOleadas??-1);
    if(!o.started){o.started=true;o.timer=(min+random()*(max-min))/1000;}
    for(const s of list)if(!s.combat?.hunt)engageOrReturn(s,home(s),HOLD_RADIUS);
    o.timer-=dt;
    if(o.timer<=0&&(limit<0||o.waves<limit)){o.timer=(min+random()*(max-min))/1000;wave(o,list.filter(s=>!world.inCombat(s)));}
   },
   AtaqueOleadasPeriodicas(o,list,dt){return BEHAVIOURS.PatrullaOleadasPeriodicas(o,list,dt);},
   OleadasFortaleza(o,list){wave(o,list.filter(s=>!world.inCombat(s)&&!s.combat?.hunt));},
   CazaYCaptura(o,list){for(const s of list)if(!s.combat?.hunt)world.setHunting(s,true);},
   BusquedaYCaza(o,list){
    const targets=o.args.map(a=>world.troop(a)).filter(t=>t&&world.alive(t));
    if(!targets.length)return BEHAVIOURS.CazaYCaptura(o,list);
    for(const s of list){
     if(world.inCombat(s))continue;
     const target=targets.reduce((b,t)=>dist(world.centroid(t),world.centroid(s))<dist(world.centroid(b),world.centroid(s))?t:b);
     world.attack(s,target);
    }
   },
   PatrullarRuta(o,list){
    const route=o.args.find(a=>typeof a==='string'&&world.route(a));
    for(const s of list)if(!s._route&&route){s._route=route;world.followRoute(s,route);}
    for(const s of list)if(!world.isMoving(s))engageOrReturn(s,world.centroid(s),HOLD_RADIUS);
   },
   MostrarRuta(o,list){return BEHAVIOURS.PatrullarRuta(o,list);},
   RutaCiceron(o,list){return BEHAVIOURS.PatrullarRuta(o,list);},
   MostrarRutaCarros(o,list){return BEHAVIOURS.PatrullarRuta(o,list);},
   Retirada(o,list){
    const target=typeof o.args[0]==='object'&&o.args[0]?.groups?squadsOf(o.args[0])[0]:null;
    const point=target?world.centroid(target):pointOf(o);
    for(const s of list)if(point&&!world.isMoving(s)&&dist(world.centroid(s),point)>HOME_SLACK)world.moveTo(s,point.x,point.z,true);
   },
   Refuerzo(o,list){return BEHAVIOURS.Retirada(o,list);},
   HuidaYRefuerzo(o,list){return BEHAVIOURS.Retirada(o,list);},
   Exploracion(o,list,dt){
    o.timer-=dt;
    if(o.timer>0)return;o.timer=25;
    for(const s of list){if(world.inCombat(s))continue;world.moveTo(s,random()*world.width,random()*world.depth,false);}
   },
   // Build the bridge at the named building site (its builders, or the whole
   // group if it has none), then cross: the site becomes an attack point.
   PuentesRhin(o,list){
    const name=typeof o.args[0]==='string'?o.args[0]:null,site=name?world.site?.(name):null;
    if(site){
     const crew=list.filter(s=>world.canBuild?.(s)),workers=crew.length?crew:list;
     for(const s of workers)if(!world.inCombat(s)&&!world.isBusy?.(s))world.buildSite?.(s,name);
     for(const s of list)if(!workers.includes(s)&&!world.inCombat(s)&&!world.isMoving(s)&&dist(world.centroid(s),site)>HOME_SLACK)world.moveTo(s,site.x,site.z,false);
     return;
    }
    const point=pointOf(o);if(point)for(const s of list)if(!world.isMoving(s)&&!world.inCombat(s))world.moveTo(s,point.x,point.z,false);
   }
  };
  // Take a village: fight its defenders, break its garrison, then raise our
  // own with builders (FLAG_PUEDE_CONSTRUIR); troops without builders walk in
  // (presence capture, where no garrison stands).
  function seize(v,list,civ,run){
   const point={x:v.x,z:v.z},g=world.garrisonOf?.(v);
   for(const s of list){
    if(world.inCombat(s)||world.isBusy?.(s))continue;
    const foe=hostileNear(s,world.centroid(s),10)||hostileNear(s,point,v.radius+6);
    if(foe){world.attack(s,foe);continue;}
    if(g&&world.hostileStructure?.(g,civ)){if(world.attackStructure?.(s,g))continue;}
    else if(world.canBuild?.(s)&&world.buildGarrison?.(s,v))continue;
    // Its houses stand in the way: troops hold the ground round it.
    if(dist(world.centroid(s),point)>v.radius+2&&!world.isMoving(s))world.moveTo(s,point.x,point.z,run);
   }
  }
  // ---- Skirmish planner ------------------------------------------------------------
  function planner(s){
   const p=profile(world.aiDifficulty??world.difficulty??2),phase=strategies.filter(q=>q.planner).length%8;
   const orders=new WeakMap(),initialized=new WeakSet(),initialCount=new WeakMap(),seen=new Map(),trainAt=new Map(),scoutAt=new WeakMap(),scoutVisits=new WeakMap(),intents=new WeakMap();
   const race=()=>races[world.civ(s.civ)?.race];
   const at=q=>world.centroid(q),worker=q=>!!world.canBuild?.(q),scout=q=>/EXPLORADOR|AGRADO/.test(q.type||'');
   const commander=q=>/CENTURION/.test(q.type||'')||/^CENTURION/.test(units[q.type]?.base||'')||units[q.type]?.flags?.includes('FLAG_IGNORA_ATAQUES');
   const fighter=q=>q.profile&&!q.profile.noAttack&&!commander(q)&&!scout(q)&&!q.inVillage&&!q.sheltered;
   const liveArmy=()=>world.squads().filter(q=>q.civ===s.civ&&world.alive(q));
   const centre=list=>list.length?list.reduce((c,q)=>{const a=at(q);c.x+=a.x/list.length;c.z+=a.z/list.length;return c;},{x:0,z:0}):{x:0,z:0};
   const origin=world.aiHome?.(s.civ)||centre(liveArmy());
   const homePoint={x:origin.x,z:origin.z};
   const power=q=>Math.max(1,q.members?.length||1)*Math.max(.5,(units[q.type]?.power||world.power?.(q.type)||100)/100);
   const health=q=>{
    const maximum=units[q.type]?.maxSoldiers||initialCount.get(q)||q.members?.length||1,hp=units[q.type]?.health||q.profile?.hp||0;
    return Math.min(1,(q.members||[]).reduce((n,m)=>n+(hp&&Number.isFinite(m.hp)?Math.max(0,m.hp)/hp:1),0)/maximum);
   };
   const near=(a,b,r)=>Math.abs(a.x-b.x)<=r&&Math.abs(a.z-b.z)<=r&&dist(a,b)<=r;
   const planner={difficulty:p.id,profile:p,phase:'develop',elapsed:0,timer:p.planInterval+phase*3/8,
    reactionTimer:p.reactionInterval+phase*.07,attackTimer:p.attackAfter,nextWave:p.attackAfter,
    plans:0,reactions:0,waves:0,recruits:0,orders:0,failedOrders:0,deferredOrders:0,stalledOrders:0,target:null,operation:null,home:homePoint,
    think(dt){
     this.elapsed+=dt;this.attackTimer=Math.max(0,this.nextWave-this.elapsed);
     this.reactionTimer-=dt;
     if(this.reactionTimer<=1e-9){this.reactionTimer+=p.reactionInterval;react();}
     this.timer-=dt;if(this.timer>1e-9)return;this.timer+=p.planInterval;plan();
    }};
   function initialize(army){
    for(const q of army)if(!initialized.has(q)){
     initialized.add(q);initialCount.set(q,q.members?.length||1);
     q.aiRole=worker(q)?'builder':scout(q)?'scout':fighter(q)?'defender':'commander';
     world.setHunting?.(q,false);world.setAggressive?.(q,p.id!==1&&fighter(q));
    }
   }
   function visible(army){
    if(world.visibleEnemies)return world.visibleEnemies(s.civ).filter(q=>world.alive(q)&&world.isHostile(s.civ,q.civ));
    // Useful for standalone worlds too: absence of a visibility provider does
    // not grant omniscience. Scouts and soldiers still need local line of sight.
    return world.squads().filter(q=>world.alive(q)&&world.isHostile(s.civ,q.civ)&&army.some(m=>near(at(m),at(q),Concealment.isHidden(q)?HIDDEN_SIGHT:(units[m.type]?.vision||14))));
   }
   function observe(army){
    const foes=visible(army);
    for(const q of foes){const c=at(q);seen.set(q,{civ:q.civ,type:q.type,x:c.x,z:c.z,power:power(q),at:planner.elapsed});}
    for(const [q,memory] of seen)if(planner.elapsed-memory.at>p.memory)seen.delete(q);
    return foes;
   }
   function issue(q,kind,point,fn){
    if(routeBudget<=0)return false;
    let key=kind+'|'+(point?.name||point?.id||(Math.floor((point?.x||0)/6)+','+Math.floor((point?.z||0)/6)));
    let memory=orders.get(q);if(!memory){memory=new Map();orders.set(q,memory);}
    // Nearby target jitter keeps the same intent/failure memory, including
    // when crossing a quantization boundary. A genuinely different position
    // or a squad that has escaped its old terrain invalidates that failure.
    if(!memory.has(key)&&point)for(const [oldKey,old] of memory)if(old.kind===kind&&near(old.point,point,6)){key=oldKey;break;}
    let last=memory.get(key);const position=at(q),here={x:position.x,z:position.z};
    if(last&&(dist(here,last.origin)>6||point&&dist(point,last.point)>6)){memory.delete(key);last=null;}
    if(last&&last.until>planner.elapsed)return false;
    routeBudget--;planner.orders++;
    const result=world.withAiOrder?world.withAiOrder(q,fn):fn(),ok=result!==false&&result?.ok!==false;
    const deferred=!ok&&/work-budget|ai-budget/.test(result?.reason||'');
    const failures=ok||deferred?0:(last?.failures||0)+1;
    const target={x:point?.x??here.x,z:point?.z??here.z};
    memory.set(key,{kind,point:target,origin:{x:here.x,z:here.z},failures,until:planner.elapsed+(deferred?1:ok?Math.min(1,p.planInterval):Math.min(12,2**failures))});
    while(memory.size>8)memory.delete(memory.keys().next().value);
    if(deferred)planner.deferredOrders++;else if(!ok)planner.failedOrders++;
    if(ok)intents.set(q,{key,kind,point:target,x:here.x,z:here.z,progress:planner.elapsed,structure:point?.garrison||null,life:point?.garrison?.life});
    return ok;
   }
   function move(q,point,kind='move',run=false,interrupt=false){
    if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.z)||(near(at(q),point,2.8)&&kind!=='recover blocked work')||(!interrupt&&world.isMoving(q)))return false;
    const intent=intents.get(q);if(world.isMoving(q)&&intent&&near(intent.point,point,10))return false;
    return issue(q,kind,point,()=>world.moveTo(q,point.x,point.z,run));
   }
   function attack(q,foe){
    if(world.inCombat(q)||world.isBusy?.(q))return false;
    return issue(q,'attack',{name:foe.name||foe.type,x:at(foe).x,z:at(foe).z},()=>world.attack(q,foe));
   }
   function build(q,v){
    if(q.aiBuildTarget===v&&(world.isMoving(q)||world.isBusy?.(q)))return false;
    const ok=issue(q,'garrison',v,()=>world.buildGarrison?.(q,v)??false);
    if(ok)q.aiBuildTarget=v;return ok;
   }
   function danger(point,radius,foes){return foes.filter(q=>near(at(q),point,radius)).reduce((n,q)=>n+power(q),0);}
   function baseThreats(foes,owned){
    const anchors=[homePoint,...owned];return foes.filter(q=>anchors.some(a=>near(at(q),a,p.defendRadius+(a.radius||0))));
   }
   function pickFoe(q,foes){
    const c=at(q),ranged=!!q.profile?.ranged,cavalry=/CABALLERIA|CUADRIGA/.test(q.type||'');
    let best=null,score=Infinity;
    for(const foe of foes){
     const d=dist(c,at(foe));if(d>Math.max(18,q.profile?.ranged?.range||0)+4)continue;
     const value=d-(p.adaptive&&((foe.profile?.ranged&&cavalry)||foe.profile?.noAttack)?8:0)+(ranged&&foe.profile?.ranged?2:0);
     if(value<score){score=value;best=foe;}
    }
    return best;
   }
   function react(){
    planner.reactions++;
    const army=liveArmy();if(!army.length)return;initialize(army);
    const foes=observe(army),owned=villages.owned(s.civ),threats=baseThreats(foes,owned),combatants=army.filter(fighter);
    if(threats.length){
     planner.phase='defend';
     const point=at(threats.reduce((a,b)=>dist(at(a),homePoint)<dist(at(b),homePoint)?a:b));
     const needed=threats.reduce((n,q)=>n+power(q),0)*(p.adaptive?1.25:1),defenders=combatants.filter(q=>!world.isBusy?.(q)).sort((a,b)=>dist(at(a),point)-dist(at(b),point));
     let committed=0;
     for(const q of defenders){
      if(committed>=needed&&p.id!==1)break;committed+=power(q);q.aiRole='defender';
      if(q.aiRetreatUntil>planner.elapsed)continue;
      const foe=pickFoe(q,threats);
      if(foe)attack(q,foe);else move(q,point,'defend',p.adaptive,true);
     }
    }else if(planner.phase==='defend')planner.phase=planner.operation?'attack':'develop';
    if(!threats.length)for(const q of combatants){
     if(planner.operation?.group.has(q)||world.isBusy?.(q)||!world.inCombat(q))continue;
     const anchors=[homePoint,...owned];
     if(!anchors.some(a=>near(at(q),a,p.defendRadius+4)))move(q,homePoint,'defense leash',false,true);
    }
    if(!p.adaptive)return;
    for(const q of combatants){
     if(world.isBusy?.(q))continue;
     const local=foes.filter(foe=>near(at(foe),at(q),12));
     const friendly=combatants.filter(friend=>near(at(friend),at(q),14)).reduce((n,friend)=>n+power(friend),0);
     const enemy=local.reduce((n,foe)=>n+power(foe),0);
     if(local.length&&health(q)<p.retreatAt&&enemy>friendly*.8&&!near(at(q),homePoint,9)){
      q.aiRole='retreat';q.aiRetreatUntil=planner.elapsed+12;move(q,homePoint,'retreat',true,true);continue;
     }
     if(q.aiRetreatUntil>planner.elapsed)continue;
     if((planner.operation?.group.has(q)||q.aiRole==='defender')&&local.length){const foe=pickFoe(q,local);if(foe)attack(q,foe);}
    }
   }
   function train(army,owned){
    let pending=owned.flatMap(v=>v.queue||[]),count=army.length+pending.length;
    let pcu=army.reduce((n,q)=>n+(q.members?.length||0)*(units[q.type]?.training?.pcu||1),0)+pending.reduce((n,j)=>n+(j.soldiers||units[j.type]?.maxSoldiers||1)*(units[j.type]?.training?.pcu||1),0);
    const allOptions=(race()?.trains||[]).filter(type=>units[type]);
    const crew=army.filter(worker),enemy=[...seen.values()];
    const enemyCavalry=enemy.filter(q=>/CABALLERIA|CUADRIGA/.test(q.type||'')).reduce((n,q)=>n+q.power,0),enemyRanged=enemy.filter(q=>/ARQUERO|HONDERO|CAZADOR/.test(q.type||'')).reduce((n,q)=>n+q.power,0);
    for(const v of owned){
     if(count>=50||pcu>=500||v.queue?.length||(trainAt.get(v)||0)>planner.elapsed||villages.canEnter&&!villages.canEnter(v,s.civ))continue;
     let options=allOptions.filter(type=>!(/EXPLORADOR|MEDICO|CENTURION|HEROE/.test(type))&&(p.id>2||!(units[type].training?.honour>0)));
     const affordable=type=>{
      const unit=units[type],quote=villages.quote?.(type)||{soldiers:unit.maxSoldiers||16,population:(unit.maxSoldiers||16)*(unit.training?.population||1)};
      return pcu+quote.soldiers*(unit.training?.pcu||1)<=500&&(v.population===undefined||v.population>=quote.population);
     };
     options=options.filter(affordable);if(!options.length)continue;
     const builder=options.find(type=>units[type].flags?.includes('FLAG_PUEDE_CONSTRUIR'));
     const reservedBuilders=crew.length+pending.filter(j=>units[j.type]?.flags?.includes('FLAG_PUEDE_CONSTRUIR')).length;
     let type=reservedBuilders<Math.min(owned.length,2)&&builder?builder:null;
     if(!type&&p.adaptive&&army.length>=6&&!army.some(scout)&&!pending.some(j=>/EXPLORADOR/.test(j.type)))type=allOptions.find(type=>/EXPLORADOR/.test(type)&&affordable(type));
     if(!type&&p.adaptive&&army.length>=(p.id===4?8:10)&&!army.some(q=>/MEDICO/.test(q.type||''))&&!pending.some(j=>/MEDICO/.test(j.type)))type=allOptions.find(type=>/MEDICO/.test(type)&&affordable(type));
     if(!type){
      const weight=type=>{
       const base=units[type].base||type;let w=PREFERENCE[base]??4;
       const own=army.filter(q=>q.type===type).length+pending.filter(j=>j.type===type).length;
       w/=1+own*.55;
       if(p.adaptive&&enemyCavalry>enemyRanged&&/PIQUERO/.test(base))w*=4;
       if(p.adaptive&&enemyRanged>enemyCavalry&&/CABALLERIA/.test(base))w*=3;
       if(p.id===1&&/ARQUERO|PIQUERO/.test(base))w*=1.6;
       return w;
      };
      let pick=random()*options.reduce((n,type)=>n+weight(type),0);type=options[0];
      for(const candidate of options){pick-=weight(candidate);if(pick<=0){type=candidate;break;}}
     }
     const result=villages.train(v,type,s.civ);trainAt.set(v,planner.elapsed+p.trainEvery);
     if(result!==false&&result?.ok!==false){
      planner.recruits++;count++;const soldiers=units[type].maxSoldiers||16;pcu+=soldiers*(units[type].training?.pcu||1);pending.push({type,soldiers});
     }
    }
   }
   function maintain(army,owned){
    // Combat accepts building orders before routing to them. If that later
    // route fails, do not leave a builder/assault troop retrying forever.
    for(const q of army){
     const intent=intents.get(q);if(!intent||!['garrison','siege'].includes(intent.kind))continue;
     const c=at(q),life=intent.structure?.life;
     if(dist(c,intent)>.8||life!==undefined&&life!==intent.life){intent.x=c.x;intent.z=c.z;intent.life=life;intent.progress=planner.elapsed;continue;}
     if(planner.elapsed-intent.progress<20||near(c,intent.point,12)||!world.isBusy?.(q))continue;
     const previous=orders.get(q)?.get(intent.key);if(previous)previous.until=planner.elapsed+20;
     if(move(q,homePoint,'recover blocked work',false,true)){planner.stalledOrders++;q.aiBuildTarget=null;}
    }
    const crew=army.filter(q=>worker(q)&&!world.inCombat(q)&&!world.isBusy?.(q)),assigned=new Set();
    for(const v of owned){
     const g=world.garrisonOf?.(v);
     if(!g||g.state==='site'||g.state==='destroyed'){
      const q=crew.find(q=>!assigned.has(q));if(q){assigned.add(q);q.aiRole='builder';build(q,v);}
     }else if(p.adaptive&&g.state==='built'&&(g.fire>0||g.life<g.maxLife*.85)){
      const q=crew.find(q=>!assigned.has(q));if(q&&world.repair){assigned.add(q);issue(q,'repair',v,()=>world.repair(q,g));}
     }
    }
    // Commanders are economic/protected units, not a solitary attack wave.
    for(const q of army.filter(q=>!fighter(q)&&!scout(q)&&!worker(q))){
     if(q.inVillage||q.sheltered||world.inCombat(q)||world.isBusy?.(q))continue;
     const v=owned.find(v=>!villages.canEnter||villages.canEnter(v,s.civ));if(v)move(q,v.entry||v,'commander');
    }
    return assigned;
   }
   function expand(army,assigned,foes){
    if(planner.elapsed<p.expandAfter)return;
    const crew=army.filter(q=>worker(q)&&!assigned.has(q)&&!world.inCombat(q)&&!world.isBusy?.(q));
    const escorts=army.filter(q=>fighter(q)&&!worker(q)&&!planner.operation?.group.has(q)&&!world.inCombat(q)&&!world.isBusy?.(q)&&!(q.aiRetreatUntil>planner.elapsed));
    const targets=villages.villages.filter(v=>!v.owner||world.neutralCiv&&world.neutralCiv(v.owner)).sort((a,b)=>{
     const dangerAt=v=>p.adaptive?danger(v,v.radius+14,foes)*.3:0;
     return dist(a,homePoint)+dangerAt(a)-dist(b,homePoint)-dangerAt(b);
    });
    for(let i=0;i<Math.min(targets.length,p.expansions);i++){
     const v=targets[i],q=crew[i],escort=escorts.slice(i*p.escort,(i+1)*p.escort);
     if(q){q.aiRole='builder';build(q,v);}
     // No-builder scenarios retain their existing presence-capture fallback.
     for(const e of escort){e.aiRole='escort';if(dist(at(e),v)>v.radius+2)move(e,v,'expand');}
    }
   }
   function chooseTarget(){
    const options=villages.villages.filter(v=>v.owner&&v.owner!==s.civ&&world.isHostile(s.civ,v.owner));
    const threats=[...seen.values()];
    const score=v=>dist(homePoint,v)+(p.adaptive?threats.filter(q=>near(q,v,v.radius+20)).reduce((n,q)=>n+q.power,0)*.35:0)+(world.garrisonOf?.(v)?.state==='built'?8:0);
    options.sort((a,b)=>score(a)-score(b));
    if(options.length)return {x:options[0].x,z:options[0].z,name:options[0].name,village:options[0]};
    const remembered=threats.sort((a,b)=>dist(a,homePoint)-dist(b,homePoint))[0];
    if(remembered)return {x:remembered.x,z:remembered.z,name:'last seen '+remembered.type};
    // Spawn locations are public map information. Advancing there is a
    // scouting/pressure decision, not knowledge of an unseen moving army.
    const bases=(world.aiBases?.()||[]).filter(base=>world.isHostile(s.civ,base.civ)).sort((a,b)=>dist(a,homePoint)-dist(b,homePoint));
    return bases.length?{x:bases[0].x,z:bases[0].z,name:'base '+bases[0].civ}:null;
   }
   function offensives(army,owned){
    if(p.id===1||planner.phase==='defend')return;
    let op=planner.operation;
    const combatants=army.filter(q=>fighter(q)&&!worker(q)&&!world.isBusy?.(q)&&!(q.aiRetreatUntil>planner.elapsed));
    if(op){
     for(const q of op.group)if(!world.alive(q)||q.aiRetreatUntil>planner.elapsed)op.group.delete(q);
     if(!op.group.size||op.target.village?.owner===s.civ||planner.elapsed-op.created>p.operationTime){planner.operation=null;op=null;planner.phase='develop';}
    }
    if(planner.elapsed>=planner.nextWave&&combatants.length>=p.minAttack&&(owned.length||planner.elapsed>=p.attackAfter+60)){
     const target=op?.target||chooseTarget();
     if(target){
      const reserve=Math.max(1,Math.ceil(combatants.length*p.reserve));
      const count=Math.min(p.maxAttack,Math.max(1,combatants.length-reserve));
      const chosen=combatants.filter(q=>!world.inCombat(q)||op?.group.has(q)).sort((a,b)=>dist(at(a),target)-dist(at(b),target)).slice(0,count);
      if(chosen.length>=Math.min(2,p.minAttack)){
       if(!op){
        const distance=dist(homePoint,target)||1,advance=Math.min(distance*.4,24);
        const rally={x:homePoint.x+(target.x-homePoint.x)/distance*advance,z:homePoint.z+(target.z-homePoint.z)/distance*advance};
        op=planner.operation={kind:p.id===2?'raid':'assault',target,group:new Set(),created:planner.elapsed,rally,launched:p.id===2,flank:new Map()};
        planner.target={x:target.x,z:target.z,name:target.name};
       }
       for(const q of chosen){op.group.add(q);q.aiRole='attacker';}
       planner.waves++;planner.nextWave=planner.elapsed+p.waveEvery;
       if(p.id===4&&op.group.size>=4){
        const dx=target.x-homePoint.x,dz=target.z-homePoint.z,length=Math.hypot(dx,dz)||1;
        const point={x:target.x-dz/length*14,z:target.z+dx/length*14};
        let n=0;for(const q of op.group)if(n++%3===2&&!op.flank.has(q))op.flank.set(q,{point,until:planner.elapsed+24});
       }
      }
     }
    }
    if(!op)return;
    if(!op.launched){
     const assembled=[...op.group].filter(q=>near(at(q),op.rally,10)).length;
     if(assembled>=Math.ceil(op.group.size*.6)||planner.elapsed-op.created>=p.rallyTime)op.launched=true;
    }
    planner.phase=op.launched?'attack':'rally';
    for(const q of op.group){
     if(world.inCombat(q)||world.isBusy?.(q)||q.aiRetreatUntil>planner.elapsed)continue;
     if(!op.launched){move(q,op.rally,'rally',false);continue;}
     const flank=op.flank.get(q);
     if(flank&&!near(at(q),flank.point,6)&&planner.elapsed<flank.until){move(q,flank.point,'flank',p.id===4);continue;}
     const v=op.target.village,g=v&&world.garrisonOf?.(v);
     if(g?.state==='built'&&world.hostileStructure?.(g,s.civ))issue(q,'siege',{...op.target,garrison:g},()=>world.attackStructure?.(q,g)??false);
     else if(!near(at(q),op.target,(v?.radius||3)+3))move(q,op.target,'attack advance',p.id===4);
    }
   }
   function scoutGround(army,foes){
    if(p.id===1)return;
    const bases=(world.aiBases?.()||[]).filter(base=>world.isHostile(s.civ,base.civ)).map(base=>({...base,name:'base '+base.civ,radius:4}));
    const settlements=villages.villages.filter(v=>v.owner!==s.civ&&!(v.owner&&world.allied(v.owner,s.civ))).sort((a,b)=>dist(a,homePoint)-dist(b,homePoint));
    const targets=p.adaptive&&planner.elapsed>=30?[...bases,...settlements]:[...settlements,...bases];
    for(const q of army.filter(scout)){
     if(world.inCombat(q)||world.isMoving(q)||planner.elapsed<(scoutAt.get(q)||0))continue;
     const nearby=foes.find(foe=>near(at(foe),at(q),12));
     if(nearby){move(q,homePoint,'scout retreat',true,true);scoutAt.set(q,planner.elapsed+8);continue;}
     let visits=scoutVisits.get(q);if(!visits){visits=new Set();scoutVisits.set(q,visits);}
     if(targets.length&&targets.every(v=>visits.has(v.name)))visits.clear();
     const target=targets.find(v=>!visits.has(v.name)&&!near(at(q),v,(v.radius||4)+6))||targets.find(v=>!visits.has(v.name));
     if(target){const dx=homePoint.x-target.x,dz=homePoint.z-target.z,length=Math.hypot(dx,dz)||1;
      const ok=move(q,{x:target.x+dx/length*(target.radius+8),z:target.z+dz/length*(target.radius+8)},'scout');if(ok)visits.add(target.name);scoutAt.set(q,planner.elapsed+(p.id===2?20:8));}
    }
   }
   function plan(){
    planner.plans++;
    const army=liveArmy();if(!army.length)return;initialize(army);
    const foes=observe(army),owned=villages.owned(s.civ);
    train(army,owned);
    const assigned=maintain(army,owned);
    expand(army,assigned,foes);offensives(army,owned);scoutGround(army,foes);
    const reserves=army.filter(q=>fighter(q)&&!worker(q)&&!planner.operation?.group.has(q)&&q.aiRole!=='escort'&&!world.inCombat(q)&&!world.isBusy?.(q));
    if(planner.phase!=='defend')for(const q of reserves){q.aiRole='defender';const anchor=owned[0]||homePoint;if(dist(at(q),anchor)>p.defendRadius*.65)move(q,anchor,'reserve');}
   }
   return planner;
  }
  // ---- Update ----------------------------------------------------------------------
  let timer=0;
  function update(dt){
   if(!managedFrames)routeBudget=3;
   for(const s of strategies)if(s.started&&s.civ&&s.planner&&!world.controlled?.(s.civ))s.planner.think(dt);
   timer-=dt;if(timer>0)return;
   const step=THINK-timer;timer=THINK;
   for(const s of strategies){
    if(!s.started||!s.civ)continue;
    // A civilization the player has taken command of thinks for itself.
    if(world.controlled?.(s.civ))continue;
    // Scripted training at villages (delay in ms per troop).
    for(const [name,delay] of s.delays){
     if(s.training.get(name)===false)continue;
     const v=villages.find(name);if(!v||v.owner!==s.civ||v.queue.length)continue;
     const left=(s.timers.get(name)??delay/1000)-step;
     if(left>0){s.timers.set(name,left);continue;}
     s.timers.set(name,delay/1000);
     const group=s.objectives.find(o=>lower(o.args[0])===lower(name)&&o.params.NombreGrupoGenerado)?.params.NombreGrupoGenerado
      ||s.objectives.find(o=>o.params.NombreGrupoGenerado)?.params.NombreGrupoGenerado||null;
     const options=(races[world.civ(s.civ)?.race]?.trains||[]).filter(t=>units[t]&&!/EXPLORADOR|MEDICO|CABALLERIA_GERMANA|ESPADON|CAZADOR|GLADIADOR|HONDERO|ELITE/.test(t));
     if(options.length)villages.train(v,options[Math.floor(random()*options.length)],s.civ,{group});
    }
    for(const o of s.objectives){
     if(!o.active||o.forbidden)continue;
     const behaviour=BEHAVIOURS[o.kind]||BEHAVIOURS.CazaYCaptura;
     try{behaviour(o,squadsOf(o),step);}catch(error){o.active=false;world.log?.('cpu',o.kind,error.message);}
    }
   }
  }
  return {strategy,assign,objective,addObjective,change,update,strategies,objectives,squadsOf,BEHAVIOURS,
   beginFrame(){managedFrames=true;routeBudget=3;},
   snapshot(){return strategies.filter(s=>s.started&&s.planner).map(s=>{const p=s.planner;return {civ:s.civ,difficulty:p.difficulty,phase:p.phase,elapsed:p.elapsed,plans:p.plans,reactions:p.reactions,waves:p.waves,recruits:p.recruits,orders:p.orders,failedOrders:p.failedOrders,deferredOrders:p.deferredOrders,stalledOrders:p.stalledOrders,target:p.target,attackIn:p.attackTimer,attackers:p.operation?.group.size||0};});},
   start(s){if(s)s.started=true;},
   attackAll(civ){for(const q of world.squads())if(q.civ===civ&&world.alive(q))world.setHunting(q,true);}};
 }
 return {create,profile,PROFILES};
});
