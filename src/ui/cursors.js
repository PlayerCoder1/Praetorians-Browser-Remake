/* Cursors: the HD Remaster's cursor art (Content/Cursores) with the
   original game's hotspots (Varios/Def/CursoresJuego.dat). The pointer
   tells what a click would do: a hand on open ground - with a leaf over
   forest, tall grass over wheat (PRADERA), a drop on the shore - swords
   over an enemy, the order's own cursor while an order waits for its target,
   and a no-entry sign where the selected troops cannot go.

   choose(context) -> cursor name; context: {pending, terrain ('forest',
   'meadow', 'shore' or null), selection (own troops selected), enemy,
   friend, hostileStructure (tower or building), repairable, enterVillage,
   garrisonSite, walkable}. apply(element, name) sets it. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansCursors=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 // NOMBRE: [file, hotspot x, hotspot y], as CursoresJuego.dat defines them.
 const CURSORS={NORMAL:['Cursor',0,0],NORMAL_BOSQUE:['Cursor_Bosque',0,0],NORMAL_PRADERA:['Cursor_Pradera',0,0],NORMAL_ORILLA:['Cursor_Orilla',0,0],
  PROHIBIDO:['Prohibido',16,16],MOVER:['Mover',1,1],MOVER_BOSQUE:['Mover_Bosque',1,1],MOVER_PRADERA:['Mover_Pradera',1,1],MOVER_ORILLA:['Mover_Orilla',1,1],
  ATACAR:['Atacar',1,1],ATACAR_BOSQUE:['Atacar_Bosque',1,1],ATACAR_PRADERA:['Atacar_Pradera',1,1],ATACAR_ORILLA:['Atacar_Orilla',1,1],
  UNIR:['Unir',1,1],DESMANTELAR:['Desmantelar',16,16],ORIENTAR:['Orientar',1,1],CORRER:['Correr',1,1],PROTEGER:['Proteger',1,1],
  PATRULLAR:['Patrullar',1,1],PATRULLAR_PRADERA:['Patrullar_Pradera',1,1],PATRULLAR_ORILLA:['Patrullar_Orilla',1,1],
  REPARAR:['Reparar',1,1],BUILD_GARRISON:['build_garrison',0,0],CONSTRUIR_PUENTE:['Construir_Puente',0,0],ENTRAR_PUEBLO:['EntrarPueblo',0,0],
  EJECUTAR_HABILIDAD:['EjecutarHabilidad',1,1],ATACAR_TORRE:['AtacarTorre',3,3],ASALTAR_TORRE:['AsaltarTorre',16,28]};
 const SUFFIX={forest:'_BOSQUE',meadow:'_PRADERA',shore:'_ORILLA'};
 // A terrain variant when the game has one (there is no forest patrol cursor).
 const variant=(name,terrain)=>{const v=terrain&&SUFFIX[terrain]?name+SUFFIX[terrain]:name;return CURSORS[v]?v:name;};
 function choose(c){
  const t=c.terrain||null;
  switch(c.pending){
   case 'move':case 'run':return c.walkable===false?'PROHIBIDO':c.enemy?variant('ATACAR',t):variant(c.pending==='run'?'CORRER':'MOVER',t);
   case 'attack':return c.enemy||c.hostileStructure?(c.hostileStructure==='tower'?'ATACAR_TORRE':variant('ATACAR',t)):c.walkable===false?'PROHIBIDO':variant('ATACAR',t);
   case 'patrol':return c.walkable===false?'PROHIBIDO':variant('PATRULLAR',t);
   case 'protect':return c.friend?'PROTEGER':'PROHIBIDO';
   case 'face':return 'ORIENTAR';
   case 'hawk':return 'EJECUTAR_HABILIDAD';
   case 'ability':return c.enemy?'EJECUTAR_HABILIDAD':'PROHIBIDO';
   case 'repair':return c.repairable?'REPARAR':'PROHIBIDO';
   case 'rally':return c.walkable===false?'PROHIBIDO':variant('MOVER',c.terrain);
   case 'bridge':return 'CONSTRUIR_PUENTE';
   case 'build':return c.walkable===false?'PROHIBIDO':'BUILD_GARRISON';
   default:break;
  }
  if(c.selection){
   if(c.enemy)return variant('ATACAR',t);
   if(c.hostileStructure)return c.hostileStructure==='tower'?'ATACAR_TORRE':'DESMANTELAR';
   if(c.repairable)return 'REPARAR';
   if(c.enterVillage)return 'ENTRAR_PUEBLO';
   if(c.garrisonSite)return 'BUILD_GARRISON';
   if(!c.friend&&c.walkable===false)return 'PROHIBIDO';
  }
  return variant('NORMAL',t);
 }
 function css(name,base='assets/hd/interface/'){
  const [file,x,y]=CURSORS[name]||CURSORS.NORMAL;
  return `url('${base}${file}.png') ${x} ${y}, ${name==='PROHIBIDO'?'not-allowed':'default'}`;
 }
 function apply(element,name,base){
  const value=css(name,base);
  if(element._cursor===name&&element.style.cursor)return false;
  element._cursor=name;element.style.cursor=value;return true;
 }
 return {CURSORS,choose,css,apply,variant};
});
