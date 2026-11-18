export class MediaError extends Error {
  constructor(message: string, readonly detail: { errMsg: string; errno?: number }) { super(message); this.name = 'MediaError'; }
}

export function choosePhoto(sourceType: Array<'album' | 'camera'>): Promise<string | null> {
  return new Promise((resolve, reject) => {
    wx.chooseImage({
      count: 1,
      sizeType: ['original'],
      sourceType,
      success: result => result.tempFilePaths[0] ? resolve(result.tempFilePaths[0]) : reject(new MediaError('没有读取到图片，请重新选择。', { errMsg: 'empty photo selection' })),
      fail: error => /cancel/i.test(error.errMsg) ? resolve(null) : reject(new MediaError('图片选择未完成，请重试或使用另一种输入。', error))
    });
  });
}

export function persistImage(tempFilePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().saveFile({
      tempFilePath,
      success: result => resolve(result.savedFilePath),
      fail: error => reject(new MediaError('素材未能保存在本机。请检查可用空间后重试，当前输入仍保留。', error))
    });
  });
}

export function errorText(error: unknown): string {
  // Local diagnostics retain native errMsg/errno; nothing is uploaded or reported remotely.
  console.warn('[Bird Assistant] operation failed', error);
  return error instanceof Error ? error.message : '操作未完成，当前内容仍保留。';
}
