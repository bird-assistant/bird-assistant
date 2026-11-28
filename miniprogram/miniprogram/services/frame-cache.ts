import { getDraft } from './community';
import { readJournals } from './journal-model';
import {restoreEditorHistory} from './journal-storage';
import {postDraftMediaPaths} from './post-draft';
import { localRepository } from './repository';

const maxFrames = 12;
const maxBytes = 12 * 1024 * 1024;
const ownedName = /^vision-\d{13}(?:-\d+)?\.(?:jpg|png)$/;
let sequence = 0;

export class FrameCapacityError extends Error {}

function collect(activePaths: string[]) {
  const root = wx.env.USER_DATA_PATH;
  const files = wx.getFileSystemManager();
  const names = new Set(files.readdirSync(root).filter(name => ownedName.test(name)));
  let count = 0, bytes = 0;
  if (!names.size) return {count, bytes, names};
  const saved = new Set<string>();
  for (const record of localRepository().list()) {
    saved.add(record.imagePath);
    if (record.communityDraft) saved.add(record.communityDraft.path);
  }
  for (const journal of readJournals()) {
    const history=restoreEditorHistory(journal);
    for(const document of [journal,...history.past.map(step=>step.document),...history.future.map(step=>step.document)]){
      for (const element of document.elements) saved.add(element.src);
    }
  }
  for(const path of postDraftMediaPaths())saved.add(path);
  const active = new Set(activePaths);
  const draft = getDraft();
  if (draft) active.add(draft.path);
  for (const name of names) {
    const path = root + '/' + name;
    if (saved.has(path)) continue;
    if (!active.has(path)) {
      try { files.unlinkSync(path); continue; } catch {}
    }
    const stat = files.statSync(path);
    if (Array.isArray(stat) || !stat.isFile()) throw new Error('无法核对识别帧缓存。');
    count++;
    bytes += stat.size;
  }
  return {count, bytes, names};
}

export function reclaimFrames(activePaths: string[]) {
  try { collect(activePaths); } catch {}
}

export function storeFrame(image: ArrayBuffer, activePaths: string[]): string {
  const {count, bytes, names} = collect(activePaths);
  if (count >= maxFrames || bytes + image.byteLength > maxBytes) {
    throw new FrameCapacityError('待复核帧已达到 12 张或 12 MB，请先保存观察或移除素材。');
  }
  const suffix = new Uint8Array(image)[0] === 137 ? 'png' : 'jpg';
  const files = wx.getFileSystemManager();
  const stamp = Date.now();
  let name: string;
  do { name = `vision-${stamp}-${++sequence}.${suffix}`; } while (names.has(name));
  const path = wx.env.USER_DATA_PATH + '/' + name;
  try { files.writeFileSync(path, image); }
  catch (error) { try { files.unlinkSync(path); } catch {} throw error; }
  return path;
}
