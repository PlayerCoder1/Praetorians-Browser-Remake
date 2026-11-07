/* Structures in play: garrisons, watchtowers, tents, altars, ships and
   barracks that troops attack and destroy; building sites where infantry
   raises garrisons, watchtowers, bridges and siege machines; troops sheltering
   in a watchtower. (Fortress gates are src/world/fortress.js; main.js attacks
   both the same way, through combat.attackStructure.)

   Data: assets/hd/structures.json (DefEstructuras: VIDA, DEFENSAS,
   FACTOR_CONSTRUCCION, MAX_CONSTRUIR, PUNTO_SUPERFICIE, POSICIONES,
   ALTO_PISO, PUNTO_ENTRADA and the visual's construction, damage and ruin
   geometries), data/game/units.json (DefMaquinas FACTOR_CONSTRUCCION,
   MAX_CONSTRUIR) and data/game/races.json (GUARNICION, CONSTRUYE).

   Building: each builder at the site (a soldier of a FLAG_PUEDE_CONSTRUIR
   troop, at most MAX_CONSTRUIR of them) adds FACTOR_CONSTRUCCION life points
   a second until the structure or machine has its full VIDA. A full troop
   raises any siege machine in about 20 s, a watchtower or a bridge in some
   15 s, a garrison in 20 s - the original's figures read as rates.

   A village belongs to whoever holds its garrison (manual and Tutorial II:
   destroy the enemy garrison, then build your own with auxiliary infantry).
   No dependency on rendering: main.js supplies the hooks. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansBuildings=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const lower=s=>String(s||'').toLowerCase();
 // Structures troops can attack (villages, bridges and gates are not here).
 const ATTACKABLE=new Set(['GUARNICION','TORRE_DEFENSA','ATACABLE','BARCO']);
 // Structures that stand in the way (their PUNTO_SUPERFICIE outline).
 const SOLID=new Set(['GUARNICION','TORRE_DEFENSA','ATACABLE']);
 const STAGES_DAMAGED=[.66,.33];
 function inside(poly,x,z){
  let c=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
   const [xi,zi]=poly[i],[xj,zj]=poly[j];
   if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;
  }
  return c;
 }
 // world: civ(name), allied(a,b), isHostile(a,b), groundY(x,z)
 // villages: src/mission/villages.js
 // hooks: show(entity, model|null), obstaclesChanged(), bridgeBuilt(entity),
 //  machineBuilt(entity) -> squad, event(kind, data)
 // machineSites: assets/hd/machine-sites.json machines - each siege machine's
 //  construction stages (DefVisuales CONSTRUCCION) and their ground footprints.
 function convexHull(points){
  const pts=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(pts.length<3)return pts;
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),lower=[],upper=[];
  for(const p of pts){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}
  for(let i=pts.length-1;i>=0;i--){const p=pts[i];while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}
  return lower.slice(0,-1).concat(upper.slice(0,-1));
 }
 function create({defs,units,races,placements=[],world,villages:villageList=null,machineSites={},hooks={}}){
  let villages=villageList;
  const entities=[];let nextId=0;
  const hook=(name,...args)=>{try{return hooks[name]?.(...args);}catch(error){console.warn('buildings',name,error);}};
  function frame(e){e.c=Math.cos(e.r);e.s=Math.sin(e.r);}
  const toWorld=(e,lx,lz)=>({x:e.x+lx*e.c+lz*e.s,z:e.z-lx*e.s+lz*e.c});
  const toLocal=(e,x,z)=>{const dx=x-e.x,dz=z-e.z;return {x:dx*e.c-dz*e.s,z:dx*e.s+dz*e.c};};
  // A structure's ground outline: its surround box (CENTRO_RODEO ±
  // ANCHO_RODEO_X/Y), which matches the models - the garrisons'
  // PUNTO_SUPERFICIE is one shape shared by all three, with a wedge reaching
  // 2 m beyond any of their geometry - else PUNTO_SUPERFICIE.
  function outline(def){
   if(def.aroundX!=null){
    const c=def.aroundCentre||[0,0],cx=c[0],cz=c[c.length-1],ax=def.aroundX,az=def.aroundY??ax;
    return [[cx-ax,cz-az],[cx+ax,cz-az],[cx+ax,cz+az],[cx-ax,cz+az]];
   }
   const pts=(def.surface||[]).map(v=>[v[0],v[2]]);
   if(pts.length>=3)return pts;
   const r=Math.max(1,def.aroundRadius||1);
   return [[-r,-r],[r,-r],[r,r],[-r,r]];
  }
  function add(e){
   frame(e);e.outline=outline(e.def);
   e.radius=Math.max(1,...e.outline.map(([x,z])=>Math.hypot(x,z)));
   entities.push(e);return e;
  }
  function fromPlacement(p){
   const def=defs[p.type]||{};
   return add({id:++nextId,name:p.name||null,type:p.type,kind:def.kind,def,placement:p,x:p.x,z:p.z,r:p.r||0,
    owner:p.owner&&!/^neutral$/i.test(p.owner)?p.owner:null,life:def.life||100000,maxLife:def.life||100000,
    state:'built',progress:1,village:p.garrisonOf||null,occupants:[],machine:false});
  }
  for(const p of placements){
   const def=defs[p.type];
   if(def&&ATTACKABLE.has(def.kind))fromPlacement(p);
   // A building site (ANDAMIO) for a bridge: a site from the start.
   else if(def?.kind==='ANDAMIO'&&p.construction&&defs[p.construction]){
    const target=defs[p.construction];
    add({id:++nextId,name:p.name||null,type:p.construction,kind:target.kind,def:target,placement:p,x:p.x,z:p.z,r:p.r||0,
     owner:null,life:0,maxLife:target.life||100000,state:'site',progress:0,scaffold:true,occupants:[],machine:false});
   }
  }
  // Villages and barracks stand in the way (FLAG_ESQUIVABLE): their
  // CASILLAS footprint, 1 m cells in rows along +z and columns along +x,
  // centred on the structure.
  const footprints=[];
  for(const p of placements){
   const def=defs[p.type];
   if((def?.kind==='PUEBLO'||def?.kind==='BARRACON')&&def.cellMask?.length&&def.cells?.[0]){
    const f={x:p.x,z:p.z,r:p.r||0,rows:def.cells[0],columns:def.cells[1],mask:def.cellMask};frame(f);
    f.reach=Math.hypot(f.rows,f.columns)/2+1;footprints.push(f);
   }
  }
  function onFootprint(x,z){
   for(const f of footprints){
    if(Math.abs(x-f.x)>f.reach||Math.abs(z-f.z)>f.reach)continue;
    const l=toLocal(f,x,z),col=Math.round(l.x+(f.columns-1)/2),row=Math.round(l.z+(f.rows-1)/2);
    if(row>=0&&col>=0&&row<f.rows&&col<f.columns&&f.mask[row*f.columns+col])return f;
   }
   return null;
  }
  // Garrisons give their village its owner (villages: src/mission/villages.js).
  function link(list){
   villages=list;
   for(const e of entities)if(e.kind==='GUARNICION'&&e.village){
    const v=villages?.find(e.village);if(v){e.villageRef=v;v.garrison=e;if(e.owner)v.owner=e.owner;else e.owner=v.owner||null;}
   }
  }
  if(villages)link(villages);
  const find=name=>entities.find(e=>e.name&&lower(e.name)===lower(name))||null;
  const alive=e=>e.state!=='destroyed';
  const hostileTo=(e,civ)=>e.state==='built'&&!!e.owner&&!!civ&&world.isHostile(civ,e.owner);
  // The structure at (x, z): inside its outline, or within its radius + reach.
  function at(x,z,reach=.6){
   let best=null,bestD=Infinity;
   for(const e of entities){
    if(e.state==='destroyed')continue;
    const d=Math.hypot(e.x-x,e.z-z);if(d>e.radius+reach+2)continue;
    const l=toLocal(e,x,z);
    if(inside(e.outline,l.x,l.z)||d<=e.radius*.6+reach){if(d<bestD){bestD=d;best=e;}}
   }
   return best;
  }
  // Model to show: building stages, the structure, its damage, its ruin.
  function modelOf(e){
   const g=e.def.geometries||{},base=e.def.parts?.[0]?.model||null;
   // A machine is a troop once built; its site shows its construction stages.
   if(e.machine&&e.state!=='site')return null;
   if(e.state==='site'){
    // Nothing on the ground until the builders are there (begin).
    if(e.pending)return null;
    const stages=g.construction||[];
    if(!stages.length)return e.progress>0?base:null;
    return stages[Math.min(stages.length-1,Math.floor(e.progress*stages.length))];
   }
   if(e.state==='destroyed')return g.ruin||g.destroyed||null;
   const damaged=g.damaged||[],share=e.life/Math.max(1,e.maxLife);
   if(damaged[1]&&share<STAGES_DAMAGED[1])return damaged[1];
   if(damaged[0]&&share<STAGES_DAMAGED[0])return damaged[0];
   return base;
  }
  function refresh(e){const model=modelOf(e);if(model!==e.shown){e.shown=model;hook('show',e,model);}}
  // ---- Damage ------------------------------------------------------------------
  function damage(e,amount,by){
   if(e.state!=='built'||!(amount>0))return;
   // A fresh attack (none for 15 s) is announced to its owner.
   const now=world.clock?.()??0,fresh=!(now-(e.attackedAt??-Infinity)<15);
   e.life-=amount;e.attackedAt=now;e.placement&&(e.placement.attackedAt=e.attackedAt);
   if(fresh)hook('event','attacked',{entity:e,by});
   // Melee troops storming a manned tower bring its defenders down to fight.
   if(e.occupants.length&&by?.profile&&!by.profile.ranged)hook('assault',e,by);
   if(e.life<=0)destroy(e,by);else refresh(e);
  }
  // ---- Fire (Praetorians.exe 0x4e90f0 / 0x4e9200) ---------------------------------
  // A structure keeps a fire level: fire weapons (INCENDIO x the structure's
  // DEFENSAS INCENDIO %) feed it instead of harming it directly, up to 1500.
  // Above 750 it burns, losing (fire - 750) x 0.01 life a tick (here with its
  // fire defence again: stone burns slowly); above 1000 the fire feeds
  // itself. Repairers put it out before mending. The original's tick rate is
  // not known: damage at FIRE_TICKS a second is this port's choice (a
  // garrison at full fire burns down in about two minutes).
  // Incoming weapon fire uses a separate ignition scale: summing the raw
  // INCENDIO from 16-30 arrows used to fill the entire 1500-level fire in
  // one volley. These are port balance choices: 2% of the incoming flame
  // dose catches, and self-fed growth is 10 fire per second, not per tick.
  // Sustained volleys build a fire gradually; scripted setFire/addFire keep
  // their explicit fire-level units and the source's damage defenses.
  const FIRE_MAX=1500,FIRE_BURNS=750,FIRE_SPREADS=1000,FIRE_GROWTH=10,FIRE_TICKS=50,FIRE_IMPACT_SCALE=.02;
  const burning=e=>(e.fire||0)>FIRE_BURNS;
  function addFire(e,amount,by){
   if(e.state!=='built'||!amount)return;
   e.fire=Math.max(0,Math.min(FIRE_MAX,(e.fire||0)+amount));
   if(amount>0)e.burnBy=by||e.burnBy;
   showFire(e);
  }
  function setFire(e,amount){if(e.state!=='built')return;e.fire=Math.max(0,Math.min(FIRE_MAX,amount||0));showFire(e);}
  function showFire(e){
   // The fire level, 0 to 1 of FIRE_MAX: flames catch at the base and climb
   // the building as it grows (main.js); half way (750) it burns.
   const level=Math.round(Math.min(1,(e.fire||0)/FIRE_MAX)*50)/50;
   if(level!==e.fireShown){e.fireShown=level;hook('fire',e,level);}
  }
  let fireClock=0;
  function update(dt){
   fireClock+=dt;
   while(fireClock+1e-9>=1/FIRE_TICKS){
    fireClock-=1/FIRE_TICKS;
    for(const e of entities){
     if(e.state!=='built'||!e.fire)continue;
     if(e.fire>FIRE_SPREADS)e.fire=Math.min(FIRE_MAX,e.fire+FIRE_GROWTH/FIRE_TICKS);
     if(burning(e))damage(e,Math.max(1,(e.fire-FIRE_BURNS)*.01)*((e.def.defenses?.fire??100)/100),e.burnBy);
     if(e.state==='built')showFire(e);
    }
   }
  }
  function destroy(e,by){
   if(e.state==='destroyed')return;
   e.state='destroyed';e.life=0;if(e.placement)e.placement.destroyed=true;
   if(e.fire){e.fire=0;showFire(e);}
   for(const out of [...e.occupants])leave(out);
   refresh(e);
   if(e.kind==='GUARNICION'&&e.village){
    const v=e.villageRef||villages?.find(e.village);
    if(v&&v.garrison===e){const previous=v.owner;v.owner=null;v.queue.length=0;hook('event','villageLost',{village:v,previous,by});}
   }
   if(SOLID.has(e.kind))hook('obstaclesChanged',e);
   hook('event','destroyed',{entity:e,by});
  }
  // ---- Building ----------------------------------------------------------------
  const raceOf=civ=>world.civ(civ)?.race;
  const machineDef=type=>units[type]?.construction?units[type]:null;
  // What civ's builders can raise: its race's CONSTRUYE (bridges at their
  // sites, watchtowers) and its siege machines (FLAG_SOLO_MISIONES ones
  // only in campaign missions).
  function buildable(civ,{campaign=true}={}){
   const race=races[raceOf(civ)];if(!race)return [];
   const list=[];
   for(const type of race.builds||[]){
    const def=defs[type];if(!def)continue;
    list.push({type,kind:def.kind==='PUENTE'?'bridge':'structure',label:def.label,icon:def.buildIcon||null});
   }
   for(const [type,unit] of Object.entries(units)){
    if(unit.race!==raceOf(civ)||!unit.construction)continue;
    if(!campaign&&unit.flags?.includes('FLAG_SOLO_MISIONES'))continue;
    list.push({type,kind:'machine',label:unit.name,icon:unit.construction.icon||null});
   }
   return list;
  }
  // A siege machine's site: its stages, standing on the ground all of them
  // cover together (builders line it, and it stands in the way while built).
  function machineSiteDef(type){
   const site=machineSites?.[type],hull=convexHull((site?.footprints||[]).flat().filter(p=>Array.isArray(p)&&p.length>=2));
   return {kind:'MAQUINA',surface:hull.length>=3?hull.map(([px,pz])=>[px,0,pz]):[],aroundRadius:1.2,
    geometries:site?.construction?.length?{construction:site.construction}:{}};
  }
  function startSite(type,x,z,r,civ,options={}){
   const unit=machineDef(type),def=unit?null:defs[type];
   if(!unit&&!def)return null;
   const e=add({id:++nextId,name:options.name||null,type,kind:unit?'MAQUINA':def.kind,def:def||machineSiteDef(type),placement:null,
    x,z,r,y:world.groundY?.(x,z)??0,owner:civ,life:0,maxLife:unit?unit.health:(def.life||100000),state:'site',progress:0,
    machine:!!unit,unit,village:options.village||null,occupants:[]});
   if(!unit){
    e.placement={type,name:e.name,x,y:e.y,z,r,owner:civ,garrisonOf:e.village,built:false};
   }
   // As in the original, a new site is only a place until its builders
   // reach it: nothing shows and nothing stands in the way (pending). When
   // they are there its first stage rises round them (begin); a garrison,
   // tower or siege machine site then stands in the way once they have
   // stepped out to its edges (main.js clearSites, then blockSite).
   e.pending=options.pending??true;
   if(SOLID.has(e.kind)||e.def.geometries?.construction?.length&&e.machine){e.blocking=false;e.clearing=true;}
   refresh(e);hook('event','siteStarted',{entity:e});
   return e;
  }
  function begin(e){
   if(e.state!=='site'||!e.pending)return;
   e.pending=false;
   // The ruin of the garrison it replaces is cleared away now.
   const footprint=()=>{const f=hook('footprint',modelOf(e));if(f?.length>=3){e.workOutline=f;e.contour=null;}};
   const old=e.replaces;e.replaces=null;
   if(old&&old.state==='destroyed'&&entities.includes(old)){hook('show',old,null);entities.splice(entities.indexOf(old),1);}
   // A machine's site already covers the ground of all its stages.
   refresh(e);if(!e.machine)footprint();hook('event','siteBegun',{entity:e});
  }
  // A site nobody came to build is given up.
  function cancelSite(e){
   if(e.state!=='site'||!e.pending)return false;
   const i=entities.indexOf(e);if(i>=0)entities.splice(i,1);
   hook('show',e,null);
   const v=e.villageRef;if(v&&v.garrison===e)v.garrison=e.replaces||null;
   hook('event','siteCancelled',{entity:e});
   return true;
  }
  const rateOf=e=>e.machine?e.unit.construction:{factor:e.def.buildFactor||100,maxBuilders:e.def.maxBuilders||32};
  // squad works at the site for dt seconds (count: its men at their places).
  function work(e,squad,dt,count=squad.members.length){
   if(e.state!=='site')return false;
   // A site cannot seal or finish around immobile occupants. Keep its
   // crew's job alive while the world waits for them to stand and move.
   if(world.constructionBlocked?.(e))return true;
   if(e.pending&&count)begin(e);
   const {factor,maxBuilders}=rateOf(e);
   e.workers??=new Map();e.workers.set(squad,count);
   const builders=Math.min(maxBuilders,[...e.workers.values()].reduce((n,v)=>n+v,0));
   // Each squad adds its share of the capped crew.
   const share=count/Math.max(1,[...e.workers.values()].reduce((n,v)=>n+v,0));
   const requested=world.buildRate?.(squad),rate=Number.isFinite(requested)&&requested>0?Math.min(4,requested):1;
   e.life=Math.min(e.maxLife,e.life+factor*builders*share*dt*rate);
   e.progress=e.life/e.maxLife;
   e.builtBy=squad.civ;if(e.placement)e.placement.builtBy=squad.civ;
   refresh(e);
   if(e.life>=e.maxLife)complete(e);
   return true;
  }
  function stopWork(e,squad){e.workers?.delete(squad);}
  // Repairs (ORDEN_REPARAR): FACTOR_REPARACION life points per builder per
  // second, at most MAX_REPARAR builders.
  // A fire is put out first (0x4e92e0: at most 1000 left, then lowered).
  const EXTINGUISH=.1;
  function repair(e,squad,dt,count=squad.members.length){
   if(e.state!=='built'||(e.life>=e.maxLife&&!e.fire))return false;
   const factor=e.def.repairFactor||40,max=e.def.maxRepairers||32;
   e.workers??=new Map();e.workers.set(squad,count);
   const total=[...e.workers.values()].reduce((n,v)=>n+v,0),share=count/Math.max(1,total);
   if(e.fire){if(count)setFire(e,Math.min(e.fire,FIRE_SPREADS)-factor*Math.min(max,total)*share*dt*EXTINGUISH);return true;}
   e.life=Math.min(e.maxLife,e.life+factor*Math.min(max,total)*share*dt);
   refresh(e);
   if(e.life>=e.maxLife)e.workers=null;
   return true;
  }
  function complete(e){
   e.state='built';e.progress=1;e.life=e.maxLife;e.workers=null;e.workOutline=null;e.contour=null;
   if(e.placement){e.placement.built=true;e.placement.construction=null;}
   const civ=e.owner||e.builtBy;e.owner=civ;
   if(e.machine){
    const blocked=!!e.blocking;
    e.state='destroyed';hook('show',e,null);entities.splice(entities.indexOf(e),1);
    // Its site makes way for the machine it has become.
    if(blocked)hook('obstaclesChanged',e);
    hook('machineBuilt',e);hook('event','machineBuilt',{entity:e,civ});return;
   }
   refresh(e);
   if(e.kind==='PUENTE'){e.owner=null;hook('bridgeBuilt',e);}
   if(SOLID.has(e.kind))hook('obstaclesChanged',e);
   if(e.kind==='GUARNICION'&&e.village){
    const v=e.villageRef||villages?.find(e.village);
    if(v){const previous=v.owner;v.garrison=e;v.owner=civ;v.queue.length=0;hook('event','captured',{village:v,civ,previous});}
   }
   hook('event','built',{entity:e,civ});
  }
  // Where a village's garrison stands: its own garrison's place, else the
  // village's annex point (PUNTO_ANEXO).
  // A new garrison is turned as its village (every garrison the missions
  // place at an annex point has the village's orientation).
  function garrisonSite(v){
   const old=v.garrison&&entities.includes(v.garrison)?v.garrison:entities.find(e=>e.kind==='GUARNICION'&&(e.villageRef===v||(e.village&&lower(e.village)===lower(v.name))));
   if(old)return {x:old.x,z:old.z,r:old.r,old};
   const a=v.annex||v.exit||{x:v.x+4,z:v.z};
   return {x:a.x,z:a.z,r:v.r||0};
  }
  // A garrison raised by civ at village v (its own garrison must be gone).
  function startGarrison(v,civ){
   const current=v.garrison;
   if(current&&current.state!=='destroyed'){
    if(current.state==='site'&&current.owner===civ)return current;
    return null;
   }
   const type=races[raceOf(civ)]?.garrison;if(!type||!defs[type])return null;
   const spot=garrisonSite(v);
   const e=startSite(type,spot.x,spot.z,spot.r,civ,{village:v.name,name:spot.old?.name||null});
   if(spot.old?.state==='destroyed')e.replaces=spot.old;
   e.villageRef=v;v.garrison=e;
   return e;
  }
  // ---- Shelter in a watchtower (MAX_TROPAS troops, POSICIONES) ------------------
  // An unowned tower belongs to whoever goes in; a mission script may put
  // more troops in than the tower normally takes (force).
  const canShelter=(e,squad,force=false)=>e.state==='built'&&e.kind==='TORRE_DEFENSA'&&(force||e.occupants.length<(e.def.maxTroops||1))
   &&!e.occupants.includes(squad)&&(!e.owner||e.owner===squad.civ||world.allied(e.owner,squad.civ));
  function enter(e,squad,{force=false}={}){
   if(!canShelter(e,squad,force))return false;
   e.owner??=squad.civ;e.occupants.push(squad);squad.sheltered=e;
   const floor=(world.groundY?.(e.x,e.z)??0)+(e.def.floor||2),spots=(e.def.positions||[[0,0]]).map(([px,pz])=>toWorld(e,px,pz));
   squad.members.forEach((m,i)=>{const p=i<spots.length?spots[i]:toWorld(e,0,0);m.x=p.x;m.z=p.z;m.y=floor;m.r=Math.atan2(p.x-e.x,p.z-e.z);});
   squad.x=e.x;squad.z=e.z;squad.dirty=true;
   hook('event','sheltered',{entity:e,squad});
   return true;
  }
  function leave(squad){
   const e=squad.sheltered;if(!e)return null;
   e.occupants=e.occupants.filter(s=>s!==squad);squad.sheltered=null;
   const door=toWorld(e,(e.def.entry?.[0]??1)+1.4,e.def.entry?.[2]??0);
   squad.x=door.x;squad.z=door.z;
   hook('event','unsheltered',{entity:e,squad,door});
   return door;
  }
  // ---- Navigation --------------------------------------------------------------
  function classify(x,z){
   if(onFootprint(x,z))return {kind:'solid',village:true};
   for(const e of entities){
    if(!blocks(e))continue;
    if(Math.abs(x-e.x)>e.radius+.1||Math.abs(z-e.z)>e.radius+.1)continue;
    const l=toLocal(e,x,z);if(inside(shape(e),l.x,l.z))return {kind:'solid',structure:e};
   }
   return null;
  }
  // Siege machine sites too, while being built (a machine is a troop after).
  const blocks=e=>(SOLID.has(e.kind)||(e.machine&&e.state==='site'))&&(e.state==='built'||(e.state==='site'&&e.blocking));
  // What stands on the ground: a site's scaffold (its stage's footprint), else
  // the structure's outline.
  const shape=e=>e.workOutline||e.outline;
  // On (or within margin of) e's outline.
  function covers(e,x,z,margin=0){
   if(Math.abs(x-e.x)>e.radius+margin+.1||Math.abs(z-e.z)>e.radius+margin+.1)return false;
   const l=toLocal(e,x,z);
   if(inside(shape(e),l.x,l.z))return true;
   for(const [dx,dz] of [[margin,0],[-margin,0],[0,margin],[0,-margin]])if(margin&&inside(shape(e),l.x+dx,l.z+dz))return true;
   return false;
  }
  function blockSite(e){if(e.state!=='site'||e.blocking)return;e.blocking=true;e.clearing=false;hook('obstaclesChanged',e);}
  // Builders', repairers' and attackers' places round e: the whole crew
  // close against it, shoulder to shoulder on its outline (PUNTO_SUPERFICIE)
  // a body's width out, further rings only when one is full, nearest `from`
  // first.
  const PLACE_GAP=.36,BODY_OUT=.4,RING_GAP=.4;
  function workCentre(e){const c=e.def.aroundCentre||[0,0];return toWorld(e,c[0],c[c.length-1]);}
  // The outline's distance from its middle along direction a (local).
  function contour(e){
   if(e.contour)return e.contour;
   const pts=e.workOutline||e.outline,mx=pts.reduce((n,p)=>n+p[0],0)/pts.length,mz=pts.reduce((n,p)=>n+p[1],0)/pts.length,steps=144,reach=[];
   for(let k=0;k<steps;k++){
    const a=k*2*Math.PI/steps,dx=Math.cos(a),dz=Math.sin(a);let far=0;
    for(let i=0,j=pts.length-1;i<pts.length;j=i++){
     // Ray from the middle against edge j-i.
     const ex=pts[i][0]-pts[j][0],ez=pts[i][1]-pts[j][1],den=dx*ez-dz*ex;if(Math.abs(den)<1e-9)continue;
     const wx=pts[j][0]-mx,wz=pts[j][1]-mz,t=(wx*ez-wz*ex)/den,u=(wx*dz-wz*dx)/den;
     if(t>0&&u>=0&&u<=1)far=Math.max(far,t);
    }
    reach.push(far||.5);
   }
   return e.contour={mx,mz,steps,reach};
  }
  // A point's place round e: its angle about the outline's middle (local)
  // and how far beyond the outline it stands; and back.
  const sector=(c,a)=>((Math.round(a/(2*Math.PI)*c.steps)%c.steps)+c.steps)%c.steps;
  function polar(e,p){
   const c=contour(e),l=toLocal(e,p.x,p.z),dx=l.x-c.mx,dz=l.z-c.mz,a=Math.atan2(dz,dx);
   return {a,off:Math.hypot(dx,dz)-c.reach[sector(c,a)]};
  }
  function rim(e,a,off){const c=contour(e),r=c.reach[sector(c,a)]+off;return toWorld(e,c.mx+Math.cos(a)*r,c.mz+Math.sin(a)*r);}
  // Every place round e on as many rows as count men could need (twice as
  // many places as men): combat.js gives each man the nearest free one, so a
  // troop packs against the side it comes from, rows deep, as in the original.
  function spots(e,count,from,usable=null){
   const {mx,mz,steps,reach}=contour(e),out=[],want=count*2+8;
   for(let ring=0;out.length<want&&ring<12;ring++){
    const off=BODY_OUT+ring*RING_GAP,line=[];
    for(let k=0;k<steps;k++){const a=k*2*Math.PI/steps,r=reach[k]+off;line.push([mx+Math.cos(a)*r,mz+Math.sin(a)*r]);}
    // Places every PLACE_GAP along that line.
    const list=[];let carry=ring%2?PLACE_GAP/2:0;
    for(let k=0;k<steps;k++){
     const [ax,az]=line[k],[bx,bz]=line[(k+1)%steps],len=Math.hypot(bx-ax,bz-az);
     for(let s=carry;s<len;s+=PLACE_GAP){
      const p=toWorld(e,ax+(bx-ax)*s/len,az+(bz-az)*s/len);p.row=ring;
      // Corners and the closing of the ring bring places together: one man each.
      if((!usable||usable(p))&&!list.some(q=>Math.hypot(q.x-p.x,q.z-p.z)<PLACE_GAP*.85)&&!out.some(q=>Math.hypot(q.x-p.x,q.z-p.z)<PLACE_GAP*.85))list.push(p);
     }
     carry=((carry-len)%PLACE_GAP+PLACE_GAP)%PLACE_GAP;
    }
    out.push(...list);
   }
   return out;
  }
  // Combat target for attacking (or, work:true, building) entity e.
  function target(e,{work:building=false,repair:mending=false}={}){
   return {kind:building?'site':mending?'repair':'structure',entity:e,centre:{x:e.x,z:e.z},defenses:e.def.defenses||{building:100,melee:10},
    workCentre:workCentre(e),spots:(count,from,usable)=>spots(e,count,from,usable),radius:e.radius,begin:()=>begin(e),
    polar:p=>polar(e,p),rim:(a,off)=>rim(e,a,off),
    // A missile lands: its direct damage, and what it adds to the fire.
    hit:(amount,fire,by)=>{if(fire)addFire(e,fire*FIRE_IMPACT_SCALE,by);if(amount>0)damage(e,amount,by);},
    // Burning at its fullest: fire arrows can add nothing more.
    fireFull:()=>e.state==='built'&&(e.fire||0)>=FIRE_MAX,
    // Where an arrow strikes: a point on the building, at a man's height or more.
    aimPoint(random=Math.random){
     const c=contour(e),a=random()*2*Math.PI,r=c.reach[sector(c,a)]*(.3+random()*.6),p=toWorld(e,c.mx+Math.cos(a)*r,c.mz+Math.sin(a)*r);
     return {x:p.x,z:p.z,y:(world.groundY?.(p.x,p.z)??0)+1.2+random()*1.6};
    },
    alive:()=>building?e.state==='site':mending?e.state==='built'&&(e.life<e.maxLife||e.fire>0):e.state==='built',
    damage:(amount,by)=>damage(e,amount,by),
    work:(squad,dt,count)=>mending?repair(e,squad,dt,count):work(e,squad,dt,count),stop:squad=>stopWork(e,squad),
    approach(from,weapon){
     const d=Math.hypot(from.x-e.x,from.z-e.z)||1,ux=(from.x-e.x)/d,uz=(from.z-e.z)/d;
     if(weapon?.kind==='ranged'){const r=Math.max((weapon.rangeMin||0)+1,Math.min(weapon.rangeMax*.8,d));return {x:e.x+ux*r,z:e.z+uz*r};}
     // Builders march onto a site still open to them (as in the original)
     // and step out to its edges from there.
     if(building&&!blocks(e))return {x:e.x,z:e.z};
     const r=e.radius+(building?1.4:1.1);return {x:e.x+ux*r,z:e.z+uz*r};
    },
    // From a soldier to its walls (roughly: its outline's radius).
    distanceTo:p=>Math.max(0,Math.hypot(p.x-e.x,p.z-e.z)-e.radius*.85),
    // Other places round it, nearest first.
    ring(from,weapon){
     const r=weapon?.kind==='ranged'?Math.min(weapon.rangeMax*.8,Math.max((weapon.rangeMin||0)+1,6)):e.radius+(building?1.4:1.1),list=[];
     for(const k of [r,r+1.5])for(let a=0;a<12;a++)list.push({x:e.x+Math.cos(a*Math.PI/6)*k,z:e.z+Math.sin(a*Math.PI/6)*k});
     return list.sort((a,b)=>Math.hypot(a.x-from.x,a.z-from.z)-Math.hypot(b.x-from.x,b.z-from.z));
    }};
  }
  // Show every structure's current model (once the renderer is ready).
  function refreshAll(){for(const e of entities){e.shown=undefined;refresh(e);}}
  return {entities,find,at,alive,hostileTo,target,damage,destroy,buildable,startSite,startGarrison,garrisonSite,work,stopWork,complete,
   canShelter,enter,leave,classify,modelOf,refresh,refreshAll,link,repair,addFire,setFire,burning,update,blockSite,begin,cancelSite,covers,blocks,ATTACKABLE,SOLID,FIRE_MAX};
 }
 return {create};
});
