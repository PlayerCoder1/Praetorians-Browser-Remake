/* Burning buildings: volumetric flames, smoke, embers and firelight.

   Each flame is a box ray-marched through animated turbulence, after
   mattatz's THREE.Fire (MIT): along the view ray the shader samples a flame
   shape - hot white-yellow at the axis and the base, orange, then deep red
   at its licking edges - displaced upwards by three octaves of simplex noise
   that scroll up through the volume. The camera is orthographic, so every
   ray runs along the view direction.

   A building's fire level (0..1 of its FIRE_MAX, src/world/buildings.js)
   decides how far the fire has climbed: it catches at the base, round its
   footprint, and the flames grow up the building as the level rises, more
   of them as it spreads. Smoke and embers rise with it and an orange light
   flickers on the ground and the walls (the two biggest fires only). */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansFire=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const VERTEX=`precision highp float;
attribute vec3 position;
uniform mat4 world;uniform mat4 viewProjection;
varying vec3 vWorld;
void main(){vec4 w=world*vec4(position,1.);vWorld=w.xyz;gl_Position=viewProjection*w;}`;
 const FRAGMENT=`precision highp float;
varying vec3 vWorld;
uniform mat4 invWorld;uniform vec3 viewDir;uniform float time;uniform vec3 seed;uniform float heat;uniform float stepLen;
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){
 const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
 vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
 vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
 vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
 i=mod289(i);
 vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
 float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;
 vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
 vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);
 vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
 vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));
 vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
 vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
 vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
 p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
 vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
 return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float turbulence(vec3 p){float sum=0.,freq=1.,amp=1.;for(int i=0;i<3;i++){sum+=abs(snoise(p*freq))*amp;freq*=2.;amp*=.5;}return sum;}
// The flame's colour at distance st.x from its axis and height st.y.
vec4 flame(vec2 st){
 float w=mix(.95,.02,pow(st.y,.75));
 float d=st.x/max(w,.001);if(d>=1.)return vec4(0.);
 float core=1.-d,t=core*(1.-st.y*.8);
 vec3 c=mix(vec3(.42,.035,0.),vec3(1.,.3,.02),smoothstep(.04,.32,t));
 c=mix(c,vec3(1.,.66,.16),smoothstep(.3,.6,t));
 c=mix(c,vec3(1.,.93,.7),smoothstep(.62,.95,t));
 float a=smoothstep(0.,.3,core)*(1.-smoothstep(.5,1.,st.y));
 return vec4(c*a,a);
}
vec4 sampleFire(vec3 p){
 vec2 st=vec2(length(p.xz)*2.,p.y+.5);
 if(st.x>=1.||st.y<=0.||st.y>=1.)return vec4(0.);
 vec3 q=p;q.y-=(seed.z+time)*.55;q*=vec3(2.,3.2,2.);
 st.y+=sqrt(st.y)*1.25*turbulence(q+seed);
 if(st.y>=1.)return vec4(0.);
 return flame(st);
}
void main(){
 vec3 pos=(invWorld*vec4(vWorld,1.)).xyz;
 vec3 stepL=(invWorld*vec4(viewDir*stepLen,0.)).xyz;
 // A different start in each pixel hides the steps (no banding).
 pos+=stepL*fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
 vec4 col=vec4(0.);
 for(int i=0;i<40;i++){
  pos+=stepL;
  if(abs(pos.x)>.501||abs(pos.y)>.501||abs(pos.z)>.501)break;
  col+=sampleFire(pos);
 }
 gl_FragColor=vec4(col.rgb*.23*heat,1.);
}`;
 const FLAMES=7,MAX_LIGHTS=2;
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function create({B,scene,groundY}){
  B.Effect.ShadersStore.praetoriansFireVertexShader=VERTEX;
  B.Effect.ShadersStore.praetoriansFireFragmentShader=FRAGMENT;
  const soft=(()=>{
   const t=new B.DynamicTexture('fire particle',{width:64,height:64},scene,false),ctx=t.getContext();
   const g=ctx.createRadialGradient(32,32,0,32,32,32);
   g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.4,'rgba(255,255,255,.6)');g.addColorStop(1,'rgba(255,255,255,0)');
   ctx.fillStyle=g;ctx.fillRect(0,0,64,64);t.hasAlpha=true;t.update();return t;
  })();
  const fires=new Map(),smokeTails=new Map();let clock=0;
  function flameMesh(name,seed){
   const mesh=B.MeshBuilder.CreateBox(name,{size:1},scene);
   const material=new B.ShaderMaterial(name,scene,{vertex:'praetoriansFire',fragment:'praetoriansFire'},
    {attributes:['position'],uniforms:['world','viewProjection','invWorld','viewDir','time','seed','heat','stepLen'],needAlphaBlending:true});
   material.backFaceCulling=true;material.alphaMode=B.Engine.ALPHA_ONEONE;material.disableDepthWrite=true;
   material.setVector3('seed',new B.Vector3(seed*7.13,seed*3.71,seed*11.3));
   mesh.material=material;mesh.isPickable=false;mesh.renderingGroupId=2;mesh.setEnabled(false);
   return mesh;
  }
  // footprint: the building's ground outline in world x, z; height: its top.
  function build(key,footprint,height,{groundPatch=false}={}){
   const xs=footprint.map(p=>p.x),zs=footprint.map(p=>p.z);
   const cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2;
   const span=Math.max(groundPatch?1:1.5,Math.min(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs)));
   // The ground patch uses the garrison's seven volumetric flames, drawn
   // inside its small footprint rather than one isolated spark per cell.
   const inset=groundPatch?.6:.75;
   const corners=footprint.slice(0,4).map(p=>({x:cx+(p.x-cx)*inset,z:cz+(p.z-cz)*inset}));
   const spots=[corners[0],{x:cx,z:cz},corners[2],corners[1],corners[3],
    {x:(corners[0].x+corners[1].x)/2,z:(corners[0].z+corners[1].z)/2},{x:(corners[2].x+corners[3].x)/2,z:(corners[2].z+corners[3].z)/2}];
   const flames=spots.slice(0,FLAMES).map((p,i)=>({x:p.x,z:p.z,y:groundY(p.x,p.z),mesh:flameMesh(`fire ${key} ${i}`,i+1+Math.random()),
    start:i/FLAMES*(groundPatch?.2:.6),width:(groundPatch?span*(i===1?.85:.48):span*(i===1?.9:.62))*(.9+Math.random()*.2),tall:height*(i===1?1.3:1)*(.9+Math.random()*.35),shown:groundPatch?.35:0}));
   const ground=groundY(cx,cz);
   const smoke=new B.ParticleSystem(`smoke ${key}`,groundPatch?140:260,scene);
   smoke.particleTexture=soft;smoke.emitter=new B.Vector3(cx,ground,cz);smoke.renderingGroupId=2;
   smoke.minEmitBox=new B.Vector3(-span*(groundPatch?.28:.35),height*(groundPatch?.35:.6),-span*(groundPatch?.28:.35));smoke.maxEmitBox=new B.Vector3(span*(groundPatch?.28:.35),height*(groundPatch?.85:1.1),span*(groundPatch?.28:.35));
   smoke.color1=groundPatch?new B.Color4(.10,.095,.085,.48):new B.Color4(.13,.12,.11,.55);smoke.color2=groundPatch?new B.Color4(.19,.175,.15,.35):new B.Color4(.22,.2,.18,.45);smoke.colorDead=groundPatch?new B.Color4(.28,.27,.25,0):new B.Color4(.32,.31,.3,0);
   smoke.minSize=groundPatch?.6:.9;smoke.maxSize=groundPatch?1.2:2;smoke.minLifeTime=groundPatch?2:3;smoke.maxLifeTime=groundPatch?4:6;smoke.addSizeGradient(0,.5);smoke.addSizeGradient(1,2.6);
   smoke.direction1=groundPatch?new B.Vector3(.05,1.1,-.08):new B.Vector3(-.25,1,-.25);smoke.direction2=groundPatch?new B.Vector3(.35,1.8,.2):new B.Vector3(.6,1.5,.4);smoke.minEmitPower=.45;smoke.maxEmitPower=.8;
   smoke.blendMode=B.ParticleSystem.BLENDMODE_STANDARD;smoke.emitRate=0;smoke.start();
   const embers=new B.ParticleSystem(`embers ${key}`,groundPatch?60:220,scene);
   embers.particleTexture=soft;embers.emitter=new B.Vector3(cx,ground,cz);embers.renderingGroupId=2;
   embers.minEmitBox=new B.Vector3(-span*.4,.3,-span*.4);embers.maxEmitBox=new B.Vector3(span*.4,height,span*.4);
   embers.color1=new B.Color4(1,.75,.3,1);embers.color2=new B.Color4(1,.4,.08,1);embers.colorDead=new B.Color4(.4,.05,0,0);
   embers.minSize=groundPatch?.03:.05;embers.maxSize=groundPatch?.075:.12;embers.minLifeTime=groundPatch?.7:1;embers.maxLifeTime=groundPatch?1.6:2.6;
   embers.direction1=groundPatch?new B.Vector3(-.25,1.7,-.2):new B.Vector3(-.8,2.5,-.8);embers.direction2=groundPatch?new B.Vector3(.3,3,.25):new B.Vector3(.8,4,.8);embers.minEmitPower=.6;embers.maxEmitPower=groundPatch?.9:1.4;
   embers.addVelocityGradient(0,1);embers.addVelocityGradient(1,.3);embers.gravity=new B.Vector3(0,-.4,0);
   embers.blendMode=B.ParticleSystem.BLENDMODE_ADD;embers.emitRate=0;embers.start();
   return {flames,smoke,embers,cx,cz,ground,height,span,groundPatch,activeCells:null,phase:'burning',smolderAge:0,level:groundPatch?.45:0,target:0,light:null};
  }
  function lightFor(f){
   const light=new B.PointLight('firelight',new B.Vector3(f.cx,f.ground+f.height*.5,f.cz),scene);
   light.diffuse=new B.Color3(1,.52,.18);light.specular=B.Color3.Black();light.range=f.groundPatch?Math.max(4,f.span*3):Math.max(8,f.span*4);light.intensity=0;
   return light;
  }
  // level 0..1; footprint/height are only needed the first time.
  function set(key,level,footprint,height,options){
   let f=fires.get(key);
   if(level<=0&&!f)return;
   if(f?.groundPatch&&level<=0){
    // The lethal flame ends with its cell state. Only smoke and the last
    // airborne embers remain; their clock pauses with the rest of the game.
    if(f.phase!=='smolder'){
     f.phase='smolder';f.smolderAge=0;f.target=0;f.level=0;
     for(const flame of f.flames){flame.shown=0;flame.mesh.setEnabled(false);}
     f.smoke.minEmitBox.y=.04;f.smoke.maxEmitBox.y=.22;f.smoke.emitRate=6;f.embers.emitRate=0;
     f.light?.dispose();f.light=null;
    }
    return;
   }
   if(!f){if(!footprint?.length)return;f=build(key,footprint,height,options);fires.set(key,f);}
   // An overlapping patch may outlive some of its original cells. Keep its
   // flame origins on cells that still burn, including at clipped field edges.
   if(f.groundPatch&&Array.isArray(options?.cells))f.activeCells=new Set(options.cells.map(p=>`${p.x},${p.z}`));
   f.target=f.groundPatch?Math.max(.45,clamp(level,0,1)):clamp(level,0,1);
  }
  function dispose(key,f,immediate=false){
   for(const flame of f.flames){flame.mesh.material.dispose();flame.mesh.dispose();}
   f.smoke.stop();f.embers.stop();
   // The particle texture is shared by every fire, including garrisons.
   // Disposing one effect must not destroy the texture used by the others.
   if(f.groundPatch||immediate){f.smoke.dispose(false);f.embers.dispose(false);}
   else{
    // An extinguished fire's particles still belong to its building. Keep
    // that association so a subsequent loss of sight can remove the tail.
    if(!smokeTails.has(key))smokeTails.set(key,new Set());
    const tails=smokeTails.get(key),tail={f,timer:null};tails.add(tail);
    tail.timer=setTimeout(()=>{
     f.smoke.dispose(false);f.embers.dispose(false);tails.delete(tail);
     if(!tails.size)smokeTails.delete(key);
    },6000);
   }
   f.light?.dispose();fires.delete(key);
  }
  // Sight loss is immediate; ordinary extinguishing keeps its smoke tail.
  function hide(key){
   const f=fires.get(key);if(f)dispose(key,f,true);
   for(const tail of smokeTails.get(key)||[]){clearTimeout(tail.timer);tail.f.smoke.dispose(false);tail.f.embers.dispose(false);}
   smokeTails.delete(key);
  }
  function update(dt,camera){
   clock+=dt;
   const view=camera.target.subtract(camera.position).normalize();
   // Firelight for the biggest fires only (materials take a few lights).
   const lit=[...fires.values()].filter(f=>f.phase!=='smolder'&&f.level>.05).sort((a,b)=>b.level-a.level).slice(0,MAX_LIGHTS);
   for(const [key,f] of fires){
    if(f.phase==='smolder'){
     f.smolderAge+=dt;
     if(f.smolderAge>=4){dispose(key,f);continue;}
     f.smoke.emitRate=6*(1-f.smolderAge/4);
     continue;
    }
    // The fire's visible growth follows its level smoothly.
    f.level+=(f.target-f.level)*Math.min(1,dt*(f.groundPatch?3.5:1.6));
    if(f.target<=0&&f.level<.01){dispose(key,f);continue;}
    for(const flame of f.flames){
     if(f.activeCells&&!f.activeCells.has(`${Math.floor(flame.x)},${Math.floor(flame.z)}`)){flame.mesh.setEnabled(false);continue;}
     // Each flame catches once the fire reaches it, at the base, then climbs.
     const grow=clamp((f.level-flame.start)/Math.max(.05,1-flame.start),0,1);
     flame.shown+=(grow-flame.shown)*Math.min(1,dt*(f.groundPatch?4.5:2.2));
     const on=flame.shown>.02;flame.mesh.setEnabled(on);if(!on)continue;
     const h=Math.max(.5,flame.tall*(.18+1.05*flame.shown)),w=flame.width*(.55+.45*flame.shown);
     flame.mesh.scaling.set(w,h,w);flame.mesh.position.set(flame.x,flame.y+h*.5-.1,flame.z);
     flame.mesh.computeWorldMatrix(true);
     const m=flame.mesh.material;
     m.setMatrix('invWorld',flame.mesh.getWorldMatrix().clone().invert());
     m.setVector3('viewDir',view);m.setFloat('time',clock);
     m.setFloat('stepLen',Math.hypot(w,h,w)/40);
     m.setFloat('heat',.55+.45*flame.shown);
    }
    f.smoke.emitRate=f.level>.02?(f.groundPatch?8+30*f.level:6+46*f.level):0;
    f.smoke.maxEmitBox.y=f.height*(.4+.8*f.level);
    f.embers.emitRate=f.level>.15?(f.groundPatch?3+12*f.level:10+70*f.level):0;
    if(lit.includes(f)){
     f.light??=lightFor(f);
     f.light.intensity=(.35+(f.groundPatch?.65:1.1)*f.level)*(.82+.18*Math.sin(clock*13.1+f.cx)*Math.sin(clock*7.7+f.cz));
    }else if(f.light){f.light.dispose();f.light=null;}
   }
  }
  return {set,hide,update,fires};
 }
 return {create};
});
