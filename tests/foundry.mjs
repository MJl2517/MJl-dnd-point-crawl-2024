import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {browser} from "./cdp.mjs";
// Run against ONLY the isolated world prepared by dev/setup.ps1, never a campaign world.
const b=await browser(),contexts=[],report={passed:[],screenshots:[]};
let gm,player;
const ev=(s,fn,args)=>b.eval(`(${fn.toString()})(${JSON.stringify(args??null)})`,s);
const pass=(name)=>{report.passed.push(name);console.log(`PASS ${name}`);};
async function screenshot(name,s) {const path=`mjl-pointcrawl/dev/${name}.png`;await b.screenshot(path,s);report.screenshots.push(path);}
async function reload(s) {await b.eval('globalThis.__pcReloading=true;location.reload()',s);await b.until('!globalThis.__pcReloading && globalThis.game?.ready',s,45000);await b.until('canvas.ready',s);}
async function join(s,name) {
  await b.until('document.querySelector("select[name=userid]") || globalThis.game?.ready',s);
  if(await b.eval('!!globalThis.game?.ready',s))return;
  await ev(s,name=>{const select=document.querySelector('select[name=userid]');select.value=[...select.options].find(o=>o.text===name)?.value;document.querySelector('button[name=join]').click();},name);
  await b.until('globalThis.game?.ready',s,120000);await b.until('canvas.ready',s);
  await b.eval('document.querySelector(".application.user-config button[type=submit]")?.click()',s);
}
async function send(s,action,args={}) {return ev(s,async({action,args})=>(await import('/modules/mjl-pointcrawl/scripts/store.mjs')).request(action,args),{action,args});}
async function waitState(s,expression) {return b.until(expression,s,30000);}
async function startRoll(s,requestId,actorId) {
  await ev(s,({requestId,actorId})=>{globalThis.__pcResult=null;import('/modules/mjl-pointcrawl/scripts/store.mjs').then(m=>m.perform(canvas.scene,requestId,actorId)).then(()=>globalThis.__pcResult={ok:true}).catch(e=>globalThis.__pcResult={error:e.message});},{requestId,actorId});
}
async function nativeSubmit(s,action="normal") {
  await waitState(s,'!!document.querySelector(".application:not(.mjl-app) button[type=submit]")');
  const buttons=await b.eval('[...document.querySelectorAll(".application:not(.mjl-app) button[type=submit]")].map(e=>({action:e.dataset.action,text:e.innerText}))',s);
  await ev(s,action=>{const buttons=[...document.querySelectorAll('.application:not(.mjl-app) button[type=submit]')];(buttons.find(x=>x.dataset.action===action)??buttons.at(-1)).click();},action);
  await waitState(s,'globalThis.__pcResult');
  const result=await b.eval('__pcResult',s);assert.equal(result.error,undefined,JSON.stringify({result,buttons}));
}
try {
  const targets=(await b.call('Target.getTargets')).targetInfos;
  const target=targets.find(t=>t.type==='page'&&t.url.startsWith('http://127.0.0.1:30010/'));
  if(target) gm=(await b.call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  else gm=await b.page('http://127.0.0.1:30010/join');
  await b.call('Runtime.enable',{},gm);await b.call('Page.enable',{},gm);
  await b.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},gm);
  await join(gm,'Gamemaster');
  assert.equal(await b.eval('game.world.id',gm),'pointcrawl-test','Refusing to mutate a non-test world');
  await reload(gm);
  b.events=[];
  const fixture=await ev(gm,async()=>{
    const m=await import('/modules/mjl-pointcrawl/scripts/store.mjs');
    const user=game.users.find(u=>u.name==='Pointcrawl Player')??await User.create({name:'Pointcrawl Player',role:1});
    const actor=await Actor.create({name:'Эйрин · проверка',type:'character',ownership:{[user.id]:3},system:{abilities:{wis:{value:14}},attributes:{hp:{value:8,max:20}}},items:[{name:'Путешественник',type:'class',system:{levels:2,hd:{denomination:'d8',spent:0}}}]});
    const group=await Actor.create({name:'Путники · проверка',type:'group',ownership:{[user.id]:3},system:{members:[{actor:actor.id}]}});
    const scene=await Scene.create({name:'Зелёная долина — испытание Pointcrawl',width:1800,height:1200,grid:{type:0,size:100},backgroundColor:'#6c8165',tokenVision:true,ownership:{default:2},navigation:true});
    const created=await scene.createEmbeddedDocuments('Region',[
      {name:'One',shapes:[{type:'polygon',points:[450,350,950,350,950,950,450,950]}]},
      {name:'Two',shapes:[{type:'polygon',points:[950,350,1450,350,1450,950,950,950]}]},
      {name:'Three',shapes:[{type:'polygon',points:[1450,350,1950,350,1950,950,1450,950]}]}
    ]);
    const one=created.find(r=>r.name==='One'),two=created.find(r=>r.name==='Two'),three=created.find(r=>r.name==='Three');
    await m.request('enable',{enabled:true},scene);
    await m.request('region',{regionId:one.id,values:{name:'Зелёная долина',center:{x:700,y:650},explored:true,notes:'SECRET_VALLEY_782'}},scene);
    await m.request('region',{regionId:two.id,values:{name:'Тайный лес',center:{x:1200,y:650},navigationDC:0,searchDC:0,forageDC:0,notes:'SECRET_FOREST_782'}},scene);
    await m.request('region',{regionId:three.id,values:{name:'Запретный кряж',center:{x:1700,y:650},notes:'SECRET_RIDGE_782'}},scene);
    await m.request('location',{regionId:two.id,values:{name:'Скрытый родник',description:'Чистая вода под корнями старого дуба.',notes:'SECRET_SPRING_782',x:1250,y:750,dc:0,revealed:false}},scene);
    await m.request('route',{from:one.id,to:two.id,seconds:3600,risk:true},scene);
    const [token]=await scene.createEmbeddedDocuments('Token',[(await group.getTokenDocument({x:650,y:600,width:1,height:1})).toObject()]);
    await m.request('party',{tokenId:token.id},scene);
    await scene.activate();game.togglePause(false,{broadcast:true});
    return {scene:scene.id,one:one.id,two:two.id,three:three.id,actor:actor.id,group:group.id,token:token.id,user:user.id};
  });
  await waitState(gm,`canvas.ready && canvas.scene.id === ${JSON.stringify(fixture.scene)}`);
  await ev(gm,()=>{ui.notifications.clear();game.modules.get('mjl-pointcrawl').api.open();});
  await waitState(gm,'!!document.querySelector(".mjl-app .mjl-shell")');
  await ev(gm,()=>game.modules.get('mjl-pointcrawl').api.open().setPosition({left:75,top:70,width:880,height:720}));
  await ev(gm,()=>document.querySelector('[data-control="mjl-pointcrawl"]').click());
  await waitState(gm,'ui.controls.control?.name === "mjl-pointcrawl"');
  await ev(gm,()=>document.querySelector('[data-tool="manager"]').click());
  await waitState(gm,'!!document.querySelector(".mjl-manager")');
  await ev(gm,()=>document.querySelector('[data-tool="hub"]').click());
  assert.equal(await b.eval('!!document.querySelector("[data-control=mjl-pointcrawl]")',gm),true);pass('Separate Pointcrawl toolbar and travel centre render in Foundry 14.361');
  await screenshot('gm-centre',gm);
  const context=(await b.call('Target.createBrowserContext')).browserContextId;contexts.push(context);player=await b.page('http://127.0.0.1:30010/join',context);
  await join(player,'Pointcrawl Player');
  await waitState(player,`canvas.ready && canvas.scene.id === ${JSON.stringify(fixture.scene)}`);
  await ev(player,()=>{ui.notifications.clear();});
  const visible=await b.eval('JSON.stringify({journal:game.journal.contents,regions:canvas.scene.regions.contents,state:canvas.scene.getFlag("mjl-pointcrawl","state")})',player);
  assert(!visible.includes('SECRET_'));assert(!visible.includes('Скрытый родник'));assert(!visible.includes('Тайный лес'));assert(!visible.includes('Запретный кряж'));
  pass('Player receives no GM notes, hidden region names or hidden locations');
  await ev(player,()=>{canvas.pan({x:1200,y:650,scale:.65});ui.notifications.clear();});
  await screenshot('player-map-before',player);
  const before=await b.eval('game.time.worldTime',gm);
  await ev(player,async f=>{await canvas.scene.tokens.get(f.token).update({x:1150,y:600});},fixture);
  assert.equal(await b.eval('canvas.scene.getFlag("mjl-pointcrawl","state").active',gm),null);
  await ev(player,async f=>{const u=await import("/modules/mjl-pointcrawl/scripts/app.mjs");await u.TravelCentre.open().render({force:true});document.querySelector(`#mjl-pointcrawl-centre [data-pc-action=travel][data-to="${f.two}"]`).click();},fixture);
  await waitState(gm,'!!canvas.scene.getFlag("mjl-pointcrawl","state").active');
  const travel=await b.eval('canvas.scene.getFlag("mjl-pointcrawl","state").active.id',gm);
  assert.equal(await ev(gm,f=>canvas.scene.tokens.get(f.token).x,fixture),650);assert.equal(await b.eval('game.time.worldTime',gm),before);
  assert.equal(await ev(player,f=>canvas.scene.getFlag('mjl-pointcrawl','state').regions.find(r=>r.id===f.two).explored,fixture),false);
  pass('Player drag is blocked without a request; travel-centre request leaves token, time and exploration unchanged');
  await assert.rejects(()=>send(player,'approve',{requestId:travel}),/только мастеру/);
  await send(gm,'approve',{requestId:travel,actors:[fixture.actor],pace:'normal',dc:0,risk:true});
  await waitState(player,'canvas.scene.getFlag("mjl-pointcrawl","state").active?.status === "approved"');
  await startRoll(player,travel,fixture.actor);await nativeSubmit(player);
  await send(gm,'finish',{requestId:travel});
  await waitState(player,'!canvas.scene.getFlag("mjl-pointcrawl","state").active');
  assert.equal(await b.eval('game.time.worldTime',gm),before+3600);
  assert.equal(await ev(player,f=>canvas.scene.tokens.get(f.token).x,fixture),1150);
  await assert.rejects(()=>send(gm,'finish',{requestId:travel}),/не готова/);
  assert.equal(await b.eval('game.time.worldTime',gm),before+3600);pass('Native player Survival roll; GM arrival reveals region and charges time exactly once');
  await ev(player,async()=>{const m=await import('/modules/mjl-pointcrawl/scripts/app.mjs');await m.PointcrawlApp.instance?.close();canvas.pan({x:1200,y:650,scale:.65});ui.notifications.clear();});
  await screenshot('player-map-after',player);
  const forage=await send(player,'create',{kind:'forage',actors:[fixture.actor]});await send(gm,'approve',{requestId:forage});
  await waitState(player,'canvas.scene.getFlag("mjl-pointcrawl","state").active?.status === "approved"');
  await startRoll(player,forage,fixture.actor);await nativeSubmit(player);
  await send(gm,'finish',{requestId:forage});
  await assert.rejects(()=>send(player,'create',{kind:'forage',actors:[fixture.actor]}),/уже искал/);pass('Forage creates food/water chat results and enforces per-character daily quota');
  const search=await send(player,'create',{kind:'search',actors:[fixture.actor]});await send(gm,'approve',{requestId:search});
  await waitState(player,'canvas.scene.getFlag("mjl-pointcrawl","state").active?.status === "approved"');
  await startRoll(player,search,fixture.actor);await nativeSubmit(player);
  const location=await ev(gm,async f=>(await import('/modules/mjl-pointcrawl/scripts/store.mjs')).privateData(canvas.scene).regions[f.two].locations[0].id,fixture);
  assert.equal(await b.eval('JSON.stringify(canvas.scene.getFlag("mjl-pointcrawl","state")).includes("Скрытый родник")',player),false);
  await send(gm,'reveal',{requestId:search,locationId:location});await send(gm,'finish',{requestId:search});
  await waitState(player,'JSON.stringify(canvas.scene.getFlag("mjl-pointcrawl","state")).includes("Скрытый родник")');pass('Native Perception check lets GM reveal one eligible hidden location');
  const rest=await send(player,'create',{kind:'long',actors:[fixture.actor]});await send(gm,'approve',{requestId:rest});
  const restStart=await b.eval('game.time.worldTime',gm);
  await waitState(player,'canvas.scene.getFlag("mjl-pointcrawl","state").active?.status === "approved"');
  await startRoll(player,rest,fixture.actor);await nativeSubmit(player);
  assert.equal(await b.eval('game.time.worldTime',gm),restStart);
  const hp=await ev(gm,f=>game.actors.get(f.actor).system.attributes.hp,fixture);assert.equal(hp.value,hp.max);
  await send(gm,'finish',{requestId:rest});assert.equal(await b.eval('game.time.worldTime',gm),restStart+28800);pass('Native Long Rest heals actor; party clock advances 8 hours once on GM completion');
  const short=await send(player,'create',{kind:'short',actors:[fixture.actor]});await send(gm,'approve',{requestId:short});
  await waitState(player,'canvas.scene.getFlag("mjl-pointcrawl","state").active?.status === "approved"');
  await startRoll(player,short,fixture.actor);await nativeSubmit(player);await send(gm,'finish',{requestId:short});pass('Native Short Rest dialog and group completion');
  const eventMarker=`EVENT_SECRET_${fixture.scene}`;
  const json={schemaVersion:1,name:'Тест событий',description:'Проверка JSON',results:[{weight:2,title:'Случайная встреча',text:eventMarker},{weight:1,title:'Тихий путь',text:eventMarker}]};
  await send(gm,'table',{regionId:fixture.two,json});
  const tableId=await ev(gm,async f=>(await import('/modules/mjl-pointcrawl/scripts/store.mjs')).privateData(canvas.scene).regions[f.two].tables[0],fixture);
  const eventId=await send(gm,'event',{regionId:fixture.two,tableId});
  assert.equal(await ev(player,marker=>JSON.stringify(game.messages.filter(m=>m.visible)).includes(marker),eventMarker),false);
  await send(gm,'publishEvent',{eventId});await waitState(player,`JSON.stringify(game.messages.contents).includes(${JSON.stringify(eventMarker)})`);
  const count=await b.eval('game.messages.filter(m=>m.getFlag("mjl-pointcrawl","eventPublished")).length',player);
  await send(gm,'publishEvent',{eventId});assert.equal(await b.eval('game.messages.filter(m=>m.getFlag("mjl-pointcrawl","eventPublished")).length',player),count);pass('JSON becomes native RollTable; GM-only event publishes once');
  const pending=await send(player,'create',{kind:'search',actors:[fixture.actor]});
  await reload(player);assert.equal(await b.eval('canvas.scene.getFlag("mjl-pointcrawl","state").active.id',player),pending);
  await send(gm,'reject',{requestId:pending});pass('Pending request and explored map survive player reconnect');
  await ev(gm,async()=>{const m=await import('/modules/mjl-pointcrawl/scripts/canvas.mjs');await m.useTool({action:'preview'});await game.modules.get('mjl-pointcrawl').api.open().close();canvas.pan({x:1200,y:650,scale:.65});ui.notifications.clear();});
  await screenshot('gm-player-preview',gm);
  await ev(player,()=>{canvas.pan({x:1250,y:700,scale:.9});});await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:40,y:210},player);
  await screenshot('player-pan-zoom',player);
  await ev(gm,()=>{game.modules.get('mjl-pointcrawl').api.open();});
  await waitState(gm,'!!document.querySelector(".mjl-app .mjl-shell")');
  await ev(gm,()=>game.modules.get('mjl-pointcrawl').api.open().setPosition({left:75,top:70,width:880,height:720}));
  await screenshot('gm-completed',gm);
  const errors=b.events.filter(e=>e.method==='Runtime.exceptionThrown');
  assert.equal(errors.length,0,JSON.stringify(errors));pass('No uncaught browser JavaScript errors across GM and player workflows');
  report.success=true;report.versions={foundry:'14.361',dnd5e:'5.3.3',socketlib:'1.1.4'};report.fixture=fixture;
} catch(e) {
  report.success=false;report.error=e.stack;
  console.error(e);
  for(const [name,s] of [['gm-failure',gm],['player-failure',player]])if(s){try{await screenshot(name,s);}catch{}}
  const errors=b.events.filter(e=>e.method==='Runtime.exceptionThrown');console.error(JSON.stringify(errors));process.exitCode=1;
} finally {
  await mkdir('mjl-pointcrawl/dev',{recursive:true});await writeFile('mjl-pointcrawl/dev/foundry-report.json',JSON.stringify(report,null,2));
  for(const id of contexts)await b.call('Target.disposeBrowserContext',{browserContextId:id}).catch(()=>{});
  b.close();
}
