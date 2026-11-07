/* Frame-rate independent battlefield pan and wheel zoom. No Babylon dependency:
   callers provide a camera target, zoom accessors and world-space pan input. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansCameraMotion=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
 function configurePointer(camera){
  const pointers=camera?.inputs?.attached?.pointers;if(!pointers)return false;
  pointers.buttons=[1];
  // New Babylon input maps resolve the action separately from the button
  // filter. Leaving the default rotate action on button 0 makes middle drag
  // silently do nothing, even with pointers.buttons = [1].
  camera.movement?.input?.setInteraction('pointer',{button:1},'rotate');
  return true;
 }
 function create({camera,width,depth,getZoom,setZoom,onZoom=()=>{},panSpeed=.8,minZoom=5,maxZoom=65,
  response=.055,zoomResponse=.08,maxDelta=.25}={}){
  if(!camera?.target||typeof getZoom!=='function'||typeof setZoom!=='function')throw new Error('Camera motion needs a target and zoom accessors.');
  if(!Number.isFinite(width)||width<0||!Number.isFinite(depth)||depth<0)throw new Error('Camera motion needs finite map bounds.');
  response=Math.max(.001,response);zoomResponse=Math.max(.001,zoomResponse);
  let vx=0,vz=0,targetZoom=clamp(getZoom(),minZoom,maxZoom);
  function reset(){vx=0;vz=0;targetZoom=clamp(getZoom(),minZoom,maxZoom);}
  function requestZoom(deltaPixels){
   if(Number.isFinite(deltaPixels))targetZoom=clamp(targetZoom*Math.exp(deltaPixels*.001),minZoom,maxZoom);
   return targetZoom;
  }
  // Exact integral of eased velocity when its desired speed follows the
  // concurrently easing zoom. Large/irregular frames travel the same distance
  // as small frames, including during a wheel zoom while panning.
  function integrate(velocity,input,zoom,dt,ev,ez,iv,iz){
   const a=input*panSpeed*targetZoom,b=input*panSpeed*(zoom-targetZoom);
   if(Math.abs(zoomResponse-response)<1e-8){
    return {velocity:a+(velocity-a)*ev+b*dt/response*ev,
     distance:a*dt+(velocity-a)*iv+b*(iv-dt*ev)};
   }
   const k=zoomResponse/(zoomResponse-response);
   return {velocity:a+(velocity-a)*ev+b*k*(ez-ev),distance:a*dt+(velocity-a)*iv+b*k*(iz-iv)};
  }
  function update(dt,{x=0,z=0,enabled=true}={}){
   if(!enabled){reset();return;}
   if(!Number.isFinite(dt)||dt<=0)return;
   dt=Math.min(dt,maxDelta);
   x=Number.isFinite(x)?x:0;z=Number.isFinite(z)?z:0;
   const length=Math.hypot(x,z);if(length>1){x/=length;z/=length;}
   const zoom=clamp(getZoom(),minZoom,maxZoom),ev=Math.exp(-dt/response),ez=Math.exp(-dt/zoomResponse);
   const iv=-Math.expm1(-dt/response)*response,iz=-Math.expm1(-dt/zoomResponse)*zoomResponse;
   const px=integrate(vx,x,zoom,dt,ev,ez,iv,iz),pz=integrate(vz,z,zoom,dt,ev,ez,iv,iz);
   camera.target.x=clamp(camera.target.x+px.distance,0,width);
   camera.target.z=clamp(camera.target.z+pz.distance,0,depth);
   vx=px.velocity;vz=pz.velocity;
   if((camera.target.x===0&&vx<0)||(camera.target.x===width&&vx>0))vx=0;
   if((camera.target.z===0&&vz<0)||(camera.target.z===depth&&vz>0))vz=0;
   const nextZoom=targetZoom+(zoom-targetZoom)*ez;
   if(nextZoom!==zoom){setZoom(nextZoom);onZoom(nextZoom);}
  }
  return {update,requestZoom,reset,get targetZoom(){return targetZoom;},get velocity(){return {x:vx,z:vz};}};
 }
 return {create,configurePointer};
});
