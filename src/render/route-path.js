/* The selected troops' routes, drawn on the ground.

   Each route is a ribbon laid over the terrain: resampled every 30 cm and
   each edge set on the ground beneath it, so it follows hills, ridges and
   hollows instead of cutting straight through them between waypoints. It
   is gold with a dark rim (it reads on snow as on grass), and bright
   chevrons flow along it towards the destination, which a pulsing ring
   marks. It starts at the troop's head and shortens as the troop marches.

   Where trees or a hill hide the route, a faint copy still shows through
   (depth test GREATER), so a route is never lost under a forest. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansRoutePath=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const VERTEX=`precision highp float;
attribute vec3 position;attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main(){gl_Position=worldViewProjection*vec4(position,1.);vUV=uv;}`;
 // uv.x: metres along the route (around the ring); uv.y: 0..1 across the
 // ribbon, 2..3 across the destination ring.
 const FRAGMENT=`precision highp float;
varying vec2 vUV;
uniform float time,trim,total,ghost;
void main(){
 bool ring=vUV.y>1.5;
 float e=abs(fract(vUV.y)*2.-1.),u=vUV.x;
 if(!ring&&u<trim)discard;
 float rim=smoothstep(.5,.66,e),soft=1.-smoothstep(.86,1.,e);
 vec3 gold=vec3(.97,.71,.2),light=vec3(1.,.95,.72),dark=vec3(.15,.09,.03);
 vec3 col;float a;
 if(ring){
  float pulse=.5+.5*sin(time*4.);
  col=mix(mix(gold,light,pulse*.6),dark,rim);a=soft*mix(.95,.7,rim);
 }else{
  // Chevrons pointing along the route, flowing towards its end.
  float f=fract((u+e*.3)/.9-time*1.1);
  float chevron=smoothstep(0.,.07,f)*(1.-smoothstep(.3,.38,f));
  col=mix(mix(gold,light,chevron),dark,rim);
  a=soft*mix(.93,.78,rim)*smoothstep(trim,trim+.9,u)*(1.-smoothstep(total-.25,total,u));
 }
 if(ghost>.5){col=mix(col,light,.35);a*=.4;}
 if(a<.01)discard;
 gl_FragColor=vec4(col,a);
}`;
 const STEP=.3,HALF_WIDTH=.17,LIFT=.1,RING_RADIUS=.62,RING_HALF=.07;
 function create({B,scene,groundY}){
  B.Effect.ShadersStore.praetoriansRouteVertexShader=VERTEX;
  B.Effect.ShadersStore.praetoriansRouteFragmentShader=FRAGMENT;
  const routes=new Map();let shown=[],clock=0;
  function material(name,ghost){
   const m=new B.ShaderMaterial(name,scene,{vertex:'praetoriansRoute',fragment:'praetoriansRoute'},
    {attributes:['position','uv'],uniforms:['worldViewProjection','time','trim','total','ghost'],needAlphaBlending:true});
   m.backFaceCulling=false;m.disableDepthWrite=true;m.setFloat('ghost',ghost?1:0);
   // The route sits on the ground, pulled a little towards the camera so the
   // terrain's own triangles never cover it; the ghost shows only where
   // something stands in front of it.
   if(ghost)m.depthFunction=B.Constants.GREATER;else m.zOffset=-3;
   return m;
  }
  const lay=(x,z)=>groundY(x,z)+LIFT;
  // The route's ribbon and its destination ring as one mesh.
  function geometry(points){
   const samples=[{x:points[0].x,z:points[0].z,u:0}];
   for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],length=Math.hypot(b.x-a.x,b.z-a.z),pieces=Math.max(1,Math.ceil(length/STEP)),from=samples[samples.length-1].u;
    if(length<1e-4)continue;
    for(let k=1;k<=pieces;k++){const t=k/pieces;samples.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,u:from+length*t});}
   }
   const positions=[],uvs=[],indices=[];
   samples.forEach((p,i)=>{
    const a=samples[Math.max(0,i-1)],b=samples[Math.min(samples.length-1,i+1)],d=Math.hypot(b.x-a.x,b.z-a.z)||1;
    const nx=(b.z-a.z)/d,nz=-(b.x-a.x)/d;
    for(const side of [-1,1]){const x=p.x+nx*HALF_WIDTH*side,z=p.z+nz*HALF_WIDTH*side;positions.push(x,lay(x,z),z);uvs.push(p.u,side<0?0:1);}
    if(i){const v=i*2;indices.push(v-2,v-1,v,v-1,v+1,v);}
   });
   const end=samples[samples.length-1],base=positions.length/3,around=32;
   for(let k=0;k<=around;k++){
    const angle=k/around*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle);
    for(const [r,v] of [[RING_RADIUS-RING_HALF,2],[RING_RADIUS+RING_HALF,3]]){const x=end.x+c*r,z=end.z+s*r;positions.push(x,lay(x,z),z);uvs.push(angle*RING_RADIUS,v);}
    if(k){const v=base+k*2;indices.push(v-2,v-1,v,v-1,v+1,v);}
   }
   return {positions,uvs,indices,total:end.u};
  }
  function build(squad){
   const points=squad.path.map(p=>({x:p.x,z:p.z})),made=geometry(points),data=new B.VertexData();
   data.positions=made.positions;data.uvs=made.uvs;data.indices=made.indices;
   const mesh=new B.Mesh(`route ${squad.index??''}`,scene);data.applyToMesh(mesh,false);
   mesh.material=material('route',false);mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;
   const ghost=mesh.clone(`route ghost ${squad.index??''}`);ghost.material=material('route ghost',true);ghost.isPickable=false;ghost.alwaysSelectAsActiveMesh=true;
   for(const m of [mesh.material,ghost.material])m.setFloat('total',made.total);
   const cumulative=[0];for(let i=1;i<points.length;i++)cumulative.push(cumulative[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z));
   return {path:squad.path,points,cumulative,total:made.total,mesh,ghost,trim:0};
  }
  function remove(squad){
   const route=routes.get(squad);if(!route)return;
   for(const m of [route.mesh,route.ghost]){m.material.dispose();m.dispose();}
   routes.delete(squad);
  }
  // How far along its route the troop's head has come (never back).
  function progress(squad,route){
   const {points,cumulative}=route,at=Math.max(1,Math.min(points.length-1,squad.waypoint||1));
   let best=Infinity,along=route.trim;
   for(let i=Math.max(1,at-1);i<=Math.min(points.length-1,at+1);i++){
    const a=points[i-1],b=points[i],length=cumulative[i]-cumulative[i-1];if(length<1e-6)continue;
    const t=Math.max(0,Math.min(1,((squad.x-a.x)*(b.x-a.x)+(squad.z-a.z)*(b.z-a.z))/(length*length)));
    const d=Math.hypot(squad.x-a.x-(b.x-a.x)*t,squad.z-a.z-(b.z-a.z)*t);
    if(d<best){best=d;along=cumulative[i-1]+length*t;}
   }
   // A marching block's centre is on the route: start at its front rank.
   const front=squad.flow?.column?0:Math.max(0,...(squad.members||[]).map(m=>m.dz||0));
   return Math.max(route.trim,Math.min(route.total,along+front));
  }
  // squads: the troops whose routes to show (the selection, or none).
  function show(squads){
   shown=[...squads];
   for(const squad of [...routes.keys()])if(!shown.includes(squad))remove(squad);
  }
  function update(dt){
   clock+=dt||0;
   for(const squad of shown){
    const live=squad.path&&squad.path.length>=2&&squad.isMoving;
    let route=routes.get(squad);
    if(route&&(!live||route.path!==squad.path)){remove(squad);route=null;}
    if(!live)continue;
    if(!route){route=build(squad);routes.set(squad,route);}
    route.trim=progress(squad,route);
    for(const m of [route.mesh.material,route.ghost.material]){m.setFloat('time',clock);m.setFloat('trim',route.trim);}
   }
  }
  return {show,update,get count(){return routes.size;}};
 }
 return {create};
});
