/** Use the current app window, never device model/DPR or physical screen size. */
export function workspaceLayout(width:number,height:number,header=88){
  const w=Number.isFinite(width)?Math.max(0,width):0,h=Number.isFinite(height)?Math.max(0,height-header):0;
  const split=w>=860&&h>=440;
  const body=Math.max(0,Math.min(1360,w)-48),listWidth=split?Math.max(280,Math.min(352,Math.round(body*.31))):w;
  return {split,workspaceHeight:h,listWidth,detailWidth:split?body-26-listWidth:w};
}
