import { round2 } from './numbers';

export function layout(focused = false) {
  const info = wx.getWindowInfo();
  const capsule = wx.getMenuButtonBoundingClientRect();
  const status = info.statusBarHeight || 24;
  const headerHeight = Math.max(status + 44, capsule.bottom + Math.max(4, capsule.top - status));
  const tabHeight = 66 + Math.max(0, info.screenHeight - (info.safeArea?.bottom || info.screenHeight));
  return { headerHeight, tabHeight, width: info.windowWidth, height: info.windowHeight - headerHeight - (focused ? 0 : tabHeight) };
}

export const EDITOR_CHROME_HEIGHT = 94; // 54 toolbar + 28 caption + 12 spacing.

export function editorPanes(height: number, documentHeight: number) {
  const minimumControls = Math.min(190, Math.max(64, (height - EDITOR_CHROME_HEIGHT) * .45));
  const stageHeight = round2(Math.max(0, Math.min(documentHeight, height * .48, height - EDITOR_CHROME_HEIGHT - minimumControls)));
  return { stageHeight, controlsHeight: round2(Math.max(0, height - EDITOR_CHROME_HEIGHT - stageHeight)) };
}
