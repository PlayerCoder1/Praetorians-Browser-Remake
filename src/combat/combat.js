/* Combat reconstruction using the original unit/weapon definitions. RITMO
   supplies the minimum attack interval; the renderer can also supply the
   native clip duration. Reach and damage percentages come from the data.

   Melee follows what the original game visibly does. An attacker reaching
   the squad he attacks locks both into combat until one of them is
   destroyed (manual §4.6); merely being near a fight drags nobody in. Each
   soldier pairs off with one opponent: duels first, extra men ganging up,
   never more than three on one man. The overflow waits where it stands, and
   a squad whose fight is full is taken over by the AI, which attacks the
   nearest enemy with room. Bodies pass through one another, so the squads
   collapse into one intermixed clump.
   The pairing rules, timing integration and impact phase reconstruct
   behaviour, not the unavailable original executable.

   Fortresses: each squad moves on its own navigation (navFor: a gate opens
   only for its holder's side). Troops on a wall walkway (anchored) hold the
   wall: they shoot what is in range and fight what climbs up, but never go
   down after the enemy on their own. Structures (gates) are attacked with
   the troop's weapon against buildings - DESMANTELAR for soldiers, CARGA for
   rams, the stone shot for catapults - against the structure's DEFENSAS. */
(function(root,factory){
 const concealment=typeof module==='object'&&module.exports?require('../world/troop-concealment.js'):root.PraetoriansTroopConcealment;
 const api=factory(concealment);if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansCombat=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(Concealment){
 'use strict';
 const SPEED_SCALE=1.65/20,RUN_FACTOR=1.55;
 const BODY=.32,MEMBER_RADIUS=.06;
 // Squads lock into melee when an attacker reaches the man he attacks
 // (CONTACT); standing or marching near a fight never drags a squad in. A
 // squad sent to attack breaks ranks and charges CHARGE_BREAK from its target.
 const CONTACT=1.5,CHARGE_BREAK=4,CHARGE_TIMEOUT=12,LINK_BREAK=12;
 // Pairing scores are metres: a foe attacking me counts ANSWER_BONUS closer
 // (so a man always turns on his attacker, which also breaks chase loops),
 // an unclaimed foe FREE_BONUS closer, each man already on him CROWD_COST
 // further. Nobody is attacked by more than MAX_ATTACKERS at once.
 // Men without an opponent are matched all together, closest pairs first.
 // When more than PAIR_BUDGET need one at once (whole armies meeting), the
 // searches are spread over PAIR_SPREAD steps. A man whose own fight is full
 // takes on any enemy with room within AGGRO_RADIUS (AI aggro) and keeps him
 // while within AGGRO_HOLD; otherwise he waits where he stands.
 const PAIR_RADII=[1.5,3],PAIR_BUDGET=240,PAIR_SPREAD=3,MAX_ATTACKERS=3,ANSWER_BONUS=5,FREE_BONUS=1,CROWD_COST=.9,STICK_BONUS=.5,REPAIR_INTERVAL=.5,AGGRO_RADIUS=2.5,AGGRO_HOLD=4;
 // No body collision in melee: a weak nudge only keeps men from standing
 // exactly on top of each other.
 const NUDGE_RADIUS=.3,NUDGE_SPEED=.6,SLOT_CROWD=.35,SLOT_REACHED=.2,GIVE_UP=1,SHUN_TIME=2,WAIT_IN_REACH=1;
 // Every duel claims its own patch of ground, at least SPOT_GAP from any other
 // duel, searched outwards from where the pair met. Duellists stand DUEL_GAP
 // of their weapon reach apart.
 const SPOT_GAP=.6,SPOT_SEARCH=3.5,DUEL_GAP=.75;
 // AI takeover: a squad whose men all wait because its fight is full, or
 // whose enemies are all dead, attacks the nearest enemy with room within
 // FLOW_JOIN.
 const FLOW_JOIN=6;
 const FIXED_STEP=1/30,MAX_CATCHUP=.25,THINK_INTERVAL=.1;
 // Automatic pursuit shares a small FIFO routing budget. Failed targets are
 // remembered briefly so the next think does not immediately select them again.
 const PURSUIT_ROUTES_PER_STEP=2,PURSUIT_FRAME_WORK=4096,FAILED_TARGET_LIMIT=8,RETRY_BASE=1,RETRY_MAX=4;
 const IMPACT_PHASE=.45,SHOOT_DRAW=1;
 // Endurance (DefUnidades MANA_*, DefHabilidades FISICO): running spends
 // 0.3 % of the maximum a tick of the original's logic, taken as 20 a second
 // (its replays sample every 50 ms) - 6 % a second, so a rested troop runs
 // some 15 s; nobody runs under 10 % (MINIMO_MANA). MANA_CRECIMIENTO comes
 // back every 10 s (as the villages' VEL_REGENERACION here; not documented).
 const RUN_DRAIN=.06,RUN_FLOOR=.1,REST_PERIOD=10;
 // PILUM (DefHabilidades): as a troop closes in on the troop it attacks,
 // every man throws a javelin from 3 to 10 m (the PILUM weapon), spending
 // 70 % of his endurance (GASTO_MANA_PUNTUAL_UNIDAD); the troop needs 70 %
 // of its endurance to throw (MINIMO_MANA). FLAG_EJECUCION_AUTOMATICA: it
 // throws by itself unless automatic use is turned off (squad.autoPilum).
 const PILUM_COST=.7;
 const FALLBACK_MELEE={damage:{melee:20,projectile:0},interval:.6,rangeMin:0,rangeMax:.5,kind:'melee'};
 const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
 const valid=m=>!!m&&m.hp>0;
 function profile(stats,type){
  const unit=stats[type];if(!unit)throw new Error('No combat stats for unit type '+type);
  const state=unit.states.NORMAL||Object.values(unit.states)[0]||{received:{melee:100,projectile:100},speed:20};
  const primary=unit.weapons.NORMAL||FALLBACK_MELEE;
  // States without VELOCIDAD (heroes, scouts) march at their standard
  // formation's speed, scaled as the infantry pair 0.025 <-> 20.
  // A siege machine rolls in its MOVIL state: a catapult's is 4 (its NORMAL
  // 35 is no marching speed - it rolled as fast as the cavalry).
  const moving=unit.states.MOVIL?.speed>0?unit.states.MOVIL:state;
  const speed=moving.speed>0?moving.speed:unit.formationSpeed?unit.formationSpeed/.025*20:20;
  return {type,health:unit.health,received:state.received,speed:speed*SPEED_SCALE,stamina:unit.stamina||null,
   noAttack:(unit.flags||[]).includes('FLAG_NO_ATAQUE'),
   vision:unit.vision||12,aggression:unit.aggression||unit.vision||12,
   melee:primary.kind==='melee'?primary:(unit.weapons.CUERPO||FALLBACK_MELEE),ranged:primary.kind==='ranged'?primary:null,
   pilum:(unit.abilities||[]).includes('PILUM')&&unit.weapons.PILUM?.kind==='ranged'?unit.weapons.PILUM:null};
 }
 function damage(weapon,target){
  const d=weapon.damage,r=target.received;
  if(weapon.kind==='ranged')return (d.projectile||0)*(r.projectile??100)/100;
  return ((d.melee||0)*(r.melee??100)+(d.projectile||0)*(r.projectile??100))/100;
 }
 // attackDuration(squad, member, weapon) optionally returns the native clip
 // duration in seconds. It is a lower bound alongside the source RITMO.
 // update accepts real seconds and advances at 30 Hz; move/attack return
 // false for orders rejected by the original game's melee lock.
 const ANCHOR_REACH=6;
 const IN_TENT='La troupe est dans sa tente : annulez d’abord la promotion ou la dégradation.';
 const FORMATION_LOCKED='Relevez d’abord la troupe en choisissant sa formation normale.';
 // Siege shots (DefProyectiles TIPO_PIEDRA_CATAPULTA, TIPO_FLECHA_BALLESTA).
 // launch: share of the firing clip before the shot leaves (the arm, the
 // bow strikes); height: where it leaves (the catapult's POSICION_PROYECTIL
 // 2.0). A stone lands within `scatter` of where it was aimed and crushes the
 // enemies within `splash`; a bolt goes through up to `pierce` men, those
 // within BOLT_REACH of its line. Radii, counts and speeds are this port's:
 // the executable holds the original's rules.
 const SIEGE_SHOTS={
  PIEDRA:{launch:.35,height:2,scatter:1.2,flight:.8,speed:12,splash:1.5},
  FLECHA_BALLESTA:{launch:.15,height:1.1,speed:28,pierce:3}
 };
 const BOLT_REACH=.45;
 // Hidden in tall grass: spotted only within this many metres (squad gap).
 const CONCEALED_SIGHT=3;
 // clipDuration(squad, name) optionally gives a clip's length in seconds (a
 // siege engine fires and reloads as its 'shoot' and 'load' clips run).
 function create({nav,motion,groundY=()=>0,stats,random=Math.random,onEvent=()=>{},attackDuration=()=>0,isHostile=null,navFor=null,anchored=null,unreachable=null,structureFor=null,hasClip=()=>false,clipDuration=()=>0,formations=null}){
  const navOf=s=>navFor?navFor(s):nav;
  const isAnchored=s=>!!anchored?.(s);
  const formationPending=s=>!!s.formationState?.pending;
  // A planted posture is an explicit stance. A march never raises it for
  // the player; this also covers a queued entry before its geometry starts.
  const isFormationLocked=s=>!!s?.formationState?.stationary||
   !!(s?.formationRequest&&formations?.get(s.type,s.formationRequest.id)?.mobile===false);
  const holdsRanks=s=>!formationPending(s)&&(!!s.formationState?.stationary||s.formationState?.mode==='testudo');
  const squads=[],projectiles=[],grid=new Map(),usedBuckets=[],pending=[],spots=new Map(),pursuitRoutes=[];
  const metrics={steps:0,neighborChecks:0,targetSearches:0,damageEvents:0,droppedTime:0,contacts:0,duels:0,waiting:0,activeSoldiers:0,engagedSquads:0,projectiles:0,pathRequests:0,pathDeferred:0,pathFailures:0,retrySkips:0};
  let accumulator=0,nextId=0,step=0,clock=0,frameRoutesRemaining=null,frameRouteWork=0;
  const emit=(type,data)=>{try{onEvent(type,data);}catch(error){console.warn('combat event',error);}};
  const alive=s=>s&&s.members.length>0;
  // Neutral squads (a guide not yet with the army) are nobody's enemy.
  // Sides by default (player / enemy / neutral); missions with several
  // civilizations and alliances supply isHostile(a,b).
  const hostile=(a,b)=>a!==b&&a.side!=='neutral'&&b.side!=='neutral'&&(isHostile?isHostile(a,b):a.side!==b.side);
  const key=(x,z)=>(x+65536)*131072+z+65536;
  function centroid(s){let x=0,z=0;const n=s.members.length;if(!n)return {x:s.x,z:s.z};for(const m of s.members){x+=m.x;z+=m.z;}return {x:x/n,z:z/n};}
  function spread(s,c=centroid(s)){let r=.3;for(const m of s.members)r=Math.max(r,dist(m,c));return r;}
  function snapshot(s){
   const c=centroid(s);s.combat.cx=c.x;s.combat.cz=c.z;s.combat.radius=spread(s,c);
  }
  const center=s=>({x:s.combat.cx,z:s.combat.cz});
  function setFormation(squad,id,{force=false}={}){
   if(!formations)return false;
   const check=formations.check(squad,id,{ignoreBusy:force});if(!check.ok)return false;
   const state=formations.apply(squad,id);if(!state)return false;
   squad.profile=formations.profile(squad.type,id,profile(stats,squad.type));squad.speed=squad.profile.speed;
   if(!state.canRun)squad.running=false;
   return state;
  }
  // This same reset is used by live orders and their private forecast. Only
  // local offsets change here: no soldier's world position, HP or stamina is
  // touched. The regular reformer then walks him safely into the new block.
  function resetFormation(squad,{geometry=true}={}){
   const normal=formations?.standard(squad.type);if(!normal)return false;
   const previous=squad.formationState,state=setFormation(squad,normal.id,{force:true});
   if(!state)return false;
   if(geometry){
    const slots=motion.shape?.(squad.members.length,squad.spacing);let changed=!!squad.formationShape;
    squad.formationShape=null;
    if(slots?.length===squad.members.length)for(let i=0;i<slots.length;i++){
     const m=squad.members[i],slot=slots[i];changed=changed||Math.abs((m.dx||0)-slot.dx)>1e-6||Math.abs((m.dz||0)-slot.dz)>1e-6;
     m.dx=slot.dx;m.dz=slot.dz;delete m.formationRole;
    }
    if(changed){squad.individualTurn=null;squad.needsReform=true;}
   }
   return {state,previous};
  }
  function insert(m){
   const k=key(Math.floor(m.x),Math.floor(m.z));let bucket=grid.get(k);
   if(!bucket){bucket=[];grid.set(k,bucket);}if(!bucket.length)usedBuckets.push(bucket);
   bucket.push(m);m._combatBucket=bucket;m._combatCell=k;
  }
  function relocate(m){
   const k=key(Math.floor(m.x),Math.floor(m.z));if(k===m._combatCell)return;
   const bucket=m._combatBucket,i=bucket.indexOf(m);if(i>=0){bucket[i]=bucket[bucket.length-1];bucket.pop();}
   insert(m);
  }
  function rebuildGrid(){
   for(const bucket of usedBuckets)bucket.length=0;usedBuckets.length=0;
   // A centurion inside a village is out of everyone's reach.
   for(const s of squads)if(!s.inVillage)for(const m of s.members)insert(m);
  }
  // Queries visit nearby occupied cells, never the entire army.
  function nearby(x,z,radius,visit){
   const loX=Math.floor(x-radius),hiX=Math.floor(x+radius),loZ=Math.floor(z-radius),hiZ=Math.floor(z+radius);
   for(let ix=loX;ix<=hiX;ix++)for(let iz=loZ;iz<=hiZ;iz++){
    const bucket=grid.get(key(ix,iz));if(!bucket)continue;
    for(let i=0;i<bucket.length;i++){const m=bucket[i];if(!valid(m))continue;metrics.neighborChecks++;if(visit(m)===false)return;}
   }
  }
  const gap=(a,b)=>Math.hypot(a.combat.cx-b.combat.cx,a.combat.cz-b.combat.cz)-a.combat.radius-b.combat.radius;
  function closeEnough(a,b,reach){
   if(gap(a,b)>reach)return false;
   const small=a.members.length<=b.members.length?a:b,other=small===a?b:a,oc=other.combat,limit=(oc.radius+reach)**2;let found=false;
   for(const m of small.members){if((m.x-oc.cx)**2+(m.z-oc.cz)**2>limit)continue;nearby(m.x,m.z,reach,o=>{
    // Nearby on the far side of a building is not reachable by a charge.
    // Keep following the formation's route around it until there is a clear
    // approach, rather than breaking ranks and running into its wall.
    if(o.squad===other&&(o.x-m.x)**2+(o.z-m.z)**2<=reach*reach&&(!navOf(a)||navOf(a).lineClear(m,o,MEMBER_RADIUS))){found=true;return false;}
   });if(found)return true;}
   return false;
  }
  function add(squad,side){
   squad.side=side;squad.profile=profile(stats,squad.type);squad.speed=squad.profile.speed;
   if(formations?.get(squad.type,squad.formationState?.id)&&!formationPending(squad)){
    squad.profile=formations.profile(squad.type,squad.formationState.id,squad.profile);squad.speed=squad.profile.speed;
   }
   squad.dying=squad.dying||[];squad.fallen=0;squad.kills=squad.kills||0;
   squad.combat={mode:'idle',target:null,foes:new Set(),engaged:false,ordered:false,moveOrder:false,repath:0,dest:null,shouted:false,think:0,chargeTime:0};
   for(const m of squad.members){
    m.hp=squad.profile.health;m.squad=squad;m.combatId=nextId++;m.foe=null;m.watch=null;m.slot=null;m._attackers=0;
    if(squad.profile.stamina)m.stamina??=squad.profile.stamina.initial;
    m.cooldown=squad.profile.ranged?Math.min(SHOOT_DRAW,squad.profile.ranged.interval*.75)+random()*squad.profile.ranged.interval*.25:random()*squad.profile.melee.interval;
    m._repair=(m.combatId%15)*FIXED_STEP;
   }
   snapshot(squad);squads.push(squad);return squad;
  }
  function clearAction(m){m.action=null;m.actionTime=0;m.actionDuration=0;m.attackTime=0;m._swing=null;m._swingDuration=0;m._release=0;m.combatMoving=false;m.charging=false;}
  // m.foe is the one enemy a soldier attacks; _attackers counts the enemies
  // attacking him. A pair attacking each other is a duel.
  function setFoe(m,o){
   if(m.foe===o)return;
   if(m.foe)m.foe._attackers=Math.max(0,(m.foe._attackers||0)-1);
   breakSpot(m);m.foe=o;m.slot=null;m._blocked=0;
   if(o){o._attackers=(o._attackers||0)+1;m.watch=null;if(o.foe===m)duelSpot(m,o);}
  }
  // ---- Duel spots --------------------------------------------------------------
  function spotsNear(x,z,visit){
   const ix=Math.floor(x),iz=Math.floor(z);
   for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const list=spots.get(key(ix+dx,iz+dz));if(list)for(const spot of list)visit(spot);}
  }
  function spotClear(x,z){let clear=true;spotsNear(x,z,o=>{if(clear&&(o.x-x)**2+(o.z-z)**2<SPOT_GAP*SPOT_GAP)clear=false;});return clear;}
  function breakSpot(m){
   const spot=m.spot;if(!spot)return;
   const list=spots.get(spot.k),i=list?list.indexOf(spot):-1;if(i>=0){list[i]=list[list.length-1];list.pop();}
   if(spot.a.spot===spot)spot.a.spot=null;if(spot.b.spot===spot)spot.b.spot=null;
  }
  // Pairs that met where the fronts touched would all fight on that one line.
  // Instead each duel takes the free patch nearest to both men, so the pairs
  // spread into a clump with room for every fight.
  function duelSpot(a,b){
   // A braced line and a shield roof stay where their ranks were placed.
   // Their assailant comes to them rather than dragging both to a duel spot.
   if(holdsRanks(a.squad)||holdsRanks(b.squad))return;
   const reach=Math.min(a.squad.profile.melee.rangeMax,b.squad.profile.melee.rangeMax)+BODY,h=reach*DUEL_GAP/2;
   let ax=b.x-a.x,az=b.z-a.z;const l=Math.hypot(ax,az);
   if(l>1e-6){ax/=l;az/=l;}else{ax=Math.sin(a.r||0);az=Math.cos(a.r||0);}
   const mx=(a.x+b.x)/2,mz=(a.z+b.z)/2,turn=(a.combatId*.618034%1)*Math.PI*2;
   const grid=navOf(a.squad);
   const fits=(x,z)=>spotClear(x,z)&&(!grid||(grid.canStand(x-ax*h,z-az*h,MEMBER_RADIUS)&&grid.canStand(x+ax*h,z+az*h,MEMBER_RADIUS)));
   let at=fits(mx,mz)?{x:mx,z:mz}:null;
   for(let r=.45;!at&&r<=SPOT_SEARCH;r+=.45){
    const n=Math.max(6,Math.round(r*7));let best=Infinity;
    for(let i=0;i<n;i++){
     const t=turn+i*Math.PI*2/n,x=mx+Math.cos(t)*r,z=mz+Math.sin(t)*r;if(!fits(x,z))continue;
     const travel=(x-ax*h-a.x)**2+(z-az*h-a.z)**2+(x+ax*h-b.x)**2+(z+az*h-b.z)**2;
     if(travel<best){best=travel;at={x,z};}
    }
   }
   at??={x:mx,z:mz};
   const spot={x:at.x,z:at.z,ax,az,h,a,b,k:key(Math.floor(at.x),Math.floor(at.z))};
   let list=spots.get(spot.k);if(!list)spots.set(spot.k,list=[]);list.push(spot);
   a.spot=b.spot=spot;
  }
  function standOf(m){const spot=m.spot,side=spot.a===m?-1:1;return {x:spot.x+side*spot.ax*spot.h,z:spot.z+side*spot.az*spot.h};}
  function release(m){clearAction(m);setFoe(m,null);m.watch=null;}
  // An attacker reaching his man locks both squads into melee until one of
  // them is destroyed.
  function link(a,b){
   if(!hostile(a,b)||!alive(a)||!alive(b))return;
   for(const [s,o] of [[a,b],[b,a]]){
    // Unarmed men (FLAG_NO_ATAQUE) can be attacked but never fight back,
    // so they are never locked in a melee.
    if(s.profile.noAttack)continue;
    const c=s.combat;
    // A crew must drop its building job before fighting soldiers. Work poses
    // and routes belong to the siege and cannot survive this transition.
    if(c.mode==='siege'||c.structure)endSiege(s,{reform:false});
    c.foes.add(o);
    if(c.mode==='melee')continue;
    if(c.mode==='shoot')stopShooting(s);
    c.mode='melee';c.moveOrder=false;c.dest=null;c.chargeTime=0;s.running=false;s.needsReform=false;motion.halt?.(s);
    if(!alive(c.target)||!c.foes.has(c.target))c.target=o;
    emit('engage',{squad:s,enemy:o});
   }
  }
  function unlink(a,b){a.combat.foes.delete(b);b.combat.foes.delete(a);}
  // run: a double right-click - the troop runs to its target (breath
  // permitting); otherwise it marches and charges the last few metres.
  // pilum: the player ordered the javelins thrown (even with automatic use off).
  function attack(squad,target,{run=false,pilum=false}={}){
   if(!alive(squad)||!alive(target)||!hostile(squad,target)||squad.profile.noAttack||squad.transform||formationPending(squad)||target.sheltered||target.inVillage)return false;
   const c=squad.combat;
   if(c.mode==='melee'&&c.engaged)return c.foes.has(target);
   if(c.mode==='siege'||c.structure)endSiege(squad);
   if(c.mode==='melee'||c.mode==='approach'){for(const o of c.foes)o.combat.foes.delete(squad);c.foes.clear();for(const m of squad.members)release(m);}
   if(squad.needsReform)return false;
   c.pendingRoute=null;
   // CPU attacks also use this entry point. Only a new player attack gets
   // immediate routing priority; later pursuit corrections share the budget.
   c.urgentPath=squad.side==='player';
   if(c.urgentPath)c.failedTargets?.delete(target);
   c.run=!!run;c.target=target;c.ordered=true;c.moveOrder=false;c.repath=0;c.dest=null;c.think=0;c.mode='pursue';c.thrown=false;c.pilumOrder=!!pilum;return true;
  }
  // May the troop throw its javelins now (its endurance permitting)?
  function canThrow(squad){
   const st=squad.profile.stamina;if(!squad.profile.pilum||!squad.members.length)return false;if(!st)return true;
   let sum=0;for(const m of squad.members)sum+=m.stamina??st.initial;
   return sum/squad.members.length>=st.max*PILUM_COST;
  }
  function throwPilum(squad,target){
   const w=squad.profile.pilum,st=squad.profile.stamina;if(!w||!alive(target))return false;
   for(const m of squad.members){
    const aim=target.members[Math.floor(random()*target.members.length)],range=dist(m,aim);
    const from={x:m.x,z:m.z,y:(m.y??groundY(m.x,m.z))+1.1};
    projectiles.push({from,to:{x:aim.x,z:aim.z,y:groundY(aim.x,aim.z)+.5},target:aim,t:0,time:.3+range/15+random()*.12,arc:.35+range*.09,
     weapon:w,side:squad.side,attacker:squad,ammo:'PILUM',x:from.x,y:from.y,z:from.z,dx:0,dy:0,dz:0});
    if(st)m.stamina=Math.max(0,(m.stamina??st.initial)-st.max*PILUM_COST);
   }
   squad.combat.thrown=true;squad.combat.pilumOrder=false;
   emit('pilum',{squad,target});emit('shoot',{squad,member:squad.members[0]});
   return true;
  }
  // Close ranks in the direction of a new movement order. Putting the new
  // block beyond the crew's leading man lets everyone withdraw towards it
  // instead of stepping back towards the building before turning around.
  function movementReform(squad,destination){
   if(!destination||!Number.isFinite(destination.x)||!Number.isFinite(destination.z))return null;
   const mid=centroid(squad),dx=destination.x-mid.x,dz=destination.z-mid.z,d=Math.hypot(dx,dz);
   if(d<.1)return null;
   const ux=dx/d,uz=dz/d,lead=Math.max(0,...squad.members.map(m=>(m.x-mid.x)*ux+(m.z-mid.z)*uz));
   const ahead=Math.min(d,lead+(squad.radius||1.5)+.3);
   return {yaw:Math.atan2(ux,uz),at:{x:mid.x+ux*ahead,z:mid.z+uz*ahead}};
  }
  function fightRegroupPose(squad,destination){
   const moving=movementReform(squad,destination),here=centroid(squad),t=alive(squad.combat.target)?centroid(squad.combat.target):null;
   return {yaw:moving?.yaw??(t?Math.atan2(t.x-here.x,t.z-here.z):squad.r),at:moving?.at||null};
  }
  function retryRegroupPose(squad,destination){
   const moving=movementReform(squad,destination);
   return {yaw:moving?.yaw??squad.reformYaw??squad.r,at:moving?.at||squad.reformAt||null};
  }
  // Where an interrupted building crew would close ranks when no new
  // movement direction is given. This read-only geometry is shared by the
  // actual interruption and its held-order forecast.
  function siegeRegroupAt(squad){
   const c=squad.combat,t=c.structure;
   if(t?.spots&&c.places&&squad.members.length){
    const mid=centroid(squad);let dx=mid.x-t.centre.x,dz=mid.z-t.centre.z,d=Math.hypot(dx,dz);
    if(d<.5&&c.from){dx=c.from.x-t.centre.x;dz=c.from.z-t.centre.z;d=Math.hypot(dx,dz);}
    if(d>1e-3){const far=(t.radius||2)*.8+(squad.radius||1.5)+.6;return {x:t.centre.x+dx/d*far,z:t.centre.z+dz/d*far};}
   }
   return null;
  }
  function regroup(squad,yaw=squad.r,at=null){
   // Planted men never left their rank positions during combat. Closing
   // ranks with the normal walking reformer would start an individual
   // movement job at their intentional speed of 0, leaving it stuck after
   // victory, a lost shooting target or a casualty. Keep the surviving
   // ranks where they stand until a deliberate order releases the stance.
   if(holdsRanks(squad)&&squad.formationState.stationary){
    motion.halt?.(squad);squad.needsReform=false;squad.reformAt=null;squad.reformYaw=null;squad.reformRetry=0;squad.blockedReason=null;
    return true;
   }
   // Sheltered troops stand above solid ground. Their building/village exit
   // places them outside; ground reformation must wait for that exit.
   const ready=!alive(squad)||!!squad.sheltered||!!squad.inVillage||!motion.reform||motion.reform(squad,navOf(squad),yaw,at)!==false;
   squad.needsReform=!ready;squad.reformAt=ready?null:at;squad.reformYaw=ready?null:yaw;squad.reformRetry=ready?0:.5;
   squad.blockedReason=ready?null:'La troupe ne peut pas encore se reformer sur un passage praticable.';
   return ready;
  }
  function leaveFight(squad,destination=null){
   const c=squad.combat;
   for(const o of c.foes)o.combat.foes.delete(squad);c.foes.clear();
   for(const m of squad.members)release(m);
   c.mode='idle';c.chargeTime=0;squad.running=false;
   if(alive(squad)&&motion.reform){
    const pose=fightRegroupPose(squad,destination);
    return regroup(squad,pose.yaw,pose.at);
   }
   return true;
  }
  function move(squad,destination=null){
   const c=squad.combat;if(!c)return false;
   // A troop sheltering in its tent while it is promoted or demoted
   // (main.js squad.transform) takes no orders until that is done or called off.
   if(squad.transform){squad.blockedReason=IN_TENT;return false;}
   squad.blockedReason=null;
   // The original manual's melee lock: troops actually fighting take no
   // move, stop or reform orders until their opponents are destroyed. A squad
   // whose men are only waiting for room in a full fight can be pulled out.
   if(c.mode==='melee'&&c.engaged)return false;
   if(destination&&isFormationLocked(squad)){squad.blockedReason=FORMATION_LOCKED;return false;}
   if(destination&&formationPending(squad))resetFormation(squad);
   let ready=true;
   if(c.mode==='melee'||c.mode==='approach'||c.mode==='shoot')ready=leaveFight(squad,destination);
   else if(c.mode==='siege')ready=endSiege(squad,{destination});
   else if(squad.needsReform){const pose=retryRegroupPose(squad,destination);ready=regroup(squad,pose.yaw,pose.at);}
   c.pendingRoute=null;c.urgentPath=false;
   c.mode='idle';c.target=null;c.ordered=false;c.moveOrder=ready;c.run=false;squad.running=false;
   if(!ready)squad.blockedReason='La troupe ne peut pas encore se reformer sur un passage praticable.';
   return ready;
  }
  // Predict only the source formation that move() will release to locomotion.
  // Do not call move() on a clone: it would still unlink live foes, stop a
  // building's workers or fire events through the copied combat references.
  function previewMove(squad,destination=null){
   const c=squad?.combat;
   if(!c||!alive(squad))return {ok:false,source:squad||null,reason:'unavailable'};
   if(c.mode==='melee'&&c.engaged)return {ok:false,source:squad,reason:'melee'};
   if(destination&&isFormationLocked(squad))return {ok:false,source:squad,reason:'stationary',message:FORMATION_LOCKED};
   // Exiting a village/tower belongs to its owning building system. The
   // order preview may show an intended destination but not a certain route.
   if(squad.sheltered||squad.inVillage)return {ok:true,source:squad,provisional:true};
   let resetSource=null;
   if(destination&&formationPending(squad)){
    resetSource={...squad,members:squad.members.map(m=>({...m})),squeeze:squad.squeeze?{...squad.squeeze}:undefined,
     forced:squad.forced?{...squad.forced}:undefined};
    resetFormation(resetSource);
   }
   const fighting=c.mode==='melee'||c.mode==='approach'||c.mode==='shoot';
   const crew=c.mode==='siege'&&!!c.places;
   const needsRegroup=fighting||(c.mode==='siege'?(crew||(resetSource||squad).needsReform):(resetSource||squad).needsReform);
   if(!needsRegroup||!motion.reform)return {ok:true,source:resetSource||squad};
   const source=resetSource||{...squad,members:squad.members.map(m=>({...m})),squeeze:squad.squeeze?{...squad.squeeze}:undefined,
    forced:squad.forced?{...squad.forced}:undefined};
   const grid=navOf(squad);let pose;
   if(fighting)pose=fightRegroupPose(source,destination);
   else if(c.mode==='siege'){
    const fallback=siegeRegroupAt(source);
    if(crew)stepOut(source,grid);
    const moving=movementReform(source,destination);
    pose={yaw:moving?.yaw??source.r,at:moving?.at||fallback};
   }else pose=retryRegroupPose(source,destination);
   if(motion.reform(source,grid,pose.yaw,pose.at)===false)return {ok:false,source,regroup:true,reason:'reform'};
   // reform() normally lets the living men walk into these slots. A forecast
   // materializes them only on its private members, as the route must depict
   // the re-formed block rather than holes left by casualties or crew places.
   const job=source.individualTurn;
   if(job){
    for(const soldier of job.soldiers){
     Object.assign(soldier.m,{dx:soldier.slot.dx,dz:soldier.slot.dz,x:soldier.to.x,z:soldier.to.z,r:job.yaw});
    }
    source.r=job.yaw;source.squeeze=job.q;source.individualTurn=null;
   }
   source.needsReform=false;source.reformAt=null;source.reformYaw=null;
   return {ok:true,source,regroup:true};
  }
  function kill(member,attacker){
   const squad=member.squad;member.hp=0;release(member);
   if(attacker?.members&&attacker!==squad)attacker.kills=(attacker.kills||0)+1;
   if(motion.removeMember)motion.removeMember(squad,member);else squad.members.splice(squad.members.indexOf(member),1);
   squad.fallen++;squad.dirty=true;
   const activeFormation=squad.formationState;
   if(formations&&activeFormation&&!activeFormation.pending&&activeFormation.mode!=='standard'&&
      squad.members.length>0&&squad.members.length<(formations.current(squad)?.minimum||0)){
    resetFormation(squad);emit('formationLost',{squad,formation:activeFormation.id,reason:'minimum'});
   }
   squad.dying.push({x:member.x,y:member.y??groundY(member.x,member.z),z:member.z,r:member.r,variant:Math.floor(random()*3),time:0});
   emit('death',{squad,member,attacker});
   if(!squad.members.length){
    squad.destroyed=true;
    if(squad.combat.structure)endSiege(squad,{reform:false});
    for(const o of squad.combat.foes)o.combat.foes.delete(squad);squad.combat.foes.clear();squad.combat.mode='idle';
    emit('destroyed',{squad,attacker});
   }
   else if(squad.combat.mode!=='melee'&&squad.combat.mode!=='shoot'&&!squad.isMoving)squad.needsReform=true;
  }
  function hit(member,amount,attacker,kind){
   if(!valid(member))return false;member.hp-=amount;metrics.damageEvents++;
   const squad=member.squad;
   emit('hit',{squad,member,amount,attacker,kind});if(member.hp<=0)kill(member,attacker);
   if(kind==='projectile')underFire(squad,attacker);
   return true;
  }
  // Shot at while standing idle: an aggressive troop goes for the shooters
  // (pursue brings it within reach; bowmen shoot back from range). A
  // defensive troop's bowmen answer only if the shooters are within range
  // (pursue drops them otherwise); its other men hold their ground.
  function underFire(squad,attacker){
   const c=squad.combat;
   if(!alive(squad)||!alive(attacker)||!hostile(squad,attacker)||attacker.sheltered||attacker.inVillage)return;
   if(c.mode!=='idle'||c.target||c.moveOrder||squad.isMoving||squad.needsReform||squad.sheltered||squad.inVillage||squad.transform||squad.profile.noAttack)return;
   if(c.aggressive===false||(c.stance==='defensive'&&!squad.profile.ranged))return;
   c.target=attacker;c.mode='pursue';c.repath=0;
   // Followed as far as the shooters' reach, not only the troop's own radius.
   c.chase={target:attacker,reach:Math.max(gap(squad,attacker),attacker.profile.ranged?.rangeMax||0)+6};
  }
  // The player's men only pick targets the player can see (the game marks
  // enemies hidden by fog, forest or height with visible=false).
  // Troops sheltering in a watchtower cannot be reached: the tower is.
  // Troops lying hidden in tall grass (squad.concealed) are seen by nobody
  // farther than CONCEALED_SIGHT.
  const unseen=(viewer,s,d=0)=>(viewer.side==='player'&&s.visible===false)||!!s.sheltered||!!s.inVillage||(Concealment.isHidden(s)&&d>CONCEALED_SIGHT);
  function failedTarget(squad,target){
   const c=squad.combat,entry=c.failedTargets?.get(target);if(!entry)return null;
   const nav=navOf(squad),there=target.combat;
   // Gates, bridges, casualties changing formation width, or an army moving
   // around the obstacle make the previous failure irrelevant immediately.
   if(!alive(target)||entry.nav!==nav||entry.revision!==(nav?.revision??0)||entry.radius!==squad.radius||
    Math.hypot(squad.x-entry.x,squad.z-entry.z)>1||Math.hypot(there.cx-entry.tx,there.cz-entry.tz)>2.5){
    c.failedTargets.delete(target);return null;
   }
   return entry;
  }
  function retryBlocked(squad,target){
   const entry=failedTarget(squad,target);
   if(entry){
    const ranged=squad.profile.ranged,d=Math.hypot(squad.combat.cx-target.combat.cx,squad.combat.cz-target.combat.cz);
    // A target that comes into firing range or a clear charge needs no route
    // at all. Remembering an old failure must not make us ignore that threat.
    if(ranged?d<=ranged.rangeMax*.95&&d>=ranged.rangeMin:closeEnough(squad,target,CHARGE_BREAK)){
     squad.combat.failedTargets.delete(target);return false;
    }
    if(clock+1e-8<entry.until){metrics.retrySkips++;return true;}
   }
   return false;
  }
  function rememberFailure(squad,target){
   const c=squad.combat,previous=failedTarget(squad,target),nav=navOf(squad),there=target.combat;
   const failures=(previous?.failures||0)+1,delay=Math.min(RETRY_MAX,RETRY_BASE*2**Math.min(2,failures-1));
   const memory=c.failedTargets||(c.failedTargets=new Map());
   memory.delete(target);
   while(memory.size>=FAILED_TARGET_LIMIT)memory.delete(memory.keys().next().value);
   memory.set(target,{nav,revision:nav?.revision??0,radius:squad.radius,x:squad.x,z:squad.z,tx:there.cx,tz:there.cz,failures,until:clock+delay});
  }
  function nearest(squad,within){
   let best=null,bestD=within;const c=squad.combat;
   for(const s of squads){if(!hostile(squad,s)||!alive(s))continue;
    const d=Math.hypot(c.cx-s.combat.cx,c.cz-s.combat.cz);if(d<bestD&&!unseen(squad,s,d)&&!retryBlocked(squad,s)){best=s;bestD=d;}}
   return best;
  }
  function nearestOf(squad,set){
   let best=null,bestD=Infinity;
   for(const s of set){if(!alive(s))continue;const d=gap(squad,s);if(d<bestD){best=s;bestD=d;}}
   return best;
  }
  function startCharge(squad,target){
   const c=squad.combat;c.target=target;c.mode='approach';c.chargeTime=0;squad.running=false;motion.halt?.(squad);
   if(!c.shouted){c.shouted=true;emit('charge',{squad,target});}
  }
  function stopShooting(squad){
   for(const m of squad.members)if(m.action==='shoot'||m.action==='load'||m.action==='aim')clearAction(m);
   if(squad.combat.mode==='shoot'){squad.combat.mode='idle';squad.needsReform=true;}
  }
  // Room on a squad: men attacked by fewer than MAX_ATTACKERS.
  const hasRoom=s=>s.members.some(m=>(m._attackers||0)<MAX_ATTACKERS);
  function nearestWithRoom(squad,within){
   let best=null,bestD=within;
   for(const s of squads){if(!hostile(squad,s)||!alive(s)||!hasRoom(s))continue;const d=gap(squad,s);if(d<bestD&&!unseen(squad,s,d)&&!retryBlocked(squad,s)){best=s;bestD=d;}}
   return best;
  }
  function think(squad){
   const c=squad.combat,p=squad.profile;
   if(formationPending(squad))return;
   if(c.mode==='siege')return;
   if(c.mode==='melee'||c.mode==='approach'){
    // A squad put straight into melee by a script is locked to its target.
    if(c.mode==='melee'&&!c.foes.size&&alive(c.target)&&hostile(squad,c.target))link(squad,c.target);
    for(const o of c.foes)if(!alive(o)||gap(squad,o)>LINK_BREAK)unlink(squad,o);
    if(c.target&&!alive(c.target))c.target=null;
    if(!c.foes.size&&!c.target){
     // Victory, or the charge target fell to someone else. Carry on into a
     // fight with room right beside us (not a defensive troop), otherwise re-form.
     const next=p.ranged||holdsRanks(squad)||c.stance==='defensive'?null:nearestWithRoom(squad,FLOW_JOIN+c.radius);
     leaveFight(squad);c.ordered=false;
     if(next)startCharge(squad,next);
     return;
    }
    if(!c.foes.size&&c.mode==='melee')c.mode='approach';
    if(!c.target)c.target=nearestOf(squad,c.foes);
    // Every man is waiting: the squad's fight is full. The AI takes over and
    // attacks the nearest enemy with room close by, if there is one.
    if(!c.engaged&&!squad.members.some(m=>m.foe)){
     const next=p.ranged||holdsRanks(squad)||c.stance==='defensive'?null:nearestWithRoom(squad,FLOW_JOIN+c.radius);
     if(next&&next!==c.target){c.target=next;c.chargeTime=0;}
    }
    if(c.mode==='approach'){
     // A charge that never connects (the target outran it) goes back to pursuit.
     c.chargeTime=squad.members.some(m=>m.foe)?c.chargeTime+THINK_INTERVAL:0;
     if(c.chargeTime>CHARGE_TIMEOUT){const t=c.target;leaveFight(squad);c.target=t;c.mode='pursue';c.repath=0;}
    }
    return;
   }
   if(c.target&&!alive(c.target)){
    c.target=null;c.ordered=false;
    if(c.mode==='shoot')stopShooting(squad);
    c.mode='idle';
   }
   if(c.moveOrder&&!squad.isMoving)c.moveOrder=false;
   if(c.moveOrder||c.target||p.noAttack)return;
   if(holdsRanks(squad)&&!squad.isMoving){
    // A special defensive posture may acquire an enemy in its actual reach,
    // but never turns an automatic acquisition into a march or a charge.
    const range=p.ranged?p.ranged.rangeMax:p.melee.rangeMax+BODY+c.radius;
    const target=nearest(squad,range);
    if(target){c.target=target;c.mode='pursue';c.repath=0;}
    return;
   }
   // The enemy AI attacks what it sees, preferring enemies with room, unless
   // a mission has made the squad non-aggressive (it then waits to be
   // attacked). The player's troops on Agressif (the default) do the same
   // once they stand still: they fall on enemies within their aggression
   // radius (RADIO2_AGRESION, else their sight). Defensive troops wait for
   // orders or fight back when attacked; their bowmen still shoot what
   // comes within range.
   if(squad.transform)return;
   if(squad.side==='player'&&c.stance!=='defensive'&&c.aggressive!==false&&!squad.isMoving&&!squad.sheltered&&!squad.inVillage){
    const range=isAnchored(squad)?(p.ranged?p.ranged.rangeMax:ANCHOR_REACH):Math.max(p.aggression,p.ranged?.rangeMax||0);
    const target=(p.ranged?null:nearestWithRoom(squad,range))||nearest(squad,range);
    if(target){c.target=target;c.mode='pursue';c.repath=0;}
   }else if(squad.side!=='player'&&c.aggressive!==false){
    // A hunting squad (mission tactic CazaYCaptura) seeks the army anywhere;
    // one holding a wall only what it can reach from there.
    const range=isAnchored(squad)?(p.ranged?p.ranged.rangeMax:ANCHOR_REACH):c.hunt?Infinity:p.aggression;
    const target=nearestWithRoom(squad,range)||nearest(squad,range);
    if(target){c.target=target;c.mode='pursue';c.repath=0;}
    // No troop to fight: a hostile structure within reach (a watchtower with
    // shooters inside, a garrison holding a village).
    else if(structureFor&&!isAnchored(squad)){const t=structureFor(squad,Math.min(range,30));if(t)attackStructure(squad,t);}
   }else if(p.ranged&&!squad.isMoving){
    const target=nearest(squad,p.ranged.rangeMax);
    if(target){c.target=target;c.mode='pursue';c.repath=0;}
   }
  }
  function order(squad,point,run,routeNav=null){
   if(squad.needsReform)return false;
   const result=motion.order(squad,point,routeNav||navOf(squad));if(result?.ok){squad.running=!!run&&canRun(squad);squad.combat.dest={...point};squad.combat.partialRoute=!!result.partial;return true;}return false;
  }
  // No route to the target: the owner of the world may send the squad
  // against what stands in the way (a gate); otherwise it gives up unless
  // ordered.
  function cannotReach(squad){
   const c=squad.combat;
   if(unreachable?.(squad,c.target))return;
   if(!c.ordered)c.target=null;
  }
  function performPursuitRoute(request){
   const {squad,target,point,run,interval,shout}=request,c=squad.combat;
   const urgent=c.urgentPath;c.urgentPath=false;c.repath=interval;metrics.pathRequests++;
   const routeNav=navOf(squad),before=routeNav?.workUnits;
   const result=!urgent&&routeNav?.withWorkBudget?
    routeNav.withWorkBudget(Math.max(0,PURSUIT_FRAME_WORK-frameRouteWork),()=>order(squad,point,run,routeNav),{allowPartial:true}):order(squad,point,run,routeNav);
   const ok=result===true,deferred=result?.deferred||result?.reason==='work-budget',after=routeNav?.workUnits;
   // Count deterministic navigation work, including failed subplans. One
   // cold search may exceed the work threshold; do not bundle another behind
   // it. Urgent player orders still run, but also consume this work allowance.
   if(frameRoutesRemaining!==null&&Number.isFinite(before)&&Number.isFinite(after))frameRouteWork+=Math.max(0,after-before);
   if(ok){
    c.failedTargets?.delete(target);
    if(shout&&!c.shouted){c.shouted=true;emit('charge',{squad,target});}
   }else if(deferred){
    // A sliced search has not proved this enemy unreachable. Keep its
    // combat intent and let the fair route queue give it another turn.
    c.repath=.5;
   }else{
    metrics.pathFailures++;rememberFailure(squad,target);cannotReach(squad);
   }
  }
  function requestPursuitRoute(squad,point,run,interval,shout=false){
   const c=squad.combat;if(squad.needsReform||retryBlocked(squad,c.target))return;
   if(c.urgentPath){c.pendingRoute=null;performPursuitRoute({squad,target:c.target,point,run,interval,shout});return;}
   let request=c.pendingRoute;
   if(!request){request={squad};c.pendingRoute=request;pursuitRoutes.push(request);}
   Object.assign(request,{target:c.target,point,run,interval,shout});
  }
  function drainPursuitRoutes(){
   let attempted=0;
   while(pursuitRoutes.length&&attempted<PURSUIT_ROUTES_PER_STEP&&(frameRoutesRemaining===null||(frameRoutesRemaining>0&&frameRouteWork<PURSUIT_FRAME_WORK))){
    const request=pursuitRoutes.shift(),{squad,target}=request,c=squad.combat;
    if(c.pendingRoute!==request)continue;
    c.pendingRoute=null;
    if(!alive(squad)||!alive(target)||c.target!==target||c.mode!=='pursue'||squad.needsReform||retryBlocked(squad,target))continue;
    performPursuitRoute(request);attempted++;
    if(frameRoutesRemaining!==null)frameRoutesRemaining--;
   }
   // This is the current backlog, not the number of routes already attempted.
   metrics.pathDeferred=pursuitRoutes.length;
  }
  function pursue(squad,dt){
   const c=squad.combat,p=squad.profile,target=c.target;if(!alive(target)){c.mode='idle';return;}
   const here=center(squad),there=center(target),d=dist(here,there);
   if(holdsRanks(squad)){
    if(p.ranged){
     if(d<=p.ranged.rangeMax&&d>=p.ranged.rangeMin){if(c.mode!=='shoot'){c.mode='shoot';motion.halt?.(squad);emit('aim',{squad,target});}}
     else{if(c.mode==='shoot')stopShooting(squad);c.mode='idle';c.target=null;c.ordered=false;}
    }else if(closeEnough(squad,target,p.melee.rangeMax+BODY))link(squad,target);
    else if(squad.formationState.mode==='testudo'&&!squad.formationState.stationary&&c.ordered){
     // A shield roof advances as its whole slow block, never as individual
     // charging men. It keeps the selected posture when given an attack.
     c.repath-=dt;
     if(c.repath<=0&&(!squad.isMoving||!c.dest||dist(c.dest,there)>2.5))requestPursuitRoute(squad,there,false,1);
    }
    else if(!c.ordered){c.mode='idle';c.target=null;}
    c.urgentPath=false;return;
   }
   // On a wall, unordered: shoot from it, fight on it, never climb down.
   if(!c.ordered&&isAnchored(squad)&&(p.ranged?!(d<=p.ranged.rangeMax*.95&&d>=p.ranged.rangeMin):d>ANCHOR_REACH+c.radius)){
    c.target=null;c.mode='idle';return;
   }
   // An enemy the player's troop took on by itself is let go once it has
   // drawn well beyond the troop's aggression radius (it outran them), or
   // beyond the reach of the shots it answered.
   const chase=c.chase?.target===target?c.chase.reach:Math.max(p.aggression,p.ranged?.rangeMax||0)*1.5;
   if(!c.ordered&&squad.side==='player'&&gap(squad,target)>chase){
    if(c.mode==='shoot')stopShooting(squad);c.target=null;c.mode='idle';return;
   }
   if(p.ranged){
    if(d<=p.ranged.rangeMax*.95&&d>=p.ranged.rangeMin){
     if(c.mode!=='shoot'){c.mode='shoot';motion.halt?.(squad);emit('aim',{squad,target});}c.urgentPath=false;return;
    }
    // Defensive bowmen shoot from where they stand.
    if(!c.ordered&&c.stance==='defensive'){if(c.mode==='shoot')stopShooting(squad);c.target=null;c.mode='idle';return;}
    if(c.mode==='shoot')stopShooting(squad);c.mode='pursue';
    // Back away when the target is inside the bow's minimum range.
    const want=p.ranged.rangeMin>d?p.ranged.rangeMin+1:p.ranged.rangeMax*.8,k=d>1e-6?(d-want)/d:0;
    const point={x:here.x+(there.x-here.x)*k,z:here.z+(there.z-here.z)*k};c.repath-=dt;
    if(c.repath<=0&&(!squad.isMoving||!c.dest||dist(c.dest,point)>3))requestPursuitRoute(squad,point,c.run,1.2);return;
   }
   // A defensive troop does not chase what it was not ordered to attack.
   if(!c.ordered&&c.stance==='defensive'&&!closeEnough(squad,target,CHARGE_BREAK)){c.target=null;c.mode='idle';return;}
   // Javelins first, within their range, then the charge.
   if(p.pilum&&!c.thrown&&(c.pilumOrder||squad.autoPilum!==false)&&d<=p.pilum.rangeMax&&d>=p.pilum.rangeMin&&canThrow(squad))throwPilum(squad,target);
   // The formation runs in; the last few metres every man charges his own foe.
   if(closeEnough(squad,target,CHARGE_BREAK)){c.urgentPath=false;startCharge(squad,target);return;}
   c.repath-=dt;
   if(c.repath<=0&&(!squad.isMoving||!c.dest||dist(c.dest,there)>2.5)){
    requestPursuitRoute(squad,there,c.run||d<14,1,d<14);
   }
  }
  // ---- Pairing ---------------------------------------------------------------
  const fighting=s=>alive(s)&&(s.combat.mode==='melee'||s.combat.mode==='approach');
  // Who a soldier may fight: the squad his own squad attacks, squads it is
  // locked with, and anyone attacking him. An enemy he took on by AI aggro
  // stays his while within AGGRO_HOLD.
  function eligible(m,o){
   if(!valid(o)||!hostile(o.squad,m.squad))return false;
   const c=m.squad.combat,s=o.squad;
   return c.foes.has(s)||s===c.target||o.foe===m||(o===m.foe&&dist(m,o)<=AGGRO_HOLD);
  }
  function foeSquads(m){const c=m.squad.combat,list=[...c.foes];if(alive(c.target)&&!c.foes.has(c.target))list.push(c.target);return list;}
  // Best opponent for m: someone attacking him first, then unclaimed men,
  // then the least crowded, all weighed against distance. If his squad's
  // fight is full he takes on any enemy with room close by; if there is none
  // he waits, facing m.watch, the nearest enemy.
  function pickFoe(m){
   metrics.targetSearches++;let best=null,score=Infinity,near=null,nearD=Infinity;
   const consider=(o,any)=>{
    if(!valid(o)||!hostile(o.squad,m.squad)||(!any&&!eligible(m,o)))return;const d=dist(m,o);
    if(d<nearD){nearD=d;near=o;}
    if(o===m._shun&&m._shunTime>0)return;
    const own=m.foe===o,claims=(o._attackers||0)-(own?1:0);
    if(claims>=MAX_ATTACKERS)return;
    const value=d-(o.foe===m?ANSWER_BONUS:0)-(claims?0:FREE_BONUS)+claims*CROWD_COST-(own?STICK_BONUS:0);
    if(value<score){score=value;best=o;}
   };
   for(const radius of PAIR_RADII){
    nearby(m.x,m.z,radius,o=>{if((o.x-m.x)**2+(o.z-m.z)**2<=radius*radius)consider(o);});
    if(best)break;
   }
   // Nobody close: look through the squads we fight and chase the best man.
   if(!best)for(const s of foeSquads(m))for(const o of s.members){metrics.neighborChecks++;consider(o);}
   // That fight is full: the AI takes on whoever is near.
   if(!best)nearby(m.x,m.z,AGGRO_RADIUS,o=>{if((o.x-m.x)**2+(o.z-m.z)**2<=AGGRO_RADIUS*AGGRO_RADIUS)consider(o,true);});
   m.watch=best?null:near;
   return best;
  }
  function pair(dt){
   const free=[],fresh=[],again=[];
   for(const s of squads)for(const m of s.members){
    m._attackers=0;
    if(m.foe&&(!fighting(s)||!eligible(m,m.foe))){breakSpot(m);m.foe=null;m.slot=null;}
    if(!fighting(s))m.watch=null;
   }
   for(const s of squads)for(const m of s.members)if(m.foe)m.foe._attackers++;
   for(const s of squads){
    if(!fighting(s))continue;
    for(const m of s.members){
     m._repair-=dt;
     if(m.foe){
      // Duels are kept. Anyone else checks every half second whether a
      // better opponent, above all one attacking him, is about.
      if(m.foe.foe!==m&&m.action!=='attack'&&m._repair<=0){m._repair=REPAIR_INTERVAL;again.push(m);}
     }else if(!m.watch)fresh.push(m);
     else if(m._repair<=0){m._repair=REPAIR_INTERVAL;free.push(m);}
    }
   }
   const spread=fresh.length>PAIR_BUDGET;
   for(const m of fresh)if(!spread||(step+m.combatId)%PAIR_SPREAD===0){m._repair=REPAIR_INTERVAL;free.push(m);}
   // Unattached men take the nearest unclaimed enemies, closest pairs first,
   // and an unattached enemy answers at once: neighbours become duels.
   const edges=[];
   for(const m of free){
    metrics.targetSearches++;
    for(const radius of PAIR_RADII){
     const before=edges.length;
     nearby(m.x,m.z,radius,o=>{
      if(o._attackers||!eligible(m,o)||(o===m._shun&&m._shunTime>0))return;
      const d2=(o.x-m.x)**2+(o.z-m.z)**2;if(d2<=radius*radius)edges.push({m,o,d2});
     });
     if(edges.length>before)break;
    }
   }
   edges.sort((a,b)=>a.d2-b.d2);
   for(const {m,o} of edges){
    if(m.foe||o._attackers)continue;
    setFoe(m,o);
    if(!o.foe&&fighting(o.squad)&&eligible(o,m)&&m._attackers<MAX_ATTACKERS)setFoe(o,m);
   }
   for(const m of free)if(!m.foe)again.push(m);
   for(const m of again){const o=pickFoe(m);if(o)setFoe(m,o);}
   let duels=0,waiting=0;
   for(const s of squads)if(fighting(s))for(const m of s.members){if(m.foe?.foe===m)duels++;else if(!m.foe)waiting++;}
   metrics.duels=duels/2;metrics.waiting=waiting;
  }
  // ---- Melee movement and blows ---------------------------------------------
  function walk(m,dx,dz){
   const grid=navOf(m.squad);
   for(const [x,z] of [[m.x+dx,m.z+dz],[m.x+dx,m.z],[m.x,m.z+dz]]){
    if(grid&&(!grid.canStand(x,z,MEMBER_RADIUS)||!grid.lineClear(m,{x,z},MEMBER_RADIUS)))continue;
    m.x=x;m.z=z;relocate(m);return true;
   }
   return false;
  }
  function nudge(m){
   let x=0,z=0;
   nearby(m.x,m.z,NUDGE_RADIUS,o=>{
    if(o===m)return;const ox=m.x-o.x,oz=m.z-o.z,d=Math.hypot(ox,oz);if(d>=NUDGE_RADIUS)return;
    if(d<1e-6){const a=m.combatId*2.39996;x+=Math.cos(a);z+=Math.sin(a);return;}
    const k=(NUDGE_RADIUS-d)/(NUDGE_RADIUS*d);x+=ox*k;z+=oz*k;
   });
   const l=Math.hypot(x,z);return l>1?{x:x/l,z:z/l}:{x,z};
  }
  function advanceTo(m,to,dt,stop=0){
   if(holdsRanks(m.squad))return false;
   const dx=to.x-m.x,dz=to.z-m.z,d=Math.hypot(dx,dz);if(d<=stop+1e-6)return false;
   const speed=m.squad.profile.speed,run=d>1.5&&rested(m),step=Math.min((run?speed*RUN_FACTOR:speed)*dt,d-stop),n=nudge(m);
   if(!walk(m,dx/d*step+n.x*NUDGE_SPEED*dt,dz/d*step+n.z*NUDGE_SPEED*dt))return false;
   m.r=Math.atan2(dx,dz);m.y=groundY(m.x,m.z);m.charging=run;return true;
  }
  function settle(m,dt){
   if(holdsRanks(m.squad))return;
   const n=nudge(m);if(Math.hypot(n.x,n.z)>.05&&walk(m,n.x*NUDGE_SPEED*dt,n.z*NUDGE_SPEED*dt))m.y=groundY(m.x,m.z);
  }
  // A man joining someone else's fight takes a free side of the enemy, so
  // two or three attackers surround him instead of stacking on one spot.
  function chooseSlot(m,foe,reach){
   const r=reach*DUEL_GAP,base=Math.atan2(m.z-foe.z,m.x-foe.x),grid=navOf(m.squad);let best=null,bestScore=Infinity;
   for(const k of [0,1,-1,2,-2,3,-3,4]){
    const a=base+k*Math.PI/4,x=foe.x+Math.cos(a)*r,z=foe.z+Math.sin(a)*r;
    if(grid&&!grid.canStand(x,z,MEMBER_RADIUS))continue;
    let crowd=0;nearby(x,z,SLOT_CROWD,o=>{if(o!==m&&o!==foe&&(o.x-x)**2+(o.z-z)**2<SLOT_CROWD*SLOT_CROWD)crowd++;});
    const score=crowd*2+Math.abs(k)*.4;if(score<bestScore){bestScore=score;best={dx:x-foe.x,dz:z-foe.z};}
   }
   return best;
  }
  function attackerOf(m,radius){
   let best=null,bestD=radius*radius;
   nearby(m.x,m.z,radius,o=>{if(o.foe!==m)return;const d2=(o.x-m.x)**2+(o.z-m.z)**2;if(d2<bestD){bestD=d2;best=o;}});
   return best;
  }
  function fight(squad,dt){
   const c=squad.combat;
   for(const m of squad.members){
    m._shunTime=(m._shunTime||0)-dt;
    const foe=m.foe;
    if(!foe){
     // No opponent with room: wait where he stands, facing the fight,
     // instead of crowding round the last enemies.
     clearAction(m);const watch=valid(m.watch)?m.watch:null;
     if(watch)m.r=Math.atan2(watch.x-m.x,watch.z-m.z);settle(m,dt);
     continue;
    }
    const d=dist(m,foe);
    const closeWeapon=squad.profile.formationClose;
    const w=closeWeapon&&d<=closeWeapon.rangeMax+BODY?closeWeapon:squad.profile.melee,reach=w.rangeMax+BODY;
    if(foe.foe===m){m.slot=null;if(!m.spot)duelSpot(m,foe);}
    else if(!m.slot&&m.action!=='attack'&&d<reach+1.5)m.slot=chooseSlot(m,foe,reach);
    const spot=m.spot?standOf(m):m.slot?{x:foe.x+m.slot.dx,z:foe.z+m.slot.dz}:null;
    // A swing starts once the foe stands still and m has his place; a foe
    // walking off is followed, not struck at, unless he lingers in reach.
    const close=d<=reach+1e-8,placed=!spot||dist(m,spot)<=SLOT_REACHED||m._blocked>.3;
    m._wait=close&&m.action!=='attack'?(m._wait||0)+dt:0;
    const ready=close&&(m.action==='attack'||(!foe.combatMoving&&placed)||m._wait>WAIT_IN_REACH);
    if(!ready){
     clearAction(m);
     m.combatMoving=advanceTo(m,spot||foe,dt);
     if(m.combatMoving)m._blocked=0;
     else if((m._blocked=(m._blocked||0)+dt)>GIVE_UP&&d>reach){m._shun=foe;m._shunTime=SHUN_TIME;setFoe(m,null);}
     continue;
    }
    m.combatMoving=false;m.charging=false;m._blocked=0;m.r=Math.atan2(foe.x-m.x,foe.z-m.z);
    metrics.contacts++;
    m.action='attack';m.attackVariant??=random()<.5?1:2;
    const cycleDuration=()=>{const native=attackDuration(squad,m,w);return Math.max(FIXED_STEP,w.interval,squad.formationState?.mode&&squad.formationState.mode!=='standard'?0:Number.isFinite(native)?native:0);};
    if(m._swing===null||m._swing===undefined){m._swingDuration=cycleDuration();m._swing=-Math.min(m._swingDuration*.5,m.cooldown||0);m._didHit=false;}
    m._swing+=dt;
    if(m._swing>=m._swingDuration){
     m._swing-=m._swingDuration;m._didHit=false;m.attackVariant=m.attackVariant===1?2:1;m._swingDuration=cycleDuration();
     // Between blows, a man on someone else's opponent turns on whoever is attacking him.
     if(foe.foe!==m&&m._attackers>0){const other=attackerOf(m,reach+.5);if(other&&eligible(m,other)&&other._attackers<MAX_ATTACKERS){setFoe(m,other);clearAction(m);continue;}}
    }
    const interval=m._swingDuration;
    m.actionTime=Math.max(0,m._swing);m.actionDuration=interval;m.attackInterval=interval;m.attackTime=m.actionTime/interval;
    if(!m._didHit&&m._swing>=interval*IMPACT_PHASE){m._didHit=true;pending.push({member:m,foe,weapon:w});}
   }
   const here=centroid(squad);squad.x=here.x;squad.z=here.z;
   if(alive(c.target)){const t=c.target.combat;squad.r=Math.atan2(t.cx-here.x,t.cz-here.z);}
   squad.dirty=true;
  }
  function resolveStrikes(){
   // Evaluate all contacts before applying damage: casualties cannot erase
   // another soldier's strike merely because his squad updated second.
   for(const strike of pending){const m=strike.member,foe=strike.foe;
    if(valid(m)&&valid(foe)&&dist(m,foe)<=strike.weapon.rangeMax+BODY+1e-8)strike.amount=damage(strike.weapon,foe.squad.profile);
   }
   for(const strike of pending)if(strike.amount&&valid(strike.foe)){
    emit('strike',{squad:strike.member.squad,member:strike.member,foe:strike.foe,amount:strike.amount});
    hit(strike.foe,strike.amount,strike.member.squad,'melee');
   }
   pending.length=0;
  }
  function shoot(squad,dt){
   const c=squad.combat,w=squad.profile.ranged,target=c.target;if(!alive(target)){stopShooting(squad);return;}
   const tc=center(target),d=dist(center(squad),tc);
   if(d>w.rangeMax*1.05||d<w.rangeMin){stopShooting(squad);c.mode='pursue';c.repath=0;return;}
   // A siege engine fires and reloads as its own clips run (the catapult's
  // DISPARAR_MAQUINA 2.4 s, CARGAR_MUNICION_MAQUINA 5.8 s), its shot leaving
  // as the arm or the bow strikes; a bowman draws for a second.
  const siege=SIEGE_SHOTS[w.ammo];
  const release=siege?Math.min(w.interval*.5,clipDuration(squad,'shoot')||1):.36;
  const draw=siege?Math.min(w.interval*.75,clipDuration(squad,'load')||SHOOT_DRAW):Math.min(SHOOT_DRAW,w.interval*.75);
  for(const m of squad.members){
    m.r=Math.atan2(tc.x-m.x,tc.z-m.z);m.cooldown-=dt;m._release=Math.max(0,(m._release||0)-dt);
    if(m.cooldown<=1e-8){
    m.cooldown+=w.interval;m._release=release;
    const aim=target.members[Math.floor(random()*target.members.length)];
    if(siege){m._launch={at:release*siege.launch,aim:{x:aim.x,z:aim.z},target:aim};}
    else launch(squad,m,w,aim);
    emit('shoot',{squad,member:m});
    }
    if(m._launch&&(m._launch.at-=dt)<=0){const l=m._launch;m._launch=null;launch(squad,m,w,valid(l.target)?l.target:null,l.aim);}
    if(m._release>0){m.action='shoot';m.actionDuration=release;m.actionTime=release-m._release;}
    else if(m.cooldown<=draw){m.action='load';m.actionDuration=draw;m.actionTime=Math.max(0,draw-m.cooldown);}
    else{m.action='aim';m.actionDuration=1;m.actionTime=0;}
    m.attackTime=m.actionTime/m.actionDuration;
   }
   squad.dirty=true;
  }
  // A shot leaves. An arrow tracks its chosen living man (the original
  // manual: marching cannot dodge a normal arrow; if he dies in flight its
  // landing point can still hit a nearby enemy). Siege shots go where they
  // were aimed: a catapult's stone high over, to crush the men where it
  // lands; a ballista's bolt flat, through the line beyond.
  function launch(squad,m,w,target,aimPoint=null){
   const siege=SIEGE_SHOTS[w.ammo],aim=aimPoint||target;
   const from={x:m.x,z:m.z,y:(m.y??groundY(m.x,m.z))+(siege?.height??.9)};
   if(!siege){
    const range=dist(m,target);
    projectiles.push({from,to:{x:target.x,z:target.z,y:groundY(target.x,target.z)+.5},target,t:0,time:.45+range/14,arc:.5+range*.13,weapon:w,side:squad.side,attacker:squad,ammo:w.ammo||'FLECHA'});
    return;
   }
   if(siege.pierce){
    const dx=aim.x-m.x,dz=aim.z-m.z,d=Math.hypot(dx,dz)||1,reach=Math.max(d+2,w.rangeMax);
    const to={x:m.x+dx/d*reach,z:m.z+dz/d*reach};to.y=groundY(to.x,to.z)+.6;
    projectiles.push({from,to,target:null,t:0,time:reach/siege.speed,arc:.25,weapon:w,side:squad.side,attacker:squad,ammo:w.ammo,
     pierce:siege.pierce,hits:new Set(),px:from.x,pz:from.z});
    return;
   }
   const a=random()*Math.PI*2,r=random()*siege.scatter,to={x:aim.x+Math.cos(a)*r,z:aim.z+Math.sin(a)*r};to.y=groundY(to.x,to.z);
   const range=dist(m,to);
   projectiles.push({from,to,target:null,t:0,time:siege.flight+range/siege.speed,arc:1.5+range*.35,weapon:w,side:squad.side,attacker:squad,ammo:w.ammo,splash:siege.splash});
  }
  // A bolt strikes the men along the stretch it flew this step (each once).
  function boltPass(p){
   const ax=p.px,az=p.pz,bx=p.x,bz=p.z,lx=bx-ax,lz=bz-az,l2=lx*lx+lz*lz||1e-9;
   nearby((ax+bx)/2,(az+bz)/2,Math.sqrt(l2)/2+BOLT_REACH,o=>{
    if(p.hits.size>=p.pierce||p.hits.has(o)||!hostile(p.attacker,o.squad))return;
    const t=Math.max(0,Math.min(1,((o.x-ax)*lx+(o.z-az)*lz)/l2));
    if(Math.hypot(o.x-(ax+lx*t),o.z-(az+lz*t))>BOLT_REACH)return;
    p.hits.add(o);hit(o,damage(p.weapon,o.squad.profile),p.attacker,'projectile');
   });
   p.px=bx;p.pz=bz;
  }
  // A stone crushes every enemy within its splash: the full blow within half
  // of it, less towards the edge.
  function stoneFalls(p){
   let struck=0;const r=p.splash;
   nearby(p.to.x,p.to.z,r,o=>{
    if(!hostile(p.attacker,o.squad))return;
    const d=Math.hypot(o.x-p.to.x,o.z-p.to.z);if(d>r)return;
    const share=d<=r/2?1:1-.6*(d-r/2)/(r/2);
    hit(o,damage(p.weapon,o.squad.profile)*share,p.attacker,'projectile');struck++;
   });
   return struck;
  }
  function updateProjectiles(dt){
   for(let i=projectiles.length-1;i>=0;i--){
    const p=projectiles[i];p.t+=dt;const k=Math.min(1,p.t/p.time);
    if(valid(p.target)){p.to.x=p.target.x;p.to.z=p.target.z;p.to.y=groundY(p.to.x,p.to.z)+.5;}
    p.x=p.from.x+(p.to.x-p.from.x)*k;p.z=p.from.z+(p.to.z-p.from.z)*k;
    p.y=p.from.y+(p.to.y-p.from.y)*k+p.arc*4*k*(1-k);
    p.dx=(p.to.x-p.from.x)/p.time;p.dz=(p.to.z-p.from.z)/p.time;p.dy=(p.to.y-p.from.y)/p.time+p.arc*4*(1-2*k)/p.time;
    if(p.pierce&&!p.structure){boltPass(p);if(p.hits.size>=p.pierce)p.t=p.time;}
    if(k<1&&!(p.pierce&&p.hits.size>=p.pierce))continue;projectiles[i]=projectiles[projectiles.length-1];projectiles.pop();
    if(p.pierce&&!p.structure){emit('impact',{x:p.x,z:p.z,hit:p.hits.size>0,ammo:p.ammo,side:p.side});continue;}
    if(p.splash&&!p.structure){const struck=stoneFalls(p);emit('impact',{x:p.to.x,z:p.to.z,hit:struck>0,ammo:p.ammo,side:p.side,splash:p.splash});continue;}
    if(p.structure){if(p.structure.alive())strikeStructure(p.structure,structureDamage(p.weapon,p.structure.defenses),p.attacker);emit('impact',{x:p.to.x,z:p.to.z,hit:true,ammo:p.ammo,side:p.side,structure:true});continue;}
    let victim=valid(p.target)?p.target:null,best=.32*.32;
    if(!victim)nearby(p.to.x,p.to.z,.32,m=>{if(!hostile(p.attacker,m.squad))return;const d2=(m.x-p.to.x)**2+(m.z-p.to.z)**2;if(d2<best){best=d2;victim=m;}});
    if(victim)hit(victim,damage(p.weapon,victim.squad.profile),p.attacker,'projectile');
    emit('impact',{x:p.to.x,z:p.to.z,hit:!!victim,ammo:p.ammo,side:p.side});
   }
  }
  // ---- Structures ----------------------------------------------------------------
  // target: {centre, defenses, alive(), damage(amount, squad), approach(from, weapon)}
  // and, for buildings (src/world/buildings.js), spots/polar/rim (places round
  // it), hit(damage, fire, squad) and aimPoint().
  // The troop's best weapon against this structure's defences (damage per
  // second): archers' fire arrows, catapults' stones, rams' charge, or the
  // soldiers' DESMANTELAR.
  // Only weapons meant for buildings: DESMANTELAR (the men tear it down),
  // fire, or an engine's building damage - never pila or plain arrows, which
  // left troops standing at throwing range.
  const forBuildings=(name,w)=>name==='DESMANTELAR'||(w.damage?.fire||0)>0||(w.damage?.building||0)>0;
  function structureWeapon(type,defenses={building:100},squad=null){
   let best=null,bestRate=0;
   const weapons=squad?.profile.formationFire?{DESMANTELAR:stats[type]?.weapons.DESMANTELAR,FUEGO:squad.profile.formationFire}:stats[type]?.weapons||{};
   for(const [name,w] of Object.entries(weapons)){
    if(!w)continue;
    if(!forBuildings(name,w))continue;
    const d=structureDamage(w,defenses),rate=(d.life+d.fire)/Math.max(.1,w.interval||1);
    if(rate>bestRate){bestRate=rate;best=w;}
   }
   return best;
  }
  // As the original (Praetorians.exe 0x465c30): MELEE, PROYECTIL, EDIFICIO
  // and GOLPE x the structure's DEFENSAS % harm it; INCENDIO x its INCENDIO %
  // feeds its fire instead (buildings.js addFire).
  function structureDamage(weapon,defenses){
   const d=weapon.damage||{},r=defenses||{};
   return {life:((d.melee||0)*(r.melee??0)+(d.projectile||0)*(r.projectile??0)+(d.building||0)*(r.building??100)+(d.blow||0)*(r.blow??0))/100,
    fire:(d.fire||0)*(r.fire??0)/100};
  }
  const fireOnly=(weapon,t)=>{const d=structureDamage(weapon,t.defenses);return d.fire>0&&d.life<=0;};
  function strikeStructure(t,d,squad){
   if(t.hit)t.hit(d.life,d.fire,squad);else if(d.life+d.fire>0)t.damage(d.life+d.fire,squad);
  }
  // job 'attack': strike it; 'work': build or repair it (target.work).
  const WORK_SWING=.8,STRUCTURE_REACH=1.6;
  const structureInRangedReach=(squad,target,weapon)=>{
   if(weapon?.kind!=='ranged')return false;
   const range=dist(centroid(squad),target.centre);
   return range>=(weapon.rangeMin||0)&&range<=(weapon.rangeMax||0);
  };
  function attackStructure(squad,target,job='attack',{run=false}={}){
   if(!alive(squad)||!target?.alive())return false;
   if((job==='attack'&&squad.profile.noAttack)||squad.transform)return false;
   if(formationPending(squad)){if(isFormationLocked(squad))squad.blockedReason=FORMATION_LOCKED;return false;}
   let weapon=job==='work'?{kind:'melee',interval:WORK_SWING,damage:{}}:structureWeapon(squad.type,target.defenses,squad);if(!weapon)return false;
   // Fire arrows add nothing to a building already burning at its fullest.
   if(job==='attack'&&fireOnly(weapon,target)&&target.fireFull?.())return false;
   const c=squad.combat;
   if(c.mode==='melee'&&c.engaged)return false;
   // Planted archers can volley from their ranks. Any structure job needing
   // an approach, dismantling or work waits for an explicit standing choice.
   if(isFormationLocked(squad)&&!(job==='attack'&&structureInRangedReach(squad,target,weapon))){
    squad.blockedReason=FORMATION_LOCKED;return false;
   }
   if(['melee','approach','shoot'].includes(c.mode))leaveFight(squad);
   if(c.mode==='siege')endSiege(squad);
   if(squad.needsReform)return false;
   c.run=!!run&&canRun(squad);c.structure=target;c.siegeWeapon=weapon;c.job=job;c.mode='siege';c.target=null;c.ordered=true;c.moveOrder=false;c.repath=0;c.dest=null;c.spot=null;c.marched=false;c.from=centroid(squad);
   return true;
  }
  function stepOut(squad,grid=navOf(squad)){
   if(!grid?.canStand)return;
   for(const m of squad.members){
    if(grid.canStand(m.x,m.z,MEMBER_RADIUS))continue;
    search:for(let r=.2;r<=3;r+=.2)for(let a=0;a<24;a++){
     const x=m.x+Math.cos(a*Math.PI/12)*r,z=m.z+Math.sin(a*Math.PI/12)*r;
     if(grid.canStand(x,z,MEMBER_RADIUS)){m.x=x;m.z=z;m.y=groundY(x,z);break search;}
    }
   }
   squad.dirty=true;
  }
  function endSiege(squad,{reform=true,destination=null}={}){
   const c=squad.combat,t=c.structure,wasSiege=c.mode==='siege',crew=!!c.places;
   if(!wasSiege&&!t&&!crew)return true;
   const at=siegeRegroupAt(squad);
   // A crew that worked round a building forms up again outside it, on the
   // side where most of its men stand (then where it came from).
   const needsRegroup=crew||squad.needsReform;
   t?.stop?.(squad);c.structure=null;c.siegeWeapon=null;c.job=null;c.spot=null;c.places=null;c.marched=false;c.from=null;c.run=false;c.dest=null;c.repath=0;c.ordered=false;
   if(wasSiege)c.mode='idle';
   for(const m of squad.members){clearAction(m);m._siege=undefined;m.pose=null;m._placed=false;m._workStuck=0;m._route=null;m._routeTo=null;}
   squad.needsReform=false;squad.reformAt=null;squad.reformYaw=null;squad.reformRetry=0;
   // A finished building stands on more ground than the scaffold its crew
   // lined: men left inside its walls step out to the nearest free ground,
   // or no route to their places could start (the troop stayed stuck round it).
   if(crew)stepOut(squad);
   // Start closing ranks now, before the next movement order plans its
   // route. The crew's centroid can be too close to the wall for a block;
   // deferring this until the march ends used to cancel that new order and
   // pull the men back to the old building several seconds later.
   if(reform&&needsRegroup&&alive(squad)&&motion.reform){
    const moving=movementReform(squad,destination);
    return regroup(squad,moving?.yaw??squad.r,moving?.at||at);
   }
   return true;
  }
  // ---- Crews round a building ----------------------------------------------------
  // Builders, repairers and the men who storm a building do not work from
  // their formation: as in the original, builders march onto the site and
  // step out to its edges; attackers press against the side they come from.
  // Each man takes the nearest free place against the walls (target.spots),
  // packed rows deep, and works there - builders with their CONSTRUIR clips,
  // attackers striking. Only the men at their places count. Afterwards the
  // troop forms up again outside (endSiege: reformAt).
  function assignPlaces(members,spots){
   // Each man the nearest free place, the men nearest the walls first: the
   // troop packs against the side it stands on, rows deep (the original).
   const free=spots.slice(),out=new Array(members.length);
   const nearest=m=>{let best=-1,bestD=Infinity;for(let k=0;k<free.length;k++){const d=(free[k].x-m.x)**2+(free[k].z-m.z)**2;if(d<bestD){bestD=d;best=k;}}return {k:best,d:bestD};};
   const order=members.map((m,i)=>({m,i,d:nearest(m).d})).sort((a,b)=>a.d-b.d);
   for(const {m,i} of order){
    if(!free.length){out[i]={x:m.x,z:m.z};continue;}
    const {k}=nearest(m);out[i]=free[k];free.splice(k,1);
   }
   return out;
  }
  // One walking step towards place p, by the man's own route round the
  // building (the navigation grid knows it is solid). False once there (or
  // after two seconds blocked).
  function walkRound(m,p,t,dt){
   const d=Math.hypot(p.x-m.x,p.z-m.z);if(d<.08){m._route=null;return false;}
   if(m._routeTo!==p){
    if(m._routeRetryAt>clock)return true;
    const grid=navOf(m.squad),before=grid?.workUnits;
    const plan=grid?.withWorkBudget?
     grid.withWorkBudget(Math.max(0,Math.min(1536,PURSUIT_FRAME_WORK-frameRouteWork)),()=>grid.plan({x:m.x,z:m.z},p,MEMBER_RADIUS)):
     grid?.plan({x:m.x,z:m.z},p,MEMBER_RADIUS);
    if(frameRoutesRemaining!==null&&Number.isFinite(before)&&Number.isFinite(grid?.workUnits))frameRouteWork+=Math.max(0,grid.workUnits-before);
    if(plan?.deferred||plan?.reason==='work-budget'){m._routeRetryAt=clock+.4+(m.combatId%7)*.04;return true;}
    m._routeRetryAt=0;
    m._route=plan?.ok?plan.points.slice(1):[];m._route.push(p);m._routeTo=p;
   }
   while(m._route.length>1&&Math.hypot(m._route[0].x-m.x,m._route[0].z-m.z)<.15)m._route.shift();
   const running=!!m.squad.combat.run&&d>1.5&&rested(m);m.charging=running;
   const next=m._route[0],dx=next.x-m.x,dz=next.z-m.z,l=Math.hypot(dx,dz)||1,move=Math.min(m.squad.profile.speed*(running?RUN_FACTOR:1)*dt,l);
   if(!walk(m,dx/l*move,dz/l*move)){m._workStuck=(m._workStuck||0)+dt;return m._workStuck<2;}
   m.r=Math.atan2(dx,dz);m.y=groundY(m.x,m.z);return true;
  }
  function crew(squad,t,dt){
   const c=squad.combat,w=c.siegeWeapon,working=c.job==='work',centre=t.workCentre||t.centre;
   if(!c.places||c.places.length!==squad.members.length){
    // The troop is there: the site's first stage rises round it (and the
    // men line that scaffold, not the finished building).
    if(working)t.begin?.();
    // Places on ground the men can stand on; with none, they work where they are.
    const grid=navOf(squad);let spots=t.spots(squad.members.length,center(squad),p=>!grid||grid.canStand(p.x,p.z,MEMBER_RADIUS));
    // Builders line the edges in one row all round before any second row;
    // attackers press rows deep against the side they come from.
    if(working){let rows=0;while(spots.filter(p=>(p.row||0)<=rows).length<squad.members.length&&rows<12)rows++;spots=spots.filter(p=>(p.row||0)<=rows);}
    c.places=spots.length?assignPlaces(squad.members,spots):squad.members.map(m=>({x:m.x,z:m.z}));
   }
   const build=working&&hasClip(squad,'build'),alternate=build&&hasClip(squad,'build2');
   const interval=Math.max(w.interval||WORK_SWING,FIXED_STEP),d=working?null:structureDamage(w,t.defenses);
   let placed=0;
   squad.members.forEach((m,i)=>{
    m.charging=false;
    if(!m._placed&&walkRound(m,c.places[i],t,dt)){m.combatMoving=true;m.pose=null;m.action=null;return;}
    m._placed=true;m.combatMoving=false;placed++;
    m.r=Math.atan2(centre.x-m.x,centre.z-m.z);
    if(build){m.action=null;m.pose=alternate&&m.combatId%2?'build2':'build';return;}
    // Attackers (and builders without builders' clips) swing at it.
    m.pose=null;m._siege=(m._siege??random()*interval)-dt;
    if(m._siege<=0){
     m._siege+=interval;
     if(d){strikeStructure(t,d,squad);if(random()<.12)emit('strike',{squad,member:m,structure:t,amount:d.life});}
    }
    m.action='attack';m.attackVariant??=1;m.actionDuration=interval;m.actionTime=Math.min(interval,Math.max(0,interval-m._siege));m.attackTime=m.actionTime/interval;
   });
   // The troop's mark (selection ring, regrouping) follows its men.
   const mid=centroid(squad);squad.x=mid.x;squad.z=mid.z;
   if(working){
    if(placed&&random()<dt*.6)emit('build',{squad,member:squad.members[Math.floor(random()*squad.members.length)],structure:t});
    t.work(squad,dt,placed);
   }
   squad.dirty=true;
  }
  // Archers and engines shoot at a building: real missiles (fire arrows
  // burning) that land on it.
  function volley(squad,t,dt){
   const w=squad.combat.siegeWeapon,interval=Math.max(w.interval||0,squad.profile.ranged?.interval||0)||1;
   if(fireOnly(w,t)&&t.fireFull?.()){endSiege(squad);squad.combat.ordered=false;emit('fireFull',{squad,structure:t});return;}
   // Fire arrows use the normal shooting cadence without spending stamina.
   // Ignition is balanced by the building's gradual fire accumulation.
   for(const m of squad.members){
    m.r=Math.atan2(t.centre.x-m.x,t.centre.z-m.z);m.cooldown=(m.cooldown??random()*interval)-dt;m._release=Math.max(0,(m._release||0)-dt);
    const draw=Math.min(SHOOT_DRAW,interval*.75),release=.36;
    if(m.cooldown<=1e-8){
     m.cooldown+=interval;m._release=release;
     const to=t.aimPoint?t.aimPoint(random):{x:t.centre.x,z:t.centre.z,y:groundY(t.centre.x,t.centre.z)+1.5},range=Math.hypot(to.x-m.x,to.z-m.z),flight=.45+range/14;
     projectiles.push({from:{x:m.x,z:m.z,y:(m.y??groundY(m.x,m.z))+.9},to,target:null,structure:t,t:0,time:flight,arc:.5+range*.13,weapon:w,side:squad.side,attacker:squad,ammo:w.ammo||'FLECHA'});
     emit('shoot',{squad,member:m});
    }
    if(m._release>0){m.action='shoot';m.actionDuration=release;m.actionTime=release-m._release;}
    else if(m.cooldown<=draw){m.action='load';m.actionDuration=draw;m.actionTime=Math.max(0,draw-m.cooldown);}
    else{m.action='aim';m.actionDuration=1;m.actionTime=0;}
    m.attackTime=m.actionTime/m.actionDuration;
   }
   squad.dirty=true;
  }
  function siege(squad,dt){
   const c=squad.combat,t=c.structure,w=c.siegeWeapon;
   if(!t||!w||!t.alive()){endSiege(squad);c.ordered=false;return;}
   const here=center(squad),ranged=c.job!=='work'&&w.kind==='ranged',surround=!!t.spots&&!ranged;
   // The ordinary approach point favours 80% weapon range. A planted
   // archer at the outer part of its reach must shoot where it stands,
   // rather than receive a march order while its speed is deliberately 0.
   if(squad.formationState?.stationary&&ranged){
    if(!structureInRangedReach(squad,t,w)){endSiege(squad);return;}
    if(squad.isMoving)motion.halt?.(squad);
    volley(squad,t,dt);return;
   }
   // A crew spreads round the building once near it, or once its march there
   // is over (a march cut short no longer leaves it standing idle).
   const arrived=c.marched&&!squad.isMoving,near=c.job==='work'?(c.spot&&dist(here,c.spot)<=1.5):dist(here,t.centre)<=(t.radius||2)+c.radius+5;
   if(surround&&(c.places||near||arrived)){
    if(squad.isMoving)motion.halt?.(squad);
    crew(squad,t,dt);return;
   }
   // Where to stand: chosen once per job, on the near side; if no route
   // leads there, the next places round the structure are tried.
   const weapon=c.job==='work'?null:w;
   c.spot??=t.approach(here,weapon);
   const spot=c.spot,d=dist(here,spot);
   if(d>(ranged?2.5:1.2+c.radius*.4)){
    for(const m of squad.members)clearAction(m);
    c.repath-=dt;
    if(c.repath<=0&&(!squad.isMoving||!c.dest||dist(c.dest,spot)>1.5)){
     c.repath=1.5;
     const grid=navOf(squad),before=grid?.workUnits;
     const attempt=()=>{
      if(order(squad,spot,c.run,grid))c.marched=!c.partialRoute;
      else{
       const next=(t.ring?.(here,weapon)||[]).find(p=>dist(p,spot)>.5&&order(squad,p,c.run,grid));
       if(next){c.spot=next;c.marched=!c.partialRoute;}else endSiege(squad);
      }
     };
     const result=grid?.withWorkBudget?grid.withWorkBudget(Math.max(0,PURSUIT_FRAME_WORK-frameRouteWork),attempt,{allowPartial:true}):attempt();
     if(frameRoutesRemaining!==null&&Number.isFinite(before)&&Number.isFinite(grid?.workUnits))frameRouteWork+=Math.max(0,grid.workUnits-before);
     if(result?.deferred||result?.reason==='work-budget')c.repath=.4;
    }
    return;
   }
   if(squad.isMoving)motion.halt?.(squad);
   if(ranged){volley(squad,t,dt);return;}
   if(surround){crew(squad,t,dt);return;}
   // Fortress gates: the men within reach of them strike; a crew builds.
   const aim=t.centre,interval=Math.max(w.interval,FIXED_STEP),building=c.job==='work',hit=building?null:structureDamage(w,t.defenses);
   if(building)t.work(squad,dt);
   const reach=(w.rangeMax||.5)+STRUCTURE_REACH;
   for(const m of squad.members){
    m.r=Math.atan2(aim.x-m.x,aim.z-m.z);
    if(!building&&t.distanceTo&&t.distanceTo(m)>reach){clearAction(m);m._siege=undefined;continue;}
    m._siege=(m._siege??random()*interval)-dt;
    if(m._siege<=0){
     m._siege+=interval;
     if(building){if(random()<.04)emit('build',{squad,member:m,structure:t});}
     else{strikeStructure(t,hit,squad);if(random()<.15)emit('strike',{squad,member:m,structure:t,amount:hit.life});}
    }
    m.action='attack';m.attackVariant??=1;m.actionDuration=interval;m.actionTime=Math.min(interval,Math.max(0,interval-m._siege));m.attackTime=m.actionTime/interval;
   }
   squad.dirty=true;
  }
  // ---- Endurance ---------------------------------------------------------------
  const rested=m=>{const st=m.squad.profile.stamina;return !st||m.stamina===undefined||m.stamina>st.max*RUN_FLOOR;};
  function endurance(squad,dt){
   const st=squad.profile.stamina;if(!st||!squad.members.length)return;
   const marching=squad.running&&squad.isMoving;let sum=0;
   for(const m of squad.members){
    m.stamina??=st.initial;
    if(marching||m.charging)m.stamina=Math.max(0,m.stamina-st.max*RUN_DRAIN*dt);
    else m.stamina=Math.min(st.max,m.stamina+st.growth/REST_PERIOD*dt);
    sum+=m.stamina;
   }
   squad.stamina=sum/squad.members.length;squad.staminaMax=st.max;
   // Out of breath: the troop walks.
   if(squad.running&&squad.stamina<=st.max*RUN_FLOOR){squad.running=false;squad.exhausted=true;emit('exhausted',{squad});}
   else if(squad.exhausted&&squad.stamina>st.max*RUN_FLOOR*2)squad.exhausted=false;
  }
  // May this troop run (FISICO: at least 10 % of its endurance)?
  function canRun(squad){
   if(squad.formationState?.canRun===false||formationPending(squad))return false;
   const st=squad.profile?.stamina;if(!st)return true;
   const n=squad.members.length;if(!n)return false;
   let sum=0;for(const m of squad.members)sum+=m.stamina??st.initial;
   return sum/n>st.max*RUN_FLOOR;
  }
  function tick(dt){
   metrics.steps++;step++;clock+=dt;metrics.contacts=0;metrics.activeSoldiers=0;metrics.engagedSquads=0;
   for(const s of squads)if(alive(s))endurance(s,dt);
   for(const s of squads){if(!alive(s))continue;snapshot(s);
    metrics.activeSoldiers+=s.members.length;
    for(const m of s.members){
     if(m.px!==undefined){const k=Math.min(1,dt*6);m.vx=(m.vx||0)+((m.x-m.px)/dt-(m.vx||0))*k;m.vz=(m.vz||0)+((m.z-m.pz)/dt-(m.vz||0))*k;}
     m.px=m.x;m.pz=m.z;
    }
   }
   rebuildGrid();updateProjectiles(dt);
   for(const squad of squads){
    if(!alive(squad))continue;const c=squad.combat;c.think-=dt;
    if(c.think<=0){c.think+=THINK_INTERVAL;think(squad);}
   }
   pair(dt);
   for(const squad of squads){
    if(!alive(squad))continue;const c=squad.combat,mode=c.mode;
    if(mode==='melee'||mode==='approach'){if(mode==='melee')metrics.engagedSquads++;fight(squad,dt);}
    else if(mode==='shoot')shoot(squad,dt);
    else if(mode==='pursue')pursue(squad,dt);
    else if(mode==='siege')siege(squad,dt);
    else if(mode==='wait'&&alive(c.target))squad.r=Math.atan2(c.target.combat.cx-c.cx,c.target.combat.cz-c.cz);
    if(mode!=='melee'&&mode!=='approach'&&mode!=='shoot'&&mode!=='siege')for(const m of squad.members)clearAction(m);
    if(squad.needsReform&&!squad.isMoving&&!squad.sheltered&&c.mode!=='melee'&&c.mode!=='approach'&&c.mode!=='shoot'&&c.mode!=='siege'){
     squad.reformRetry=Math.max(0,(squad.reformRetry||0)-dt);
     if(!squad.reformRetry)regroup(squad,squad.reformYaw??squad.r,squad.reformAt||null);
    }
   }
   drainPursuitRoutes();
   for(const s of squads)s.combat.engaged=false;
   for(const squad of squads)if(fighting(squad))for(const m of squad.members){
    const foe=m.foe;if(!valid(foe))continue;const d=dist(m,foe);
    // Nobody is left swinging at a man who moved out of reach this step.
    if(m.action==='attack'&&d>squad.profile.melee.rangeMax+BODY+1e-8)clearAction(m);
    // An attacker who reaches his man locks both squads together; while any
    // man of a squad is in contact the squad counts as engaged.
    if(d<=CONTACT){if(!squad.combat.foes.has(foe.squad))link(squad,foe.squad);squad.combat.engaged=foe.squad.combat.engaged=true;}
   }
   resolveStrikes();metrics.projectiles=projectiles.length;metrics.activeSoldiers=squads.reduce((n,s)=>n+s.members.length,0);
  }
  function update(dt){
   if(!(dt>0)||!Number.isFinite(dt))return;
   metrics.steps=0;metrics.neighborChecks=0;metrics.targetSearches=0;metrics.damageEvents=0;
   metrics.pathRequests=metrics.pathDeferred=metrics.pathFailures=metrics.retrySkips=0;
   for(const s of squads)s.dirty=false;
   if(dt>MAX_CATCHUP)metrics.droppedTime+=dt-MAX_CATCHUP;
   accumulator+=Math.min(dt,MAX_CATCHUP);
   while(accumulator+1e-9>=FIXED_STEP){tick(FIXED_STEP);accumulator-=FIXED_STEP;}
  }
  // The live game may advance several fixed ticks after a delayed render.
  // Share one route quota across those catch-up ticks rather than multiplying
  // the expensive work by six. Standalone simulations that never call this
  // retain the normal per-tick budget.
  function beginFrame(){frameRoutesRemaining=PURSUIT_ROUTES_PER_STEP;frameRouteWork=0;}
  // Mission scripting: attitude (SetActitudAgresiva) and change of side
  // (CambiarBando); a squad changing sides leaves any fight first.
  function setAggressive(squad,on){squad.combat.aggressive=!!on;}
  // Standing in burning wheat deals environmental HP damage. The source
  // INCENDIO coefficient governs ignition damage against structures; soldiers
  // have zero there, which must not make them immune to a burning field.
  // Weapon/structure damage keeps its own original defense calculation.
  function burn(member,amount){if(!(amount>0)||!Number.isFinite(amount))return false;return hit(member,amount,null,'fire');}
  // The player's attitude orders (ORDEN_ACTITUD_DEFENSIVA / OFENSIVA). A
  // defensive troop holds its ground: it never chases a target it was not
  // ordered to attack, its bowmen only shoot from where they stand, and it
  // does not carry on into a neighbouring fight. Aggressive is the default.
  function setStance(squad,stance){squad.combat.stance=stance==='defensive'?'defensive':'aggressive';}
  function setHunting(squad,on){squad.combat.hunt=!!on;if(on)squad.combat.aggressive=true;}
  function setSide(squad,side){
   if(squad.side===side)return;
   if(['melee','approach','shoot','pursue'].includes(squad.combat.mode))leaveFight(squad);
   if(squad.combat.mode==='siege')endSiege(squad);
   for(const o of squads)if(o.combat.target===squad&&o.combat.mode!=='melee'){o.combat.target=null;if(o.combat.mode==='pursue')o.combat.mode='idle';}
   squad.side=side;squad.combat.target=null;
  }
  return {add,attack,move,previewMove,setFormation,resetFormation,isFormationLocked,FORMATION_LOCKED,engage:link,setAggressive,setStance,setHunting,burn,CONCEALED_SIGHT,setSide,update,beginFrame,squads,projectiles,centroid,spread,damage,profile:type=>profile(stats,type),RUN_FACTOR,metrics,stats:metrics,getStats:()=>({...metrics}),
   attackStructure,endSiege,structureWeapon,structureDamage,canRun,canThrow,throwPilum,RUN_FLOOR,PILUM_COST};
 }
 return {create,profile,damage,SPEED_SCALE,RUN_FACTOR,FIXED_STEP,IMPACT_PHASE,MAX_ATTACKERS,CONTACT,FORMATION_LOCKED};
});
