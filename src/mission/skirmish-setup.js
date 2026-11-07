/* Shared skirmish roster rules. No DOM or engine dependencies: the menu and
   mission loader use the same validation, colours, races and team rules. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.SkirmishSetup=root.PraetoriansSkirmishSetup=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const COLORS=Object.freeze([
  {name:'red',label:'Rouge',hex:'#ff4c32'},
  {name:'green',label:'Vert',hex:'#24cf18'},
  {name:'orange',label:'Orange',hex:'#ffa500'},
  {name:'blue',label:'Bleu',hex:'#00b8e8'},
  {name:'purple',label:'Violet',hex:'#ed28cf'},
  {name:'yellow',label:'Jaune',hex:'#d8df00'},
  {name:'brown',label:'Brun',hex:'#ae7d25'},
  {name:'grey',label:'Gris',hex:'#929292'}
 ].map(Object.freeze));
 const RACES=Object.freeze([
  {id:'ROMANOS',label:'Romains'},
  {id:'EGIPCIOS',label:'Égyptiens'},
  {id:'BARBAROS',label:'Barbares'},
  {id:'RANDOM',label:'Aléatoire'}
 ].map(Object.freeze));
 const RACE_IDS=['ROMANOS','BARBAROS','EGIPCIOS'];
 const capacity=max=>Math.max(2,Math.min(8,Math.floor(Number(max)||2)));
 const integer=(value,min,max,fallback)=>Number.isInteger(Number(value))&&Number(value)>=min&&Number(value)<=max?Number(value):fallback;
 const defaultPlayer=i=>({name:i?'CPU'+i:'Joueur',race:i?'RANDOM':'ROMANOS',color:i,team:0});
 function normalizePlayers(players,maxPlayers){
  const max=capacity(maxPlayers),input=Array.isArray(players)?players:[];
  const count=Math.max(2,Math.min(max,input.length||max)),used=new Set();
  return Array.from({length:count},(_,i)=>{
   const source=input[i]&&typeof input[i]==='object'?input[i]:{},fallback=defaultPlayer(i);
   let color=integer(source.color,0,7,i);
   if(used.has(color))color=COLORS.findIndex((_,n)=>!used.has(n));
   used.add(color);
   const name=typeof source.name==='string'?source.name.trim().slice(0,40):'';
   return {name:name||fallback.name,race:RACES.some(r=>r.id===source.race)?source.race:fallback.race,
    color,team:integer(source.team,0,8,0)};
  });
 }
 // Entering a map fills its available slots, preserving any choices that
 // fit. Removing a CPU afterwards uses normalizePlayers, which keeps count.
 function createPlayers(maxPlayers,existing){
  const max=capacity(maxPlayers),input=Array.isArray(existing)?existing:[];
  return normalizePlayers(Array.from({length:max},(_,i)=>input[i]||defaultPlayer(i)),max);
 }
 function prepareLaunch(players,maxPlayers,random=Math.random){
  return normalizePlayers(players,maxPlayers).map(player=>({...player,race:player.race==='RANDOM'
   ?RACE_IDS[Math.max(0,Math.min(RACE_IDS.length-1,Math.floor(Number(random())*RACE_IDS.length)||0))]:player.race}));
 }
 function sameTeam(a,b){return !!a&&!!b&&Number(a.team)>0&&Number(a.team)===Number(b.team);}
 function hasOpponents(players){return Array.isArray(players)&&players.length>1&&players.some((p,i)=>i>0&&!sameTeam(players[0],p));}
 function alliancePairs(civilizations){
  const pairs=[];
  for(let i=0;i<civilizations.length;i++)for(let j=i+1;j<civilizations.length;j++){
   const a=civilizations[i],b=civilizations[j];
   if(!a.neutral&&!b.neutral&&sameTeam(a,b))pairs.push([a.name,b.name]);
  }
  return pairs;
 }
 // Older direct links still use race/opponents/opponentRaces. Their explicit
 // race rotation and default one CPU remain compatible with the old loader.
 function legacyPlayers(launch,maxPlayers){
  const humanRace=RACE_IDS.includes(launch.race)?launch.race:'ROMANOS';
  const count=Math.min(capacity(maxPlayers),Math.max(2,Math.floor(Number(launch.opponents)||1)+1));
  return Array.from({length:count},(_,i)=>({...defaultPlayer(i),race:i
   ?(launch.opponentRaces?.[i-1]||RACE_IDS[(RACE_IDS.indexOf(humanRace)+i)%RACE_IDS.length]):humanRace}));
 }
 function buildScenario(mission,races,launch={},random=Math.random){
  const starts=(mission.startPositions||[]).map(([x,z])=>({x,z}));
  if(starts.length<2)return {players:[],civilizations:[],troops:[]};
  const max=Math.min(starts.length,mission.maxPlayers||starts.length,8);
  const players=prepareLaunch(Array.isArray(launch.players)&&launch.players.length?launch.players:legacyPlayers(launch,max),max,random);
  const home=starts[0],rest=starts.slice(1).sort((a,b)=>Math.hypot(b.x-home.x,b.z-home.z)-Math.hypot(a.x-home.x,a.z-home.z));
  const centre={x:(mission.scene?.width||0)/2,z:(mission.scene?.depth||0)/2};
  const civilizations=[],troops=[];
  players.forEach((player,i)=>{
   const start=i?rest[i-1]:home,race=races[player.race]?player.race:'ROMANOS',name=i?`CPU ${i}`:'JOUEUR';
   civilizations.push({name,displayName:player.name,race,human:!i,color:String(player.color),team:player.team,label:null,neutral:false,cpu:!!i});
   const facing=Math.atan2(centre.x-start.x,centre.z-start.z);
   (races[race]?.pack||[]).forEach((troop,k)=>troops.push({name:`${name}_${k+1}`,type:troop.type,
    civilization:name,units:troop.units,position:[start.x,0,start.z],orientation:facing,properties:[],formation:'',skirmishStart:true}));
  });
  return {players,civilizations,troops};
 }
 // A teammate can still win after the human army falls. Neutral forces do
 // not prolong elimination matches. Campaigns retain their scripted rules.
 function eliminationOutcome(humanName,aliveNames,civilizations,isAllied=null){
  const human=civilizations.find(c=>c.name===humanName),alive=new Set(aliveNames);
  const active=civilizations.filter(c=>!c.neutral&&alive.has(c.name));
  const friendly=c=>c.name===humanName||(isAllied?isAllied(humanName,c.name):sameTeam(human,c));
  if(!active.some(friendly))return 'defeat';
  return active.some(c=>!friendly(c))?null:'victory';
 }
 return {COLORS,RACES,capacity,normalizePlayers,createPlayers,prepareLaunch,sameTeam,hasOpponents,alliancePairs,buildScenario,eliminationOutcome};
});
