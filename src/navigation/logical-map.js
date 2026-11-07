/* The original logical map (MLG): one 32-bit value per 1 m cell, and each
   unit's own list of what it cannot cross (DefUnidades TERRENO and
   FLAGSNOPASABLES). This is what the original game moves troops by.

   The names and values below are the original executable's own tables
   (Praetorians.exe, .data 0x72a5a0 for the cell flags, 0x72ac00 for the
   terrain types); the rules are its unit-definition loader (0x46914f) and
   its movement test (0x510e7f):
   - terrain type = the value's top five bits; a unit cannot enter a type in
     its TERRENO list (structures overwrite cells with 0xF8000000 meaning
     "keep the type");
   - a unit cannot enter a cell sharing a bit with its FLAGSNOPASABLES mask;
     the loader widens the slope flags (PENDIENTE1 also blocks PENDIENTE2 and
     3, PENDIENTE2 also blocks PENDIENTE3) and adds FLAG_NOPASABLE (the
     footprints of solid scenery: pyramids, temples, barrels, tents) and
     FLAG_FIN_ESCENARIO to every unit that does not fly (FLAG_VOLADORA).
   In the maps: 0x10 level ground, 0x20 a ramp between levels, 0x80 the
   hills and cliffs no troop climbs (mostly on BLOQUEADO ground, which only
   machines must also keep off). */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansLogicalMap=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const TYPE={NORMAL:0,ARENA:1,AGUA_PROFUNDA:2,ORILLA:3,PRADERA:4,BOSQUE_LIGERO:5,BOSQUE_CERRADO:6,MURALLA:7,BLOQUEADO:8,NIEVE:9,NO_USADO:10,FIN_ESCENARIO:11};
 const FLAG={FLAG_NOPASABLE:0x1,FLAG_PLANO:0x10,FLAG_PENDIENTE1:0x20,FLAG_PENDIENTE2:0x40,FLAG_PENDIENTE3:0x80,
  FLAG_ESTRUCTURA:0x100,FLAG_PUENTE:0x200,FLAG_MODIFICADA:0x400,FLAG_PUERTA:0x800,FLAG_NO_ASALTABLE:0x1000,FLAG_CONSTRUIBLE:0x2000,
  FLAG_MURALLA_IMPASABLE:0x8000,FLAG_INTERIOR_FORTALEZA:0x10000,FLAG_ESTRUCTURA_PLANA:0x80000,FLAG_FIN_ESCENARIO:0x100000,
  FLAG_PIE_MURALLA:0x200000,FLAG_BLOQUEADO_MAQUINAS:0x400000};
 const BORDER=FLAG.FLAG_FIN_ESCENARIO;
 // Flags the game itself handles elsewhere here: structures, bridges and
 // gates are world/buildings.js and world/fortress.js.
 const DYNAMIC=FLAG.FLAG_ESTRUCTURA|FLAG.FLAG_PUENTE|FLAG.FLAG_PUERTA|FLAG.FLAG_NO_ASALTABLE;
 const typeOf=v=>v>>>27;
 // Ordinary infantry.
 const DEFAULT={terrain:['AGUA_PROFUNDA','FIN_ESCENARIO'],noPass:['FLAG_PENDIENTE2']};
 // The unit-definition loader's widening of the mask (0x46914f).
 function widen(mask,flying){
  if(mask&FLAG.FLAG_PENDIENTE1)mask|=FLAG.FLAG_PENDIENTE2|FLAG.FLAG_PENDIENTE3;
  else if(mask&FLAG.FLAG_PENDIENTE2)mask|=FLAG.FLAG_PENDIENTE3;
  if(!flying)mask|=FLAG.FLAG_NOPASABLE|FLAG.FLAG_FIN_ESCENARIO;
  return mask>>>0;
 }
 // What a unit (data/game/units.json entry) cannot cross. Walls are the
 // fortress's business; deep water is reported apart (it is water).
 function rules(unit){
  const list=unit?.terrain?.length||unit?.noPass?.length?unit:DEFAULT;
  const flying=(unit?.flags||[]).includes('FLAG_VOLADORA');
  const types=new Set();let mask=0;
  for(const name of list.terrain||[])if(TYPE[name]!==undefined&&name!=='MURALLA'&&name!=='AGUA_PROFUNDA')types.add(TYPE[name]);
  for(const name of list.noPass||[])if(FLAG[name])mask|=FLAG[name];
  mask=widen(mask,flying)&~DYNAMIC;
  const water=(list.terrain||[]).includes('AGUA_PROFUNDA');
  const key=[...types].sort((a,b)=>a-b).join(',')+'|'+mask+'|'+(water?'w':'');
  return {key,types,mask,water,
   blocked:v=>types.has(typeOf(v))||(v&mask)!==0,
   deep:v=>water&&typeOf(v)===TYPE.AGUA_PROFUNDA};
 }
 const shallow=v=>typeOf(v)===TYPE.ORILLA;
 const deep=v=>typeOf(v)===TYPE.AGUA_PROFUNDA;
 return {TYPE,FLAG,BORDER,typeOf,rules,widen,shallow,deep,DEFAULT};
});
