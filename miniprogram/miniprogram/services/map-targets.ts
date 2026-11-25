import {Cluster} from './map-clusters';

export type MarkerTarget={group:Cluster;query:Record<string,unknown>;zoom:number};
/** Native taps may arrive after several marker updates; IDs must outlive a render. */
export class MapTargets{
  private sequence=0;
  private ids=new Map<string,number>();
  private targets=new Map<number,MarkerTarget>();
  assign(groups:Cluster[],query:Record<string,unknown>,zoom:number){
    const filters=JSON.stringify([query.scope,query.origin,query.speciesId,query.startDate,query.endDate]);
    const current=new Set<number>();
    const ids=groups.map(group=>{
      const key=filters+'|'+JSON.stringify(group);
      let id=this.ids.get(key);
      if(id===undefined){id=++this.sequence;this.ids.set(key,id);}
      this.targets.delete(id);this.targets.set(id,{group,query:{...query},zoom});current.add(id);
      return id;
    });
    // Retain a bounded history for delayed native callbacks, never evict live IDs.
    for(const entry of this.targets){
      if(this.targets.size<=Math.max(512,current.size))break;
      if(!current.has(entry[0]))this.targets.delete(entry[0]);
    }
    for(const entry of this.ids)if(!this.targets.has(entry[1]))this.ids.delete(entry[0]);
    return ids;
  }
  get(raw:unknown){const id=Number(raw);return Number.isSafeInteger(id)?this.targets.get(id):undefined;}
}
