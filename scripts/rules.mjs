export const ID = "mjl-pointcrawl";
export const TITLE = "MJl - Pointcrawl";
export const PACE = {slow: {name: "Медленный", factor: 1.5}, normal: {name: "Нормальный", factor: 1}, fast: {name: "Быстрый", factor: .75}};
export const TERRAIN = {
  arctic: {name: "Арктика", maxPace: "fast", detection: "6d6 * 10", forageDC: 20, navigationDC: 10, searchDC: 10},
  coast: {name: "Побережье", maxPace: "normal", detection: "2d10 * 10", forageDC: 10, navigationDC: 5, searchDC: 15},
  desert: {name: "Пустыня", maxPace: "normal", detection: "6d6 * 10", forageDC: 20, navigationDC: 10, searchDC: 10},
  forest: {name: "Лес", maxPace: "normal", detection: "2d8 * 10", forageDC: 10, navigationDC: 15, searchDC: 15},
  grassland: {name: "Луг", maxPace: "fast", detection: "6d6 * 10", forageDC: 15, navigationDC: 5, searchDC: 15},
  hills: {name: "Холмы", maxPace: "normal", detection: "2d10 * 10", forageDC: 15, navigationDC: 10, searchDC: 15},
  mountains: {name: "Горы", maxPace: "slow", detection: "4d10 * 10", forageDC: 20, navigationDC: 15, searchDC: 20},
  swamp: {name: "Болото", maxPace: "slow", detection: "2d8 * 10", forageDC: 10, navigationDC: 15, searchDC: 20},
  underground: {name: "Подземье", maxPace: "normal", detection: "2d6 * 10", forageDC: 20, navigationDC: 10, searchDC: 20},
  city: {name: "Город", maxPace: "normal", detection: "2d6 * 10", forageDC: 20, navigationDC: 15, searchDC: 15},
  water: {name: "Вода", maxPace: "normal", detection: "6d6 * 10", forageDC: 15, navigationDC: 10, searchDC: 15}
};
export const ACTIONS = {travel: "Переход", local: "Переход внутри региона", teleport: "Телепортация", navigation: "Навигация", search: "Поиск локации", forage: "Поиск пропитания", short: "Короткий отдых", long: "Долгий отдых"};
export const STATUS = {pending: "Ждёт решения мастера", approved: "Разрешено — ожидаются участники", camp:"Предел дневного перехода — отдых или марш", suspended:"Ожидает завершения отдыха в пути", committing: "Завершение — требуется проверка", done: "Завершено", rejected: "Отклонено"};
export const clone = value => structuredClone(value);
export const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]);
export function unknownExitLabels(state) {
  const unknown=new Set(state.regions.filter(r=>r.center&&!r.explored).map(r=>r.id));
  const here=state.currentRegionId;
  const exits=state.routes.filter(r=>r.from===here||r.to===here);
  const labels=new Map();
  exits.forEach((r,i)=>{
    const id=r.from===here?r.to:r.from;
    if(unknown.has(id))labels.set(id,`?${i+1}`);
  });
  return labels;
}
export function need(condition, message) { if (!condition) throw Error(message); }
export function number(value, label, min=0, max=1e9, integer=false) {
  need(value !== "" && value !== null && typeof value !== "boolean", `${label}: требуется число.`);
  const n = Number(value);
  need(Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n)), `${label}: недопустимое значение.`);
  return n;
}
export function text(value, label, max=20000) {
  need(typeof value === "string" && value.length <= max, `${label}: недопустимый текст.`);
  return value;
}
export function secondsLabel(seconds) {
  const m = Math.ceil(seconds / 60);
  return [Math.floor(m / 1440) ? `${Math.floor(m / 1440)} д` : "", Math.floor(m % 1440 / 60) ? `${Math.floor(m % 1440 / 60)} ч` : "", m % 60 ? `${m % 60} мин` : ""].filter(Boolean).join(" ") || "0 мин";
}
export function durationSeconds(hours,minutes) {
  return number(number(hours,"Часы",0,8760,true)*3600+number(minutes,"Минуты",0,59,true)*60,"Продолжительность",60,31536000,true);
}
export const dayOf = seconds => Math.floor(seconds / 86400);
export function allowedPaces(region,road=false,profile={}) {
  if(profile.mode==="vehicle")return ["normal"];
  if(profile.slower&&profile.mode!=="special")return ["slow"];
  if(profile.mode==="special"&&profile.ignoreTerrain)return Object.keys(PACE);
  const cap=region.maxPace;
  need(PACE[cap], "Укажите максимальный темп местности.");
  let count=Math.min(3,Object.keys(PACE).indexOf(cap)+1+(road?1:0));
  if(region.terrain==="arctic"&&!region.equipped)count=Math.min(count,2);
  return Object.keys(PACE).slice(0,count);
}
export function travelSeconds(base,pace,region,penalty=0,road=false) {return journeySeconds(base,pace,region,road,{},null,penalty);}

export const TRAVEL_LIMIT=8*3600;
export function travelLeg(total,elapsed,daySeconds,march=false) {
  const remaining=Math.max(0,total-elapsed),limit=daySeconds<TRAVEL_LIMIT?TRAVEL_LIMIT:march?(Math.floor(daySeconds/3600)+1)*3600:daySeconds;
  const seconds=Math.min(remaining,Math.max(0,limit-daySeconds)),after=daySeconds+seconds;
  return {seconds,camp:seconds<remaining&&!march,save:seconds>0&&after>=9*3600&&after%3600===0?10+after/3600-8:null,arrive:seconds===remaining};
}
export function movementProfile(value={}) {
  const mode=value.mode??"walk";need(["walk","special","vehicle"].includes(mode),"Неизвестный способ передвижения.");
  return {mode,speed:number(value.speed??30,"Скорость, футы",1,10000),mph:number(value.mph??3,"Скорость транспорта",.01,10000),ignoreTerrain:!!value.ignoreTerrain,slower:!!value.slower};
}
export function journeySeconds(base,pace,region,road,profile={},miles=null,penalty=0) {
  penalty=number(penalty,"Штраф навигации",0,60);
  need(allowedPaces(region,road,profile).includes(pace),"Этот темп недоступен для группы.");
  if(miles!=null&&profile.mode!=="walk") {
    const mph=profile.mode==="vehicle"?profile.mph:Math.floor(profile.speed/10*8*({slow:2/3,normal:1,fast:4/3}[pace]))/8;
    need(mph>0,"Скорость слишком мала для выбранного темпа.");
    return Math.ceil(number(miles,"Расстояние, мили",.001,1e7)/mph*3600*(1+penalty/100));
  }
  return Math.ceil(number(base,"Время маршрута",1)*PACE[pace].factor*(1+number(penalty,"Штраф",0,60)/100));
}
export function eventTable(input) {
  need(typeof input!=="string"||input.length<=2000000,"JSON не должен превышать 2 МБ.");
  const data = typeof input === "string" ? JSON.parse(input) : input;
  need(data && data.schemaVersion === 1, "Поддерживается schemaVersion: 1.");
  const name = text(data.name, "Название", 200).trim(); need(name, "Укажите название таблицы.");
  const description = text(data.description ?? "", "Описание");
  need(Array.isArray(data.results) && data.results.length > 0 && data.results.length <= 1000, "Требуется от 1 до 1000 результатов.");
  let last = 0;
  const results = data.results.map((r, i) => {
    need(r && typeof r === "object", `Результат ${i + 1}: требуется объект.`);
    const weight = number(r.weight, `Вес ${i + 1}`, 1, 10000, true);
    const title = text(r.title, `Заголовок ${i + 1}`, 200).trim(); need(title, "Пустой заголовок результата.");
    const body = text(r.text, `Текст ${i + 1}`);
    const range = [last + 1, last += weight];
    return {weight, range, title, text: body};
  });
  need(last <= 1000000, "Сумма весов не должна превышать 1000000.");
  return {name, description, formula: `1d${last}`, results};
}

// Geometry stays independent of canvas so the same validation runs in tests and GM requests.
const EPS = 1e-7;
const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const same = (a,b) => Math.abs(a.x-b.x)<EPS && Math.abs(a.y-b.y)<EPS;
const onEdge = (p,a,b) => Math.abs(cross(a,b,p)) < EPS && p.x >= Math.min(a.x,b.x)-EPS && p.x <= Math.max(a.x,b.x)+EPS && p.y >= Math.min(a.y,b.y)-EPS && p.y <= Math.max(a.y,b.y)+EPS;
function intersects(a,b,c,d, proper=false) {
  const c1=cross(a,b,c), c2=cross(a,b,d), c3=cross(c,d,a), c4=cross(c,d,b);
  if (((c1>EPS && c2< -EPS)||(c1< -EPS && c2>EPS)) && ((c3>EPS && c4< -EPS)||(c3< -EPS && c4>EPS))) return true;
  return !proper && [onEdge(c,a,b),onEdge(d,a,b),onEdge(a,c,d),onEdge(b,c,d)].some(Boolean);
}
export function polygon(shapes) {
  need(Array.isArray(shapes) && shapes.length===1 && shapes[0].type==="polygon" && !shapes[0].hole, "Нужен один многоугольник без отверстий.");
  const flat=shapes[0].points;
  need(Array.isArray(flat) && flat.length>=6 && flat.length<=2000 && flat.length%2===0 && flat.every(Number.isFinite), "Недопустимые вершины границы.");
  const points=[];
  for(let i=0;i<flat.length;i+=2) points.push({x:flat[i],y:flat[i+1]});
  if(same(points[0],points.at(-1))) points.pop();
  need(points.length>=3, "Нужно хотя бы три вершины.");
  let area=0;
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    need(!same(a,b), "Соседние вершины совпадают."); area+=a.x*b.y-b.x*a.y;
    for(let j=i+1;j<points.length;j++) {
      if(j===i+1 || (i===0 && j===points.length-1)) continue;
      need(!intersects(a,b,points[j],points[(j+1)%points.length]), "Граница пересекает сама себя.");
    }
  }
  need(Math.abs(area)>EPS, "Граница не имеет площади.");
  return points;
}
export function inside(p, points, boundary=true) {
  let hit=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[j],b=points[i];
    if(onEdge(p,a,b)) return boundary;
    if((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) hit=!hit;
  }
  return hit;
}
export function overlaps(a,b) {
  for(let i=0;i<a.length;i++) for(let j=0;j<b.length;j++) if(intersects(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length],true)) return true;
  if(a.some(p=>inside(p,b,false)) || b.some(p=>inside(p,a,false))) return true;
  // Collinear shared edges are legal; a midpoint just inside catches coincident polygons and partial strips.
  for(const [one,two] of [[a,b],[b,a]]) {
    const area=one.reduce((n,p,i)=>n+p.x*one[(i+1)%one.length].y-one[(i+1)%one.length].x*p.y,0);
    for(let i=0;i<one.length;i++) {
      const p=one[i],q=one[(i+1)%one.length],len=Math.hypot(q.x-p.x,q.y-p.y),side=Math.sign(area)*.001;
      if(inside({x:(p.x+q.x)/2-(q.y-p.y)/len*side,y:(p.y+q.y)/2+(q.x-p.x)/len*side},two,false)) return true;
    }
  }
  return false;
}
export function validateRegionGeometry(shapes, center, others=[]) {
  const points=polygon(shapes);
  if(center) need(Number.isFinite(center.x) && Number.isFinite(center.y) && inside(center,points,false), "Центр должен находиться внутри региона, не на границе.");
  need(!others.some(s=>overlaps(points,polygon(s))), "Регионы перекрываются. Общая граница разрешена.");
  return points;
}
export function validateRequest(request, actorId, user, members) {
  need(request && request.status==="approved", "Заявка уже закрыта или ещё не одобрена.");
  need(request.actors.includes(actorId) && members.includes(actorId), "Персонаж не входит в участников заявки.");
  need(user.isGM || user.owns, "Нет права управлять этим персонажем.");
  need(!request.outcomes[actorId] && !request.running[actorId], "Эта попытка уже выполнена или выполняется.");
}
