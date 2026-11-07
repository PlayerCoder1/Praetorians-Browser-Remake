/* Small terrain-following soot and ash patches. Vertex colours avoid another
   texture or render pass; nearby patches share a chunk mesh and material. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansGroundScorch=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const FAN=[[.5,.5],[0,0],[.5,0],[1,0],[1,.5],[1,1],[.5,1],[0,1],[0,.5]];
 const clamp=v=>Math.max(0,Math.min(1,v));
 function noise(x,z){let h=(Math.imul(Math.round(x*16),374761393)+Math.imul(Math.round(z*16),668265263))|0;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;}
 function create({B,scene,groundY,width,chunkSize=16}){
  const meshes=[],batches=new Map(),records=new Map(),dirty=new Set();let material=null,enabled=true;
  function batchFor(patch){
   const key=`${Math.floor(patch.x0/chunkSize)},${Math.floor(patch.z0/chunkSize)}`;
   if(batches.has(key))return batches.get(key);
   if(!material){
    material=new B.StandardMaterial('wheat soot and ash',scene);material.disableLighting=true;
    material.emissiveColor=B.Color3.White();material.specularColor=B.Color3.Black();
    material.transparencyMode=B.Material.MATERIAL_ALPHABLEND;material.disableDepthWrite=true;material.backFaceCulling=false;material.zOffset=-1;
   }
   const mesh=new B.Mesh(`wheat scorch chunk ${key}`,scene);mesh.material=material;mesh.isPickable=false;
   mesh.useVertexColors=true;mesh.hasVertexAlpha=true;mesh.setEnabled(enabled);meshes.push(mesh);
   const batch={mesh,positions:[],normals:[],colors:[],indices:[],rebuild:false};batches.set(key,batch);return batch;
  }
  function add(patch){
   if(records.has(patch.id))return;
   const batch=batchFor(patch),start=batch.positions.length/3,weights=[],tones=[];
   const cells=new Set(patch.cells);
   // Match the terrain's eight-triangle fan in every 1 m logical cell.
   for(let cz=patch.z0;cz<patch.z1;cz++)for(let cx=patch.x0;cx<patch.x1;cx++){
    if(!cells.has(cz*width+cx))continue;
    const centre=batch.positions.length/3;
    for(const [dx,dz] of FAN){
     const x=cx+dx,z=cz+dz,n=noise(x,z);
     batch.positions.push(x,groundY(x,z)+.018,z);batch.normals.push(0,1,0);
     const edge=Math.min(x-patch.x0,patch.x1-x,z-patch.z0,patch.z1-z);
     weights.push(clamp(edge/.35)*(.65+n*.25));
     tones.push(.09+n*.07,.083+n*.06,.07+n*.05);batch.colors.push(0,0,0,0);
    }
    for(let i=0;i<8;i++)batch.indices.push(centre,centre+1+(i+1)%8,centre+1+i);
   }
   records.set(patch.id,{batch,start,weights,tones,progress:-1});batch.rebuild=true;dirty.add(batch);
  }
  function paint(id,progress){
   const r=records.get(id);if(!r)return;const k=clamp(progress);if(k===r.progress)return;r.progress=k;
   for(let i=0;i<r.weights.length;i++){
    const o=(r.start+i)*4;r.batch.colors[o]=r.tones[i*3];r.batch.colors[o+1]=r.tones[i*3+1];r.batch.colors[o+2]=r.tones[i*3+2];
    r.batch.colors[o+3]=r.weights[i]*k*.85;
   }
   dirty.add(r.batch);
  }
  function flush(){
   for(const batch of dirty){
    if(batch.rebuild){
     const vd=new B.VertexData();vd.positions=batch.positions;vd.normals=batch.normals;vd.colors=batch.colors;vd.indices=batch.indices;
     vd.applyToMesh(batch.mesh,true);batch.rebuild=false;
    }else batch.mesh.updateVerticesData(B.VertexBuffer.ColorKind,batch.colors,false,false);
   }
   dirty.clear();
  }
  return {meshes,add,paint,flush,
   setEnabled(on){enabled=on;for(const mesh of meshes)mesh.setEnabled(on);},
   dispose(){for(const mesh of meshes)mesh.dispose();material?.dispose();records.clear();batches.clear();dirty.clear();}};
 }
 return {create};
});
