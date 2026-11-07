/* A visual-only construction ghost built from the actual HD model sections.
   The owner validates placement; this renderer never creates building sites,
   obstacles, workers or resources. Only one type's preview is retained. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansBuildPreview=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const TEXTURES=['diffuseTexture','ambientTexture','opacityTexture','reflectionTexture','emissiveTexture','specularTexture','bumpTexture','lightmapTexture','refractionTexture','albedoTexture','reflectivityTexture','metallicTexture','microSurfaceTexture','metallicReflectanceTexture','reflectanceTexture','environmentBRDFTexture'];
 function create({B,scene,groundY=()=>0,resolveParts,materialForGroup,models=null,alpha=.75}){
  if(!B||!scene||typeof resolveParts!=='function'||typeof materialForGroup!=='function')throw new Error('Construction preview needs Babylon, a scene, parts and materials');
  const opacity=Number.isFinite(alpha)?Math.max(.1,Math.min(1,alpha)):.75;
  let currentType=null,visible=false,valid=true,disposed=false,parts=[],meshes=[],materials=[];
  function syncTextures(target,base){for(const property of TEXTURES)if(property in base&&property in target)target[property]=base[property];}
  function cloneMaterial(base,name,invalid){
   const material=base?.clone?.(name)||new B.StandardMaterial(name,scene);
   // Babylon's material.clone creates texture wrappers as well. Share the
   // renderer's existing textures explicitly and release only those wrappers,
   // so cancelling a preview neither leaks textures nor destroys shared art.
   const shared=new Set(base?.getActiveTextures?.()||[]),duplicates=new Set(material.getActiveTextures?.()||[]);
   if(base)syncTextures(material,base);
   for(const texture of duplicates)if(!shared.has(texture))texture.dispose();
   material.alpha=(Number.isFinite(base?.alpha)?base.alpha:1)*opacity;
   material.transparencyMode=B.Material.MATERIAL_ALPHABLEND;
   material.disableDepthWrite=true;material.zOffset=-1;
   if(invalid){
    if('diffuseColor' in material)material.diffuseColor=new B.Color3(1,.045,.025);
    if('albedoColor' in material)material.albedoColor=new B.Color3(1,.045,.025);
    material.emissiveColor=new B.Color3(.62,.012,.006);
    if('specularColor' in material)material.specularColor=B.Color3.Black();
    // Invalid placements stay readable even while overlapping the object
    // that blocks construction. Valid previews keep ordinary depth testing.
    material.depthFunction=B.Constants.ALWAYS;
   }
   materials.push(material);return material;
  }
  function release(){
   for(const mesh of meshes)mesh.dispose(false,false);
   for(const material of materials)material.dispose(false,false);
   meshes=[];materials=[];parts=[];visible=false;currentType=null;
  }
  function rebuild(type){
   release();currentType=type;
   for(const [partIndex,part] of (resolveParts(type)||[]).entries()){
    const model=typeof part.model==='string'?(models?.models?.[part.model]||models?.[part.model]):part.model;
    const groups=part.groups||model?.groups;if(!groups?.length)continue;
    const record={part,meshes:[]};
    for(const [groupIndex,group] of groups.entries()){
     if(group.isShadow||!group.positions?.length||!group.indices?.length)continue;
     const name='construction preview '+type+' '+partIndex+' '+groupIndex;
     const mesh=new B.Mesh(name,scene),data=new B.VertexData();
     data.positions=group.positions;data.indices=group.indices;
     data.uvs=group.uvs;data.colors=group.colors;
     data.normals=group.normals;
     if(!data.normals?.length){data.normals=new Float32Array(group.positions.length);B.VertexData.ComputeNormals(group.positions,model?.normalIndices||group.indices,data.normals);}
     data.applyToMesh(mesh,false);
     const base=(part.materialForGroup||materialForGroup)(group,part);
     const normal=cloneMaterial(base,name+' normal',false),red=cloneMaterial(base,name+' invalid',true);
     mesh.material=normal;mesh.useVertexColors=!!group.colors;mesh.hasVertexAlpha=false;
     mesh.isPickable=false;mesh.checkCollisions=false;mesh.receiveShadows=false;
     mesh.metadata={constructionPreview:true,type,partIndex,groupIndex,baseMaterial:base,normalMaterial:normal,invalidMaterial:red};
     mesh.setEnabled(false);record.meshes.push(mesh);meshes.push(mesh);
    }
    if(record.meshes.length)parts.push(record);
   }
  }
  function show(type,{x,z,r=0,y,valid:allowed=true}={}){
   if(disposed)return false;
   if(!type||![x,z,r].every(Number.isFinite)){hide();return false;}
   if(type!==currentType||!meshes.length)rebuild(type);
   const c=Math.cos(r),s=Math.sin(r);valid=allowed!==false;
   for(const record of parts){
    const part=record.part,lx=part.x||0,lz=part.z||0;
    const px=x+lx*c+lz*s,pz=z-lx*s+lz*c;
    const py=(Number.isFinite(y)?y:groundY(px,pz))+(part.y||0);
    for(const mesh of record.meshes){
     const meta=mesh.metadata;
     // If asynchronously loaded team art replaces a material's texture,
     // update the preview without cloning textures or rebuilding geometry.
     if(meta.baseMaterial){syncTextures(meta.normalMaterial,meta.baseMaterial);syncTextures(meta.invalidMaterial,meta.baseMaterial);}
     mesh.position.set(px,py,pz);mesh.rotation.set(0,r+(part.r||0),0);
     mesh.material=valid?meta.normalMaterial:meta.invalidMaterial;
     mesh.setEnabled(true);
    }
   }
   visible=meshes.length>0;return visible;
  }
  function hide(){for(const mesh of meshes)mesh.setEnabled(false);visible=false;}
  function dispose(){if(disposed)return;release();disposed=true;}
  return {show,hide,dispose,get meshes(){return meshes;},get visible(){return visible;},get type(){return currentType;},get valid(){return valid;}};
 }
 return {create};
});
