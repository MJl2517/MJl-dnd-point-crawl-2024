import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {browser} from "./cdp.mjs";
const b=await browser(),report={passed:[]};let s;
const ev=(fn,arg)=>b.eval(`(${fn.toString()})(${JSON.stringify(arg??null)})`,s);
const until=code=>b.until(code,s,60000);
const pass=name=>{report.passed.push(name);console.log(`PASS ${name}`);};
async function click(selector) {
  await until("(async()=>!(await import('/modules/mjl-pointcrawl/scripts/app.mjs')).PointcrawlApp.instance?.busy)()");
  await ev(selector=>document.querySelector(selector).click(),selector);
}
async function mapClick(x,y) {
  const at=await ev(({x,y})=>{const p=canvas.stage.toGlobal(new PIXI.Point(x,y));return {x:p.x,y:p.y};},{x,y});
  await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',...at},s);await new Promise(r=>setTimeout(r,250));
  await b.call('Input.dispatchMouseEvent',{type:'mousePressed',...at,button:'left',buttons:1,clickCount:1},s);
  await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',...at,button:'left',buttons:0,clickCount:1},s);
}
async function closeCentre() {await ev(async()=>{await (await import('/modules/mjl-pointcrawl/scripts/app.mjs')).PointcrawlApp.instance?.close();});}
const formFor=id=>`document.querySelector('[data-form=region]')?.dataset.id === ${JSON.stringify(id)}`;
try {
  for(const target of (await b.call('Target.getTargets')).targetInfos)
    if(target.type==='page'&&target.url.startsWith('http://127.0.0.1:30010/'))await b.call('Target.closeTarget',{targetId:target.targetId});
  s=await b.page('http://127.0.0.1:30010/join');
  await until('document.querySelector("select[name=userid]") || globalThis.game?.ready');
  if(!await b.eval('!!globalThis.game?.ready',s)) {
    await ev(()=>{const sel=document.querySelector('select[name=userid]');sel.value=[...sel.options].find(o=>o.text==='Gamemaster').value;document.querySelector('button[name=join]').click();});
    await b.until('globalThis.game?.ready && canvas.ready',s,120000);
  }
  assert.equal(await b.eval('game.world.id',s),'pointcrawl-test');
  b.events=[];
  const sceneId=await ev(async()=>{
    await (await import('/modules/mjl-pointcrawl/scripts/private.mjs')).initializePrivate(true);
    const scene=await Scene.create({name:'Регрессия карточки региона 1.0.1',width:2600,height:1800,grid:{type:0,size:100},tokenVision:true});
    await scene.activate();game.togglePause(false,{broadcast:true});return scene.id;
  });
  await until(`canvas.ready && canvas.scene.id === ${JSON.stringify(sceneId)}`);
  const draw=()=>ev(async()=>{await (await import('/modules/mjl-pointcrawl/scripts/canvas.mjs')).useTool({action:'draw'});});
  await ev(async()=>{await (await import('/modules/mjl-pointcrawl/scripts/store.mjs')).request('enable',{enabled:true});ui.notifications.clear();});
  await draw();
  const one=await ev(async()=>{const [doc]=await canvas.scene.createEmbeddedDocuments('Region',[{name:'Свежий полигон',shapes:[{type:'polygon',points:[400,400,900,400,900,900,400,900]}]}]);return doc.id;});
  await until(formFor(one));
  assert.equal(await ev(async id=>!!(await import('/modules/mjl-pointcrawl/scripts/store.mjs')).privateData(canvas.scene).regions[id],one),false);
  pass('A freshly created polygon opens an editable card before any save or adoption');
  const original=await ev(id=>JSON.stringify(canvas.scene.regions.get(id).toObject().shapes),one);
  await closeCentre();
  await ev(async id=>{await (await import('/modules/mjl-pointcrawl/scripts/canvas.mjs')).useTool({action:'center',regionId:id});canvas.pan({x:650,y:650,scale:.7});},one);
  await mapClick(650,650);
  await until(`(async()=>!!(await import('/modules/mjl-pointcrawl/scripts/store.mjs')).privateData(canvas.scene).regions[${JSON.stringify(one)}]?.center)()`);
  assert.equal(await ev(id=>JSON.stringify(canvas.scene.regions.get(id).toObject().shapes),one),original);
  pass('Centre tool registers an unsaved polygon and preserves its original geometry');
  await draw();
  const two=await ev(async()=>{const [doc]=await canvas.scene.createEmbeddedDocuments('Region',[{name:'Второй полигон',shapes:[{type:'polygon',points:[1200,400,1700,400,1700,900,1200,900]}]}]);return doc.id;});
  await until(formFor(two));
  await ev(()=>{const f=document.querySelector('[data-form=region]');f.elements.name.value='Заполненная карточка';f.elements.notes.value='Сохранить перед установкой центра';f.elements.notes.dispatchEvent(new Event('input',{bubbles:true}));});
  await click('[data-pc-action=center]');await until('ui.controls.tool?.name === "inspect" && !document.querySelector(".mjl-app")');
  await ev(()=>{canvas.pan({x:1450,y:650,scale:.7});});await mapClick(1450,650);
  await until(`(async()=>!!(await import('/modules/mjl-pointcrawl/scripts/store.mjs')).privateData(canvas.scene).regions[${JSON.stringify(two)}]?.center)()`);
  await until(formFor(two));
  const saved=await ev(async id=>(await import('/modules/mjl-pointcrawl/scripts/store.mjs')).privateData(canvas.scene).regions[id],two);
  assert.equal(saved.name,'Заполненная карточка');assert.equal(saved.notes,'Сохранить перед установкой центра');assert(saved.center);
  pass('Card centre button saves the entered name and GM notes before placing the centre');
  await closeCentre();
  await ev(async()=>{await ui.controls.activate({control:'regions',tool:'polygon'});});
  const three=await ev(async()=>{const [doc]=await canvas.scene.createEmbeddedDocuments('Region',[{name:'Черновик со штатного слоя',shapes:[{type:'polygon',points:[400,1100,900,1100,900,1500,400,1500]}]}]);return doc.id;});
  await ev(async()=>{await ui.controls.activate({control:'mjl-pointcrawl',tool:'inspect'});canvas.pan({x:650,y:1300,scale:.7});});
  await mapClick(650,1300);await until(formFor(three));
  pass('Map selection opens an unregistered polygon drawn with the native Regions toolbar');
  await closeCentre();
  await ev(async()=>{await ui.controls.activate({control:'mjl-pointcrawl',tool:'inspect'});canvas.regions.releaseAll();});
  await until('!!document.querySelector("#scene-controls-tools [data-tool=togglePalette]")');
  await ev(()=>document.querySelector('#scene-controls-tools [data-tool=togglePalette]').click());
  await until('!!document.querySelector("#region-palette")');
  await ev(async()=>{await ui.placeablesPalette?.render();});
  assert.equal(b.events.filter(e=>e.method==='Runtime.exceptionThrown').length,0,'Opening the native palette');
  for(let i=0;i<5;i++) {
    await ev(()=>{const checkbox=document.querySelector('#region-palette input[name=displayMeasurements]');if(!checkbox)throw Error('Missing native palette checkbox');checkbox.click();});
    await new Promise(r=>setTimeout(r,250));
    await ev(async()=>{await ui.placeablesPalette?.render();});
    assert.equal(await b.eval('document.querySelectorAll("#region-palette .mjl-region-card").length',s),0);
  }
  pass('Toggling the real palette checkbox five times never inserts region-card buttons');
  await ev(async()=>{await ui.controls.togglePlaceablePalette(false);});
  await ev(id=>{canvas.scene.regions.get(id).sheet.render({force:true});},one);
  await until('document.querySelectorAll(".mjl-region-card").length === 1');
  const part=await ev(id=>Object.keys(canvas.scene.regions.get(id).sheet.constructor.PARTS).find(k=>!['tabs','footer'].includes(k)),one);
  for(let i=0;i<4;i++)await ev(async({id,part})=>{await canvas.scene.regions.get(id).sheet.render({parts:[part]});},{id:one,part});
  assert.equal(await b.eval('document.querySelectorAll(".mjl-region-card").length',s),1);
  await click('.mjl-region-card');await until(formFor(one));
  pass('Actual Region Configuration keeps exactly one working card button across partial renders');
  await ev(async id=>{await canvas.scene.regions.get(id).sheet.close();},one);
  await click('[data-pc-action=editBoundary]');
  await until(`ui.controls.control?.name==="regions"&&ui.controls.tool?.name==="select"&&canvas.regions.controlled.some(r=>r.id===${JSON.stringify(one)})`);
  pass('Region card opens the native boundary editor and selects the intended region');
  await b.screenshot('mjl-pointcrawl/dev/regions-fixed.png',s);
  const errors=b.events.filter(e=>e.method==='Runtime.exceptionThrown');assert.equal(errors.length,0,JSON.stringify(errors));
  pass('No uncaught JavaScript errors in draft cards, centre placement or palette redraws');
  report.success=true;report.sceneId=sceneId;
}catch(e){report.success=false;report.error=e.stack;console.error(e);if(s)try{await b.screenshot('mjl-pointcrawl/dev/regions-failure.png',s);}catch{}process.exitCode=1;}
finally{await writeFile('mjl-pointcrawl/dev/regions-report.json',JSON.stringify(report,null,2));b.close();}
