/* Terrain-based squad routing. No external dependencies.
   With the map's logical map (options.logical: the MLG values and one
   unit's rules, see logical-map.js) passability is the original game's:
   deep water, the map's edge, slopes no troop climbs and whatever else the
   unit cannot cross (dense forest, shallow water, hills for machines).
   A half-cell sample's coarse flag uses touching 1 m logical cells; actual
   soldier footprints and grid crossings additionally check the exact MLG
   cells, so blocked-cell edges cannot be traversed. Heights then guard
   against sheer drops (options.maxGrade/maxStep).
   Without it (tests, tools) water comes from the H2O triangles with fords
   where the river is painted see-through, and steep or rock-painted ground
   from the heights and options.rockCoverage.
   Mission structures (options.structures, see world/structures.js) add a
   bridge's walkway over the water and its solid stonework; fortresses
   (world/fortress.js) add raised wall walkways, ladders up to them, solid
   wall sides and gates (open ground where options.gateOpen(gate) allows). */
(function(root, factory) {
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PraetoriansNavigation=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const SQRT2=Math.SQRT2;
 const REGION_SEARCH_THRESHOLD=16384;
 // Bound resumable automatic searches across every unit navigation profile,
 // not once per profile. Arrays are the dominant retained search allocation.
 const PAUSED_SEARCH_BYTES=64*1024*1024,pausedSearchPool=new Map();let pausedSearchBytes=0;
 const FULL_ROUTE_BYTES=16*1024*1024,fullRoutePool=new Map();let fullRouteBytes=0;
 const NEIGHBORS=[[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,SQRT2],[-1,1,SQRT2],[1,-1,SQRT2],[-1,-1,SQRT2]];
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
 // The PVE tile has a centre vertex and eight triangles, in the editor's
 // fan order {4,3,0,1,2,5,8,7,6,3}. Its surface is *not* bilinear.
 // This sampler is shared with the viewer so feet, navigation and effects
 // use the same heightfield; HD cooked terrain may have separate detail.
 const FAN_EDGE=[[3,0],[0,1],[1,2],[2,5],[5,8],[8,7],[7,6],[6,3]];
 const FAN_X=[0,.5,1,0,.5,1,0,.5,1];
 const FAN_Z=[0,0,0,.5,.5,.5,1,1,1];
 function sampleHeight(raw,width,depth,step,x,z){
  const columns=Math.round(width/step)+1,rows=Math.round(depth/step)+1;
  const gx=clamp(x/step,0,columns-1),gz=clamp(z/step,0,rows-1);
  // Non-PVE grids retain their original bilinear fallback.
  if(Math.abs(step-.5)>1e-8||columns<3||rows<3){
   const ix=Math.min(columns-2,Math.floor(gx)),iz=Math.min(rows-2,Math.floor(gz));
   const u=gx-ix,v=gz-iz,i=iz*columns+ix;
   return raw[i]*(1-u)*(1-v)+raw[i+1]*u*(1-v)+raw[i+columns]*(1-u)*v+raw[i+columns+1]*u*v;
  }
  const tileX=Math.min(columns-3,Math.floor(gx/2)*2),tileZ=Math.min(rows-3,Math.floor(gz/2)*2);
  const u=clamp((gx-tileX)/2,0,1),v=clamp((gz-tileZ)/2,0,1);
  let wedge;
  if(v<=.5)wedge=u<=.5?(u<=v?0:1):(u+v>=1?3:2);
  else wedge=u>=.5?(u>=v?4:5):(u+v>=1?6:7);
  const [a,b]=FAN_EDGE[wedge],ax=FAN_X[a]-.5,az=FAN_Z[a]-.5,bx=FAN_X[b]-.5,bz=FAN_Z[b]-.5;
  const du=u-.5,dv=v-.5,det=ax*bz-bx*az;
  const wa=(du*bz-dv*bx)/det,wb=(dv*ax-du*az)/det;
  const base=tileZ*columns+tileX;
  return raw[base+columns+1]*(1-wa-wb)+
   raw[base+((a/3)|0)*columns+(a%3)]*wa+
   raw[base+((b/3)|0)*columns+(b%3)]*wb;
 }
 class MinHeap {
  constructor(){this.data=[];}
  push(node,score){const a=this.data;let i=a.length;a.push([node,score]);while(i){const p=(i-1)>>1;if(a[p][1]<=score)break;a[i]=a[p];i=p;}a[i]=[node,score];}
  pop(){const a=this.data,top=a[0],last=a.pop();if(a.length){let i=0;while(true){let ch=i*2+1;if(ch>=a.length)break;if(ch+1<a.length&&a[ch+1][1]<a[ch][1])ch++;if(a[ch][1]>=last[1])break;a[i]=a[ch];i=ch;}a[i]=last;}return top;}
  get length(){return this.data.length;}
 }
 function create(map, options={}){
  // Automatic orders may impose a deterministic amount of routing work.
  // Throw only this private sentinel, caught at the explicit outer scope;
  // ordinary player calls and collision checks keep their original behavior.
  const WORK_BUDGET_EXHAUSTED={};
  let activeBudget=null,lastBudgetExhausted=false;
  const budgetLines=new Map(),completePlans=new Map(),finishingPlans=new Map();
  function retain(cache,key,value,limit){
   cache.delete(key);cache.set(key,value);
   while(cache.size>limit)cache.delete(cache.keys().next().value);
   return value;
  }
  function forgetRoute(cache,key){
   const value=cache.get(key),entry=value&&fullRoutePool.get(value);
   if(entry){fullRouteBytes-=entry.bytes;fullRoutePool.delete(value);}
   cache.delete(key);
  }
  function retainRoute(cache,key,value,limit){
   forgetRoute(cache,key);
   const points=value.path?value.path.length+value.smoothed.length:value.points.length;
   const entry={cache,key,bytes:512+points*64};
   cache.set(key,value);fullRoutePool.set(value,entry);fullRouteBytes+=entry.bytes;
   while(cache.size>limit)forgetRoute(cache,cache.keys().next().value);
   while(fullRouteBytes>FULL_ROUTE_BYTES&&fullRoutePool.size){
    const [old,meta]=fullRoutePool.entries().next().value;
    if(meta.cache.get(meta.key)===old)forgetRoute(meta.cache,meta.key);
    else{fullRoutePool.delete(old);fullRouteBytes-=meta.bytes;}
   }
   return value;
  }
  function spendWork(amount=1){
   if(!activeBudget)return;
   if(activeBudget.remaining+1e-9<amount){activeBudget.exhausted=true;throw WORK_BUDGET_EXHAUSTED;}
   activeBudget.remaining=Math.max(0,activeBudget.remaining-amount);workUnits+=amount;
  }
  function withWorkBudget(maxUnits,callback,settings={}){
   if(!Number.isFinite(maxUnits)||maxUnits<0||typeof callback!=='function')throw new Error('Navigation work budget needs a nonnegative finite allowance and callback');
   const parent=activeBudget,scope={remaining:Math.min(maxUnits,parent?.remaining??Infinity),exhausted:false,allowPartial:!!settings.allowPartial};
   scope.reserve=Math.min(1024,scope.remaining*.25);
   const allowance=scope.remaining;activeBudget=scope;
   try{return callback();}
   catch(error){if(error!==WORK_BUDGET_EXHAUSTED)throw error;scope.exhausted=true;return {ok:false,reason:'work-budget',deferred:true};}
   finally{
    activeBudget=parent;
    if(parent){parent.remaining=Math.max(0,parent.remaining-(allowance-scope.remaining));parent.exhausted=parent.exhausted||scope.exhausted;}
    lastBudgetExhausted=scope.exhausted;
   }
  }
  const width=map.width,depth=map.depth,step=map.terrain.spacing||.5;
  const columns=Math.round(width/step)+1, rows=Math.round(depth/step)+1, size=columns*rows;
  const raw=map.terrain.heights;
  if(raw.length!==size)throw new Error('Unsupported PVE height grid dimensions');
  // Separate "may occupy this ground" from "may cross this incline".
  // The v1.4 regression expanded every steep triangle into four surrounding
  // blocked grid vertices. This closed normal roads running beside cliffs.
  const maxGrade=options.maxGrade ?? .68;
  const maxStep=options.maxStep ?? .38;
  const maxCrossGrade=options.maxCrossGrade ?? .48;
  const maxCrossStep=options.maxCrossStep ?? .24;
  // Painted cliffs: optional per-vertex rock coverage (terrain-surface.js).
  // Rock-painted ground is held to a stricter grade, blended by coverage, so
  // low-relief cliff bands block while flat painted rock stays walkable.
  const logical=options.logical&&options.logical.values?.length===options.logical.width*options.logical.depth?options.logical:null;
  const rock=!logical&&options.rockCoverage?.length===size?options.rockCoverage:null;
  const rockGrade=options.rockGrade ?? .1;
  const walkable=new Uint8Array(size),water=new Uint8Array(size),slope=new Uint8Array(size),cliff=new Uint8Array(size);
  const index=(x,z)=>z*columns+x;
  const worldHeight=(x,z)=>sampleHeight(raw,width,depth,step,x,z);
  // Exact per-cell MLG passability, used in addition to the half-metre raster.
  // A node can sit on a passable corner yet a soldier 0.25 m away be inside
  // a BLOCKED cell. The sample raster alone must not decide collisions.
  // The original MLG marks some terrain as forbidden because of a slope
  // flag, even when the *actual* high-resolution heightfield has a shallow,
  // continuous ramp. Infantry formations may use those ramps: classify the
  // complete 1m MLG cell by its real surface, never by its pink paint alone.
  // FIN_ESCENARIO, hard scenery, water, denied terrain types and true cliffs
  // remain impassable. No relaxation is applied to siege-machine profiles.
  const logicalBlocked=logical?new Uint8Array(logical.width*logical.depth):null;
  const gentleHill=logical?new Uint8Array(logical.width*logical.depth):null;
  const hillMarch=!!options.allowGentleHills&&!!logical;
  const HILL_FLAGS=0x20|0x40|0x80;
  function hillGeometrySafe(cx,cz){
   // Test the centre, four quarter points, and their neighbours in all eight
   // directions. This catches hidden drops at MLG tile boundaries instead of
   // declaring a steep ledge safe because its centre sample was level.
   const x=cx+.5,z=cz+.5;
   if(x<1.1||z<1.1||x>width-1.1||z>depth-1.1)return false;
   // Include the neighbouring half-cell: a flat plateau touching a sheer
   // face must not be mislabeled as an ordinary climbable hillside.
   for(const ox of [-.5,-.25,.25,.5])for(const oz of [-.5,-.25,.25,.5]){
    const px=x+ox,pz=z+oz,h=worldHeight(px,pz);
    for(const dx of [-.25,0,.25])for(const dz of [-.25,0,.25]){
     if(!dx&&!dz)continue;
     const distance=Math.hypot(dx,dz);
     if(Math.abs(worldHeight(px+dx,pz+dz)-h)>distance*.75+.014)return false;
    }
   }
   return true;
  }
  function eligibleHillCell(value,cx,cz){
   if(!hillMarch||!logical.rules.blocked(value)||logical.rules.deep(value))return false;
   const type=value>>>27;
   if(logical.rules.types.has(type))return false;
   // Only the slope restriction may be bypassed: never a hard object, world
   // edge, wall, or any extra unit-specific forbidden bit.
   if(!(value&HILL_FLAGS)||!(value&logical.rules.mask&HILL_FLAGS))return false;
   if(value&logical.rules.mask&~HILL_FLAGS)return false;
   if(value&(0x1|0x8000|0x100000))return false;
   return hillGeometrySafe(cx,cz);
  }
  if(logical)for(let k=0;k<logicalBlocked.length;k++){
   const value=logical.values[k],cx=k%logical.width,cz=(k/logical.width)|0;
   if(eligibleHillCell(value,cx,cz))gentleHill[k]=1;
   else logicalBlocked[k]=(logical.rules.blocked(value)||logical.rules.deep(value))?1:0;
  }
  const terrainCellBlocked=(cx,cz)=>logicalBlocked[clamp(cz,0,logical.depth-1)*logical.width+clamp(cx,0,logical.width-1)]!==0;
  function allTouchedLogicalBlocked(x,z){
   const px=x*step,pz=z*step;
   const xs=px%1===0?[px-1,px]:[Math.floor(px)];
   const zs=pz%1===0?[pz-1,pz]:[Math.floor(pz)];
   return xs.every(cx=>zs.every(cz=>terrainCellBlocked(cx,cz)));
  }
  function exactLogicalBlocked(x,z,radius=0){
   if(!logical)return false;
   const r=Math.max(0,radius),lw=logical.width,ld=logical.depth;
   const x0=clamp(Math.floor(x-r),0,lw-1),x1=clamp(Math.floor(x+r),0,lw-1);
   const z0=clamp(Math.floor(z-r),0,ld-1),z1=clamp(Math.floor(z+r),0,ld-1);
   for(let cz=z0;cz<=z1;cz++)for(let cx=x0;cx<=x1;cx++){
    spendWork(.02);
    if(!logicalBlocked[cz*lw+cx])continue;
    const px=clamp(x,cx,cx+1),pz=clamp(z,cz,cz+1);
    if((px-x)**2+(pz-z)**2>r*r+1e-12)continue;
    // Raised walls, ladders, bridges and traversable gates explicitly replace
    // the original cell's terrain; keep their own geometry-based restrictions.
    const structure=options.structures?.classify(px,pz);
    if(structure&&(['deck','wall','ladder'].includes(structure.kind)||
     (structure.kind==='gate'&&options.gateOpen?.(structure.gate))))continue;
    return true;
   }
   return false;
  }
  // Rasterize the actual H2O triangles instead of approximating the river from a thumbnail.
  // Sample grid vertices plus edges: water should remain blocked across tile boundaries.
  const pointInside=(px,pz,ax,az,bx,bz,cx,cz)=>{
   const ab=(bx-ax)*(pz-az)-(bz-az)*(px-ax),bc=(cx-bx)*(pz-bz)-(cz-bz)*(px-bx),ca=(ax-cx)*(pz-cz)-(az-cz)*(px-cx);
   return !(ab< -1e-7||bc< -1e-7||ca< -1e-7) || !(ab>1e-7||bc>1e-7||ca>1e-7);
  };
  let rasterTriangles=0;
  // Water surface opacity per sample (H2O vertex alpha: the translucent fade).
  const opacity=new Float32Array(size).fill(-1);
  // Logical cells are 1 m: a sample on a cell edge touches two (or four);
  // it has a property only when every cell it touches has it.
  function everyCell(x,z,test){
   const px=x*step,pz=z*step,lw=logical.width,ld=logical.depth;
   const xs=px%1===0?[px-1,px]:[Math.floor(px)],zs=pz%1===0?[pz-1,pz]:[Math.floor(pz)];
   for(const cx of xs)for(const cz of zs){
    const v=logical.values[clamp(cz,0,ld-1)*lw+clamp(cx,0,lw-1)];
    if(!test(v))return false;
   }
   return true;
  }
  if(!logical)for(const group of map.water?.groups||[]){
   const p=group.positions||[],tri=group.indices||[],colors=group.colors;
   for(let t=0;t<tri.length;t+=3){
    const ia=tri[t]*3,ib=tri[t+1]*3,ic=tri[t+2]*3;
    const ax=p[ia],az=p[ia+2],bx=p[ib],bz=p[ib+2],cx=p[ic],cz=p[ic+2];
    if(![ax,az,bx,bz,cx,cz].every(Number.isFinite))continue;
    let x0=clamp(Math.floor(Math.min(ax,bx,cx)/step)-1,0,columns-1),x1=clamp(Math.ceil(Math.max(ax,bx,cx)/step)+1,0,columns-1);
    let z0=clamp(Math.floor(Math.min(az,bz,cz)/step)-1,0,rows-1),z1=clamp(Math.ceil(Math.max(az,bz,cz)/step)+1,0,rows-1);
    const det=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
     const px=x*step,pz=z*step;
     if(!pointInside(px,pz,ax,az,bx,bz,cx,cz))continue;
     const i=index(x,z);water[i]=1;
     if(colors&&Math.abs(det)>1e-12){
      const w0=clamp(((bz-cz)*(px-cx)+(cx-bx)*(pz-cz))/det,0,1),w1=clamp(((cz-az)*(px-cx)+(ax-cx)*(pz-cz))/det,0,1),w2=clamp(1-w0-w1,0,1);
      const a=w0*colors[tri[t]*4+3]+w1*colors[tri[t+1]*4+3]+w2*colors[tri[t+2]*4+3];
      opacity[i]=Math.max(opacity[i],a);
     }
    }
    rasterTriangles++;
   }
  }
  // Fords: where the river is painted see-through right across its middle
  // (the sandy road shows under the water), soldiers can wade. Banks also
  // fade out, so a ford core must lie well inside the river; cores are then
  // joined to the banks through the surrounding shallow water.
  const ford=new Uint8Array(size);
  if(logical){
   // Deep water is the river; shallow water (fords, frozen ponds) is ground
   // for whoever may wade (ford marks it for display).
   const shallow=v=>(v>>>27)===3;
   for(let z=0;z<rows;z++)for(let x=0;x<columns;x++){
    const i=index(x,z);
    if(everyCell(x,z,logical.rules.deep))water[i]=1;
    else if(everyCell(x,z,shallow))ford[i]=1;
   }
  }else{
   const fordAlpha=options.fordAlpha ?? .78,coreDepth=options.fordCoreDepth ?? 1.25,reach=options.fordReach ?? 1.5,minCore=options.fordMinCore ?? 8,border=1.5;
   const shallow=i=>water[i]&&opacity[i]>=0&&opacity[i]<fordAlpha;
   const shore=new Float32Array(size).fill(Infinity),queue=[];
   for(let i=0;i<size;i++)if(!water[i]){shore[i]=0;queue.push(i);}
   for(let h=0;h<queue.length;h++){
    const i=queue[h],x=i%columns,z=(i/columns)|0;
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
     const nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=columns||nz>=rows)continue;
     const j=index(nx,nz);if(shore[j]>shore[i]+step){shore[j]=shore[i]+step;queue.push(j);}
    }
   }
   const isCore=new Uint8Array(size);
   for(let i=0;i<size;i++){
    const x=(i%columns)*step,z=((i/columns)|0)*step;
    if(x<border||z<border||x>width-border||z>depth-border)continue;
    if(shallow(i)&&shore[i]>=coreDepth)isCore[i]=1;
   }
   // Keep only real crossings: clusters of several core samples.
   const seen=new Uint8Array(size),reached=new Float32Array(size).fill(Infinity),grow=[];
   for(let i=0;i<size;i++){
    if(!isCore[i]||seen[i])continue;
    const cluster=[i];seen[i]=1;
    for(let h=0;h<cluster.length;h++){
     const c=cluster[h],x=c%columns,z=(c/columns)|0;
     for(const [dx,dz] of NEIGHBORS){
      const nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=columns||nz>=rows)continue;
      const j=index(nx,nz);if(isCore[j]&&!seen[j]){seen[j]=1;cluster.push(j);}
     }
    }
    if(cluster.length>=minCore)for(const c of cluster){reached[c]=0;ford[c]=1;grow.push(c);}
   }
   for(let h=0;h<grow.length;h++){
    const i=grow[h],x=i%columns,z=(i/columns)|0;
    for(const [dx,dz,distance] of NEIGHBORS){
     const nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=columns||nz>=rows)continue;
     const j=index(nx,nz),d=reached[i]+distance*step;
     if(!shallow(j)||d>reach||d>=reached[j])continue;
     reached[j]=d;ford[j]=1;grow.push(j);
    }
   }
   for(let i=0;i<size;i++)if(ford[i])water[i]=0;
  }
  // Bridges: the walkway is dry, walkable ground over the river; the
  // stonework beside it is solid. Heights under the walkway were already
  // raised to the deck by the caller (structures.patchHeights).
  // Wall walkways (1) and ladders (2) are raised ground: moving between two
  // raised samples ignores the grade (stairs, the ladder's rungs); between
  // raised and plain ground the full step applies, so walls are only reached
  // by their ladders.
  // Village CASILLAS are hard collision, but NOT a formation-radius exclusion
  // zone: units spawned close to the village must be able to walk away.
  // Other structures, cliffs and water continue using normal clearance.
  const villageSolid=new Uint8Array(size);
  const deck=new Uint8Array(size),solid=new Uint8Array(size),level=new Uint8Array(size),gateCells=new Uint8Array(size),barred=new Uint8Array(size);
  if(options.structures)for(let z=0;z<rows;z++)for(let x=0;x<columns;x++){
   const hit=options.structures.classify(x*step,z*step);if(!hit)continue;
   const i=index(x,z);
   if(hit.kind==='deck'){deck[i]=1;water[i]=0;ford[i]=0;}
   else if(hit.kind==='wall'||hit.kind==='ladder'){level[i]=hit.kind==='wall'?1:2;water[i]=0;ford[i]=0;}
   else if(hit.kind==='gate'){gateCells[i]=1;if(!options.gateOpen?.(hit.gate))solid[i]=1;}
   else {solid[i]=1;if(hit.village)villageSolid[i]=1;}
  }
  // Terrain vertices can touch a steep triangle while remaining on a flat
  // road. Flag only the immediate vertex gradient here. The *actual traversed
  // direction* has a stricter independent grade check in lineClear/A* below.
  for(let z=0;z<rows;z++)for(let x=0;x<columns;x++){
   const i=index(x,z);
   if(x===0||z===0||x===columns-1||z===rows-1){slope[i]=1;continue;}
   // A bridge deck is stonework above the ground: the rock painted on the
   // river banks beneath it says nothing about the walkway.
   const coverage=rock&&!deck[i]?rock[i]:0,grade=maxGrade+(rockGrade-maxGrade)*coverage,stepLimit=maxStep*grade/maxGrade;
   let steep=false;
   for(const [dx,dz] of NEIGHBORS){
    // Raised samples are never steep themselves; plain ground right beside a
    // wall top or a ladder's upper rungs is (the foot of the wall).
    if(level[i])break;
    // On a walkway only the deck itself counts: its edge drops to the water
    // behind a parapet, which is not ground anybody walks down.
    if(deck[i]&&!deck[index(x+dx,z+dz)])continue;
    const horizontal=Math.hypot(dx,dz)*step,rise=Math.abs(raw[i]-raw[index(x+dx,z+dz)]);
    if(rise>stepLimit*Math.hypot(dx,dz)||rise/horizontal>grade){steep=true;break;}
   }
   slope[i]=steep?1:0;
   if(steep&&coverage>0){
    // Mark samples that only the painted-rock rule blocks, for diagnostics.
    let bare=false;
    for(const [dx,dz] of NEIGHBORS){
     const rise=Math.abs(raw[i]-raw[index(x+dx,z+dz)]);
     if(rise>maxStep*Math.hypot(dx,dz)||rise/(Math.hypot(dx,dz)*step)>maxGrade){bare=true;break;}
    }
    cliff[i]=bare?0:1;
   }
   if(logical&&!water[i]&&!deck[i]&&!level[i]&&!gateCells[i]&&allTouchedLogicalBlocked(x,z)){barred[i]=1;solid[i]=1;}
   walkable[i]=!(steep||water[i]||solid[i])?1:0;
  }
  // Ignore *only village* footprint cells when computing the stand-off
  // distance. A village remains solid at its own cells/positions, but it does
  // not generate a halo based on the squad's formation radius. This is
  // separate from movement collision, which still tests the exact footprint.
  const hardBlocked=i=>!!(slope[i]||water[i]||barred[i]||(solid[i]&&!villageSolid[i]));
  // Two chamfer passes approximate distance from an impassable node. Radius checks
  // let the entire formation (not just its leader) steer clear of cliffs and water.
  const clearance=new Uint16Array(size);
  // This is NOT a collision halo. Village footprints remain exact for
  // canStand()/lineClear(). Only the *planned centre route* uses the distance
  // to a village, because a 30-person formation has width: passing its centre
  // 10 cm from a house leads to soldiers walking into the house and stalling.
  const villageDistance=new Uint16Array(size);
  function rebuildClearance(){
   clearance.fill(60000);
   for(let z=0;z<rows;z++)for(let x=0;x<columns;x++){
    const i=index(x,z);if(hardBlocked(i)){clearance[i]=0;continue;}
    let v=clearance[i];if(x)v=Math.min(v,clearance[i-1]+10);if(z)v=Math.min(v,clearance[i-columns]+10);
    if(x&&z)v=Math.min(v,clearance[i-columns-1]+14);
    if(x<columns-1&&z)v=Math.min(v,clearance[i-columns+1]+14);
    clearance[i]=v;
   }
   for(let z=rows-1;z>=0;z--)for(let x=columns-1;x>=0;x--){
    const i=index(x,z);let v=clearance[i];if(x<columns-1)v=Math.min(v,clearance[i+1]+10);
    if(z<rows-1)v=Math.min(v,clearance[i+columns]+10);
    if(x<columns-1&&z<rows-1)v=Math.min(v,clearance[i+columns+1]+14);
    if(x&&z<rows-1)v=Math.min(v,clearance[i+columns-1]+14);
    clearance[i]=v;
   }
   villageDistance.fill(60000);
   for(let z=0;z<rows;z++)for(let x=0;x<columns;x++){
    const i=index(x,z);if(villageSolid[i]){villageDistance[i]=0;continue;}
    let v=villageDistance[i];if(x)v=Math.min(v,villageDistance[i-1]+10);
    if(z)v=Math.min(v,villageDistance[i-columns]+10);
    if(x&&z)v=Math.min(v,villageDistance[i-columns-1]+14);
    if(x<columns-1&&z)v=Math.min(v,villageDistance[i-columns+1]+14);
    villageDistance[i]=v;
   }
   for(let z=rows-1;z>=0;z--)for(let x=columns-1;x>=0;x--){
    const i=index(x,z);let v=villageDistance[i];
    if(x<columns-1)v=Math.min(v,villageDistance[i+1]+10);
    if(z<rows-1)v=Math.min(v,villageDistance[i+columns]+10);
    if(x<columns-1&&z<rows-1)v=Math.min(v,villageDistance[i+columns+1]+14);
    if(x&&z<rows-1)v=Math.min(v,villageDistance[i+columns-1]+14);
    villageDistance[i]=v;
   }
  }
  rebuildClearance();
  const node=(x,z)=>index(clamp(Math.round(x/step),0,columns-1),clamp(Math.round(z/step),0,rows-1));
  // Along a walkway, onto or along a ladder: no grade limit.
  const climbs=(a,b)=>(a&&b)||a===2||b===2;
  const inBounds=(x,z)=>x>=0&&z>=0&&x<=width&&z<=depth;
  // SOFT EDGE ESCAPE (command-start only): buildings, water and the map border
  // are never softened. A soldier already intersecting a cliff/MLG edge may
  // take small steps toward clear ground; no clear soldier may enter it.
  // This is separate from the ordinary A* passability and its clearance.
  const softDepth=new Uint16Array(size);
  softDepth.fill(60000);
  for(let z=0;z<rows;z++)for(let x=0;x<columns;x++){
   const i=index(x,z);
   if(!slope[i]&&!barred[i])softDepth[i]=0;
   else{
    if(x)softDepth[i]=Math.min(softDepth[i],softDepth[i-1]+10);
    if(z)softDepth[i]=Math.min(softDepth[i],softDepth[i-columns]+10);
    if(x&&z)softDepth[i]=Math.min(softDepth[i],softDepth[i-columns-1]+14);
    if(x<columns-1&&z)softDepth[i]=Math.min(softDepth[i],softDepth[i-columns+1]+14);
   }
  }
  for(let z=rows-1;z>=0;z--)for(let x=columns-1;x>=0;x--){
   const i=index(x,z);
   if(x<columns-1)softDepth[i]=Math.min(softDepth[i],softDepth[i+1]+10);
   if(z<rows-1)softDepth[i]=Math.min(softDepth[i],softDepth[i+columns]+10);
   if(x<columns-1&&z<rows-1)softDepth[i]=Math.min(softDepth[i],softDepth[i+columns+1]+14);
   if(x&&z<rows-1)softDepth[i]=Math.min(softDepth[i],softDepth[i+columns-1]+14);
  }
  function edgeRisk(x,z,radius=.06){
   spendWork(.05);
   if(!inBounds(x,z))return Infinity;
   const i=node(x,z),r=Math.max(0,radius);
   if(slope[i]||barred[i]||exactLogicalBlocked(x,z,0)){
    // Only rescue a shallow overlap with the *edge*, never a squad deep
    // inside an entire mountain. Inverse distance makes outward progress
    // measurable even when both locations are inside blocked samples.
    return r+softDepth[i]*step/10;
   }
   let risk=Math.max(0,r-clearance[i]*step/10);
   // At 1m MLG cell boundaries the half-metre raster is intentionally
   // permissive. The exact cell footprint is not: include its distance
   // here or a squad radius can be rejected while the risk looks like zero.
   if(logical&&r>0){
    for(let cz=Math.max(0,Math.floor(z-r)-1);cz<=Math.min(logical.depth-1,Math.floor(z+r)+1);cz++)
     for(let cx=Math.max(0,Math.floor(x-r)-1);cx<=Math.min(logical.width-1,Math.floor(x+r)+1);cx++){
      spendWork(.02);
      if(!logicalBlocked[cz*logical.width+cx]||logical.rules.deep(logical.values[cz*logical.width+cx]))continue;
      const gap=Math.hypot(x-clamp(x,cx,cx+1),z-clamp(z,cz,cz+1));
      risk=Math.max(risk,Math.max(0,r-gap));
     }
   }
   return risk;
  }
  function hardPhysicalBlocked(x,z,radius=0){
   if(!inBounds(x,z)||x-radius<0||z-radius<0||x+radius>width||z+radius>depth)return true;
   const center=node(x,z);
   if(water[center]||(solid[center]&&!barred[center]&&!slope[center]))return true;
   const hit=options.structures?.classify(x,z);
   if(hit&&hit.kind!=='deck'&&hit.kind!=='wall'&&hit.kind!=='ladder'&&
     (hit.kind!=='gate'||!options.gateOpen?.(hit.gate)))return true;
   if(logical){
    // Respect the whole soldier footprint at the river boundary, not just
    // its centre (1m MLG cells can be half a meter from the nearest sample).
    for(let cz=Math.max(0,Math.floor(z-radius));cz<=Math.min(logical.depth-1,Math.floor(z+radius));cz++)
     for(let cx=Math.max(0,Math.floor(x-radius));cx<=Math.min(logical.width-1,Math.floor(x+radius));cx++){
      if(!logical.rules.deep(logical.values[cz*logical.width+cx]))continue;
      const px=clamp(x,cx,cx+1),pz=clamp(z,cz,cz+1);
      if(Math.hypot(x-px,z-pz)<=radius+1e-9)return true;
     }
   }
   return false;
  }
  // Only the authored slope/MLG *fringe* enables the escape feature. A deep
  // river bank without a cliff nearby is not a candidate for soft recovery.
  function hasSoftFringe(x,z,radius){
   const r=radius+.5;
   const x0=clamp(Math.floor((x-r)/step),0,columns-1),x1=clamp(Math.ceil((x+r)/step),0,columns-1);
   const z0=clamp(Math.floor((z-r)/step),0,rows-1),z1=clamp(Math.ceil((z+r)/step),0,rows-1);
   for(let iz=z0;iz<=z1;iz++)for(let ix=x0;ix<=x1;ix++){
    spendWork(.02);
    const i=index(ix,iz);
    if((slope[i]||barred[i])&&Math.hypot(ix*step-x,iz*step-z)<=r)return true;
   }
   if(logical)for(let iz=Math.max(0,Math.floor(z-r));iz<=Math.min(logical.depth-1,Math.floor(z+r));iz++)
    for(let ix=Math.max(0,Math.floor(x-r));ix<=Math.min(logical.width-1,Math.floor(x+r));ix++){
     spendWork(.02);
     const i=iz*logical.width+ix;
     if(logicalBlocked[i]&&!logical.rules.deep(logical.values[i])&&
      Math.hypot(x-clamp(x,ix,ix+1),z-clamp(z,iz,iz+1))<=r)return true;
    }
   return false;
  }
  // Used only for soldiers ALREADY crossing an authored steep/MLG fringe,
  // not as a substitute for nav.canStand. Monotone risk and the short grace
  // limit prevent a step from going deeper into a mountain. Hard objects and
  // river are rejected at every sample.
  function edgeStep(from,to,radius=.06){
   if(lineClear(from,to,radius))return true;
   const risk=edgeRisk(from.x,from.z,radius);
   // The raster can reject a short sub-cell step even when BOTH endpoints
   // are strictly walkable (nearest-node aliasing at a 1m MLG boundary).
   // In the tiny rescue corridor validate these intermediate *real* positions
   // instead of the rounded grid vertices.
   if(risk<=.005){
    const pieces=Math.max(1,Math.ceil(dist(from,to)/.075));
    for(let i=0;i<=pieces;i++){
     const t=i/pieces,x=from.x+(to.x-from.x)*t,z=from.z+(to.z-from.z)*t;
     if(hardPhysicalBlocked(x,z,radius))return false;
     // A <= 5mm existing overlap is a boundary rounding artefact; it may
     // disappear in the direction of the step, but cannot grow or cross a wall.
     if(!canStand(x,z,radius)&&
        (canStand(from.x,from.z,radius)||edgeRisk(x,z,radius)>.006))return false;
    }
    return true;
   }
   if(risk>1.2||!Number.isFinite(risk))return false;
   const pieces=Math.max(1,Math.ceil(dist(from,to)/.075));
   let peak=risk;
   for(let i=0;i<=pieces;i++){
    const t=i/pieces,x=from.x+(to.x-from.x)*t,z=from.z+(to.z-from.z)*t;
    if(hardPhysicalBlocked(x,z,radius))return false;
    peak=Math.max(peak,edgeRisk(x,z,radius));
   }
   const ending=edgeRisk(to.x,to.z,radius);
   return peak<=risk+.115&&ending<=risk+.045;
  }
  // A queried world position can be up to half a grid diagonal from its
  // nearest sample. Use a conservative allowance instead of rounding across
  // the edge of a cliff. Radius already includes the furthest soldier slot.
  // v1.4 added 0.36 world units on top of each squad radius, creating
  // artificial barriers across winding roads. Keep a small raster allowance;
  // runtime swept footstep checks enforce the precise local collision.
  const radiusQuantized=(radius)=>Math.round((radius+step*.18)/step*10);
  function structureSolidAt(x,z){
   const hit=options.structures?.classify(x,z);
   return !!hit&&hit.kind!=='deck'&&hit.kind!=='wall'&&hit.kind!=='ladder'&&
    (hit.kind!=='gate'||!options.gateOpen?.(hit.gate));
  }
  function canStand(x,z,radius=.6){
   // Check the real circular footprint against the finite map, before using
   // the grid's conservative clearance mask. A point inside the world does
   // not imply that the soldier's feet are inside it.
   radius=Math.max(0,radius);
   if(!inBounds(x,z)||x-radius<0||z-radius<0||x+radius>width||z+radius>depth||
      exactLogicalBlocked(x,z,radius))return false;
   const gx=Math.round(x/step),gz=Math.round(z/step),i=index(gx,gz);
   if(hardBlocked(i)||clearance[i]<=radiusQuantized(radius))return false;
   // The raster alone rounds the edge of a building to a .5 m sample.
   // A soldier can otherwise stand *inside* its actual wall even though
   // the nearest grid vertex is free. Check the true shape, and sweep the
   // member's circular contact points when near an occupied structure.
   if(options.structures){
    if(structureSolidAt(x,z))return false;
    const proximity=Math.min(clearance[i],villageDistance[i])*step/10;
    if(radius>0&&proximity<=radius+step*.9){
     for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],
      [.70710678,.70710678],[.70710678,-.70710678],[-.70710678,.70710678],[-.70710678,-.70710678]]){
      if(structureSolidAt(x+dx*radius,z+dz*radius))return false;
     }
    }
   }
   return true;
  }
  // A* and component floods query the same exact logical footprints many
  // times. Their nodes and crossing midpoints lie on the half-grid lattice;
  // remember the original test there, without weakening world-space sweeps.
  // Two bits hold unknown/blocked/clear, about one grid byte per clearance.
  const exactGridCache=new Map(),exactColumns=columns*2-1;
  const exactBytes=Math.ceil(exactColumns*(rows*2-1)/4);
  function gridLogicalClear(qx,qz,required){
   if(!logical)return true;
   let cache=exactGridCache.get(required);
   if(!cache){
    if(exactGridCache.size>=8)exactGridCache.delete(exactGridCache.keys().next().value);
    cache=new Uint8Array(exactBytes);exactGridCache.set(required,cache);
   }
   const i=qz*exactColumns+qx,at=i>>2,shift=(i&3)*2,state=(cache[at]>>shift)&3;
   if(state)return state===2;
   const clear=!exactLogicalBlocked(qx*step*.5,qz*step*.5,Math.max(0,required/10*step-step*.18));
   cache[at]|=(clear?2:1)<<shift;return clear;
  }
  function invalidateLogicalPermissions(bounds){
   if(!bounds){exactGridCache.clear();return;}
   // These cached tests only query structure overrides inside their logical
   // footprint. A far-away building cannot change them. Clear the affected
   // centers, inflated by each exact tested radius; retain the rest.
   const half=step*.5,lastX=exactColumns-1,lastZ=rows*2-2;
   for(const [required,cache] of exactGridCache){
    const radius=Math.max(0,required/10*step-step*.18);
    const x0=clamp(Math.floor((bounds.xMin-radius)/half),0,lastX),x1=clamp(Math.ceil((bounds.xMax+radius)/half),0,lastX);
    const z0=clamp(Math.floor((bounds.zMin-radius)/half),0,lastZ),z1=clamp(Math.ceil((bounds.zMax+radius)/half),0,lastZ);
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
     const i=z*exactColumns+x;cache[i>>2]&=~(3<<((i&3)*2));
    }
   }
  }
  function gridCanStand(x,z,required,ignoreVillage=false){
   spendWork(.05);
   if(x<0||z<0||x>=columns||z>=rows)return false;
   const i=index(x,z);
   if((!ignoreVillage&&!walkable[i])||hardBlocked(i)||clearance[i]<=required)return false;
   return gridLogicalClear(x*2,z*2,required);
  }
  function nearestCell(x,z,radius,maxDistance){
   const cx=clamp(Math.round(x/step),0,columns-1),cz=clamp(Math.round(z/step),0,rows-1);
   const limit=Math.ceil(maxDistance/step),required=radiusQuantized(radius);
   let best=null,bestD=Infinity;
   for(let dz=-limit;dz<=limit;dz++)for(let dx=-limit;dx<=limit;dx++){
    spendWork(.1);
    const gx=cx+dx,gz=cz+dz;if(!gridCanStand(gx,gz,required))continue;
    const candidate={x:gx*step,z:gz*step},d=dist(candidate,{x,z});
    if(d<=maxDistance+step*.25 && d<bestD){best=candidate;bestD=d;}
   }
   return best;
  }
  function lineClear(a,b,radius){
   // Visit every rounded grid cell touched by the segment. Uniform height
   // samples alone can miss a tiny crossing at a blocked corner, returning
   // a route which later fails when soldiers take smaller walking steps.
   const dx=b.x-a.x,dz=b.z-a.z,sx=Math.sign(dx),sz=Math.sign(dz),required=radiusQuantized(radius);
   const d=dist(a,b);
   // Soldiers move only a few centimetres each frame. Their *exact* swept
   // footprint, sampled below, is authoritative when both ends remain inside
   // the same 1-metre logical cell. Walking the rounded half-metre A* raster
   // for these short steps can reject valid movement at a 0.25-metre rounding
   // boundary: the raster vertex may touch a blocked adjacent MLG cell even
   // when the soldier never comes near its footprint. Keep normal grid/corner
   // traversal for every longer step, cell boundary and wider formation.
   const exactShortStep=radius<=.15 && d<=step*.45 &&
     Math.floor(a.x)===Math.floor(b.x)&&Math.floor(a.z)===Math.floor(b.z);
   if(!exactShortStep){
   let gx=Math.round(a.x/step),gz=Math.round(a.z/step);
   const endX=Math.round(b.x/step),endZ=Math.round(b.z/step);
   let crossX=sx?((gx+sx*.5)*step-a.x)/dx:Infinity,crossZ=sz?((gz+sz*.5)*step-a.z)/dz:Infinity;
   const everyX=sx?step/Math.abs(dx):Infinity,everyZ=sz?step/Math.abs(dz):Infinity;
   if(!gridCanStand(gx,gz,required,true))return false;
   while(gx!==endX||gz!==endZ){
    spendWork(.1);
    const nextX=gx===endX?Infinity:crossX,nextZ=gz===endZ?Infinity:crossZ;
    if(Math.abs(nextX-nextZ)<1e-10){
     // Native Praetorians permits diagonal adjacency when at least one
     // orthogonal side remains traversable; the exact swept-footprint
     // checks below still reject genuine corner clipping.
     if(!gridCanStand(gx+sx,gz,required,true)&&!gridCanStand(gx,gz+sz,required,true))return false;
     gx+=sx;gz+=sz;crossX+=everyX;crossZ+=everyZ;
    }else if(nextX<nextZ){gx+=sx;crossX+=everyX;}
    else{gz+=sz;crossZ+=everyZ;}
    if(!gridCanStand(gx,gz,required,true))return false;
   }
   }
   // Increase spatial sampling for the short exact sweep. The existing
   // canStand check includes MLG footprints, structures, water and clearance.
   const pieces=Math.max(1,Math.ceil(d/(exactShortStep?step*.06:step*.32)));
   let previousY=worldHeight(a.x,a.z),last=a,previousLevel=level[node(a.x,a.z)];
   for(let k=0;k<=pieces;k++){
    spendWork(.1);
    const t=k/pieces,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
    if(!canStand(x,z,radius))return false;
    const here=level[node(x,z)];
    if(k){const y=worldHeight(x,z),h=Math.hypot(x-last.x,z-last.z);
     if(!climbs(previousLevel,here)&&Math.abs(y-previousY)>Math.min(maxCrossStep*h/step,maxCrossGrade*h)+.015)return false;
     previousY=y;
    }
    last={x,z};previousLevel=here;
   }
   return true;
  }
  // MARCHING FEET vs. NAVIGATION: the A* centre still obeys the original
  // passability mask. Only the outermost planted feet may graze a *shallow*
  // MLG/slope fringe. That distinction stops an intact rank bending around
  // every scrub-painted edge. The maximum penetration is bounded by the
  // distance to real walkable ground; it cannot accumulate over steps.
  // Structures, water, forbidden terrain types and world boundaries never
  // receive this grace. If the terrain actually changes height sharply the
  // edge is a cliff, not a harmless brush and is also always rejected.
  const MARCH_FRINGE=.22,FRONTIER_ANGLES=12;
  function harmlessMarchFringe(x,z,radius){
   if(!inBounds(x,z)||x-radius<0||z-radius<0||x+radius>width||z+radius>depth||
      hardPhysicalBlocked(x,z,radius))return false;
   // Real structure geometry is solid even when the planted foot centre lies
   // a few centimetres outside it. Never treat a building collision as brush.
   if(options.structures&&radius>0){
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],
      [.70710678,.70710678],[-.70710678,.70710678],
      [.70710678,-.70710678],[-.70710678,-.70710678]]){
     if(structureSolidAt(x+dx*radius,z+dz*radius))return false;
    }
   }
   // A blocked MLG cell is softened ONLY when its forbidden attribute is a
   // shallow slope flag; a type restriction or NOPASABLE is never softened.
   // Gentle, proven climbable hillside cells are handled by canStand itself.
   if(logical){
    const x0=Math.max(0,Math.floor(x-radius)),x1=Math.min(logical.width-1,Math.floor(x+radius));
    const z0=Math.max(0,Math.floor(z-radius)),z1=Math.min(logical.depth-1,Math.floor(z+radius));
    for(let cz=z0;cz<=z1;cz++)for(let cx=x0;cx<=x1;cx++){
     const px=clamp(x,cx,cx+1),pz=clamp(z,cz,cz+1);
     if(Math.hypot(px-x,pz-z)>radius+1e-9)continue;
     const flags=logical.values[cz*logical.width+cx];
     if(!logicalBlocked[cz*logical.width+cx])continue;
     const type=flags>>>27;
     if(logical.rules.deep(flags)||logical.rules.types?.has(type)||
        (flags&(0x1|0x8000|0x100000))!==0 ||
        (flags&logical.rules.mask&~(0x20|0x40|0x80))!==0)return false;
     if(!(flags&logical.rules.mask&(0x20|0x40|0x80)))return false;
    }
   }else if(slope[node(x,z)]||water[node(x,z)])return false;
   return true;
  }
  function canMarchFoot(x,z,radius=.06){
   if(canStand(x,z,radius))return true;
   radius=Math.max(0,radius);
   if(!harmlessMarchFringe(x,z,radius))return false;
   // Contact must stay close to *actual* legal ground, not necessarily a
   // half-cell node: the half-cell clearance halo around MLG borders is the
   // source of much of the overreaction seen in narrow passages.
   const y=worldHeight(x,z);
   // A truly steep face can have an almost-flat single sample near its lip.
   // Probe the local ground around the foot before offering any grace.
   const probe=.18;
   for(const [dx,dz] of [[probe,0],[-probe,0],[0,probe],[0,-probe]]){
    if(!inBounds(x+dx,z+dz))return false;
    if(Math.abs(worldHeight(x+dx,z+dz)-y)>maxCrossGrade*probe+.03)return false;
   }
   if(logical){
    const bx=Math.floor(x),bz=Math.floor(z);
    for(let cz=Math.max(0,bz-1);cz<=Math.min(logical.depth-1,bz+1);cz++)
     for(let cx=Math.max(0,bx-1);cx<=Math.min(logical.width-1,bx+1);cx++){
      if(logicalBlocked[cz*logical.width+cx])continue;
      const px=clamp(x,cx+.005,cx+.995),pz=clamp(z,cz+.005,cz+.995);
      const distance=Math.hypot(x-px,z-pz);
      if(distance>MARCH_FRINGE+1e-9||hardPhysicalBlocked(px,pz,0))continue;
      // Short crossing over a visually painted obstacle must be almost flat.
      if(Math.abs(y-worldHeight(px,pz))>Math.max(.045,.24*distance+.012))continue;
      return true;
     }
    return false;
   }
   // Non-MLG maps: only forgive raster rounding on flat, unblocked ground;
   // never relax an actual rock-cliff cell.
   for(const distance of [.08,.15,MARCH_FRINGE])for(let i=0;i<FRONTIER_ANGLES;i++){
    const a=i*Math.PI*2/FRONTIER_ANGLES,px=x+Math.cos(a)*distance,pz=z+Math.sin(a)*distance;
    if(!inBounds(px,pz)||!canStand(px,pz,.005))continue;
    if(Math.abs(y-worldHeight(px,pz))>Math.max(.045,.24*distance+.012))continue;
    return true;
   }
   return false;
  }
  function marchLineClear(a,b,radius=.06){
   if(lineClear(a,b,radius))return true;
   const length=dist(a,b);
   // Collision is swept continuously through a short fringe: even if both
   // ends are legal, this rejects a shortcut through a deep blocked patch.
   const pieces=Math.max(1,Math.ceil(length/.06));
   let previous=null;
   for(let k=0;k<=pieces;k++){
    const t=k/pieces,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
    if(!canMarchFoot(x,z,radius))return false;
    const y=worldHeight(x,z);
    if(previous){
     const h=Math.hypot(x-previous.x,z-previous.z);
     if(Math.abs(y-previous.y)>Math.max(.016,maxCrossGrade*h+.015))return false;
    }
    previous={x,z,y};
   }
   return true;
  }
  // A marching formation is not a collection of individually pathfinding men.
  // The leader/inner files establish a *strictly walkable core*, while only
  // the OUTERMOST files may project a short distance past its bank. This is
  // intentional: old Praetorians marches visibly brush across MLG/foliage
  // margins instead of distorting the block to avoid every painted polygon.
  // The TWO central files stay strictly walkable. The next two files on
  // either flank can project across flat painted edges while remaining
  // tethered to a core soldier. The leash is measured from the innermost
  // file, not increased by repeated steps; no independent wall crossing.
  // Never soften physical drops, water, structures or the map boundary.
  // Two exterior files can overhang a higher bank at full spacing. Keep a
  // cross-slope grade test rather than the old flat .32m height difference:
  // a 0.8m ascent over a 1m rank-to-flank span can be a normal hillside,
  // while a sharp .8m step is still a genuine cliff.
  const FORMATION_WING_REACH=1.04;
  const WING_CLIMB_GRADE=.86;
  function canWingFoot(x,z,radius=.06,inward=null){
   if(canMarchFoot(x,z,radius))return true;
   if(!inward||!Number.isFinite(inward.x)||!Number.isFinite(inward.z))return false;
   if(hardPhysicalBlocked(x,z,radius)||!canMarchFoot(inward.x,inward.z,radius))return false;
   const distance=dist({x,z},inward);
   if(distance>FORMATION_WING_REACH+1e-8)return false;
   const innerHeight=worldHeight(inward.x,inward.z),edgeHeight=worldHeight(x,z);
   // A cosmetic terrain mask edge is fine. A real drop or raised vertical
   // face is not: don't put men in a river or through a cliffside.
   if(Math.abs(innerHeight-edgeHeight)>WING_CLIMB_GRADE*distance+.04)return false;
   const pieces=Math.max(1,Math.ceil(distance/.10));
   let lastHeight=edgeHeight;
   for(let i=1;i<pieces;i++){
    const t=i/pieces,px=x+(inward.x-x)*t,pz=z+(inward.z-z)*t;
    if(hardPhysicalBlocked(px,pz,radius))return false;
    const height=worldHeight(px,pz);
    if(Math.abs(height-lastHeight)>WING_CLIMB_GRADE*distance/pieces+.025)return false;
    lastHeight=height;
   }
   if(Math.abs(lastHeight-innerHeight)>WING_CLIMB_GRADE*distance/pieces+.025)return false;
   return true;
  }
  function wingLineClear(a,b,radius=.06,inwardA=null,inwardB=null){
   if(marchLineClear(a,b,radius))return true;
   if(!inwardA||!inwardB)return false;
   const pieces=Math.max(1,Math.ceil(dist(a,b)/.10));
   let previous=null;
   for(let i=0;i<=pieces;i++){
    const t=i/pieces,pt={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};
    const inner={x:inwardA.x+(inwardB.x-inwardA.x)*t,
     z:inwardA.z+(inwardB.z-inwardA.z)*t};
    if(!canWingFoot(pt.x,pt.z,radius,inner))return false;
    const y=worldHeight(pt.x,pt.z);
    if(previous){const distance=dist(pt,previous);
     if(Math.abs(y-previous.y)>Math.max(.03,maxCrossGrade*distance+.025))return false;}
    previous={...pt,y};
   }
   return true;
  }
  // Only route planning enforces formation width against villages. A spawned
  // squad may already have its centre inside that *virtual* radius, so allow
  // a monotonically outward escape: do not trap an otherwise valid squad.
  function routeLineClear(a,b,radius){
   if(activeBudget)return budgetRouteLineClear(a,b,radius);
   if(!lineClear(a,b,radius))return false;
   const needed=radius/step*10;
   const initial=villageDistance[node(a.x,a.z)];
   const pieces=Math.max(1,Math.ceil(dist(a,b)/(step*.32)));
   let previous=initial;
   for(let k=1;k<=pieces;k++){
    spendWork(.05);
    const t=k/pieces,idx=node(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t);
    const gap=villageDistance[idx];
    if(gap<needed-1e-6){
     // The centre started close to a house; the only safe way through that
     // portion is outwards (or tangentially), never deeper into the village.
     if(initial>=needed || gap+2<previous)return false;
    }
    previous=gap;
   }
   return true;
  }
  // Budgeted whole-route previews must finish genuine long segments too.
  // Preserve the exact raster/sample/village checks between allowances;
  // restarting a long successful line could otherwise consume every slice.
  function budgetRouteLineClear(a,b,radius){
   const key=failureKey(a,b,radius);let s=budgetLines.get(key);
   if(!s){
    const dx=b.x-a.x,dz=b.z-a.z,sx=Math.sign(dx),sz=Math.sign(dz),gx=Math.round(a.x/step),gz=Math.round(a.z/step);
    s={phase:'raster',started:false,dx,dz,sx,sz,gx,gz,endX:Math.round(b.x/step),endZ:Math.round(b.z/step),required:radiusQuantized(radius),
     crossX:sx?((gx+sx*.5)*step-a.x)/dx:Infinity,crossZ:sz?((gz+sz*.5)*step-a.z)/dz:Infinity,
     everyX:sx?step/Math.abs(dx):Infinity,everyZ:sz?step/Math.abs(dz):Infinity,
     pieces:Math.max(1,Math.ceil(dist(a,b)/(step*.32))),k:0,previousY:worldHeight(a.x,a.z),last:{x:a.x,z:a.z},previousLevel:level[node(a.x,a.z)]};
   }
   retain(budgetLines,key,s,256);
   if(s.done)return s.value;
   const finish=value=>{s.done=true;s.value=value;return value;};
   if(s.phase==='raster'){
    if(!s.started){if(!gridCanStand(s.gx,s.gz,s.required,true))return finish(false);s.started=true;}
    while(s.gx!==s.endX||s.gz!==s.endZ){
     spendWork(.1);
     const nextX=s.gx===s.endX?Infinity:s.crossX,nextZ=s.gz===s.endZ?Infinity:s.crossZ;
     let gx=s.gx,gz=s.gz,crossX=s.crossX,crossZ=s.crossZ;
     if(Math.abs(nextX-nextZ)<1e-10){
      if(!gridCanStand(gx+s.sx,gz,s.required,true)&&!gridCanStand(gx,gz+s.sz,s.required,true))return finish(false);
      gx+=s.sx;gz+=s.sz;crossX+=s.everyX;crossZ+=s.everyZ;
     }else if(nextX<nextZ){gx+=s.sx;crossX+=s.everyX;}
     else{gz+=s.sz;crossZ+=s.everyZ;}
     if(!gridCanStand(gx,gz,s.required,true))return finish(false);
     s.gx=gx;s.gz=gz;s.crossX=crossX;s.crossZ=crossZ;
    }
    s.phase='exact';
   }
   if(s.phase==='exact'){
    while(s.k<=s.pieces){
     spendWork(.1);
     const t=s.k/s.pieces,x=a.x+s.dx*t,z=a.z+s.dz*t;
     if(!canStand(x,z,radius))return finish(false);
     const here=level[node(x,z)];let y=s.previousY;
     if(s.k){
      y=worldHeight(x,z);const h=Math.hypot(x-s.last.x,z-s.last.z);
      if(!climbs(s.previousLevel,here)&&Math.abs(y-s.previousY)>Math.min(maxCrossStep*h/step,maxCrossGrade*h)+.015)return finish(false);
     }
     s.previousY=y;s.previousLevel=here;s.last={x,z};s.k++;
    }
    s.phase='village';s.k=1;s.initial=villageDistance[node(a.x,a.z)];s.previous=s.initial;
   }
   const needed=radius/step*10;
   while(s.k<=s.pieces){
    spendWork(.05);
    const t=s.k/s.pieces,gap=villageDistance[node(a.x+s.dx*t,a.z+s.dz*t)];
    if(gap<needed-1e-6&&(s.initial>=needed||gap+2<s.previous))return finish(false);
    s.previous=gap;s.k++;
   }
   return finish(true);
  }
  function heuristic(a,b){const dx=Math.abs(a%columns-b%columns),dz=Math.abs(Math.floor(a/columns)-Math.floor(b/columns));return step*(Math.max(dx,dz)+(SQRT2-1)*Math.min(dx,dz));}
  // A* may step from i to its neighbour (the same test both ways).
  function passable(i,x,z,dx,dz,distance,required){
   const nx=x+dx,nz=z+dz;if(!gridCanStand(nx,nz,required))return false;
   // Native neighbor rule: both blocked side cells forbid a diagonal.
   // Never bypass the target-cell or exact midpoint footprint checks.
   if(dx&&dz&&!gridCanStand(x+dx,z,required)&&!gridCanStand(x,z+dz,required))return false;
   // Do not jump from one allowed node to another through a blocked
   // 1 m logical cell: the crossing midpoint is checked with the footprint.
   if(!gridLogicalClear(x*2+dx,z*2+dz,required))return false;
   const next=index(nx,nz),rise=Math.abs(raw[i]-raw[next]);
   return climbs(level[i],level[next])||!(rise/(step*distance)>maxCrossGrade||rise>maxCrossStep*distance);
  }
  // Connected regions for one formation clearance, so that a goal nothing
  // joins to (heavy infantry facing a ford, a plateau without a ramp) fails
  // after bounded search, and repeated unreachable orders fail at once.
  // Build these only when a search needs them: a short reachable detour must
  // not first flood every walkable sample on a large multiplayer map.
  const regionsByClearance=new Map();
  const disconnectedBefore=[];
  function rememberDisconnectedComponents(){
   for(const [required,label] of regionsByClearance){
    if(disconnectedBefore.some(entry=>entry.label===label))continue;
    disconnectedBefore.push({required,label});
    const same=disconnectedBefore.filter(entry=>entry.required===required);
    if(same.length>2)disconnectedBefore.splice(disconnectedBefore.indexOf(same[0]),1);
    if(disconnectedBefore.length>8)disconnectedBefore.shift();
   }
  }
  function previouslyDisconnected(required,start,end){
   for(const entry of disconnectedBefore){
    if(entry.required!==required)continue;
    const a=entry.label[start],b=entry.label[end];
    // Each nonzero label is a COMPLETE component. Zero is unknown, but
    // outside every known complete component. Equal/unknown labels never
    // prove a route exists. Closing more ground cannot join old islands.
    if((a||b)&&a!==b)return true;
   }
   return false;
  }
  function regions(required,seed){
   let label=regionsByClearance.get(required);if(label&&label[seed])return label;
   if(!label){
    if(regionsByClearance.size>=8)regionsByClearance.delete(regionsByClearance.keys().next().value);
    label=new Int32Array(size);label.regionCount=0;regionsByClearance.set(required,label);
   }
   // Only the queried component is needed to decide this route. Filling all
   // other islands first caused large pauses on eight-player bridge maps.
   const queue=new Int32Array(size),count=++label.regionCount;
   let head=0,tail=0;queue[tail++]=seed;label[seed]=count;
   let completed=false;
   try{
    while(head<tail){
     if(activeBudget)spendWork();else workUnits++;
     const i=queue[head++],x=i%columns,z=(i/columns)|0;
     for(const [dx,dz,distance] of NEIGHBORS){
      if(!passable(i,x,z,dx,dz,distance,required))continue;
      const next=index(x+dx,z+dz);if(!label[next]){label[next]=count;queue[tail++]=next;}
     }
    }
    completed=true;
   }finally{
    // An interrupted flood is not a disconnected-component proof. Remove
    // every provisional label, including nodes queued but not expanded.
    if(!completed)for(let i=0;i<tail;i++)if(label[queue[i]]===count)label[queue[i]]=0;
   }
   return label;
  }
  // Navigation has no unit-occupancy state. An identical failed query stays
  // failed until an obstacle changes; keep its expensive validation result.
  // Keys retain exact JS coordinates and radius, never rounded positions.
  const failedPlans=new Map(),failedEscapes=new Map(),FAILURE_CACHE_LIMIT=256;
  const pausedSearches=new Map(),automaticRoutes=new Map();
  const pausedSearchLimit=8;
  function discardSearch(key){
   const old=pausedSearches.get(key);if(!old)return;
   pausedSearches.delete(key);if(pausedSearchPool.delete(old))pausedSearchBytes-=old.budgetBytes;
  }
  function saveSearch(key,value){
   discardSearch(key);
   if(pausedSearches.size>=pausedSearchLimit)discardSearch(pausedSearches.keys().next().value);
   value.budgetOwner=pausedSearches;value.budgetKey=key;value.budgetBytes=size*13;
   pausedSearches.set(key,value);
   pausedSearchPool.set(value,value);pausedSearchBytes+=value.budgetBytes;
   while(pausedSearchBytes>PAUSED_SEARCH_BYTES&&pausedSearchPool.size){
    const old=pausedSearchPool.keys().next().value;pausedSearchPool.delete(old);pausedSearchBytes-=old.budgetBytes;
    old.budgetOwner.delete(old.budgetKey);
   }
  }
  let revision=0,workUnits=0;
  function failureKey(start,goal,radius){
   return [start.x,start.z,goal.x,goal.z,radius].every(Number.isFinite)?
    `${start.x},${start.z}|${goal.x},${goal.z}|${radius}`:null;
  }
  function cachedFailure(cache,key){
   if(key===null)return null;
   const result=cache.get(key);if(!result)return null;
   cache.delete(key);cache.set(key,result);return {...result,expanded:0};
  }
  function rememberFailure(cache,key,result){
   if(key!==null&&!result.ok&&result.reason!=='work-budget'){
    if(cache.size>=FAILURE_CACHE_LIMIT)cache.delete(cache.keys().next().value);
    cache.set(key,{...result});
   }
   return result;
  }
  function plan(start,goal,radius=.6,mode='short'){
   // The normal shortest-route cache and the clearance-preferring retry must
   // never share entries: their cost functions and smoothed paths differ.
   const key=failureKey(start,goal,radius)+(mode==='clearance'?'|clearance':'');
   const cached=cachedFailure(failedPlans,key);
   if(cached)return cached;
   const full=activeBudget&&!activeBudget.allowPartial;
   if(full&&completePlans.has(key)){
    const saved=retainRoute(completePlans,key,completePlans.get(key),128);
    return {...saved,points:saved.points.map(p=>({...p})),expanded:0};
   }
   const finishing=full&&finishingPlans.get(key);
   const result=finishing?finishCompletePath(key,finishing):planUncached(start,goal,radius,mode);
   if(full&&result.ok&&!result.partial)retainRoute(completePlans,key,{...result,points:result.points.map(p=>({...p}))},128);
   return rememberFailure(failedPlans,key,result);
  }
  function planUncached(start,goal,radius,mode='short'){
   // Never teleport an existing squad from dangerous ground to a nearby safe
   // cell. That created visually straight segments cutting across cliffs.
   if(!canStand(start.x,start.z,radius))return {ok:false,reason:'Formation is too close to a cliff or river; use a safe starting position.'};
   const source=nearestCell(start.x,start.z,radius,Math.max(1.75,radius*1.45)),
    destination=nearestCell(goal.x,goal.z,radius,1.25);
   if(!source)return {ok:false,reason:'Squad is too close to blocked terrain.'};
   if(!destination)return {ok:false,reason:'Destination blocked by a cliff, river or map boundary.'};
   const startI=node(source.x,source.z),endI=node(destination.x,destination.z);
   // Open ground needs no map-wide region scan or A* search. Check the
   // actual start, not its rounded grid node, so the shortcut keeps the
   // same formation clearance, swept grade and walkway rules as any route.
   // This also keeps several armies receiving orders together inexpensive.
   if(mode!=='clearance'&&routeLineClear(start,destination,radius))return {ok:true,points:[{x:start.x,z:start.z},destination],length:dist(start,destination),expanded:0,adjusted:dist(goal,destination)>.55};
   // Even within one rounded grid cell, the real start can sit across an
   // incline from the goal. A zero-node search cannot make that sweep safe.
   if(startI===endI)return {ok:false,reason:'Route starts too close to impassable terrain.'};
   const required=radiusQuantized(radius);let label=regionsByClearance.get(required);
   if(label&&(label[startI]||label[endI])&&label[startI]!==label[endI])return {ok:false,reason:'No passable route for this formation (cliffs or water divide the area).',expanded:0};
   if(previouslyDisconnected(required,startI,endI))return {ok:false,reason:'No passable route for this formation (cliffs or water divide the area).',expanded:0};
   const routeKey=endI+'|'+required+(mode==='clearance'?'|clearance':'');
   if(activeBudget?.allowPartial){
    const known=automaticRoutes.get(routeKey),at=known?.byNode.get(startI);
    if(at!==undefined)return finishPath(known.path.slice(at),start,goal,radius,source,destination,0,true);
   }
   const searchKey=startI+'|'+routeKey;
   let search=activeBudget?pausedSearches.get(searchKey):null;
   if(!search){
    const cost=new Float64Array(size),parent=new Int32Array(size),closed=new Uint8Array(size),heap=new MinHeap();
    cost.fill(Infinity);parent.fill(-1);cost[startI]=0;heap.push(startI,heuristic(startI,endI));
    search={cost,parent,closed,heap,expanded:0};
   }
   const {cost,parent,closed,heap}=search;
   let found=false,expanded=search.expanded,current=-1;
   try{
    while(heap.length&&expanded<size){
     if(activeBudget&&activeBudget.remaining<Math.max(128,activeBudget.reserve)){
      activeBudget.exhausted=true;throw WORK_BUDGET_EXHAUSTED;
     }
     const [i]=heap.pop();if(closed[i])continue;
     current=i;if(activeBudget)spendWork();else workUnits++;
     closed[i]=1;expanded++;
     if(i===endI){found=true;current=-1;break;}
     // An automatic query resumes its A* on the next allowance instead of
     // abandoning a half-finished whole-component flood on every retry.
     if(!activeBudget&&(!label||!label[startI])&&expanded>=REGION_SEARCH_THRESHOLD){
      label=regions(required,startI);
      if(label[startI]!==label[endI])return {ok:false,reason:'No passable route for this formation (cliffs or water divide the area).',expanded};
     }
     const x=i%columns,z=(i/columns)|0;
     for(const [dx,dz,distance] of NEIGHBORS){
      if(!passable(i,x,z,dx,dz,distance,required))continue;
      const next=index(x+dx,z+dz);if(closed[next])continue;
      const rise=Math.abs(raw[i]-raw[next]),run=step*distance,safety=1+Math.min(.26,6/(clearance[next]+10));
      const gap=villageDistance[next]*step/10,intrusion=Math.max(0,(radius-gap)/Math.max(radius,.15)),villageCost=1+20*intrusion*intrusion;
      // Prefer a corridor with space for the *outer files* rather than
      // hugging a cliff just because that centreline is slightly shorter.
      // This is a fallback cost only: occupied cells are never made walkable.
      const free=Math.max(0,clearance[next]*step/10-radius);
      const clearanceCost=mode==='clearance'?1+2.6/(.65+free*free*1.8):1;
      const nextCost=cost[i]+run*(1+rise/run*.85)*safety*villageCost*clearanceCost;
      if(nextCost<cost[next]){cost[next]=nextCost;parent[next]=i;heap.push(next,nextCost+heuristic(next,endI));}
     }
     current=-1;
    }
   }catch(error){
    if(error===WORK_BUDGET_EXHAUSTED){
     // Re-open a node interrupted inside its neighbor checks. Previously
     // relaxed edges remain valid; the next slice completes all its edges.
     if(current!==-1){closed[current]=0;expanded--;heap.push(current,cost[current]+heuristic(current,endI));}
     search.expanded=expanded;saveSearch(searchKey,search);
    }
    throw error;
   }
   discardSearch(searchKey);
   if(!found){
    // A small disconnected component can be exhausted before the cold
    // threshold. Cache its regions too, so repeated failed orders do not
    // search that entire component again.
    if(!activeBudget&&(!label||!label[startI]))regions(required,startI);
    return {ok:false,reason:'No passable route for this formation (cliffs or water divide the area).',expanded};
   }
   const path=[];for(let i=endI;i!==-1;i=parent[i]){path.push({x:(i%columns)*step,z:Math.floor(i/columns)*step});if(i===startI)break;}
   path.reverse();path[0]=source;path[path.length-1]=destination;
   if(activeBudget?.allowPartial){
    if(automaticRoutes.size>=32)automaticRoutes.delete(automaticRoutes.keys().next().value);
    automaticRoutes.set(routeKey,{path:path.slice(),byNode:new Map(path.map((p,i)=>[node(p.x,p.z),i]))});
   }
   if(activeBudget&&!activeBudget.allowPartial){
    const key=failureKey(start,goal,radius)+(mode==='clearance'?'|clearance':''),session={path,start:{...start},goal:{...goal},radius,source,destination,expanded,smoothed:[{x:start.x,z:start.z}],phase:'initial',at:0,n:null,validateAt:1,mode};
    retainRoute(finishingPlans,key,session,32);
    return finishCompletePath(key,session);
   }
   return finishPath(path,start,goal,radius,source,destination,expanded,!!activeBudget?.allowPartial,mode);
  }
  // A* has already found the complete route. Keep its raw path and exact
  // smoothing cursor until every segment is validated, never expose a prefix
  // as a whole-formation destination and never redo a completed A* search.
  function finishCompletePath(key,s){
   retainRoute(finishingPlans,key,s,32);
   const {path,start,goal,radius,destination,smoothed}=s;
   const failed=reason=>{forgetRoute(finishingPlans,key);return {ok:false,reason};};
   if(s.phase==='initial'){
    if(!routeLineClear(smoothed[0],path[0],radius))return failed('Route starts too close to impassable terrain.');
    s.phase='smooth';
   }
   while(s.phase==='smooth'&&s.at<path.length-1){
    const anchor=smoothed[smoothed.length-1];
    if(s.n===null){s.far=s.at;s.n=s.at+1;}
    while(s.n<path.length&&dist(anchor,path[s.n])<=(s.mode==='clearance'?2.1:13)){
     if(routeLineClear(anchor,path[s.n],radius))s.far=s.n;
     s.n++;
    }
    let far=s.far;
    if(far===s.at){
     if(dist(anchor,path[s.at])>1e-8){
      if(!routeLineClear(anchor,path[s.at],radius))return failed('Village route is too narrow for this formation.');
      smoothed.push(path[s.at]);s.n=null;continue;
     }
     far=s.at+1;
    }
    const point=path[far];if(dist(smoothed[smoothed.length-1],point)>1e-8)smoothed.push(point);
    s.at=far;s.n=null;
   }
   if(s.phase==='smooth'){
    if(smoothed.length<2)smoothed.push(destination);
    s.phase='validate';
   }
   while(s.validateAt<smoothed.length){
    if(!routeLineClear(smoothed[s.validateAt-1],smoothed[s.validateAt],radius))return failed('Route crosses impassable cliff terrain.');
    s.validateAt++;
   }
   forgetRoute(finishingPlans,key);
   const length=smoothed.slice(1).reduce((total,p,k)=>total+dist(smoothed[k],p),0);
   return {ok:true,points:smoothed,length,expanded:s.expanded,adjusted:dist(goal,destination)>.55};
  }
  function finishPath(path,start,goal,radius,source,destination,expanded,allowPartial,mode='short'){
   let partial=false;
   if(allowPartial){
    // A short already-searched prefix bounds the validation/smoothing cost.
    // At least one genuine grid step is needed; returning the start forever
    // would hide starvation behind a successful-looking routing result.
    let length=dist(start,path[0]),last=0;
    for(let i=1;i<path.length;i++){const next=length+dist(path[i-1],path[i]);if(next>8&&last)break;length=next;last=i;}
    partial=last<path.length-1;path.length=last+1;
    if(last===0&&dist(start,path[0])<.5){
     if(!partial)return {ok:true,points:[{x:start.x,z:start.z},path[0]],length:dist(start,path[0]),expanded,adjusted:dist(goal,destination)>.55};
     if(activeBudget)activeBudget.exhausted=true;throw WORK_BUDGET_EXHAUSTED;
    }
   }
   const smoothed=[{x:start.x,z:start.z}],maxShortcut=mode==='clearance'?2.1:13;
   if(!routeLineClear(smoothed[0],path[0],radius)){
    // The old fallback inserted an unchecked straight jump to the first grid
    // node. Refuse that jump instead of sending soldiers over a cliff.
    return {ok:false,reason:'Route starts too close to impassable terrain.'};
   }
   let at=0;
   while(at<path.length-1){
    const anchor=smoothed[smoothed.length-1];
    let far=at;
    for(let n=at+1;n<path.length&&dist(anchor,path[n])<=maxShortcut;n++){
     if(routeLineClear(anchor,path[n],radius))far=n;
    }
    // The real start can lie to one side of its grid sample. If no next
    // node is visible from there, keep the checked step to that sample,
    // then search for shortcuts from the actual point we emitted.
    if(far===at){
     if(dist(anchor,path[at])>1e-8){
      if(!routeLineClear(anchor,path[at],radius))return {ok:false,reason:'Village route is too narrow for this formation.'};
      smoothed.push(path[at]);continue;
     }
     far=at+1;
    }
    const point=path[far];if(dist(smoothed[smoothed.length-1],point)>1e-8)smoothed.push(point);
    at=far;
   }
   if(smoothed.length<2)smoothed.push(partial?path[path.length-1]:destination);
   // Validate every final segment even when shortcut smoothing was disabled.
   for(let i=1;i<smoothed.length;i++){
    if(!routeLineClear(smoothed[i-1],smoothed[i],radius))
     return {ok:false,reason:'Route crosses impassable cliff terrain.'};
   }
   const length=smoothed.slice(1).reduce((total,p,k)=>total+dist(smoothed[k],p),0);
   return {ok:true,points:smoothed,length,expanded,adjusted:partial||dist(goal,destination)>.55,...(partial?{partial:true}:null)};
  }
  // Route a formation using progressively different centre clearances. The
  // callback checks its *oriented soldier footprints* along every turn;
  // a narrow centre route is never accepted merely because A* found it.
  // This remains read-only and uses plan()'s normal revision-aware caches.
  function planFormation(start,goal,radii,validate){
   const tried=new Set(),direct=dist(start,goal);
   let best=null,lastFailure=null,hadCentreRoute=false;
   for(const proposed of radii){
    const radius=Math.max(.12,proposed),key=Math.round(radius*1000);
    if(!Number.isFinite(radius)||tried.has(key))continue;
    tried.add(key);
    const route=plan(start,goal,radius);
    if(!route.ok){lastFailure=route;if(route.deferred)return best||route;continue;}
    hadCentreRoute=true;
    const fitted=validate(route.points,route,radius);
    if(!fitted){lastFailure={ok:false,reason:'No collision-free corridor for the complete formation.'};continue;}
    const result={...route,...fitted,radius};
    // Wide, low-turn routes are preferable even when a tighter corridor
    // saves a couple of metres: a compact marching troop reads better.
    // Prefer routes that preserve visible width: .92 should beat .60
    // when the extra detour is modest, without forbidding genuine pinches.
    // A shorter route is not worth turning an orderly infantry block into
   // a cramped spearhead. Prefer a modest detour over a deep contraction;
   // when the only legal road is truly narrow, compression still works.
   const compressionCost=result.scale<1?
     .8+Math.pow(1-result.scale,1.25)*(32+direct*.22):0;
    const score=result.length+compressionCost+(result.turnCost||0)+
     (result.adjusted?.75:0);
    if(!best||score<best.score){best={...result,score};}
    // A smooth full-width march already near the geometric shortest route:
    // further A* searches cannot yield a noticeable improvement.
    if(result.scale===1&&!result.adjusted&&result.length<=direct*1.12+.35)break;
    if(route.partial)break;
   }
   // When shortest routes keep scraping the cliff, search once with a
   // clearance preference. A* still respects exactly the same MLG/water
   // passability; this chooses a better *centreline*, not a magic shortcut.
   if(!best&&hadCentreRoute){
    const clearRadii=[Math.max(.24,Math.min(...radii)),Math.max(.24,Math.min(...radii)*.8)];
    const wideTried=new Set();
    for(const radius of clearRadii){
     const k=Math.round(radius*1000);if(wideTried.has(k))continue;wideTried.add(k);
     const route=plan(start,goal,radius,'clearance');
     if(!route.ok){if(route.deferred)return route;lastFailure=route;continue;}
     const fitted=validate(route.points,route,radius);
     if(fitted){best={...route,...fitted,radius,score:0};break;}
     lastFailure={ok:false,reason:'The widest A* corridor still clips the formation.'};
     if(route.partial)break;
    }
   }
   if(best){const {score,...route}=best;return route;}
   return lastFailure||{ok:false,reason:'No route permits this formation to stay intact.'};
  }
  // If the *centre* is walkable but the full formation circle overlaps a
  // mountain edge, route it OUT to the closest safe formation centre, then
  // use the unchanged full-radius A* from there. The first leg is continuous
  // world-space movement, not teleporting to the snapped navigation node.
  function planEdgeEscape(start,goal,radius=.6){
   const key=failureKey(start,goal,radius),cached=cachedFailure(failedEscapes,key);
   return cached||rememberFailure(failedEscapes,key,planEdgeEscapeUncached(start,goal,radius));
  }
  function planEdgeEscapeUncached(start,goal,radius){
   if(canStand(start.x,start.z,radius)||!canStand(start.x,start.z,.12)||
    !hasSoftFringe(start.x,start.z,radius)||edgeRisk(start.x,start.z,radius)<=.01||
    !Number.isFinite(edgeRisk(start.x,start.z,radius)))return {ok:false,reason:'No safe cliff-edge escape from this position.'};
   const candidates=[];
   const maxDistance=Math.min(6,Math.max(3,radius*2.5));
   for(let d=.5;d<=maxDistance;d+=.5){
    for(let k=0;k<24;k++){
     spendWork(.1);
     const angle=k*Math.PI/12,p={x:start.x+d*Math.cos(angle),z:start.z+d*Math.sin(angle)};
     if(!canStand(p.x,p.z,radius)||!lineClear(start,p,.12))continue;
     const score=d+.24*dist(p,goal);
     candidates.push({p,d,score});
    }
   }
   candidates.sort((a,b)=>a.score-b.score);
   const direct=candidates.find(c=>routeLineClear(c.p,goal,radius));
   const shortlist=direct?[direct]:candidates.slice(0,12);
   for(const c of shortlist){
    spendWork();
    const main=plan(c.p,goal,radius);
    if(!main.ok)continue;
    const points=[{x:start.x,z:start.z},c.p,...main.points.slice(1)];
    return {...main,ok:true,points,length:c.d+main.length,edgeEscape:true,edgeEscapeTo:c.p};
   }
   return {ok:false,reason:'No safe route away from this cliff edge.'};
  }
  const statistics={columns,rows,cells:size,water:Array.from(water).reduce((s,v)=>s+v,0),ford:ford.reduce((s,v)=>s+v,0),deck:deck.reduce((s,v)=>s+v,0),solid:solid.reduce((s,v)=>s+v,0),steep:Array.from(slope).reduce((s,v)=>s+v,0),paintedCliff:cliff.reduce((s,v)=>s+v,0),blocked:walkable.reduce((s,v)=>s+(v===0),0),triangles:rasterTriangles};
  statistics.walkway=level.reduce((s,v)=>s+(v===1),0);statistics.logicalBlocked=barred.reduce((s,v)=>s+v,0);statistics.ladder=level.reduce((s,v)=>s+(v===2),0);
  // A building changes only its solid footprint. Keep the terrain, logical
  // rules and fixed bridge/wall data, and reclassify the affected samples.
  // Bridges, ladders, gate access and terrain height changes still require a
  // new grid. Clearance must propagate across the whole grid after removal
  // as well as addition, and connected-region labels must be discarded.
  function refreshObstacles(bounds){
   if(!options.structures)return false;
   const x0=bounds?clamp(Math.floor(bounds.xMin/step),0,columns-1):0,
    x1=bounds?clamp(Math.ceil(bounds.xMax/step),0,columns-1):columns-1,
    z0=bounds?clamp(Math.floor(bounds.zMin/step),0,rows-1):0,
    z1=bounds?clamp(Math.ceil(bounds.zMax/step),0,rows-1):rows-1;
   let changed=false,opened=false;
   for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
    const i=index(x,z),hit=options.structures.classify(x*step,z*step);
    const wasVillage=villageSolid[i],wasSolid=solid[i],wasWalkable=walkable[i],wasHard=hardBlocked(i);
    villageSolid[i]=hit?.kind==='solid'&&hit.village?1:0;
    const blocked=hit&&hit.kind!=='deck'&&hit.kind!=='wall'&&hit.kind!=='ladder'&&(hit.kind!=='gate'||!options.gateOpen?.(hit.gate));
    const nextSolid=barred[i]||blocked?1:0,nextWalkable=!(slope[i]||water[i]||nextSolid)?1:0;
    if(solid[i]!==nextSolid||walkable[i]!==nextWalkable||wasVillage!==villageSolid[i])changed=true;
    solid[i]=nextSolid;walkable[i]=nextWalkable;
    if((wasSolid&&!nextSolid)||(!wasWalkable&&nextWalkable)||(wasHard&&!hardBlocked(i)))opened=true;
   }
   if(changed){
    // Negative component knowledge survives only monotonic closures. Any
    // opening discards it, including a hard solid becoming a village cell.
    // Bridges, ladders and gate-access changes still require a new grid.
    if(opened)disconnectedBefore.length=0;else rememberDisconnectedComponents();
    rebuildClearance();regionsByClearance.clear();invalidateLogicalPermissions(bounds);failedPlans.clear();failedEscapes.clear();
    for(const key of pausedSearches.keys())discardSearch(key);automaticRoutes.clear();budgetLines.clear();
    for(const key of completePlans.keys())forgetRoute(completePlans,key);
    for(const key of finishingPlans.keys())forgetRoute(finishingPlans,key);
    revision++;
    statistics.solid=solid.reduce((n,v)=>n+v,0);statistics.blocked=walkable.reduce((n,v)=>n+(v===0),0);
   }
   return changed;
  }
  // Read-only diagnostics. Do not change the movement rules: this makes it
  // possible to distinguish a village's exact CASILLAS mask from authored
  // MLG flags, geometric cliffs, deep water, and formation clearance.
  function diagnose(x,z,radius=.6){
   const valid=inBounds(x,z),gx=clamp(Math.round(x/step),0,columns-1),gz=clamp(Math.round(z/step),0,rows-1);
   const i=index(gx,gz),hit=valid?options.structures?.classify(x,z):null;
   const cx=logical?clamp(Math.floor(x),0,logical.width-1):null;
   const cz=logical?clamp(Math.floor(z),0,logical.depth-1):null;
   const flags=logical?logical.values[cz*logical.width+cx]>>>0:null;
   const cellBlocked=logical?!!logicalBlocked[cz*logical.width+cx]:false;
   const hillAllowed=logical?!!gentleHill[cz*logical.width+cx]:false;
   // X-Ray only: local worst-case rise per metre at this foot position.
   // Do not use it as a second, inconsistent movement collision test.
   const h=worldHeight(x,z),quarter=.25;
   const groundGrade=Math.max(...[[quarter,0],[-quarter,0],[0,quarter],[0,-quarter]]
    .map(([dx,dz])=>Math.abs(worldHeight(x+dx,z+dz)-h)/quarter));
   const footprintBlocked=valid&&exactLogicalBlocked(x,z,radius);
   const required=radiusQuantized(radius);
   const clearanceMet=clearance[i]>required;
   const near=[];
   // Report the closest non-village reason for clearance rejection. This
   // search is only run when the debugging panel asks for an inspection.
   const range=Math.min(24,Math.ceil((Math.max(0,radius)+1.5)/step));
   let closest=null;
   for(let dz=-range;dz<=range;dz++)for(let dx=-range;dx<=range;dx++){
    const qx=gx+dx,qz=gz+dz;
    if(qx<0||qz<0||qx>=columns||qz>=rows)continue;
    const j=index(qx,qz);
    if(!hardBlocked(j))continue;
    const distance=Math.hypot(qx*step-x,qz*step-z);
    if(!closest||distance<closest.distance){
     const kind=barred[j]?'MLG blocked':water[j]?'deep water':slope[j]?'cliff/steep ground':'other solid structure';
     closest={kind,distance:+distance.toFixed(2),x:+(qx*step).toFixed(2),z:+(qz*step).toFixed(2)};
    }
   }
   const edgeClearance=Math.min(x,z,width-x,depth-z);
   if(!valid)near.push('Outside map bounds');
   else if(edgeClearance+1e-9<radius)
    near.push('Formation footprint crosses the world boundary');
   else if(edgeClearance<radius+step*.4)
    near.push('Near the map boundary (little room for outside ranks)');
   if(hit?.village)near.push('Inside village CASILLAS footprint (no safety radius)');
   else if(hit&&hit.kind!=='deck'&&hit.kind!=='wall'&&hit.kind!=='ladder'&&
    (hit.kind!=='gate'||!options.gateOpen?.(hit.gate)))near.push('Solid structure: '+hit.kind);
   if(hillAllowed)near.push('GENTLE HILLSIDE: slope flag overridden after heightfield grade checks');
   if(footprintBlocked)near.push('MLG blocked cell overlaps formation footprint');
   if(barred[i])near.push('Blocked MLG sample');
   if(water[i])near.push('Deep-water sample');
   if(slope[i])near.push('Cliff / excessive terrain height step');
   if(!clearanceMet)near.push('Formation clearance too small near non-village obstacle');
   const permitted=canStand(x,z,radius);
   if(!permitted&&!near.length)near.push('Navigation raster blocked at sampled position');
   const source=permitted?nearestCell(x,z,radius,Math.max(1.75,radius*1.45)):null;
   if(permitted&&!source)near.push('No accessible half-cell grid node near start');
   return {x,z,radius,allowed:permitted,valid,hitKind:hit?.kind||null,village:!!hit?.village,
    flags,logicalCell:{x:cx,z:cz,blocked:cellBlocked,overlap:footprintBlocked,gentleHill:hillAllowed},
    sample:{x:gx*step,z:gz*step,steep:!!slope[i],water:!!water[i],solid:!!solid[i],
     village:!!villageSolid[i],barred:!!barred[i],walkable:!!walkable[i]},
    clearance:+(clearance[i]*step/10).toFixed(2),requiredClearance:+(required*step/10).toFixed(2),
    groundGrade:+groundGrade.toFixed(2),groundHeight:+h.toFixed(2),
    worldEdgeGap:+edgeClearance.toFixed(2),worldEdgeOverlap:edgeClearance+1e-9<radius,
    villageRouteGap:+(villageDistance[i]*step/10).toFixed(2),
    nearestBlocker:closest,gridNodeFound:!!source,reasons:near};
  }
  const raised=(x,z)=>level[node(x,z)];
  return {plan,planFormation,planEdgeEscape,withWorkBudget,edgeStep,edgeRisk,canStand,lineClear,canMarchFoot,marchLineClear,canWingFoot,wingLineClear,formationWingReach:FORMATION_WING_REACH,refreshObstacles,diagnose,worldHeight,statistics,width,depth,step,water,ford,deck,solid,slope,cliff,clearance,villageDistance,walkable,level,raised,gateCells,barred,villageSolid,logicalBlocked,get revision(){return revision;},get workUnits(){return workUnits;},get lastBudgetExhausted(){return lastBudgetExhausted;},
   gentleHill,logicalWidth:logical?.width??null,logicalDepth:logical?.depth??null,
   profile:logical?.rules?.key??null};
 }
 return {create,sampleHeight};
});
