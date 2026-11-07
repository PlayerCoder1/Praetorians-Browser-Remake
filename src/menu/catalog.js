/* Menu catalog: the campaign in MisionesSingle.dat order and the skirmish
   maps (assets/maps/catalog.json, tools/build_maps.py), with their titles and
   briefings in the game's own French texts and the original artwork exported
   from the user's PAKs (assets/menu-original). */
const ART='assets/menu-original/Game/';
const pad=n=>String(n).padStart(2,'0');
async function readJson(url) {
 try { const response = await fetch(url, {cache:'no-cache'}); return response.ok ? await response.json() : null; }
 catch { return null; }
}
export async function loadCatalog() {
 const i18n=window.PraetoriansI18n;await i18n?.ready();
 const [menu, built, texts, structureData] = await Promise.all([readJson('data/ui/menu-fr.json'), readJson('assets/maps/catalog.json'),
  readJson('data/localization/fr-game.json'),readJson('assets/hd/structures.json')]);
 const index=new Map(Object.entries(texts?.texts||{}).map(([k,v])=>[k.toLowerCase(),v]));
 const text=key=>{if(!key)return null;const value=i18n?.text(key,key);return value&&value!==key?value:index.get(String(key).toLowerCase())??null;};
 const transcribed=new Map((menu?.campaign||[]).map((entry,i)=>[i,entry]));
 const titles=new Map((menu?.skirmish||[]).map(entry=>[entry.id,entry.title]));
 const campaign=(built?.campaign||[{id:'SP_TUTORIAL_1',index:1}]).map((entry,i)=>({
  id:entry.id,
  // Mission names (LTEXT_MISION_*); the tutorials keep the menu's names.
  title:(text(entry.title)||transcribed.get(i)?.title||entry.id).toUpperCase(),
  description:text(entry.description)||transcribed.get(i)?.description||'',
  // Portrait campaign map shown beside the briefing, in list order.
  art:`${ART}Imagenes/Single/Mapa_S_${pad(i+1)}.png`,
  enabled:true
 }));
 const skirmish=await Promise.all((built?.skirmish||[]).map(async entry=>{
  const players=entry.maxPlayers||Number(entry.id.split('_')[1])||2;
  const title=text(entry.title)||titles.get(entry.id)||entry.id;
  const mission=await readJson(`assets/missions/${encodeURIComponent(entry.id)}.json`);
  const markers=window.PraetoriansMapVillageMarkers;
  const mapInfo={width:mission?.scene?.width,depth:mission?.scene?.depth,
   villages:markers?.fromStructures(mission?.structures,structureData?.structures)||[]};
  return {id:entry.id,title,players,label:`${title} (${players})`,art:`${ART}Mapas/DESCRIPCION/${entry.map||entry.id}.png`,
   fallback:`assets/maps/${entry.map||entry.id}/minimap.png`,mapInfo};
 }));
 return {campaign,multiplayer:skirmish,source:built?'assets/maps/catalog.json':'fallback'};
}
