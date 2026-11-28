const KEY='bird-assistant.fault-summary.v1';
type Fault={at:string;stage:string;kind:string;frames:string[]};
/** Store categories and code locations only: no URL parameters, media paths, text or credentials. */
export function faultSummary(stage:string,value:unknown){
  const error=value instanceof Error?value.message+'\n'+value.stack:String(value);
  const kind=/鉴权|auth|401|403/i.test(error)?'认证失败':/domain|域名/i.test(error)?'域名配置':/502|503|504/.test(error)?'服务不可用':/网络|network|request:fail/i.test(error)?'网络请求失败':/null/i.test(error)?'空异常':/timeout|超时/i.test(error)?'超时':'应用异常';
  const frames=Array.from(new Set(error.match(/[A-Za-z0-9_.-]+\.(?:js|ts):\d+(?::\d+)?/g)||[])).slice(0,4);
  try{const existing=wx.getStorageSync(KEY);const rows=Array.isArray(existing)?existing:[];const next:Fault={at:new Date().toISOString(),stage:stage.replace(/[^a-z-]/g,'').slice(0,25),kind,frames};wx.setStorageSync(KEY,[next,...rows].slice(0,20));}catch{/* Diagnostics never block the user's work. */}
}
export function diagnosticText(){
  const device=wx.getDeviceInfo?.(),app=wx.getAppBaseInfo?.();const rows=wx.getStorageSync(KEY);
  return JSON.stringify({version:'0.4.21',model:device?.model,platform:device?.platform,system:device?.system,wechat:app?.version,library:app?.SDKVersion,
    faults:Array.isArray(rows)?rows.slice(0,20):[]},null,2);
}
