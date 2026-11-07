/* Realistic water for rivers, lakes and small seas (WebGL, Babylon ShaderMaterial).
   Ported in spirit from a spectral-ocean playground and adapted to a top-down
   RTS camera: layered directional waves plus fine noise give the surface
   normal; rivers advect their ripples downstream with a two-phase flow map;
   Fresnel mixes a sky reflection over a see-through, depth-tinted body;
   a sun glint, shimmering caustics over shallows and broken foam along the
   banks finish it. The H2O vertex alpha (the original translucent fade) is
   used as a depth proxy: 0 at banks and fords, 1 in deep water. */
(function(root, factory) {
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PraetoriansWater=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const VERTEX=`
  precision highp float;
  attribute vec3 position;
  attribute vec2 uv;
  attribute vec4 color;
  attribute vec2 flow;
  uniform mat4 world;
  uniform mat4 viewProjection;
  varying vec3 vWorld;
  varying float vDepth;
  varying vec2 vFlow;
  void main(void){
   vec4 w=world*vec4(position,1.0);
   vWorld=w.xyz;vDepth=color.a;vFlow=flow;
   gl_Position=viewProjection*w;
  }`;
 const FRAGMENT=`
  precision highp float;
  varying vec3 vWorld;
  varying float vDepth;
  varying vec2 vFlow;
  uniform float time;
  uniform vec3 viewDirection;      // from the surface towards the camera
  uniform vec3 sunDirection;       // towards the sun
  uniform vec3 glintDirection;     // where the bright glitter appears
  uniform vec2 windDirection;
  uniform float waveScale;         // wavelength multiplier (rivers small, seas large)
  uniform float waveStrength;      // normal strength
  uniform float steepness;         // wave height relative to wavelength
  uniform float flowSpeed;         // 0 for still or open water
  uniform float choppiness;        // whitecaps on crests
  uniform float foamAmount;        // bank foam
  uniform float clarity;           // how see-through shallow water is
  uniform vec3 shallowColor;
  uniform vec3 deepColor;
  uniform vec3 skyHorizon;
  uniform vec3 skyZenith;
  uniform vec3 sunColor;

  float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
  // Value noise with analytic derivatives: (value, d/dx, d/dy).
  vec3 noised(vec2 p){
   vec2 i=floor(p),f=fract(p);
   vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0),du=30.0*f*f*(f*(f-2.0)+1.0);
   float a=hash(i),b=hash(i+vec2(1.0,0.0)),c=hash(i+vec2(0.0,1.0)),d=hash(i+vec2(1.0,1.0));
   float k1=b-a,k2=c-a,k4=a-b-c+d;
   return vec3(a+k1*u.x+k2*u.y+k4*u.x*u.y,du*(vec2(k1,k2)+k4*u.yx));
  }
  // Height (x) and gradient (yz) of the wave field: six directional waves
  // spread around the wind with deep-water dispersion (long swell to short
  // wavelets), plus fine fixed-size chop from two noise octaves.
  vec3 waves(vec2 p,float t){
   vec3 h=vec3(0.0);
   vec2 w=normalize(windDirection+vec2(1e-4));
   vec2 side=vec2(-w.y,w.x);
   for(int i=0;i<6;i++){
    float fi=float(i);
    vec2 dir=normalize(w+side*sin(fi*2.4)*0.55);
    float wavelength=waveScale*2.6*pow(0.72,fi);
    float k=6.2831853/wavelength;
    float amplitude=wavelength*steepness;
    float phase=dot(dir,p)*k-t*sqrt(9.8*k)*0.55+fi*1.7;
    h.x+=amplitude*sin(phase);
    h.yz+=dir*(amplitude*k*cos(phase));
   }
   vec3 n1=noised(p*3.1+t*0.25);
   vec3 n2=noised(p*6.7-t*0.37);
   h.x+=(n1.x-0.5)*0.022+(n2.x-0.5)*0.009;
   h.yz+=n1.yz*3.1*0.022+n2.yz*6.7*0.009;
   return h;
  }
  // Classic tileable caustic pattern.
  float caustic(vec2 uv,float t){
   vec2 p=mod(uv*6.2831853,6.2831853)-250.0;
   vec2 i=p;float c=1.0;
   for(int n=0;n<4;n++){
    float tt=t*(1.0-(3.5/float(n+1)));
    i=p+vec2(cos(tt-i.x)+sin(tt+i.y),sin(tt-i.y)+cos(tt+i.x));
    c+=1.0/length(vec2(p.x/(sin(i.x+tt)/0.005),p.y/(cos(i.y+tt)/0.005)));
   }
   c/=4.0;c=1.17-pow(c,1.4);
   return pow(abs(c),8.0);
  }
  void main(void){
   vec2 p=vWorld.xz;
   float flowLength=length(vFlow);
   vec2 flowDir=flowLength>1e-4?vFlow/flowLength:vec2(0.0);
   // Two-phase flow map: ripples drift downstream without smearing.
   float period=3.0;
   float ph0=fract(time/period),ph1=fract(time/period+0.5);
   float blend=abs(ph0-0.5)*2.0;
   vec2 drift=flowDir*flowSpeed*period;
   vec3 h0=waves(p-drift*ph0,time);
   vec3 h1=waves(p-drift*ph1+vec2(0.37,0.11),time);
   vec3 h=mix(h0,h1,blend);
   // Rivers: fine streaks stretched along the current.
   if(flowSpeed>0.0&&flowLength>1e-4){
    vec2 side=vec2(-flowDir.y,flowDir.x);
    vec2 q=vec2(dot(p,flowDir)*0.9-time*flowSpeed*1.3,dot(p,side)*3.2);
    vec3 s=noised(q*1.6);
    h.yz+=(flowDir*s.y*0.9+side*s.z*2.0)*0.016;
   }
   vec3 N=normalize(vec3(-h.y*waveStrength,1.0,-h.z*waveStrength));
   vec3 V=normalize(viewDirection);
   vec3 R=reflect(-V,N);
   float depth=smoothstep(0.0,1.0,vDepth);
   // Fresnel reflection of a soft afternoon sky.
   float fresnel=0.02+0.98*pow(1.0-max(dot(N,V),0.0),5.0);
   fresnel=clamp(fresnel*1.4+0.12,0.0,1.0);
   vec3 sky=mix(skyHorizon,skyZenith,pow(clamp(R.y,0.0,1.0),0.6));
   // The sky is brighter towards the sun: ripples facing it catch light.
   sky+=sunColor*pow(max(dot(R,normalize(glintDirection)),0.0),6.0)*0.55;
   // Water body: clear teal in the shallows, deep green-blue in the channel.
   vec3 body=mix(shallowColor,deepColor,depth);
   body*=0.74+0.52*max(dot(N,normalize(sunDirection)),0.0);
   // Caustics dance over shallow beds and fords.
   float c=caustic(p*0.33+flowDir*time*flowSpeed*0.05,time*0.6);
   body+=vec3(0.75,0.95,0.85)*c*(1.0-depth)*0.38;
   vec3 color=mix(body,sky,fresnel);
   // Sun: a soft sheen and sharp glitter.
   float sheen=pow(max(dot(R,normalize(sunDirection)),0.0),40.0)*0.22;
   // Glitter only on a sparse, shifting set of ripples.
   float sparkle=smoothstep(0.62,0.92,noised(p*5.0+vec2(time*0.7,-time*0.5)).x);
   float glitter=pow(max(dot(R,normalize(glintDirection)),0.0),700.0)*1.6*sparkle;
   color+=sunColor*(sheen+glitter);
   // Foam: broken lines along the banks, whitecaps on crests of open water.
   vec2 fp=p*2.4-flowDir*time*flowSpeed*0.9;
   float n=noised(fp).x*0.65+noised(fp*2.3+7.1).x*0.35;
   float bank=smoothstep(0.42,0.04,vDepth)*smoothstep(0.38,0.72,n)*foamAmount;
   float crest=smoothstep(0.75,1.15,h.x/(steepness*waveScale*2.6*1.8)+n*0.35)*choppiness;
   float foam=clamp(bank+crest,0.0,1.0);
   color=mix(color,vec3(0.93,0.96,0.94),foam*0.85);
   // Opacity: see the bed through shallow water, more cover where deep.
   float alpha=mix(0.15,0.74,depth)*(1.0-clarity*0.35)+fresnel*0.3+foam*0.55+glitter*0.3;
   alpha*=smoothstep(0.0,0.12,vDepth+foam*0.2);
   gl_FragColor=vec4(color,clamp(alpha,0.0,1.0));
  }`;
 // Presets: rivers flow and ripple finely; open water has longer wind waves
 // and whitecaps.
 const PRESETS={
  river:{waveScale:.7,steepness:.016,waveStrength:1.6,flowSpeed:.55,choppiness:.05,foamAmount:.85,clarity:.7,
   shallowColor:[.45,.66,.60],deepColor:[.12,.35,.39],windDirection:[.6,.8]},
  sea:{waveScale:2.2,steepness:.03,waveStrength:1.3,flowSpeed:0,choppiness:.55,foamAmount:1,clarity:.35,
   shallowColor:[.24,.55,.58],deepColor:[.02,.17,.27],windDirection:[.8,.35]}
 };
 // Downstream direction per vertex: the H2O texture's U runs along the river,
 // so the world-space gradient of U points with the current.
 function flowField(group){
  const p=group.positions,uv=group.uvs,t=group.indices,count=p.length/3;
  const flow=new Float32Array(count*2);
  if(!uv)return flow;
  for(let k=0;k<t.length;k+=3){
   const a=t[k],b=t[k+1],c=t[k+2];
   const x1=p[b*3]-p[a*3],z1=p[b*3+2]-p[a*3+2],x2=p[c*3]-p[a*3],z2=p[c*3+2]-p[a*3+2];
   const du1=uv[b*2]-uv[a*2],du2=uv[c*2]-uv[a*2],det=x1*z2-x2*z1;
   if(Math.abs(det)<1e-9)continue;
   const gx=(du1*z2-du2*z1)/det,gz=(x1*du2-x2*du1)/det,len=Math.hypot(gx,gz);
   if(len<1e-9)continue;
   for(const v of [a,b,c]){flow[v*2]+=gx/len;flow[v*2+1]+=gz/len;}
  }
  for(let v=0;v<count;v++){
   const len=Math.hypot(flow[v*2],flow[v*2+1]);
   if(len>1e-9){flow[v*2]/=len;flow[v*2+1]/=len;}
  }
  return flow;
 }
 // Rivers are built from several overlapping H2O meshes. Each mesh fades out
 // at its own ends, so where one lies inside another (a junction, a seam)
 // that fade would show as a false shoreline. Give every vertex the highest
 // opacity of any water covering it; returns new groups (inputs untouched).
 function blendOverlaps(groups){
  const alphaAt=(group,x,z)=>{
   const p=group.positions,c=group.colors,t=group.indices;let best=-1;
   for(let k=0;k<t.length;k+=3){
    const a=t[k],b=t[k+1],d=t[k+2];
    const ax=p[a*3],az=p[a*3+2],bx=p[b*3],bz=p[b*3+2],cx=p[d*3],cz=p[d*3+2];
    if(x<Math.min(ax,bx,cx)-1e-6||x>Math.max(ax,bx,cx)+1e-6||z<Math.min(az,bz,cz)-1e-6||z>Math.max(az,bz,cz)+1e-6)continue;
    const det=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(det)<1e-12)continue;
    const w0=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/det,w1=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/det,w2=1-w0-w1;
    if(w0<-1e-5||w1<-1e-5||w2<-1e-5)continue;
    best=Math.max(best,w0*c[a*4+3]+w1*c[b*4+3]+w2*c[d*4+3]);
   }
   return best;
  };
  return groups.map((group,gi)=>{
   if(!group.colors)return group;
   const colors=Float32Array.from(group.colors),p=group.positions;
   for(let v=0;v<p.length/3;v++){
    for(const [oi,other] of groups.entries()){
     if(oi===gi||!other.colors)continue;
     const a=alphaAt(other,p[v*3],p[v*3+2]);
     if(a>colors[v*4+3])colors[v*4+3]=a;
    }
   }
   return {...group,colors};
  });
 }
 // A river is long and thin along its U direction; anything else is treated
 // as open water.
 function classify(group){
  const uv=group.uvs;if(!uv||uv.length<4)return 'sea';
  let u0=Infinity,u1=-Infinity,v0=Infinity,v1=-Infinity;
  for(let i=0;i<uv.length;i+=2){u0=Math.min(u0,uv[i]);u1=Math.max(u1,uv[i]);v0=Math.min(v0,uv[i+1]);v1=Math.max(v1,uv[i+1]);}
  return (u1-u0)>2.5*Math.max(1e-6,v1-v0)?'river':'sea';
 }
 function create(B,scene,name,preset='river'){
  if(!B.Effect.ShadersStore.praetoriansWaterVertexShader){
   B.Effect.ShadersStore.praetoriansWaterVertexShader=VERTEX;
   B.Effect.ShadersStore.praetoriansWaterFragmentShader=FRAGMENT;
  }
  const settings=PRESETS[preset]||PRESETS.river;
  const material=new B.ShaderMaterial(name,scene,{vertex:'praetoriansWater',fragment:'praetoriansWater'},{
   attributes:['position','uv','color','flow'],
   uniforms:['world','viewProjection','time','viewDirection','sunDirection','glintDirection','windDirection','waveScale','steepness','waveStrength',
    'flowSpeed','choppiness','foamAmount','clarity','shallowColor','deepColor','skyHorizon','skyZenith','sunColor'],
   needAlphaBlending:true
  });
  material.backFaceCulling=false;material.disableDepthWrite=true;
  // Draw each pixel of water once: overlapping river meshes must not stack.
  material.stencil.enabled=true;material.stencil.func=B.Constants.NOTEQUAL;material.stencil.funcRef=1;
  material.stencil.opStencilDepthPass=B.Constants.REPLACE;
  for(const key of ['waveScale','steepness','waveStrength','flowSpeed','choppiness','foamAmount','clarity'])material.setFloat(key,settings[key]);
  material.setColor3('shallowColor',B.Color3.FromArray(settings.shallowColor));
  material.setColor3('deepColor',B.Color3.FromArray(settings.deepColor));
  material.setVector2('windDirection',B.Vector2.FromArray(settings.windDirection));
  material.setColor3('skyHorizon',new B.Color3(.70,.79,.80));
  material.setColor3('skyZenith',new B.Color3(.36,.53,.68));
  material.setColor3('sunColor',new B.Color3(1,.93,.78));
  material.setFloat('time',0);
  return material;
 }
 // The inexpensive display mode is also custom water. Never load the old
 // H2O bitmap pages: the H2O stream supplies only shape and shoreline alpha.
 function createSimple(B,scene,name,preset='river'){
  B.Effect.ShadersStore.praetoriansSimpleWaterVertexShader=`
   precision highp float;
   attribute vec3 position;
   attribute vec4 color;
   uniform mat4 worldViewProjection;
   varying float depth;
   void main(void){gl_Position=worldViewProjection*vec4(position,1.0);depth=color.a;}`;
  B.Effect.ShadersStore.praetoriansSimpleWaterFragmentShader=`
   precision highp float;
   varying float depth;
   uniform vec3 shallowColor,deepColor;
   void main(void){
    float d=smoothstep(0.0,1.0,depth);
    gl_FragColor=vec4(mix(shallowColor,deepColor,d),mix(.18,.68,d)*smoothstep(0.0,.12,depth));
   }`;
  const settings=PRESETS[preset]||PRESETS.river;
  const material=new B.ShaderMaterial(name,scene,{vertex:'praetoriansSimpleWater',fragment:'praetoriansSimpleWater'},
   {attributes:['position','color'],uniforms:['worldViewProjection','shallowColor','deepColor'],needAlphaBlending:true});
  material.setColor3('shallowColor',B.Color3.FromArray(settings.shallowColor));
  material.setColor3('deepColor',B.Color3.FromArray(settings.deepColor));
  material.backFaceCulling=false;material.disableDepthWrite=true;
  material.stencil.enabled=true;material.stencil.func=B.Constants.NOTEQUAL;material.stencil.funcRef=1;
  material.stencil.opStencilDepthPass=B.Constants.REPLACE;
  return material;
 }
 // Per frame: time, and light directions relative to the camera. The glitter
 // sits between the true sun and the camera's mirror direction so a top-down
 // view still catches sunlight on the ripples.
 function update(B,material,camera,seconds,sunTowards){
  const view=camera.position.subtract(camera.getTarget()).normalize();
  const mirror=new B.Vector3(-view.x,view.y,-view.z);
  const sun=sunTowards.clone().normalize();
  const glint=B.Vector3.Lerp(mirror,sun,.3).normalize();
  material.setFloat('time',seconds);
  material.setVector3('viewDirection',view);
  material.setVector3('sunDirection',sun);
  material.setVector3('glintDirection',glint);
 }
 return {create,createSimple,update,flowField,classify,blendOverlaps,PRESETS};
});
