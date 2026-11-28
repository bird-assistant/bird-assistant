'use strict';
const COLLECTION='bird_private_place_backups_v1';
function record(reply){if(reply?.code||!reply||!Object.prototype.hasOwnProperty.call(reply,'data'))throw Error('database read failed');const data=reply.data;if(Array.isArray(data)){if(data.length>1)throw Error('unexpected document count');return data[0]||null;}if(data==null)return null;if(typeof data!=='object')throw Error('invalid document');return data;}
/** A single conditional update is atomic; no read-then-unconditional overwrite or multi-document transaction. */
function documentStore(db){
 const collection=()=>db.collection(COLLECTION);
 return {
  async read(owner){return record(await collection().doc(owner).get());},
  async compareAndSwap(owner,expected,value){
   if(expected===0){
    // The deterministic unique _id rejects simultaneous first writers. Never turn an insertion error into an overwrite.
    const result=await collection().add({...value,_id:owner});if(result?.code||result?.id!==owner)throw Error('database insert not confirmed');return true;
   }
   const result=await collection().where({_id:owner,revision:expected}).update(value);
   if(result?.code||!Number.isSafeInteger(result?.updated)||result.updated<0||result.updated>1)throw Error('unexpected update result');
   return result.updated===1;
  }
 };
}
module.exports={documentStore,COLLECTION};
