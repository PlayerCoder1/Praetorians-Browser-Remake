/* Shared, cached sight queries for skirmish planners. The renderer's visible
   flag belongs to the human observer and cannot be used as CPU intelligence. */
(function(root,factory){
 const concealment=typeof module==='object'&&module.exports?require('../world/troop-concealment.js'):root.PraetoriansTroopConcealment;
 const api=factory(concealment);if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.PraetoriansAiAwareness=api;
})(typeof window!=='undefined'?window:globalThis,function(Concealment){
 'use strict';
 function create({squads,villages=()=>[],alive=s=>s.members.length>0,allied,hostile,centroid=s=>s,spread=()=>0,groundY=()=>0,inForest=()=>false,clock=()=>0,concealedSight=4,villageVision=10,interval=.5,cellSize=24}){
  let until=-Infinity,records=[],eyes=[],grid=new Map(),cache=new Map(),maxReach=0;
  const stats={rebuilds:0,queries:0,cacheHits:0,sightChecks:0};
  const key=(x,z)=>Math.floor(x/cellSize)+','+Math.floor(z/cellSize);
  function invalidate(){until=-Infinity;}
  function rebuild(now){
   records=[];eyes=[];grid=new Map();cache=new Map();maxReach=0;
   for(const squad of squads()){
    if(!alive(squad)||!squad.civ||squad.inVillage)continue;
    const p=squad.sheltered?squad:centroid(squad);
    if(!Number.isFinite(p.x)||!Number.isFinite(p.z))continue;
    const members=squad.members||[],forestCount=members.reduce((n,m)=>n+(inForest(m.x,m.z)?1:0),0);
    const record={squad,civ:squad.civ,x:p.x,z:p.z,y:groundY(p.x,p.z),reach:Math.max(0,spread(squad)||0),hidden:forestCount*2>members.length,concealed:Concealment.isHidden(squad)};
    // A sheltered troop supplies vision but cannot be selected as an attack
    // target itself; the enemy must attack the tower that shelters it.
    if(!squad.sheltered){records.push(record);maxReach=Math.max(maxReach,record.reach);const bucket=key(p.x,p.z);if(!grid.has(bucket))grid.set(bucket,[]);grid.get(bucket).push(record);}
    const vision=squad.profile?.vision||0;
    if(vision>0)eyes.push({civ:squad.civ,x:p.x,z:p.z,y:record.y,vision,forest:forestCount>0});
   }
   for(const village of villages())if(village.owner)eyes.push({civ:village.owner,x:village.x,z:village.z,y:groundY(village.x,village.z),vision:(village.radius||4)+villageVision,forest:false});
   until=now+interval;stats.rebuilds++;
  }
  function visibleEnemies(civ){
   const now=clock();if(now>=until||now<until-interval)rebuild(now);
   stats.queries++;if(cache.has(civ)){stats.cacheHits++;return cache.get(civ);}
   const seen=new Set();
   for(const eye of eyes){
    if(eye.civ!==civ&&!allied(eye.civ,civ))continue;
    const radius=eye.vision+maxReach,minX=Math.floor((eye.x-radius)/cellSize),maxX=Math.floor((eye.x+radius)/cellSize),minZ=Math.floor((eye.z-radius)/cellSize),maxZ=Math.floor((eye.z+radius)/cellSize);
    for(let z=minZ;z<=maxZ;z++)for(let x=minX;x<=maxX;x++)for(const target of grid.get(x+','+z)||[]){
     if(seen.has(target.squad)||!hostile(civ,target.civ))continue;
     stats.sightChecks++;const d=Math.hypot(eye.x-target.x,eye.z-target.z);
     if(d>eye.vision+target.reach)continue;
     if(target.concealed){if(d<=concealedSight+target.reach)seen.add(target.squad);continue;}
     if(d<=4+target.reach||((!target.hidden||(eye.forest&&d<=6+target.reach))&&target.y-eye.y<=1.2))seen.add(target.squad);
    }
   }
   const result=[...seen];cache.set(civ,result);return result;
  }
  return {visibleEnemies,invalidate,stats};
 }
 return {create};
});
