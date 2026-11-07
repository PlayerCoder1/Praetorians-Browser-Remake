/* Fortress walls (MURALLAS: the map's .MUR, tools/terrain_formats.py
   decode_walls), their ladders and gates, for navigation and ground heights.

   - The top of each wall piece or tower is a raised walkway (height above the
     ground at the piece); its sloped sides are solid.
   - Fixed ladders (map objects TCE_ESCALA_FIJA*) and deployed siege ladders
     are ramps from their foot up to the nearest walkway.
   - A gate (PUERTA structures) is an opening through the wall, along the
     gate's local x axis: open ground for those it lets through, solid for
     the others, and open to everyone once broken.

   No dependency on rendering; used by terrain-nav.js through classify(). */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansFortress=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 // Ramp half width around the ladder's axis: three half-cell samples, the
 // least a marching column (one man abreast) needs to plan a route.
 const LADDER_HALF_WIDTH=.75;
 const EDGE=.06;                // Walkway edges are inclusive (samples on them).
 const LADDER_REACH=3.5;        // Furthest a ladder's top may be from its foot.
 const LADDER_INSIDE=.45;       // How far the ramp runs onto the walkway.
 const GATE_DEPTH=2.2;          // Opening half depth through the wall and its slopes.
 const GATE_TRIM=.3;            // Kept clear of the gateposts on each side.
 function inside(poly,x,z){
  let c=false;
  if(onEdge(poly,x,z))return true;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
   const [xi,zi]=poly[i],[xj,zj]=poly[j];
   if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;
  }
  return c;
 }
 function onEdge(poly,x,z){
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
   const [ax,az]=poly[j],[bx,bz]=poly[i],ex=bx-ax,ez=bz-az,len2=ex*ex+ez*ez;if(!len2)continue;
   const t=Math.max(0,Math.min(1,((x-ax)*ex+(z-az)*ez)/len2));
   if(Math.hypot(ax+ex*t-x,az+ez*t-z)<=EDGE)return true;
  }
  return false;
 }
 function bounds(poly,margin=0){
  const xs=poly.map(p=>p[0]),zs=poly.map(p=>p[1]);
  return [Math.min(...xs)-margin,Math.min(...zs)-margin,Math.max(...xs)+margin,Math.max(...zs)+margin];
 }
 const within=(b,x,z)=>x>=b[0]&&x<=b[2]&&z>=b[1]&&z<=b[3];
 // walls: map.walls ({name, bounds, pieces}); objects: map objects (ladders);
 // gates: [{placement:{x,z,r,name}, structure}] (structures.json PUERTA).
 function create({walls,objects=[],gates=[],groundY=()=>0}){
  const pieces=(walls?.pieces||[]).map(p=>{
   const base=p.top.reduce((n,[x,z])=>n+groundY(x,z),0)/p.top.length;
   // The walkway's long direction: the longer side of the top quad.
   const [a,b,c]=p.top,ab=Math.hypot(b[0]-a[0],b[1]-a[1]),bc=Math.hypot(c[0]-b[0],c[1]-b[1]);
   const along=ab>=bc?[(b[0]-a[0])/ab,(b[1]-a[1])/ab]:[(c[0]-b[0])/bc,(c[1]-b[1])/bc];
   return {...p,y:base+p.height,width:Math.min(ab,bc),along,box:bounds(p.footprint,EDGE),topBox:bounds(p.top,EDGE)};
  });
  const area=pieces.length?bounds(pieces.flatMap(p=>p.footprint),LADDER_REACH+1):null;
  const walkwayAt=(x,z)=>{
   let best=null;
   for(const p of pieces)if(within(p.topBox,x,z)&&inside(p.top,x,z)&&(!best||p.y>best.y))best=p;
   // topBox carries the EDGE margin (bounds(p.top, EDGE)).
   return best;
  };
  // Ladders: from the foot along the object's local +x (world (cos r, -sin r))
  // until the walkway; the ramp climbs from the ground to the walkway.
  const ladders=[];
  function makeLadder(x,z,r,info={}){
   const dx=Math.cos(r),dz=-Math.sin(r);
   let top=null,piece=null;
   for(let d=.1;d<=LADDER_REACH;d+=.1){
    const p=walkwayAt(x+dx*d,z+dz*d);
    if(p){piece=p;top=d+LADDER_INSIDE;break;}
   }
   if(!piece)return null;
   const ladder={id:info.id??('L'+ladders.length),x,z,dx,dz,length:top,piece,foot:groundY(x,z),...info};
   ladder.box=[Math.min(x,x+dx*top)-1,Math.min(z,z+dz*top)-1,Math.max(x,x+dx*top)+1,Math.max(z,z+dz*top)+1];
   return ladder;
  }
  if(pieces.length)for(const o of objects){
   if(!/escala_fija/i.test(o.n))continue;
   const ladder=makeLadder(o.x,o.z,o.r||0,{fixed:true});if(ladder)ladders.push(ladder);
  }
  function ladderAt(x,z){
   for(const l of ladders){
    if(!within(l.box,x,z))continue;
    const rx=x-l.x,rz=z-l.z,t=rx*l.dx+rz*l.dz,side=Math.abs(rx*l.dz-rz*l.dx);
    if(t<-.05||t>l.length||side>LADDER_HALF_WIDTH)continue;
    const climb=Math.min(1,t/Math.max(.1,l.length-LADDER_INSIDE));
    return {ladder:l,y:l.foot+(l.piece.y-l.foot)*climb};
   }
   return null;
  }
  // Gates: the opening is the door plane's span (PUNTO_SUPERFICIE, local z)
  // through the wall's thickness (local x): as deep as the wall piece the gate
  // stands in, sides included, plus a step of clearance.
  const toWorld=(g,lx,lz)=>({x:g.x+lx*g.c+lz*g.s,z:g.z-lx*g.s+lz*g.c});
  function wallDepth(g,lx,lz,direction){
   let inWall=false,last=0;
   for(let d=0;d<=GATE_DEPTH*2;d+=.1){
    const w=toWorld(g,lx+direction*d,lz);
    if(pieces.some(p=>within(p.box,w.x,w.z)&&inside(p.footprint,w.x,w.z))){inWall=true;last=d;}
   }
   return inWall?last+.35:GATE_DEPTH;
  }
  const gateList=gates.map((g,index)=>{
   const p=g.placement,s=g.structure||{},surface=s.surface||[[.5,0,-1.5],[.5,0,2.5]];
   const zs=surface.map(v=>v[2]),xs=surface.map(v=>v[0]);
   const centreX=xs.reduce((n,v)=>n+v,0)/xs.length;
   const gate={index,placement:p,structure:s,name:p.name||null,x:p.x,z:p.z,r:p.r||0,c:Math.cos(p.r||0),s:Math.sin(p.r||0),
    z0:Math.min(...zs)+GATE_TRIM,z1:Math.max(...zs)-GATE_TRIM,
    life:s.life||100000,maxLife:s.life||100000,broken:false,holder:p.owner&&!/^neutral$/i.test(p.owner)?p.owner:null};
   const lz=(gate.z0+gate.z1)/2,spans=[gate.z0+.2,lz,gate.z1-.2];
   const back=Math.max(...spans.map(z=>wallDepth(gate,centreX,z,-1))),front=Math.max(...spans.map(z=>wallDepth(gate,centreX,z,1)));
   gate.x0=centreX-back;gate.x1=centreX+front;
   // Gate centre in the world, and where attackers stand on either side.
   gate.centre=toWorld(gate,centreX,lz);
   gate.sides=[gate.x0-.9,gate.x1+.9].map(ax=>toWorld(gate,ax,lz));
   const reach=Math.max(back,front)+3;
   gate.box=[gate.centre.x-reach,gate.centre.z-reach,gate.centre.x+reach,gate.centre.z+reach];
   return gate;
  });
  function gateAt(x,z){
   for(const g of gateList){
    if(!within(g.box,x,z))continue;
    const dx=x-g.x,dz=z-g.z,lx=dx*g.c-dz*g.s,lz=dx*g.s+dz*g.c;
    if(lx>=g.x0&&lx<=g.x1&&lz>=g.z0&&lz<=g.z1)return g;
   }
   return null;
  }
  // 'ladder' {y} | 'gate' {gate} | 'wall' {y, piece} | 'solid' | null.
  function classify(x,z){
   if(!area||!within(area,x,z))return null;
   const l=ladderAt(x,z);if(l)return {kind:'ladder',y:l.y,ladder:l.ladder};
   const g=gateAt(x,z);if(g)return {kind:'gate',gate:g};
   const w=walkwayAt(x,z);if(w)return {kind:'wall',y:w.y,piece:w};
   for(const p of pieces)if(within(p.box,x,z)&&inside(p.footprint,x,z))return {kind:'solid',piece:p};
   return null;
  }
  // Raise the height samples of walkways and ladders. Ground samples beside
  // them stay put: the steep step marks them unwalkable (the wall's foot).
  function patchHeights(heights,columns,rows,step){
   if(!area)return 0;
   let patched=0;
   const x0=Math.max(0,Math.floor(area[0]/step)),x1=Math.min(columns-1,Math.ceil(area[2]/step));
   const z0=Math.max(0,Math.floor(area[1]/step)),z1=Math.min(rows-1,Math.ceil(area[3]/step));
   for(let gz=z0;gz<=z1;gz++)for(let gx=x0;gx<=x1;gx++){
    const hit=classify(gx*step,gz*step);
    if(hit&&(hit.kind==='wall'||hit.kind==='ladder')){heights[gz*columns+gx]=hit.y;patched++;}
   }
   return patched;
  }
  // A siege ladder set against the wall at (x, z), leaning along r.
  function addLadder(x,z,r,id){
   const ladder=makeLadder(x,z,r,{id,siege:true});if(ladder)ladders.push(ladder);return ladder;
  }
  function removeLadder(id){const i=ladders.findIndex(l=>l.id===id);if(i>=0)ladders.splice(i,1);return i>=0;}
  // Nearest point at the foot of a wall from (x, z), and the direction to
  // lean a ladder there (towards the walkway).
  function ladderSpot(x,z,maxDistance=6){
   let best=null;
   for(const p of pieces){
    if(p.tower)continue;
    const n=p.footprint.length;
    for(let i=0;i<n;i++){
     const [ax,az]=p.footprint[i],[bx,bz]=p.footprint[(i+1)%n],ex=bx-ax,ez=bz-az,len=Math.hypot(ex,ez);if(len<1)continue;
     const t=Math.max(.15,Math.min(.85,((x-ax)*ex+(z-az)*ez)/(len*len))),px=ax+ex*t,pz=az+ez*t;
     // Outward normal of the edge; the foot stands a little outside it.
     let nx=ez/len,nz=-ex/len;const cx=p.top.reduce((s,q)=>s+q[0],0)/4,cz=p.top.reduce((s,q)=>s+q[1],0)/4;
     if((px-cx)*nx+(pz-cz)*nz<0){nx=-nx;nz=-nz;}
     const foot={x:px+nx*1.1,z:pz+nz*1.1},d=Math.hypot(foot.x-x,foot.z-z);
     if(d<=maxDistance&&(!best||d<best.d))best={...foot,r:Math.atan2(nz,-nx),d,piece:p};
    }
   }
   return best;
  }
  const isWalkway=(x,z)=>!!walkwayAt(x,z);
  // On top of a wall piece, ignoring gates and ladders cut through it (a
  // mission's troops placed over a gate stand on the wall beside it).
  const onTop=(x,z)=>pieces.some(p=>within(p.topBox,x,z)&&inside(p.top,x,z));
  function walkwayNear(x,z,maxDistance=6){
   for(let r=0;r<=maxDistance;r+=.25)for(let a=0;a<(r?24:1);a++){
    const px=x+Math.cos(a*Math.PI/12)*r,pz=z+Math.sin(a*Math.PI/12)*r;
    if(walkwayAt(px,pz)&&!ladderAt(px,pz)&&!gateAt(px,pz))return {x:px,z:pz};
   }
   return null;
  }
  // Inside the fortress: the ground the walls and closed gates enclose
  // (setInterior, from a navigation grid), else its bounding rectangle.
  const fortBox=walls?.bounds||null;
  let interior=null;
  function setInterior(grid){
   const columns=grid.statistics.columns,rows=grid.statistics.rows,step=grid.step,size=columns*rows;
   const open=i=>(grid.walkable[i]||grid.level[i])&&!grid.gateCells[i];
   const label=new Int32Array(size).fill(-1),sizes=[];
   const cell=p=>{const x=Math.round(p.x/step),z=Math.round(p.z/step);return x>=0&&z>=0&&x<columns&&z<rows?z*columns+x:-1;};
   function flood(start){
    // The nearest open sample to a gate side, then everything joined to it.
    let seed=-1;const sx=start%columns,sz=(start/columns)|0;
    for(let r=0;r<=4&&seed<0;r++)for(let dz=-r;dz<=r&&seed<0;dz++)for(let dx=-r;dx<=r;dx++){const x=sx+dx,z=sz+dz;if(x>=0&&z>=0&&x<columns&&z<rows&&open(z*columns+x)){seed=z*columns+x;break;}}
    if(seed<0)return -1;if(label[seed]>=0)return label[seed];
    const id=sizes.length,queue=[seed];label[seed]=id;
    for(let h=0;h<queue.length;h++){
     const i=queue[h],x=i%columns,z=(i/columns)|0;
     for(const j of [x>0?i-1:-1,x<columns-1?i+1:-1,z>0?i-columns:-1,z<rows-1?i+columns:-1])if(j>=0&&label[j]<0&&open(j)){label[j]=id;queue.push(j);}
    }
    sizes.push(queue.length);return id;
   }
   const inner=new Set();
   for(const g of gateList){
    const [a,b]=g.sides.map(cell).map(i=>i<0?-1:flood(i));
    if(a<0||b<0||a===b)continue;
    inner.add(sizes[a]<sizes[b]?a:b);
   }
   if(!inner.size)return false;
   const mask=new Uint8Array(size);for(let i=0;i<size;i++)if(inner.has(label[i]))mask[i]=1;
   interior={mask,columns,rows,step};return true;
  }
  function contains(x,z){
   if(interior){const gx=Math.round(x/interior.step),gz=Math.round(z/interior.step);return gx>=0&&gz>=0&&gx<interior.columns&&gz<interior.rows&&interior.mask[gz*interior.columns+gx]===1;}
   return !!fortBox&&x>=fortBox[0]&&x<=fortBox[2]&&z>=fortBox[1]&&z<=fortBox[3];
  }
  return {pieces,ladders,gates:gateList,classify,patchHeights,walkwayAt,isWalkway,onTop,walkwayNear,gateAt,addLadder,removeLadder,ladderSpot,contains,setInterior,bounds:fortBox,name:walls?.name||null};
 }
 return {create};
});
