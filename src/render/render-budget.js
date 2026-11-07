/* Limit work at Babylon's own frame loop, before simulation and GPU submission.
   The original materials and lighting stay unchanged; resolution is an explicit
   optional trade-off for smaller GPUs. */
(function(root,factory){
 const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansRenderBudget=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(root){
 'use strict';
 const STORAGE_KEY='praetorians.renderBudget';
 const FPS=Object.freeze([30,60,90,120,'display']),RENDER_SCALES=Object.freeze([.75,.85,1]);
 const DEFAULT=Object.freeze({fps:60,renderScale:1});
 function normalize(value){
  const fps=value?.fps==='display'?'display':Number(value?.fps),renderScale=Number(value?.renderScale);
  return {fps:FPS.includes(fps)?fps:DEFAULT.fps,
   renderScale:RENDER_SCALES.includes(renderScale)?renderScale:DEFAULT.renderScale};
 }
 function storageOrDefault(storage){if(storage!==undefined)return storage;try{return root?.localStorage;}catch{return null;}}
 function read(storage){
  try{return normalize(JSON.parse(storageOrDefault(storage)?.getItem(STORAGE_KEY)||'null'));}
  catch{return {...DEFAULT};}
 }
 function write(value,storage){
  const settings=normalize(value);
  try{storageOrDefault(storage)?.setItem(STORAGE_KEY,JSON.stringify(settings));}catch{}
  return settings;
 }
 function hardwareScaling(renderScale){return 1/normalize({renderScale}).renderScale;}
 function create({engine,onResize=()=>{},onApply=()=>{},storage,settings:initial}={}){
  if(!engine||typeof engine.setHardwareScalingLevel!=='function')throw new Error('Render budget needs a Babylon engine.');
  let settings={...DEFAULT};
  function apply(value,{persist=true}={}){
   settings=normalize({...settings,...value});
   // Numeric caps throttle the entire callback in Babylon. Display mode
   // follows the browser's refresh clock, without a second frame scheduler.
   // undefined is Babylon's public API for disabling its additional cap.
   engine.maxFPS=settings.fps==='display'?undefined:settings.fps;
   engine.renderEvenInBackground=false;
   const scaling=hardwareScaling(settings.renderScale);
   if(engine.getHardwareScalingLevel?.()!==scaling){
    engine.setHardwareScalingLevel(scaling);
    onResize();
   }
   if(persist)write(settings,storage);
   onApply({...settings});
   return {...settings};
  }
  apply(initial??read(storage),{persist:false});
  return {apply,
   get settings(){return {...settings};},
   get state(){return {...settings,hardwareScaling:hardwareScaling(settings.renderScale),
    renderEvenInBackground:engine.renderEvenInBackground,
    renderWidth:engine.getRenderWidth?.(),renderHeight:engine.getRenderHeight?.()};}
  };
 }
 return {STORAGE_KEY,FPS,RENDER_SCALES,DEFAULT,normalize,read,write,hardwareScaling,create};
});
