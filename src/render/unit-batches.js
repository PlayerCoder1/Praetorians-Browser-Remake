/* Shared HD pose batches: draw cost follows model/action/phase, not squad count.
   Native poses/normals are cached once. Dead bodies and depth silhouettes are
   bounded; moving troops use cheap contact shadows rather than re-rendering the
   entire forest shadow map at every swing. */
(function(root,factory){
 const animation=typeof module==='object'&&module.exports?require('./unit-animation.js'):root.PraetoriansUnitAnimation;
 const api=factory(animation);if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansUnitBatches=api;
})(typeof window!=='undefined'?window:globalThis,function(Animation){
 'use strict';
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 function formationClip(squad,member,field){
  const render=squad.formationState?.render||squad.specialFormation?.render;
  if(!render)return null;
  const role=member.formationRole||'center',value=render.roles?.[role]?.[field]??render[field];
  return typeof value==='string'?value:value?.[role]||value?.default||null;
 }
 function action(model,squad,member,elapsed,index){
  const clips=model.animations,moving=squad.isMoving?member.stepping:member.combatMoving;
  let clip,clock,slot,loop=true;
  const combatAction=['attack','shoot','load','aim','throw'].includes(member.action);
  const override=combatAction&&formationClip(squad,member,member.action);
  const transition=squad.formationState?.transition;
  const enter=transition&&(transition.roles?.[member.formationRole||'center']||transition.clip);
  if(combatAction&&clips[override||member.action]){
   clip=override||((member.action==='attack'&&member.attackVariant===2&&clips.attack2)?'attack2':member.action);
   if(clip==='attack2'&&((clips.attack2.source!==undefined&&clips.attack2.source===clips.attack.source)||
     (clips.attack2.offset!==undefined&&clips.attack2.offset===clips.attack.offset)))clip='attack';
   const a=clips[clip],phase=member.action==='attack'&&Number.isFinite(member.attackTime)?member.attackTime:
    (member.actionTime||0)/Math.max(.001,member.actionDuration||a.duration/1000);
   const timing=Animation.frameAt(a,clip==='aim'||member.action==='aim'?0:clamp(phase,0,1)*a.duration,{loop:false});
   // The batch still identifies a native frame. Its fractional time is now
   // retained for interpolation in the vertex shader rather than discarded.
   slot=timing.index;clock=timing.time;loop=false;
  }else if(enter&&clips[enter]&&!moving&&(transition.elapsedMs||0)<clips[enter].duration){
   clip=enter;const timing=Animation.frameAt(clips[clip],transition.elapsedMs||0,{loop:false});
   slot='enter'+timing.index;clock=timing.time;loop=false;
  }else if(member.pose&&clips[member.pose]&&!moving){
   clip=member.pose;const a=clips[clip];
   if(a.loop===false){
    const timing=Animation.frameAt(a,member.poseTime||0,{loop:false});
    slot='pose'+timing.index;clock=timing.time;loop=false;
   }else{slot=((squad.index||0)*7+(member.combatId??index))%2;clock=elapsed+slot*a.duration/2;}
  }else{
   const running=(squad.isMoving?squad.running:member.charging)&&squad.formationState?.canRun!==false;
   const field=moving?(running&&clips.run?'run':'walk'):'idle';
   clip=formationClip(squad,member,field)||(moving?field:squad.combat?.mode==='melee'&&clips.ready?'ready':'rest');
   if(!clips[clip])clip=moving&&clips.walk?'walk':'rest';
   const phases=moving?3:2;
   slot=((squad.index||0)*7+(member.combatId??index))%phases;
   clock=elapsed+slot*clips[clip].duration/phases;
  }
  return {clip,slot,clock,loop};
 }
 function writeMatrix(buffer,index,o){
  const at=index*16,s=o.scale||1,c=Math.cos(o.r||0)*s,n=Math.sin(o.r||0)*s;
  buffer[at]=c;buffer[at+1]=0;buffer[at+2]=-n;buffer[at+3]=0;
  buffer[at+4]=0;buffer[at+5]=s;buffer[at+6]=0;buffer[at+7]=0;
  buffer[at+8]=n;buffer[at+9]=0;buffer[at+10]=c;buffer[at+11]=0;
  buffer[at+12]=o.x;buffer[at+13]=o.y||0;buffer[at+14]=o.z;buffer[at+15]=1;
 }
 function posePlugin(B){
  return class extends B.MaterialPluginBase{
   constructor(material){super(material,'PraetoriansUnitPose',180,{PRAETORIANS_UNIT_POSE:false});this.doNotSerialize=true;this._enable(true);}
   getClassName(){return 'PraetoriansUnitPose';}
   prepareDefines(defines,scene,mesh){defines.PRAETORIANS_UNIT_POSE=!!mesh?.isVerticesDataPresent('unitPositionNext');}
   getAttributes(attributes){attributes.push('unitPositionNext','unitNormalNext');}
   getUniforms(){return {ubo:[{name:'unitPoseMix',size:1,type:'float'}],vertex:'#ifdef PRAETORIANS_UNIT_POSE\nuniform float unitPoseMix;\n#endif\n'};}
   bindForSubMesh(ubo,scene,engine,subMesh){ubo.updateFloat('unitPoseMix',subMesh.getMesh().metadata?.unitPoseMix||0);}
   getCustomCode(type){return type==='vertex'?{
    CUSTOM_VERTEX_DEFINITIONS:'#ifdef PRAETORIANS_UNIT_POSE\nattribute vec3 unitPositionNext;\nattribute vec3 unitNormalNext;\n#endif',
    CUSTOM_VERTEX_UPDATE_POSITION:'#ifdef PRAETORIANS_UNIT_POSE\npositionUpdated=mix(positionUpdated,unitPositionNext,unitPoseMix);\n#endif',
    CUSTOM_VERTEX_UPDATE_NORMAL:'#if defined(PRAETORIANS_UNIT_POSE) && defined(NORMAL)\nvec3 unitBlendedNormal=mix(normalUpdated,unitNormalNext,unitPoseMix);\nnormalUpdated=unitBlendedNormal*inversesqrt(max(dot(unitBlendedNormal,unitBlendedNormal),0.00000001));\n#endif'
   }:null;}
  };
 }
 function create({B,scene,camera,materialForGroup,maxCorpses=256,maxTransitionBatches=48,getSelected=()=>[],silhouettes=()=>true,shadows=()=>true}){
  const cache=Animation.createPoseCache({maxBytes:64*1024*1024}),batches=new Map(),kinds=new Map(),bodies=[],previous=new WeakMap();
  const gpuInterpolation=!!B.MaterialPluginBase&&(scene?.getEngine?.().getCaps?.().maxVertexAttribs??16)>=9;
  const PosePlugin=gpuInterpolation?posePlugin(B):null,plugins=new WeakMap(),visualActions=new WeakMap();
  const transitionPool=[];
  const stats={activeBatches:0,totalBatches:0,transitionBatches:0,gpuInterpolation,visibleSoldiers:0,fallingSoldiers:0,corpses:0,drawCalls:0,uploadedBytes:0,updateMs:0,cache:cache.stats};
  function smoothMaterial(material){if(gpuInterpolation&&!plugins.has(material)){plugins.set(material,new PosePlugin(material));}return material;}
  const gold=new B.StandardMaterial('selected troops obscured by landscape',scene);
  gold.disableLighting=true;gold.emissiveColor=new B.Color3(.85,.72,.3);gold.diffuseColor=B.Color3.Black();gold.specularColor=B.Color3.Black();
   gold.alpha=.22;gold.disableDepthWrite=true;gold.depthFunction=B.Constants.GREATER;smoothMaterial(gold);
  function register(squad){
   let info=kinds.get(squad.kind);
   // Prepare only poses that actually reach the camera. Warming every clip
   // here stalls a new recruitment and evicts visible poses on varied maps.
   if(!info){info={model:squad.model,meshes:[]};kinds.set(squad.kind,info);}
   squad.meshes=info.meshes;
  }
  function capture(squads){
   // Capture the immediate previous fixed step, even during catch-up. Weak
   // keys release killed members; interpolation never changes simulation.
   for(const squad of squads)for(const item of [squad,...squad.members]){
    let state=previous.get(item);
    if(!state){state={render:Object.create(item)};previous.set(item,state);}
    state.x=item.x;state.y=item.y||0;state.z=item.z;state.r=item.r||0;
    state.action=item.action;state.variant=item.attackVariant;
    state.attackTime=item.attackTime;state.actionTime=item.actionTime;
    state.pose=item.pose;state.poseTime=item.poseTime;
    state.formationTransition=item.formationState?.transition;
    state.formationElapsed=state.formationTransition?.elapsedMs;
   }
  }
  function interpolate(item,alpha=1){
   const state=previous.get(item);if(!state||alpha>=1)return item;
   alpha=clamp(alpha,0,1);const view=state.render;
   view.x=state.x+(item.x-state.x)*alpha;view.y=state.y+((item.y||0)-state.y)*alpha;view.z=state.z+(item.z-state.z)*alpha;
   const delta=(item.r||0)-state.r;view.r=state.r+Math.atan2(Math.sin(delta),Math.cos(delta))*alpha;
   const same=state.action===item.action&&state.variant===item.attackVariant;
   view.attackTime=same&&item.attackTime>=state.attackTime?state.attackTime+(item.attackTime-state.attackTime)*alpha:item.attackTime;
   view.actionTime=same&&item.actionTime>=state.actionTime?state.actionTime+(item.actionTime-state.actionTime)*alpha:item.actionTime;
   view.poseTime=state.pose===item.pose&&item.poseTime>=state.poseTime?state.poseTime+(item.poseTime-state.poseTime)*alpha:item.poseTime;
   const transition=item.formationState?.transition;
   if(transition&&transition===state.formationTransition&&transition.elapsedMs>=state.formationElapsed){
    const formation=state.formationView||(state.formationView={}),clock=state.transitionView||(state.transitionView={});
    Object.assign(formation,item.formationState);Object.assign(clock,transition);
    clock.elapsedMs=state.formationElapsed+(transition.elapsedMs-state.formationElapsed)*alpha;
    formation.transition=clock;view.formationState=formation;
   }else if(item.formationState||Object.hasOwn(view,'formationState'))view.formationState=item.formationState;
   return view;
  }
  function grow(batch,n){
   if(n<=batch.capacity)return;
   batch.capacity=Math.max(64,batch.capacity*2,n);
   const matrices=new Float32Array(batch.capacity*16);matrices.set(batch.matrices);batch.matrices=matrices;
   const ghosts=new Float32Array(batch.capacity*16);ghosts.set(batch.ghostMatrices);batch.ghostMatrices=ghosts;
   batch.rebind=true;
  }
  // colour: the troop's player colour (squad.colour, 1-7; 0 or none draws the
  // texture as it is). Each colour of a model batches apart, with its own
  // dyed texture (materialForGroup(group, colour)).
  const batchKey=(kind,clip,slot,colour)=>kind+'|'+clip+'|'+slot+(colour?'|c'+colour:'');
  function makeBatch(kind,clip,slot,pose,ghost=false,colour=0,keyOverride=null){
   const model=kinds.get(kind).model,key=keyOverride||batchKey(kind,clip,slot,colour);
   const batch={key,kind,clip,slot,colour,parts:[],count:0,ghostCount:0,capacity:0,matrices:new Float32Array(0),ghostMatrices:new Float32Array(0),pose:null,rebind:false};
   for(const group of model.groups){
    const mesh=new B.Mesh('HD batch '+key,scene),vd=new B.VertexData();
    vd.positions=pose.positions;vd.normals=pose.normals;vd.uvs=group.uvs;vd.indices=group.indices;vd.applyToMesh(mesh,true);
    mesh.material=smoothMaterial(materialForGroup(group,colour));mesh.isPickable=false;mesh.renderingGroupId=2;mesh.alwaysSelectAsActiveMesh=true;mesh.doNotSyncBoundingInfo=true;mesh.setEnabled(false);
    const twin=new B.Mesh('selected outline '+key,scene);mesh.geometry.applyToMesh(twin);twin.makeGeometryUnique();
    twin.material=gold;twin.isPickable=false;twin.renderingGroupId=1;twin.alwaysSelectAsActiveMesh=true;twin.doNotSyncBoundingInfo=true;twin.setEnabled(false);
    mesh.metadata={batch:key,pose:clip,silhouette:twin,unitPoseMix:0};twin.metadata={unitPoseMix:0};
    if(gpuInterpolation)for(const part of [mesh,twin]){
     part.setVerticesData('unitPositionNext',pose.positions,true,3);
     part.setVerticesData('unitNormalNext',pose.normals,true,3);
    }
    batch.parts.push({mesh,twin});kinds.get(kind).meshes.push(mesh);
   }
   batches.set(key,batch);grow(batch,64);stats.totalBatches=batches.size;
   return batch;
  }
  const transitionAssignments=new Map();
  function transitionalBatch(squad,state,colour){
   const old=state.blend,model=squad.model,from=cache.get(model,old.clip,old.clock,{loop:old.loop});
   const signature=squad.kind+'|'+colour+'|'+from.key+'|'+state.clip+'|'+state.slot+'|'+Math.floor(state.mix*4);
   if(transitionAssignments.has(signature))return transitionAssignments.get(signature);
   let batch=transitionPool.find(item=>item.kind===squad.kind&&item.colour===colour&&item.count===0);
   if(!batch){
    let index=transitionPool.length;
    if(index>=maxTransitionBatches){
     index=transitionPool.findIndex(item=>item.count===0);
     if(index<0)return null; // Steady native smoothing remains available.
     const retired=transitionPool[index],meshes=kinds.get(retired.kind).meshes;
     for(const part of retired.parts){const at=meshes.indexOf(part.mesh);if(at>=0)meshes.splice(at,1);part.mesh.dispose(false,false);part.twin.dispose(false,false);}
     batches.delete(retired.key);
    }
    const pose=cache.get(model,state.clip,state.clock,{loop:state.loop});
    batch=makeBatch(squad.kind,state.clip,'transition'+index,pose,false,colour,squad.kind+'|transition'+index+'|c'+colour);
    batch.transient=true;transitionPool[index]=batch;stats.transitionBatches=transitionPool.length;
   }
   transitionAssignments.set(signature,batch);return batch;
  }
  function polishedAction(squad,member,identity,elapsed,index){
   const state=action(squad.model,squad,member,elapsed,index);
   if(!gpuInterpolation)return state;
   let track=visualActions.get(identity);
   const restarted=track&&state.loop===false&&track.last.loop===false&&state.clock+40<track.last.clock;
   if(track&&elapsed>=track.seen&&elapsed-track.seen<500&&(track.last.clip!==state.clip||restarted)){
    track.from={...track.last,blend:null};track.since=elapsed;
    track.duration=['attack','attack2','shoot','load','aim','throw'].includes(state.clip)?60:110;
   }
   if(!track){track={};visualActions.set(identity,track);}
   if(track.from&&elapsed>=track.since&&elapsed-track.since<track.duration){
    state.blend=track.from;state.mix=clamp((elapsed-track.since)/track.duration,0,1);
   }else track.from=null;
   track.last={clip:state.clip,slot:state.slot,clock:state.clock,loop:state.loop};track.seen=elapsed;
   return state;
  }
  function queue(squad,record,state,isSelected){
   const colour=squad.colour||0,key=batchKey(squad.kind,state.clip,state.slot,colour);
   let batch=state.blend?transitionalBatch(squad,state,colour):null;
   if(!batch){state.blend=null;batch=batches.get(key);}
   if(!batch){const pose=cache.get(squad.model,state.clip,state.clock,{loop:state.loop});batch=makeBatch(squad.kind,state.clip,state.slot,pose,false,colour);}
   if(batch.count===0){batch.state=state;if(batch.transient){batch.clip=state.clip;for(const part of batch.parts)part.mesh.metadata.pose=state.clip;}}
   grow(batch,batch.count+1);writeMatrix(batch.matrices,batch.count++,record);
   if(isSelected)writeMatrix(batch.ghostMatrices,batch.ghostCount++,record);
  }
  const blobTex=new B.DynamicTexture('soft troop contact shadow',{width:32,height:32},scene,false);
  const context=blobTex.getContext(),gradient=context.createRadialGradient(16,16,1,16,16,16);
  gradient.addColorStop(0,'rgba(24,20,9,0.35)');gradient.addColorStop(.45,'rgba(24,20,9,0.23)');gradient.addColorStop(1,'rgba(24,20,9,0)');
  context.fillStyle=gradient;context.fillRect(0,0,32,32);blobTex.update();blobTex.hasAlpha=true;
  const blobMaterial=new B.StandardMaterial('troop contact shadows',scene);blobMaterial.disableLighting=true;blobMaterial.emissiveColor=B.Color3.White();
  blobMaterial.diffuseTexture=blobTex;blobMaterial.useAlphaFromDiffuseTexture=true;blobMaterial.transparencyMode=B.Material.MATERIAL_ALPHABLEND;blobMaterial.backFaceCulling=false;blobMaterial.disableDepthWrite=true;
  const blob=new B.Mesh('batched troop contact shadows',scene),blobData=new B.VertexData();
  blobData.positions=[-.24,.018,-.18,.24,.018,-.18,.24,.018,.18,-.24,.018,.18];blobData.indices=[0,2,1,0,3,2];blobData.uvs=[0,0,1,0,1,1,0,1];blobData.normals=[0,1,0,0,1,0,0,1,0,0,1,0];blobData.applyToMesh(blob);
  blob.material=blobMaterial;blob.isPickable=false;blob.alwaysSelectAsActiveMesh=true;blob.doNotSyncBoundingInfo=true;blob.renderingGroupId=0;
  let blobMatrices=new Float32Array(1024*16),blobCapacity=1024,blobRebind=true;
  function visible(record){
   const dx=record.x-camera.target.x,dz=record.z-camera.target.z,c=Math.cos(camera.alpha),s=Math.sin(camera.alpha),b=Math.cos(camera.beta);
   return Math.abs(-s*dx+c*dz)<camera.orthoRight+2&&Math.abs(-c*b*dx-s*b*dz+Math.sin(camera.beta)*((record.y||0)-camera.target.y))<camera.orthoTop+4;
  }
  function update(squads,elapsed,dtMs,alpha=1){
   const started=performance.now();stats.activeBatches=stats.visibleSoldiers=stats.fallingSoldiers=stats.drawCalls=stats.uploadedBytes=0;
   for(const batch of batches.values()){batch.count=0;batch.ghostCount=0;}
   transitionAssignments.clear();
   const selection=new Set(getSelected());let blobCount=0;
   for(const squad of squads){
    const visualSquad=interpolate(squad,alpha);
    const canSee=!squad.hidden&&(squad.side!=='enemy'||squad.visible);
    if(canSee)for(let i=0;i<squad.members.length;i++){
     const actor=squad.members[i],member=interpolate(actor,alpha);if(!visible(member))continue;
     queue(squad,member,polishedAction(visualSquad,member,actor,elapsed,i),silhouettes()&&selection.has(squad));stats.visibleSoldiers++;
     // Fliers (the scout's hawk) cast no contact blob: it would hang in the air.
     if(shadows()&&!squad.noShadow){
      if(blobCount>=blobCapacity){blobCapacity*=2;const next=new Float32Array(blobCapacity*16);next.set(blobMatrices);blobMatrices=next;blobRebind=true;}
      writeMatrix(blobMatrices,blobCount++,member);
     }
    }
    for(let i=squad.dying.length-1;i>=0;i--){
     const entry=squad.dying[i],clip=entry.clip||(entry.clip=squad.model.deaths[entry.variant%squad.model.deaths.length]);
     const animation=squad.model.animations[clip];entry.time+=dtMs;
     if(entry.renderStart===undefined)entry.renderStart=elapsed-entry.time;
     if(entry.wasVisible===undefined)entry.wasVisible=canSee;
     if(entry.time>=animation.duration){
      bodies.push({squad,entry});squad.dying.splice(i,1);if(bodies.length>maxCorpses)bodies.shift();continue;
     }
     if(!entry.wasVisible||!visible(entry))continue;
     const clock=Math.max(0,elapsed-entry.renderStart),slot=Animation.frameAt(animation,clock,{loop:false}).index;
     queue(squad,entry,{clip,slot:'death'+slot,clock,loop:false},false);stats.fallingSoldiers++;
    }
   }
   for(const body of bodies){
    if(!body.entry.wasVisible||!visible(body.entry))continue;
    queue(body.squad,body.entry,{clip:body.entry.clip,slot:'corpse',clock:body.squad.model.animations[body.entry.clip].duration,loop:false},false);
   }
   for(const batch of batches.values()){
    if(batch.count){
     const model=kinds.get(batch.kind).model,state=batch.state;
     const segment=gpuInterpolation?(state.blend?{
      from:cache.get(model,state.blend.clip,state.blend.clock,{loop:state.blend.loop}),
      to:cache.get(model,state.clip,state.clock,{loop:state.loop}),mix:state.mix
     }:cache.segment(model,state.clip,state.clock,{loop:state.loop})):null;
     const pose=segment?.from||cache.get(model,state.clip,state.clock,{loop:state.loop}),next=segment?.to||pose;
     for(const {mesh,twin} of batch.parts){
      if(batch.pose!==pose.key){mesh.updateVerticesData(B.VertexBuffer.PositionKind,pose.positions);mesh.updateVerticesData(B.VertexBuffer.NormalKind,pose.normals);stats.uploadedBytes+=pose.positions.byteLength+pose.normals.byteLength;}
      if(batch.ghostCount&&batch.ghostPose!==pose.key){twin.updateVerticesData(B.VertexBuffer.PositionKind,pose.positions);twin.updateVerticesData(B.VertexBuffer.NormalKind,pose.normals);}
      if(gpuInterpolation){
       if(batch.nextPose!==next.key){mesh.updateVerticesData('unitPositionNext',next.positions);mesh.updateVerticesData('unitNormalNext',next.normals);stats.uploadedBytes+=next.positions.byteLength+next.normals.byteLength;}
       if(batch.ghostCount&&batch.ghostNextPose!==next.key){twin.updateVerticesData('unitPositionNext',next.positions);twin.updateVerticesData('unitNormalNext',next.normals);}
       mesh.metadata.unitPoseMix=segment.mix;twin.metadata.unitPoseMix=segment.mix;
      }
     }
     if(batch.ghostCount){batch.ghostPose=pose.key;batch.ghostNextPose=next.key;}
     batch.pose=pose.key;batch.nextPose=next.key;stats.activeBatches++;
    }
    for(const {mesh,twin} of batch.parts){
     if(batch.rebind){mesh.thinInstanceSetBuffer('matrix',batch.matrices,16,false);twin.thinInstanceSetBuffer('matrix',batch.ghostMatrices,16,false);}
     mesh.thinInstanceCount=batch.count;mesh.setEnabled(batch.count>0);
     twin.thinInstanceCount=batch.ghostCount;twin.setEnabled(batch.ghostCount>0);
     // visible() already culls each soldier, and these non-pickable meshes
     // bypass Babylon's frustum checks. Rebuilding instance bounds here would
     // transform eight corners per soldier again on every rendered frame.
     if(batch.count){mesh.thinInstanceBufferUpdated('matrix');stats.uploadedBytes+=batch.count*64;stats.drawCalls++;}
     if(batch.ghostCount){twin.thinInstanceBufferUpdated('matrix');stats.uploadedBytes+=batch.ghostCount*64;stats.drawCalls++;}
    }
    batch.rebind=false;
   }
   if(blobRebind){blob.thinInstanceSetBuffer('matrix',blobMatrices,16,false);blobRebind=false;}
   blob.thinInstanceCount=blobCount;blob.setEnabled(blobCount>0);if(blobCount){blob.thinInstanceBufferUpdated('matrix');stats.drawCalls++;}
   stats.corpses=bodies.length;stats.updateMs=performance.now()-started;
  }
  return {register,capture,interpolate,update,stats,cache,batches,action,writeMatrix,get meshes(){return [...batches.values()].flatMap(b=>b.parts.map(p=>p.mesh));}};
 }
 return {create,action,writeMatrix,formationClip,posePlugin};
});
