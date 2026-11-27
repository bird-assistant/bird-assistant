/** One local player per owning view. Stopping clears ownership before native callbacks fire. */
export class LocalAudioPlayback {
  private player:WechatMiniprogram.InnerAudioContext|null=null;
  constructor(private failed:()=>void){}
  play(path:string){
    this.stop();if(!path)return;
    try{const player=wx.createInnerAudioContext();this.player=player;player.src=path;
      player.onEnded(()=>{if(this.player===player)this.stop();});
      player.onError(()=>{if(this.player!==player)return;this.stop();this.failed();});player.play();
    }catch{this.stop();this.failed();}
  }
  stop(){const player=this.player;this.player=null;if(!player)return;try{player.stop();}catch{}try{player.destroy();}catch{}}
}
