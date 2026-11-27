const {test}=require('node:test');
const assert=require('node:assert/strict');
const metadata=require('../.test-build/services/photo-metadata.js');
const {photoInfo}=require('../.test-build/services/photo-info.js');

// Independent classic-TIFF fixture: explicit offsets, two IFDs and private tags that must be ignored.
function exif(little=true){
  const data=Buffer.alloc(512),view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const w16=(p,n)=>view.setUint16(p,n,little),w32=(p,n)=>view.setUint32(p,n,little),signed=(p,n)=>view.setInt32(p,n,little);
  data.write(little?'II':'MM');w16(2,42);w32(4,8);w16(8,5);
  function entry(p,tag,type,count,value){w16(p,tag);w16(p+2,type);w32(p+4,count);if(type===3&&count===1)w16(p+8,value);else w32(p+8,value);}
  entry(10,271,2,6,100);data.write('Nikon\0',100);
  entry(22,272,2,7,110);data.write('D5100\0\0',110);
  entry(34,34665,4,1,128);entry(46,34853,4,1,400);entry(58,42033,2,15,430);data.write('private-serial\0',430);
  w16(128,9);
  entry(130,33434,5,1,300);w32(300,1);w32(304,50);
  entry(142,33437,5,1,308);w32(308,63);w32(312,10);
  entry(154,34855,3,1,800);
  entry(166,37386,5,1,316);w32(316,600);w32(320,1);
  entry(178,37380,10,1,324);signed(324,-1);signed(328,3);
  entry(190,41987,3,1,0);entry(202,37385,3,1,0);
  entry(214,42036,2,13,340);data.write('Field lens 6\0',340);
  entry(226,37500,7,20,450);data.write('secret-maker-gps-data',450);
  w16(400,1);entry(402,2,5,3,470);data.write('GPS-PRIVATE',470);
  return data;
}
function jpeg(tiff=exif()){
  const app=Buffer.concat([Buffer.from('Exif\0\0'),tiff]),size=Buffer.alloc(2);size.writeUInt16BE(app.length+2);
  return Buffer.concat([Buffer.from([255,216,255,225]),size,app,Buffer.from([255,192,0,11,8,5,53,7,208,1,1,17,0,255,217])]);
}
const arrayBuffer=data=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
test('little- and big-endian JPEG EXIF expose real camera fields without private or inferred values',()=>{
  for(const little of [true,false]){
    const result=metadata.parsePhotoMetadata(arrayBuffer(jpeg(exif(little))));assert.equal(result.state,'ready');assert.equal(result.hasExif,true);
    assert.equal(result.camera.make,'Nikon');assert.equal(result.camera.model,'D5100');assert.equal(result.camera.iso,'800');assert.equal(result.camera.exposure,'0.02');assert.equal(result.camera.aperture,'6.3');assert.equal(result.camera.focal,'600');assert.equal(result.camera.exposureBias,'-0.33 EV');assert.equal(result.camera.whiteBalance,'AWB');assert.equal(result.camera.flash,'未闪光');assert.equal(result.camera.resolution,'2000 × 1333 px');
    assert.equal(result.camera.focusMode,undefined);assert.doesNotMatch(JSON.stringify(result),/private|secret|latitude|longitude|serial/i);
    const shown=photoInfo(result.camera);assert.equal(shown.settings.find(row=>row.key==='exposure').value,'1/50 s');
  }
});
test('PNG and WebP EXIF wrappers preserve the same allowed camera metadata',()=>{
  const chunk=(kind,data,little=false)=>{const length=Buffer.alloc(4);little?length.writeUInt32LE(data.length):length.writeUInt32BE(data.length);return little?Buffer.concat([Buffer.from(kind),length,data,data.length%2?Buffer.alloc(1):Buffer.alloc(0)]):Buffer.concat([length,Buffer.from(kind),data,Buffer.alloc(4)]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(600);ihdr.writeUInt32BE(400,4);
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('eXIf',exif()),chunk('IEND',Buffer.alloc(0))]);
  const contents=chunk('EXIF',exif(false),true),riff=Buffer.alloc(4);riff.writeUInt32LE(contents.length+4);
  const webp=Buffer.concat([Buffer.from('RIFF'),riff,Buffer.from('WEBP'),contents]);
  for(const data of [png,webp]){const result=metadata.parsePhotoMetadata(arrayBuffer(data));assert.equal(result.camera.iso,'800');assert.equal(result.camera.model,'D5100');assert.equal(result.hasExif,true);}
});
test('zero denominators, corrupt offsets, truncated markers and hostile counts cannot invent values or throw',()=>{
  const data=exif();data.writeUInt32LE(0,304);data.writeUInt32LE(0xffffffff,150);data.writeUInt32LE(0xffffffff,134);
  const malformed=[Buffer.alloc(0),Buffer.from([255,216,255,225,0,1]),jpeg().subarray(0,18),jpeg(data),Buffer.from('unrecognized format')];
  for(const input of malformed)assert.doesNotThrow(()=>metadata.parsePhotoMetadata(arrayBuffer(input)));
  const value=metadata.parsePhotoMetadata(arrayBuffer(jpeg(data)));assert.equal(value.camera.exposure,undefined);assert.equal(value.camera.aperture,undefined);assert.doesNotMatch(JSON.stringify(value),/NaN|Infinity/);
  for(let i=0;i<128;i++){const input=jpeg();input[i%input.length]=i;assert.doesNotThrow(()=>metadata.parsePhotoMetadata(arrayBuffer(input)));}
});
test('local file reads are bounded and perform no upload, login, mutation or location request',async()=>{
  const bytes=arrayBuffer(jpeg());let read;
  global.wx={getFileSystemManager:()=>({getFileInfo:o=>o.success({size:100000000}),readFile:o=>{read=o;o.success({data:bytes});}})};
  const result=await metadata.readLocalPhotoMetadata('wxfile://original');assert.equal(result.camera.iso,'800');assert.equal(read.position,0);assert.equal(read.length,metadata.PHOTO_HEADER_LIMIT);
});
test('unreadable or unsupported files remain importable and saved metadata stays allowlisted',async()=>{
  global.wx={getFileSystemManager:()=>({getFileInfo:o=>o.fail({errMsg:'unavailable'})})};
  assert.equal((await metadata.readLocalPhotoMetadata('missing')).state,'unavailable');
  assert.equal(metadata.parsePhotoMetadata(arrayBuffer(Buffer.from('HEIC?'))).state,'unsupported');
  const safe=metadata.cleanLocalMetadata({state:'ready',format:'jpeg',hasExif:true,camera:{model:'Camera',latitude:'40',serial:'private'}});assert.deepEqual(safe.camera,{model:'Camera'});
});
