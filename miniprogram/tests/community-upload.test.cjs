const {test} = require('node:test');
const assert = require('node:assert/strict');

function client({upload, read, size = 6, request}) {
  const network = require.resolve('../.test-build/services/vision-network.js');
  const community = require.resolve('../.test-build/services/community.js');
  delete require.cache[community];
  delete require.cache[network];
  let logins = 0;
  global.wx = {
    login: options => options.success({code: 'mock'}),
    request(options) {
      if (options.url.endsWith('/auth/wechat')) {
        options.success({statusCode: 200, data: {access_token: 'session-' + ++logins, expires_in: 3600}});
      } else request(options);
    },
    uploadFile: upload,
    getFileSystemManager: () => ({getFileInfo: options => options.success({size}), readFile: read})
  };
  return require(community).uploadPhoto;
}

const blocked = options => options.fail({errMsg: 'uploadFile:fail url not in domain list'});

test('blocked native upload retries the original multipart bytes and refreshes an expired token once', async () => {
  const bytes = Uint8Array.from([255,216,0,128,0,255]);
  let reads = 0, uploads = 0, requests = 0;
  const upload = client({
    upload: options => { uploads++; blocked(options); },
    read: options => { reads++; options.success({data: bytes.buffer}); },
    request: options => {
      requests++;
      assert.ok(options.url.endsWith('/api/v1/community/media'));
      assert.equal(options.header.Authorization, 'Bearer session-' + requests);
      const boundary = options.header['Content-Type'].split('boundary=')[1];
      const expected = Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="bird.jpeg"\r\nContent-Type: image/jpeg\r\n\r\n'), bytes, Buffer.from('\r\n--'+boundary+'--\r\n')]);
      assert.deepEqual(Buffer.from(options.data), expected);
      options.success({statusCode: requests === 1 ? 401 : 201, data: '{"id":"stored","camera":{}}', header: {}});
    }
  });
  assert.equal((await upload('original.jpg')).id, 'stored');
  assert.deepEqual({reads,uploads,requests}, {reads:1,uploads:1,requests:2});
});

test('HTTP rejection and cancellation do not resend the photo', async () => {
  for (const example of [
    {upload: options => options.success({statusCode:413, data:'<html>too large</html>'}), reason:/大小限制/},
    {upload: options => options.fail({errMsg:'uploadFile:fail cancel'}), reason:/取消/}
  ]) {
    const upload = client({upload:example.upload, read:assert.fail, request:assert.fail});
    await assert.rejects(upload('original.jpg'), example.reason);
  }
});

test('fallback distinguishes an unreadable original, an oversized photo and a network timeout', async () => {
  const upload = client({upload:blocked, read:options => options.fail({errMsg:'ENOENT'}), request:assert.fail});
  await assert.rejects(upload('expired.jpg'), /从相册重新选择/);
  const tooLarge = client({upload:blocked, size:25*1024*1024, read:assert.fail, request:assert.fail});
  await assert.rejects(tooLarge('large.jpg'), /24 MiB/);
  const timeout = client({upload:blocked, read:options => options.success({data:new ArrayBuffer(6)}),
    request:options => options.fail({errMsg:'request:fail timeout'})});
  await assert.rejects(timeout('slow.jpg'), /上传超时/);
});
