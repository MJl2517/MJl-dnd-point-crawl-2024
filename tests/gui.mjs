import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {browser} from "./cdp.mjs";
const report={passed:[]},b=await browser(),contexts=[];
const fixture=JSON.parse(await readFile('mjl-pointcrawl/dev/foundry-report.json','utf8')).fixture;
assert(fixture,'Run the Foundry smoke test first');
const ev=(s,fn,arg)=>b.eval(`(${fn.toString()})(${JSON.stringify(arg??null)})`,s);
const pass=name=>{report.passed.push(name);console.log(`PASS ${name}`);};
const until=(s,code)=>b.until(code,s,60000);
async function click(s,selector) {
  await until(s,"(async()=>!(await import('/modules/mjl-pointcrawl/scripts/app.mjs')).PointcrawlApp.instance?.busy)()");
  await ev(s,selector=>document.querySelector(selector).click(),selector);
}
async function join(s,name){await until(s,'document.querySelector("select[name=userid]")');await ev(s,name=>{const select=document.querySelector('select[name=userid]');select.value=[...select.options].find(o=>o.text===name).value;document.querySelector('button[name=join]').click();},name);await b.until('game?.ready && canvas.ready',s,120000);await ev(s,()=>{game.user.sheet.close();ui.notifications.clear();});}
async function p(s,x,y){return ev(s,({x,y})=>{const p=canvas.stage.toGlobal(new PIXI.Point(x,y));return {x:p.x,y:p.y};},{x,y});}
async function mouse(s,type,at,extra={}) {await b.call('Input.dispatchMouseEvent',{type,x:at.x,y:at.y,...extra},s);}
async function mouseClick(s,at,count=1) {await mouse(s,'mouseMoved',at);await new Promise(r=>setTimeout(r,200));await mouse(s,'mousePressed',at,{button:'left',buttons:1,clickCount:count});await mouse(s,'mouseReleased',at,{button:'left',buttons:0,clickCount:count});}
async function drag(s,a,z){await mouse(s,'mouseMoved',a);await mouse(s,'mousePressed',a,{button:'left',buttons:1,clickCount:1});for(let i=1;i<=8;i++){await mouse(s,'mouseMoved',{x:a.x+(z.x-a.x)*i/8,y:a.y+(z.y-a.y)*i/8},{button:'left',buttons:1});await new Promise(r=>setTimeout(r,60));}await new Promise(r=>setTimeout(r,200));await mouse(s,'mouseReleased',z,{button:'left',buttons:0,clickCount:1});}
let gm,player;
try {
  const target=(await b.call('Target.getTargets')).targetInfos.find(t=>t.type==='page'&&t.url.startsWith('http://127.0.0.1:30010/'));
  gm=(await b.call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;await b.call('Runtime.enable',{},gm);await b.call('Page.enable',{},gm);
  await b.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},gm);
  await b.eval('globalThis.__reload=true;location.reload()',gm);await until(gm,'!globalThis.__reload && game?.ready && canvas.ready');b.events=[];
  assert.equal(await b.eval('game.world.id',gm),'pointcrawl-test');
  await ev(gm,async f=>{await game.scenes.get(f.scene).view();game.togglePause(false,{broadcast:true});ui.notifications.clear();const m=await import('/modules/mjl-pointcrawl/scripts/private.mjs');await m.initializePrivate(true);},fixture);
  await until(gm,`canvas.ready && canvas.scene.id === ${JSON.stringify(fixture.scene)}`);
  await ev(gm,f=>{canvas.scene.tokens.get(f.token).sheet.render({force:true});},fixture);
  await until(gm,'!!document.querySelector(".mjl-token-setting input")');
  assert.equal(await b.eval('document.querySelector(".mjl-token-setting input").checked',gm),true);
  await ev(gm,async f=>{await canvas.scene.tokens.get(f.token).sheet.close();},fixture);pass('Token Configuration contains the enabled Pointcrawl group checkbox');
  await ev(gm,()=>{game.modules.get('mjl-pointcrawl').api.open();});await until(gm,'!!document.querySelector(".mjl-app")');
  await ev(gm,()=>game.modules.get('mjl-pointcrawl').api.open().setPosition({left:70,top:60,width:880,height:760}));
  await click(gm,'[data-pc-action=tab][data-tab=regions]');await until(gm,'!!document.querySelector(".mjl-manager")');
  await click(gm,`[data-pc-action=region][data-id="${fixture.two}"]`);await until(gm,`document.querySelector('[data-form=region]')?.dataset.id === ${JSON.stringify(fixture.two)}`);
  const secret=`SECRET_GUI_${fixture.scene}`;
  await ev(gm,secret=>{const form=document.querySelector('[data-form=region]');form.elements.notes.value=secret;form.elements.description.value='Лесной путь среди старых дубов.';form.requestSubmit();},secret);
  await until(gm,`(async()=>{const a=await import('/modules/mjl-pointcrawl/scripts/app.mjs'),s=await import('/modules/mjl-pointcrawl/scripts/store.mjs');return !a.PointcrawlApp.instance.busy && s.privateData(canvas.scene).regions[${JSON.stringify(fixture.two)}].notes===${JSON.stringify(secret)};})()`);
  await b.screenshot('mjl-pointcrawl/dev/gm-region-editor.png',gm);pass('Region form saves public description and separate GM notes through the real UI');
  await click(gm,'[data-pc-action=tab][data-tab=tables]');await until(gm,'!!document.querySelector("textarea[name=json]")');
  await ev(gm,()=>{document.querySelector('textarea[name=json]').value=JSON.stringify({schemaVersion:1,name:'Таблица из интерфейса',results:[{weight:1,title:'Путник',text:'На тропе появляется одинокий путник.'}]});});
  await click(gm,'[data-pc-action=previewImport]');await until(gm,'!document.querySelector("[data-pc-action=importTable]").disabled');
  assert.equal(await b.eval('document.querySelector(".mjl-import-preview").innerText.includes("Путник")',gm),true);
  await click(gm,'[data-pc-action=importTable]');await until(gm,'!!game.tables.find(t=>t.name === "Таблица из интерфейса")');pass('JSON file-text preview and import button produce a native RollTable');
  await click(gm,'[data-pc-action=tab][data-tab=regions]');await until(gm,'!!document.querySelector("[data-pc-action=draw]")');
  const count=await b.eval('canvas.scene.regions.size',gm);
  await click(gm,'[data-pc-action=draw]');await until(gm,'ui.controls.control?.name === "mjl-pointcrawl" && ui.controls.tool?.name === "polygon"');
  await ev(gm,()=>{canvas.pan({x:750,y:1300,scale:.9});});
  const a=await p(gm,550,1150),z=await p(gm,850,1150);
  await drag(gm,a,z);await mouseClick(gm,await p(gm,850,1150));await mouseClick(gm,await p(gm,850,1450));await mouseClick(gm,await p(gm,550,1450));await mouseClick(gm,await p(gm,550,1150));
  await until(gm,`canvas.scene.regions.size > ${count}`);
  await until(gm,'!!document.querySelector("[data-form=region]")');
  const newRegion=await b.eval('document.querySelector("[data-form=region]").dataset.id',gm);
  await click(gm,'[data-pc-action=center]');await until(gm,'ui.controls.tool?.name === "center"');
  await mouseClick(gm,await p(gm,700,1300));await until(gm,'!!document.querySelector("[data-form=region]")');
  assert(Math.abs(await ev(gm,async id=>(await import('/modules/mjl-pointcrawl/scripts/store.mjs')).privateData(canvas.scene).regions[id].center.x,newRegion)-700)<2);
  await ev(gm,async()=>{const app=(await import('/modules/mjl-pointcrawl/scripts/app.mjs')).PointcrawlApp.instance;await app.close();});
  pass('Native polygon drawing, adoption and centre placement work with real mouse input');
  await ev(gm,async()=>{(await import('/modules/mjl-pointcrawl/scripts/app.mjs')).PointcrawlApp.open({tab:'routes'});});
  await click(gm,'[data-pc-action=route]:not([data-id])');
  await until(gm,'!!document.querySelector(".mjl-dialog input[name=hours]")');
  await ev(gm,({from,to})=>{const form=document.querySelector('.mjl-dialog input[name=hours]').form;form.elements.from.value=from;form.elements.to.value=to;form.querySelector('button[type=submit]').click();},{from:fixture.two,to:newRegion});
  await until(gm,`canvas.scene.getFlag('mjl-pointcrawl','state').routes.some(r=>r.from===${JSON.stringify(newRegion)}||r.to===${JSON.stringify(newRegion)})`);pass('Manager route form connects selected regions without a map-connection tool');
  const ctx=(await b.call('Target.createBrowserContext')).browserContextId;contexts.push(ctx);player=await b.page('http://127.0.0.1:30010/join',ctx);await join(player,'Pointcrawl Player');
  assert.equal(await b.eval('JSON.stringify(game.journal.contents).includes("SECRET_GUI_")',player),false);
  await ev(player,async()=>{await ui.controls.activate({control:'tokens',tool:'select'});canvas.pan({x:1000,y:950,scale:.7});});
  await until(player,'ui.controls.control?.name === "tokens"');
  await new Promise(r=>setTimeout(r,300));
  const tokenStart=await ev(player,f=>({x:canvas.scene.tokens.get(f.token).x,y:canvas.scene.tokens.get(f.token).y}),fixture);
  const pa=await p(player,1200,650),pz=await p(player,700,1300);
  await drag(player,pa,pz);
  assert.equal(await b.eval('canvas.scene.getFlag("mjl-pointcrawl","state").active',gm),null);
  await ev(player,async to=>{const u=await import("/modules/mjl-pointcrawl/scripts/app.mjs");await u.TravelCentre.open().render({force:true});document.querySelector(`#mjl-pointcrawl-centre [data-pc-action=travel][data-to="${to}"]`).click();},newRegion);
  await until(gm,'!!canvas.scene.getFlag("mjl-pointcrawl","state").active');
  const pending=await b.eval('canvas.scene.getFlag("mjl-pointcrawl","state").active',gm);assert.equal(pending.to,newRegion);
  assert.deepEqual(await ev(player,f=>({x:canvas.scene.tokens.get(f.token).x,y:canvas.scene.tokens.get(f.token).y}),fixture),tokenStart);
  await b.screenshot('mjl-pointcrawl/dev/player-real-drag.png',player);pass('Real player drag is blocked; the travel-centre button creates a request without moving the token');
  await ev(gm,async id=>(await import('/modules/mjl-pointcrawl/scripts/store.mjs')).request('reject',{requestId:id}),pending.id);
  await until(player,'!canvas.scene.getFlag("mjl-pointcrawl","state").active');
  const recoveryUser=await ev(gm,async()=>{const u=game.users.find(u=>u.name==='ZZ Pointcrawl Recovery')??await User.create({name:'ZZ Pointcrawl Recovery',role:4});return u.id;});
  const takeoverRequest=await ev(player,async f=>(await import('/modules/mjl-pointcrawl/scripts/store.mjs')).request('create',{kind:'search',actors:[f.actor]}),fixture);
  const recoveryContext=(await b.call('Target.createBrowserContext')).browserContextId;contexts.push(recoveryContext);
  const recovery=await b.page('http://127.0.0.1:30010/join',recoveryContext);await join(recovery,'ZZ Pointcrawl Recovery');
  await b.eval('game.logOut()',gm).catch(()=>{});
  await until(recovery,'game.users.activeGM?.isSelf');
  await ev(recovery,async id=>(await import('/modules/mjl-pointcrawl/scripts/store.mjs')).request('reject',{requestId:id}),takeoverRequest);
  await until(player,'!canvas.scene.getFlag("mjl-pointcrawl","state").active');pass('Second GM takes over a persisted request after the first GM logs out');
  await b.call('Target.disposeBrowserContext',{browserContextId:recoveryContext});contexts.splice(contexts.indexOf(recoveryContext),1);
  await join(gm,'Gamemaster');
  await ev(player,()=>{ui.notifications.clear();canvas.pan({x:1200,y:650,scale:.65});});
  await b.screenshot('mjl-pointcrawl/dev/player-final-map.png',player);
  const errors=b.events.filter(e=>e.method==='Runtime.exceptionThrown');assert.equal(errors.length,0,JSON.stringify(errors));pass('No uncaught JavaScript errors in toolbar, editing, drawing, drag or GM takeover');
  report.success=true;
}catch(e){report.success=false;report.error=e.stack;console.error(e);console.error(JSON.stringify(b.events.filter(e=>e.method==='Runtime.exceptionThrown')));if(gm)try{await b.screenshot('mjl-pointcrawl/dev/gui-failure.png',gm);}catch{}process.exitCode=1;}
finally{for(const id of contexts)await b.call('Target.disposeBrowserContext',{browserContextId:id}).catch(()=>{});await writeFile('mjl-pointcrawl/dev/gui-report.json',JSON.stringify(report,null,2));b.close();}
