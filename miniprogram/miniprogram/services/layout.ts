import { round2 } from './numbers';

export function headerMetrics(width:number,statusBarHeight:number|undefined,capsule:{left:number;top:number;bottom:number}|null){
  const status=typeof statusBarHeight==='number'&&Number.isFinite(statusBarHeight)&&statusBarHeight>=0?statusBarHeight:24;
  const valid=!!capsule&&Number.isFinite(capsule.left)&&capsule.left>0&&capsule.left<width&&capsule.top>=status&&capsule.bottom>capsule.top;
  return {status,headerHeight:valid?Math.max(status+44,capsule!.bottom+Math.max(4,capsule!.top-status)):status+44,
    right:valid?Math.max(0,Math.min(width-48,width-capsule!.left+10)):16};
}
export function layout(focused = false) {
  const info = wx.getWindowInfo();
  let capsule=null;try{capsule=wx.getMenuButtonBoundingClientRect();}catch{/* Some desktop windows have no capsule. */}
  const {headerHeight}=headerMetrics(info.windowWidth,info.statusBarHeight,capsule);
  const tabHeight = 66 + Math.max(0, info.screenHeight - (info.safeArea?.bottom || info.screenHeight));
  return { headerHeight, tabHeight, width: info.windowWidth, height: info.windowHeight - headerHeight - (focused ? 0 : tabHeight) };
}

export const EDITOR_CHROME_HEIGHT = 128; // 34 name row + 54 toolbar + 28 caption + 12 spacing.

export function editorPanes(height: number, documentHeight: number) {
  const minimumControls = Math.min(190, Math.max(64, (height - EDITOR_CHROME_HEIGHT) * .45));
  const stageHeight = round2(Math.max(0, Math.min(documentHeight, height * .48, height - EDITOR_CHROME_HEIGHT - minimumControls)));
  return { stageHeight, controlsHeight: round2(Math.max(0, height - EDITOR_CHROME_HEIGHT - stageHeight)) };
}
