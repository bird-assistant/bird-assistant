import { ContextInput, ObservationContext, observationContext, validStoredContext } from './observation-context';

export interface StoragePort {
  read(key: string): unknown;
  write(key: string, value: unknown): void;
}

export interface Observation extends Partial<ObservationContext> {
  id: string;
  birdName: string;
  notes: string;
  imagePath: string;
  source: 'camera' | 'album';
  createdAt: string;
  observedAt: string|null;
  visibility: 'private';
  sync: 'local-only';
  mediaKind?: 'photo' | 'video' | 'audio';
  sample?: boolean;
}

export interface Profile { name: string; avatar: string; }
export const RECORDS_KEY = 'bird-assistant.records.v1';
export const PROFILE_KEY = 'bird-assistant.profile.v1';

export function isSampleObservation(record:Pick<Observation,'sample'|'imagePath'>):boolean {
  // Recognize older packaged examples too; do not remove them from history or journal materials.
  return record.sample===true||/^\/assets\/samples\//.test(record.imagePath)||record.imagePath==='/assets/bird-preview.png';
}
export function observationStats(records:Observation[],favorites:string[]) {
  const actual=records.filter(r=>!isSampleObservation(r));
  const names=new Set(actual.map(r=>r.birdName.trim()).filter(name=>name&&name!=='待鉴定'));
  const favoriteIds=new Set(favorites);
  return {observationCount:actual.length,speciesCount:names.size,favoriteCount:actual.filter(r=>favoriteIds.has(r.id)).length};
}

export class RepositoryError extends Error {
  constructor(message: string) { super(message); this.name = 'RepositoryError'; }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export function createRepository(port: StoragePort, now: () => string = () => new Date().toISOString(), id: () => string = () => 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9)) {
  function list(): Observation[] {
    const stored = port.read(RECORDS_KEY);
    if (stored === '' || stored === undefined || stored === null) return [];
    if (!isObject(stored) || stored.version !== 1 || !Array.isArray(stored.records)) throw new RepositoryError('本机记录格式无法读取，已有内容未覆盖。');
    const valid = stored.records.every((r: unknown) => isObject(r) && typeof r.id === 'string' && typeof r.birdName === 'string' && typeof r.notes === 'string' && typeof r.imagePath === 'string' && typeof r.createdAt === 'string' && (r.source === 'camera' || r.source === 'album') && validStoredContext(r) && r.visibility === 'private' && r.sync === 'local-only');
    if (!valid) throw new RepositoryError('本机记录包含无法读取的内容，已有资料未覆盖。');
    return copy(stored.records as Observation[]);
  }
  function save(draft: Pick<Observation, 'birdName' | 'notes' | 'imagePath' | 'source'> & Partial<Pick<Observation, 'mediaKind' | 'sample'>> & Partial<ContextInput>): Observation {
    const existing = list();
    if (!draft.imagePath.trim()) throw new RepositoryError('请先选择或拍摄照片。');
    const createdAt=now(),context=observationContext({observedDate:draft.observedDate||'',observedTime:draft.observedTime||'',placeName:draft.placeName||''},createdAt);
    const record: Observation = { imagePath:draft.imagePath,source:draft.source,notes:draft.notes,mediaKind:draft.mediaKind,sample:draft.sample,
      birdName:draft.birdName.trim()||'待鉴定',id:id(),createdAt,...context,visibility:'private',sync:'local-only' };
    // Synchronous storage must acknowledge the write before the caller shows success.
    port.write(RECORDS_KEY, { version: 1, records: [record, ...existing] });
    return copy(record);
  }
  function profile(): Profile {
    const stored = port.read(PROFILE_KEY);
    if (stored === '' || stored === undefined || stored === null) return { name: '观鸟者', avatar: '/assets/avatars/owl.png' };
    if (!isObject(stored) || stored.version !== 1 || !isObject(stored.profile) || typeof stored.profile.name !== 'string' || typeof stored.profile.avatar !== 'string') throw new RepositoryError('本机资料无法读取，原资料未覆盖。');
    return copy(stored.profile as unknown as Profile);
  }
  function saveProfile(value: Profile): Profile {
    profile();
    if (!value.name.trim()) throw new RepositoryError('请填写显示名称。');
    const result = { name: value.name.trim(), avatar: value.avatar };
    port.write(PROFILE_KEY, { version: 1, profile: result });
    return copy(result);
  }
  return { list, save, profile, saveProfile };
}

export function localRepository() {
  return createRepository({ read: key => wx.getStorageSync(key) as unknown, write: (key, value) => wx.setStorageSync(key, value) });
}
