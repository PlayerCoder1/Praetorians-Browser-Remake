/* Lethal ground fire, checked per soldier. Capture before simulation work,
   then apply after ignition and after movement. Traversing a burning cell
   between fixed ticks is just as dangerous as ending a tick inside it.
   Idle frames do no per-soldier work when no wheat is burning. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansGrassExposure=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.z);
 // Clip very long journeys to the map before walking its 1 m cell grid.
 // The upper map edge is harmless: burningAt uses the map's half-open cells.
 function clip(a,b,width,depth){
  if(!(width>0&&depth>0))return [a,b];
  let lo=0,hi=1;const dx=b.x-a.x,dz=b.z-a.z;
  for(const [at,delta,size] of [[a.x,dx,width],[a.z,dz,depth]]){
   if(!delta){if(at<0||at>size)return null;continue;}
   let enter=-at/delta,leave=(size-at)/delta;
   if(enter>leave){const swap=enter;enter=leave;leave=swap;}
   lo=Math.max(lo,enter);hi=Math.min(hi,leave);if(lo>hi)return null;
  }
  return [{x:Math.max(0,Math.min(width,a.x+dx*lo)),z:Math.max(0,Math.min(depth,a.z+dz*lo))},
   {x:Math.max(0,Math.min(width,a.x+dx*hi)),z:Math.max(0,Math.min(depth,a.z+dz*hi))}];
 }
 function crosses(field,from,to,width,depth){
  if(!finite(to))return false;
  if(field.burningAt(to.x,to.z))return true;
  if(!finite(from))return false;
  if(from.x===to.x&&from.z===to.z)return false;
  if(Math.floor(from.x)===Math.floor(to.x)&&Math.floor(from.z)===Math.floor(to.z))return false;
  if(field.burningAt(from.x,from.z))return true;
  let a=from,b=to;
  if(width>0&&depth>0&&(from.x<0||from.x>width||from.z<0||from.z>depth||to.x<0||to.x>width||to.z<0||to.z>depth)){
   const path=clip(from,to,width,depth);if(!path)return false;
   a=path[0];b=path[1];
  }
  const dx=b.x-a.x,dz=b.z-a.z;
  let x=Math.floor(a.x),z=Math.floor(a.z);const endX=Math.floor(b.x),endZ=Math.floor(b.z);
  const sx=Math.sign(dx),sz=Math.sign(dz),deltaX=dx?Math.abs(1/dx):Infinity,deltaZ=dz?Math.abs(1/dz):Infinity;
  let nextX=dx?((sx>0?x+1:x)-a.x)/dx:Infinity,nextZ=dz?((sz>0?z+1:z)-a.z)/dz:Infinity;
  // Only cells actually traversed by the line are visited. In particular a
  // diagonal touching a grid corner does not enter the two side cells.
  for(let remaining=Math.abs(endX-x)+Math.abs(endZ-z)+1;remaining>0;remaining--){
   if(field.burningAt(x+.5,z+.5))return true;
   if(x===endX&&z===endZ)break;
   if(nextX<nextZ){x+=sx;nextX+=deltaX;}
   else if(nextZ<nextX){z+=sz;nextZ+=deltaZ;}
   else{x+=sx;z+=sz;nextX+=deltaX;nextZ+=deltaZ;}
  }
  return false;
 }
 function create({field,combat}){
  const terrain=field.field||field,width=terrain.width,depth=terrain.depth;
  let previous=new WeakMap(),tracking=false;
  function idle(){if(tracking){previous=new WeakMap();tracking=false;}}
  function remember(member,state){
   if(state){state.x=member.x;state.z=member.z;}
   else previous.set(member,{x:member.x,z:member.z});
  }
  function capture(squads){
   if(!field.burning.size){idle();return;}
   for(const squad of squads)for(const member of squad.members){
    if(squad.sheltered||squad.inVillage||!(member.hp>0)||!finite(member))previous.delete(member);
    else remember(member,previous.get(member));
   }
   tracking=true;
  }
  function apply(squads){
   if(!field.burning.size){idle();return 0;}
   let killed=0;
   for(const squad of squads){
    // Death handling removes and reforms members, so inspect a stable list.
    for(const member of [...squad.members]){
     if(squad.sheltered||squad.inVillage||!(member.hp>0)||!finite(member)){previous.delete(member);continue;}
     const state=previous.get(member);
     if(crosses(field,tracking?state:null,member,width,depth)){
      combat.burn(member,member.hp);
      if(!(member.hp>0)){previous.delete(member);killed++;continue;}
     }
     // A second apply in this tick traces only movement since the first.
     remember(member,state);
    }
   }
   tracking=true;return killed;
  }
  return {capture,apply};
 }
 return {create};
});
