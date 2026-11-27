const {afterEach}=require('node:test');
const pages=[];

// A page owns timers and pending saves; keep its wx fake alive until unload finishes.
exports.registerPage=function(page){
  const record={page,wx:global.wx,closed:false},unload=page.onUnload;
  page.onUnload=()=>{if(record.closed)return;record.closed=true;return unload?.();};
  pages.push(record);
  return page;
};

afterEach(async()=>{
  const previous=global.wx;
  try{
    for(const {page,wx} of pages.splice(0).reverse()){
      global.wx=wx;
      page.onUnload();
      await page._saveJob;
    }
  }finally{global.wx=previous;}
});
