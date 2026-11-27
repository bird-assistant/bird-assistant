/** Measure the content, then give the native scroll-view a bounded pixel height. */
type SheetPage={data:Record<string,unknown>;setData:(values:Record<string,unknown>,done?:()=>void)=>void};
type Measured={height:number;dataset?:{sheetId?:string}};
const schedules=new WeakMap<object,()=>void>();
const cleanups=new WeakMap<object,()=>void>();
export function sheetBodyHeight(content:number,header:number,viewport:number,top=0){
  const available=Math.max(40,Math.min(viewport*.84,viewport-top-56)-header);
  return Math.floor(Math.min(available,Math.max(64,Number.isFinite(content)?content:64)));
}
export function fitAdaptiveSheets(page:object){schedules.get(page)?.();}
export function stopAdaptiveSheets(page:object){cleanups.get(page)?.();cleanups.delete(page);schedules.delete(page);}
export function installAdaptiveSheets(page:SheetPage,visible:()=>boolean=()=>true){
  if(schedules.has(page)||typeof wx.createSelectorQuery!=='function')return;
  const original=page.setData.bind(page);let queued=false,measuring=false,again=false,keyboard=0;
  let initialHeight=typeof wx.getWindowInfo==='function'?wx.getWindowInfo().windowHeight:0;
  const schedule=()=>{
    if(!schedules.has(page)||!visible())return;
    if(measuring){again=true;return;}if(queued)return;queued=true;
    wx.nextTick(()=>{
      queued=false;if(!schedules.has(page)||!visible())return;measuring=true;
      const query=wx.createSelectorQuery().in(page as WechatMiniprogram.Page.Instance<WechatMiniprogram.IAnyObject,WechatMiniprogram.IAnyObject>);
      if(typeof query.selectAll!=='function'){measuring=false;return;}
      query.selectAll('.sheet-measure').fields({size:true,dataset:true});
      query.selectAll('.sheet-header-fixed').fields({size:true,dataset:true});
      query.exec((rows:Measured[][])=>{
        measuring=false;if(!schedules.has(page)||!visible())return;const bodies=rows?.[0]||[],headers=rows?.[1]||[];
        const window=wx.getWindowInfo();if(!keyboard)initialHeight=window.windowHeight;const heights={...(page.data.sheetHeights as Record<string,number>||{})};let changed=false;
        for(const body of bodies){const id=body.dataset?.sheetId;if(!id)continue;
          const header=headers.find(item=>item.dataset?.sheetId===id)?.height||72;
          // Some Android versions resize windowHeight for the keyboard, others overlay it.
          // Never subtract the keyboard twice, and include the body's safe-area padding.
          const viewport=Math.min(window.windowHeight,(initialHeight||window.windowHeight)-keyboard);
          const height=sheetBodyHeight(body.height,header,viewport,window.statusBarHeight||0);
          if(heights[id]!==height){heights[id]=height;changed=true;}
        }
        const finish=()=>{if(again){again=false;schedule();}};
        if(changed)original({sheetHeights:heights},finish);else finish();
      });
    });
  };
  schedules.set(page,schedule);
  const keyboardChanged=(event:{height:number})=>{keyboard=Math.max(0,event.height);schedule();};
  wx.onKeyboardHeightChange?.(keyboardChanged);
  cleanups.set(page,()=>wx.offKeyboardHeightChange?.(keyboardChanged));
  page.setData=(values,done)=>original(values,()=>{done?.();schedule();});
  schedule();
}
