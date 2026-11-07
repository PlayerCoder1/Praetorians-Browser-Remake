/* Tall grass and wheat (PRADERA): the HD Remaster covers every cell of the
   logical map's PRADERA type (MLG terrain type 4, which also carries the
   forest bit that hides troops) with one of its climate's three tufts
   (tools/export_hd_meadows.py), alpha-masked like the game's
   BaseMasked_Simple material. Tufts stand on their cell's corner as authored,
   take the scene's light and shadows, and sway in the wind: a material plugin
   bends each vertex by its height above the ground, in waves that cross the
   field. Spatial chunks have independent instance bindings, so offscreen
   fields are culled without submitting their instances to the GPU.

   Fire (DefPraderas: PRADERA takes INCENDIO damage only): fire arrows heat a
   cell until it catches; a fixed patch around the impact burns together
   without spreading, and leaves charred stubble that hides
   nobody. Troops caught in it burn. The fire state is pure (fireField) so
   tests/meadows.test.js runs it under Node. */
(function(root,factory){
 const api=factory(typeof module==='object'&&module.exports?require('../render/ground-scorch.js'):root.PraetoriansGroundScorch);if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansMeadows=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(Scorch){
 'use strict';
 const PRADERA=4,CHUNK_SIZE=16;
 // Fire points (INCENDIO) a cell takes before it catches: six fire arrows
 // (FLECHA_FUEGO, 40 each) on the same cell. A cell burns up over
 // BURN seconds. Only grass in a small 2 x 2 m square at that impact ignites;
 // burning cells never light their neighbours or restart an existing fire.
 const IGNITE=240,BURN=7,FLARE=1.5,PATCH_SIZE=2;
 // The cells to cover: PRADERA type (top five bits of the MLG value).
 function cells(logical,width,depth){
  const list=[];if(!logical)return list;
  for(let z=0;z<depth;z++)for(let x=0;x<width;x++)if((logical[z*width+x]>>>27)===PRADERA)list.push({x,z});
  return list;
 }
 // A stable variant and size per cell (the same field every visit).
 function hash(x,z){let h=(Math.imul(x,374761393)+Math.imul(z,668265263))|0;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;}
 function placements(list,groundY){
  return list.map(({x,z})=>{
   const a=hash(x,z),b=hash(z+71,x+13);
   return {cx:x,cz:z,x:x+(b-.5)*.18,z:z+(a-.5)*.18,y:groundY(x+.5,z+.5)-.03,variant:Math.floor(a*3)%3,scale:.92+b*.2};
  });
 }
 // Keep the authored placements, grouping only their draw calls. Cells at
 // chunk edges stay with their logical cell despite their small visual jitter.
 function chunks(list,size=CHUNK_SIZE){
  const groups=new Map();
  for(const p of list){
   const x=Math.floor(p.cx/size),z=Math.floor(p.cz/size),key=`${p.variant}:${x}:${z}`;
   if(!groups.has(key))groups.set(key,{variant:p.variant,x,z,records:[]});
   groups.get(key).records.push(p);
  }
  return [...groups.values()];
 }
 // ---- Fixed patches of burning grass (pure) ------------------------------------
 function fireField({list,width,depth}){
  const grass=new Uint8Array(width*depth),heat=new Float32Array(width*depth),age=new Float32Array(width*depth);
  const state=new Uint8Array(width*depth);// 0 grass, 1 burning, 2 burnt
  const burning=new Set(),patches=new Map();let pendingCaught=[],nextPatch=0;
  for(const {x,z} of list)grass[z*width+x]=1;
  const at=(x,z)=>{const cx=Math.floor(x),cz=Math.floor(z);return cx<0||cz<0||cx>=width||cz>=depth?-1:cz*width+cx;};
  function ignite(i){
   if(i<0||!grass[i]||state[i])return false;
   state[i]=1;age[i]=0;burning.add(i);pendingCaught.push(i);return true;
  }
  // amount: fire points (a fire arrow's INCENDIO). True when it caught.
  function heatAt(x,z,amount){
   const i=at(x,z);if(i<0||!grass[i]||state[i])return false;
   heat[i]+=amount;
   if(heat[i]<IGNITE)return false;
   const cx=Math.floor(x),cz=Math.floor(z);
   const patch={id:nextPatch++,x0:cx,z0:cz,x1:Math.min(width,cx+PATCH_SIZE),z1:Math.min(depth,cz+PATCH_SIZE),cells:[]};
   for(let nz=patch.z0;nz<patch.z1;nz++)for(let nx=patch.x0;nx<patch.x1;nx++)if(ignite(nz*width+nx))patch.cells.push(nz*width+nx);
   patches.set(patch.id,patch);
   return true;
  }
  // Advances the fires; returns the cells that caught and burnt out.
  function update(dt){
   const caught=pendingCaught,burnt=[],finishedPatches=[];pendingCaught=[];
   for(const i of burning){
    age[i]+=dt;
    if(age[i]>=BURN){state[i]=2;burning.delete(i);burnt.push(i);}
   }
   for(const [id,patch] of patches)if(!patch.cells.some(i=>state[i]===1)){patches.delete(id);finishedPatches.push(patch);}
   return {caught,burnt,finishedPatches};
  }
  // 0..1: how fiercely the cell burns now (up in FLARE s, down at the end).
  function level(i){if(state[i]!==1)return 0;const a=age[i];return Math.max(0,Math.min(1,a/FLARE,(BURN-a)/FLARE));}
  return {heat:heatAt,update,level,burning,patches,progress:i=>Math.min(1,age[i]/BURN),
   isGrass:(x,z)=>{const i=at(x,z);return i>=0&&grass[i]===1&&state[i]!==2;},
   isBurnt:(x,z)=>{const i=at(x,z);return i>=0&&state[i]===2;},
   burningAt:(x,z)=>{const i=at(x,z);return i>=0&&state[i]===1;},
   index:at,state,width,depth};
 }
 function windPlugin(B){
  return class extends B.MaterialPluginBase{
   constructor(material){super(material,'PraetoriansWind',200,{PRAETORIANS_WIND:false});this.time=0;this.strength=1;this._enable(true);}
   prepareDefines(defines){defines.PRAETORIANS_WIND=true;}
   getClassName(){return 'PraetoriansWindPlugin';}
   getUniforms(){return {ubo:[{name:'windTime',size:1,type:'float'},{name:'windStrength',size:1,type:'float'}],
    vertex:'#ifdef PRAETORIANS_WIND\nuniform float windTime;\nuniform float windStrength;\n#endif\n'};}
   bindForSubMesh(ubo){ubo.updateFloat('windTime',this.time);ubo.updateFloat('windStrength',this.strength);}
   getCustomCode(type){
    if(type!=='vertex')return null;
    // Gusts roll across the field; the tips bend most, the roots not at all.
    return {CUSTOM_VERTEX_UPDATE_WORLDPOS:`
     #ifdef PRAETORIANS_WIND
      float bend=clamp(worldPos.y-finalWorld[3].y,0.0,1.2);bend*=bend;
      float wave=sin(windTime*1.7+worldPos.x*.55+worldPos.z*.35)*.6+sin(windTime*3.1+worldPos.x*1.3-worldPos.z*.9)*.25;
      float gust=.55+.45*sin(windTime*.45+worldPos.x*.08+worldPos.z*.05);
      worldPos.x+=bend*windStrength*(.09*wave*gust+.03);
      worldPos.z+=bend*windStrength*(.05*wave*gust);
      worldPos.y-=bend*windStrength*.015*abs(wave);
     #endif`};
   }
  };
 }
 const NONE={meshes:[],count:0,update(){},setEnabled(){},dispose(){},isGrass:()=>false,isBurnt:()=>false,burningAt:()=>false,heat:()=>false,step:()=>({caught:[],burnt:[]}),burning:new Set()};
 // fire: the burning-buildings renderer (src/render/fire.js), for the flames.
 function create({B,scene,data,climate,logical,width,depth,groundY,fire=null}){
  const family=data?.climates?.[climate]||data?.climates?.EUROPA;
  const list=placements(cells(logical,width,depth),groundY);
  const meshes=[],materials=[];
  if(!family||!list.length)return {...NONE};
  // The fire works on whole cells, not on the tufts' jittered positions.
  const field=fireField({list:list.map(p=>({x:p.cx,z:p.cz})),width,depth});
  const scorch=Scorch.create({B,scene,groundY,width,chunkSize:CHUNK_SIZE});
  const Wind=windPlugin(B);
  const texture=new B.Texture(family.texture,scene,false,false,B.Texture.TRILINEAR_SAMPLINGMODE);
  texture.hasAlpha=true;texture.wrapU=texture.wrapV=B.Texture.CLAMP_ADDRESSMODE;texture.anisotropicFilteringLevel=8;
  const material=new B.StandardMaterial('HD meadow tufts',scene);
  material.diffuseTexture=texture;material.useAlphaFromDiffuseTexture=true;
  material.transparencyMode=B.Material.MATERIAL_ALPHATEST;material.alphaCutOff=data.alphaCutoff??.3333;
  material.backFaceCulling=false;material.twoSidedLighting=true;
  // Dry stalks catch the light: a little brighter than the scene's soldiers.
  material.diffuseColor=new B.Color3(1.2,1.15,1.06);
  material.specularColor=new B.Color3(.02,.02,.015);material.emissiveColor=new B.Color3(.1,.09,.07);
  material.ambientColor=B.Color3.White();
  const wind=new Wind(material);materials.push(material);
  const m=B.Matrix.Identity(),q=B.Quaternion.Identity(),scale=new B.Vector3(),at=new B.Vector3();
  // Each cell's tuft: its batch and instance, to char it when it burns.
  const tuft=new Map(),batches=[];
  for(const chunk of chunks(list)){
   const {variant:index,x,z,records}=chunk,variant=family.variants[index];
   const mesh=new B.Mesh(`HD meadow tuft ${index} chunk ${x},${z}`,scene);
   // Babylon stores thin-instance vertex bindings on Geometry. Sharing it
   // would replace every earlier chunk's matrices/colors with the last one's.
   // Each tuft has only 36 vertices; keep its geometry local to the chunk.
   const vd=new B.VertexData();
   vd.positions=variant.positions;vd.indices=variant.indices;vd.uvs=variant.uvs;vd.normals=variant.normals;vd.applyToMesh(mesh,false);
   mesh.material=material;mesh.isPickable=false;mesh.receiveShadows=true;mesh.alwaysSelectAsActiveMesh=false;
   mesh.cullingStrategy=B.AbstractMesh.CULLINGSTRATEGY_STANDARD;
   mesh.metadata={meadow:{variant:index,chunkX:x,chunkZ:z,chunkSize:CHUNK_SIZE,count:records.length}};
   const matrices=new Float32Array(records.length*16),colors=new Float32Array(records.length*4),batch={mesh,matrices,colors,dirty:false};
   records.forEach((p,i)=>{
    p.height=p.scale*(.9+hash(p.z|0,p.x|0)*.25);
    scale.set(p.scale,p.height,p.scale);at.set(p.x,p.y,p.z);B.Matrix.ComposeToRef(scale,q,at,m);matrices.set(m.m,i*16);
    // Each tuft a shade riper or greener than its neighbours.
    const v=hash((p.x*7)|0,(p.z*5)|0),w=.9+v*.2;p.colour=[w*(1.02+(v-.5)*.08),w,w*(.97-(v-.5)*.1)];colors.set([...p.colour,1],i*4);
    tuft.set(p.cz*width+p.cx,{batch,i,p});
   });
   mesh.thinInstanceSetBuffer('matrix',matrices,16,false);mesh.thinInstanceSetBuffer('color',colors,4,false);mesh.thinInstanceRefreshBoundingInfo(false);
   // The vertex shader bends the tips beyond their static positions. Leave
   // conservative room at frustum edges; burning only shrinks the geometry.
   const bounds=mesh.getBoundingInfo(),padding=new B.Vector3(.3,.05,.2);
   mesh.setBoundingInfo(new B.BoundingInfo(bounds.minimum.subtract(padding),bounds.maximum.add(padding)));
   meshes.push(mesh);batches.push(batch);
  }
  // Natural soot and collapse, without a coloured burning-state marker.
  function paint(cell,burnt){
   const t=tuft.get(cell);if(!t)return;
   const {batch,i,p}=t,k=burnt?1:Math.max(0,(field.progress(cell)-.07)/.93),v=hash(p.cx+29,p.cz+83);
   const char=[.21+v*.05,.20+v*.045,.18+v*.04];
   const c=p.colour.map((value,j)=>value+(char[j]-value)*k);
   batch.colors.set([...c,1],i*4);
   scale.set(p.scale*(1-k*(.74+v*.08)),p.height*(1-k)+(.045+v*.04)*k,p.scale*(1-k*(.74+v*.08)));
   q.copyFrom(B.Quaternion.FromEulerAngles(0,(v-.5)*k,0));at.set(p.x,p.y,p.z);B.Matrix.ComposeToRef(scale,q,at,m);batch.matrices.set(m.m,i*16);
   batch.dirty=true;
  }
  // One garrison-style effect per small square; smoke can linger after it
  // stops being lethal. Separate impacts retain their own burn lifetimes.
  const flamesShown=new Set();
  function flames(){
   if(!fire)return;
   const now=new Set();
   for(const patch of field.patches.values()){
    const {x0,z0,x1,z1}=patch,key=`meadow patch ${patch.id}`;now.add(key);
    const level=Math.max(...patch.cells.map(cell=>field.level(cell)));
    const cells=patch.cells.filter(cell=>field.state[cell]===1).map(cell=>({x:cell%width,z:Math.floor(cell/width)}));
    fire.set(key,level,[{x:x0,z:z0},{x:x1,z:z0},{x:x1,z:z1},{x:x0,z:z1}],2.2,{groundPatch:true,cells});
    flamesShown.add(key);
   }
   for(const key of flamesShown)if(!now.has(key)){fire.set(key,0);flamesShown.delete(key);}
  }
  let paintTimer=0;
  return {meshes,scorches:scorch.meshes,count:list.length,materials,field,
   isGrass:field.isGrass,isBurnt:field.isBurnt,burningAt:field.burningAt,heat:field.heat,get burning(){return field.burning;},
   // The fire's own clock (the simulation's fixed step).
   step(dt){
    const changes=field.update(dt);
    for(const cell of changes.burnt)paint(cell,true);
    for(const patch of changes.finishedPatches){scorch.add(patch);scorch.paint(patch.id,1);}
    if((paintTimer-=dt)<=0){
     paintTimer=.2;for(const cell of field.burning)paint(cell,false);
     for(const patch of field.patches.values()){scorch.add(patch);scorch.paint(patch.id,Math.max(...patch.cells.map(cell=>field.progress(cell))));}
     flames();
    }
    else if(changes.burnt.length)flames();
    return changes;
   },
   // seconds: animation clock; strength: 0 calm .. 1.5 gale; light:
   // optional emissive multiplier. The battlefield uses fixed daylight.
   update(seconds,strength=1,light=1){
    wind.time=seconds;wind.strength=strength;material.emissiveColor.set(.1*light,.09*light,.07*light);
    for(const b of batches)if(b.dirty){b.dirty=false;b.mesh.thinInstanceBufferUpdated('matrix');b.mesh.thinInstanceBufferUpdated('color');}
    scorch.flush();
   },
   setEnabled(on){for(const mesh of meshes)mesh.setEnabled(on);scorch.setEnabled(on);},
   dispose(){for(const mesh of meshes)mesh.dispose();scorch.dispose();material.dispose();texture.dispose();}};
 }
 return {create,cells,placements,chunks,hash,fireField,PRADERA,IGNITE,BURN,PATCH_SIZE,CHUNK_SIZE};
});
