const {test}=require('node:test');const assert=require('node:assert/strict');
const sheet=require('../.test-build/services/sheet-gesture.js');
const event=(x,y,count=1)=>({currentTarget:{dataset:{dismiss:'close'}},touches:Array.from({length:count},()=>({clientX:x,clientY:y}))});
function host(){return {data:{},closed:0,setData(value){Object.assign(this.data,value);},close(){this.closed++;}};}
test('short and sideways sheet drags snap back without dismissing or retaining a stale gesture',t=>{
 t.mock.timers.enable({apis:['Date'],now:1000});const p=host();sheet.beginSheetDrag(p,event(0,0));t.mock.timers.tick(500);sheet.moveSheetDrag(p,event(0,22));sheet.endSheetDrag(p);assert.equal(p.closed,0);assert.equal(p.data.sheetDragStyle,'');sheet.beginSheetDrag(p,event(0,0));sheet.moveSheetDrag(p,event(90,40));sheet.endSheetDrag(p);assert.equal(p.closed,0);assert.equal(p.data.sheetDragStyle,'');
});
test('deliberate slow drag and fast downward flick each dismiss once, with no idle timeout',t=>{
 t.mock.timers.enable({apis:['Date'],now:1000});const p=host();sheet.beginSheetDrag(p,event(0,0));t.mock.timers.tick(60000);sheet.moveSheetDrag(p,event(0,90));sheet.endSheetDrag(p);sheet.endSheetDrag(p);assert.equal(p.closed,1);sheet.beginSheetDrag(p,event(0,0));t.mock.timers.tick(35);sheet.moveSheetDrag(p,event(0,32));sheet.endSheetDrag(p);assert.equal(p.closed,2);assert.equal(p.data.sheetDragStyle,'');
});
test('upward and multi-touch gestures never dismiss a sheet',t=>{
 t.mock.timers.enable({apis:['Date'],now:1000});const p=host();sheet.beginSheetDrag(p,event(0,100));sheet.moveSheetDrag(p,event(0,10));sheet.endSheetDrag(p);assert.equal(p.closed,0);sheet.beginSheetDrag(p,event(0,0));sheet.moveSheetDrag(p,event(0,100,2));sheet.endSheetDrag(p);assert.equal(p.closed,0);
});
test('cloud opacity reaches one before a rotated paper touches the date row and is zero before movement',()=>{
 const {paperCloudOpacity}=require('../.test-build/services/paper-gesture.js');const origin=500,height=260,width=250,travel=-230,boundary=300;
 assert.equal(paperCloudOpacity(origin,height,width,travel,0,boundary),0);assert.ok(paperCloudOpacity(origin,height,width,travel,.0001,boundary)<.01);
 const p=.2,scale=1-p*.46,angle=p*2.8*Math.PI/180,top=origin+travel*p-height*.6*scale*Math.cos(angle)-width*.5*scale*Math.sin(angle);
 assert.ok(top>boundary);assert.equal(paperCloudOpacity(origin,height,width,travel,p,boundary),1);
 assert.equal(paperCloudOpacity(900,height,width,travel,.1,boundary),0);
});
test('map waves start green, wash toward white while expanding, and retain the nine-second geographic lifetime',()=>{
 const {mapRippleCircles}=require('../.test-build/services/map-effects.js');const point={latitude:40,longitude:116,started:0,color:'#285b49'};
 const first=mapRippleCircles(point,0,12)[1],last=mapRippleCircles(point,1699,12)[1];assert.equal(first.color,'#285b49');assert.ok(last.radius>first.radius);const rgb=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));assert.ok(rgb(last.color).every((v,i)=>v>rgb(first.color)[i]));assert.equal(mapRippleCircles(point,9000,12).length,0);assert.equal(mapRippleCircles(point,0,12)[0].fillColor,'#285b49');
});
