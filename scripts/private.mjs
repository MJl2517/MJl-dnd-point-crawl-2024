import {ID} from "./rules.mjs";

export const PRIVATE_PACK=`world.${ID}-private`;
export const privateEntries=new Map();
let initializing;
const ownership={GAMEMASTER:"OWNER",ASSISTANT:"OWNER",TRUSTED:"NONE",PLAYER:"NONE"};
export function privatePack() {return game.packs.get(PRIVATE_PACK);}
export async function loadPrivate() {
  if(!game.user.isGM||!privatePack())return;
  const docs=await privatePack().getDocuments();
  privateEntries.clear();
  for(const doc of docs) {const id=doc.getFlag(ID,"sceneId");if(id)privateEntries.set(id,doc);}
}
export async function initializePrivate(create=false) {
  if(!game.user.isGM)return;
  if(initializing)return initializing;
  initializing=(async()=>{
    let pack=privatePack();
    if(!pack&&create) pack=await CompendiumCollection.createCompendium({name:`${ID}-private`,label:"Pointcrawl · секреты мастера",type:"JournalEntry",ownership},{render:false});
    if(!pack)return;
    if(create && (pack.locked||pack.ownership.PLAYER!=="NONE"||pack.ownership.TRUSTED!=="NONE"))await pack.configure({ownership,locked:false});
    await loadPrivate();
  })();
  try {await initializing;}finally{initializing=null;}
}
export async function createPrivate(scene,data) {
  await initializePrivate(true);
  const doc=await JournalEntry.create({name:`Pointcrawl ${scene.id}`,ownership:{default:0},flags:{[ID]:{sceneId:scene.id,data}}},{pack:PRIVATE_PACK,broadcast:false,render:false});
  privateEntries.set(scene.id,doc);return doc;
}
