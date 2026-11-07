/* A selected structure in the HD's bottom panel, and the yellow brackets
   that mark it (or a selected village) on the ground.

   Garrisons, watchtowers, tents, altars and ships can be selected, and so
   can every building site once its builders have begun (a site not begun
   is only a place, as in the original). A click on one selects it, and a
   click on nothing lets it go, as for a village. Built bridges are ground.
   The panel shows the HD's portrait and "POINTS DE VIE: 11880 / 100000":
   life rises while the builders work (FACTOR_CONSTRUCCION a builder a
   second) and falls when the structure is attacked or burns.

   Portraits are the HD's TorusUI TroopIcon_NN, matched to the HD models
   (the original's DefEstructuras COORD_PICONO cells): garrisons 56 Roman,
   57 Gallic; watchtowers 59 Roman, 60 Gallic, 61 Egyptian; barracks 62;
   altar 64; any building site the timber pile, 65, whatever it will become;
   ship 66; general's tents 67 Roman, 68 Gallic, 69 Egyptian. The HD has no
   Egyptian garrison portrait (the original shows one garrison portrait for
   every race), so its sandstone tower, 61, stands in.

   main.js gives a building entity (src/world/buildings.js) and its title;
   info() returns what the selection panel (src/ui/troop-hud.js) shows.
   brackets(box, groundY) returns the marker's ground mesh. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansStructurePanel=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const PORTRAITS={GUARNICION_ROMANA:56,GUARNICION_BARBARA:57,GUARNICION_EGIPCIA:61,
  TORRE_DEFENSA_ROMANA:59,TORRE_DEFENSA_BARBARA:60,TORRE_DEFENSA_EGIPCIA:61,
  ALTAR_GALO:64,BARCO_PRUEBA:66,TIENDA_GENERAL_ROMANO:67,TIENDA_GENERAL_GALO:68,TIENDA_GENERAL_EGIPCIO:69};
 const BY_KIND={GUARNICION:56,TORRE_DEFENSA:59,ATACABLE:64,BARCO:66,PUEBLO:58,BARRACON:62};
 const SITE=65;
 const icon=n=>'TroopIcon_'+String(n).padStart(2,'0');
 function portrait(e){
  if(e.state==='site')return icon(SITE);
  return icon(PORTRAITS[e.type]??BY_KIND[e.kind]??SITE);
 }
 // Standing, or rising once begun; a built bridge is ground to walk on.
 const SELECTABLE=new Set(['GUARNICION','TORRE_DEFENSA','ATACABLE','BARCO']);
 function selectable(e){
  if(!e||e.state==='destroyed'||e.pending)return false;
  return e.state==='site'||SELECTABLE.has(e.kind);
 }
 function info(e,{title,colour='#8f8f8f',base='assets/hd/interface/'}={}){
  return {key:e,name:title||e.type,icon:base+portrait(e)+'.png',hp:Math.max(0,e.life||0),hpMax:e.maxLife||0,
   stamina:0,staminaMax:0,count:null,max:null,kills:null,colour,side:'structure',selected:true,fighting:false,
   // A site's life is its progress: low is not a danger.
   building:e.state==='site',stats:[],abilities:[],queue:null};
 }
 // The box the brackets go round: the outline's bounds (a site's scaffold
 // once begun), local to the structure, as buildings.js turns it by r.
 function boxOf(e){
  const pts=e.workOutline||e.outline||[];if(!pts.length)return null;
  let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
  for(const [px,pz] of pts){x0=Math.min(x0,px);x1=Math.max(x1,px);z0=Math.min(z0,pz);z1=Math.max(z1,pz);}
  return {x:e.x,z:e.z,r:e.r||0,cx:(x0+x1)/2,cz:(z0+z1)/2,hx:(x1-x0)/2,hz:(z1-z0)/2};
 }
 // A village: its CASILLAS footprint (rows along z, columns along x, 1 m
 // cells, centred), else most of its radius.
 function villageBox(v,def={}){
  const [rows,columns]=def.cells||[],h=(v.radius||4)*.75;
  return {x:v.x,z:v.z,r:v.r||0,cx:0,cz:0,hx:columns?columns/2:h,hz:rows?rows/2:h};
 }
 // An L at each corner of the box, a hand's width wide, its arms in short
 // steps that follow the ground.
 function brackets({x,z,r=0,cx=0,cz=0,hx,hz},groundY,{margin=.35,width=.14,lift=.08}={}){
  const c=Math.cos(r),s=Math.sin(r),positions=[],indices=[];
  const toWorld=(lx,lz)=>({x:x+lx*c+lz*s,z:z-lx*s+lz*c});
  const ax=hx+margin,az=hz+margin,arm=Math.min(1.6,Math.max(.5,.64*Math.min(ax,az)));
  // From (x0, z0) to (x1, z1), (ox, oz) across: all local.
  function strip(x0,z0,x1,z1,ox,oz){
   const n=Math.max(1,Math.ceil(Math.hypot(x1-x0,z1-z0)/.3)),first=positions.length/3;
   for(let i=0;i<=n;i++){
    const lx=x0+(x1-x0)*i/n,lz=z0+(z1-z0)*i/n;
    for(const k of [0,1]){const p=toWorld(lx+ox*k,lz+oz*k);positions.push(p.x,groundY(p.x,p.z)+lift,p.z);}
   }
   for(let i=0;i<n;i++){const a=first+i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  }
  for(const sx of [-1,1])for(const sz of [-1,1]){
   const kx=cx+sx*ax,kz=cz+sz*az;
   strip(kx,kz,kx-sx*arm,kz,0,-sz*width);
   strip(kx,kz,kx,kz-sz*arm,-sx*width,0);
  }
  return {positions,indices};
 }
 return {portrait,selectable,info,boxOf,villageBox,brackets,PORTRAITS};
});
