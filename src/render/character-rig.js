/* Editable, lightweight LBS rig for the HD vertex-animation meshes. The HD
   exports have no skeleton: automatic human bindings are a starting point and
   can be corrected with pivot edits and weight painting in the workshop. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansCharacterRig=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const FORMAT='praetorians-character-rig-v1';
 const LIMITS=Object.freeze({maxJoints:64,maxVertices:30000,maxInfluences:4,maxPivot:20,maxRotation:Math.PI*4});
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
 const fail=message=>{throw new Error('Character rig: '+message);};
 function vector(value,label,bound=LIMITS.maxPivot){
  if(!Array.isArray(value)||value.length!==3||Array.from(value).some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>bound))fail(label+' needs three finite numbers within ±'+bound);
  return value.slice();
 }
 function normalize(influences){
  const map=new Map();
  for(const [id,weight] of influences)if(weight>0)map.set(id,(map.get(id)||0)+weight);
  const out=Array.from(map).sort((a,b)=>b[1]-a[1]).slice(0,LIMITS.maxInfluences);
  const sum=out.reduce((s,p)=>s+p[1],0);
  return sum?out.map(([id,weight])=>[id,weight/sum]):[];
 }
 function validate(input,vertexCount){
  if(!input||input.format!==FORMAT)fail('unsupported binding format');
  if(!Number.isInteger(input.vertexCount)||input.vertexCount<1||input.vertexCount>LIMITS.maxVertices||vertexCount!==undefined&&input.vertexCount!==vertexCount)fail('binding vertex count does not match this HD mesh');
  if(!Array.isArray(input.joints)||!input.joints.length||input.joints.length>LIMITS.maxJoints)fail('use 1–'+LIMITS.maxJoints+' joints');
  const ids=new Set(),joints=Array.from(input.joints,j=>{
   if(!j||typeof j.id!=='string'||!/^\w[\w-]{0,47}$/.test(j.id)||own(Object.prototype,j.id)||j.id==='prototype'||ids.has(j.id))fail('joint IDs must be unique simple names');
   ids.add(j.id);return {id:j.id,parent:j.parent??null,pivot:vector(j.pivot,'pivot')};
  });
  if(joints.filter(j=>j.parent===null).length!==1)fail('a rig needs exactly one root joint');
  const byId=new Map(joints.map(j=>[j.id,j]));
  for(const joint of joints){
   if(joint.parent!==null&&(typeof joint.parent!=='string'||!ids.has(joint.parent)))fail('missing parent joint');
   const visited=new Set();let current=joint;
   while(current){if(visited.has(current.id))fail('joint hierarchy contains a cycle');visited.add(current.id);current=current.parent===null?null:byId.get(current.parent);}
  }
  if(!Array.isArray(input.weights)||input.weights.length!==input.vertexCount)fail('each vertex needs weights');
  const weights=Array.from(input.weights,influences=>{
   if(!Array.isArray(influences)||!influences.length||influences.length>LIMITS.maxInfluences)fail('use 1–4 influences per vertex');
   for(const influence of influences)if(!Array.isArray(influence)||influence.length!==2||!ids.has(influence[0])||typeof influence[1]!=='number'||!Number.isFinite(influence[1])||influence[1]<0||influence[1]>1)fail('invalid vertex weight');
   const normalized=normalize(influences);if(!normalized.length)fail('vertex weights must have a positive sum');return normalized;
  });
  return {format:FORMAT,vertexCount:input.vertexCount,joints,weights};
 }
 function compile(input){
  const rig=validate(input),byId=new Map(rig.joints.map((j,i)=>[j.id,i])),order=[],visited=new Set();
  function visit(i){if(visited.has(i))return;const p=rig.joints[i].parent;if(p!==null)visit(byId.get(p));visited.add(i);order.push(i);}
  rig.joints.forEach((_,i)=>visit(i));
  const weights=new Float32Array(rig.vertexCount*4),indices=new Uint8Array(rig.vertexCount*4);
  rig.weights.forEach((row,v)=>row.forEach(([id,w],i)=>{indices[v*4+i]=byId.get(id);weights[v*4+i]=w;}));
  return {rig,byId,order,weights,indices,global:new Float64Array(rig.joints.length*12),skin:new Float64Array(rig.joints.length*12),isCompiledRig:true};
 }
 function rotationValues(rotations,id){
  const r=rotations&&own(rotations,id)?rotations[id]:[0,0,0];
  if(!r||r.length!==3||Array.from(r).some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>LIMITS.maxRotation))fail('invalid rotation for '+id);
  return r;
 }
 function transforms(compiled,rotations){
  const {rig,byId,order,global:g,skin:s}=compiled;let changed=false;
  for(const i of order){
   const j=rig.joints[i],r=rotationValues(rotations,j.id),[x,y,z]=r;changed=changed||x!==0||y!==0||z!==0;
   const cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
   // Rz * Ry * Rx, with column vectors, then the parent joint transform.
   const a00=cz*cy,a01=cz*sy*sx-sz*cx,a02=cz*sy*cx+sz*sx;
   const a10=sz*cy,a11=sz*sy*sx+cz*cx,a12=sz*sy*cx-cz*sx;
   const a20=-sy,a21=cy*sx,a22=cy*cx,o=i*12;
   if(j.parent===null){
    g[o]=a00;g[o+1]=a01;g[o+2]=a02;g[o+3]=j.pivot[0];
    g[o+4]=a10;g[o+5]=a11;g[o+6]=a12;g[o+7]=j.pivot[1];
    g[o+8]=a20;g[o+9]=a21;g[o+10]=a22;g[o+11]=j.pivot[2];
   }else{
    const parent=byId.get(j.parent),p=parent*12,pivot=rig.joints[parent].pivot;
    const tx=j.pivot[0]-pivot[0],ty=j.pivot[1]-pivot[1],tz=j.pivot[2]-pivot[2];
    for(let row=0;row<3;row++){
     const n=o+row*4,k=p+row*4;
     g[n]=g[k]*a00+g[k+1]*a10+g[k+2]*a20;
     g[n+1]=g[k]*a01+g[k+1]*a11+g[k+2]*a21;
     g[n+2]=g[k]*a02+g[k+1]*a12+g[k+2]*a22;
     g[n+3]=g[k]*tx+g[k+1]*ty+g[k+2]*tz+g[k+3];
    }
   }
   for(let row=0;row<3;row++){
    const n=o+row*4;s[n]=g[n];s[n+1]=g[n+1];s[n+2]=g[n+2];
    s[n+3]=g[n+3]-g[n]*j.pivot[0]-g[n+1]*j.pivot[1]-g[n+2]*j.pivot[2];
   }
  }
  return changed;
 }
 function deform(input,positions,rotations,out){
  const compiled=input?.isCompiledRig?input:compile(input),{rig,weights,indices,skin}=compiled;
  if(!positions||positions.length!==rig.vertexCount*3)fail('pose vertex count does not match binding');
  out=out&&out.length===positions.length?out:new Float32Array(positions.length);
  if(!transforms(compiled,rotations)){out.set(positions);return out;}
  for(let v=0;v<rig.vertexCount;v++){
   const offset=v*3,x=positions[offset],y=positions[offset+1],z=positions[offset+2];let xx=0,yy=0,zz=0;
   for(let k=0;k<4;k++){const w=weights[v*4+k];if(!w)continue;const i=indices[v*4+k]*12;
    xx+=(skin[i]*x+skin[i+1]*y+skin[i+2]*z+skin[i+3])*w;
    yy+=(skin[i+4]*x+skin[i+5]*y+skin[i+6]*z+skin[i+7])*w;
    zz+=(skin[i+8]*x+skin[i+9]*y+skin[i+10]*z+skin[i+11])*w;
   }
   out[offset]=xx;out[offset+1]=yy;out[offset+2]=zz;
  }
  return out;
 }
 function jointPositions(input,rotations){
  const c=input?.isCompiledRig?input:compile(input);transforms(c,rotations);const out={};
  c.rig.joints.forEach((j,i)=>{out[j.id]=[c.global[i*12+3],c.global[i*12+7],c.global[i*12+11]];});return out;
 }
 function smooth(a,b,x){const k=Math.max(0,Math.min(1,(x-a)/(b-a)));return k*k*(3-2*k);}
 function auto(model){
  const positions=(model.animations.rest||Object.values(model.animations)[0])?.frames?.[0]?.positions;
  if(!positions?.length||positions.length%3||positions.length/3>LIMITS.maxVertices)fail('model has no usable rest pose');
  const ys=[],xs=[],zs=[];for(let i=0;i<positions.length;i+=3){xs.push(positions[i]);ys.push(positions[i+1]);zs.push(positions[i+2]);}
  for(const a of [xs,ys,zs])a.sort((x,y)=>x-y);
  const q=(a,t)=>a[Math.min(a.length-1,Math.floor(a.length*t))];
  // Percentiles keep tall spear tips and hanging equipment from setting the
  // entire human's height. They remain editable for mounted/atypical meshes.
  const bottom=q(ys,.05),height=Math.max(.05,(q(ys,.95)-bottom)/.96),cx=q(xs,.5),cz=q(zs,.5);
  const pivot=(x,y,z=0)=>[cx+x*height,bottom+y*height,cz+z*height];
  const joints=[{id:'hips',parent:null,pivot:pivot(0,.49)},{id:'torso',parent:'hips',pivot:pivot(0,.58)},{id:'head',parent:'torso',pivot:pivot(0,.8)}];
  for(const [side,sign] of [['left',-1],['right',1]]){
   joints.push({id:side+'UpperArm',parent:'torso',pivot:pivot(sign*.13,.74)},
    {id:side+'Forearm',parent:side+'UpperArm',pivot:pivot(sign*.18,.58)},
    {id:side+'Hand',parent:side+'Forearm',pivot:pivot(sign*.19,.52,.02)},
    {id:side+'UpperLeg',parent:'hips',pivot:pivot(sign*.07,.49)},
    {id:side+'LowerLeg',parent:side+'UpperLeg',pivot:pivot(sign*.075,.27)},
    {id:side+'Foot',parent:side+'LowerLeg',pivot:pivot(sign*.075,.075)});
  }
  const weights=[];
  for(let i=0;i<positions.length;i+=3){
   const x=(positions[i]-cx)/height,y=(positions[i+1]-bottom)/height,side=x<0?'left':'right';
   const pairs=[],add=(id,w)=>{if(w>1e-6)pairs.push([id,w]);};
   const upper=smooth(.43,.57,y),lower=1-upper;
   const foot=1-smooth(.08,.18,y),knee=(1-smooth(.25,.39,y))*(1-foot);
   add(side+'Foot',lower*foot);add(side+'LowerLeg',lower*knee);add(side+'UpperLeg',lower*(1-foot-knee));
   const head=smooth(.77,.86,y),arm=smooth(.075,.15,Math.abs(x))*(1-smooth(.77,.87,y));
   add('head',upper*head);add('torso',upper*(1-head)*(1-arm));
   const hand=1-smooth(.52,.6,y),elbow=(1-smooth(.61,.71,y))*(1-hand),armWeight=upper*(1-head)*arm;
   add(side+'Hand',armWeight*hand);add(side+'Forearm',armWeight*elbow);add(side+'UpperArm',armWeight*(1-hand-elbow));
   weights.push(normalize(pairs));
  }
  return validate({format:FORMAT,vertexCount:positions.length/3,joints,weights});
 }
 function setPivot(rig,id,pivot){
  const joint=rig.joints.find(j=>j.id===id);if(!joint)fail('unknown joint '+id);joint.pivot=vector(pivot,'pivot');return rig;
 }
 function paint(rig,{joint,center,radius,strength=.65,positions,subtract=false}={}){
  if(!rig.joints.some(j=>j.id===joint))fail('unknown joint '+joint);
  const point=vector(center,'brush center');
  if(!Number.isFinite(radius)||radius<=0||radius>20||!Number.isFinite(strength)||strength<0||strength>1)fail('invalid brush radius or strength');
  if(!positions||positions.length!==rig.vertexCount*3)fail('brush pose does not match binding');
  const parent=rig.joints.find(j=>j.id===joint).parent||rig.joints.find(j=>j.parent===null).id;let touched=0;
  for(let v=0;v<rig.vertexCount;v++){
   const i=v*3,distance=Math.hypot(positions[i]-point[0],positions[i+1]-point[1],positions[i+2]-point[2]);if(distance>=radius)continue;
   const amount=strength*(1-distance/radius)**2;if(!amount)continue;
   const old=rig.weights[v],weight=old.find(p=>p[0]===joint)?.[1]||0,target=subtract?weight*(1-amount):weight+(1-weight)*amount;
   if(Math.abs(target-weight)<1e-10)continue;
   let other=old.filter(p=>p[0]!==joint),sum=other.reduce((s,p)=>s+p[1],0);
   if(!sum&&parent===joint)continue;
   if(!sum&&target<1){other=[[parent,1]];sum=1;}
   rig.weights[v]=normalize([...other.map(([id,w])=>[id,sum?w/sum*(1-target):0]),[joint,target]]);touched++;
  }
  return touched;
 }
 return {FORMAT,LIMITS,auto,validate,compile,deform,jointPositions,setPivot,paint};
});
