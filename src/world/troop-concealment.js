/* Wheat hides idle, settled infantry; it is not forest. Combat and movement
   immediately invalidate hiding, and a hit needs a quiet recovery before a
   new hiding delay can begin. The clock advances only with simulation time. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansTroopConcealment=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const HIDE_DELAY=2,RECOVERY=3;
 const isForestCell=value=>{const type=value>>>27;return type===5||type===6;};
 function active(s){
  const c=s.combat,members=s.members||[];
  return !!(s.isMoving||s.isTurning||s.isWalking||s.needsReform||s.inVillage||s.sheltered||
   (c&&(c.mode!=='idle'||c.target||c.structure||c.moveOrder||c.engaged||c.foes?.size))||
   members.some(m=>m.combatMoving||m.action||m.foe||(m._attackers||0)>0));
 }
 const isHidden=s=>!!s.concealed&&!active(s);
 function clear(s){
  const changed=!!s.concealed;
  s.concealed=false;s.hideTimer=0;
  for(const m of s.members||[])if(m.pose==='lieDown'||m.pose==='lying'){m.pose=null;m.poseTime=0;s.dirty=true;}
  if(changed)s.dirty=true;
  return changed;
 }
 function create({canHide=()=>true,inGrass=()=>false,burning=()=>false,delay=HIDE_DELAY,recovery=RECOVERY}={}){
  let clock=0;const disturbedUntil=new WeakMap();
  function disrupt(s){
   if(!s?.members)return false;
   disturbedUntil.set(s,clock+recovery);return clear(s);
  }
  function update(squads,dt){
   if(!(dt>0)||!Number.isFinite(dt))return false;
   clock+=dt;let changed=false;
   // A squad receiving an attack cannot disappear between incoming arrows,
   // or while a melee attacker approaches, merely because it holds position.
   const threatened=new Set();
   for(const s of squads){
    if(!s.members?.length)continue;
    const c=s.combat;if(c?.target?.members?.length)threatened.add(c.target);
    for(const enemy of c?.foes||[])if(enemy.members?.length)threatened.add(enemy);
   }
   for(const s of squads){
    const members=s.members||[];
    if(!members.length){changed=clear(s)||changed;continue;}
    const fighting=threatened.has(s)||active(s);
    if(fighting){
     // Keep the recovery after combat ends, including gaps between volleys.
     if(threatened.has(s)||s.combat?.mode!=='idle'||members.some(m=>m.action||m.foe||(m._attackers||0)>0))disturbedUntil.set(s,clock+recovery);
     changed=clear(s)||changed;continue;
    }
    let grass=0;
    if(clock+1e-9>=(disturbedUntil.get(s)||0)&&canHide(s))for(const m of members)if(inGrass(m.x,m.z)&&!burning(m.x,m.z))grass++;
    const hiding=grass>0&&grass*10>=members.length*6;
    if(!hiding){changed=clear(s)||changed;continue;}
    s.hideTimer=(s.hideTimer||0)+dt;
    if(s.hideTimer+1e-9<delay)continue;
    if(!s.concealed){s.concealed=true;s.dirty=true;changed=true;}
    const down=s.model?.animations?.lieDown?.duration||0,lying=!!s.model?.animations?.lying;
    for(const m of members){
     if(m.pose==='lying')continue;
     if(m.pose!=='lieDown'){m.pose=down?'lieDown':'lying';m.poseTime=0;}
     m.poseTime=Math.min((m.poseTime||0)+dt*1000,down);if(m.poseTime>=down&&lying)m.pose='lying';
    }
   }
   return changed;
  }
  return {update,disrupt,get clock(){return clock;}};
 }
 return {create,active,isHidden,isForestCell,HIDE_DELAY,RECOVERY};
});
