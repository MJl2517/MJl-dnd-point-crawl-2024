import assert from "node:assert/strict";
import {browser} from "./cdp.mjs";

// Run only against the isolated pointcrawl-test world with Campaign Journal installed.
const b=await browser(),url="http://127.0.0.1:30010/join",pc="mjl-pointcrawl",cj="mjl-campaign-journal";
const ev=(s,fn,arg)=>b.eval(`(${fn.toString()})(${JSON.stringify(arg??null)})`,s);
const until=(s,code)=>b.until(code,s,60000);
const sceneRef=({scene})=>`game.scenes.get("${scene}")`;
async function join(name,context,noCanvas=false){
  const s=await b.page(url,context);
  await until(s,'!!document.querySelector("select[name=userid]")');
  await ev(s,({name,noCanvas})=>{
    if(noCanvas)localStorage.setItem("core.noCanvas","true");
    const select=document.querySelector("select[name=userid]");
    select.value=[...select.options].find(o=>o.text===name).value;
    document.querySelector("button[name=join]").click();
  },{name,noCanvas});
  await until(s,'globalThis.game?.ready');
  return s;
}
let gm,context,fixture,configuration,oldScene;
async function activateChronicle(enabled){
  await ev(gm,config=>game.settings.set("core","moduleConfiguration",config),{...configuration,[cj]:enabled});
  await b.call("Page.reload",{},gm);
  await until(gm,`globalThis.game?.ready&&canvas.ready&&game.modules.get("${cj}").active===${enabled}`);
}
try{
  gm=await join("Gamemaster");
  assert.equal(await b.eval("game.world.id",gm),"pointcrawl-test");
  configuration=await b.eval('game.settings.get("core","moduleConfiguration")',gm);
  oldScene=await b.eval("game.scenes.active?.id",gm);
  if(configuration[cj])await activateChronicle(false);
  fixture=await ev(gm,async()=>{
    const m=await import("/modules/mjl-pointcrawl/scripts/store.mjs");
    const group=await Actor.create({name:"Проверка арта Pointcrawl",type:"group"});
    const scene=await Scene.create({name:"Pointcrawl · проверка арта",width:2000,height:1600,grid:{type:0,size:100}});
    const [r]=await scene.createEmbeddedDocuments("Region",[{name:"Регион",shapes:[{type:"rectangle",x:400,y:400,width:1000,height:800}]}]);
    await m.request("enable",{enabled:true},scene);
    await m.request("region",{regionId:r.id,values:{name:"Долина",center:{x:600,y:600},explored:true}},scene);
    for(const [name,x,revealed] of [["Башня",900,true],["Секрет",1100,false],["Место загрузки",1200,true]]){
      await m.request("location",{regionId:r.id,values:{name,x,y:900,revealed}},scene);
    }
    const [location,hidden,uploadLocation]=m.privateData(scene).regions[r.id].locations.map(l=>l.id);
    const [token]=await scene.createEmbeddedDocuments("Token",[(await group.getTokenDocument({x:550,y:550,width:1,height:1})).toObject()]);
    await m.request("party",{tokenId:token.id},scene);
    await m.request("offlineSettings",{enabled:true,names:"Следопыт"},scene);
    await scene.activate();
    return {scene:scene.id,regionId:r.id,locationId:location,hidden,uploadLocation,actor:group.id};
  });
  await until(gm,`canvas.ready&&canvas.scene.id==="${fixture.scene}"`);
  await ev(gm,async f=>{(await import("/modules/mjl-pointcrawl/scripts/app.mjs")).PointcrawlApp.open({regionId:f.regionId});},fixture);
  await until(gm,'document.querySelector("[data-pc-action=placeArt]")');
  await b.eval('document.querySelector("[data-pc-action=placeArt]:not([data-location])").click()',gm);
  await until(gm,'document.querySelector(".mjl-dialog [name=src]")');
  await b.eval(`(()=>{const input=document.querySelector(".mjl-dialog [name=src]");input.value="icons/svg/castle.svg";input.form.querySelector('button[data-action=ok]').click();})()`,gm);
  await until(gm,`${sceneRef(fixture)}.getFlag("${pc}","state").regions[0].art==="icons/svg/castle.svg"`);
  console.log("PASS standalone region art saved from the GM dialog");

  await until(gm,'!document.querySelector(".mjl-dialog [name=src]")');
  await until(gm,`document.querySelector('[data-pc-action=placeArt][data-location="${fixture.uploadLocation}"]')`);
  await b.eval(`document.querySelector('[data-pc-action=placeArt][data-location="${fixture.uploadLocation}"]').click()`,gm);
  await until(gm,'document.querySelector("[data-art-drop]")');
  assert.equal(await ev(gm,()=>{document.querySelector("[data-art-drop]").focus();return game.keyboard.hasFocus;}),true);
  const transfer=kind=>ev(gm,async kind=>{
    const zone=document.querySelector("[data-art-drop]"),data=new DataTransfer();
    if(kind==="invalid")data.items.add(new File(["not an image"],"example.txt",{type:"text/plain"}));
    else {
      const image=document.createElement("canvas");image.width=image.height=16;
      const brush=image.getContext("2d");brush.fillStyle=kind==="paste"?"#f80":"#08f";brush.fillRect(0,0,16,16);
      const png=await new Promise(resolve=>image.toBlob(resolve,"image/png"));
      data.items.add(new File([png],`${kind}.png`,{type:"image/png"}));
    }
    if(kind==="paste")zone.dispatchEvent(new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true}));
    else zone.dispatchEvent(new DragEvent("drop",{dataTransfer:data,bubbles:true,cancelable:true}));
  },kind);
  const previous=await b.eval('document.querySelector(".mjl-dialog [name=src]").value',gm);
  await transfer("invalid");
  await until(gm,'document.querySelector("[data-art-status]").textContent.includes("поддерживаемого формата")');
  assert.equal(await b.eval('document.querySelector(".mjl-dialog [name=src]").value',gm),previous);
  const paths=[];
  for(const kind of ["paste","drop"]){
    await transfer(kind);
    await until(gm,`document.querySelector("[data-art-status]").textContent.includes("Загружено: ${kind}.png")`);
    const path=await b.eval('document.querySelector(".mjl-dialog [name=src]").value',gm);
    assert.match(path,/^worlds\/pointcrawl-test\/mjl-pointcrawl-art\/\w+\.png$/);
    assert.equal(await ev(gm,async path=>{
      const response=await fetch(path),blob=await response.blob();
      return response.ok&&blob.type==="image/png"&&(await createImageBitmap(blob)).width===16;
    },path),true);
    paths.push(path);
  }
  assert.notEqual(paths[0],paths[1]);
  await b.eval('document.querySelector(".mjl-dialog [data-action=ok]").click()',gm);
  await until(gm,`${sceneRef(fixture)}.getFlag("${pc}","state").regions[0].locations.find(l=>l.id==="${fixture.uploadLocation}").art===${JSON.stringify(paths[1])}`);
  console.log("PASS clipboard and file drop upload real images; unsupported files are rejected and Save attaches the chosen image");

  await activateChronicle(true);
  await until(gm,`game.modules.get("${cj}").api?.setPointcrawlArt`);
  const linked=await ev(gm,async f=>{
    const m=await import("/modules/mjl-pointcrawl/scripts/store.mjs"),c=await import("/modules/mjl-campaign-journal/scripts/store.mjs");
    const scene=game.scenes.get(f.scene);
    const edit=(locationId,src)=>m.request("placeArt",{regionId:f.regionId,locationId,src},scene);
    const shared=await edit(f.locationId,"icons/svg/cave.svg"),secret=await edit(f.hidden,"icons/svg/bones.svg");
    const ids=game.journal.filter(j=>j.getFlag("mjl-pointcrawl","notebook")?.sceneId===f.scene).map(j=>j.uuid);
    const cards=c.entries().filter(r=>ids.includes(r.pointcrawlUuid));
    const card=cards.find(r=>r.name==="Башня"),other=cards.find(r=>r.name==="Секрет");
    const request=await m.request("create",{kind:"local",locationId:f.locationId},scene);
    await m.request("approve",{requestId:request,minutes:5},scene);
    await m.request("finish",{requestId:request},scene);
    const message=game.messages.find(m=>m.getFlag("mjl-pointcrawl","requestId")===request);
    return {card:card.id,secretUuid:other.pointcrawlUuid,shared:shared.src,secret:secret.src,message:message.id,raw:message.content,request:message.getFlag("mjl-pointcrawl","request")};
  },fixture);
  assert.equal(linked.request.status,"done");
  assert(!linked.raw.includes(linked.shared));
  ({browserContextId:context}=await b.call("Target.createBrowserContext"));
  const player=await join("Pointcrawl Player",context,true);
  await until(player,`game.modules.get("${cj}").api?.pointcrawlArt`);
  const art=()=>ev(player,async f=>{
    const m=await import("/modules/mjl-pointcrawl/scripts/store.mjs"),scene=game.scenes.get(f.scene);
    return {region:m.artFor(scene,f.regionId)?.src,location:m.artFor(scene,f.regionId,f.locationId)?.src,hidden:m.artFor(scene,f.regionId,f.hidden),
      secret:game.modules.get("mjl-campaign-journal").api.pointcrawlArt(f.secretUuid),snapshot:JSON.stringify(m.state(scene))};
  },{...fixture,...linked});
  const initial=await art();
  assert.equal(initial.region,"icons/svg/castle.svg");
  assert.equal(initial.location,linked.shared);
  assert.equal(initial.hidden,null);
  assert.equal(initial.secret,null);
  assert(!initial.snapshot.includes(linked.secret));
  await ev(player,async f=>{
    const {TravelCentre}=await import("/modules/mjl-pointcrawl/scripts/app.mjs");
    TravelCentre.open({regionId:f.regionId}).sceneId=f.scene;
  },fixture);
  await until(player,`document.querySelector('[data-pc-action=viewArt][data-location="${fixture.locationId}"]')`);
  assert.equal(await b.eval(`!!document.querySelector('[data-pc-action=viewArt][data-location="${fixture.hidden}"]')`,player),false);

  const selector=`[data-message-id="${linked.message}"] [data-mjl-arrival-art]`;
  await until(player,`document.querySelector('${selector}')`);
  const open=()=>b.eval(`document.querySelector('${selector}').click()`,player);
  await open();
  await until(player,`[...document.images].some(i=>i.closest(".image-popout")&&i.src.endsWith("${linked.shared}")&&i.naturalWidth>0)`);
  console.log("PASS real arrival opens public art without projecting the hidden art");

  const updated=await ev(gm,async f=>{
    const m=await import("/modules/mjl-pointcrawl/scripts/store.mjs"),c=await import("/modules/mjl-campaign-journal/scripts/store.mjs");
    const scene=game.scenes.get(f.scene),card=()=>c.entry(f.card);
    const save=values=>c.request({action:"save",id:f.card,revision:card().revision,values});
    await save({images:[{src:"icons/svg/chest.svg",caption:"Вход"},{src:"icons/svg/book.svg",caption:"Второй арт"}]});
    const inherited=m.artFor(scene,f.regionId,f.locationId).src;
    const second=card().images[1].src;
    const {src}=await m.request("placeArt",{regionId:f.regionId,locationId:f.locationId,src:"icons/svg/bridge.svg"},scene);
    return {src,inherited,second,images:card().images};
  },{...fixture,...linked});
  assert.notEqual(updated.inherited,linked.shared);
  assert.notEqual(updated.inherited,updated.src);
  assert.deepEqual(updated.images.map(i=>i.caption),["Вход","Второй арт"]);
  assert.equal(updated.images[0].src,updated.src);
  assert.equal(updated.images[1].src,updated.second);
  await until(player,`game.journal.get("${linked.card}").getFlag("${cj}","entry").images[0].src==="${updated.src}"`);
  await open();
  await until(player,`[...document.images].some(i=>i.closest(".image-popout")&&i.src.endsWith("${updated.src}")&&i.naturalWidth>0)`);
  await ev(gm,async id=>{
    const c=await import("/modules/mjl-campaign-journal/scripts/store.mjs");
    await c.request({action:"save",id,revision:c.entry(id).revision,values:{published:false}});
  },linked.card);
  await until(player,`!game.journal.get("${linked.card}")?.getFlag("${cj}","entry")?.published`);
  assert.equal((await art()).location,"");
  await open();
  await until(player,'document.body.textContent.includes("Арт этого места пока недоступен.")');
  console.log("PASS two-way replacement preserves gallery and an old chat button rechecks access");
}finally{
  if(context)await b.call("Target.disposeBrowserContext",{browserContextId:context}).catch(console.error);
  if(fixture)await ev(gm,async f=>{
    const ids=game.journal.filter(j=>j.getFlag("mjl-pointcrawl","notebook")?.sceneId===f.scene).map(j=>j.uuid);
    if(game.modules.get("mjl-campaign-journal")?.active){
      const c=await import("/modules/mjl-campaign-journal/scripts/store.mjs");
      for(const r of c.entries().filter(r=>ids.includes(r.pointcrawlUuid))){
        await c.request({action:"save",id:r.id,revision:r.revision,values:{archived:true}});
        await c.request({action:"delete",id:r.id,revision:c.entry(r.id).revision});
      }
    }
    await game.scenes.get(f.oldScene)?.activate();
    const messages=game.messages.filter(m=>m.getFlag("mjl-pointcrawl","sceneId")===f.scene);
    if(messages.length)await ChatMessage.deleteDocuments(messages.map(m=>m.id));
    await game.scenes.get(f.scene)?.delete();
    await game.actors.get(f.actor)?.delete();
  },{...fixture,oldScene}).catch(console.error);
  if(configuration)await ev(gm,config=>game.settings.set("core","moduleConfiguration",config),configuration).catch(console.error);
  if(gm)await b.call("Page.close",{},gm).catch(console.error);
  b.close();
}
