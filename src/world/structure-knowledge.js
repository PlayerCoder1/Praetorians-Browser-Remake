/* Observed structures belong to an observer's memory, not to the live world.
   Exploring terrain does not reveal later construction, damage or captures.
   Public village locations can always be drawn; their owner is known only
   through current sight or friendly intelligence. This module stores scalar
   snapshots, so changes to the simulation cannot silently change that memory. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansStructureKnowledge=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const STRUCTURE_FIELDS=['model','owner','state','life','maxLife','progress','x','y','z','r','kind','type','occupantCount'];
 const VILLAGE_FIELDS=['owner','x','z'];
 function same(a,b,fields){return !!a&&fields.every(key=>Object.is(a[key],b[key]));}
 function create(){
  const observers=new Map();
  function memory(observer,make=false){
   if(observer==null)return null;
   let entry=observers.get(observer);
   if(!entry&&make){entry={structures:new Map(),villages:new Map()};observers.set(observer,entry);}
   return entry||null;
  }
  function peek(observer,entity){return entity?memory(observer)?.structures.get(entity)||null:null;}
  function observe(observer,entity,{visible=false,friendly=false,model=entity?.shown}={}){
   if(!entity||observer==null)return null;
   const previous=peek(observer,entity);
   if(!visible&&!friendly)return previous;
   const snapshot={model:model??null,owner:entity.owner||null,state:entity.state,
    life:entity.life,maxLife:entity.maxLife,progress:entity.progress,
    x:entity.x,y:entity.y,z:entity.z,r:entity.r,kind:entity.kind,type:entity.type,
    occupantCount:entity.occupants?.length||0};
   if(same(previous,snapshot,STRUCTURE_FIELDS))return previous;
   const result=Object.freeze(snapshot);memory(observer,true).structures.set(entity,result);return result;
  }
  function peekVillage(observer,village){return village?memory(observer)?.villages.get(village)||null:null;}
  function observeVillage(observer,village,{visible=false,friendly=false}={}){
   if(!village||observer==null)return null;
   const previous=peekVillage(observer,village);
   if(!visible&&!friendly)return previous;
   const snapshot={owner:village.owner||null,x:village.x,z:village.z};
   if(same(previous,snapshot,VILLAGE_FIELDS))return previous;
   const result=Object.freeze(snapshot);memory(observer,true).villages.set(village,result);return result;
  }
  function villageOwner(observer,village,options){return observeVillage(observer,village,options)?.owner||null;}
  function forget(observer,entity){
   const entry=memory(observer);if(!entry)return false;
   const structure=entry.structures.delete(entity),village=entry.villages.delete(entity);
   return structure||village;
  }
  function clear(observer){if(arguments.length)observers.delete(observer);else observers.clear();}
  return {observe,peek,observeVillage,peekVillage,villageOwner,forget,clear};
 }
 return {create};
});
