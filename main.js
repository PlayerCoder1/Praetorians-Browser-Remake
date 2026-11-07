/* Praetorians HD Remaster: cooked Unreal assets from Content/Paks. */
(async () => {
 'use strict';
 const $ = id => document.getElementById(id);
 // A busy local server can drop a connection while a mission fetches its
 // hundreds of files at once: such network failures are retried.
 const loadJSON = async (path, tries = 3) => {
  let response;
  // Revalidated: rebuilt data (tools/*) must not be read from a stale cache.
  try { response = await fetch(path, {cache: 'no-cache'}); }
  catch (error) {
   if (tries <= 1) throw error;
   await new Promise(done => setTimeout(done, 400));
   return loadJSON(path, tries - 1);
  }
  if (!response.ok) throw new Error(`Missing ${path}. Run start_viewer.bat to prepare the assets.`);
  return response.json();
 };
 // The roster is validated by the same shared rules used in the menu.
 function setupSkirmish(mission,races,launch){
  const scenario=window.PraetoriansSkirmishSetup.buildScenario(mission,races,launch);
  mission.civilizations.push(...scenario.civilizations);
  mission.troops.push(...scenario.troops);
  launch.players=scenario.players;
 }
 try {
  const I18n=window.PraetoriansI18n;await I18n.ready();
  if (!window.BABYLON) throw new Error('The local Babylon.js engine is missing.');
  // Which mission or skirmish map: the menu sets window.PraetoriansLaunch, or
  // ?mission=<ID> (assets/missions/<ID>.json, built by tools/build_maps.py).
  const params=new URLSearchParams(location.search);
  const listParam=name=>{try{const value=JSON.parse(params.get(name)||'null');return Array.isArray(value)?value:null;}catch{return null;}};
  const menuOptions=()=>{try{return JSON.parse(localStorage.getItem('praetorians.menu.options')||'{}');}catch{return {};}};
  const launch=Object.assign({mission:params.get('mission')||'SP_TUTORIAL_1',difficulty:Number(params.get('difficulty'))||0,
   race:params.get('race')||null,opponents:Number(params.get('opponents'))||0,
   players:listParam('players'),opponentRaces:listParam('opponentRaces')},window.PraetoriansLaunch||{});
  const missionData=await loadJSON(`assets/missions/${encodeURIComponent(launch.mission)}.json`);
  let scriptSource=null;
  const mapBase=`assets/maps/${missionData.map}/`;
  const [map, hdTerrain, hdWater, unitAssets, hdInterface, buildingData, objectIndex, gameTexts, races] = await Promise.all([
   loadJSON(mapBase+'map.json'),loadJSON(mapBase+'terrain.json'),
   loadJSON(mapBase+'water.json').catch(()=>({groups:[]})),loadJSON('assets/hd/units/units.json'),
   loadJSON('assets/hd/interface/manifest.json'),loadJSON('assets/hd/structures.json'),loadJSON('assets/hd/objects/index.json'),
   // The HD Remaster's French game texts (tools/export_hd_texts.py).
   loadJSON('data/localization/fr-game.json').catch(()=>({texts:{}})),
   loadJSON('data/game/races.json').catch(()=>({})),
   // The mission script (Varios/Scripts), run by src/mission/script-engine.js.
   missionData.scriptFile&&launch.mission!=='SP_TUTORIAL_1'?fetch(missionData.scriptFile).then(r=>r.ok?r.text():null).catch(()=>null):null
  ]).then(results=>{scriptSource=results.pop();return results;});
  // Skirmish maps (.MSS) hold only start positions (POS_INICIAL): every
  // player starts there with their race's pack (DefRazas PACK).
  if(missionData.kind==='skirmish')setupSkirmish(missionData,races,launch);
  // Mission files spell text keys in any case (LTEXT_MISION_DIS_Ayudar_Aliados).
  const textIndex=new Map(Object.entries(gameTexts.texts).map(([k,v])=>[k.toLowerCase(),v]));
  const text=key=>I18n.text(key,gameTexts.texts[key]??textIndex.get(String(key).toLowerCase())??key);
  const isTutorial1=launch.mission==='SP_TUTORIAL_1';
  // Master is a fourth planner tier; campaign data only has variants 1–3.
  const requestedDifficulty=Number(launch.difficulty||({facile:1,normal:2,difficile:3,master:4})[menuOptions().difficulty]||2);
  const aiDifficulty=Number.isInteger(requestedDifficulty)&&requestedDifficulty>=1&&requestedDifficulty<=4?requestedDifficulty:2;
  const difficulty=Math.min(3,aiDifficulty),aiProfile=window.PraetoriansCpu.profile?.(aiDifficulty)||{trainingRate:1,buildRate:1};
  launch.difficulty=aiDifficulty;
  map.mission=missionData;
  for(const variant of missionData.variants||[])if(variant.difficulty===difficulty){
   missionData.troops.push(...variant.troops);missionData.structures.push(...variant.structures);
  }
  map.water=hdWater;
  // Map objects and structure parts come from the shared HD object library.
  const placements=missionData.structures.map(s=>({...s,x:s.position[0],y:s.position[1],z:s.position[2],r:s.orientation||0}));
  const structureData={structures:buildingData.structures,
   // Building sites (ANDAMIO) carry no walkway until built.
   placements:placements.filter(p=>buildingData.structures[p.type]?.deck)};
  const wantedModels=new Set(map.objects.map(o=>o.n.toLowerCase()));
  for(const p of placements)for(const part of buildingData.structures[p.type]?.parts||[])wantedModels.add(part.model);
  // Structures that rise, take damage and fall show their other geometries
  // (DefVisuales CONSTRUCCION / DESTRUCCION / ROTO): those of the mission's
  // structures and of what its races can build.
  const missionRaces=new Set(missionData.civilizations.map(c=>c.race).filter(Boolean));
  const buildTypes=new Set(placements.map(p=>p.construction).filter(Boolean));
  for(const race of missionRaces)for(const type of races[race]?.builds||[])buildTypes.add(type);
  for(const race of missionRaces){const garrison=races[race]?.garrison;if(garrison)buildTypes.add(garrison);}
  const stateModels=def=>{const g=def?.geometries||{};return [...(g.construction||[]),...(g.damaged||[]),g.ruin,g.destroyed].filter(Boolean);};
  for(const p of placements)if(['GUARNICION','TORRE_DEFENSA','ATACABLE','BARCO'].includes(buildingData.structures[p.type]?.kind))for(const m of stateModels(buildingData.structures[p.type]))wantedModels.add(m);
  for(const type of buildTypes){const def=buildingData.structures[type];if(!def)continue;for(const part of def.parts)wantedModels.add(part.model);for(const m of stateModels(def))wantedModels.add(m);}
  // A gate that gives way shows its broken model.

  const models={textureInfo:objectIndex.textureInfo,models:Object.fromEntries(await Promise.all([...wantedModels]
   .filter(name=>objectIndex.models[name]).map(name=>loadJSON('assets/hd/objects/'+objectIndex.models[name].file).then(m=>[name,m]))))};
  // The HD cooked mesh retains the original 8-bit field with its exact range.
  if(map.terrain?.heightBytes){
   const floor=map.pve.floor,range=map.pve.ceiling-floor;
   map.terrain.heights=map.terrain.heightBytes.map(value=>floor+value/255*range);
  }
  // Mission structures (the fixed bridge): soldiers walk on its deck, so the
  // ground heights under the walkway are raised before anything samples them.
  const structures=window.PraetoriansStructures.create(structureData);
  structures.patchHeights(map.terrain.heights,map.terrain.width,map.terrain.depth,map.terrain.spacing||.5);
  const B = BABYLON, W = map.width, D = map.depth;
  const canvas = $('renderCanvas');
  const engine = new B.Engine(canvas, true, {preserveDrawingBuffer: false, stencil: true});
  const scene = new B.Scene(engine);
  scene.clearColor = new B.Color4(.055, .075, .035, 1);
  scene.ambientColor = new B.Color3(.18, .20, .14);
  scene.skipPointerMovePicking = true;
  // The game picks its own cursors (src/ui/cursors.js): Babylon must not reset them.
  scene.doNotHandleCursors = true;
  const ambient = new B.HemisphericLight('sky', new B.Vector3(0, 1, 0), scene);
  ambient.intensity = .82;
  ambient.diffuse = new B.Color3(.97, 1, .87);
  ambient.groundColor = new B.Color3(.25, .29, .13);
  const sun = new B.DirectionalLight('afternoon sun', new B.Vector3(-.5, -1, .45), scene);
  sun.intensity = .72;
  sun.diffuse = new B.Color3(1, .96, .81);
  const camera = new B.ArcRotateCamera('battlefield camera', -Math.PI / 4, .73, 65, new B.Vector3(115, 0, 40), scene);
  camera.mode = B.Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = .1; camera.maxZ = 500;
  camera.lowerBetaLimit = .25; camera.upperBetaLimit = 1.12;
  camera.lowerRadiusLimit = 65; camera.upperRadiusLimit = 65;
  camera.panningSensibility = 0;
  camera.attachControl(canvas, true);
  camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
  camera.inputs.removeByType('ArcRotateCameraMouseWheelInput');
  window.PraetoriansCameraMotion.configurePointer(camera);
  camera.angularSensibilityX = 900; camera.angularSensibilityY = 1100;
  let zoom = 11.6,cameraMotion=null;
  function resetCameraMotion(){
   cameraMotion?.reset();
   camera.inertialAlphaOffset=camera.inertialBetaOffset=camera.inertialRadiusOffset=0;
   camera.inertialPanningX=camera.inertialPanningY=0;
   // Babylon's pointer rotation already compensates for elapsed time.
   // Clear its queued movement when pausing or jumping to another view.
   camera.movement?.resetRotationVelocity();camera.movement?.resetPanVelocity();camera.movement?.resetZoomVelocity();
  }
  function resizeCamera() {
   const aspect = engine.getRenderWidth() / engine.getRenderHeight();
   camera.orthoTop = zoom; camera.orthoBottom = -zoom;
   camera.orthoLeft = -zoom * aspect; camera.orthoRight = zoom * aspect;
  }
  // The starting view: the player's army (the human civilization's troops, or
  // the first skirmish start position).
  // The civilization the player commands (F8 / settings: take control of any other).
  let humanCiv=missionData.civilizations.find(c=>c.human)?.name,cpuEnabled=true;
  function armyCentre(){
   const own=missionData.troops.filter(t=>t.civilization===humanCiv);
   if(own.length)return {x:own.reduce((n,t)=>n+t.position[0],0)/own.length,z:own.reduce((n,t)=>n+t.position[2],0)/own.length};
   const start=missionData.startPositions?.[0];
   return start?{x:start[0],z:start[1]}:{x:W/2,z:D/2};
  }
  function view(name) {
   camera.inertialAlphaOffset = camera.inertialBetaOffset = 0;
   camera.alpha = -Math.PI / 4; camera.beta = .73;
   if (name === 'map') {camera.target.set(W / 2, 0, D / 2); zoom = Math.max(W,D)*.36;}
   else if (name === 'river' && isTutorial1) {camera.target.set(76, .5, 38); zoom = 13;}
   else if (isTutorial1) {camera.target.set(114.5, .3, 39.5); zoom = 11.6;}
   else {const c=armyCentre();camera.target.set(c.x,0,c.z);zoom=11.6;}
   resizeCamera();resetCameraMotion();
  }
  view(new URLSearchParams(location.search).get('view') || 'army');
  cameraMotion=window.PraetoriansCameraMotion.create({camera,width:W,depth:D,
   maxZoom:Math.max(65,Math.max(W,D)*.36),getZoom:()=>zoom,setZoom(value){zoom=value;resizeCamera();}});
  // Cap the entire Babylon frame, including GPU submission. CSS-pixel native
  // resolution is the default; lower scales only affect the 3D canvas.
  const renderBudget=window.PraetoriansRenderBudget.create({engine,onResize:resizeCamera,
   onApply(value){$('fpsLimit').value=String(value.fps);$('renderScale').value=String(value.renderScale);}});
  $('fpsLimit').addEventListener('change',e=>renderBudget.apply({fps:e.target.value==='display'?'display':Number(e.target.value)}));
  $('renderScale').addEventListener('change',e=>renderBudget.apply({renderScale:Number(e.target.value)}));
  window.addEventListener('resize', () => {engine.resize(); resizeCamera();});
  canvas.addEventListener('wheel', e => {
   e.preventDefault();
   if(!window.praetorians||window.PraetoriansMenu?.isOpen()||ordersBlocked())return;
   // Wheel mice, trackpads and page-mode devices feed the same eased zoom.
   const pixels=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1);
   cameraMotion.requestZoom(pixels);
  }, {passive: false});
  // Standards, facing guides and HUD overlays are separate DOM elements.
  // Cancel the native menu for the entire active game without swallowing
  // right-click handlers such as group memorisation.
  document.addEventListener('contextmenu',e=>{
   if(!$('game').hidden&&!window.PraetoriansMenu?.isOpen())e.preventDefault();
  },true);

  const terrain = map.terrain;
  const gridW = terrain?.width || W + 1, gridD = terrain?.depth || D + 1;
  const heightValues = terrain?.heights;
  const fallbackSample = (x, z) => map.pve.heightBytes[Math.min(D-1, Math.max(0, z))*W + Math.min(W-1, Math.max(0, x))];
  function gridHeight(x, z) {
   if (heightValues) return heightValues[z * gridW + x];
   return (fallbackSample(Math.min(x,W-1), Math.min(z,D-1)) - 33) / 74;
  }
  function groundY(x, z) {
   // Use the same eight-triangle PVE surface as A* and individual soldiers.
   if(heightValues) return window.PraetoriansNavigation.sampleHeight(heightValues,W,D,terrain.spacing||.5,x,z);
   const gx = Math.max(0,Math.min(gridW-1,x / W * (gridW-1)));
   const gz = Math.max(0,Math.min(gridD-1,z / D * (gridD-1)));
   const ix = Math.min(gridW-2,Math.floor(gx)), iz = Math.min(gridD-2,Math.floor(gz));
   const u=gx-ix,v=gz-iz;
   return gridHeight(ix,iz)*(1-u)*(1-v)+gridHeight(ix+1,iz)*u*(1-v)+gridHeight(ix,iz+1)*(1-u)*v+gridHeight(ix+1,iz+1)*u*v;
  }
  // Fortress walls (MURALLAS, src/world/fortress.js): raised walkways reached
  // by ladders, solid wall sides, and gates (PUERTA structures) that open for
  // the side holding the fortress. Each wall piece reads the ground under it
  // before the walkways are raised.
  const fortress=map.walls?.pieces?.length?window.PraetoriansFortress.create({walls:map.walls,objects:map.objects,
   gates:placements.filter(p=>buildingData.structures[p.type]?.kind==='PUERTA').map(p=>({placement:p,structure:buildingData.structures[p.type]})),groundY}):null;
  if(fortress){
   fortress.patchHeights(map.terrain.heights,map.terrain.width,map.terrain.depth,map.terrain.spacing||.5);
   initialHolders();
  }
  // A gate nobody owns belongs to whoever garrisons the fortress at the start.
  function initialHolders(){
   const neutral=new Set(missionData.civilizations.filter(c=>c.neutral).map(c=>c.name)),inside=new Map();
   for(const t of missionData.troops)if(!neutral.has(t.civilization)&&fortress.contains(t.position[0],t.position[2]))inside.set(t.civilization,(inside.get(t.civilization)||0)+(t.units||1));
   const holder=[...inside].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
   let changed=false;
   for(const gate of fortress.gates)if(!gate.placement.owner||/^neutral$/i.test(gate.placement.owner)){if(gate.holder!==holder)changed=true;gate.holder=holder;}
   return changed;
  }
  // The navigation and unit-motion modules are kept independent from rendering.
  // Navigation is built once the HD terrain mesh is loaded (painted cliffs).
  const motion=window.PraetoriansSquadMotion;
  // Blocked-terrain overlay, for the selected troop (its own profile and
  // gates): red where it cannot go, blue deep water, aqua shallow water it
  // may wade, light red open ground its formation is too wide for. Drawn as
  // one filtered texture laid over the ground, so the edges follow the
  // terrain smoothly instead of in blocks.
  const overlayColors={cliff:[238,36,28,150],water:[38,107,245,140],tight:[255,77,64,70],ford:[115,242,217,80]};
  function navigationOverlay(radius,grid){
   const nx=grid.statistics.columns,nz=grid.statistics.rows,step=grid.step;
   const texture=new B.DynamicTexture('navigation restrictions',{width:nx,height:nz},scene,false,B.Texture.BILINEAR_SAMPLINGMODE);
   const context=texture.getContext(),image=context.createImageData(nx,nz);
   for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    const i=z*nx+x,px=x*step,pz=z*step;
    const kind=grid.water[i]?'water':!grid.walkable[i]?'cliff':radius&&!grid.canStand(px,pz,radius)?'tight':grid.ford?.[i]?'ford':null;
    if(!kind)continue;
    // Canvas rows run top-down; the texture's v runs with z.
    image.data.set(overlayColors[kind],((nz-1-z)*nx+x)*4);
   }
   // Uploaded flipped (invertY): the canvas's bottom row (z = 0) is v = 0.
   // Unflipped, the overlay lay mirrored across the map.
   context.putImageData(image,0,0);texture.update(true);
   texture.wrapU=texture.wrapV=B.Texture.CLAMP_ADDRESSMODE;texture.hasAlpha=true;
   // A 1 m grid following the ground (walkways and bridge decks included).
   const positions=[],uvs=[],indices=[],cols=W+1;
   for(let z=0;z<=D;z++)for(let x=0;x<=W;x++){positions.push(x,groundY(x,z)+.07,z);uvs.push((x+.5*step)/(W+step),(z+.5*step)/(D+step));}
   for(let z=0;z<D;z++)for(let x=0;x<W;x++){const a=z*cols+x;indices.push(a,a+cols,a+1,a+1,a+cols,a+cols+1);}
   const material=new B.StandardMaterial('navigation restrictions',scene);
   material.disableLighting=true;material.emissiveTexture=texture;material.opacityTexture=texture;material.diffuseColor=B.Color3.Black();
   material.backFaceCulling=false;material.zOffset=-2;
   const mesh=makeMesh('navigation restrictions',{positions,indices,uvs},material);
   mesh.isPickable=false;
   return mesh;
  }
  let restrictions=null,restrictionRadius=null;
  let restrictionGrid=null;
  function refreshNavigationOverlay(){
   const enabled=$('showNavigation').checked&&!$('showVillageDebug').checked;
   const radius=enabled?Math.max(0,...selectedSquads.map(s=>s.radius)):null;
   const grid=enabled?(selectedSquads[0]?navOf(selectedSquads[0]):nav):null;
   if(restrictions&&(!enabled||radius!==restrictionRadius||grid!==restrictionGrid)){restrictions.material.emissiveTexture?.dispose();restrictions.material.dispose();restrictions.dispose();restrictions=null;}
   if(enabled&&!restrictions){restrictions=navigationOverlay(radius,grid);restrictionRadius=radius;restrictionGrid=grid;}
  }
  // Debug renderer uses the same half-metre navigation samples as the game.
  // It shows why a cell is marked solid; it does not add or remove collisions.
  // MLG colouring reads the original 1-metre logical cells, while the yellow
  // samples come from the actual rotated village CASILLAS classification.
  const debugColors={village:[255,206,35,190],both:[202,66,250,220],mlg:[255,62,140,170],
   building:[255,146,28,165],cliff:[248,59,47,125],water:[36,106,251,150],
   hill:[55,188,102,96]}; // Green = measured, climbable MLG hillside.
  let villageDebugOverlay=null,villageDebugGrid=null,villageDebugCircle=null,debugLastOrder=null,debugStatusTimer=0;
  // Geometry X-ray is opt-in and purely visual. It shows the *actual*
  // member footprint, path, passage normals and free/blocked widths, rather
  // than just the oversized circular A* proxy.
  let geometryDebugMeshes=[],showXrayTerrain=true;
  const geometryHud=document.createElement('div');
  geometryHud.id='formationGeometryHud';
  geometryHud.style.cssText='position:fixed;right:16px;top:128px;z-index:9999;max-width:300px;padding:9px 12px;border:1px solid #6aa8a0;background:rgba(9,22,26,.84);color:#e4f6f0;font:12px/1.5 monospace;white-space:pre-wrap;pointer-events:none;border-radius:4px;';
  geometryHud.hidden=true;document.body.appendChild(geometryHud);
  function clearGeometryDebug(){
   for(const m of geometryDebugMeshes)m.dispose();geometryDebugMeshes=[];
  }
  function drawFormationGeometry(s,grid,fit,targetFit=null){
   clearGeometryDebug();if(!fit)return;
   const at=(x,z,h=.25)=>new B.Vector3(x,groundY(x,z)+h,z);
   const colour={foot:new B.Color3(.22,1,.94),soft:new B.Color3(1,.82,.25),free:new B.Color3(.2,1,.4),
    blocked:new B.Color3(1,.2,.19),guide:new B.Color3(1,.8,.12),path:new B.Color3(.68,.55,1),
    attempted:new B.Color3(1,.57,.15)};
   const shapes={foot:[],soft:[],free:[],blocked:[],guide:[],path:[],attempted:[]};
   const line=(type,a,b,h=.25)=>shapes[type].push([at(a.x,a.z,h),at(b.x,b.z,h)]);
   // Convex hull of the soldiers' ACTUAL positions, not a mathematical
   // rectangle centred on the A* point. The hull bends as the rear ranks
   // follow a corner and shows the centreline's sideways displacement.
   const spots=s.members.map(m=>({x:m.x,z:m.z})).sort((a,b)=>a.x-b.x||a.z-b.z);
   const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
   const lower=[],upper=[];
   for(const p of spots){while(lower.length>1&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}
   for(let i=spots.length-1;i>=0;i--){const p=spots[i];while(upper.length>1&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}
   const hull=lower.slice(0,-1).concat(upper.slice(0,-1));
   for(let i=0;i<hull.length;i++)line('foot',hull[i],hull[(i+1)%hull.length],.34);
   // Cyan = clear foot and shoulder, yellow = safe foot with visible
   // silhouette brushing a border, red = foot core actually blocked.
   // Never classify a prohibited footstep as an allowable soft brush.
   const core=fit.footCoreRadius??.06,shoulder=fit.visualShoulderRadius??.145;
   for(const m of s.members){
    const scale=fit.currentScale??1;
    const planted=(grid.canMarchFoot||grid.canStand).call(grid,m.x,m.z,core)||
     (Math.abs(m.dx)>=(s.outerFile??Infinity)-1e-4&&grid.canWingFoot?.(m.x,m.z,core,{
      x:m.x-Math.cos(m.r)*Math.sign(m.dx)*(s.spacing?.x||.47)*scale,
      z:m.z+Math.sin(m.r)*Math.sign(m.dx)*(s.spacing?.x||.47)*scale}));
    const type=!planted?'blocked':
     !grid.canStand(m.x,m.z,shoulder)?'soft':'foot',r=.09;
    line(type,{x:m.x-r,z:m.z},{x:m.x+r,z:m.z},.34);
    line(type,{x:m.x,z:m.z-r},{x:m.x,z:m.z+r},.34);
   }
   for(const section of fit.samples){
    const rx=Math.cos(section.yaw),rz=-Math.sin(section.y);
    const c={x:section.x,z:section.z};
    const lo={x:c.x-rx*section.left,z:c.z-rz*section.left};
    const hi={x:c.x+rx*section.right,z:c.z+rz*section.right};
    line(section.tightFits?'free':'blocked',lo,hi,.42);
    for(const sign of [-1,1]){
     const edge=sign<0?lo:hi;
     const mark={x:edge.x+rx*sign*.23,z:edge.z+rz*sign*.23};
     line('blocked',edge,mark,.42);
    }
   }
   const face=fit.heading;
   const tip={x:s.x+Math.sin(face)*2.35,z:s.z+Math.cos(face)*2.35};
   line('guide',{x:s.x,z:s.z},tip,.45);
   const headL={x:tip.x-Math.sin(face-.42)*.42,z:tip.z-Math.cos(face-.42)*.42};
   const headR={x:tip.x-Math.sin(face+.42)*.42,z:tip.z-Math.cos(face+.42)*.42};
   line('guide',tip,headL,.45);line('guide',tip,headR,.45);
   if(s.flow?.line)for(let i=1;i<s.flow.line.length;i++)line('path',s.flow.line[i-1],s.flow.line[i],.18);
   else if(s.path){
    let prev={x:s.x,z:s.z};
    for(const p of s.path.slice(s.waypoint??0)){line('path',prev,p,.18);prev=p;}
   }
   if(debugLastOrder?.squad===s){
    // Orange = the path A* proposed but the complete moving footprint
    // rejected; red X = the first specific failure in its sweep.
    const issue=debugLastOrder.diagnostic||s.lastRouteDiagnostic?.diagnostic;
    const attempted=debugLastOrder.failedRoute||s.lastRouteDiagnostic?.failedRoute;
    if(!debugLastOrder.ok&&Array.isArray(attempted))for(let i=1;i<attempted.length;i++)
     line('attempted',attempted[i-1],attempted[i],.48);
    if(!debugLastOrder.ok&&issue?.at){
     if(issue.sectionCenter&&Number.isFinite(issue.yaw)){
      const section=rejectedPassageSection(navOf(s),issue,Math.max(...s.members.map(m=>Math.abs(m.dz))));
      if(section){
       const rx=Math.cos(section.yaw),rz=-Math.sin(section.yaw);
       const a={x:section.x-rx*section.left,z:section.z-rz*section.left};
       const b={x:section.x+rx*section.right,z:section.z+rz*section.right};
       line(section.width<(issue.minimumFormationWidth||fit.minimumWidth)?'blocked':'free',a,b,.65);
      }
     }
     const {x,z}=issue.at,r=.4;
     line('blocked',{x:x-r,z:z-r},{x:x+r,z:z+r},.7);
     line('blocked',{x:x-r,z:z+r},{x:x+r,z:z-r},.7);
     for(let i=0;i<16;i++){
      const a=i*Math.PI/8,b=(i+1)*Math.PI/8;
      line('blocked',{x:x+.52*Math.cos(a),z:z+.52*Math.sin(a)},
       {x:x+.52*Math.cos(b),z:z+.52*Math.sin(b)},.68);
     }
     if(issue.centre)line('attempted',issue.centre,issue.at,.55);
     // Show the exact swept segment that failed, in red. With the former
     // single X at the sample centre it was impossible to know whether the
     // outside rank scraped a cliff, the map rim, or a tight bend.
     if(issue.sweepStart&&issue.sweepEnd){
      line('blocked',issue.sweepStart,issue.sweepEnd,.79);
      const a=issue.sweepStart,b=issue.sweepEnd;
      const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1;
      const nx=-dz/len*.17,nz=dx/len*.17;
      line('blocked',{x:a.x+nx,z:a.z+nz},{x:a.x-nx,z:a.z-nz},.79);
     }
    }
    const goal=debugLastOrder.to,r=.29;
    if(targetFit){
     const section=targetFit.samples[0],rx=Math.cos(section.yaw),rz=-Math.sin(section.y);
     const a={x:section.x-rx*section.left,z:section.z-rz*section.left};
     const b={x:section.x+rx*section.right,z:section.z+rz*section.right};
     line(section.tightFits?'free':'blocked',a,b,.52);
    }
    for(let k=0;k<16;k++){
     const a=2*Math.PI*k/16,b=2*Math.PI*(k+1)/16;
     line('guide',{x:goal.x+r*Math.cos(a),z:goal.z+r*Math.sin(a)},
      {x:goal.x+r*Math.cos(b),z:goal.z+r*Math.sin(b)},.38);
    }
   }
   for(const [type,segments]of Object.entries(shapes))if(segments.length){
    const mesh=B.MeshBuilder.CreateLineSystem('formation geometry '+type,{lines:segments},scene);
    mesh.isPickable=false;mesh.color=colour[type];geometryDebugMeshes.push(mesh);
   }
  }
  function createVillageDebugOverlay(grid){
   const nx=grid.statistics.columns,nz=grid.statistics.rows,step=grid.step;
   const texture=new B.DynamicTexture('village collision debug',{width:nx,height:nz},scene,false,B.Texture.NEAREST_SAMPLINGMODE);
   const context=texture.getContext(),image=context.createImageData(nx,nz);
   for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    const i=z*nx+x,px=x*step,pz=z*step;
    const lx=grid.logicalWidth?Math.min(grid.logicalWidth-1,Math.floor(px)):0;
    const lz=grid.logicalDepth?Math.min(grid.logicalDepth-1,Math.floor(pz)):0;
    const mlg=!!(grid.logicalBlocked&&grid.logicalBlocked[lz*grid.logicalWidth+lx]&&!grid.deck[i]&&!grid.level[i]);
    const village=!!grid.villageSolid[i];
    const hill=!!(grid.gentleHill&&grid.gentleHill[lz*grid.logicalWidth+lx]);
    const kind=village&&mlg?'both':village?'village':mlg?'mlg':grid.water[i]?'water':
     grid.slope[i]?'cliff':grid.solid[i]?'building':hill?'hill':null;
    if(kind)image.data.set(debugColors[kind],((nz-1-z)*nx+x)*4);
   }
   // Flipped on upload like the navigation overlay (v = 0 is z = 0).
   context.putImageData(image,0,0);texture.update(true);
   texture.wrapU=texture.wrapV=B.Texture.CLAMP_ADDRESSMODE;texture.hasAlpha=true;
   const positions=[],uvs=[],indices=[],cols=W+1;
   for(let z=0;z<=D;z++)for(let x=0;x<=W;x++){
    positions.push(x,groundY(x,z)+.11,z);
    uvs.push((x+.5*step)/(W+step),(z+.5*step)/(D+step));
   }
   for(let z=0;z<D;z++)for(let x=0;x<W;x++){
    const a=z*cols+x;indices.push(a,a+cols,a+1,a+1,a+cols,a+cols+1);
   }
   const material=new B.StandardMaterial('village collision debug',scene);
   material.disableLighting=true;material.emissiveTexture=texture;material.opacityTexture=texture;
   material.diffuseColor=B.Color3.Black();material.backFaceCulling=false;material.zOffset=-3;
   const mesh=makeMesh('village collision debug',{positions,indices,uvs},material);
   mesh.isPickable=false;return mesh;
  }
  function disposeVillageDebugOverlay(){
   if(!villageDebugOverlay)return;
   villageDebugOverlay.material.emissiveTexture?.dispose();
   villageDebugOverlay.material.dispose();villageDebugOverlay.dispose();
   villageDebugOverlay=null;villageDebugGrid=null;
  }
  // Actual terrain width through the REJECTED path cross-section, not only
  // the selected squad's current footprint. This is diagnostic-only; it never
  // alters pathfinding, collision or movement orders.
  function rejectedPassageSection(nav,issue,depth){
   if(!issue?.sectionCenter||!Number.isFinite(issue.yaw)||!nav?.canStand)return null;
   const {x,z}=issue.sectionCenter,yaw=issue.yaw,rx=Math.cos(yaw),rz=-Math.sin(yaw),
    fx=Math.sin(yaw),fz=Math.cos(yaw);
   const safe=(sign,side)=>[-depth,0,depth].every(forward=>
    nav.canStand(x+fx*forward+rx*sign*side,z+fz*forward+rz*sign*side,.11));
   const probe=sign=>{
    let room=0;
    for(let d=0;d<=4.001;d+=.08){if(!safe(sign,d))break;room=d;}
    return room;
   };
   const left=probe(-1),right=probe(1);
   return {x,z,yaw,left,right,width:left+right};
  }
  function updateVillageDebugStatus(){
   if(!$('showVillageDebug').checked)return;
   const s=selectedSquads[0];
   if(!s){$('villageDebugInfo').textContent='Select a squad to inspect passage width, terrain collision and the formation footprint.';
    geometryHud.textContent='FORMATION X-RAY [F6]\nSelect a troop to analyse passages.';
    villageDebugCircle?.setEnabled(false);clearGeometryDebug();return;}
   const grid=navOf(s),d=grid.diagnose(s.x,s.z,s.radius??.6);
   const lines=[`${s.type||s.name||'Selected squad'} · (${d.x.toFixed(2)}, ${d.z.toFixed(2)})`,
    `Stand at current position: ${d.allowed?'YES':'NO — BLOCKED'}   radius=${d.radius.toFixed(2)} m`,
    `Village CASILLAS at actual position: ${d.village?'YES':'no'} (no village safety halo)`,
    `Other structure here: ${d.hitKind&&!d.village?d.hitKind:'none'}`,
    `MLG cell (${d.logicalCell.x??'-'}, ${d.logicalCell.z??'-'}): ${d.flags==null?'not loaded':'0x'+d.flags.toString(16).padStart(8,'0')}`,
    `MLG cell blocked for this unit: ${d.logicalCell.blocked?'YES':'no'}; overlap in radius: ${d.logicalCell.overlap?'YES':'no'}`,
    `Half-cell sample (${d.sample.x.toFixed(1)}, ${d.sample.z.toFixed(1)}): village=${+d.sample.village}, solid=${+d.sample.solid}, MLG=${+d.sample.barred}, cliff=${+d.sample.steep}, water=${+d.sample.water}`,
    `Clearance from non-village blockers: ${d.clearance.toFixed(2)} m (needs > ${d.requiredClearance.toFixed(2)} m)`,
    `EDGE DISTANCE: ${d.worldEdgeGap.toFixed(2)} m to the map border (full squad circle needs ${d.radius.toFixed(2)} m; individual soldiers are checked separately)`,
    `Village routing gap: ${d.villageRouteGap.toFixed(2)} m (formation radius: ${d.radius.toFixed(2)} m; does NOT block soldier movement)`,
    `MOVEMENT: ${s.isMoving?'MOVING':'STOPPED'} · phase=${s.phase||'unknown'} · waypoint=${s.waypoint??'-'}/${s.path?.length??0}`,
    `Motion blockage: ${s.blockedReason||'none'} · route endpoint: ${s.destination?`(${s.destination.x.toFixed(2)}, ${s.destination.z.toFixed(2)})`:'none'}`,
    `Accessible A* start node nearby: ${d.gridNodeFound?'YES':'NO'}`,
    `Nearest non-village blocker: ${d.nearestBlocker?`${d.nearestBlocker.kind} at (${d.nearestBlocker.x},${d.nearestBlocker.z}) ~${d.nearestBlocker.distance} m`:'none nearby'}`,
    `Reasons: ${d.reasons.length?d.reasons.join(' | '):'none at current point'}`];
   const fit=motion.inspectPassage?.(s,grid);
   if(fit){
    const m=x=>Number.isFinite(x)?x.toFixed(2):'—';
    const deg=a=>Math.round(a*180/Math.PI);
    lines.push('—— FORMATION GEOMETRY (actual soldier footprint) ——');
    lines.push(`Width: normal ${m(fit.normalWidth)} m · tight ${m(fit.minimumWidth)} m · depth ${m(fit.normalDepth)} → ${m(fit.minimumDepth)} m`);
    lines.push(`CORE + FLANKS: ${s.members.length} men keep ranks; the strict central files require ${m(fit.normalCoreWidth)} m at full width (or ${m(fit.walkableCoreWidth)} m at maximum squeeze). Side files can overhang flat painted edges, never cliffs, water or the map border.`);
    lines.push(`Heading: ${deg(fit.heading)}° · compactness ${(100*fit.currentScale).toFixed(0)}% · sideways shift ${m(fit.lateralShift)} m`);
    lines.push(`FOOT CONTACT: ${m(fit.footCoreRadius)} m core / ${m(fit.visualShoulderRadius)} m silhouette; ${fit.wingTouches} outer-file overhangs (max ${m(fit.wingReach)} m); ${fit.softFootTouches} tolerated foot contacts, ${fit.footBlocked} truly blocked.`);
    lines.push('The centre and inner files obey hard terrain. OUTER FILES may overhang a little if the adjacent inner file is walkable. AMBER: permitted contact; RED: genuinely blocked core, border, water or structures.');
    lines.push(`TURN: ${s.individualTurn&&!s.individualTurn.settle?'in-place soldier about-face / slot reassignment':s.phase==='turning'?'formation bend/pivot':'none'}. No 360-degree block wheel on reversal.`);
    for(const section of fit.samples){
     lines.push(`At +${m(section.forward)} m: free cross-section ≈${m(section.width)} m (left ${m(section.left)} / right ${m(section.right)}): ${section.fullFits?'FULL FIT':section.tightFits?'SQUEEZE':'TOO NARROW / BLOCKED'}`);
    }
    if(fit.plannedMinScale!==null)lines.push(`Planned tightest width: ${(100*fit.plannedMinScale).toFixed(0)}% · max centre shift ${m(fit.plannedMaxShift)} m`);
    lines.push(`Fit at current point: ${fit.canFitHere?'YES':'NO'} · best local orientation: ${fit.bestAngle?`${deg(fit.bestAngle.yaw)}° (${100*fit.bestAngle.scale}% spacing)`:'none'}`);
    lines.push(`Geometry diagnosis: ${fit.reason} Walkable core ${m(fit.walkableCoreWidth)} m; outside-file tolerance ${m(fit.wingReach)} m.`);
    lines.push('Cyan = clear soldiers · amber = shoulder brush · red = FOOT BLOCKED · green = free cross-section · yellow = heading/target · violet = route.');
    lines.push('TERRAIN X-RAY: faint GREEN = climbable hillside (PVE grade checked); PINK = blocked MLG; RED = sheer gradient.');
   }
   if(debugLastOrder?.squad===s){
    const o=debugLastOrder;
    lines.push(`LAST MOVE to (${o.to.x.toFixed(2)}, ${o.to.z.toFixed(2)}): ${o.ok?'accepted':'REFUSED'}`);
    if(!o.ok)lines.push('Route result: '+o.reason);
    if(!o.ok&&o.diagnostic?.at){
     const issue=o.diagnostic,hit=grid.diagnose(issue.at.x,issue.at.z,.11);
     lines.push('BEST ATTEMPT — FIRST ROUTE FAILURE: '+issue.kind);
     lines.push(`At (${issue.at.x.toFixed(2)}, ${issue.at.z.toFixed(2)}) · soldier ${issue.member==null?'centre':issue.member+1} · ${issue.distance==null?'during turn':issue.distance.toFixed(2)+' m into march'}`);
     lines.push(`Map boundary gap at failure: ${hit.worldEdgeGap.toFixed(2)} m (checked footprint: 0.11 m)`);
     if(issue.legalPoses!=null)lines.push(`CROSS-SECTION: legal lateral poses ${issue.legalPoses}, reachable transitions ${issue.reachablePoses}, failed swept segments ${issue.failedSweeps}`);
     if(issue.compressionAttempts)lines.push(`ADAPTIVE PINCH SEARCH: ${issue.compressionAttempts} spacing profiles tested; final compression ${(100*(issue.compression??1)).toFixed(0)}%`);
     const rejectedSection=rejectedPassageSection(grid,issue,Math.max(...s.members.map(m=>Math.abs(m.dz))));
     if(rejectedSection)lines.push(`ROUTE PINCH WIDTH: ${rejectedSection.width.toFixed(2)} m available (L ${rejectedSection.left.toFixed(2)} / R ${rejectedSection.right.toFixed(2)}), minimum ${Number(issue.minimumFormationWidth??fit.minimumWidth).toFixed(2)} m at this heading; centre-line ${grid.canStand(rejectedSection.x,rejectedSection.z,.11)?'walkable':'blocked'}`);
     if(issue.sweepStart&&issue.sweepEnd)lines.push(`RED SWEPT SEGMENT: (${issue.sweepStart.x.toFixed(2)},${issue.sweepStart.z.toFixed(2)}) → (${issue.sweepEnd.x.toFixed(2)},${issue.sweepEnd.z.toFixed(2)})`);
     if(Number.isFinite(issue.yaw))lines.push(`Failure orientation: ${Math.round(issue.yaw*180/Math.PI)}°${issue.compression?` · compression ${(100*issue.compression).toFixed(0)}%`:''}`);
     lines.push('Terrain under failure: '+(hit.reasons.join(' | ')||hit.hitKind||'adjacent cell / swept collision'));
     if(issue.kind==='entry-turn')lines.push('Suggestion: move outward into turning space first, rather than pivoting at this position.');
     if(issue.kind==='no-continuous-lane'||issue.kind==='lateral-transition-too-sharp')lines.push('Suggestion: the troop needs a smoother approach to the entrance; local space is not enough to guarantee a whole-route fit.');
     if(issue.kind==='no-legal-formation-pose')lines.push('Suggestion: the current route cross-section physically cannot hold the compressed troop. A wider detour is needed.');
     if(issue.kind==='swept-soldier'||issue.kind==='swept-centre')lines.push('Suggestion: follow the RED swept segment: the actual moving footprint clips terrain or the world border between two legal-looking poses.');
     if(hit.worldEdgeOverlap)lines.push('WORLD EDGE COLLISION: this proposed route clips the unplayable outside border.');
     if(!hit.allowed&&hit.logicalCell.blocked)lines.push('MLG COLLISION: the proposed route overlaps a map-authored blocked cell.');
    }else if(!o.ok)lines.push('No swept corridor recorded: A* or destination deployment rejected the order before formation testing.');
    if(o.ok)lines.push(`ACCEPTED MARCH: minimum width ${(100*(o.compactScale??1)).toFixed(0)}% · maximum planned lateral movement ${(o.lateralPlan??0).toFixed(2)} m · compression-search attempts ${o.compressionAttempts??1}`);
    if(o.ok&&o.adjusted)lines.push(`Destination SNAPPED from (${o.to.x.toFixed(2)}, ${o.to.z.toFixed(2)}) to (${o.endpoint.x.toFixed(2)}, ${o.endpoint.z.toFixed(2)})`);
   }
   let targetFit=null;
   if(debugLastOrder?.squad===s){
    const goal=debugLastOrder.to;
    targetFit=motion.inspectPassage?.({...s,x:goal.x,z:goal.z,flow:null},grid)||null;
    if(targetFit)lines.push(`CLICKED DESTINATION: free width ≈${targetFit.samples[0].width.toFixed(2)} m; local orientation ${targetFit.bestAngle?Math.round(targetFit.bestAngle.yaw*180/Math.PI)+'°':'BLOCKED'}; ${debugLastOrder.ok?'order accepted':'route rejected'}`);
    const goalCell=grid.diagnose(goal.x,goal.z,.11);
    lines.push(`GOAL CELL: ${goalCell.allowed?'walkable for one soldier':'BLOCKED for a soldier'} · ${goalCell.reasons.join(' | ')||'no local obstacle'} · clearance ${goalCell.clearance.toFixed(2)} m · world edge ${goalCell.worldEdgeGap.toFixed(2)} m`);
    lines.push(`HILL TEST: ${goalCell.logicalCell.gentleHill?'gentle terrain ramp accepted':goalCell.logicalCell.blocked?'MLG cliff/forbidden terrain remains blocked':'ordinary walkable terrain'} · measured grade ${goalCell.groundGrade.toFixed(2)} rise/m; only gradual slopes are climbable.`);
    if(!debugLastOrder.ok&&/divide the area|No passable route/.test(debugLastOrder.reason))
     lines.push('PLANNER STAGE: A* found no connected corridor at its attempted clearances; the terrain mask may separate these areas.');
    else if(!debugLastOrder.ok&&!debugLastOrder.diagnostic)
     lines.push('PLANNER STAGE: rejected before a specific soldier collision was recorded (destination placement, topology or navigation budget).');
   }
   $('villageDebugInfo').textContent=lines.join('\n');
   if(fit){
    const sample=fit.samples[1],angle=fit.bestAngle?Math.round(fit.bestAngle.yaw*180/Math.PI)+'°':'none';
    const failure=debugLastOrder?.squad===s&&!debugLastOrder.ok?debugLastOrder:null;
    const issue=failure?.diagnostic;
    const status=failure?failure.reason:s.blockedReason||'No rejection recorded';
    const edgeAtHit=issue?.at?grid.diagnose(issue.at.x,issue.at.z,.11).worldEdgeGap:null;
    const sectionAtFailure=issue?.sectionCenter?rejectedPassageSection(grid,issue,Math.max(...s.members.map(m=>Math.abs(m.dz)))):null;
    geometryHud.textContent=`FORMATION X-RAY [F6]  ·  Shift+F6 terrain ${showXrayTerrain?'ON':'OFF'}\nSquad: ${s.members.length} men · ${s.phase||'idle'}\nWidth: ${fit.normalWidth.toFixed(2)} m → ${fit.minimumWidth.toFixed(2)} m · core ${fit.normalCoreWidth.toFixed(2)} m\nAhead (+1.3m): ${sample.width.toFixed(2)} m (${sample.fullFits?'wide':sample.tightFits?'squeeze':'blocked'})\nHeading: ${Math.round(fit.heading*180/Math.PI)}° · local fit: ${angle}\nCompression: ${(100*fit.currentScale).toFixed(0)}% · lateral: ${fit.lateralShift.toFixed(2)} m\nSoft contacts: ${fit.softFootTouches} feet · ${fit.wingTouches} wing overhangs · ${fit.footBlocked} blocked\nHill: ${d.logicalCell.gentleHill?'GENTLE / CLIMBABLE':d.logicalCell.blocked?'STEEP / MLG BLOCKED':'ordinary terrain'} · grade ${d.groundGrade.toFixed(2)}\nTurn: ${s.individualTurn&&!s.individualTurn.settle?'ABOUT-FACE (in place)':s.phase==='turning'?'pivot/bend':'normal'}\nMap edge: ${d.worldEdgeGap.toFixed(2)} m from centre\n${failure?.ok===false&&sectionAtFailure?`Route pinch ${sectionAtFailure.width.toFixed(2)} m vs walkable core ${fit.walkableCoreWidth.toFixed(2)} m\n`:''}${issue?.at?`FAILED: ${issue.kind}\n(${issue.at.x.toFixed(2)}, ${issue.at.z.toFixed(2)})${issue.member==null?'':' · soldier '+(issue.member+1)} · edge ${edgeAtHit.toFixed(2)}m\n${issue.legalPoses==null?'':`Lanes ${issue.legalPoses} · transitions ${issue.reachablePoses} · sweeps ${issue.failedSweeps}\n`}`:''}${!failure&&debugLastOrder?.squad===s&&debugLastOrder.ok?`Path squeeze ${Math.round((debugLastOrder.compactScale??1)*100)}% · lateral ${(debugLastOrder.lateralPlan??0).toFixed(2)} m\n`:''}Route: ${status}`;
    drawFormationGeometry(s,grid,fit,targetFit);
   }
   const radius=Math.max(.25,s.radius??.6),points=[];
   for(let k=0;k<=64;k++){
    const a=k*Math.PI*2/64,x=s.x+radius*Math.cos(a),z=s.z+radius*Math.sin(a);
    points.push(new B.Vector3(x,groundY(x,z)+.24,z));
   }
   if(!villageDebugCircle){villageDebugCircle=B.MeshBuilder.CreateLines('selected navigation radius',{points},scene);
    villageDebugCircle.isPickable=false;}
   else B.MeshBuilder.CreateLines('selected navigation radius',{points,instance:villageDebugCircle});
   villageDebugCircle.setEnabled(true);
   villageDebugCircle.color=d.allowed?new B.Color3(.2,1,1):new B.Color3(1,.28,.18);
  }
  function refreshVillageDebugOverlay(){
   const enabled=$('showVillageDebug').checked;
   $('villageDebugPanel').hidden=!enabled;
   geometryHud.hidden=!enabled;
   if(!enabled){disposeVillageDebugOverlay();clearGeometryDebug();villageDebugCircle?.setEnabled(false);return;}
   const grid=selectedSquads[0]?navOf(selectedSquads[0]):nav;
   if(!showXrayTerrain){disposeVillageDebugOverlay();}
   else if(grid!==villageDebugGrid){disposeVillageDebugOverlay();villageDebugOverlay=createVillageDebugOverlay(grid);villageDebugGrid=grid;}
   updateVillageDebugStatus();
  }
  function refreshDebugViews(){refreshNavigationOverlay();refreshVillageDebugOverlay();}
  $('showNavigation').addEventListener('change',refreshDebugViews);
  $('showVillageDebug').addEventListener('change',refreshDebugViews);
  window.addEventListener('keydown',event=>{
   if(event.key!=='F6'||event.repeat||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||window.PraetoriansMenu?.isOpen())return;
   event.preventDefault();
   if(event.shiftKey){showXrayTerrain=!showXrayTerrain;}
   else $('showVillageDebug').checked=!$('showVillageDebug').checked;
   refreshDebugViews();
  });
  $('copyVillageDebug').addEventListener('click',()=>{
   const report=$('villageDebugInfo').textContent;
   if(navigator.clipboard?.writeText)navigator.clipboard.writeText(report).then(()=>toast('Debug report copied.'),()=>console.info('Village debug report:\n'+report));
   else{console.info('Village debug report:\n'+report);toast('Debug report printed in browser console (F12).');}
  });
  function makeMesh(name, data, material, updatable=false) {
   const mesh = new B.Mesh(name, scene), vd = new B.VertexData();
   vd.positions = data.positions; vd.indices = data.indices; vd.uvs = data.uvs;
   if(data.uvs2)vd.uvs2=data.uvs2;
   vd.normals = data.normals || [];
   if (!vd.normals.length) B.VertexData.ComputeNormals(vd.positions,vd.indices,vd.normals);
   if (data.colors) vd.colors=data.colors;
   vd.applyToMesh(mesh,updatable); mesh.material=material;
   return mesh;
  }
  function texture(path, alpha=false, repeat=false) {
   const tx = new B.Texture(path, scene, false, false, B.Texture.TRILINEAR_SAMPLINGMODE);
   tx.hasAlpha=alpha;
   tx.wrapU=tx.wrapV=repeat?B.Texture.WRAP_ADDRESSMODE:B.Texture.CLAMP_ADDRESSMODE;
   tx.anisotropicFilteringLevel=8;
   return tx;
  }
  function unlit(name, path, alpha=false) {
   const mat = new B.PBRMaterial(name,scene);
   mat.unlit=true; mat.backFaceCulling=false; mat.metallic=0; mat.roughness=1;
   if(path)mat.albedoTexture=texture(path,alpha);
   if(alpha){mat.useAlphaFromAlbedoTexture=true; mat.transparencyMode=B.Material.MATERIAL_ALPHABLEND;}
   return mat;
  }
  const terrainResponse=await fetch(hdTerrain.binary);
  if(!terrainResponse.ok)throw new Error('HD terrain buffer is missing. Run start_viewer.bat --rebuild-hd.');
  const terrainBuffer=await terrainResponse.arrayBuffer(),groundData={};
  // Format 2 (tools/export_hd_maps.py): indexed, uint16 UVs and uint8 colours
  // normalised to [0,1].
  for(const [name,layout] of Object.entries(hdTerrain.layout)){
   const Type={uint32:Uint32Array,float32:Float32Array,uint16:Uint16Array,uint8:Uint8Array}[layout.type];
   let values=new Type(terrainBuffer,layout.byteOffset,layout.length);
   if(layout.normalized){
    const scale=layout.type==='uint16'?65535:255,floats=new Float32Array(values.length);
    for(let i=0;i<values.length;i++)floats[i]=values[i]/scale;
    values=floats;
   }
   groundData[name]=values;
  }
  // Many cliffs are low-relief in the height field and only read as cliffs
  // through the atlas's painted rock layer; measure that layer for A*.
  async function atlasPixels(path,uvs){
   const image=new Image();image.src=path;await image.decode();
   let maxV=0;for(const list of uvs)for(let i=1;i<list.length;i+=2)maxV=Math.max(maxV,list[i]);
   const rows=Math.min(image.naturalHeight,Math.ceil(maxV*image.naturalHeight)+1),canvas=document.createElement('canvas');
   canvas.width=image.naturalWidth;canvas.height=rows;
   const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
   return {pixels:context.getImageData(0,0,canvas.width,rows).data,width:canvas.width,height:rows,textureWidth:image.naturalWidth,textureHeight:image.naturalHeight};
  }
  // Passability is the original game's: the map's logical map (MLG) read
  // with each unit's own TERRENO / FLAGSNOPASABLES (navigation/logical-map.js).
  // Painted-rock cliffs are only guessed for a map without one.
  const Logical=window.PraetoriansLogicalMap;
  const logicalValues=map.logical?.length===W*D?Uint32Array.from(map.logical):null;
  let rockCoverage=null;
  if(!logicalValues)try{
   rockCoverage=window.PraetoriansTerrainSurface.rockCoverage(groundData,await atlasPixels(hdTerrain.texture,[groundData.uvs,groundData.uvs2]),{width:W,depth:D,step:map.terrain.spacing||.5});
  }catch(error){console.warn('Painted cliff detection unavailable; using slope only.',error);}
  // Bridges and the fortress share the navigation grid. A gate's opening is
  // ground only for the side it lets through, so each set of open gates has
  // its own grid (navFor): usually two, the holders' and everyone else's.
  // Structures in play (src/world/buildings.js): garrisons, watchtowers,
  // tents and the like stand in the way; building sites rise into them.
  // Siege machines' building sites (tools/export_hd_machine_sites.py): their
  // construction stages, which stand in the way while they are built.
  const [gameStats,unitTypes,machineSites,formationData]=await Promise.all([loadJSON('data/game/units.json'),
   loadJSON('assets/hd/units/combat/types.json').catch(()=>({types:{}})),
   loadJSON('assets/hd/machine-sites.json').catch(()=>({machines:{}})),loadJSON('data/game/special-formations.json')]);
  const formations=window.PraetoriansSpecialFormations.create({units:gameStats,data:formationData});
  I18n.registerLabels({'Cette troupe ne possède pas cette formation.':{en:'This unit does not have that formation.'},'Sortez du bâtiment avant de changer de formation.':{en:'Leave the building before changing formation.'},'La troupe change déjà de formation.':{en:'This unit is already changing formation.'},'Cette formation ne peut pas contenir autant de soldats.':{en:'Too many soldiers for this formation.'},'Pas assez de place pour cette formation.':{en:'There is not enough space for this formation.'},'Cette formation nécessite un terrain ouvert.':{en:'This formation requires open ground.'}});
  const buildingHooks={};
  const buildings=window.PraetoriansBuildings.create({defs:buildingData.structures,units:gameStats,races,placements,hooks:buildingHooks,machineSites:machineSites.machines,
   world:{civ:name=>civByName.get(lower(name))||null,allied:(a,b)=>allied(a,b),isHostile:(a,b)=>civHostile(a,b),groundY,clock:()=>missionClock,buildRate:squad=>aiRateFor(squad.civ,'buildRate'),
    constructionBlocked:e=>allSquads.some(s=>s.members.length&&!s.hidden&&combat.isFormationLocked(s)&&s.members.some(m=>buildings.covers(e,m.x,m.z,.2)))}});
  const navStructures={classify:(x,z)=>structures.classify(x,z)||fortress?.classify(x,z)||buildings.classify(x,z)||null};
  // One grid per passability profile: infantry, troops kept out of dense
  // forest (pikemen, cavalry), out of shallow water (heavy infantry), and
  // siege machines (off hills, forests and shallows too).
  const defaultRules=Logical.rules(null),ruleSets=new Map([[defaultRules.key,defaultRules]]),rulesByType=new Map();
  function rulesFor(type){
   // Unit definitions are fixed for a match. Per-soldier movement queries
   // reuse their profile instead of allocating a Set and closures each time.
   if(rulesByType.has(type))return rulesByType.get(type);
   const rules=Logical.rules(gameStats[type]);
   if(!ruleSets.has(rules.key))ruleSets.set(rules.key,rules);
   const shared=ruleSets.get(rules.key);rulesByType.set(type,shared);return shared;
  }
  function buildNav(gateOpen,rules=defaultRules){
   // MLG flags remain authoritative, but they are not a complete geometric
   // collision mesh: also reject steep PVE transitions, even on MLG maps.
   // In particular, the previous 1.6 / 0.8 limits permitted ~58 degree
   // terrain crossings which could put soldiers on cliff faces.
   // Let infantry walk up genuinely gradual hills, even if old MLG slope
   // paint labels the cell forbidden. Machines still obey their original
   // restrictions; all classes respect sheer drops, solid scenery and water.
   const hillMarch=!!logicalValues&&!rules.types.has(Logical.TYPE.BLOQUEADO)&&
    !(rules.mask&Logical.FLAG.FLAG_BLOQUEADO_MAQUINAS);
   const slopeLimits=hillMarch?
    {maxGrade:.88,maxStep:.48,maxCrossGrade:.76,maxCrossStep:.38}:
    {maxGrade:.68,maxStep:.38,maxCrossGrade:.48,maxCrossStep:.24};
   const terrainRules=logicalValues
    ?{...slopeLimits,allowGentleHills:hillMarch,logical:{values:logicalValues,width:W,depth:D,rules}}
    :{...slopeLimits,rockCoverage};
   const built=window.PraetoriansNavigation.create(map,{...terrainRules,structures:navStructures,gateOpen});
   if(fortress)built.walkway=(x,z)=>fortress.walkwayAt(x,z);
   return built;
  }
  // Open: broken, held by nobody, or held by this civilization or an ally.
  const gateOpenFor=(gate,civ)=>gate.broken||!gate.holder||(civ!=null&&(civ===gate.holder||allied(civ,gate.holder)));
  let nav=buildNav(gate=>gateOpenFor(gate,null));
  // The fortress's true inside (walls and shut gates enclose it), and its
  // garrison counted again with it.
  if(fortress?.setInterior(nav)&&initialHolders())nav=buildNav(gate=>gateOpenFor(gate,null));
  const navCache=new Map();
  // The grid for a civilization (its gates) and a unit's profile.
  function navFor(civ,rules=defaultRules){
   const sameGates=!fortress?.gates.length||civ==null||fortress.gates.every(g=>gateOpenFor(g,civ)===gateOpenFor(g,null));
   if(sameGates&&rules.key===defaultRules.key)return nav;
   const gates=sameGates?'base':fortress.gates.map(g=>gateOpenFor(g,civ)?1:0).join(''),key=rules.key+'#'+gates;
   let built=navCache.get(key);
   if(!built){built=buildNav(sameGates?g=>gateOpenFor(g,null):g=>gateOpenFor(g,civ),rules);navCache.set(key,built);}
   return built;
  }
  const navOf=s=>navFor(s?.civ,s?.type?rulesFor(s.type):defaultRules);
  $('navigationInfo').textContent=logicalValues
   ?`A* · ${nav.statistics.cells.toLocaleString()} half-cell samples · logical map: ${nav.statistics.logicalBlocked.toLocaleString()} blocked, ${nav.statistics.water.toLocaleString()} deep water, ${(nav.statistics.ford||0).toLocaleString()} shallow · ${nav.statistics.steep.toLocaleString()} sheer · ${(nav.statistics.deck||0).toLocaleString()} bridge deck samples`
   :`A* · ${nav.statistics.cells.toLocaleString()} half-cell samples · ${nav.statistics.steep.toLocaleString()} steep (${nav.statistics.paintedCliff.toLocaleString()} painted cliff) · ${nav.statistics.water.toLocaleString()} water samples blocked · ${(nav.statistics.ford||0).toLocaleString()} ford samples wadeable · ${(nav.statistics.deck||0).toLocaleString()} bridge deck samples`;
  // The remaster's terrain uses two UV layers in its 4096px texture atlas.
  // Vertex alpha blends the layers; vertex RGB is the authored baked light.
  B.Effect.ShadersStore.hdTerrainVertexShader=`
   precision highp float;
   attribute vec3 position;
   attribute vec2 uv,uv2;
   attribute vec4 color;
   uniform mat4 worldViewProjection;
   varying vec2 vUV0,vUV1;
   varying vec4 vColor;
   varying float vHeight;
   void main(void){
    gl_Position=worldViewProjection*vec4(position,1.0);
    vUV0=uv;vUV1=uv2;vColor=color;vHeight=position.y;
   }`;
  B.Effect.ShadersStore.hdTerrainFragmentShader=`
   precision highp float;
   uniform sampler2D atlas;
   uniform float heightMode;
   varying vec2 vUV0,vUV1;
   varying vec4 vColor;
   varying float vHeight;
   void main(void){
    vec3 a=texture2D(atlas,vUV0).rgb,b=texture2D(atlas,vUV1).rgb;
    vec3 ground=mix(a,b,vColor.a)*vColor.rgb;
    vec3 heightColor=mix(vec3(.22,.34,.12),vec3(.77,.83,.61),clamp((vHeight+.46)/3.46,0.0,1.0));
    gl_FragColor=vec4(mix(ground,heightColor,heightMode),1.0);
   }`;
  const groundMat=new B.ShaderMaterial('HD Remaster terrain atlas',scene,
   {vertex:'hdTerrain',fragment:'hdTerrain'},
   {attributes:['position','uv','uv2','color'],uniforms:['worldViewProjection','heightMode'],samplers:['atlas']});
  groundMat.backFaceCulling=false;
  // The cropped atlas (format 2) must not wrap its last row onto its first.
  const terrainAtlas=texture(hdTerrain.texture,false,(hdTerrain.format||1)<2);
  groundMat.setTexture('atlas',terrainAtlas);
  groundMat.setFloat('heightMode',0);
  const ground=makeMesh(`HD ${map.title} cooked terrain`,groundData,groundMat);
  ground.useVertexColors=true;ground.hasVertexAlpha=false;
  const referenceMat=unlit('HD minimap diagnostic',mapBase+'minimap.png');
  $('materialMode').addEventListener('change',()=>{
   ground.material=({pte:groundMat,height:groundMat,reference:referenceMat})[$('materialMode').value];
   groundMat.setFloat('heightMode',$('materialMode').value==='height'?1:0);
   ground.material.wireframe=$('wireframe').checked;
  });
  $('wireframe').addEventListener('change',()=>ground.material.wireframe=$('wireframe').checked);

  const materialCache=new Map(), modelMeshes=[], bakedShadows=[];
  function modelMaterial(group, prefix='assets/hd/environment/textures/', info=models.textureInfo) {
   const name=(group.texture||'').toLowerCase();
   const shadow=!!group.isShadow;
   const key=prefix+name+'|'+group.flags+'|'+shadow;
   if(materialCache.has(key))return materialCache.get(key);
   let mat;
   if(shadow){
    mat=unlit(name,prefix+encodeURIComponent(name)+'.png',true);
    mat.alpha=1;mat.zOffset=-1;
   }else if(name.startsWith('de_ruina')||name==='de_pared_bmp'){
    mat=unlit(name,prefix+encodeURIComponent(name)+'.png');
   }else{
    mat=new B.StandardMaterial(name,scene);
    mat.diffuseColor=B.Color3.White();mat.specularColor=B.Color3.Black();
    mat.ambientColor=B.Color3.White();mat.emissiveColor=new B.Color3(.045,.055,.025);
    mat.backFaceCulling=false;mat.twoSidedLighting=true;
    if(name){
     const alpha=info?.[name]?.hasAlpha ?? (group.flags===1);
     mat.diffuseTexture=texture(prefix+encodeURIComponent(name)+'.png',alpha,true);
     if(alpha){mat.useAlphaFromDiffuseTexture=true;mat.transparencyMode=B.Material.MATERIAL_ALPHATEST;mat.alphaCutOff=.3;}
    }
   }
   materialCache.set(key,mat);return mat;
  }
  function instanceMatrices(records) {
   const matrices=new Float32Array(records.length*16),mat=B.Matrix.Identity();
   for(let i=0;i<records.length;i++){
    const o=records[i],s=o.scale||1;
    B.Matrix.ComposeToRef(new B.Vector3(s,s,s),B.Quaternion.FromEulerAngles(0,o.r||0,0),new B.Vector3(o.x,o.y,o.z),mat);
    matrices.set(mat.m,i*16);
   }
   return matrices;
  }
  // Shared model/action batches are rebuilt once after the fixed simulation.
  function refreshSquadInstances(squad){squad.dirty=true;}
  function setInstances(mesh, records, dynamic=false) {
   mesh.thinInstanceSetBuffer('matrix',instanceMatrices(records),16,!dynamic);
   mesh.thinInstanceRefreshBoundingInfo(true);mesh.isPickable=false;
  }
  const byName={};
  for(const object of map.objects)(byName[object.n.toLowerCase()]||=[]).push(object);
  let modelCount=0,objectCount=0;
  for(const [name,records] of Object.entries(byName)){
   const model=models.models[name];if(!model)continue;
   for(const [index,group] of model.groups.entries()){
    const mesh=makeMesh(name+' / '+index,group,modelMaterial(group));
    mesh.useVertexColors=!!group.colors;mesh.hasVertexAlpha=!!group.isShadow;
    setInstances(mesh,records);modelMeshes.push(mesh);
    if(group.isShadow)bakedShadows.push(mesh);
   }
   modelCount++;objectCount+=records.length;
  }
  // Mission structures (ESTRUCTURA): villages are many buildings placed
  // around the village centre (DefPueblos), the others one visual. Parts
  // turn with the structure: world = (x*c + z*s, -x*s + z*c).
  // A part can change model (a gate breaking, a building rising); each model
  // keeps one batch of instances.
  let shadowReceiver=null,shadowGenerator=null;
  const partRecords=new Map(),structureParts=[],partMeshes=new Map();
  const structureKnowledge=window.PraetoriansStructureKnowledge.create();
  const structureEntities=new Map(buildings.entities.map(e=>[e.placement||e,e]));
  const structureGates=new Map((fortress?.gates||[]).map(g=>[g.placement,g]));
  let structureVisionReady=false,batchingParts=false;
  const dirtyPartModels=new Set();
  function friendlyOwner(owner){return !!owner&&!neutralCiv(owner)&&(owner===humanCiv||allied(owner,humanCiv));}
  function structureObserved(e){return !!e&&structureVisionReady&&(friendlyOwner(e.owner)||vision.seen(e.x,e.z));}
  function visibleStructureAt(x,z,reach=.6){const e=buildings.at(x,z,reach);return structureObserved(e)?e:null;}
  function showParts(name){
   const model=models.models[name];if(!model)return;
   const records=partRecords.get(name)||[];
   let meshes=partMeshes.get(name);
   if(!meshes){
    if(!records.length)return;
    meshes=model.groups.map((group,index)=>{
     const mesh=makeMesh('structure '+name+' / '+index,group,modelMaterial(group));
     mesh.useVertexColors=!!group.colors;modelMeshes.push(mesh);shadowGenerator?.addShadowCaster(mesh);return mesh;
    });
    partMeshes.set(name,meshes);modelCount++;
   }
   for(const mesh of meshes){if(records.length)setInstances(mesh,records);mesh.setEnabled(records.length>0&&!$('hideObjects').checked);}
  }
  function applyPartModel(record,name){
   const old=record.model;if(old===name)return;
   const list=partRecords.get(old),i=list?list.indexOf(record):-1;if(i>=0)list.splice(i,1);
   record.model=name;if(!partRecords.has(name))partRecords.set(name,[]);partRecords.get(name).push(record);
   dirtyPartModels.add(old);dirtyPartModels.add(name);
   if(!batchingParts)flushPartModels();
  }
  function flushPartModels(){
   if(!dirtyPartModels.size)return;
   for(const name of dirtyPartModels)showParts(name);
   dirtyPartModels.clear();shadowGenerator?.getShadowMap()?.resetRefreshCounter();
  }
  function refreshPartVisibility(record){
   const placement=record.placement,entity=structureEntities.get(placement),gate=structureGates.get(placement);
   const publicLandmark=['PUEBLO','BARRACON'].includes(buildingData.structures[placement.type]?.kind);
   const point=gate?.centre||entity||placement;
   const owner=entity?entity.owner:gate?gate.holder:placement.owner;
   const friendly=structureVisionReady&&friendlyOwner(owner);
   const visible=structureVisionReady&&vision.seen(point.x,point.z);
   const known=publicLandmark?null:structureKnowledge.observe(humanCiv,record,{visible,friendly,model:record.desiredModel});
   const name=(publicLandmark?record.desiredModel:known?.model)||'';
   const changed=record.observedModel!==name;record.observedModel=name;
   if(name&&!models.models[name]){
    // A late asset load must not put a newly hidden or obsolete stage back.
    if(changed)ensureModel(name).then(()=>{if(record.observedModel===name&&models.models[name])applyPartModel(record,name);});
   }else applyPartModel(record,name);
  }
  function setPartModel(record,name){
   record.desiredModel=name||'';refreshPartVisibility(record);
  }
  function addParts(placement,model=null){
   const parts=buildingData.structures[placement.type]?.parts||[],made=[];
   const c=Math.cos(placement.r),s=Math.sin(placement.r);
   for(const part of parts){
    const x=placement.x+part.x*c+part.z*s,z=placement.z-part.x*s+part.z*c;
    const desiredModel=model||part.model,publicLandmark=['PUEBLO','BARRACON'].includes(buildingData.structures[placement.type]?.kind);
    const record={x,z,y:parts.length>1?groundY(x,z):placement.y,r:placement.r+(part.r||0),placement,part,desiredModel,model:publicLandmark?desiredModel:''};
    if(!partRecords.has(record.model))partRecords.set(record.model,[]);
    partRecords.get(record.model).push(record);structureParts.push(record);made.push(record);
   }
   return made;
  }
  for(const placement of placements){addParts(placement);objectCount++;}
  for(const name of partRecords.keys())showParts(name);
  // A structure's model: its mission parts, or (a building site) a part of
  // its own. Models not yet loaded arrive on demand.
  const loadingModels=new Map();
  function ensureModel(name){
   if(!name||models.models[name]||!objectIndex.models[name])return Promise.resolve();
   if(!loadingModels.has(name))loadingModels.set(name,loadJSON('assets/hd/objects/'+objectIndex.models[name].file).then(m=>{models.models[name]=m;}).catch(error=>console.warn(error)));
   return loadingModels.get(name);
  }
  function showStructure(e,model){
   structureEntities.set(e.placement||e,e);
   let records=structureParts.filter(r=>r.placement===(e.placement||e));
   if(!records.length){
    if(!model)return;
    const record={x:e.x,z:e.z,y:e.placement?.y??groundY(e.x,e.z),r:e.r,placement:e.placement||e,part:{model},model:'',desiredModel:''};
    partRecords.set('',[...(partRecords.get('')||[]),record]);structureParts.push(record);records=[record];
   }
   for(const record of records)setPartModel(record,model||'');
  }
  $('objectCount').textContent=objectCount.toLocaleString();$('nameCount').textContent=modelCount;
  $('modelSummary').textContent=`HD Remaster · ${modelCount} Unreal model variants · ${objectCount.toLocaleString()} placements · 4096² terrain atlas. Source: Content/Paks.`;
  // Tall grass and wheat (PRADERA cells) in the mission's climate (TIPO_TERRENO).
  const meadowData=await loadJSON('assets/hd/environment/meadows/meadows.json').catch(()=>null);
  const meadows=window.PraetoriansMeadows.create({B,scene,data:meadowData,logical:map.logical,width:W,depth:D,groundY,
   // The flames are the burning-buildings renderer, made further on.
   fire:{set:(...args)=>burning.set(...args)},
   climate:meadowData?.terrainConfig?.[missionData.scene?.terrainConfig]||'EUROPA'});
  function refreshObjects(){
   modelMeshes.forEach(m=>m.setEnabled(!$('hideObjects').checked&&(!bakedShadows.includes(m)||$('shadows').checked)));
   meadows.setEnabled(!$('hideObjects').checked);
   // Cached meshes for old construction/damage states keep their instance
   // buffers. A display change must not bring those obsolete states back.
   for(const [name,meshes] of partMeshes){const active=(partRecords.get(name)?.length||0)>0;for(const mesh of meshes)mesh.setEnabled(active&&!$('hideObjects').checked);}
   if(shadowReceiver)shadowReceiver.setEnabled($('shadows').checked);
   if(shadowGenerator)shadowGenerator.getShadowMap().resetRefreshCounter();
  }
  $('hideObjects').addEventListener('change',refreshObjects);
  $('shadows').addEventListener('change',refreshObjects);
  $('fullbright').addEventListener('change',()=>{
   for(const mat of materialCache.values())if(mat instanceof B.StandardMaterial){
    mat.disableLighting=$('fullbright').checked;
    mat.emissiveColor=$('fullbright').checked?B.Color3.White():new B.Color3(.045,.055,.025);
   }
  });

  // H2O supplies water shape and shoreline alpha, never its legacy textures.
  // Keep the existing custom shader; the inexpensive mode is texture-free.
  const waterMeshes=[];
  if(map.water?.groups?.length){
   const Water=window.PraetoriansWater,realistic={},simple={};
   if(!Water)throw new Error('Custom water renderer is unavailable');
   const waterGroups=Water.blendOverlaps(map.water.groups);
   for(const [index,group] of waterGroups.entries()){
    const kind=Water.classify(group);
    realistic[kind]??=Water.create(B,scene,'realistic '+kind,kind);
    simple[kind]??=Water.createSimple(B,scene,'simple '+kind,kind);
    const water=makeMesh('H2O river surface '+index,group,realistic[kind]);
    water.useVertexColors=true;water.hasVertexAlpha=true;water.isPickable=false;waterMeshes.push(water);
    water.setVerticesData('flow',Water.flowField(group),false,2);
    water.metadata={simple:simple[kind],realistic:realistic[kind]};
   }
   const realisticToggle=$('realisticWater');
   realisticToggle?.addEventListener('change',()=>{
    for(const water of waterMeshes)if(water.metadata)water.material=realisticToggle.checked?water.metadata.realistic:water.metadata.simple;
   });
   if(realisticToggle&&!realisticToggle.checked)realisticToggle.dispatchEvent(new Event('change'));
   waterMeshes.realistic=Object.values(realistic);
  }
  const zoneMeshes=[];
  for(const zone of map.mission.zones){
   const points=[];
   if(zone.kind==='CIRCULAR'){
    for(let i=0;i<=64;i++){const a=i*Math.PI/32,x=zone.center[0]+Math.cos(a)*zone.radius,z=zone.center[1]+Math.sin(a)*zone.radius;points.push(new B.Vector3(x,groundY(x,z)+.08,z));}
   }else for(const [x,z] of [...zone.vertices,zone.vertices[0]])points.push(new B.Vector3(x,groundY(x,z)+.08,z));
   const mesh=B.MeshBuilder.CreateLines(zone.name,{points},scene);mesh.color=new B.Color3(.95,.78,.25);mesh.isPickable=false;mesh.setEnabled(false);zoneMeshes.push(mesh);
  }
  $('showZones').addEventListener('change',()=>zoneMeshes.forEach(m=>m.setEnabled($('showZones').checked)));

  $('loadingText').textContent='Restoring the starting formations…';
  const Models=window.PraetoriansUnitModels,Combat=window.PraetoriansCombat;
  // Unit type -> HD model (tools/export_hd_army.py), hand-checked soldiers first.
  const kindFor=type=>Models.MODEL_FOR_TYPE[type]||unitTypes.types?.[type];
  // ---- Civilizations ---------------------------------------------------------
  // The human civilization is the player's; NEUTRAL ones never fight; the
  // others are enemies unless an alliance joins them (CrearAlianzaPorNombre).
  const civs=new Map(missionData.civilizations.map(c=>[c.name,c]));
  const alliances=new Set();
  if(missionData.kind==='skirmish')for(const [a,b] of window.PraetoriansSkirmishSetup.alliancePairs(missionData.civilizations)){
   alliances.add(a+'|'+b);alliances.add(b+'|'+a);
  }
  const allied=(a,b)=>a===b||alliances.has(a+'|'+b)||alliances.has(b+'|'+a);
  const neutralCiv=name=>!!civs.get(name)?.neutral||(isTutorial1&&name==='SCOUT');
  function sideOfCiv(name){
   if(name===humanCiv)return 'player';
   if(neutralCiv(name))return 'neutral';
   return allied(humanCiv,name)?'ally':'enemy';
  }
  const civHostile=(a,b)=>a!==b&&!allied(a,b)&&!neutralCiv(a)&&!neutralCiv(b);
  const troopsWithModels=map.mission.troops.filter(t=>kindFor(t.type));
  const unitTitles={INFANTERIA_LIGERA:'Auxiliary infantry',PIQUERO:'Spearmen',ARQUERO:'Archers',GALO_LIGERA:'Gallic warriors',GALO_ARQUERO:'Gallic archers',HEROE_AGRADO:text('LTEXT_UNIDAD_AGRADO')};
  const Critters=window.PraetoriansCritters;
  const wildlifeKinds=map.mission.animals.map(a=>Critters.KINDS[a.type]?.model).filter(Boolean);
  // Models for every troop a mission can field later: what its races train
  // at villages, and what its script creates (CrearTropa).
  const laterTypes=new Set();
  for(const civ of missionData.civilizations)if(!civ.neutral)for(const type of races[civ.race]?.trains||[])laterTypes.add(type);
  for(const m of (scriptSource||'').matchAll(/CrearTropa\s*\(\s*"[^"]*"\s*,\s*"([^"]+)"/g))laterTypes.add(m[1]);
  // Siege machines its races can build.
  for(const civ of missionData.civilizations)if(!civ.neutral)for(const [type,unit] of Object.entries(gameStats))if(unit.race===civ.race&&unit.construction)laterTypes.add(type);
  // Centurions promoted from auxiliaries (Promouvoir), troops demoted (Dégrader).
  for(const civ of missionData.civilizations)if(!civ.neutral)for(const type of [races[civ.race]?.centurion,races[civ.race]?.demotion])if(type)laterTypes.add(type);
  // The wolf is its scout's familiar, exported as a separate animated mesh.
  // Load it with the scout both at mission startup and during recruitment.
  const withFamiliars=types=>types.includes('EXPLORADOR_LOBO')?[...new Set([...types,'LOBO_SCOUT'])]:types;
  const neededKinds=new Set(withFamiliars([...troopsWithModels.map(t=>t.type),...laterTypes]).map(kindFor).filter(Boolean).concat(wildlifeKinds,'hawk'));
  const loadedModels=await Promise.all([...neededKinds].map(kind=>Models.load(kind).catch(error=>{console.warn(error);return null;})));
  const unitModels=Object.fromEntries(loadedModels.filter(Boolean).map(model=>[model.kind,model]));
  // The game's own names for the troops (DefUnidades NOMBRE), as the lesson
  // texts call them: "Infanterie auxiliaire", "Lanciers"...
  for(const [type,unit] of Object.entries(gameStats))if(unit.name&&textIndex.has(unit.name.toLowerCase()))unitTitles[type]=text(unit.name);
  // Units are drawn after the landscape (rendering group 2). Their silhouettes
  // (group 1) pass the depth test only where trees or hills hide them, so a
  // squad in a forest still shows as a tinted outline.
  scene.setRenderingAutoClearDepthStencil(1,false,false,false);
  scene.setRenderingAutoClearDepthStencil(2,false,false,false);
  // ---- Player colours (tools/export_hd_team_colours.py) -----------------------
  // The game dyes a troop's cloth in its civilization's colour (mission
  // COLOR 0-7: red, green, orange, blue, purple, yellow, brown, grey) with
  // eight versions of each texture. A colour's version is the base texture
  // with that colour's patch of dyed pixels drawn over it; until both images
  // have loaded the troop shows the base texture.
  const UNIT_TEXTURES='assets/hd/units/textures/';
  const teamColours=await loadJSON(UNIT_TEXTURES+'team-colours.json').catch(()=>({textures:{}}));
  const teamMaterials=new Map();
  const loadImage=src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Missing '+src));image.src=src;});
  function unitMaterial(group,colour=0){
   const base=modelMaterial(group,UNIT_TEXTURES,unitAssets.textureInfo),name=(group.texture||'').toLowerCase();
   if(!colour||!teamColours.textures?.[name]?.includes(colour)||!base.diffuseTexture)return base;
   const key=name+'|'+colour;
   if(teamMaterials.has(key))return teamMaterials.get(key);
   const material=base.clone(`${base.name} · couleur ${colour}`);teamMaterials.set(key,material);
   Promise.all([loadImage(UNIT_TEXTURES+encodeURIComponent(name)+'.png'),loadImage(`${UNIT_TEXTURES}team/${encodeURIComponent(name)}_${colour}.webp`)]).then(([image,patch])=>{
    const w=image.naturalWidth,h=image.naturalHeight;
    const dyed=new B.DynamicTexture(`troop colour ${key}`,{width:w,height:h},scene,true,B.Texture.TRILINEAR_SAMPLINGMODE);
    const context=dyed.getContext();context.drawImage(image,0,0);context.drawImage(patch,0,0,w,h);
    // Unflipped, as the unit textures load (texture(): invertY false).
    dyed.update(false);
    dyed.hasAlpha=base.diffuseTexture.hasAlpha;dyed.wrapU=dyed.wrapV=B.Texture.WRAP_ADDRESSMODE;
    dyed.anisotropicFilteringLevel=base.diffuseTexture.anisotropicFilteringLevel||8;
    const old=material.diffuseTexture;material.diffuseTexture=dyed;if(old&&old!==base.diffuseTexture)old.dispose();
   }).catch(error=>console.warn('Troop colour unavailable',key,error));
   return material;
  }
  // A civilization's colour number (mission COLOR; 0, red, by default).
  function colourIndex(civ){const i=Number(civs.get(civ)?.color);return Number.isInteger(i)&&i>=0&&i<8?i:0;}
  let companions=null;
  function renderSelection(){
   const chosen=coverHighlights.size?[...selectedSquads,...coverHighlights]:selectedSquads;
   return companions?.list.length?[...chosen,...companions.list.filter(c=>chosen.includes(c.owner))]:chosen;
  }
  const unitRenderer=window.PraetoriansUnitBatches.create({B,scene,camera,materialForGroup:unitMaterial,
   getSelected:renderSelection,silhouettes:()=>$('silhouettes')?.checked!==false,shadows:()=>$('shadows').checked});
  // How far apart a troop's men stand. Horses, camels and chariots (models
  // of a rider and his mount) keep their own footprint - the HD model at
  // rest - plus a hand's breadth, as the original's cavalry formations
  // (Equites AMPLITUD 0.7 x 1.8); the special troops that cost honour points
  // stand a tenth looser still (a foot soldier's depth counted to .7 m at
  // most: a weapon held long must not open the ranks). Everyone else keeps
  // the regular .47 m grid.
  const SPACING_GAP=.12,SPECIAL_SPACING=1.1,FOOT_DEPTH=.7,spacingCache=new Map();
  function spacingOf(type,model){
   if(spacingCache.has(type))return spacingCache.get(type);
   const p=model?.animations?.rest?.frames?.[0]?.positions,special=(gameStats[type]?.training?.honour||0)>0;
   let spacing=null;
   if(p){
    let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
    for(let i=0;i<p.length;i+=3){x0=Math.min(x0,p[i]);x1=Math.max(x1,p[i]);z0=Math.min(z0,p[i+2]);z1=Math.max(z1,p[i+2]);}
    const mounted=(model.groups?.length||1)>1,k=special?SPECIAL_SPACING:1,depth=mounted?z1-z0:Math.min(FOOT_DEPTH,z1-z0);
    if(special||mounted)spacing={x:Math.max(.47,x1-x0+SPACING_GAP)*k,z:Math.max(.47,depth+SPACING_GAP)*k};
   }
   spacingCache.set(type,spacing);return spacing;
  }
  function spawnSquad(troop,index,side){
   const kind=kindFor(troop.type),model=unitModels[kind];if(!model)return null;
   const squad={...troop,index,side,civ:troop.civilization,kind,model,x:troop.position[0],z:troop.position[2],r:troop.orientation,meshes:[],members:[],destination:null,visible:side!=='enemy'};
   squad.spacing=spacingOf(troop.type,model);squad.colour=colourIndex(squad.civ);
   const initialFormation=formations.get(troop.type,troop.formation);
   if(initialFormation?.mode!=='standard'&&initialFormation&&troop.units>=initialFormation.minimum){
    formations.apply(squad,initialFormation.id);
    squad.formationShape=count=>formations.slots(squad.type,initialFormation.id,count,{spacing:squad.spacing});
   }
   motion.setup(squad,groundY);
   unitRenderer.register(squad);
   return squad;
  }
  function addRing(squad){
   const ring=B.MeshBuilder.CreateTorus('selection '+squad.name,{diameter:2.7,thickness:.035,tessellation:48},scene);
   ring.scaling.z=.78;ring.position.set(squad.x,groundY(squad.x,squad.z)+.055,squad.z);
   const ringMat=unlit('selection green');ringMat.albedoColor=new B.Color3(.37,.79,.17);ring.material=ringMat;ring.isPickable=false;ring.setEnabled(false);squad.ring=ring;
  }
  // squads: the player's; enemySquads: hostile; otherSquads: allies, neutrals.
  const squads=[],enemySquads=[],otherSquads=[];
  for(const troop of troopsWithModels){
   const side=sideOfCiv(troop.civilization);
   const list=side==='player'?squads:side==='enemy'?enemySquads:otherSquads;
   const squad=spawnSquad(troop,side==='player'?squads.length:100+enemySquads.length+otherSquads.length,side);if(!squad)continue;
   if(side==='player')addRing(squad);
   list.push(squad);
  }
  // Skirmish: the original creates every pack troop on its start position
  // (POS_INICIAL) and then gives them room as for a group order to that
  // point (Praetorians.exe 0x43fc60): in pack order - the centurion first -
  // each troop takes the nearest ground where its whole formation stands
  // clear of those already there, the side facing the map centre first.
  {
   const placed=[];
   for(const s of [...squads,...enemySquads,...otherSquads]){
    if(!s.skirmishStart)continue;
    const start={x:s.x,z:s.z},grid=navOf(s),ahead=Math.atan2(Math.sin(s.r),Math.cos(s.r));
    let spot=null;
    search:for(let ring=0;ring<=16;ring+=.5){
     const n=ring?Math.max(8,Math.round(ring*2*Math.PI/.75)):1;
     for(let k=0;k<n;k++){
      // Round from straight ahead, alternately left and right.
      const a=Math.PI/2-ahead+(k%2?1:-1)*Math.ceil(k/2)*2*Math.PI/n;
      const px=start.x+Math.cos(a)*ring,pz=start.z+Math.sin(a)*ring;
      if(placed.some(o=>Math.hypot(o.x-px,o.z-pz)<o.radius+s.radius+.8))continue;
      if(motion.poseSafe(s,px,pz,s.r,grid)){spot={x:px,z:pz};break search;}
     }
    }
    if(spot){s.x=spot.x;s.z=spot.z;motion.occupy(s,groundY);}
    placed.push(s);
   }
  }
  // Troops placed on blocked ground (inside a building's outline) step aside.
  for(const s of [...squads,...enemySquads,...otherSquads]){
   const grid=navOf(s);if(grid.canStand(s.x,s.z,.3)||fortress?.onTop(s.x,s.z))continue;
   search:for(let r=.5;r<=6;r+=.5)for(let a=0;a<16;a++){const x=s.x+Math.cos(a*Math.PI/8)*r,z=s.z+Math.sin(a*Math.PI/8)*r;if(grid.canStand(x,z,.6)){motion.arrange(s,grid,groundY,{x,z});break search;}}
  }
  // Troops a mission puts on a fortress wall stand on its walkway, in files.
  if(fortress)for(const s of [...squads,...enemySquads,...otherSquads]){
   if(!fortress.onTop(s.x,s.z))continue;
   const at=fortress.isWalkway(s.x,s.z)?{x:s.x,z:s.z}:fortress.walkwayNear(s.x,s.z);if(!at)continue;
   s.nav=navOf(s);motion.arrange(s,s.nav,groundY,at);
  }
  // Tutorial I: the guide (civilization SCOUT) is neutral until he meets the army.
  const scoutSquads=otherSquads.filter(s=>s.civ==='SCOUT');
  const allSquads=[...squads,...enemySquads,...otherSquads];
  companions=window.PraetoriansScoutCompanions.create({getModel:()=>unitModels[kindFor('LOBO_SCOUT')],
   groundY,navFor:navOf,register:unitRenderer.register});
  companions.sync(allSquads);
  // Recruitment must not build a new full-map passability grid during a
  // battle. Prepare the races' trainable profiles while the map is loading;
  // navFor shares grids between units/civilizations with the same rules.
  if(missionData.kind==='skirmish')for(const civ of missionData.civilizations)
   for(const type of races[civ.race]?.trains||[])if(gameStats[type])navFor(civ.name,rulesFor(type));
  $('silhouettes')?.addEventListener('change',()=>allSquads.forEach(refreshSquadInstances));
  // ---- Test battles (F2): any troop of any race, on any side ------------------
  // Every unit type with an HD model, grouped by race (troops, heroes,
  // machines). A model this mission did not load comes the first time.
  const SPAWN_RACES=[['ROMANOS','Romains'],['BARBAROS','Barbares'],['EGIPCIOS','Égyptiens']];
  const isMachine=type=>!!gameStats[type]?.construction||/^(CATAPULTA|BALLESTA_MOVIL|ARIETE|TORRE_ASALTO|ESCALA|CARRO)/.test(type);
  const isHero=type=>/^HEROE_|^LABIENO$/.test(type);
  // Single units (machines, heroes, centurions, scouts) come one at a time.
  const spawnLimit=type=>(gameStats[type]?.maxSoldiers||0)>1?40:1;
  function spawnGroups(){
   const groups=[];
   for(const [race,title] of SPAWN_RACES){
    const types=Object.keys(gameStats).filter(t=>gameStats[t].race===race&&kindFor(t)&&!gameStats[t].flags?.includes('FLAG_FAMILIAR'));
    for(const [label,list] of [[title,types.filter(t=>!isHero(t)&&!isMachine(t))],[title+' · héros',types.filter(isHero)],[title+' · machines',types.filter(isMachine)]])
     if(list.length)groups.push({label,list});
   }
   return groups;
  }
  // The civilization a test troop joins: the player's, the first enemy's, or an ally's.
  const allyCivName=()=>missionData.civilizations.find(c=>c.name!==humanCiv&&!neutralCiv(c.name)&&allied(humanCiv,c.name))?.name||null;
  function spawnCiv(side){
   if(side==='player')return humanCiv;
   if(side==='ally')return allyCivName()||humanCiv;
   return enemySquads.find(s=>s.members.length)?.civ||missionData.civilizations.find(c=>!c.human&&!c.neutral&&c.name!==humanCiv&&!allied(humanCiv,c.name))?.name||'Galos';
  }
  let spawnMode=false,spawned=0;
  // Test buildings: the side's garrison and watchtower, placed already built.
  const enemyCivName=()=>enemySquads.find(s=>s.members.length)?.civ||missionData.civilizations.find(c=>c.name!==humanCiv&&!neutralCiv(c.name))?.name||'Galos';
  function spawnStructures(side){
   const civ=side==='player'?humanCiv:enemyCivName(),race=races[civs.get(civ)?.race]||races[side==='player'?'ROMANOS':'BARBAROS'];
   const types=[race?.garrison,...(race?.builds||[]).filter(t=>buildingData.structures[t]?.kind==='TORRE_DEFENSA')].filter(t=>t&&buildingData.structures[t]);
   return types.map(type=>({type,title:buildingData.structures[type].label?text(buildingData.structures[type].label):type}));
  }
  function fillSpawnTypes(){
   // Sides: yours, the enemy, and an ally when the mission has one.
   const sideNow=$('spawnSide').value||'enemy',ally=allyCivName();
   $('spawnSide').innerHTML=`<option value="enemy">Ennemi</option><option value="player">Vous</option>${ally?'<option value="ally">Allié</option>':''}`;
   $('spawnSide').value=sideNow==='ally'&&!ally?'enemy':sideNow;
   const side=$('spawnSide').value,built=spawnStructures(side==='ally'?'player':side),keep=$('spawnType').value;
   $('spawnType').innerHTML=spawnGroups().map(g=>{
    const titles=g.list.map(t=>unitTitles[t]||t);
    // Two troops with one name show their type too.
    return `<optgroup label="${g.label}">${g.list.map((t,i)=>`<option value="${t}">${titles[i]}${titles.indexOf(titles[i])!==titles.lastIndexOf(titles[i])?` (${t})`:''}</option>`).join('')}</optgroup>`;
   }).join('')+(built.length?`<optgroup label="Bâtiments">${built.map(b=>`<option value="structure:${b.type}">${b.title}</option>`).join('')}</optgroup>`:'');
   const options=[...$('spawnType').options].map(o=>o.value);
   // Keep the choice; otherwise that side's race's basic infantry.
   const preferred=races[civs.get(spawnCiv(side))?.race]?.demotion;
   $('spawnType').value=options.includes(keep)?keep:options.includes(preferred)?preferred:options[0];
   if(keep!==$('spawnType').value)syncSpawnCount();
  }
  // A troop's full strength by default (DefUnidades MAX_UNIDADES_TROPA).
  function syncSpawnCount(){
   const type=$('spawnType').value,input=$('spawnCount');
   if(type.startsWith('structure:')){input.disabled=true;return;}
   const limit=spawnLimit(type);input.disabled=limit===1;input.max=String(limit);
   input.value=String(Math.min(limit,Math.max(1,gameStats[type]?.maxSoldiers||1)));
  }
  $('spawnType').addEventListener('change',syncSpawnCount);
  function spawnStructureAt(side,type,x,z){
   const civ=side==='player'?humanCiv:enemyCivName();
   const e=buildings.startSite(type,x,z,0,civ,{pending:false});if(!e)return null;
   buildings.complete(e);
   // Shown at once to the player, as test enemies are.
   return e;
  }
  $('spawnSide').addEventListener('change',fillSpawnTypes);fillSpawnTypes();
  function opponentsCentre(side){
   const others=(side==='player'?enemySquads:squads).filter(s=>s.members.length);
   if(!others.length)return null;
   return {x:others.reduce((n,s)=>n+s.x,0)/others.length,z:others.reduce((n,s)=>n+s.z,0)/others.length};
  }
  // A new troop near (x, z): the nearest spot with room for its whole
  // formation (scripted reinforcements, village training, test battles).
  function placeTroop(troop,x,z,facing){
   const side=sideOfCiv(troop.civilization);
   const list=side==='player'?squads:side==='enemy'?enemySquads:otherSquads;
   const squad=spawnSquad({...troop,orientation:facing},side==='player'?squads.length:100+enemySquads.length+otherSquads.length,side);if(!squad)return null;
   // A terrain-safe slot can still be occupied by another formation. Reject
   // those positions at spawn time, before any bodies begin inside each other.
   const c=Math.cos(facing),sn=Math.sin(facing);
   function unoccupied(px,pz){
    for(const other of allSquads){
     if(!other.members.length||Math.hypot(other.x-px,other.z-pz)>squad.radius+other.radius+4)continue;
     for(const member of squad.members){
      const mx=px+c*member.dx+sn*member.dz,mz=pz-sn*member.dx+c*member.dz;
      for(const o of other.members)if((o.x-mx)**2+(o.z-mz)**2<.38*.38)return false;
     }
    }
    return true;
   }
   let spot=null;
   search:for(let ring=0;ring<=10;ring+=.5)for(let a=0;a<(ring?16:1);a++){
    const px=x+Math.cos(a*Math.PI/8)*ring,pz=z+Math.sin(a*Math.PI/8)*ring;
    if(motion.poseSafe(squad,px,pz,facing,navOf(squad))&&unoccupied(px,pz)){spot={x:px,z:pz};break search;}
   }
   if(!spot)return null;
   squad.x=spot.x;squad.z=spot.z;motion.occupy(squad,groundY);
   if(side==='player')addRing(squad);
   list.push(squad);allSquads.push(squad);combat.add(squad,side);updateArmyStats();
   squad.visible=side!=='enemy'||!!squad.revealed;squad.visibilityChanged=true;refreshSquadInstances(squad);
   companions.sync(allSquads);return squad;
  }
  function addSquadAt(side,type,count,x,z){
   const target=opponentsCentre(side==='ally'?'player':side);
   const facing=target?Math.atan2(target.x-x,target.z-z):0;
   const troop={name:`${side==='player'?'ROM':side==='ally'?'ALLY':'GAL'}_TEST_${++spawned}`,type,civilization:spawnCiv(side),
    units:Math.max(1,Math.min(spawnLimit(type),count|0)),position:[x,0,z],orientation:facing,properties:[]};
   const squad=placeTroop(troop,x,z,facing);
   // Test troops follow the same sight and concealment rules as other troops.
   // A permanent reveal here leaked unseen enemies to the field and minimap.
   if(squad&&window.praetorians)updateEnemyVisibility();
   return squad;
  }
  // Models a mission did not need load on demand (any troop of any race).
  async function loadUnitModels(types){
   const required=withFamiliars(types);
   const kinds=[...new Set(required.map(kindFor).filter(k=>k&&!unitModels[k]))];
   await Promise.all(kinds.map(kind=>Models.load(kind).then(model=>{unitModels[kind]=model;}).catch(error=>console.warn(error))));
   return required.every(t=>unitModels[kindFor(t)]);
  }
  const sideTitle=side=>side==='player'?'à vous':side==='ally'?'alliée':'ennemie';
  async function spawnTest(side,type,count,x,z){
   const title=unitTitles[type]||type;
   if(!withFamiliars([type]).every(t=>unitModels[kindFor(t)])){
    toast(`Chargement : ${title}…`);
    if(!await loadUnitModels([type])){toast(`Modèle introuvable : ${title}.`);return null;}
   }
   const squad=addSquadAt(side,type,count,x,z);
   toast(squad?`${title} (${squad.members.length}) · troupe ${sideTitle(side)}.`:'Pas assez de place ici pour cette formation.');
   return squad;
  }
  window.praetoriansSpawnTest=spawnTest;
  function setSpawnMode(on){spawnMode=on;$('spawnPlace').classList.toggle('active',on);if(on)setPending(null);}
  $('spawnPlace').addEventListener('click',()=>{setSpawnMode(!spawnMode);if(spawnMode){settings.hidden=true;toast('Click the ground to spawn. Esc to stop.');}});
  $('spawnBattle').addEventListener('click',()=>{
   // Gallic models a mission without Gauls did not load come first.
   const needed=['GALO_LIGERA','GALO_ARQUERO','INFANTERIA_LIGERA','PIQUERO'];
   if(needed.some(t=>!unitModels[kindFor(t)])){toast('Chargement des troupes…');loadUnitModels(needed).then(quickBattle);return;}
   quickBattle();
  });
  function quickBattle(){
   const ours=squads.filter(s=>s.members.length);
   const cx=ours.reduce((n,s)=>n+s.x,0)/Math.max(1,ours.length),cz=ours.reduce((n,s)=>n+s.z,0)/Math.max(1,ours.length);
   const made=[
    ['enemy','GALO_LIGERA',16,cx-20,cz-5],['enemy','GALO_LIGERA',16,cx-20,cz],['enemy','GALO_LIGERA',16,cx-20,cz+5],
    ['enemy','GALO_ARQUERO',16,cx-25,cz],['player','INFANTERIA_LIGERA',30,cx-6,cz-4],['player','PIQUERO',20,cx-6,cz+4]
   ].map(args=>addSquadAt(...args)).filter(Boolean);
   for(const squad of made){
    const targets=(squad.side==='enemy'?squads:made.filter(s=>s.side==='enemy')).filter(s=>s.members.length);
    const target=targets.sort((a,b)=>(a.x-squad.x)**2+(a.z-squad.z)**2-((b.x-squad.x)**2+(b.z-squad.z)**2))[0];
    if(target)combat.attack(squad,target);
   }
   settings.hidden=true;camera.target.set(cx-12,0,cz);zoom=Math.max(zoom,16);resizeCamera();resetCameraMotion();
   toast(`Test battle: ${made.filter(s=>s.side==='enemy').length} Gallic and ${made.filter(s=>s.side==='player').length} Roman squads added.`);
  }
  // Combat uses the original unit and weapon tables; sounds the original sound tables.
  let sound=null;
  const troopVoices=window.PraetoriansTroopVoices.create({sound:()=>sound,units:gameStats});
  function syncVoices(){const o=menuOptions();troopVoices.setEnabled({answers:o.voices!==false,messages:o.announcer!==false});}
  const answer=(list,situation)=>{syncVoices();return troopVoices.answer(list,situation);};
  const combat=Combat.create({nav,motion,groundY,stats:gameStats,formations,onEvent:onCombatEvent,isHostile:(a,b)=>civHostile(a.civ,b.civ),
   navFor:navOf,anchored:s=>!!fortress?.isWalkway(s.x,s.z),unreachable:(squad,target)=>siegeFallback(squad,target),
   structureFor:(squad,range)=>{
    let best=null,bestD=range;
    for(const e of buildings.entities){
     if(squad.side==='player'&&!structureObserved(e))continue;
     if(!buildings.hostileTo(e,squad.civ)||!(e.kind==='GUARNICION'||(e.kind==='TORRE_DEFENSA'&&e.occupants.length)))continue;
     const d=Math.hypot(e.x-squad.x,e.z-squad.z)-e.radius;if(d<bestD){bestD=d;best=e;}
    }
    return best?buildings.target(best):null;
   },
   attackDuration:(s,m)=>{const render=s.formationState?.render,role=m.formationRole||'center';const name=render?.roles?.[role]?.attack||render?.attack||(m.attackVariant===2&&s.model.animations.attack2?'attack2':'attack');return (s.model.animations[name]?.duration||s.model.animations.attack?.duration||0)/1000;},
   // A siege engine's firing and reloading clips (src/units/unit-models.js).
   clipDuration:(s,name)=>(s.model?.animations?.[s.formationState?.render?.[name]||name]?.duration||0)/1000,
   hasClip:(s,name)=>!!s.model?.animations?.[name]});
  for(const squad of allSquads)combat.add(squad,squad.side);
  updateArmyStats();
  window.PraetoriansSound?.create({language:I18n.language}).then(async bank=>{sound=bank;await bank.setLanguage(I18n.language);bank.setVolume((menuOptions().effects??85)/100);bank.preload(['UATC','UMOR','ULFL','PFGL','TGCB','UCRG']);syncVoices();troopVoices.preload(squads);}).catch(error=>console.warn('Sound effects unavailable',error));
  function onCombatEvent(type,data){
   const at=data.member||(data.squad&&combat.centroid(data.squad))||data;
   if((type==='hit'||type==='engage')&&data.squad?.formationState?.pending)cancelFormation(data.squad);
   if(['hit','strike','clash','shoot','aim','engage','charge','pilum','build'].includes(type)){
    if(data.squad)concealmentVisibilityDirty=concealment.disrupt(data.squad)||concealmentVisibilityDirty;
    if(type==='hit'&&data.attacker?.members)concealmentVisibilityDirty=concealment.disrupt(data.attacker)||concealmentVisibilityDirty;
   }
   if(type==='hit'){if(data.squad?.civ===humanCiv){syncVoices();troopVoices.message(/^CENTURION/.test(gameStats[data.squad.type]?.base||'')?'hero':'troop');}damagedTroops.add(data.squad.name);data.squad.foughtAt=performance.now();if(data.attacker?.members)data.attacker.foughtAt=performance.now();
    if(data.squad.transform)cancelTransform(data.squad,'interrompue : la troupe est attaquée');}
   if(type==='exhausted'&&data.squad.side==='player'&&selectedSquads.includes(data.squad))toast(`${unitTitles[data.squad.type]||data.squad.type} : à bout de souffle, la troupe marche.`);
   if(type==='fireFull'&&data.squad.side==='player')toast('Le bâtiment brûle de toutes parts : les flèches enflammées n’y ajoutent plus rien.');
   if(type==='strike'||type==='clash'){sound?.play('UATC',at);if(data.squad)data.squad.foughtAt=performance.now();}
   else if(type==='death'){
    // The results screen's VICTIMES and PERTES.
    if(data.squad?.civ)statsOf(data.squad.civ).losses++;
    if(data.attacker?.civ&&data.attacker.civ!==data.squad?.civ)statsOf(data.attacker.civ).kills++;
    sound?.play('UMOR',at);updateArmyStats();if(selectedSquads.includes(data.squad))refreshSelectionPanel();
    if(data.attacker?.civ===humanCiv&&data.squad?.civ!==humanCiv)gainHonour(0,honour.PER_KILL);
    // Centurions gain experience (EXPERIENCIA_POR_MUERTE) from kills by troops round them.
    if(data.attacker?.members&&data.squad?.civ!==data.attacker.civ){
     const at=combat.centroid(data.attacker);
     for(const c of allSquads)if(c.civ===data.attacker.civ&&isCenturion(c)&&(c===data.attacker||Math.hypot(c.x-at.x,c.z-at.z)<=COMMAND_RADIUS))c.xp=(c.xp||0)+honour.PER_KILL;
    }
   }
   else if(type==='shoot'){sound?.play('ULFL',at);if(data.squad)data.squad.foughtAt=performance.now();}
   else if(type==='aim')sound?.play('UCRG',at);
   else if(type==='impact'){if(data.hit||Math.random()<.35)sound?.play('PFGL',data);}
   else if(type==='engage'||type==='charge')sound?.play('TGCB',at);
   else if(type==='destroyed'){
    const title=unitTitles[data.squad.type]||data.squad.type;
    if(data.squad.side==='player'){data.squad.ring?.setEnabled(false);setSelection(selectedSquads.filter(s=>s!==data.squad),false,false);toast(`${title} have been wiped out.`);}
    else toast(`${title} destroyed.`);
   }
  }
  // HD meshes omit the old baked shadow cards: the remaster casts their
  // silhouettes at runtime. A transparent receiver preserves the source atlas.
  if(B.ShadowOnlyMaterial){
   sun.position=new B.Vector3(90,90,-30);
   sun.autoCalcShadowZBounds=true;
   shadowGenerator=new B.ShadowGenerator(2048,sun);
   shadowGenerator.usePercentageCloserFiltering=true;
   shadowGenerator.filteringQuality=B.ShadowGenerator.QUALITY_LOW;
   shadowGenerator.bias=.0003;shadowGenerator.normalBias=.015;
   shadowGenerator.transparencyShadow=true;
   for(const mesh of modelMeshes)shadowGenerator.addShadowCaster(mesh);
   const material=new B.ShadowOnlyMaterial('HD cast shadows',scene);
   material.activeLight=sun;material.shadowColor=new B.Color3(.08,.11,.04);
   material.alpha=.42;material.backFaceCulling=false;material.zOffset=-1;
   shadowReceiver=ground.clone('HD terrain shadow receiver',null,true);
   shadowReceiver.material=material;shadowReceiver.receiveShadows=true;
   shadowReceiver.isPickable=false;shadowReceiver.position.y=.003;
   shadowGenerator.getShadowMap().refreshRate=B.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  }
  // ---- Wildlife and the scout's hawk ------------------------------------------
  const critters=Critters.create({animals:map.mission.animals,nav,groundY});
  for(const animal of critters.list){animal.model=unitModels[animal.kind];unitRenderer.register(animal);}
  // HALCON: released by the scout (SOLTAR_FAMILIAR_HALCON) towards a point;
  // it flies there, circles watching the ground (RAD_VISION 9), and returns.
  const HAWK_SPEED=6,HAWK_HEIGHT=4,HAWK_WATCH=25,HAWK_VISION=9;
  const hawk={active:false,phase:null,target:null,timer:0,owner:null,
   squad:{kind:'hawk',model:unitModels.hawk,index:950,side:'neutral',visible:true,noShadow:true,dying:[],isMoving:false,
    members:[{x:0,y:0,z:0,r:0,combatId:9950,combatMoving:true,charging:false}]}};
  unitRenderer.register(hawk.squad);
  function releaseHawk(owner,target){
   const m=hawk.squad.members[0];
   Object.assign(hawk,{active:true,phase:'out',owner,target:{x:target.x,z:target.z},timer:0});
   m.x=owner.x;m.z=owner.z;m.y=groundY(owner.x,owner.z)+1.3;
   sound?.play('UHGT',m);refreshCommands();
  }
  function updateHawk(dt){
   if(!hawk.active)return;
   const m=hawk.squad.members[0];
   if(!hawk.owner?.members.length){hawk.active=false;refreshCommands();return;}
   let goal=hawk.target;
   if(hawk.phase==='circle'){
    hawk.timer-=dt;const a=hawk.timer*.8;goal={x:hawk.target.x+Math.cos(a)*2.6,z:hawk.target.z+Math.sin(a)*2.6};
    if(hawk.timer<=0)hawk.phase='return';
   }
   if(hawk.phase==='return')goal={x:hawk.owner.x,z:hawk.owner.z};
   const dx=goal.x-m.x,dz=goal.z-m.z,d=Math.hypot(dx,dz),step=Math.min(d,HAWK_SPEED*dt);
   if(d>1e-3){m.x+=dx/d*step;m.z+=dz/d*step;m.r=Math.atan2(dx,dz);}
   const cruise=groundY(m.x,m.z)+(hawk.phase==='return'&&d<3?1.3:HAWK_HEIGHT);
   m.y+=(cruise-m.y)*Math.min(1,dt*1.5);
   if(hawk.phase==='out'&&d<.6){hawk.phase='circle';hawk.timer=HAWK_WATCH;}
   if(hawk.phase==='return'&&d<.6){hawk.active=false;refreshCommands();}
  }
  // ---- Mission scripting support ---------------------------------------------
  const zones=Object.fromEntries(map.mission.zones.map(zone=>[zone.name,zone]));
  function inZone(zone,x,z){
   if(!zone)return false;
   if(zone.kind==='CIRCULAR')return Math.hypot(x-zone.center[0],z-zone.center[1])<=zone.radius;
   let inside=false;const v=zone.vertices;
   for(let i=0,j=v.length-1;i<v.length;j=i++){
    if((v[i][1]>z)!==(v[j][1]>z)&&x<(v[j][0]-v[i][0])*(z-v[i][1])/(v[j][1]-v[i][1])+v[i][0])inside=!inside;
   }
   return inside;
  }
  const troop=name=>allSquads.find(s=>s.name===name);
  const groupOf=name=>allSquads.filter(s=>(s.properties||[]).includes('GRUPO '+name));

  const damagedTroops=new Set(),revealZones=[],routeFollowers=[],orderRestrictions=new Set();
  let logicPaused=false,missionClock=0,escapeArmed=false,escaped=false,raining=0;
  const missionWaits=[];
  const missionWait=ms=>new Promise(done=>missionWaits.push({at:missionClock+ms/1000,done}));
  // Cut-scene camera: fly the mission's camera routes (camera and look-at
  // nodes, x y z seconds) on the orthographic battle camera.
  let cinematicFrame=null;
  function cameraState(){return {x:camera.target.x,y:camera.target.y,z:camera.target.z,alpha:camera.alpha,beta:camera.beta,zoom};}
  function viewFrom(eye,look){
   const vx=eye[0]-look[0],vy=eye[1]-look[1],vz=eye[2]-look[2],len=Math.hypot(vx,vy,vz)||1;
   return {x:look[0],y:look[1],z:look[2],alpha:Math.atan2(vz,vx),
    beta:Math.max(camera.lowerBetaLimit,Math.min(camera.upperBetaLimit,Math.acos(vy/len))),zoom:Math.max(5,Math.min(30,len*.52))};
  }
  function applyView(v){
   camera.target.set(v.x,v.y,v.z);camera.alpha=v.alpha;camera.beta=v.beta;
   camera.inertialAlphaOffset=camera.inertialBetaOffset=0;zoom=v.zoom;resizeCamera();resetCameraMotion();
  }
  function blendView(a,b,t){
   const da=Math.atan2(Math.sin(b.alpha-a.alpha),Math.cos(b.alpha-a.alpha)),s=t*t*(3-2*t);
   return {x:a.x+(b.x-a.x)*s,y:a.y+(b.y-a.y)*s,z:a.z+(b.z-a.z)*s,alpha:a.alpha+da*s,beta:a.beta+(b.beta-a.beta)*s,zoom:a.zoom+(b.zoom-a.zoom)*s};
  }
  function routeView(route,t){
   const sample=nodes=>{
    if(nodes.length===1)return nodes[0].slice(0,3);
    let i=1;while(i<nodes.length-1&&nodes[i][3]<t)i++;
    const a=nodes[i-1],b=nodes[i],k=Math.max(0,Math.min(1,(t-a[3])/((b[3]-a[3])||1)));
    return [0,1,2].map(axis=>a[axis]+(b[axis]-a[axis])*k);
   };
   return viewFrom(sample(route.camera),sample(route.lookAt));
  }
  function flyRoute(route,blendIn,blendOut,home){
   const duration=Math.max(route.camera.at(-1)[3],route.lookAt.at(-1)[3]);
   const start=cameraState();let t=-blendIn;
   return new Promise(done=>{
    cinematicFrame=dt=>{
     if(escaped){cinematicFrame=null;done();return;}
     t+=dt;
     if(t<0)applyView(blendView(start,routeView(route,0),1+t/Math.max(blendIn,1e-3)));
     else if(t<=duration)applyView(routeView(route,t));
     else if(blendOut&&t<=duration+blendOut)applyView(blendView(routeView(route,duration),home,(t-duration)/blendOut));
     else{if(blendOut)applyView(home);cinematicFrame=null;done();}
    };
   });
  }
  function realWait(ms){return new Promise(done=>{let left=ms/1000;cinematicFrame=dt=>{left-=dt;if(left<=0||escaped){cinematicFrame=null;done();}};});}
  async function speakLines(lines){
   for(const line of lines){
    if(escaped)break;
    missionUi.cinema.say(line.text?text(line.text):'');
    const started=missionClock,spoken=line.sound&&sound?sound.speak(line.sound):Promise.resolve();
    await Promise.all([spoken,missionWait(line.ms||0)]);
    if(missionClock-started<.05)await missionWait(50);
   }
   missionUi.cinema.say('');
  }
  async function runCinematic(steps){
   const home=cameraState();
   for(const step of steps){
    if(escaped)break;
    if(step.pause){await realWait(step.pause);continue;}
    const route=map.mission.cameraRoutes.find(r=>r.name===step.route);if(!route)continue;
    // Voices run alongside the flight; both finish before the next step
    // (IntroducirPuntoSincronia).
    await Promise.all([flyRoute(route,step.blendIn||0,step.blendOut||0,home),step.voices?speakLines(step.voices):null]);
   }
   const skipped=escaped;
   cinematicFrame=null;
   if(skipped){
    // Escape: back where the player was (MirarAPunto with the stored view).
    sound?.silence();missionUi.cinema.say('');applyView(home);
   }else{
    // IntroducirPonerModoJuegoCamara(TRUE): the game camera resumes where
    // the flight ended, at the battle camera's angle and zoom.
    const end=cameraState();
    if(Math.abs(end.alpha-home.alpha)+Math.abs(end.beta-home.beta)+Math.abs(end.zoom-home.zoom)>1e-3){
     const target={...end,alpha:home.alpha,beta:home.beta,zoom:home.zoom};let t=0;
     await new Promise(done=>{cinematicFrame=dt=>{t=Math.min(1,t+dt/.8);applyView(blendView(end,target,t));if(t>=1){cinematicFrame=null;done();}};});
    }
   }
   escapeArmed=false;escaped=false;cinematicFrame=null;
   return {skipped};
  }
  function followRoutes(){
   for(let i=routeFollowers.length-1;i>=0;i--){
    const f=routeFollowers[i],s=f.squad;
    if(!s.members.length||['melee','approach','pursue','shoot'].includes(s.combat.mode)){routeFollowers.splice(i,1);continue;}
    if(s.isMoving)continue;
    if(f.next>=f.nodes.length){routeFollowers.splice(i,1);continue;}
    const [x,z]=f.nodes[f.next++].position;motion.order(s,{x,z},navOf(s));
   }
  }
  const missionUi=window.PraetoriansMissionUI.create($('game'));
  $('game').classList.add('mission-ui');
  // The mission script's view of the world (see src/mission/tutorial1.js).
  const missionApi={
   text,ui:missionUi,
   alive:name=>!!troop(name)?.members.length,
   soldiers:civ=>allSquads.filter(s=>s.civ===civ).reduce((n,s)=>n+s.members.length,0),
   civInZone:(civ,zone)=>allSquads.some(s=>s.civ===civ&&s.members.some(m=>inZone(zones[zone],m.x,m.z))),
   troopInZone:(name,zone)=>!!troop(name)?.members.some(m=>inZone(zones[zone],m.x,m.z)),
   hawkInZone:zone=>hawk.active&&inZone(zones[zone],hawk.squad.members[0].x,hawk.squad.members[0].z),
   damaged:name=>damagedTroops.has(name),
   groupAlive:name=>groupOf(name).filter(s=>s.members.length).length,
   setAggressive:(group,on)=>groupOf(group).forEach(s=>combat.setAggressive(s,on)),
   followRoute:(group,name)=>{
    const route=map.mission.patrolRoutes.find(r=>r.name===name);if(!route)return;
    for(const s of groupOf(group))if(s.members.length)routeFollowers.push({squad:s,nodes:route.nodes,next:0});
   },
   hunt:group=>groupOf(group).forEach(s=>combat.setHunting(s,true)),
   revealGroup:group=>groupOf(group).forEach(s=>{s.revealed=true;}),
   joinPlayer:group=>{
    for(const s of groupOf(group)){
     if(s.side==='player'||!s.members.length)continue;
     combat.setSide(s,'player');s.civilization=s.civ='Romanos';s.index=squads.length;
     squads.push(s);addRing(s);
    }
    updateArmyStats();refreshGroupButtons();
   },
   restrict:(order,on)=>{if(on)orderRestrictions.add(order);else orderRestrictions.delete(order);refreshCommands();},
   reveal:(x,z,r,ms)=>revealZones.push({x,z,r,until:missionClock+ms/1000}),
   rain:amount=>{raining=amount;missionUi.setRain(amount);},
   chime:()=>sound?.play('IATU'),
   pause:on=>{logicPaused=!!on;},
   cinema:on=>missionUi.cinema.on(on),
   camera:{position:()=>({x:camera.target.x,z:camera.target.z}),lookAt:(x,z)=>{camera.target.x=x;camera.target.z=z;resetCameraMotion();}},
   cinematic:runCinematic,
   armEscape:()=>{escapeArmed=true;escaped=false;},
   waitOrEscape:ms=>realWait(ms).then(()=>{escapeArmed=false;escaped=false;}),
   wait:missionWait,
   end:(victory,entries)=>{finishMission(victory,entries);}
  };
  let missionEnded=false;
  // ---- The end of the game (src/ui/results-screen.js) ------------------------------
  // The battle's last moment: the game dims under VICTOIRE (or DÉFAITE) and its
  // objectives while the announcer says so (IAWV / IAWD); then, after a few
  // seconds or on Continuer, the HD's results screen: every army's banner,
  // the winners' whole, the vanquished torn, with their figures.
  const matchStats=new Map();
  function statsOf(civ){let s=matchStats.get(civ);if(!s)matchStats.set(civ,s={kills:0,losses:0,trained:0});return s;}
  const results=window.PraetoriansResults.create({
   labels:{victory:text('LTEXT_MISSION_SUCCESS'),defeat:text('LTEXT_MISSION_FAILURE'),kills:text('LTEXT_GUI_KILLS'),losses:text('LTEXT_GUI_LOSSES'),
    trained:text('LTEXT_GUI_TRAINED'),villages:text('LTEXT_GUI_VILLAGES'),time:text('LTEXT_GUI_PLAYTIME'),score:text('LTEXT_GUI_SCORE'),
    quit:text('LTEXT_GUI_QUIT'),replay:text('LTEXT_GUI_RESTART_LEVEL')},
   onQuit:()=>{location.href=location.pathname;},onReplay:()=>location.reload()});
  // Every army that took part: ours and our allies first.
  function resultArmies(victory){
   const friendly=c=>c.name===humanCiv||allied(humanCiv,c.name);
   return missionData.civilizations
    .filter(c=>!neutralCiv(c.name)&&(matchStats.has(c.name)||allSquads.some(s=>s.civ===c.name)||villages?.owned(c.name).length))
    .sort((a,b)=>(a.name===humanCiv?0:friendly(a)?1:2)-(b.name===humanCiv?0:friendly(b)?1:2))
    .map(c=>{const s=statsOf(c.name);return {name:c.displayName||(c.label?text(c.label):c.name),race:c.race,colour:colourIndex(c.name),
     won:victory?friendly(c):!friendly(c),human:c.name===humanCiv,stats:{kills:s.kills,losses:s.losses,trained:s.trained,villages:villages?.owned(c.name).length||0}};});
  }
  function finishMission(victory,entries){
   logicPaused=true;missionEnded=true;
   let shown=false;
   const go=()=>{if(shown)return;shown=true;clearTimeout(timer);results.show({victory,seconds:missionClock,players:resultArmies(victory)});};
   missionUi.finish(victory,entries,{onContinue:go});
   sound?.play(victory?'IAWV':'IAWD');sound?.playMusic('SMNU');
   const timer=setTimeout(go,5000);
  }
  missionUi.cinema.onSkip(()=>{if(escapeArmed)escaped=true;if(interruptHandle){interruptHandle.fired=true;interruptHandle=null;}});
  // ---- Every other mission: its original script --------------------------------
  // The script engine (src/mission/script-engine.js) runs the .trg; the
  // library (script-game.js) calls into this world. Villages and the CPU's
  // strategies run in the simulation step.
  const lower=s=>String(s||'').toLowerCase();
  const civByName=new Map(missionData.civilizations.map(c=>[lower(c.name),c]));
  let interruptHandle=null,presentationShown=false;
  const timers=[],namedReveals=new Map(),structureOwners=new Map(),pings=[];
  function refreshSides(){
   // Alliances or neutrality changed: re-sort every troop by its civilization.
   for(const s of [...allSquads]){
    const side=sideOfCiv(s.civ);if(side===s.side)continue;
    moveSquadSide(s,side);
   }
   updateArmyStats();refreshGroupButtons();
  }
  function moveSquadSide(s,side){
   for(const list of [squads,enemySquads,otherSquads]){const i=list.indexOf(s);if(i>=0)list.splice(i,1);}
   if(side==='player'){s.index=squads.length;squads.push(s);if(!s.ring)addRing(s);}
   else{(side==='enemy'?enemySquads:otherSquads).push(s);s.ring?.setEnabled(false);if(selectedSquads.includes(s))setSelection(selectedSquads.filter(o=>o!==s),false,false);}
   combat.setSide(s,side);
   s.visible=side!=='enemy'||!!s.revealed;s.visibilityChanged=true;refreshSquadInstances(s);
  }
  // Scripted camera orders: groups of camera steps and voice lines, played in
  // order; within a group both run side by side.
  function cameraPoint(name){return map.mission.cameraPoints.find(p=>lower(p.name)===lower(name))||null;}
  function entityPosition(name){
   const t=allSquads.find(s=>lower(s.name)===lower(name));if(t?.members.length)return combat.centroid(t);
   const v=villages?.find(name);if(v)return {x:v.x,z:v.z};
   const p=placements.find(p=>lower(p.name)===lower(name));return p?{x:p.x,z:p.z}:null;
  }
  async function scriptVoices(lines,job){
   for(const line of lines){
    if(job.cancelled)return;
    missionUi.cinema.say(line.text?text(line.text):'');
    const spoken=line.sound&&sound?sound.speak(line.sound):Promise.resolve();
    await Promise.all([spoken,missionWait(line.ms||0)]);
   }
   if(!job.cancelled)missionUi.cinema.say('');
  }
  function cameraJob(groups,{onSync,onEnd}){
   const home=cameraState();
   const job={done:false,cancelled:false,cancel(){if(job.done)return;job.cancelled=true;finish();}};
   let frame=null;
   function finish(){if(job.done)return;job.done=true;if(frame&&cinematicFrame===frame)cinematicFrame=null;frame=null;onEnd();}
   const play=step=>new Promise(done=>{
    if(job.cancelled)return done();
    let t=0;
    const end=()=>{if(cinematicFrame===frame)cinematicFrame=null;frame=null;done();};
    if(step.pause){const left=step.pause/1000;frame=dt=>{t+=dt;if(job.cancelled||t>=left)end();};}
    else if(step.route){
     const route=map.mission.cameraRoutes.find(r=>lower(r.name)===lower(step.route));if(!route)return done();
     const duration=Math.max(route.camera.at(-1)?.[3]||0,route.lookAt.at(-1)?.[3]||0),start=cameraState();
     frame=dt=>{
      if(job.cancelled)return end();
      t+=dt;const k=t-(step.blendIn||0);
      if(k<0)applyView(blendView(start,routeView(route,0),1+k/Math.max(step.blendIn,1e-3)));
      else if(k<=duration)applyView(routeView(route,k));
      else if(step.blendOut&&k<=duration+step.blendOut)applyView(blendView(routeView(route,duration),home,(k-duration)/step.blendOut));
      else{if(step.blendOut)applyView(home);end();}
     };
    }else if(step.point){const p=cameraPoint(step.point);if(p)applyView(viewFrom(p.position,p.lookAt));return done();}
    else if(step.entity){
     const at=entityPosition(step.entity);if(!at)return done();
     const start=cameraState(),target={...start,x:at.x,y:groundY(at.x,at.z),z:at.z};
     frame=dt=>{t=Math.min(1,t+dt/Math.max(step.blendIn||1,.3));applyView(blendView(start,target,t));if(t>=1||job.cancelled)end();};
    }else if(step.gameMode){
     // Back to the battle camera's angle and zoom where the flight ended.
     const start=cameraState(),target={...start,alpha:home.alpha,beta:home.beta,zoom:home.zoom};
     if(Math.abs(start.alpha-home.alpha)+Math.abs(start.beta-home.beta)+Math.abs(start.zoom-home.zoom)<1e-3)return done();
     frame=dt=>{t=Math.min(1,t+dt/.8);applyView(blendView(start,target,t));if(t>=1||job.cancelled)end();};
    }else return done();
    cinematicFrame=frame;
   });
   (async()=>{
    for(const group of groups){
     if(job.cancelled)break;
     const moves=(async()=>{for(const step of group.camera){if(job.cancelled)break;await play(step);}})();
     await Promise.all([moves,scriptVoices(group.voices,job)]);
     if(job.cancelled)break;
     onSync();
    }
    finish();
   })();
   return job;
  }
  // Ownership colours (civilization COLOR) for the minimap and villages.
  // The game's own colour table, as the troops wear it (red, green, orange,
  // blue, purple, yellow, brown, grey), in campaigns as in skirmish.
  const CIV_COLORS=window.PraetoriansSkirmishSetup.COLORS.map(c=>c.hex);
  const civColor=name=>{const c=civByName.get(lower(name));const i=Number(c?.color);return Number.isInteger(i)&&CIV_COLORS[i]?CIV_COLORS[i]:'#8f8f8f';};
  // Honour (DefRazas CAMBIO_PUNTOS_EXPERIENCIA): every 200 points of the
  // army's experience - 10 a kill (EXPERIENCIA_POR_MUERTE) - make a point of
  // honour; scripts give points too (DarPHCiv).
  const honour={points:0,xp:0,STEP:200,PER_KILL:10};
  function gainHonour(points=0,xp=0){
   honour.points+=points;honour.xp+=xp;
   while(honour.xp>=honour.STEP){honour.xp-=honour.STEP;honour.points++;}
   $('honourPoints').textContent=honour.points;$('honourProgress').style.width=`${(100*honour.xp/honour.STEP).toFixed(1)}%`;
  }
  const VILLAGE_VISION=12;
  const aiHomes=new Map();
  for(const troop of missionData.troops)if(!aiHomes.has(troop.civilization)&&troop.position)aiHomes.set(troop.civilization,{x:troop.position[0],z:troop.position[2]});
  function aiRateFor(civ,field){return missionData.kind==='skirmish'&&civ!==humanCiv&&cpuEnabled&&civByName.get(lower(civ))?.cpu?(aiProfile[field]||1):1;}
  let aiAwareness=null,aiRouteWork=0;
  const world={
   clock:()=>missionClock,text,difficulty,scenarioDifficulty:difficulty,aiDifficulty,kind:missionData.kind,get humanCiv(){return humanCiv;},width:W,depth:D,
   aiHome:civ=>aiHomes.get(civ)||null,
   aiBases:()=>[...aiHomes].filter(([civ])=>!neutralCiv(civ)).map(([civ,point])=>({civ,x:point.x,z:point.z})),
   visibleEnemies:civ=>aiAwareness?.visibleEnemies(civ)||[],
   trainingRate:civ=>aiRateFor(civ,'trainingRate'),
   withAiOrder(squad,fn){
    const grid=navOf(squad),remaining=4096-aiRouteWork;
    if(remaining<=0)return {ok:false,reason:'ai-budget',deferred:true};
    const before=grid.workUnits||0;
    try{return grid.withWorkBudget?grid.withWorkBudget(remaining,fn,{allowPartial:true}):fn();}
    finally{aiRouteWork+=Math.max(0,(grid.workUnits||0)-before);}
   },
   // Civilizations the player commands have no CPU (cpu.js).
   controlled:civ=>civ===humanCiv||!cpuEnabled,
   log:(...args)=>console.debug('[script]',...args),
   after:(seconds,fn)=>timers.push({at:missionClock+seconds,fn}),
   civ:name=>civByName.get(lower(name))||null,
   squads:()=>allSquads,alive:s=>s.members.length>0,centroid:s=>s.members.length?combat.centroid(s):{x:s.x,z:s.z},
   troop:name=>allSquads.find(s=>s.name&&lower(s.name)===lower(name))||null,
   group:name=>{const key='grupo '+lower(name);return allSquads.filter(s=>(s.properties||[]).some(p=>lower(p)===key));},
   inZone:(name,x,z)=>inZone(zones[name]||Object.values(zones).find(zone=>lower(zone.name)===lower(name)),x,z),
   zone:name=>zones[name]||Object.values(zones).find(zone=>lower(zone.name)===lower(name))||null,
   isHostile:civHostile,allied,neutralCiv,
   setAlliance(a,b,on){if(on)alliances.add(a+'|'+b);else{alliances.delete(a+'|'+b);alliances.delete(b+'|'+a);}aiAwareness?.invalidate();refreshSides();},
   setNeutral(name,on){const c=civByName.get(lower(name));if(c){c.neutral=on;aiAwareness?.invalidate();refreshSides();}},
   changeCiv(s,civ){
    s.civ=s.civilization=civByName.get(lower(civ))?.name||civ;
    const side=sideOfCiv(s.civ);if(side!==s.side)moveSquadSide(s,side);
    updateArmyStats();refreshGroupButtons();
   },
   setAggressive:(s,on)=>combat.setAggressive(s,on),
   setHunting:(s,on)=>combat.setHunting(s,on),
   stance(s,stance){combat.setStance(s,stance);combat.setHunting(s,false);combat.setAggressive(s,stance!=='defensive');},
   attack:(s,target)=>combat.attack(s,target),
   moveTo(s,x,z,run){
    if(combat.move(s,{x,z})===false)return false;
    // A point on solid ground (a village's houses, a building): the nearest
    // ground round it where the troop can stand, on its side first.
    const grid=navOf(s);
    if(!grid.canStand(x,z,Math.min(s.radius,1.2))){
     let best=null,bestD=Infinity;
     for(let ring=1;ring<=10&&!best;ring+=.5)for(let k=0;k<24;k++){
      const a=k*Math.PI/12,px=x+Math.cos(a)*ring,pz=z+Math.sin(a)*ring;
      if(!grid.canStand(px,pz,Math.min(s.radius,1.2)))continue;
      const d=Math.hypot(px-s.x,pz-s.z);if(d<bestD){bestD=d;best={x:px,z:pz};}
     }
     if(best){x=best.x;z=best.z;}
    }
    const result=motion.order(s,{x,z},grid);
    if(result.ok)s.running=!!run&&combat.canRun(s);
    // Sent into a fortress whose gate is shut to it: it breaks the gate.
    else if(fortress&&s.side!=='player'&&fortress.contains(x,z)){const gate=closedGateFor(s,null);if(gate)return combat.attackStructure(s,gateTarget(gate));}
    return result.ok;
   },
   hold:(s,on)=>combat.setAggressive(s,!on),
   followRoute(s,name){
    const route=map.mission.patrolRoutes.find(r=>lower(r.name)===lower(name));
    if(route&&s.members.length){for(let i=routeFollowers.length-1;i>=0;i--)if(routeFollowers[i].squad===s)routeFollowers.splice(i,1);routeFollowers.push({squad:s,nodes:route.nodes,next:0});}
   },
   route:name=>map.mission.patrolRoutes.find(r=>lower(r.name)===lower(name))||null,
   isMoving:s=>!!s.isMoving,
   inCombat:s=>['melee','approach','pursue','shoot'].includes(s.combat?.mode),
   damaged:s=>damagedTroops.has(s.name)||!!s.damaged,
   power:type=>gameStats[type]?.power||100,
   kills:civ=>allSquads.filter(s=>civHostile(civ,s.civ)).reduce((n,s)=>n+(s.fallen||0),0),
   setVisible(s,on){s.revealed=on;},
   reveal:(x,z,r,ms)=>revealZones.push({x,z,r,until:missionClock+ms/1000}),
   revealNamed(name,x,z,r,on){if(on)namedReveals.set(name,{x,z,r,until:Infinity});else namedReveals.delete(name);},
   sees:(mine,other)=>mine!==humanCiv||enemySquads.some(s=>s.civ===other&&s.visible&&s.members.length),
   spawn(civ,type,units,x,z,r,name,groupName){
    const kind=kindFor(type);if(!kind||!unitModels[kind]){console.warn('No model for',type);return null;}
    const troop={name:name||`${civ}_${type}_${++spawned}`,type,civilization:civByName.get(lower(civ))?.name||civ,units,position:[x,0,z],orientation:r,
     properties:groupName?['GRUPO '+groupName]:[],formation:''};
    return placeTroop(troop,x,z,r);
   },
   structure(name){
    const e=buildings.find(name);
    if(e)return {x:e.x,z:e.z,type:e.type,owner:e.owner,destroyed:e.state==='destroyed',attacked:missionClock-(e.attackedAt??-1e9)<5,
     built:e.state==='built',builtBy:e.placement?.builtBy||null,life:e.life,entity:e};
    const p=placements.find(p=>p.name&&lower(p.name)===lower(name));if(!p)return null;
    return {x:p.x,z:p.z,type:p.type,owner:structureOwners.get(lower(name))||p.owner||null,destroyed:!!p.destroyed,attacked:missionClock-(p.attackedAt??-1e9)<5,built:!p.construction};
   },
   setStructureOwner(name,civ){structureOwners.set(lower(name),civ);const e=buildings.find(name);if(e)e.owner=civ;return true;},
   garrisonOf:v=>v.garrison||null,
   hostileStructure:(e,civ)=>buildings.hostileTo(e,civ),
   attackStructure:(s,e)=>combat.attackStructure(s,buildings.target(e)),
   canBuild:s=>!!gameStats[s.type]?.flags?.includes('FLAG_PUEDE_CONSTRUIR')&&s.members.length>0,
   isBusy:s=>s.combat?.mode==='siege',
   buildGarrison(s,v){
    const e=buildings.startGarrison(v,s.civ);if(!e)return false;
    scriptGame?.notify('garrisonOrder',{types:[s.type],names:[s.name]});
    return combat.attackStructure(s,buildings.target(e,{work:true}),'work');
   },
   repair(s,e){
    if(e?.state!=='built'||!e.owner||(e.owner!==s.civ&&!allied(e.owner,s.civ)))return false;
    return combat.attackStructure(s,buildings.target(e,{repair:true}),'work');
   },
   // A building site still to finish (bridges at their ANDAMIO), for the CPU.
   site:name=>{const e=buildings.find(name);return e&&e.state==='site'?{x:e.x,z:e.z,entity:e}:null;},
   buildSite(s,name){const e=buildings.find(name);if(!e||e.state!=='site')return false;return combat.attackStructure(s,buildings.target(e,{work:true}),'work');},
   buildingBridge:civ=>buildings.entities.some(e=>e.kind==='PUENTE'&&e.state==='site'&&e.progress>0&&(!civ||e.builtBy===civ)),
   // PonerVidaEnte / PonerFuegoEnte on a structure.
   setLife(name,life){const e=buildings.find(name);if(e&&e.state==='built'){e.life=Math.max(1,Math.min(e.maxLife,life));buildings.refresh(e);}},
   setFire(name,fire){const e=buildings.find(name);if(e)buildings.setFire(e,fire);},
   burning(type){return buildings.entities.some(e=>e.state==='built'&&buildings.burning(e)&&(!type||lower(e.type)===lower(type)));},
   honour(civ,points){if(civ===humanCiv&&Number.isFinite(points))gainHonour(points);},
   restrict(order,type,civ,on){
    const key=type?order+'|'+type:order;
    if(on)orderRestrictions.add(key);else orderRestrictions.delete(key);
    refreshCommands();
   },
   ping(civ,x,z){pings.push({x,z,until:missionClock+6,color:civColor(civ)});},
   rain(amount){raining=amount;missionUi.setRain(amount);},
   lightning(){},
   pause(on){logicPaused=!!on;},
   setInterrupt(h){interruptHandle=h;},
   end(victory,entries){if(missionEnded)return;finishMission(victory,entries);},
   sound:{speak:code=>sound?sound.speak(code):Promise.resolve({played:false}),play:code=>sound?.play(code),silence:()=>sound?.silence()},
   camera:{position:()=>({x:camera.target.x,z:camera.target.z}),
    lookAt(x,z){camera.target.x=x;camera.target.z=z;resetCameraMotion();},
    run:(groups,callbacks)=>cameraJob(groups,callbacks)},
   ui:{objectives:list=>missionUi.objectives.set(list),notice:(t,kind)=>missionUi.objectives.notice(t,kind),
    openObjectives:()=>missionUi.objectives.open(),
    presentation(title,place){
     if(title==null){missionUi.presentation.hide();presentationShown=false;}
     else{missionUi.presentation(title,place);presentationShown=true;}
    },
    cinema:on=>missionUi.cinema.on(on),subtitle:t=>missionUi.cinema.say(t),message:t=>missionUi.objectives.notice(t),
    tutorial:{on:(next,close)=>missionUi.tutorial.on(next,close),show:(...a)=>missionUi.tutorial.show(...a),hide:()=>missionUi.tutorial.hide()}}
  };
  // Villages, the CPU and the script (every mission but Tutorial I's port).
  let villages=null,cpu=null,scriptGame=null,scriptEngine=null;
  aiAwareness=window.PraetoriansAiAwareness.create({squads:()=>allSquads,villages:()=>villages?.villages||[],
   alive:world.alive,allied,hostile:civHostile,centroid:world.centroid,spread:combat.spread,groundY,inForest,clock:()=>missionClock,
   concealedSight:combat.CONCEALED_SIGHT,villageVision:VILLAGE_VISION});
  function villageEvent(kind,data){
   const v=data.village,name=v.label?text(v.label):v.named===false?'Le village':v.name;
   // The results screen's UNITÉS FORMÉES: soldiers trained.
   if(kind==='trained'&&data.squad)statsOf(data.job.civ).trained+=data.squad.members.length;
   if(kind==='captured'){
    for(const s of [...v.inside])if(s.civ!==data.civ&&!allied(s.civ,data.civ))leaveVillage(s);
    if(data.civ===humanCiv)missionUi.objectives.notice(`${name} : village conquis`,'done');
    else if(data.previous===humanCiv)missionUi.objectives.notice(`${name} : village perdu`,'failed');
    refreshVillagePanel();
   }else if(kind==='trained'&&data.job.civ===humanCiv&&data.squad){
    syncVoices();troopVoices.message('trained');
    toast(`${unitTitles[data.job.type]||data.job.type} : entraînement terminé (${name}).`);
    if(v.rally)issueMove(data.squad,{x:v.rally.x,z:v.rally.z});
    scriptGame?.notify('trained',{types:[data.job.type],names:[data.squad.name]});
   }
  }
  let mission;
  if(isTutorial1)mission=window.PraetoriansTutorial1.create(missionApi);
  else{
   // Legacy CPU fallback can assign ownership by presence. Ownership alone
   // does not satisfy the separate completed-garrison requirement for entry.
   villages=window.PraetoriansVillages.create({world,defs:buildingData.structures,placements,units:gameStats,races,onEvent:villageEvent,presence:civ=>civ!==humanCiv,trainingRate:civ=>aiRateFor(civ,'trainingRate')});
   buildings.link(villages);
   cpu=window.PraetoriansCpu.create({world,villages,units:gameStats,races});
   scriptGame=window.PraetoriansScriptGame.create({world,villages,cpu});
   if(scriptSource){
    try{scriptEngine=window.PraetoriansScript.create(scriptSource,scriptGame.library,{name:launch.mission,clock:()=>missionClock,
     log:(kind,...args)=>(kind==='error'?console.error:console.debug)('[script]',kind,...args)});}
    catch(error){console.error('Mission script',error);}
   }
   // Skirmish: every CPU player gets the skirmish planner.
   if(missionData.kind==='skirmish')for(const civ of missionData.civilizations.filter(c=>c.cpu)){
    const s=cpu.strategy('skirmish');cpu.assign(civ.name,s);cpu.start(s);
   }
   let ruleTimer=2;
   mission={
    update(dt=0){
     scriptEngine?.update();
     for(let i=timers.length-1;i>=0;i--)if(timers[i].at<=missionClock){const t=timers.splice(i,1)[0];t.fn();}
     if((ruleTimer-=dt)>0||missionEnded)return;ruleTimer=2;
     // A skirmish team survives while any of its armies survives. Campaign
     // fallback missions retain their individual elimination condition.
     if(scriptEngine)return;
     if(missionData.kind==='skirmish'){
      const outcome=window.PraetoriansSkirmishSetup.eliminationOutcome(humanCiv,
       allSquads.filter(s=>s.members.length).map(s=>s.civ),missionData.civilizations,allied);
      if(outcome==='defeat')world.end(false,[{text:'Survivre',state:'failed'}]);
      else if(outcome==='victory')world.end(true,[{text:'Vaincre tous les adversaires',state:'done'}]);
      return;
     }
     const mine=allSquads.some(s=>s.civ===humanCiv&&s.members.length);
     const foes=allSquads.some(s=>civHostile(humanCiv,s.civ)&&s.members.length);
     if(!mine)world.end(false,[{text:'Survivre',state:'failed'}]);
     else if(!foes)world.end(true,[{text:'Vaincre tous les adversaires',state:'done'}]);
    },
    onAction:(kind,data)=>scriptGame.notify(kind,data)
   };
   if(!scriptSource&&missionData.kind!=='skirmish')missionUi.objectives.set([{text:'Détruire les forces ennemies',state:'open'}]);
   if(missionData.kind==='skirmish')missionUi.objectives.set([{text:'Vaincre tous les adversaires',state:'open'},{text:'Conquérir les villages',state:'open'}]);
  }
  function tickMission(dt){
   missionClock+=dt;
   for(let i=missionWaits.length-1;i>=0;i--)if(missionWaits[i].at<=missionClock){missionWaits[i].done();missionWaits.splice(i,1);}
   if(cinematicFrame)cinematicFrame(dt);
   mission.update(dt);
  }
  // ---- Fortress: gates held, attacked and broken --------------------------------
  // A gate is held by the side inside the fortress and lets it and its allies
  // through. Enemies break it with their weapons against buildings (combat
  // attackStructure); a broken gate is open to all. When the holder has
  // nobody left inside, the fortress passes to whoever is.
  function gatesChanged(){
   navCache.clear();nav=buildNav(gate=>gateOpenFor(gate,null));
   for(const s of allSquads)if(s.members.length)s.nav=navOf(s);
   if(restrictions){restrictions.material.emissiveTexture?.dispose();restrictions.material.dispose();restrictions.dispose();restrictions=null;}refreshDebugViews();
   for(const s of allSquads)stepAside(s);
  }
  function buildingObstaclesChanged(e){
   // A garrison's scaffold/finished outline changes a small patch of solid
   // ground. Refresh existing profile grids instead of rebuilding terrain
   // and logical-map data for every army when each site begins or finishes.
   if(!e){gatesChanged();return;}
   const reach=e.radius+.1,bounds={xMin:e.x-reach,xMax:e.x+reach,zMin:e.z-reach,zMax:e.z+reach};
   for(const grid of new Set([nav,...navCache.values()]))grid.refreshObstacles(bounds);
   disposeVillageDebugOverlay(); // grid object is unchanged, but its obstacles changed
   if(restrictions){restrictions.material.emissiveTexture?.dispose();restrictions.material.dispose();restrictions.dispose();restrictions=null;}refreshDebugViews();
   for(const s of allSquads)stepAside(s);
  }
  // Nobody is left inside what has just become solid: a troop standing there
  // forms up on the nearest free ground.
  function stepAside(s){
   // A crew at work stands round the building, man by man.
   if(!s.members.length||s.sheltered||s.inVillage||s.hidden||combat.isFormationLocked(s)||s.combat?.mode==='siege'||fortress?.onTop(s.x,s.z))return;
   const grid=navOf(s);
   if(grid.canStand(s.x,s.z,.3)&&s.members.every(m=>grid.canStand(m.x,m.z,.2)))return;
   for(let r=.5;r<=10;r+=.5)for(let a=0;a<16;a++){
    const x=s.x+Math.cos(a*Math.PI/8)*r,z=s.z+Math.sin(a*Math.PI/8)*r;
    if(grid.canStand(x,z,Math.min(s.radius,1.2))){cancelMobilePreparation(s);if(combat.move(s,{x,z})===false)return;motion.arrange(s,grid,groundY,{x,z});refreshSquadInstances(s);return;}
   }
  }
  // A new garrison or tower site: the troops standing on it walk off first
  // (its own builders go to their places round it); then it stands in the way.
  let siteTimer=0;
  function clearSites(dt){
   if((siteTimer-=dt)>0)return;siteTimer=.5;
   for(const e of [...buildings.entities]){
    if(e.state!=='site')continue;
    // Not begun: only a place its builders are marching to. Given up when
    // nobody is on the way any more (they were sent elsewhere).
    if(e.pending){
     const heading=allSquads.some(s=>s.members.length&&s.combat?.structure?.entity===e);
     e.unattended=heading?0:(e.unattended||0)+.5;
     if(e.unattended>=2)buildings.cancelSite(e);
     continue;
    }
    if(!e.clearing)continue;
    e.clearingTime=(e.clearingTime||0)+.5;
    const crowd=allSquads.filter(s=>s.members.length&&!s.hidden&&s.members.some(m=>buildings.covers(e,m.x,m.z,.1)));
    // A site waits for deliberately planted troops to be raised. It may
    // never seal underneath them and force the formation to another place.
    if(crowd.some(s=>combat.isFormationLocked(s)))continue;
    // Its own builders step out to its edges; bystanders get ten seconds.
    const crew=s=>s.combat?.structure?.entity===e;
    // ...and it stays open while its crew is still on its way onto it.
    const coming=allSquads.some(s=>s.members.length&&crew(s)&&!s.combat.places);
    if(!coming&&(!crowd.length||(e.clearingTime>10&&!crowd.some(crew)))){buildings.blockSite(e);continue;}
    for(const s of crowd){
     // A crew working at a neighbouring site (machines are built side by
     // side) keeps working: moving it would end its job. It steps out of
     // this site's ground when its own is done (combat endSiege).
     if(crew(s)||s.isMoving||s.combat?.mode==='siege'||(s.combat?.mode==='melee'&&s.combat.engaged))continue;
     const dx=s.x-e.x,dz=s.z-e.z,d=Math.hypot(dx,dz)||1,ux=d>.2?dx/d:1,uz=d>.2?dz/d:0,far=e.radius+s.radius+1.5;
     world.moveTo(s,e.x+ux*far,e.z+uz*far,false);
    }
   }
  }
  // ---- Buildings: attacked, raised, sheltering troops --------------------------------
  buildingHooks.show=showStructure;
  // A model's footprint on the ground (local x, z): the convex hull of its
  // vertices within half a metre of its lowest point. Builders line it.
  const footprints=new Map();
  buildingHooks.footprint=name=>{
   if(!name||!models.models[name])return null;
   if(footprints.has(name))return footprints.get(name);
   let low=Infinity;const pts=[];
   for(const g of models.models[name].groups)if(!g.isShadow)for(let i=1;i<g.positions.length;i+=3)low=Math.min(low,g.positions[i]);
   for(const g of models.models[name].groups)if(!g.isShadow)for(let i=0;i<g.positions.length;i+=3)if(g.positions[i+1]<low+.5)pts.push([g.positions[i],g.positions[i+2]]);
   pts.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
   const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),lower=[],upper=[];
   for(const p of pts){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}
   for(const p of pts.reverse()){while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}
   const hull=pts.length>=3?lower.slice(0,-1).concat(upper.slice(0,-1)):null;
   footprints.set(name,hull);return hull;
  };
  // ---- Burning buildings (src/render/fire.js) -------------------------------------
  const burning=window.PraetoriansFire.create({B,scene,groundY});
  // The top of a model (its tallest vertex), for how high the fire climbs.
  const heightOf=name=>{let top=0;for(const g of models.models[name]?.groups||[])if(!g.isShadow)for(let i=1;i<g.positions.length;i+=3)top=Math.max(top,g.positions[i]);return top||4;};
  buildingHooks.fire=(e,level)=>{
   // Remember buildings, never a live fire or its smoke through the fog.
   if(!structureObserved(e)){burning.hide(e);return;}
   const shape=e.outline.map(([lx,lz])=>({x:e.x+lx*Math.cos(e.r)+lz*Math.sin(e.r),z:e.z-lx*Math.sin(e.r)+lz*Math.cos(e.r)}));
   burning.set(e,level,shape,heightOf(e.shown||e.def.parts?.[0]?.model));
  };
  function refreshStructureVisibility(){
   for(const e of buildings.entities){
    structureEntities.set(e.placement||e,e);
    structureKnowledge.observe(humanCiv,e,{visible:vision.seen(e.x,e.z),friendly:friendlyOwner(e.owner)});
    buildingHooks.fire(e,e.fireShown||0);
   }
   // Replaced ruins can leave the simulation list while their last smoke
   // particles are fading. They must disappear behind fog as well.
   for(const e of structureEntities.values())if(!structureObserved(e))burning.hide(e);
   for(const v of villages?.villages||[])structureKnowledge.observeVillage(humanCiv,v,{visible:vision.seen(v.x,v.z),friendly:friendlyOwner(v.owner)});
   batchingParts=true;
   try{for(const record of structureParts)refreshPartVisibility(record);}
   finally{batchingParts=false;flushPartModels();}
   // Panels/cursors must not keep reading live enemy state once sight ends.
   if(selectedStructure&&!structureObserved(selectedStructure))selectStructure(null);
   if(selectedVillage&&!structureObserved(selectedVillage))selectVillage(null);
  }
  buildingHooks.obstaclesChanged=buildingObstaclesChanged;
  buildingHooks.bridgeBuilt=e=>{
   const placement={...(e.placement||{}),type:e.type,x:e.x,y:e.placement?.y??groundY(e.x,e.z),z:e.z,r:e.r};
   if(structures.add(placement))structures.patchHeights(map.terrain.heights,map.terrain.width,map.terrain.depth,map.terrain.spacing||.5);
   gatesChanged();
  };
  buildingHooks.machineBuilt=e=>{
   const troop={name:`${e.owner}_${e.type}_${++spawned}`,type:e.type,civilization:e.owner,units:1,position:[e.x,0,e.z],orientation:e.r,properties:[],formation:''};
   return placeTroop(troop,e.x,e.z,e.r);
  };
  buildingHooks.event=(kind,data)=>{
   const e=data.entity,title=e?(e.def?.label?text(e.def.label):e.type):'';
   if((e?.owner||data.civ)===humanCiv){syncVoices();if(kind==='attacked')troopVoices.message('village');else if(kind==='built'||kind==='machineBuilt')troopVoices.message('built');}
   if(kind==='destroyed'){
    if(structureObserved(e))sound?.play('UMOR',{x:e.x,z:e.z});
    if(e.owner===humanCiv)toast(`${title} : détruit !`);else if(data.by?.civ===humanCiv)toast(`${title} ennemi détruit.`);
   }else if(kind==='built'){
    if(e.owner===humanCiv)toast(`${title} : construction terminée.`);
    scriptGame?.notify('built',{types:[e.type],names:[e.name].filter(Boolean)});
   }else if(kind==='machineBuilt'){
    if(data.civ===humanCiv)toast(`${unitTitles[e.type]||text(gameStats[e.type]?.name||'')||e.type} : construction terminée.`);
    scriptGame?.notify('machineBuilt',{types:[e.type]});
   }else if(kind==='captured')villageEvent('captured',data);
   else if(kind==='villageLost'){const v=data.village;for(const s of [...v.inside])leaveVillage(s);if(data.previous===humanCiv)missionUi.objectives.notice(`${v.label?text(v.label):v.named===false?'Village':v.name} : garnison perdue`,'failed');refreshVillagePanel();}
   else if(kind==='unsheltered'){const s=data.squad;if(s.members.length){s.nav=navOf(s);motion.arrange(s,s.nav,groundY,data.door,s.r);}}
  };
  // Stormed: the defenders come down and the attackers fall on them.
  buildingHooks.assault=(e,by)=>{
   const defenders=[...e.occupants];
   for(const s of defenders){buildings.leave(s);if(s.members.length)combat.attack(by,s);}
  };
  // A mission script sends a troop into a watchtower (InteractuarTropaConEnte).
  world.enterStructure=(s,name)=>{
   const e=buildings.find(name);if(!e||e.kind!=='TORRE_DEFENSA'||e.state!=='built')return false;
   if(Math.hypot(s.x-e.x,s.z-e.z)<e.radius+10){buildings.enter(e,s,{force:true});refreshSquadInstances(s);return true;}
   const door=buildings.target(e).approach({x:s.x,z:s.z});
   cancelMobilePreparation(s);if(combat.move(s,door)===false)return false;
   if(motion.order(s,door,navOf(s)).ok){s.enterTower=e;s.enterForce=true;}
   return true;
  };
  buildings.refreshAll();
  const canBuild=s=>world.canBuild(s);
  // Troops ordered to build: each works at the site (combat job 'work').
  // run (a double right-click): the troops run there.
  let runOrder=false;
  function sendBuilders(list,e){
   const sent=[];for(const s of list){cancelMobilePreparation(s);s.orderQueue=null;if(sheltered(s))continue;if(combat.attackStructure(s,buildings.target(e,{work:true}),'work',{run:runOrder}))sent.push(s);}
   answer(sent.length?sent:list,sent.length?'G':'B');return sent.length;
  }
  const sheltered=s=>{if(!s.sheltered)return false;buildings.leave(s);return false;};
  function attackStructureWith(e){
   if(!structureObserved(e))return;
   const armed=selectedSquads.filter(s=>!s.profile?.noAttack);
   const accepted=armed.filter(s=>{cancelMobilePreparation(s);s.orderQueue=null;sheltered(s);return combat.attackStructure(s,buildings.target(e),'attack',{run:runOrder});}),count=accepted.length;
   answer(count?accepted:selectedSquads,count?(runOrder?'T':'A'):'U');
   setPending(null);redrawRoute();
   const title=e.def?.label?text(e.def.label):e.type;
   const ablaze=buildings.target(e).fireFull();
   toast(count?`${count} troupe(s) attaquent${runOrder?' au pas de course':''} : ${title}.`:ablaze?`${title} brûle déjà de toutes parts : les flèches enflammées n’y peuvent plus rien.`:'Ces troupes ne peuvent pas attaquer ce bâtiment.');
  }
  // Right click on a structure or a village: what the selected troops do there.
  function structureOrder(p){
   const e=visibleStructureAt(p.x,p.z);
   if(e){
    if(buildings.hostileTo(e,humanCiv)){attackStructureWith(e);return true;}
    if(e.state==='site'&&(!e.owner||e.owner===humanCiv||allied(e.owner,humanCiv))){
     const crew=selectedSquads.filter(canBuild);
     if(crew.length){const n=sendBuilders(crew,e);toast(n?`${n} troupe(s) construisent${runOrder?' (au pas de course)':''}.`:'Ces troupes ne peuvent pas construire.');return true;}
    }
    // Builders mend their own damaged structures (ORDEN_REPARAR).
    if(e.state==='built'&&(e.life<e.maxLife||e.fire>0)&&(e.owner===humanCiv||allied(e.owner,humanCiv))&&!orderRestrictions.has('ORDEN_REPARAR')){
     const crew=selectedSquads.filter(canBuild);
     if(crew.length){let n=0;for(const s of crew){cancelMobilePreparation(s);s.orderQueue=null;if(combat.attackStructure(s,buildings.target(e,{repair:true}),'work'))n++;}toast(n?`${n} troupe(s) réparent.`:'Ces troupes ne peuvent pas réparer.');return true;}
    }
    if(e.kind==='TORRE_DEFENSA'&&e.state==='built'){
     const s=selectedSquads.find(q=>!gameStats[q.type]?.flags?.includes('FLAG_NO_ATAQUE')&&!/CABALLERIA|CUADRIGA/.test(gameStats[q.type]?.base||'')&&(gameStats[q.type]?.maxSoldiers||0)>1);
     if(s&&buildings.canShelter(e,s)){
      const door=buildings.target(e).approach({x:s.x,z:s.z});
      cancelMobilePreparation(s);if(combat.move(s,door)===false){toast(s.blockedReason||ENGAGED);return true;}s.orderQueue=null;
      if(motion.order(s,door,navOf(s)).ok){s.enterTower=e;toast(`${unitTitles[s.type]||s.type} : vers la tour.`);}
      return true;
     }
    }
   }
   const v=villageAt(p);
   // A centurion goes into his own village (recruiting is done from inside).
   if(v&&(v.owner===humanCiv||(v.owner&&allied(v.owner,humanCiv)))){
    const going=selectedSquads.filter(isCenturion);
    if(going.length&&villages.canEnter(v,humanCiv)){
     let sent=0;
     for(const s of going){
      combat.move(s);s.orderQueue=null;if(s.sheltered)buildings.leave(s);
      if(s.inVillage===v)continue;if(s.inVillage)leaveVillage(s);
      if(motion.order(s,v.entry,navOf(s)).ok){s.enterVillage=v;sent++;}
     }
     toast(sent?`Le centurion entre ${v.named===false?'dans le village':'à '+(v.label?text(v.label):v.name)}.`:'Aucun chemin praticable jusqu’à l’entrée du village.');
     return true;
    }
    if(going.length&&!selectedSquads.some(canBuild)){
     toast('Terminez la construction d’une garnison avant de faire entrer le centurion.');return true;
    }
   }
   if(v&&(v.owner!==humanCiv||!villages.canEnter(v,humanCiv))){
    const crew=selectedSquads.filter(canBuild);
    const standing=v.garrison&&v.garrison.state!=='destroyed'&&!(v.garrison.state==='site'&&v.garrison.owner===humanCiv);
    if(crew.length&&!standing){
     const site=buildings.startGarrison(v,humanCiv);
     if(site){const n=sendBuilders(crew,site);mission.onAction('garrisonOrder',{types:crew.map(s=>s.type),names:crew.map(s=>s.name)});
      toast(n?`Construction d’une garnison${v.named===false?'':' à '+(v.label?text(v.label):v.name)}${runOrder?' (au pas de course)':''}.`:'Ces troupes ne peuvent pas construire.');return true;}
    }
    if(standing&&structureObserved(v.garrison)&&v.garrison.state==='built'&&buildings.hostileTo(v.garrison,humanCiv)&&!crew.length){attackStructureWith(v.garrison);return true;}
   }
   return false;
  }
  // ---- Ladders and assault towers against the walls (FLAG_PUEDE_ASALTAR) ----------
  const assaults=s=>!!gameStats[s.type]?.flags?.includes('FLAG_PUEDE_ASALTAR');
  function ladderOrder(p){
   if(!fortress)return false;
   const machines=selectedSquads.filter(assaults);if(!machines.length)return false;
   const spot=fortress.ladderSpot(p.x,p.z,5);if(!spot)return false;
   let sent=0;
   for(const s of machines){
    combat.move(s);s.orderQueue=null;undeploy(s);
    if(motion.order(s,{x:spot.x,z:spot.z},navOf(s),Math.atan2(Math.cos(spot.r),-Math.sin(spot.r))).ok){s.deployAt=spot;sent++;}
   }
   toast(sent?'L’échelle avance vers la muraille.':'Aucun chemin jusqu’à la muraille.');
   return true;
  }
  function undeploy(s){
   if(!s.deployedLadder)return;
   fortress.removeLadder(s.deployedLadder);s.deployedLadder=null;gatesChanged();
   if(s.ladderVisual){showStructure(s.ladderVisual,null);s.ladderVisual=null;s.hidden=false;refreshSquadInstances(s);}
  }
  function updateMachines(){
   for(const s of allSquads){
    if(s.deployedLadder&&(!s.members.length||s.isMoving))undeploy(s);
    if(s.deployAt&&s.members.length&&!s.isMoving){
     const spot=s.deployAt;s.deployAt=null;
     if(Math.hypot(s.x-spot.x,s.z-spot.z)<2.5){
      const ladder=fortress.addLadder(s.x,s.z,spot.r,'siege-'+s.name);
      if(ladder){
       s.deployedLadder=ladder.id;gatesChanged();if(s.side==='player')toast('Échelle posée contre la muraille.');
       // A ladder leans on the wall (the fixed ladders' model); an assault
       // tower stands against it as it is.
       if(/^ESCALA/.test(s.type)){s.ladderVisual={x:s.x,z:s.z,r:spot.r,placement:null};showStructure(s.ladderVisual,'tce_escala_fija');s.hidden=true;refreshSquadInstances(s);}
      }
     }
    }
    // Into the watchtower once at its door.
    if(s.enterTower&&s.members.length&&!s.isMoving){
     const e=s.enterTower;s.enterTower=null;
     if(Math.hypot(s.x-e.x,s.z-e.z)<e.radius+3&&buildings.enter(e,s,{force:!!s.enterForce})){refreshSquadInstances(s);if(s.side==='player')toast('Troupe à l’abri dans la tour.');}
     s.enterForce=false;
    }
    // Into the village once at its entrance (a centurion).
    if(s.enterVillage&&!villages?.canEnter(s.enterVillage,s.civ))s.enterVillage=null;
    if(s.enterVillage&&s.members.length&&!s.isMoving){
     const v=s.enterVillage;s.enterVillage=null;
     if(Math.hypot(s.x-v.entry.x,s.z-v.entry.z)<3)enterVillage(s,v);
    }
   }
  }
  // ---- Construction (ORDEN_CONSTRUIR, the command panel's third tab), demotion
  // (ORDEN_TRANSFORMAR_A_LIGERA) and promotion (ORDEN_TRANSFORMAR_A_CENTURION) ----
  function buildOptions(){
   if(!selectedSquads.some(canBuild)||orderRestrictions.has('ORDEN_CONSTRUIR'))return [];
   return buildings.buildable(humanCiv,{campaign:missionData.kind!=='skirmish'}).filter(o=>!orderRestrictions.has('ORDEN_CONSTRUIR|'+o.type)
    &&(o.kind!=='machine'||(kindFor(o.type)&&unitModels[kindFor(o.type)]))
    &&(o.kind!=='bridge'||buildings.entities.some(e=>e.scaffold&&e.state==='site')));
  }
  function openBuildPanel(){
   if(!buildOptions().length){toast(selectedSquads.some(canBuild)?'Rien à construire ici.':'Seule l’infanterie auxiliaire construit.');return;}
   commandPanel.open('construction');
  }
  function buildPreviewParts(type){
   if(gameStats[type]?.construction){
    const model=unitModels[kindFor(type)];return model?[{model,unit:true}]:[];
   }
   return (buildingData.structures[type]?.parts||[]).filter(part=>models.models[part.model]).map(part=>({...part,model:models.models[part.model]}));
  }
  const placementRules=window.PraetoriansBuildPlacement.create({defs:buildingData.structures,units:gameStats,width:W,depth:D,groundY,
   seen:(x,z)=>structureVisionReady&&vision.seen(x,z),
   navFor:type=>gameStats[type]?.construction?navFor(humanCiv,rulesFor(type)):navOf(selectedSquads.find(canBuild)),
   entities:()=>buildings.entities,classify:(x,z)=>navStructures.classify(x,z),
   footprint:type=>{
    if(!gameStats[type]?.construction)return null;
    const points=[];
    for(const group of unitModels[kindFor(type)]?.groups||[])if(!group.isShadow)for(let i=0;i<group.positions.length;i+=3)points.push([group.positions[i],group.positions[i+2]]);
    return points;
   }});
  const buildPreview=window.PraetoriansBuildPreview.create({B,scene,groundY,resolveParts:buildPreviewParts,
   materialForGroup:(group,part)=>part.unit?unitMaterial(group,colourIndex(humanCiv)):modelMaterial(group)});
  let constructionPreviewState=null;
  function buildingPlacement(type,p){
   const crew=selectedSquads.filter(s=>s.members.length&&s.civ===humanCiv&&canBuild(s));
   if(!crew.length)return {ok:false,reason:'selection',message:'Sélectionnez une troupe capable de construire.',type};
   if(!p||![p.x,p.z].every(Number.isFinite))return {ok:false,reason:'position',message:'Choisissez un emplacement sur la carte.',type};
   if(!buildOptions().some(option=>option.type===type))return {ok:false,reason:'type',message:'Cette construction n’est pas disponible.',type,x:p.x,z:p.z,r:0};
   const centre=crew.reduce((a,s)=>({x:a.x+s.x/crew.length,z:a.z+s.z/crew.length}),{x:0,z:0});
   const position={x:p.x,z:p.z,r:Number.isFinite(p.r)?p.r:Math.atan2(centre.x-p.x,centre.z-p.z)};
   if(buildingData.structures[type]?.kind==='PUENTE'){
    if(!structureVisionReady||!vision.seen(p.x,p.z))return {...position,type,ok:false,reason:'visibility',message:'Explorez cet emplacement avant de construire.'};
    const site=buildings.entities.filter(e=>structureObserved(e)&&e.scaffold&&e.state==='site'&&e.type===type&&(!e.owner||e.owner===humanCiv||allied(e.owner,humanCiv)))
     .sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
    if(!site||Math.hypot(site.x-p.x,site.z-p.z)>12)return {...position,type,ok:false,reason:'bridge-site',message:'Cliquez sur un chantier de pont, au bord de la rivière.'};
    return {ok:true,type,x:site.x,z:site.z,r:site.r||0,site,message:'Chantier de pont disponible.'};
   }
   const result={...placementRules.check(type,{...position,civ:humanCiv}),...position,type};
   if(result.ok&&result.footprint?.length&&allSquads.some(s=>s.members.length&&!s.hidden&&(s.side==='player'||s.visible)&&combat.isFormationLocked(s)&&s.members.some(m=>
    window.PraetoriansBuildPlacement.overlaps(result.footprint,[{x:m.x-.2,z:m.z-.2},{x:m.x+.2,z:m.z-.2},{x:m.x+.2,z:m.z+.2},{x:m.x-.2,z:m.z+.2}],0)))){
    return {...result,ok:false,reason:'stationary-troops',message:combat.FORMATION_LOCKED};
   }
   return result;
  }
  function placeBuilding(type,p){
   const placement=buildingPlacement(type,p);
   if(!placement.ok){answer(selectedSquads,'B');toast(placement.message);if(placement.reason==='selection')setPending(null);return false;}
   const crew=selectedSquads.filter(canBuild),def=buildingData.structures[type];
   const site=placement.site||buildings.startSite(type,placement.x,placement.z,placement.r,humanCiv);
   if(!site){toast('Impossible de commencer cette construction.');return false;}
   setPending(null);
   const n=sendBuilders(crew,site);
   toast(n?`${n} troupe(s) construisent : ${def?.label?text(def.label):unitTitles[type]||text(gameStats[type]?.name||'')||type}.`:'Ces troupes ne peuvent pas construire.');
   return n>0;
  }
  // Any troop but the race's basic infantry, heroes, scouts and machines.
  function demotable(s){
   const unit=gameStats[s.type],target=races[unit?.race]?.demotion;
   return !!target&&target!==s.type&&s.members.length>0&&(unit.maxSoldiers||0)>1&&!/HEROE|CENTURION|EXPLORADOR|MEDICO|MENSAJERO/.test(s.type)&&!unit.construction&&reorganisable(s)&&!s.sheltered;
  }
  // ---- Promotion and demotion in the race's tent ----------------------------------
  // As in the game, the ordered troop stops and shelters in its race's tent
  // (DefRazas TIENDA: the small one for a dozen men or fewer) for
  // TRANSFORM_TIME seconds. Its only order meanwhile calls it off (Annuler
  // promotion / Annuler dégradation); being hit or caught in a fight calls it
  // off too. Then one soldier comes out a centurion and the troop keeps the
  // others (30/30 becomes 29/30), or the whole troop comes out as the race's
  // basic infantry.
  const TRANSFORM_TIME=3,transforming=new Set();
  function tentFor(s){
   const tents=races[gameStats[s.type]?.race]?.tents||[];
   return (s.members.length<=12?tents[0]:tents[tents.length-1])||null;
  }
  function startTransform(s,kind){
   cancelFormation(s);combat.resetFormation(s);
   combat.move(s);s.orderQueue=null;clearStanding(s);motion.stop(s);
   const c=combat.centroid(s),tent=tentFor(s);
   s.transform={kind,left:TRANSFORM_TIME,visual:tent?{x:c.x,z:c.z,r:s.r,placement:null}:null};
   if(tent)showStructure(s.transform.visual,tent);
   s.hidden=true;refreshSquadInstances(s);transforming.add(s);
   mission.onAction(kind,{types:[s.type],names:[s.name]});
  }
  // The troop comes out of its tent (done, called off, or wiped out).
  function leaveTent(s){
   const t=s.transform;if(!t)return null;
   s.transform=null;transforming.delete(s);
   if(t.visual)showStructure(t.visual,null);
   s.hidden=false;refreshSquadInstances(s);
   return t;
  }
  function cancelTransform(s,reason){
   const t=leaveTent(s);if(!t)return;
   if(s.side==='player'&&reason)toast(`${unitTitles[s.type]||s.type} : ${t.kind==='promote'?'promotion':'dégradation'} ${reason}.`);
   if(selectedSquads.includes(s)){refreshCommands();refreshSelectionPanel();}
  }
  function cancelSelectedTransforms(){for(const s of selectedSquads)cancelTransform(s,'annulée');}
  function updateTransforms(dt){
   for(const s of [...transforming]){
    if(!s.members.length){leaveTent(s);continue;}
    if(['melee','approach'].includes(s.combat?.mode)){cancelTransform(s,'interrompue : la troupe est attaquée');continue;}
    if((s.transform.left-=dt)>0)continue;
    const {kind}=leaveTent(s);
    if(kind==='promote')completePromotion(s);else completeDemotion(s);
   }
  }
  function degradeSelected(){
   if(orderRestrictions.has('ORDEN_TRANSFORMAR_A_LIGERA')){toast('Ordre indisponible.');return;}
   const list=selectedSquads.filter(demotable);if(!list.length){toast('Aucune troupe à dégrader.');return;}
   for(const s of list)startTransform(s,'degrade');
   const type=races[gameStats[list[0].type].race].demotion;
   toast(`${list.length} troupe(s) dans leur tente : dégradation en ${unitTitles[type]||type} dans ${TRANSFORM_TIME} s.`);
  }
  function completeDemotion(s){
   const type=races[gameStats[s.type].race].demotion,c=combat.centroid(s),chosen=selectedSquads.includes(s);
   const troop={name:`${s.name}_L`,type,civilization:s.civilization||s.civ,units:s.members.length,position:[c.x,0,c.z],orientation:s.r,properties:[...(s.properties||[])],formation:''};
   retire(s);
   const next=placeTroop(troop,c.x,c.z,s.r);
   if(!next){toast('Pas de place pour la nouvelle troupe.');return;}
   if(chosen)setSelection([...selectedSquads.filter(q=>q!==s&&q.members.length),next]);
   refreshGroupButtons();updateArmyStats();
   if(s.side==='player')toast(`${unitTitles[s.type]||s.type} dégradée en ${unitTitles[type]||type}.`);
  }
  // A troop of the race's basic infantry (the auxiliaries) becomes its
  // centurion (DefRazas UNIDAD_CENTURION). "100 Points de Contrôle d'Unité
  // donnent droit à un Centurion" (LTEXT_TIP4): the army's command points
  // (PCU a soldier, the population counter) allow one centurion a hundred.
  const PCU_PER_CENTURION=100;
  // Declared, not const: the army counter (updateArmyStats) reads it while loading.
  function commandPoints(){return squads.reduce((n,s)=>n+s.members.length*(gameStats[s.type]?.training?.pcu??1),0);}
  function centurionsAllowed(){return Math.floor(commandPoints()/PCU_PER_CENTURION);}
  function promotable(s){
   const race=races[gameStats[s.type]?.race],type=race?.centurion;
   return !!type&&race.demotion===s.type&&s.members.length>0&&!!unitModels[kindFor(type)]&&reorganisable(s)&&!s.sheltered&&!s.inVillage;
  }
  // Centurions, with those already in a tent being promoted.
  const centurionCount=()=>squads.filter(isCenturion).length+[...transforming].filter(s=>s.transform.kind==='promote').length;
  const noRoomForCenturion=have=>`${PCU_PER_CENTURION} points de contrôle d’unité donnent droit à un centurion : votre armée en a ${commandPoints()} pour ${have} centurion(s).`;
  function promoteSelected(){
   if(orderRestrictions.has('ORDEN_TRANSFORMAR_A_CENTURION')){toast('Ordre indisponible.');return;}
   const s=selectedSquads.find(promotable);if(!s){toast('Seule l’infanterie auxiliaire peut être promue centurion.');return;}
   const have=centurionCount();
   if(have>=centurionsAllowed()){toast(noRoomForCenturion(have));return;}
   startTransform(s,'promote');
   toast(`${unitTitles[s.type]||s.type} dans sa tente : un soldat sera promu centurion dans ${TRANSFORM_TIME} s.`);
  }
  // One soldier, the troop's front man, comes out of the tent its centurion;
  // the troop keeps the others and closes ranks (a lone soldier is promoted whole).
  let promotions=0;
  function completePromotion(s){
   const have=squads.filter(isCenturion).length;
   if(have>=centurionsAllowed()){toast(noRoomForCenturion(have));return;}
   const type=races[gameStats[s.type].race].centurion,fx=Math.sin(s.r),fz=Math.cos(s.r);
   let best=0,ahead=-Infinity;
   s.members.forEach((m,i)=>{const d=(m.x-s.x)*fx+(m.z-s.z)*fz;if(d>ahead){ahead=d;best=i;}});
   const man=s.members[best],at={x:man.x+fx*1.2,z:man.z+fz*1.2},lone=s.members.length===1,chosen=selectedSquads.includes(s);
   const troop={name:`${s.name}_C${++promotions}`,type,civilization:s.civilization||s.civ,units:1,position:[at.x,0,at.z],orientation:s.r,properties:[...(s.properties||[])],formation:''};
   if(lone)retire(s);else s.members.splice(best,1);
   const next=placeTroop(troop,at.x,at.z,s.r);
   if(!next){if(!lone)s.members.push(man);toast('Pas de place pour le centurion.');return;}
   if(!lone)reorganised([s]);
   if(chosen)setSelection([next]);
   refreshGroupButtons();updateArmyStats();
   toast(`${unitTitles[type]||type} promu${lone?'':` · ${unitTitles[s.type]||s.type} (${s.members.length}/${gameStats[s.type]?.maxSoldiers||s.members.length})`}.`);
  }
  function gateTarget(gate){
   return gate.target??={kind:'gate',gate,centre:gate.centre,defenses:gate.structure.defenses||{building:100},
    alive:()=>!gate.broken,
    damage(amount,by){
     if(gate.broken)return;
     gate.life-=amount;gate.placement.attackedAt=missionClock;
     if(gate.holder===humanCiv&&missionClock-(gate.warned??-1e9)>20){gate.warned=missionClock;toast('La porte du fort est attaquée !');}
     if(gate.life<=0)breakGate(gate);
    },
    // From a soldier to the gateway (its opening, in the gate's frame).
    distanceTo(p){
     const dx=p.x-gate.x,dz=p.z-gate.z,lx=dx*gate.c-dz*gate.s,lz=dx*gate.s+dz*gate.c;
     return Math.hypot(Math.max(gate.x0-lx,0,lx-gate.x1),Math.max(gate.z0-lz,0,lz-gate.z1));
    },
    // Melee: the near side of the passage; siege shots: within range.
    approach(from,weapon){
     const c=gate.centre;
     if(weapon?.kind==='ranged'){
      const d=Math.max((weapon.rangeMin||0)+1,Math.min(weapon.rangeMax*.8,Math.hypot(from.x-c.x,from.z-c.z))),a=Math.atan2(from.z-c.z,from.x-c.x);
      return {x:c.x+Math.cos(a)*d,z:c.z+Math.sin(a)*d};
     }
     return gate.sides.reduce((a,b)=>Math.hypot(a.x-from.x,a.z-from.z)<=Math.hypot(b.x-from.x,b.z-from.z)?a:b);
    }};
  }
  function breakGate(gate){
   gate.broken=true;gate.life=0;gate.placement.destroyed=true;
   // The gate's doors are gone (its models are only the door leaves).
   for(const record of structureParts)if(record.placement===gate.placement)setPartModel(record,'');
   if(structureVisionReady&&(friendlyOwner(gate.holder)||vision.seen(gate.centre.x,gate.centre.z))){
    sound?.play('UMOR',gate.centre);
    toast(gate.holder===humanCiv?'La porte du fort a cédé !':'La porte est enfoncée !');
   }
   gatesChanged();
  }
  // The nearest gate shut to this troop, when what it wants is behind it.
  function closedGateFor(squad,target){
   if(!fortress)return null;
   const there=target?.members?.length?combat.centroid(target):null;
   if(there&&!fortress.contains(there.x,there.z)&&!fortress.contains(squad.x,squad.z))return null;
   let best=null,bestD=150;
   for(const gate of fortress.gates){
    if(gateOpenFor(gate,squad.civ)||!civHostile(squad.civ,gate.holder))continue;
    const d=Math.hypot(gate.centre.x-squad.x,gate.centre.z-squad.z);if(d<bestD){bestD=d;best=gate;}
   }
   return best;
  }
  // A troop that cannot reach its enemy because a gate is shut to it breaks
  // the gate: the CPU always, the player's troops when ordered to attack.
  function siegeFallback(squad,target){
   if(!fortress||(squad.side==='player'&&!squad.combat.ordered))return false;
   const gate=closedGateFor(squad,target);
   return gate?combat.attackStructure(squad,gateTarget(gate)):false;
  }
  function hostileGateAt(p){
   return fortress?.gates.find(g=>structureVisionReady&&vision.seen(g.centre.x,g.centre.z)&&!g.broken&&g.holder&&civHostile(humanCiv,g.holder)&&Math.hypot(g.centre.x-p.x,g.centre.z-p.z)<3.2)||null;
  }
  function attackGateWith(gate){
   const armed=selectedSquads.filter(s=>!s.profile?.noAttack);
   const accepted=armed.filter(s=>{cancelMobilePreparation(s);s.orderQueue=null;return combat.attackStructure(s,gateTarget(gate),'attack',{run:runOrder});}),count=accepted.length;
   answer(count?accepted:selectedSquads,count?(runOrder?'T':'A'):'U');
   setPending(null);redrawRoute();
   toast(count?`${count} troupe(s) attaquent la porte${runOrder?' au pas de course':''}.`:'Ces troupes ne peuvent pas attaquer la porte.');
  }
  // Doors swing open while the holder's troops pass through.
  let doorTimer=0;
  function updateDoors(dt){
   if(!fortress?.gates.length||(doorTimer-=dt)>0)return;doorTimer=.25;
   for(const g of fortress.gates){
    if(g.broken)continue;
    const open=!!g.holder&&allSquads.some(s=>s.members.length&&(s.civ===g.holder||allied(s.civ,g.holder))&&Math.hypot(s.x-g.centre.x,s.z-g.centre.z)<s.radius+6&&s.members.some(m=>Math.hypot(m.x-g.centre.x,m.z-g.centre.z)<4.5));
    if(open===!!g.open)continue;g.open=open;
    for(const record of structureParts)if(record.placement===g.placement)setPartModel(record,open?'':record.part.model);
   }
  }
  let gateTimer=2;
  function updateGates(dt){
   updateDoors(dt);
   if(!fortress?.gates.length||(gateTimer-=dt)>0)return;gateTimer=2;
   const inside=new Map();
   for(const s of allSquads)if(s.members.length&&!neutralCiv(s.civ)&&fortress.contains(s.x,s.z))inside.set(s.civ,(inside.get(s.civ)||0)+s.members.length);
   const strongest=[...inside].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
   let changed=false;
   for(const gate of fortress.gates){
    if(gate.broken||(gate.holder&&inside.get(gate.holder))||!strongest||strongest===gate.holder)continue;
    gate.holder=strongest;changed=true;
   }
   if(changed)gatesChanged();
  }
  // RTS controls: marquee selection; Shift adds/removes squads; right-drag sets final facing.
  const SG=window.PraetoriansSelectionGeometry;
  let selected=null,selectedSquads=[];
  let formationPreview=null,formationPreviewState=null,formationPreviewStamp='',formationPreviewNext=0,formationPreviewRetry=false;
  const nearbyDeployment=window.PraetoriansNearbyDeployment.create(),nearbyOrderDeployment=window.PraetoriansNearbyDeployment.create();
  let pendingDeployment=null,deploymentOrderSequence=0,formationVisionCache=null;
  const formationNavIds=new WeakMap();let formationNavSequence=0;
  function formationNavStamp(s){const grid=navOf(s);if(!formationNavIds.has(grid))formationNavIds.set(grid,++formationNavSequence);return `${formationNavIds.get(grid)}:${grid.revision||0}`;}
  const marquee=$('selectionMarquee'),facingGuide=$('facingGuide'),facingStem=$('facingStem');
  // The selected troops' routes, laid on the ground (src/render/route-path.js;
  // it follows each troop's progress and new routes every frame).
  const routePaths=window.PraetoriansRoutePath.create({B,scene,groundY});
  function redrawRoute(){routePaths.show($('showRoutes').checked?selectedSquads:[]);}
  $('showRoutes').addEventListener('change',redrawRoute);
  function toast(text){$('toast').textContent=I18n.translateLabel(text);$('toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('visible'),2200);}
  // ---- Troop HUD: standards over the troops, the selection panel ---------------------
  // Each army's colour (the mission's COLOR index).
  const ARMY_COLOURS=CIV_COLORS;
  const colourOf=civ=>ARMY_COLOURS[Number(civs.get(civ)?.color)%ARMY_COLOURS.length||0]||ARMY_COLOURS[0];
  const FIGHTING=new Set(['melee','approach','shoot','pursue']);
  function troopStats(s){
   const unit=gameStats[s.type]||{},p=s.profile,rows=[];if(!p)return rows;
   const blow=w=>Math.round(Math.max(w.damage?.melee||0,w.damage?.projectile||0));
   if(!p.noAttack)rows.push({icon:'attack',label:'Attaque',value:blow(p.melee),title:`Dégâts d’un coup au corps à corps (un coup toutes les ${p.melee.interval} s)`});
   if(p.ranged)rows.push({icon:'ranged',label:'Tir',value:`${blow(p.ranged)} · ${p.ranged.rangeMax} m`,title:'Dégâts d’un tir et portée'});
   rows.push({icon:'shield',label:'Défense',value:`${100-(p.received?.melee??100)} %`,title:'Dégâts évités au corps à corps'});
   rows.push({icon:'arrows',label:'Protection',value:`${100-(p.received?.projectile??100)} %`,title:'Dégâts évités contre flèches et projectiles'});
   const state=unit.states?.[s.formationState?.defense||'NORMAL']||unit.states?.NORMAL||Object.values(unit.states||{})[0];
   rows.push({icon:'speed',label:'Vitesse',value:s.formationState?.stationary?0:state?.speed||'—',title:'Vitesse de marche (VELOCIDAD)'});
   rows.push({icon:'vision',label:'Vision',value:`${unit.vision||'—'} m`,title:'Rayon de vision'});
   return rows;
  }
  function troopInfo(s){
   if(!s.members.length||!s.profile)return null;
   let hp=0,stamina=0;for(const m of s.members){hp+=Math.max(0,m.hp);stamina+=m.stamina??s.profile.stamina?.initial??0;}
   const n=s.members.length,c=s.combat;
   const fighting=FIGHTING.has(c?.mode)||(c?.mode==='siege'&&c.job!=='work')||performance.now()-(s.foughtAt||-1e9)<3500;
   return {key:s,name:unitTitles[s.type]||s.type,description:describeTroop(s),icon:'assets/hd/interface/'+portraitFor(s)+'.png',
    hp:hp/n,hpMax:s.profile.health,stamina:stamina/n,staminaMax:s.profile.stamina?.max||0,exhausted:!!s.exhausted,
    count:n,max:Math.max(s.units||n,n),kills:s.kills||0,colour:colourOf(s.civ),side:s.side,
    selected:selectedSquads.includes(s),fighting,stats:troopStats(s),covered:!!s.covered&&(s.side!=='enemy'||!!s.visible),
    abilities:s.side==='player'?abilitiesOf(s).map(a=>abilityButton(a,[s])).map(b=>({id:b.id,icon:'assets/hd/interface/'+b.icon+'.png',title:b.title,auto:b.auto,disabled:b.disabled})):[],
    ...(isCenturion(s)&&s.side==='player'?centurionInfo(s):{})};
  }
  // A centurion's level (DefRazas NIVELES_CENTURION: 0, 200, 500, 1500,
  // 4000 experience) and the troops he will recruit at his next village.
  function centurionInfo(s){
   const {level,xp,next}=centurionLevel(s);
   return {level:next!=null?`Niveau ${level} (prochain : ${xp}/${next})`:`Niveau ${level} (maximum)`,
    queue:Array.from({length:RECRUIT_SLOTS},(_,k)=>{const type=s.recruits?.[k];return type?{icon:'assets/hd/interface/'+portraitOfType(type)+'.png',title:unitTitles[type]||type,progress:0}:null;})};
  }
  const CENTURION_LEVELS=[0,200,500,1500,4000],COMMAND_RADIUS=15,RECRUIT_SLOTS=7;
  function centurionLevel(s){
   const xp=s.xp||0;let level=0;while(level+1<CENTURION_LEVELS.length&&xp>=CENTURION_LEVELS[level+1])level++;
   return {level,xp,next:CENTURION_LEVELS[level+1]??null};
  }
  const troopHud=window.PraetoriansTroopHud;
  const standards=troopHud.banners({container:$('game')});
  const selectionPanel=troopHud.panel({single:$('selectionInfo'),strip:$('selectionStrip'),
   onPick:(squad,drop)=>setSelection(drop?selectedSquads.filter(s=>s!==squad):[squad]),
   onAbility:id=>useAbility(id),onFormation:id=>changeFormation(id.slice(10)),onDisabled:reason=>toast(reason),
   onToggleAuto:id=>toggleAutoAbility(id),onQueue:index=>dropFromQueue(index)});
  // A standard floats above the troop's men, a little above their heads.
  function standardAt(s){
   // A troop in its promotion tent keeps its standard over the tent.
   if(!s.members.length||(s.hidden&&!s.transform)||s.inVillage||(s.side==='enemy'&&!s.visible))return null;
   const c=combat.centroid(s),p=worldToScreen({x:c.x,y:groundY(c.x,c.z)+2.1,z:c.z});
   const rect=canvas.getBoundingClientRect();
   if(p.x<-40||p.y<-40||p.x>rect.width+40||p.y>rect.height-20)return null;
   return p;
  }
  function refreshStandards(){standards.update(allSquads,troopInfo,standardAt);}
  function refreshSelectionPanel(){
   const troops=selectedSquads.filter(s=>s.members.length);
   // A selected structure destroyed (or a finished machine gone) is let go.
   if(selectedStructure&&!(structureObserved(selectedStructure)&&StructurePanel.selectable(selectedStructure)&&buildings.entities.includes(selectedStructure))){selectStructure(null);return;}
   if(selectedVillage&&!structureObserved(selectedVillage)){selectVillage(null);return;}
   if(!troops.length&&selectedStructure){selectionPanel.show([structureInfo(selectedStructure)]);return;}
   if(!troops.length&&selectedVillage){selectionPanel.show([villageInfo(selectedVillage)]);return;}
   const controls=formationButtons(troops).map(button=>({...button,icon:'assets/hd/interface/'+button.icon+'.png'}));
   selectionPanel.show(troops.map(s=>{const info=troopInfo(s);if(info)info.formations=s.side==='player'?controls:[];return info;}).filter(Boolean));
  }
  // A village in the HD's panel: its picture, life and population, and its
  // seven training slots (the first with its progress).
  function villageInfo(v){
   const life=buildingData.structures[v.type]?.life||150000;
   return {key:v,name:v.label?text(v.label):v.named===false?'Village':v.name,icon:'assets/hd/interface/'+(v.kind==='BARRACON'?StructurePanel.portrait(v):VILLAGE_PORTRAIT)+'.png',
    hp:life,hpMax:life,stamina:0,staminaMax:0,stLabel:'Population',stText:`${Math.floor(v.population)}/${Math.round(v.maxPopulation)}`,
    count:null,max:null,kills:null,colour:v.owner?civColor(v.owner):'#8f8f8f',side:'village',selected:true,fighting:false,stats:[],abilities:[],
    queue:v.owner===humanCiv?Array.from({length:RECRUIT_SLOTS},(_,k)=>{const job=v.queue[k];return job?{icon:'assets/hd/interface/'+portraitOfType(job.type)+'.png',
     title:`${unitTitles[job.type]||job.type}${k===0?` · ${Math.ceil(job.left)} s`:''}`,progress:k===0?1-job.left/job.total:0}:null;}):null};
  }
  function updateArmyStats(){
   // Command points (PCU), as the HD counts its population: 100/500 for a pack.
   $('armyPopulation').textContent=`${commandPoints()}/500`;
   $('armySquads').textContent=`${squads.filter(s=>s.members.length).length}/50`;
   $('armyKills').textContent=enemySquads.reduce((n,s)=>n+(s.fallen||0),0);
   $('armyLosses').textContent=squads.reduce((n,s)=>n+(s.fallen||0),0);
  }
  // The HD's own portrait of every troop (TorusUI TroopIcon_NN): Roman 01-17
  // and 71, Egyptian 18-30 and 49, Gallic 31-48, scouts 12 and 54, chariots
  // 53, the village 58. Heroes take their base type's.
  const PORTRAITS={CENTURION:1,PIQUERO:3,INFANTERIA_LIGERA:4,CABALLERIA_PESADA:5,ARQUERO:6,CABALLERIA_ARQUERA:7,INFANTERIA_PESADA:8,
   MEDICO:9,GLADIADOR:10,HONDERO:11,EXPLORADOR_HALCON:12,EXPLORADOR_LOBO:54,PIQUERO_ELITE:71,MENSAJERO:5,MENSAJERO_RESISTENTE:5,
   EGIPCIO_ARQUERO:18,EGIPCIO_CABALLERIA_ARQUERA:19,EGIPCIO_LIGERA:20,EGIPCIO_CABALLERIA_PESADA:21,EGIPCIO_PIQUERO:22,EGIPCIO_PESADA:23,
   EGIPCIO_MEDICO:24,EGIPCIO_ARQUERON:25,EGIPCIO_CENTURION:49,EGIPCIO_MENSAJERO:21,EGIPCIO_CUADRIGA:53,CABALLERIA_PARTHA:33,
   GALO_CENTURION:31,JEFE_GERMANO:32,GALO_ESPADON:34,GALO_MEDICO:35,GALO_LIGERA:36,GALO_CABALLERIA_PESADA:37,GALO_ARQUERO:38,
   GALO_CABALLERIA_ARQUERA:39,GALO_PIQUERO:40,GALO_PESADA:41,CABALLERIA_GERMANA:42,GALO_CAZADOR:43,GALO_MENSAJERO:37,BARBARO_CUADRIGA:53,
   HEROE_AGRADO:12,PRISIONERO:11};
  const BASE_PORTRAITS={CENTURION:1,CENTURION_A_PIE:31,MEDICO:9,EXPLORADOR:54,PRISIONERO:11};
  // Siege machines: catapult, ballista, ram, tower, ladder of each race.
  const MACHINE_PORTRAITS={ROMANOS:13,EGIPCIOS:26,BARBAROS:44},MACHINES=[/CATAPULTA/,/BALLESTA/,/ARIETE/,/TORRE_ASALTO/,/ESCALA/];
  function portraitOfType(type){
   const unit=gameStats[type]||{};let n=PORTRAITS[type];
   if(n==null){const k=MACHINES.findIndex(re=>re.test(type));if(k>=0)n=(MACHINE_PORTRAITS[unit.race]??13)+k;}
   n??=PORTRAITS[unit.base]??BASE_PORTRAITS[unit.base]??4;
   return 'TroopIcon_'+String(n).padStart(2,'0');
  }
  const portraitFor=s=>portraitOfType(s.type);
  const VILLAGE_PORTRAIT='TroopIcon_58';
  const RACE_NAMES={ROMANOS:'Armée romaine',BARBAROS:'Guerriers barbares',EGIPCIOS:'Armée égyptienne'};
  function describeTroop(s){
   if(s.type==='HEROE_AGRADO')return 'Éclaireur · porte un faucon';
   const unit=gameStats[s.type]||{},race=RACE_NAMES[unit.race]||'Troupe';
   if(unit.abilities?.includes('SOLTAR_FAMILIAR_HALCON'))return `${race} · éclaireur au faucon`;
   if(Object.values(unit.weapons||{}).some(w=>w.kind==='ranged'))return `${race} · tir à distance`;
   if(unit.flags?.includes('FLAG_NO_ATAQUE'))return `${race} · ne combat pas`;
   return `${race} · ${(unitTitles[s.type]||s.type).toLowerCase()}`;
  }
  // ---- Villages: selection, inhabitants and training ------------------------------
  let selectedVillage=null,villagePanelTimer=0;
  function villageAt(p){return villages?.villages.find(v=>structureObserved(v)&&Math.hypot(v.x-p.x,v.z-p.z)<=v.radius+1.5)||null;}
  // ---- Structures: selection (src/ui/structure-panel.js) --------------------------
  // A garrison, tower, tent... or a building site once begun, on explored
  // land: its life in the bottom panel, rising as it is built and falling
  // as it is attacked. A click on nothing lets it go.
  const StructurePanel=window.PraetoriansStructurePanel;
  let selectedStructure=null;
  // How tall a structure's model stands (its vertices' highest point).
  const modelHeights=new Map();
  function structureHeight(e){
   const name=e.shown;if(!name||!models.models[name])return 2;
   if(!modelHeights.has(name)){
    let top=0;for(const g of models.models[name].groups||[])for(let i=1;i<(g.positions?.length||0);i+=3)top=Math.max(top,g.positions[i]);
    modelHeights.set(name,top||2);
   }
   return modelHeights.get(name);
  }
  // The structure under the pointer: the view ray against each one's
  // outline up to its model's height, nearest the eye first (a tower's roof
  // is drawn over the ground behind it). height: where the ray enters it.
  function structureUnder(clientX,clientY){
   const end=groundUnder(clientX,clientY);if(!end)return null;
   const rect=canvas.getBoundingClientRect(),ray=scene.createPickingRay(clientX-rect.left,clientY-rect.top,B.Matrix.Identity(),camera,false);
   const o=ray.origin,d=ray.direction;if(d.y>-1e-3)return null;
   const tEnd=(o.y-end.y)/-d.y,tTop=Math.max(0,(o.y-end.y-12)/-d.y);
   for(let t=tTop;t<=tEnd;t+=.12){
    const x=o.x+d.x*t,y=o.y+d.y*t,z=o.z+d.z*t,e=buildings.at(x,z,0);
    if(!StructurePanel.selectable(e)||!structureObserved(e))continue;
    const base=e.placement?.y??groundY(e.x,e.z);
    if(y<=base+structureHeight(e))return {entity:e,height:y-groundY(x,z)};
   }
   return null;
  }
  function selectStructure(e){
   if(e&&!structureObserved(e))return false;
   if(selectedStructure!==e){selectedStructure=e||null;if(e)selectedVillage=null;commandPanel.reset();}
   refreshVillagePanel();
   return true;
  }
  function structureInfo(e){
   const title=e.machine?unitTitles[e.type]||e.type:e.def?.label?text(e.def.label):e.type;
   return StructurePanel.info(e,{title,colour:e.owner?civColor(e.owner):'#8f8f8f'});
  }
  // Yellow brackets on the ground round the selected structure or village.
  const markMaterial=unlit('selected structure');markMaterial.albedoColor=new B.Color3(.96,.86,.16);
  let selectionMark=null,markShape=null;
  function refreshSelectionMark(){
   const box=selectedStructure?StructurePanel.boxOf(selectedStructure)
    :selectedVillage?StructurePanel.villageBox(selectedVillage,buildingData.structures[selectedVillage.type]):null;
   const shape=box&&[box.x,box.z,box.r,box.cx,box.cz,box.hx,box.hz].map(v=>v.toFixed(2)).join();
   if(shape===markShape)return;markShape=shape;
   selectionMark?.dispose();selectionMark=null;if(!box)return;
   const {positions,indices}=StructurePanel.brackets(box,groundY),data=new B.VertexData();
   data.positions=positions;data.indices=indices;
   selectionMark=new B.Mesh('selection brackets',scene);data.applyToMesh(selectionMark);
   selectionMark.material=markMaterial;selectionMark.isPickable=false;
  }
  // Centurions and centurion heroes (BASE CENTURION / CENTURION_A_PIE).
  const isCenturion=s=>s.members.length>0&&/^CENTURION/.test(gameStats[s.type]?.base||'');
  // Inside a village the centurion is out of sight and out of reach; he comes
  // out by its PUNTO_SALIDA when ordered to move, when the player calls him
  // out, or when the village's garrison falls.
  function enterVillage(s,v){
   if(!isCenturion(s)||!villages?.canEnter(v,s.civ))return false;
   if(s.inVillage===v)return true;
   if(s.inVillage)leaveVillage(s);
   s.inVillage=v;v.inside.push(s);s.hidden=true;s.ring?.setEnabled(false);
   combat.move(s);
   if(selectedSquads.includes(s))setSelection(selectedSquads.filter(q=>q!==s),false,false);
   refreshSquadInstances(s);
   if(s.side==='player')toast(`${unitTitles[s.type]||'Centurion'} : dans le village.`);
   // Recruiting ordered while he was outside (Tutorial II, lesson 5), and
   // the troops queued with him.
   if(v.pendingTraining?.length)(s.recruits??=[]).push(...v.pendingTraining.splice(0));
   flushRecruits(s);
   refreshVillagePanel();
   return true;
  }
  // A centurion standing idle near one of his villages with nobody inside
  // goes in by himself ("il entre automatiquement dans toute ville déserte
  // à proximité").
  const AUTO_ENTER_RANGE=7,AUTO_ENTER_IDLE=2;
  function autoEnterVillages(dt){
   if(!villages)return;
   for(const s of allSquads){
    if(s.inVillage&&!villages.canEnter(s.inVillage,s.civ))leaveVillage(s);
    if(!isCenturion(s)||s.inVillage||s.enterVillage||s.isMoving||s.sheltered||s.combat?.mode!=='idle'){s.idleNearVillage=0;continue;}
    const v=villages.villages.find(v=>villages.canEnter(v,s.civ)&&!v.inside.some(isCenturion)&&Math.hypot(v.x-s.x,v.z-s.z)<=v.radius+AUTO_ENTER_RANGE);
    if(!v){s.idleNearVillage=0;continue;}
    if((s.idleNearVillage=(s.idleNearVillage||0)+dt)<AUTO_ENTER_IDLE)continue;
    s.idleNearVillage=0;
    if(motion.order(s,v.entry,navOf(s)).ok)s.enterVillage=v;
   }
  }
  function leaveVillage(s){
   const v=s.inVillage;if(!v)return;
   s.inVillage=null;v.inside=v.inside.filter(q=>q!==s);s.hidden=false;
   if(s.members.length){s.nav=navOf(s);motion.arrange(s,s.nav,groundY,v.exit,Math.atan2(v.exit.x-v.x,v.exit.z-v.z));}
   refreshSquadInstances(s);refreshVillagePanel();
  }
  function selectVillage(v){
   if(v&&!structureObserved(v))return false;
   if(selectedVillage!==v){selectedVillage=v||null;if(v)selectedStructure=null;commandPanel.reset();if(pendingOrder==='rally')pendingOrder=null;}
   refreshVillagePanel();
   return true;
  }
  // The selected village shows in the bottom panel and its recruits in the
  // command grid (the old floating panel is no longer used).
  function refreshVillagePanel(){
   refreshSelectionPanel();refreshCommands();refreshSelectionMark();
  }
  // A village recruits only with one of the player's centurions (or
  // centurion heroes) inside it, as Tutorial II teaches ("Sélectionne ton
  // centurion pour le faire entrer en ville"); recruits ordered from outside
  // go on the centurion's own queue (his Construction tab). Script-owned
  // barracks train on their own (Tutorial III, Cicéron: no centurion).
  const NO_RECRUITER='Un centurion doit se trouver dans le village pour recruter.';
  const recruiterInside=v=>v.kind==='BARRACON'||v.inside.some(s=>s.side==='player'&&isCenturion(s));
  function orderTraining(v,type){
   if(!villages.canEnter(v,humanCiv)){toast('Terminez la construction d’une garnison avant de recruter dans ce village.');return;}
   if(!recruiterInside(v)){toast(NO_RECRUITER);return;}
   if(v.queue.length>=RECRUIT_SLOTS){toast('La file de recrutement est pleine (7 troupes).');return;}
   toast(trainingMessage(type,trainAt(v,type,humanCiv)));refreshVillagePanel();
  }
  // Selected centurions queue up to seven troops ("préformer"): they are
  // trained as soon as he is inside one of his villages.
  function queueRecruit(type){
   const list=selectedSquads.filter(isCenturion);if(!list.length)return;
   const s=list.find(c=>(c.recruits?.length||0)<RECRUIT_SLOTS);
   if(!s){toast('La file du centurion est pleine (7 troupes).');return;}
   (s.recruits??=[]).push(type);
   toast(`${unitTitles[type]||type} : en attente (${s.recruits.length}/${RECRUIT_SLOTS}) · recruté dès que le centurion entre dans un village.`);
   if(s.inVillage)flushRecruits(s);
   refreshSelectionPanel();refreshCommands();
  }
  // A centurion inside one of his villages hands his queue to it.
  function flushRecruits(s){
   const v=s.inVillage;if(!v||!s.recruits?.length||!villages?.canEnter(v,s.civ))return;
   while(s.recruits.length&&v.queue.length<RECRUIT_SLOTS){
    const type=s.recruits[0],result=trainAt(v,type,s.civ);
    if(!result.ok)break;
    s.recruits.shift();if(s.side==='player')toast(trainingMessage(type,result));
   }
  }
  let recruitTimer=0;
  function updateRecruits(dt){
   if(!villages||(recruitTimer-=dt)>0)return;recruitTimer=1;
   for(const s of squads)if(s.inVillage&&s.recruits?.length)flushRecruits(s);
  }
  // A click on a queue slot: a village's training is cancelled (inhabitants
  // and honour given back), a centurion's waiting recruit dropped.
  function dropFromQueue(index){
   const troops=selectedSquads.filter(s=>s.members.length);
   if(!troops.length&&selectedVillage?.owner===humanCiv){
    const v=selectedVillage,job=v.queue[index];if(!job)return;
    v.queue.splice(index,1);
    const q=villages.quote(job.type);v.population=Math.min(v.maxPopulation,v.population+q.population);if(q.honour)gainHonour(q.honour);
    toast(`${unitTitles[job.type]||job.type} : entraînement annulé.`);refreshVillagePanel();return;
   }
   const s=troops.find(isCenturion);if(!s?.recruits?.[index])return;
   const [type]=s.recruits.splice(index,1);toast(`${unitTitles[type]||type} retiré de la file.`);refreshSelectionPanel();
  }
  // The player's training also spends honour points (PUNTOS_HONOR: one for
  // cavalry, two for special troops), as the game's training table gives.
  function trainAt(v,type,civ){
   const q=villages.quote(type);
   if(civ===humanCiv&&q.honour>honour.points)return {ok:false,reason:'honour',needed:q.honour};
   const result=villages.train(v,type,civ);
   if(result.ok&&civ===humanCiv&&q.honour)gainHonour(-q.honour);
   return result;
  }
  function trainingMessage(type,result){
   if(result.ok)return `${unitTitles[type]||type} : entraînement lancé (${Math.round(result.seconds)} s).`;
   if(result.reason==='honour')return `Il faut ${result.needed} point${result.needed>1?'s':''} d’honneur (vous en avez ${honour.points}).`;
   return result.reason==='population'?'Pas assez d’habitants.':'Ce village ne vous appartient pas.';
  }
  function setSelection(next,focus=false,acknowledge=true){
   hideFormationPreview(true);
   pendingDeployment=null;
   if(next.length&&(selectedVillage||selectedStructure)){selectedVillage=null;selectedStructure=null;refreshVillagePanel();}
   selectedSquads=[...new Map(next.filter(s=>s.members.length&&s.side==='player').map(s=>[s.index,s])).values()].sort((a,b)=>a.index-b.index);
   selected=selectedSquads[0]||null;
   squads.forEach(s=>s.ring.setEnabled(selectedSquads.includes(s)));
   refreshGroupButtons();
   // HD troop icons by unit family: 03 spear, 04 sword (auxiliaries), 06 bow,
   // 05/07 cavalry, 02 centurion, 08 heavy infantry, 09 medic, 10 gladiator,
   // 12 scout with hawk.
   refreshSelectionPanel();
   if(selected){
    if(acknowledge)answer(selectedSquads,'S');
    if(focus){camera.target.set(selected.x-9.5,0,selected.z-5.5);zoom=Math.min(zoom,11.6);resizeCamera();resetCameraMotion();}
    // Tutorial watchers: which troop types the player has just selected.
    mission.onAction('select',{types:selectedSquads.map(s=>s.type)});
   }
   commandPanel.reset();redrawRoute();refreshDebugViews();refreshCommands();refreshCursor();
  }
  // ---- Memorised groups (Ctrl/Alt + number, or right-click a group button) ---
  const memorised=new Map();
  const ROMAN=['I','II','III','IV','V','VI','VII','VIII','IX'];
  function refreshGroupButtons(){
   document.querySelectorAll('[data-group]').forEach(button=>{
    const index=Number(button.dataset.group),group=memorised.get(index)?.filter(s=>s.members.length);
    const members=group?.length?group:squads[index]?.members.length?[squads[index]]:[];
    button.classList.toggle('selected',members.length>0&&members.every(s=>selectedSquads.includes(s)));
    button.classList.toggle('memorised',!!group?.length);
    button.title=group?.length?`Groupe ${ROMAN[index]} · ${group.length} formation(s) · ${index+1}`:squads[index]?`${unitTitles[squads[index].type]||squads[index].type} · ${index+1}`:`Selection group ${index+1}`;
   });
  }
  function memoriseGroup(index){
   if(!selectedSquads.length){toast('Sélectionnez des formations à mémoriser.');return;}
   memorised.set(index,[...selectedSquads]);refreshGroupButtons();
   toast(`Groupe ${ROMAN[index]} mémorisé (${selectedSquads.length} formation(s)).`);
   mission.onAction('groupCreated');
  }
  function recallGroup(index,focus=false,add=false){
   const group=memorised.get(index)?.filter(s=>s.members.length);
   if(!group?.length)return false;
   setSelection(add?[...selectedSquads,...group]:group);
   if(focus&&selected){const c=group.reduce((p,s)=>({x:p.x+s.x/group.length,z:p.z+s.z/group.length}),{x:0,z:0});camera.target.set(c.x-9.5,0,c.z-5.5);resizeCamera();resetCameraMotion();}
   mission.onAction('groupSelected');
   return true;
  }
  // ---- Orders: the command panel's Actions -------------------------------------
  // A pending order waits for a click on the battlefield: move (M), attack
  // (A), patrol (L), protect (P), face (F, ORDEN_ORIENTAR), the scout's hawk
  // (K, SOLTAR_FAMILIAR_HALCON), the javelins, a repair (R) or a building.
  let pendingOrder=null,lastRightClick={time:0,x:0,y:0};
  const ORDER_HINTS={move:'Cliquez sur la destination (glisser avec le bouton droit : orientation).',run:'Cliquez sur la destination : les troupes y courent.',
   attack:'Cliquez sur l’ennemi à attaquer, ou sur un lieu : les troupes y marchent en combattant ce qu’elles croisent.',
   patrol:'Cliquez sur le point de patrouille : les troupes iront et viendront jusque-là.',protect:'Cliquez sur la troupe alliée à protéger.',
   face:'Cliquez sur le point vers lequel les troupes doivent faire face.',hawk:'Cliquez sur la zone que le faucon doit explorer.',
   'ability:PILUM':'Cliquez sur la troupe ennemie : vos troupes lanceront leurs javelots à portée.',repair:'Cliquez sur le bâtiment à réparer.',
   rally:'Cliquez sur le point de ralliement des troupes recrutées.'};
  function setPending(kind){
   hideFormationPreview(true);
   pendingDeployment=null;
   pendingOrder=kind;
   if(!kind?.startsWith('build:')){buildPreview.hide();constructionPreviewState=null;}
   if(kind)toast(ORDER_HINTS[kind]||'Cliquez sur l’emplacement de la construction (Échap : annuler).');
   refreshCommands();refreshCursor();
  }
  window.addEventListener('keydown',event=>{
   if(event.key==='Escape'&&pointerStart?.button===2&&!window.PraetoriansMenu?.isOpen()){
    event.preventDefault();event.stopImmediatePropagation();hideFormationPreview(true);return;
   }
   if(event.key==='Escape'&&pendingOrder?.startsWith('build:')&&!window.PraetoriansMenu?.isOpen()){
    event.preventDefault();event.stopImmediatePropagation();setPending(null);
   }
  },true);
  function armOrder(kind){
   if(!selectedSquads.length){toast('Sélectionnez d’abord une troupe.');return;}
   if(['move','patrol','protect','face'].includes(kind)&&selectedSquads.every(s=>combat.isFormationLocked(s))){toast(combat.FORMATION_LOCKED);return;}
   if(kind==='hawk'){
    if(hawk.active){recallHawk();return;}
    if(!hawkOwner()){toast('Seul l’éclaireur porte un faucon.');return;}
   }
   if(kind==='attack'&&selectedSquads.every(s=>s.profile?.noAttack)){toast(`${unitTitles[selectedSquads[0].type]||'Cette troupe'} ne peut pas attaquer.`);return;}
   setPending(pendingOrder===kind?null:kind);
  }
  // Standing orders (patrol, protect, attack on the march) end with any new
  // order the player gives the troop.
  function clearStanding(s){s.patrol=null;s.protect=null;s.attackMove=null;}
  // ORDEN_ACTITUD_DEFENSIVA / OFENSIVA (D, G).
  function setStance(stance){
   for(const s of selectedSquads)combat.setStance(s,stance);
   answer(selectedSquads,'G');
   toast(stance==='defensive'?`${selectedSquads.length} troupe(s) en attitude défensive : elles tiennent leur position.`:`${selectedSquads.length} troupe(s) en attitude agressive.`);
   refreshCommands();
  }
  // ORDEN_HOLD_POSITION (H): stop where they stand and hold the ground.
  function holdPosition(){
   for(const squad of selectedSquads)cancelMobilePreparation(squad);
   if(!selectedSquads.length){toast('Sélectionnez d’abord une troupe.');return;}
   let halted=0;for(const squad of selectedSquads){if(squad.formationState?.pending&&combat.isFormationLocked(squad))continue;clearStanding(squad);if(combat.move(squad)!==false){squad.orderQueue=null;motion.stop(squad);halted++;}}
   setPending(null);redrawRoute();
   toast(halted?`${halted} troupe(s) restent en position.`:ENGAGED);
   answer(selectedSquads,halted?'G':'U');
  }
  const reorganisable=s=>s.members.length>0&&!s.transform&&!combat.isFormationLocked(s)&&!['melee','approach'].includes(s.combat?.mode);
  function sameTypeSelection(){
   const list=selectedSquads.filter(s=>s.members.length);
   return list.length&&list.every(s=>s.type===list[0].type&&s.type!=='HEROE_AGRADO')?list:null;
  }
  // ORDEN_UNIR_TROPAS (J): same-type troops join into one, up to the type's
  // maximum (MAX_UNIDADES_TROPA).
  function mergeCandidates(){
   const list=sameTypeSelection();
   if(!list||list.length<2||orderRestrictions.has('ORDEN_UNIR_TROPAS')||!list.every(reorganisable))return null;
   return list.reduce((n,s)=>n+s.members.length,0)<=(gameStats[list[0].type]?.maxSoldiers||30)?list:null;
  }
  // ORDEN_ROMPER_TROPA (Diviser les troupes): each troop splits in two.
  function splitCandidates(){
   if(orderRestrictions.has('ORDEN_ROMPER_TROPA'))return null;
   const list=selectedSquads.filter(s=>s.members.length>=2&&s.type!=='HEROE_AGRADO'&&reorganisable(s));
   return list.length?list:null;
  }
  // ORDEN_DISTRIBUIR_TROPAS (B, Équilibrer): same-type troops share their men.
  function balanceCandidates(){
   const list=sameTypeSelection();
   if(!list||list.length<2||orderRestrictions.has('ORDEN_DISTRIBUIR_TROPAS')||!list.every(reorganisable))return null;
   const sizes=list.map(s=>s.members.length);
   return Math.max(...sizes)-Math.min(...sizes)>1?list:null;
  }
  // ---- The command panel: Actions, Aptitudes, Construction ---------------------
  // The HD order icons (IconUtil_Actions_NN) in the game's grid: move, attack,
  // defensive, aggressive / hold, patrol, protect, promote or demote / face,
  // join, balance, split. Names and hotkeys are the game's texts.
  const ACTIONS=[['move','02','LTEXT_ORDEN_MOVER','Se déplacer (M)'],['attack','01','LTEXT_ORDEN_ATACAR','Attaquer (A)'],
   ['defensive','17','LTEXT_ORDEN_ACTITUD_DEFENSIVA','Défensif (D)'],['aggressive','18','LTEXT_ORDEN_ACTITUD_OFENSIVA','Agressif (G)'],
   ['stop','05','LTEXT_ORDEN_HOLD_POSITION','Rester en position (H)'],['patrol','10','LTEXT_ORDEN_PATRULLAR','Patrouiller (L)'],
   ['protect','09','LTEXT_ORDEN_PROTEGER','Protéger (P)'],['promote','19','LTEXT_ORDEN_TRANSFORMAR_A_CENTURION','Promouvoir'],
   ['face','08','LTEXT_ORDEN_ORIENTAR','Faire face (F)'],['merge','11','LTEXT_ORDEN_UNIR','Réunir troupes (J)'],
   ['balance','12','LTEXT_ORDEN_DISTRIBUIR','Équilibrer les troupes (B)'],['split','13','LTEXT_ORDEN_DIVIDIR','Diviser les troupes (S)']];
  const DEGRADE=['degrade','14','LTEXT_ORDEN_DEGRADAR','Dégrader'];
  const label=(key,fallback)=>{const value=text(key);return value===key?fallback:value;};
  // What a troop is doing, as the panel marks it in gold.
  function orderOf(s){
   if(s.patrol)return 'patrol';if(s.protect)return 'protect';
   const c=s.combat;
   if(s.attackMove||(c?.ordered&&['pursue','approach','melee','shoot'].includes(c.mode))||(c?.mode==='siege'&&c.job!=='work'))return 'attack';
   if(s.isMoving)return 'move';
   return 'stop';
  }
  const restricted=(order,list)=>orderRestrictions.has(order)||list.some(s=>orderRestrictions.has(order+'|'+s.type));
  function formationName(definition){return definition?label(definition.tooltip,'Formation '+definition.mode):'';}
  I18n.registerLabels({[combat.FORMATION_LOCKED]:{en:'Stand this unit up by choosing its normal formation first.'}});
  function formationReason(check){
   const reasons={unsupported:'Cette troupe ne possède pas cette formation.',empty:'Aucun soldat disponible.',sheltered:'Sortez du bâtiment avant de changer de formation.',transition:'La troupe change déjà de formation.',melee:ENGAGED,maximum:'Cette formation ne peut pas contenir autant de soldats.'};
   return check.reason==='minimum'?`${formationName(check.definition)} · ${check.minimum}+`:reasons[check.reason]||'Pas assez de place pour cette formation.';
  }
  function formationCheck(squad,definition){
   // Choosing the standing posture is also the explicit way to cancel
   // preparation. Other orders must never release a planted troop for it.
   const canStand=definition.mode==='standard'&&squad.formationState?.pending&&!squad.combat?.engaged&&!squad.sheltered&&!squad.inVillage&&!squad.transform;
   return formations.check(squad,definition.id,{ignoreBusy:!!canStand});
  }
  function cancelFormation(squad){
   if(!squad.formationTransition&&!squad.formationRequest&&!squad.formationState?.pending)return false;
   squad.formationTransition=null;squad.formationRequest=null;
   combat.resetFormation(squad);motion.halt(squad);squad.needsReform=true;
   return true;
  }
  function cancelMobilePreparation(squad){
   return combat.isFormationLocked(squad)?false:cancelFormation(squad);
  }
  function changeFormation(mode){
   const accepted=[];
   for(const squad of selectedSquads){
    const definition=formations.choices(squad.type).find(def=>def.mode===mode);if(!definition)continue;
    if(formations.current(squad)?.id===definition.id&&!squad.formationState?.pending)continue;
    const check=formationCheck(squad,definition);
    if(!check.ok){toast(formationReason(check));continue;}
    if(definition.mode!=='standard'&&navOf(squad)?.walkway?.(squad.x,squad.z)){toast('Cette formation nécessite un terrain ouvert.');continue;}
    if(definition.mode==='standard')cancelFormation(squad);
    squad.orderQueue=null;clearStanding(squad);
    squad.formationRequest={id:definition.id};
    squad.formationState={...(squad.formationState||formations.state(squad.type,formations.standard(squad.type).id)),pending:true};
    accepted.push(squad);
   }
   hideFormationPreview(true);setPending(null);answer(accepted,'G');refreshCommands();refreshSelectionPanel();
   return accepted.length;
  }
  let formationStartsRemaining=1;
  function updateFormations(dt){
   for(const squad of allSquads){
    const request=squad.formationRequest;
    if(request&&formationStartsRemaining>0){
     formationStartsRemaining--;squad.formationRequest=null;
     const check=formations.check(squad,request.id,{ignoreBusy:true});
     if(!check.ok||squad.combat.engaged||!squad.members.length){cancelFormation(squad);continue;}
     if(combat.move(squad)===false){cancelFormation(squad);continue;}
     combat.resetFormation(squad);motion.halt(squad);
     const definition=check.definition,grid=navOf(squad),oldFiles=squad.files,oldCore=squad.coreFile;
     squad.formationShape=definition.mode==='standard'?null:count=>formations.slots(squad.type,definition.id,count,{spacing:squad.spacing});
     const reshape=()=>motion.reform(squad,grid,squad.r);
     const result=grid?.withWorkBudget?grid.withWorkBudget(12288,reshape):reshape();
     if(result!==true){
      squad.files=oldFiles;squad.coreFile=oldCore;combat.resetFormation(squad);squad.needsReform=true;
      if(selectedSquads.includes(squad))toast('Pas assez de place pour cette formation.');
      continue;
     }
     const state=formations.state(squad.type,definition.id);
     state.pending=true;state.transition={clip:state.transitionClip,roles:state.transitionRoles,elapsedMs:0};
     squad.formationState=state;squad.formationVersion=(squad.formationVersion||0)+1;
     squad.needsReform=false;squad.combat.moveOrder=false;squad.running=false;
     squad.formationTransition={id:definition.id,elapsed:0,duration:definition.activation};
    }
    const job=squad.formationTransition;if(!job)continue;
    const check=formations.check(squad,job.id,{ignoreBusy:true});
    if(!check.ok||squad.combat.engaged||squad.sheltered||squad.inVillage||squad.transform){cancelFormation(squad);continue;}
    job.elapsed+=dt;
    if(squad.formationState.transition)squad.formationState.transition.elapsedMs=job.elapsed*1000;
    if(job.elapsed>Math.max(12,job.duration+12)){cancelFormation(squad);continue;}
    if(job.elapsed+1e-9>=job.duration&&!squad.isMoving&&!squad.needsReform){
     squad.formationTransition=null;combat.setFormation(squad,job.id,{force:true});
     if(selectedSquads.includes(squad)){refreshSelectionPanel();refreshCommands();}
    }
   }
  }
  function formationButtons(troops=selectedSquads){
   const list=troops.filter(s=>s.side==='player'&&s.members.length&&formations.choices(s.type).length>1),modes=[];
   for(const squad of list)for(const definition of formations.choices(squad.type))if(!modes.includes(definition.mode))modes.push(definition.mode);
   const order=['planted','raised','standard','testudo'];modes.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
   return modes.map((mode,slot)=>{
    const supported=list.filter(s=>formations.choices(s.type).some(def=>def.mode===mode));
    const definition=formations.choices(supported[0].type).find(def=>def.mode===mode);
    const ready=supported.map(s=>({s,check:formationCheck(s,formations.choices(s.type).find(def=>def.mode===mode))}));
    const usable=ready.filter(entry=>entry.check.ok),active=supported.every(s=>formations.get(s.type,s.formationRequest?.id||s.formationTransition?.id||s.formationState?.id)?.mode===mode||(!s.formationState&&mode==='standard'));
    const title=formationName(definition)+(supported.length<list.length?` · ${supported.length}/${list.length}`:'')+
     (definition.mode==='standard'?'':`\n${definition.minimum}+ · ${definition.activation} s`);
    return {id:'formation:'+mode,slot,icon:definition.iconName||'IconUtil_Actions_17',title,active,
     disabled:!usable.length,reason:usable.length?'':formationReason(ready[0].check)};
   });
  }
  function actionButtons(){
   const list=selectedSquads.filter(s=>s.members.length);if(!list.length)return [];
   const pending=['move','attack','patrol','protect','face'].includes(pendingOrder)?pendingOrder:null;
   const state=pending||orderOf(list[0]);
   const defensive=list.every(s=>s.combat?.stance==='defensive');
   // Promotion for the race's basic infantry (the auxiliaries), demotion for the others.
   const basics=list.every(s=>races[gameStats[s.type]?.race]?.demotion===s.type&&races[gameStats[s.type]?.race]?.centurion);
   const buttons=ACTIONS.map(([id,icon,key,fallback],slot)=>({id,icon:'IconUtil_Actions_'+icon,title:label(key,fallback),slot}));
   if(!basics){const [id,icon,key,fallback]=DEGRADE;buttons[7]={id,icon:'IconUtil_Actions_'+icon,title:label(key,fallback),slot:7};}
   const noAttack=list.every(s=>s.profile?.noAttack);
   const planted=list.every(s=>combat.isFormationLocked(s));
   for(const b of buttons){
    switch(b.id){
     case 'move':case 'stop':case 'patrol':case 'protect':case 'face':b.active=!pending||b.id===pending?state===b.id:false;break;
     case 'attack':b.active=state==='attack';b.disabled=noAttack;b.reason='Cette troupe ne combat pas.';break;
     case 'defensive':b.active=defensive;break;
     case 'aggressive':b.active=!defensive;break;
     case 'promote':b.disabled=!list.some(promotable)||restricted('ORDEN_TRANSFORMAR_A_CENTURION',list);b.reason='Promotion indisponible.';
      b.title+=` · ${PCU_PER_CENTURION} points de contrôle d’unité par centurion`;break;
     case 'degrade':b.disabled=!list.some(demotable)||restricted('ORDEN_TRANSFORMAR_A_LIGERA',list);b.reason='Ces troupes ne peuvent pas être dégradées.';break;
     case 'merge':b.disabled=!mergeCandidates();b.reason='Sélectionnez plusieurs troupes du même type dont l’effectif total tient dans une seule.';break;
     case 'balance':b.disabled=!balanceCandidates();b.reason='Sélectionnez plusieurs troupes du même type aux effectifs inégaux.';break;
     case 'split':b.disabled=!splitCandidates();b.reason='Il faut au moins deux soldats hors de la mêlée.';break;
    }
    if(planted&&['move','patrol','protect','face','promote','degrade','merge','balance','split'].includes(b.id)){b.disabled=true;b.reason=combat.FORMATION_LOCKED;}
   }
   return buttons;
  }
  // ---- Aptitudes (DefHabilidades) with the HD icons (IconUtil_Ability_NN) ----
  // Played here: the auxiliaries' javelins (PILUM, used automatically unless
  // turned off) and the scout's hawk. The others show greyed.
  const ABILITY_ICONS={PILUM:12,RED:14,FRANCISCAS:7,FRENESI:8,BOLEADORAS:9,REZAR:24,REZAR_PROJIMO:26,REZAR_ROBAR:25,CEGAR_TROPA:29,CEGAR_ZONA:28,ALMAS:27,
   DISPARO_FUEGO:23,DISPARO_METRALLA:22,ESPEJISMO_MANEJABLE:30,SOLTAR_FAMILIAR_LOBO:15,SOLTAR_FAMILIAR_HALCON:20,DISPARO_PARTHO:21,ATAQUE_SORPRESA:16,
   VENENO:32,CURACION_RAPIDA:34,KIT_CURACION_EXTRA:35};
  const PLAYED_ABILITIES=new Set(['PILUM','SOLTAR_FAMILIAR_HALCON']);
  const abilityIcon=n=>'IconUtil_Ability_'+String(n).padStart(2,'0');
  function abilitiesOf(s){
   const list=[...(gameStats[s.type]?.abilities||[])];
   if(s.type==='HEROE_AGRADO'&&!list.includes('SOLTAR_FAMILIAR_HALCON'))list.push('SOLTAR_FAMILIAR_HALCON');
   return list.filter(a=>ABILITY_ICONS[a]);
  }
  function abilityButton(name,list){
   const hawkName=name==='SOLTAR_FAMILIAR_HALCON',wolfName=name==='SOLTAR_FAMILIAR_LOBO';
   const users=list.filter(s=>abilitiesOf(s).includes(name));
   const disabled=!PLAYED_ABILITIES.has(name);
   return {id:name,icon:abilityIcon(hawkName&&hawk.active?19:ABILITY_ICONS[name]),
    title:hawkName?`${label(hawk.active?'LTEXT_ORDEN_REGRESAR_FAMILIAR':'LTEXT_HABILIDAD_SOLTAR_FAMILIAR','Envoyer')} le faucon (K)`
     :wolfName?`${label('LTEXT_HABILIDAD_SOLTAR_FAMILIAR','Envoyer')} le loup (O)`:label('LTEXT_HABILIDAD_'+name,name),
    auto:name==='PILUM'?users.some(s=>s.autoPilum!==false):undefined,disabled,reason:disabled?'Aptitude pas encore reproduite dans cette reconstitution.':''};
  }
  function abilityButtons(){
   const list=selectedSquads.filter(s=>s.members.length),names=[];
   for(const s of list)for(const a of abilitiesOf(s))if(!names.includes(a))names.push(a);
   return names.slice(0,12).map((name,slot)=>({...abilityButton(name,list),slot,active:pendingOrder==='ability:'+name||(name==='SOLTAR_FAMILIAR_HALCON'&&pendingOrder==='hawk')}));
  }
  function useAbility(name){
   if(!selectedSquads.length)return;
   if(name==='SOLTAR_FAMILIAR_HALCON'){armOrder('hawk');return;}
   if(name==='PILUM'){
    const users=selectedSquads.filter(s=>abilitiesOf(s).includes('PILUM'));
    if(!users.some(s=>combat.canThrow(s))){toast('Endurance insuffisante : il faut 70 % d’endurance pour lancer les javelots.');return;}
    setPending(pendingOrder==='ability:PILUM'?null:'ability:PILUM');return;
   }
   toast('Aptitude pas encore reproduite dans cette reconstitution.');
  }
  // Right click on an ability: automatic use on or off (FLAG_EJECUCION_AUTOMATICA).
  function toggleAutoAbility(name){
   if(name!=='PILUM')return;
   const users=selectedSquads.filter(s=>abilitiesOf(s).includes('PILUM'));if(!users.length)return;
   const on=!users.some(s=>s.autoPilum!==false);
   for(const s of users)s.autoPilum=on;
   toast(on?'Javelots : lancer automatique activé.':'Javelots : lancer automatique désactivé (cliquez sur l’icône pour lancer).');
   refreshCommands();refreshSelectionPanel();
  }
  // ---- Construction: machines on the first row, buildings on the second, repair ----
  const BUILD_ICONS=[[/TORRE_ASALTO/,'21'],[/CATAPULTA/,'25'],[/BALLESTA/,'24'],[/ARIETE/,'23'],[/ESCALA/,'22'],[/ESCUDO/,'23'],
   [/PUENTE/,'20'],[/GUARNICION/,'07'],[/TORRE/,'26']];
  function constructionButtons(){
   const crew=selectedSquads.filter(canBuild);if(!crew.length)return [];
   const options=buildOptions(),machines=options.filter(o=>o.kind==='machine'),others=options.filter(o=>o.kind!=='machine');
   const button=(o,slot)=>({id:o.type,slot,icon:'IconUtil_Actions_'+(BUILD_ICONS.find(([re])=>re.test(o.type))?.[1]||'26'),
    title:`${o.label?text(o.label):unitTitles[o.type]||o.type}${o.kind==='bridge'?' · sur un chantier de pont':''}`,active:pendingOrder==='build:'+o.type});
   const buttons=[...machines.slice(0,4).map((o,i)=>button(o,i)),...others.slice(0,4).map((o,i)=>button(o,4+i))];
   buttons.push({id:'repair',slot:8,icon:'IconUtil_Actions_04',title:label('LTEXT_ORDEN_REPARAR','Réparer (R)'),active:pendingOrder==='repair',
    disabled:orderRestrictions.has('ORDEN_REPARAR'),reason:'Ordre indisponible.'});
   return buttons;
  }
  // ---- Recruiting: the race's troops as the HD's portraits, five a row ---------
  // A village selected: its grid trains them (and calls the centurion out,
  // sets the rally point); a centurion selected: his Construction tab
  // queues seven of them for his next village.
  function recruitTypes(){
   return villages?villages.trainable(humanCiv).filter(t=>!orderRestrictions.has('ORDEN_ENTRENAR_TROPAS|'+t)&&kindFor(t)&&unitModels[kindFor(t)]):[];
  }
  function recruitButton(type,slot,check){
   const q=villages.quote(type),cost=q.honour?` · ${q.honour} point${q.honour>1?'s':''} d’honneur`:'';
   const reason=check?.(q)||'';
   return {id:'train:'+type,slot,icon:portraitOfType(type),portrait:true,disabled:!!reason,reason,
    title:`${unitTitles[type]||type}\n${q.soldiers} soldats · ${q.population} habitants · ${Math.round(q.seconds)} s${cost}`};
  }
  function villageButtons(v){
   if(!v||v.owner!==humanCiv)return [];
   const buttons=recruitTypes().slice(0,13).map((type,k)=>recruitButton(type,k,q=>
    !villages.canEnter(v,humanCiv)?'Terminez la construction d’une garnison.':!recruiterInside(v)?NO_RECRUITER:v.queue.length>=RECRUIT_SLOTS?'La file de recrutement est pleine (7 troupes).':v.population<q.population?`Il faut ${q.population} habitants.`:honour.points<q.honour?`Il faut ${q.honour} point(s) d’honneur.`:''));
   const at=buttons.length,inside=v.inside.filter(s=>s.side==='player'&&s.members.length);
   if(inside.length)buttons.push({id:'leave',slot:at,icon:'IconUtil_Actions_28',title:label('LTEXT_ORDEN_SACAR_CENTURION','Sortir du village')});
   buttons.push({id:'rally',slot:at+(inside.length?1:0),icon:'IconUtil_Actions_02',title:label('LTEXT_ORDEN_RALLY_POINT','Fixer le point de ralliement'),active:pendingOrder==='rally'});
   return buttons;
  }
  function centurionRecruitButtons(){
   const list=selectedSquads.filter(isCenturion);if(!list.length)return [];
   const full=list.every(s=>(s.recruits?.length||0)>=RECRUIT_SLOTS);
   return recruitTypes().slice(0,15).map((type,k)=>recruitButton(type,k,()=>full?'La file du centurion est pleine (7 troupes).':''));
  }
  const commandPanel=window.PraetoriansCommandPanel.create({root:$('commandPanel'),
   onCommand:(tab,id)=>{
    if(id.startsWith('formation:')){changeFormation(id.slice(10));return;}
    if(id.startsWith('train:')){const type=id.slice(6);if(tab==='construction')queueRecruit(type);else if(selectedVillage)orderTraining(selectedVillage,type);return;}
    if(id==='leave'&&selectedVillage){const out=selectedVillage.inside.filter(s=>s.side==='player');for(const s of out)leaveVillage(s);if(out.length)setSelection(out);return;}
    if(id==='rally'){setPending(pendingOrder==='rally'?null:'rally');return;}
    if(tab==='actions')runAction(id);else if(tab==='abilities')useAbility(id);else if(id==='repair')armOrder('repair');else setPending(pendingOrder==='build:'+id?null:'build:'+id);
   },
   onToggleAuto:toggleAutoAbility,onDisabled:reason=>toast(reason)});
  function refreshCommands(){
   const village=!selectedSquads.length&&selectedVillage?selectedVillage:null,any=selectedSquads.length>0||!!village;
   if(pendingOrder&&(!any||(pendingOrder.startsWith('build:')&&!selectedSquads.some(canBuild)))){pendingOrder=null;buildPreview.hide();constructionPreviewState=null;refreshCursor();}
   if(village){
    const actions=villageButtons(village);
    commandPanel.render({tabs:{actions:actions.length>0,abilities:false,construction:false},buttons:{actions,abilities:[],construction:[]},columns:{actions:5}});
    return;
   }
   const recruiting=selectedSquads.some(isCenturion);
   // A troop in its tent: its only order calls the promotion or demotion off.
   const inTent=selectedSquads.filter(s=>s.members.length);
   if(inTent.length&&inTent.every(s=>s.transform)){
    const demoting=inTent.every(s=>s.transform.kind==='degrade');
    const actions=[{id:'cancelTransform',slot:0,icon:'IconUtil_Actions_15',
     title:demoting?label('LTEXT_ORDEN_ABORTAR_DEGRADAR','Annuler dégradation'):label('LTEXT_ORDEN_ABORTAR_TRANSFORMAR_A_CENTURION','Annuler promotion')}];
    commandPanel.render({tabs:{actions:true,abilities:false,construction:false},buttons:{actions,abilities:[],construction:[]}});
    return;
   }
   const actions=actionButtons(),abilities=abilityButtons(),construction=recruiting?centurionRecruitButtons():constructionButtons();
   commandPanel.render({tabs:{actions:actions.length>0,abilities:abilities.length>0,construction:construction.length>0},
    buttons:{actions,abilities,construction},columns:{construction:recruiting?5:4}});
  }
  function runAction(id){
   if(!selectedSquads.length){toast('Sélectionnez d’abord une troupe.');return;}
   switch(id){
    case 'move':case 'attack':case 'patrol':case 'protect':case 'face':armOrder(id);break;
    case 'defensive':case 'aggressive':setStance(id);break;
    case 'stop':holdPosition();break;
    case 'promote':promoteSelected();break;
    case 'degrade':degradeSelected();break;
    case 'merge':mergeSelected();break;
    case 'balance':balanceSelected();break;
    case 'split':splitSelected();break;
    case 'cancelTransform':cancelSelectedTransforms();break;
   }
   refreshCommands();
  }
  // Reorganised troops close ranks into fresh blocks, side by side across
  // their common front as a group order deploys them.
  function reorganised(list){
   const alive=list.filter(s=>s.members.length);if(!alive.length)return;
   const all=alive.flatMap(s=>s.members),heading=alive[0].r;
   const centre={x:all.reduce((n,m)=>n+m.x,0)/all.length,z:all.reduce((n,m)=>n+m.z,0)/all.length};
   for(const s of alive)s.radius=Math.max(.55,...motion.shape(s.members.length,s.spacing).map(p=>Math.hypot(p.dx,p.dz)+.28));
   const targets=new Map(SG.deploymentTargets(alive,centre,heading).map(t=>[t.squad,t]));
   for(const s of alive){
    // Reorganisation changes the troop's membership and slots. Restore its
    // mobile profile before walking survivors into the new regular block.
    s.formationTransition=null;s.formationRequest=null;combat.resetFormation(s);
    combat.move(s);s.orderQueue=null;
    for(const m of s.members)m.squad=s;
    s.units=s.members.length;
    motion.reform(s,navOf(s),heading,targets.get(s));refreshSquadInstances(s);
   }
   updateArmyStats();
  }
  // A troop whose men all joined another leaves the army.
  function retire(s){
   s.members.length=0;s.units=0;s.merged=true;s.ring?.setEnabled(false);s.orderQueue=null;s.formationTransition=null;s.formationRequest=null;
   for(const [index,group] of memorised)memorised.set(index,group.filter(o=>o!==s));
  }
  function mergeSelected(){
   const list=mergeCandidates();if(!list){toast(selectedSquads.some(s=>combat.isFormationLocked(s))?combat.FORMATION_LOCKED:'Ces troupes ne peuvent pas être réunies.');return;}
   const [keep,...rest]=list;
   for(const other of rest){keep.members.push(...other.members);retire(other);}
   reorganised([keep]);setSelection([keep]);refreshGroupButtons();
   toast(`${unitTitles[keep.type]||keep.type} réunis : ${keep.members.length} soldats.`);
   mission.onAction('merge');
  }
  let splitCount=0;
  function newTroop(source,members){
   const troop={name:`${source.name}_${++splitCount}`,type:source.type,civilization:source.civilization,units:members.length,
    position:[source.x,0,source.z],orientation:source.r,formation:source.formation,properties:[...(source.properties||[])]};
   const squad=spawnSquad(troop,squads.length,'player');if(!squad)return null;
   combat.add(squad,'player');
   // The placeholder men make way for the real ones, wounds and all.
   squad.members=members;for(const m of members)m.squad=squad;
   addRing(squad);squads.push(squad);allSquads.push(squad);
   return squad;
  }
  function splitSelected(){
   const list=splitCandidates();if(!list){toast(selectedSquads.some(s=>combat.isFormationLocked(s))?combat.FORMATION_LOCKED:'Aucune troupe à diviser.');return;}
   const made=[];
   for(const source of list){
    // The right-hand half of the block forms the new troop.
    const c=Math.cos(source.r),s=Math.sin(source.r),side=m=>(m.x-source.x)*c-(m.z-source.z)*s;
    const leaving=[...source.members].sort((a,b)=>side(a)-side(b)).slice(Math.ceil(source.members.length/2));
    for(const m of leaving)source.members.splice(source.members.indexOf(m),1);
    const squad=newTroop(source,leaving);
    if(!squad){source.members.push(...leaving);continue;}
    made.push(source,squad);
   }
   reorganised(made);setSelection(made);refreshGroupButtons();
   toast(`${made.length/2} troupe(s) divisée(s).`);
  }
  function balanceSelected(){
   const list=balanceCandidates();if(!list){toast(selectedSquads.some(s=>combat.isFormationLocked(s))?combat.FORMATION_LOCKED:'Ces troupes ne peuvent pas être équilibrées.');return;}
   const total=list.reduce((n,s)=>n+s.members.length,0),base=Math.floor(total/list.length);
   const want=new Map(list.map((s,i)=>[s,base+(i<total%list.length?1:0)]));
   for(const taker of list){
    while(taker.members.length<want.get(taker)){
     const donor=list.find(s=>s.members.length>want.get(s));if(!donor)break;
     // The donor's man nearest the receiving troop changes troop.
     let best=0,bestD=Infinity;
     donor.members.forEach((m,i)=>{const d=(m.x-taker.x)**2+(m.z-taker.z)**2;if(d<bestD){bestD=d;best=i;}});
     taker.members.push(donor.members.splice(best,1)[0]);
    }
   }
   reorganised(list);setSelection(list);
   toast(`Troupes équilibrées : ${list.map(s=>s.members.length).join(' / ')} soldats.`);
  }
  // ORDEN_ORIENTAR (F): the troops turn where they stand to face a point.
  function faceTowards(p){
   let turned=0;
   for(const s of selectedSquads){
    if(combat.isFormationLocked(s))continue;
    cancelFormation(s);
    if(combat.move(s,{x:s.x,z:s.z})===false)continue;
    s.orderQueue=null;
    if(motion.order(s,{x:s.x,z:s.z},navOf(s),Math.atan2(p.x-s.x,p.z-s.z)).ok)turned++;
   }
   setPending(null);redrawRoute();
   if(turned){toast(`${turned} troupe(s) font face.`);mission.onAction('face');}
   else toast(selectedSquads.some(s=>combat.isFormationLocked(s))?combat.FORMATION_LOCKED:ENGAGED);
  }
  // The scout's hawk: sent towards a point, or called back.
  // Scouts with a hawk (SOLTAR_FAMILIAR_HALCON): Agrado, the falconers.
  function hawkOwner(){return selectedSquads.find(s=>s.members.length&&(s.type==='HEROE_AGRADO'||gameStats[s.type]?.abilities?.includes('SOLTAR_FAMILIAR_HALCON')))||null;}
  function sendHawk(p){
   const owner=hawkOwner();
   if(!owner){toast('Sélectionnez l’éclaireur.');return;}
   if(hawk.active){toast('Le faucon est déjà en vol.');return;}
   releaseHawk(owner,p);toast('Le faucon s’envole.');
  }
  function recallHawk(){if(hawk.active&&hawk.phase!=='return'){hawk.phase='return';toast('Le faucon revient.');refreshCommands();}}
  function selectSquad(index,focus=false,add=false){
   const squad=squads[index];
   if(!squad||!squad.members.length){if(!add)setSelection([]);return;}
   if(add){setSelection(selectedSquads.includes(squad)?selectedSquads.filter(s=>s!==squad):[...selectedSquads,squad]);}
   else setSelection([squad],focus);
  }
  // Browsers restore checkbox state on reload without a change event.
  refreshDebugViews();
  document.querySelectorAll('[data-group]').forEach(button=>{
   const index=Number(button.dataset.group);
   button.addEventListener('click',event=>{
    if(recallGroup(index,false,event.shiftKey))return;
    if(squads[index]?.members.length)selectSquad(index,false,event.shiftKey);else toast('Ce groupe est vide.');
   });
   button.addEventListener('dblclick',()=>{if(!recallGroup(index,true)&&squads[index])selectSquad(index,true);});
   // Right-click a group button to memorise the current selection there.
   button.addEventListener('contextmenu',event=>{event.preventDefault();memoriseGroup(index);});
  });
  const ENGAGED='Les troupes engagées doivent finir leur mêlée avant de recevoir de nouveaux ordres.';
  function issueMove(squad,step){
   if(!combat.isFormationLocked(squad)&&(squad.formationTransition||squad.formationRequest))cancelFormation(squad);
   if(combat.move(squad,{x:step.x,z:step.z})===false){
    const rejected={ok:false,reason:squad.blockedReason||ENGAGED};
    if(squad.side==='player'){
     debugLastOrder={squad,to:{x:step.x,z:step.z},ok:false,reason:rejected.reason};updateVillageDebugStatus();
    }
    return rejected;
   }
   if(squad.sheltered)buildings.leave(squad);
   if(squad.inVillage)leaveVillage(squad);
   squad.enterTower=null;squad.enterVillage=null;squad.deployAt=null;
   const result=motion.order(squad,{x:step.x,z:step.z},navOf(squad),step.heading??null,step.preview||null);
   if(squad.side==='player'){
    debugLastOrder={squad,to:{x:step.x,z:step.z},ok:result.ok,reason:result.reason||'',
     diagnostic:result.diagnostic||null,failedRoute:result.failedRoute||null,
     adjusted:!!result.adjusted,endpoint:result.ok?result.points[result.points.length-1]:null,
     compactScale:result.scale??1,lateralPlan:result.maximumShift??0,compressionAttempts:result.compressionAttempts??1};
    if(!result.ok)console.info('Village obstacle diagnosis',navOf(squad).diagnose(squad.x,squad.z,squad.radius??.6));
    updateVillageDebugStatus();
   }
   if(result.ok)squad.running=!!step.run&&combat.canRun(squad);
   if(result.ok&&step.run&&!squad.running&&squad.side==='player')toast(`${unitTitles[squad.type]||squad.type} : trop épuisée pour courir.`);
   return result;
  }
  // run: ORDEN_CORRER (double right-click or Ctrl). queue: Shift adds a
  // waypoint after the current march.
  function orderGroup(anchor,explicitHeading=null,{run=false,queue=false,deployment=null}={}){
   if(!selectedSquads.length)return;
   pendingDeployment=null;
   const centroid={x:selectedSquads.reduce((n,s)=>n+s.x,0)/selectedSquads.length,z:selectedSquads.reduce((n,s)=>n+s.z,0)/selectedSquads.length};
   const heading=explicitHeading ?? SG.dragHeading(centroid,anchor,.15) ?? selectedSquads[0].r;
   const held=deployment&&deployment.selection.length===selectedSquads.length&&deployment.selection.every((s,i)=>s===selectedSquads[i])?deployment:null;
   let resolved=held;
   if(!resolved?.complete){
    const requested=held?.requestedTargets||SG.deploymentTargets(selectedSquads,anchor,heading);
    const solver=held?nearbyDeployment:nearbyOrderDeployment,key=held?.key||`order-${++deploymentOrderSequence}`;
    const result=resolveLocalDeployment(solver,requested,anchor,explicitHeading,{queue,key,workLimit:32768});
    if(!result.complete){
     pendingDeployment={solver,requested,anchor:{x:anchor.x,z:anchor.z},heading:explicitHeading,run,queue,key,selection:[...selectedSquads]};
     return;
    }
    resolved=result;
   }
   const targets=resolved.targets;
   let moved=0,queued=0,adjusted=0,reason='';const accepted=[];
   for(const target of targets){
    if(target.blocked||target.locked){
     // Deployment can refuse the move BEFORE issueMove() is invoked. Keep
     // that stage in F6 too (previously the overlay showed a stale order).
     const squad=target.squad,preview=target.preview;
     let why=target.locked?(combat.isFormationLocked(target.squad)?combat.FORMATION_LOCKED:'Combat prevents movement'):preview?.reason||'Nearby destination search found no legal deployment';
     const origin=preview?.points?.[0],end=preview?.formation;
     if(preview?.ok&&end?.valid&&origin&&Number.isFinite(preview.length)){
      const direct=Math.hypot(origin.x-end.x,origin.z-end.z);
      if(preview.length>direct*2.5+12+1e-7)
       why='Nearby deployment distance safeguard rejected a long detour (original unchanged rule)';
     }
     if(squad.side==='player')debugLastOrder={squad,to:{x:target.x,z:target.z},ok:false,
      reason:why,diagnostic:preview?.diagnostic||null,failedRoute:preview?.failedRoute||null};
     reason=why;continue;
    }
    const squad=target.squad,step={x:target.x,z:target.z,heading:explicitHeading,run};
    if(queue&&(squad.isMoving||squad.orderQueue?.length)){(squad.orderQueue??=[]).push(step);queued++;accepted.push(squad);continue;}
    if(target.preview?.ok)step.preview=target.preview;
    squad.orderQueue=null;
    const result=issueMove(squad,step);
    if(result.ok){moved++;accepted.push(squad);if(result.adjusted||target.adjusted)adjusted++;}
    else{
     reason=result.reason;
     console.info('Route refused',{from:{x:+squad.x.toFixed(2),z:+squad.z.toFixed(2)},to:{x:+target.x.toFixed(2),z:+target.z.toFixed(2)},radius:+squad.radius.toFixed(2),reason});
    }
   }
   setPending(null);redrawRoute();
   const going=moved+queued;
   answer(going?accepted:selectedSquads,going?(run&&accepted.some(s=>combat.canRun(s))?'R':'M'):'N');
   if(!going)toast(targets.some(t=>combat.isFormationLocked(t.squad))?combat.FORMATION_LOCKED:targets.some(t=>t.locked)?ENGAGED:'Aucun espace libre accessible à proximité.');
   else if(queued&&!moved)toast(`Point de passage ajouté (${queued} troupe(s)).`);
   else if(going<selectedSquads.length)toast(`${going}/${selectedSquads.length} troupes en route ; les autres sont bloquées.`);
   else toast(`${going} troupe(s) ${run?'au pas de course':'en marche'}${explicitHeading!==null?' · orientation fixée':''}${adjusted?` · ${adjusted} destination(s) ajustée(s)`:''}.`);
   if(going){if(run)mission.onAction('run');if(explicitHeading!==null)mission.onAction('face');}
  }
  // A visible enemy formation under the cursor, if any.
  function enemyAt(p){
   let best=null,bestD=1;
   // Occupants of a tower are protected by the building. Let the structure
   // receive the click instead of intercepting it with a rejected troop
   // attack that makes the enemy appear unreachable.
   for(const e of enemySquads){if(!e.visible||!e.members.length||e.sheltered||e.inVillage)continue;for(const m of e.members){const d=Math.hypot(m.x-p.x,m.z-p.z);if(d<bestD){best=e;bestD=d;}}}
   for(const c of companions.list){
    const e=c.owner;if(c.hidden||e.side!=='enemy'||!e.visible||!e.members.length)continue;
    for(const m of c.members){const d=Math.hypot(m.x-p.x,m.z-p.z);if(d<bestD){best=e;bestD=d;}}
   }
   return best;
  }
  // pilum: the javelins ordered thrown (the ability's button).
  function attackWith(foe,{pilum=false}={}){
   for(const squad of selectedSquads)cancelMobilePreparation(squad);
   // FLAG_NO_ATAQUE: the scout carries no weapon and cannot attack.
   const armed=selectedSquads.filter(s=>!s.profile?.noAttack);
   const accepted=armed.filter(s=>{s.orderQueue=null;clearStanding(s);return combat.attack(s,foe,{run:runOrder,pilum:pilum&&!!s.profile?.pilum});}),count=accepted.length;
   answer(count?accepted:selectedSquads,count?(runOrder?'T':'A'):'U');
   setPending(null);redrawRoute();
   if(!armed.length){toast(`${unitTitles[selectedSquads[0]?.type]||'Cette troupe'} ne peut pas attaquer.`);return;}
   toast(count?`${count} troupe(s) attaquent${runOrder?' au pas de course':''} : ${unitTitles[foe.type]||foe.type}.`:'Ces troupes sont déjà engagées en mêlée.');
  }
  // ---- Standing orders: patrol (L), protect (P), attack on the march (A) ---------
  // ORDEN_PATRULLAR: the troops walk to the point and back, over and over,
  // fighting what they meet; ORDEN_PROTEGER: they follow a friendly troop and
  // fall on whoever attacks it; Attaquer on open ground: they march there,
  // engaging enemies on the way.
  function patrolTo(p){
   let n=0;
   for(const s of selectedSquads){
    const from={x:s.x,z:s.z};
    if(issueMove(s,{x:p.x,z:p.z}).ok){s.patrol={points:[from,{x:p.x,z:p.z}],leg:1};n++;}
   }
   setPending(null);redrawRoute();
   toast(n?`${n} troupe(s) en patrouille.`:'Aucun chemin praticable jusqu’à ce point.');
   answer(selectedSquads,n?'G':'N');
  }
  function protectWith(friend){
   if(!friend||!friend.members.length||friend.inVillage){toast('Cliquez sur une de vos troupes.');return;}
   const guards=selectedSquads.filter(s=>s!==friend&&!combat.isFormationLocked(s));
   if(!guards.length){if(selectedSquads.some(s=>combat.isFormationLocked(s)))toast(combat.FORMATION_LOCKED);setPending(null);return;}
   for(const s of guards){s.protect=friend;s.protectDest=null;}
   setPending(null);
   toast(guards.length?`${guards.length} troupe(s) protègent : ${unitTitles[friend.type]||friend.type}.`:'Une troupe ne peut pas se protéger elle-même.');
  }
  function attackMoveTo(p){
   let n=0;
   for(const s of selectedSquads){if(s.profile?.noAttack)continue;if(issueMove(s,{x:p.x,z:p.z}).ok){s.attackMove={x:p.x,z:p.z};n++;}}
   setPending(null);redrawRoute();
   toast(n?`${n} troupe(s) avancent en combattant.`:'Aucun chemin praticable jusqu’à ce point.');
  }
  // Attaquer on tall grass with bowmen: fire arrows (their FUEGO weapon) on
  // the cell until it catches (src/world/meadows.js fire). Their target is a
  // structure-like spot for combat's siege march and volleys.
  const GRASS_DEFENSES={melee:0,projectile:0,fire:100,building:0};
  function grassTarget(p){
   const cx=Math.floor(p.x),cz=Math.floor(p.z),centre={x:cx+.5,z:cz+.5};
   return {kind:'meadow',centre,radius:1,defenses:GRASS_DEFENSES,
    alive:()=>meadows.isGrass(centre.x,centre.z)&&!meadows.burning.has(cz*W+cx),
    damage(){},hit(life,fire){if(fire>0&&meadows.heat(centre.x,centre.z,fire))toast('Les herbes prennent feu !');},
    fireFull:()=>false,
    aimPoint:random=>({x:centre.x+(random()-.5)*1.2,z:centre.z+(random()-.5)*1.2,y:groundY(centre.x,centre.z)+.4}),
    distanceTo:q=>Math.hypot(q.x-centre.x,q.z-centre.z),
    approach(from,weapon){
     const d=Math.hypot(from.x-centre.x,from.z-centre.z),a=Math.atan2(from.z-centre.z,from.x-centre.x);
     const want=Math.max((weapon?.rangeMin||0)+1,Math.min((weapon?.rangeMax||10)*.8,d));
     return {x:centre.x+Math.cos(a)*want,z:centre.z+Math.sin(a)*want};
    },
    ring(from,weapon){const r=Math.max(4,(weapon?.rangeMax||10)*.7);return Array.from({length:12},(_,k)=>({x:centre.x+Math.cos(k*Math.PI/6)*r,z:centre.z+Math.sin(k*Math.PI/6)*r}));}};
  }
  const canBurn=s=>{const w=!s.profile?.noAttack&&combat.structureWeapon(s.type,GRASS_DEFENSES);return !!w&&w.kind==='ranged'&&(w.damage?.fire||0)>0;};
  function burnGrassAt(p){
   const archers=selectedSquads.filter(canBurn);if(!archers.length)return false;
   const target=grassTarget(p);let n=0;
   for(const s of archers){cancelMobilePreparation(s);s.orderQueue=null;clearStanding(s);if(combat.attackStructure(s,target,'attack',{run:runOrder}))n++;}
   setPending(null);redrawRoute();
   answer(archers,n?'A':'U');
   toast(n?`${n} troupe(s) tirent des flèches enflammées sur les herbes.`:'Ces troupes ne peuvent pas incendier les herbes.');
   return true;
  }
  // ORDEN_REPARAR (R): builders mend one of our damaged buildings.
  function repairAt(p){
   const e=buildings.at(p.x,p.z);
   if(!e||e.state!=='built'||!(e.life<e.maxLife||e.fire>0)||!(e.owner===humanCiv||allied(e.owner,humanCiv))){toast('Cliquez sur un de vos bâtiments endommagés.');return;}
   const crew=selectedSquads.filter(canBuild);let n=0;
   for(const s of crew){cancelMobilePreparation(s);s.orderQueue=null;clearStanding(s);if(combat.attackStructure(s,buildings.target(e,{repair:true}),'work'))n++;}
   answer(crew,n?'G':'U');
   setPending(null);toast(n?`${n} troupe(s) réparent.`:'Ces troupes ne peuvent pas réparer.');
  }
  const BUSY=new Set(['melee','approach','pursue','shoot','siege']);
  // The nearest enemy troop the player can see within reach of a troop.
  function enemyNear(s,reach){
   const c=combat.centroid(s);let best=null,bestD=reach;
   for(const e of enemySquads){
    if(!e.visible||!e.members.length||e.sheltered||e.inVillage)continue;
    const d=Math.hypot(e.x-c.x,e.z-c.z)-combat.spread(e);if(d<bestD){best=e;bestD=d;}
   }
   return best;
  }
  const engageReach=s=>s.profile?.ranged?s.profile.ranged.rangeMax:Math.min(10,s.profile?.vision||10);
  let ordersTimer=0;
  function updateOrders(dt){
   if((ordersTimer-=dt)>0)return;ordersTimer=.25;
   for(const s of squads){
    if(!s.patrol&&!s.protect&&!s.attackMove)continue;
    if(!s.members.length||s.inVillage){clearStanding(s);continue;}
    const busy=BUSY.has(s.combat?.mode);
    if(s.protect){
     const friend=s.protect;
     if(!friend.members.length||friend.inVillage){s.protect=null;continue;}
     if(busy)continue;
     const fc=friend.combat,threat=(fc&&BUSY.has(fc.mode)&&fc.target?.members?.length&&fc.target.side!=='player'?fc.target:null)||[...(fc?.foes||[])].find(o=>o.members.length)||enemyNear(friend,6);
     if(threat&&!s.profile?.noAttack&&combat.attack(s,threat))continue;
     const at=combat.centroid(friend),here=combat.centroid(s),gap=friend.radius+s.radius+1.5;
     if(Math.hypot(at.x-here.x,at.z-here.z)>gap+2){
      // A place behind the friendly troop, kept as it marches.
      const dest={x:at.x-Math.sin(friend.r)*gap,z:at.z-Math.cos(friend.r)*gap};
      if(!s.isMoving||!s.protectDest||Math.hypot(dest.x-s.protectDest.x,dest.z-s.protectDest.z)>2.5){
       const keep=s.protect;if(issueMove(s,dest).ok)s.protectDest=dest;s.protect=keep;
      }
     }
     continue;
    }
    if(busy)continue;
    // Patrols and attacks on the march fight what they meet (not defensive troops).
    if(s.combat?.stance!=='defensive'&&!s.profile?.noAttack){const foe=enemyNear(s,engageReach(s));if(foe&&combat.attack(s,foe))continue;}
    if(s.isMoving)continue;
    if(s.patrol){
     const p=s.patrol,to=p.points[p.leg];
     if(Math.hypot(s.x-to.x,s.z-to.z)<2.5)p.leg=(p.leg+1)%p.points.length;
     const next=p.points[p.leg],keep=s.patrol;
     if(!issueMove(s,next).ok){s.patrol=null;if(selectedSquads.includes(s))toast('Patrouille interrompue : chemin bloqué.');}else s.patrol=keep;
    }else if(s.attackMove){
     const to=s.attackMove;
     if(Math.hypot(s.x-to.x,s.z-to.z)<2.5){s.attackMove=null;continue;}
     if(!issueMove(s,to).ok)s.attackMove=null;else s.attackMove=to;
    }
   }
  }
  function getGroundAt(clientX,clientY){
   const rect=canvas.getBoundingClientRect();
   const hit=scene.pick(clientX-rect.left,clientY-rect.top,m=>m===ground);
   return hit.hit?hit.pickedPoint:null;
  }
  function localPoint(event){const rect=canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};}
  function worldToScreen(pos){
   const rect=canvas.getBoundingClientRect();
   const projected=B.Vector3.Project(new B.Vector3(pos.x,pos.y,pos.z),B.Matrix.Identity(),scene.getTransformMatrix(),camera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight()));
   return {x:projected.x*rect.width/engine.getRenderWidth(),y:projected.y*rect.height/engine.getRenderHeight()};
  }
  function squadsInRectangle(rect){
   return squads.filter(s=>{
    if(s.inVillage)return false;
    const projected=[worldToScreen({x:s.x,y:groundY(s.x,s.z)+.55,z:s.z}),...s.members.map(m=>worldToScreen({x:m.x,y:m.y+.7,z:m.z}))];
    return projected.some(p=>SG.inRect(p,rect));
   });
  }
  function nearestSquadOnGround(p){
   const nearest=squads.filter(s=>!s.inVillage).map(s=>({s,d:Math.min(Math.hypot(s.x-p.x,s.z-p.z),...s.members.map(m=>Math.hypot(m.x-p.x,m.z-p.z)))})).sort((a,b)=>a.d-b.d)[0];
   let best=nearest&&nearest.d<.75?nearest.s:null,bestD=best?nearest.d:.75;
   for(const c of companions.list){
    if(c.hidden||c.owner.side!=='player'||!c.owner.members.length)continue;
    for(const m of c.members){const d=Math.hypot(m.x-p.x,m.z-p.z);if(d<bestD){best=c.owner;bestD=d;}}
   }
   return best;
  }
  function showFacing(start,end){
   facingGuide.hidden=false;
   facingGuide.style.left=`${start.x}px`;facingGuide.style.top=`${start.y}px`;
   const dx=end.x-start.x,dy=end.y-start.y;
   facingStem.style.width=`${Math.max(26,Math.hypot(dx,dy))}px`;
   facingStem.style.transform=`rotate(${Math.atan2(dy,dx)}rad)`;
  }
  let pointerStart=null,pointer={x:-1,y:-1,inside:false};
  formationPreview=window.PraetoriansFormationPreview.create({B,scene,groundY});
  function hideFormationPreview(cancel=false){
   formationPreview?.hide();formationPreviewState=null;formationPreviewStamp='';formationPreviewNext=0;formationPreviewRetry=false;
   if(cancel&&pointerStart?.button===2){pointerStart=null;facingGuide.hidden=true;}
  }
  function intendedFormation(squad,target,yaw,valid=true){
   const c=Math.cos(yaw),s=Math.sin(yaw);
   return motion.shape(squad.members.length,squad.spacing).map(slot=>{
    const x=target.x+c*slot.dx+s*slot.dz,z=target.z-s*slot.dx+c*slot.dz;
    return {x,z,r:yaw,valid:valid&&x>=0&&z>=0&&x<W&&z<D};
   });
  }
  function deploymentPrediction(target,heading,queue){
   const squad=target.squad,queued=queue&&(squad.isMoving||squad.orderQueue?.length);
   const previous=queued?(squad.orderQueue?.at(-1)||squad.destination):null;
   const source=previous?{...squad,x:previous.x,z:previous.z,r:previous.heading??squad.finalFacing??squad.r}:squad;
   const yaw=heading??SG.dragHeading(source,target,.01)??source.r,intended=intendedFormation(squad,target,yaw);
   return {source,yaw,intended,queued,provisional:!intended.every(p=>vision.seen(p.x,p.z))};
  }
  function deploymentVisionStamp(anchor){
   const point=`${humanCiv}:${anchor.x}:${anchor.z}`;
   if(formationVisionCache?.point===point&&formationVisionCache.version===vision.version)return formationVisionCache.hash;
   let hash=2166136261;
   const c=vision.cell,x0=Math.max(0,Math.floor((anchor.x-26)/c)),x1=Math.min(vision.cols-1,Math.ceil((anchor.x+26)/c));
   const z0=Math.max(0,Math.floor((anchor.z-26)/c)),z1=Math.min(vision.rows-1,Math.ceil((anchor.z+26)/c));
   for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)hash=Math.imul(hash^(vision.seen((x+.5)*c,(z+.5)*c)?1:0),16777619);
   formationVisionCache={point,version:vision.version,hash};return hash;
  }
  function resolveLocalDeployment(solver,requested,anchor,heading,{queue=false,key,workLimit=8192}={}){
   const started=performance.now(),predictions=new Map(requested.map(t=>{
    const p=deploymentPrediction(t,heading,queue);
    p.clearRadius=Math.max(t.squad.radius||0,...p.intended.map(m=>Math.hypot(m.x-t.x,m.z-t.z)+.28))+.1;
    return [t.squad,p];
   }));
   const locked=t=>combat.isFormationLocked(t.squad)||(t.squad.combat?.mode==='melee'&&t.squad.combat.engaged);
   const movable=requested.filter(t=>!locked(t)),forecasts=new Map();let workLeft=workLimit,workUsed=0;
   const token=(t,p)=>`${t.squad.index}:${p.x}:${p.z}`;
   function budget(t,fn){
    const grid=navOf(t.squad),before=grid.workUnits||0;
    const result=grid.withWorkBudget?grid.withWorkBudget(workLeft,fn):fn();
    const used=Math.max(0,(grid.workUnits||0)-before);workUsed+=used;workLeft=Math.max(0,workLeft-used);return result;
   }
   const result=solver.resolve(movable,{anchor,heading,key,
    within:(candidate,t)=>{
     // A 6x5 infantry block is not a circle. Requiring its 1.8 m diagonal
     // radius to fit inside the map rejects legal positions along the border.
     // Validate the actual rotated soldier slots with a small body margin.
     const source=predictions.get(t.squad).source,yaw=heading??SG.dragHeading(source,candidate,.01)??source.r;
     return candidate.x>=.2&&candidate.z>=.2&&candidate.x<=W-.2&&candidate.z<=D-.2&&
      intendedFormation(t.squad,candidate,yaw).every(p=>p.x>=.13&&p.z>=.13&&p.x<=W-.13&&p.z<=D-.13);
    },
    known:(candidate,t)=>{
     const source=predictions.get(t.squad).source,yaw=heading??SG.dragHeading(source,candidate,.01)??source.r;
     const intended=intendedFormation(t.squad,candidate,yaw);
     // Only inspect the visible formation footprint. The old circular fog
     // requirement could exclude a perfectly visible troop standing beside
     // the battlefield edge or an unexplored strip of snow.
     if(!intended.every(p=>vision.seen(p.x,p.z)))return false;
     return intended.every(p=>vision.seen(p.x+.1,p.z)&&vision.seen(p.x-.1,p.z)&&
      vision.seen(p.x,p.z+.1)&&vision.seen(p.x,p.z-.1));
    },
    canFit:(candidate,t)=>budget(t,()=>{
     const grid=navOf(t.squad);
     if(!grid.canStand(candidate.x,candidate.z,.2))return false;
     const forecast=combat.previewMove(predictions.get(t.squad).source,candidate);forecasts.set(token(t,candidate),forecast);
     if(!forecast.ok)return false;
     if(forecast.provisional)return true;
     // V7: do not require the *unsqueezed* squad radius when its actual
     // final member slots fit. The shared movement controller handles
     // restrained compression on tight roads; the old radius check could
     // reject all move orders before they reached motion.order().
     // With no explicit facing, the route determines the eventual heading;
     // do not reject a candidate based on the straight-line bearing here.
     if(heading===null)return true;
     const formation=motion.previewFormation(forecast.source,candidate,grid,heading);
     return {ok:formation.valid,formation};
    }),
    validate:(candidate,t)=>budget(t,()=>{
     const forecast=forecasts.get(token(t,candidate))||combat.previewMove(predictions.get(t.squad).source,candidate);
     if(!forecast.ok)return {ok:false,reason:forecast.reason};
     if(forecast.provisional)return {ok:false,provisional:true};
     const grid=navOf(t.squad),preview=motion.previewOrder(forecast.source,candidate,grid,heading),form=preview.formation;
     if(preview.ok&&form&&!form.files&&!form.valid)return {ok:false,reason:'formation-clearance'};
     return preview;
    })});
   const bySquad=new Map(result.targets.map(t=>[t.squad,t]));
   result.targets=requested.map(t=>locked(t)?{...t,locked:true,blocked:true}:bySquad.get(t.squad));
   result.ok=result.targets.every(t=>!t.blocked&&!t.deferred);
   const markers=[];
   for(const t of result.targets){
    if(!t.blocked&&!t.deferred&&t.preview?.ok&&t.preview.formation?.valid)markers.push(...t.preview.formation.members);
    else{
     const intended=predictions.get(t.squad).intended;
     markers.push(...intended.map(p=>({...p,valid:p.valid&&!t.blocked&&!t.locked})));
    }
   }
   return {...result,markers,workUsed,planningMs:performance.now()-started};
  }
  function updatePendingDeployment(){
   const job=pendingDeployment;if(!job||document.hidden||ordersBlocked()||!settings.hidden||window.PraetoriansMenu?.isOpen())return;
   if(job.selection.length!==selectedSquads.length||job.selection.some((s,i)=>s!==selectedSquads[i])){pendingDeployment=null;return;}
   const result=resolveLocalDeployment(job.solver,job.requested,job.anchor,job.heading,{queue:job.queue,key:job.key});
   if(!result.complete)return;
   pendingDeployment=null;
   orderGroup(job.anchor,job.heading,{run:job.run,queue:job.queue,deployment:{...result,selection:job.selection}});
  }
  function updateFormationPreview(force=false){
   const start=pointerStart;
   if(!start||start.button!==2||!start.world||!selectedSquads.length||pendingOrder||spawnMode||!pointer.inside||!settings.hidden||ordersBlocked()||document.hidden||window.PraetoriansMenu?.isOpen()){
    hideFormationPreview(!!start&&(!settings.hidden||ordersBlocked()||document.hidden||!!window.PraetoriansMenu?.isOpen()));return null;
   }
   const rect=canvas.getBoundingClientRect(),current={x:pointer.x-rect.left,y:pointer.y-rect.top};
   const dragged=Math.hypot(current.x-start.x,current.y-start.y)>7;
   // A normal click on an enemy/building is an interaction, not a deployment.
   if(!dragged&&(enemyAt(start.world)||hostileGateAt(start.world)||visibleStructureAt(start.world.x,start.world.z)||villageAt(start.world))){hideFormationPreview();return null;}
   const tip=dragged?groundUnder(pointer.x,pointer.y):null;
   const explicitHeading=dragged&&tip?SG.dragHeading(start.world,tip,.15):null;
   const centre={x:selectedSquads.reduce((n,s)=>n+s.x,0)/selectedSquads.length,z:selectedSquads.reduce((n,s)=>n+s.z,0)/selectedSquads.length};
   const heading=explicitHeading??SG.dragHeading(centre,start.world,.15)??selectedSquads[0].r;
   const selection=[...selectedSquads],targets=SG.deploymentTargets(selection,start.world,heading);
   const now=performance.now();
   if(!force&&now<formationPreviewNext)return formationPreviewState;
   const predictions=targets.map(target=>deploymentPrediction(target,explicitHeading,start.shift));
   const stamp=[start.world.x,start.world.z,explicitHeading,start.shift,deploymentVisionStamp(start.world),...predictions.map(p=>p.provisional),...selection.flatMap(s=>{
    const centre=combat.centroid(s);
    return [s.index,s.members.length,s.x.toFixed(2),s.z.toFixed(2),centre.x.toFixed(2),centre.z.toFixed(2),s.r.toFixed(3),s.needsReform,s.combat?.mode,s.combat?.engaged,s.destination?.x,s.destination?.z,...(s.orderQueue||[]).flatMap(p=>[p.x,p.z,p.heading]),formationNavStamp(s),s.formationVersion||0,s.formationState?.id||'',!!s.formationState?.pending];
   })].join('|');
   if(!force&&stamp===formationPreviewStamp&&!formationPreviewRetry)return formationPreviewState;
   formationPreviewNext=now+50;formationPreviewStamp=stamp;formationPreviewRetry=false;
   const result=resolveLocalDeployment(nearbyDeployment,targets,start.world,explicitHeading,{queue:start.shift,key:stamp});
   formationPreviewRetry=result.deferred;
   const state={...result,key:stamp,requestedTargets:targets,anchor:{x:start.world.x,z:start.world.z},heading:explicitHeading,selection};
   formationPreview.show(result.markers);formationPreviewState=state;
   return state;
  }
  // ---- Cursors (src/ui/cursors.js): what a click would do -----------------------
  // The ground under the pointer, by marching the view ray down onto the
  // height field: cheap enough to follow every pointer move.
  const Cursors=window.PraetoriansCursors;
  function groundUnder(clientX,clientY){
   const rect=canvas.getBoundingClientRect(),ray=scene.createPickingRay(clientX-rect.left,clientY-rect.top,B.Matrix.Identity(),camera,false);
   const o=ray.origin,d=ray.direction;if(d.y>-1e-3)return null;
   let t=Math.max(0,(o.y-40)/-d.y),prev=t;
   const at=k=>({x:o.x+d.x*k,y:o.y+d.y*k,z:o.z+d.z*k}),above=k=>{const q=at(k);return q.y>groundY(q.x,q.z);};
   for(let i=0;i<500&&above(t);i++){prev=t;t+=.35;}
   if(above(t))return null;
   let lo=prev,hi=t;for(let i=0;i<10;i++){const mid=(lo+hi)/2;if(above(mid))lo=mid;else hi=mid;}
   const q=at(hi);return q.x<0||q.z<0||q.x>W||q.z>D?null:q;
  }
  // Wheat (PRADERA), forest and the shore have their own cursors.
  function terrainKind(x,z){
   const cx=Math.floor(x),cz=Math.floor(z);if(!map.logical||cx<0||cz<0||cx>=W||cz>=D)return null;
   const v=map.logical[cz*W+cx],type=v>>>27;
   if(type===Logical.TYPE.PRADERA)return meadows.isBurnt(x,z)?null:'meadow';
   if(v&FOREST)return 'forest';
   if(type===Logical.TYPE.ORILLA||type===Logical.TYPE.AGUA_PROFUNDA)return 'shore';
   return null;
  }
  function refreshCursor(){
   let name='NORMAL';
   const p=pointer.inside&&!ordersBlocked()&&!spawnMode?groundUnder(pointer.x,pointer.y):null;
   const placement=updateBuildPreview(p);
   if(p){
    const sel=selectedSquads.length>0,pending=pendingOrder;
    const kind=pending?.startsWith('build:')?(buildingData.structures[pending.slice(6)]?.kind==='PUENTE'?'bridge':'build'):pending?.startsWith('ability:')?'ability':pending;
    const enemy=sel?enemyAt(p):null,friend=sel?nearestSquadOnGround(p):null;
    const e=sel?visibleStructureAt(p.x,p.z):null;
    const hostile=e&&e.state!=='destroyed'&&buildings.hostileTo(e,humanCiv)?(e.kind==='TORRE_DEFENSA'?'tower':'building'):sel&&hostileGateAt(p)?'building':null;
    const builders=sel&&selectedSquads.some(canBuild);
    const repairable=!!e&&builders&&e.state==='built'&&(e.life<e.maxLife||e.fire>0)&&(e.owner===humanCiv||allied(e.owner,humanCiv));
    const v=sel&&!e?villageAt(p):null;
    const grid=sel?navOf(selectedSquads[0]):null;
    const walkable=!grid||grid.canStand(p.x,p.z,.2)||!!fortress?.walkwayAt?.(p.x,p.z)||!!e;
    name=Cursors.choose({pending:kind,terrain:terrainKind(p.x,p.z),selection:sel,enemy:!!enemy,friend:!!friend&&!selectedSquads.includes(friend)||kind!=='protect'&&!!friend,
     hostileStructure:hostile,repairable,enterVillage:!!v&&selectedSquads.some(s=>isCenturion(s)&&villages?.canEnter(v,s.civ)),
     garrisonSite:!!v&&v.kind==='PUEBLO'&&builders&&(!v.garrison||v.garrison.state==='destroyed'||(v.garrison.state==='site'&&v.garrison.owner===humanCiv)),walkable:placement?placement.ok:walkable});
    if(placement&&!placement.ok)name='PROHIBIDO';
    // Troops in their tent take no orders.
    if(sel&&!friend&&selectedSquads.every(s=>s.transform))name='PROHIBIDO';
   }
   Cursors.apply(canvas,name);
  }
  function updateBuildPreview(point){
   if(!pendingOrder?.startsWith('build:')||!pointer.inside||!settings.hidden||spawnMode||ordersBlocked()||window.PraetoriansMenu?.isOpen()){
    buildPreview.hide();constructionPreviewState=null;return null;
   }
   const p=point===undefined?groundUnder(pointer.x,pointer.y):point;
   if(!p){buildPreview.hide();constructionPreviewState=null;return null;}
   const state=buildingPlacement(pendingOrder.slice(6),p);constructionPreviewState=state;
   if(Number.isFinite(state.x)&&Number.isFinite(state.z))buildPreview.show(state.type,{x:state.x,z:state.z,r:state.r,valid:state.ok});else buildPreview.hide();
   return state;
  }
  let cursorQueued=false;
  function scheduleCursor(){if(cursorQueued)return;cursorQueued=true;requestAnimationFrame(()=>{cursorQueued=false;refreshCursor();});}
  // Middle-mouse drag rotates the camera. Right mouse is reserved for orders.
  // Cut-scenes and the end screen take no orders.
  const ordersBlocked=()=>missionUi.cinema.active||missionEnded;
  canvas.addEventListener('pointerdown',e=>{
   if(e.button!==0&&e.button!==2)return;
   if(ordersBlocked()){e.preventDefault();return;}
   const start=localPoint(e);
   pointer.x=e.clientX;pointer.y=e.clientY;pointer.inside=true;
   pointerStart={x:start.x,y:start.y,button:e.button,shift:e.shiftKey,world:e.button===2?getGroundAt(e.clientX,e.clientY):null,id:e.pointerId};
   if(e.button===2)e.preventDefault();
   if(e.button===2)pendingDeployment=null;
   try{canvas.setPointerCapture(e.pointerId);}catch{}
   canvas.focus();
   if(e.button===2)updateFormationPreview(true);
  });
  canvas.addEventListener('pointermove',e=>{
   pointer.x=e.clientX;pointer.y=e.clientY;pointer.inside=true;scheduleCursor();
   if(!pointerStart||e.pointerId!==pointerStart.id)return;
   const current=localPoint(e),start=pointerStart;
   if(start.button===0){
    const rect=SG.rectFromPoints(start,current);
    if(Math.hypot(current.x-start.x,current.y-start.y)>6){
     marquee.hidden=false;
     Object.assign(marquee.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.right-rect.left}px`,height:`${rect.bottom-rect.top}px`});
    }
   }else if(start.button===2&&start.world&&selectedSquads.length&&Math.hypot(current.x-start.x,current.y-start.y)>7){
    showFacing(start,current);
   }
   if(start.button===2)updateFormationPreview();
  });
  canvas.addEventListener('pointerleave',()=>{pointer.inside=false;buildPreview.hide();constructionPreviewState=null;hideFormationPreview(true);});
  canvas.addEventListener('pointercancel',()=>{pointerStart=null;marquee.hidden=true;facingGuide.hidden=true;hideFormationPreview();});
  canvas.addEventListener('lostpointercapture',()=>{if(pointerStart){pointerStart=null;marquee.hidden=true;facingGuide.hidden=true;hideFormationPreview();}});
  canvas.addEventListener('pointerup',e=>{
   const start=pointerStart;if(!start||start.id!==e.pointerId)return;
   const shown=formationPreviewState;
   pointerStart=null;marquee.hidden=true;facingGuide.hidden=true;
   hideFormationPreview();
   try{canvas.releasePointerCapture(e.pointerId);}catch{}
   const current=localPoint(e),dragged=Math.hypot(current.x-start.x,current.y-start.y)>7;
   if(start.button===0){
    if(dragged){
     const chosen=squadsInRectangle(SG.rectFromPoints(start,current));
     const next=start.shift?[...selectedSquads,...chosen]:chosen;
     setSelection(next);if(chosen.length)toast(`${selectedSquads.length} troupe(s) sélectionnée(s).`);
     else if(!start.shift){selectVillage(null);selectStructure(null);}
     // VigilarInterfazCajaSeleccion: troops chosen with the selection box.
     if(chosen.length)mission.onAction('boxSelect',{types:selectedSquads.map(s=>s.type)});
     return;
    }
    const p=getGroundAt(e.clientX,e.clientY);
    if(!p)return;
    if(spawnMode){
     const what=$('spawnType').value;
     if(what.startsWith('structure:')){
      const e=spawnStructureAt($('spawnSide').value==='enemy'?'enemy':'player',what.slice(10),p.x,p.z);
      toast(e?`${e.def.label?text(e.def.label):e.type} (${e.owner}) placé.`:'Impossible de placer ce bâtiment ici.');
      return;
     }
     spawnTest($('spawnSide').value,what,Number($('spawnCount').value)||1,p.x,p.z);
     return;
    }
    if(pendingOrder){executePending(p,e);return;}
    // A troop, unless a structure is drawn over it (the ray meets the
    // structure above a man's height); then a structure before a village
    // (a garrison stands within its village's reach).
    const nearest=nearestSquadOnGround(p),hit=structureUnder(e.clientX,e.clientY);
    if(nearest&&!(hit&&hit.height>1.8))selectSquad(nearest.index,false,start.shift);
    else if(!start.shift){const v=hit?null:villageAt(p);setSelection([]);selectVillage(v);selectStructure(hit?.entity||null);}
    const x=Math.max(0,Math.min(W-1,Math.floor(p.x))),z=Math.max(0,Math.min(D-1,Math.floor(p.z))),i=z*W+x;
    $('inspection').textContent=`World: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}\nCell: ${x}, ${z}\nTile A / B: ${map.pve.textureIndexA[i]} / ${map.pve.textureIndexB[i]}\nPVE flags: 0x${map.pve.flags[i].toString(16)}\nMLG flags: 0x${map.logical[i].toString(16)}`;
   }else if(start.button===2&&start.world){
    if(pendingOrder&&!dragged){executePending(start.world,e);return;}
    for(const s of selectedSquads)clearStanding(s);
    const tip=getGroundAt(e.clientX,e.clientY);
    // A second right click on the same spot turns the march into a run.
    const now=performance.now(),double=!dragged&&now-lastRightClick.time<400&&Math.hypot(current.x-lastRightClick.x,current.y-lastRightClick.y)<16;
    lastRightClick=double||dragged?{time:0,x:0,y:0}:{time:now,x:current.x,y:current.y};
    const foe=!dragged&&selectedSquads.length?enemyAt(start.world):null;
    runOrder=e.ctrlKey||double;
    try{
     if(foe){attackWith(foe);return;}
     const gate=!dragged&&selectedSquads.length?hostileGateAt(start.world):null;
     if(gate){attackGateWith(gate);return;}
     if(!dragged&&selectedSquads.length&&(ladderOrder(start.world)||structureOrder(start.world)))return;
    }finally{runOrder=false;}
    const heading=shown?shown.heading:dragged&&tip?SG.dragHeading(start.world,tip,.15):null;
    orderGroup(shown?.anchor||start.world,heading,{run:e.ctrlKey||double,queue:start.shift,deployment:shown});
   }
  });
  function executePending(p,e){
   const kind=pendingOrder;
   for(const s of selectedSquads)if(kind!=='hawk'&&!kind?.startsWith('build:')&&kind!=='repair')clearStanding(s);
   if(kind==='face'){faceTowards(p);return;}
   if(kind==='hawk'){setPending(null);sendHawk(p);return;}
   if(kind?.startsWith('build:')){
    const type=kind.slice(6),shown=constructionPreviewState;
    // Commit the pose actually displayed, then revalidate it. A fresh pick
    // can update Babylon's camera matrix during pointer-up and otherwise
    // shift the construction away from its visible ghost.
    placeBuilding(type,shown?.type===type?shown:groundUnder(e.clientX,e.clientY)||p);return;
   }
   if(kind==='ability:PILUM'){
    const foe=enemyAt(p);if(!foe){toast('Cliquez sur une troupe ennemie visible.');return;}
    attackWith(foe,{pilum:true});mission.onAction('ability',{name:'PILUM'});return;
   }
   if(kind==='repair'){repairAt(p);return;}
   if(kind==='rally'){if(selectedVillage){selectedVillage.rally={x:p.x,z:p.z};toast('Point de ralliement fixé : les troupes recrutées s’y rendront.');}setPending(null);return;}
   if(kind==='protect'){protectWith(nearestSquadOnGround(p));return;}
   if(kind==='patrol'){patrolTo(p);return;}
   if(kind==='attack'){
    const foe=enemyAt(p);if(foe){attackWith(foe);return;}
    const gate=hostileGateAt(p);if(gate){attackGateWith(gate);return;}
    const building=visibleStructureAt(p.x,p.z);if(building&&buildings.hostileTo(building,humanCiv)){attackStructureWith(building);return;}
    if(meadows.isGrass(p.x,p.z)&&burnGrassAt(p))return;
    attackMoveTo(p);return;
   }
   const foe=kind==='move'?enemyAt(p):null;
   if(foe){attackWith(foe);return;}
   const gate=kind==='move'?hostileGateAt(p):null;
   if(gate){attackGateWith(gate);return;}
   if(kind==='move'&&(ladderOrder(p)||structureOrder(p)))return;
   orderGroup(p,null,{run:kind==='run'||e.ctrlKey,queue:e.shiftKey});
  }

  const minimap=$('minimap'),ctx=minimap.getContext('2d'),miniImage=new Image();
  miniImage.src=mapBase+'minimap.png';
  const VillageMarkers=window.PraetoriansMapVillageMarkers,miniVillageImage=new Image();
  miniVillageImage.src=VillageMarkers.ICON;
  const mapVillageLocations=VillageMarkers.fromStructures(placements,buildingData.structures);
  // Drawn at twice the old resolution (crisper markers on big maps).
  const MW=560,MH=420;minimap.width=MW;minimap.height=MH;
  // The minimap art (720x448) is an isometric parallelogram of the map. Its
  // world frame was fitted against the terrain itself: world (0,0) is the
  // left corner, +X runs to the bottom corner and +Z to the top corner.
  // Every HD minimap is 720x448 with the map's diamond stretched to fill it
  // (scale 720/(W+D) across, 448/(W+D) down); Tutorial I keeps its fit.
  const MINI=isTutorial1?{w:720,h:448,origin:[.2,163.3],xAxis:[457.7,288.7],zAxis:[256,-163.2]}:
   {w:720,h:448,origin:[0,D*448/(W+D)],xAxis:[W*720/(W+D),W*448/(W+D)],zAxis:[D*720/(W+D),-D*448/(W+D)]};
  function miniPoint(x,z){
   const u=x/W,v=z/D;
   return {x:(MINI.origin[0]+MINI.xAxis[0]*u+MINI.zAxis[0]*v)*MW/MINI.w,y:(MINI.origin[1]+MINI.xAxis[1]*u+MINI.zAxis[1]*v)*MH/MINI.h};
  }
  function miniToWorld(cx,cy){
   const ix=cx*MINI.w/MW-MINI.origin[0],iy=cy*MINI.h/MH-MINI.origin[1];
   const [a,c]=MINI.xAxis,[b,d]=MINI.zAxis,det=a*d-b*c;
   return {x:(d*ix-b*iy)/det*W,z:(-c*ix+a*iy)/det*D};
  }
  // The whole map shows: the clip follows this map's own diamond (a square
  // map's corners used to be cut by Tutorial I's outline). Big maps get a
  // bigger minimap.
  minimap.style.clipPath=`polygon(${[[0,0],[W,0],[W,D],[0,D]].map(([x,z])=>{const p=miniPoint(x,z);return `${(p.x/MW*100).toFixed(2)}% ${(p.y/MH*100).toFixed(2)}%`;}).join(',')})`;
  $('game').style.setProperty('--minimap-scale',String(Math.max(W,D)>=200?1.25:Math.max(W,D)>=150?1.12:1));
  minimap.addEventListener('pointerdown',e=>{
   if(ordersBlocked())return;
   const rect=minimap.getBoundingClientRect();
   const p=miniToWorld((e.clientX-rect.left)/rect.width*MW,(e.clientY-rect.top)/rect.height*MH);
   camera.target.x=Math.max(0,Math.min(W,p.x));camera.target.z=Math.max(0,Math.min(D,p.z));resetCameraMotion();
  });
  function drawMinimap(){
   ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,MW,MH);
   if(miniImage.complete&&miniImage.naturalWidth)ctx.drawImage(miniImage,0,0,MW,MH);
   // Unexplored land greyed out, explored land out of sight dimmed: the
   // vision grid laid on the map's diamond.
   if($('visibility').checked){
    const sx=MW/MINI.w,sy=MH/MINI.h,c=vision.cell;
    ctx.save();ctx.imageSmoothingEnabled=true;
    ctx.setTransform(MINI.xAxis[0]*sx*c/W,MINI.xAxis[1]*sy*c/W,MINI.zAxis[0]*sx*c/D,MINI.zAxis[1]*sy*c/D,MINI.origin[0]*sx,MINI.origin[1]*sy);
    ctx.drawImage(miniFog,0,0);ctx.restore();
   }
   // Village locations are public map landmarks, as in the map selector.
   // Only scouting (or friendly intelligence) reveals ownership. Beyond
   // current sight, retain the last observed owner, including neutral white.
   VillageMarkers.draw(ctx,miniVillageImage,villages?.villages||mapVillageLocations,(v)=>miniPoint(v.x,v.z),30,v=>{
    const owner=structureKnowledge.villageOwner(humanCiv,v,{visible:structureVisionReady&&vision.seen(v.x,v.z),friendly:structureVisionReady&&friendlyOwner(v.owner)});
    return owner&&!neutralCiv(owner)?civColor(owner):null;
   });
   // Troops in their owner's colour, then
   // troops: ours red, enemies blue (Tutorial I) or their civilization's
   // colour, allies and neutrals in theirs; script alerts (AvisoCivilizacion) pulse.
   for(const squad of squads){if(!squad.members.length)continue;const p=miniPoint(squad.x,squad.z);ctx.fillStyle=civColor(squad.civ);ctx.fillRect(p.x-3.5,p.y-3.5,7,7);}
   for(const squad of enemySquads){if(!squad.visible||!squad.members.length)continue;const p=miniPoint(squad.x,squad.z);ctx.fillStyle=civColor(squad.civ);ctx.fillRect(p.x-3.5,p.y-3.5,7,7);}
   for(const squad of otherSquads){if(!squad.members.length||squad.civ==='SCOUT'||(squad.side!=='ally'&&!vision.seen(squad.x,squad.z)))continue;const p=miniPoint(squad.x,squad.z);ctx.fillStyle=civColor(squad.civ);ctx.fillRect(p.x-3,p.y-3,6,6);}
   for(let i=pings.length-1;i>=0;i--){const ping=pings[i];if(ping.until<missionClock){pings.splice(i,1);continue;}
    const p=miniPoint(ping.x,ping.z),k=(missionClock*2)%1;ctx.strokeStyle=ping.color;ctx.lineWidth=3;ctx.beginPath();ctx.arc(p.x,p.y,6+k*18,0,Math.PI*2);ctx.stroke();}
   const halfX=zoom*engine.getRenderWidth()/engine.getRenderHeight(),halfZ=zoom/Math.cos(camera.beta);
   const forward={x:-Math.cos(camera.alpha),z:-Math.sin(camera.alpha)},right={x:-Math.sin(camera.alpha),z:Math.cos(camera.alpha)};
   ctx.strokeStyle='#fff7d1';ctx.lineWidth=2.4;ctx.beginPath();
   [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(([x,z],i)=>{const p=miniPoint(camera.target.x+right.x*x*halfX+forward.x*z*halfZ,camera.target.z+right.z*x*halfX+forward.z*z*halfZ);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});
   ctx.closePath();ctx.stroke();
  }
  const settings=$('settings');
  $('settingsButton').addEventListener('click',()=>settings.hidden=!settings.hidden);
  $('closeSettings').addEventListener('click',()=>settings.hidden=true);
  for(const id of ['homeView','presetArmy'])$(id).addEventListener('click',()=>view('army'));
  for(const id of ['riverView','presetRiver'])$(id).addEventListener('click',()=>view('river'));
  for(const id of ['mapView','presetMap'])$(id).addEventListener('click',()=>view('map'));
  $('collapseObjective').addEventListener('click',()=>{const collapsed=document.querySelector('.objective').classList.toggle('collapsed');$('collapseObjective').textContent=collapsed?'+':'−';$('collapseObjective').setAttribute('aria-label',collapsed?'Expand objective':'Minimize objective');});
  $('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Use F11 for full screen.');}});
  // ---- Taking command of another civilization (F8, settings) ---------------------
  // Every troop is re-sorted by its civilization's side towards the one now
  // commanded; that civilization's CPU stops (world.controlled), so with the
  // CPU switched off the player drives every side in turn.
  const civTitle=c=>`${c.label?text(c.label):c.name}${c.race?' · '+(races[c.race]?.name?text(races[c.race].name):c.race):''}`;
  const commandable=()=>missionData.civilizations.filter(c=>!neutralCiv(c.name)&&(c.name===humanCiv||allSquads.some(s=>s.civ===c.name&&s.members.length)));
  function refreshControlPanel(){
   const list=commandable();
   $('controlCiv').innerHTML=list.map(c=>`<option value="${c.name}" ${c.name===humanCiv?'selected':''}>${civTitle(c)}</option>`).join('');
   $('cpuEnabled').checked=cpuEnabled;
  }
  function takeControl(name){
   if(!name||name===humanCiv||!civs.has(name))return false;
   setTimeout(fillSpawnTypes,0);
   setSelection([]);selectedVillage=null;selectedStructure=null;refreshVillagePanel();
   humanCiv=name;
   structureVisionReady=false;vision=visionFor(name);
   refreshSides();
   updateEnemyVisibility();
   squads.forEach((s,i)=>{s.index=i;s.ring?.setEnabled(false);});
   memorised.clear();refreshGroupButtons();
   focusOn(squads);refreshControlPanel();
   toast(`Vous commandez : ${civTitle(civs.get(name))}.`);
   return true;
  }
  $('controlCiv').addEventListener('change',e=>takeControl(e.target.value));
  $('cpuEnabled').addEventListener('change',e=>{cpuEnabled=e.target.checked;toast(cpuEnabled?'IA des joueurs CPU activée.':'IA des joueurs CPU désactivée : vous commandez tous les camps.');});
  refreshControlPanel();
  // keys: by character (arrows, order letters); codes: by physical key, so
  // the WASD camera is ZQSD on a French keyboard and 1-9 work unshifted.
  const keys={},codes={};
  // The game's order hotkeys (LTEXT_TECLARAPIDA_*), and the keys (by physical
  // position: ZQSD on a French keyboard) that move the camera when the
  // "keyboard camera" option is on - D and S (A on QWERTY) are then camera keys.
  const HOTKEYS={m:'move',a:'attack',d:'defensive',g:'aggressive',h:'stop',l:'patrol',p:'protect',f:'face',j:'merge',b:'balance',s:'split',k:'hawk',r:'repair'};
  const CAMERA_CODES=new Set(['KeyW','KeyA','KeyS','KeyD']);
  const CAMERA_KEYS_PREFERENCE='praetorians.controls.keyboardCamera';
  try{$('keyboardCamera').checked=localStorage.getItem(CAMERA_KEYS_PREFERENCE)==='true';}catch{}
  $('keyboardCamera').addEventListener('change',e=>{try{localStorage.setItem(CAMERA_KEYS_PREFERENCE,String(e.target.checked));}catch{}
   toast(e.target.checked?'Caméra au clavier : ZQSD / WASD et flèches (D, S et A ne commandent plus les troupes).':'Raccourcis du jeu : flèches pour la caméra, lettres pour les ordres.');});
  const keyboardCamera=()=>$('keyboardCamera').checked;
  let lastDigit={index:-1,time:0},focusCycle=-1;
  function focusOn(list){
   const alive=list.filter(s=>s.members.length);if(!alive.length)return;
   const c=alive.reduce((p,s)=>({x:p.x+s.x/alive.length,z:p.z+s.z/alive.length}),{x:0,z:0});
   camera.target.set(c.x-9.5,0,c.z-5.5);resizeCamera();resetCameraMotion();
  }
  document.addEventListener('keydown',e=>{
   if(window.PraetoriansMenu?.isOpen()) return;
   if(e.key.toLowerCase()==='f2'||e.key.toLowerCase()==='f3'){
    e.preventDefault();
    if(!e.repeat){if(e.key.toLowerCase()==='f2')settings.hidden=!settings.hidden;else setPerformanceVisible(!performanceHud.isVisible());}
    return;
   }
   if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
   const key=e.key.toLowerCase();keys[key]=true;codes[e.code]=true;
   if(ordersBlocked()){if(key.startsWith('arrow')||key===' ')e.preventDefault();return;}
   if(key==='f9'){e.preventDefault();missionUi.objectives.toggle();return;}
   if(key==='f8'){
    e.preventDefault();const list=commandable(),i=list.findIndex(c=>c.name===humanCiv);
    if(list.length>1)takeControl(list[(i+1)%list.length].name);return;
   }
   if(key==='home'){e.preventDefault();view('army');}
   if(key==='escape'){settings.hidden=true;setPending(null);setSpawnMode(false);setSelection([]);selectVillage(null);selectStructure(null);}
   // 1-9 select a memorised group (twice: centre on it); Ctrl+1-9 memorises.
   const digit=/^(Digit|Numpad)[1-9]$/.test(e.code)?Number(e.code.at(-1))-1:/^[1-9]$/.test(e.key)?Number(e.key)-1:-1;
   if(digit>=0){
    e.preventDefault();
    if(e.ctrlKey||e.altKey||e.metaKey){memoriseGroup(digit);return;}
    const now=performance.now(),twice=lastDigit.index===digit&&now-lastDigit.time<450;lastDigit={index:digit,time:now};
    if(!recallGroup(digit,twice,e.shiftKey)&&squads[digit])selectSquad(digit,twice,e.shiftKey);
    return;
   }
   if(key.startsWith('arrow'))e.preventDefault();
   if(e.ctrlKey||e.altKey||e.metaKey)return;
   // Space: centre on each selected troop in turn.
   if(key===' '){e.preventDefault();if(selectedSquads.length){focusCycle=(focusCycle+1)%selectedSquads.length;focusOn([selectedSquads[focusCycle]]);}return;}
   // The original order hotkeys (LTEXT_TECLARAPIDA_*). With the keyboard
   // camera option on, its keys (ZQSD / WASD) move the camera instead.
   if(keyboardCamera()&&CAMERA_CODES.has(e.code))return;
   const hotkey=HOTKEYS[key];
   if(!hotkey||e.repeat)return;
   e.preventDefault();
   if(hotkey==='hawk')armOrder('hawk');
   else if(hotkey==='repair'){if(selectedSquads.some(canBuild))armOrder('repair');}
   else runAction(hotkey);
  });
  document.addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;codes[e.code]=false;});
  window.addEventListener('blur',()=>{for(const key of Object.keys(keys))keys[key]=false;for(const code of Object.keys(codes))codes[code]=false;pointer.inside=false;});
  // Escape skips a cut-scene (PonerHandleInterrupcion) before the pause menu
  // sees the key.
  window.addEventListener('keydown',e=>{
   if(e.key!=='Escape'||window.PraetoriansMenu?.isOpen())return;
   // A mission script's interruption handle (PonerHandleInterrupcion) during
   // its cut-scene or chapter card.
   if(interruptHandle&&(missionUi.cinema.active||presentationShown)){
    interruptHandle.fired=true;interruptHandle=null;e.preventDefault();e.stopImmediatePropagation();return;
   }
   if(!escapeArmed)return;
   escaped=true;e.preventDefault();e.stopImmediatePropagation();
  },true);
  // A soft visibility falloff reproduces the darker explored landscape around
  // the starting army. It follows the four formations as the player moves them.
  // ---- What the player's side sees (src/world/vision.js) ----------------------------
  // His troops, his allies' (their eyes are his) and the villages they hold
  // (with the hawk in flight and zones a mission reveals). The same viewers
  // spot enemies (updateEnemyVisibility); the grid shades the battlefield and
  // greys the unexplored minimap.
  const visions=new Map();
  function visionFor(observer){
   if(!visions.has(observer))visions.set(observer,window.PraetoriansVision.create({width:W,depth:D}));
   return visions.get(observer);
  }
  let vision=visionFor(humanCiv);
  const fogTexture=new B.DynamicTexture('vision grid',{width:vision.cols,height:vision.rows},scene,false,B.Texture.BILINEAR_SAMPLINGMODE);
  fogTexture.wrapU=fogTexture.wrapV=B.Texture.CLAMP_ADDRESSMODE;
  const fogContext=fogTexture.getContext(),fogImage=fogContext.createImageData(vision.cols,vision.rows);
  // The land's heights for the shading pass (bridge decks and walls included).
  const landHeights=(()=>{
   let lo=Infinity,hi=-Infinity;
   for(let z=0;z<gridD;z++)for(let x=0;x<gridW;x++){const h=gridHeight(x,z);if(h<lo)lo=h;if(h>hi)hi=h;}
   hi=Math.max(hi,lo+.01);
   const texture=new B.DynamicTexture('land heights',{width:gridW,height:gridD},scene,false,B.Texture.BILINEAR_SAMPLINGMODE);
   const context=texture.getContext(),image=context.createImageData(gridW,gridD);
   for(let z=0;z<gridD;z++)for(let x=0;x<gridW;x++){
    const v=Math.round((gridHeight(x,z)-lo)/(hi-lo)*255),o=((gridD-1-z)*gridW+x)*4;
    image.data[o]=image.data[o+1]=image.data[o+2]=v;image.data[o+3]=255;
   }
   // Canvas rows run from the far edge (z = depth) down: uploaded flipped
   // (invertY), the bottom row (z = 0) is the shader's v = 0.
   context.putImageData(image,0,0);texture.update(true);texture.wrapU=texture.wrapV=B.Texture.CLAMP_ADDRESSMODE;
   return {texture,lo,hi};
  })();
  const miniFog=document.createElement('canvas');miniFog.width=vision.cols;miniFog.height=vision.rows;
  const miniFogContext=miniFog.getContext('2d'),miniFogImage=miniFogContext.createImageData(vision.cols,vision.rows);
  const friendly=s=>s.side==='player'||s.side==='ally';
  function updateVision(eyes){
   const viewers=eyes.map(v=>({x:v.x,z:v.z,r:v.vision}));
   if(hawk.active&&hawk.owner&&friendly(hawk.owner)){const b=hawk.squad.members[0];viewers.push({x:b.x,z:b.z,r:HAWK_VISION});}
   for(const z of [...revealZones,...namedReveals.values()])viewers.push({x:z.x,z:z.z,r:z.r});
   vision.update(viewers);
   structureVisionReady=true;
   refreshStructureVisibility();
   // Uploaded flipped like the heights: v = 0 is z = 0 (unflipped, the
   // shading lay mirrored across the map: lit far away, dark at home).
   vision.pixels(fogImage.data);fogContext.putImageData(fogImage,0,0);fogTexture.update(true);
   // The minimap: unexplored land greyed out, explored land out of sight dimmed.
   const out=miniFogImage.data;
   for(let z=0;z<vision.rows;z++)for(let x=0;x<vision.cols;x++){
    const i=z*vision.cols+x,o=i*4,seen=vision.light[i]/255;
    // A grey wash over unexplored land, the map still faintly readable under it.
    if(!vision.explored[i]){out[o]=104;out[o+1]=101;out[o+2]=93;out[o+3]=190;}
    else{out[o]=8;out[o+1]=8;out[o+2]=6;out[o+3]=Math.round(60*(1-seen));}
   }
   miniFogContext.putImageData(miniFogImage,0,0);
  }
  B.Effect.ShadersStore.praetoriansVisibilityFragmentShader=`
   precision highp float;
   varying vec2 vUV;
   uniform sampler2D textureSampler;
   uniform mat4 inverseViewProjection;
   // The vision grid (src/world/vision.js): red seen now, green explored.
   uniform sampler2D fogSampler;
   uniform vec2 fogScale;
   // The land's heights (8 bits over heightRange), to find where each pixel's
   // view ray meets the ground, hills included.
   uniform sampler2D heightSampler;
   uniform vec2 heightRange,heightGrid,worldSize;
   float landAt(vec2 xz){
    vec2 uv=(clamp(xz/worldSize,0.0,1.0)*(heightGrid-1.0)+.5)/heightGrid;
    return heightRange.x+texture2D(heightSampler,uv).r*(heightRange.y-heightRange.x);
   }
   uniform float enabled;
   void main(void){
    vec2 clip=vUV*2.0-1.0;
    vec4 nearPoint=inverseViewProjection*vec4(clip,0.0,1.0);
    vec4 farPoint=inverseViewProjection*vec4(clip,1.0,1.0);
    nearPoint/=nearPoint.w;farPoint/=farPoint.w;
    vec3 ray=farPoint.xyz-nearPoint.xyz;
    float tTop=(nearPoint.y-heightRange.y)/(-ray.y),tLow=(nearPoint.y-heightRange.x)/(-ray.y),hitT=tLow,prevT=tTop;
    for(int i=1;i<=12;i++){
     float t=mix(tTop,tLow,float(i)/12.0);vec3 q=nearPoint.xyz+ray*t;
     if(q.y<=landAt(q.xz)){
      float lo=prevT,hi=t;
      for(int k=0;k<4;k++){float m=(lo+hi)*.5;vec3 r=nearPoint.xyz+ray*m;if(r.y<=landAt(r.xz))hi=m;else lo=m;}
      hitT=hi;break;
     }
     prevT=t;
    }
    vec3 world=nearPoint.xyz+ray*hitT;
    vec4 fog=texture2D(fogSampler,clamp(world.xz*fogScale,0.0,1.0));
    // Out of sight the explored land is darker, the unexplored darker still.
    float light=mix(1.0,mix(mix(.5,.64,fog.g),1.0,fog.r),enabled);
    vec4 color=texture2D(textureSampler,vUV);
    gl_FragColor=vec4(color.rgb*light,color.a);
   }`;
  const visibility=new B.PostProcess('explored terrain shading','praetoriansVisibility',
   ['inverseViewProjection','fogScale','heightRange','heightGrid','worldSize','enabled'],['fogSampler','heightSampler'],1,camera);
  visibility.onApply=effect=>{
   effect.setMatrix('inverseViewProjection',B.Matrix.Invert(scene.getTransformMatrix()));
   effect.setTexture('fogSampler',fogTexture);effect.setFloat2('fogScale',1/(vision.cols*vision.cell),1/(vision.rows*vision.cell));
   effect.setTexture('heightSampler',landHeights.texture);effect.setFloat2('heightRange',landHeights.lo,landHeights.hi);
   effect.setFloat2('heightGrid',gridW,gridD);effect.setFloat2('worldSize',W,D);
   effect.setFloat('enabled',$('visibility').checked?1:0);

  };
  // Falling soldiers and bounded corpse piles share the same pose batches.
  // Arrows in flight.
  const arrows=B.MeshBuilder.CreateCylinder('arrows in flight',{height:.62,diameterTop:.014,diameterBottom:.03,tessellation:5},scene);
  const arrowMaterial=new B.StandardMaterial('arrow shaft',scene);arrowMaterial.diffuseColor=new B.Color3(.33,.24,.14);arrowMaterial.specularColor=B.Color3.Black();
  arrows.material=arrowMaterial;arrows.isPickable=false;arrows.renderingGroupId=2;
  const arrowMatrices=new Float32Array(512*16);arrows.thinInstanceSetBuffer('matrix',arrowMatrices,16,false);arrows.thinInstanceCount=0;arrows.setEnabled(false);
  // Fire arrows (FLECHA_FUEGO) burn at the head: a glowing flame on each.
  const arrowFlames=B.MeshBuilder.CreateSphere('fire arrow flames',{diameter:.13,segments:4},scene);
  const flameMaterial=new B.StandardMaterial('fire arrow flame',scene);
  flameMaterial.disableLighting=true;flameMaterial.emissiveColor=new B.Color3(1,.55,.12);flameMaterial.alpha=.85;
  arrowFlames.material=flameMaterial;arrowFlames.isPickable=false;arrowFlames.renderingGroupId=2;
  const flameMatrices=new Float32Array(512*16);arrowFlames.thinInstanceSetBuffer('matrix',flameMatrices,16,false);arrowFlames.thinInstanceCount=0;arrowFlames.setEnabled(false);
  // Siege shots drawn as the game's own (DefProyectiles VISUAL, exported by
  // tools/export_hd_machine_sites.py): the catapult's stone tumbling on its
  // high arc, the ballista's bolt nose first.
  const SHOT_CAPACITY=64,shotModels=new Map();
  for(const [ammo,{model,axis}] of Object.entries(machineSites.projectiles||{})){
   ensureModel(model).then(()=>{
    const data=models.models[model];if(!data)return;
    const matrices=new Float32Array(SHOT_CAPACITY*16);
    const meshes=data.groups.map((group,i)=>{
     const mesh=makeMesh(`siege shot ${model} / ${i}`,group,modelMaterial(group));mesh.isPickable=false;mesh.renderingGroupId=2;
     mesh.thinInstanceSetBuffer('matrix',matrices,16,false);mesh.thinInstanceCount=0;mesh.setEnabled(false);return mesh;
    });
    shotModels.set(ammo,{meshes,axis,matrices,count:0});
   });
  }
  const shotAxis=new B.Vector3(1,0,0),tumble=new B.Quaternion(),spin=new B.Vector3();
  function updateArrows(){
   const list=combat.projectiles,m=B.Matrix.Identity(),q=new B.Quaternion(),up=B.Vector3.Up(),dir=new B.Vector3(),one=new B.Vector3(1,1,1),pos=new B.Vector3();
   const flicker=new B.Vector3();let flames=0,n=0;
   for(const shot of shotModels.values())shot.count=0;
   for(let i=0;i<list.length&&n<512;i++){
    const p=list[i];dir.set(p.dx,p.dy,p.dz).normalize();
    const shot=shotModels.get(p.ammo);
    if(shot){
     if(shot.count>=SHOT_CAPACITY)continue;
     pos.set(p.x,p.y,p.z);
     if(shot.axis)B.Quaternion.FromUnitVectorsToRef(shotAxis,dir,q);
     else{spin.set(1.3,.7,.4);B.Quaternion.RotationAxisToRef(spin.normalize(),(p.t||0)*7+i,tumble);q.copyFrom(tumble);}
     B.Matrix.ComposeToRef(one,q,pos,m);shot.matrices.set(m.m,shot.count++*16);
     continue;
    }
    B.Quaternion.FromUnitVectorsToRef(up,dir,q);
    pos.set(p.x,p.y,p.z);B.Matrix.ComposeToRef(one,q,pos,m);arrowMatrices.set(m.m,n++*16);
    if(/FUEGO/.test(p.ammo||'')){
     const s=.8+.3*Math.sin((p.t||0)*40+i);flicker.set(s,s*2,s);
     pos.set(p.x+dir.x*.26,p.y+dir.y*.26,p.z+dir.z*.26);B.Matrix.ComposeToRef(flicker,q,pos,m);flameMatrices.set(m.m,flames++*16);
    }
   }
   arrows.thinInstanceCount=n;arrows.thinInstanceBufferUpdated('matrix');arrows.setEnabled(n>0);if(n)arrows.thinInstanceRefreshBoundingInfo(true);
   for(const shot of shotModels.values())for(const mesh of shot.meshes){
    mesh.thinInstanceCount=shot.count;mesh.thinInstanceBufferUpdated('matrix');mesh.setEnabled(shot.count>0);if(shot.count)mesh.thinInstanceRefreshBoundingInfo(true);
   }
   arrowFlames.thinInstanceCount=flames;arrowFlames.thinInstanceBufferUpdated('matrix');arrowFlames.setEnabled(flames>0);if(flames)arrowFlames.thinInstanceRefreshBoundingInfo(true);
  }
  // Enemies are seen within the vision radius (RAD_VISION) of our troops,
  // with the lessons' rules: troops in forest (MLG terrain types 5/6) are
  // invisible from outside it, and troops on high ground are hidden from
  // those below. Close by, nothing hides. The hawk sees from the air, but not
  // into the trees; mission scripts can light zones (IluminarZona) or reveal.
  const FOREST=0x20000000,CLOSE_SIGHT=4,FOREST_SIGHT=6,HEIGHT_HIDE=1.2;
  // PRADERA is type 4, whose encoded value includes bit 0x20000000 too.
  // Testing that bit treated every standing soldier in wheat as forest-hidden.
  function inForest(x,z){
   const cx=Math.floor(x),cz=Math.floor(z);
   return cx>=0&&cz>=0&&cx<W&&cz<D&&window.PraetoriansTroopConcealment.isForestCell(map.logical[cz*W+cx]);
  }
  // Troops in cover the player can see show their standard; his and his
  // allies' are also outlined through the trees.
  const coverHighlights=new Set();
  function updateEnemyVisibility(){
   for(let i=revealZones.length-1;i>=0;i--)if(revealZones[i].until<=missionClock)revealZones.splice(i,1);
   // The player's eyes and his allies'.
   const viewers=allSquads.filter(s=>s.members.length&&!s.inVillage&&friendly(s)).map(s=>{
    const c=s.sheltered?{x:s.x,z:s.z}:combat.centroid(s);
    return {x:c.x,z:c.z,y:groundY(c.x,c.z),vision:s.profile.vision,forest:s.members.some(m=>inForest(m.x,m.z))};
   });
   // The villages held by him and his allies see round them too.
   for(const v of villages?.villages||[])if(v.owner&&(v.owner===humanCiv||allied(v.owner,humanCiv)))
    viewers.push({x:v.x,z:v.z,y:groundY(v.x,v.z),vision:v.radius+VILLAGE_VISION,forest:false});
   const bird=hawk.active&&hawk.owner&&friendly(hawk.owner)?hawk.squad.members[0]:null;
   for(const enemy of enemySquads){
    let seen=false;
    if(enemy.members.length){
     const c=combat.centroid(enemy),reach=combat.spread(enemy),y=groundY(c.x,c.z);
     const hidden=enemy.members.filter(m=>inForest(m.x,m.z)).length*2>enemy.members.length;
     const concealed=window.PraetoriansTroopConcealment.isHidden(enemy);
     // A mission can reveal ordinary troops or an area, but a troop lying
     // hidden in wheat still requires a viewer close enough to discover it.
     seen=!concealed&&(!!enemy.revealed||revealZones.some(z=>Math.hypot(z.x-c.x,z.z-c.z)<z.r+reach)||[...namedReveals.values()].some(z=>Math.hypot(z.x-c.x,z.z-c.z)<z.r+reach));
     if(!seen&&bird&&!hidden&&!concealed)seen=Math.hypot(bird.x-c.x,bird.z-c.z)<HAWK_VISION+reach;
     if(!seen)for(const v of viewers){
      const d=Math.hypot(v.x-c.x,v.z-c.z);
      if(d>v.vision+reach)continue;
      // Lying hidden in tall grass: found only by stumbling on them.
      if(concealed){if(d<=combat.CONCEALED_SIGHT+reach){seen=true;break;}continue;}
      if(d<=CLOSE_SIGHT+reach||((!hidden||(v.forest&&d<=FOREST_SIGHT+reach))&&y-v.y<=HEIGHT_HIDE)){seen=true;break;}
     }
    }
    if(seen!==enemy.visible){enemy.visible=seen;enemy.visibilityChanged=true;}
   }
   coverHighlights.clear();
   for(const s of allSquads){
    const n=s.members.length;
    const wheat=n>0&&s.members.filter(m=>meadows.isGrass(m.x,m.z)).length*2>=n;
    s.covered=n>0&&!s.inVillage&&!s.sheltered&&(wheat||s.members.filter(m=>inForest(m.x,m.z)).length*2>=n);
    if(s.covered&&s.side!=='neutral'&&(friendly(s)||(s.visible&&wheat&&!window.PraetoriansTroopConcealment.isHidden(s))))coverHighlights.add(s);
   }
   updateVision(viewers);
  }
  // Marching feet, battle din and the river, from the original sound tables.
  let riverPoint=null,riverCheck=0;
  function nearestWater(x,z){
   const step=nav.step,cols=nav.statistics.columns,rows=nav.statistics.rows,cx=Math.round(x/step),cz=Math.round(z/step);
   let best=null,bestD=Infinity;
   for(let dz=-40;dz<=40;dz+=2)for(let dx=-40;dx<=40;dx+=2){
    const gx=cx+dx,gz=cz+dz;if(gx<0||gz<0||gx>=cols||gz>=rows||!nav.water[gz*cols+gx])continue;
    const d=dx*dx+dz*dz;if(d<bestD){bestD=d;best={x:gx*step,z:gz*step};}
   }
   return best;
  }
  // Birdsong points from the mission's ambient sounds (APAJ).
  const birdPoints=(map.mission.ambientSounds||[]).filter(a=>a.type==='APAJ').flatMap(a=>a.positions.map(([x,,z])=>({x,z})));
  let battleMusic=0,birdTimer=3;
  function updateSound(dt){
   if(!sound)return;
   sound.setListener({x:camera.target.x,z:camera.target.z,range:zoom*1.7,right:{x:-Math.sin(camera.alpha),z:Math.cos(camera.alpha)}});
   if((riverCheck-=dt)<=0){
    riverCheck=1;riverPoint=nearestWater(camera.target.x,camera.target.z);
    const o=menuOptions();sound.setVolume((o.effects??85)/100);sound.setMusicVolume((o.music??75)/100);syncVoices();
   }
   // The mission's music (MUSICA_MISION), and its battle music (MUSICA_BATALLA)
   // while our troops are in melee, holding a few seconds after it ends.
   if(!missionEnded){
    battleMusic=squads.some(s=>s.members.length&&s.combat?.mode==='melee')?8:Math.max(0,battleMusic-dt);
    sound.playMusic(battleMusic>0?map.mission.battleMusic||'SB01':map.mission.missionMusic||'SA01');
   }
   if((birdTimer-=dt)<=0){
    birdTimer=3+Math.random()*6;
    const near=birdPoints.filter(p=>Math.hypot(p.x-camera.target.x,p.z-camera.target.z)<zoom*2.5);
    if(near.length)sound.play('APAJ',near[Math.floor(Math.random()*near.length)]);
   }
   const candidates=[];
   if(!logicPaused)for(const s of allSquads){
    if(!s.members.length||(s.side==='enemy'&&!s.visible))continue;
    const c=combat.centroid(s),d=Math.hypot(c.x-camera.target.x,c.z-camera.target.z);
    if(s.isMoving&&s.members.some(m=>m.stepping)){
     const n=s.members.length,bucket=n===1?1:n<=5?2:n<=15?3:4;
     candidates.push([d,'steps'+s.index,{name:`T${s.type==='PIQUERO'?'P':'L'}${s.running?'C':'A'}${bucket}`,at:c}]);
    }
    if(s.combat?.mode==='melee')candidates.push([d-5,'fight'+s.index,{name:'TCBT',at:c}]);
   }
   const wanted=new Map(candidates.sort((a,b)=>a[0]-b[0]).slice(0,5).map(([,key,value])=>[key,value]));
   if(riverPoint)wanted.set('river',{name:'ARIO',at:riverPoint,boost:.7});
   if(raining>0)wanted.set('rain',{name:'ALLV',at:null,boost:Math.min(1,raining*1.6)});
   sound.setLoops(wanted);
  }
  // CPU orders can include pathfinding: keep them visible separately from
  // combat/motion, and include all remaining world work in simulation time.
  const timing={samples:[],combatMs:0,motionMs:0,worldMs:0,cpuMs:0,simulationMs:0,batchMs:0,hudMs:0,renderMs:0,frameMs:0,steps:0,droppedTime:0};
  const performancePreference='praetorians.performance.visible';
  let performanceReady=false,pendingPerformance=null;
  const performanceHud=window.PraetoriansPerformanceHud.create({root:$('performanceHud'),getContext:()=>{
   const active=allSquads.filter(s=>s.members.length),modes={};
   for(const s of active){const mode=s.combat?.mode||'idle';modes[mode]=(modes[mode]||0)+1;}
   return {build:'nearby-deployment-20261101',mission:launch.mission,map:map.title,kind:missionData.kind,difficulty:aiDifficulty,
    gameTimeSeconds:missionClock,civilizations:missionData.civilizations.filter(c=>!c.neutral).length,
    cpuPlayers:cpu?.strategies.filter(s=>s.started).length||0,squads:active.length,
    soldiers:active.reduce((n,s)=>n+s.members.length,0),movingSquads:active.filter(s=>s.isMoving).length,
    combatModes:modes,combatCounters:{...combat.metrics},navigationProfiles:1+navCache.size,ai:cpu?.snapshot?.()||null,
    renderSettings:renderBudget.settings,renderSize:[engine.getRenderWidth(),engine.getRenderHeight()]};
  },onVisibilityChange:visible=>{
   $('showPerformance').checked=visible;
   try{localStorage.setItem(performancePreference,String(visible));}catch{}
  }});
  if(isTutorial1)$('performanceHud').classList.add('perf-left');
  function setPerformanceVisible(visible){
   performanceHud.setVisible(visible);$('showPerformance').checked=visible;
  }
  let performanceVisible=true;
  try{performanceVisible=localStorage.getItem(performancePreference)!=='false';}catch{}
  setPerformanceVisible(performanceVisible);
  $('showPerformance').addEventListener('change',e=>setPerformanceVisible(e.target.checked));
  function resetPerformanceClock(){pendingPerformance=null;performanceHud.resetClock();}
  let frame=0,elapsed=0,visibilityTimer=0,accumulator=0,soundTimer=0,resumeFrame=true;
  function suspendFrame(){accumulator=0;resumeFrame=true;buildPreview.hide();constructionPreviewState=null;hideFormationPreview(true);resetCameraMotion();resetPerformanceClock();}
  document.addEventListener('visibilitychange',suspendFrame);
  window.addEventListener('blur',suspendFrame);window.addEventListener('focus',suspendFrame);
  const FIXED_STEP=1/30,MAX_STEPS=6;
  // Everything the unit renderer draws: troops, wildlife, the hawk in flight.
  function drawList(){companions.sync(allSquads);const list=[...allSquads,...critters.list,...companions.list];if(hawk.active&&(hawk.owner&&friendly(hawk.owner)||vision.seen(hawk.squad.members[0].x,hawk.squad.members[0].z)))list.push(hawk.squad);return list;}
  const threats=[];
  // ---- Hiding in tall grass ----------------------------------------------------------
  // Foot troops standing still in tall grass for HIDE_DELAY seconds drop to
  // the ground (TUMBAR, REPOSO_TUMBADO; bowmen crouch) and are hidden from
  // the enemy, unless he stumbles on them (combat.CONCEALED_SIGHT). Cavalry,
  // commanders and machines cannot hide there. Moving, fighting or fire
  // brings them up.
  // Troops with only the lying-down clip (gladiators, praetorians, slingers)
  // stay down on its last frame.
  const canHide=s=>!s.formationState?.noAmbush&&!s.formationState?.pending&&!!(s.model?.animations?.lying||s.model?.animations?.lieDown)&&!/^CENTURION|^HEROE|^JEFE/.test(gameStats[s.type]?.base||s.type)&&!gameStats[s.type]?.construction;
  const concealment=window.PraetoriansTroopConcealment.create({canHide,inGrass:(x,z)=>meadows.isGrass(x,z),burning:(x,z)=>meadows.burningAt(x,z)});
  let concealmentVisibilityDirty=false;
  function updateConcealment(dt){
   const changed=concealment.update(allSquads,dt)||concealmentVisibilityDirty;
   concealmentVisibilityDirty=false;
   if(changed){aiAwareness.invalidate();updateEnemyVisibility();}
  }
  // Contact with a burning wheat cell is lethal to that soldier. Trace both
  // combat and formation movement so a fast step cannot skip the tiny patch.
  const grassExposure=window.PraetoriansGrassExposure.create({field:meadows,combat});
  function simulateStep(dt){
   unitRenderer.capture(drawList());
   grassExposure.capture(allSquads);
   updateFormations(dt);
   const start=performance.now();combat.update(dt);timing.combatMs+=performance.now()-start;
   meadows.step(dt);grassExposure.apply(allSquads);updateConcealment(dt);
   const movingStart=performance.now();
   for(const squad of allSquads){
    const wasMoving=squad.isMoving;
    if(!squad.sheltered&&!squad.inVillage)motion.advance(squad,dt,groundY,squad.speed*(squad.running?combat.RUN_FACTOR:1),navOf(squad));
    if(wasMoving&&!squad.isMoving){
     squad.running=false;
     // On to the next Shift waypoint.
     if(squad.orderQueue?.length){const step=squad.orderQueue.shift();if(!issueMove(squad,step).ok)squad.orderQueue=null;}
     if(selectedSquads.includes(squad))redrawRoute();
    }
    if(squad.blockedReason){if(selectedSquads.includes(squad))toast(squad.blockedReason);squad.blockedReason=null;}
   }
   grassExposure.apply(allSquads);
   timing.motionMs+=performance.now()-movingStart;
   const worldStart=performance.now();
   threats.length=0;for(const s of allSquads)for(const m of s.members)threats.push(m);
   critters.update(dt,threats);
   updateHawk(dt);
   updateGates(dt);
   updateMachines();
   updateOrders(dt);
   updateTransforms(dt);
   followRoutes();
   buildings.update(dt);
   clearSites(dt);
   autoEnterVillages(dt);
   updateRecruits(dt);
   villages?.update(dt);
   companions.step(dt);
   timing.worldMs+=performance.now()-worldStart;
   const cpuStart=performance.now();
   cpu?.update(dt);
   timing.cpuMs+=performance.now()-cpuStart;
  }
  function advanceSimulation(dt){
   const simulationStart=performance.now();
   // Catch-up ticks share one routing quota instead of multiplying a stall.
   combat.beginFrame();formationStartsRemaining=1;
   cpu?.beginFrame?.();
   aiRouteWork=0;
   timing.combatMs=timing.motionMs=timing.worldMs=timing.cpuMs=timing.simulationMs=timing.steps=0;
   // PararLogica: the world stands still during the scout's introduction.
   if(logicPaused){accumulator=0;return 0;}
   const accepted=Math.min(Math.max(dt,0),FIXED_STEP*MAX_STEPS);
   timing.droppedTime+=Math.max(0,dt-accepted);accumulator+=accepted;
   while(accumulator+1e-9>=FIXED_STEP&&timing.steps<MAX_STEPS){
    simulateStep(FIXED_STEP);accumulator-=FIXED_STEP;timing.steps++;elapsed+=FIXED_STEP*1000;
   }
   if((visibilityTimer-=accepted)<=0){visibilityTimer=.25;updateEnemyVisibility();}
   timing.simulationMs=performance.now()-simulationStart;
   return accepted;
  }
  updateEnemyVisibility();
  engine.runRenderLoop(()=>{
   if(document.hidden||window.PraetoriansMenu?.isOpen()){suspendFrame();return;}
   const frameStart=performance.now();
   // A hidden tab or menu never contributes a catch-up interval on return.
   const dt=resumeFrame?0:Math.max(0,engine.getDeltaTime()/1000);
   resumeFrame=false;
   // The elapsed interval belongs to the preceding frame's work. Pair them
   // here so hovering a spike shows the CPU work that actually preceded it.
   if(performanceReady&&!document.hidden){
    if(pendingPerformance)performanceHud.record({...pendingPerformance,interval:dt*1000},frameStart);
   }else resetPerformanceClock();
   const right=new B.Vector3(-Math.sin(camera.alpha),0,Math.cos(camera.alpha)),forward=new B.Vector3(-Math.cos(camera.alpha),0,-Math.sin(camera.alpha));
   const wasd=keyboardCamera();
   let dx=(wasd&&codes.KeyD||keys.arrowright?1:0)-(wasd&&codes.KeyA||keys.arrowleft?1:0),dz=(wasd&&codes.KeyW||keys.arrowup?1:0)-(wasd&&codes.KeyS||keys.arrowdown?1:0);
   if(pointer.inside&&settings.hidden&&$('edgeScroll').checked&&!pointerStart){
    if(pointer.x<10)dx--;if(pointer.x>innerWidth-10)dx++;
    if(pointer.y<10)dz++;if(pointer.y>innerHeight-10)dz--;
   }
   dx=Math.max(-1,Math.min(1,dx));dz=Math.max(-1,Math.min(1,dz));
   const cameraEnabled=!ordersBlocked()&&settings.hidden;
   cameraMotion.update(dt,{x:right.x*dx+forward.x*dz,z:right.z*dx+forward.z*dz,enabled:cameraEnabled});
   if(!cameraEnabled)resetCameraMotion();
   updateBuildPreview();
   updateFormationPreview();
   updatePendingDeployment();
   const advanced=advanceSimulation(dt);
   tickMission(Math.min(dt,.25));
   const alpha=Math.max(0,Math.min(1,accumulator/FIXED_STEP)),renderTime=Math.max(0,elapsed-FIXED_STEP*1000+alpha*FIXED_STEP*1000);
   unitRenderer.update(drawList(),renderTime,advanced*1000,alpha);timing.batchMs=unitRenderer.stats.updateMs;
   for(const squad of selectedSquads)if(squad.ring){
    const at=squad.hidden?{x:squad.x,z:squad.z,r:squad.r}:unitRenderer.interpolate(squad,alpha);
    squad.ring.position.set(at.x,groundY(at.x,at.z)+.055,at.z);squad.ring.rotation.y=at.r;
   }
   const hudStart=performance.now();
   updateArrows();burning.update(dt,camera);routePaths.update(dt);refreshStandards();
   if($('showVillageDebug').checked&&(debugStatusTimer-=dt)<=0){debugStatusTimer=.35;updateVillageDebugStatus();}
   if((soundTimer-=dt)<=0){soundTimer=.1;updateSound(.1);refreshSelectionPanel();refreshCommands();if(frame%2===0)refreshCursor();if((villagePanelTimer-=.1)<=0){villagePanelTimer=.5;refreshVillagePanel();}}
   timing.hudMs=performance.now()-hudStart;
   if(waterMeshes.length){
    const tx=waterMeshes[0].metadata?.classic?.albedoTexture??waterMeshes[0].material.albedoTexture;
    if(tx){tx.uOffset=elapsed*.000004;tx.vOffset=elapsed*.000002;}
    for(const material of waterMeshes.realistic||[])window.PraetoriansWater.update(B,material,camera,elapsed/1000,sun.direction.scale(-1));
   }
   meadows.update(frameStart/1000,1,1);
   const renderStart=performance.now();scene.render();timing.renderMs=performance.now()-renderStart;
   if(frame++%12===0){drawMinimap();const fps=engine.getFps();$('fps').textContent=Number.isFinite(fps)?`${Math.round(fps)} FPS`:'';}
   timing.frameMs=performance.now()-frameStart;
   const sample={combat:timing.combatMs,motion:timing.motionMs,world:timing.worldMs,cpu:timing.cpuMs,simulation:timing.simulationMs,batches:timing.batchMs,hud:timing.hudMs,render:timing.renderMs,frame:timing.frameMs,interval:dt*1000,steps:timing.steps};
   timing.samples.push(sample);if(timing.samples.length>180)timing.samples.shift();
   if(performanceReady&&!document.hidden)pendingPerformance=sample;
  });
  await scene.whenReadyAsync();
  if(shadowGenerator)shadowGenerator.getShadowMap().resetRefreshCounter();
  $('loading').remove();
  resetPerformanceClock();performanceReady=true;
  const languageSelect=$('gameLanguage');
  function refreshLanguage(){
   if(languageSelect)languageSelect.value=I18n.language;
   for(const [type,unit] of Object.entries(gameStats))if(unit.name)unitTitles[type]=text(unit.name);
   results.setLabels({victory:text('LTEXT_MISSION_SUCCESS'),defeat:text('LTEXT_MISSION_FAILURE'),kills:text('LTEXT_GUI_KILLS'),losses:text('LTEXT_GUI_LOSSES'),trained:text('LTEXT_GUI_TRAINED'),villages:text('LTEXT_GUI_VILLAGES'),time:text('LTEXT_GUI_PLAYTIME'),score:text('LTEXT_GUI_SCORE'),quit:text('LTEXT_GUI_QUIT'),replay:text('LTEXT_GUI_RESTART_LEVEL')});
   if(sound){sound.setLanguage(I18n.language);troopVoices.preload(squads);}
   refreshSelectionPanel();refreshCommands();refreshGroupButtons();
  }
  if(languageSelect){
   languageSelect.replaceChildren(...I18n.languages.map(language=>{const option=document.createElement('option');option.value=language.id;option.textContent=language.name;return option;}));
   languageSelect.value=I18n.language;
   languageSelect.addEventListener('change',()=>I18n.setLanguage(languageSelect.value).catch(error=>{console.warn('Language change',error);languageSelect.value=I18n.language;}));
  }
  I18n.onChange(refreshLanguage);
  window.praetorians={engine,scene,camera,cameraMotion,resetCameraMotion,map,ground,renderBudget,view,meadows,companions,drawList,selectSquad,structures,get selectedSquads(){return [...selectedSquads];},squads,enemySquads,combat,unitRenderer,routePaths,timing,performanceHud,advanceSimulation,addSquadAt,get sound(){return sound;},troopVoices,i18n:I18n,formations,changeFormation,cancelFormation,updateFormations,loadUnitModels,groundY,nav,motion,modelCount,objectCount,waterMeshes,
   mission,missionApi,missionUi,critters,hawk,allSquads,scoutSquads,otherSquads,launch,kindFor,structureParts,world,fortress,navFor,gateTarget,attackGateWith,get baseNav(){return nav;},
   get villages(){return villages;},selectVillage,selectStructure,structureUnder,get selectedVillage(){return selectedVillage;},get selectedStructure(){return selectedStructure;},get vision(){return vision;},structureKnowledge,updateEnemyVisibility,concealment,takeControl,spawnStructureAt,updateArrows,refreshStandards,refreshSelectionPanel,troopInfo,burning,buildings,openBuildPanel,placeBuilding,buildingPlacement,buildPreview,updateBuildPreview,get constructionPreviewState(){return constructionPreviewState;},formationPreview,updateFormationPreview,get formationPreviewState(){return formationPreviewState;},degradeSelected,structureOrder,ladderOrder,get cpu(){return cpu;},aiAwareness,drawMinimap,miniPoint,get scriptEngine(){return scriptEngine;},get scriptGame(){return scriptGame;},zones,inZone,inForest,setSelection,orderGroup,faceTowards,memoriseGroup,recallGroup,
   mergeSelected,splitSelected,balanceSelected,sendHawk,recallHawk,attackWith,tickMission,nearbyDeployment,get pendingDeployment(){return pendingDeployment;},get missionClock(){return missionClock;},get logicPaused(){return logicPaused;},
   edition:'HD Remaster',sources:{environment:models.statistics,terrain:hdTerrain,units:unitAssets.source,interface:hdInterface.source}};
 }catch(error){console.error(error);$('loadingText').textContent=error.message||String(error);}
})();
