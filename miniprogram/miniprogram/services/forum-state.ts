import {sessionRevision} from './community';
type State={revision:number;fields:Record<string,unknown>};
const states=new Map<string,State>();let revision=-1,clock=0;
function scope(){const current=sessionRevision();if(current!==revision){states.clear();clock=0;revision=current;}}
export function forumReadStamp(){scope();return clock;}
const keys=['likes','replyCount','reactions','bookmarked','poll'];
function fields(row:Record<string,unknown>){const value:Record<string,unknown>={};for(const key of keys)if(Object.prototype.hasOwnProperty.call(row,key))value[key]=row[key];return value;}
/** Partial legacy lists must not erase known counts, ballots or reactions. */
export function rememberForumPost<T extends {id:string}>(row:T,stamp=forumReadStamp()):T{
  scope();const old=states.get(row.id),incoming=fields(row as Record<string,unknown>);
  const merged=old&&old.revision>stamp?{...incoming,...old.fields}:{...old?.fields,...incoming};
  states.delete(row.id);states.set(row.id,{revision:old?.revision||0,fields:merged});while(states.size>256)states.delete(states.keys().next().value!);
  return {...row,...merged};
}
export function patchForumPost(id:string,patch:Record<string,unknown>){scope();if(!Object.keys(fields(patch)).length)return;const old=states.get(id);states.set(id,{revision:++clock,fields:{...old?.fields,...fields(patch)}});}
export function needsForumDetails(row:Record<string,unknown>){return !Number.isInteger(row.likes)||!Number.isInteger(row.replyCount)||!Array.isArray(row.reactions)||!('poll' in row);}

export function patchForumReaction(id:string,kind:string,active:boolean,likes?:number){
  scope();const current=states.get(id)?.fields||{},old=Array.isArray(current.reactions)?current.reactions as string[]:[];
  const reactions=old.filter(value=>value!==kind);if(active)reactions.push(kind);
  const patch={reactions,...(kind==='like'&&Number.isInteger(likes)?{likes}:{}),...(kind==='bookmark'?{bookmarked:active}:{})};patchForumPost(id,patch);return patch;
}

/** Project an existing cached row without treating it as a new server response. */
export function knownForumPost<T extends {id:string}>(row:T):T{scope();return {...row,...states.get(row.id)?.fields};}
