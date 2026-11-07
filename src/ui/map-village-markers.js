/* Village positions share the HD map artwork's isometric projection. Optional
   owner colours tint the HD house fill while preserving its outline/alpha. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansMapVillageMarkers=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const ICON='assets/hd/interface/Village.png';
 const tintCache=new WeakMap(),MAX_TINTS=16;
 function colourKey(colour){
  if(typeof colour!=='string')return null;
  const hex=colour.trim().toLowerCase();
  if(/^#[0-9a-f]{6}$/.test(hex))return hex;
  if(/^#[0-9a-f]{3}$/.test(hex))return '#'+hex.slice(1).split('').map(char=>char+char).join('');
  return null;
 }
 function defaultCanvas(){
  if(typeof document!=='undefined')return document.createElement('canvas');
  if(typeof OffscreenCanvas!=='undefined')return new OffscreenCanvas(1,1);
  return null;
 }
 function tint(image,colour,canvasFactory=defaultCanvas){
  const key=colourKey(colour);
  if(!key||key==='#ffffff'||!image?.complete||!image.naturalWidth)return image;
  const width=image.naturalWidth,height=image.naturalHeight,source=image.currentSrc||image.src||'';
  let record=tintCache.get(image);
  if(!record||record.width!==width||record.height!==height||record.source!==source){
   record={width,height,source,pixels:null,colours:new Map()};tintCache.set(image,record);
  }
  if(record.colours.has(key))return record.colours.get(key);
  try{
   const canvas=canvasFactory();if(!canvas)return image;
   canvas.width=width;canvas.height=height;
   const context=canvas.getContext('2d');if(!context)return image;
   if(!record.pixels){context.drawImage(image,0,0);record.pixels=context.getImageData(0,0,width,height).data.slice();}
   const pixels=context.createImageData(width,height),red=parseInt(key.slice(1,3),16)/255,green=parseInt(key.slice(3,5),16)/255,blue=parseInt(key.slice(5,7),16)/255;
   for(let i=0;i<record.pixels.length;i+=4){
    pixels.data[i]=record.pixels[i]*red;pixels.data[i+1]=record.pixels[i+1]*green;pixels.data[i+2]=record.pixels[i+2]*blue;pixels.data[i+3]=record.pixels[i+3];
   }
   context.putImageData(pixels,0,0);
   if(record.colours.size>=MAX_TINTS)record.colours.delete(record.colours.keys().next().value);
   record.colours.set(key,canvas);return canvas;
  }catch(_){
   // Storage/canvas restrictions must not remove the village from the map.
   return image;
  }
 }
 function project(point,width,depth,image={width:720,height:448}){
  if(!point||![point.x,point.z,width,depth,image.width,image.height].every(Number.isFinite)||width<=0||depth<=0||image.width<=0||image.height<=0)return null;
  const u=(point.x+point.z)/(width+depth),v=(depth+point.x-point.z)/(width+depth);
  return {x:u*image.width,y:v*image.height,u,v};
 }
 function fromStructures(placements,defs){
  const result=[];
  for(const [index,p] of (placements||[]).entries()){
   const kind=defs?.[p.type]?.kind;if(kind!=='PUEBLO'&&kind!=='BARRACON')continue;
   const x=p.x??p.position?.[0],z=p.z??p.position?.[2];
   if(!Number.isFinite(x)||!Number.isFinite(z))continue;
   result.push({x,z,type:p.type,name:p.name||'Village '+(result.length+1),index});
  }
  return result;
 }
 function draw(ctx,image,markers,pointFor,size=18,colourFor=null){
  if(!image||!image.complete||!image.naturalWidth||!Number.isFinite(size)||size<=0)return 0;
  const height=size*image.naturalHeight/image.naturalWidth;let count=0;
  ctx.save();ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=2;ctx.shadowOffsetY=1;
  for(const marker of markers||[]){
   const p=pointFor(marker);if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;
   const picture=typeof colourFor==='function'?tint(image,colourFor(marker)):image;
   ctx.drawImage(picture,p.x-size/2,p.y-height/2,size,height);count++;
  }
  ctx.restore();return count;
 }
 return {ICON,project,fromStructures,draw,tint};
});
