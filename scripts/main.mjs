import {ID} from "./rules.mjs";
import {state,privateData,connectSocket,request} from "./store.mjs";
import {PointcrawlApp,TravelCentre,RequestWindow} from "./app.mjs";
import {controls,preMove,validateGeometry,prepareRegion,redraw,canvasReady,canvasTearDown,useTool} from "./canvas.mjs";
import {initializePrivate,loadPrivate} from "./private.mjs";

Hooks.once("init",()=>{
  game.settings.registerMenu(ID,"open",{name:"Pointcrawl · Мастер",label:"Открыть менеджер мастера",hint:"Регионы, маршруты, события и заявки.",icon:"fa-solid fa-map",type:PointcrawlApp,restricted:true});
  game.settings.registerMenu(ID,"centre",{name:"Pointcrawl · Партия",label:"Открыть центр путешествий",hint:"Действия партии и известные регионы.",icon:"fa-solid fa-campground",type:TravelCentre,restricted:false});
});
Hooks.once("socketlib.ready",connectSocket);
Hooks.once("ready",async()=>{
  if(game.modules.get("socketlib")?.active)connectSocket();
  game.modules.get(ID).api={open:()=>game.user.isGM?PointcrawlApp.open():TravelCentre.open()};
  if(game.user.isGM) {try{await initializePrivate(game.users.activeGM?.isSelf);if(game.users.activeGM?.isSelf)for(const scene of game.scenes.filter(s=>state(s).enabled))await request("syncJournals",{},scene);ui.journal.render();refresh();}catch(e){ui.notifications.error(`Pointcrawl: ${e.message}`);}}
  if(game.user.isGM&&canvas.scene&&state(canvas.scene).active?.status==="committing")ui.notifications.warn("Pointcrawl: незавершённое действие. Откройте центр путешествий для восстановления.",{permanent:true});
  refresh();
});
Hooks.on("getSceneControlButtons",controls);
Hooks.on("preMoveToken",preMove);
Hooks.on("preUpdateRegion",validateGeometry);
Hooks.on("canvasReady",canvasReady);
Hooks.on("canvasReady",()=>{if(game.ready&&game.users.activeGM?.isSelf&&state(canvas.scene).enabled)request("syncJournals",{},canvas.scene).catch(console.error);});
Hooks.on("canvasTearDown",canvasTearDown);
Hooks.on(`${ID}.tool`,args=>useTool(args).catch(e=>ui.notifications.error(e.message)));
let refreshTimer;
function refresh() {
  clearTimeout(refreshTimer);
  refreshTimer=setTimeout(()=>{
    redraw();
    RequestWindow.sync();
  },80);
}
Hooks.on(`${ID}.refresh`,()=>{refresh();if(game.user.isGM)ui.journal.render({parts:["directory"]});});
for(const hook of ["updateScene","updateRegion","deleteRegion","updateActor","updateJournalEntry","userConnected","updateWorldTime","updateToken","createChatMessage","updateChatMessage"])Hooks.on(hook,refresh);
Hooks.on("activateSceneControls",refresh);
Hooks.on("userConnected",()=>{if(game.users.activeGM?.isSelf)for(const scene of game.scenes.filter(s=>state(s).enabled))request("syncJournals",{},scene).catch(console.error);});
function notebookTitle(doc) {
  const link=doc.getFlag(ID,"notebook"),scene=game.scenes.get(link?.sceneId);
  if(!game.user.isGM||!scene)return doc.name;
  const r=privateData(scene).regions[link.regionId],l=link.locationId?r?.locations.find(l=>l.id===link.locationId):null;
  return r&&(!link.locationId||l)?(l?`${r.name} — ${l.name}`:r.name):doc.name;
}
Hooks.on("renderJournalDirectory",(_app,html)=>{
  if(!game.user.isGM)return;
  for(const row of html.querySelectorAll("[data-entry-id]")) {
    const doc=game.journal.get(row.dataset.entryId);if(!doc?.getFlag(ID,"notebook"))continue;
    const name=row.querySelector(".entry-name");if(name)name.textContent=notebookTitle(doc);
  }
});
Hooks.on("renderJournalEntrySheet",(app,html)=>{
  const link=app.document?.getFlag(ID,"notebook");if(!link||link.archived||!game.user.isGM||html.querySelector(".mjl-journal-secrets"))return;
  const title=notebookTitle(app.document),input=html.querySelector('.journal-header input[name="name"]');
  if(input){input.value=title;input.disabled=true;}
  const heading=html.querySelector(".window-title");if(heading)heading.textContent=title;
  const b=document.createElement("button");b.type="button";b.className="mjl-journal-secrets";b.textContent="Pointcrawl · заметки мастера";
  b.onclick=()=>import("./app.mjs").then(({NotesWindow})=>NotesWindow.open({...link,tab:"gm"})).catch(e=>ui.notifications.error(`Pointcrawl: ${e.message}`));
  html.querySelector(".journal-header")?.append(b);
});
Hooks.on("updateScene",(_scene,changes)=>{
  if(game.user.isGM&&!game.users.activeGM?.isSelf&&foundry.utils.getProperty(changes,`flags.${ID}`))loadPrivate().then(()=>{ui.journal.render();refresh();}).catch(console.error);
});
Hooks.on("createRegion",(doc,_options,userId)=>{
  refresh();
  if(game.user.id===userId&&ui.controls.control?.name===ID&&state(doc.parent).enabled)PointcrawlApp.open({regionId:doc.id});
});
Hooks.on("deleteRegion",doc=>{
  if(game.users.activeGM?.isSelf&&state(doc.parent).enabled&&privateData(doc.parent).regions[doc.id])
    request("deleteRegion",{regionId:doc.id},doc.parent).catch(e=>ui.notifications.error(e.message));
});
Hooks.on("preCreateRegion",prepareRegion);
Hooks.on("preDeleteRegion",(doc,_options)=>{
  if(doc.getFlag(ID,"region")&&(state(doc.parent).active||state(doc.parent).currentRegionId===doc.id)) {ui.notifications.warn("Pointcrawl: завершите заявку и уберите группу из региона перед удалением.");return false;}
});
Hooks.on("renderRegionConfig",(app,html)=>{
  const doc=app.document;
  // RegionPalette also emits this hook, but its document is a temporary preset, not a scene Region.
  if(!game.user.isGM||!doc?.id||doc.parent?.regions?.get(doc.id)!==doc||!state(doc.parent).enabled||html.querySelector(".mjl-region-card"))return;
  const b=document.createElement("button");b.className="mjl-region-card";b.type="button";b.textContent="Pointcrawl — карточка региона";
  b.onclick=()=>PointcrawlApp.open({regionId:doc.id});html.querySelector(".window-content")?.prepend(b);
});
Hooks.on("renderTokenConfig",(app,html)=>{
  const token=app.document;
  if(!game.user.isGM||token?.parent?.documentName!=="Scene"||html.querySelector(".mjl-token-setting"))return;
  const label=document.createElement("label");label.className="mjl-token-setting form-group";
  const span=document.createElement("span");span.textContent="Pointcrawl — токен группы";
  const input=document.createElement("input");input.type="checkbox";input.name=`flags.${ID}.party`;input.checked=!!token.getFlag(ID,"party");
  input.disabled=token.actor?.type!=="group";
  label.append(span,input);
  const target=html.querySelector('[data-tab="character"]')??html.querySelector(".window-content");target?.append(label);
});
Hooks.on("preUpdateToken",(token,changes)=>{
  const value=foundry.utils.getProperty(changes,`flags.${ID}.party`);
  if(value===undefined)return;
  if(!game.user.isGM||token.actor?.type!=="group")return false;
  if(state(token.parent).active){ui.notifications.warn("Pointcrawl: завершите заявку перед сменой токена группы.");return false;}
});
Hooks.on("updateToken",(token,changes,_options,userId)=>{
  if(!game.users.activeGM?.isSelf||!state(token.parent).enabled)return;
  if(foundry.utils.getProperty(changes,`flags.${ID}.party`)===true&&state(token.parent).tokenId!==token.id)
    request("party",{tokenId:token.id},token.parent).catch(e=>ui.notifications.error(`Pointcrawl: ${e.message}`));
  if(foundry.utils.getProperty(changes,`flags.${ID}.party`)===false&&state(token.parent).tokenId===token.id)
    request("unparty",{},token.parent).catch(e=>ui.notifications.error(`Pointcrawl: ${e.message}`));
});
// dnd5e replaces request-card contents after Foundry's renderChatMessageHTML hook.
Hooks.on("dnd5e.renderChatMessage",(message,html)=>{
  // This particular video is inserted by theripper93 welcome cards. Preserve the card without auto-loading an external iframe.
  for(const frame of html.querySelectorAll('iframe[src^="https://www.youtube.com/embed/2Iq_so_GsLA"]')) {
    const link=document.createElement("a");link.href="https://www.youtube.com/watch?v=2Iq_so_GsLA";
    link.target="_blank";link.rel="noopener noreferrer";link.textContent="Открыть ознакомительное видео на YouTube";frame.replaceWith(link);
  }
  const flag=message.getFlag(ID,"requestId");
  if(flag) {
    html.querySelector(".targets")?.remove();
    html.querySelector("[data-mjl-open]")?.addEventListener("click",()=>{
      const sceneId=message.getFlag(ID,"sceneId");
      RequestWindow.open({sceneId,requestId:flag});
    });
  }
  const publish=html.querySelector("[data-mjl-event]");
  if(publish) {
    publish.hidden=!game.user.isGM;
    publish.addEventListener("click",()=>request("publishEvent",{eventId:publish.dataset.mjlEvent},game.scenes.get(publish.dataset.scene)).catch(e=>ui.notifications.error(e.message)));
  }
});
