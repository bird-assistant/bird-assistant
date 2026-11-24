/** Window coordinates only; the paper/map data never depend on a phone brand. */
export function mapPanes(width:number,height:number){
  const fieldHeight=Math.max(0,Math.floor(height)),toolbarHeight=fieldHeight<380?96:112;
  const mapHeight=Math.max(0,fieldHeight-toolbarHeight);
  const compact=mapHeight<260,creditReserve=36,sheetHeaderHeight=compact?44:64;
  const sheetHeight=Math.min(390,Math.max(0,Math.floor((mapHeight-creditReserve)*(compact?1:.72))));
  return {fieldHeight,toolbarHeight,mapHeight,sheetHeight,sheetHeaderHeight,creditReserve,compact,listHeight:Math.max(0,sheetHeight-sheetHeaderHeight-12),wide:width>=700};
}
export function clusterMarker(group:{latitude:number;longitude:number;count:number},index:number){
  const cluster=group.count>1;
  return {id:index+1,latitude:group.latitude,longitude:group.longitude,
    iconPath:cluster?'/assets/icons/map-cluster.png':'/assets/icons/pin.png',width:cluster?40:26,height:cluster?40:30,
    ...(cluster?{anchor:{x:.5,y:.5},label:{content:group.count>999?'999+':String(group.count),color:'#ffffff',fontSize:12,textAlign:'center',anchorX:0,anchorY:-8}}:{}),
    callout:{content:group.count+' 条',display:'BYCLICK' as const,padding:6,borderRadius:10,color:'#285b49',bgColor:'#fffef9'}};
}
