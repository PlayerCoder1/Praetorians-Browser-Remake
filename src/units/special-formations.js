/* Source-backed selectable postures, geometry and profile overrides.
   Pure gameplay metadata: this module never moves or heals a soldier. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansSpecialFormations=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
 // The exporter supplies semantic aliases validated against the actual HD
 // shield poses (its axis conversion swaps the apparent Spanish side names).
 const TESTUDO_ROLES={front:'Front',rear:'Rear',left:'Left',right:'Right',center:'Center'};
 function create({units,data}){
  if(!units||!data?.formations||!data?.units)throw Error('Native formation and unit metadata are required');
  const definitions=data.formations;
  function choices(type){const entry=data.units[type];return (entry?.choices||[]).map(id=>definitions[id]).filter(Boolean);}
  function get(type,id){return choices(type).find(def=>def.id===id)||null;}
  function standard(type){return get(type,data.units[type]?.standard)||null;}
  function current(squad){return get(squad?.type,squad?.formationState?.id)||standard(squad?.type);}
  function check(squad,id,{ignoreBusy=false}={}){
   const definition=get(squad?.type,id);if(!definition)return {ok:false,reason:'unsupported',definition:null};
   const count=squad.members?.length??squad.units??0;
   if(!count)return {ok:false,reason:'empty',definition};
   // Any survivors can return to their standard posture, even if its native
   // creation minimum was larger than the depleted troop now has.
   if(definition.id!==standard(squad.type)?.id&&count<definition.minimum)return {ok:false,reason:'minimum',minimum:definition.minimum,definition};
   if(definition.id!==standard(squad.type)?.id&&count>definition.maximum)return {ok:false,reason:'maximum',maximum:definition.maximum,definition};
   if(!ignoreBusy){
    if(squad.inVillage||squad.sheltered||squad.transform)return {ok:false,reason:'sheltered',definition};
    if(squad.formationTransition||squad.formationState?.pending)return {ok:false,reason:'transition',definition};
    if(squad.combat?.engaged)return {ok:false,reason:'melee',definition};
   }
   return {ok:true,reason:null,definition};
  }
  function state(type,id){
   const def=get(type,id);if(!def)return null;
   const base=units[type],ranged=!!def.weapons.ranged;
   let render={},transitionClip=null,transitionRoles=null;
   if(def.mode==='raised'){render={idle:'raised',walk:'walkRaised',run:'run',attack:'attack'};}
   else if(def.mode==='planted'){
    if(ranged){render={idle:'crouched',load:'loadCrouched',aim:'aimCrouched',shoot:'shootCrouched',attack:'attack'};transitionClip='crouchEnter';}
    else{render={idle:'planted',attack:'attackPlanted'};transitionClip='plantEnter';}
   }else if(def.mode==='testudo'){
    const roles={};transitionRoles={};
    for(const [role,name] of Object.entries(TESTUDO_ROLES)){
     roles[role]={idle:'testudoRest'+name,walk:'testudoWalk'+name,run:'testudoWalk'+name,attack:'attackCovered'};
     transitionRoles[role]='testudoEnter'+name;
    }
    render={idle:'testudoRestCenter',walk:'testudoWalkCenter',attack:'attackCovered',roles};transitionClip='testudoEnterCenter';
   }
   return {id:def.id,mode:def.mode,stationary:!def.mobile,canRun:!!def.canRun&&def.mobile,
    activation:def.activation,minimum:def.minimum,maximum:def.maximum,defense:def.defense,
    ranged,render,transitionClip,transitionRoles,
    noAmbush:def.flags.includes('FLAG_NO_EMBOSCADA_PRADERA'),race:base?.race};
  }
  function columnCount(def,count){
   let value=count;const operations=def.layout||['OPERACION_SQRT_UP'];
   for(let i=0;i<operations.length;i++){
    const op=operations[i];
    if(op==='OPERACION_SQRT_UP')value=Math.ceil(Math.sqrt(value));
    else if(op==='OPERACION_SQRT_DOWN')value=Math.floor(Math.sqrt(value));
    else if(op==='OPERACION_CONST')value=Number(operations[++i]);
    else if(op==='OPERACION_DIV_UP')value=Math.ceil(value/Number(operations[++i]));
    else if(op==='OPERACION_DIV_DOWN')value=Math.floor(value/Number(operations[++i]));
    else if(op==='OPERACION_MUL')value*=Number(operations[++i]);
   }
   return Math.max(1,Math.min(count,Math.round(value)||1));
  }
  function slots(type,id,count,{spacing=null}={}){
   const def=get(type,id);if(!def||!Number.isInteger(count)||count<0)return [];
   if(!count)return [];
   const normal=standard(type),scaleX=typeof spacing==='number'&&spacing>0?spacing/(normal?.spacing.column||.5):spacing?.x>0?spacing.x/(normal?.spacing.column||.5):1,
    scaleZ=typeof spacing==='number'&&spacing>0?spacing/(normal?.spacing.row||.5):spacing?.z>0?spacing.z/(normal?.spacing.row||.5):1;
   const stepX=Math.max(.18,def.spacing.column*scaleX),stepZ=Math.max(.18,def.spacing.row*scaleZ);
   const columns=columnCount(def,count),rows=Math.ceil(count/columns),out=[];
   for(let row=0,index=0;row<rows;row++){
    const width=Math.min(columns,count-index);
    for(let col=0;col<width;col++,index++){
     // +Z faces forward. A complete leading row screens the centre; the
     // short final rank remains centred as casualties change the block.
     const role=row===0?'front':row===rows-1?'rear':col===0?'left':col===width-1?'right':'center';
     out.push({dx:(col-(width-1)/2)*stepX,dz:((rows-1)/2-row)*stepZ,formationRole:role});
    }
   }
   const midX=out.reduce((n,p)=>n+p.dx,0)/count,midZ=out.reduce((n,p)=>n+p.dz,0)/count;
   return out.map(p=>({...p,dx:p.dx-midX,dz:p.dz-midZ}));
  }
  function profile(type,id,baseProfile){
   const def=get(type,id),unit=units[type];if(!def||!unit)return baseProfile;
   const stateDef=unit.states[def.defense]||unit.states.NORMAL;
   const weapon=role=>{const ref=def.weapons[role];return ref?units[ref.type]?.weapons?.[ref.state]||null:null;};
   const result={...baseProfile,received:copy(stateDef?.received||baseProfile.received),
    melee:copy(weapon('melee')||weapon('close')||baseProfile.melee),
    ranged:copy(weapon('ranged')||null),formationFire:copy(weapon('fire')||null),
    formationClose:copy(weapon('close')||null),formationMode:def.mode,
    stationary:!def.mobile,canRun:def.canRun&&def.mobile};
   const normal=standard(type),ratio=normal?.speed>0&&def.speed>0?def.speed/normal.speed:1;
   result.speed=def.mobile?(baseProfile.speed||0)*ratio:0;
   if(def.mode==='testudo')result.pilum=null;
   return result;
  }
  function apply(squad,id){
   const next=state(squad.type,id);if(!next)return false;
   squad.formationState=next;squad.formationVersion=(squad.formationVersion||0)+1;
   if(!next.canRun)squad.running=false;
   squad.dirty=true;return next;
  }
  function reset(squad){const def=standard(squad.type);return def?apply(squad,def.id):false;}
  return {choices,get,standard,current,check,state,slots,profile,apply,reset,columnCount};
 }
 return {create};
});
