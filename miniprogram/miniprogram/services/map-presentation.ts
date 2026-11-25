/** Window coordinates only; the paper/map data never depend on a phone brand. */
export function mapPanes(width:number,height:number){
  const fieldHeight=Math.max(0,Math.floor(height)),toolbarHeight=fieldHeight<380?96:112;
  const mapHeight=Math.max(0,fieldHeight-toolbarHeight);
  const compact=mapHeight<260,creditReserve=0,sheetHeaderHeight=compact?44:64,wide=width>=700;
  // Flush to the tab boundary, with an opaque bottom and an upward content fade.
  const sheetHeight=wide?Math.max(0,mapHeight-16):Math.min(300,Math.max(0,Math.floor(mapHeight*.46)));
  return {fieldHeight,toolbarHeight,mapHeight,sheetHeight,sheetHeaderHeight,creditReserve,compact,
    searchHeight:Math.max(60,Math.min(176,mapHeight-44)),
    drawerWidth:wide?Math.round(Math.min(380,width*.4)):width,listHeight:Math.max(0,sheetHeight-sheetHeaderHeight),wide};
}
export const INDIVIDUAL_PIN_ZOOM=16;
export function clusterMarker(group:{latitude:number;longitude:number;count:number},index:number,zoom=4){
  const cluster=group.count>1||zoom<INDIVIDUAL_PIN_ZOOM;
  return {id:index+1,latitude:group.latitude,longitude:group.longitude,
    iconPath:cluster?'/assets/icons/map-cluster.png':'/assets/icons/pin.png',width:cluster?40:26,height:cluster?40:30,
    ...(cluster?{anchor:{x:.5,y:.5},label:{content:String(group.count),color:'#ffffff',fontSize:group.count>=10000?10:12,textAlign:'center',anchorX:0,anchorY:-8}}:{}),
    callout:{content:group.count+' 条',display:'BYCLICK' as const,padding:6,borderRadius:10,color:'#285b49',bgColor:'#fffef9'}};
}
