/* Standalone HD morph-animation authoring. Nothing here is loaded by battles. */
(async function(){
 'use strict';
 const I18n=window.PraetoriansI18n;
 // The editor is custom UI rather than a screen shipped in the original game.
 // Native game text supplies character names; these labels provide an English
 // fallback for the extra posing tools when a native translation is absent.
 const workshopLabels={
  'Atelier d’animations · Praetorians HD':'Animation workshop · Praetorians HD',
  'Retour au menu':'Back to menu','CRÉATION DE PERSONNAGES':'CHARACTER CREATION','Atelier d’animations':'Animation workshop',
  'Bibliothèque d’animations':'Animation library','Personnage HD':'HD character','Modèle':'Model','Chargement…':'Loading…',
  'Chargement des personnages du Remaster.':'Loading Remaster characters.','Animations d’origine':'Original animations',
  'Mes créations':'My creations','Animations HD':'HD animations','Animations sauvegardées':'Saved animations',
  'Vos animations apparaîtront ici.':'Your animations will appear here.','Importer une animation':'Import an animation',
  'Aperçu et chronologie':'Preview and timeline','ANIMATION HD':'HD ANIMATION','Préparation de l’aperçu…':'Preparing preview…',
  'Recentrer la caméra':'Centre the camera','Recentrer':'Centre','Chargement du modèle HD…':'Loading HD model…',
  'Aperçu 3D du personnage. Glisser pour tourner la caméra, molette pour zoomer.':'3D character preview. Drag to rotate the camera, scroll to zoom.',
  'Glisser : tourner · Molette : zoomer':'Drag: rotate · Scroll: zoom','Grille':'Grid','Chronologie de l’animation':'Animation timeline',
  'Pause':'Pause','Lire':'Play','Revenir au début':'Return to start','Vitesse':'Speed','Vitesse de lecture':'Playback speed',
  'Position dans l’animation':'Animation position','POSES CLÉS':'KEYFRAMES','+ Ajouter à cet instant':'+ Add at this time',
  'Poses clés':'Keyframes','Créez une animation pour éditer ses poses.':'Create an animation to edit its poses.',
  'Création et réglages':'Creation and settings','Créer une animation':'Create an animation',
  'Composez une séquence avec les poses HD, puis ajustez ses mouvements et son rythme.':'Build a sequence with HD poses, then adjust its movement and timing.',
  'Nouvelle séquence':'New sequence','Copier l’animation HD':'Copy HD animation','Nom de l’animation':'Animation name',
  'Durée (s)':'Duration (s)','Boucle':'Loop','Enregistrer':'Save','Enregistré':'Saved','Exporter JSON':'Export JSON',
  'Pose sélectionnée':'Selected pose','Supprimer':'Delete','Instant (s)':'Time (s)','Pose source (s)':'Source pose (s)',
  'Animation source':'Source animation','Mouvement du personnage entier':'Whole character movement','Position (m)':'Position (m)',
  'Rotation (°)':'Rotation (°)','Échelle':'Scale','Parties du corps':'Body parts','Réinitialiser':'Reset','Articulation':'Joint',
  'Rotation de la partie (°)':'Body part rotation (°)','Rotation X de l’articulation':'Joint X rotation',
  'Rotation Y de l’articulation':'Joint Y rotation','Rotation Z de l’articulation':'Joint Z rotation',
  'Ajuster le squelette et les influences':'Adjust the skeleton and weights',
  'Le squelette initial est une approximation pour un humain. Ajustez-le pour le personnage choisi. Les pivots et influences sont communs à toutes les poses de cette création.':'The initial skeleton approximates a human. Adjust it for your character. Pivots and weights are shared by every pose in this creation.',
  'Pivot de l’articulation (m)':'Joint pivot (m)','Voir les influences de cette partie':'Show weights for this body part',
  'Peindre sur le personnage (clic gauche)':'Paint on the character (left click)','Effacer au lieu de peindre':'Erase instead of painting',
  'Rayon du pinceau (m)':'Brush radius (m)',
  'Peignez au repos pour préparer le squelette ; désactivez le pinceau pour tourner la caméra. Une rotation nulle conserve exactement le modèle HD.':'Paint at rest to prepare the skeleton; disable the brush to rotate the camera. Zero rotation preserves the HD model exactly.',
  'Supprimer cette création':'Delete this creation',
  'Créez et animez un squelette éditable sur les modèles HD : tête, torse, bras et jambes. Le squelette est ajouté par l’atelier. Les créations sont sauvegardées dans ce navigateur et exportables ; les animations de combat du jeu restent indépendantes.':'Create and animate an editable skeleton on HD models: head, torso, arms and legs. The workshop adds the skeleton. Creations are saved in this browser and can be exported; battle animations stay independent.',
  'Préparation de l’atelier…':'Preparing workshop…','Modèles et textures HD · Effets du jeu conservés':'HD models and textures · Game effects preserved',
  'Repos':'Rest','En garde':'Ready','Marche':'Walk','Course':'Run','Attaque':'Attack','Attaque II':'Attack II',
  'Attaque accroupie':'Planted attack','Recharger':'Reload','Viser':'Aim','Tirer':'Shoot','Lancer un projectile':'Throw','Construire':'Build',
  'Construire II':'Build II','Se cacher':'Hide','Caché':'Hidden','Se relever':'Stand up','Mort':'Death','Mort II':'Death II',
  'Mort III':'Death III','Brouter':'Graze','Voler':'Fly','Monter':'Ascend','Descendre':'Descend',
  'Faucon':'Hawk','Cerf':'Deer','Lapin':'Rabbit','Écureuil':'Squirrel','Forgeron':'Blacksmith',
  'Bassin':'Hips','Torse':'Torso','Tête':'Head','Bras gauche':'Left upper arm','Avant-bras gauche':'Left forearm','Main gauche':'Left hand',
  'Bras droit':'Right upper arm','Avant-bras droit':'Right forearm','Main droite':'Right hand','Cuisse gauche':'Left thigh',
  'Jambe gauche':'Left lower leg','Pied gauche':'Left foot','Cuisse droite':'Right thigh','Jambe droite':'Right lower leg','Pied droit':'Right foot',
  'CRÉATION PERSONNELLE':'CUSTOM CREATION','brouillon':'draft','sommets':'vertices','matériau':'material','matériaux':'materials',
  'Stockage indisponible ou plein. Exportez votre création en JSON.':'Storage is unavailable or full. Export your creation as JSON.',
  'La bibliothèque contient 64 créations. Exportez puis supprimez une création pour libérer une place.':'The library holds 64 creations. Export and delete a creation to free a slot.',
  'Bibliothèque pleine (64 créations). Exportez puis supprimez une ancienne création.':'Library full (64 creations). Export and delete an old creation.',
  'Vos animations de ce personnage apparaîtront ici.':'Your animations for this character will appear here.',
  'Brouillon mémorisé. Cliquez sur Enregistrer quand il vous convient.':'Draft saved. Click Save when you are happy with it.',
  'Personnage HD prêt. Choisissez une animation ou créez votre séquence.':'HD character ready. Choose an animation or create your own sequence.',
  'Impossible de charger ce modèle.':'Unable to load this model.',
  'Sélectionnez une pose pour changer son animation source, sa position ou sa rotation.':'Select a pose to change its source animation, position or rotation.',
  'Influences ajustées. Testez la rotation de cette partie.':'Weights adjusted. Test this body part’s rotation.',
  'sommets ajustés':'vertices adjusted',
  'Une pose existe déjà à cet instant. Déplacez le curseur pour en ajouter une autre.':'A pose already exists at this time. Move the playhead to add another.',
  'Animation enregistrée :':'Animation saved:','Animation importée :':'Animation imported:',
  'Animation exportée. Vous pourrez la réimporter dans l’atelier.':'Animation exported. You can import it into the workshop again.',
  'Création supprimée.':'Creation deleted.','Le fichier dépasse 1 Mo.':'The file exceeds 1 MB.',
  'Ce modèle HD n’est pas disponible :':'This HD model is unavailable:',
  'Impossible de charger le modèle de cette animation.':'Unable to load this animation’s model.',
  'Import refusé :':'Import rejected:','Fichier HD manquant :':'Missing HD file:',
  'Atelier indisponible :':'Workshop unavailable:','Ouvrez cet atelier avec start_viewer.bat.':'Open this workshop using start_viewer.bat.'
 };
 I18n?.registerLabels?.(Object.fromEntries(Object.entries(workshopLabels).map(([source,en])=>[source,{en}])));
 await I18n?.ready?.();
 I18n?.bind?.(document.documentElement);
 const tr=value=>I18n?.translateLabel(value)??value;
 const locale=()=>I18n?.language||'fr';
 const B=window.BABYLON,Models=window.PraetoriansUnitModels,Animation=window.PraetoriansUnitAnimation,Custom=window.PraetoriansCustomAnimation,Rig=window.PraetoriansCharacterRig;
 const $=id=>document.getElementById(id),storageKey='praetorians.animationWorkshop.v1';
 $('speed').querySelector('[value="1.5"]').textContent=(1.5).toLocaleString(locale())+'×';
 $('brushSize').textContent=Number($('brushRadius').value).toLocaleString(locale())+' m';
 const labels={rest:'Repos',ready:'En garde',walk:'Marche',run:'Course',attack:'Attaque',attack2:'Attaque II',attackPlanted:'Attaque accroupie',load:'Recharger',aim:'Viser',shoot:'Tirer',throw:'Lancer un projectile',build:'Construire',build2:'Construire II',lieDown:'Se cacher',lying:'Caché',getUp:'Se relever',death:'Mort',death2:'Mort II',death3:'Mort III',idle:'Repos',graze:'Brouter',fly:'Voler',ascend:'Monter',descend:'Descendre'};
 const animalNames={hawk:'Faucon',deer:'Cerf',rabbit:'Lapin',squirrel:'Écureuil',rat:'Rat',smith:'Forgeron'};
 const jointNames={hips:'Bassin',torso:'Torse',head:'Tête',leftUpperArm:'Bras gauche',leftForearm:'Avant-bras gauche',leftHand:'Main gauche',rightUpperArm:'Bras droit',rightForearm:'Avant-bras droit',rightHand:'Main droite',leftUpperLeg:'Cuisse gauche',leftLowerLeg:'Jambe gauche',leftFoot:'Pied gauche',rightUpperLeg:'Cuisse droite',rightLowerLeg:'Jambe droite',rightFoot:'Pied droit'};
 for(const table of [labels,animalNames,jointNames])for(const key of Object.keys(table))table[key]=tr(table[key]);
 const seconds=ms=>(ms/1000).toLocaleString(locale(),{minimumFractionDigits:2,maximumFractionDigits:2});
 const copy=value=>JSON.parse(JSON.stringify(value));
 const state={ready:false,model:null,kind:null,mode:'source',source:'rest',clip:null,compiled:null,still:null,selectedKey:0,time:0,playing:true,sample:null,id:null,saved:[],meshes:[]};
 let library={},names={},loadSerial=0,loadController=null,frameDirty=true,entryDirty=false,last=0,storageAvailable=true,jointId='head',paintPointer=null,paintChanged=false;
 const modelCache=new Map();
 function status(message,error=false){$('status').textContent=tr(message);$('status').dataset.error=String(error);}
 function persist(){
  try{localStorage.setItem(storageKey,JSON.stringify({clips:state.saved,active:state.mode==='custom'?state.id:null,model:state.kind}));storageAvailable=true;return true;}
  catch(_){storageAvailable=false;status('Stockage indisponible ou plein. Exportez votre création en JSON.',true);return false;}
 }
 function recordDraft(){
  if(!state.clip||!state.id)return;
  let entry=state.saved.find(item=>item.id===state.id);
  if(!entry){if(state.saved.length>=64)throw Error('La bibliothèque contient 64 créations. Exportez puis supprimez une création pour libérer une place.');entry={id:state.id,clip:null,saved:false};state.saved.push(entry);}
  entry.clip=copy(state.clip);entry.saved=!entryDirty;persist();
 }
 function restore(){
  try{
   const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');
   if(Array.isArray(saved.clips))for(const entry of saved.clips.slice(0,64)){
    try{if(typeof entry.id!=='string'||entry.id.length>100)continue;const clip=Custom.validate(entry.clip);if(!Object.hasOwn(library,clip.model))continue;if(state.saved.some(item=>item.id===entry.id))continue;state.saved.push({id:entry.id,clip,saved:!!entry.saved});}catch(_){/* One damaged entry does not hide the rest. */}
   }
   return saved;
  }catch(_){return {};}
 }
 function makeOption(value,text){const option=document.createElement('option');option.value=value;option.textContent=text;return option;}
 function clipButton(text,time,active,attribute,value,handler){
  const button=document.createElement('button');button.type='button';button.className='clip-item';button.setAttribute('aria-pressed',String(active));button.dataset[attribute]=value;
  const name=document.createElement('span');name.className='clip-label';if(attribute==='saved')name.dataset.i18nIgnore='';name.textContent=text;button.append(name);
  const length=document.createElement('small');length.textContent=seconds(time)+' s';button.append(length);button.onclick=handler;return button;
 }
 function renderLibrary(){
  $('sourceClips').replaceChildren();
  for(const [name,clip] of Object.entries(state.model.animations))$('sourceClips').append(clipButton(labels[name]||name,clip.duration,state.mode==='source'&&state.source===name,'source',name,()=>selectSource(name)));
  $('sourceCount').textContent=Object.keys(state.model.animations).length;
  const entries=state.saved.filter(entry=>entry.clip.model===state.kind);
  $('savedCount').textContent=entries.length;$('savedClips').replaceChildren();
  for(const entry of entries)$('savedClips').append(clipButton(entry.clip.name+(entry.saved?'':' · '+tr('brouillon')),entry.clip.durationMs,state.mode==='custom'&&entry.id===state.id,'saved',entry.id,()=>activateCustom(entry.clip,entry.id,!entry.saved)));
  if(!entries.length){const hint=document.createElement('p');hint.className='hint';hint.textContent='Vos animations de ce personnage apparaîtront ici.';$('savedClips').append(hint);}
 }
 function currentDuration(){return state.mode==='custom'?state.clip.durationMs:state.model?.animations[state.source]?.duration||1000;}
 function refreshHeading(){
  $('previewName').toggleAttribute('data-i18n-ignore',state.mode==='custom');
  $('previewName').textContent=state.mode==='custom'?state.clip.name:labels[state.source]||state.source;
  $('previewKind').textContent=state.mode==='custom'?'CRÉATION PERSONNELLE':'ANIMATION HD';
  $('editor').hidden=state.mode!=='custom';$('addKey').disabled=state.mode!=='custom'||state.clip.keyframes.length>=Custom.LIMITS.maxKeyframes;
  document.querySelector('.inspector').classList.toggle('editing',state.mode==='custom');
  $('scrubber').max=currentDuration();
  $('play').textContent=state.playing?'Pause':'Lire';
 }
 function syncTime(){
  $('scrubber').value=Math.min(state.time,currentDuration());
  $('clock').textContent=seconds(Math.min(state.time,currentDuration()))+' / '+seconds(currentDuration())+' s';
 }
 function renderKeys(){
  $('keyframes').replaceChildren();$('keyCount').textContent=state.mode==='custom'?state.clip.keyframes.length:'—';
  if(state.mode!=='custom'){const hint=document.createElement('p');hint.className='hint';hint.textContent='Créez une animation pour éditer ses poses.';$('keyframes').append(hint);return;}
  state.clip.keyframes.forEach((key,index)=>{
   const button=document.createElement('button');button.type='button';button.className='keyframe';button.dataset.keyIndex=index;
   button.textContent=seconds(key.timeMs)+' s';button.title=(labels[key.clip]||key.clip)+' · pose '+seconds(key.sourceTimeMs)+' s';button.setAttribute('aria-pressed',String(index===state.selectedKey));
   button.onclick=()=>{state.selectedKey=index;state.time=key.timeMs;state.playing=false;frameDirty=true;renderEditor();refreshHeading();syncTime();};$('keyframes').append(button);
  });
 }
 function renderEditor(){
  renderKeys();if(state.mode!=='custom')return;
  const clip=state.clip,key=clip.keyframes[state.selectedKey];
  $('clipName').value=clip.name;$('duration').value=+(clip.durationMs/1000).toFixed(3);$('loop').checked=clip.loop;
  $('keyTime').value=+(key.timeMs/1000).toFixed(4);$('keyTime').max=clip.durationMs/1000;
  const endpoint=state.selectedKey===0||state.selectedKey===clip.keyframes.length-1;
  $('keyTime').disabled=endpoint;$('deleteKey').disabled=endpoint;
  $('sourceClip').value=key.clip;$('sourceTime').value=+(key.sourceTimeMs/1000).toFixed(4);
  $('sourceTime').max=state.model.animations[key.clip].duration/1000;
  for(const channel of ['position','rotation','scale'])for(let i=0;i<3;i++)$(channel+'XYZ'[i]).value=+(key[channel][i]*(channel==='rotation'?180/Math.PI:1)).toFixed(4);
  renderJointEditor();
  $('deleteClip').hidden=!state.saved.some(entry=>entry.id===state.id);
  $('saveClip').textContent=entryDirty?'Enregistrer':'Enregistré';
 }
 function selectSource(name){
  stopPainting();$('paintWeights').checked=false;updatePaintingMode();
  state.source=name;state.mode='source';state.time=0;state.playing=true;state.sample=null;frameDirty=true;
  updateWeights();renderLibrary();renderEditor();refreshHeading();syncTime();persist();
 }
 function activateCustom(input,id=null,dirty=true){
  const recipe=copy(input);recipe.rig??=Rig.auto(state.model);
  const compiled=Custom.compile(recipe,state.model);
  if(!id&&state.saved.length>=64)throw Error('Bibliothèque pleine (64 créations). Exportez puis supprimez une ancienne création.');
  state.clip=compiled.clip;state.compiled=compiled;state.still={...compiled,clip:{...compiled.clip,loop:false}};state.id=id||'clip-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  state.mode='custom';state.selectedKey=0;state.time=0;state.playing=true;state.sample=null;entryDirty=dirty;frameDirty=true;
  recordDraft();renderLibrary();renderEditor();refreshHeading();syncTime();
 }
 function commit(input,keyTime){
  try{
   const compiled=Custom.compile(input,state.model);state.clip=compiled.clip;state.compiled=compiled;state.still={...compiled,clip:{...compiled.clip,loop:false}};
   if(keyTime!==undefined)state.selectedKey=state.clip.keyframes.findIndex(key=>key.timeMs===keyTime);
   state.selectedKey=Math.max(0,Math.min(state.clip.keyframes.length-1,state.selectedKey));
   entryDirty=true;frameDirty=true;state.time=Math.min(state.time,state.clip.durationMs);recordDraft();renderLibrary();renderEditor();refreshHeading();syncTime();
   if(storageAvailable)status('Brouillon mémorisé. Cliquez sur Enregistrer quand il vous convient.');
  }catch(error){status(error.message,true);renderEditor();}
 }
 function editKey(callback){if(state.mode!=='custom')return;const draft=copy(state.clip),key=draft.keyframes[state.selectedKey];callback(key,draft);commit(draft,key.timeMs);}
 const canvas=$('animationCanvas');
 let engine,scene,camera,root,grid,jointMarker,weightMaterial;
 function setupScene(){
  engine=new B.Engine(canvas,true,{preserveDrawingBuffer:false,stencil:false});engine.maxFPS=60;engine.setHardwareScalingLevel(1/Math.min(devicePixelRatio||1,1.5));
  scene=new B.Scene(engine);scene.clearColor=new B.Color4(0,0,0,0);scene.ambientColor=new B.Color3(.43,.47,.40);
  camera=new B.ArcRotateCamera('workshop camera',Math.PI*.35,Math.PI*.39,5,new B.Vector3(0,.9,0),scene);
  camera.attachControl(canvas,true);camera.lowerRadiusLimit=1;camera.upperRadiusLimit=25;camera.lowerBetaLimit=.08;camera.upperBetaLimit=Math.PI*.49;
  camera.wheelPrecision=45;camera.panningSensibility=0;camera.inertia=.7;camera.minZ=.02;
  const fill=new B.HemisphericLight('studio sky',new B.Vector3(0,1,0),scene);fill.intensity=.85;fill.groundColor=new B.Color3(.30,.33,.26);
  const key=new B.DirectionalLight('studio sun',new B.Vector3(-.5,-1,.4),scene);key.intensity=.8;
  root=new B.TransformNode('HD character',scene);
  B.Effect.ShadersStore.workshopWeightsVertexShader='precision highp float;attribute vec3 position;attribute vec4 color;uniform mat4 worldViewProjection;varying vec4 weightColor;void main(void){weightColor=color;gl_Position=worldViewProjection*vec4(position,1.0);}';
  B.Effect.ShadersStore.workshopWeightsFragmentShader='precision highp float;varying vec4 weightColor;void main(void){gl_FragColor=weightColor;}';
  weightMaterial=new B.ShaderMaterial('joint influence colors',scene,{vertex:'workshopWeights',fragment:'workshopWeights'},{attributes:['position','color'],uniforms:['worldViewProjection']});weightMaterial.backFaceCulling=false;
  jointMarker=B.MeshBuilder.CreateSphere('selected joint pivot',{diameter:.065,segments:8},scene);
  const jointMaterial=new B.StandardMaterial('joint pivot',scene);jointMaterial.disableLighting=true;jointMaterial.emissiveColor=new B.Color3(1,.72,.26);jointMaterial.disableDepthWrite=true;jointMaterial.depthFunction=B.Constants.ALWAYS;
  jointMarker.material=jointMaterial;jointMarker.parent=root;jointMarker.renderingGroupId=3;jointMarker.isPickable=false;jointMarker.setEnabled(false);
  const floor=B.MeshBuilder.CreateGround('studio floor',{width:30,height:30},scene),material=new B.StandardMaterial('studio floor',scene);
  material.diffuseColor=new B.Color3(.14,.18,.14);material.specularColor=B.Color3.Black();floor.material=material;floor.position.y=-.03;floor.isPickable=false;
  const lines=[];for(let n=-10;n<=10;n++){lines.push([new B.Vector3(n,-.018,-10),new B.Vector3(n,-.018,10)],[new B.Vector3(-10,-.018,n),new B.Vector3(10,-.018,n)]);}
  grid=B.MeshBuilder.CreateLineSystem('metre grid',{lines},scene);grid.color=new B.Color3(.26,.32,.25);grid.alpha=.4;grid.isPickable=false;
  const resize=new ResizeObserver(()=>{engine.resize();frameDirty=true;});resize.observe(canvas);
  window.addEventListener('pagehide',()=>{loadController?.abort();resize.disconnect();engine.dispose();},{once:true});
  function render(){
   const now=performance.now(),dt=Math.min(100,Math.max(0,now-last));last=now;
   if(state.ready){
    if(state.playing){
     state.time+=dt*Number($('speed').value);const duration=currentDuration(),loop=state.mode==='custom'?state.clip.loop:state.model.animations[state.source].loop!==false;
     if(state.time>=duration){if(loop)state.time%=duration;else{state.time=duration;state.playing=false;refreshHeading();}}
     frameDirty=true;
    }
    if(frameDirty){drawPose();syncTime();frameDirty=false;}
   }
   scene.render();
  }
  document.addEventListener('visibilitychange',()=>{last=performance.now();if(document.hidden)engine.stopRenderLoop();else engine.runRenderLoop(render);});
  engine.runRenderLoop(render);
 }
 function drawPose(){
  let positions;
  if(state.mode==='custom'){
   state.sample=Custom.sample(state.playing?state.compiled:state.still,state.time,state.sample);positions=state.sample.positions;
   root.position.set(...state.sample.position);root.rotation.set(...state.sample.rotation);root.scaling.set(...state.sample.scale);
  }else{
   positions=Models.sample(state.model.animations[state.source],state.time,state.sample?.positions,state.playing?undefined:{loop:false});
   state.sample={positions};root.position.setAll(0);root.rotation.setAll(0);root.scaling.setAll(1);
  }
  const normals=Animation.normalsFor(positions,state.model.normalIndices||state.model.groups[0].indices);
  for(const mesh of state.meshes){mesh.updateVerticesData(B.VertexBuffer.PositionKind,positions,true);mesh.updateVerticesData(B.VertexBuffer.NormalKind,normals);}
  if(state.mode==='custom'&&state.compiled.rig){
   const pivot=Rig.jointPositions(state.compiled.rig,state.sample.joints||{})[jointId];if(pivot)jointMarker.position.set(...pivot);
   jointMarker.setEnabled(!!pivot);
  }else jointMarker.setEnabled(false);
 }
 function resetView(){
  if(!state.model)return;const pose=(state.model.animations.rest||Object.values(state.model.animations)[0]).frames[0].positions;
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<pose.length;i++) {const axis=i%3;min[axis]=Math.min(min[axis],pose[i]);max[axis]=Math.max(max[axis],pose[i]);}
  const height=Math.max(.8,max[1]-min[1]),extent=Math.max(height,max[0]-min[0],max[2]-min[2]);
  camera.setTarget(new B.Vector3((min[0]+max[0])/2,min[1]+height*.5,(min[2]+max[2])/2));camera.radius=extent*2.5;camera.alpha=Math.PI*.35;camera.beta=Math.PI*.39;
  camera.lowerRadiusLimit=extent*.6;camera.upperRadiusLimit=extent*8;frameDirty=true;
 }
 async function fetchModel(kind,signal){
  if(modelCache.has(kind)){const model=modelCache.get(kind);modelCache.delete(kind);modelCache.set(kind,model);return model;}
  const base='assets/hd/units/combat/'+kind;
  const [meta,buffer]=await Promise.all([fetch(base+'.json',{signal}).then(response=>{if(!response.ok)throw Error('Modèle HD introuvable : '+kind);return response.json();}),fetch(base+'.bin',{signal}).then(response=>{if(!response.ok)throw Error('Animation HD introuvable : '+kind);return response.arrayBuffer();})]);
  const model=Models.decode(meta,buffer);modelCache.set(kind,model);while(modelCache.size>3)modelCache.delete(modelCache.keys().next().value);return model;
 }
 async function loadCharacter(kind,restoreId=null){
  const serial=++loadSerial;loadController?.abort();loadController=new AbortController();
  stopPainting();$('paintWeights').checked=false;updatePaintingMode();state.ready=false;state.playing=false;$('editor').inert=true;$('previewLoading').hidden=false;$('previewLoading').textContent='Chargement du modèle HD…';
  for(const id of ['newClip','copyClip','play','restart','scrubber','addKey','saveClip','exportClip','deleteClip','deleteKey'])$(id).disabled=true;
  try{
   const model=await fetchModel(kind,loadController.signal);if(serial!==loadSerial)return;
   // Keep the existing character until its replacement has loaded successfully.
   for(const mesh of state.meshes){mesh.material=mesh.metadata.hdMaterial;mesh.dispose(false,true);}state.meshes=[];
   for(const [index,group] of model.groups.entries()){
    const mesh=new B.Mesh('HD '+kind+' section '+index,scene),data=new B.VertexData();
    data.positions=group.positions;data.normals=Animation.normalsFor(group.positions,model.normalIndices||group.indices);data.uvs=group.uvs;data.indices=group.indices;data.applyToMesh(mesh,true);
    const material=new B.StandardMaterial('HD '+group.texture,scene);material.diffuseTexture=new B.Texture('assets/hd/units/textures/'+encodeURIComponent(group.texture)+'.png',scene,false,false);
    material.diffuseColor=B.Color3.White();material.specularColor=B.Color3.Black();material.ambientColor=B.Color3.White();material.backFaceCulling=false;material.twoSidedLighting=true;
    mesh.material=material;mesh.metadata={hdMaterial:material};mesh.parent=root;mesh.isPickable=true;state.meshes.push(mesh);
   }
   state.model=model;state.kind=kind;state.compiled=null;state.clip=null;state.id=null;state.sample=null;state.selectedKey=0;
   state.source=model.animations.rest?'rest':Object.keys(model.animations)[0];state.mode='source';state.time=0;state.ready=true;state.playing=true;
   $('character').value=kind;$('modelInfo').textContent=names[kind]+' · '+(model.groups[0].positions.length/3).toLocaleString(locale())+' '+tr('sommets')+' · '+model.groups.length+' '+tr(model.groups.length>1?'matériaux':'matériau');
   $('sourceClip').replaceChildren(...Object.keys(model.animations).map(name=>makeOption(name,labels[name]||name)));
   for(const id of ['newClip','copyClip','play','restart','scrubber','saveClip','exportClip','deleteClip'])$(id).disabled=false;
   $('editor').inert=false;$('showWeights').checked=false;
   const restored=state.saved.find(entry=>entry.id===restoreId&&entry.clip.model===kind);
   if(restored)activateCustom(restored.clip,restored.id,!restored.saved);else{renderLibrary();renderEditor();refreshHeading();}
   resetView();drawPose();syncTime();frameDirty=true;
   await scene.whenReadyAsync();if(serial!==loadSerial)return;$('previewLoading').hidden=true;
   status('Personnage HD prêt. Choisissez une animation ou créez votre séquence.');
  }catch(error){
   if(serial!==loadSerial||error.name==='AbortError')return;
   state.ready=!!state.model;state.playing=false;$('editor').inert=false;$('previewLoading').hidden=state.ready;$('previewLoading').textContent='Impossible de charger ce modèle.';status(error.message,true);
   if(state.ready){$('character').value=state.kind;for(const id of ['newClip','copyClip','play','restart','scrubber','saveClip','exportClip','deleteClip'])$(id).disabled=false;renderEditor();refreshHeading();}
  }
 }
 function createClip(fromSource){
  try{
   const source=state.source,model=state.model;
   if(fromSource)activateCustom(Custom.create(model,source,{name:'Copie · '+(labels[source]||source)}));
   else{
    const rest=model.animations.rest?'rest':source;
    const sourceTime=Math.min(model.animations[source].duration/2,model.animations[source].frames.at(-1).time);
    const key=(timeMs,clip,sourceTimeMs)=>({timeMs,clip,sourceTimeMs,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
    activateCustom({format:Custom.FORMAT,model:state.kind,name:'Nouvelle séquence',durationMs:2000,loop:true,keyframes:[key(0,rest,0),key(1000,source,sourceTime),key(2000,rest,0)]});
   }
   status('Sélectionnez une pose pour changer son animation source, sa position ou sa rotation.');
  }catch(error){status(error.message,true);}
 }
 $('newClip').onclick=()=>createClip(false);$('copyClip').onclick=()=>createClip(true);
 $('character').onchange=()=>loadCharacter($('character').value);
 $('play').onclick=()=>{if(!state.playing&&state.time>=currentDuration())state.time=0;state.playing=!state.playing;frameDirty=true;refreshHeading();};
 $('restart').onclick=()=>{state.time=0;frameDirty=true;syncTime();};
 $('scrubber').oninput=()=>{state.time=Number($('scrubber').value);state.playing=false;frameDirty=true;refreshHeading();syncTime();};
 $('resetView').onclick=resetView;$('showGrid').onchange=()=>grid.setEnabled($('showGrid').checked);
 $('clipName').onchange=()=>{const draft=copy(state.clip);draft.name=$('clipName').value;commit(draft);};
 $('duration').onchange=()=>{const draft=copy(state.clip),duration=Number($('duration').value)*1000;for(const key of draft.keyframes)key.timeMs=key.timeMs/draft.durationMs*duration;draft.durationMs=duration;commit(draft);};
 $('loop').onchange=()=>{const draft=copy(state.clip);draft.loop=$('loop').checked;commit(draft);};
 $('keyTime').onchange=()=>editKey(key=>{key.timeMs=Number($('keyTime').value)*1000;state.time=key.timeMs;});
 $('sourceTime').onchange=()=>editKey(key=>{key.sourceTimeMs=Number($('sourceTime').value)*1000;});
 $('sourceClip').onchange=()=>editKey(key=>{key.clip=$('sourceClip').value;key.sourceTimeMs=Math.min(key.sourceTimeMs,state.model.animations[key.clip].duration);});
 for(const channel of ['position','rotation','scale'])for(let axis=0;axis<3;axis++)$(channel+'XYZ'[axis]).onchange=()=>editKey(key=>{key[channel][axis]=Number($(channel+'XYZ'[axis]).value)*(channel==='rotation'?Math.PI/180:1);});
 function renderJointEditor(){
  const rig=state.clip?.rig;if(!rig)return;
  if(!rig.joints.some(joint=>joint.id===jointId))jointId=rig.joints[0].id;
  $('joint').replaceChildren(...rig.joints.map(joint=>makeOption(joint.id,jointNames[joint.id]||joint.id)));$('joint').value=jointId;
  const key=state.clip.keyframes[state.selectedKey],angles=key.joints?.[jointId]||[0,0,0],joint=rig.joints.find(joint=>joint.id===jointId);
  for(let axis=0;axis<3;axis++){
   const degrees=+(angles[axis]*180/Math.PI).toFixed(3);$('joint'+'XYZ'[axis]).value=degrees;$('jointSlider'+'XYZ'[axis]).value=degrees;$('pivot'+'XYZ'[axis]).value=+joint.pivot[axis].toFixed(4);
  }
  updateWeights();
 }
 function updateWeights(){
  const show=$('showWeights').checked&&state.mode==='custom',rig=state.clip?.rig;
  let colors;
  if(show&&rig){
   colors=new Float32Array(rig.vertexCount*4);
   for(let i=0;i<rig.vertexCount;i++){
    const weight=rig.weights[i].find(([id])=>id===jointId)?.[1]||0;
    colors.set([.13+weight*.85,.2+weight*.52,.18+weight*.13,1],i*4);
   }
  }
  for(const mesh of state.meshes){
   mesh.useVertexColors=show;mesh.material=show?weightMaterial:mesh.metadata.hdMaterial;
   if(colors)mesh.setVerticesData(B.VertexBuffer.ColorKind,colors,true);
  }
 }
 function updatePaintingMode(){
  const painting=$('paintWeights').checked&&state.mode==='custom';canvas.classList.toggle('painting',painting);
  if(camera?.inputs.attached.pointers)camera.inputs.attached.pointers.buttons=painting?[1,2]:[0,1,2];
  if(painting){state.playing=false;$('showWeights').checked=true;updateWeights();refreshHeading();frameDirty=true;}
 }
 function stopPainting(){
  if(paintPointer===null)return;paintPointer=null;
  if(paintChanged){paintChanged=false;commit(state.clip);if(storageAvailable)status('Influences ajustées. Testez la rotation de cette partie.');}
 }
 function paintAt(event){
  if(!state.ready||state.mode!=='custom'||!state.sample)return;
  const rect=canvas.getBoundingClientRect(),pick=scene.pick(event.clientX-rect.left,event.clientY-rect.top,mesh=>state.meshes.includes(mesh));
  if(!pick?.hit)return;
  const point=B.Vector3.TransformCoordinates(pick.pickedPoint,B.Matrix.Invert(root.getWorldMatrix()));
  const touched=Rig.paint(state.clip.rig,{joint:jointId,center:[point.x,point.y,point.z],radius:Number($('brushRadius').value),strength:.65,positions:state.sample.positions,subtract:$('eraseWeights').checked});
  if(touched){paintChanged=true;entryDirty=true;updateWeights();status(touched+' '+tr('sommets ajustés')+' · '+(jointNames[jointId]||jointId));}
 }
 canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0||!$('paintWeights').checked||state.mode!=='custom')return;
  event.preventDefault();event.stopImmediatePropagation();paintPointer=event.pointerId;paintChanged=false;canvas.setPointerCapture(event.pointerId);paintAt(event);
 },true);
 canvas.addEventListener('pointermove',event=>{if(paintPointer!==event.pointerId)return;event.preventDefault();event.stopImmediatePropagation();paintAt(event);},true);
 for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>{if(paintPointer!==event.pointerId)return;event.stopImmediatePropagation();stopPainting();},true);
 $('joint').onchange=()=>{jointId=$('joint').value;state.playing=false;frameDirty=true;renderJointEditor();refreshHeading();};
 for(let axis=0;axis<3;axis++){
  const setJoint=value=>{state.playing=false;state.time=state.clip.keyframes[state.selectedKey].timeMs;editKey(key=>{key.joints??={};key.joints[jointId]??=[0,0,0];key.joints[jointId][axis]=Number(value)*Math.PI/180;});};
  $('joint'+'XYZ'[axis]).onchange=()=>setJoint($('joint'+'XYZ'[axis]).value);
  $('jointSlider'+'XYZ'[axis]).oninput=()=>setJoint($('jointSlider'+'XYZ'[axis]).value);
  $('pivot'+'XYZ'[axis]).onchange=()=>{const draft=copy(state.clip),joint=draft.rig.joints.find(joint=>joint.id===jointId),pivot=joint.pivot.slice();pivot[axis]=Number($('pivot'+'XYZ'[axis]).value);try{Rig.setPivot(draft.rig,jointId,pivot);commit(draft);}catch(error){status(error.message,true);renderJointEditor();}};
 }
 $('resetJoint').onclick=()=>{state.playing=false;state.time=state.clip.keyframes[state.selectedKey].timeMs;editKey(key=>{if(key.joints)delete key.joints[jointId];});};
 $('showWeights').onchange=()=>{updateWeights();frameDirty=true;};$('paintWeights').onchange=()=>{stopPainting();updatePaintingMode();};
 $('brushRadius').oninput=()=>{$('brushSize').textContent=Number($('brushRadius').value).toLocaleString(locale())+' m';};
 $('addKey').onclick=()=>{
  if(state.mode!=='custom')return;const draft=copy(state.clip),time=Math.round(state.time);
  const existing=draft.keyframes.findIndex(key=>Math.abs(key.timeMs-time)<1);
  if(existing>=0){state.selectedKey=existing;renderEditor();status('Une pose existe déjà à cet instant. Déplacez le curseur pour en ajouter une autre.');return;}
  const sample=Custom.sample(state.compiled,time),before=draft.keyframes.findLast(key=>key.timeMs<time)||draft.keyframes[0],after=draft.keyframes.find(key=>key.timeMs>time)||draft.keyframes.at(-1);
  const mix=(time-before.timeMs)/(after.timeMs-before.timeMs);
  const key={timeMs:time,clip:before.clip,sourceTimeMs:before.clip===after.clip?before.sourceTimeMs+(after.sourceTimeMs-before.sourceTimeMs)*mix:before.sourceTimeMs,position:sample.position,rotation:sample.rotation,scale:sample.scale,joints:sample.joints};
  draft.keyframes.push(key);state.playing=false;commit(draft,time);
 };
 $('deleteKey').onclick=()=>{const draft=copy(state.clip);if(!state.selectedKey||state.selectedKey===draft.keyframes.length-1)return;draft.keyframes.splice(state.selectedKey,1);commit(draft);};
 $('saveClip').onclick=()=>{try{entryDirty=false;recordDraft();renderLibrary();renderEditor();if(storageAvailable)status(tr('Animation enregistrée :')+' '+state.clip.name);}catch(error){status(error.message,true);}};
 $('exportClip').onclick=()=>{
  try{const blob=new Blob([Custom.stringify(state.clip)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=state.kind+'-'+state.clip.name.replace(/[^a-z0-9_-]/gi,'_')+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Animation exportée. Vous pourrez la réimporter dans l’atelier.');}catch(error){status(error.message,true);}
 };
 $('deleteClip').onclick=()=>{const entry=state.saved.find(item=>item.id===state.id);if(!entry)return;state.saved=state.saved.filter(item=>item!==entry);selectSource(state.source);persist();status('Création supprimée.');};
 $('importClip').onclick=()=>$('importFile').click();
 $('importFile').onchange=async()=>{
  const file=$('importFile').files[0];$('importFile').value='';if(!file)return;
  try{
   if(file.size>Custom.LIMITS.maxJsonBytes)throw Error('Le fichier dépasse 1 Mo.');
   const clip=Custom.parse(await file.text());if(!Object.hasOwn(library,clip.model))throw Error(tr('Ce modèle HD n’est pas disponible :')+' '+clip.model);
   const model=await fetchModel(clip.model);Custom.compile(clip,model);
   if(clip.model!==state.kind)await loadCharacter(clip.model);
   if(state.kind!==clip.model||!state.ready)throw Error('Impossible de charger le modèle de cette animation.');
   activateCustom(clip);status(tr('Animation importée :')+' '+clip.name);
  }catch(error){status(tr('Import refusé :')+' '+error.message,true);}
 };
 canvas.addEventListener('keydown',event=>{if(event.code==='Space'&&state.ready){event.preventDefault();$('play').click();}});
 Object.defineProperty(window,'animationWorkshop',{value:Object.freeze({
  get ready(){return state.ready;},get model(){return state.model;},get scene(){return scene;},get engine(){return engine;},get meshes(){return state.meshes;},get mode(){return state.mode;},get clip(){return state.clip?copy(state.clip):null;},get currentTime(){return state.time;},get selectedKey(){return state.selectedKey;},get savedCount(){return state.saved.length;},get playing(){return state.playing;},get sample(){return state.sample;}
 })});
 try{
  const get=async path=>{const response=await fetch(path);if(!response.ok)throw Error(tr('Fichier HD manquant :')+' '+path);return response.json();};
  const [index,types,definitions,texts]=await Promise.all([get('assets/hd/units/combat/index.json'),get('assets/hd/units/combat/types.json'),get('data/game/units.json'),I18n?Promise.resolve(null):get('data/localization/fr-game.json')]);
  library=index;
  for(const [type,kind] of Object.entries(types.types))if(!names[kind]){const unit=definitions[type],key=unit?.name;const localized=key?I18n?.text(key):null;names[kind]=(localized&&localized!==key?localized:null)||texts?.texts?.[key]||type.replaceAll('_',' ').toLocaleLowerCase(locale());}
  for(const kind of Object.keys(library))names[kind]||=animalNames[kind]||kind.replaceAll('_',' ');
  $('character').replaceChildren(...Object.keys(library).sort((a,b)=>names[a].localeCompare(names[b],locale())).map(kind=>makeOption(kind,names[kind]+' · '+kind)));
  const saved=restore();setupScene();$('character').disabled=false;
  const active=state.saved.find(entry=>entry.id===saved.active);
  await loadCharacter(active?.clip.model||(Object.hasOwn(library,saved.model)?saved.model:'infantry'),active?.id);
 }catch(error){status(tr('Atelier indisponible :')+' '+error.message,true);$('previewLoading').textContent=tr('Ouvrez cet atelier avec start_viewer.bat.');}
})();
