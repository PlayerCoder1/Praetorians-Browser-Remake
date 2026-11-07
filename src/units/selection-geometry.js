/* Pure geometry for RTS marquee selection and multi-squad deployment. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansSelectionGeometry=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
 const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
 function rectFromPoints(a,b){return {left:Math.min(a.x,b.x),top:Math.min(a.y,b.y),right:Math.max(a.x,b.x),bottom:Math.max(a.y,b.y)};}
 function inRect(p,r,margin=0){return p.x>=r.left-margin&&p.x<=r.right+margin&&p.y>=r.top-margin&&p.y<=r.bottom+margin;}
 function dragHeading(anchor,tip,minLength=.35){
  return dist(anchor,tip)<minLength?null:Math.atan2(tip.x-anchor.x,tip.z-anchor.z);
 }
 function deploymentTargets(squads,anchor,heading){
  if(!squads.length)return [];
  if(squads.length===1)return [{squad:squads[0],x:anchor.x,z:anchor.z}];
  const columns=squads.length<=3?squads.length:Math.ceil(Math.sqrt(squads.length));
  const rows=Math.ceil(squads.length/columns);
  const largest=Math.max(...squads.map(s=>Number.isFinite(s.radius)?s.radius:1));
  const spacing=Math.max(2.5,largest*2+1.0);
  const sideways={x:Math.cos(heading),z:-Math.sin(heading)};
  const ahead={x:Math.sin(heading),z:Math.cos(heading)};
  return squads.map((squad,i)=>{
   const row=Math.floor(i/columns),rowStart=row*columns;
   const rowWidth=Math.min(columns,squads.length-rowStart);
   const col=i-rowStart;
   const lateral=(col-(rowWidth-1)/2)*spacing;
   const depth=((rows-1)/2-row)*spacing;
   return {squad,x:anchor.x+sideways.x*lateral+ahead.x*depth,z:anchor.z+sideways.z*lateral+ahead.z*depth};
  });
 }
 function selectionIndices(projected,rect){return projected.filter(item=>item.points.some(p=>inRect(p,rect))).map(item=>item.index);}
 return {rectFromPoints,inRect,dragHeading,deploymentTargets,selectionIndices,clamp};
});
