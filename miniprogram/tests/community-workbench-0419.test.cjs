const {test}=require('node:test');
const assert=require('node:assert/strict');
const notes=require('../.test-build/services/field-notes.js');
const social=require('../.test-build/services/social-local.js');
const shelf=require('../.test-build/services/guide-shelf.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function storage(extra={}){const values=new Map();let writes=0;global.wx={getStorageSync:k=>structuredClone(values.get(k)??''),setStorageSync:(k,v)=>{writes++;values.set(k,structuredClone(v));},...extra};return {values,writes:()=>writes};}
const input=(title,body='A real observation')=>({title,body,tags:['湖边'],observationId:'obs_local',pinned:false});
const bird=i=>({id:'bird_'+i,name:'鸟'+i,english:'Bird '+i,scientific:'Aves '+i,family:i%2?'科甲':'科乙'});

test('notes compare revisions and merge fresh storage without overwriting a different note',()=>{
 storage();const a=notes.saveFieldNote('a',input('A'),0),b=notes.saveFieldNote('b',input('B'),0);
 const edit=notes.saveFieldNote('a',input('A new'),a.revision);assert.equal(edit.revision,2);
 assert.equal(notes.readFieldNotes().find(n=>n.id==='b').title,b.title);
 assert.throws(()=>notes.saveFieldNote('a',input('Stale editor'),a.revision),/别处更改/);
 assert.equal(notes.readFieldNotes().find(n=>n.id==='a').title,'A new');
});
test('note corruption and quota errors preserve original storage and the caller draft',()=>{
 const env=storage();env.values.set(notes.FIELD_NOTES_KEY,{version:1,items:[{id:'broken'}]});
 assert.throws(()=>notes.saveFieldNote('a',input('new'),0),/原内容未覆盖/);assert.equal(env.writes(),0);
 env.values.clear();const saved=notes.saveFieldNote('a',input('saved'),0),before=structuredClone(env.values.get(notes.FIELD_NOTES_KEY)),draft=input('still typed');
 global.wx.setStorageSync=()=>{throw Error('storage quota');};assert.throws(()=>notes.saveFieldNote('a',draft,saved.revision),/quota/);
 assert.deepEqual(env.values.get(notes.FIELD_NOTES_KEY),before);assert.equal(draft.title,'still typed');
});
test('notes can be trashed and restored without touching linked observations or photographs',()=>{
 const env=storage(),saved=notes.saveFieldNote('a',input('湖边笔记'),0);env.values.set('original-observations',{photo:'/user/original.jpg'});
 notes.trashFieldNote('a',saved.revision);let trashed=notes.readFieldNotes()[0];assert.ok(trashed.deletedAt);assert.equal(notes.findFieldNotes([trashed],'','').length,0);
 assert.throws(()=>notes.saveFieldNote('a',input('edit trash'),trashed.revision),/回收站/);
 notes.trashFieldNote('a',trashed.revision,true);assert.equal(notes.readFieldNotes()[0].deletedAt,'');assert.equal(notes.readFieldNotes()[0].observationId,'obs_local');
 assert.deepEqual(env.values.get('original-observations'),{photo:'/user/original.jpg'});
});
test('note tags, text search and pins organize only matching active notes',()=>{
 storage();assert.deepEqual(notes.noteTags('湖边，湖边,鸟鸣、 夜观\n路线'),['湖边','鸟鸣','夜观','路线']);
 const a=notes.saveFieldNote('a',input('Lake','Listen carefully'),0),b=notes.saveFieldNote('b',{...input('Different'),pinned:true},0);
 assert.equal(notes.findFieldNotes([a,b],'','')[0].id,'b');assert.equal(notes.findFieldNotes([a,b],'LISTEN','湖边')[0].id,'a');
 assert.equal(notes.findFieldNotes([a,b],'','missing').length,0);
});
test('conversation preferences and message drafts are scoped to the server account and preserve other fields',()=>{
 storage();social.saveConversationPrefs('alice','chat','peer',{alias:'湖边鸟友',pinned:true});
 social.saveConversationPrefs('alice','chat','peer',{draft:'Tomorrow?',reference:'retry_1'});
 assert.equal(social.conversationPrefs('alice','chat','peer').alias,'湖边鸟友');assert.equal(social.conversationPrefs('bob','chat','peer').draft,'');
 assert.equal(social.conversationPrefs('alice','group','peer').draft,'');assert.equal(social.conversationPrefs('alice','chat','peer').reference,'retry_1');
});
test('a hidden private conversation reappears on a new message while local drafts and unread remain intact',()=>{
 storage();const a={peer:'a',created:'2026-11-28T02:00:00Z',body:'hello',unread:4},b={peer:'b',created:'2026-11-27T02:00:00Z',body:'hi',unread:1};
 social.saveConversationPrefs('owner','chat','a',{hidden:social.inboxFingerprint(a)});assert.deepEqual(social.localInbox('owner',[a,b]).map(n=>n.peer),['b']);
 social.saveConversationPrefs('owner','chat','b',{pinned:true,quiet:true,draft:'My unsent text'});
 const rows=social.localInbox('owner',[{...a,body:'a new message'},b]);assert.equal(rows[0].peer,'b');assert.equal(rows[0].unread,1);assert.match(rows[0].excerpt,/My unsent text/);assert.equal(rows.length,2);
 assert.equal(social.localInbox('owner',[a,b],true).find(n=>n.peer==='a').hidden,true);
});
test('notification hiding is recoverable, account scoped and never removes its source record',()=>{
 storage();const items=[{id:'reply_1',post:'post_1',body:'Look at the bill'}];social.dismissActivity('one','reply_1');
 assert.equal(social.localActivity('one',items).length,0);assert.equal(social.localActivity('two',items).length,1);
 social.restoreActivity('one');assert.equal(social.localActivity('one',items).length,1);assert.equal(items[0].body,'Look at the bill');
});
test('malformed local conversation settings are never reset as a side effect of a new draft',()=>{
 const env=storage();env.values.set('bird-assistant.social-local.v1.owner',{version:1,conversations:{'chat:peer':{draft:7}},dismissed:[]});
 assert.throws(()=>social.saveConversationPrefs('owner','chat','peer',{draft:'keep me'}),/原内容未覆盖/);assert.equal(env.writes(),0);
});
test('public forward cards contain only a whitelisted internal record id and a bounded title',()=>{
 const body=social.publicShareBody({kind:'publication',id:'post_123abc',title:'湖边的发现'});assert.deepEqual(social.readPublicShare(body),{kind:'publication',id:'post_123abc',title:'湖边的发现'});
 for(const id of ['https://evil.example','../../private','post_x?token=secret','file:///original'])assert.throws(()=>social.publicShareBody({kind:'publication',id,title:'x'}));
 assert.equal(social.readPublicShare('[羽迹公开内容] {"id":"post_1","title":"x","url":"https://evil.example"}').id,'post_1');
 assert.equal(social.readPublicShare('[羽迹公开内容] {"id":"https://evil.example","title":"x"}'),null);assert.equal(social.readPublicShare('ordinary text'),null);
});
test('guide bookmarks deduplicate and recent history is bounded without implying a sighting',()=>{
 const env=storage();for(let i=0;i<35;i++)shelf.rememberGuide(bird(i));assert.equal(shelf.readGuideShelf().recent.length,30);
 shelf.bookmarkGuide(bird(1));shelf.bookmarkGuide(bird(2));shelf.bookmarkGuide(bird(1));assert.deepEqual(shelf.readGuideShelf().saved.map(b=>b.id),['bird_2']);
 const groups=shelf.guideGroups([bird(1),bird(2),bird(3)],'鸟3');assert.equal(groups[0].family,'科甲');assert.equal(groups[0].items[0].id,'bird_3');
 assert.equal([...env.values.keys()].some(k=>k.includes('observations')),false);
});
test('external filtering stays inside the loaded page and preserves the server date ordering',()=>{
 const items=[{id:'new',date:'2026-11-27',source:'iNaturalist',image:'photo',title:'麻雀',placeName:'北京'},{id:'old',date:'2024-02-18',source:'Birda',image:'',title:'灰喜鹊',placeName:'北京'}];
 const filtered=shelf.externalExplore(items,'','北京',true);assert.equal(filtered.shown.length,1);assert.equal(filtered.sources.length,2);assert.equal(filtered.days[0].day,'2026-11-27');
 assert.deepEqual(shelf.externalExplore(items,'','',false).shown.map(i=>i.id),['new','old']);assert.equal(shelf.externalExplore(items,'Birda','',false).shown[0].id,'old');
});
function page(route){let definition;global.Page=v=>definition=v;const file=require.resolve('../.test-build/'+route+'/index.js');delete require.cache[file];require(file);
 const p={data:structuredClone(definition.data),setData(v,done){Object.assign(this.data,v);done?.();}};for(const [k,v]of Object.entries(definition))if(k!=='data')p[k]=typeof v==='function'?v.bind(p):structuredClone(v);return p;}
test('note editor flushes pending typing on hide and refuses to navigate away after a failed save',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const env=storage({showModal:o=>o.success({confirm:true}),navigateBack(){throw Error('must not navigate');}});
 const repo=require('../.test-build/services/repository.js'),original=repo.localRepository;repo.localRepository=()=>({list:()=>[]});t.after(()=>{repo.localRepository=original;});
 const p=page('field/notes');p.onLoad();p.onShow();p.create();p.input({currentTarget:{dataset:{field:'body'}},detail:{value:'A draft before sleeping'}});p.onHide();
 assert.equal(notes.readFieldNotes()[0].body,'A draft before sleeping');assert.equal(p.data.dirty,false);
 global.wx.setStorageSync=()=>{throw Error('full');};p.input({currentTarget:{dataset:{field:'body'}},detail:{value:'Please keep this newer text'}});p.back();
 assert.equal(p.data.screen,'edit');assert.equal(p.data.note.body,'Please keep this newer text');assert.equal(p.data.dirty,true);assert.match(p.data.error,/full/);p.onUnload();assert.equal(env.values.get(notes.FIELD_NOTES_KEY).items[0].body,'A draft before sleeping');
});
test('forwarding rechecks public visibility and waits for explicit confirmation before sending',async t=>{
 let visibility='public';const sent=[],env=storage({setNavigationBarTitle(){},showToast(){},request(o){const path=new URL(o.url).pathname;if(path.endsWith('/auth/wechat'))return o.success({statusCode:200,data:{access_token:'test',expires_in:3600}});
   let data;if(path.endsWith('/account'))data={id:'mine',profile:{nickname:'Me'}};else if(path.endsWith('/friends'))data={items:[{id:'peer',nickname:'Friend',relationship:'friends'}]};else if(path.endsWith('/groups'))data={items:[]};else if(path.endsWith('/publications/post_123'))data={id:'post_123',visibility,title:'The observation'};else if(path.endsWith('/messages/peer')){sent.push(o.data);data={id:'msg_1'};}else throw Error(path);o.success({statusCode:200,data});},login:o=>o.success({code:'mock'})});
 const api=require('../.test-build/services/community.js');api.setSession(true);const p=page('field/social');p.onLoad({screen:'forward',id:'post_123'});p.onShow();t.after(()=>p.onUnload());await settle();await settle();
 assert.equal(p.data.forwardShare.id,'post_123');assert.equal(sent.length,0);p.chooseForward({currentTarget:{dataset:{kind:'chat',id:'peer'}}});assert.equal(sent.length,0);
 visibility='private';await p.sendForward();assert.equal(sent.length,0);assert.match(p.data.error,/公开/);visibility='public';await p.sendForward();assert.equal(sent.length,1);assert.equal(social.readPublicShare(sent[0].body).id,'post_123');assert.equal(p.data.forwardTarget,null);assert.match(p.data.forwardReceipt,/Friend/);assert.ok(env.values.size);
});

test('reply drafts retain the target, species and idempotency reference per account',()=>{
 storage();const drafts=require('../.test-build/services/reply-drafts.js'),draft={post:'post_1',body:'Look at the cheek',species:'bird_1',speciesName:'树麻雀',parentId:'reply_1',parentName:'鸟友',reference:'retry_1'};
 drafts.saveReplyDraft('one',draft);assert.deepEqual(drafts.readReplyDraft('one','post_1'),draft);assert.equal(drafts.readReplyDraft('two','post_1'),null);
 drafts.saveReplyDraft('one',{...draft,body:'',species:'',parentId:''});assert.equal(drafts.readReplyDraft('one','post_1'),null);
});
test('a reply acknowledgement preserves newer typing and records the submitted species snapshot',async t=>{
 let ack;const api=require('../.test-build/services/community.js'),original=api.api;storage({hideKeyboard(){}});api.setSession(true);
 api.api=(path,method)=>method==='POST'?new Promise(resolve=>{ack=resolve;}):Promise.resolve({});t.after(()=>{api.api=original;});
 const p=page('field/hub');p._submitKey='retry_1';p.data.screen='record';p.data.id='post_1';p.data.self='me';p.data.body='Submitted text';p.data.replySpecies='bird_1';p.data.replyTarget={id:'reply_1',name:'First observer'};p.data.record={features:{threadedReplies:true}};p.load=async()=>{};
 const pending=p.action({currentTarget:{dataset:{op:'reply'}}});await settle();p.field({currentTarget:{dataset:{field:'body'}},detail:{value:'New unsent text'}});p.data.replySpecies='bird_2';
 ack({id:'reply_new'});await pending;assert.equal(p.data.body,'New unsent text');assert.equal(p.data.replySpecies,'bird_2');assert.equal(p.data.pendingReplies[0].body,'Submitted text');assert.equal(p.data.pendingReplies[0].species,'bird_1');p.onUnload();
});
test('restoring an older reply draft never erases text typed while the account request was loading',t=>{
 const drafts=require('../.test-build/services/reply-drafts.js');storage();const api=require('../.test-build/services/community.js');api.setSession(true);
 drafts.saveReplyDraft('me',{post:'post_1',body:'Older local draft',species:'',speciesName:'',parentId:'',parentName:'',reference:'old_ref'});
 const p=page('field/hub');p.data.screen='record';p.data.id='post_1';p.data.self='me';p.data.body='Fresh typing';p.restoreReplyDraft();
 assert.equal(p.data.body,'Fresh typing');assert.equal(p.data.replyDraftBlocked,true);p.storeReplyDraft();assert.equal(drafts.readReplyDraft('me','post_1').body,'Older local draft');p.onUnload();
});
test('account changes clear the previous inbox before the next account request completes',async t=>{
 const api=require('../.test-build/services/community.js'),original=api.api;let complete;storage({setNavigationBarTitle(){}});api.setSession(true);api.api=()=>new Promise(resolve=>{complete=resolve;});t.after(()=>{api.api=original;});
 const p=page('field/social');p.onLoad({screen:'inbox'});p._visible=true;p.data.registered=true;p.data.self='previous';p.data.inbox=[{peer:'private_previous'}];p.data.prefs={alias:'Private local alias',pinned:true,quiet:false};
 api.setSession(true);const pending=p.start();assert.equal(p.data.inbox.length,0);assert.equal(p.data.prefs.alias,'');assert.equal(p.data.self,'');
 complete({id:'next',profile:null});await pending;assert.equal(p.data.self,'next');assert.equal(p.data.registered,false);p.onUnload();
});
test('corrupt observation storage does not prevent independent local notes from opening',t=>{
 storage();notes.saveFieldNote('independent',input('Keep this note'),0);const repo=require('../.test-build/services/repository.js'),original=repo.localRepository;repo.localRepository=()=>({list(){throw Error('old observation data');}});t.after(()=>{repo.localRepository=original;});
 const p=page('field/notes');p.onLoad();assert.equal(p.data.rows[0].title,'Keep this note');assert.match(p.data.observationError,/仍可独立/);assert.equal(p.data.error,'');p.onUnload();
});
