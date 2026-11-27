/** Bounded preview work. These are analysis copies, never replacements for a shutter photo. */
export class LiveSampling {
  private sent=-Infinity;
  private checked=-Infinity;
  private stable=0;
  private signature:number[]=[];
  private target='';
  private previousMode='';
  feedback(targets:Array<{id:number;appearance:string}>){
    const key=targets.filter(track=>track.appearance!=='lost').map(track=>track.id).sort((a,b)=>a-b).join(',');
    this.stable=key===this.target?this.stable+1:0;this.target=key;
  }
  interval(mode:string,server:number){return Math.max(server,mode==='wait'?(this.stable>=3?4000:1800):(this.stable>=4?1600:1000));}
  allow(now:number,mode:string,server:number,rgba:ArrayBuffer){
    if(mode!==this.previousMode){this.stable=0;this.previousMode=mode;}
    if(now-this.checked<Math.max(300,server))return false;
    this.checked=now;const bytes=new Uint8Array(rgba),signature:number[]=[];
    for(let i=0;i<64;i++){const p=Math.floor(i*Math.max(0,bytes.length/4-1)/63)*4;signature.push(((bytes[p]||0)*3+(bytes[p+1]||0)*6+(bytes[p+2]||0))/10);}
    const motion=this.signature.length?signature.reduce((sum,n,i)=>sum+Math.abs(n-this.signature[i]),0)/signature.length:0;
    this.signature=signature;if(motion>12)this.stable=0;
    if(now-this.sent<this.interval(mode,server))return false;
    this.sent=now;return true;
  }
}

export class RecoveryFrames<T extends {id:string;capturedAt:string;image:ArrayBuffer}> {
  private entries:Array<{value:T;score:number}>=[];
  constructor(private age=20000,private budget=2400000){}
  private prune(now:number){this.entries=this.entries.filter(item=>now-Date.parse(item.value.capturedAt)<=this.age&&Date.parse(item.value.capturedAt)<=now+1000);}
  add(value:T,score:number,now=Date.now()){
    this.prune(now);if(!(score>0)||value.image.byteLength>this.budget)return;
    this.entries=this.entries.filter(item=>item.value.id!==value.id);
    this.entries.push({value,score});this.entries.sort((a,b)=>b.score-a.score||b.value.capturedAt.localeCompare(a.value.capturedAt));
    this.entries=this.entries.slice(0,2);
    while(this.entries.reduce((sum,item)=>sum+item.value.image.byteLength,0)>this.budget)this.entries.pop();
  }
  list(now=Date.now()){this.prune(now);return this.entries.map(item=>item.value);}
  clear(){this.entries=[];}
}
