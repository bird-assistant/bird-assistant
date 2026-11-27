const {test} = require('node:test');
const assert = require('node:assert/strict');
const {reclaimFrames, storeFrame, FrameCapacityError} = require('../.test-build/services/frame-cache.js');
const {localRepository} = require('../.test-build/services/repository.js');
const {JOURNAL_KEY, element} = require('../.test-build/services/journal-model.js');

function device() {
  const files = new Map(), storage = new Map();
  const root = 'wxfile://usr';
  const manager = {
    readdirSync: () => [...files.keys()].map(path => path.slice(root.length + 1)),
    statSync: path => ({size:files.get(path), isFile:() => files.has(path)}),
    unlinkSync: path => files.delete(path),
    writeFileSync: (path, image) => files.set(path, image.byteLength)
  };
  global.wx = {env:{USER_DATA_PATH:root}, getFileSystemManager:() => manager,
    getStorageSync:key => storage.get(key), setStorageSync:(key,value) => storage.set(key,value)};
  return {files, root, storage};
}

test('reclaiming also handles legacy frames and protects observations, journals and other files', () => {
  const {files, root, storage} = device();
  const paths = ['vision-1720000000000.jpg','vision-1720000000001.png','vision-1720000000002.jpg','album.jpg'].map(name => root + '/' + name);
  for (const path of paths) files.set(path, 80);
  localRepository().save({imagePath:paths[0], birdName:'', notes:'', source:'camera'});
  storage.set(JOURNAL_KEY,[{version:1,id:'j',title:'',updatedAt:'',background:'',width:600,height:800,elements:[element('photo',{src:paths[1]})]}]);
  reclaimFrames([]);
  assert.deepEqual([...files.keys()], [paths[0],paths[1],paths[3]]);
});

test('frame count and byte caps preserve active evidence and free capacity after removal', () => {
  const {files} = device();
  const active = [];
  for (let index = 0; index < 12; index++) active.push(storeFrame(new ArrayBuffer(1),active));
  assert.throws(() => storeFrame(new ArrayBuffer(1),active), FrameCapacityError);
  active.pop(); reclaimFrames(active);
  assert.equal(files.size,11);
  assert.throws(() => storeFrame(new ArrayBuffer(12*1024*1024),active), FrameCapacityError);
  assert.equal(files.size,11);
  assert.ok(storeFrame(new ArrayBuffer(1),active));
});

test('unreadable observation metadata leaves the original images intact', () => {
  const {files,root,storage} = device();
  const path = root + '/vision-1720000000000.jpg'; files.set(path,80);
  storage.set('bird-assistant.records.v1',{version:2});
  reclaimFrames([]);
  assert.equal(files.has(path),true);
});
