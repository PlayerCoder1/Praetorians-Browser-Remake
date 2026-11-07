/* Soldier destination markers for a held movement order. Two reused thin-
   instance batches draw all the gold/red ground arrows; no units, textures,
   shadows, collision or navigation work are created by this renderer. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansFormationPreview=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 function create({B,scene,groundY=()=>0,lift=.065}={}){
  if(!B||!scene)throw new Error('Formation preview needs Babylon and a scene');
  const positions=[],indices=[],normals=[];
  const vertex=(x,z)=>{positions.push(x,0,z);normals.push(0,1,0);return positions.length/3-1;};
  // An open ring marks the exact foot position; the small arrow points at
  // the front of the final formation, using the game's +Z-forward yaw.
  for(let i=0;i<16;i++){
   const a=i*Math.PI/8,b=(i+1)*Math.PI/8,start=positions.length/3;
   vertex(Math.cos(a)*.145,Math.sin(a)*.145);vertex(Math.cos(a)*.103,Math.sin(a)*.103);
   vertex(Math.cos(b)*.145,Math.sin(b)*.145);vertex(Math.cos(b)*.103,Math.sin(b)*.103);
   indices.push(start,start+1,start+2,start+1,start+3,start+2);
  }
  const at=positions.length/3;
  for(const p of [[-.038,.095],[.038,.095],[-.038,.22],[.038,.22],[0,.32],[-.115,.185],[.115,.185]])vertex(...p);
  indices.push(at,at+1,at+2,at+1,at+3,at+2,at+4,at+5,at+6);
  const batches=[true,false].map(valid=>{
   const mesh=new B.Mesh('formation preview '+(valid?'valid':'invalid'),scene),data=new B.VertexData();
   data.positions=positions;data.indices=indices;data.normals=normals;data.applyToMesh(mesh,false);
   const material=new B.StandardMaterial(mesh.name+' material',scene);
   material.disableLighting=true;material.emissiveColor=valid?new B.Color3(1,.81,.28):new B.Color3(1,.16,.1);
   material.diffuseColor=B.Color3.Black();material.specularColor=B.Color3.Black();
   material.alpha=.9;material.backFaceCulling=false;material.disableDepthWrite=true;
   material.depthFunction=B.Constants.ALWAYS;material.transparencyMode=B.Material.MATERIAL_ALPHABLEND;
   mesh.material=material;mesh.isPickable=false;mesh.checkCollisions=false;mesh.receiveShadows=false;
   mesh.renderingGroupId=2;mesh.metadata={formationPreview:true,valid};mesh.setEnabled(false);
   return {valid,mesh,material,matrices:null,capacity:0,count:0};
  });
  const one=new B.Vector3(1,1,1),position=new B.Vector3(),rotation=new B.Quaternion(),matrix=B.Matrix.Identity();
  let visible=false,disposed=false,markers=[];
  function show(input=[]){
   if(disposed)return false;
   markers=[];for(const marker of input||[]){
    const x=marker.x,z=marker.z,r=Number.isFinite(marker.r)?marker.r:0;
    if(!Number.isFinite(x)||!Number.isFinite(z))continue;
    const y=Number.isFinite(marker.y)?marker.y:groundY(x,z);
    if(!Number.isFinite(y))continue;
    markers.push({x,y:y+lift,z,r,valid:marker.valid!==false});
   }
   for(const batch of batches){
    const count=markers.reduce((n,m)=>n+(m.valid===batch.valid),0);
    if(count>batch.capacity){
     batch.capacity=2**Math.ceil(Math.log2(Math.max(32,count)));
     batch.matrices=new Float32Array(batch.capacity*16);
     batch.mesh.thinInstanceSetBuffer('matrix',batch.matrices,16,false);
    }
    batch.count=count;let i=0;
    for(const marker of markers)if(marker.valid===batch.valid){
     position.set(marker.x,marker.y,marker.z);B.Quaternion.RotationYawPitchRollToRef(marker.r,0,0,rotation);
     B.Matrix.ComposeToRef(one,rotation,position,matrix);batch.matrices.set(matrix.m,i++*16);
    }
    batch.mesh.thinInstanceCount=count;
    if(count){batch.mesh.thinInstanceBufferUpdated('matrix');batch.mesh.thinInstanceRefreshBoundingInfo(true);}
    batch.mesh.setEnabled(count>0);
   }
   visible=markers.length>0;return visible;
  }
  function hide(){for(const batch of batches){batch.count=0;batch.mesh.thinInstanceCount=0;batch.mesh.setEnabled(false);}markers=[];visible=false;}
  function dispose(){if(disposed)return;hide();for(const batch of batches){batch.mesh.dispose(false,false);batch.material.dispose(false,false);}disposed=true;}
  return {show,hide,dispose,get markers(){return markers;},get meshes(){return batches.map(b=>b.mesh);},get visible(){return visible;},
   get stats(){return {markers:markers.length,batches:batches.filter(b=>b.count>0).length,capacity:batches.reduce((n,b)=>n+b.capacity,0)};}};
 }
 return {create};
});
