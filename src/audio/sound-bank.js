/* Game sound effects from the original sound tables (data/game/sounds.json,
   built from the Sonidos*.dat files): each event plays one of its files at
   the original volume, never more copies at once than its POLIFONIA. Sounds
   are panned and attenuated by where they happen relative to the camera. The
   audio itself is the HD Remaster's Ogg Vorbis (assets/hd/sounds). */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansSound=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const BASE='assets/hd/sounds/';
 const LANGUAGES=['en','fr','de','es','it'];
 const languageCode=value=>{const code=String(value||'fr').toLowerCase().split(/[-_]/)[0];return LANGUAGES.includes(code)?code:'en';};
 async function create({master=.8,language='fr'}={}){
  const [defs,manifest]=await Promise.all([
   fetch('data/game/sounds.json').then(r=>r.json()),fetch(BASE+'manifest.json').then(r=>r.json())
  ]);
  const files=new Map(Object.keys(manifest).map(name=>[name.toLowerCase(),BASE+manifest[name].file]));
  let currentLanguage=languageCode(language),languageVersion=0;
  // The remaster ships five narration packs. This installation has English
  // and French troop acknowledgements; use English for missing localized lines.
  const resolve=file=>{
   const base=file.split(/[\\/]/).pop().replace(/\.(ogi|ogg|wav)$/i,'').toLowerCase();
   return files.get('voice_'+currentLanguage+'_'+base)||files.get('voice_en_'+base)||files.get('voice_fr_'+base)||files.get(String(file).toLowerCase())||files.get(base);
  };
  const Context=window.AudioContext||window.webkitAudioContext;
  const context=new Context(),output=context.createGain();output.connect(context.destination);
  let volume=master;output.gain.value=volume;
  // Browsers start audio only after a user gesture.
  let unlocked=context.state==='running';
  const unlock=()=>{unlocked=true;if(context.state==='suspended')context.resume().catch(()=>{});};
  for(const type of ['pointerdown','keydown'])addEventListener(type,unlock,{capture:true});
  async function ready(){
   if(context.state==='suspended'&&unlocked)try{await context.resume();}catch{}
   return context.state==='running';
  }
  const buffers=new Map(),playing=new Map(),loops=new Map(),spokenEffects=new Set();
  let listener={x:0,z:0,range:20,right:{x:1,z:0}};
  function load(file){
   if(!buffers.has(file))buffers.set(file,fetch(file).then(r=>{if(!r.ok)throw Error('Missing audio');return r.arrayBuffer();}).then(data=>context.decodeAudioData(data)).catch(()=>null));
   return buffers.get(file);
  }
  const available=name=>(defs[name]?.files||[]).map(resolve).filter(Boolean);
  // Distance fall-off and left/right placement from the camera's view.
  function placement(at){
   if(!at)return {gain:1,pan:0};
   const dx=at.x-listener.x,dz=at.z-listener.z,d=Math.hypot(dx,dz);
   const gain=Math.max(0,1-Math.max(0,d-listener.range*.45)/(listener.range*1.3));
   const pan=Math.max(-1,Math.min(1,(dx*listener.right.x+dz*listener.right.z)/(listener.range*.9)));
   return {gain,pan};
  }
  function voice(buffer,gain,pan,loop){
   const source=context.createBufferSource(),amp=context.createGain(),panner=context.createStereoPanner();
   source.buffer=buffer;source.loop=loop;amp.gain.value=gain;panner.pan.value=pan;
   source.connect(amp).connect(panner).connect(output);
   source.start();
   return {source,amp,panner};
  }
  // One-shot event, e.g. play('UATC', {x,z}).
  async function play(name,at,boost=1){
   const def=defs[name],choices=available(name),version=languageVersion;if(!def||!choices.length||!await ready())return;
   const {gain,pan}=placement(at);if(gain<=.02)return;
   const active=playing.get(name)||0;if(active>=Math.max(1,def.polyphony))return;
   playing.set(name,active+1);
   const buffer=await load(choices[Math.floor(Math.random()*choices.length)]);
   if(!buffer||(version!==languageVersion&&choices.some(file=>file.includes('/voice_')))){playing.set(name,(playing.get(name)||1)-1);return;}
   const {source}=voice(buffer,def.volume*gain*boost,pan,false);
   if(choices.some(file=>file.includes('/voice_')))spokenEffects.add(source);
   source.onended=()=>{spokenEffects.delete(source);playing.set(name,Math.max(0,(playing.get(name)||1)-1));};
  }
  // Continuous sounds (marching, battle din, river): call every frame with the
  // set of wanted loops; others fade out.
  function setLoops(wanted){
   const now=context.currentTime;
   for(const [key,{name,at,boost=1}] of wanted){
    const def=defs[name],choices=available(name);if(!def||!choices.length)continue;
    const {gain,pan}=placement(at),target=def.volume*gain*boost;
    let loop=loops.get(key);
    if(!loop||loop.name!==name){
     if(loop)stopLoop(key);
     loop={name,voice:null,pending:true};loops.set(key,loop);
     load(choices[0]).then(buffer=>{if(loops.get(key)!==loop||!buffer||context.state!=='running'){if(loops.get(key)===loop)loops.delete(key);return;}loop.voice=voice(buffer,0,pan,true);loop.pending=false;});
    }
    if(loop.voice){loop.voice.amp.gain.setTargetAtTime(target,now,.15);loop.voice.panner.pan.setTargetAtTime(pan,now,.15);}
   }
   for(const key of [...loops.keys()])if(!wanted.has(key))stopLoop(key);
  }
  function stopLoop(key){
   const loop=loops.get(key);loops.delete(key);
   if(loop?.voice){const v=loop.voice;v.amp.gain.setTargetAtTime(0,context.currentTime,.12);setTimeout(()=>{try{v.source.stop();}catch{}},600);}
  }
  // Music (Musicas.dat): one looping track at a time, crossfaded, on its own
  // volume (the menu's music option).
  const musicOut=context.createGain();musicOut.connect(context.destination);musicOut.gain.value=.75;
  let music=null;
  async function playMusic(name){
   if(music?.name===name)return;
   const old=music;music=null;
   if(old?.voice){old.voice.amp.gain.setTargetAtTime(0,context.currentTime,.8);setTimeout(()=>{try{old.voice.source.stop();}catch{}},4000);}
   const def=defs[name],file=available(name)[0];if(!def||!file)return;
   const track={name,voice:null};music=track;
   const buffer=await load(file);
   if(music!==track||!buffer)return;
   const source=context.createBufferSource(),amp=context.createGain();
   source.buffer=buffer;source.loop=true;amp.gain.value=0;source.connect(amp).connect(musicOut);source.start();
   amp.gain.setTargetAtTime(def.volume,context.currentTime,1);
   track.voice={source,amp};
  }
  // A spoken line (cut-scenes): centred, at the definition's volume.
  // Resolves when it has finished, or at once if it cannot be played.
  let speechTurn=0;
  async function speak(name){
   silence();
   const def=defs[name],file=available(name)[0],version=languageVersion,turn=speechTurn;
   if(!def||!file||!await ready())return {played:false,duration:0};
   const buffer=await load(file);if(!buffer||version!==languageVersion||turn!==speechTurn)return {played:false,duration:0};
   const {source}=voice(buffer,def.volume,0,false);
   speak.current=source;
   return new Promise(done=>{source.onended=()=>done({played:true,duration:buffer.duration});});
  }
  function silence(){speechTurn++;try{speak.current?.stop();}catch{}speak.current=null;}
  // The troops' answers and the announcer's messages (src/audio/troop-voices.js):
  // one at a time on each channel, a new line cutting the last one short.
  // A troop's answer leans to its side of the screen but is never faint: the
  // selected troop may well be off screen.
  const channels=new Map();
  async function say(name,channel,at=null){
   const def=defs[name],choices=available(name);if(!def||!choices.length)return false;
   const turn={},slot=channels.get(channel)||{};slot.turn=turn;channels.set(channel,slot);
   try{slot.source?.stop();}catch{}slot.source=null;
   if(!await ready()||slot.turn!==turn)return false;
   const buffer=await load(choices[Math.floor(Math.random()*choices.length)]);
   if(!buffer||slot.turn!==turn)return false;
   const {source}=voice(buffer,def.volume,placement(at).pan*.6,false);
   slot.source=source;source.onended=()=>{if(slot.source===source)slot.source=null;};
   return true;
  }
  function stopChannel(channel){const slot=channels.get(channel);if(!slot)return;slot.turn={};try{slot.source?.stop();}catch{}slot.source=null;}
  function setLanguage(value){
   const next=languageCode(value);if(next===currentLanguage)return currentLanguage;
   currentLanguage=next;languageVersion++;silence();
   for(const channel of channels.keys())stopChannel(channel);
   for(const source of spokenEffects)try{source.stop();}catch{}
   spokenEffects.clear();
   return currentLanguage;
  }
  return {
   play,setLoops,playMusic,speak,silence,say,setLanguage,stopChannel,
   has(name){return available(name).length>0;},
   get language(){return currentLanguage;},
   get voiceLanguage(){return currentLanguage==='fr'?'fr':'en';},
   setMusicVolume(value){musicOut.gain.setTargetAtTime(Math.max(0,Math.min(1,value)),context.currentTime,.1);},
   setListener(next){listener={...listener,...next};},
   setVolume(value){volume=Math.max(0,Math.min(1,value));output.gain.setTargetAtTime(volume,context.currentTime,.05);},
   preload(names){for(const name of names)for(const file of available(name))load(file);},
   get state(){return context.state;},defs
  };
 }
 return {create,languageCode};
});
