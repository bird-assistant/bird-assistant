export type TripBrief={headline:string;reasons:string[];watchFor:string[];preparation:string[];uncertainty:string[]};
export function adviceSections(brief:TripBrief|null|undefined){
  if(!brief)return [];
  return [{title:'为什么去',lines:brief.reasons},{title:'可以留意',lines:brief.watchFor},
    {title:'出发前准备',lines:brief.preparation},{title:'需要留意',lines:brief.uncertainty}].filter(section=>section.lines?.length);
}
/** Keep the older service response readable without inventing new recommendations. */
export function adviceParagraphs(text:string){
  const paragraphs=text.replace(/\r/g,'').split(/\n+/).map(line=>line.trim()).filter(Boolean);
  const all:string[]=[];
  for(const paragraph of paragraphs){
    const sentences=paragraph.match(/[^。！？!?]+[。！？!?]?/g)||[paragraph],result:string[]=[];
    let line='';for(const sentence of sentences){if(line&&line.length+sentence.length>120){result.push(line);line='';}line+=sentence;}
    if(line)result.push(line);all.push(...result);
  }
  return all;
}
