import {ID,esc,need} from "./rules.mjs";

export function notebook(scene,regionId,locationId) {
  return game.journal.find(j=>{const link=j.getFlag(ID,"notebook");return link?.sceneId===scene.id&&link.regionId===regionId&&(link.locationId??null)===(locationId??null)&&!link.archived;});
}
const descriptionHTML=subject=>subject.description?`<p>${esc(subject.description).replace(/\n/g,"<br>")}</p>`:"<p></p>";
async function seedDescription(doc,subject) {
  if(!subject.description||doc.pages.some(p=>p.flags?.[ID]?.description))return;
  const initial=doc.pages.find(p=>p.flags?.[ID]?.initial&&["","<p></p>"].includes(p.text.content??""));
  if(initial)await initial.update({"text.content":descriptionHTML(subject),[`flags.${ID}.description`]:true});
  else await doc.createEmbeddedDocuments("JournalEntryPage",[{name:"Описание",type:"text",text:{format:1,content:descriptionHTML(subject)},flags:{[ID]:{description:true}}}]);
}
async function revokePages(doc) {
  const pages=doc.pages.filter(p=>p.ownership&&(p.ownership.default>0||Object.keys(p.ownership).length>1));
  if(pages.length)await doc.updateEmbeddedDocuments("JournalEntryPage",pages.map(p=>({_id:p.id,ownership:{default:p.ownership.default>0?-1:p.ownership.default??-1}})),{diff:false,recursive:false});
}
async function folder(key,name,parent=null) {
  let doc=game.folders.find(f=>f.type==="JournalEntry"&&f.getFlag(ID,"notebooks")===key);
  if(!doc)doc=await Folder.create({name,type:"JournalEntry",folder:parent,flags:{[ID]:{notebooks:key}}});
  else if(doc.name!==name||doc.folder?.id!==parent&&!(doc.folder==null&&parent==null))await doc.update({name,folder:parent});
  return doc;
}
export async function syncJournals(scene,data) {
  if(!game.users.activeGM?.isSelf)return;
  const root=await folder("root","Pointcrawl"),group=await folder(scene.id,scene.name??scene.id,root.id);
  const regions=await folder(`${scene.id}:regions`,"Регионы",group.id),locations=await folder(`${scene.id}:locations`,"Локации",group.id);
  const current=new Set();
  for(const r of Object.values(data.regions).filter(Boolean))for(const l of [null,...r.locations]) {
    const link={sceneId:scene.id,regionId:r.id,locationId:l?.id??null},subject=l??r;
    let doc=game.journal.find(j=>{const f=j.getFlag(ID,"notebook");return f?.sceneId===scene.id&&f.regionId===r.id&&(f.locationId??null)===(l?.id??null);});
    const folderId=l?locations.id:regions.id,level=r.explored&&(!l||l.revealed)?3:0;
    const published=!!level||doc?.getFlag(ID,"notebook").published===true;
    link.published=published;
    const name=published?(l?`${r.name} — ${l.name}`:r.name):l?"Скрытая локация":"Неизвестный регион";
    if(!doc)doc=await JournalEntry.create({name,folder:folderId,ownership:{default:level},flags:{[ID]:{notebook:link}},pages:[{name:"Заметки",type:"text",text:{format:1,content:published?descriptionHTML(subject):"<p></p>"},flags:{[ID]:{initial:true,description:published&&!!subject.description}}}]},{render:false});
    else {
      if(level&&!doc.getFlag(ID,"notebook").published)await seedDescription(doc,subject);
      const changes={};
      if(doc.name!==name)changes.name=name;
      if(doc.folder?.id!==folderId)changes.folder=folderId;
      if(doc.ownership.default!==level||Object.keys(doc.ownership).some(k=>k!=="default"))changes.ownership={default:level};
      if(doc.getFlag(ID,"notebook").archived||doc.getFlag(ID,"notebook").published!==published)changes.flags={...doc.flags,[ID]:{...doc.flags[ID],notebook:link}};
      // Ownership is replaced so closing a region also revokes individually assigned player access.
      if(Object.keys(changes).length)await doc.update(changes,{diff:false,recursive:false});
    }
    if(!level)await revokePages(doc);
    current.add(doc.id);
  }
  // Preserve written pages when a region/location is removed; archive instead of deleting player work.
  for(const doc of game.journal.filter(j=>j.getFlag(ID,"notebook")?.sceneId===scene.id&&!current.has(j.id))) {
    if(!doc.getFlag(ID,"notebook").archived)await doc.update({name:`Архив · ${doc.name}`,ownership:{default:0},flags:{...doc.flags,[ID]:{...doc.flags[ID],notebook:{...doc.getFlag(ID,"notebook"),archived:true}}}},{diff:false,recursive:false});
    await revokePages(doc);
  }
}
export function showNotebook(scene,regionId,locationId) {
  const doc=notebook(scene,regionId,locationId);
  need(doc&&doc.testUserPermission(game.user,"OBSERVER"),"Заметки недоступны. Дождитесь подключения мастера и открытия региона.");
  doc.sheet.render({force:true});return doc;
}
