/* Wildlife from the mission's CRITTER records: deer (CIERVOMIEDOSO, the timid
   deer), rabbits (CONEJO), squirrels (ARDILLA), rats (RATA), boars
   (JABALI) and the village smith (PALETO4). Each animal idles near its
   spot (deer graze, rest or lie down), wanders a little, and bolts away from
   troops that come close. Purely scenery: animals never block or fight.
   Each animal is a one-member pseudo-squad the unit renderer can draw. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansCritters=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 // Speeds in world units per second; flee: how close troops may come.
 const KINDS={
  CIERVOMIEDOSO:{model:'deer',walk:1.1,run:4.2,flee:9,wander:6,poses:['rest','graze','graze','lying']},
  CONEJO:{model:'rabbit',walk:1.3,run:3.4,flee:5,wander:3,poses:['rest']},
  ARDILLA:{model:'squirrel',walk:1,run:2.8,flee:4,wander:2.5,poses:['rest']},
  RATA:{model:'rat',walk:1,run:2.6,flee:3,wander:2,poses:['rest']},
  JABALI:{model:'boar',walk:1.2,run:4,flee:8,wander:6,poses:['rest','rest']},
  // A villager (DefCritters PALETO4, the smith) going about the village.
  PALETO4:{model:'smith',walk:1.1,run:1.1,flee:0,wander:4,poses:['rest','idle']},
 };
 const BODY=.15;
 function create({animals,nav,groundY,random=Math.random}){
  const list=[];
  for(const [i,record] of (animals||[]).entries()){
   const def=KINDS[record.type];if(!def)continue;
   const [x,,z]=record.position;
   const member={x,z,y:groundY(x,z),r:record.orientation||random()*Math.PI*2,combatId:9000+i,combatMoving:false,charging:false,pose:'rest',poseTime:0};
   list.push({type:record.type,kind:def.model,def,index:900+i,side:'neutral',visible:true,critter:true,
    members:[member],dying:[],isMoving:false,home:{x,z},state:'idle',timer:1+random()*8,goal:null});
  }
  const canStand=(x,z)=>!nav||nav.canStand(x,z,BODY);
  function clearLine(a,b){
   const n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.5);
   for(let i=1;i<=n;i++){const t=i/n;if(!canStand(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t))return false;}
   return true;
  }
  // A point reachable in a straight run from where the animal stands: away
  // from a threat (the escape widens, then shortens, when it is cornered),
  // or anywhere within reach of `around` (its home).
  function pick(c,around,distance,away,allowed=()=>true){
   const from=c.members[0];
   for(let attempt=0;attempt<16;attempt++){
    const a=away!==undefined?away+(random()*2-1)*Math.min(2.4,.6+attempt*.15):random()*Math.PI*2;
    const d=distance*(.5+random()*.5)*(attempt<8?1:.6);
    const p={x:around.x+Math.sin(a)*d,z:around.z+Math.cos(a)*d};
    if(allowed(p)&&canStand(p.x,p.z)&&clearLine(from,p))return p;
   }
   return null;
  }
  let clock=0;
  function setPose(c,pose){const m=c.members[0];if(m.pose!==pose){m.pose=pose;m.poseTime=0;}}
  // threats: troop positions ({x,z}), typically every living soldier.
  function update(dt,threats){
   clock+=dt;
   for(const c of list){
    const m=c.members[0],def=c.def;
    m.poseTime+=dt*1000;
    let near=null,nearD=def.flee;
    for(const t of threats){const d=Math.abs(t.x-m.x)+Math.abs(t.z-m.z);if(d<nearD*1.5){const e=Math.hypot(t.x-m.x,t.z-m.z);if(e<nearD){nearD=e;near=t;}}}
    if(near&&c.state!=='flee'){
     // Bolt straight away from the nearest soldier, lying deer included,
     // and keep clear of that spot for a while.
     const goal=pick(c,m,def.flee*1.6,Math.atan2(m.x-near.x,m.z-near.z));
     c.scare={x:near.x,z:near.z,until:clock+25};
     if(goal){c.goal=goal;c.state='flee';setPose(c,null);}
    }
    if(c.state==='idle'){
     c.timer-=dt;
     if(c.timer<=0){
      if(m.pose==='lying'){setPose(c,'getUp');c.state='rising';c.timer=0;continue;}
      const calm=p=>!c.scare||c.scare.until<clock||Math.hypot(p.x-c.scare.x,p.z-c.scare.z)>def.flee*1.3;
      if(random()<.55){const goal=pick(c,c.home,def.wander,undefined,calm);if(goal){c.goal=goal;c.state='walk';setPose(c,null);continue;}}
      const pose=def.poses[Math.floor(random()*def.poses.length)];
      if(pose==='lying'&&m.pose!=='lying'){setPose(c,'lieDown');c.state='lying down';}
      else setPose(c,pose);
      c.timer=4+random()*10;
     }
    }else if(c.state==='lying down'||c.state==='rising'){
     // One-shot clips: lie down (3.68 s) then stay lying; get up (3.36 s).
     const clip=c.state==='rising'?3360:3680;
     if(m.poseTime>=clip){if(c.state==='rising'){setPose(c,'rest');c.state='idle';c.timer=1+random()*3;}else{setPose(c,'lying');c.state='idle';c.timer=8+random()*14;}}
    }
    if(c.state==='walk'||c.state==='flee'){
     const run=c.state==='flee',speed=run?def.run:def.walk,dx=c.goal.x-m.x,dz=c.goal.z-m.z,d=Math.hypot(dx,dz);
     if(d<.15){c.state='idle';c.timer=run?2+random()*3:3+random()*8;m.combatMoving=m.charging=false;setPose(c,def.poses[0]);continue;}
     const step=Math.min(d,speed*dt),x=m.x+dx/d*step,z=m.z+dz/d*step;
     if(!canStand(x,z)){c.state='idle';c.timer=.5;m.combatMoving=m.charging=false;continue;}
     m.x=x;m.z=z;m.y=groundY(x,z);m.r=Math.atan2(dx,dz);m.combatMoving=true;m.charging=run;
    }else{m.combatMoving=m.charging=false;}
   }
  }
  return {list,update,KINDS};
 }
 return {create,KINDS};
});
