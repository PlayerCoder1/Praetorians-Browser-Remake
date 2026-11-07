/* Painted-cliff detection. Many Praetorians cliffs (switchback walls, gully
   sides) are low-relief in the height field and only read as cliffs because
   the terrain atlas paints a rock layer there. Measure that rock layer
   directly from what is rendered: classify each atlas region a triangle
   samples (rock is grey, i.e. low saturation, unlike grass and sand), then
   weight it with the per-vertex layer blend (colors.a) exactly like the
   terrain shader: lerp(texture(uvs), texture(uvs2), colors.a). */
(function(root, factory) {
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PraetoriansTerrainSurface=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 // atlas: {pixels: RGBA bytes, width, height} holding at least every row the
 // UVs reach; textureWidth/textureHeight are the full texture dimensions the
 // UVs are normalised against (defaults to the pixel buffer size).
 function regionClassifier(atlas, rockSaturation){
  const tw=atlas.textureWidth||atlas.width,th=atlas.textureHeight||atlas.height,px=atlas.pixels,cache=new Map();
  return function isRock(u0,v0,u1,v1){
   const x0=Math.max(0,Math.floor(u0*tw)),x1=Math.min(atlas.width-1,Math.ceil(u1*tw)-1),
    y0=Math.max(0,Math.floor(v0*th)),y1=Math.min(atlas.height-1,Math.ceil(v1*th)-1),key=`${x0},${y0},${x1},${y1}`;
   let rock=cache.get(key);
   if(rock===undefined){
    // Mean per-texel saturation; a stride keeps large regions cheap.
    const stride=Math.max(1,Math.floor(Math.min(x1-x0,y1-y0)/24));let s=0,n=0;
    for(let y=y0;y<=y1;y+=stride)for(let x=x0;x<=x1;x+=stride){
     const o=(y*atlas.width+x)*4,r=px[o],g=px[o+1],b=px[o+2],mx=Math.max(r,g,b);
     s+=mx?(mx-Math.min(r,g,b))/mx:0;n++;
    }
    rock=n>0&&s/n<rockSaturation;cache.set(key,rock);
   }
   return rock;
  };
 }
 // Returns a Float32Array (columns*rows, same layout as the navigation grid)
 // with the painted rock fraction in [0,1] at every grid vertex.
 function rockCoverage(mesh, atlas, grid, options={}){
  const {positions,uvs,uvs2,colors}=mesh,step=grid.step||.5;
  const columns=Math.round(grid.width/step)+1,rows=Math.round(grid.depth/step)+1;
  const isRock=regionClassifier(atlas,options.rockSaturation ?? .38);
  const sum=new Float32Array(columns*rows),count=new Uint16Array(columns*rows);
  const indices=mesh.indices,triangles=(indices?indices.length:positions.length/3)/3;
  const corner=(t,k)=>indices?indices[t*3+k]:t*3+k;
  const bounds=(uv,t)=>{let u0=Infinity,v0=Infinity,u1=-Infinity,v1=-Infinity;
   for(let k=0;k<3;k++){const c=corner(t,k),u=uv[c*2],v=uv[c*2+1];u0=Math.min(u0,u);v0=Math.min(v0,v);u1=Math.max(u1,u);v1=Math.max(v1,v);}
   return [u0,v0,u1,v1];};
  for(let t=0;t<triangles;t++){
   const rockA=isRock(...bounds(uvs,t)),rockB=isRock(...bounds(uvs2,t));
   for(let k=0;k<3;k++){
    const v=corner(t,k),i=gridIndex(v);if(i<0)continue;
    const alpha=colors[v*4+3];
    sum[i]+=(rockA?1-alpha:0)+(rockB?alpha:0);count[i]++;
   }
  }
  function gridIndex(v){
   const x=Math.round(positions[v*3]/step),z=Math.round(positions[v*3+2]/step);
   return x>=0&&z>=0&&x<columns&&z<rows?z*columns+x:-1;
  }
  const coverage=new Float32Array(columns*rows);
  for(let i=0;i<coverage.length;i++)coverage[i]=count[i]?Math.min(1,sum[i]/count[i]):0;
  return coverage;
 }
 return {rockCoverage};
});
