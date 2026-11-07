/* Praetorians squad locomotion: one A* path for the formation, facing-first turns.
   The units share the squad's yaw and maintain their individual rotated slots.
   This module is deliberately independent of Babylon.js and game asset files. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansSquadMotion=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const TURN_SPEED=2.65;              // Radians per second; ~1.2s for an about-face.
 const FACING_TOLERANCE=.045;         // ~2.6 degrees before marching forward.
 const ARRIVAL_TOLERANCE=.035;
 // Collision is measured at the planted foot, not at the visible shoulder,
 // skirt or spear. Their visuals can graze foliage; a planted foot can also
 // enter a shallow, low-height MLG slope *fringe* up to the measured grace
 // distance. Water, actual cliffs, structures and the void never soften.
 // Keep the core radius consistent in planning, turning and each real step.
 const MEMBER_RADIUS=.06;
 const VISUAL_SHOULDER_RADIUS=.145; // X-ray only: NEVER used to permit a footstep.

 // Runtime centre check. A* already planned the route with the formation's
 // radius; at runtime every soldier is checked individually, which is what
 // lets a squeezed block pass where its full circle would not fit.
 const CENTRE_RADIUS=.3;
 // Squeezing: where a cliff or river crowds one side of the block, the
 // soldiers on that side close in towards the centre, then ease back out once
 // there is room. Each side (right/left/front/back) has its own factor.
 // Tactical marching never collapses into a single-file snake. Across-rank
 // spacing may close by 40%; ranks open up slightly front-to-back to keep personal space.
 const SQUEEZE_LEVELS=[1,.96,.92,.88,.84,.80,.76,.72,.68,.64,.60];
 const MIN_SQUEEZE=SQUEEZE_LEVELS[SQUEEZE_LEVELS.length-1];
 const SQUEEZE_RATE=1.55,RELAX_RATE=.48; // Factor change per second.
 const SQUEEZE_MARGIN=.075;           // Small preferred spacing at the *feet*, not the visual shoulders.
 const LOOKAHEAD=1.4,LOOKAHEAD_STEP=.35,HOLD_TIME=.6,MAX_HOLD=2.5;
 const SIDES=['xp','xn','zp','zn'];
 // Changing direction re-forms the block as in the original game: instead of
 // wheeling, every soldier turns towards his slot in the re-oriented block,
 // walks there and faces the new front. Soldiers already on a slot (an exact
 // about-face) just turn on the spot. Only tiny corrections pivot the block.
 const INDIVIDUAL_TURN=.14;           // ~8 degrees.
 const SOLDIER_TURN_SPEED=5.5;        // Radians per second for one soldier.
 const REPOSITION_STEP=.1;            // Smaller offsets are absorbed while turning.
 const TURN_STAGGER=.22;
 // Retry a blocked soldier's *individual* slot route occasionally, never
 // pathfinding for every soldier on every simulation tick.
 const SOLO_REPATH_AFTER=.65,SOLO_REPATH_COOLDOWN=2.5,SOLO_REPATH_GROUP_GAP=.25;
 const FORCED_RELAX=.3;               // Collision-driven squeeze wears off per second.
 let conflict=null;                   // Soldier whose slot failed the last safety check.
 // Small visual footwork only: ranks must remain one cohesive troop, not
 // drift farther behind the leader on long marches or bends.
 const ROW_SPACING=.47;               // Rank spacing of shape(); identifies ranks.
 // A troop's own spacing (squad.spacing {x: across, z: front to back}, set
 // by main.js from the unit's size: horses, chariots and the special troops
 // stand looser); everyone else keeps the regular .47 m grid.
 const rowSpacing=squad=>squad?.spacing?.z||ROW_SPACING;
 const RANK_LAG=.027,RANK_LAG_GROWTH=.0035; // Rank-bound, never independent route progress.
 const STRIDE_DRIFT=.023,PLACE_DRIFT=.013,SWAY=.029; // Organic movement, clipped by actual foot clearance.
 const STRETCH_IN=1.4,STRETCH_OUT=.55;  // Seconds to open up / close ranks.
 // Per-soldier footwork: only soldiers actually moving or turning step;
 // those already on their slot stand at rest while the others finish.
 const STEP_SPEED=.18,STEP_TURN_RATE=.6,STEP_HOLD=.12;
 // Flowing march: ranks follow the road; hairpins sharper than this re-form.
 const SHARP_CORNER=1.9,MIN_FLOW=.6,FLOW_LOOKAHEAD=.7;
 const FLOW_RANK_BLEND=.44;        // Very slight stagger as ranks enter a turn.
 const CORRIDOR_SAMPLE=.28;       // Sweep the *whole* block every 28 cm.
 const CORRIDOR_MEMBER_RADIUS=MEMBER_RADIUS; // Exactly the runtime foot core; prevents planner/runtime disagreement.
 // A safe narrowing is approached over distance, not sprung on every soldier
 // in one frame. The whole formation compresses by the same factor, then
 // naturally regains its original spacing after clearing the pinch point.
 const COMPRESSION_SLOPE=.27;     // Change in spacing factor per metre.
 const COMPRESSION_AHEAD=.5;     // Begin closing slightly before the tightest spot.
 const REPLAN_DELAY=1.8;          // Try a new full-formation road, never column.
 // The route may slide the whole intact rectangle sideways inside an open
 // corridor. This solves off-centre and angled gates that a centre-only A*
 // path misses; the offset is a smooth *formation-level* manoeuvre, never
 // independent soldier avoidance. All samples are checked against real MLG.
 const CORRIDOR_SHIFT=.08,NORMAL_CORRIDOR_SHIFT=.64,MAX_CORRIDOR_SHIFT=1.28,SHIFT_SLOPE=.63;
 const depthScale=width=>1+.32*(1-width);

 // A rank swings round a bend over a stretch of road scaled to its width, and
 // the block slows in bends so the outer flank never has to run.
 const MAX_FLANK_SPEED=1.75;           // Times marching speed.
 // Optional tracing hooks. This file behaves identically when the X-Ray tool
 // is not installed. Hooks report attempted positions; they never alter a result.
 function debugEnabled(){return typeof globalThis!=='undefined'&&globalThis.PraetMovementXray?.active===true;}
 function debugTrace(squad,kind,details){
  if(!debugEnabled())return;
  try{globalThis.PraetMovementXray.event(squad,kind,details);}catch(_ignored){}
 }
 // A route diagnosis is data, not a second collision system: record the
 // FIRST rejected swept footprint so F6 can show where planning failed.
 function routeIssue(report,kind,p,extra={}){
  if(report&&!report.issue&&p&&Number.isFinite(p.x)&&Number.isFinite(p.z))
   report.issue={kind,at:{x:p.x,z:p.z},...extra};
 }
 // Only member foot contacts receive fringe tolerance. Centre navigation
 // remains the original strict terrain rule, preserving impassable barriers.
 const footClear=(nav,x,z,r=MEMBER_RADIUS)=>
  (nav.canMarchFoot||nav.canStand).call(nav,x,z,r);
 const footSweep=(nav,a,b,r=MEMBER_RADIUS)=>
  (nav.marchLineClear||nav.lineClear).call(nav,a,b,r);
 // The navigable unit is the centre + the two innermost FILES. The
 // two neighbouring files on each side are visual formation wings, not four
 // more independent pathfinders. This lets an intact six-file infantry block
 // march beside broad, FLAT painted MLG fringes without shrinking to a thin
 // spearhead. The nav layer still checks height, deep water, buildings and
 // world bounds for EVERY wing foot, and the core must remain on clear ground.
 // Sparse mounted formations and wall-file movement keep stricter clearance.
 function coreFile(squad){
  if(Number.isFinite(squad.coreFile))return squad.coreFile;
  const positive=squad.members.map(m=>Math.abs(m.dx)).filter(v=>v>1e-5);
  return positive.length?Math.min(...positive):0;
 }
 function isWing(squad,m){
  return !squad.files&&(squad.spacing?.x||ROW_SPACING)<=.55&&
   Math.abs(m.dx)>coreFile(squad)+1e-4;
 }
 function inwardFoot(squad,m,p,scale=1){
  const h=p.r??squad.r,sign=Math.sign(m.dx);
  const overhang=(Math.abs(m.dx)-coreFile(squad))*scale;
  return {x:p.x-Math.cos(h)*sign*overhang,z:p.z+Math.sin(h)*sign*overhang};
 }
 function formationFoot(squad,nav,m,p,scale=1){
  if(footClear(nav,p.x,p.z,CORRIDOR_MEMBER_RADIUS))return true;
  return isWing(squad,m)&&!!nav.canWingFoot&&
   nav.canWingFoot(p.x,p.z,CORRIDOR_MEMBER_RADIUS,inwardFoot(squad,m,p,scale));
 }
 function formationSweep(squad,nav,m,a,b,scaleA=1,scaleB=scaleA){
  if(footSweep(nav,a,b,CORRIDOR_MEMBER_RADIUS))return true;
  return isWing(squad,m)&&!!nav.wingLineClear&&
   nav.wingLineClear(a,b,CORRIDOR_MEMBER_RADIUS,
    inwardFoot(squad,m,a,scaleA),inwardFoot(squad,m,b,scaleB));
 }
 // Broad reversals are soldier-level manoeuvres, not a 180-degree wheel
 // of the *whole* rectangle. The men exchange their logical slots, turn on
 // their own feet and only then resume the shared march.
 const ABOUT_FACE_ANGLE=2.35; // about 135 degrees (catches imperfect mouse directions).
 const aboutFace=(a,b)=>Math.abs(deltaAngle(a,b))>=ABOUT_FACE_ANGLE;
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 const deltaAngle=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));

 const widestFront=count=>count>=24?6:count>=12?4:Math.ceil(Math.sqrt(count));
 function shape(count,spacing=null){
  const columns=widestFront(count);
  const rows=Math.ceil(count/columns),across=spacing?.x||ROW_SPACING,deep=spacing?.z||ROW_SPACING;
  return Array.from({length:count},(_,i)=>({
   dx:((i%columns)-(columns-1)/2)*across,
   dz:(Math.floor(i/columns)-(rows-1)/2)*deep
  }));
 }
 // Special postures supply native slot geometry; ordinary movement retains
 // its established block layout. Never accept a malformed authored shape.
 function squadShape(squad,count){
  const slots=squad.formationShape?.(count);
  return slots?.length===count&&slots.every(p=>Number.isFinite(p.dx)&&Number.isFinite(p.dz))?slots:shape(count,squad.spacing);
 }
 const unsqueezed=()=>({xp:1,xn:1,zp:1,zn:1});
 // A soldier's slot after squeezing: each half of the block scales separately.
 function offset(m,q){
  return {dx:m.dx*(m.dx>0?q.xp:q.xn),dz:m.dz*(m.dz>0?q.zp:q.zn)};
 }
 function slotPosition(x,z,yaw,m,q){
  const c=Math.cos(yaw),s=Math.sin(yaw),{dx,dz}=offset(m,q);
  return {x:x+c*dx+s*dz,z:z-s*dx+c*dz};
 }
 // A fixed pseudo-random number per soldier, from his index in the squad.
 const soldierSeed=(squad,member)=>{const i=squad.members.indexOf(member);return ((i*7919+13)%101)/101;};
 // Where the march has drifted a soldier from his slot: backwards for rank
 // slack and pace, sideways for sway. Never onto blocked ground.
 function marchingPosition(squad,member,p,front,nav){
  const stretch=squad.stretch||0;
  if(stretch<1e-3)return p;
  const rank=Math.max(0,Math.round((front-member.dz)/rowSpacing(squad))),seed=member.seed??soldierSeed(squad,member),t=squad.marchTime||0;
  const lag=Math.max(-.02,stretch*(RANK_LAG*rank+RANK_LAG_GROWTH*rank*rank+STRIDE_DRIFT*Math.sin(t*1.7+seed*6.283)+PLACE_DRIFT*(seed*2-1)));
  const sway=stretch*SWAY*Math.sin(t*2.3+seed*11);
  const c=Math.cos(squad.r),s=Math.sin(squad.r);
  for(const k of [1,.5]){
   const drifted={x:p.x-s*lag*k+c*sway*k,z:p.z-c*lag*k-s*sway*k};
   if(!nav||(footClear(nav,drifted.x,drifted.z,MEMBER_RADIUS)&&footSweep(nav,p,drifted,MEMBER_RADIUS)))return drifted;
  }
  return p;
 }
 function occupy(squad,groundY){
  const q=squad.squeeze||unsqueezed(),nav=squad.nav;
  const front=Math.max(...squad.members.map(m=>m.dz));
  for(const member of squad.members){
   const p=marchingPosition(squad,member,slotPosition(squad.x,squad.z,squad.r,member,q),front,nav);
   member.x=p.x;member.z=p.z;
   member.y=groundY(member.x,member.z);
   member.r=squad.r; // Every soldier faces the same direction as the squad.
  }
 }
 // A rare formation can be spawned with a handful of men already on a
 // blocked MLG/cliff fringe. Escape is a short, uniform TRANSLATION of the
 // existing block towards a safe centre. There is no pivot, regrouping or
 // rank flowing during this translation, and it ends before the old motion
 // controller resumes. This avoids invoking an expensive replan every frame.
 function edgeEscapeAdvance(squad,dt,groundY,speed,nav){
  if(!squad.edgeEscape||!squad.path)return false;
  const to=squad.path[squad.waypoint];
  if(!to){squad.edgeEscape=false;return false;}
  const dx=to.x-squad.x,dz=to.z-squad.z,d=Math.hypot(dx,dz);
  const travel=Math.min(d,Math.max(0,speed)*dt);
  if(d<1e-6){squad.waypoint++;squad.edgeEscape=false;return false;}
  const ux=dx/d,uz=dz/d,move={x:ux*travel,z:uz*travel};
  const start={x:squad.x,z:squad.z},end={x:squad.x+move.x,z:squad.z+move.z};
  if(!nav.lineClear(start,end,.12)){
   squad.edgeEscape=false;squad.blockedReason='The formation centre has no clear route away from this cliff.';
   stop(squad);return true;
  }
  let minority=0;
  for(const m of squad.members){
   const next={x:m.x+move.x,z:m.z+move.z};
   if(footSweep(nav,m,next,MEMBER_RADIUS))continue;
   if(!nav.edgeStep?.(m,next,MEMBER_RADIUS)||
      ((!footClear(nav,m.x,m.z,MEMBER_RADIUS)||!footClear(nav,next.x,next.z,MEMBER_RADIUS))&&
       ++minority>Math.max(1,Math.floor(squad.members.length*.49)))){
    squad.edgeEscape=false;squad.blockedReason='A wall, river or too many blocked soldiers prevent cliff escape.';
    stop(squad);return true;
   }
  }
  const heading=Math.atan2(ux,uz);
  for(const m of squad.members){
   m.x+=move.x;m.z+=move.z;m.y=groundY(m.x,m.z);
   m.r+=clamp(deltaAngle(m.r,heading),-SOLDIER_TURN_SPEED*dt,SOLDIER_TURN_SPEED*dt);
  }
  squad.x=end.x;squad.z=end.z;squad.edgeGrace=minority;
  squad.isMoving=true;squad.isWalking=true;squad.isTurning=false;squad.phase='walking';
  if(travel>=d-1e-5){
   squad.x=to.x;squad.z=to.z;squad.waypoint++;
   // The full-radius route begins only after the entire block is back
   // on legal ground; no member is snapped, rearranged or teleported.
   if(nav.canStand(squad.x,squad.z,squad.radius)&&
      squad.members.every(m=>formationFoot(squad,nav,m,m,1))){
    squad.edgeEscape=false;squad.edgeGrace=0;
   }
  }
  return true;
 }
 // Validate BOTH the swept formation footprint and each actual soldier slot.
 // A* keeps the formation center safe; this check prevents the visible edge
 // soldiers from ever entering blocked cliff or river samples while turning.
 function poseSafe(squad,x,z,yaw,nav,q=squad.squeeze||unsqueezed()){
  if(!nav)return true;
  if(!nav.canStand(x,z,CENTRE_RADIUS)){
   debugTrace(squad,'pose-reject',{reason:'centre-canStand',candidate:{x,z},radius:CENTRE_RADIUS});
   return false;
  }
  for(const m of squad.members){
   const p=slotPosition(x,z,yaw,m,q);
   if(!formationFoot(squad,nav,m,{...p,r:yaw},Math.min(q.xp,q.xn))){
    conflict=m;
    debugTrace(squad,'pose-reject',{reason:'member-canStand',memberIndex:squad.members.indexOf(m),
     candidate:{x:p.x,z:p.z},radius:MEMBER_RADIUS});
    return false;
   }
  }
  return true;
 }
 function sweptPoseSafe(squad,x,z,yaw,nav){
  if(!nav)return true;
  // Individual soldiers trace swept arcs during pivoting, as well as their
  // forward paths during translation. A center-only check lets the outer row
  // walk through a steep face at an A* corner.
  const d=Math.hypot(x-squad.x,z-squad.z),a=Math.abs(deltaAngle(squad.r,yaw));
  const parts=Math.max(1,Math.ceil(d/.14),Math.ceil(a/.095));
  const members=squad.members,q=squad.squeeze||unsqueezed();
  const offsets=members.map(m=>slotPosition(squad.x,squad.z,squad.r,m,q));
  let previous={x:squad.x,z:squad.z};conflict=null;
  for(let i=1;i<=parts;i++){
   const t=i/parts,angle=squad.r+deltaAngle(squad.r,yaw)*t;
   const center={x:squad.x+(x-squad.x)*t,z:squad.z+(z-squad.z)*t};
   if(!poseSafe(squad,center.x,center.z,angle,nav,q))return false;
   if(!nav.lineClear(previous,center,CENTRE_RADIUS)){
    debugTrace(squad,'sweep-reject',{reason:'centre-lineClear',from:previous,candidate:center,radius:CENTRE_RADIUS});
    return false;
   }
   for(let k=0;k<members.length;k++){
    const point=slotPosition(center.x,center.z,angle,members[k],q);
    if(!formationSweep(squad,nav,members[k],{...offsets[k],r:squad.r+deltaAngle(squad.r,yaw)*(i-1)/parts},{...point,r:angle},Math.min(q.xp,q.xn))){
     conflict=members[k];
     debugTrace(squad,'sweep-reject',{reason:'member-lineClear',memberIndex:k,
      from:{x:offsets[k].x,z:offsets[k].z},candidate:{x:point.x,z:point.z},radius:MEMBER_RADIUS});
     return false;
    }
    offsets[k]=point;
   }
   previous=center;
  }
  return true;
 }
 // The loosest squeeze that keeps every soldier clear of blocked ground at
 // this pose. Crowded soldiers first close up sideways, as a file would, and
 // only then front-to-back.
 function fitSqueeze(squad,x,z,yaw,nav){
  const q=unsqueezed();
  const clear=m=>{const p=slotPosition(x,z,yaw,m,q);return formationFoot(squad,nav,m,{...p,r:yaw},Math.min(q.xp,q.xn));};
  const tighter=v=>SQUEEZE_LEVELS.find(l=>l<v-1e-6)??v;
  const tighten=(key,m)=>{
   if(!key||q[key]<=MIN_SQUEEZE)return false;
   const old=q[key];q[key]=tighter(old);
   if(clear(m))return true;
   q[key]=old;return false;
  };
  for(let pass=0;pass<SQUEEZE_LEVELS.length*2;pass++){
   let changed=false;
   for(const m of squad.members){
    if(clear(m))continue;
    const side=m.dx>0?'xp':m.dx<0?'xn':null,depth=m.dz>0?'zp':m.dz<0?'zn':null;
    if(tighten(side,m)||tighten(depth,m)){changed=true;continue;}
    for(const key of [side,depth])if(key&&q[key]>MIN_SQUEEZE){q[key]=tighter(q[key]);changed=true;}
   }
   if(!changed)break;
  }
  return q;
 }
 // Poses the squad is about to occupy: here, and along the route ahead, so
 // soldiers start closing in before the passage narrows rather than at it.
 function upcomingPoses(squad){
  const poses=[{x:squad.x,z:squad.z,yaw:squad.r}];
  const path=squad.path;
  if(path&&squad.waypoint<path.length){
   let from={x:squad.x,z:squad.z},travelled=0,next=LOOKAHEAD_STEP;
   for(let i=squad.waypoint;i<path.length&&travelled<LOOKAHEAD;i++){
    const to=path[i],length=Math.hypot(to.x-from.x,to.z-from.z);
    if(length>1e-6){
     const yaw=Math.atan2(to.x-from.x,to.z-from.z);
     poses.push({x:from.x,z:from.z,yaw});
     while(next<=travelled+length&&next<=LOOKAHEAD){
      const t=(next-travelled)/length;
      poses.push({x:from.x+(to.x-from.x)*t,z:from.z+(to.z-from.z)*t,yaw});
      next+=LOOKAHEAD_STEP;
     }
     travelled+=length;
    }
    from=to;
   }
  }else if(squad.finalFacing!==null&&squad.finalFacing!==undefined){
   poses.push({x:squad.x,z:squad.z,yaw:squad.finalFacing});
  }
  return poses;
 }
 function updateSqueeze(squad,dt,nav){
  if(!nav)return unsqueezed();
  const target={...squad.forced};
  for(const k of SIDES)squad.forced[k]=Math.min(1,squad.forced[k]+FORCED_RELAX*dt);
  for(const pose of upcomingPoses(squad)){
   const q=fitSqueeze(squad,pose.x,pose.z,pose.yaw,nav);
   for(const k of SIDES)target[k]=Math.min(target[k],q[k]);
  }
  const current=squad.squeeze,next={...current};
  for(const k of SIDES){
   next[k]=current[k]>target[k]?Math.max(target[k],current[k]-SQUEEZE_RATE*dt):Math.min(target[k],current[k]+RELAX_RATE*dt);
  }
  // Only adopt the new spacing if every soldier stays on safe ground.
  // If a soldier would land on blocked ground, pull him in on his other
  // axis too (grid rounding can make one-axis squeezing a dead end).
  for(let attempt=0;attempt<4&&!poseSafe(squad,squad.x,squad.z,squad.r,nav,next);attempt++){
   const crowded=conflict;if(!crowded)break;
   for(const k of memberSides(crowded))next[k]=Math.max(MIN_SQUEEZE,Math.min(next[k],current[k])-SQUEEZE_RATE*dt);
  }
  const changed=SIDES.some(k=>Math.abs(next[k]-current[k])>1e-6);
  squad.squeezeMoved=changed&&poseSafe(squad,squad.x,squad.z,squad.r,nav,next);
  if(squad.squeezeMoved)squad.squeeze=next;
  return target;
 }
 const memberSides=m=>[m.dx>0?'xp':m.dx<0?'xn':null,m.dz>0?'zp':m.dz<0?'zn':null].filter(Boolean);
 const squeezing=(squad,target)=>SIDES.some(k=>squad.squeeze[k]>target[k]+1e-3);
 const relaxing=(squad,target)=>SIDES.some(k=>squad.squeeze[k]<target[k]-1e-3);
 // Which side of the block each side becomes after turning by delta (rounded
 // to quarter turns), so a squeezed flank stays squeezed against its cliff.
 function rotateSqueeze(q,delta){
  const quarter=((Math.round(delta/(Math.PI/2))%4)+4)%4;
  if(quarter===1)return {xp:q.zn,xn:q.zp,zp:q.xp,zn:q.xn};
  if(quarter===2)return {xp:q.xn,xn:q.xp,zp:q.zn,zn:q.zp};
  if(quarter===3)return {xp:q.zp,xn:q.zn,zp:q.xn,zn:q.xp};
  return {...q};
 }
 // Hungarian algorithm on a square cost matrix; returns column per row.
 function assign(cost){
  const n=cost.length,u=new Float64Array(n+1),v=new Float64Array(n+1),p=new Int32Array(n+1),way=new Int32Array(n+1);
  for(let i=1;i<=n;i++){
   p[0]=i;let j0=0;const minv=new Float64Array(n+1).fill(Infinity),used=new Uint8Array(n+1);
   do{
    used[j0]=1;const i0=p[j0];let delta=Infinity,j1=0;
    for(let j=1;j<=n;j++)if(!used[j]){
     const c=cost[i0-1][j-1]-u[i0]-v[j];
     if(c<minv[j]){minv[j]=c;way[j]=j0;}
     if(minv[j]<delta){delta=minv[j];j1=j;}
    }
    for(let j=0;j<=n;j++)if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else minv[j]-=delta;
    j0=j1;
   }while(p[j0]!==0);
   do{const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0);
  }
  const result=new Array(n);
  for(let j=1;j<=n;j++)result[p[j]-1]=j-1;
  return result;
 }
 function beginIndividualTurn(squad,yaw,nav){
  const delta=deltaAngle(squad.r,yaw),q=rotateSqueeze(squad.squeeze||unsqueezed(),delta);
  // Optimal soldier-to-slot assignment (least total squared walk): nobody
  // crosses the whole block, and after an exact about-face every soldier
  // keeps his spot (the back rank simply becomes the front rank).
  const slots=squad.members.map(m=>({dx:m.dx,dz:m.dz,formationRole:m.formationRole}));
  const targets=slots.map(slot=>slotPosition(squad.x,squad.z,yaw,slot,q));
  const memberSlot=assign(squad.members.map(m=>targets.map(t=>(t.x-m.x)**2+(t.z-m.z)**2)));
  // A true about-face is a rotation of each *person*, not their footprint.
  // If the new mirrored slots are already underneath all the men, a terrain
  // mask overlapping their CURRENT positions must never prevent them from
  // simply looking the other way. No new ground is crossed in this case.
  const stationaryReverse=aboutFace(squad.r,yaw)&&squad.members.every((m,i)=>{
   const t=targets[memberSlot[i]];return Math.hypot(t.x-m.x,t.z-m.z)<.015;
  });
  if(nav&&!stationaryReverse&&!poseSafe(squad,squad.x,squad.z,yaw,nav,q))return false;
  squad.stretch=0; // Soldiers start from where they actually stand.
  squad.individualTurn={yaw,delta,q,time:0,soldiers:squad.members.map((m,i)=>({
   m,slot:slots[memberSlot[i]],to:targets[memberSlot[i]],startR:m.r,
   // A slight, fixed per-soldier hesitation so the turn ripples naturally.
   delay:((i*7919)%17)/17*TURN_STAGGER
  }))};
  squad.phase='facing';squad.isTurning=true;squad.isWalking=false;
  return true;
 }
 function completeIndividualTurn(squad){
  const job=squad.individualTurn;if(!job)return;
  for(const soldier of job.soldiers){
   const m=soldier.m;m.dx=soldier.slot.dx;m.dz=soldier.slot.dz;m.formationRole=soldier.slot.formationRole||null;m.x=soldier.to.x;m.z=soldier.to.z;m.r=job.yaw;
  }
  squad.r=job.yaw;squad.squeeze=job.q;squad.individualTurn=null;
  if(!squad.path){squad.isMoving=false;squad.isTurning=false;squad.isWalking=false;squad.phase='idle';}
 }
 // A completed march may leave a few ranks closing near a cliff. Their
 // old settling targets must NEVER hold a newly accepted move command hostage.
 // Keep each soldier's real position and logical slot (no snap or reassignment).
 function releaseClosing(squad,reason){
  if(!squad.individualTurn?.settle)return false;
  squad.individualTurn=null;
  squad.holdTime=0;
  squad.stretch=0;
  const continuing=!!squad.path&&squad.waypoint<squad.path.length;
  if(!continuing){
   squad.path=null;squad.destination=null;squad.finalFacing=null;squad.waypoint=0;
   // The men have not necessarily reached every old slot. Avoid snapping
   // their visible positions to ideal slots in advance() on this same tick.
   if(reason==='settling-stalled')squad.skipOccupyOnce=true;
  }
  squad.isMoving=continuing;
  squad.isTurning=false;squad.isWalking=false;
  squad.phase=continuing?'turning':'idle';
  debugTrace(squad,'closing-released',{reason,resuming:continuing});
  return true;
 }
 function individualTurnAdvance(squad,dt,groundY,speed,nav){
  const job=squad.individualTurn;job.time+=dt;
  const turnStep=SOLDIER_TURN_SPEED*(job.settle?1.6:1)*dt,prefer=Math.sign(job.delta)||1;
  // If a slot's direct crossing is blocked (e.g. closing up after a bridge),
  // plan a real route for that man at a bounded rate. Never snap him across.
  const stepTo=(soldier,next)=>{
   const m=soldier.m;
   if(!nav||formationSweep(squad,nav,soldier.slot,{...m,r:job.yaw},{...next,r:job.yaw})){
    m.x=next.x;m.z=next.z;m.y=groundY(m.x,m.z);soldier.stuck=0;
    return;
   }
   soldier.stuck=(soldier.stuck||0)+dt;
   if(soldier.stuck<SOLO_REPATH_AFTER||!nav?.plan||
      job.time-(soldier.lastRepath??-Infinity)<SOLO_REPATH_COOLDOWN||
      job.time-(job.lastRepath??-Infinity)<SOLO_REPATH_GROUP_GAP)return;
   soldier.lastRepath=job.lastRepath=job.time;
   const result=nav.plan(m,soldier.to,MEMBER_RADIUS);
   const path=result?.ok?result.points?.slice(1):null;
   const last=path?.[path.length-1];
   if(!last||!formationSweep(squad,nav,soldier.slot,{...last,r:job.yaw},{...soldier.to,r:job.yaw}))return;
   if(Math.hypot(last.x-soldier.to.x,last.z-soldier.to.z)>1e-4)path.push(soldier.to);
   soldier.route=path;soldier.waypoint=0;soldier.stuck=0;
  };
  // Turn one soldier towards a yaw; an exact reversal turns the squad's way.
  const turnToward=(m,yaw)=>{
   let error=deltaAngle(m.r,yaw);
   if(Math.abs(error)>Math.PI-.05)error=Math.abs(error)*prefer;
   m.r+=clamp(error,-turnStep,turnStep);
   return Math.abs(error)-turnStep;
  };
  let done=true;
  for(const soldier of job.soldiers){
   const m=soldier.m;
   if(job.time<soldier.delay){done=false;continue;}
   // Dispersed builders can stand on opposite sides of a solid building.
   // Their closing-up routes are planned once by reform(), rather than
   // walking straight into its wall until the turn timeout snaps them out.
   const route=soldier.route;
   if(route)while(soldier.waypoint<route.length-1&&Math.hypot(route[soldier.waypoint].x-m.x,route[soldier.waypoint].z-m.z)<1e-4)soldier.waypoint++;
   const point=route?route[soldier.waypoint]:soldier.to,waypoint=!!route&&soldier.waypoint<route.length-1;
   const dx=point.x-m.x,dz=point.z-m.z,d=Math.hypot(dx,dz);
   if(waypoint||(!soldier.arrived&&d>REPOSITION_STEP)){
    // Face the new slot, then walk to it (never across blocked ground).
    const left=turnToward(m,Math.atan2(dx,dz));
    if(left<.35){
     const k=Math.min(1,speed*(job.settle?1.5:.9)*dt/d),next={x:m.x+dx*k,z:m.z+dz*k};
     stepTo(soldier,next);
    }
    done=false;continue;
   }
   soldier.arrived=true;
   if(d>1e-4){
    const k=Math.min(1,speed*(job.settle?1.05:.5)*dt/d),next={x:m.x+dx*k,z:m.z+dz*k};
    stepTo(soldier,next);
   }
   // On the slot: face the new front.
   if(turnToward(m,job.yaw)>1e-3||Math.hypot(soldier.to.x-m.x,soldier.to.z-m.z)>.01)done=false;
  }
  // An impossible old settling target must not freeze the squad forever.
  // Count real progress rather than using a blind animation time limit:
  // a legitimately walking soldier can take as long as needed to reform.
  if(job.settle&&job.fromFlow){
   const remaining=job.soldiers.reduce((sum,soldier)=>sum+
    Math.hypot(soldier.to.x-soldier.m.x,soldier.to.z-soldier.m.z),0);
   if(job.bestRemaining==null||remaining<job.bestRemaining-.004){
    job.bestRemaining=remaining;job.lastProgress=job.time;
   }
   if(job.time>2.5&&job.time-(job.lastProgress??0)>2.3){
    // No teleport to an invalid slot; leave all real feet where they are.
    releaseClosing(squad,'settling-stalled');
    return true;
   }
  }
  // A settle is the ranks closing up; a turn is soldiers re-facing.
  squad.phase=job.settle?'closing':'facing';squad.isTurning=!job.settle;squad.isWalking=!!job.settle;
  // Do not time out into completeIndividualTurn(): that routine places all
  // men exactly on their slots. If one is blocked, keep the whole unit in
  // the closing phase rather than visibly teleporting or leaving him behind.
  if(!done)return true;
  // Every soldier has now actually reached his slot.
  completeIndividualTurn(squad);occupy(squad,groundY);squad.holdTime=0;
  if(Number.isFinite(squad.queuedFacing)){
   const yaw=squad.queuedFacing;squad.queuedFacing=null;
   if(beginIndividualTurn(squad,yaw,nav)){
    debugTrace(squad,'about-face',{oldHeading:squad.r,newHeading:yaw,reason:'after-settle'});
    squad.isMoving=true;return true;
   }
  }
  if(!squad.path){squad.isMoving=false;squad.isTurning=false;squad.phase='idle';}
  return true;
 }
 // ---- Flowing march -------------------------------------------------------
 // On the march the block follows the road like the original game: each rank
 // walks the route at its own distance behind the centre and faces the way
 // the road runs where it is, so the front ranks take a bend first and the
 // rear ranks follow. Each rank pulls its flanks in where the road narrows.
 // Smooth the A* centre road with short quadratic bends. The corridor test
 // below accepts only bends where the *entire* formation can follow safely.
 // A shorter trim is attempted if cutting a corner hits an obstacle.
 function roundRoad(points,trim){
  if(points.length<3||trim<=0)return points.map(p=>({x:p.x,z:p.z}));
  const out=[{x:points[0].x,z:points[0].z}];
  for(let i=1;i<points.length-1;i++){
   const a=points[i-1],b=points[i],c=points[i+1];
   const da=Math.hypot(b.x-a.x,b.z-a.z),db=Math.hypot(c.x-b.x,c.z-b.z);
   if(da<1e-5||db<1e-5){out.push({x:b.x,z:b.z});continue;}
   const ux=(b.x-a.x)/da,uz=(b.z-a.z)/da,vx=(c.x-b.x)/db,vz=(c.z-b.z)/db;
   const change=Math.acos(clamp(ux*vx+uz*vz,-1,1));
   if(change<.055||change>Math.PI-.055){out.push({x:b.x,z:b.z});continue;}
   const cut=Math.min(trim,da*.44,db*.44)*(Math.min(1,change/.9));
   if(cut<.025){out.push({x:b.x,z:b.z});continue;}
   const from={x:b.x-ux*cut,z:b.z-uz*cut},to={x:b.x+vx*cut,z:b.z+vz*cut};
   out.push(from);
   const segments=Math.max(3,Math.ceil(cut*2/CORRIDOR_SAMPLE));
   for(let j=1;j<=segments;j++){
    const t=j/segments,k=1-t;
    out.push({x:k*k*from.x+2*k*t*b.x+t*t*to.x,z:k*k*from.z+2*k*t*b.z+t*t*to.z});
   }
  }
  out.push({x:points[points.length-1].x,z:points[points.length-1].z});
  return out;
 }
 function flowGeometry(points,members,rankBlend=FLOW_RANK_BLEND){
  if(points.length<2)return null;
  let length=0;
  for(let i=1;i<points.length;i++)length+=Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z);
  if(length<1e-6)return null;
  const depth=Math.max(...members.map(m=>Math.abs(m.dz)))+1;
  const unit=(a,b)=>{const d=Math.hypot(b.x-a.x,b.z-a.z)||1;return {x:(b.x-a.x)/d,z:(b.z-a.z)/d};};
  const first=unit(points[0],points[1]),last=unit(points[points.length-2],points[points.length-1]);
  const line=[{x:points[0].x-first.x*depth,z:points[0].z-first.z*depth},...points,
   {x:points[points.length-1].x+last.x*depth,z:points[points.length-1].z+last.z*depth}];
  const cumulative=[0];
  for(let i=1;i<line.length;i++)cumulative.push(cumulative[i-1]+Math.hypot(line[i].x-line[i-1].x,line[i].z-line[i-1].z));
  const halfWidth=Math.max(...members.map(m=>Math.abs(m.dx)));
  return {line,cumulative,window:clamp(halfWidth+.45,.75,2.1),start:depth,end:depth+length,
   rankBlend,endYaw:Math.atan2(last.x,last.z)};
 }
 // Stable assigned slots are primary; a small longitudinal blend makes the
 // front ranks lead a bend without stretching the unit into a snake.
 function corridorPosition(flow,m,distance,scale=1,lag=0,sway=0,shift=0){
  const blend=flow.rankBlend??FLOW_RANK_BLEND;
  const deep=depthScale(scale);
  const progress=distance+m.dz*blend*deep-lag;
  const point=flowPoint(flow,progress),heading=flowHeading(flow,progress);
  const across=m.dx*scale+sway+shift,depth=m.dz*deep*(1-blend);
  const c=Math.cos(heading),s=Math.sin(heading);
  return {x:point.x+c*across+s*depth,z:point.z-s*across+c*depth,r:heading};
 }
 // No soldier may collide anywhere on a complete swept marching route.
 // Check actual slots, not a circular approximation, including simultaneous
 // turning of the outside flank and full clearance at the destination.
 // Interpolate the exact compression that the planner has checked, at
 // the distance travelled along the corridor. Normal roads remain at 1.
 function corridorScaleAt(profile,d){
  if(!profile)return 1;
  const t=clamp((d-profile.start)/profile.step,0,profile.values.length-1);
  const i=Math.min(profile.values.length-2,Math.floor(t));
  return profile.values[i]+(profile.values[i+1]-profile.values[i])*(t-i);
 }
 function corridorOffsetAt(profile,d){
  if(!profile?.offsets)return 0;
  const t=clamp((d-profile.start)/profile.step,0,profile.offsets.length-1);
  const i=Math.min(profile.offsets.length-2,Math.floor(t));
  return profile.offsets[i]+(profile.offsets[i+1]-profile.offsets[i])*(t-i);
 }
 // Finite-state lateral search: after measuring the usable width for each
 // marching cross-section, find a CONTINUOUS formation-centre line through
 // the legal intervals. The centre may shift left/right a few decimetres,
 // and the width may close gradually, but nobody changes their rank or file.
 function corridorFits(squad,points,nav,maxScale,report=null,maxShift=NORMAL_CORRIDOR_SHIFT){
  const flow=flowGeometry(points,squad.members,squad.files?1:FLOW_RANK_BLEND);
  if(!flow)return null;
  const steps=Math.max(1,Math.ceil((flow.end-flow.start)/CORRIDOR_SAMPLE));
  const step=(flow.end-flow.start)/steps;
  const levels=[maxScale,...SQUEEZE_LEVELS.filter(v=>v<maxScale-1e-6)];
  const shifts=[];
  for(let k=-Math.round(maxShift/CORRIDOR_SHIFT);k<=Math.round(maxShift/CORRIDOR_SHIFT);k++)
   shifts.push(k*CORRIDOR_SHIFT);
  const preference=[...shifts.keys()].sort((a,b)=>Math.abs(shifts[a])-Math.abs(shifts[b]));
  const frames=new Array(steps+1),caps=new Array(steps+1);
  // The native terrain grid can certify a large obstacle-free disc in one
  // clearance lookup. Only use that broad phase for real navigation grids;
  // lightweight mock navs may interpret radii as point-only checks.
  const fastGrid=!!(nav.clearance&&nav.statistics);
  const openRadius=squad.radius+maxShift+.35;
  const widthFit=(frame,scale,shift)=>{
   const x=frame.x+frame.rx*shift,z=frame.z+frame.rz*shift;
   if(!nav.canStand(x,z,CENTRE_RADIUS))return false;
   for(const m of squad.members){
    const p=corridorPosition(flow,m,frame.d,scale,0,0,shift);
    if(!formationFoot(squad,nav,m,p,scale))return false;
   }
   return true;
  };
  for(let i=0;i<=steps;i++){
   const d=flow.start+i*step,center=flowPoint(flow,d),yaw=flowHeading(flow,d);
   const frame=frames[i]={d,x:center.x,z:center.z,rx:Math.cos(yaw),rz:-Math.sin(yaw)};
   // Do NOT reject the raw A* centreline here: it is only a guide. The
   // formation may march on a continuously shifted lane beside that guide.
   // Every candidate *actual* centre and every soldier is verified in
   // widthFit and in the swept finite-state transition search below.
   if(fastGrid&&nav.canStand(center.x,center.z,openRadius)){
    frame.wideOpen=true;caps[i]=maxScale;continue;
   }
   let allowed=null;
   for(const scale of levels){
    for(const j of preference){
     if((i===0||i===steps)&&j!==Math.round(shifts.length/2))continue;
     if(widthFit(frame,scale,shifts[j])){allowed=scale;break;}
    }
    if(allowed!==null)break;
   }
   if(allowed===null){
    // Find the outer file closest to a forbidden cell; drawing this point
    // explains why a apparently WIDE local cross-section can still fail.
    const member=squad.members.findIndex(m=>{
     const p=corridorPosition(flow,m,d,MIN_SQUEEZE,0,0,0);
     return !formationFoot(squad,nav,m,p,MIN_SQUEEZE);
    });
    const p=member<0?center:corridorPosition(flow,squad.members[member],d,MIN_SQUEEZE,0,0,0);
    routeIssue(report,'formation-section',p,{distance:d-flow.start,yaw,member:member<0?null:member,
     compression:MIN_SQUEEZE,sectionCenter:{x:center.x,z:center.z},
     minimumFormationWidth:2*coreFile(squad)*MIN_SQUEEZE+2*CORRIDOR_MEMBER_RADIUS});return null;
   }
   caps[i]=allowed;
  }
  // The first pass uses the loosest cross-section that fits. If that choice
  // traps the troop at a bend, retry with tighter *local* spacing instead of
  // declaring a wide-looking gate impossible. Tightening is coupled to the
  // lateral search: both the pose AND the full sweep must remain legal.
  const maxDelta=step*COMPRESSION_SLOPE;
  const padding=Math.max(1,Math.ceil(.62/step));
  const forced=new Float64Array(steps+1).fill(1);
  const compressionValues=()=>{
   const values=caps.map((c,i)=>Math.min(c,forced[i]));
   // The first and last ranks encounter a chokepoint before the squad centre.
   // Bring the contraction forward and retain it until the tail clears.
   const copy=values.slice();
   for(let i=0;i<values.length;i++)for(let j=Math.max(0,i-padding);j<=Math.min(steps,i+padding);j++)
    values[i]=Math.min(values[i],copy[j]);
   for(let i=1;i<values.length;i++)values[i]=Math.min(values[i],values[i-1]+maxDelta);
   for(let i=values.length-2;i>=0;i--)values[i]=Math.min(values[i],values[i+1]+maxDelta);
   return values;
  };
  const zero=Math.round(shifts.length/2);
  // Each attempt is a compact dynamic program across legal *formation* lanes.
  // Failed transitions are not waived even at the deepest compression.
  function searchLanes(values){
   let previous=new Float64Array(shifts.length).fill(Infinity);
   const back=new Array(steps+1);
   for(let i=0;i<=steps;i++){
    const frame=frames[i],options=new Float64Array(shifts.length).fill(Infinity),parents=new Int16Array(shifts.length).fill(-1);
    let legalPoses=0,reachablePoses=0,failedSweeps=0,firstSweep=null;
    for(let j=0;j<shifts.length;j++){
     if((i===0||i===steps)&&j!==zero)continue;
     if(!frame.wideOpen&&!widthFit(frame,values[i],shifts[j]))continue;
     legalPoses++;
     if(i===0){options[j]=Math.abs(shifts[j])*.6;continue;}
     for(let k=0;k<shifts.length;k++){
      if(!Number.isFinite(previous[k])||
         Math.abs(shifts[j]-shifts[k])>SHIFT_SLOPE*step+1e-6)continue;
      reachablePoses++;
      const delta=shifts[j]-shifts[k];
      const cost=previous[k]+Math.abs(shifts[j])*.012+Math.abs(delta)*.28+delta*delta*.8;
      if(cost>=options[j])continue;
      const prior=frames[i-1];
      const ax=prior.x+prior.rx*shifts[k],az=prior.z+prior.rz*shifts[k];
      const bx=frame.x+frame.rx*shifts[j],bz=frame.z+frame.rz*shifts[j];
      const broadClear=fastGrid&&prior.wideOpen&&frame.wideOpen&&
       nav.canStand((ax+bx)/2,(az+bz)/2,openRadius);
      if(!broadClear){
       if(!nav.lineClear({x:ax,z:az},{x:bx,z:bz},CENTRE_RADIUS)){
        failedSweeps++;
        if(!firstSweep)firstSweep={kind:'swept-centre',from:{x:ax,z:az},to:{x:bx,z:bz},member:null};
        continue;
       }
       let unsafe=false;
       for(let member=0;member<squad.members.length;member++){
        const m=squad.members[member];
        const from=corridorPosition(flow,m,prior.d,values[i-1],0,0,shifts[k]);
        const to=corridorPosition(flow,m,frame.d,values[i],0,0,shifts[j]);
        if(!formationSweep(squad,nav,m,from,to,values[i-1],values[i])){
         unsafe=true;failedSweeps++;
         if(!firstSweep)firstSweep={kind:'swept-soldier',from,to,member};
         break;
        }
       }
       if(unsafe)continue;
      }
      options[j]=cost;parents[j]=k;
     }
    }
    if(!options.some(Number.isFinite)){
     const reason=!legalPoses?'no-legal-formation-pose':
      !reachablePoses?'lateral-transition-too-sharp':
      firstSweep?.kind||'no-continuous-lane';
     return {failedIndex:i,reason,detail:firstSweep,legalPoses,reachablePoses,failedSweeps};
    }
    back[i]=parents;previous=options;
   }
   let cursor=zero;
   if(!Number.isFinite(previous[cursor]))return {failedIndex:steps,reason:'destination-lane'};
   const offsets=new Array(steps+1);
   for(let i=steps;i>=0;i--){
    offsets[i]=shifts[cursor];cursor=i?back[i][cursor]:zero;
    if(cursor<0)return {failedIndex:i,reason:'lane-backtrack'};
   }
   return {offsets};
  }
  let values=null,offsets=null,lastFailure=null,attempts=0;
  // Try gentle compression before deeper squeezing; the old .72 jump
  // needlessly collapsed the formation even for a minor corner correction.
  for(let retry=0;retry<=5;retry++){
   values=compressionValues();
   const found=searchLanes(values);attempts=retry+1;
   if(found.offsets){offsets=found.offsets;break;}
   lastFailure=found;
   if(retry===5||found.failedIndex===0)break;
   const at=found.failedIndex;
   // Narrow for ~1.8 m at the rejected section so the soldiers are already
   // packed before the first outside rank reaches the entrance.
   const window=Math.max(2,Math.ceil(.9/step));
   let improved=false;
   for(let k=Math.max(0,at-window);k<=Math.min(steps,at+window);k++){
    const lower=[.92,.84,.76,.68,MIN_SQUEEZE][Math.min(retry,4)];
    if(forced[k]>lower+1e-7){forced[k]=lower;improved=true;}
   }
   if(!improved)break;
  }
  if(!offsets){
   const i=lastFailure?.failedIndex??0,frame=frames[i],detail=lastFailure?.detail;
   let hit=detail?.to||{x:frame.x,z:frame.z};
   if(debugEnabled()&&detail?.from&&detail?.to){
    const a=detail.from,b=detail.to;
    for(let t=0;t<=1.0001;t+=.05){
     const p={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};
     if(!formationFoot(squad,nav,squad.members[detail?.member??0],p,values[i])){hit=p;break;}
    }
   }
   routeIssue(report,lastFailure?.reason||'no-continuous-lane',hit,{
    distance:frame.d-flow.start,yaw:Math.atan2(-frame.rz,frame.rx),
    compression:values[i],member:detail?.member??null,sectionCenter:{x:frame.x,z:frame.z},
    legalPoses:lastFailure?.legalPoses,reachablePoses:lastFailure?.reachablePoses,
    failedSweeps:lastFailure?.failedSweeps,sweepStart:detail?.from||null,
    sweepEnd:detail?.to||null,compressionAttempts:attempts,
    minimumFormationWidth:2*coreFile(squad)*MIN_SQUEEZE+2*CORRIDOR_MEMBER_RADIUS
   });
   return null;
  }
  const profile={start:flow.start,step,values,offsets};
  let prior=null;
  for(let i=0;i<=steps;i++){
   const positions=[];
   for(let k=0;k<squad.members.length;k++){
    const p=corridorPosition(flow,squad.members[k],frames[i].d,values[i],0,0,offsets[i]);
    if((!frames[i].wideOpen&&!formationFoot(squad,nav,squad.members[k],p,values[i]))||
       (prior&&!(frames[i].wideOpen&&frames[i-1].wideOpen&&
        nav.canStand((p.x+prior[k].x)/2,(p.z+prior[k].z)/2,openRadius))&&
        !formationSweep(squad,nav,squad.members[k],prior[k],p,values[i?i-1:0],values[i]))){
     routeIssue(report,'swept-soldier',p,{distance:frames[i].d-flow.start,
      member:k,compression:values[i],sectionCenter:{x:frames[i].x,z:frames[i].z},
      yaw:flowHeading(flow,frames[i].d),
      minimumFormationWidth:2*coreFile(squad)*MIN_SQUEEZE+2*CORRIDOR_MEMBER_RADIUS});return null;
    }
    positions.push(p);
   }
   prior=positions;
  }
  return {...flow,compressionProfile:profile,minimumScale:Math.min(...values),maximumShift:Math.max(...offsets.map(Math.abs)),compressionAttempts:attempts};
 }
 // Before approving a corridor, verify the formation can turn into its
 // first heading *without moving individual soldiers to other ranks*.
 function pivotFits(squad,x,z,from,to,nav,q,report=null,kind='entry-turn'){
  const angle=deltaAngle(from,to),steps=Math.max(1,Math.ceil(Math.abs(angle)/.075));
  let previous=null;
  for(let i=0;i<=steps;i++){
   const yaw=from+angle*i/steps,positions=[];
   for(let k=0;k<squad.members.length;k++){
    const p=slotPosition(x,z,yaw,squad.members[k],q);
    if(!formationFoot(squad,nav,squad.members[k],{...p,r:yaw},Math.min(q.xp,q.xn))||
      (previous&&!formationSweep(squad,nav,squad.members[k],{...previous[k],r:yaw-angle/steps},{...p,r:yaw},Math.min(q.xp,q.xn)))){
     routeIssue(report,kind,p,{member:k,yaw,turnFrom:from,turnTo:to});return false;
    }
    positions.push(p);
   }
   previous=positions;
  }
  return true;
 }
 // The squad may not have space to rotate on the spot beside a cliff.
 // Prefer a rolling departure: the existing files first walk forward in
 // their current orientation, then take the bend together. Every pose and
 // sweep is verified by corridorFits; no soldier teleports or changes rank.
 function validatedRoad(squad,points,nav,preferredScale=1,finalFacing=null,report=null,allowRoll=true,maxShift=NORMAL_CORRIDOR_SHIFT){
  const half=Math.max(...squad.members.map(m=>Math.abs(m.dx)),.5);
  const trimSizes=[Math.max(.45,half*.85),.55,.25,0];
  let entryTurnFailed=false;
  for(const scale of [preferredScale,...(preferredScale===1?[.88]:[])]){
   for(const trim of trimSizes){
    const road=roundRoad(points,trim);
    const candidate=flowGeometry(road,squad.members,squad.files?1:FLOW_RANK_BLEND);
    if(!candidate)continue;
    const startYaw=flowHeading(candidate,candidate.start);
    const firstTurn={issue:null};
    // In an about-face soldiers rotate on their own feet and exchange
    // *logical* front/back slots. They do not sweep a 30-man rectangle through
    // the scenery in a huge circle. The final mirrored pose must still fit.
    const entryFits=aboutFace(squad.r,startYaw)?
      poseSafe(squad,squad.x,squad.z,startYaw,nav,
       rotateSqueeze(squad.squeeze||unsqueezed(),deltaAngle(squad.r,startYaw))):
      pivotFits(squad,squad.x,squad.z,squad.r,startYaw,nav,
       squad.squeeze||unsqueezed(),firstTurn);
    if(!entryFits){
     entryTurnFailed=true;
     if(report&&!report.issue)report.issue=firstTurn.issue;
     continue;
    }
    const geom=corridorFits(squad,road,nav,scale,report,maxShift);
    if(!geom)continue;
    if(Number.isFinite(finalFacing)){
     const end=road[road.length-1],lastScale=corridorScaleAt(geom.compressionProfile,geom.end);
     const q={xp:lastScale,xn:lastScale,zp:depthScale(lastScale),zn:depthScale(lastScale)};
     const endHeading=flowHeading(geom,geom.end);
     if(aboutFace(endHeading,finalFacing)){
      if(!poseSafe(squad,end.x,end.z,finalFacing,nav,rotateSqueeze(q,deltaAngle(endHeading,finalFacing))))continue;
     }else if(!pivotFits(squad,end.x,end.z,endHeading,finalFacing,nav,q,report,'final-turn'))continue;
    }
    let turnCost=0;
    for(let k=2;k<road.length;k++){
     const a=road[k-2],b=road[k-1],c=road[k];
     const h1=Math.atan2(b.x-a.x,b.z-a.z),h2=Math.atan2(c.x-b.x,c.z-b.z);
     turnCost+=Math.abs(deltaAngle(h1,h2))*.55;
    }
    return {points:road,length:geom.end-geom.start,scale:geom.minimumScale,
     compressionProfile:geom.compressionProfile,maximumShift:geom.maximumShift,compressionAttempts:geom.compressionAttempts,turnCost};
   }
  }
  if(allowRoll&&entryTurnFailed&&points.length>=2){
   const start=points[0];
   for(const distance of [2.2,3.1]){
    const lead={x:start.x+Math.sin(squad.r)*distance,z:start.z+Math.cos(squad.r)*distance};
    if(!nav.canStand(lead.x,lead.z,CENTRE_RADIUS))continue;
    // If the lead would walk straight into an MLG wall this option fails
    // the same member-by-member sweep as every ordinary corridor.
    const rolling=[start,lead,...points.slice(1)];
    const fitted=validatedRoad(squad,rolling,nav,preferredScale,finalFacing,null,false,maxShift);
    if(fitted)return {...fitted,rollingStart:true};
   }
  }
  if(report&&!report.points)report.points=points.map(p=>({x:p.x,z:p.z}));
  return null;
 }
 function beginFlow(squad){
  const raw=[{x:squad.x,z:squad.z},...squad.path.slice(squad.waypoint)],points=[raw[0]],indices=[squad.waypoint-1];
  for(let i=1;i<raw.length;i++){
   const p=raw[i],q=points[points.length-1];
   if(Math.hypot(p.x-q.x,p.z-q.z)>1e-3){points.push(p);indices.push(squad.waypoint+i-1);}
  }
  if(points.length<2)return false;
  let end=points.length-1;
  // Legacy routes can still stop to perform an about-face. Corridor-verified
  // roads have already been rounded, swept and are marched in one pass.
  if(!squad.corridorValidated&&!squad.files)for(let k=1;k<points.length-1;k++){
   const a=Math.atan2(points[k].x-points[k-1].x,points[k].z-points[k-1].z),b=Math.atan2(points[k+1].x-points[k].x,points[k+1].z-points[k].z);
   if(Math.abs(deltaAngle(a,b))>SHARP_CORNER){end=k;break;}
  }
  const used=points.slice(0,end+1),geometry=flowGeometry(used,squad.members,squad.files?1:FLOW_RANK_BLEND);
  if(!geometry||geometry.end-geometry.start<MIN_FLOW)return false;
  const front=Math.max(...squad.members.map(m=>m.dz)),q=squad.squeeze||unsqueezed();
  const rankOf=new Map(squad.members.map(m=>[m,Math.max(0,Math.round((front-m.dz)/rowSpacing(squad)))]));
  const ranks=Math.max(...rankOf.values())+1;
  const rankSides=Array.from({length:ranks},()=>({xp:[],xn:[]}));
  for(const m of squad.members){const side=m.dx>0?'xp':m.dx<0?'xn':null;if(side)rankSides[rankOf.get(m)][side].push(m);}
  const scale=squad.routeScale??1;
  squad.flow={...geometry,s:geometry.start,endIndex:indices[end],indices:indices.slice(0,end+1),
   rankOf,rankSides,memberOrder:squad.members.slice(),corridorScale:scale,
   compressionProfile:squad.routeProfile||null,revision:squad.nav?.revision??0,
   lat:Array.from({length:ranks},()=>({xp:q.xp,xn:q.xn})),
   zp:q.zp,zn:q.zn};
  squad.holdTime=0;
  return true;
 }
 function flowPoint(flow,distance){
  const {line,cumulative}=flow,s=clamp(distance,0,cumulative[cumulative.length-1]);
  let lo=1,hi=line.length-1;
  while(lo<hi){const mid=(lo+hi)>>>1;if(cumulative[mid]<s)lo=mid+1;else hi=mid;}
  const i=lo,a=line[i-1],b=line[i],t=clamp((s-cumulative[i-1])/((cumulative[i]-cumulative[i-1])||1),0,1);
  return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};
 }
 // Road direction averaged over a short window, so ranks swing smoothly.
 function flowHeading(flow,distance){
  const a=flowPoint(flow,distance-flow.window),b=flowPoint(flow,distance+flow.window);
  return Math.atan2(b.x-a.x,b.z-a.z);
 }
 function flowPosition(squad,m,distance,lateral,noFootwork=false){
  const flow=squad.flow,rank=flow.rankOf.get(m),stretch=noFootwork?0:squad.stretch||0,t=squad.marchTime||0;
  const seed=m.seed??soldierSeed(squad,m);
  const lag=stretch*(RANK_LAG*rank+RANK_LAG_GROWTH*rank*rank+
   STRIDE_DRIFT*Math.sin(t*1.7+seed*6.283)+PLACE_DRIFT*(seed*2-1));
  const side=m.dx>0?'xp':'xn';
  // The validated corridor remains the skeleton of the march. Very small
  // rank-specific breathing and footwork keeps it from looking like a mesh
  // with 30 soldiers welded to it. Runtime still checks every actual step;
  // the noFootwork retry removes this variation against solid terrain.
  const base=lateral??flow.lat[rank][side];
  const transverse=base+(noFootwork?0:stretch*.012*Math.sin(t*1.25+rank*.8));
  const longitudinal=m.dz>0?flow.zp:flow.zn;
  const shift=corridorOffsetAt(flow.compressionProfile,distance);
  const shallow=depthScale(transverse);
  const member={dx:m.dx,dz:m.dz*longitudinal/shallow};
  const sway=stretch*SWAY*Math.sin(t*2.3+seed*11);
  return corridorPosition(flow,member,distance,transverse,Math.max(-.02,lag),sway,shift);
 }
 // Loosest flank spacing for one rank side that stays clear of blocked ground.
 function rankFit(squad,rank,side,distance,nav){
  const soldiers=squad.flow.rankSides[rank][side];
  for(const level of SQUEEZE_LEVELS){
   if(soldiers.every(m=>{const p=flowPosition(squad,m,distance,level);return formationFoot(squad,nav,m,p,level);}))return level;
  }
  return MIN_SQUEEZE;
 }
 function flowAdvance(squad,dt,groundY,speed,nav){
  if(!squad.members.length){squad.flow=null;stop(squad);return true;}
  const flow=squad.flow;squad.lastStep=dt;
  // A new building/gate can invalidate a formerly safe corridor. Redirect
  // the intact troop early instead of marching into the obstruction.
  if(nav&&flow.revision!==nav.revision&&!flow.revisionChecked&&squad.destination){
   flow.revisionChecked=true;
   if(order(squad,squad.destination,nav,squad.finalFacing).ok){
    debugTrace(squad,'corridor-replan',{reason:'terrain-revision',progress:flow.s});
    return true;
   }
  }
  // Casualties, promotions and merging can change membership in mid-march.
  // Reindex only when the list changes; otherwise flank lookups stay O(1).
  if(flow.memberOrder.length!==squad.members.length||squad.members.some((m,i)=>m!==flow.memberOrder[i])){
   const front=Math.max(...squad.members.map(m=>m.dz));
   flow.rankOf=new Map(squad.members.map(m=>[m,Math.max(0,Math.round((front-m.dz)/rowSpacing(squad)))]));
   const ranks=Math.max(0,...flow.rankOf.values())+1;
   flow.lat.length=Math.max(flow.lat.length,ranks);
   for(let i=0;i<flow.lat.length;i++)flow.lat[i]??={xp:1,xn:1};
   flow.rankSides=Array.from({length:flow.lat.length},()=>({xp:[],xn:[]}));
   for(const m of squad.members){const side=m.dx>0?'xp':m.dx<0?'xn':null;if(side)flow.rankSides[flow.rankOf.get(m)][side].push(m);}
   flow.memberOrder=squad.members.slice();
  }
  let next=Math.min(flow.end,flow.s+Math.max(0,speed)*dt);
  squad.marchTime=(squad.marchTime||0)+dt;
  const previousDepth={zp:flow.zp,zn:flow.zn};
  if(flow.compressionProfile){
   // If a squad STARTS against a narrow entrance, close ranks in place
   // before moving the centre. Never pop all 30 soldiers inward in a frame.
   const initial=Math.min(...flow.lat.map(l=>Math.min(l.xp,l.xn)));
   const atNow=corridorScaleAt(flow.compressionProfile,flow.s);
   const prepare=initial>atNow+SQUEEZE_RATE*dt;
   if(prepare)next=flow.s;
   // The runtime MUST occupy the exact footprint the planner swept. The
   // longitudinal scale is much gentler than the transverse scale, leaving
   // recognisable, loosely marching ranks even in a constricted passage.
   const target=corridorScaleAt(flow.compressionProfile,next);
   const width=prepare?Math.max(target,initial-SQUEEZE_RATE*dt):target;
   const deep=depthScale(width);
   flow.zp=deep;flow.zn=deep;
   for(const flank of flow.lat){flank.xp=width;flank.xn=width;}
  }else{
   const adjustDepth=v=>v>(flow.corridorScale??1)?
    Math.max(flow.corridorScale??1,v-SQUEEZE_RATE*dt):
    Math.min(flow.corridorScale??1,v+RELAX_RATE*dt);
   flow.zp=adjustDepth(flow.zp);flow.zn=adjustDepth(flow.zn);
   if(nav){
    for(let rank=0;rank<flow.lat.length;rank++)for(const side of ['xp','xn']){
     const target=Math.min(flow.corridorScale??1,rankFit(squad,rank,side,next,nav),rankFit(squad,rank,side,Math.min(flow.end,next+FLOW_LOOKAHEAD),nav));
     const current=flow.lat[rank][side];
     flow.lat[rank][side]=current>target?Math.max(target,current-SQUEEZE_RATE*dt):Math.min(target,current+RELAX_RATE*dt);
    }
   }
  }
  // Cosmetic, per-soldier sway must NEVER slow a shared marching road.
  // In a tight cross-section the planner reserved the exact file positions;
  // let gait animation add life, not physical side-to-side displacements that
  // alternate between illegal and legal every frame (the V6 stutter).
  const stableTightMarch=!!flow.compressionProfile&&
   corridorScaleAt(flow.compressionProfile,next)<.94;
  // Every soldier's planted foot is checked. The decorative shoulders can
  // brush through scrub or skim a boundary, but feet cannot enter hard MLG.
  // If a planted foot cannot fit, the intact block retries or waits.
  // Slow down in bends: nobody moves faster than MAX_FLANK_SPEED.
  if(next>flow.s){
   const probe=squad.members.map(m=>flowPosition(squad,m,next,null,stableTightMarch));
   const fastest=Math.max(...squad.members.map((m,i)=>Math.hypot(probe[i].x-m.x,probe[i].z-m.z)));
   const limit=MAX_FLANK_SPEED*Math.max(0,speed)*dt;
   if(fastest>limit)next=flow.s+(next-flow.s)*limit/fastest;
  }
  let positions=null,previousRejection=null;
  for(let attempt=0;attempt<10;attempt++){
   const noFootwork=stableTightMarch||attempt%2===1;
   const candidate=squad.members.map(m=>flowPosition(squad,m,next,null,noFootwork));
   const bad=nav?squad.members.findIndex((m,i)=>{
    const p=candidate[i];
    if(!formationFoot(squad,nav,m,p,corridorScaleAt(flow.compressionProfile,next))){
     if(debugEnabled())previousRejection={reason:'destination-canStand',memberIndex:i,
      from:{x:m.x,z:m.z},candidate:{x:p.x,z:p.z},radius:MEMBER_RADIUS};
     return true;
    }
    if(!formationSweep(squad,nav,m,m,p,corridorScaleAt(flow.compressionProfile,flow.s),corridorScaleAt(flow.compressionProfile,next))){
     if(debugEnabled())previousRejection={reason:'swept-lineClear',memberIndex:i,
      from:{x:m.x,z:m.z},candidate:{x:p.x,z:p.z},radius:MEMBER_RADIUS};
     return true;
    }
    return false;
   }):-1;
   if(bad<0){positions=candidate;break;}
   if(previousRejection)debugTrace(squad,'rank-flow-reject',{...previousRejection,attempt,progress:flow.s,proposedProgress:next});
   // A validated corridor cannot safely change its shape *after* planning.
   // First drop purely cosmetic gait variation, then reduce the step length.
   if(flow.compressionProfile){
    if(noFootwork){next=(next+flow.s)*.5;}
    if(next<=flow.s+1e-5)break;
    const target=corridorScaleAt(flow.compressionProfile,next),deep=depthScale(target);
    flow.zp=deep;flow.zn=deep;
    for(const flank of flow.lat){flank.xp=target;flank.xn=target;}
    continue;
   }
   // Legacy paths (walls/ladders) retain the flank-aware safety fallback.
   const m=squad.members[bad],lat=flow.lat[flow.rankOf.get(m)],side=m.dx>0?'xp':'xn';
   if(flow.zp!==previousDepth.zp||flow.zn!==previousDepth.zn){flow.zp=previousDepth.zp;flow.zn=previousDepth.zn;continue;}
   if(m.dx!==0&&lat[side]>MIN_SQUEEZE+1e-6){lat[side]=SQUEEZE_LEVELS.find(l=>l<lat[side]-1e-6)??MIN_SQUEEZE;continue;}
   const depth=m.dz>=0?'zp':'zn';
   if(flow[depth]>MIN_SQUEEZE+1e-6){flow[depth]=SQUEEZE_LEVELS.find(l=>l<flow[depth]-1e-6)??MIN_SQUEEZE;continue;}
   if(next>flow.s+1e-4){next=(next+flow.s)*.5;continue;}
   break;
  }
  if(!positions)debugTrace(squad,'rank-flow-stop',{
   reason:'all-10-fit-attempts-failed',progress:flow.s,attemptedProgress:next,
   lastRejection:previousRejection});
  const progressed=positions&&next>flow.s+1e-9;
  squad.stretch=clamp((squad.stretch||0)+(progressed?dt/STRETCH_IN:-dt/STRETCH_OUT),0,1);
  if(positions){
   squad.members.forEach((m,i)=>{const p=positions[i];m.x=p.x;m.z=p.z;m.r=p.r;m.y=groundY(m.x,m.z);});
   flow.s=next;
  }
  squad.holdTime=progressed||(positions&&flow.compressionProfile&&
   corridorScaleAt(flow.compressionProfile,flow.s)<1-1e-6)?0:(squad.holdTime||0)+dt;
  const centre=flowPoint(flow,flow.s);
  squad.x=centre.x;squad.z=centre.z;squad.r=flowHeading(flow,flow.s);
  squad.squeeze={xp:Math.min(...flow.lat.map(l=>l.xp)),xn:Math.min(...flow.lat.map(l=>l.xn)),zp:flow.zp,zn:flow.zn};
  squad.phase='walking';squad.isTurning=false;squad.isWalking=true;
  // A blocked corridor is replanned for the complete formation. Never
  // turn an ordered infantry block into a column or scatter its members.
  if(squad.holdTime>REPLAN_DELAY){
   if(squad.destination&&order(squad,squad.destination,nav,squad.finalFacing).ok){
    debugTrace(squad,'corridor-replan',{reason:'blocked',progress:flow.s});
    return true;
   }
   return blocked(squad,groundY);
  }
  if(flow.s>=flow.end-1e-6){
   const after=flow.endIndex+1;
   settle(squad,nav,flow.end,flow.endYaw);
   squad.waypoint=after;
  }
  return true;
 }
 // Close the flowing ranks into the regular block: every soldier walks to
 // his own slot. Settles where the block fits, or a little way back.
 function settle(squad,nav,at,yaw=null){
  const flow=squad.flow;
  const q0={xp:Math.min(...flow.lat.map(l=>l.xp)),xn:Math.min(...flow.lat.map(l=>l.xn)),zp:flow.zp,zn:flow.zn};
  let pose=null;
  for(let back=0;back<=3&&!pose;back+=.25){
   const c=flowPoint(flow,at-back),h=yaw??flowHeading(flow,at-back);
   if(!nav||poseSafe(squad,c.x,c.z,h,nav,q0)){pose={c,h,q:q0};break;}
   const q=fitSqueeze(squad,c.x,c.z,h,nav);
   if(poseSafe(squad,c.x,c.z,h,nav,q))pose={c,h,q};
  }
  pose??={c:flowPoint(flow,at),h:yaw??flowHeading(flow,at),q:q0};
  squad.flow=null;squad.x=pose.c.x;squad.z=pose.c.z;squad.r=pose.h;squad.stretch=0;
  squad.individualTurn={yaw:pose.h,delta:0,q:pose.q,time:0,settle:true,fromFlow:true,soldiers:squad.members.map(m=>({
   m,slot:{dx:m.dx,dz:m.dz},to:slotPosition(pose.c.x,pose.c.z,pose.h,m,pose.q),startR:m.r,delay:0
  }))};
  squad.phase='closing';squad.isTurning=false;squad.isWalking=true;
 }
 function blocked(squad,groundY){
  // Preserve every man's formation slot. If no verified corridor exists,
  // stop together and report the obstruction rather than splitting apart.
  stop(squad);
  squad.blockedReason='No safe path for the complete formation. Move the destination or clear the passage.';
  if(!squad.individualTurn)occupy(squad,groundY);
  return true;
 }
 // An obstacle ahead: wait while the soldiers close in, and only give up if
 // the fully squeezed formation still cannot pass.
 function hold(squad,groundY,target){
  squad.holdTime=(squad.holdTime||0)+squad.lastStep;
  // The soldier who would touch the cliff closes in further: sideways first,
  // then front-to-back once his flank is fully squeezed.
  if(conflict){
   const side=conflict.dx>0?'xp':conflict.dx<0?'xn':null,depth=conflict.dz>0?'zp':conflict.dz<0?'zn':null;
   // Still held after a moment: close up front-to-back as well.
   const keys=side&&squad.squeeze[side]>MIN_SQUEEZE+1e-3&&squad.holdTime<.3?[side]:[side,depth];
   for(const key of keys){
    if(!key)continue;
    const tighter=SQUEEZE_LEVELS.find(l=>l<squad.squeeze[key]-1e-6)??MIN_SQUEEZE;
    squad.forced[key]=Math.min(squad.forced[key],tighter);target[key]=Math.min(target[key],tighter);
   }
  }
  if(squad.holdTime<MAX_HOLD&&(squeezing(squad,target)||squad.holdTime<HOLD_TIME)){
   occupy(squad,groundY);return true;
  }
  return blocked(squad,groundY);
 }
 function setup(squad,groundY){
  const slots=squadShape(squad,squad.units);
  squad.members=slots.map(slot=>({...slot,x:0,y:0,z:0,r:squad.r}));
  squad.outerFile=Math.max(0,...slots.map(slot=>Math.abs(slot.dx)));
  squad.coreFile=null;squad.coreFile=coreFile(squad);
  squad.radius=Math.max(.55,...slots.map(p=>Math.hypot(p.dx,p.dz)+.28));
  // Planning radius of the fully squeezed block, for passages the regular
  // block cannot fit through. Clearance is sampled on the half-cell grid and
  // both the centre and each soldier round to a sample, so keep ~.45 of
  // margin: enough that squeezing can always absorb the ragged cliff edge.
  squad.squeezedRadius=Math.max(.55,...slots.map(p=>Math.hypot(p.dx,p.dz)*MIN_SQUEEZE+.45));
  squad.columnRadius=columnRadius(slots);squad.outerFile=Math.max(0,...slots.map(slot=>Math.abs(slot.dx)));
  squad.pathRadius=squad.radius;squad.squeeze=unsqueezed();squad.forced=unsqueezed();squad.holdTime=0;
  squad.path=null;squad.destination=null;squad.waypoint=0;squad.blockedReason=null;
  squad.routeScale=1;squad.routeProfile=null;squad.corridorValidated=false;squad.exitTranslation=null;
  squad.isMoving=false;squad.isTurning=false;squad.isWalking=false;squad.phase='idle';
  occupy(squad,groundY);
  return squad;
 }
 // Adaptive files: everyone follows the same road, narrowing ranks near
 // obstacles and widening naturally in open ground. No designated leader.
 function columnRadius(slots){return Math.max(.45,...slots.map(p=>Math.abs(p.dx)*MIN_SQUEEZE+.15));}
 // Planning is shared by the hold-to-deploy preview and the real order.
 // It may fill navigation caches, but never changes a squad or its members.
 function planOrder(squad,destination,nav,finalFacing=null){
  const start={x:squad.x,z:squad.z};
  if(!squad.members.length)return {result:{ok:false,reason:'No soldiers remain.'},radius:CENTRE_RADIUS,columns:0};
  // A face-only order has NO travelling distance. A* used to manufacture an
  // 80 cm out-and-back road in order to provide a heading, sending the entire
  // troop off and then back before it finally turned! Do not ask A* for a
  // route, and do not sweep a rotating formation footprint just to face.
  if(Number.isFinite(finalFacing)&&Math.hypot(start.x-destination.x,start.z-destination.z)<=ARRIVAL_TOLERANCE){
   return {result:{ok:true,points:[start],length:0,scale:1,faceOnly:true,adjusted:false},
    radius:squad.radius,columns:squad.columnRadius??columnRadius(squad.members)};
  }
  const across=Math.max(...squad.members.map(m=>Math.abs(m.dx)));
  const depth=Math.max(...squad.members.map(m=>Math.abs(m.dz)));
  const preferred=clamp(Math.max(across,depth)*.85+.3,.48,squad.radius);
  const candidates=[preferred,squad.radius,Math.max(.55,preferred*.67),.38,.22];
  const failure={issue:null,points:null,route:null,progress:-1};
  const validate=(points,route)=>{
   if(route.edgeEscape)return null;
   // Every A* clearance option has its own rejected road. Preserve the
   // *most successful* attempt and its matching red failure marker rather
   // than drawing an unrelated first A* path with a collision from another.
   const attempted={issue:null,points:null};
   const fitted=validatedRoad(squad,points,nav,1,finalFacing,attempted);
   if(!fitted){
    const progress=attempted.issue?.distance!=null?
     attempted.issue.distance/Math.max(.1,route.length||1):-.01;
    if(progress>failure.progress){
     failure.issue=attempted.issue;
     failure.points=attempted.points||points.map(p=>({x:p.x,z:p.z}));
     failure.route=route;
     failure.progress=progress;
    }
   }
   return fitted;
  };
  let result=nav.planFormation?
   nav.planFormation(start,destination,candidates,validate):null;
  if(!result){
   // Compatible with lightweight/mock navigation implementations.
   result={ok:false,reason:'No formation-aware navigation available.'};
   for(const radius of candidates){
    const route=nav.plan(start,destination,radius);
    if(!route.ok){result=route;continue;}
    const fitted=validate(route.points,route);
    if(fitted){result={...route,...fitted,radius};break;}
   }
  }
  // WIDE-LANE RESCUE: Search a larger coherent sideways manoeuvre only
  // ONCE, using the best already found A* candidate. Doing this for every
  // radius and corner trim multiplied failed-order work by 10+ on large maps.
  // It cannot change terrain passability and it never changes soldier slots.
  if(!result.ok&&!result.deferred&&failure.route?.ok&&failure.points){
   const extra=validatedRoad(squad,failure.points,nav,1,finalFacing,null,false,MAX_CORRIDOR_SHIFT);
   if(extra)result={...failure.route,...extra};
  }
  if(!result.ok&&nav.planEdgeEscape){
   // The existing dedicated extraction is only for a troop spawned directly
   // on a cliff fringe. It moves all soldiers by a common translation.
   const escape=nav.planEdgeEscape(start,destination,squad.radius);
   if(escape.ok){
    const safePart=[escape.edgeEscapeTo,...escape.points.slice(2)];
    const fitted=validatedRoad(squad,safePart,nav,1,finalFacing);
    if(fitted)result={...escape,points:[start,...fitted.points],scale:fitted.scale,
     length:escape.length,radius:squad.radius,edgeEscape:true};
   }
  }
  if(!result.ok&&!result.deferred){
   const extracted=extractRoute(squad,destination,nav,finalFacing,candidates);
   if(extracted)result=extracted;
  }
  if(!result.ok){
   // A* failure is distinct from a path that A* found but a soldier cannot
   // follow. Keep the first concrete obstacle for the F6 X-ray.
   result={...result,diagnostic:failure.issue,failedRoute:failure.points};
  }
  return {result,radius:result.radius??squad.radius,columns:squad.columnRadius??columnRadius(squad.members)};
 }
 // An intact troop boxed against a cliff or the world edge may be unable to
 // pivot on the spot. Route planning used to reject the order even if the
 // soldiers could all TRANSLATE a short distance into turning space. Treat
 // that first translation as its own swept manoeuvre, before the normal
 // corridor begins. At no point may a previously safe soldier enter MLG,
 // water, solid geometry, or leave the map.
 const EXIT_SAMPLE=.18,EXIT_MAX=5.5,EXIT_ATTEMPTS=4;
 const exitCandidateCache=new WeakMap();
 function translationFits(squad,nav,to){
  if(squad.flow||squad.individualTurn||squad.defile)return false;
  const from={x:squad.x,z:squad.z},length=Math.hypot(to.x-from.x,to.z-from.z);
  if(length<.3||length>EXIT_MAX+1e-6)return false;
  const count=Math.ceil(length/EXIT_SAMPLE);
  const mx=to.x-from.x,mz=to.z-from.z;
  // Reject most near-cliff positions without doing a full 30-man sweep.
  if(!nav.canStand(to.x,to.z,CENTRE_RADIUS)||
   squad.members.some(m=>!footClear(nav,m.x+mx,m.z+mz,CORRIDOR_MEMBER_RADIUS)))return false;
  const initial=squad.members.map(m=>({x:m.x,z:m.z}));
  // Do not conceal dispersed or rearranging troops by snapping them onto a
  // mathematical rectangle before performing the extraction.
  if(initial.some((p,i)=>{
   const q=slotPosition(from.x,from.z,squad.r,squad.members[i],squad.squeeze||unsqueezed());
   return Math.hypot(p.x-q.x,p.z-q.z)>.18;
  }))return false;
  let previousCenter=from,previous=initial;
  for(let i=1;i<=count;i++){
   const t=i/count,dx=(to.x-from.x)*t,dz=(to.z-from.z)*t;
   const center={x:from.x+dx,z:from.z+dz};
   const safe=nav.lineClear(previousCenter,center,CENTRE_RADIUS);
   if(!safe&&((nav.canStand(previousCenter.x,previousCenter.z,CENTRE_RADIUS)&&
     !nav.canStand(center.x,center.z,CENTRE_RADIUS))||
     !nav.edgeStep?.(previousCenter,center,CENTRE_RADIUS)))return false;
   const members=[];
   for(let k=0;k<initial.length;k++){
    const next={x:initial[k].x+dx,z:initial[k].z+dz},prior=previous[k];
    if(!footSweep(nav,prior,next,CORRIDOR_MEMBER_RADIUS)){
     // The exception is ONLY for a footprint that was already on the soft
     // blocked fringe, moving steadily out. It never legalises a fresh hit.
     if((footClear(nav,prior.x,prior.z,CORRIDOR_MEMBER_RADIUS)&&
       !footClear(nav,next.x,next.z,CORRIDOR_MEMBER_RADIUS))||
      !nav.edgeStep?.(prior,next,CORRIDOR_MEMBER_RADIUS))return false;
    }
    members.push(next);
   }
   previousCenter=center;previous=members;
  }
  return nav.canStand(to.x,to.z,CENTRE_RADIUS)&&previous.every(p=>footClear(nav,p.x,p.z,CORRIDOR_MEMBER_RADIUS));
 }
 function extractRoute(squad,goal,nav,finalFacing,radii){
  if(squad.flow||squad.individualTurn||squad.defile||!nav.plan)return null;
  const start={x:squad.x,z:squad.z},direction=Math.atan2(goal.x-start.x,goal.z-start.z);
  const first=squad.members[0],last=squad.members[squad.members.length-1];
  const previous=exitCandidateCache.get(squad);
  const valid=previous&&previous.nav===nav&&previous.revision===nav.revision&&
   previous.x===squad.x&&previous.z===squad.z&&previous.r===squad.r&&
   previous.firstX===first?.x&&previous.firstZ===first?.z&&previous.lastX===last?.x&&previous.lastZ===last?.z;
  const cache=valid?previous:{nav,revision:nav.revision,x:squad.x,z:squad.z,r:squad.r,
   firstX:first?.x,firstZ:first?.z,lastX:last?.x,lastZ:last?.z,tests:new Map()};
  exitCandidateCache.set(squad,cache);
  const offsets=[0,1,-1,2,-2,3,-3,4,-4,5,-5,6,-6,7,-7,8];
  let attempts=0;
  // Evaluate lazily: it is wasteful (and can exhaust the per-frame RTS work
  // budget) to sweep 30 soldiers along 96 possible exits when the first few
  // are enough. Never probe off-map positions beyond the candidate's radius.
  for(const d of [.8,1.4,2.1,3,4.2,5.5])for(const k of offsets){
   const a=direction+k*Math.PI/8,p={x:start.x+Math.sin(a)*d,z:start.z+Math.cos(a)*d};
   const key=`${p.x.toFixed(3)},${p.z.toFixed(3)}`;
   let fits=cache.tests.get(key);
   if(fits===undefined){fits=translationFits(squad,nav,p);cache.tests.set(key,fits);}
   if(!fits)continue;
   // A pivot toward the target is a cheap prefilter for tight corners. A
   // valid route may still bend away initially, so try alternative angles
   // when the direct pivot does not fit.
   const projected=Math.atan2(goal.x-p.x,goal.z-p.z);
   if(!pivotFits(squad,p.x,p.z,squad.r,projected,nav,squad.squeeze||unsqueezed()))continue;
   if(attempts++>=EXIT_ATTEMPTS)return null;
   const simulated={...squad,x:p.x,z:p.z};
   const validate=points=>validatedRoad(simulated,points,nav,1,finalFacing);
   const found=nav.planFormation?nav.planFormation(p,goal,radii,validate):
    radii.map(radius=>{
     const route=nav.plan(p,goal,radius),fitted=route.ok?validate(route.points):null;
     return fitted?{...route,...fitted}:route;
    }).find(r=>r.ok&&r.scale);
   if(found?.deferred)return found;
   if(!found?.ok||!found.scale)continue;
   const road=found.points;
   return {...found,exitTranslation:{x:p.x,z:p.z},roadPoints:road,
    points:[start,...road],length:found.length+d,adjusted:found.adjusted||false};
  }
  return null;
 }
 // Slowly march the exact same slots out of a cramped starting pocket, then
 // pivot as one on the already validated road. No column or rearrangement.
 function extractionAdvance(squad,dt,groundY,speed,nav){
  const target=squad.exitTranslation;
  if(!target)return false;
  const dx=target.x-squad.x,dz=target.z-squad.z,d=Math.hypot(dx,dz);
  if(d<=.0001){
   squad.x=target.x;squad.z=target.z;squad.exitTranslation=null;
   squad.phase='turning';return true;
  }
  const step=Math.min(d,Math.max(0,speed)*dt*.8);
  if(step<=0)return true;
  const mx=dx/d*step,mz=dz/d*step;
  const prior={x:squad.x,z:squad.z},next={x:prior.x+mx,z:prior.z+mz};
  if(!nav.lineClear(prior,next,CENTRE_RADIUS)&&
   ((nav.canStand(prior.x,prior.z,CENTRE_RADIUS)&&!nav.canStand(next.x,next.z,CENTRE_RADIUS))||
    !nav.edgeStep?.(prior,next,CENTRE_RADIUS)))return blocked(squad,groundY);
  for(const m of squad.members){
   const p={x:m.x+mx,z:m.z+mz};
   if(!formationSweep(squad,nav,m,m,{...p,r:m.r})&&
    ((formationFoot(squad,nav,m,m)&&!formationFoot(squad,nav,m,{...p,r:m.r}))||
     !nav.edgeStep?.(m,p,CORRIDOR_MEMBER_RADIUS)))return blocked(squad,groundY);
  }
  squad.x=next.x;squad.z=next.z;
  for(const m of squad.members){m.x+=mx;m.z+=mz;m.y=groundY(m.x,m.z);}
  squad.phase='walking';squad.isMoving=true;squad.isWalking=true;squad.isTurning=false;
  if(step>=d-1e-6){squad.x=target.x;squad.z=target.z;squad.exitTranslation=null;}
  return true;
 }
 // ---- Column through narrow ground -----------------------------------------
 // Where the block cannot pass, the troop marches as a column whose width
 // follows the ground: its full front in the open, fewer files at a gap
 // (one man where it must), keeping to the open side where the road hugs a
 // cliff. Ranks keep their spacing; the men queue where the column
 // lengthens and close up where it widens again, and beyond it the block
 // re-forms (finish). Each man is held as a distance along the road and an
 // offset across it, so nobody cuts a corner or wanders off the road.
 const DEFILE_RADII=[.55,.3];
 const COLUMN_SAMPLE=.25,COLUMN_MARGIN=.14,COLUMN_WINDOW=.6,COLUMN_GAP=1.15;
 const COLUMN_CATCH_UP=1.35,COLUMN_SIDESTEP=.9,COLUMN_BLEND=.35,COLUMN_DONE=.3;
 // Cohesive motion is measured along the shared road, not straight-line
 // distance (hairpins can put distant ranks physically near each other).
 const COLUMN_MAX_LAG=1.05,COLUMN_MAX_OFFSET=.7;

 // The road a marching block or column has covered, up to where it stands.
 function trailOf(flow){
  const points=[];
  for(let i=0;i<flow.line.length&&flow.cumulative[i]<flow.s-1e-3;i++)points.push(flow.line[i]);
  points.push(flowPoint(flow,flow.s));
  return points;
 }
 function columnPoint(flow,s,l){
  const p=flowPoint(flow,s),h=flowHeading(flow,s);
  return {x:p.x+Math.cos(h)*l,z:p.z-Math.sin(h)*l,r:h};
 }
 // A man's place on the road: the nearest point no further along than `limit`.
 function onRoad(flow,p,limit){
  let best=null;
  for(let i=1;i<flow.line.length&&flow.cumulative[i-1]<=limit;i++){
   const a=flow.line[i-1],b=flow.line[i],length=flow.cumulative[i]-flow.cumulative[i-1];if(length<1e-9)continue;
   const ux=(b.x-a.x)/length,uz=(b.z-a.z)/length,t=clamp((p.x-a.x)*ux+(p.z-a.z)*uz,0,Math.min(length,limit-flow.cumulative[i-1]));
   const d=Math.hypot(p.x-a.x-ux*t,p.z-a.z-uz*t);
   if(!best||d<best.d)best={d,s:flow.cumulative[i-1]+t};
  }
  const c=columnPoint(flow,best?.s??0,0);
  return {s:best?.s??0,l:(p.x-c.x)*Math.cos(c.r)-(p.z-c.z)*Math.sin(c.r)};
 }
 // Closest legal road parameter in a local arc-length window. The old
 // all-segment projection made recovery O(N soldiers × N route segments ×
 // candidate headings) and could jump across nearby hairpin branches.
 function onRoadNear(flow,p,low,high){
  const {line,cumulative}=flow;
  const lo=clamp(low,0,cumulative[cumulative.length-1]),hi=clamp(high,lo,cumulative[cumulative.length-1]);
  let a=1,b=line.length-1;
  while(a<b){const mid=(a+b)>>>1;if(cumulative[mid]<lo)a=mid+1;else b=mid;}
  let best=null;
  for(let i=a;i<line.length&&cumulative[i-1]<=hi;i++){
   const A=line[i-1],B=line[i],len=cumulative[i]-cumulative[i-1];if(len<1e-9)continue;
   const ux=(B.x-A.x)/len,uz=(B.z-A.z)/len;
   const t=clamp((p.x-A.x)*ux+(p.z-A.z)*uz,Math.max(0,lo-cumulative[i-1]),Math.min(len,hi-cumulative[i-1]));
   const d=Math.hypot(p.x-A.x-ux*t,p.z-A.z-uz*t);
   if(!best||d<best.d)best={d,s:cumulative[i-1]+t};
  }
  const c=columnPoint(flow,best?.s??lo,0);
  return {s:best?.s??lo,l:(p.x-c.x)*Math.cos(c.r)-(p.z-c.z)*Math.sin(c.r)};
 }
 function columnState(flow,nav,m,limit){
  const at=onRoad(flow,m,limit);let p=columnPoint(flow,at.s,at.l);
  if(nav&&(!footClear(nav,p.x,p.z,MEMBER_RADIUS)||!footSweep(nav,m,p,MEMBER_RADIUS))){at.l=0;p=columnPoint(flow,at.s,0);}
  // ex/ez: how far he stands from that place; it fades as he falls in.
  // Capture the soldier's initial lane position for this journey. Sorting
  // by the constantly changing lateral coordinate each frame swaps rank
  // targets when soldiers squeeze past one another or go around a bend.
  return {s:at.s,l:at.l,entryL:at.l,ex:m.x-p.x,ez:m.z-p.z,S:at.s,L:at.l,stuck:0};
 }
 // Free ground either side of the road at sample k (metres to the right, to
 // the left), up to the room the troop's full front could use.
 function columnRoom(flow,nav,k){
  if(flow.room[k])return flow.room[k];
  const c=columnPoint(flow,k*COLUMN_SAMPLE,0),ox=Math.cos(c.r),oz=-Math.sin(c.r);
  const reach=side=>{
   if(!nav||!footClear(nav,c.x,c.z,MEMBER_RADIUS))return 0;
   let free=0,y=nav.worldHeight(c.x,c.z);
   for(let d=.1;d<=flow.reach+1e-9;d+=.1){
    const x=c.x+ox*side*d,z=c.z+oz*side*d,h=nav.worldHeight(x,z);
    if(!footClear(nav,x,z,MEMBER_RADIUS)||Math.abs(h-y)>.3)break;
    free=d;y=h;
   }
   return free;
  };
  return flow.room[k]=[reach(1),reach(-1)];
 }
 // How many files a rank at distance s marches in, and where its middle
 // runs: the narrowest ground within a step or so either way decides.
 function columnRank(flow,nav,s){
  if(s<flow.start)return {files:flow.widest,mid:0};
  const k0=Math.floor(Math.max(flow.start,s-COLUMN_WINDOW)/COLUMN_SAMPLE),k1=Math.floor(Math.min(flow.end,s+COLUMN_WINDOW)/COLUMN_SAMPLE);
  let right=Infinity,left=Infinity;
  for(let k=k0;k<=k1;k++){const [r,l]=columnRoom(flow,nav,k);right=Math.min(right,r);left=Math.min(left,l);}
  const files=clamp(Math.floor((right+left-2*COLUMN_MARGIN)/flow.across+1e-6)+1,1,flow.widest);
  const half=(files-1)/2*flow.across,lo=half-left+COLUMN_MARGIN,hi=right-COLUMN_MARGIN-half;
  return {files,mid:lo>hi?(lo+hi)/2:clamp(0,lo,hi),
   debugInvalid:lo>hi,debugRight:right,debugLeft:left,debugLow:lo,debugHigh:hi};
 }
 function beginColumn(squad,nav){
  const road=[{x:squad.x,z:squad.z}];
  for(const p of squad.path.slice(squad.waypoint)){const q=road[road.length-1];if(Math.hypot(p.x-q.x,p.z-q.z)>1e-3)road.push({x:p.x,z:p.z});}
  let trail=squad.columnTrail||null;squad.columnTrail=null;
  if(road.length<2)return false;
  const unit=(a,b)=>{const d=Math.hypot(b.x-a.x,b.z-a.z)||1;return {x:(b.x-a.x)/d,z:(b.z-a.z)/d};};
  const n=squad.members.length,first=unit(road[0],road[1]),gap=rowSpacing(squad)*COLUMN_GAP;
  // The road the men came along leads into the column, unless the new road
  // turns back along it (then the rear leads off).
  trail=trail?.filter((p,i,all)=>!i||Math.hypot(p.x-all[i-1].x,p.z-all[i-1].z)>1e-3)||null;
  if(trail&&trail.length>=2){const u=unit(trail[trail.length-2],trail[trail.length-1]);if(u.x*first.x+u.z*first.z<0)trail=null;}else trail=null;
  const behind=trail?trail.slice(0,-1):[],origin=behind[0]||road[0],lead=behind.length?unit(behind[0],behind[1]||road[0]):first;
  const line=[{x:origin.x-lead.x*(n*gap+2),z:origin.z-lead.z*(n*gap+2)},...behind,...road];
  // The head marches on past the road's end by half the block's depth where
  // there is room, so the block forms round the destination.
  const last=unit(road[road.length-2],road[road.length-1]),end=road[road.length-1],front=Math.max(0,...squad.members.map(m=>m.dz));
  let ahead=0;
  for(let d=.25;d<=front+1e-9;d+=.25){if(nav&&!nav.canStand(end.x+last.x*d,end.z+last.z*d,CENTRE_RADIUS))break;ahead=d;}
  if(ahead>0)line.push({x:end.x+last.x*ahead,z:end.z+last.z*ahead});
  const cumulative=[0];
  for(let i=1;i<line.length;i++)cumulative.push(cumulative[i-1]+Math.hypot(line[i].x-line[i-1].x,line[i].z-line[i-1].z));
  const widest=widestFront(n),across=squad.spacing?.x||ROW_SPACING,start=cumulative[1+behind.length];
  const flow={column:true,line,cumulative,window:.5,start,end:cumulative[cumulative.length-1],room:[],widest,across,gap,
   // Each soldier follows the same road. A shared elastic spacing is adjusted
   // from the *whole* troop's errors, not from a designated leading soldier.
   packedGap:gap,minGap:Math.max((squad.spacing?.z||ROW_SPACING)*.70,MEMBER_RADIUS*2.4),
   reach:(widest-1)*across+2*COLUMN_MARGIN+.1,state:new Map(),order:null,s:start,hold:0,
   maxLag:0,maxOffset:0,targetsReady:false,clock:0,nextReplan:0,revision:nav?.revision??0};
  for(const m of squad.members)flow.state.set(m,columnState(flow,nav,m,start+n*gap+2));
  // Marching order: the men furthest along lead.
  const at=m=>flow.state.get(m);
  flow.order=[...squad.members].sort((a,b)=>at(b).s-at(a).s||at(a).l-at(b).l);
  flow.s=Math.max(start,at(flow.order[0]).s);
  squad.flow=flow;squad.individualTurn=null;squad.stretch=0;
  return true;
 }
 // Recover at a narrow edge by choosing a nearby legal road offset.
 // Cheap bounded steering first, then a throttled nav.plan() only if needed.
 // Returns null when there is no legal local step; never teleports a soldier.
 // Fallback steering in world coordinates. A blocked soldier is NOT assumed
 // to be at his ideal path parameter; a blocked step never advances st.s.
 // Sample both sides, short forward motions and slight retreat around corners.
 function columnRecovery(flow,st,m,nav,maxStep){
  if(!nav||maxStep<=1e-6)return null;
  const target=columnPoint(flow,Math.min(flow.end,Math.max(st.s,st.S)),st.L);
  const base=Math.atan2(target.x-m.x,target.z-m.z);
  const pathHead=flowHeading(flow,st.s);
  const headings=[base,pathHead,base+.45,base-.45,pathHead+.9,pathHead-.9,
                  base+Math.PI/2,base-Math.PI/2,base+Math.PI];
  let best=null;
  const oldDistance=Math.hypot(target.x-m.x,target.z-m.z);
  for(const heading of headings){
   for(const multiplier of [1,.5,.25]){
    const d=maxStep*multiplier,x=m.x+Math.sin(heading)*d,z=m.z+Math.cos(heading)*d;
    if(!footClear(nav,x,z,MEMBER_RADIUS)||!footSweep(nav,m,{x,z},MEMBER_RADIUS))continue;
    const nextDist=Math.hypot(target.x-x,target.z-z);
    const projected=onRoadNear(flow,{x,z},st.s-1.2,Math.min(flow.end,st.s+2));
    const advance=clamp(projected.s-st.s,-d*2,d*2);
    const improvement=oldDistance-nextDist;
    const score=advance*1.8+improvement*1.2-Math.abs(projected.l-st.L)*.13;
    if(!best||score>best.score)best={x,z,s:projected.s,l:projected.l,score};
   }
  }
  // Do not oscillate for no benefit: a small temporary sideways motion is
  // useful, but do not bounce the soldier back and forth indefinitely.
  if(best&&best.score>-.02)return best;
  return null;
 }
 // One-off A* escape for a stuck soldier, throttled across the whole troop.
 // This is only used when cheap local steering and the shared road cannot
 // resolve a real obstacle. No per-soldier per-frame path requests.
 function memberDetour(squad,flow,st,m,nav,step,groundY,dt){
  if(!nav)return false;
  if(st.route&&st.routeIndex<st.route.length){
   while(st.routeIndex<st.route.length&&
    Math.hypot(st.route[st.routeIndex].x-m.x,st.route[st.routeIndex].z-m.z)<.065)st.routeIndex++;
   if(st.routeIndex<st.route.length){
    const to=st.route[st.routeIndex],dx=to.x-m.x,dz=to.z-m.z,d=Math.hypot(dx,dz);
    const travel=Math.min(d,step*COLUMN_CATCH_UP*1.2);
    const next={x:m.x+dx*travel/d,z:m.z+dz*travel/d};
    if(footClear(nav,next.x,next.z,MEMBER_RADIUS)&&footSweep(nav,m,next,MEMBER_RADIUS)){
     m.x=next.x;m.z=next.z;m.y=groundY(m.x,m.z);
     m.r+=clamp(deltaAngle(m.r,Math.atan2(dx,dz)),-SOLDIER_TURN_SPEED*dt,SOLDIER_TURN_SPEED*dt);
     const projected=onRoadNear(flow,m,st.s-1.2,Math.min(flow.end,st.s+Math.max(2,step*4)));
     st.s=clamp(projected.s,Math.max(0,st.s-step*2),st.s+step*COLUMN_CATCH_UP*2.5);
     st.l=projected.l;
     const ideal=columnPoint(flow,st.s,st.l);
     st.ex=m.x-ideal.x;st.ez=m.z-ideal.z;
     st.stuck=0;return true;
    }
    // The world changed since this detour was generated.
    st.route=null;st.routeIndex=0;
   }else{st.route=null;st.routeIndex=0;}
  }
  if(!nav.plan||st.stuck<.65||flow.clock-(st.lastRepath??-Infinity)<2.1||
     flow.clock-(flow.lastDetour??-Infinity)<.22)return false;
  st.lastRepath=flow.lastDetour=flow.clock;
  // Select a different recovery anchor each retry. Never run six complete
  // A* searches for one soldier in the same animation frame.
  const attempts=[[1.6,0],[.75,0],[.25,0],[1.6,st.L],[.75,st.L],[.25,st.L]];
  // Three alternatives per retry prevent one stuck soldier from consuming
  // six full A* budgets in one animation frame. Rotate through all anchors.
  const start=st.recoveryAttempt||0;st.recoveryAttempt=(start+3)%attempts.length;
  for(let i=0;i<3;i++){
   const [ds,lateral]=attempts[(start+i)%attempts.length];
   const s=Math.min(flow.end,Math.max(st.s,Math.min(st.S,st.s+ds)));
   const target=columnPoint(flow,s,lateral);
   if(!footClear(nav,target.x,target.z,MEMBER_RADIUS))continue;
   const run=()=>nav.plan({x:m.x,z:m.z},target,MEMBER_RADIUS);
   const result=nav.withWorkBudget?nav.withWorkBudget(2304,run):run();
   if(result?.deferred){st.lastRepath=flow.clock-1.4;return false;}
   if(!result?.ok||result.points?.length<2)continue;
   const end=result.points[result.points.length-1];
   if(Math.hypot(end.x-target.x,end.z-target.z)>.45)continue;
   st.route=result.points.slice(1).map(p=>({x:p.x,z:p.z}));
   st.routeIndex=0;st.stuck=0;
   return memberDetour(squad,flow,st,m,nav,step,groundY,dt);
  }
  return false;
 }
 // Recheck the shared navigation only after a sustained standstill or a map
 // revision. Replanning has a cooldown, preserving current soldier positions.
 function columnReplan(squad,flow,nav){
  if(!nav?.plan||!squad.destination||flow.clock<(flow.nextReplan||0))return false;
  flow.nextReplan=flow.clock+2.8;
  const at={x:squad.x,z:squad.z};
  const radii=[Math.min(.3,squad.pathRadius||.3),.12];
  for(const radius of radii){
   const run=()=>nav.plan(at,squad.destination,radius);
   const result=nav.withWorkBudget?nav.withWorkBudget(3500,run):run();
   if(result?.deferred){flow.nextReplan=flow.clock+1;return false;}
   if(!result?.ok||result.points?.length<2)continue;
   const points=result.points;
   // Do not mistake a new route for the old route just because both
   // approach the same first corner. Compare the COMPLETE remaining road;
   // alternate routes frequently share an initial waypoint at a chokepoint.
   const previous=squad.path?[{x:at.x,z:at.z},...squad.path.slice(squad.waypoint)]:[];
   const unchanged=previous.length===points.length&&points.every((p,i)=>
    Math.hypot(p.x-previous[i].x,p.z-previous[i].z)<.14);
   if(unchanged&&flow.revision===nav.revision)continue;
   squad.columnTrail=trailOf(flow);
   squad.flow=null;squad.path=points;squad.waypoint=1;
   squad.defile={};squad.pathRadius=radius;squad.blockedReason=null;
   return true;
  }
  return false;
 }
 function columnAdvance(squad,dt,groundY,speed,nav){
  const flow=squad.flow,state=flow.state;squad.lastStep=dt;flow.clock=(flow.clock||0)+dt;
  if(flow.revision!==(nav?.revision??0)){
   flow.revisionChanged=true;flow.revision=nav?.revision??0;
   flow.nextReplan=Math.min(flow.nextReplan||0,flow.clock+.3);
   for(const st of state.values()){st.route=null;st.routeIndex=0;}
  }
  // A gate/building change invalidates the cached width of this road.
  if(flow.roomRevision!==nav?.revision){flow.room=[];flow.roomRevision=nav?.revision;}
  // The fallen leave the column; a man joining it falls in at the tail.
  if(flow.order.length!==squad.members.length||squad.members.some(m=>!state.has(m))){
   const present=new Set(squad.members);flow.order=flow.order.filter(m=>present.has(m));
   for(const m of squad.members)if(!state.has(m)){state.set(m,columnState(flow,nav,m,flow.end));flow.order.push(m);}
   if(!flow.order.length){squad.flow=null;stop(squad);return true;}
  }
  const step=Math.max(0,speed)*dt,sidestep=step*COLUMN_SIDESTEP,before=flow.s;
  // Elastic ranks: shrink the distance between files/ranks if the road
  // narrows or the troop stretches. Relax back to normal in free ground.
  // This is squad-wide behaviour; no soldier is appointed as a leader.
  const crowded=flow.targetsReady&&(flow.maxLag>.38||flow.maxOffset>.35);
  const desiredGap=crowded?flow.minGap:flow.gap;
  const gapRate=crowded?2.2:.6;
  flow.packedGap+=clamp(desiredGap-flow.packedGap,-gapRate*dt,gapRate*dt);
  // Keep marching smoothly while the group closes up; hard stop only when
  // a member truly cannot move through the navigable corridor. Advancing
  // endlessly past an immobile soldier would silently recreate stragglers.
  // Only *longitudinal* lag can stop the shared route. Lateral formation
  // slots may be temporarily unreachable at a bend; freezing forward travel
  // because of their offset deadlocks the entire column. Real movement is
  // still checked per soldier below (canStand + swept lineClear), and a man
  // who cannot move forward accumulates longitudinal lag and limits the pace.
  const pressure=flow.targetsReady?flow.maxLag/COLUMN_MAX_LAG:0;
  const pace=pressure<=.6?1:clamp(1.6-pressure,.12,1);
  if(!flow.targetsReady||pressure<1.75)
   flow.s=Math.min(flow.end,flow.s+step*pace);
  else debugTrace(squad,'column-hold',{reason:'forward-lag-pressure',pressure,
   maxLag:flow.maxLag,maxOffset:flow.maxOffset,progress:flow.s});
  // Every rank gets as many files as the terrain admits. Narrow gaps cause
  // queueing and compact rows, then ranks unfold automatically in the open.
  for(let i=0,d=flow.s;i<flow.order.length;d-=flow.packedGap){
   const rankInfo=columnRank(flow,nav,d),{files,mid}=rankInfo;
   if(rankInfo.debugInvalid)debugTrace(squad,'lane-impossible',{
    reason:'lane-width-below-required',progress:d,files,right:rankInfo.debugRight,left:rankInfo.debugLeft,
    minimum:2*COLUMN_MARGIN,low:rankInfo.debugLow,high:rankInfo.debugHigh,
    candidate:columnPoint(flow,d,mid)});
   const rank=flow.order.slice(i,i+files);i+=files;
   // Lane identity is fixed when the column is formed. Current steering
   // position may fluctuate, but it must not make soldiers trade lanes.
   rank.sort((a,b)=>state.get(a).entryL-state.get(b).entryL);
   rank.forEach((m,j)=>{const st=state.get(m);st.S=d;st.L=mid+(j-(rank.length-1)/2)*flow.across;});
  }
  const fade=Math.exp(-dt/COLUMN_BLEND);
  let moved=false,closed=true,maxLag=0,maxOffset=0;
  for(const m of flow.order){
   const st=state.get(m);
   // Catch up with his place, never walking back: a man whose place fell
   // behind him (the column lengthening at a gap) waits for it.
   let s=st.s,l=st.l;
   if(st.S>s+1e-3)s=Math.min(st.S,s+step*COLUMN_CATCH_UP);
   else if(flow.s>=flow.end-.25&&st.S<s-.09){
    // File-count changes can leave a man slightly AHEAD of his final slot.
    // The previous controller prohibited all backward correction forever,
    // so large troops waited at the destination even on wide open terrain.
    // Allow slow, individually swept final shuffling; never drag him back
    // through the tight passage while the front is still marching.
    s=Math.max(st.S,s-step*.8);
   }
   // Always settle sideways, even when already at the correct forward
   // position. Otherwise a frozen shared route prevents the very lateral
   // correction needed to make progress again.
   l+=clamp(st.L-l,-sidestep,sidestep);
   // Where the road narrows he closes in before stepping on.
   if(s>=flow.start){
    const [r,left]=columnRoom(flow,nav,Math.round(s/COLUMN_SAMPLE)),lo=COLUMN_MARGIN/2-left,hi=r-COLUMN_MARGIN/2;
    const fit=lo>hi?(lo+hi)/2:clamp(l,lo,hi);
    if(Math.abs(fit-l)>sidestep*1.5&&s>st.s){s=st.s;l=st.l+clamp(fit-st.l,-sidestep,sidestep);}else l=fit;
   }
   const p=columnPoint(flow,s,l);
   let ex=st.ex*fade,ez=st.ez*fade,x=p.x+ex,z=p.z+ez;
   // Nobody walks faster than a catching-up pace (an outer man swinging
   // round a bend, a man falling in from aside): he trails his place a
   // little instead, and closes the distance as the offset fades.
   const far=Math.hypot(x-m.x,z-m.z),most=step*COLUMN_CATCH_UP*1.2;
   if(far>most){x=m.x+(x-m.x)*most/far;z=m.z+(z-m.z)*most/far;ex=x-p.x;ez=z-p.z;}
   let rejected=null;
   if(nav){
    if(!footClear(nav,x,z,MEMBER_RADIUS))rejected='destination-canStand';
    else if(!footSweep(nav,m,{x,z},MEMBER_RADIUS))rejected='swept-lineClear';
   }
   if(rejected){
    debugTrace(squad,'column-step-reject',{reason:rejected,memberIndex:squad.members.indexOf(m),
     from:{x:m.x,z:m.z},candidate:{x,z},radius:MEMBER_RADIUS,
     currentProgress:st.s,goalProgress:st.S,lateral:st.l,goalLateral:st.L,
     actualCenter:{x:squad.x,z:squad.z},progress:flow.s});
    // The soldier's offset may be unsafe even though the shared route is
    // valid (river edge, tight corner). First steer toward the lane centre,
    // keeping the swept motion legal. No group-wide freeze for this case.
    const safe=columnRecovery(flow,st,m,nav,step*COLUMN_CATCH_UP*1.2);
    if(debugEnabled())debugTrace(squad,'column-recovery',{
     memberIndex:squad.members.indexOf(m),success:!!safe,
     currentProgress:st.s,goalProgress:st.S,from:{x:m.x,z:m.z},
     candidate:safe?{x:safe.x,z:safe.z}:null});
    if(safe){
     x=safe.x;z=safe.z;
     // The lateral error is measured at the actual, not desired, position.
     // Do not mark a soldier farther along unless he actually got there.
     s=Math.max(st.s,Math.min(s,safe.s));
     const centre=columnPoint(flow,s,0);
     l=(x-centre.x)*Math.cos(centre.r)-(z-centre.z)*Math.sin(centre.r);
     const base=columnPoint(flow,s,l);ex=x-base.x;ez=z-base.z;
    }else{
     st.stuck=(st.stuck||0)+dt;
     debugTrace(squad,'column-no-local-step',{
      reason:'recovery-exhausted',memberIndex:squad.members.indexOf(m),
      currentProgress:st.s,goalProgress:st.S,from:{x:m.x,z:m.z},stuckSeconds:st.stuck});
     if(memberDetour(squad,flow,st,m,nav,step,groundY,dt)){
      moved=true;closed=false;
      maxLag=Math.max(maxLag,Math.max(0,st.S-st.s));
      maxOffset=Math.max(maxOffset,Math.hypot(st.ex,st.ez),Math.abs(st.L-st.l));
      continue;
     }
     closed=false;maxLag=Math.max(maxLag,Math.max(0,st.S-st.s));
     maxOffset=Math.max(maxOffset,Math.hypot(st.ex,st.ez),Math.abs(st.L-st.l));
     continue;
    }
   }
   // Existing detours must run until the man catches up with the shared
   // road; otherwise the next ordinary target can pull him into the wall.
   if(st.route&&memberDetour(squad,flow,st,m,nav,step,groundY,dt)){
    moved=true;closed=false;
    maxLag=Math.max(maxLag,Math.max(0,st.S-st.s));
    maxOffset=Math.max(maxOffset,Math.hypot(st.ex,st.ez),Math.abs(st.L-st.l));
    continue;
   }
   if(Math.hypot(x-m.x,z-m.z)>1e-4){
    moved=true;
    if(s>st.s+1e-4)m.r+=clamp(deltaAngle(m.r,p.r),-SOLDIER_TURN_SPEED*dt,SOLDIER_TURN_SPEED*dt);
   }
   if(st.route&&st.routeIndex>=st.route.length){st.route=null;st.routeIndex=0;}
   Object.assign(st,{s,l,ex,ez,stuck:0});m.x=x;m.z=z;m.y=groundY(x,z);
   const behind=Math.max(0,st.S-st.s);
   const offsetError=Math.hypot(st.ex,st.ez);
   maxLag=Math.max(maxLag,behind);
   maxOffset=Math.max(maxOffset,offsetError,Math.abs(st.L-st.l));
   // Geometric convergence matters too: the longitudinal parameter can
   // reach the goal before the soldier has walked out his lateral offset.
   const target=columnPoint(flow,st.S,st.L);
   if(behind>COLUMN_DONE||Math.hypot(m.x-target.x,m.z-target.z)>COLUMN_DONE)closed=false;
  }
  flow.maxLag=maxLag;flow.maxOffset=maxOffset;flow.targetsReady=true;
  const head=columnPoint(flow,flow.s,0);
  squad.x=head.x;squad.z=head.z;squad.r=head.r;squad.stretch=0;
  squad.phase=moved||flow.s>before?'walking':'waiting';squad.isTurning=false;squad.isWalking=!!(moved||flow.s>before);
  flow.hold=moved||flow.s>before?0:flow.hold+dt;
  // The old code cleared a diagnostic string that is never emitted here,
  // leaving the "Passage blocked" toast active after marching resumed.
  if((moved||flow.s>before)&&squad.blockedReason&&
   (squad.blockedReason.startsWith('No safe passage for all soldiers')||
    squad.blockedReason.startsWith('Passage blocked;')))squad.blockedReason=null;
  // Never abandon a man at the river or teleport him to the destination.
  // In particular, being motionless for 0.5 s is NOT arrival.
  if(flow.s>=flow.end-1e-6&&closed){
   squad.flow=null;squad.waypoint=squad.path.length;
   return finish(squad,dt,groundY,nav,unsqueezed());
  }
  if(flow.revisionChanged){
   flow.revisionChanged=false;
   if(columnReplan(squad,flow,nav))return true;
  }
  if(flow.hold>1.2){
   const replanned=columnReplan(squad,flow,nav);
   debugTrace(squad,'column-replan',{success:!!replanned,hold:flow.hold,
    progress:flow.s,navRevision:nav?.revision??null});
   if(replanned)return true;
   if(flow.hold>MAX_HOLD*1.5){
    // Preserve the order and retry on cooldown: a closed gate or real wall
    // may be temporary. Never quietly declare the march complete.
    squad.blockedReason='Passage blocked; troop will retry when a route opens.';
    debugTrace(squad,'column-waiting',{reason:'replan-failed-and-no-progress',
     progress:flow.s,remaining:flow.end-flow.s,maxLag:flow.maxLag,maxOffset:flow.maxOffset});
    flow.hold=MAX_HOLD*1.5;
   }
  }
  return true;
 }
 function routeFacing(squad,points,finalFacing){
  if(Number.isFinite(finalFacing))return finalFacing;
  for(let i=(points?.length||0)-1;i>0;i--){
   const a=points[i-1],b=points[i];
   if(Math.hypot(b.x-a.x,b.z-a.z)>ARRIVAL_TOLERANCE)return Math.atan2(b.x-a.x,b.z-a.z);
  }
  return squad.r;
 }
 function destinationFormation(squad,destination,nav,finalFacing,result){
  const end=result.ok?result.points?.[result.points.length-1]:destination;
  let x=end?.x,z=end?.z,r=routeFacing(squad,result.ok?result.points:null,finalFacing);
  const projected={...squad},wall=nav?.walkway?.(x,z);
  let slots=squad.members.map(m=>({dx:m.dx,dz:m.dz})),q;
  if(!!squad.files!==!!wall){
   // This is the same final wall/ground transition used by finish()/reform().
   const formed=wallShape(projected,nav,x,z,r);slots=formed.slots;r=formed.yaw;q=unsqueezed();
   const groundFormation=!projected.files&&nav?.raised&&nav.raised(x,z)===0;
   const fits=(cx,cz)=>!nav||(nav.canStand(cx,cz,CENTRE_RADIUS)&&slots.every(slot=>{
    const p=slotPosition(cx,cz,r,slot,q);
    return (squad.files?footClear(nav,p.x,p.z,MEMBER_RADIUS):formationFoot(squad,nav,slot,{...p,r}))&&(!groundFormation||!nav.raised(p.x,p.z));
   }));
   if(!fits(x,z))search:for(let ring=.5;ring<=4;ring+=.5)for(let a=0;a<16;a++){
    const cx=x+Math.cos(a*Math.PI/8)*ring,cz=z+Math.sin(a*Math.PI/8)*ring;
    if(fits(cx,cz)){x=cx;z=cz;break search;}
   }
  }else q=nav?fitSqueeze(squad,x,z,r,nav):unsqueezed();
  const members=slots.map(slot=>{
   const p=slotPosition(x,z,r,slot,q);
   return {...p,r,dx:slot.dx,dz:slot.dz,valid:!!result.ok&&(!nav||(wall?footClear(nav,p.x,p.z,MEMBER_RADIUS):formationFoot(squad,nav,slot,{...p,r},Math.min(q.xp,q.xn))))};
  });
  const valid=!!result.ok&&members.length>0&&(!nav||nav.canStand(x,z,CENTRE_RADIUS))&&members.every(m=>m.valid);
  return {x,z,r,files:projected.files||null,squeeze:q,members,valid};
 }
 const preparedOrders=new WeakMap();
 // Read-only fit for a proposed destination, without a route search. Nearby
 // placement can reject impossible soldier slots before spending A* work.
 // Reachability and the final path-facing still need previewOrder().
 function previewFormation(squad,destination,nav,finalFacing=null){
  return destinationFormation(squad,destination,nav,finalFacing,{ok:true,points:[{x:squad.x,z:squad.z},{x:destination.x,z:destination.z}]});
 }
 function orderStamp(squad,destination,nav,finalFacing){
  return {squad,nav,revision:nav.revision,x:squad.x,z:squad.z,r:squad.r,radius:squad.radius,
   goalX:destination.x,goalZ:destination.z,facing:Number.isFinite(finalFacing)?finalFacing:null,
   members:squad.members.map(m=>({member:m,dx:m.dx,dz:m.dz}))};
 }
 function preparedMatches(stamp,squad,destination,nav,finalFacing){
  return !!stamp&&stamp.squad===squad&&stamp.nav===nav&&stamp.revision===nav.revision&&
   stamp.x===squad.x&&stamp.z===squad.z&&stamp.r===squad.r&&stamp.radius===squad.radius&&
   stamp.goalX===destination.x&&stamp.goalZ===destination.z&&stamp.facing===(Number.isFinite(finalFacing)?finalFacing:null)&&
   stamp.members.length===squad.members.length&&stamp.members.every((m,i)=>m.member===squad.members[i]&&m.dx===squad.members[i].dx&&m.dz===squad.members[i].dz);
 }
 function previewOrder(squad,destination,nav,finalFacing=null){
  const planned=planOrder(squad,destination,nav,finalFacing),result=planned.result;
  const preview={...result,formation:destinationFormation(squad,destination,nav,finalFacing,result)};
  if(result.ok)preparedOrders.set(preview,{...orderStamp(squad,destination,nav,finalFacing),planned});
  return preview;
 }
 function order(squad,destination,nav,finalFacing=null,prepared=null){
  const saved=prepared&&preparedOrders.get(prepared);
  const planned=preparedMatches(saved,squad,destination,nav,finalFacing)?saved.planned:planOrder(squad,destination,nav,finalFacing);
  const {result,radius,columns}=planned;
  if(!result.ok){
   squad.lastRouteDiagnostic={...result,goal:{...destination}};
   return result;
  }
  squad.lastRouteDiagnostic=null;
  squad.columnRadius=columns;
  // Planning is read-only; only release the old closing job AFTER the new
  // route is accepted. A rejected click must not interrupt a safe manoeuvre.
  // This is the key to responsive orders from cramped map-edge locations:
  // an unreachable old rank slot cannot swallow every subsequent move click.
  if(!result.faceOnly&&squad.individualTurn?.settle)
   releaseClosing(squad,'new-movement-order');
  if(result.faceOnly){
   squad.nav=nav;squad.blockedReason=null;
   squad.destination=null;squad.path=null;squad.waypoint=0;squad.finalFacing=null;
   squad.exitTranslation=null;squad.edgeEscape=false;
   squad.routeProfile=null;squad.corridorValidated=false;
   // During a moving order the ranks may be spread along a curved road.
   // First close that existing road without teleporting any soldier, then
   // immediately turn every man individually. An idle squad turns at once.
   if(squad.flow){
    if(squad.flow.column){
     // Column troops must complete their existing reforming animation.
     squad.flow=null;
     if(!reform(squad,nav,squad.r,{x:squad.x,z:squad.z}))return {ok:false,reason:'Cannot reform here for an about-face.'};
    }else settle(squad,nav,squad.flow.s);
    squad.queuedFacing=finalFacing;
   }else if(squad.individualTurn?.settle){
    squad.queuedFacing=finalFacing;
   }else{
    squad.individualTurn=null;
    if(!beginIndividualTurn(squad,finalFacing,nav))return {ok:false,reason:'No room to face the requested direction.'};
   }
   squad.isMoving=true;
   debugTrace(squad,'about-face',{oldHeading:squad.r,newHeading:finalFacing,reason:'face-command'});
   return result;
  }
  if(result.defile||squad.flow?.column){
   // A reissued order during a narrow crossing MUST inherit the existing
   // line of soldiers. Calling settle() on a column used flow.lat (which a
   // column does not possess), throwing a TypeError and freezing the game.
   // Keep the real world positions and follow the new road in elastic files.
   if(squad.flow){squad.columnTrail=trailOf(squad.flow);squad.flow=null;}
   squad.individualTurn=null;squad.defile={};
  }
  // A new order mid-normal-flow: close up the ranks before starting again.
  else if(squad.flow)settle(squad,nav,squad.flow.s);
  squad.defileRetried=false;squad.queuedFacing=null;
  squad.nav=nav;squad.blockedReason=null;squad.pathRadius=radius;squad.holdTime=0;
  squad.corridorValidated=!!result.scale;squad.routeScale=result.scale??1;
  squad.routeProfile=result.compressionProfile||null;
  squad.edgeEscape=!!result.edgeEscape;squad.edgeGrace=0;
  squad.squeeze??=unsqueezed();squad.forced??=unsqueezed();
  squad.exitTranslation=result.exitTranslation?{...result.exitTranslation}:null;
  squad.path=result.roadPoints||result.points;squad.waypoint=1;
  squad.destination={...result.points[result.points.length-1]};
  squad.finalFacing=Number.isFinite(finalFacing)?finalFacing:null;
  squad.isMoving=result.length>ARRIVAL_TOLERANCE || (squad.finalFacing!==null && Math.abs(deltaAngle(squad.r,squad.finalFacing))>FACING_TOLERANCE)
   || SIDES.some(k=>squad.squeeze[k]<1)||!!squad.individualTurn;
  squad.isTurning=false;squad.isWalking=false;
  squad.phase=squad.isMoving?'turning':'idle';
  if(!squad.isMoving)stop(squad);
  return result;
 }
 function stop(squad){
  squad.queuedFacing=null;squad.exitTranslation=null;
  // Halting mid-march: the flowing ranks close up into the block first; a
  // column forms its block round its head where there is room (otherwise
  // the men stay on the road, and the next order takes them on as a column).
  if(squad.flow?.column){squad.flow=null;reform(squad,squad.nav,squad.r,{x:squad.x,z:squad.z});}
  else if(squad.flow)settle(squad,squad.nav,squad.flow.s);
  // Halting mid about-face: drop the route, let the soldiers finish turning.
  if(squad.individualTurn){squad.path=null;squad.destination=null;squad.waypoint=0;squad.finalFacing=null;return;}
  squad.path=null;squad.destination=null;squad.waypoint=0;
  // Halted with ranks still open: the rear catches up before standing still.
  if((squad.stretch||0)>.01&&squad.isMoving){
   squad.phase='closing';squad.isTurning=false;squad.isWalking=true;squad.finalFacing=null;return;
  }
  squad.isMoving=false;squad.isTurning=false;squad.isWalking=false;squad.phase='idle';squad.finalFacing=null;
  squad.edgeEscape=false;squad.edgeGrace=0;
 }
 function finish(squad,dt,groundY,nav,target){
  // Through the narrow ground: the column re-forms the block where the road
  // ends, each man by his own way. Where it cannot (a cramped spot), the men
  // stay on the road until the next order takes them on as a column.
  if(squad.defile){
   const end=squad.path?.[squad.path.length-1],yaw=squad.finalFacing??squad.r;
   if(!reform(squad,nav,yaw,end?{x:end.x,z:end.z}:null))stop(squad);
   squad.finalFacing=null;return true;
  }
  if(squad.finalFacing!==null&&!squad.defile){
   const error=deltaAngle(squad.r,squad.finalFacing);
   if(Math.abs(error)>FACING_TOLERANCE){
    if(aboutFace(squad.r,squad.finalFacing)&&beginIndividualTurn(squad,squad.finalFacing,nav)){
     debugTrace(squad,'about-face',{oldHeading:squad.r,newHeading:squad.finalFacing,reason:'final-facing'});
     return individualTurnAdvance(squad,dt,groundY,1.65,nav);
    }
    const turnRate=Math.min(TURN_SPEED,Math.max(.5,1.65*MAX_FLANK_SPEED/Math.max(.7,squad.radius)));
    const nextYaw=squad.r+clamp(error,-turnRate*dt,turnRate*dt);
    if(!sweptPoseSafe(squad,squad.x,squad.z,nextYaw,nav))return hold(squad,groundY,target);
    squad.r=nextYaw;squad.holdTime=0;
    squad.phase='turning';squad.isTurning=true;squad.isWalking=false;squad.isMoving=true;
    occupy(squad,groundY);return true;
   }
   if(!sweptPoseSafe(squad,squad.x,squad.z,squad.r+error,nav))return hold(squad,groundY,target);
   squad.r+=error;squad.finalFacing=null;
  }
  // Arrived: the rear ranks catch up, and soldiers step back out to the
  // regular spacing where room allows.
  if((squad.stretch||0)>.01){
   squad.phase='closing';squad.isTurning=false;squad.isWalking=true;
   occupy(squad,groundY);return true;
  }
  if((relaxing(squad,target)||squeezing(squad,target))&&squad.squeezeMoved){
   squad.phase='reforming';squad.isTurning=false;squad.isWalking=true;
   occupy(squad,groundY);return true;
  }
  // Halted on a wall walkway in a block, or back on the ground in files:
  // take the formation that fits there.
  if(nav?.walkway&&!squad.defile&&!!squad.files!==!!nav.walkway(squad.x,squad.z)){reform(squad,nav,squad.r);return true;}
  stop(squad);occupy(squad,groundY);return true;
 }
 function advance(squad,dt,groundY,speed=1.65,nav=squad.nav){
  const x=squad.x,z=squad.z;
  const result=advanceFormation(squad,dt,groundY,speed,nav);
  // (Men strung out along a column stand where they are, not in the block.)
  if(result&&!squad.individualTurn&&!squad.flow&&!squad.defile&&!squad.skipOccupyOnce){
   // Ranks open up while the block marches and close whenever it does not.
   const step=clamp(Number.isFinite(dt)?dt:0,0,.075);
   const marching=squad.phase==='walking'&&Math.hypot(squad.x-x,squad.z-z)>1e-6;
   squad.marchTime=(squad.marchTime||0)+step;
   squad.stretch=clamp((squad.stretch||0)+(marching?step/STRETCH_IN:-step/STRETCH_OUT),0,1);
   occupy(squad,groundY);
  }
  // Consume the one-tick no-snap guard before the next simulation step.
  squad.skipOccupyOnce=false;
  if(result)updateStepping(squad,clamp(Number.isFinite(dt)?dt:0,0,.075));
  return result;
 }
 // member.stepping: true while this soldier walks or turns (with a short
 // hold so footwork does not flicker between frames).
 function updateStepping(squad,step){
  for(const m of squad.members){
   if(step>0&&m.lastX!==undefined){
    const speed=Math.hypot(m.x-m.lastX,m.z-m.lastZ)/step,turn=Math.abs(deltaAngle(m.lastR,m.r))/step;
    m.stepHold=speed>STEP_SPEED||turn>STEP_TURN_RATE?STEP_HOLD:Math.max(0,(m.stepHold||0)-step);
   }
   m.stepping=!!squad.isMoving&&(m.stepHold||0)>0;
   m.lastX=m.x;m.lastZ=m.z;m.lastR=m.r;
  }
 }
 function advanceFormation(squad,dt,groundY,speed,nav){
  const stepTime=clamp(Number.isFinite(dt)?dt:0,0,.075);
  if(squad.edgeEscape&&stepTime)return edgeEscapeAdvance(squad,stepTime,groundY,speed,nav);
  if(squad.exitTranslation&&stepTime)return extractionAdvance(squad,stepTime,groundY,speed,nav);
  if(squad.individualTurn&&squad.isMoving)return stepTime?individualTurnAdvance(squad,stepTime,groundY,speed,nav):false;
  if(squad.flow&&squad.isMoving)return stepTime?(squad.flow.column?columnAdvance:flowAdvance)(squad,stepTime,groundY,speed,nav):false;
  if(squad.isMoving&&!squad.path&&squad.phase==='closing'){
   if(!stepTime)return false;
   if((squad.stretch||0)<=.01){squad.stretch=0;squad.isMoving=false;squad.isWalking=false;squad.phase='idle';}
   if(!squad.defile)occupy(squad,groundY);return true;
  }
  if(!squad.isMoving||!squad.path)return false;
  if(!stepTime)return false;
  // Narrow ground: the men set off as a column straight away, without first
  // wheeling the block (it may not have room to).
  if(squad.defile){
   if(beginColumn(squad,nav))return columnAdvance(squad,stepTime,groundY,speed,nav);
   return finish(squad,stepTime,groundY,nav,unsqueezed());
  }
  squad.squeeze??=unsqueezed();squad.forced??=unsqueezed();squad.lastStep=stepTime;
  const target=updateSqueeze(squad,stepTime,nav);
  const held=()=>{
   debugTrace(squad,'block-hold',{reason:'formation-footprint-rejected',
    center:{x:squad.x,z:squad.z},waypoint:squad.waypoint});
   return hold(squad,groundY,target);
  };

  // Skip tiny path segments. Do not waste frames turning towards a waypoint
  // that is already underneath the squad's center.
  let to,dx,dz,d;
  while(squad.waypoint<squad.path.length){
   to=squad.path[squad.waypoint];
   dx=to.x-squad.x;dz=to.z-squad.z;d=Math.hypot(dx,dz);
   if(d>ARRIVAL_TOLERANCE)break;
   if(!sweptPoseSafe(squad,to.x,to.z,squad.r,nav))return held();
   squad.x=to.x;squad.z=to.z;squad.waypoint++;
  }
  if(squad.waypoint>=squad.path.length){
   return finish(squad,stepTime,groundY,nav,target);
  }

  const heading=Math.atan2(dx,dz); // Babylon +Z-forward yaw convention.
  const error=deltaAngle(squad.r,heading);
  if(aboutFace(squad.r,heading)&&beginIndividualTurn(squad,heading,nav)){
   debugTrace(squad,'about-face',{oldHeading:squad.r,newHeading:heading,reason:'reverse-order'});
   return individualTurnAdvance(squad,stepTime,groundY,speed,nav);
  }
  // For ordinary bends, wheel the full block as one at a safe speed.
  // The old beginIndividualTurn() swapped soldiers between ranks for every
  // movement command, visibly dissolving the formation before marching.
  const turnRate=Math.min(TURN_SPEED,Math.max(.5,Math.max(0,speed)*MAX_FLANK_SPEED/Math.max(.7,squad.radius)));
  const yawStep=clamp(error,-turnRate*stepTime,turnRate*stepTime);
  const candidateYaw=squad.r+yawStep;
  if(!sweptPoseSafe(squad,squad.x,squad.z,candidateYaw,nav))return held();
  squad.r=candidateYaw;
  const remainingError=deltaAngle(squad.r,heading);

  // Large turns happen in place: no sliding sideways or moving backwards.
  // The entire formation pivots around its center with its leader.
  if(Math.abs(remainingError)>FACING_TOLERANCE){
   squad.phase='turning';squad.isTurning=true;squad.isWalking=false;squad.holdTime=0;
   occupy(squad,groundY);return true;
  }

  // Finish small heading corrections exactly, then march forward. The move
  // vector is derived from the squad's actual facing, not a separate path
  // translation vector, so they cannot strafe at corners.
  if(!sweptPoseSafe(squad,squad.x,squad.z,squad.r+remainingError,nav))return held();
  squad.r+=remainingError;
  // Facing the route: from here the ranks flow along it.
  if(beginFlow(squad))return flowAdvance(squad,stepTime,groundY,speed,nav);
  squad.phase='walking';squad.isTurning=false;squad.isWalking=true;
  const travel=Math.min(d,Math.max(0,speed)*stepTime);
  const nextX=squad.x+Math.sin(squad.r)*travel;
  const nextZ=squad.z+Math.cos(squad.r)*travel;
  if(!sweptPoseSafe(squad,nextX,nextZ,squad.r,nav))return held();
  squad.x=nextX;squad.z=nextZ;squad.holdTime=0;
  if(travel>=d-1e-5){
   if(!sweptPoseSafe(squad,to.x,to.z,squad.r,nav))return held();
   squad.x=to.x;squad.z=to.z;squad.waypoint++;
   if(squad.waypoint>=squad.path.length)return finish(squad,stepTime,groundY,nav,target);
  }
  occupy(squad,groundY);
  return true;
 }
 // ---- Combat support ------------------------------------------------------
 // Stop all marching where the soldiers stand (combat moves them itself).
 function halt(squad){
  squad.queuedFacing=null;squad.exitTranslation=null;
  squad.individualTurn=null;squad.flow=null;squad.path=null;squad.destination=null;squad.waypoint=0;
  squad.isMoving=false;squad.isTurning=false;squad.isWalking=false;squad.phase='combat';squad.finalFacing=null;squad.stretch=0;
 }
 function removeMember(squad,member){
  const i=squad.members.indexOf(member);if(i>=0){squad.members.splice(i,1);squad.coreFile=null;}
  if(squad.individualTurn)squad.individualTurn.soldiers=squad.individualTurn.soldiers.filter(s=>s.m!==member);
 }
 // Close ranks into a fresh block for the survivors: every soldier walks from
 // where he stands to the nearest slot (no teleporting), then faces `yaw`.
 // The block forms where its men stand, or around `at` when given (troops
 // split or balanced form up side by side).
 // On a fortress walkway (nav.walkway, world/fortress.js) a squad stands in
 // two or three files along the wall; anywhere else in its block.
 function fileShape(count,files,spacing=null){
  const across=(files>2?.4:.47)*(spacing?.x||ROW_SPACING)/ROW_SPACING,deep=spacing?.z||ROW_SPACING,ranks=Math.ceil(count/files);
  return Array.from({length:count},(_,i)=>({dx:((i%files)-(files-1)/2)*across,dz:(Math.floor(i/files)-(ranks-1)/2)*deep}));
 }
 function wallShape(squad,nav,x,z,yaw){
  const wall=nav?.walkway?.(x,z);
  if(!wall){squad.files=null;return {slots:squadShape(squad,squad.members.length),yaw};}
  squad.files=squad.members.length>16?3:2;
  // Face along the wall, whichever way is nearer the wanted facing.
  const along=Math.atan2(wall.along[0],wall.along[1]);
  return {slots:fileShape(squad.members.length,squad.files,squad.spacing),yaw:Math.abs(deltaAngle(yaw,along))<=Math.PI/2?along:along+Math.PI};
 }
 // Snap a squad into formation at (x, z) at once (mission start).
 function arrange(squad,nav,groundY,at={x:squad.x,z:squad.z},yaw=squad.r){
  if(!reform(squad,nav,yaw,at,false))return false;
  completeIndividualTurn(squad);occupy(squad,groundY);
  squad.isMoving=false;squad.isTurning=false;squad.isWalking=false;squad.phase='idle';
  return true;
 }
 function reform(squad,nav,yaw=squad.r,at=null,routeMembers=true){
  const members=squad.members,n=members.length;if(!n)return false;
  const q=unsqueezed();
  let cx=at?at.x:members.reduce((s,m)=>s+m.x,0)/n,cz=at?at.z:members.reduce((s,m)=>s+m.z,0)/n;
  const oldFiles=squad.files,oldCoreFile=squad.coreFile;
  const formed=wallShape(squad,nav,cx,cz,yaw),slots=formed.slots;yaw=formed.yaw;
  // Wall-file transitions retain their ladder/raised-ground handling. The
  // individual ground routes here are for dispersed crews, melee ranks and
  // a column strung out along a winding road (finish).
  const safeReform=routeMembers&&!squad.files&&!oldFiles;
  const groundFormation=!squad.files&&nav?.raised&&nav.raised(cx,cz)===0;
  const fits=(x,z)=>!nav||(nav.canStand(x,z,CENTRE_RADIUS)&&slots.every(slot=>{const p=slotPosition(x,z,yaw,slot,q);return (squad.files?footClear(nav,p.x,p.z,MEMBER_RADIUS):formationFoot(squad,nav,slot,{...p,r:yaw}))&&(!groundFormation||!nav.raised(p.x,p.z));}));
  if(!fits(cx,cz)){
   search:for(let ring=.5;ring<=4;ring+=.5)for(let a=0;a<16;a++){
    const x=cx+Math.cos(a*Math.PI/8)*ring,z=cz+Math.sin(a*Math.PI/8)*ring;
    if(fits(x,z)){cx=x;cz=z;break search;}
   }
  }
  // No usable complete formation near the requested centre: keep the men
  // where they are instead of later placing them on impassable ground.
  if(!fits(cx,cz)){squad.files=oldFiles;squad.coreFile=oldCoreFile;return false;}
  const targets=slots.map(slot=>slotPosition(cx,cz,yaw,slot,q));
  const memberSlot=assign(members.map(m=>targets.map(t=>(t.x-m.x)**2+(t.z-m.z)**2)));
  const soldiers=members.map((m,i)=>({m,slot:slots[memberSlot[i]],to:targets[memberSlot[i]],startR:m.r,delay:0}));
  if(safeReform&&nav)for(const soldier of soldiers){
   if(formationSweep(squad,nav,soldier.slot,{...soldier.m,r:yaw},{...soldier.to,r:yaw}))continue;
   const plan=nav.plan?.(soldier.m,soldier.to,MEMBER_RADIUS);
   const points=plan?.ok?plan.points.slice(1):null;
   const last=points?.[points.length-1];
   // The grid can adjust a destination. Only accept that route if its
   // remaining segment reaches the exact assigned slot safely as well.
   if(!last||!formationSweep(squad,nav,soldier.slot,{...last,r:yaw},{...soldier.to,r:yaw})){squad.files=oldFiles;squad.coreFile=oldCoreFile;return false;}
   if(Math.hypot(last.x-soldier.to.x,last.z-soldier.to.z)>1e-4)points.push(soldier.to);
   soldier.route=points;soldier.waypoint=0;
  }
  squad.radius=Math.max(.55,...slots.map(p=>Math.hypot(p.dx,p.dz)+.28));
  squad.squeezedRadius=Math.max(.55,...slots.map(p=>Math.hypot(p.dx,p.dz)*MIN_SQUEEZE+.45));
  squad.columnRadius=columnRadius(slots);squad.outerFile=Math.max(0,...slots.map(slot=>Math.abs(slot.dx)));
  squad.pathRadius=squad.radius;squad.squeeze=unsqueezed();squad.forced=unsqueezed();
  squad.flow=null;squad.path=null;squad.destination=null;squad.waypoint=0;squad.stretch=0;squad.defile=null;
  squad.routeScale=1;squad.routeProfile=null;squad.corridorValidated=false;
  squad.x=cx;squad.z=cz;
  squad.individualTurn={yaw,delta:deltaAngle(squad.r,yaw),q,time:0,settle:true,safeReform,soldiers};
  squad.isMoving=true;squad.phase='closing';squad.isTurning=false;squad.isWalking=true;
  return true;
 }
 // Read-only formation geometry analyser. The same nav.canStand used by
 // routing supplies the values shown in Babylon's terrain inspector; no
 // screen-space estimates or MLG shortcuts are involved.
 function inspectPassage(squad,nav){
  if(!squad?.members?.length||!nav)return null;
  const across=Math.max(...squad.members.map(m=>Math.abs(m.dx)));
  const depth=Math.max(...squad.members.map(m=>Math.abs(m.dz)));
  const squeeze=squad.flow?.compressionProfile?
   corridorScaleAt(squad.flow.compressionProfile,squad.flow.s):
   Math.min(squad.squeeze?.xp??1,squad.squeeze?.xn??1);
  const heading=squad.flow?flowHeading(squad.flow,squad.flow.s):squad.r;
  const mRadius=CORRIDOR_MEMBER_RADIUS;
  const side=(cx,cz,angle,sign,max=4)=>{
   const rx=Math.cos(angle),rz=-Math.sin(angle),ux=Math.sin(angle),uz=Math.cos(angle);
   // Probe three cross-sections so a wide gap next to a cliff cannot
   // accidentally look legal just because its centre line is open.
   let distance=0,reason=null;
   for(let d=0;d<=max+.001;d+=.08){
    let safe=true;
    for(const row of [-depth,0,depth]){
     const x=cx+ux*row+rx*sign*d,z=cz+uz*row+rz*sign*d;
     if(!nav.canStand(x,z,mRadius)){safe=false;break;}
    }
    if(!safe){reason='blocked';break;}
    distance=d;
   }
   return {distance,reason};
  };
  const samples=[];
  for(const forward of [0,1.3,2.6]){
   const centre=squad.flow?flowPoint(squad.flow,Math.min(squad.flow.end,squad.flow.s+forward)):
    {x:squad.x+Math.sin(heading)*forward,z:squad.z+Math.cos(heading)*forward};
   const angle=squad.flow?flowHeading(squad.flow,Math.min(squad.flow.end,squad.flow.s+forward)):heading;
   const left=side(centre.x,centre.z,angle,-1),right=side(centre.x,centre.z,angle,1);
   const width=left.distance+right.distance;
   const inner=coreFile(squad);
   const minWidth=2*inner*MIN_SQUEEZE+2*mRadius;
   const normalWidth=2*inner+2*mRadius;
   samples.push({forward,x:centre.x,z:centre.z,yaw:angle,left:left.distance,right:right.distance,
    width,minWidth,normalWidth,fullFits:width>=normalWidth-.08,
    tightFits:width>=minWidth-.08});
  }
  const directions=[];
  for(let degrees=-75;degrees<=75;degrees+=15){
   const angle=heading+degrees*Math.PI/180;
   const fits=[];
   for(const scale of SQUEEZE_LEVELS){
    const q={xp:scale,xn:scale,zp:depthScale(scale),zn:depthScale(scale)};
    if(nav.canStand(squad.x,squad.z,CENTRE_RADIUS)&&squad.members.every(m=>{
     const p=slotPosition(squad.x,squad.z,angle,m,q);
     return formationFoot(squad,nav,m,{...p,r:angle},scale);
    }))fits.push(scale);
   }
   if(fits.length)directions.push({degrees,yaw:angle,scale:fits[0]});
  }
  const best=directions.sort((a,b)=>b.scale-a.scale||Math.abs(a.degrees)-Math.abs(b.degrees))[0]||null;
  const profile=squad.flow?.compressionProfile;
  return {centre:{x:squad.x,z:squad.z},heading,normalWidth:2*across+2*mRadius,
   minimumWidth:2*across*MIN_SQUEEZE+2*mRadius,
   normalDepth:2*depth+2*mRadius,minimumDepth:2*depth*depthScale(MIN_SQUEEZE)+2*mRadius,
   footCoreRadius:MEMBER_RADIUS,visualShoulderRadius:VISUAL_SHOULDER_RADIUS,
   wingReach:nav.formationWingReach??0,walkableCoreWidth:2*coreFile(squad)*MIN_SQUEEZE+2*mRadius,
   normalCoreWidth:2*coreFile(squad)+2*mRadius,
   shoulderTouches:squad.members.reduce((n,m)=>n+(footClear(nav,m.x,m.z,MEMBER_RADIUS)&&!nav.canStand(m.x,m.z,VISUAL_SHOULDER_RADIUS)?1:0),0),
   softFootTouches:squad.members.reduce((n,m)=>n+(formationFoot(squad,nav,m,m,squeeze)&&!nav.canStand(m.x,m.z,MEMBER_RADIUS)?1:0),0),
   wingTouches:squad.members.reduce((n,m)=>n+(!footClear(nav,m.x,m.z,MEMBER_RADIUS)&&formationFoot(squad,nav,m,m,squeeze)?1:0),0),
   footBlocked:squad.members.reduce((n,m)=>n+(!formationFoot(squad,nav,m,m,squeeze)?1:0),0),
   currentScale:squeeze,lateralShift:profile?corridorOffsetAt(profile,squad.flow.s):0,
   plannedMinScale:profile?Math.min(...profile.values):null,
   plannedMaxShift:profile?.offsets?.length?Math.max(...profile.offsets.map(Math.abs)):0,
   samples,bestAngle:best,canFitHere:!!directions.length,
   reason:!directions.length?'No legal orientation for this formation at this position.':
    samples[1].width<samples[1].minWidth?'Passage ahead is narrower than its strictly walkable inner files.':
    !samples[1].fullFits?'Passage ahead requires compression or an adjusted angle.':'Open for a full-width formation.'};
 }
 return {setup,order,previewOrder,previewFormation,stop,advance,occupy,shape,fileShape,poseSafe,sweptPoseSafe,halt,removeMember,reform,arrange,inspectPassage};
});
