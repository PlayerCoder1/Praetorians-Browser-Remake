/* Wolf scouts keep their familiar beside them. A wolf is a one-member render
   squad, outside combat, population, targeting and vision. It shares the unit
   pose batches and follows the scout's actual safe footsteps around corners. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansScoutCompanions=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const TYPE='EXPLORADOR_LOBO',FAMILIAR='LOBO_SCOUT',BODY=.12;
 const SIDE=.65,BEHIND=.35,TRAIL_STEP=.2,TRAIL_LIMIT=160,TELEPORT=20;
 const finite=value=>Number.isFinite(value);
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
 const turn=(a,b,dt)=>a+Math.max(-7*dt,Math.min(7*dt,Math.atan2(Math.sin(b-a),Math.cos(b-a))));
 function create({getModel,groundY=()=>0,navFor=()=>null,register=()=>{}}={}){
  if(typeof getModel!=='function')throw new Error('Scout companions need a wolf model accessor.');
  const entries=new Map(),list=[];let nextId=0;
  const anchor=owner=>owner.members?.find(m=>finite(m.x)&&finite(m.z)&&!(m.hp<=0));
  const alive=owner=>owner?.type===TYPE&&!!anchor(owner);
  const suppressed=owner=>!!(owner.hidden||owner.sheltered||owner.inVillage||owner.concealed);
  function canStand(nav,p){return !nav?.canStand||nav.canStand(p.x,p.z,BODY);}
  function clear(nav,a,b){
   if(!canStand(nav,b))return false;
   if(nav?.lineClear)return nav.lineClear(a,b,BODY);
   const n=Math.max(1,Math.ceil(distance(a,b)/.15));
   for(let i=1;i<=n;i++)if(!canStand(nav,{x:a.x+(b.x-a.x)*i/n,z:a.z+(b.z-a.z)*i/n}))return false;
   return true;
  }
  function beside(owner,nav){
   const m=anchor(owner),r=finite(m.r)?m.r:owner.r||0,s=Math.sin(r),c=Math.cos(r);
   // Prefer the scout's right, then his left or directly behind in a narrow
   // lane. These are destinations only: every actual footstep is swept too.
   for(const [side,back] of [[SIDE,BEHIND],[-SIDE,BEHIND],[0,.8],[0,.35]]){
    const p={x:m.x+c*side-s*back,z:m.z-s*side-c*back};
    if(canStand(nav,p)&&clear(nav,m,p))return p;
   }
   return {x:m.x,z:m.z};
  }
  function refresh(entry){
   const owner=entry.owner,c=entry.squad;
   c.side=owner.side;c.civ=owner.civ;c.visible=owner.visible;
   c.hidden=suppressed(owner);
   if(c.hidden){c.isMoving=c.running=false;const m=c.members[0];m.combatMoving=m.charging=m.stepping=false;}
  }
  function place(entry){
   const a=anchor(entry.owner),p=beside(entry.owner,navFor(entry.owner)),c=entry.squad,m=c.members[0];
   m.x=c.x=p.x;m.z=c.z=p.z;m.y=c.y=groundY(p.x,p.z);m.r=c.r=a.r||entry.owner.r||0;
   c.isMoving=c.running=false;m.combatMoving=m.charging=m.stepping=false;
   entry.trail=[{x:a.x,z:a.z}];entry.last={x:a.x,z:a.z};entry.wasSuppressed=suppressed(entry.owner);
  }
  function sync(owners=[]){
   const current=new Set(owners.filter(alive)),model=getModel();
   for(const [owner,entry] of entries)if(!current.has(owner)){
    entries.delete(owner);const i=list.indexOf(entry.squad);if(i>=0)list.splice(i,1);
   }
   for(const owner of current){
    let entry=entries.get(owner);
    if(!entry&&model){
     const id=++nextId,member={x:0,z:0,y:0,r:0,combatId:1000000+id,pose:null,poseTime:0,combatMoving:false,stepping:false,charging:false};
     const squad={type:FAMILIAR,kind:model.kind||'wolf',model,index:100000+id,owner,companion:true,
      members:[member],dying:[],isMoving:false,running:false,side:owner.side,civ:owner.civ,visible:owner.visible,hidden:false};
     entry={owner,squad,trail:[],last:null,wasSuppressed:false};entries.set(owner,entry);list.push(squad);place(entry);register(squad);
    }
    if(entry){
     const hidden=suppressed(owner);
     // Leaving a building puts both scout and familiar at its entrance, not
     // on opposite sides of a wall. This reposition happens while invisible.
     if(entry.wasSuppressed&&!hidden)place(entry);
     entry.wasSuppressed=hidden;refresh(entry);
    }
   }
   return list;
  }
  function waypoint(entry,goal,nav){
   const m=entry.squad.members[0];
   if(clear(nav,m,goal))return goal;
   // At a corner, follow the scout's recorded path. Test only a short bounded
   // look-ahead from the closest footprint; never run A* for a familiar.
   const trail=entry.trail;let closest=0,best=Infinity;
   for(let i=0;i<trail.length;i++){const d=distance(m,trail[i]);if(d<best){best=d;closest=i;}}
   for(let i=Math.min(trail.length-1,closest+12);i>=closest;i--)if(distance(m,trail[i])>.04&&clear(nav,m,trail[i]))return trail[i];
   return null;
  }
  function step(dt){
   if(!finite(dt)||dt<=0)return;
   // The caller runs at the world's fixed step. Bound any debug/manual step
   // too, so a paused interval cannot send a familiar across an obstacle.
   dt=Math.min(dt,.25);
   for(const entry of entries.values()){
    const owner=entry.owner;if(!alive(owner))continue;
    refresh(entry);if(entry.squad.hidden)continue;
    const a=anchor(owner),last=entry.last,c=entry.squad,m=c.members[0],nav=navFor(owner);
    if(last&&distance(last,a)>TELEPORT){place(entry);continue;}
    if(!last||distance(last,a)>=TRAIL_STEP){
     const p={x:a.x,z:a.z};entry.trail.push(p);entry.last=p;
     if(entry.trail.length>TRAIL_LIMIT)entry.trail.splice(0,entry.trail.length-TRAIL_LIMIT);
    }
    const goal=beside(owner,nav),target=waypoint(entry,goal,nav);
    const d=target?distance(m,target):0,oldX=m.x,oldZ=m.z;
    const run=!!owner.running||!!a.charging||distance(m,a)>2.5;
    // A slight speed reserve catches up after turns without ever teleporting.
    const base=Math.max(2.4,Number(owner.speed)||0),speed=run?Math.max(4.6,base*1.8):Math.max(3.2,base*1.2);
    if(target&&d>.035){
     const length=Math.min(d,speed*dt),p={x:m.x+(target.x-m.x)/d*length,z:m.z+(target.z-m.z)/d*length};
     if(clear(nav,m,p)){m.x=p.x;m.z=p.z;}
    }
    const moving=Math.hypot(m.x-oldX,m.z-oldZ)>1e-6;
    m.r=turn(m.r,moving?Math.atan2(m.x-oldX,m.z-oldZ):(finite(a.r)?a.r:owner.r||0),dt);
    m.y=groundY(m.x,m.z);m.poseTime+=dt*1000;
    c.x=m.x;c.z=m.z;c.y=m.y;c.r=m.r;c.isMoving=moving;c.running=run&&moving;
    m.stepping=m.combatMoving=moving;m.charging=run&&moving;
   }
  }
  return {sync,step,list,get size(){return entries.size;}};
 }
 return {create,TYPE,FAMILIAR,BODY,SIDE,BEHIND,TRAIL_LIMIT};
});
