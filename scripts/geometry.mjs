import {ID,need,polygon} from "./rules.mjs";

export const isBoundary=doc=>!!(doc.getFlag(ID,"region")||doc.getFlag(ID,"draft")||(!doc.attachment?.token&&doc.shapes.some(s=>["polygon","rectangle"].includes(s.type))));
export function shapeTree(scene,shapes) {
  const raw=shapes.map(s=>s.toObject?s.toObject():s);
  need(raw.length>0,"Нарисуйте хотя бы одну фигуру региона.");
  for(const s of raw)if(s.type==="polygon")polygon([{...s,hole:false}]);
  const doc=new foundry.documents.RegionDocument({name:"Pointcrawl geometry",shapes:raw,restriction:{enabled:false}},{parent:scene});
  const tree=doc.polygonTree;
  need(tree.area>0,"У региона нет площади: проверьте размеры фигур и режим «Отверстие» в палитре.");
  return tree;
}
export function subtractPaths(subject,clip) {
  const c=new ClipperLib.Clipper(),solution=new ClipperLib.PolyTree();
  c.AddPaths(subject,ClipperLib.PolyType.ptSubject,true);
  if(clip.length)c.AddPaths(clip,ClipperLib.PolyType.ptClip,true);
  c.Execute(ClipperLib.ClipType.ctDifference,solution,ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftNonZero);
  return foundry.data.PolygonTree.fromClipperPolyTree(solution);
}
export function fitRegion(scene,shapes,id,{center=null,locations=[]}={}) {
  const original=shapeTree(scene,shapes);
  const other=scene.regions.filter(r=>r.id!==id&&isBoundary(r));
  const paths=other.flatMap(r=>r.clipperPaths);
  const tree=paths.length?subtractPaths(original.clipperPaths,paths):original;
  need(tree.area>0,"Вся новая область уже занята другими регионами. Нарисуйте её за их границами.");
  if(center)need(tree.testPoint(center,-.005),"Центр оказался вне свободной области. Сначала переместите центр внутрь региона.");
  for(const l of locations)need(tree.testPoint(l),`Локация «${l.name}» оказалась вне свободной области. Сначала переместите её.`);
  const changed=Math.abs(tree.area-original.area)>.0001;
  const fitted=changed?[...tree].map(n=>({type:"polygon",points:[...n.points],hole:n.isHole})):shapes.map(s=>s.toObject?s.toObject():s);
  return {shapes:fitted,tree,changed};
}
export function drawTree(graphics,tree,color) {
  // Each island is drawn separately; children of holes are filled again, preserving nested regions.
  for(const node of tree)if(!node.isHole) {
    graphics.beginFill(color,1).drawPolygon(node.points);
    for(const hole of node.children)graphics.beginHole().drawPolygon(hole.points).endHole();
    graphics.endFill();
  }
}
