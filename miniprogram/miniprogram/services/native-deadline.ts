/** Native timeout options are not a guarantee that a suspended bridge calls back. */
export function nativeDeadline<T>(start:(resolve:(value:T)=>void,reject:(error:unknown)=>void)=>void|{abort:()=>void},milliseconds:number,message:string):Promise<T>{
  return new Promise((resolve,reject)=>{
    let settled=false,task:void|{abort:()=>void};
    const finish=(action:()=>void)=>{if(settled)return;settled=true;clearTimeout(timer);action();};
    const timer=setTimeout(()=>{finish(()=>reject(new Error(message)));try{task?.abort();}catch{/* The bridge may already be detached. */}},milliseconds);
    try{task=start(value=>finish(()=>resolve(value)),error=>finish(()=>reject(error)));}catch(error){finish(()=>reject(error));}
  });
}
