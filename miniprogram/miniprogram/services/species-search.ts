import {api} from './community';

export type SpeciesMatch={id:string;name?:string;english?:string;scientific?:string};
export type SpeciesSearchState={matches:SpeciesMatch[];searching:boolean;searchError:string;searchMore:boolean};
/** One bounded search session. Edits and dismissal invalidate every older response. */
export function speciesSearch(update:(state:SpeciesSearchState)=>void,delay=220){
  let generation=0,timer=0 as unknown as ReturnType<typeof setTimeout>,query='',items:SpeciesMatch[]=[],busy=false,more=false,offset=0;
  const emit=(error='')=>update({matches:items,searching:busy,searchError:error,searchMore:more});
  const close=()=>{generation++;clearTimeout(timer);items=[];busy=false;more=false;offset=0;emit();};
  async function load(append=false){
    if(!query||busy||(append&&!more))return;
    const token=generation,term=query;busy=true;emit();
    try{
      const response=await api('/api/v1/species','GET',{q:term,limit:20,offset:append?offset:0});
      if(token!==generation)return;
      const incoming=(response.items||[]) as SpeciesMatch[],previous=append?items:[];
      const unique=new Map(previous.map(row=>[row.id,row]));for(const row of incoming)unique.set(row.id,row);
      items=Array.from(unique.values());offset=(append?offset:0)+incoming.length;
      more=response.hasMore===true&&items.length>previous.length;
      busy=false;emit(items.length?'':'没有匹配的鸟种，请换一个关键词。');
    }catch{if(token===generation){busy=false;emit('搜索未完成，可重试。');}}
  }
  return {
    input(value:string){close();query=value.trim();if(query)timer=setTimeout(()=>void load(),delay);},
    search(value?:string){clearTimeout(timer);if(value!==undefined&&value.trim()!==query){close();query=value.trim();}return load();},
    more:()=>load(true),close
  };
}
