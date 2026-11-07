/* Local, reachable deployment alternatives. Candidate destinations and final
   soldier footprints stay close to the requested group; nothing scans the
   map for a distant fallback. Callers provide terrain and route validation. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansNearbyDeployment=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const finite=Number.isFinite,dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
 const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
 function hull(points){
  const list=points.filter(p=>finite(p.x)&&finite(p.z)).sort((a,b)=>a.x-b.x||a.z-b.z);
  const unique=list.filter((p,i)=>!i||p.x!==list[i-1].x||p.z!==list[i-1].z);
  if(unique.length<3)return unique;
  const a=[],b=[];
  for(const p of unique){while(a.length>1&&cross(a[a.length-2],a[a.length-1],p)<=0)a.pop();a.push(p);}
  for(let i=unique.length-1;i>=0;i--){const p=unique[i];while(b.length>1&&cross(b[b.length-2],b[b.length-1],p)<=0)b.pop();b.push(p);}
  return a.slice(0,-1).concat(b.slice(0,-1));
 }
 function footprint(members,padding=.18){
  return hull(members.flatMap(p=>[{x:p.x-padding,z:p.z-padding},{x:p.x-padding,z:p.z+padding},
   {x:p.x+padding,z:p.z-padding},{x:p.x+padding,z:p.z+padding}]));
 }
 function overlaps(a,b,clearance=.35){
  if(a.length<3||b.length<3)return false;
  for(const poly of [a,b])for(let i=0;i<poly.length;i++){
   const p=poly[i],q=poly[(i+1)%poly.length],nx=-(q.z-p.z),nz=q.x-p.x,length=Math.hypot(nx,nz);
   if(length<1e-9)continue;
   let a0=Infinity,a1=-Infinity,b0=Infinity,b1=-Infinity;
   for(const v of a){const n=(v.x*nx+v.z*nz)/length;a0=Math.min(a0,n);a1=Math.max(a1,n);}
   for(const v of b){const n=(v.x*nx+v.z*nz)/length;b0=Math.min(b0,n);b1=Math.max(b1,n);}
   if(a1+clearance<=b0+1e-7||b1+clearance<=a0+1e-7)return false;
  }
  return true;
 }
 function create({maxDistance=10,step=.75,maxCandidates=256,clearance=.35,bodyRadius=.18,
  anchorMin=12,anchorMax=24,anchorPadding=8,maxDetourRatio=2.5,maxDetourExtra=12,localOrderDistance=24}={}){
  maxDistance=finite(maxDistance)?Math.max(0,Math.min(18,maxDistance)):10;
  step=finite(step)?Math.max(.25,Math.min(2,step)):.75;
  maxCandidates=finite(maxCandidates)?Math.max(1,Math.floor(maxCandidates)):256;
  const limits=Object.freeze({maxDistance,step,maxCandidates,clearance,bodyRadius,anchorMin,anchorMax,anchorPadding,maxDetourRatio,maxDetourExtra,localOrderDistance});
  const offsets=[];
  for(let z=-Math.ceil(maxDistance/step);z<=Math.ceil(maxDistance/step);z++)for(let x=-Math.ceil(maxDistance/step);x<=Math.ceil(maxDistance/step);x++){
   const dx=x*step,dz=z*step,d2=dx*dx+dz*dz;if(d2>1e-9&&d2<=maxDistance*maxDistance+1e-7)offsets.push({x:dx,z:dz,d2});
  }
  let saved=null;
  function signatureMatches(state,targets,key,anchor,heading){
   return !!state&&key!==undefined&&state.key===key&&state.anchor.x===anchor.x&&state.anchor.z===anchor.z&&state.heading===heading&&
    state.inputs.length===targets.length&&state.inputs.every((t,i)=>t.squad===targets[i].squad&&t.x===targets[i].x&&t.z===targets[i].z);
  }
  function makeState(targets,key,anchor,heading){
   const inputs=targets.map(t=>({...t})),furthest=Math.max(0,...inputs.map(t=>finite(t.x)&&finite(t.z)?dist(t,anchor):0));
   const anchorLimit=Math.min(anchorMax,Math.max(anchorMin,furthest+anchorPadding));
   const states=inputs.map((target,index)=>({target,index,status:'ideal',cursor:0,lastPreview:null,candidates:null}));
   return {key,anchor:{x:anchor.x,z:anchor.z},heading,anchorLimit,inputs,states,reserved:[],phase:'ideal',idealCursor:0,
    searchOrder:null,searchCursor:0,totalCandidates:0,totalValidated:0,repacked:false,finished:false,best:null};
  }
  function approxFootprint(target){
   const points=target.intended?.members||target.intended;
   if(Array.isArray(points)&&points.length)return footprint(points,bodyRadius);
   const r=Math.max(.3,Math.min(12,target.squad?.radius||target.radius||.55));
   return [{x:target.x-r,z:target.z-r},{x:target.x+r,z:target.z-r},{x:target.x+r,z:target.z+r},{x:target.x-r,z:target.z+r}];
  }
  function report(state,stats){
   const complete=state.finished;
   const targets=state.states.map(s=>s.result?{...s.result}:{...s.target,preview:s.lastPreview,blocked:s.status==='blocked',deferred:s.status!=='blocked'});
   return {targets,complete,deferred:!complete,ok:targets.every(t=>!t.blocked&&!t.deferred),
    stats:{...stats,totalCandidates:state.totalCandidates,totalValidated:state.totalValidated,anchorLimit:state.anchorLimit,maxDistance,repacked:state.repacked}};
  }
  function resolve(targets,{anchor,heading=null,key,validate,canFit=null,known=null,within=null,maxCandidates:perCall=maxCandidates}={}){
   if(!Array.isArray(targets)||typeof validate!=='function')throw new Error('Nearby deployment needs targets and a route validator');
   anchor=anchor&&finite(anchor.x)&&finite(anchor.z)?anchor:{x:targets.reduce((n,t)=>n+(t.x||0),0)/Math.max(1,targets.length),z:targets.reduce((n,t)=>n+(t.z||0),0)/Math.max(1,targets.length)};
   const state=signatureMatches(saved,targets,key,anchor,heading)?saved:makeState(targets,key,anchor,heading);saved=state;
   const stats={candidates:0,validated:0},budget=finite(perCall)?Math.max(1,Math.floor(perCall)):maxCandidates;
   function attempt(item,candidate){
    if(stats.candidates>=budget)return 'budget';
    stats.candidates++;state.totalCandidates++;
    if(!finite(candidate.x)||!finite(candidate.z)||dist(candidate,item.target)>maxDistance+1e-7||dist(candidate,state.anchor)>state.anchorLimit+1e-7)return 'rejected';
    if(within&&!within(candidate,item.target,item.index))return 'rejected';
    if(known&&!known(candidate,item.target,item.index))return 'unknown';
    const fit=canFit?.(candidate,item.target,item.index);
    if(fit?.deferred)return 'deferred';
    if(fit===false||fit?.ok===false||fit?.valid===false)return 'rejected';
    const cheap=fit?.formation||(Array.isArray(fit?.members)?fit:null);
    if(cheap?.valid&&finite(cheap.x)&&finite(cheap.z)&&cheap.members?.length){
     const reach=Math.max(.3,Math.min(12,item.target.squad?.radius||item.target.radius||.55));
     if(dist(cheap,item.target)>maxDistance+1e-7||dist(cheap,state.anchor)>state.anchorLimit+1e-7||
      cheap.members.some(m=>!finite(m.x)||!finite(m.z)||dist(m,item.target)>maxDistance+reach+1e-7||dist(m,state.anchor)>state.anchorLimit+reach+1e-7))return 'rejected';
     const shape=footprint(cheap.members,bodyRadius);
     if(state.reserved.some(other=>overlaps(shape,other.shape,clearance)))return 'rejected';
    }
    stats.validated++;state.totalValidated++;
    const preview=validate(candidate,item.target,item.index);
    if(preview?.deferred)return 'deferred';
    item.lastPreview=preview||null;
    if(preview?.provisional)return 'provisional';
    const form=preview?.formation;
    if(!preview?.ok||!form?.valid||!finite(form.x)||!finite(form.z)||!form.members?.length||form.members.some(m=>!finite(m.x)||!finite(m.z)||m.valid===false))return 'rejected';
    const actual={x:form.x,z:form.z},reach=Math.max(.3,Math.min(12,item.target.squad?.radius||item.target.radius||.55));
    if(dist(actual,item.target)>maxDistance+1e-7||dist(actual,state.anchor)>state.anchorLimit+1e-7||
     form.members.some(m=>dist(m,item.target)>maxDistance+reach+1e-7||dist(m,state.anchor)>state.anchorLimit+reach+1e-7))return 'rejected';
    const alternative=dist(candidate,item.target)>.01||dist(actual,item.target)>.55;
    const origin=preview.points?.[0]||item.target.squad;
    const localOrder=origin&&finite(origin.x)&&finite(origin.z)&&dist(origin,item.target)<=localOrderDistance;
    if((alternative||localOrder)&&finite(preview.length)&&origin&&finite(origin.x)&&finite(origin.z)&&preview.length>dist(origin,actual)*maxDetourRatio+maxDetourExtra+1e-7)return 'rejected';
    const shape=footprint(form.members,bodyRadius);
    if(state.reserved.some(other=>overlaps(shape,other.shape,clearance)))return 'rejected';
    item.result={...item.target,x:candidate.x,z:candidate.z,preview,resolved:actual,adjusted:dist(actual,item.target)>.01||dist(candidate,item.target)>.01,blocked:false,deferred:false};
    item.status='done';state.reserved.push({index:item.index,shape});return 'accepted';
   }
   function provisional(item){
    item.result={...item.target,preview:item.lastPreview,provisional:true,adjusted:false,blocked:false,deferred:false};item.status='done';
    state.reserved.push({index:item.index,shape:approxFootprint(item.target)});
   }
   // Keep legal intended placements first, then move only the obstructed
   // troops. Their accepted *actual* footprints reserve space for later ones.
   while(state.phase==='ideal'&&state.idealCursor<state.states.length){
    const item=state.states[state.idealCursor],outcome=attempt(item,{x:item.target.x,z:item.target.z});
    if(outcome==='budget'||outcome==='deferred')return report(state,stats);
    if(outcome==='unknown'||outcome==='provisional')provisional(item);
    else if(outcome!=='accepted')item.status='search';
    state.idealCursor++;
   }
   if(state.phase==='ideal'){
    state.phase='search';state.searchOrder=state.states.filter(s=>s.status==='search').sort((a,b)=>(b.target.squad?.radius||b.target.radius||.55)-(a.target.squad?.radius||a.target.radius||.55)||a.index-b.index);
   }
   while(true){
    while(state.searchCursor<state.searchOrder.length){
     const item=state.searchOrder[state.searchCursor];
     if(state.repacked&&!item.repackIdeal){
      const outcome=attempt(item,{x:item.target.x,z:item.target.z});
      if(outcome==='budget'||outcome==='deferred')return report(state,stats);
      item.repackIdeal=true;
      if(outcome==='accepted'){state.searchCursor++;continue;}
      if(outcome==='unknown'||outcome==='provisional'){provisional(item);state.searchCursor++;continue;}
     }
     if(!item.candidates)item.candidates=offsets.map(o=>({x:item.target.x+o.x,z:item.target.z+o.z,d2:o.d2})).sort((a,b)=>a.d2-b.d2||dist(a,state.anchor)-dist(b,state.anchor)||a.x-b.x||a.z-b.z);
     let accepted=false;
     while(item.cursor<item.candidates.length){
      const candidate=item.candidates[item.cursor],outcome=attempt(item,candidate);
      if(outcome==='budget'||outcome==='deferred')return report(state,stats);
      item.cursor++;
      if(outcome==='accepted'){accepted=true;break;}
      // Unknown alternative ground never provides information or silently
      // changes a known destination into an unobserved deployment.
     }
     if(!accepted&&item.status!=='done')item.status='blocked';
     state.searchCursor++;
    }
    if(!state.repacked&&state.states.some(s=>s.status==='blocked')){
     // A legal one-person ideal can occupy the only hole for a whole troop.
     // Try the large blocks first, then relocate the smaller ones locally.
     state.best={states:state.states.map(s=>({status:s.status,result:s.result,lastPreview:s.lastPreview})),reserved:[...state.reserved]};
     state.repacked=true;state.reserved=state.reserved.filter(r=>state.states[r.index].result?.provisional);
     state.searchOrder=state.states.filter(s=>!s.result?.provisional).sort((a,b)=>(b.target.squad?.radius||b.target.radius||.55)-(a.target.squad?.radius||a.target.radius||.55)||a.index-b.index);
     for(const item of state.searchOrder){item.status='search';item.result=null;item.cursor=0;item.repackIdeal=false;}
     state.searchCursor=0;continue;
    }
    break;
   }
   if(state.best){
    const score=states=>states.reduce((a,s)=>{
     if(s.status==='done'&&s.result){a[0]+=s.result.squad?.members?.length||1;a[1]++;a[2]-=dist(s.result.resolved||s.result,state.anchor);}
     return a;
    },[0,0,0]);
    const current=score(state.states),old=score(state.best.states);
    const better=current[0]!==old[0]?current[0]>old[0]:current[1]!==old[1]?current[1]>old[1]:current[2]>=old[2];
    if(!better){state.states.forEach((s,i)=>Object.assign(s,state.best.states[i]));state.reserved=state.best.reserved;}
    state.best=null;
   }
   state.finished=true;
   return report(state,stats);
  }
  function clear(){saved=null;}
  return {resolve,clear,limits};
 }
 return {create,footprint,overlaps};
});
