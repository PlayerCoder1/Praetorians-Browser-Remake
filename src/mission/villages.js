/* Villages (PUEBLO) and barracks (BARRACON): ownership, conquest,
   population and troop training.

   A mission ESTRUCTURA of a village type names it and gives its inhabitants
   (HABITANTES / MAX_HABITANTES / VEL_REGENERACION). A garrison (GUARNICION)
   naming the village (PUEBLO_GUARNICION) gives its starting owner
   (CIVILIZACION_ESTR); otherwise it starts neutral.

   Conquest is by garrison (src/world/buildings.js): destroy the owner's
   garrison, then build your own. Where no garrison stands, civilizations
   given presence capture (options.presence(civ): the CPU without builders)
   take a village by holding it alone for a few seconds.

   Training: the owner spends inhabitants (COSTE_HABITANTES per soldier) and
   time (COSTE_ENTRENAMIENTO seconds per soldier) to raise a troop of
   MAX_UNIDADES_TROPA soldiers of a type its race can train; it appears at
   the village's exit point. Inhabitants regrow (VEL_REGENERACION per 10 s,
   an approximation) up to the maximum. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansVillages=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const CAPTURE_TIME=4,REGROW_PERIOD=10,HOLD_RING=3;
 const lower=s=>String(s||'').toLowerCase();
 // world: squads(), alive(s), civ(name), allied(a,b), spawn(...), neutralCiv
 // defs: structure definitions (assets/hd/structures.json); placements: the
 // mission's structures; units: data/game/units.json; races: races.json.
 function create({world,defs,placements,units,races,onEvent=()=>{},presence=()=>true,trainingRate=()=>1}){
  const villages=[],garrisons=[];
  for(const p of placements){
   const def=defs[p.type]||{},kind=def.kind;
   if(kind==='PUEBLO'||kind==='BARRACON'){
    const r=p.r||0,c=Math.cos(r),s=Math.sin(r);
    const local=v=>v&&{x:p.x+v[0]*c+v[2]*s,z:p.z-v[0]*s+v[2]*c};
    // Unnamed villages (skirmish maps) get a unique name of their own.
    villages.push({name:p.name||`${p.type}@${Math.round(p.x)},${Math.round(p.z)}`,named:!!p.name,label:p.label||null,type:p.type,kind,x:p.x,z:p.z,r,
     radius:Math.max(4,def.aroundRadius||4.2),owner:null,
     population:p.population??def.population??300,maxPopulation:p.maxPopulation??def.maxPopulation??600,
     regeneration:p.regeneration??def.regeneration??5,
     exit:local(p.exit||def.exit)||{x:p.x+5,z:p.z},annex:local(p.annex||def.annex),
     // The centurion goes in by PUNTO_ENTRADA (main.js enterVillage).
     entry:local(p.entry||def.entry)||local(p.exit||def.exit)||{x:p.x+5,z:p.z},inside:[],
     progress:0,claimant:null,queue:[],trainedBy:null,garrison:null});
   }else if(kind==='GUARNICION')garrisons.push({name:p.name,type:p.type,village:p.garrisonOf||null,owner:p.owner||null,x:p.x,z:p.z});
  }
  const byName=new Map(villages.map(v=>[lower(v.name),v]));
  for(const g of garrisons){
   const v=g.village?byName.get(lower(g.village)):null;
   if(v&&g.owner)v.owner=g.owner;
  }
  const find=name=>byName.get(lower(name))||null;
  // Ownership alone is not permission for a commander to enter. A village
  // needs its completed, living garrison; script-owned standalone barracks
  // already provide their own training building and need no separate one.
  function canEnter(name,civ){
   const v=typeof name==='string'?find(name):name;
   if(!v||!civ||!v.owner||(v.owner!==civ&&!world.allied(v.owner,civ)))return false;
   if(v.kind==='BARRACON')return true;
   const g=v.garrison;
   return v.kind==='PUEBLO'&&g?.kind==='GUARNICION'&&g.state==='built'&&Number.isFinite(g.life)&&g.life>0&&g.owner===v.owner;
  }
  function setOwner(name,civ){
   const v=find(name);if(!v)return false;
   const previous=v.owner;v.owner=civ;
   // Explicit mission transfers hand over the standing garrison too (Munda:
   // the allies give town to Caesar). Ruins and construction are not revived.
   const g=v.garrison;
   if(g?.kind==='GUARNICION'&&g.state==='built'&&Number.isFinite(g.life)&&g.life>0){
    g.owner=civ;if(g.placement)g.placement.owner=civ;
   }
   onEvent('captured',{village:v,civ,previous});return true;
  }
  const raceOf=civ=>world.civ(civ)?.race;
  function trainable(civ){
   const race=races[raceOf(civ)];return race?race.trains.filter(t=>units[t]):[];
  }
  // A full troop of `type` for `civ` at village v: cost and time, as the
  // game's own table gives them (COSTE_ENTRENAMIENTO seconds and
  // COSTE_HABITANTES inhabitants a soldier, PUNTOS_HONOR a troop): 30 s and
  // 30 inhabitants for Roman auxiliaries, 69 s, 24 and a point of honour for
  // equites, 90 s, 48 and two points for the special troops.
  function quote(type){
   const unit=units[type],training=unit?.training||{};
   const soldiers=Math.max(1,unit?.maxSoldiers||training.step||16);
   return {soldiers,population:soldiers*(training.population||1),seconds:soldiers*(training.time||1),honour:training.honour||0};
  }
  function train(name,type,civ,options={}){
   const v=typeof name==='string'?find(name):name;
   if(!v||v.owner!==civ)return {ok:false,reason:'not-owner'};
   const q=quote(type);
   if(v.population<q.population)return {ok:false,reason:'population',needed:q.population};
   v.population-=q.population;
   v.queue.push({type,civ,soldiers:q.soldiers,left:q.seconds,total:q.seconds,group:options.group||null,name:options.name||null});
   onEvent('trainingStarted',{village:v,type,civ});
   return {ok:true,seconds:q.seconds};
  }
  let clock=0,captureTimer=0;
  function update(dt){
   clock+=dt;
   for(const v of villages){
    // Inhabitants regrow.
    if(v.population<v.maxPopulation)v.population=Math.min(v.maxPopulation,v.population+v.regeneration*dt/REGROW_PERIOD);
    // Training.
    const job=v.queue[0];
    if(job){
     // Difficulty can change CPU development speed without changing costs,
     // soldier statistics or the scripted recruitment-delay API.
     const requested=trainingRate(job.civ,v),rate=Number.isFinite(requested)&&requested>0?Math.min(4,requested):1;
     job.left-=dt*rate;
     if(job.left<=0){
      v.queue.shift();
      if(v.owner===job.civ){
       const squad=world.spawn(job.civ,job.type,job.soldiers,v.exit.x,v.exit.z,Math.atan2(v.exit.x-v.x,v.exit.z-v.z),job.name,job.group);
       onEvent('trained',{village:v,squad,job});
      }
     }
    }
   }
   if((captureTimer-=dt)>0)return;
   const step=.5;captureTimer=step;
   // Who stands at each village? (Its houses stand in the way: the ground
   // round it counts.)
   const present=new Map(villages.map(v=>[v,new Map()]));
   for(const s of world.squads()){
    if(!world.alive(s)||!s.civ||world.neutralCiv(s.civ))continue;
    for(const v of villages){
     const near=v.radius+HOLD_RING,dx=s.x-v.x,dz=s.z-v.z;if(dx*dx+dz*dz>(near+3)**2)continue;
     let count=0;for(const m of s.members)if((m.x-v.x)**2+(m.z-v.z)**2<=near*near)count++;
     if(count)present.get(v).set(s.civ,(present.get(v).get(s.civ)||0)+count);
    }
   }
   for(const v of villages){
    // A standing (or rising) garrison decides who holds the village.
    if(v.garrison&&v.garrison.state!=='destroyed'){v.progress=0;v.claimant=null;continue;}
    const civs=[...present.get(v).keys()].filter(c=>presence(c)||c===v.owner||(v.owner&&world.allied(c,v.owner)));
    const defended=v.owner&&civs.some(c=>c===v.owner||world.allied(c,v.owner));
    const claimants=civs.filter(c=>c!==v.owner&&!(v.owner&&world.allied(c,v.owner)));
    // One side (or allies together) in an undefended village takes it.
    const one=claimants.length&&claimants.every(c=>world.allied(c,claimants[0]))?claimants[0]:null;
    if(one&&!defended){
     if(v.claimant!==one){v.claimant=one;v.progress=0;}
     v.progress+=step;
     if(v.progress>=CAPTURE_TIME){
      const previous=v.owner;v.owner=one;v.progress=0;v.claimant=null;v.queue.length=0;
      onEvent('captured',{village:v,civ:one,previous});
     }
    }else{v.progress=Math.max(0,v.progress-step);if(!v.progress)v.claimant=null;}
   }
  }
  return {villages,garrisons,find,canEnter,train,trainable,quote,update,setOwner,
   owned:civ=>villages.filter(v=>v.owner===civ),
  };
 }
 return {create};
});
