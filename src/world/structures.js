/* Mission structures (the tutorial's fixed bridge): placement transforms and
   the walkable deck, shared by navigation, ground heights and rendering.
   The walkway is the definition's PUNTO_SUPERFICIE rectangle; its height is
   the profile sampled from the HD mesh. The stonework beside the walkway
   (parapets and abutments, within the mesh's extent) is solid. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansStructures=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 function create(data){
  const decks=[];
  // A bridge's walkway; also for bridges built during the mission.
  function add(placement){
   const structure=data.structures[placement.type];if(!structure?.deck)return null;
   const deck=structure.deck,xs=structure.surface.map(p=>p[0]);
   const r=placement.r||0,c=Math.cos(r),s=Math.sin(r);
   const [sx0,sx1,sz0,sz1]=structure.stoneBounds;
   const made={placement,structure,c,s,
    xMin:Math.min(...xs),xMax:Math.max(...xs),zMin:deck.zMin,zMax:deck.zMax,
    reachX0:Math.min(sx0,Math.min(...xs)),reachX1:Math.max(sx1,Math.max(...xs)),reachZ0:sz0,reachZ1:sz1};
   decks.push(made);return made;
  }
  for(const placement of data?.placements||[])add(placement);
  // Rendering rotates by Quaternion.FromEulerAngles(0,r,0):
  // world = (lx*c + lz*s, -lx*s + lz*c); this is its inverse.
  const local=(d,x,z)=>{const dx=x-d.placement.x,dz=z-d.placement.z;return {lx:dx*d.c-dz*d.s,lz:dx*d.s+dz*d.c};};
  function profile(d,lx){
   const deck=d.structure.deck,f=(lx-deck.x0)/deck.step,i=Math.floor(f);
   const a=deck.heights[i],b=deck.heights[i+1];
   // At the ends of the stones the walkway keeps its last height, then
   // continues on the banks (null) - never a sudden drop inside one sample.
   if(a==null&&b==null)return null;
   if(a==null)return b;
   if(b==null)return a;
   return a+(b-a)*(f-i);
  }
  // 'deck': on the walkway (its height, or null where the walkway runs onto
  // the banks); 'solid': the stonework beside it; null: not a structure.
  function classify(x,z){
   for(const d of decks){
    const {lx,lz}=local(d,x,z);
    if(lx<d.reachX0||lx>d.reachX1||lz<d.reachZ0||lz>d.reachZ1)continue;
    if(lx>=d.xMin&&lx<=d.xMax&&lz>=d.zMin&&lz<=d.zMax){
     const h=profile(d,lx);
     return {kind:'deck',y:h==null?null:d.placement.y+h};
    }
    if((lz<d.zMin||lz>d.zMax)&&lx>=d.structure.stoneBounds[0]&&lx<=d.structure.stoneBounds[1])return {kind:'solid'};
   }
   return null;
  }
  // Raise the half-cell height samples under the walkway to the stones, so
  // ground height, navigation grades and soldier feet all follow the deck.
  // Samples one step beyond its long edges are raised too: heights blend
  // between samples, and the walkway must not sag towards the water at its
  // parapets. Those outer samples stay solid for navigation.
  function patchHeights(heights,columns,rows,step){
   let patched=0;
   for(let z=0;z<rows;z++)for(let x=0;x<columns;x++){
    let y=null;
    for(const d of decks){
     const {lx,lz}=local(d,x*step,z*step);
     if(lx<d.xMin||lx>d.xMax||lz<d.zMin-step||lz>d.zMax+step)continue;
     const h=profile(d,lx);if(h!=null)y=Math.max(y??-Infinity,d.placement.y+h);
    }
    if(y!=null&&y>heights[z*columns+x]){heights[z*columns+x]=y;patched++;}
   }
   return patched;
  }
  return {decks,classify,patchHeights,add};
 }
 return {create};
});
