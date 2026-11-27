export type RecognitionKind = 'photo' | 'audio';
export type RecognitionState = 'candidate' | 'unknown';
export interface RecognitionCandidate {
  rank:number; speciesId:string|null; scientificName:string; name:string;
  score:number; scoreType:'relative_similarity'|'dongniao_confidence'|'birdnet_confidence'|'mock';
  scoreText:string; mapped:boolean;
}
export interface RecognitionSubject {
  rank:number; state:RecognitionState; reason:string;
  box:{x1:number;y1:number;x2:number;y2:number}; candidates:RecognitionCandidate[];
}
export interface RecognitionResult {
  analysisId:string; kind:RecognitionKind; state:RecognitionState; reason:string;
  candidates:RecognitionCandidate[]; subjects:RecognitionSubject[];
  model:{name:string;backend:string;revision?:string;catalogVersion?:string}; example:boolean;
  frameContext?:{sessionId:string;capturedAt:string;latitude:number|null;longitude:number|null;regionCode:string|null};
  photoContext?:Record<string,string>;
}
export interface RecognitionInput {kind:RecognitionKind;filePath:string;reference:string;sample?:boolean;}
export interface RecognitionUpload {
  path:string; name:'image'|'audio'; filePath:string; formData:Record<string,string>;
}
export interface RecognitionResponse {statusCode:number;data:string;header?:Record<string,string>;}
export interface RecognitionTransport {
  // The transport owns HTTPS, native timeout, session authorization and upload-domain configuration.
  upload(request:RecognitionUpload,success:(response:RecognitionResponse)=>void,fail:()=>void):{abort():void};
}
export class RecognitionError extends Error {
  constructor(readonly code:string,message:string,readonly requestId='',readonly retryAfterSeconds:number|null=null) {
    super(message);this.name='RecognitionError';
  }
}
function invalid():never {throw new RecognitionError('INVALID_RESPONSE','识别结果格式无法读取，原素材仍保留。');}
function object(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
  return value as Record<string,unknown>;
}
function text(value:unknown,max=200):string {
  if(typeof value!=='string'||!value.trim()||value.length>max)return invalid();
  return value;
}
function optionalText(value:unknown,max=200):string {
  if(value===null||value===undefined)return '';
  if(typeof value!=='string'||value.length>max)return invalid();return value.trim();
}
function number(value:unknown,min:number,max:number):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)return invalid();return value;
}
function rank(value:unknown):number {const n=number(value,1,10000);return Number.isInteger(n)?n:invalid();}
function state(value:unknown):RecognitionState {return value==='candidate'||value==='unknown'?value:invalid();}
function list(value:unknown,max:number):unknown[] {return Array.isArray(value)&&value.length<=max?value:invalid();}
function candidates(value:unknown,kind:RecognitionKind):RecognitionCandidate[] {
  const ranks:number[]=[];
  return list(value,50).map(raw=>{
    const c=object(raw),order=rank(c.rank);if(ranks.includes(order))return invalid();ranks.push(order);
    let scoreType:RecognitionCandidate['scoreType'];
    if(c.score_type==='mock')scoreType='mock';
    else if(kind==='photo'&&c.score_type==='relative_similarity')scoreType='relative_similarity';
    else if(kind==='photo'&&c.score_type==='dongniao_confidence')scoreType='dongniao_confidence';
    else if(kind==='audio'&&c.score_type==='birdnet_confidence')scoreType='birdnet_confidence';
    else return invalid();
    const scientificName=text(c.scientific_name),speciesId=optionalText(c.species_id)||null;
    if(kind==='photo'&&!speciesId&&scoreType!=='dongniao_confidence')return invalid();
    if(kind==='audio'&&typeof c.mapped!=='boolean')return invalid();
    const score=number(c.score,0,1);
    // Keep the backend score separately; display two decimals without calling it a probability.
    return {rank:order,speciesId,scientificName,name:optionalText(c.common_name_zh)||optionalText(c.common_name_en)||scientificName,
      score,scoreType,scoreText:scoreType==='dongniao_confidence'?`懂鸟 ${(score*100).toFixed(1)}%`:score.toFixed(2),mapped:kind==='photo'?!!speciesId:c.mapped===true};
  });
}
export function trackCandidates(value:unknown):RecognitionCandidate[] {
  return candidates(list(value,50).map((entry,index)=>({...object(entry),rank:index+1})),'photo');
}
function decode(body:string):Record<string,unknown> {
  if(typeof body!=='string'||body.length>1024*1024)return invalid();
  try{return object(JSON.parse(body) as unknown);}catch{return invalid();}
}

/** Preserve photo subjects separately from the aggregate list, including unknown subjects. */
export function parseRecognitionResult(body:string,kind:RecognitionKind,reference?:string):RecognitionResult {
  const raw=decode(body),model=object(raw.model),policy=object(raw.policy);
  const resultState=state(raw.state),items=candidates(raw.candidates,kind);
  if(resultState==='candidate'&&!items.length)return invalid();
  if(kind==='audio'&&reference!==undefined&&raw.client_reference!==reference)return invalid();
  const ranks:number[]=[];
  const subjects:RecognitionSubject[]=kind==='audio'?[]:list(raw.subjects,32).map(value=>{
    const s=object(value),box=object(s.bbox),order=rank(s.rank);
    if(ranks.includes(order))return invalid();ranks.push(order);
    const bounds={x1:number(box.x1,0,1),y1:number(box.y1,0,1),x2:number(box.x2,0,1),y2:number(box.y2,0,1)};
    if(bounds.x2<=bounds.x1||bounds.y2<=bounds.y1)return invalid();
    const subjectState=state(s.state),subjectCandidates=candidates(s.candidates,kind);
    if(subjectState==='candidate'&&!subjectCandidates.length)return invalid();
    return {rank:order,state:subjectState,reason:text(s.reason),box:bounds,candidates:subjectCandidates};
  });
  const backend=text(model.backend),details=model.details?object(model.details):{};
  return {analysisId:text(raw.analysis_id,128),kind,state:resultState,reason:text(policy.reason),candidates:items,subjects,
    model:{name:text(model.name),backend,revision:optionalText(details.revision),catalogVersion:optionalText(details.catalog_version)},example:backend==='mock'||policy.score_type==='mock'||items.some(c=>c.scoreType==='mock')||subjects.some(s=>s.candidates.some(c=>c.scoreType==='mock'))};
}

const ERROR_COPY:Record<string,string>={
  AUDIO_TOO_LONG:'录音过长，请选取不超过 60 秒的片段。',AUDIO_TOO_SHORT:'录音过短，请保留至少 1 秒的声音。',
  AUDIO_TOO_LARGE:'录音文件过大，请缩短片段后重试。',IMAGE_TOO_LARGE:'图片超过服务限制，请使用较小副本，保留原图。',
  UNSUPPORTED_AUDIO_FORMAT:'暂不支持此音频格式，可改用 MP3、WAV、AAC 或 M4A。',
  UNSUPPORTED_IMAGE_FORMAT:'暂不支持此图片格式，可改用 JPEG、PNG 或 WebP。',
  AUDIO_CAPACITY_EXCEEDED:'识别服务繁忙，请稍后手动重试。'
};
export function recognitionFailure(response:RecognitionResponse):RecognitionError {
  // Never display/log arbitrary server messages, debug details, paths or credentials.
  let code='HTTP_ERROR',requestId='';
  try{const e=object(decode(response.data).error);if(typeof e.code==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(e.code))code=e.code;
    if(typeof e.request_id==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(e.request_id))requestId=e.request_id;
  }catch{/* Non-JSON gateway failures are still recoverable. */}
  const status=response.statusCode,headers=response.header||{};
  const retryKey=Object.keys(headers).find(key=>key.toLowerCase()==='retry-after');
  const retryRaw=retryKey?headers[retryKey]:'';
  const retry=/^\d{1,5}$/.test(retryRaw)?Number(retryRaw):null;
  const message=status===401||status===403?'识别授权不可用，请稍后重新进入或联系管理员。':status===502||status===504?'识别服务暂不可用（HTTP '+status+'），原素材仍保留，请稍后手动重试。':status===429||status===503?'识别服务繁忙，请稍后手动重试。':ERROR_COPY[code]||'识别未完成，原素材与笔记仍保留，可稍后重试。';
  return new RecognitionError(code,message,requestId,retry);
}
export function recognitionUpload(input:RecognitionInput):RecognitionUpload {
  if(input.kind!=='photo'&&input.kind!=='audio')throw new RecognitionError('UNSUPPORTED_KIND','当前只准备单张照片和录音识别，视频可先保存在本机。');
  if(input.sample)throw new RecognitionError('EXAMPLE_MEDIA','示例素材用于界面体验，不作为真实目击上传。');
  if(!input.filePath.trim()||!/^[A-Za-z0-9._:-]{1,128}$/.test(input.reference))throw new RecognitionError('INVALID_INPUT','请选择有效素材后重试。');
  return {path:input.kind==='photo'?'/api/v1/vision/analyses':'/api/v1/audio/analyses',name:input.kind==='photo'?'image':'audio',
    filePath:input.filePath,formData:input.kind==='photo'?{}:{client_reference:input.reference}};
}

/** One explicit attempt; no automatic retries. Cancel settles locally and ignores late native callbacks. */
export function startRecognition(transport:RecognitionTransport,input:RecognitionInput):{result:Promise<RecognitionResult>;cancel():void} {
  let task:{abort():void}|undefined,settled=false;
  let cancel=()=>{};
  const result=new Promise<RecognitionResult>((resolve,reject)=>{
    const fail=(error:RecognitionError)=>{if(settled)return;settled=true;reject(error);};
    cancel=()=>{if(settled)return;fail(new RecognitionError('CANCELLED','已取消识别，原素材仍保留。'));try{task?.abort();}catch{/* Already settled locally. */}};
    try{
      task=transport.upload(recognitionUpload(input),response=>{
        if(settled)return;
        try{
          if(response.statusCode!==200){fail(recognitionFailure(response));return;}
          const value=parseRecognitionResult(response.data,input.kind,input.kind==='audio'?input.reference:undefined);
          settled=true;resolve(value);
        }catch{fail(new RecognitionError('INVALID_RESPONSE','识别结果格式无法读取，原素材仍保留。'));}
      },()=>fail(new RecognitionError('UPLOAD_FAILED','上传未完成，请检查网络后重试，原素材仍保留。')));
    }catch(error){fail(error instanceof RecognitionError?error:new RecognitionError('UPLOAD_FAILED','上传未完成，原素材仍保留。'));}
  });
  return {result,cancel:()=>cancel()};
}
