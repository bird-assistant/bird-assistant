const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const service=require('../.test-build/services/community.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function page(name,data={}){
  let definition;global.Page=value=>definition=value;
  const file=require.resolve('../.test-build/'+name+'/index.js');delete require.cache[file];require(file);
  const result={data:{...structuredClone(definition.data),...data},setData(values,done){Object.assign(this.data,values);done?.();}};
  for(const [key,value]of Object.entries(definition))if(key!=='data')result[key]=typeof value==='function'?value.bind(result):structuredClone(value);
  global.wx={nextTick:f=>f(),pageScrollTo:()=>{},setNavigationBarTitle:()=>{},hideKeyboard:()=>{},getWindowInfo:()=>({windowWidth:390})};
  return result;
}
const tap=(op,id)=>({currentTarget:{dataset:{op,id}}});

test('identification posts keep a failed ballot and submit species-only votes or moderated explanations',async t=>{
  const requests=[];
  let fail=true;
  const poll={total:1,candidates:[{id:'owl',name:'短耳鸮',votes:1}],mine:'owl',result:null};
  t.mock.method(service,'sessionState',()=> 'out');
  t.mock.method(service,'api',async(path,method,body)=>{
    if(method==='PUT'||method==='POST'){
      requests.push({path,method,body});
      if(fail)throw Error('offline');
      return method==='PUT'?poll:{id:'r1',status:'pending'};
    }
    return {id:'post',channel:'post',poll,replies:[]};
  });
  const hub=page('field/hub',{screen:'record',id:'post',record:{poll},replySpecies:'owl',selectedSpecies:'短耳鸮'});
  await hub.action(tap('reply'));
  assert.equal(hub.data.replySpecies,'owl');
  fail=false;
  await hub.action(tap('reply'));
  assert.equal(requests[1].path,'/api/v1/community/publications/post/identification/vote');
  assert.deepEqual(requests[1].body,{species:'owl'});
  assert.equal(hub.data.replySpecies,'');
  assert.equal(hub.data.record.pollPreview,'短耳鸮 1票');
  hub.chooseReplySpecies({detail:{id:'owl',name:'短耳鸮'}});
  hub.setData({body:'脸盘圆，眼周深色'});
  await hub.action(tap('reply'));
  assert.equal(requests[2].body.identification_vote,true);
  assert.equal(requests[2].body.body,'脸盘圆，眼周深色');
  assert.match(hub.data.notice,/待审核/);
  hub.onUnload();
});

test('a help request cannot silently become an ordinary post on an older server',async t=>{
  t.mock.method(service,'api',async(_path,_method,payload)=>{
    assert.equal(payload.identification_help,true);
    return {id:'legacy',display:{post:{title:'芦苇里的鸟'}}};
  });
  const hub=page('field/hub',{screen:'publish',body:'请帮我辨认',identificationHelp:true});
  await hub.prepare(tap(''));
  assert.equal(hub.data.preview,null);
  assert.match(hub.data.error,/尚未支持求鉴定帖/);
  assert.equal(hub.data.body,'请帮我辨认');
  hub.onUnload();
});

test('live search starts at the first nonempty edit, debounces and ignores superseded results',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const requests=[],states=[];
  t.mock.method(service,'api',(_path,_method,query)=>new Promise(resolve=>requests.push({query,resolve})));
  const query=require('../.test-build/services/species-search.js').speciesSearch(state=>states.push(state));
  query.input('  ');t.mock.timers.tick(500);assert.equal(requests.length,0);
  query.input('鹊');t.mock.timers.tick(100);query.input('喜鹊');t.mock.timers.tick(219);assert.equal(requests.length,0);
  t.mock.timers.tick(1);assert.equal(requests[0].query.q,'喜鹊');
  query.input('鸳');requests[0].resolve({items:[{id:'stale'}],hasMore:true});await settle();assert.deepEqual(states.at(-1).matches,[]);
  t.mock.timers.tick(220);requests[1].resolve({items:[{id:'duck'}],hasMore:false});await settle();assert.equal(states.at(-1).matches[0].id,'duck');query.close();
});
test('search pages deduplicate, block duplicate loads, stop on old servers and invalidate dismissed requests',async t=>{
  const requests=[],states=[];t.mock.method(service,'api',(_p,_m,query)=>new Promise(resolve=>requests.push({query,resolve})));
  const search=require('../.test-build/services/species-search.js').speciesSearch(s=>states.push(s));
  const first=search.search('鹤');requests[0].resolve({items:[{id:'a'}],hasMore:true});await first;
  const next=search.more();search.more();assert.equal(requests.length,2);assert.equal(requests[1].query.offset,1);
  requests[1].resolve({items:[{id:'a'},{id:'b'}],hasMore:true});await next;assert.deepEqual(states.at(-1).matches.map(x=>x.id),['a','b']);
  const end=search.more();requests[2].resolve({items:[{id:'a'}],hasMore:true});await end;await search.more();assert.equal(requests.length,3);
  const old=search.search('鸭');requests[3].resolve({items:[{id:'legacy'}]});await old;await search.more();assert.equal(requests.length,4);
  const late=search.search('鸥');search.close();requests[4].resolve({items:[{id:'late'}]});await late;assert.deepEqual(states.at(-1).matches,[]);
});
test('failed pagination retains matches and retries the same offset',async t=>{
  let count=0;const offsets=[],states=[];
  t.mock.method(service,'api',async(_p,_m,q)=>{offsets.push(q.offset);if(++count===2)throw Error('offline');return {items:[{id:String(count)}],hasMore:count===1};});
  const query=require('../.test-build/services/species-search.js').speciesSearch(s=>states.push(s));
  await query.search('鸟');await query.more();assert.equal(states.at(-1).matches.length,1);assert.ok(states.at(-1).searchError);
  await query.more();assert.deepEqual(offsets,[0,1,1]);assert.equal(states.at(-1).matches.length,2);query.close();
});
test('map memory stores only a valid viewport and tolerates corrupt or full storage',()=>{
  const views=require('../.test-build/services/map-view.js'),saved=new Map();
  global.wx={getStorageSync:k=>saved.get(k),setStorageSync:(k,v)=>saved.set(k,v)};
  const view={latitude:39.99,longitude:116.32,scale:13.5};views.saveMapView(view);assert.deepEqual(views.readMapView(),view);
  assert.deepEqual(Object.keys([...saved.values()][0]).sort(),['latitude','longitude','scale','version']);
  views.saveMapView({...view,latitude:NaN});assert.deepEqual(views.readMapView(),view);
  saved.set([...saved.keys()][0],{version:1,latitude:999,longitude:0,scale:12});assert.equal(views.readMapView(),null);
  global.wx={getStorageSync:()=>{throw Error('unavailable');},setStorageSync:()=>{throw Error('quota');}};
  assert.equal(views.readMapView(),null);assert.doesNotThrow(()=>views.saveMapView(view));
});
test('a fresh native map restores its last settled center and fractional zoom without fetching observations into storage',async t=>{
  let definition;global.Component=v=>definition=v;const entry=require.resolve('../.test-build/components/field-map/index.js');delete require.cache[entry];require(entry);
  const storage=new Map();global.wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,structuredClone(v)),createMapContext:()=>({
    getCenterLocation:o=>o.success({latitude:40,longitude:116.3}),getScale:o=>o.success({scale:12.3}),
    getRegion:o=>o.success({southwest:{latitude:39,longitude:116},northeast:{latitude:41,longitude:117}})})};
  t.mock.method(service,'api',async()=>({total:0,clusters:[]}));
  const make=()=>({data:structuredClone(definition.data),...definition.methods,setData(p){Object.assign(this.data,p);}});
  const first=make();await first.load();const fresh=make();definition.lifetimes.attached.call(fresh);
  assert.equal(fresh.data.scale,12.3);assert.equal(fresh.data.latitude,40);assert.equal(fresh.data.longitude,116.3);assert.equal(storage.size,1);
  definition.lifetimes.detached.call(first);definition.lifetimes.detached.call(fresh);
});
test('comparison uses one centered full-width card and evenly sized columns without colored letterboxing',()=>{
  const {comparisonWidth}=require('../.test-build/services/field-guide.js');
  assert.equal(comparisonWidth(390,1),358);assert.equal(comparisonWidth(390,2),173);assert.equal(comparisonWidth(320,3),156);
  assert.equal(comparisonWidth(1024,1),420);assert.ok(comparisonWidth(768,3)*3+24<=736);
  const css=fs.readFileSync('miniprogram/field/guide-card/index.wxss','utf8');assert.match(css,/background:transparent/);assert.match(css,/height:164px/);
});
test('field guide requests coalesce and failures do not poison the public metadata cache',async t=>{
  const guide=require('../.test-build/services/field-guide.js');let calls=0,release;
  t.mock.method(service,'api',()=>{calls++;return new Promise(resolve=>release=resolve);});
  const a=guide.fieldCard('cache-fixture'),b=guide.fieldCard('cache-fixture');assert.equal(calls,1);assert.equal(a,b);release({id:'cache-fixture',guide:{photo:null,fields:[]}});await a;
  await guide.fieldCard('cache-fixture');assert.equal(calls,1);
  t.mock.method(service,'api',async()=>{calls++;throw Error('offline');});
  await assert.rejects(guide.fieldCard('failed-fixture'));await assert.rejects(guide.fieldCard('failed-fixture'));assert.equal(calls,3);
});
test('reply chains preserve parent context, chronological children and private pending state',()=>{
  const {forumThreads,forumPost}=require('../.test-build/services/forum.js');
  const threads=forumThreads([{id:'c',parentId:'b',replyToName:'乙',body:'第三层',created:'2026-11-25T00:02:00Z'},
    {id:'a',publicName:'甲',created:'2026-11-25T00:00:00Z'},{id:'b',parentId:'a',publicName:'乙',status:'pending',created:'2026-11-25T00:01:00Z'},
    {id:'orphan',parentId:'hidden',created:'2026-11-25T00:03:00Z'}]);
  assert.deepEqual(threads.map(x=>x.id),['a','orphan']);assert.deepEqual(threads[0].children.map(x=>x.id),['b','c']);
  assert.equal(threads[0].children[0].status,'pending');assert.equal(threads[0].children[1].replyToName,'乙');
  const post=forumPost({reactions:['like','bookmark'],likes:3,replyCount:2,created:'2026-11-25T00:00:00Z'});
  assert.equal(post.posted,'2026-11-25 08:00');assert.equal(post.liked,true);assert.equal(post.favorited,true);assert.equal(post.hasLikes,true);
});
test('forum pagination retains existing posts on failure, deduplicates and ignores hidden-page responses',async t=>{
  const warnings=[];t.mock.method(console,'warn',(_message,error)=>warnings.push(error));
  const calls=[];t.mock.method(service,'api',(_p,_m,q)=>new Promise((resolve,reject)=>calls.push({q,resolve,reject})));
  const p=page('pages/community');let load=p.loadFeed();calls[0].resolve({items:[{id:'a',body:'one'}],hasMore:true,total:2});await load;
  load=p.loadFeed(true);calls[1].reject(Error('offline'));await load;assert.equal(p.data.remotePosts[0].id,'a');assert.ok(p.data.error);assert.equal(warnings[0].message,'offline');
  load=p.loadFeed(true);assert.equal(calls[2].q.offset,1);calls[2].resolve({items:[{id:'a'},{id:'b'}],hasMore:false,total:2});await load;assert.deepEqual(p.data.remotePosts.map(x=>x.id),['a','b']);
  load=p.loadFeed(false,true);p.onHide();calls[3].resolve({items:[{id:'late'}]});await load;assert.deepEqual(p.data.remotePosts.map(x=>x.id),['a','b']);p.onUnload();
});
test('feed reactions use idempotent server routes and server counts without an optimistic double increment',async t=>{
  const calls=[];t.mock.method(service,'api',async(path,method)=>{calls.push([path,method]);return method==='PUT'?{active:true,reactions:['like'],likes:8,bookmarked:false}:{active:false,reactions:[],likes:7,bookmarked:false};});
  const p=page('pages/community',{remotePosts:[{id:'p',liked:false,favorited:false,hasLikes:true,likes:7}]});
  const event={currentTarget:{dataset:{id:'p',kind:'like'}}};await p.react(event);assert.equal(p.data.remotePosts[0].likes,8);assert.equal(p.data.remotePosts[0].liked,true);
  await p.react(event);assert.equal(p.data.remotePosts[0].likes,7);assert.equal(p.data.remotePosts[0].liked,false);
  assert.deepEqual(calls.map(x=>[x[0].split('/').slice(-2).join('/'),x[1]]),[['p/like','PUT'],['reactions/like','DELETE']]);p.onUnload();
});
test('a failed threaded reply keeps text, target and idempotency key; success shows pending moderation',async t=>{
  const requests=[];let fail=true;
  t.mock.method(service,'sessionState',()=> 'out');t.mock.method(service,'api',async(path,method,body)=>{
    if(method==='POST'){requests.push(body);if(fail)throw Error('offline');return {id:'pending',status:'pending'};}
    return {id:'post',channel:'post',features:{threadedReplies:true},replyCount:1,replies:[{id:'parent',publicName:'鸟友甲',status:'approved'}]};
  });
  const p=page('field/hub',{screen:'record',id:'post',body:'我也观察到了',record:{features:{threadedReplies:true},replies:[{id:'parent',publicName:'鸟友甲',status:'approved'}]}});p._submitKey='same-retry';
  p.replyTo(tap('', 'parent'));await p.action(tap('reply'));assert.equal(p.data.body,'我也观察到了');assert.equal(p.data.replyTarget.id,'parent');assert.ok(p.data.error);
  fail=false;await p.action(tap('reply'));assert.equal(requests[1].reference,requests[0].reference);assert.equal(requests[1].parentId,'parent');assert.equal(p.data.body,'');assert.equal(p.data.replyTarget,null);assert.match(p.data.notice,/审核/);p.onUnload();
});
test('edited failed replies get a new idempotency key and an old server never receives a threaded parent',async t=>{
  const payloads=[];t.mock.method(service,'api',async(_p,_m,body)=>{payloads.push(body);throw Error('offline');});
  const p=page('field/hub',{screen:'record',id:'p',body:'first',record:{replies:[{id:'r',publicName:'甲'}]}});p._submitKey='original';p.replyTo(tap('', 'r'));
  assert.equal(p.data.replyTarget,null);await p.action(tap('reply'));p.data.body='edited';await p.action(tap('reply'));
  assert.equal(payloads[0].parentId,undefined);assert.notEqual(payloads[1].reference,payloads[0].reference);assert.equal(p.data.body,'edited');p.onUnload();
});
test('species topic association is sent only when the server advertises support',async t=>{
  const payloads=[];t.mock.method(service,'api',async(_p,_m,body)=>{payloads.push(body);return {id:'preview',display:{post:{body:'text'}}};});
  const p=page('field/hub',{screen:'publish',postSpecies:'bird',postSpeciesName:'喜鹊',body:'text'});await p.prepare(tap());assert.equal(payloads[0].species,undefined);
  p.data.speciesSupported=true;await p.prepare(tap());assert.equal(payloads[1].species,'bird');p.onUnload();
});
test('platform component registration and image selectors avoid both reported compiler warnings',()=>{
  const app=JSON.parse(fs.readFileSync('miniprogram/app.json'));assert.equal(app.usingComponents?.['app-header'],undefined);
  for(const name of ['home','community','journal','profile','identify'])assert.ok(JSON.parse(fs.readFileSync('miniprogram/pages/'+name+'/index.json')).usingComponents['app-header']);
  const css=fs.readFileSync('miniprogram/components/bird-crop/index.wxss','utf8');assert.doesNotMatch(css,/\.crop\s+image\b/);
  const hub=fs.readFileSync('miniprogram/field/hub/index.wxml','utf8');assert.match(hub,/data-op="reply"/);assert.match(hub,/class="thread-children"/);assert.doesNotMatch(hub,/wx:key="root\.id"/);
});

test('earlier reply pages append once, preserve current threads and can retry a failed page',async t=>{
  const requests=[];let fails=true;t.mock.method(service,'api',async(_p,_m,q)=>{requests.push(q);if(fails)throw Error('offline');return {replies:[{id:'new',created:'2026-11-25'},{id:'old',created:'2026-11-24'}],replyHasMore:false};});
  const p=page('field/hub',{screen:'record',id:'p',record:{replyHasMore:true,replies:[{id:'new',created:'2026-11-25'}]}});p._replyOffset=100;
  await p.moreReplies();assert.equal(p._replyOffset,100);assert.equal(p.data.record.replies.length,1);
  fails=false;await p.moreReplies();assert.deepEqual(requests.map(x=>x.replyOffset),[100,100]);assert.deepEqual(p.data.record.replies.map(x=>x.id),['new','old']);assert.equal(p.data.record.replyHasMore,false);p.onUnload();
});

test('a search near the bottom opens above its field and ignores a measurement after detach',()=>{
  let definition,callback;global.Component=value=>definition=value;
  const entry=require.resolve('../.test-build/components/species-search/index.js');delete require.cache[entry];require(entry);
  global.wx={getWindowInfo:()=>({windowHeight:600}),createSelectorQuery:()=>({in(){return this;},select(){return this;},boundingClientRect(fn){callback=fn;return this;},exec(){}})};
  const instance={data:{...structuredClone(definition.data),selectedIds:[]},...definition.methods,setData(v){Object.assign(this.data,v);}};
  definition.lifetimes.attached.call(instance);callback({top:490,bottom:536});assert.equal(instance.data.above,true);assert.equal(instance.data.listHeight,240);
  instance.resizeResults();callback({top:100,bottom:146});assert.equal(instance.data.above,false);assert.equal(instance.data.listHeight,240);
  instance.resizeResults();definition.lifetimes.detached.call(instance);const before=structuredClone(instance.data);callback({top:490,bottom:536});assert.deepEqual(instance.data,before);
});

test('discussion species guide returns to the same results and draft before the user selects a bird',async t=>{
  const post=page('field/hub',{screen:'record',id:'post-1',replySuggestOpen:true,body:'翅膀有白斑'});
  let definition;
  global.Component=value=>{definition=value;};
  const entry=require.resolve('../.test-build/components/species-search/index.js');
  delete require.cache[entry];require(entry);
  const bird={id:'avibase-owl',name:'短耳鸮',scientific:'Asio flammeus'};
  t.mock.method(service,'api',async()=>({items:[bird]}));
  const picker={
    data:{...structuredClone(definition.data),showGuide:true,selectedIds:[]},...definition.methods,
    setData(values){Object.assign(this.data,values);},
    triggerEvent(name,detail){assert.equal(name,'select');post.chooseReplySpecies({detail});}
  };
  definition.lifetimes.attached.call(picker);
  t.after(()=>definition.lifetimes.detached.call(picker));
  picker.input({detail:{value:'短耳'}});picker.search();await settle();
  const event=tap('',bird.id),original=structuredClone(picker.data),visits=[];
  global.wx.navigateTo=options=>visits.push(options);
  picker.openGuide(event);picker.openGuide(event);
  assert.deepEqual(visits.map(visit=>visit.url),['/field/hub/index?screen=species&id=avibase-owl']);
  definition.pageLifetimes.hide.call(picker);post.onHide();definition.pageLifetimes.show.call(picker);
  assert.deepEqual(picker.data,original);
  assert.equal(post.data.replySuggestOpen,true);assert.equal(post.data.replySpecies,'');
  assert.equal(post.data.body,'翅膀有白斑');
  global.wx.showToast=()=>{};
  picker.openGuide(event);visits[1].fail();picker.openGuide(event);
  assert.equal(visits.length,3);visits[2].fail();
  picker.select(event);
  assert.equal(post.data.replySpecies,bird.id);assert.equal(post.data.replySuggestOpen,false);
});
