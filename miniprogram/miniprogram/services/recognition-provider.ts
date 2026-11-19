import { RecognitionInput, RecognitionKind, RecognitionTransport, RecognitionError, startRecognition } from './recognition';

/** UI-independent handoff slot. No endpoint, credential, camera or Page is owned here. */
export interface RecognitionProvider {
  contract:'bird-recognition/1';
  kinds:RecognitionKind[];
  createTransport():RecognitionTransport;
}
let provider:RecognitionProvider|null=null;
export function installRecognitionProvider(value:RecognitionProvider|null) {
  if(value&&(value.contract!=='bird-recognition/1'||typeof value.createTransport!=='function'||!Array.isArray(value.kinds)||!value.kinds.length||value.kinds.some(kind=>kind!=='photo'&&kind!=='audio')))throw new Error('Unsupported recognition integration contract');
  provider=value;
}
export function recognitionAvailable(kind:RecognitionKind='photo'){return provider!==null&&provider.kinds.includes(kind);}
export function recognizeWithProvider(input:RecognitionInput):ReturnType<typeof startRecognition> {
  if(!provider)throw new RecognitionError('NOT_CONFIGURED','识别模块尚未安装，素材仍可保留。');
  if(!provider.kinds.includes(input.kind))throw new RecognitionError('UNSUPPORTED_KIND','已安装的模块暂不支持此类素材，原件仍保留。');
  return startRecognition(provider.createTransport(),input);
}
