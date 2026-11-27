'use strict';
const cloud = require('wx-server-sdk');
const {handleGateway} = require('./handler.cjs');
cloud.init({env: cloud.DYNAMIC_CURRENT_ENV});
exports.main = async event => handleGateway(event, {
  context: cloud.getWXContext(),
  appId: process.env.BIRD_GATEWAY_APP_ID || '',
  writingEnabled: process.env.BIRD_GATEWAY_ENABLE_WRITING === 'true',
  fetch: globalThis.fetch
});
