// Read-only readiness checks. No login codes, model requests, uploads or writes.
const requireCurrent=process.argv.includes('--require-current');
const origin=new URL(process.env.BIRD_PUBLIC_ORIGIN||'https://api.auroraliu.cn:8080');
if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search)throw new Error('Use a plain HTTPS service origin without credentials or query parameters.');
async function get(path){try{const response=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(12000),redirect:'error'});let data;try{data=await response.json();}catch{data=null;}return{status:response.status,data};}catch{return{status:0,data:null};}}
const results=await Promise.all([get('/api/v1/vision/readyz'),get('/api/v1/map/observations'),get('/api/v1/species/avibase-C22FBF8D/places?sort=distance&latitude=40&longitude=116.3&limit=1'),get('/api/v1/audio/readyz')]);
const vision=results[0],auth=results[1],places=results[2];
const ready=vision.status===200&&vision.data?.status==='ready'&&vision.data?.models?.every(model=>model.ready===true);
const current=places.status===200&&places.data?.sort==='distance';
const audio=results[3];
const report={checked:new Date().toISOString(),origin:origin.origin,readOnly:true,vision:{status:vision.status,ready,models:(vision.data?.models||[]).map(({name,backend,device,ready})=>({name,backend,device,ready}))},audio:{status:audio.status,ready:audio.status===200&&audio.data?.status==='ready'&&Array.isArray(audio.data?.models)&&audio.data.models.length>0&&audio.data.models.every(model=>model.ready===true),actualRecognition:'NOT TESTED'},privateMapProtection:{status:auth.status,passed:auth.status===401},placesOrdering:{status:places.status,current,action:current?'current':'Deploy the reviewed business-service changes before testing distance ordering and new trip advice.'},acceptance:{realIdentification:'NOT TESTED',wechatLogin:'NOT TESTED',qwen:'NOT CALLED',publications:'NOT CREATED'}};
console.log(JSON.stringify(report,null,2));
if(!ready||auth.status!==401||requireCurrent&&!current)process.exitCode=1;
