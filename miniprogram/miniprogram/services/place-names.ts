const provinces:Record<string,string>={
  beijing:'北京',tianjin:'天津',shanghai:'上海',chongqing:'重庆',hebei:'河北',shanxi:'山西',shaanxi:'陕西',
  liaoning:'辽宁',jilin:'吉林',heilongjiang:'黑龙江',jiangsu:'江苏',zhejiang:'浙江',anhui:'安徽',fujian:'福建',
  jiangxi:'江西',shandong:'山东',henan:'河南',hubei:'湖北',hunan:'湖南',guangdong:'广东',hainan:'海南',
  sichuan:'四川',guizhou:'贵州',yunnan:'云南',gansu:'甘肃',qinghai:'青海',taiwan:'台湾',
  'inner mongolia':'内蒙古','nei mongol':'内蒙古',neimenggu:'内蒙古',guangxi:'广西','guangxi zhuang':'广西',ningxia:'宁夏','ningxia hui':'宁夏',xinjiang:'新疆','xinjiang uygur':'新疆','xinjiang uyghur':'新疆',tibet:'西藏',xizang:'西藏',
  'hong kong':'香港',hongkong:'香港',macau:'澳门',macao:'澳门',
};
/** Translate known source labels only; unfamiliar locality names remain intact. */
export function chinesePlace(value:unknown):string{
  if(typeof value!=='string')return '';
  return value.split(/(\s*[·,，/]\s*)/).map(part=>{
    const key=part.trim().toLowerCase().replace(/^(?:province of|city of)\s+/,'').replace(/\s+(?:province|shi|sheng|municipality|autonomous region|zhuang autonomous region|hui autonomous region|uygur autonomous region)$/,'');
    return provinces[key]||part;
  }).join('');
}
