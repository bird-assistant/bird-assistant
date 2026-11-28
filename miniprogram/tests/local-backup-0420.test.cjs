const {test}=require('node:test');
const assert=require('node:assert/strict');
const m=require('../.test-build/services/journal-model.js');
const state=require('../.test-build/services/journal-storage.js');
const places=require('../.test-build/services/saved-places.js');
const backup=require('../.test-build/services/local-backup.js');
const protectedData=require('../.test-build/services/protected-local-data.js');

function environment(){
 const store=new Map(),files=new Map(),dirs=new Set(['/user']),deleted=[];let diskFail=false,kvFail=false;
 const raw=v=>typeof v==='string'?Buffer.from(v):Buffer.from(v),missing=()=>Object.assign(Error('ENOENT: no such file'),{errMsg:'ENOENT: no such file'});
 const fs={
  accessSync(path){if(!files.has(path)&&!dirs.has(path))throw missing();},
  statSync(path){if(!files.has(path))throw missing();return {size:files.get(path).length,isFile:()=>true};},
  mkdirSync(path){dirs.add(path);},
  writeFileSync(path,value){if(diskFail&&path.includes('/records-')){files.set(path,Buffer.from('partial write'));throw Error('disk full');}files.set(path,raw(value));},
  appendFileSync(path,value){if(!files.has(path))throw missing();files.set(path,Buffer.concat([files.get(path),raw(value)]));},
  readFileSync(path,encoding,position=0,length){const value=files.get(path);if(!value)throw missing();const b=value.subarray(position,length==null?undefined:position+length);return encoding?b.toString(encoding):Uint8Array.from(b).buffer;},
  unlinkSync(path){deleted.push(path);files.delete(path);},rmdirSync(path){dirs.delete(path);},
  readdirSync(path){if(!dirs.has(path))throw missing();return [...files.keys()].filter(p=>p.startsWith(path+'/')&&!p.slice(path.length+1).includes('/')).map(p=>p.slice(path.length+1));}
 };
 global.wx={env:{USER_DATA_PATH:'/user'},getFileSystemManager:()=>fs,getStorageSync:k=>structuredClone(store.get(k)??''),setStorageSync:(k,v)=>{if(kvFail)throw Error('KV full');store.set(k,structuredClone(v));},removeStorageSync:k=>store.delete(k),getStorageInfoSync:()=>({keys:[...store.keys()],currentSize:0}),canIUse:()=>false};
 return {store,files,dirs,fs,deleted,failDisk:()=>diskFail=true,failKV:()=>kvFail=true};
}
function fixture(e){
 e.files.set('/user/original.jpg',Buffer.from('ORIGINAL photo bytes + EXIF\0\xff','binary'));
 e.files.set('/user/undo-only.jpg',Buffer.from('UNDO-ONLY original photo'));
 const asset={id:'a',src:'/user/original.jpg',label:'Observed bird',sample:false,selected:true,persisted:true};
 const doc=m.makeJournal([asset],'Editable original'),prior=m.copy(doc);prior.elements.push(m.element('photo',{src:'/user/undo-only.jpg',persisted:true}));
 state.saveJournalState(doc,state.editorHistory([{document:prior,selected:''}],[]));
 const place=places.savePlace({name:'湖边',address:'本人的收藏',latitude:40,longitude:116.3});return {doc,place};
}
function externalCopy(e,path){const external='/outside/saved.birdbackup';e.files.set(external,Buffer.from(e.files.get(path)));return external;}
function wipeMiniProgram(e){e.store.clear();for(const path of e.files.keys())if(path.startsWith('/user/'))e.files.delete(path);e.dirs.clear();e.dirs.add('/user');}

test('saved-place and journal originals survive KV cache clearing, and explicit deletion remains deleted',()=>{
 const e=environment(),{doc,place}=fixture(e);e.store.clear();assert.equal(places.readSavedPlaces()[0].id,place.id);assert.equal(m.readJournals()[0].title,doc.title);
 places.removeSavedPlace(place.id);e.store.clear();assert.equal(places.readSavedPlaces().length,0);assert.equal(m.readJournals().length,1);
 state.deleteJournalState(doc.id);e.store.clear();assert.equal(m.readJournals().length,0);assert.equal(e.files.get('/user/original.jpg').toString('binary'),'ORIGINAL photo bytes + EXIF\0\xff');
});
test('legacy KV originals migrate to protected user files before the cache is discarded',()=>{
 const e=environment(),doc=m.makeJournal([],'Legacy text');e.store.set(m.JOURNAL_KEY,[doc]);e.store.set(places.SAVED_PLACES_KEY,{version:1,items:[]});
 m.readJournals();places.readSavedPlaces();e.store.clear();assert.equal(m.readJournals()[0].id,doc.id);assert.equal(places.readSavedPlaces().length,0);
});
test('a failed snapshot write retains the previous valid vault and never reports a newly saved bookmark',()=>{
 const e=environment(),{place}=fixture(e);e.failDisk();assert.throws(()=>places.savePlace({name:'unsaved',address:'',latitude:41,longitude:117}),/当前内容仍保留/);
 assert.deepEqual(places.readSavedPlaces().map(p=>p.id),[place.id]);assert.equal(m.readJournals().length,1);
});
test('a KV quota failure cannot hide a successfully committed protected original',()=>{
 const e=environment();e.failKV();const saved=places.savePlace({name:'File-backed place',address:'',latitude:30,longitude:120});assert.equal(places.readSavedPlaces()[0].id,saved.id);
});
test('both cache cleanup buttons preserve protected records, journal photos, editing history and backups',async()=>{
 const e=environment(),{doc}=fixture(e),result=await backup.exportLocalBackup([doc.id]);e.dirs.add('/user/journal-previews');e.files.set('/user/journal-previews/disposable.png',Buffer.from('thumbnail'));e.store.set('bird-assistant.journal.preview.v1.x',{thumbnail:'/user/journal-previews/disposable.png'});
 const preview=require('../.test-build/services/preview-cache.js'),publicImages=require('../.test-build/services/public-guide-photos.js');preview.clearPreviewCache();publicImages.clearPublicGuideCache();
 assert.equal(places.readSavedPlaces().length,1);assert.equal(m.readJournals()[0].editHistory.past.length,1);assert.ok(e.files.has(result.path));assert.ok(e.files.has('/user/original.jpg'));assert.ok(e.files.has('/user/undo-only.jpg'));assert.equal(e.files.has('/user/journal-previews/disposable.png'),false);
 assert.equal(e.deleted.some(p=>p.includes('/bird-assistant-originals/')),false);
});
test('an external backup restores editable journals, bookmarks and exact original/Undo-only photo bytes after a full simulated wipe',async()=>{
 const e=environment(),{doc,place}=fixture(e),original=Buffer.from(e.files.get('/user/original.jpg')),undo=Buffer.from(e.files.get('/user/undo-only.jpg'));
 const exported=await backup.exportLocalBackup([doc.id]);assert.equal(exported.info.photos,2);const external=externalCopy(e,exported.path);wipeMiniProgram(e);
 assert.equal(m.readJournals().length,0);assert.equal(places.readSavedPlaces().length,0);const restored=await backup.restoreLocalBackup(external);assert.equal(restored.journals,1);assert.equal(restored.places,1);
 const j=m.readJournals()[0];assert.equal(j.id,doc.id);assert.equal(places.readSavedPlaces()[0].id,place.id);assert.deepEqual(e.files.get(j.elements.find(p=>p.type==='photo').src),original);
 const history=state.restoreEditorHistory(j);assert.deepEqual(e.files.get(history.past[0].document.elements.find(p=>p.type==='photo'&&p.src!==j.elements.find(p=>p.type==='photo').src).src),undo);
});
test('restoring into existing data creates a new journal instead of overwriting newer edits',async()=>{
 const e=environment(),{doc}=fixture(e),exported=await backup.exportLocalBackup([doc.id]);const newer=m.readJournals()[0];newer.title='Keep these newer edits';state.saveJournalState(newer,state.editorHistory([],[]));
 const result=await backup.restoreLocalBackup(exported.path);assert.equal(result.copies,1);assert.equal(result.places,0);const rows=m.readJournals();assert.equal(rows.length,2);assert.equal(rows.find(j=>j.id===doc.id).title,'Keep these newer edits');assert.match(rows.find(j=>j.id!==doc.id).title,/恢复副本/);assert.doesNotThrow(()=>state.restoreEditorHistory(rows.find(j=>j.id!==doc.id)));
});
test('damaged metadata and damaged photo frames cannot change existing records or original photos',async()=>{
 const e=environment(),{doc}=fixture(e),exported=await backup.exportLocalBackup([doc.id]),before=JSON.stringify(m.readJournals()),image=Buffer.from(e.files.get('/user/original.jpg'));
 const bytes=Buffer.from(e.files.get(exported.path));bytes[20]^=1;e.files.set('/outside/bad-metadata.birdbackup',bytes);await assert.rejects(backup.restoreLocalBackup('/outside/bad-metadata.birdbackup'),/目录校验失败/);
 const photo=Buffer.from(e.files.get(exported.path));photo[16+photo.readUInt32LE(8)+2]^=1;e.files.set('/outside/bad-photo.birdbackup',photo);await assert.rejects(backup.restoreLocalBackup('/outside/bad-photo.birdbackup'),/照片校验失败/);
 assert.equal(JSON.stringify(m.readJournals()),before);assert.deepEqual(e.files.get('/user/original.jpg'),image);assert.equal([...e.files.keys()].some(p=>p.includes('/restored-')),false);
});
test('cancelled exports/imports remove only their own incomplete files and preserve the current library',async()=>{
 const e=environment(),{doc}=fixture(e);let checks=0;await assert.rejects(backup.exportLocalBackup([doc.id],{current:()=>++checks<3}),/已暂停/);assert.equal([...e.files.keys()].some(p=>p.includes('/exports/')),false);
 const exported=await backup.exportLocalBackup([doc.id]),before=JSON.stringify(m.readJournals());checks=0;await assert.rejects(backup.restoreLocalBackup(exported.path,{current:()=>++checks<3}),/已暂停/);
 assert.equal(JSON.stringify(m.readJournals()),before);assert.ok(e.files.has('/user/original.jpg'));assert.ok(e.files.has(exported.path));assert.equal([...e.files.keys()].some(p=>p.includes('/restored-')),false);
});
test('restore failure at commit keeps existing records and cleans staged image copies',async()=>{
 const e=environment(),{doc}=fixture(e),exported=await backup.exportLocalBackup([doc.id]),before=JSON.stringify(m.readJournals());e.failDisk();await assert.rejects(backup.restoreLocalBackup(exported.path),/保护文件/);
 assert.equal(JSON.stringify(m.readJournals()),before);assert.equal([...e.files.keys()].some(p=>p.includes('/restored-')),false);assert.ok(e.files.has('/user/original.jpg'));
});
test('an archive cannot import arbitrary file paths, even with a recomputed metadata checksum',async()=>{
 const e=environment(),{doc}=fixture(e),exported=await backup.exportLocalBackup([doc.id]),original=e.files.get(exported.path),length=original.readUInt32LE(8),manifest=JSON.parse(original.subarray(12,12+length).toString());
 manifest.journals[0].elements.find(p=>p.type==='photo').src='/user/original.jpg';const metadata=Buffer.from(JSON.stringify(manifest)),header=Buffer.alloc(12),hash=Buffer.alloc(4);header.write('BIRDBK01');header.writeUInt32LE(metadata.length,8);hash.writeUInt32LE(protectedData.checksum(new Uint8Array(metadata)));
 const malicious=Buffer.concat([header,metadata,hash,original.subarray(16+length)]);e.files.set('/outside/untrusted.birdbackup',malicious);await assert.rejects(backup.restoreLocalBackup('/outside/untrusted.birdbackup'),/外部路径/);assert.equal(m.readJournals().length,1);assert.ok(e.files.has('/user/original.jpg'));
});
test('missing original photos fail export instead of producing an apparently complete layout-only backup',async()=>{
 const e=environment(),{doc}=fixture(e);e.files.delete('/user/undo-only.jpg');await assert.rejects(backup.exportLocalBackup([doc.id]),/未生成不完整备份/);assert.equal([...e.files.keys()].some(p=>p.includes('/exports/')),false);assert.equal(m.readJournals().length,1);
});
