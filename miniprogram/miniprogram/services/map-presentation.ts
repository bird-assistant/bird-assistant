/** Window coordinates only; the paper/map data never depend on a phone brand. */
export function mapPanes(width:number,height:number){
  const fieldHeight=Math.max(0,Math.floor(height)),toolbarHeight=fieldHeight<380?96:112;
  const mapHeight=Math.max(0,fieldHeight-toolbarHeight);
  const compact=mapHeight<260,creditReserve=0,sheetHeaderHeight=compact?58:78,wide=width>=700;
  // Flush to the tab boundary, with an opaque bottom and an upward content fade.
  const sheetHeight=wide?Math.max(0,mapHeight-16):Math.min(300,Math.max(0,Math.floor(mapHeight*.46)));
  return {fieldHeight,toolbarHeight,mapHeight,sheetHeight,sheetHeaderHeight,creditReserve,compact,
    searchHeight:Math.max(0,Math.min(132,mapHeight-36)),
    drawerWidth:wide?Math.round(Math.min(380,width*.4)):width,listHeight:Math.max(0,sheetHeight-sheetHeaderHeight),wide};
}
/** Exactly one to three 44px options; additional matches scroll. */
export function speciesResultsHeight(count:number,more:boolean,available:number){return Math.min(Math.max(0,available),44*Math.min(3,Math.max(0,count)+(more?1:0)));}
export const INDIVIDUAL_PIN_ZOOM=16;
export function clusterMarker(group:{latitude:number;longitude:number;count:number},index:number,_zoom=4){
  return {id:index+1,latitude:group.latitude,longitude:group.longitude,
    iconPath:'/assets/icons/map-cluster.png',width:40,height:40,anchor:{x:.5,y:.5},
    callout:{content:group.count+' 条',display:'BYCLICK' as const,padding:6,borderRadius:10,color:'#285b49',bgColor:'#fffef9'}};
}

/** Short result drawers use only the space their rows need. */
export function recordPane(maximum:number,header:number,count:number,more:boolean,loading=false){
  const body=Math.min(Math.max(0,maximum-header),Math.max(64,count*74+(more?64:48)+(loading?30:0)));
  return {sheetHeight:header+body,listHeight:body};
}
