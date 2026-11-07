/* Loads the combat-ready HD soldiers (assets/hd/units/combat): geometry plus
   every animation clip (walk, rest, run, attack, shoot, deaths), decoding the
   int16-quantised frames into Float32 vertex positions. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansUnitModels=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const BASE='assets/hd/units/combat/';
 // Unit type (from the mission) -> exported model.
 const MODEL_FOR_TYPE={INFANTERIA_LIGERA:'infantry',PIQUERO:'pikeman',ARQUERO:'archer',GALO_LIGERA:'gaul_infantry',GALO_ARQUERO:'gaul_archer',HEROE_AGRADO:'scout'};
 function decode(meta,buffer){
  const raw=new Uint16Array(buffer),stride=meta.vertices*3,{origin,scale}=meta,decodedFrames=new Map();
  const frame=index=>{
   if(decodedFrames.has(index))return decodedFrames.get(index);
   const out=new Float32Array(stride),start=index*stride;
   for(let i=0;i<stride;i++){const axis=i%3;out[i]=origin[axis]+raw[start+i]*scale[axis];}
   // Clip aliases (including the positional testudo names) reference the
   // same immutable packed frame. Decode once rather than multiplying the
   // soldier library's memory by the number of semantic aliases.
   decodedFrames.set(index,out);
   return out;
  };
  const animations={};
  for(const [name,clip] of Object.entries(meta.clips)){
   const frames=[];
   for(let k=0;k<clip.frames;k++)frames.push({time:k*meta.frameMs,positions:frame(clip.offset+k)});
   // Retain the cooked clip identity and timing. Combat can play an attack as
   // a one-shot even though the exported preview marks the clip as looping.
   animations[name]={...clip,name,frameMs:meta.frameMs,frames};
  }
  const rest=animations.rest||Object.values(animations)[0];
  // A mounted troop is two sections (rider and mount) with their own
  // textures, sharing the animated vertices; normals use every section.
  const sections=meta.groups?.length?meta.groups:[{texture:meta.texture,indices:meta.indices}];
  return {kind:meta.kind,name:meta.mesh,frameMs:meta.frameMs,animations,
   deaths:Object.keys(animations).filter(n=>n.startsWith('death')),normalIndices:sections.length>1?meta.indices:null,
   groups:sections.map(g=>({texture:g.texture,indices:g.indices,uvs:meta.uvs,positions:rest.frames[0].positions,flags:0}))};
 }
 const cache=new Map();
 function load(kind){
  // The pair must match (clip offsets index the frames): always revalidated.
  if(!cache.has(kind))cache.set(kind,Promise.all([
   fetch(BASE+kind+'.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('Missing unit model '+kind);return r.json();}),
   fetch(BASE+kind+'.bin',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('Missing unit animation '+kind);return r.arrayBuffer();})
  ]).then(([meta,buffer])=>decode(meta,buffer)));
  return cache.get(kind);
 }
 // Resolve timing without touching vertices. Times are milliseconds; looping
 // wraps in both directions, while one-shots clamp safely at either end.
 function frameAt(animation,time,options={}){
  const frames=animation?.frames,n=frames?.length||0;
  if(!n)throw new Error('Cannot sample an empty unit animation');
  const frameMs=animation.frameMs||(n>1?frames[1].time-frames[0].time:40)||40;
  const duration=animation.duration>0?animation.duration:n*frameMs;
  const loop=options.loop??animation.loop??false;
  const input=Number.isFinite(time)?time:0;
  const t=loop?((input%duration)+duration)%duration:Math.min(Math.max(0,input),Math.max(0,(n-1)*frameMs));
  const index=Math.min(n-1,Math.floor(t/frameMs));
  const next=loop?(index+1)%n:Math.min(n-1,index+1);
  return {index,next,mix:Math.max(0,Math.min(1,(t-index*frameMs)/frameMs)),time:t,frameMs,duration,loop,finished:!loop&&input>=duration};
 }
 // Interpolated compatibility sampler. The battle renderer uses the shared
 // native-frame cache instead, so this never runs once for every fighter.
 function sample(animation,time,out,options){
  const timing=frameAt(animation,time,options),frames=animation.frames;
  const k=timing.mix,a=frames[timing.index].positions,b=frames[timing.next].positions;
  out=out||new Float32Array(a.length);
  for(let i=0;i<a.length;i++)out[i]=a[i]+(b[i]-a[i])*k;
  return out;
 }
 return {load,decode,sample,frameAt,MODEL_FOR_TYPE};
});
