import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {browser} from './cdp.mjs';
const b=await browser(),report={passed:[]},contexts=[];let gm,player;
const ev=(s,fn,args)=>b.eval(`(${fn.toString()})(${JSON.stringify(args??null)})`,s);
const pass=name=>{report.passed.push(name);console.log(`PASS ${name}`);};
const until=(s,code)=>b.until(code,s,60000);
const send=(s,action,args={})=>ev(s,async({action,args})=>(await import('/modules/mjl-pointcrawl/scripts/store.mjs')).request(action,args),{action,args});
async function join(name,context) {
  const s=await b.page('http://127.0.0.1:30010/join',context);
  await until(s,'!!document.querySelector("select[name=userid]")');
  await ev(s,name=>{const input=document.querySelector('select[name=userid]');input.value=[...input.options].find(o=>o.text===name).value;document.querySelector('button[name=join]').click();},name);
  await b.until('globalThis.game?.ready&&canvas.ready',s,300000);
  await b.eval('game.user.sheet.close();ui.notifications.clear()',s);return s;
}
async function click(s,x,y) {
  const p=await ev(s,({x,y})=>{const p=canvas.stage.toGlobal(new PIXI.Point(x,y));return {x:p.x,y:p.y};},{x,y});
  await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',...p},s);await new Promise(r=>setTimeout(r,250));
  await b.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...p},s);
  await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...p},s);
}
const privateRegion=(s,id)=>ev(s,async id=>(await import('/modules/mjl-pointcrawl/scripts/store.mjs')).privateData(canvas.scene).regions[id],id);
const marker=(s,name)=>ev(s,name=>{const visit=c=>c.name===name?c:(c.children??[]).map(visit).find(Boolean);const c=visit(canvas.stage.getChildByName('mjl-pointcrawl'));return c?{name:c.name,text:c.text}:null;},name);
async function approveLocal(id,minutes) {
  await until(gm,`!!document.querySelector('#mjl-pointcrawl-request-${id} [data-form=approve]')`);
  await ev(gm,({id,minutes})=>{const form=document.querySelector(`#mjl-pointcrawl-request-${id} [data-form=approve]`);form.elements.minutes.value=minutes;form.requestSubmit();},{id,minutes});
  await until(player,`canvas.scene.getFlag('mjl-pointcrawl','state').active?.status==='approved'`);
}
async function finishMotion(id,f,target) {
  for(const s of [gm,player])await ev(s,token=>{
    globalThis.__motion=[];globalThis.__track=Hooks.on('updateToken',(doc,_change,options)=>{
      if(doc.id!==token||!options.mjlPointcrawlArrival)return;
      const start=performance.now(),sample=()=>{__motion.push({x:doc.object.x,y:doc.object.y,targetX:doc.x});if(performance.now()-start<2500)setTimeout(sample,30);};sample();
    });
  },f.token);
  const before=await b.eval('game.time.worldTime',gm);
  await ev(gm,id=>document.querySelector(`#mjl-pointcrawl-request-${id} [data-pc-action=finish]`).click(),id);
  await until(player,'!canvas.scene.getFlag("mjl-pointcrawl","state").active');
  for(const s of [gm,player]) {
    const end=target.x-50;
    await until(s,`__motion.some(p=>Math.abs(p.x-__motion[0].x)>2&&Math.abs(p.x-${end})>2)`);
    const samples=await b.eval('__motion',s),origin=samples[0];
    assert(samples.some(p=>Math.abs(p.x-origin.x)>2&&Math.abs(p.x-end)>2),JSON.stringify(samples));
    await until(s,`Math.abs(canvas.scene.tokens.get('${f.token}').object.x-${end})<1`);
    await until(s,`document.querySelector('#mjl-pointcrawl-arrival')?.textContent===${JSON.stringify(target.name)}`);
    assert.equal(await b.eval('getComputedStyle(document.querySelector("#mjl-pointcrawl-arrival")).pointerEvents',s),'none');
    await b.eval('Hooks.off("updateToken",__track)',s);
  }
  return before;
}
try {
  for(const t of (await b.call('Target.getTargets')).targetInfos)if(t.type==='page'&&t.url.includes('127.0.0.1:30010/'))await b.call('Target.closeTarget',{targetId:t.targetId});
  gm=await join('Gamemaster');assert.equal(await b.eval('game.world.id',gm),'pointcrawl-test');b.events=[];
  const f=await ev(gm,async()=>{
    const m=await import('/modules/mjl-pointcrawl/scripts/store.mjs');
    const user=game.users.find(u=>u.name==='Pointcrawl Player')??await User.create({name:'Pointcrawl Player',role:1});
    const hero=await Actor.create({name:'Следопыт · локации',type:'character',ownership:{[user.id]:3}});await user.update({character:hero.id});
    const group=await Actor.create({name:'Группа · локации',type:'group',ownership:{[user.id]:3},system:{members:[{actor:hero.id}]}});
    const scene=await Scene.create({name:'Pointcrawl · локации и плавное движение',width:2400,height:1600,grid:{type:0,size:100},tokenVision:true,backgroundColor:'#61755c'});
    const regions=await scene.createEmbeddedDocuments('Region',[{name:'one',shapes:[{type:'rectangle',x:400,y:400,width:800,height:800}]},{name:'two',shapes:[{type:'rectangle',x:1200,y:400,width:800,height:800}]}]);
    const one=regions.find(r=>r.name==='one'),two=regions.find(r=>r.name==='two');
    await m.request('enable',{enabled:true},scene);
    await m.request('region',{regionId:one.id,values:{name:'Зелёная долина',center:{x:600,y:600},explored:true}},scene);
    const secretForest=`SECRET_FOREST_LOC_${scene.id}`;
    await m.request('region',{regionId:two.id,values:{name:secretForest,center:{x:1600,y:600}}},scene);
    await m.request('location',{regionId:one.id,values:{name:'SECRET_CAVE_LOC',notes:'SECRET_NOTES_LOC',description:'',x:700,y:1000,revealed:false}},scene);
    await m.request('route',{from:one.id,to:two.id,seconds:5400,risk:false},scene);
    const [token]=await scene.createEmbeddedDocuments('Token',[(await group.getTokenDocument({x:550,y:550,width:1,height:1})).toObject()]);await m.request('party',{tokenId:token.id},scene);
    await scene.activate();game.togglePause(false,{broadcast:true});return {scene:scene.id,one:one.id,two:two.id,token:token.id,hero:hero.id,secretForest};
  });
  await until(gm,`canvas.ready&&canvas.scene.id==='${f.scene}'`);
  await ev(gm,async f=>{await ui.controls.activate({control:'mjl-pointcrawl',tool:'inspect'});canvas.pan({x:1100,y:800,scale:.7});(await import('/modules/mjl-pointcrawl/scripts/app.mjs')).PointcrawlApp.open({regionId:f.one});},f);
  await until(gm,'!!document.querySelector("#mjl-pointcrawl-manager [data-form=region]")');
  const themes=await ev(gm,()=>{
    const app=document.querySelector('#mjl-pointcrawl-manager'),before=document.body.className,result=[];
    for(const theme of ['theme-dark','theme-light']) {
      document.body.classList.remove('theme-dark','theme-light');document.body.classList.add(theme);
      const select=app.querySelector('[name=terrain]'),option=select.options[0],style=getComputedStyle(option);
      result.push({theme,scheme:getComputedStyle(select).colorScheme,background:style.backgroundColor,color:style.color});
    }
    document.body.className=before;return result;
  });
  assert.equal(themes[0].scheme,'dark');assert.equal(themes[1].scheme,'light');
  assert.notEqual(themes[0].background,themes[1].background);assert(themes.every(t=>t.background!==t.color&&!t.background.includes('rgba')));
  pass('Native select options use opaque matching backgrounds and readable text in dark and light application themes');
  await b.eval('document.querySelector("#mjl-pointcrawl-manager [data-pc-action=location]:not([data-id])").click()',gm);
  await until(gm,'!!document.querySelector("[data-location-pick]")');
  await ev(gm,()=>{const form=document.querySelector('[data-location-pick]').form;form.elements.name.value='Родник';form.elements.description.value='Вода у старого дуба';form.elements.notes.value='SECRET_SPRING_LOC';form.elements.revealed.checked=true;form.querySelector('[data-location-pick]').click();});
  await until(gm,'!document.querySelector("[data-location-pick]")&&!document.querySelector("#mjl-pointcrawl-manager")');
  await click(gm,1500,850);
  assert.equal(await b.eval('!!document.querySelector("[data-location-pick]")',gm),false);
  await b.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},gm);
  await b.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},gm);
  await until(gm,'!!document.querySelector("[data-location-pick]")');
  assert.equal(await b.eval('document.querySelector("[data-location-pick]").form.elements.description.value',gm),'Вода у старого дуба');
  pass('Invalid map click is refused; Escape restores the unsaved location form');
  await b.eval('document.querySelector("[data-location-pick]").click()',gm);
  await until(gm,'!document.querySelector("[data-location-pick]")');await click(gm,1000,850);
  await until(gm,'!!document.querySelector("[data-location-pick]")');
  assert.equal(await b.eval('Math.round(document.querySelector("[data-location-pick]").form.elements.x.value)',gm),1000);
  const layout=await ev(gm,()=>{
    const root=document.querySelector('.mjl-location-layout'),form=root.closest('form');
    const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
    return {root:box(root),textareas:[...root.querySelectorAll('textarea')].map(box),name:box(form.elements.name),nameLabel:box(form.elements.name.closest('label')),checkbox:box(form.elements.showName),save:box(form.querySelector('[data-action=ok]')),viewport:innerHeight};
  });
  assert(layout.textareas.every(r=>r.width>layout.root.width*.95));
  assert(layout.name.y>layout.nameLabel.y+12);assert(layout.checkbox.width<32);
  assert(layout.save.bottom<layout.viewport-8);
  pass('Location editor aligns labels and full-width text fields; checkboxes and Save fit the window');
  await b.screenshot('mjl-pointcrawl/dev/location-editor.png',gm);
  await b.eval('document.querySelector("[data-location-pick]").form.querySelector("[data-action=ok]").click()',gm);
  await until(gm,`(async()=>!!(await import('/modules/mjl-pointcrawl/scripts/store.mjs')).privateData(canvas.scene).regions['${f.one}'].locations.find(l=>l.name==='Родник'))()`);
  const spring=(await privateRegion(gm,f.one)).locations.find(l=>l.name==='Родник');assert.equal(spring.notes,'SECRET_SPRING_LOC');assert.equal(Math.round(spring.y),850);
  pass('Location is placed with a real map click and preserves its name, description and secret notes');
  const context=(await b.call('Target.createBrowserContext')).browserContextId;contexts.push(context);player=await join('Pointcrawl Player',context);
  await ev(player,async()=>{await ui.controls.activate({control:'mjl-pointcrawl'});canvas.pan({x:1100,y:800,scale:.7});});
  await ev(player,async()=>{for(let i=0;i<3;i++){await ui.controls.activate({control:'tokens'});await ui.controls.activate({control:'mjl-pointcrawl',tool:'travel'});}});
  assert.equal(await b.eval('!!document.querySelector("[data-tool=togglePalette], [data-tool=inspect], [data-tool=select]")',player),false);
  assert.equal(await b.eval('ui.controls.tool.name',player),'travel');
  const publicData=await b.eval('JSON.stringify({scene:canvas.scene.toObject(),messages:game.messages.contents,journals:game.journal.contents})',player);
  for(const secret of [f.secretForest,'SECRET_CAVE_LOC','SECRET_NOTES_LOC','SECRET_SPRING_LOC'])assert(!publicData.includes(secret),secret);
  pass('Player has travel and hub controls; palette and region selectors are hidden and secrets remain private');
  assert.equal((await marker(player,`location-name-${spring.id}`))?.text,'Родник');
  const routeLabel=await ev(player,()=>canvas.stage.getChildByName('mjl-pointcrawl').children.filter(c=>c.name?.startsWith('route-time-')).map(c=>c.getChildByName('duration').text));assert.deepEqual(routeLabel,['1 ч 30 мин']);
  await send(gm,'region',{regionId:f.one,values:{showName:false}});
  await send(gm,'location',{regionId:f.one,locationId:spring.id,values:{...spring,showName:false}});
  await until(player,`!canvas.scene.getFlag('mjl-pointcrawl','state').regions.find(r=>r.id==='${f.one}').showName`);
  await ev(player,()=>Hooks.callAll('mjl-pointcrawl.refresh'));
  await until(player,`!canvas.stage.getChildByName('mjl-pointcrawl').getChildByName('region-point-${f.one}').children.some(c=>c.name==='region-name-${f.one}')`);
  await until(player,`!canvas.scene.getFlag('mjl-pointcrawl','state').regions.find(r=>r.id==='${f.one}').locations.find(l=>l.id==='${spring.id}').showName&&!canvas.stage.getChildByName('mjl-pointcrawl').getChildByName('location-point-${spring.id}').children.some(c=>c.name==='location-name-${spring.id}')`);
  assert.equal(await marker(player,`location-name-${spring.id}`),null);assert(await marker(player,`location-point-${spring.id}`));
  pass('Routes show normal travel time; centre and location names can be hidden without hiding the points');
  await ev(gm,async()=>{for(const a of [ ...(await import('/modules/mjl-pointcrawl/scripts/app.mjs')).RequestWindow.windows.values(),(await import('/modules/mjl-pointcrawl/scripts/app.mjs')).PointcrawlApp.instance])if(a?.rendered)await a.close();});
  await click(player,1000,850);
  let id=await until(gm,'canvas.scene.getFlag("mjl-pointcrawl","state").active?.id');
  assert.equal(await b.eval('canvas.scene.getFlag("mjl-pointcrawl","state").active.kind',player),'local');
  assert.equal(await ev(player,f=>canvas.scene.tokens.get(f.token).x,f),550);
  await assert.rejects(()=>send(gm,'approve',{requestId:id}),/число/);
  await approveLocal(id,25);
  assert.equal(await b.eval('canvas.scene.getFlag("mjl-pointcrawl","state").active.seconds',player),1500);
  assert.equal(await ev(player,id=>!!document.querySelector(`#mjl-pointcrawl-request-${id} [data-pc-action=perform]`),id),false);
  const before=await finishMotion(id,f,{x:1000,y:850,name:'Родник'});assert.equal(await b.eval('game.time.worldTime',gm),before+1500);
  await b.screenshot('mjl-pointcrawl/dev/arrival-location-player.png',player);
  await assert.rejects(()=>send(gm,'finish',{requestId:id}),/не готова/);
  pass('Location click creates a request; GM supplies time, no navigation roll, both clients animate movement');
  await ev(player,async()=>{const m=await import('/modules/mjl-pointcrawl/scripts/app.mjs');for(const a of m.RequestWindow.windows.values())if(a.rendered)await a.close();m.TravelCentre.open();});
  await until(player,'!!document.querySelector("#mjl-pointcrawl-centre [data-pc-action=local]:not([data-id])")');
  await b.eval('document.querySelector("#mjl-pointcrawl-centre [data-pc-action=local]:not([data-id])").click()',player);
  id=await until(gm,'canvas.scene.getFlag("mjl-pointcrawl","state").active?.id');await approveLocal(id,10);
  await finishMotion(id,f,{x:600,y:600,name:'Зелёная долина'});
  pass('Travel centre supports returning from a location to the region centre through the same workflow');
  await ev(player,async f=>{const m=await import('/modules/mjl-pointcrawl/scripts/app.mjs');for(const a of [m.TravelCentre.instance,...m.RequestWindow.windows.values()])if(a?.rendered)await a.close();await canvas.scene.tokens.get(f.token).update({x:950,y:800});},f);
  for(const client of [gm,player]) {
    for(const destination of [{x:650,y:650},{x:950,y:800},{x:1550,y:550}])await ev(client,async({f,destination})=>{await canvas.scene.tokens.get(f.token).update(destination);},{f,destination});
    assert.deepEqual(await ev(client,f=>{const t=canvas.scene.tokens.get(f.token);return {x:t.x,y:t.y};},f),{x:550,y:550});
    assert.equal(await b.eval('canvas.scene.getFlag("mjl-pointcrawl","state").active',client),null);
  }
  pass('Manual movement inside a region, onto a location or across a boundary is blocked for GM/player and creates no request');
  id=await send(player,'create',{kind:'travel',to:f.two,actors:[f.hero]});
  await until(gm,`!!document.querySelector('#mjl-pointcrawl-request-${id} [data-form=approve]')`);
  await send(gm,'approve',{requestId:id,risk:false});
  await until(gm,`!!document.querySelector('#mjl-pointcrawl-request-${id} [data-pc-action=finish]')`);
  await finishMotion(id,f,{x:1600,y:600,name:f.secretForest});
  assert.equal(await b.eval('canvas.scene.getFlag("mjl-pointcrawl","state").currentRegionId',player),f.two);
  pass('Inter-region arrival is also animated for GM and player');
  await b.screenshot('mjl-pointcrawl/dev/locations-player.png',player);
  for(const s of [gm,player]) {await b.eval('globalThis.__arrivalReload=true;location.reload()',s);await b.until('!globalThis.__arrivalReload&&game?.ready&&canvas.ready',s,180000);assert.equal(await b.eval('!!document.querySelector("#mjl-pointcrawl-arrival")',s),false);}
  pass('Arrival titles show the destination in both clients after movement, do not block clicks and do not replay after reload');
  const errors=b.events.filter(e=>e.method==='Runtime.exceptionThrown');assert.equal(errors.length,0,JSON.stringify(errors));pass('No uncaught JavaScript errors in location and movement workflows');report.success=true;report.fixture=f;
} catch(e) {report.success=false;report.error=e.stack;console.error(e);process.exitCode=1;for(const [name,s] of [['locations-gm-failure',gm],['locations-player-failure',player]])if(s)await b.screenshot(`mjl-pointcrawl/dev/${name}.png`,s).catch(()=>{});
} finally {await writeFile('mjl-pointcrawl/dev/locations-report.json',JSON.stringify(report,null,2));for(const id of contexts)await b.call('Target.disposeBrowserContext',{browserContextId:id}).catch(()=>{});b.close();}
