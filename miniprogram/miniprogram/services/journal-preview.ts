/** A latest-value render queue. It never queues document snapshots or history. */
export function previewQueue(render:()=>void,interval=40,clock:()=>number=Date.now) {
  let timer:ReturnType<typeof setTimeout>|null=null,last=-Infinity,pending=false;
  const flush=()=>{if(timer!==null){clearTimeout(timer);timer=null;}if(!pending)return;pending=false;last=clock();render();};
  return {
    request(){pending=true;const wait=interval-(clock()-last);if(wait<=0)flush();else if(timer===null)timer=setTimeout(flush,wait);},
    flush,
    cancel(){if(timer!==null)clearTimeout(timer);timer=null;pending=false;last=-Infinity;}
  };
}
