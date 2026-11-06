import {ID, need, secondsLabel} from "./rules.mjs";
import {state,privateData,partyToken,members,regionAt,request} from "./store.mjs";
import {PointcrawlApp,TravelCentre,RequestWindow} from "./app.mjs";
import {fitRegion,shapeTree,subtractPaths,drawTree} from "./geometry.mjs";

let overlay,stage,pick=null;
let paletteWork=Promise.resolve();
export let preview=false;
const notify=error=>{ui.notifications.error(`Pointcrawl: ${error.message}`);console.error(ID,error);};
const run=fn=>Promise.resolve().then(fn).catch(notify);
function toolName() {return ui.controls?.control?.name===ID?ui.controls.tool?.name:null;}
function point(event) {return event.getLocalPosition(canvas.stage);}
function label(text,x,y,name) {
  const l=new PIXI.Text(text,{fontFamily:"Arial",fontSize:17,fill:0xf6e8cc,stroke:0x10151a,strokeThickness:4,align:"center"});
  l.anchor.set(.5,0);l.position.set(x,y);l.eventMode="none";l.name=name;return l;
}
function routeBadge(edge,seconds,color,x,y) {
  const badge=new PIXI.Container();
  badge.name=`route-time-${edge.id}`;
  badge.eventMode="none";
  badge.position.set(x,y);
  const duration=new PIXI.Text(`${secondsLabel(seconds)}${edge.road?" · дорога":""}`,{
    fontFamily:"Arial",fontSize:20,fontWeight:"bold",fill:color
  });
  duration.name="duration";
  duration.anchor.set(.5);
  const width=Math.ceil(duration.width)+24, height=Math.ceil(duration.height)+10;
  const background=new PIXI.Graphics().lineStyle(2,color).beginFill(0x101921)
    .drawRoundedRect(-width/2,-height/2,width,height,height/2).endFill();
  badge.addChild(background,duration);
  return badge;
}
function clearPickNotice(pending) {for(const n of [pending?.notice,pending?.warning])if(n)ui.notifications.remove(n);}
function cancelPick() {const pending=pick;pick=null;clearPickNotice(pending);if(pending?.onCancel)run(pending.onCancel);if(pending)redraw();}
async function visitLocation(locationId=null) {
  const actors=members(canvas.scene).filter(a=>game.user.isGM||a.isOwner).map(a=>a.id);
  need(actors.length,"Нет персонажа партии под вашим управлением.");
  const requestId=await request("create",{kind:"local",locationId,actors});RequestWindow.open({requestId});
}

export function redraw() {
  if(!canvas.ready || !canvas.stage)return;
  if(overlay) {overlay.parent?.removeChild(overlay);overlay.destroy({children:true});}
  overlay=null;
  const s=state(canvas.scene);if(!s.enabled)return;
  overlay=new PIXI.Container();overlay.name=ID;overlay.zIndex=1000000;overlay.eventMode="passive";
  canvas.stage.addChild(overlay);
  const fog=!game.user.isGM||preview;
  if(fog) {
    const g=new PIXI.Graphics(),rect=canvas.dimensions.rect;
    const background=shapeTree(canvas.scene,[{type:"rectangle",x:rect.x,y:rect.y,width:rect.width,height:rect.height}]);
    const visited=s.regions.filter(r=>r.explored).flatMap(r=>canvas.scene.regions.get(r.id)?.clipperPaths??[]);
    drawTree(g,subtractPaths(background.clipperPaths,visited),0x151b20);g.eventMode="static";
    g.on("pointerdown",event=>{if(event.button===0)event.stopPropagation();});
    overlay.addChild(g);
  }
  const secrets=game.user.isGM&&!preview?privateData(canvas.scene):null;
  const regions=secrets?Object.values(secrets.regions).filter(Boolean):s.regions;
  const edges=secrets?secrets.routes:s.routes;
  const available=new Set([s.currentRegionId]);
  for(const e of edges) {if(e.from===s.currentRegionId)available.add(e.to);if(e.to===s.currentRegionId)available.add(e.from);}
  const visible=regions.filter(r=>r.center&&(secrets||r.explored||available.has(r.id)));
  const outline=new PIXI.Graphics(),lines=new PIXI.Graphics();
  outline.eventMode=lines.eventMode="none";
  overlay.addChild(outline,lines);
  const centers=new Map(visible.map(r=>[r.id,r.center]));
  const publishedRoutes=new Map(s.routes.map(r=>[r.id,r]));
  for(const e of edges) {
    const a=centers.get(e.from),b=centers.get(e.to);
    if(!a||!b)continue;
    const color=e.road?0xf3cb7e:0xc3dcee, width=e.road?7:5;
    outline.lineStyle(width+4,0x101921).moveTo(a.x,a.y).lineTo(b.x,b.y);
    lines.lineStyle(width,color).moveTo(a.x,a.y).lineTo(b.x,b.y);
    const seconds=e.normalSeconds??publishedRoutes.get(e.id)?.normalSeconds??e.seconds;
    overlay.addChild(routeBadge(e,seconds,color,(a.x+b.x)/2,(a.y+b.y)/2));
  }
  for(const r of visible) {
    const container=new PIXI.Container();container.position.set(r.center.x,r.center.y);
    // Markers must not cover the party token's drag handle on the native Tokens layer.
    container.name=`region-point-${r.id}`;container.eventMode=ui.controls.control?.name===ID&&!ui.controls.tool?.creation&&!pick?"static":"none";container.cursor="pointer";container.hitArea=new PIXI.Circle(0,0,22);
    const isHere=r.id===s.currentRegionId;
    const dot=new PIXI.Graphics().lineStyle(3,isHere?0xf5dd91:0xc4a872).beginFill(isHere?0x6e5530:0x202a32).drawCircle(0,0,isHere?15:12).endFill();container.addChild(dot);
    const title=secrets||r.explored?r.name:"?";
    if(r.showName!==false)container.addChild(label(title,0,20,`region-name-${r.id}`));
    container.on("pointerdown",e=>e.stopPropagation());
    container.on("pointertap",event=>{event.stopPropagation();run(()=>selectRegion(r.id));});
    overlay.addChild(container);
    if(r.explored||secrets) for(const l of r.locations??[]) {
      const mark=new PIXI.Container();mark.name=`location-point-${l.id}`;mark.position.set(l.x,l.y);
      // Public locations have already been filtered by publish and omit the private revealed field.
      const color=l.color?Number.parseInt(l.color.slice(1),16):(!secrets||l.revealed?0x7c986c:0x724d50);
      mark.addChild(new PIXI.Graphics().lineStyle(2,0xebd9ab).beginFill(color).drawCircle(0,0,7).endFill());
      if(secrets) {
        const eye=new PIXI.Graphics().lineStyle(2,0xebd9ab).moveTo(-9,0).quadraticCurveTo(0,-10,9,0).quadraticCurveTo(0,10,-9,0).drawCircle(0,0,2);
        if(!l.revealed)eye.moveTo(-9,8).lineTo(9,-8);
        eye.position.set(19,-12);eye.name=`location-eye-${l.revealed?"open":"closed"}-${l.id}`;eye.eventMode="none";mark.addChild(eye);
      }
      if(l.showName!==false)mark.addChild(label(l.name,0,12,`location-name-${l.id}`));
      mark.eventMode=container.eventMode;mark.cursor="pointer";mark.hitArea=new PIXI.Circle(0,0,16);
      mark.on("pointerdown",e=>e.stopPropagation());
      mark.on("pointertap",e=>{e.stopPropagation();run(async()=>{
        if(game.user.isGM&&toolName()==="inspect") {
          const app=PointcrawlApp.instance??=new PointcrawlApp();app.regionId=r.id;await app.locationDialog(l.id);
        } else {need(r.id===s.currentRegionId,"Сначала перейдите в регион этой локации.");await visitLocation(l.id);}
      });});overlay.addChild(mark);
    }
  }
}

async function selectRegion(id) {
  const mode=toolName();
  if(game.user.isGM&&(mode==="center"||pick?.action==="center"))return;
  const s=state(canvas.scene);
  if(id===s.currentRegionId&&mode==="travel")return visitLocation();
  if(id!==s.currentRegionId&&(mode==="travel"||!game.user.isGM)) {
    const actors=members(canvas.scene).filter(a=>game.user.isGM||a.isOwner).map(a=>a.id);
    need(actors.length,"Нет персонажа партии под вашим управлением.");
    const requestId=await request("create",{kind:"travel",to:id,actors,pace:"normal"});RequestWindow.open({requestId});return;
  }
  (game.user.isGM?PointcrawlApp:TravelCentre).open({regionId:id});
}

function pointer(event) {
  if(event.button!==0 || !game.user.isGM || !state(canvas.scene).enabled)return;
  const p=point(event),mode=toolName();
  if(ui.controls.control?.name===ID&&ui.controls.tool?.creation&&!canvas.regions.preview.children.length)canvas.regions.releaseAll();
  if(pick?.action==="locationPoint") {
    event.stopPropagation();const pending=pick;
    if(!canvas.scene.regions.get(pending.regionId)?.polygonTree.testPoint(p)) {if(pending.warning)ui.notifications.remove(pending.warning);pending.warning=ui.notifications.warn("Pointcrawl: выберите точку внутри нужного региона. Esc — отмена.");return;}
    pick=null;clearPickNotice(pending);redraw();run(()=>pending.onPick({x:p.x,y:p.y}));return;
  }
  if(pick?.action==="center") {
    event.stopPropagation();
    if(pick.busy)return;
    const pending=pick,doc=pending.regionId?canvas.scene.regions.get(pending.regionId):regionAt(canvas.scene,p,true);
    if(!doc) {ui.notifications.warn("Pointcrawl: щёлкните внутри нарисованного региона. Esc — отмена.");return;}
    pending.busy=true;
    run(async()=>{
      try {await request("region",{regionId:doc.id,values:{center:{x:p.x,y:p.y}}});if(pick===pending)pick=null;ui.notifications.info("Pointcrawl: центр установлен.");PointcrawlApp.open({regionId:doc.id});}
      finally {pending.busy=false;}
    });return;
  }
  if(mode==="inspect") {
    const doc=regionAt(canvas.scene,p,true);if(doc) {event.stopPropagation();PointcrawlApp.open({regionId:doc.id});}
  }
}

export async function useTool({action,regionId,onPick,onCancel}) {
  if(action==="preview") {preview=!preview;redraw();ui.notifications.info(preview?"Pointcrawl: предпросмотр вида игроков включён.":"Pointcrawl: вид мастера.");return;}
  if(action==="draw") {
    need(game.user.isGM,"Только мастер рисует регионы.");
    canvas.regions.templateMode=false;canvas.regions.releaseAll();
    await ui.controls.activate({control:ID,tool:"polygon"});
    ui.notifications.info("Pointcrawl: нарисуйте один многоугольник штатным инструментом. После завершения сохраните карточку.");return;
  }
  if(action==="center") {
    need(game.user.isGM,"Только мастер устанавливает центр региона.");
    if(!state(canvas.scene).enabled) {PointcrawlApp.open({regionId,tab:"regions"});return;}
    if(regionId&&!canvas.scene.regions.has(regionId))regionId=null;
    pick={action,regionId};await ui.controls.activate({control:ID,tool:"center"});
    ui.notifications.info("Pointcrawl: щёлкните внутри региона для установки центра. Новая карточка сохранится автоматически. Esc — отмена.");return;
  }
  if(action==="locationPoint") {
    need(game.user.isGM&&canvas.scene.regions.has(regionId),"Выберите регион локации.");
    await ui.controls.activate({control:ID,tool:"inspect"});
    pick={action,regionId,onPick,onCancel};canvas.regions.releaseAll();redraw();
    pick.notice=ui.notifications.info("Pointcrawl: щёлкните по карте внутри региона для размещения локации. Esc вернёт её карточку.");return;
  }
  if(action==="editBoundary") {
    await ui.controls.activate({control:ID,tool:"select"});
    canvas.scene.regions.get(regionId)?.object?.control({releaseOthers:true});
    ui.notifications.info("Pointcrawl: измените вершины штатными маркерами региона. Центр и локации должны оставаться внутри.");
  }
}

function toggleRegionPalette(closeOnly=false) {
  paletteWork=paletteWork.then(async()=>{
    const current=ui.placeablesPalette;
    if(closeOnly?current?.id!=="region-palette":ui.controls.control?.name!==ID)return;
    if(current)await current.close({animate:false});
    if(closeOnly||current?.id==="region-palette"||ui.controls.control?.name!==ID)return;
    const Palette=canvas.regions.constructor.paletteClass;
    const palette=new Palette({
      initialData:ui.controls.tool?.createData??{},
      position:{top:180,left:100},
      actions:{closePalette:()=>toggleRegionPalette(true)}
    });
    // Reserve the window while Foundry's controls and palette render asynchronously.
    ui.placeablesPalette=palette;
    try {await palette.render({force:true});}
    catch(error) {if(ui.placeablesPalette===palette)ui.placeablesPalette=null;throw error;}
  }).catch(notify);
  return paletteWork;
}

export function controls(controls) {
  const original=controls.regions;if(!original)return;
  const gm=game.user.isGM;
  const tool=(name,title,icon,order,extra={})=>({name,title,icon,order,...extra});
  controls[ID]={name:ID,title:"Pointcrawl — путешествия",icon:"fa-solid fa-route",order:8,layer:gm?"regions":"tokens",visible:true,
    onChange:(_event,enabled)=>{
      // Players use our markers on the token layer; native region editing and its palette are GM tools.
      if(!gm) {
        if(enabled&&!canvas.tokens.active) {canvas.tokens.activate();ui.controls.activate({control:ID,tool:"travel"}).catch(notify);}
        return;
      }
      if(enabled&&canvas.regions.templateMode)canvas.regions.templateMode=false;
      if(enabled&&!canvas.regions.active) {
        const selected=ui.controls.tool?.name??(gm?"inspect":"travel");
        // The native layer selects its own toolbar on activation. Restore our toolbar once it is active.
        canvas.regions.activate();
        ui.controls.activate({control:ID,tool:selected});
      } else if(!enabled){cancelPick();}
    },
    onToolChange:(_event,tool,active)=>{
      if(!gm)return;
      canvas.regions.setAllRenderFlags({refreshState:true});
      if(active&&!tool.control)canvas.regions.releaseAll();
    },activeTool:gm?"inspect":"travel",tools:{
      hub:tool("hub","Центр путешествий","fa-solid fa-campground",1,{button:true,onChange:()=>TravelCentre.open()}),
      travel:tool("travel","Перейти к центру или локации","fa-solid fa-person-hiking",2,{interaction:true,control:true}),
      manager:tool("manager","Менеджер регионов","fa-solid fa-map",3,{button:true,visible:gm,onChange:()=>PointcrawlApp.open({tab:"regions"})}),
      inspect:tool("inspect","Выбрать регион и открыть информацию","fa-solid fa-location-dot",4,{interaction:true,control:true,visible:gm}),
      polygon:{...original.tools.polygon,visible:gm,control:true,order:5},
      rectangle:{...original.tools.rectangle,visible:gm,control:true,order:6},
      select:{...original.tools.select,visible:gm,order:7,title:"Редактировать границы региона"},
      center:tool("center","Поставить центр выбранного региона","fa-solid fa-crosshairs",8,{interaction:true,control:true,visible:gm,onChange:(_e,enabled)=>{if(enabled&&!pick)run(()=>useTool({action:"center",regionId:canvas.regions.controlled[0]?.id}));}}),
      togglePalette:{...original.tools.togglePalette,visible:gm&&original.tools.togglePalette.visible!==false,order:9,toggle:false,button:true,active:false,
        onChange:(_event,active)=>gm&&toggleRegionPalette(!active)},
      preview:tool("preview","Предпросмотр вида игроков","fa-solid fa-eye",10,{button:true,visible:gm,onChange:()=>run(()=>useTool({action:"preview"}))})
    }};
}

export function preMove(token,_movement,operation) {
  const scene=token.parent,s=state(scene);
  if(!s.enabled||token.id!==s.tokenId||!token.getFlag(ID,"party"))return;
  if(game.user.isGM&&(operation.mjlPointcrawlArrival||operation.mjlPointcrawlReposition))return;
  ui.notifications.warn("Pointcrawl: перемещайте группу через центр путешествий или инструмент перехода.");
  return false;
}

const announced=new Set();
export async function arrivalBanner(message,changes) {
  const r=changes.flags?.[ID]?.request,scene=canvas.scene;
  if(!message.author?.isGM||message.getFlag(ID,"requestId")!==r?.id)return;
  if(!game.ready||!scene||!state(scene).enabled||r?.sceneId!==scene.id||r.status!=="done"||!["travel","local","teleport"].includes(r.kind)||announced.has(r.id))return;
  announced.add(r.id);
  await partyToken(scene)?.object?.movementAnimationPromise?.catch(()=>{});
  if(!canvas.ready||canvas.scene?.id!==scene.id)return;
  const region=game.user.isGM?privateData(scene).regions[r.to??r.regionId]:null;
  const title=(r.locationId?region?.locations.find(l=>l.id===r.locationId)?.name:region?.name)??r.destination?.replace(/^Центр: /,"");
  if(!title)return;
  document.getElementById(`${ID}-arrival`)?.remove();
  const banner=document.createElement("div");banner.id=`${ID}-arrival`;banner.className="mjl-arrival";banner.setAttribute("role","status");banner.setAttribute("aria-live","polite");
  const name=document.createElement("span");name.textContent=title;banner.append(name);document.body.append(banner);
  const still=matchMedia("(prefers-reduced-motion: reduce)").matches;
  banner.animate([{opacity:0,transform:still?"none":"translateY(12px)"},{opacity:1,transform:"none",offset:.18},{opacity:1,transform:"none",offset:.76},{opacity:0,transform:still?"none":"translateY(-6px)"}],{duration:5000,easing:"ease-out"}).finished.then(()=>banner.remove(),()=>banner.remove());
}

export function validateGeometry(doc,changes) {
  if(!changes.shapes||!state(doc.parent).enabled||(!doc.getFlag(ID,"region")&&!doc.getFlag(ID,"draft")&&ui.controls.control?.name!==ID))return;
  try {
    const r=privateData(doc.parent).regions[doc.id]??{};
    const fitted=fitRegion(doc.parent,changes.shapes,doc.id,r);
    if(fitted.changed)changes.shapes=fitted.shapes;
  } catch(e) {notify(e);return false;}
}
export function prepareRegion(doc) {
  if(ui.controls.control?.name!==ID||!state(doc.parent).enabled)return;
  try {
    const fitted=fitRegion(doc.parent,doc.shapes,doc.id);
    doc.updateSource({...(fitted.changed?{shapes:fitted.shapes}:{}),name:"Новый регион",ownership:{default:0},displayMeasurements:false,restriction:{enabled:false},hidden:false,[`flags.${ID}.draft`]:true});
    if(fitted.changed)ui.notifications.info("Pointcrawl: новая область обрезана по границам существующих регионов.");
  } catch(e) {notify(e);return false;}
}

export function canvasReady() {
  if(stage)stage.off("pointerdowncapture",pointer);
  stage=canvas.stage;stage.on("pointerdowncapture",pointer);pick=null;
  redraw();
}
export function canvasTearDown() {
  document.getElementById(`${ID}-arrival`)?.remove();
  if(stage)stage.off("pointerdowncapture",pointer);stage=null;
  overlay?.parent?.removeChild(overlay);overlay?.destroy({children:true});overlay=null;pick=null;
}
document.addEventListener("keydown",event=>{if(event.key==="Escape"){cancelPick();}});
