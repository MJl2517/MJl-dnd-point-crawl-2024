import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {browser} from './cdp.mjs';
// Run after tests/locations.mjs, only in the isolated pointcrawl-test world.
const baseline=JSON.parse(await readFile('mjl-pointcrawl/dev/locations-report.json','utf8'));
assert(baseline.success,'Run tests/locations.mjs first');
const b=await browser(),contexts=[],report={passed:[]};let gm,player,navigator;
const ev=(s,fn,args)=>b.eval(`(${fn.toString()})(${JSON.stringify(args??null)})`,s);
const until=(s,code)=>b.until(code,s,60000);
const pass=name=>{report.passed.push(name);console.log(`PASS ${name}`);};
const send=(s,action,args={})=>ev(s,async({action,args})=>(await import('/modules/mjl-pointcrawl/scripts/store.mjs')).request(action,args),{action,args});
async function join(name) {
  const context=(await b.call('Target.createBrowserContext')).browserContextId;contexts.push(context);
  const s=await b.page('http://127.0.0.1:30010/join',context);
  await until(s,'!!document.querySelector("select[name=userid]")');
  await ev(s,name=>{const input=document.querySelector('select[name=userid]');input.value=[...input.options].find(o=>o.text===name).value;document.querySelector('button[name=join]').click();},name);
  await b.until('globalThis.game?.ready&&canvas.ready',s,300000);await b.eval('game.user.sheet.close();ui.notifications.clear()',s);return s;
}
async function centre(s) {await ev(s,async()=>{(await import('/modules/mjl-pointcrawl/scripts/app.mjs')).TravelCentre.open();});await until(s,'!!document.querySelector("#mjl-pointcrawl-centre .mjl-shell")');}
async function create(s,selector) {await ev(s,selector=>document.querySelector(selector).click(),selector);return until(gm,'canvas.scene.getFlag("mjl-pointcrawl","state").active?.id');}
async function approve(id,{hours,minutes,risk,dc=100,actor}) {
  await until(gm,`!!document.querySelector('#mjl-pointcrawl-request-${id} [data-form=approve]')`);
  await ev(gm,({id,hours,minutes,risk,dc,actor})=>{
    const form=document.querySelector(`#mjl-pointcrawl-request-${id} [data-form=approve]`);
    if(form.elements.hours){form.elements.hours.value=hours;form.elements.minutes.value=minutes;}
    form.elements.risk.checked=risk;if(form.elements.dc)form.elements.dc.value=dc;
    if(actor)form.querySelector(`[name=actor][value="${actor}"]`).checked=true;
    form.requestSubmit();
  },{id,hours,minutes,risk,dc,actor});
  await until(player,'canvas.scene.getFlag("mjl-pointcrawl","state").active?.status==="approved"');
}
async function finish(id) {await until(gm,`!!document.querySelector('#mjl-pointcrawl-request-${id} [data-pc-action=finish]')`);await ev(gm,id=>document.querySelector(`#mjl-pointcrawl-request-${id} [data-pc-action=finish]`).click(),id);await until(player,'!canvas.scene.getFlag("mjl-pointcrawl","state").active');}
try {
  const pages=(await b.call('Target.getTargets')).targetInfos.filter(t=>t.type==='page'&&t.url.includes('127.0.0.1:30010/game'));
  const target=pages[0];gm=(await b.call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  await b.call('Runtime.enable',{},gm);assert.equal(await b.eval('game.world.id',gm),'pointcrawl-test');assert.equal(await b.eval('game.user.isGM',gm),true);
  for(const t of pages.slice(1))await b.call('Target.closeTarget',{targetId:t.targetId});
  await b.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},gm);
  const f=await ev(gm,async f=>{
    const s=await import('/modules/mjl-pointcrawl/scripts/store.mjs');await game.scenes.get(f.scene).activate();const previous=s.state(canvas.scene).active;if(previous?.status==='pending')await s.request('reject',{requestId:previous.id});await s.request('journeySettings',{hours:0,minutes:0,profile:{mode:'walk'}});await s.request('route',{from:f.one,to:f.two,seconds:5400,risk:true,road:false});
    const user=game.users.find(u=>u.name==='Pointcrawl Navigator')??await User.create({name:'Pointcrawl Navigator',role:1});
    const actor=await Actor.create({name:'Проводник · по умолчанию',type:'character',ownership:{[user.id]:3},system:{abilities:{wis:{value:14}}}});
    await user.update({character:actor.id});
    const token=canvas.scene.tokens.get(f.token);await token.actor.update({'system.members':[{actor:f.hero},{actor:actor.id}]});
    await s.request('reposition',{regionId:f.one});
    for(const app of [...(await import('/modules/mjl-pointcrawl/scripts/app.mjs')).RequestWindow.windows.values()])if(app.rendered)await app.close();
    return {...f,guide:actor.id,spring:s.privateData(canvas.scene).regions[f.one].locations.find(l=>l.name==='Родник').id};
  },baseline.fixture);
  await until(gm,`Math.abs(canvas.scene.tokens.get('${f.token}').object.x-550)<1`);
  player=await join('Pointcrawl Player');navigator=await join('Pointcrawl Navigator');b.events=[];
  await centre(player);
  const groups=await ev(player,()=>{const root=document.querySelector('#mjl-pointcrawl-centre');return {local:root.querySelector('[data-exits=locations]').innerText,regions:root.querySelector('[data-exits=regions]').innerText,localButtons:root.querySelectorAll('[data-exits=locations] [data-pc-action=local]').length,wrong:root.querySelectorAll('[data-exits=locations] [data-pc-action=travel], [data-exits=regions] [data-pc-action=local]').length};});
  assert(groups.local.includes('Родник'));assert(groups.regions.includes('Соседние регионы'));assert(groups.localButtons>=2);assert.equal(groups.wrong,0);
  pass('Available exits has separate location and region groups');
  await ev(player,guide=>{const form=document.querySelector('#mjl-pointcrawl-centre [data-form=guide]');form.elements.guide.value=guide;form.requestSubmit();},f.guide);
  await until(gm,`canvas.scene.getFlag('mjl-pointcrawl','state').guideId==='${f.guide}'`);
  await b.eval('globalThis.__reload=true;location.reload()',player);await b.until('!globalThis.__reload&&globalThis.game?.ready&&canvas.ready',player,300000);
  await centre(player);assert.equal(await b.eval('document.querySelector("[data-form=guide] [name=guide]").value',player),f.guide);
  await b.screenshot('mjl-pointcrawl/dev/guide-travel-centre.png',player);
  pass('Party member can assign a guide from Current Region; selection survives reconnect');
  let id=await create(player,`#mjl-pointcrawl-centre [data-exits=locations] [data-id="${f.spring}"]`);
  assert.equal(await b.eval('canvas.scene.getFlag("mjl-pointcrawl","state").active.actors[0].id',player),f.guide);
  await until(gm,`!!document.querySelector('#mjl-pointcrawl-request-${id} [name=hours]')`);
  await ev(gm,id=>{const form=document.querySelector(`#mjl-pointcrawl-request-${id} [data-form=approve]`);form.elements.hours.value=1;form.elements.minutes.value=25;form.elements.risk.checked=true;form.elements.dc.value=100;form.elements.hours.dispatchEvent(new Event('input',{bubbles:true}));},id);
  await b.screenshot('mjl-pointcrawl/dev/guide-local-request.png',gm);
  const before=await b.eval('game.time.worldTime',gm);
  await approve(id,{hours:1,minutes:25,risk:true});
  await until(navigator,`!!document.querySelector('#mjl-pointcrawl-request-${id} [data-pc-action=perform]')`);
  assert.equal(await b.eval('canvas.scene.getFlag("mjl-pointcrawl","state").active.seconds',gm),5100);
  assert.equal(await ev(player,id=>!!document.querySelector(`#mjl-pointcrawl-request-${id} [data-pc-action=perform]`),id),false);
  await assert.rejects(()=>send(gm,'finish',{requestId:id}),/результатов/);
  pass('Hours/minutes and Can get lost approve a local check for the default guide owner');
  await ev(navigator,id=>document.querySelector(`#mjl-pointcrawl-request-${id} [data-pc-action=perform]`).click(),id);
  await until(navigator,'!!document.querySelector(".application:not(.mjl-app) button[type=submit]")');
  await ev(navigator,()=>{const buttons=[...document.querySelectorAll('.application:not(.mjl-app) button[type=submit]')];(buttons.find(x=>x.dataset.action==='normal')??buttons.at(-1)).click();});
  await until(gm,`!!canvas.scene.getFlag('mjl-pointcrawl','state').active?.outcomes['${f.guide}']`);
  const result=await b.eval('canvas.scene.getFlag("mjl-pointcrawl","state").active',gm);
  assert.equal(result.outcomes[f.guide].success,false);assert(result.penalty>=10&&result.penalty<=60&&result.penalty%10===0);assert.equal(result.seconds,Math.ceil(5100*(1+result.penalty/100)));
  assert.equal(await b.eval('game.time.worldTime',gm),before);
  await finish(id);assert.equal(await b.eval('game.time.worldTime',gm),before+result.seconds);
  await assert.rejects(()=>send(gm,'finish',{requestId:id}),/не готова/);
  assert.equal(await b.eval('game.time.worldTime',gm),before+result.seconds);
  pass('Native local Survival failure adds 1d6 × 10%; arrival charges the resulting duration once');
  await until(player,`!document.querySelector('#mjl-pointcrawl-centre [data-pc-action=local]:not([data-id])').disabled`);
  id=await create(player,'#mjl-pointcrawl-centre [data-exits=locations] [data-pc-action=local]:not([data-id])');
  await approve(id,{hours:0,minutes:10,risk:false});
  assert.equal(await ev(navigator,id=>!!document.getElementById(`mjl-pointcrawl-request-${id}`),id),false);
  const safeBefore=await b.eval('game.time.worldTime',gm);await finish(id);assert.equal(await b.eval('game.time.worldTime',gm),safeBefore+600);
  pass('Unchecked local risk completes with no player check');
  await until(player,`!document.querySelector('#mjl-pointcrawl-centre [data-exits=regions] [data-pc-action=travel]').disabled`);
  id=await create(player,`#mjl-pointcrawl-centre [data-exits=regions] [data-pc-action=travel][data-to="${f.two}"]`);
  assert.equal(await b.eval('canvas.scene.getFlag("mjl-pointcrawl","state").active.actors[0].id',gm),f.guide);
  await approve(id,{risk:false,actor:f.hero});
  assert.equal(await b.eval('canvas.scene.getFlag("mjl-pointcrawl","state").active.actors[0].id',gm),f.hero);
  assert.equal(await b.eval('canvas.scene.getFlag("mjl-pointcrawl","state").guideId',gm),f.guide);
  await send(gm,'reject',{requestId:id});
  pass('Inter-region travel uses the guide too; GM override affects only that request');
  await centre(gm);await centre(navigator);
  await ev(gm,guide=>{
    const form=document.querySelector('#mjl-pointcrawl-centre [data-form=guide]');
    form.elements.guide.value=guide;form.elements.guideOnly.checked=true;form.requestSubmit();
  },f.guide);
  await until(player,'document.querySelector("#mjl-pointcrawl-centre [data-pc-action=travel]")?.disabled&&document.querySelector("[data-form=guide] [name=guide]")?.disabled');
  await assert.rejects(()=>send(player,'create',{kind:'travel',to:f.two,actors:[f.hero]}),/только проводник/);
  await assert.rejects(()=>send(player,'guide',{actorId:f.hero}),/только мастеру/);
  await until(navigator,'canvas.scene.getFlag("mjl-pointcrawl","state").guideOnly&&!document.querySelector("#mjl-pointcrawl-centre [data-pc-action=travel]")?.disabled');
  id=await create(navigator,`#mjl-pointcrawl-centre [data-pc-action=travel][data-to="${f.two}"]`);
  await until(gm,`document.querySelector('#mjl-pointcrawl-request-${id} .mjl-facts')?.textContent.includes("Pointcrawl Navigator")`);
  await until(player,`game.messages.some(m=>m.getFlag("mjl-pointcrawl","requestId")==="${id}"&&m.content.includes("Инициатор")&&m.content.includes("Pointcrawl Navigator"))`);
  await send(gm,'reject',{requestId:id});
  await send(gm,'guide',{actorId:f.guide,guideOnly:false});
  pass('Guide-only mode blocks another player in the UI and on the GM socket, and shows the guide owner as initiator');
  const errors=b.events.filter(e=>e.method==='Runtime.exceptionThrown');assert.equal(errors.length,0,JSON.stringify(errors));pass('No uncaught JavaScript errors across three clients');report.success=true;
} catch(e) {report.success=false;report.error=e.stack;console.error(e);process.exitCode=1;for(const [name,s] of [['guide-gm-failure',gm],['guide-player-failure',player],['guide-navigator-failure',navigator]])if(s)await b.screenshot(`mjl-pointcrawl/dev/${name}.png`,s).catch(()=>{});
} finally {await writeFile('mjl-pointcrawl/dev/guides-report.json',JSON.stringify(report,null,2));for(const id of contexts)await b.call('Target.disposeBrowserContext',{browserContextId:id}).catch(()=>{});b.close();}
