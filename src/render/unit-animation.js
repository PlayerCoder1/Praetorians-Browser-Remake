/* Shared HD vertex-animation poses. A native 40 ms frame is decoded once by
   unit-models and its normals are built once here, regardless of how many
   formations or falling soldiers use it. Each result is immutable shared data:
   upload it to a model/clip/frame batch, then instance fighters with matrices. */
(function(root,factory){
 const models=typeof module==='object'&&module.exports?require('../units/unit-models.js'):root.PraetoriansUnitModels;
 const api=factory(models);if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansUnitAnimation=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(Models){
 'use strict';
 // Same left-handed, equal-face-weight normals as Babylon ComputeNormals.
 // Called only for a cache miss; never for an individual soldier.
 function normalsFor(positions,indices){
  const normals=new Float32Array(positions.length);
  for(let i=0;i<indices.length;i+=3){
   const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
   const ux=positions[a]-positions[b],uy=positions[a+1]-positions[b+1],uz=positions[a+2]-positions[b+2];
   const vx=positions[c]-positions[b],vy=positions[c+1]-positions[b+1],vz=positions[c+2]-positions[b+2];
   let x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;
   const length=Math.hypot(x,y,z)||1;x/=length;y/=length;z/=length;
   for(const index of [a,b,c]){normals[index]+=x;normals[index+1]+=y;normals[index+2]+=z;}
  }
  for(let i=0;i<normals.length;i+=3){const length=Math.hypot(normals[i],normals[i+1],normals[i+2])||1;normals[i]/=length;normals[i+1]/=length;normals[i+2]/=length;}
  return normals;
 }
 function createPoseCache({maxBytes=64*1024*1024}={}){
  if(!(maxBytes>0))throw new Error('Pose cache needs a positive memory budget');
  let identities=new WeakMap(),identity=0;
  const poses=new Map(),stats={hits:0,misses:0,normalBuilds:0,evictions:0,entries:0,bytes:0};
  function modelId(model){let id=identities.get(model);if(id===undefined){id=++identity;identities.set(model,id);}return id;}
  function get(model,clipName,timeMs,options={}){
   const animation=model.animations[clipName];
   if(!animation)throw new Error(`Missing HD animation ${model.kind||model.name}: ${clipName}`);
   const timing=Models.frameAt(animation,timeMs,options),groupIndex=options.groupIndex||0;
   const group=model.groups[groupIndex];if(!group)throw new Error(`Missing unit mesh group ${groupIndex}`);
   const key=modelId(model)+'|'+groupIndex+'|'+clipName+'|'+timing.index;
   let pose=poses.get(key);
   if(pose){stats.hits++;poses.delete(key);poses.set(key,pose);}
   else{
    stats.misses++;stats.normalBuilds++;
    // Sections sharing the vertices (rider and mount) light from all of them.
    const positions=animation.frames[timing.index].positions,normals=normalsFor(positions,model.normalIndices||group.indices);
    pose={key,frameIndex:timing.index,clip:clipName,positions,normals,duration:timing.duration};
    // Include referenced positions in the budget so the working-set estimate
    // stays conservative even if the model decoder changes ownership later.
    const bytes=positions.byteLength+normals.byteLength;
    while(poses.size&&stats.bytes+bytes>maxBytes){const oldest=poses.keys().next().value,removed=poses.get(oldest);poses.delete(oldest);stats.bytes-=removed.positions.byteLength+removed.normals.byteLength;stats.evictions++;}
    if(bytes<=maxBytes){poses.set(key,pose);stats.bytes+=bytes;}
    stats.entries=poses.size;
   }
   return pose;
  }
  function prepare(model,clipNames=Object.keys(model.animations)){
   for(const name of clipNames){const animation=model.animations[name];for(const frame of animation.frames)get(model,name,frame.time,{loop:false});}
   return stats;
  }
  // Two immutable native poses feed the GPU interpolation stream. This never
  // allocates blended vertices or recalculates normals for individual men.
  function segment(model,clipName,timeMs,options={}){
   const clip=model.animations[clipName],timing=Models.frameAt(clip,timeMs,options);
   const from=get(model,clipName,clip.frames[timing.index].time,{...options,loop:false});
   const mix=timing.index===timing.next?0:timing.mix;
   const to=timing.next!==timing.index?get(model,clipName,clip.frames[timing.next].time,{...options,loop:false}):from;
   return {from,to,mix};
  }
  function clear(){poses.clear();identities=new WeakMap();stats.entries=0;stats.bytes=0;}
  return {get,segment,prepare,clear,stats,maxBytes};
 }
 // Attacks and shots use their own clock, reset at the start of each action.
 // Normalize to the complete native clip if combat uses a different duration.
 // Walking/resting may use wall-clock offsets so ranks are not all in step.
 function actionTime(member,elapsedMs,clipDurationMs){
  if(['attack','shoot','load','aim','throw'].includes(member.action)){
   if(member.action==='attack'&&Number.isFinite(member.attackTime))return Math.max(0,Math.min(1,member.attackTime))*clipDurationMs;
   const time=Math.max(0,Number.isFinite(member.actionTime)?member.actionTime:0)*1000;
   return member.actionDuration>0?Math.min(clipDurationMs,time/(member.actionDuration*1000)*clipDurationMs):time;
  }
  return Math.max(0,elapsedMs+(member.animationOffset||0));
 }
 return {createPoseCache,frameAt:Models.frameAt,actionTime,normalsFor};
});
