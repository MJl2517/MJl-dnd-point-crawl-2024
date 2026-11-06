import {ID, PACE, TERRAIN, ACTIONS, STATUS, TRAVEL_LIMIT, movementProfile, allowedPaces, journeySeconds, durationSeconds, esc, eventTable, secondsLabel, need} from "./rules.mjs";
import {state, privateData, notesFor, regionDraft, partyToken, partyProfile, members, needsParticipant, request, perform} from "./store.mjs";
import {isBoundary} from "./geometry.mjs";
import {notebook,showNotebook} from "./journals.mjs";

const {ApplicationV2,DialogV2}=foundry.applications.api;
const options=(entries,value)=>Object.entries(entries).map(([key,label])=>`<option value="${esc(key)}" ${key===value?"selected":""}>${esc(typeof label==="object"?label.name:label)}</option>`).join("");
const button=(action,label,attrs="")=>`<button type="button" data-pc-action="${action}" ${attrs}>${label}</button>`;
const field=(label,name,value,type="text",attrs="")=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
const area=(label,name,value)=>`<label>${label}<textarea name="${name}" rows="4">${esc(value)}</textarea></label>`;
const checked=v=>v?"checked":"";
const fdata=form=>Object.fromEntries(new FormData(form));
function timePreview(form,calculate) {
  const output=form.querySelector('[data-time-preview]');
  const update=()=>{try{output.textContent=calculate(form);}catch(e){output.textContent=e.message;}};
  form.addEventListener('input',update);form.addEventListener('change',update);update();
}
export async function prompt(title,content,read,ok="Сохранить",render) {
  return DialogV2.prompt({classes:["mjl-dialog"],window:{title},position:{width:500},content:`<div class="mjl-dialog-fields">${content}</div>`,rejectClose:false,render,ok:{label:ok,callback:(_event,b)=>read(b.form)}});
}
function teleportOptions(scene,to,locationId) {
  const regions=game.user.isGM?Object.values(privateData(scene).regions):state(scene).regions.filter(r=>r.explored);
  return regions.filter(r=>r?.center).map(r=>`<optgroup label="${esc(r.name)}">${options(Object.fromEntries([[`${r.id}:`,"Центр региона"],...(r.locations??[]).filter(l=>game.user.isGM||l.revealed!==false).map(l=>[`${r.id}:${l.id}`,l.name])]),`${to}:${locationId??""}`)}</optgroup>`).join("");
}
const teleportHint='<p class="mjl-muted">Используйте заклинание или предмет штатно в dnd5e. Мастер подтверждает фактическое место прибытия; ресурсы предмета здесь не списываются.</p>';
export async function confirm(title,content) { return DialogV2.confirm({classes:["mjl-dialog"],window:{title},content,rejectClose:false,yes:{label:"Подтвердить"},no:{label:"Отмена"}}); }
export class PointcrawlApp extends ApplicationV2 {
  static instance;
  static DEFAULT_OPTIONS={id:`${ID}-manager`,classes:["mjl-app"],window:{title:"Pointcrawl · Менеджер мастера",icon:"fa-solid fa-route",resizable:true},position:{width:900,height:"auto"}};
  tab="regions"; regionId=""; regionSearch=""; requestId=""; pace="normal"; busy=false; dirty=false; importParsed=null; sections=new Map();
  get scene() {return this.sceneId?game.scenes.get(this.sceneId):canvas.scene;}
  get manager() {return this.constructor===PointcrawlApp;}
  static open({regionId,requestId,tab}={}) {
    if(this===PointcrawlApp&&!game.user.isGM)return TravelCentre.open({regionId});
    if(requestId)return RequestWindow.open({sceneId:canvas.scene?.id,requestId});
    const app=this.instance??=new this();
    if((tab&&tab!==app.tab)||(regionId&&regionId!==app.regionId))app.resetScroll=true;
    if(tab)app.tab=tab;
    if(requestId===null)app.requestId="";
    if(regionId) {app.regionId=regionId;app.tab="regions";}
    app.dirty=false; app.render({force:true}); return app;
  }
  async _renderHTML() {
    const scene=this.scene;
    if(!scene) return '<p class="mjl-empty">Откройте сцену карты путешествий.</p>';
    if(this.manager&&!game.user.isGM)return '<p class="mjl-empty">Менеджер доступен только мастеру.</p>';
    const tabs=this.manager?{regions:"Регионы",routes:"Маршруты",tables:"События",party:"Партия и заявки"}:{travel:"Путешествие",regions:"Регионы"};
    if(!tabs[this.tab])this.tab=Object.keys(tabs)[0];
    return this.frame(scene,this.tab==="travel"?this.travel(scene):this.tab==="regions"?this.regions(scene):this.tab==="routes"?this.routes(scene):this.tab==="party"?this.party(scene):this.tables(scene),tabs);
  }
  frame(scene,body,tabs={}) {
    const s=state(scene),gm=this.manager&&game.user.isGM;
    return `<div class="mjl-shell">
      ${Object.keys(tabs).length?`<nav class="mjl-tabs">${Object.entries(tabs).map(([id,name])=>button("tab",name,`data-tab="${id}" class="${this.tab===id?"active":""}"`)).join("")}</nav>`:""}
      <main class="mjl-main">${!game.users.activeGM?'<p class="mjl-error">Мастер не подключён. Заявки временно недоступны.</p>':""}
      ${!s.enabled?`<div class="mjl-empty"><p>${gm?"Включите режим путешествий, затем добавьте регионы и назначьте группу.":"Мастер ещё не настроил карту путешествий."}</p>${gm?button("enable","Включить для этой сцены",'class="mjl-primary"'):""}</div>`:body}</main>
      <footer class="mjl-footer"><span role="status">${this.busy?"Обработка…":this.dirty?"Есть несохранённые изменения":""}</span></footer></div>`;
  }
  fold(id,title,content,open=false) {
    const key=`${this.tab}:${this.regionId}:${id}`;
    return `<details class="mjl-fold" data-pc-section="${key}" ${(this.sections.get(key)??open)?"open":""}><summary>${title}</summary><div class="mjl-fold-content">${content}</div></details>`;
  }
  _replaceHTML(result,content) {
    const scroll=this.resetScroll?0:content.querySelector(".mjl-main")?.scrollTop??0;
    content.innerHTML=result;const main=content.querySelector(".mjl-main");if(main)main.scrollTop=scroll;this.resetScroll=false;
  }
  _onRender(context,options) {
    super._onRender(context,options);
    const root=this.element.querySelector(".mjl-shell"); if(!root)return;
    root.addEventListener("click",event=>{
      const b=event.target.closest("[data-pc-action]");
      if(b) {event.preventDefault();this.run(()=>this.action(b.dataset.pcAction,b),b.dataset.pcAction!=="previewImport");}
    });
    root.addEventListener("submit",event=>{event.preventDefault(); this.run(()=>this.submit(event.target));});
    root.addEventListener("change",event=>{if(event.target.name==="pace"&&!event.target.closest("[data-form=approve]"))this.pace=event.target.value;});
    const search=root.querySelector('[name=regionSearch]');
    if(search){search.addEventListener('input',()=>{this.regionSearch=search.value;this.filterRegions();});this.filterRegions();}
    const approval=root.querySelector('[data-form=approve]');
    if(approval?.querySelector('[data-time-preview]'))timePreview(approval,f=>{
      const r=privateData(this.scene).requests[f.dataset.id],region=privateData(this.scene).regions[r.to??r.regionId];
      if(r.kind==='local'&&!Number(f.elements.hours.value)&&!Number(f.elements.minutes.value))return 'Укажите часы и минуты перехода для расчёта.';
      const seconds=r.kind==='local'?durationSeconds(f.elements.hours.value,f.elements.minutes.value):journeySeconds(Number(f.elements.baseHours.value)*3600,f.elements.pace.value,region,r.road,r.profile,f.elements.manualTime?.checked?null:r.miles);
      const total=(state(this.scene).journey?.seconds??0)+seconds;
      return `Итого: ${secondsLabel(seconds)}. ${r.kind==='local'?'Время внутри региона задаётся мастером окончательно.':`${TERRAIN[region.terrain]?.name??region.name}; ${PACE[f.elements.pace.value].name.toLowerCase()} темп${r.road?', дорога':''}.`} В пути после отдыха: ${secondsLabel(total)} / 8 ч.${total>TRAVEL_LIMIT?' Потребуется отдых или марш.':''}${f.elements.risk.checked?' При провале навигации: ещё 10–60% времени.':''}`;
    });
    root.addEventListener("toggle",event=>{if(event.target.dataset.pcSection)this.sections.set(event.target.dataset.pcSection,event.target.open);},true);
    root.addEventListener("invalid",event=>{for(let el=event.target.parentElement;el&&el!==root;el=el.parentElement)if(el.tagName==="DETAILS")el.open=true;},true);
    root.addEventListener("input",event=>{if(event.target.closest("[data-form=region], [data-form=approve], [data-form=guide], [data-form=notes], [data-form=journey]")){this.dirty=true;this.element.querySelector(".mjl-footer [role=status]").textContent="Есть несохранённые изменения";}if(event.target.name==="json"){this.dirty=true;this.importParsed=null;this.element.querySelector("[data-pc-action=importTable]").disabled=true;}});
    this.element.querySelector("[name=terrain]")?.addEventListener("change",event=>{
      const form=event.target.form,preset=TERRAIN[event.target.value];
      for(const key of ["maxPace","detection","navigationDC","searchDC","forageDC"]) form.elements[key].value=preset[key];
      this.dirty=true;
    });
    const movement=this.element.querySelector('[data-form="journey"]');
    if(movement){const update=()=>{const mode=movement.elements.mode.value;for(const [name,visible] of Object.entries({speed:mode==="special",mph:mode==="vehicle",ignoreTerrain:mode==="special",slower:mode==="walk"})){movement.elements[name].closest("label").hidden=!visible;movement.elements[name].disabled=!visible;}movement.querySelector("p").hidden=mode==="walk";};movement.elements.mode.addEventListener("change",update);update();}
    const drop=this.element.querySelector(".mjl-table-drop");
    drop?.addEventListener("dragover",e=>e.preventDefault());
    drop?.addEventListener("drop",e=>{e.preventDefault();this.run(async()=>{
      const data=foundry.applications.ux.TextEditor.implementation.getDragEventData(e);
      need(data.type==="RollTable"&&data.uuid&&!data.uuid.startsWith("Compendium."),"Перетащите RollTable из мира. Таблицу компендиума сначала импортируйте.");
      const table=await fromUuid(data.uuid); need(table?.documentName==="RollTable","Это не таблица.");
      await request("table",{regionId:this.regionId,tableId:table.id});
    });});
    this.element.querySelector("[name=jsonFile]")?.addEventListener("change",e=>this.run(async()=>{
      const file=e.target.files[0];if(!file)return;need(file.size<=2e6,"Размер JSON не должен превышать 2 МБ.");
      this.element.querySelector("[name=json]").value=await file.text(); this.dirty=true;this.previewImport();
    },false));
  }
  async run(fn,redraw=true) {
    if(this.busy)return;
    this.busy=true;let failed=false;
    try {await fn();}
    catch(e) {failed=true;ui.notifications.error(`Pointcrawl: ${e.message}`);console.error(ID,e);}
    finally {this.busy=false;if(redraw&&!(failed&&this.dirty)){this.dirty=false;if(this.rendered)this.render();}}
  }
  noteButton(regionId,locationId) {
    return button("notes","Заметки",`data-region="${regionId}" ${locationId?`data-location="${locationId}"`:""}`);
  }
  journeySettings(scene) {
    const day=state(scene).journey??{seconds:0},p=day.profile??movementProfile();
    return `<form data-form="journey"><fieldset ${state(scene).active?"disabled":""}><label>Передвижение<select name="mode">${options({walk:"Пешком",special:"Особое перемещение",vehicle:"Транспорт"},p.mode)}</select></label><div class="mjl-form-grid">${field("Особая скорость, футы","speed",p.speed,"number",'min="1" max="10000" step="any"')}${field("Скорость транспорта, миль/ч","mph",p.mph,"number",'min="0.01" max="10000" step="any"')}</div><label class="mjl-check"><input type="checkbox" name="ignoreTerrain" ${checked(p.ignoreTerrain)}>Полёт / игнорирует труднопроходимую местность</label><label class="mjl-check"><input type="checkbox" name="slower" ${checked(p.slower)}>Есть пеший участник со скоростью не выше половины обычной</label><p class="mjl-muted">Особое перемещение: миль/ч = скорость ÷ 10. За 8 часов при особой скорости: ${Math.floor(p.speed/10*8*2/3)} / ${Math.floor(p.speed/10*8)} / ${Math.floor(p.speed/10*8*4/3)} миль (медленно / нормально / быстро). Укажите мили маршрута для расчёта; иначе время задаётся вручную. Транспорт использует свою скорость без выбора темпа.</p><h4>Счётчик пути после общего долгого отдыха</h4><div class="mjl-form-grid">${field("Часы","hours",Math.floor(day.seconds/3600),"number",'min="0" max="10000" step="1"')}${field("Минуты","minutes",Math.floor(day.seconds%3600/60),"number",'min="0" max="59" step="1"')}</div><div class="mjl-actions"><button type="submit" ${state(scene).active?"disabled":""}>Сохранить</button></div></fieldset></form>`;
  }
  travel(scene) {
    const s=state(scene),pcs=members(scene),here=s.regions.find(r=>r.id===s.currentRegionId);
    const actors=pcs.filter(a=>game.user.isGM||a.isOwner),disabled=!actors.length||s.active?"disabled":"";
    const locations=game.user.isGM?(privateData(scene).regions[here?.id]?.locations??here?.locations??[]):here?.locations??[];
    const routeRows=s.routes.filter(r=>r.from===s.currentRegionId||r.to===s.currentRegionId).map(r=>{
      const to=r.from===s.currentRegionId?r.to:r.from,dest=s.regions.find(x=>x.id===to);
      return `<div class="mjl-row"><div><strong>${esc(dest?.explored?dest.name:"Неизвестный регион")}</strong><small>${secondsLabel(r.normalSeconds??r.seconds)} · ${s.journey?.profile?.mode==="vehicle"?"транспорт":`${PACE[r.normalPace??"normal"].name.toLowerCase()} темп`}${r.road?", дорога":""}</small></div><div class="mjl-row-actions">${game.user.isGM||dest?.explored?this.noteButton(to):""}${button("travel","В путь",`data-to="${to}" ${disabled} class="mjl-primary"`)}</div></div>`;
    }).join("");
    const actorCheck=actors.map(a=>`<label class="mjl-check"><input type="checkbox" name="actor" value="${a.id}" checked>${esc(a.name)}</label>`).join("");
    const canChooseGuide=actors.length||partyToken(scene)?.isOwner,guideId=pcs.some(a=>a.id===s.guideId)?s.guideId:"";
    const guide=`<form data-form="guide" class="mjl-guide"><label>Проводник по умолчанию<select name="guide" ${!canChooseGuide||s.active?"disabled":""}>${options({"":"Выбирать в заявке",...Object.fromEntries(pcs.map(a=>[a.id,a.name]))},guideId)}</select></label><button type="submit" ${!canChooseGuide||s.active?"disabled":""}>Назначить</button></form>`;
    const locationRows=locations.map(l=>`<div class="mjl-row"><div><strong>${esc(l.name)}</strong>${game.user.isGM&&!l.revealed?'<small>Скрыта от игроков</small>':""}</div><div class="mjl-row-actions">${this.noteButton(here.id,l.id)}${button("local","В путь",`data-id="${l.id}" ${disabled} class="mjl-primary"`)}</div></div>`).join("");
    return `<div class="mjl-two"><section><article class="mjl-panel"><div class="mjl-section-heading"><h3>Текущий регион</h3>${here&&(game.user.isGM||here.explored)?this.noteButton(here.id):""}</div><h2>${esc(here?(here.name??"Неизвестный регион"):"Группа не назначена")}</h2>${!here?'<p class="mjl-muted">Мастер должен назначить токен группы внутри региона.</p>':""}
      <div class="mjl-party">${pcs.map(a=>`<span class="mjl-chip"><img src="${esc(a.img)}" alt="">${esc(a.name)}</span>`).join("")}</div>${guide}<p data-journey-status>В пути: <strong>${secondsLabel(s.journey?.seconds??0)} / 8 ч</strong></p>${(s.journey?.seconds??0)>=TRAVEL_LIMIT?'<p class="mjl-error">Предел обычного перехода достигнут. Следующая заявка потребует отдыха или марша.</p>':""}${game.user.isGM&&partyToken(scene)?this.fold("journey","Передвижение и счётчик",this.journeySettings(scene)):""}</article>
      <article class="mjl-panel"><h3>Действия партии</h3><div class="mjl-actors">${actorCheck||"Нет доступных персонажей"}</div><label>Темп<select name="pace" ${s.journey?.profile?.mode==="vehicle"?"disabled":""}>${options(PACE,this.pace)}</select></label><div class="mjl-grid-buttons">${["short","long","search","forage"].map(k=>button("activity",ACTIONS[k],`data-kind="${k}" ${disabled}`)).join("")}${button("teleport","Телепортация",`${disabled} class="mjl-wide"`)}</div><small>Поиск и сбор — по часу после одобрения мастера. Пропитание — раз в сутки на героя.</small></article></section>
      <section><article class="mjl-panel"><h3>Доступные выходы</h3><section class="mjl-exits-group" data-exits="locations"><h4>Локации внутри региона</h4>${locationRows||'<p class="mjl-muted">Нет открытых локаций.</p>'}${here?`<div class="mjl-row"><strong>Центр региона</strong>${button("local","Вернуться",`${disabled} title="Вернуться к центру региона"`)}</div>`:""}</section><section class="mjl-exits-group" data-exits="regions"><h4>Соседние регионы</h4>${routeRows||'<p class="mjl-muted">Нет маршрутов из текущего региона.</p>'}</section></article>${s.active?`<article class="mjl-panel"><h3>Текущая заявка</h3>${this.requestSummary(s.active)}</article>`:""}</section></div>`;
  }
  requestSummary(r) {
    return `<p>${ACTIONS[r.kind]} · ${STATUS[r.status]}</p><p>${r.seconds==null?"Время назначит мастер":secondsLabel(r.seconds)}</p>${button("request","Открыть отдельное окно",`data-id="${r.id}"`)}`;
  }
  party(scene) {
    const s=state(scene),token=partyToken(scene),d=privateData(scene);
    return `<article class="mjl-panel"><h3>Настройка партии</h3><div class="mjl-guide"><label>Токен группы<select name="party">${scene.tokens.filter(t=>t.actor?.type==="group").map(t=>`<option value="${t.id}" ${token?.id===t.id?"selected":""}>${esc(t.name)}</option>`).join("")}</select></label>${button("party","Назначить")}</div><p>${members(scene).map(a=>esc(a.name)).join(", ")||"Партия не назначена"}</p>${button("centre","Открыть центр путешествий")}</article><article class="mjl-panel"><h3>Навигация вручную</h3><div class="mjl-actors">${members(scene).map((a,i)=>`<label class="mjl-check"><input type="radio" name="actor" value="${a.id}" ${i===0?"checked":""}>${esc(a.name)}</label>`).join("")}</div>${button("activity","Запросить проверку текущего региона",`data-kind="navigation" ${!members(scene).length||s.active?"disabled":""}`)}</article><article class="mjl-panel"><h3>Текущая заявка</h3>${s.active?this.requestSummary(s.active):"Нет активной заявки"}</article><article class="mjl-panel"><h3>Последние заявки</h3>${Object.values(d.requests).slice(-12).reverse().map(r=>`<div class="mjl-row"><span>${ACTIONS[r.kind]} · ${STATUS[r.status]}</span>${button("request","Открыть",`data-id="${r.id}"`)}</div>`).join("")}</article>${this.fold("scene","Параметры сцены",button("disable","Отключить режим сцены",'class="mjl-danger"'))}`;
  }
  requestPanel(scene,value,data) {
    const gm=game.user.isGM,r=data?.requests[value.id]??value;
    const actors=(r.actors??[]).map(a=>typeof a==="string"?{id:a,name:game.actors.get(a)?.name??"Удалён"}:a);
    const p=state(scene).active?.id===r.id?state(scene).active:null;
    const destId=r.kind==="teleport"?r.to:r.regionId;
    const destination=["local","teleport"].includes(r.kind)?(data?(r.locationId?data.regions[destId]?.locations.find(l=>l.id===r.locationId)?.name??"Удалённая локация":`Центр: ${data.regions[destId]?.name}`):r.destination):r.to?(data?.regions[r.to]?.name??p?.destination??r.destination):null;
    const facts=[["Назначение",destination],["Передвижение",r.profile?.mode==="special"?`Особое: ${r.profile.speed} футов`:r.profile?.mode==="vehicle"?`Транспорт: ${r.profile.mph} миль/ч`:null],["Ограничение",r.profile?.slower&&r.profile.mode==="walk"?"Замедленный участник — только медленный темп":null],["Регион",data?.regions[r.regionId]?.name??r.origin],["Время",r.seconds!=null?secondsLabel(r.seconds):null],["Темп",r.kind==="travel"?`${PACE[r.effectivePace??r.pace]?.name}${r.road?" (есть дорога)":""}`:null],["Источник",r.kind==="teleport"?r.source||"Укажет мастер":null],["Потеря пути",r.penalty?`+${r.penalty}%`:null]].filter(([,v])=>v!=null);
    let html=`<p class="mjl-request-status">${STATUS[r.status]}</p><dl class="mjl-facts">${facts.map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
    const moving=["travel","local"].includes(r.kind),day=r.daySeconds??state(scene).journey?.seconds??0,remaining=Math.max(0,(r.seconds??0)-(r.elapsedSeconds??0));
    if(moving)html+=`<p>В пути после долгого отдыха: <strong>${secondsLabel(day)} / 8 ч</strong>. Осталось по заявке: ${r.seconds==null?"время назначит мастер":secondsLabel(remaining)}.</p>${r.elapsedSeconds?`<p class="mjl-muted">Уже пройдено в этом переходе: ${secondsLabel(r.elapsedSeconds)}. Токен прибудет в конечную точку после завершения всего этапа.</p>`:""}`;
    if(moving&&r.phase!=="marchSave"&&["pending","approved","camp"].includes(r.status)&&(day>=TRAVEL_LIMIT||day+remaining>TRAVEL_LIMIT))html+=`<section class="mjl-roll-info"><h3>${day>=TRAVEL_LIMIT?"Группа уже прошла 8 часов":"Этот переход превысит 8 часов пути"}</h3><p>${day>=TRAVEL_LIMIT?"Для продолжения выберите долгий отдых или марш.":"На 8-м часу переход остановится. Можно заранее заявить отдых в пути или попросить разрешение на марш."}</p>${r.restAtLimit?'<p>Запланирован долгий отдых на 8-м часу.</p>':""}${r.march?'<p>Марш разрешён мастером.</p>':r.marchRequested?'<p>Запрошен марш — ожидается решение мастера.</p>':""}<div class="mjl-grid-buttons">${button("journeyRest","Долгий отдых в пути",`data-id="${r.id}"`)}${button("journeyMarch","Заявить марш",`data-id="${r.id}"`)}${gm&&r.marchRequested&&r.status!=="pending"?button("allowMarch","Разрешить марш",`data-id="${r.id}" class="mjl-primary"`):""}</div></section>`;
    if(r.phase==="marchSave")html+=`<section class="mjl-roll-info"><h3>Марш · спасбросок Телосложения</h3><p>Сл. <strong>${r.dc}</strong>. Каждый участник бросает за себя. Провал: +1 степень истощения после подтверждения мастером.</p></section>`;
    if(r.status==="suspended")html+=`<p>Переход продолжится после общего долгого отдыха.</p>${button("request","Открыть заявку отдыха",`data-id="${r.restId}"`)}`;
    if(r.stages?.some(s=>s.type==="checks"))html+=`<details class="mjl-fold"><summary>Результаты марша</summary><div class="mjl-fold-content">${r.stages.filter(s=>s.type==="checks").map(s=>`<p>${secondsLabel(s.total)} в пути · Сл. ${s.dc}: ${Object.entries(s.outcomes).map(([id,o])=>`${esc(game.actors.get(id)?.name??"Удалён")}: ${esc(o.label)}`).join("; ")}</p>`).join("")}</div></details>`;
    if(r.kind==="teleport")html+=teleportHint;
    if(r.status!=="pending"&&r.phase!=="marchSave"&&["travel","local","navigation","search","forage"].includes(r.kind)&&needsParticipant(r))html+=`<section class="mjl-roll-info"><h3>${r.kind==="search"?"Мудрость (Внимательность)":"Мудрость (Выживание)"}</h3><p>Сложность: <strong>${r.dc}</strong></p>${["travel","local"].includes(r.kind)?'<p class="mjl-muted">При провале: +1d6 × 10% к времени.</p>':""}</section>`;
    if(["travel","local"].includes(r.kind)&&!r.risk&&!r.navigationDone&&r.phase!=="marchSave"&&r.status!=="pending")html+='<p class="mjl-muted">Проверка навигации не требуется.</p>';
    const rejectable=["pending","approved","camp"].includes(r.status)&&r.phase!=="marchSave"&&(!Object.keys(r.outcomes??{}).length||r.navigationDone&&r.phase!=="marchSave")&&!Object.values(r.running??{}).some(Boolean);
    const reject=rejectable?button("reject",moving&&r.elapsedSeconds?"Прервать переход":"Отклонить",`data-id="${r.id}"`):"";
    if(gm&&r.status==="pending") {
      const multi=["short","long","forage","search"].includes(r.kind);
      html+=`<form data-form="approve" data-id="${r.id}"><fieldset><legend>${r.kind==="teleport"?"Кто телепортирует":["local","travel"].includes(r.kind)?"Проводник":multi?"Участники":"Участник проверки"}</legend><div class="mjl-actor-picker">${members(scene).map(a=>`<label class="mjl-check"><input type="${multi?"checkbox":"radio"}" name="actor" value="${a.id}" ${checked(actors.some(x=>x.id===a.id))}>${esc(a.name)}</label>`).join("")}</div></fieldset>
      ${r.kind==="teleport"?`<label>Фактическое место прибытия<select name="destination" required>${teleportOptions(scene,r.to,r.locationId)}</select></label>${field("Заклинание или предмет","source",r.source??"","text",'maxlength="200"')}`:r.kind==="travel"?`<div class="mjl-form-grid">${field("Время маршрута, часы","baseHours",r.baseSeconds/3600,"number",'min="0.001" step="any"')}<label>Темп<select name="pace" ${r.profile?.mode==="vehicle"?"disabled":""}>${options(Object.fromEntries((r.paces??Object.keys(PACE)).map(k=>[k,PACE[k]])),r.pace)}</select></label></div>${r.profile?.mode!=="walk"&&r.miles!=null?`<p>Расстояние: ${r.miles} миль; время рассчитано по скорости.</p><label class="mjl-check"><input type="checkbox" name="manualTime">Задать время вручную вместо расчёта по расстоянию</label>`:""}${r.road?"":field("Сл. навигации","dc",r.dc,"number",'min="0" max="100" step="1"')}<label class="mjl-check"><input type="checkbox" name="risk" ${checked(r.risk)} ${r.road?"disabled":""}>${r.road?"Есть дорога — заблудиться нельзя":"Можно потеряться"}</label>`:r.kind==="local"?`<div class="mjl-form-grid">${field("Часы","hours",Math.floor((r.baseSeconds??r.seconds??0)/3600),"number",'min="0" max="8760" step="1" required')}${field("Минуты","minutes",Math.floor((r.baseSeconds??r.seconds??0)%3600/60),"number",'min="0" max="59" step="1" required')}</div><label class="mjl-check"><input type="checkbox" name="risk" ${checked(r.risk)}>Можно потеряться</label>${field("Сл. навигации","dc",r.dc??data.regions[r.regionId].navigationDC,"number",'min="0" max="100" step="1"')}`:r.kind!=="navigation"?field("Продолжительность, минуты","minutes",r.seconds==null?"":r.seconds/60,"number",'min="1" step="any" required'):""}${moving?`<p class="mjl-time-preview" data-time-preview role="status"></p><label class="mjl-check"><input type="checkbox" name="march" ${checked(r.march)}>Разрешить марш сверх 8 часов</label>`:""}<div class="mjl-actions">${reject}<button type="submit" class="mjl-primary">Одобрить</button></div></form>`;
    }
    html+=(gm&&r.status==="pending"?[]:actors).map(a=>{
      const out=r.outcomes?.[a.id],running=r.running?.[a.id],assigned=game.users.get(r.assignedUsers?.[a.id]);
      const can=(gm||(game.actors.get(a.id)?.isOwner&&(!r.assignedUsers?.[a.id]||r.assignedUsers[a.id]===game.user.id)))&&r.status==="approved"&&needsParticipant(r);
      return `<div class="mjl-row"><div><strong>${esc(a.name)}</strong><small>${r.status==="pending"?"Ждёт решения мастера":!needsParticipant(r)?"Бросок не требуется":out?esc(out.label):running?"Выполняется / ожидает восстановления":"Ожидает"}</small>${assigned?`<small>Игрок: ${esc(assigned.name)}</small>`:""}</div><div class="mjl-row-actions">${can&&!out&&!running?button("perform",["short","long"].includes(r.kind)?"Отдыхать":"Бросить",`data-id="${r.id}" data-actor="${a.id}" class="mjl-primary"`):""}${gm&&running?button("recoverRoll","Проверить попытку",`data-id="${r.id}" data-actor="${a.id}"`):""}</div></div>`;
    }).join("");
    if(gm&&r.kind==="search"&&r.status==="approved"&&Object.keys(r.outcomes).length&&!r.revealedId) {
      const region=data.regions[r.regionId],total=Math.max(...Object.values(r.outcomes).map(o=>o.total??-Infinity));
      const eligible=region.locations.filter(l=>!l.revealed&&total>=(l.dc??region.searchDC));
      html+=`<section class="mjl-roll-info"><h3>Находки · только мастер</h3><div class="mjl-grid-buttons">${eligible.map(l=>button("reveal",esc(l.name),`data-id="${r.id}" data-location="${l.id}"`)).join("")||"Нет подходящих скрытых локаций."}</div></section>`;
    }
    if(gm&&r.status==="approved")html+=`<div class="mjl-actions">${reject}${button("finish",r.kind==="teleport"?"Подтвердить прибытие":["travel","local"].includes(r.kind)?r.phase==="marchSave"?"Подтвердить спасброски":remaining+(day??0)>TRAVEL_LIMIT||r.elapsedSeconds?"Продолжить переход":"Завершить переход":"Завершить действие",`data-id="${r.id}" data-step="${r.step??0}" class="mjl-primary"`)}</div>`;
    if(gm&&r.status==="camp"&&rejectable)html+=`<div class="mjl-actions">${reject}</div>`;
    if(gm&&r.status==="committing")html+=`<p class="mjl-error">${esc(r.error??"Завершение прервано. Сверьте время и положение токена.")}</p><p>Время до: ${r.commit.timeBefore}; после: ${r.commit.timeAfter}; сейчас: ${game.time.worldTime} сек.</p><div class="mjl-actions">${button("skipTime","Время уже учтено",`data-id="${r.id}"`)}${r.commit.type==="checks"?button("skipExhaustion","Истощение уже учтено",`data-id="${r.id}"`):""}${r.commit.ledgerChange?button("skipLedger","Счётчик пути уже учтён",`data-id="${r.id}"`):""}${button("recover","Продолжить завершение",`data-id="${r.id}" class="mjl-primary"`)}</div>`;
    return html;
  }
  filterRegions() {
    const query=this.regionSearch.trim().toLocaleLowerCase();let count=0;
    for(const group of this.element.querySelectorAll('[data-region-search]')) {
      const regionMatch=group.dataset.regionSearch.toLocaleLowerCase().includes(query);
      let match=false;
      for(const location of group.querySelectorAll('[data-location-search]')) {
        const visible=!!query&&(regionMatch||location.dataset.locationSearch.toLocaleLowerCase().includes(query));
        location.hidden=!visible;match ||= visible;
      }
      group.hidden=!!query&&!regionMatch&&!match;if(!group.hidden)count++;
    }
    const empty=this.element.querySelector('[data-search-empty]');if(empty)empty.hidden=count>0;
  }
  regions(scene) {
    const gm=this.manager&&game.user.isGM,s=state(scene),data=game.user.isGM?privateData(scene):null;
    const rows=gm?scene.regions.filter(isBoundary).map(doc=>data.regions[doc.id]??{id:doc.id,name:doc.name}):data?Object.values(data.regions).filter(Boolean):s.regions.filter(r=>r.explored);
    if(!rows.some(r=>r.id===this.regionId))this.regionId=rows[0]?.id??"";
    const doc=scene.regions.get(this.regionId),r=gm?(data.regions[this.regionId]??(doc?regionDraft(doc):null)):rows.find(r=>r.id===this.regionId);
    const list=rows.map(r=>`<div data-region-search="${esc(r.name)}">${button("region",esc(r.name),`data-id="${r.id}" class="${r.id===this.regionId?"active":""}"`)}${(r.locations??[]).map(l=>`<div data-location-search="${esc(l.name)}" hidden>${button("notes",esc(l.name),`data-region="${r.id}" data-location="${l.id}"`)}</div>`).join("")}</div>`).join("");
    const body=gm?(r?this.regionForm(r):'<div class="mjl-empty">Нарисуйте первый регион.</div>'):(r?`<div class="mjl-section-heading"><h2>${esc(r.name)}</h2>${this.noteButton(r.id)}</div>${r.locations?.map(l=>`<div class="mjl-row"><strong>${esc(l.name)}</strong>${this.noteButton(r.id,l.id)}</div>`).join("")??""}`:"Выберите регион.");
    return `<div class="mjl-manager"><aside>${gm?button("draw","Новый регион",'class="mjl-wide"'):""}<label>Поиск<input type="search" name="regionSearch" value="${esc(this.regionSearch)}" placeholder="Регион или локация" autocomplete="off"></label><div class="mjl-region-list">${list}</div><p class="mjl-muted" data-search-empty hidden>Ничего не найдено.</p></aside><section class="mjl-panel">${body}</section></div>`;
  }
  regionForm(r) {
    const terrain=`<div class="mjl-form-grid"><label>Местность<select name="terrain">${options(TERRAIN,r.terrain)}</select></label><label>Максимальный темп<select name="maxPace">${options(PACE,r.maxPace)}</select></label>${field("Сл. навигации","navigationDC",r.navigationDC,"number",'min="0" max="100"')}${field("Сл. поиска","searchDC",r.searchDC,"number",'min="0" max="100"')}${field("Сл. пропитания","forageDC",r.forageDC,"number",'min="0" max="100"')}${field("Обнаружение, футы","detection",r.detection)}</div><label class="mjl-check"><input type="checkbox" name="equipped" ${checked(r.equipped)}>Снаряжение для быстрого темпа в арктике</label>`;
    const color=this.scene.regions.get(r.id)?.color?.css;
    const map=`<label>Цвет региона<color-picker name="color" value="${esc(color)}"></color-picker></label><label class="mjl-check"><input type="checkbox" name="explored" ${checked(r.explored)}>Регион открыт игрокам</label><label class="mjl-check"><input type="checkbox" name="showName" ${checked(r.showName!==false)}>Название центра на карте</label><div class="mjl-grid-buttons">${button("center",r.center?"Переместить центр":"Поставить центр",`data-id="${r.id}"`)}${button("editBoundary","Изменить границу",`data-id="${r.id}"`)}</div><div class="mjl-grid-buttons">${button("reposition","Переставить группу сюда",`data-id="${r.id}"`)}${button("preview","Вид игроков")}</div><p class="mjl-muted">Пересечения обрезаются по соседним регионам. Центр и локации должны оставаться внутри границы.</p>`;
    const locations=`${r.locations.map(l=>`<div class="mjl-row"><div><strong>${esc(l.name)}</strong><small>${l.revealed?"Открыта игрокам":"Скрыта"} · Сл. ${l.dc??r.searchDC}</small></div>${button("location","Изменить",`data-id="${l.id}"`)}</div>`).join("")}<div class="mjl-actions">${button("location","Добавить локацию")}</div>`;
    return `<form data-form="region" data-id="${r.id}" class="mjl-region-form">${field("Название региона","name",r.name,"text",'maxlength="200" required')}
      ${this.fold("terrain",`Местность и проверки <small>${esc(TERRAIN[r.terrain]?.name??"")}</small>`,terrain)}
      ${this.fold("description","Описание для игроков",`${area("Краткое описание","description",r.description)}<p class="mjl-muted">При открытии места исходное описание переносится в журнал. Дальнейшие записи редактируются в журнале Foundry.</p>${notebook(this.scene,r.id)?this.noteButton(r.id):""}`)}
      ${this.fold("notes","Заметки мастера",area("Секретные сведения","notes",r.notes))}
      ${this.fold("map",`Карта и видимость${!r.center?" · центр не установлен":""}`,map,!r.center)}
      ${this.fold("locations",`Локации (${r.locations.length})`,locations)}
      <div class="mjl-actions mjl-save-bar"><button type="submit" class="mjl-primary">Сохранить</button></div></form>
      ${this.fold("advanced","Дополнительно",`<div class="mjl-actions">${button("deleteRegion","Удалить регион",`data-id="${r.id}" class="mjl-danger"`)}</div>`)}`;
  }
  routes(scene) {
    const d=privateData(scene);
    return `<article class="mjl-panel"><h3>Маршруты между центрами</h3><p class="mjl-muted">Время задаётся для нормального темпа. Связь работает в обе стороны.</p><div class="mjl-grid-buttons">${button("route","Добавить маршрут")}</div>${d.routes.map(r=>`<div class="mjl-row"><div><strong>${esc(d.regions[r.from]?.name)} ↔ ${esc(d.regions[r.to]?.name)}</strong><small>${r.seconds==null?"Время назначит мастер":secondsLabel(r.seconds)} · ${r.road?"есть дорога · темп +1":r.risk?"есть риск навигации":"без риска навигации"}</small></div>${button("route","Изменить",`data-id="${r.id}"`)}${button("deleteRoute","Удалить",`data-id="${r.id}"`)}</div>`).join("")||'<p>Сначала добавьте два региона с центрами.</p>'}</article>`;
  }
  tables(scene) {
    const d=privateData(scene),regions=Object.values(d.regions).filter(Boolean);
    if(!d.regions[this.regionId])this.regionId=regions[0]?.id??"";
    const r=d.regions[this.regionId];
    const importer=`<input type="file" name="jsonFile" accept=".json,application/json"><label>Текст JSON<textarea name="json" rows="8" placeholder='{"schemaVersion":1,"name":"События","results":[{"weight":1,"title":"Встреча","text":"Описание"}]}'></textarea></label><div class="mjl-import-preview" role="status"></div><div class="mjl-actions">${button("previewImport","Проверить")}<button type="button" data-pc-action="importTable" class="mjl-primary" disabled>Создать таблицу</button></div><p class="mjl-muted">Пример JSON и запрос для нейросети находятся в руководстве.</p>`;
    return `<article class="mjl-panel"><h3>События региона</h3><div class="mjl-guide"><label>Регион<select name="tableRegion">${options(Object.fromEntries(regions.map(r=>[r.id,r.name])),this.regionId)}</select></label>${button("selectTableRegion","Выбрать")}</div>${r?`<div class="mjl-table-drop">Перетащите таблицу из мира</div><div class="mjl-guide"><label>Случайная таблица<select name="table">${game.tables.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></label>${button("attachTable","Привязать")}</div>${r.tables.map(id=>`<div class="mjl-row"><strong>${esc(game.tables.get(id)?.name??"Таблица удалена")}</strong><div class="mjl-row-actions">${button("event","Бросить мастеру",`data-id="${id}"`)}${button("detachTable","Отвязать",`data-id="${id}"`)}</div></div>`).join("")}${this.fold("import","Импортировать JSON",importer)}`:"Сначала создайте регион."}</article>`;
  }
  async submit(form) {
    const f=fdata(form);
    if(form.dataset.form==="region") {
      const values={...f,color:form.querySelector("color-picker").value,equipped:form.elements.equipped.checked,explored:form.elements.explored.checked,showName:form.elements.showName.checked};
      await request("region",{regionId:form.dataset.id,values});
    } else if(form.dataset.form==="journey") {
      await request("journeySettings",{hours:f.hours,minutes:f.minutes,profile:{mode:f.mode,speed:f.speed,mph:f.mph,ignoreTerrain:form.elements.ignoreTerrain.checked,slower:form.elements.slower.checked}},this.scene);
    } else if(form.dataset.form==="notes") {
      await request("notes",{regionId:this.regionId,locationId:this.locationId,notes:f.notes},this.scene);
    } else if(form.dataset.form==="guide") {
      await request("guide",{actorId:f.guide||null},this.scene);
    } else if(form.dataset.form==="approve") {
      const actors=new FormData(form).getAll("actor");
      await request("approve",{requestId:form.dataset.id,actors,march:form.elements.march?.checked??false,manualTime:form.elements.manualTime?.checked??false,...(f.destination!=null?{to:f.destination.split(":")[0],locationId:f.destination.split(":")[1]||null,source:f.source}:f.hours!=null?{hours:f.hours,minutes:f.minutes,risk:form.elements.risk.checked,dc:f.dc}:f.baseHours!=null?{baseSeconds:Number(f.baseHours)*3600,pace:f.pace,dc:f.dc,risk:form.elements.risk.checked}:f.minutes!=null?{seconds:Number(f.minutes)*60}:{})},this.scene);
    }
  }
  chosenActors() {return [...this.element.querySelectorAll('.mjl-actors [name=actor]:checked')].map(x=>x.value);}
  async action(action,b) {
    const scene=this.scene,d=game.user.isGM?privateData(scene):null;
    if(action==="tab") {this.tab=b.dataset.tab;this.requestId="";this.resetScroll=true;return;}
    if(action==="enable")return request("enable",{enabled:true});
    if(action==="disable") {if(await confirm("Отключить Pointcrawl?","<p>Маска исчезнет. Исходная настройка Token Vision будет восстановлена.</p>"))await request("enable",{enabled:false});return;}
    if(action==="region") {this.regionId=b.dataset.id;this.resetScroll=true;return;}
    if(action==="notes")return NotesWindow.open({sceneId:scene.id,regionId:b.dataset.region,locationId:b.dataset.location});
    if(action==="openNotebook")return showNotebook(scene,this.regionId,this.locationId);
    if(action==="request") {RequestWindow.open({sceneId:scene.id,requestId:b.dataset.id});return;}
    if(action==="centre") {TravelCentre.open();return;}
    if(action==="currentRequest") {this.requestId="";return;}
    if(action==="party")return request("party",{tokenId:this.element.querySelector("[name=party]").value});
    if(action==="teleport") {
      const actors=this.chosenActors();need(actors.length,"Выберите персонажа, использующего телепортацию.");
      const value=await prompt("Телепортация партии",`<label>Место прибытия<select name="destination" required><option value="">Выберите точку</option>${teleportOptions(scene)}</select></label>${field("Заклинание или предмет","source","","text",'maxlength="200" placeholder="Например, шлем телепортации"')}${teleportHint}`,f=>fdata(f),"Отправить заявку");
      if(value){const [to,locationId]=value.destination.split(":");const requestId=await request("create",{kind:"teleport",actors,to,locationId:locationId||null,source:value.source},scene);RequestWindow.open({sceneId:scene.id,requestId});}return;
    }
    if(action==="activity"||action==="travel"||action==="local") {
      let actors=this.chosenActors();
      if(action==="activity"&&b.dataset.kind==="search") {
        const selected=await prompt("Участники поиска",`<div class="mjl-actor-picker">${members(scene).map(a=>`<label class="mjl-check"><input type="checkbox" name="actor" value="${a.id}" ${checked(actors.includes(a.id))}>${esc(a.name)}</label>`).join("")}</div><label class="mjl-check"><input type="checkbox" name="all">Все участники партии</label>`,f=>new FormData(f).getAll("actor"),"Отправить заявку",(_event,dialog)=>{
          const form=dialog.element.querySelector('form'),checks=[...form.querySelectorAll('[name=actor]')],all=form.elements.all;
          all.checked=checks.every(c=>c.checked);all.addEventListener('change',()=>{for(const c of checks)c.checked=all.checked;});
          for(const c of checks)c.addEventListener('change',()=>{all.checked=checks.every(c=>c.checked);});
        });
        if(!selected)return;actors=selected;
      }
      need(actors.length,"Выберите хотя бы одного персонажа.");this.requestId="";
      const requestId=await request("create",{kind:action==="local"?"local":action==="travel"?"travel":b.dataset.kind,locationId:action==="local"?(b.dataset.id??null):undefined,actors,to:b.dataset.to,pace:this.element.querySelector("[name=pace]")?.value??"normal"},scene);
      RequestWindow.open({sceneId:scene.id,requestId});return;
    }
    if(action==="perform")return perform(scene,b.dataset.id,b.dataset.actor);
    if(["finish","reject","recover"].includes(action))return request(action,{requestId:b.dataset.id,step:Number(b.dataset.step)},scene);
    if(action==="journeyRest"||action==="journeyMarch")return request("journeyChoice",{requestId:b.dataset.id,choice:action==="journeyRest"?"rest":"march"},scene);
    if(action==="allowMarch")return request("allowMarch",{requestId:b.dataset.id},scene);
    if(action==="skipLedger"){if(await confirm("Подтвердить счётчик пути?","<p>Сверьте счётчик партии. Продолжение сохранит его текущее значение без повторного начисления.</p>"))await request("recover",{requestId:b.dataset.id,skipLedger:true},scene);return;}
    if(action==="skipExhaustion"){if(await confirm("Подтвердить учёт истощения?","<p>Сначала сверьте листы всех участников. Продолжение пропустит уже применённое истощение.</p>"))await request("recover",{requestId:b.dataset.id,skipExhaustion:true},scene);return;}
    if(action==="skipTime") {if(await confirm("Подтвердить учёт времени?","<p>Продолжить действие без повторного увеличения времени. Сначала сверьте часы мира.</p>"))await request("recover",{requestId:b.dataset.id,skipTime:true},scene);return;}
    if(action==="recoverRoll") {
      try {await request("recoverRoll",{requestId:b.dataset.id,actorId:b.dataset.actor},scene);}
      catch {
        const rest=["short","long"].includes(d.requests[b.dataset.id].kind);
        const choice=await prompt("Восстановить попытку",'<p>Результат не найден в чате. Проверьте HP, Кости Хитов и ресурсы персонажа: отдых мог примениться до сбоя. Новая попытка может повторить восстановление.</p><label>Решение<select name="decision">'+(rest?'<option value="done">Отдых уже применён — считать выполненным</option>':"")+'<option value="retry">Разрешить новую попытку</option></select></label>',f=>f.elements.decision.value,"Применить решение");
        if(choice)await request("recoverRoll",{requestId:b.dataset.id,actorId:b.dataset.actor,decision:choice},scene);
      }return;
    }
    if(action==="reveal")return request("reveal",{requestId:b.dataset.id,locationId:b.dataset.location},scene);
    if(action==="adopt")return request("region",{regionId:this.regionId});
    if(action==="deleteRegion") {if(await confirm("Удалить регион?","<p>Будут удалены граница, карточка и связанные маршруты.</p>"))await request("deleteRegion",{regionId:b.dataset.id});return;}
    if(action==="reposition")return request("reposition",{regionId:b.dataset.id});
    if(["draw","center","preview","editBoundary"].includes(action)) {
      if(action==="center") {
        const form=this.element.querySelector("[data-form=region]");
        if(form)await this.submit(form);
      }
      if(action!=="preview")await this.close();
      Hooks.callAll(`${ID}.tool`,{action,regionId:b.dataset.id??this.regionId});return;
    }
    if(action==="location") {const form=this.element.querySelector("[data-form=region]");if(form)await this.submit(form);return this.locationDialog(b.dataset.id);}
    if(action==="route")return this.routeDialog(b.dataset.id);
    if(action==="deleteRoute")return request("route",{routeId:b.dataset.id,remove:true});
    if(action==="selectTableRegion") {this.regionId=this.element.querySelector("[name=tableRegion]").value;return;}
    if(action==="attachTable")return request("table",{regionId:this.regionId,tableId:this.element.querySelector("[name=table]").value});
    if(action==="detachTable")return request("table",{regionId:this.regionId,tableId:b.dataset.id,remove:true});
    if(action==="event")return request("event",{regionId:this.regionId,tableId:b.dataset.id});
    if(action==="previewImport") {this.previewImport();this.dirty=true;return;}
    if(action==="importTable") {need(this.importParsed,"Сначала проверьте JSON.");await request("table",{regionId:this.regionId,json:this.importParsed});this.importParsed=null;return;}
  }
  previewImport() {
    this.importParsed=null;
    const raw=this.element.querySelector("[name=json]").value;
    const parsed=eventTable(raw);this.importParsed=JSON.parse(raw);
    this.element.querySelector(".mjl-import-preview").innerHTML=`<h4>${esc(parsed.name)} · ${parsed.formula}</h4><ol>${parsed.results.map(r=>`<li><strong>${r.range.join("–")}: ${esc(r.title)}</strong><p>${esc(r.text)}</p></li>`).join("")}</ol>`;
    this.element.querySelector("[data-pc-action=importTable]").disabled=false;
  }
  async locationDialog(id,point,draft) {
    const scene=this.scene,r=privateData(scene).regions[this.regionId];need(r,"Выберите регион.");
    const old={...(r.locations.find(l=>l.id===id)??{name:"",description:"",notes:"",x:r.center?.x??"",y:r.center?.y??"",dc:"",revealed:false}),...draft,...point};
    const read=f=>({...fdata(f),color:f.querySelector("color-picker").value,revealed:f.elements.revealed.checked,showName:f.elements.showName.checked,remove:!!f.elements.remove?.checked});
    const value=await DialogV2.prompt({classes:["mjl-dialog","mjl-location-editor"],window:{title:"Локация региона"},position:{width:600},rejectClose:false,
      content:`<div class="mjl-location-layout">${field("Название локации","name",old.name,"text","required")}
        <section class="mjl-location-point"><div><strong>Положение на карте</strong><p>${old.x===""?"Точка не выбрана":`Точка: ${Math.round(old.x)}, ${Math.round(old.y)}`}</p></div><button type="button" data-location-pick><i class="fa-solid fa-location-dot" aria-hidden="true"></i> Выбрать на карте</button></section>
        <div class="mjl-location-row">${field("Сложность поиска","dc",old.dc??"","number",'min="0" max="100" placeholder="Оставьте пустым, для сложности по умолчанию для региона"')}
        <label>Цвет маркера на карте<color-picker name="color" value="${esc(old.color)}" placeholder="${old.revealed?"#7c986c":"#724d50"}"></color-picker></label></div>
        ${area("Описание для игроков","description",old.description)}${area("Секретные заметки мастера","notes",old.notes)}
        <div class="mjl-location-options"><label class="mjl-location-check"><input type="checkbox" name="revealed" ${checked(old.revealed)}><span>Открыта игрокам</span></label><label class="mjl-location-check"><input type="checkbox" name="showName" ${checked(old.showName!==false)}><span>Название на карте</span></label></div>
        <details class="mjl-location-coordinates"><summary>Точные координаты · дополнительно</summary><div class="mjl-location-row">${field("Координата X","x",old.x,"number",'step="any"')}${field("Координата Y","y",old.y,"number",'step="any"')}</div></details>
        ${id?'<label class="mjl-location-check"><input type="checkbox" name="remove"><span>Удалить эту локацию</span></label>':""}</div>`,
      ok:{label:"Сохранить",callback:(_e,b)=>read(b.form)},
      render:(_event,dialog)=>dialog.element.querySelector("[data-location-pick]").addEventListener("click",async event=>{
        const values=read(event.target.form);await dialog.close();await this.close();
        Hooks.callAll(`${ID}.tool`,{action:"locationPoint",regionId:r.id,
          onPick:p=>this.locationDialog(id,p,values),onCancel:()=>this.locationDialog(id,null,values)});
      })});
    if(value) {await request("location",{regionId:r.id,locationId:id,values:value,remove:value.remove},scene);PointcrawlApp.open({regionId:r.id});}
  }
  async routeDialog(id,from,to) {
    const d=privateData(canvas.scene),r=d.routes.find(x=>x.id===id)??{from,to,seconds:3600,risk:true,road:false};
    const nodes=Object.fromEntries(Object.values(d.regions).filter(r=>r?.center).map(r=>[r.id,r.name]));
    const value=await prompt("Маршрут",`<div class="mjl-form-grid"><label>Из региона<select name="from">${options(nodes,r.from)}</select></label><label>В регион<select name="to">${options(nodes,r.to)}</select></label>${field("Время при нормальном темпе, часы","hours",r.seconds/3600,"number",'min="0.001" step="any" required')}${field("Расстояние, мили","miles",r.miles??"","number",'min="0.001" step="any" placeholder="Необязательно" title="Мили нужны для особого перемещения и транспорта. Без них используется время мастера."')}</div><label class="mjl-check" title="Повышает максимальный допустимый темп на одну ступень. Выбранный темп не меняется."><input type="checkbox" name="road" ${checked(r.road)}>Есть дорога</label><label class="mjl-check"><input type="checkbox" name="risk" ${checked(!r.road&&r.risk)} ${r.road?"disabled":""}>Риск заблудиться</label><label>Темп для предварительного расчёта<select name="previewPace">${options(PACE,"normal")}</select></label><p class="mjl-time-preview" data-time-preview role="status"></p>`,f=>({...fdata(f),road:f.elements.road.checked,risk:f.elements.risk.checked}),"Сохранить",(_event,dialog)=>{const f=dialog.element.querySelector("form");f.elements.road.addEventListener("change",()=>{f.elements.risk.disabled=f.elements.road.checked;if(f.elements.road.checked)f.elements.risk.checked=false;});timePreview(f,form=>{
      const profile=partyProfile(canvas.scene,d),road=form.elements.road.checked,selected=form.elements.previewPace.value;
      return [[form.elements.from.value,form.elements.to.value],[form.elements.to.value,form.elements.from.value]].map(([a,b])=>{
        const dest=d.regions[b];need(dest,"Выберите регионы.");const paces=allowedPaces(dest,road,profile),pace=paces.includes(selected)?selected:paces.at(-1);
        const seconds=journeySeconds(Number(form.elements.hours.value)*3600,pace,dest,road,profile,form.elements.miles.value||null);
        return d.regions[a]?.name+" → "+dest.name+": "+secondsLabel(seconds)+" ("+(TERRAIN[dest.terrain]?.name??"местность")+"; "+(profile.mode==="vehicle"?"транспорт "+profile.mph+" миль/ч":PACE[pace].name.toLowerCase()+" темп")+(pace!==selected&&profile.mode!=="vehicle"?", ограничение группы / местности":"")+").";
      }).join(" ");
    });});
    if(value)await request("route",{from:value.from,to:value.to,seconds:Number(value.hours)*3600,risk:value.risk,road:value.road,miles:value.miles});
  }
}

export class TravelCentre extends PointcrawlApp {
  static instance;
  static DEFAULT_OPTIONS={id:`${ID}-centre`,classes:["mjl-app","mjl-centre"],window:{title:"Центр путешествий"},position:{height:"auto"}};
  tab="travel";
}

export class NotesWindow extends PointcrawlApp {
  static windows=new Map();
  static DEFAULT_OPTIONS={classes:["mjl-app","mjl-notes"],window:{title:"Заметки",icon:"fa-solid fa-book-open"},position:{width:540,height:"auto"}};
  tab="players";
  get title() {
    try {return `Заметки · ${notesFor(this.scene,this.regionId,this.locationId).name}`;}
    catch {return "Заметки";}
  }
  static async open({sceneId=canvas.scene?.id,regionId,locationId,tab="players"}={}) {
    const scene=game.scenes.get(sceneId);need(scene,"Сцена не найдена.");
    notesFor(scene,regionId,locationId);
    if(tab!=="gm"||!game.user.isGM) {
      if(!notebook(scene,regionId,locationId))await request("notebook",{regionId,locationId},scene);
      return showNotebook(scene,regionId,locationId);
    }
    const key=`${sceneId}:${regionId}:${locationId??"region"}`;
    const app=this.windows.get(key)??new this({id:`${ID}-notes-${sceneId}-${locationId??regionId}`});
    this.windows.set(key,app);app.sceneId=sceneId;app.regionId=regionId;app.locationId=locationId;
    app.tab=game.user.isGM&&tab==="gm"?"gm":"players";app.resetScroll=true;app.render({force:true});return app;
  }
  async _renderHTML() {
    try {
      const data=notesFor(this.scene,this.regionId,this.locationId);
      if(!game.user.isGM)this.tab="players";
      if(this.tab!=="gm")return this.frame(this.scene,button("openNotebook","Открыть журнал Foundry"));
      return this.frame(this.scene,`<form data-form="notes">${area("Секретные заметки мастера","notes",data.notes)}<div class="mjl-actions">${button("openNotebook","Общие заметки")}<button type="submit" class="mjl-primary">Сохранить</button></div></form>`);
    } catch {return '<div class="mjl-empty">Заметки недоступны.</div>';}
  }
}

export class RequestWindow extends PointcrawlApp {
  static windows=new Map();
  static prompted=new Set();
  static DEFAULT_OPTIONS={classes:["mjl-app","mjl-request"],window:{title:"Заявка партии"},position:{width:560,height:"auto"}};
  static value(scene,id) {
    if(game.user.isGM)return privateData(scene).requests[id];
    return state(scene).active?.id===id?state(scene).active:game.messages.find(m=>m.getFlag(ID,"sceneId")===scene.id&&m.getFlag(ID,"requestId")===id)?.getFlag(ID,"request");
  }
  static open({sceneId=canvas.scene?.id,requestId}={}) {
    const scene=game.scenes.get(sceneId);if(!scene||!requestId)return;
    const key=`${sceneId}:${requestId}`,r=this.value(scene,requestId);
    const app=this.windows.get(key)??new this({id:`${ID}-request-${requestId}`,window:{title:r?.kind==="travel"?"Pointcrawl · Переход между регионами":`Pointcrawl · ${ACTIONS[r?.kind]??"Заявка партии"}`}});
    this.windows.set(key,app);app.sceneId=sceneId;app.requestId=requestId;
    app.render({force:true});return app;
  }
  async _renderHTML() {
    const scene=this.scene;if(!scene)return '<p class="mjl-empty">Сцена удалена.</p>';
    const r=RequestWindow.value(scene,this.requestId),data=game.user.isGM?privateData(scene):null;
    return this.frame(scene,r?this.requestPanel(scene,r,data):'<p>Заявка недоступна. Откройте её из чата после синхронизации.</p>');
  }
  static sync() {
    for(const app of [PointcrawlApp.instance,TravelCentre.instance,...this.windows.values(),...NotesWindow.windows.values()])
      if(app?.rendered&&!app.busy&&!app.dirty)app.render();
    for(const scene of game.scenes.filter(s=>s.active||s.id===canvas.scene?.id)) {
      const r=state(scene).active;if(!r)continue;
      const actors=r.actors.filter(a=>game.actors.get(a.id)?.isOwner&&(!r.assignedUsers?.[a.id]||r.assignedUsers[a.id]===game.user.id)&&!r.outcomes?.[a.id]&&!r.running?.[a.id]);
      const decision=["travel","local"].includes(r.kind)&&["pending","approved","camp"].includes(r.status)&&r.phase!=="marchSave"&&((r.daySeconds??0)>=TRAVEL_LIMIT||(r.daySeconds??0)+Math.max(0,(r.seconds??0)-(r.elapsedSeconds??0))>TRAVEL_LIMIT);
      const gm=game.users.activeGM?.isSelf&&(r.status==="pending"||r.status==="camp"||r.phase==="marchSave"||r.status==="approved"&&r.navigationDone&&r.restId);
      const player=!game.user.isGM&&((r.status==="approved"&&needsParticipant(r)&&actors.length)||(decision&&members(scene).some(a=>a.isOwner)));
      if(!gm&&!player)continue;
      const key=`${scene.id}:${r.id}:${r.step??0}:${r.phase??""}:${gm?"gm":`player:${actors.map(a=>a.id).sort().join(",")}`}`;
      if(this.prompted.has(key))continue;
      this.prompted.add(key);this.open({sceneId:scene.id,requestId:r.id});
    }
  }
}
