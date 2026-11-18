export const places = [
  { id: 'lake', region: 'lake', x: 35, y: 43, name: '湖畔公园' },
  { id: 'wood', region: 'wood', x: 73, y: 24, name: '林间小径' },
  { id: 'reed', region: 'lake', x: 24, y: 64, name: '芦苇栈道' },
  { id: 'lookout', region: 'lake', x: 59, y: 65, name: '湖畔观鸟台' },
  { id: 'grove', region: 'wood', x: 65, y: 16, name: '松林休憩点' },
  { id: 'gate', region: 'wood', x: 85, y: 34, name: '林间入口' }
];
export const currentPoint = { x: 50.75, y: 72.65625 };
export const mapRecords = [
  { id: 'lake-a', x: 35, y: 43, name: '树麻雀', author: '林栖', region: 'lake', date: '2026-10-21', image: '/assets/samples/field-0.png', private: false },
  { id: 'wood-a', x: 73, y: 24, name: '大山雀', author: '美宁', region: 'wood', date: '2026-10-20', image: '/assets/samples/field-2.png', private: false },
  { id: 'mine-a', x: 59, y: 65, name: '普通翠鸟', author: '我的示例标记', region: 'lake', date: '2026-10-18', image: '/assets/samples/field-1.png', private: true }
];
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export function offsetFor(p: {x: number; y: number}, w: number, h: number, z: number) { return { x: (.5 - p.x / 100) * w * z, y: (.5 - p.y / 100) * h * z }; }
export function centerAt(x: number, y: number, w: number, h: number, z: number) { return { x: (.5 - x / w / z) * 100, y: (.5 - y / h / z) * 100 }; }
export function regionAt(p: {x: number; y: number}, previous: string) {
  const distance = (r: typeof places[number]) => Math.hypot((p.x - r.x) * .625, p.y - r.y);
  const regions = places.slice(0, 2).sort((a, b) => distance(a) - distance(b));
  const old = regions.find(r => r.id === previous);
  return old && distance(old) <= distance(regions[0]) + 4 ? old.id : regions[0].id;
}
export function markers(records: typeof mapRecords, width: number, height: number, zoom: number) {
  const groups: Array<{id: string; x: number; y: number; count: number; private: boolean; ids: string[]}> = [];
  for (const r of records) {
    const group = !r.private && groups.find(g => !g.private && Math.hypot((g.x-r.x)*width*zoom/100, (g.y-r.y)*height*zoom/100) < 92);
    if (group) { group.x = (group.x*group.count+r.x)/(group.count+1); group.y = (group.y*group.count+r.y)/(group.count+1); group.count++; group.ids.push(r.id); }
    else groups.push({id:r.id,x:r.x,y:r.y,count:1,private:r.private,ids:[r.id]});
  }
  return groups;
}
