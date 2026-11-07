/* Small, portable animation recipes built from the existing HD morph poses.
   These are workshop clips, not skeleton edits or battle-animation overrides.
   Compile only after an edit; playback interpolates two cached vertex poses. */
(function(root,factory){
 const models=typeof module==='object'&&module.exports?require('../units/unit-models.js'):root.PraetoriansUnitModels;
 const rigs=typeof module==='object'&&module.exports?require('./character-rig.js'):root.PraetoriansCharacterRig;
 const api=factory(models,rigs);if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansCustomAnimation=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(Models,Rigs){
 'use strict';
 const FORMAT='praetorians-custom-animation-v1';
 const LIMITS=Object.freeze({minDurationMs:100,maxDurationMs:30000,maxKeyframes:128,maxJsonBytes:1024*1024,maxPosition:10,maxRotation:Math.PI*4,minScale:.1,maxScale:3});
 const ZERO_ROTATION=Object.freeze([0,0,0]);
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
 const fail=message=>{throw new Error('Custom animation: '+message);};
 function number(value,min,max,label){
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(label+' must be between '+min+' and '+max);
  return value;
 }
 function label(value,max,name){
  if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\x00-\x1f\x7f]/.test(value))fail(name+' is invalid');
  return value.trim();
 }
 function vector(value,fallback,min,max,name){
  if(value===undefined)return fallback.slice();
  if(!Array.isArray(value)||value.length!==3)fail(name+' needs three numbers');
  return Array.from(value,(v,i)=>number(v,min,max,name+'['+i+']'));
 }
 function getAnimation(model,name){
  if(!model?.animations||!own(model.animations,name)||!model.animations[name]?.frames?.length)fail('missing HD source clip '+name);
  return model.animations[name];
 }
 function sourceDuration(animation){
  return animation.duration>0?animation.duration:animation.frames.length*(animation.frameMs||40);
 }
 function validate(input,model){
  if(!input||typeof input!=='object'||Array.isArray(input)||input.format!==FORMAT)fail('unsupported file format');
  const modelKind=label(input.model,100,'model');
  if(!/^[a-zA-Z0-9_-]+$/.test(modelKind))fail('model is invalid');
  if(model&&model.kind!==modelKind)fail('this clip belongs to '+modelKind+', not '+model.kind);
  const name=label(input.name,64,'name');
  const durationMs=number(input.durationMs,LIMITS.minDurationMs,LIMITS.maxDurationMs,'duration');
  const meshVertices=model?(model.groups?.[0]?.positions?.length||Object.values(model.animations||{})[0]?.frames?.[0]?.positions?.length||0)/3:undefined;
  const rig=input.rig===undefined?null:Rigs.validate(input.rig,meshVertices),jointIds=rig?new Set(rig.joints.map(j=>j.id)):null;
  if(input.loop!==undefined&&typeof input.loop!=='boolean')fail('loop must be true or false');
  if(!Array.isArray(input.keyframes)||input.keyframes.length<2||input.keyframes.length>LIMITS.maxKeyframes)fail('use 2–'+LIMITS.maxKeyframes+' keyframes');
  const keyframes=Array.from(input.keyframes,(key,index)=>{
   if(!key||typeof key!=='object'||Array.isArray(key))fail('keyframe '+(index+1)+' is invalid');
   const clip=label(key.clip,100,'source clip');
   const animation=model?getAnimation(model,clip):null;
   const sourceTimeMs=number(key.sourceTimeMs,0,animation?sourceDuration(animation):LIMITS.maxDurationMs,'source time');
   const normalized={timeMs:number(key.timeMs,0,durationMs,'keyframe time'),clip,sourceTimeMs,
    position:vector(key.position,[0,0,0],-LIMITS.maxPosition,LIMITS.maxPosition,'position'),
    rotation:vector(key.rotation,[0,0,0],-LIMITS.maxRotation,LIMITS.maxRotation,'rotation'),
    scale:vector(key.scale,[1,1,1],LIMITS.minScale,LIMITS.maxScale,'scale')};
   if(key.joints!==undefined&&(!key.joints||typeof key.joints!=='object'||Array.isArray(key.joints)))fail('joint rotations must be an object');
   const entries=Object.entries(key.joints||{});
   if(entries.length&&!rig)fail('joint rotations need a character rig');
   if(rig){
    normalized.joints={};
    for(const [id,value] of entries){if(!jointIds.has(id))fail('unknown joint '+id);normalized.joints[id]=vector(value,[0,0,0],-Rigs.LIMITS.maxRotation,Rigs.LIMITS.maxRotation,'joint '+id);}
   }
   return normalized;
  }).sort((a,b)=>a.timeMs-b.timeMs);
  if(keyframes[0].timeMs!==0||keyframes.at(-1).timeMs!==durationMs)fail('include a keyframe at the start and end of the clip');
  for(let i=1;i<keyframes.length;i++)if(keyframes[i].timeMs===keyframes[i-1].timeMs)fail('keyframe times must be unique');
  const result={format:FORMAT,model:modelKind,name,durationMs,loop:input.loop??false,keyframes};
  if(rig)result.rig=rig;return result;
 }
 function create(model,sourceClip,options={}){
  const animation=getAnimation(model,sourceClip),nativeDuration=sourceDuration(animation);
  const durationMs=options.durationMs??Math.max(LIMITS.minDurationMs,Math.min(LIMITS.maxDurationMs,nativeDuration));
  const loop=options.loop??animation.loop??false;
  // Native frames plus the last interval preserve the complete source action.
  // Longer sources are uniformly resampled to keep imported recipes bounded.
  const count=Math.min(LIMITS.maxKeyframes,Math.max(2,animation.frames.length+1));
  const keyframes=Array.from({length:count},(_,i)=>{
   const t=i/(count-1);
   return {timeMs:durationMs*t,clip:sourceClip,sourceTimeMs:loop&&i===count-1?0:Math.min(nativeDuration*t,animation.frames.at(-1).time),position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
  });
  return validate({format:FORMAT,model:model.kind,name:options.name??'New '+sourceClip,durationMs,loop,keyframes},model);
 }
 function compile(input,model){
  const clip=validate(input,model),keys=[];let length=0;
  for(const key of clip.keyframes){
   const positions=Models.sample(getAnimation(model,key.clip),key.sourceTimeMs,undefined,{loop:false});
   if(!positions.length||positions.length%3||length&&positions.length!==length)fail('HD source poses do not share their vertices');
   for(let i=0;i<positions.length;i++)if(!Number.isFinite(positions[i]))fail('HD source pose has invalid vertices');
   length=positions.length;keys.push({...key,positions});
  }
  return {clip,keys,vertexCount:length/3,rig:clip.rig?Rigs.compile(clip.rig):null,jointIds:clip.rig?new Set(clip.rig.joints.map(j=>j.id)):null};
 }
 function sample(compiled,timeMs,out){
  const {clip,keys,vertexCount}=compiled;
  const input=Number.isFinite(timeMs)?timeMs:0;
  const time=clip.loop?((input%clip.durationMs)+clip.durationMs)%clip.durationMs:Math.max(0,Math.min(clip.durationMs,input));
  let lo=0,hi=keys.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(keys[mid].timeMs<=time)lo=mid;else hi=mid;}
  const a=keys[lo],b=keys[hi],mix=Math.max(0,Math.min(1,(time-a.timeMs)/(b.timeMs-a.timeMs)));
  out=out||{};
  if(!(out.positions instanceof Float32Array)||out.positions.length!==vertexCount*3)out.positions=new Float32Array(vertexCount*3);
  for(let i=0;i<out.positions.length;i++)out.positions[i]=a.positions[i]+(b.positions[i]-a.positions[i])*mix;
  for(const channel of ['position','rotation','scale']){
   if(!out[channel]||out[channel].length!==3)out[channel]=[0,0,0];
   for(let i=0;i<3;i++)out[channel][i]=a[channel][i]+(b[channel][i]-a[channel][i])*mix;
  }
  if(compiled.rig){
   out.joints=out.joints||{};
   for(const id of Object.keys(out.joints))if(!compiled.jointIds.has(id))delete out.joints[id];
   for(const joint of compiled.rig.rig.joints){
    const id=joint.id,aa=a.joints?.[id]||ZERO_ROTATION,bb=b.joints?.[id]||ZERO_ROTATION;
    const rotation=out.joints[id]||(out.joints[id]=[0,0,0]);
    for(let i=0;i<3;i++)rotation[i]=aa[i]+(bb[i]-aa[i])*mix;
   }
   Rigs.deform(compiled.rig,out.positions,out.joints,out.positions);
  }else delete out.joints;
  out.timeMs=time;out.finished=!clip.loop&&input>=clip.durationMs;
  return out;
 }
 function stringify(input){return JSON.stringify(validate(input),null,2);}
 function parse(json,model){
  if(typeof json!=='string'||json.length>LIMITS.maxJsonBytes||new TextEncoder().encode(json).byteLength>LIMITS.maxJsonBytes)fail('file is too large');
  let input;try{input=JSON.parse(json);}catch(_){fail('invalid JSON file');}
  return validate(input,model);
 }
 return {FORMAT,LIMITS,create,validate,compile,sample,stringify,parse};
});
