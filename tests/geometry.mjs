import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {browser} from "./cdp.mjs";
const b=await browser(),report={passed:[]};let s;
const ev=(fn,arg)=>b.eval(`(${fn.toString()})(${JSON.stringify(arg??null)})`,s);
const until=code=>b.until(code,s,60000);
const pass=name=>{report.passed.push(name);console.log(`PASS ${name}`);};
try {
  for(const t of (await b.call('Target.getTargets')).targetInfos)if(t.type==='page'&&t.url.startsWith('http://127.0.0.1:30010/'))await b.call('Target.closeTarget',{targetId:t.targetId});
  s=await b.page('http://127.0.0.1:30010/join');await until('document.querySelector("select[name=userid]") || globalThis.game?.ready');
  if(!await b.eval('!!globalThis.game?.ready',s)) {
    await ev(()=>{const sel=document.querySelector('select[name=userid]');sel.value=[...sel.options].find(o=>o.text==='Gamemaster').value;document.querySelector('button[name=join]').click();});
    await b.until('globalThis.game?.ready && canvas.ready',s,120000);
  }
  assert.equal(await b.eval('game.world.id',s),'pointcrawl-test');b.events=[];
  const scene=await ev(async()=>{const doc=await Scene.create({name:'Pointcrawl 1.0.2 · обрезка границ',width:2600,height:1800,grid:{type:0,size:100},tokenVision:true});await doc.activate();return doc.id;});
  await until(`canvas.ready && canvas.scene.id===${JSON.stringify(scene)}`);
  await ev(async()=>{
    await (await import('/modules/mjl-pointcrawl/scripts/store.mjs')).request('enable',{enabled:true});
    await ui.controls.activate({control:'mjl-pointcrawl',tool:'rectangle'});game.togglePause(false,{broadcast:true});
  });
  const a=await ev(async()=>{const [doc]=await canvas.scene.createEmbeddedDocuments('Region',[{name:'A',shapes:[{type:'rectangle',x:400,y:400,width:400,height:400}]}]);await (await import('/modules/mjl-pointcrawl/scripts/store.mjs')).request('region',{regionId:doc.id,values:{name:'Первая область',center:{x:600,y:600}}});return {id:doc.id,shapes:JSON.stringify(doc.toObject().shapes),area:doc.polygonTree.area};});
  assert.equal(a.area,160000);pass('A native rectangle saves as a travel region without a false hole error');
  const edge=await ev(async()=>{const [doc]=await canvas.scene.createEmbeddedDocuments('Region',[{name:'B',shapes:[{type:'rectangle',x:700,y:500,width:400,height:400}]}]);await (await import('/modules/mjl-pointcrawl/scripts/store.mjs')).request('region',{regionId:doc.id,values:{name:'Обрезанная область',center:{x:950,y:700}}});return {id:doc.id,area:doc.polygonTree.area,bounds:doc.polygonTree.bounds,shapes:doc.toObject().shapes};});
  assert.equal(edge.area,130000);assert.equal(await ev(id=>JSON.stringify(canvas.scene.regions.get(id).toObject().shapes),a.id),a.shapes);
  pass('An overlapping new rectangle is trimmed to the existing boundary; the older region is unchanged');
  const compound=await ev(async()=>{const [doc]=await canvas.scene.createEmbeddedDocuments('Region',[{name:'Compound',shapes:[{type:'rectangle',x:1800,y:400,width:100,height:100},{type:'polygon',points:[2000,400,2100,400,2100,500,2000,500]}]}]);await (await import('/modules/mjl-pointcrawl/scripts/store.mjs')).request('region',{regionId:doc.id,values:{center:{x:1850,y:450}}});return {id:doc.id,area:doc.polygonTree.area,count:doc.shapes.length};});
  assert.equal(compound.area,20000);assert.equal(compound.count,2);pass('Several valid figures in one native Region are supported');
  const nested=await ev(async()=>{
    const m=await import('/modules/mjl-pointcrawl/scripts/store.mjs');
    const [inner]=await canvas.scene.createEmbeddedDocuments('Region',[{name:'Inner',shapes:[{type:'rectangle',x:1200,y:1100,width:100,height:100}]}]);await m.request('region',{regionId:inner.id,values:{name:'Закрытый остров',center:{x:1250,y:1150}}});
    const [outer]=await canvas.scene.createEmbeddedDocuments('Region',[{name:'Outer',shapes:[{type:'polygon',points:[1100,1000,1400,1000,1400,1300,1100,1300]}]}]);await m.request('region',{regionId:outer.id,values:{name:'Открытая область с вырезом',center:{x:1120,y:1020},explored:true}});
    return {inner:inner.id,outer:outer.id,area:outer.polygonTree.area,holes:outer.shapes.filter(s=>s.hole).length,insideHole:outer.polygonTree.testPoint({x:1250,y:1150})};
  });
  assert.equal(nested.area,80000);assert.equal(nested.holes,1);assert.equal(nested.insideHole,false);pass('Cutting around an existing island creates a real supported hole, preserving the island');
  await assert.rejects(()=>ev(async id=>(await import('/modules/mjl-pointcrawl/scripts/store.mjs')).request('location',{regionId:id,values:{name:'Нельзя в отверстие',x:1250,y:1150}}),nested.outer),/внутри региона/);
  pass('Locations cannot be placed inside a cut-out hole');
  const edited=await ev(async id=>{const doc=canvas.scene.regions.get(id);await doc.update({shapes:[{type:'rectangle',x:600,y:500,width:500,height:400}]});return doc.polygonTree.area;},edge.id);
  assert.equal(edited,140000);assert.equal(await ev(id=>JSON.stringify(canvas.scene.regions.get(id).toObject().shapes),a.id),a.shapes);pass('Editing a registered boundary also trims intersections without altering neighbours');
  const legacy=await ev(async()=>{
    await ui.controls.activate({control:'regions',tool:'rectangle'});
    const [doc]=await canvas.scene.createEmbeddedDocuments('Region',[{name:'Старый квадрат с размерами',displayMeasurements:true,shapes:[{type:'rectangle',x:2000,y:1000,width:200,height:200}]}]);
    const m=await import('/modules/mjl-pointcrawl/scripts/store.mjs');const selected=m.regionAt(canvas.scene,{x:2100,y:1100},true)?.id;
    await m.request('region',{regionId:doc.id,values:{center:{x:2100,y:1100}}});
    await ui.controls.activate({control:'mjl-pointcrawl',tool:'rectangle'});return {id:doc.id,selected,area:doc.polygonTree.area};
  });
  assert.equal(legacy.selected,legacy.id);assert.equal(legacy.area,40000);pass('An existing square with display-measurements enabled is still selectable and valid');
  const split=await ev(async()=>{
    const m=await import('/modules/mjl-pointcrawl/scripts/store.mjs');
    const [strip]=await canvas.scene.createEmbeddedDocuments('Region',[{name:'Разделяющая полоса',shapes:[{type:'rectangle',x:1800,y:1100,width:20,height:400}]}]);await m.request('region',{regionId:strip.id,values:{center:{x:1810,y:1150}}});
    const [doc]=await canvas.scene.createEmbeddedDocuments('Region',[{name:'Две оставшиеся части',shapes:[{type:'rectangle',x:1700,y:1200,width:200,height:200}]}]);await m.request('region',{regionId:doc.id,values:{center:{x:1720,y:1220}}});
    return {area:doc.polygonTree.area,islands:doc.shapes.filter(s=>!s.hole).length};
  });
  assert.equal(split.area,36000);assert.equal(split.islands,2);pass('A crossing old region can split the new area into two valid contours');
  await ev(async()=>{await (await import('/modules/mjl-pointcrawl/scripts/app.mjs')).PointcrawlApp.instance?.close();await (await import('/modules/mjl-pointcrawl/scripts/canvas.mjs')).useTool({action:'preview'});canvas.pan({x:1250,y:1150,scale:1});});
  const mask=await ev(()=>{const g=canvas.stage.children.find(c=>c.name==='mjl-pointcrawl').children[0];return {known:g.geometry.containsPoint(new PIXI.Point(1120,1020)),hole:g.geometry.containsPoint(new PIXI.Point(1250,1150)),unknown:g.geometry.containsPoint(new PIXI.Point(1850,450))};});
  assert.deepEqual(mask,{known:false,hole:true,unknown:true});pass('Player mask reveals the explored outer region but still covers its unknown island');
  await b.screenshot('mjl-pointcrawl/dev/geometry-hole-mask.png',s);
  await ev(async()=>{await (await import('/modules/mjl-pointcrawl/scripts/canvas.mjs')).useTool({action:'preview'});});
  const blocked=await ev(async()=>{const count=canvas.scene.regions.size;const created=await canvas.scene.createEmbeddedDocuments('Region',[{name:'Covered',shapes:[{type:'rectangle',x:450,y:450,width:50,height:50}]}]);return {before:count,after:canvas.scene.regions.size,created:created.length};});
  assert.equal(blocked.created,0);assert.equal(blocked.before,blocked.after);pass('A fully covered new shape is rejected clearly without deleting existing regions');
  await b.call('Network.enable',{},s);
  const networkStart=b.events.length;
  const video=await ev(async()=>{
    const msg=await ChatMessage.create({content:'<h2>Тест приветственного сообщения</h2><iframe src="https://www.youtube.com/embed/2Iq_so_GsLA"></iframe>',whisper:[game.user.id]});
    const html=await msg.renderHTML();return {stored:msg.content.includes('<iframe'),frames:html.querySelectorAll('iframe').length,link:html.querySelector('a[href="https://www.youtube.com/watch?v=2Iq_so_GsLA"]')?.textContent};
  });
  assert.equal(video.stored,true);assert.equal(video.frames,0);assert(video.link);
  assert.equal(b.events.slice(networkStart).filter(e=>e.method==='Network.requestWillBeSent'&&e.params.request.url.includes('youtube.com/embed/2Iq_so_GsLA')).length,0);
  pass('The theripper93 welcome iframe becomes a link before display, without changing stored chat content or loading YouTube');
  assert.equal(b.events.filter(e=>e.method==='Runtime.exceptionThrown').length,0,JSON.stringify(b.events.filter(e=>e.method==='Runtime.exceptionThrown')));
  pass('No uncaught JavaScript errors in native geometry, clipping, mask or welcome-card rendering');report.success=true;report.sceneId=scene;
}catch(e){report.success=false;report.error=e.stack;console.error(e);if(s)try{await b.screenshot('mjl-pointcrawl/dev/geometry-failure.png',s);}catch{}process.exitCode=1;}
finally{await writeFile('mjl-pointcrawl/dev/geometry-report.json',JSON.stringify(report,null,2));b.close();}
