/* What the player's side sees and has seen: a grid of CELL metres over the
   map. Every viewer (the player's troops and his allies' - their eyes are
   his - the hawk, revealed zones, villages and towers held) lights a disc of
   its vision radius, soft at the edge. Cells ever lit stay explored.
   - light: 0..255 seen now (soft edge over EDGE metres);
   - explored: 1 once seen.
   main.js shades the battlefield with it (out of sight darker, unexplored
   darker still) and greys the unexplored minimap. Pure: tests/vision.test.js. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansVision=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const CELL=2,EDGE=4;
 function create({width,depth,cell=CELL}){
  const cols=Math.max(1,Math.ceil(width/cell)),rows=Math.max(1,Math.ceil(depth/cell));
  const light=new Uint8Array(cols*rows),explored=new Uint8Array(cols*rows);
  let version=0;
  // viewers: [{x, z, r}] in metres.
  function update(viewers){
   light.fill(0);
   for(const v of viewers){
    if(!(v.r>0)||!Number.isFinite(v.x)||!Number.isFinite(v.z))continue;
    const x0=Math.max(0,Math.floor((v.x-v.r)/cell)),x1=Math.min(cols-1,Math.floor((v.x+v.r)/cell));
    const z0=Math.max(0,Math.floor((v.z-v.r)/cell)),z1=Math.min(rows-1,Math.floor((v.z+v.r)/cell));
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
     const d=Math.hypot((x+.5)*cell-v.x,(z+.5)*cell-v.z),k=Math.min(1,(v.r-d)/EDGE);
     if(k<=0)continue;
     const i=z*cols+x,value=Math.round(k*255);
     if(value>light[i])light[i]=value;
     explored[i]=1;
    }
   }
   version++;
  }
  const index=(x,z)=>{const cx=Math.floor(x/cell),cz=Math.floor(z/cell);return cx<0||cz<0||cx>=cols||cz>=rows?-1:cz*cols+cx;};
  function seen(x,z){const i=index(x,z);return i>=0&&light[i]>=128;}
  function wasExplored(x,z){const i=index(x,z);return i>=0&&explored[i]===1;}
  function revealAll(){explored.fill(1);version++;}
  // RGBA rows for a texture laid over the map (row 0 = the far edge, z = depth):
  // red = seen now, green = explored.
  function pixels(out=new Uint8ClampedArray(cols*rows*4)){
   for(let z=0;z<rows;z++)for(let x=0;x<cols;x++){
    const i=z*cols+x,o=((rows-1-z)*cols+x)*4;
    out[o]=light[i];out[o+1]=explored[i]*255;out[o+2]=0;out[o+3]=255;
   }
   return out;
  }
  return {cols,rows,cell,light,explored,update,seen,wasExplored,revealAll,pixels,get version(){return version;}};
 }
 return {create,CELL,EDGE};
});
