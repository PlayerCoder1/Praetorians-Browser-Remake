/* Construction placement shared by the cursor preview and the actual order.
   Checks the complete rotated footprint; it never searches a route or moves
   builders, and existing soldiers can step away when construction begins. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansBuildPlacement=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const MESSAGES={
  type:'Cette construction n’est pas disponible.',position:'Choisissez un emplacement sur la carte.',
  boundary:'La construction dépasse les limites de la carte.',occupied:'Une construction occupe déjà cet emplacement.',
  blocked:'Le sol est impraticable pour cette construction.',structure:'Impossible de construire sur un bâtiment, un pont ou une muraille.',
  slope:'Le terrain est trop incliné ou irrégulier.',footprint:'L’emprise de cette construction est invalide.',
  visibility:'Explorez cet emplacement avant de construire.'
 };
 const finite=Number.isFinite;
 const point=p=>Array.isArray(p)?[p[0],p.length>2?p[2]:p[1]]:[p?.x,p?.z];
 const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
 function hull(input){
  const list=(input||[]).map(point).filter(p=>p.every(finite)).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const unique=list.filter((p,i)=>!i||p[0]!==list[i-1][0]||p[1]!==list[i-1][1]);
  if(unique.length<3)return [];
  const lower=[],upper=[];
  for(const p of unique){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=1e-9)lower.pop();lower.push(p);}
  for(const p of unique.slice().reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=1e-9)upper.pop();upper.push(p);}
  return lower.slice(0,-1).concat(upper.slice(0,-1));
 }
 function defaultFootprint(def={},unit=null){
  if(def.aroundX!=null){const c=def.aroundCentre||[0,0],x=c[0]||0,z=c.at(-1)||0,ax=Math.abs(def.aroundX),az=Math.abs(def.aroundY??ax);return [[x-ax,z-az],[x+ax,z-az],[x+ax,z+az],[x-ax,z+az]];}
  if(def.surface?.length>=3)return hull(def.surface);
  const radius=Math.max(.3,Number(def.aroundRadius)||(unit?1.1:1.5));
  return [[-radius,-radius],[radius,-radius],[radius,radius],[-radius,radius]];
 }
 function transform(local,{x,z,r=0}){const c=Math.cos(r),s=Math.sin(r);return local.map(p=>({x:x+p[0]*c+p[1]*s,z:z-p[0]*s+p[1]*c}));}
 function contains(poly,x,z){
  let sign=0;
  for(let i=0;i<poly.length;i++){
   const a=poly[i],b=poly[(i+1)%poly.length],v=(b.x-a.x)*(z-a.z)-(b.z-a.z)*(x-a.x);
   if(Math.abs(v)<1e-8)continue;const current=Math.sign(v);if(sign&&current!==sign)return false;sign=current;
  }
  return true;
 }
 function overlaps(a,b,padding=.15){
  for(const poly of [a,b])for(let i=0;i<poly.length;i++){
   const p=poly[i],q=poly[(i+1)%poly.length],dx=q.x-p.x,dz=q.z-p.z,l=Math.hypot(dx,dz);if(l<1e-8)continue;
   const nx=-dz/l,nz=dx/l;
   let a0=Infinity,a1=-Infinity,b0=Infinity,b1=-Infinity;
   for(const v of a){const d=v.x*nx+v.z*nz;a0=Math.min(a0,d);a1=Math.max(a1,d);}
   for(const v of b){const d=v.x*nx+v.z*nz;b0=Math.min(b0,d);b1=Math.max(b1,d);}
   if(a1+padding<=b0||b1+padding<=a0)return false;
  }
  return true;
 }
 function create({defs={},units={},width,depth,groundY=()=>0,navFor=()=>null,entities=()=>[],footprint=()=>null,classify=null,seen=null,sampleStep=.5,clearance=.12,maxRise=.7,maxGrade=.45,padding=.15}={}){
  const locals=new Map(),step=finite(sampleStep)&&sampleStep>0?Math.min(.5,sampleStep):.5;
  function localFor(type){
   if(!locals.has(type)){const source=footprint(type);locals.set(type,hull(source?.length?source:defaultFootprint(defs[type],units[type])));}
   return locals.get(type);
  }
  const fail=(reason,shape=[],extra={})=>({ok:false,reason,message:MESSAGES[reason]||MESSAGES.blocked,footprint:shape,...extra});
  function check(type,{x,z,r=0,civ=null}={}){
   if(!defs[type]&&!units[type]?.construction)return fail('type');
   if(![x,z,r,width,depth].every(finite)||width<=0||depth<=0)return fail('position');
   const local=localFor(type);if(local.length<3)return fail('footprint');
   const shape=transform(local,{x,z,r});
   if(shape.some(p=>p.x<0||p.z<0||p.x>width||p.z>depth))return fail('boundary',shape);
   const bounds={x0:Math.min(...shape.map(p=>p.x)),x1:Math.max(...shape.map(p=>p.x)),z0:Math.min(...shape.map(p=>p.z)),z1:Math.max(...shape.map(p=>p.z))};
   if((bounds.x1-bounds.x0)*(bounds.z1-bounds.z0)>1024)return fail('footprint',shape);
   // Visibility must be decided before consulting live occupancy or terrain.
   // Otherwise the ghost's colour/reason could reveal an unseen enemy site,
   // building, or changed ground beneath only a visible part of the model.
   if(typeof seen==='function'){
    for(let i=0;i<shape.length;i++){
     const a=shape[i],b=shape[(i+1)%shape.length],pieces=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)));
     for(let k=0;k<=pieces;k++)if(!seen(a.x+(b.x-a.x)*k/pieces,a.z+(b.z-a.z)*k/pieces))return fail('visibility',shape);
    }
    for(let row=0;bounds.z0+row<=bounds.z1+1e-7;row++){
     const pz=Math.min(bounds.z1,bounds.z0+row);
     for(let col=0;bounds.x0+col<=bounds.x1+1e-7;col++){
      const px=Math.min(bounds.x1,bounds.x0+col);
      if(contains(shape,px,pz)&&!seen(px,pz))return fail('visibility',shape);
     }
    }
    // The model pivot is also read below to determine its ground height.
    if(!seen(x,z))return fail('visibility',shape);
   }
   for(const e of entities()||[]){
    if(!e||e.state==='destroyed'||e.destroyed||![e.x,e.z].every(finite))continue;
    const otherLocal=e.machine?localFor(e.type):e.outline?.length?hull(e.outline):localFor(e.type);
    if(otherLocal.length<3)continue;
    const other=transform(otherLocal,{x:e.x,z:e.z,r:e.r||0});
    if(overlaps(shape,other,padding))return fail('occupied',shape,{obstacle:e});
   }
   const grid=navFor(type,civ);if(!grid?.canStand)return fail('blocked',shape);
   let low=Infinity,high=-Infinity,sampleCount=0,firstFailure=null;
   const sampled=new Map();
   function sample(px,pz,previous=null){
    if(firstFailure)return null;
    const id=px.toFixed(5)+','+pz.toFixed(5);if(sampled.has(id))return sampled.get(id);
    sampleCount++;
    if(sampleCount>8192){firstFailure='footprint';return null;}
    const hit=classify?.(px,pz);
    if(hit&&['solid','deck','wall','ladder','gate','village'].includes(hit.kind)){firstFailure='structure';return null;}
    if(!grid.canStand(px,pz,clearance)){firstFailure='blocked';return null;}
    const y=groundY(px,pz);if(!finite(y)){firstFailure='blocked';return null;}
    low=Math.min(low,y);high=Math.max(high,y);
    if(high-low>maxRise+1e-7){firstFailure='slope';return null;}
    const result={x:px,z:pz,y};sampled.set(id,result);
    if(previous){const distance=Math.hypot(px-previous.x,pz-previous.z);if(distance>1e-6&&Math.abs(y-previous.y)/distance>maxGrade+1e-7)firstFailure='slope';}
    return result;
   }
   // Boundary samples stop narrow obstacles and terrain edges being hidden
   // between an otherwise valid centre and the far corners of the model.
   for(let i=0;i<shape.length&&!firstFailure;i++){
    const a=shape[i],b=shape[(i+1)%shape.length],pieces=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/step));let previous=null;
    for(let k=0;k<=pieces&&!firstFailure;k++)previous=sample(a.x+(b.x-a.x)*k/pieces,a.z+(b.z-a.z)*k/pieces,previous);
   }
   // Fill the polygon, not just its corners: a pond or another obstruction
   // entirely inside a catapult/tower footprint must also reject placement.
   const previousRow=new Map();
   for(let row=0;bounds.z0+row*step<=bounds.z1+1e-7&&!firstFailure;row++){
    const pz=Math.min(bounds.z1,bounds.z0+row*step);let previous=null;
    for(let col=0;bounds.x0+col*step<=bounds.x1+1e-7&&!firstFailure;col++){
     const px=Math.min(bounds.x1,bounds.x0+col*step);if(!contains(shape,px,pz)){previous=null;previousRow.delete(col);continue;}
     const current=sample(px,pz,previous),above=previousRow.get(col);
     if(current&&above&&Math.abs(current.y-above.y)/step>maxGrade+1e-7)firstFailure='slope';
     if(current)previousRow.set(col,current);previous=current;
    }
   }
   if(!firstFailure)sample(x,z);
   if(firstFailure)return fail(firstFailure,shape,{sampleCount});
   return {ok:true,reason:null,message:'Emplacement disponible.',footprint:shape,height:groundY(x,z),sampleCount};
  }
  return {check,localFootprint:localFor};
 }
 return {create,defaultFootprint,transform,overlaps};
});
