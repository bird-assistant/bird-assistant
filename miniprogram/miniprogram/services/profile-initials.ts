/** English names use one initial; Chinese names use up to two leading Han characters. */
export function profileInitials(name:string){
  const text=Array.from(name.trim());
  if(!text.length)return '鸟';
  if(/^[A-Za-z]$/.test(text[0]))return text[0].toUpperCase();
  if(/^[\u3400-\u9fff]$/.test(text[0]))return text[0]+(text[1]&&/^[\u3400-\u9fff]$/.test(text[1])?text[1]:'');
  return text[0];
}
