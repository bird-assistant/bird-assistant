export const POST_WRITING_PURPOSES=['润色现有文字','写观鸟分享','整理鉴定求助'];
export interface PostWritingInput {title:string;body:string;instructions:string;purpose:number;image:string;includeImage:boolean;}

/** Provider-neutral request preparation only; no model call or automatic publishing. */
export function postWritingBrief(input:PostWritingInput) {
  const purpose=POST_WRITING_PURPOSES[input.purpose]||POST_WRITING_PURPOSES[1];
  if(!input.title.trim()&&!input.body.trim()&&!input.instructions.trim())throw new Error('先写一点观察、疑问或写作要求，帮助保留你的原意。');
  if(input.purpose===0&&!input.title.trim()&&!input.body.trim())throw new Error('润色需要已有标题或正文，也可以切换为写观鸟分享。');
  return {version:1,purpose,title:input.title,body:input.body,instructions:input.instructions.trim(),images:input.includeImage&&input.image?[input.image]:[],rules:['保留用户原意，不虚构物种、拍摄时间或地点。','鉴定不确定时明确保留疑问。','返回可预览的标题与正文，由用户确认采用；不自动发布。']};
}
