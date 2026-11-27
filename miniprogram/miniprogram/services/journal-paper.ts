export const papers=[{id:'plain',name:'素纸'},{id:'fiber',name:'纤维纸'},{id:'linen',name:'细织纹'},{id:'grid',name:'方格纸'},{id:'dots',name:'点阵纸'},{id:'ruled',name:'横线纸'}];
export const paperColors=['#f5efdf','#eee8da','#ffffff','#edf1e8','#f2e6e0','#e8edf1'];
export function paperSource(id?:string){return id&&id!=='plain'&&papers.some(p=>p.id===id)?'/assets/papers/'+id+'.png':'';}
