'use strict';
const wxCloud=require('wx-server-sdk');
const cloudbase=require('@cloudbase/node-sdk');
const {handleVault}=require('./handler.cjs');
const {documentStore}=require('./store.cjs');
wxCloud.init({env:wxCloud.DYNAMIC_CURRENT_ENV});
// Stable Node SDK supports PG environments; wx-server-sdk is used only for trusted WeChat invocation context.
exports.main=async event=>{
 const context=wxCloud.getWXContext();
 const appId=process.env.BIRD_VAULT_APP_ID,enabled=process.env.BIRD_VAULT_ENABLED==='true';
 if(!enabled||!appId||!context.OPENID||context.APPID!==appId)return handleVault(event,{context,appId,enabled});
 const app=cloudbase.init({env:cloudbase.SYMBOL_CURRENT_ENV});
 return handleVault(event,{context,appId,enabled,store:documentStore(app.database()),now:()=>new Date().toISOString()});
};
