import ts from 'typescript';

/** Consume every tag/attribute byte. WXML permits comparison operators inside quotes. */
export function assertWxmlSyntax(source,file='template.wxml'){
  const stack=[];let at=0,tags=0,bindings=0;
  const fail=(message,position=at)=>{const lines=source.slice(0,position).split('\n');throw new Error(`${file}:${lines.length}:${lines.at(-1).length+1}: ${message}`);};
  const space=()=>{const before=at;while(/\s/.test(source[at]||'')&&at<source.length)at++;return at>before;};
  const name=()=>{const match=/^[A-Za-z_:@][\w:.-]*/.exec(source.slice(at));if(!match)fail('Unexpected character in WXML tag or attribute');at+=match[0].length;return match[0];};
  const decode=value=>value.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi,(_all,key)=>{
    if(key.startsWith('#'))return String.fromCodePoint(key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1)));
    return {lt:'<',gt:'>',amp:'&',quot:'"',apos:"'"}[key.toLowerCase()];
  });
  function binding(value,start,offset){
    let i=start+2,quote='',depth=0;
    for(;i<value.length;i++){
      const char=value[i];
      if(quote){if(char==='\\')i++;else if(char===quote)quote='';continue;}
      if(char==='"'||char==="'"||char==='`'){quote=char;continue;}
      if(!depth&&value.startsWith('}}',i))break;
      if(char==='{')depth++;else if(char==='}')depth--;
      if(depth<0)fail('Unbalanced WXML binding',offset+i);
    }
    if(i>=value.length)fail('Unclosed WXML binding',offset+start);
    const expression=decode(value.slice(start+2,i));
    if(!expression.trim())fail('Empty WXML binding',offset+start);
    const parsed=ts.createSourceFile(file+'.js','('+expression+'\n)',ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    if(parsed.parseDiagnostics.length)fail('Invalid WXML expression: '+ts.flattenDiagnosticMessageText(parsed.parseDiagnostics[0].messageText,' '),offset+start);
    bindings++;return i+2;
  }
  function checkBindings(value,offset){let next=0;while((next=value.indexOf('{{',next))!==-1)next=binding(value,next,offset);}
  while(at<source.length){
    if(source.startsWith('<!--',at)){const end=source.indexOf('-->',at+4);if(end<0)fail('Unclosed WXML comment');at=end+3;continue;}
    if(source.startsWith('{{',at)){at=binding(source,at,0);continue;}
    if(source[at]!=='<'){at++;continue;}
    const start=at++;const closing=source[at]==='/';if(closing)at++;
    const tag=name();tags++;
    if(closing){space();if(source[at++]!=='>')fail('Unexpected content in WXML closing tag',at-1);if(stack.pop()!==tag)fail('Unbalanced WXML closing tag '+tag,start);continue;}
    const attributes=new Set();let selfClosing=false,finished=false;
    while(at<source.length){
      const separated=space();
      if(source.startsWith('/>',at)){at+=2;selfClosing=true;finished=true;break;}
      if(source[at]==='>'){at++;finished=true;break;}
      if(!separated)fail('Expected whitespace between WXML attributes');
      const attribute=name();if(attributes.has(attribute))fail('Duplicate WXML attribute '+attribute);attributes.add(attribute);
      // Boolean attributes have no '='; leave their trailing space for the next loop.
      const afterName=at;space();
      if(source[at]!=='='){at=afterName;continue;}
      at++;space();const quote=source[at];if(quote!=='"'&&quote!=="'")fail('WXML attribute values must be quoted');
      const valueStart=++at,end=source.indexOf(quote,at);if(end<0)fail('Unclosed WXML attribute '+attribute,valueStart-1);
      checkBindings(source.slice(valueStart,end),valueStart);at=end+1;
    }
    if(!finished)fail('Unclosed WXML opening tag '+tag,start);
    if(selfClosing)continue;
    if(tag==='wxs'){
      const end=source.indexOf('</wxs>',at);if(end<0)fail('Unclosed WXS block',start);at=end+6;
    }else stack.push(tag);
  }
  if(stack.length)fail('Unclosed WXML tag '+stack.at(-1));
  return {tags,bindings};
}
