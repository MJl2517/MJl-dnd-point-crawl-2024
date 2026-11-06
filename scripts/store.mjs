import {ID, TERRAIN, PACE, ACTIONS, STATUS, clone, need, number, text, esc, allowedPaces, journeySeconds, movementProfile, travelLeg, TRAVEL_LIMIT, secondsLabel, durationSeconds, dayOf, eventTable, validateRequest, unknownExitLabels} from "./rules.mjs";
import {privateEntries,initializePrivate,createPrivate} from "./private.mjs";
import {isBoundary,fitRegion} from "./geometry.mjs";
import {syncJournals,notebook} from "./journals.mjs";

let socket, queue=Promise.resolve();
export const state = scene => scene?.getFlag(ID,"state") ?? {enabled:false,regions:[],routes:[],active:null};
export const partyToken = scene => scene?.tokens.get(state(scene).tokenId);
export const members = scene => partyToken(scene)?.actor?.system.playerCharacters ?? [];
export function participants(scene,data=privateData(scene)) {
  if(!(data.offline?.enabled??state(scene).offline))return members(scene);
  if(!data.offline||!partyToken(scene))return [];
  return data.offline.roster.length?data.offline.roster:[{id:`offline-${scene.id}`,name:"Группа"}];
}
export function participantName(r,id) {
  return r.offlineParticipants?.find(p=>p.id===id)?.name??r.actors.find(p=>p.id===id)?.name??game.actors.get(id)?.name??"Удалённый персонаж";
}
export const needsParticipant = r => r.phase==="marchSave"||(!["travel","local","teleport"].includes(r.kind)||!!r.risk&&!r.navigationDone);
export function journey(scene,data=privateData(scene)) {
  const id=partyToken(scene)?.actor?.id;
  const ledgers=[...privateEntries.values()].map(doc=>doc.getFlag(ID,"data")?.journeys?.[id]);ledgers.push(data.journeys?.[id]);
  return clone(ledgers.filter(Boolean).sort((a,b)=>b.revision-a.revision)[0]??{seconds:0,revision:0,profile:movementProfile()});
}
export function partyProfile(scene,data=privateData(scene)) {
  const p=movementProfile(journey(scene,data).profile);
  if(!data.offline?.enabled&&p.mode==="walk"&&members(scene).some(a=>{const base=Number(a._source?.system?.attributes?.movement?.walk);return base>0&&Number(a.system.attributes?.movement?.walk)<=base/2;}))p.slower=true;
  return p;
}
function activeElsewhere(scene,partyId) {
  return [...privateEntries.values()].some(doc=>{const id=doc.getFlag(ID,"sceneId"),data=doc.getFlag(ID,"data"),r=data?.requests?.[data.activeId];return id!==scene.id&&game.scenes.has(id)&&!!r&&(r.partyId??partyToken(game.scenes.get(id))?.actor?.id)===partyId;});
}
function assignUsers(scene,r) {
  if(r.offlineParticipants){r.assignedUsers={};return;}
  r.assignedUsers=Object.fromEntries(r.actors.map(id=>{
    const owners=game.users.filter(u=>!u.isGM&&game.actors.get(id)?.testUserPermission(u,"OWNER")).sort((a,b)=>a.id.localeCompare(b.id));
    const owner=owners.find(u=>u.active&&u.character?.id===id)??owners.find(u=>u.active&&u.id===r.createdBy)??owners.find(u=>u.active)??owners[0];return [id,owner?.id??null];
  }));
}
export function regionDraft(doc,terrain="forest") {
  return {...TERRAIN[terrain],id:doc.id,name:doc.name||"Новый регион",terrain,description:"",notes:"",locations:[],tables:[],explored:false,center:null,equipped:false};
}
export function journal(scene) { return privateEntries.get(scene.id); }
export function privateData(scene) { return clone(journal(scene)?.getFlag(ID,"data") ?? {regions:{},routes:[],requests:{},activeId:null,foraged:{},events:{}}); }
export function notesFor(scene,regionId,locationId) {
  const gm=game.user?.isGM===true;
  const r=gm?privateData(scene).regions[regionId]:state(scene).regions.find(r=>r.id===regionId&&r.explored);
  need(r,"Заметки этого региона недоступны.");
  const subject=locationId?r.locations?.find(l=>l.id===locationId):r;
  need(subject,"Заметки этой локации недоступны.");
  return {name:subject.name,description:subject.description??"",...(gm?{notes:subject.notes??""}:{})};
}
const uid = () => foundry.utils.randomID();
async function save(scene,data) {
  const doc=journal(scene);
  // Replace the snapshot: Foundry's recursive merge would keep the previous hour's cleared outcomes.
  const updated=await doc.update({flags:{...doc.flags,[ID]:{...doc.flags?.[ID],data}}},{broadcast:false,diff:false,recursive:false});
  // Compendium updates can return a fresh Document instead of updating the instance in our map.
  privateEntries.set(scene.id,updated??doc);
}
const memberIds = (scene,data) => participants(scene,data).map(a=>a.id);
const alreadyForaged = (data,id,day) => data.foraged[id]===day || [...privateEntries.values()].some(doc=>doc.getFlag(ID,"data")?.foraged?.[id]===day);
const gmOnly = user => need(user?.isGM,"Это действие доступно только мастеру.");
const current = (scene,data) => data.regions[state(scene).currentRegionId];
const active = data => data.requests[data.activeId];
const requestById = (data,id) => { const r=data.requests[id]; need(r,"Заявка не найдена."); return r; };
function ownsParty(user,scene,data) {
  need(user.isGM||!data.offline?.enabled,"Офлайн-партией управляет мастер.");
  need(user.isGM || partyToken(scene)?.testUserPermission(user,"OWNER") || members(scene).some(a=>a.testUserPermission(user,"OWNER")),"Нет права управлять этой партией.");
}
function region(data,id) { const r=data.regions[id]; need(r,"Регион не найден."); return r; }
function checkScene(scene) { need(scene && state(scene).enabled,"Включите Pointcrawl для этой сцены."); }
function checkParty(scene,data) {
  need(partyToken(scene)?.actor?.type==="group","Назначьте токен актёра «Группа».");
  need(participants(scene,data).length,"Добавьте персонажей в группу или включите офлайн-режим.");
}
function route(data,from,to) { return data.routes.find(r=>(r.from===from&&r.to===to)||(r.from===to&&r.to===from)); }
export function regionAt(scene,point,includeDrafts=false) {
  const contains=r=>(includeDrafts?isBoundary(r):r.getFlag(ID,"region"))&&r.polygonTree.testPoint(point);
  const here=scene.regions.get(state(scene).currentRegionId);
  if(here&&contains(here))return here;
  return scene.regions.find(contains);
}
export function tokenPoint(token,position=token) {
  return {x:position.x+token.width*token.parent.grid.size/2,y:position.y+token.height*token.parent.grid.size/2};
}
function localTarget(scene,data,locationId,user) {
  const r=current(scene,data);need(r,"Текущий регион не найден.");
  if(!locationId) {need(r.center,"У региона нет центра.");return {name:`Центр: ${r.name}`,...r.center};}
  const l=r.locations.find(l=>l.id===locationId);
  need(l&&(user.isGM||l.revealed),"Локация недоступна.");return l;
}
function teleportTarget(scene,data,to,locationId,user) {
  const dest=region(data,to);
  need(scene.regions.has(to)&&(user.isGM||dest.explored),"Назначение телепортации недоступно.");
  const target=locationId?dest.locations.find(l=>l.id===locationId&&(user.isGM||l.revealed)):dest.center;
  need(target,"Точка телепортации недоступна.");return target;
}
async function moveParty(scene,point,flags={},operation={}) {
  const token=partyToken(scene);
  const x=point.x-token.width*scene.grid.size/2,y=point.y-token.height*scene.grid.size/2,teleport=!!operation.mjlPointcrawlTeleport;
  await token.update({x,y,...flags},
    {...operation,animate:!teleport,...(teleport?{movement:{[token.id]:{waypoints:[{x,y,action:"displace"}]}}}:{animation:{duration:1800}}),constrainOptions:{ignoreWalls:true,ignoreCost:true},showRuler:false});
}
export function publicRequest(r,scene,data) {
  if(!r) return null;
  const dest=data.regions[r.to??r.regionId],location=r.locationId?dest?.locations.find(l=>l.id===r.locationId):null;
  const unknown=r.exitLabel?`Неизвестный регион ${r.exitLabel}`:"Неизвестный регион";
  const destination=["local","teleport"].includes(r.kind)?(r.locationId?(dest?.explored&&location?.revealed?location.name:"Скрытая локация"):`Центр: ${dest?.explored?dest.name:"Неизвестный регион"}`):r.to?(dest?.explored?dest.name:unknown):null;
  return {id:r.id,sceneId:scene.id,kind:r.kind,status:r.status,offline:!!r.offlineParticipants,createdBy:r.createdBy,assignedUsers:clone(r.assignedUsers??{}),actors:r.actors.map(id=>({id,name:participantName(r,id)})),
    regionId:r.regionId,from:r.from,to:r.to,locationId:r.locationId,pace:r.pace,paces:r.paces,miles:r.miles,effectivePace:r.effectivePace,road:!!r.road,source:r.source,seconds:r.seconds,baseSeconds:r.baseSeconds,risk:r.risk,dc:r.dc,penalty:r.penalty,
    origin:data.regions[r.regionId]?.explored?data.regions[r.regionId].name:"Неизвестный регион",
    destination,
    phase:r.phase,step:r.step??0,elapsedSeconds:r.elapsedSeconds??0,navigationDone:!!r.navigationDone,march:!!r.march,marchRequested:!!r.marchRequested,restAtLimit:!!r.restAtLimit,resumeId:r.resumeId,restId:r.restId,daySeconds:r.status==="done"?(r.dayFinal??journey(scene,data).seconds):journey(scene,data).seconds,profile:r.profile,stages:clone(r.stages??[]),
    outcomes:clone(r.outcomes),running:clone(r.running),error:r.error??null,commit:r.commit?{type:r.commit.type,timeBefore:r.commit.timeBefore,timeAfter:r.commit.timeAfter,timeDone:r.commit.timeDone,tokenDone:r.commit.tokenDone,ledgerChange:r.commit.ledgerChange,dayBefore:r.commit.ledgerBefore?.seconds,dayAfter:r.commit.ledgerAfter?.seconds}:null};
}
export async function publish(scene,data,extra={}) {
  const old=state(scene);
  const currentId=Object.hasOwn(extra,"currentRegionId")?extra.currentRegionId:old.currentRegionId;
  const regions=Object.values(data.regions).filter(Boolean).map(r=>({id:r.id,center:r.center,showName:r.showName!==false,explored:r.explored,
    ...(r.explored?{name:r.name,terrain:r.terrain,description:r.description,locations:r.locations.filter(l=>l.revealed).map(l=>({id:l.id,name:l.name,showName:l.showName!==false,description:l.description,x:l.x,y:l.y,color:l.color??null}))}:{})}));
  const routes=data.routes.filter(r=>r.from===currentId||r.to===currentId||(data.regions[r.from]?.explored&&data.regions[r.to]?.explored)).map(r=>{
    const to=r.from===currentId?r.to:r.from;
    const profile=partyProfile(scene,data),paces=allowedPaces(data.regions[to],!!r.road,profile),pace=paces.includes("normal")?"normal":paces.at(-1);
    return {id:r.id,from:r.from,to:r.to,seconds:r.seconds,miles:r.miles,road:!!r.road,normalPace:pace,normalSeconds:journeySeconds(r.seconds,pace,data.regions[to],!!r.road,profile,r.miles),paces,name:data.regions[to]?.explored?data.regions[to].name:"?"};
  });
  const snapshot={...old,...extra,regions,routes,offline:!!data.offline?.enabled,journey:journey(scene,data),active:publicRequest(active(data),scene,data)};
  await scene.update({flags:{...scene.flags,[ID]:{...scene.flags?.[ID],state:snapshot}}},{diff:false,recursive:false});
  await syncJournals(scene,data);
  Hooks.callAll(`${ID}.refresh`);
}
export function card(r,scene,data) {
  const p=publicRequest(r,scene,data);
  const rows=p.actors.map(a=>`<li>${esc(a.name)} — ${r.status==="pending"?"ожидает решения мастера":!needsParticipant(r)?"проверка не требуется":r.outcomes[a.id] ? esc(r.outcomes[a.id].label) : r.running[a.id] ? "выполняется" : "ожидает"}</li>`).join("");
  return `<div class="mjl-card" data-scene="${scene.id}" data-request="${r.id}"><h3><i class="fa-solid fa-route"></i> ${ACTIONS[r.kind]}</h3><p>${STATUS[r.status]}</p>${p.destination?`<p>Назначение: <strong>${esc(p.destination)}</strong>${r.kind==="travel"?` · ${PACE[r.effectivePace??r.pace].name}`:""}</p>`:""}<p>Время: <strong>${r.seconds==null?"назначит мастер":secondsLabel(r.seconds)}</strong>${r.dc!=null&&needsParticipant(r)?` · Сл. ${r.dc}`:""}${r.penalty?` · потеря пути +${r.penalty}%`:""}</p>${["travel","local"].includes(r.kind)?`<p>В пути: ${secondsLabel(p.daySeconds)} / 8 ч${r.elapsedSeconds?` · пройдено по заявке ${secondsLabel(r.elapsedSeconds)}`:""}${r.phase==="marchSave"?` · спасброски Телосложения, Сл. ${r.dc}`:""}</p>`:""}<ul>${rows}</ul>${r.error?`<p class="mjl-error">${esc(r.error)}</p>`:""}<button type="button" data-mjl-open="${r.id}">Открыть заявку</button></div>`;
}
async function syncCard(scene,data,r) {
  const message=game.messages.get(r.messageId);
  if(message)await message.update({content:card(r,scene,data),flags:{...message.flags,[ID]:{...message.flags?.[ID],request:publicRequest(r,scene,data)}}},{diff:false,recursive:false});
}
async function persist(scene,data,r) { await save(scene,data); await publish(scene,data); if(r) await syncCard(scene,data,r); }

async function createRequest(scene,data,kind,user,args,parent=null) {
  need(Object.hasOwn(ACTIONS,kind),"Неизвестное действие партии.");
  checkParty(scene,data); ownsParty(user,scene,data);
  need(!active(data)||active(data)===parent||["done","rejected"].includes(active(data).status),"Сначала завершите текущую заявку партии.");
  const partyId=partyToken(scene).actor.id;
  need(!activeElsewhere(scene,partyId),"У этой партии есть незавершённая заявка на другой сцене.");
  const here=current(scene,data); need(here,"Установите токен группы внутри региона и назначьте текущий регион.");
  const roster=participants(scene,data);
  let actors=args.actors ?? roster.filter(a=>user.isGM||a.testUserPermission(user,"OWNER")).map(a=>a.id);
  need(Array.isArray(actors) && actors.length && new Set(actors).size===actors.length && actors.every(id=>memberIds(scene,data).includes(id)),"Выберите участников партии без повторений.");
  if(!user.isGM&&kind!=="search") need(actors.every(id=>game.actors.get(id).testUserPermission(user,"OWNER")),"Можно заявлять действия только своих персонажей.");
  if(["travel","local"].includes(kind)&&memberIds(scene,data).includes(state(scene).guideId))actors=[state(scene).guideId];
  if(["navigation","travel","local","teleport"].includes(kind)) actors=[actors[0]];
  const r={id:uid(),kind,partyId,status:"pending",createdBy:user.id,regionId:here.id,actors,outcomes:{},running:{},seconds:3600,pace:args.pace??"normal",penalty:0,step:0,elapsedSeconds:0,profile:partyProfile(scene,data)};
  if(data.offline?.enabled)r.offlineParticipants=roster;
  if(kind==="teleport") {
    const target=teleportTarget(scene,data,args.to,args.locationId,user),origin=tokenPoint(partyToken(scene));
    need(Math.hypot(target.x-origin.x,target.y-origin.y)>2,"Группа уже находится в этой точке.");
    Object.assign(r,{from:here.id,to:args.to,locationId:args.locationId??null,source:text(args.source??"","Источник телепортации",200).trim(),seconds:0,risk:false});
  } else if(kind==="local") {
    const target=localTarget(scene,data,args.locationId,user),origin=tokenPoint(partyToken(scene));
    need(Math.hypot(target.x-origin.x,target.y-origin.y)>2,"Группа уже находится в этой точке.");
    Object.assign(r,{locationId:args.locationId??null,seconds:null,risk:false,dc:here.navigationDC});
  } else if(kind==="travel") {
    const dest=region(data,args.to), edge=route(data,here.id,dest.id);
    need(edge,"Между регионами нет маршрута."); need(dest.center,"У региона назначения нет центра.");
    const paces=allowedPaces(dest,!!edge.road,r.profile),pace=paces.includes(r.pace)?r.pace:paces.at(-1);
    Object.assign(r,{from:here.id,to:dest.id,routeId:edge.id,baseSeconds:edge.seconds,miles:edge.miles,paces,pace,road:!!edge.road,effectivePace:pace,risk:edge.road?false:edge.risk,dc:dest.navigationDC});
    r.exitLabel=unknownExitLabels(state(scene)).get(dest.id)??null;
    r.seconds=journeySeconds(edge.seconds,pace,dest,r.road,r.profile,r.miles);
  } else if(kind==="short"||kind==="long") {
    r.seconds=CONFIG.DND5E.restTypes[kind].duration[game.settings.get("dnd5e","restVariant")]*60;
  } else if(kind==="navigation") { gmOnly(user); r.seconds=0; r.dc=here.navigationDC; }
  else r.dc=kind==="forage"?here.forageDC:here.searchDC;
  if(kind==="forage") for(const id of actors) need(!alreadyForaged(data,id,dayOf(game.time.worldTime)),`${participantName(r,id)} уже искал пропитание в эти сутки.`);
  if(parent){parent.resumeStatus=parent.status==="pending"?"pending":"approved";parent.status="suspended";parent.restId=r.id;r.resumeId=parent.id;}
  data.requests[r.id]=r; data.activeId=r.id;
  await save(scene,data);
  const message=await ChatMessage.create({content:card(r,scene,data),type:"request",system:{handler:kind==="short"||kind==="long"?"rest":"skill",targets:[],data:{},button:{label:"Pointcrawl"}},flags:{[ID]:{sceneId:scene.id,requestId:r.id}}});
  r.messageId=message.id;
  await persist(scene,data,r);
  return r.id;
}

async function approve(scene,data,r,args,user) {
  gmOnly(user); need(r.status==="pending","Эта заявка уже рассмотрена.");
  checkParty(scene,data); need(r.regionId===state(scene).currentRegionId,"Партия уже находится в другом регионе.");
  const actors=args.actors??r.actors;
  need(Array.isArray(actors)&&actors.length&&new Set(actors).size===actors.length&&actors.every(id=>memberIds(scene,data).includes(id)),"Недопустимый состав участников.");
  need(!["travel","local","teleport","navigation"].includes(r.kind)||actors.length===1,"Нужен один участник проверки.");
  if(r.kind==="local")localTarget(scene,data,r.locationId,user);
  r.actors=actors;
  if(r.kind==="teleport") {
    r.to=args.to??r.to;r.locationId=args.locationId===undefined?r.locationId:args.locationId;
    teleportTarget(scene,data,r.to,r.locationId,user);r.source=text(args.source??r.source??"","Источник телепортации",200).trim();r.seconds=0;r.risk=false;
  } else if(r.kind==="travel") {
    const edge=route(data,r.from,r.to);need(edge?.id===r.routeId,"Маршрут изменён или удалён: создайте новую заявку.");
    r.road=!!edge.road;r.pace=args.pace??r.pace;r.effectivePace=r.pace;r.risk=r.road?false:args.risk??r.risk;need(typeof r.risk==="boolean","Недопустимый риск маршрута.");
    r.baseSeconds=number(args.baseSeconds??r.baseSeconds,"Время маршрута",1);
    r.dc=number(args.dc??r.dc,"Сл. навигации",0,100,true);
    r.miles=args.manualTime?null:r.miles;r.seconds=journeySeconds(r.baseSeconds,r.pace,region(data,r.to),r.road,r.profile,r.miles);
  } else if(r.kind==="local") {
    r.baseSeconds=args.hours!=null||args.minutes!=null?durationSeconds(args.hours??0,args.minutes??0):number(args.seconds??r.baseSeconds??r.seconds,"Продолжительность",60,31536000);
    r.seconds=r.baseSeconds;r.risk=args.risk??r.risk;need(typeof r.risk==="boolean","Недопустимый риск перехода.");
    r.dc=number(args.dc??r.dc??current(scene,data).navigationDC,"Сл. навигации",0,100,true);
  } else if(r.kind!=="navigation") r.seconds=number(args.seconds??r.seconds,"Продолжительность",60,31536000);
  if(r.kind==="forage") for(const id of r.actors) need(!alreadyForaged(data,id,dayOf(game.time.worldTime)),"Кто-то из участников уже искал пропитание в эти сутки.");
  if(r.resumeId)need(memberIds(scene,data).every(id=>r.actors.includes(id)),"Для общего отдыха в пути утвердите всех участников партии.");
  if(["travel","local"].includes(r.kind)){need(typeof (args.march??false)==="boolean","Недопустимое разрешение марша.");r.march=args.march??false;if(r.march){r.marchRequested=false;r.restAtLimit=false;}}
  assignUsers(scene,r);
  r.status="approved";
  if(!r.offlineParticipants&&(r.kind==="short"||r.kind==="long")) await game.messages.get(r.messageId)?.update({"system.data":{type:r.kind,duration:r.seconds/60,advanceTime:false,advanceBastionTurn:false},"system.targets":r.actors.map(id=>({actor:game.actors.get(id).uuid}))});
  await persist(scene,data,r);
}

function matchingMessage(scene,r,actorId,lease,message) {
  if(!message || message.author?.id!==lease.userId) return false;
  if(r.kind==="short"||r.kind==="long") return message.type==="rest" && message.system?.request?.id===r.messageId && message.speaker.actor===actorId && message.system.type===r.kind;
  const flag=message.getFlag(ID,"roll");
  return flag?.requestId===r.id && flag?.lease===lease.id && flag?.actorId===actorId && message.speaker.actor===actorId && message.rolls?.length===1 && Number.isFinite(message.rolls[0].total);
}

async function resolve(scene,data,r,args,user) {
  const lease=r.running[args.actorId];
  if(r.outcomes[args.actorId]) {
    if(!lease)return;
    need(user.isGM||lease.userId===user.id,"Нет права завершить эту попытку.");
    await auxiliary(scene,data,r,args.actorId);r.running[args.actorId]=null;
    await persist(scene,data,r);return;
  }
  need(lease && (lease.userId===user.id || user.isGM),"Нет действующей попытки.");
  const message=game.messages.get(args.messageId);
  need(matchingMessage(scene,r,args.actorId,lease,message),"Результат не соответствует разрешённой попытке.");
  const actor=game.actors.get(args.actorId);
  if(r.kind==="short"||r.kind==="long") r.outcomes[actor.id]={label:"Отдых завершён",messageId:message.id};
  else {
    const total=message.rolls[0].total, success=total>=r.dc;
    const outcome={total,success,messageId:message.id,label:`${total} — ${success?"успех":"провал"}`};
    if(r.phase==="marchSave"&&actor.system.traits?.ci?.value?.has("exhaustion")){outcome.exempt=true;outcome.label+=" · иммунитет к истощению";}
    // Save the actual check first. Recovering auxiliary dice never rerolls the character's check.
    r.outcomes[actor.id]=outcome;
    if(r.kind==="forage") data.foraged[actor.id]=lease.day;
    await save(scene,data);
    await auxiliary(scene,data,r,actor.id);
  }
  r.running[args.actorId]=null;
  await persist(scene,data,r);
}

async function auxiliary(scene,data,r,actorId) {
  const out=r.outcomes[actorId]; if(!out || out.auxDone) return;
  const actor=game.actors.get(actorId);
  // An auxiliary Roll is persisted before publishing. A lost response can be replayed without a second draw.
  if(["travel","local"].includes(r.kind) && r.phase!=="marchSave"&&!out.success) {
    if(!out.penaltyRoll) { out.penaltyRoll=(await new Roll("1d6").evaluate()).toJSON(); await save(scene,data); }
    applyNavigationPenalty(data,r,out.penaltyRoll.total);
  }
  if(r.kind==="forage" && out.success) {
    if(!out.foodRoll) { out.foodRoll=(await new Roll(`1d6 + ${number(actor.system.abilities.wis.mod,"Модификатор Мудрости",-100,100)}`).evaluate()).toJSON(); await save(scene,data); }
    if(!out.waterRoll) { out.waterRoll=(await new Roll(`1d6 + ${actor.system.abilities.wis.mod}`).evaluate()).toJSON(); await save(scene,data); }
    setForageResult(out,out.foodRoll.total,out.waterRoll.total);
  }
  out.auxDone=true;
}

function applyNavigationPenalty(data,r,die) {
  r.penalty=die*10;
  r.seconds=r.kind==="local"?Math.ceil(r.baseSeconds*(1+r.penalty/100)):journeySeconds(r.baseSeconds,r.pace,region(data,r.to),r.road,r.profile,r.miles,r.penalty);
}

function setForageResult(out,food,water) {
  out.food=Math.max(0,food);out.water=Math.max(0,water);
  out.label=`${out.total} — еда: ${out.food} фунт.; вода: ${out.water} галл.`;
}

async function recordOffline(scene,data,r,args,user) {
  gmOnly(user);
  need(r.offlineParticipants&&data.activeId===r.id&&args.step===(r.step??0),"Офлайн-заявка или её этап изменились. Обновите окно.");
  const id=args.actorId;
  validateRequest(r,id,user,r.offlineParticipants.map(p=>p.id));
  need(needsParticipant(r),"Для безопасного перехода бросок не нужен.");
  const out={label:"Отдых подтверждён",auxDone:true};
  if(!["short","long"].includes(r.kind)) {
    out.total=number(args.total,"Итог броска",-100,1000,true);
    out.success=out.total>=r.dc;
    out.label=`${out.total} — ${out.success?"успех":"провал"}`;
    if(!out.success&&r.phase==="marchSave")out.label+=" · +1 степень истощения на листе персонажа";
    else if(!out.success&&["travel","local"].includes(r.kind)) {
      const die=number(args.penaltyDie,"Результат d6",1,6,true);
      applyNavigationPenalty(data,r,die);
      out.label+=` · d6: ${die}`;
    }
    if(r.kind==="forage") {
      const day=dayOf(game.time.worldTime);
      need(!alreadyForaged(data,id,day),"Этот участник уже искал пропитание в эти сутки.");
      if(out.success)setForageResult(out,number(args.food,"Еда, фунты",-100,1000,true),number(args.water,"Вода, галлоны",-100,1000,true));
      data.foraged[id]=day;
    }
  }
  r.outcomes[id]=out;
  await persist(scene,data,r);
}


async function restInJourney(scene,data,r,user) {
  const gm=game.users.get(game.users.activeGM?.id)??user;
  const id=await createRequest(scene,data,"long",gm,{actors:memberIds(scene,data)},r);
  await syncCard(scene,data,r);return id;
}
async function finish(scene,data,r,user,recover=false,skipTime=false,skipExhaustion=false,skipLedger=false) {
  gmOnly(user);need(r.status==="approved"||(recover&&r.status==="committing"),"Эта заявка не готова к завершению.");checkParty(scene,data);
  const moving=["travel","local"].includes(r.kind);
  if(r.commit&&!r.commit.type) {
    const c=r.commit,before=journey(scene,data),reset=r.kind==="long"&&memberIds(scene,data).every(id=>r.actors.includes(id));
    c.id=uid();c.type=moving?"leg":"action";c.delta=c.timeAfter-c.timeBefore;c.leg={seconds:c.delta,arrive:true};
    c.ledgerBefore=before;c.ledgerAfter={...before,revision:before.revision+1,seconds:reset?0:before.seconds+(moving?c.delta:0),lastOperation:c.id};c.ledgerChange=moving||reset;
    await save(scene,data);
  }
  if(!r.commit) {
    need(!Object.values(r.running).some(Boolean),"Есть незавершённая попытка участника.");
    need(!needsParticipant(r)||r.actors.every(id=>r.outcomes[id]),"Сначала дождитесь результатов всех участников.");
    for(const id of r.actors)await auxiliary(scene,data,r,id);
    if(r.kind==="travel"){need(state(scene).currentRegionId===r.from&&route(data,r.from,r.to)?.id===r.routeId,"Положение партии или маршрут изменились.");need(scene.regions.has(r.to),"Граница назначения удалена.");}
    if(r.kind==="local") {need(state(scene).currentRegionId===r.regionId,"Партия уже находится в другом регионе.");localTarget(scene,data,r.locationId,user);}
    if(r.kind==="teleport"){need(state(scene).currentRegionId===r.regionId,"Партия уже находится в другом регионе.");teleportTarget(scene,data,r.to,r.locationId,user);}
    const before=journey(scene,data),checks=moving&&r.phase==="marchSave";
    const leg=moving&&!checks?travelLeg(r.seconds,r.elapsedSeconds??0,before.seconds,!!r.march):{seconds:moving?0:r.seconds,arrive:true};
    const reset=r.kind==="long"&&memberIds(scene,data).every(id=>r.actors.includes(id));
    const id=uid(),after={...before,revision:before.revision+1,seconds:reset?0:before.seconds+(moving?leg.seconds:0),lastOperation:id};
    r.commit={id,type:checks?"checks":moving?"leg":"action",delta:leg.seconds,leg,ledgerBefore:before,ledgerAfter:after,ledgerChange:(moving&&leg.seconds>0)||reset,
      timeBefore:game.time.worldTime,timeAfter:game.time.worldTime+leg.seconds,timeDone:false,tokenDone:false};
    if(checks&&!r.offlineParticipants)r.commit.penalties=Object.fromEntries(r.actors.filter(id=>!r.outcomes[id].success&&!r.outcomes[id].exempt).map(id=>{const actor=game.actors.get(id);const value=Number(actor.system.attributes.exhaustion??0);return [id,{before:value,after:Math.min(value+1,CONFIG.DND5E.conditionTypes?.exhaustion?.levels??6)}];}));
    r.status="committing";await persist(scene,data,r);
  }
  const c=r.commit;
  if(!c.timeDone) {
    if(skipTime||game.time.worldTime===c.timeAfter)c.timeDone=true;
    else {need(game.time.worldTime===c.timeBefore,"Время мира изменилось после сбоя. Сверьте его и выберите «Время уже учтено».");if(c.delta)await game.time.advance(c.delta);c.timeDone=true;}
    await save(scene,data);
  }
  if(c.penalties&&!c.exhaustionDone) {
    if(!skipExhaustion)for(const [id,plan] of Object.entries(c.penalties)) {
      const actor=game.actors.get(id);need(actor,"Участник марша удалён.");
      if(actor.getFlag(ID,"marchPenalty")===c.id)continue;
      need(Number(actor.system.attributes.exhaustion??0)===plan.before,"Истощение изменилось после сбоя. Сверьте листы персонажей и подтвердите учёт истощения.");
      await actor.update({"system.attributes.exhaustion":plan.after,[`flags.${ID}.marchPenalty`]:c.id});
    }
    c.exhaustionDone=true;await save(scene,data);
  }
  if(c.ledgerChange&&!c.ledgerDone) {
    if(!skipLedger){const current=journey(scene,data);need(current.revision===c.ledgerBefore.revision||current.lastOperation===c.id,"Счётчик пути изменился после сбоя. Сверьте его и подтвердите, что путь уже учтён.");data.journeys??={};data.journeys[r.partyId??partyToken(scene).actor.id]=c.ledgerAfter;}
    c.ledgerDone=true;await save(scene,data);
  }
  const complete=!moving||(c.type==="checks"?(r.elapsedSeconds??0)>=r.seconds:c.leg.arrive&&!c.leg.save);
  if((complete&&["travel","local","teleport"].includes(r.kind))&&!c.tokenDone) {
    const dest=r.kind==="teleport"?teleportTarget(scene,data,r.to,r.locationId,user):r.kind==="local"?localTarget(scene,data,r.locationId,user):region(data,r.to).center,token=partyToken(scene);
    if(token.getFlag(ID,"arrival")!==r.id)await moveParty(scene,dest,{[`flags.${ID}.arrival`]:r.id},{mjlPointcrawlArrival:r.id,...(r.kind==="teleport"?{mjlPointcrawlTeleport:true}:{})});
    c.tokenDone=true;await save(scene,data);
  }
  if(moving) {
    r.elapsedSeconds=(r.elapsedSeconds??0)+c.delta;r.step=(r.step??0)+1;
    r.stages??=[];r.stages.push({id:c.id,type:c.type,seconds:c.delta,total:journey(scene,data).seconds,dc:r.phase==="marchSave"?r.dc:null,outcomes:clone(r.outcomes)});
    if(!r.navigationDone){r.navigation={actors:clone(r.actors),outcomes:clone(r.outcomes),dc:r.dc};r.navigationDone=true;}
    if(c.leg.save){r.phase="marchSave";r.dc=c.leg.save;r.actors=memberIds(scene,data);r.outcomes={};r.running={};assignUsers(scene,r);r.status="approved";}
    else if(!complete){r.phase="travel";r.status=c.type==="checks"||r.march?"approved":"camp";}
  }
  if(complete){r.dayFinal=journey(scene,data).seconds;if(["travel","teleport"].includes(r.kind))region(data,r.to).explored=true;r.status="done";data.activeId=null;}
  const camp=r.status==="camp"&&r.restAtLimit;
  r.error=null;r.commit=null;
  if(r.resumeId&&complete){const parent=requestById(data,r.resumeId);need(parent.status==="suspended","Исходный переход уже изменён.");parent.status=parent.resumeStatus??"approved";parent.march=false;parent.marchRequested=false;parent.restAtLimit=false;data.activeId=parent.id;}
  await save(scene,data);await publish(scene,data,complete&&["travel","teleport"].includes(r.kind)?{currentRegionId:r.to}:{});await syncCard(scene,data,r);
  if(r.resumeId&&complete)await syncCard(scene,data,data.requests[r.resumeId]);
  if(camp)await restInJourney(scene,data,r,user);
}

export async function processRequest(args,senderId) {
  const user=game.users.get(senderId); need(user?.active,"Отправитель не подключён.");
  need(game.users.activeGM?.isSelf,"Запрос должен исполняться активным мастером.");
  const scene=game.scenes.get(args.sceneId); need(scene,"Сцена не найдена.");
  if(args.action==="enable") {
    gmOnly(user);
    if(!journal(scene)) await createPrivate(scene,privateData(scene));
    const old=state(scene), enabled=!!args.enabled;
    if(enabled&&!old.enabled) await scene.update({tokenVision:false,[`flags.${ID}.state`]:{...old,enabled:true,savedTokenVision:scene.tokenVision}});
    if(!enabled&&old.enabled) {
      need(!active(privateData(scene)),"Завершите заявку перед отключением сцены.");
      await scene.update({...(scene.tokenVision===false?{tokenVision:old.savedTokenVision??true}:{}),[`flags.${ID}.state`]:{...old,enabled:false}});
    }
    await publish(scene,privateData(scene)); return;
  }
  checkScene(scene);
  const data=privateData(scene);
  if(args.action==="offlineSettings") {
    gmOnly(user);
    const partyId=partyToken(scene)?.actor?.id;
    need(!active(data)&&(!partyId||!activeElsewhere(scene,partyId)),"Завершите текущую заявку партии.");
    need(typeof args.enabled==="boolean","Выберите режим партии.");
    const names=text(args.names??"","Участники",3000).split(/\r?\n/).map(name=>name.trim()).filter(Boolean);
    const keys=names.map(name=>name.toLowerCase());
    need(names.length<=30&&names.every(name=>name.length<=80)&&new Set(keys).size===names.length,"Укажите до 30 участников с уникальными именами до 80 символов.");
    const previous=new Map((data.offline?.roster??[]).map(p=>[p.name.toLowerCase(),p.id]));
    data.offline={enabled:args.enabled,roster:names.map((name,i)=>({id:previous.get(keys[i])??uid(),name}))};
    await persist(scene,data);return;
  }
  if(args.action==="journeySettings") {
    gmOnly(user);checkParty(scene,data);need(!active(data),"Завершите текущую заявку.");
    need(!activeElsewhere(scene,partyToken(scene).actor.id),"У партии есть незавершённая заявка.");
    const old=journey(scene,data),seconds=args.hours==null?old.seconds:number(args.hours,"Часы в пути",0,10000,true)*3600+number(args.minutes??0,"Минуты",0,59,true)*60;
    data.journeys??={};data.journeys[partyToken(scene).actor.id]={...old,seconds,revision:old.revision+1,profile:args.profile?movementProfile(args.profile):old.profile,lastOperation:uid()};
    await persist(scene,data);return;
  }
  if(args.action==="syncJournals") {gmOnly(user);await publish(scene,data);return;}
  if(args.action==="notebook") {
    const r=region(data,args.regionId),l=args.locationId?r.locations.find(l=>l.id===args.locationId):null;
    need((!args.locationId||l)&&(user.isGM||r.explored&&(!l||l.revealed)),"Заметки недоступны.");
    await syncJournals(scene,data);return notebook(scene,r.id,l?.id)?.id;
  }
  if(args.action==="notes") {
    gmOnly(user);const r=region(data,args.regionId),subject=args.locationId?r.locations.find(l=>l.id===args.locationId):r;
    need(subject,"Локация не найдена.");subject.notes=text(args.notes,"Заметки мастера");await persist(scene,data);return;
  }
  if(args.action==="guide") {
    checkParty(scene,data);ownsParty(user,scene,data);need(!active(data),"Завершите текущую заявку перед сменой проводника.");
    const id=args.actorId??null;need(id===null||memberIds(scene,data).includes(id),"Проводник должен входить в состав партии.");
    await publish(scene,data,{guideId:id});return;
  }
  if(args.action==="region") {
    gmOnly(user); const doc=scene.regions.get(args.regionId); need(doc,"Сначала нарисуйте границу.");
    const old=data.regions[doc.id], {color,...values}=args.values??{};
    need(color===undefined||color===""||typeof color==="string"&&/^#[0-9a-f]{6}$/i.test(color),"Укажите цвет региона в формате #RRGGBB.");
    const terrain=values.terrain??old?.terrain??"forest"; need(TERRAIN[terrain],"Неизвестная местность.");
    const r={...(old??regionDraft(doc,terrain)),...values,terrain};
    r.id=doc.id; r.name=text(r.name,"Название",200).trim(); need(r.name,"Укажите название региона.");
    r.description=text(r.description,"Описание"); r.notes=text(r.notes,"Заметки мастера");
    for(const k of ["navigationDC","searchDC","forageDC"]) r[k]=number(r[k],k,0,100,true);
    need(PACE[r.maxPace],"Укажите максимальный темп.");
    r.detection=text(r.detection,"Дистанция обнаружения",100); r.equipped=!!r.equipped; r.explored=!!r.explored;r.showName=r.showName!==false;
    const fitted=fitRegion(scene,doc.shapes,doc.id,r);
    await doc.update({...(fitted.changed?{shapes:fitted.shapes}:{}),...(color?{color}:{}),name:r.explored?r.name:"Неизвестный регион",ownership:{default:0},[`flags.${ID}.region`]:true,[`flags.${ID}.draft`]:false});
    data.regions[doc.id]=r;
    await persist(scene,data); return;
  }
  if(args.action==="deleteRegion") {
    gmOnly(user); need(!active(data),"Завершите текущую заявку.");
    need(args.regionId!==state(scene).currentRegionId,"Сначала переставьте группу в другой регион.");
    await scene.regions.get(args.regionId)?.delete(); data.regions[args.regionId]=null;
    data.routes=data.routes.filter(r=>r.from!==args.regionId&&r.to!==args.regionId);
    await persist(scene,data); return;
  }
  if(args.action==="location") {
    gmOnly(user); const r=region(data,args.regionId); const value=args.values;
    const currentRequest=active(data),pending=currentRequest?.resumeId?data.requests[currentRequest.resumeId]:currentRequest;need(!pending||!["local","teleport"].includes(pending.kind)||(pending.kind==="teleport"?pending.to:pending.regionId)!==r.id,"Завершите заявку перемещения перед изменением локаций этого региона.");
    if(args.remove) r.locations=r.locations.filter(l=>l.id!==args.locationId);
    else {
      const i=r.locations.findIndex(x=>x.id===args.locationId);
      const color=value.color===undefined?r.locations[i]?.color??null:value.color===""?null:value.color;
      need(color===null||typeof color==="string"&&/^#[0-9a-f]{6}$/i.test(color),"Укажите цвет в формате #RRGGBB или оставьте поле пустым.");
      const l={id:args.locationId??uid(),name:text(value.name,"Название",200).trim(),description:text(value.description??"","Описание"),notes:text(value.notes??"","Секреты"),color:color?.toLowerCase()??null,
        x:number(value.x,"X",-1e7),y:number(value.y,"Y",-1e7),dc:value.dc===""||value.dc==null?null:number(value.dc,"Сл. поиска",0,100,true),revealed:!!value.revealed,showName:value.showName!==false};
      need(l.name,"Укажите название локации."); need(scene.regions.get(r.id).polygonTree.testPoint(l),"Локация должна находиться внутри региона.");
      if(i<0) r.locations.push(l); else r.locations[i]=l;
    }
    await persist(scene,data); return;
  }
  if(args.action==="route") {
    gmOnly(user); need(!active(data),"Завершите текущую заявку.");
    if(args.remove) data.routes=data.routes.filter(r=>r.id!==args.routeId);
    else {
      const from=region(data,args.from),to=region(data,args.to); need(from.id!==to.id&&from.center&&to.center,"Выберите два разных региона с центрами.");
      const existing=route(data,from.id,to.id),road=args.road??existing?.road??false;need(typeof road==="boolean","Недопустимый флаг дороги.");
      const miles=args.miles===undefined?existing?.miles??null:args.miles===""||args.miles===null?null:number(args.miles,"Расстояние, мили",.001,1e7);
      const r={id:existing?.id??uid(),from:from.id,to:to.id,seconds:number(args.seconds,"Время",1,31536000),miles,road,risk:road?false:!!args.risk};
      data.routes=data.routes.filter(x=>x.id!==r.id); data.routes.push(r);
    }
    await persist(scene,data); return;
  }
  if(args.action==="party") {
    gmOnly(user); need(!active(data),"Завершите текущую заявку.");
    const token=scene.tokens.get(args.tokenId); need(token?.actor?.type==="group","Выберите токен актёра «Группа».");
    const here=regionAt(scene,tokenPoint(token)); need(here&&data.regions[here.id]?.center,"Поместите токен в регион с центром.");
    for(const t of scene.tokens.filter(t=>t.id!==token.id&&t.getFlag(ID,"party"))) await t.setFlag(ID,"party",false);
    await token.setFlag(ID,"party",true); data.regions[here.id].explored=true; await save(scene,data);
    await publish(scene,data,{tokenId:token.id,currentRegionId:here.id,guideId:token.actor.system.playerCharacters.some(a=>a.id===state(scene).guideId)?state(scene).guideId:null}); return;
  }
  if(args.action==="unparty") {
    gmOnly(user);need(!active(data),"Завершите текущую заявку.");
    await publish(scene,data,{tokenId:null,currentRegionId:null,guideId:null});return;
  }
  if(args.action==="reposition") {
    gmOnly(user); need(!active(data),"Завершите текущую заявку.");
    const r=region(data,args.regionId), t=partyToken(scene); need(t&&r.center,"Нужны токен группы и центр региона.");
    await moveParty(scene,r.center,{}, {mjlPointcrawlReposition:true});
    r.explored=true; await save(scene,data); await publish(scene,data,{currentRegionId:r.id}); return;
  }
  if(args.action==="create") return createRequest(scene,data,args.kind,user,args);
  if(args.action==="table"||args.action==="event"||args.action==="publishEvent") {
    gmOnly(user);
    if(args.action==="publishEvent") {
      const e=data.events[args.eventId]; need(e,"Событие не найдено.");
      if(!e.published) { const existing=game.messages.find(m=>m.getFlag(ID,"eventPublished")===args.eventId); const m=existing??await ChatMessage.create({content:e.content,flags:{[ID]:{eventPublished:args.eventId}}}); e.published=m.id; await save(scene,data); } return;
    }
    const r=region(data,args.regionId);
    if(args.action==="event") {
      const table=game.tables.get(args.tableId); need(table&&r.tables.includes(table.id),"Таблица не привязана к региону.");
      const options={displayChat:false};
      if(data.offline?.enabled) {
        options.results=table.getResultsForRoll(number(args.total,"Итог броска по таблице",-1e9,1e9,true));
        need(options.results.length,"Для этого числа нет доступного результата таблицы.");
      }
      const roll=await table.draw(options); need(roll.results.length,"Таблица не выдала результат. Проверьте её диапазоны.");
      const id=uid();
      const content=`<div class="mjl-card"><h3>${esc(table.name)}</h3>${roll.results.map(x=>x.description??x.text??"").join("<hr>")}</div>`;
      data.events[id]={content,published:null}; await save(scene,data);
      await ChatMessage.create({content:`${content}<button type="button" data-mjl-event="${id}" data-scene="${scene.id}">Опубликовать игрокам</button>`,whisper:game.users.filter(u=>u.isGM).map(u=>u.id)}); return id;
    }
    if(args.remove) r.tables=r.tables.filter(id=>id!==args.tableId);
    else if(args.json!=null) {
      const parsed=eventTable(args.json);
      const table=await RollTable.create({name:parsed.name,description:`<p>${esc(parsed.description)}</p>`,formula:parsed.formula,replacement:true,displayRoll:true,ownership:{default:0},
        results:parsed.results.map(x=>({type:CONST.TABLE_RESULT_TYPES.TEXT,weight:x.weight,range:x.range,description:`<h3>${esc(x.title)}</h3><p>${esc(x.text).replaceAll("\n","<br>")}</p>`}))});
      r.tables.push(table.id);
    } else { need(game.tables.has(args.tableId),"Перетащите таблицу из мира. Таблицу компендиума сначала импортируйте."); if(!r.tables.includes(args.tableId)) r.tables.push(args.tableId); }
    await persist(scene,data); return;
  }
  const r=requestById(data,args.requestId??data.activeId);
  if(args.action==="recordOffline")return recordOffline(scene,data,r,args,user);
  if(args.action==="approve") return approve(scene,data,r,args,user);
  if(args.action==="reject") {
    gmOnly(user); need(["pending","approved","camp"].includes(r.status)&&r.phase!=="marchSave"&&!Object.values(r.running).some(Boolean)&&(!Object.keys(r.outcomes).length||r.navigationDone),"Уже начатое действие нужно завершить; его результаты не отменяются.");
    r.status="rejected";data.activeId=null;
    if(r.resumeId){const parent=requestById(data,r.resumeId);parent.status=parent.resumeStatus==="pending"?"pending":parent.march?"approved":"camp";data.activeId=parent.id;await syncCard(scene,data,parent);}
    return persist(scene,data,r);
  }
  if(args.action==="journeyChoice") {
    ownsParty(user,scene,data);need(data.activeId===r.id&&["travel","local"].includes(r.kind)&&["pending","approved","camp"].includes(r.status)&&r.phase!=="marchSave","Сейчас нельзя менять решение о продолжении пути.");
    need(!Object.values(r.running).some(Boolean),"Сначала завершите открытый бросок.");
    if(args.choice==="rest") {
      if(journey(scene,data).seconds>=TRAVEL_LIMIT)return restInJourney(scene,data,r,user);
      r.restAtLimit=true;r.march=false;r.marchRequested=false;
    } else {need(args.choice==="march","Выберите отдых или марш.");r.marchRequested=true;r.restAtLimit=false;}
    await persist(scene,data,r);return;
  }
  if(args.action==="allowMarch") {
    gmOnly(user);need(data.activeId===r.id&&r.marchRequested&&["approved","camp"].includes(r.status),"Нет заявки на марш.");r.march=true;r.marchRequested=false;r.status="approved";await persist(scene,data,r);return;
  }
  if(args.action==="reserve") {
    need(!r.offlineParticipants,"Мастер вводит результат броска вручную.");
    const actor=game.actors.get(args.actorId);
    validateRequest(r,args.actorId,{isGM:user.isGM,owns:actor?.testUserPermission(user,"OWNER")},memberIds(scene,data));
    need(user.isGM||!r.assignedUsers?.[args.actorId]||r.assignedUsers[args.actorId]===user.id,"Проверка назначена другому игроку. Обратитесь к мастеру.");
    need(needsParticipant(r),"Для безопасного перехода бросок не нужен.");
    const day=dayOf(game.time.worldTime);
    if(r.kind==="forage") need(!alreadyForaged(data,actor.id,day),"Этот персонаж уже искал пропитание в эти сутки.");
    const lease={id:uid(),userId:user.id,day}; r.running[actor.id]=lease; await persist(scene,data,r);
    return {lease:lease.id,kind:r.phase==="marchSave"?"march":r.kind,dc:r.dc,pace:r.pace,seconds:r.seconds,messageId:r.messageId};
  }
  if(args.action==="cancelRoll") {
    const lease=r.running[args.actorId]; need(lease?.id===args.lease&&lease.userId===user.id,"Нет такой попытки.");
    const existing=game.messages.find(m=>matchingMessage(scene,r,args.actorId,lease,m));
    if(existing) return resolve(scene,data,r,{...args,messageId:existing.id},user);
    r.running[args.actorId]=null; return persist(scene,data,r);
  }
  if(args.action==="resolve") return resolve(scene,data,r,args,user);
  if(args.action==="recoverRoll") {
    gmOnly(user); const lease=r.running[args.actorId]; need(lease,"Нет прерванной попытки.");
    const existing=game.messages.find(m=>matchingMessage(scene,r,args.actorId,lease,m));
    if(existing) return resolve(scene,data,r,{...args,messageId:existing.id},user);
    need(args.decision==="retry"||args.decision==="done","Результат не найден. Проверьте состояние персонажа и выберите решение вручную.");
    if(args.decision==="done") {
      need(["short","long"].includes(r.kind),"Для проверки нужен настоящий результат броска.");
      r.outcomes[args.actorId]={label:"Отдых подтверждён мастером после сбоя"};
    }
    r.running[args.actorId]=null; return persist(scene,data,r);
  }
  if(args.action==="reveal") {
    gmOnly(user); need(r.kind==="search"&&r.status==="approved","Это не активный поиск.");
    const l=region(data,r.regionId).locations.find(l=>l.id===args.locationId),out=Object.values(r.outcomes).filter(o=>Number.isFinite(o.total)).sort((a,b)=>b.total-a.total)[0];
    need(l&&out&&!r.revealedId&&out.total>=(l.dc??region(data,r.regionId).searchDC),"Эта локация не найдена проверкой.");
    l.revealed=true; r.revealedId=l.id; out.label+=` · найдено: ${l.name}`; return persist(scene,data,r);
  }
  if(args.action==="finish"||args.action==="recover") {
    if(args.action==="finish"&&r.status==="approved"&&["travel","local"].includes(r.kind)&&(r.step??0)>0)need(args.step===r.step,"Этот этап уже обработан. Обновите окно заявки.");
    try { return await finish(scene,data,r,user,args.action==="recover",!!args.skipTime,!!args.skipExhaustion,!!args.skipLedger); }
    catch(error) { if(r.status==="committing") {r.error=error.message; await persist(scene,data,r);} throw error; }
  }
  throw Error("Неизвестное действие Pointcrawl.");
}

export function connectSocket() {
  if(socket) return;
  socket=socketlib.registerModule(ID);
  socket.register("request",function(args) {
    const sender=this.socketdata.userId;
    // ponytail: one GM queue; split per scene only if many concurrent parties require it.
    const run=queue.then(async()=>{try{await initializePrivate(true);return {ok:true,value:await processRequest(args,sender)};}catch(e){console.error(ID,e);return {ok:false,error:e.message};}});
    queue=run.catch(()=>{}); return run;
  });
}
export async function request(action,values={},scene=canvas.scene) {
  need(socket,"Socketlib ещё не готов. Перезагрузите страницу.");
  const gm=game.users.activeGM; need(gm,"Нужен подключённый мастер."); need(scene,"Откройте сцену путешествий.");
  const result=await socket.executeAsUser("request",gm.id,{...values,action,sceneId:scene.id});
  need(result?.ok,result?.error??"Запрос не подтверждён. Проверьте его состояние перед повтором."); return result.value;
}
export async function perform(scene,requestId,actorId) {
  const permit=await request("reserve",{requestId,actorId},scene);
  const actor=game.actors.get(actorId);
  let result;
  try {
    if(permit.kind==="short"||permit.kind==="long") {
      result=await actor[`${permit.kind}Rest`]({request:game.messages.get(permit.messageId),duration:permit.seconds/60,advanceTime:false,advanceBastionTurn:false,chat:true});
      result=result?.message;
    } else {
      const config=permit.kind==="march"?{ability:"con",target:permit.dc}:{skill:permit.kind==="search"?"prc":"sur",ability:"wis",target:permit.dc,pace:permit.kind==="travel"?permit.pace:undefined};
      const rolls=await actor[permit.kind==="march"?"rollSavingThrow":"rollSkill"](config,{},{data:{speaker:ChatMessage.getSpeaker({actor}),flags:{[ID]:{roll:{requestId,actorId,lease:permit.lease}}}}});
      result=rolls?.[0]?.parent;
    }
  } catch(error) {
    // A rest may have changed HP before an exception. Leave the lease for explicit GM recovery.
    ui.notifications.error(`Pointcrawl: ${error.message}. Мастер может восстановить попытку в центре путешествий.`); throw error;
  }
  if(!result) return request("cancelRoll",{requestId,actorId,lease:permit.lease},scene);
  return request("resolve",{requestId,actorId,lease:permit.lease,messageId:result.id},scene);
}
