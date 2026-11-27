export interface JournalAiInput {
  version:1;requestId:string;prompt:string;purpose:string;maxChars:number;
  images:Array<{id:string;path:string;label:string}>;
}
export interface JournalAiSuggestion {
  version:1;requestId:string;title:string;body:string;
  design:{style:'nature'|'magazine'|'minimal';variant:number};
  captions?:Array<{id:string;text:string}>;
}
export interface JournalAiTransport {
  /** Gateway adapter uploads only selected bounded copies, attaches user session and owns timeout. */
  generate(input:JournalAiInput):{result:Promise<unknown>;cancel():void};
}
export class JournalAiError extends Error {constructor(readonly code:string,message:string){super(message);this.name='JournalAiError';}}
let transport:JournalAiTransport|null=null;
export function installJournalAiTransport(value:JournalAiTransport|null){transport=value;}
export function journalAiAvailable(){return transport!==null;}
export function parseJournalSuggestion(value:unknown,input:JournalAiInput):JournalAiSuggestion {
  const v=value as Partial<JournalAiSuggestion>|null;
  if(!v||v.version!==1||v.requestId!==input.requestId||typeof v.title!=='string'||Array.from(v.title).length>40||typeof v.body!=='string'||!v.body.trim()||Array.from(v.body).length>input.maxChars||!v.design||!['nature','magazine','minimal'].includes(v.design.style)||!Number.isInteger(v.design.variant)||v.design.variant<1||v.design.variant>3)throw new Error('AI 建议格式不符合约定，原文未修改，可重试。');
  // Whitelist fields: remote output cannot inject paths, geometry or document identity.
  let captions:Array<{id:string;text:string}>|undefined;
  if(v.captions!==undefined){
    if(!Array.isArray(v.captions)||v.captions.length>4||v.captions.some(p=>!p||!input.images.some(image=>image.id===p.id)||typeof p.text!=='string'||!p.text.trim()||Array.from(p.text).length>80)||new Set(v.captions.map(p=>p.id)).size!==v.captions.length)throw new Error('照片说明与所选图片不一致，原文未修改。');
    captions=v.captions.map(p=>({id:p.id,text:p.text}));
  }
  return {version:1,requestId:input.requestId,title:v.title,body:v.body,design:{style:v.design.style,variant:v.design.variant},...(captions?{captions}:{})};
}
export function startJournalAi(input:JournalAiInput,override?:JournalAiTransport) {
  const selected=override||transport;
  if(!selected)throw new Error('Qwen 手帐网关尚未配置；尚未发送请求，原文仍保留。');
  if(!input.prompt.trim())throw new Error('请补充写作要求，再生成建议。');
  if(input.images.length>4)throw new Error('已选择 '+input.images.length+' 张照片，每次最多关联 4 张。请取消多余照片后再生成。');
  if(input.prompt.length>2000)throw new Error('写作要求过长，请缩短后再生成。');
  if(new Set(input.images.map(p=>p.id)).size!==input.images.length||!Number.isInteger(input.maxChars)||input.maxChars<20||input.maxChars>600)throw new Error('写作内容或照片选择无效，请重新整理。');
  const source=selected.generate(input);let active=true,rejectJob:(error:Error)=>void=()=>{};
  const result=new Promise<JournalAiSuggestion>((resolve,reject)=>{rejectJob=reject;source.result.then(value=>{if(!active)return;active=false;try{resolve(parseJournalSuggestion(value,input));}catch(error){reject(error);}},error=>{if(active){active=false;reject(error instanceof JournalAiError?error:new Error('AI 请求未完成，原文与照片仍保留，可重试。'));}});});
  return {result,cancel(){if(!active)return;active=false;rejectJob(new Error('已取消 AI 请求，原文仍保留。'));try{source.cancel();}catch{/* cancellation already settled locally */}}};
}
