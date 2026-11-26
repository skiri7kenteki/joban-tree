// Google ドライブの同期（段階22-3、v0.51.0）。通信と保存を偽物にして、何台かの端末が順に同期する流れを確かめる
import { describe, expect, it } from 'vitest';
import { filesToRead, shouldSyncNudge, studyChangesOf, syncFileName, syncMessage, syncOnce, type RemoteFile, type SyncPort, type SyncState } from '../../src/drive/sync';
import type { BackupData } from '../../src/tree/backupFile';
import { stampStudy, studyDeletion } from '../../src/tree/deleted';
import { mergeAll } from '../../src/tree/merge';
import type { Study } from '../../src/tree/types';

const study = (id: string, moves: string, at: number, name = id): Study => ({
  id,
  name,
  note: '',
  moves: moves.split(' '),
  mySide: 'black',
  createdAt: at,
  updatedAt: at,
});
const empty = (): BackupData => ({ studies: [], trees: [], reviews: [], templates: [], games: [], practice: [], positions: [], deleted: [], prefs: {} });

/** 偽物のドライブ（アプリ専用の場所） */
class Drive {
  files = new Map<string, { name: string; text: string; version: number }>();
  private seq = 0;
  list(): RemoteFile[] {
    return [...this.files].map(([id, f]) => ({ id, name: f.name, modifiedTime: `v${f.version}`, md5Checksum: `${f.version}` }));
  }
  put(id: string | null, name: string, text: string): RemoteFile {
    const key = id ?? `f${this.files.size + 1}`;
    this.files.set(key, { name, text, version: ++this.seq });
    return this.list().find((f) => f.id === key)!;
  }
}

/** 偽物の端末。fail で、その通信だけ失敗させる */
class Device {
  data = empty();
  state: SyncState;
  uploads = 0;
  downloads = 0;
  applied = 0;
  fail: 'list' | 'download' | 'upload' | null = null;
  constructor(
    private drive: Drive,
    id: string,
  ) {
    this.state = { deviceId: id, seen: {}, uploadedHash: '' };
    this.data.prefs = { 'joban-tree.wars-name': `${id}-wars` };
  }
  private check(step: 'list' | 'download' | 'upload') {
    if (this.fail === step) throw new Error(`偽の失敗：${step}`);
  }
  port(): SyncPort {
    return {
      appVersion: '0.51.0',
      now: () => 1000,
      hash: async (t) => t,
      list: async () => (this.check('list'), this.drive.list()),
      download: async (id) => (this.check('download'), this.downloads++, this.drive.files.get(id)!.text),
      upload: async (id, name, text) => (this.check('upload'), this.uploads++, this.drive.put(id, name, text)),
      readData: async () => structuredClone(this.data),
      apply: async (incoming) => {
        this.applied++;
        const before = structuredClone(this.data);
        const result = mergeAll(this.data, structuredClone(incoming));
        this.data = result.data;
        return { before, after: structuredClone(this.data), changes: studyChangesOf(result) };
      },
      loadState: () => structuredClone(this.state),
      saveState: (s) => (this.state = structuredClone(s)),
    };
  }
  sync() {
    return syncOnce(this.port());
  }
  ids() {
    return this.data.studies.map((s) => s.id).sort();
  }
}

const FIRST_MOVES = '1g1f 2g2f 3g3f 4g4f 5g5f 6g6f 7g7f 8g8f 9g9f 1i1h 9i9h 3i3h 3i4h 7i7h 7i6h'.split(' ');

describe('同期の流れ', () => {
  it('初めての同期は、自分のファイルを 1 つ作る。設定は送らない', async () => {
    const drive = new Drive();
    const a = new Device(drive, 'aaa');
    a.data.studies = [study('s1', '7g7f 3c3d', 1)];
    const r = await a.sync();
    expect(r.ok).toBe(true);
    expect(drive.list().map((f) => f.name)).toEqual([syncFileName('aaa')]);
    const sent = JSON.parse([...drive.files.values()][0].text);
    expect(sent).toMatchObject({ app: 'joban-tree', kind: 'backup', version: 1 });
    expect(sent.data.prefs).toEqual({});
    expect([...drive.files.values()][0].text).not.toContain('aaa-wars');
    expect(a.data.prefs['joban-tree.wars-name']).toBe('aaa-wars');
    expect(a.applied).toBe(0);
  });

  it('2 台は順に同期するとそろい、そのあとは何も読まず、何も送らない', async () => {
    const drive = new Drive();
    const a = new Device(drive, 'aaa');
    const b = new Device(drive, 'bbb');
    a.data.studies = [study('s1', '7g7f 3c3d', 1)];
    b.data.studies = [study('s2', '2g2f 8c8d', 2)];
    await a.sync();
    await b.sync();
    await a.sync();
    expect(a.ids()).toEqual(['s1', 's2']);
    expect(b.ids()).toEqual(['s1', 's2']);
    // 何度か同期すると落ち着く
    for (let i = 0; i < 3; i++) {
      await b.sync();
      await a.sync();
    }
    const counts = [a.uploads, a.downloads, b.uploads, b.downloads];
    await b.sync();
    await a.sync();
    expect([a.uploads, a.downloads, b.uploads, b.downloads]).toEqual(counts);
    expect(drive.files.size).toBe(2);
  });

  it('同時に押しても（どちらも相手を読む前に送っても）、次の同期でそろう', async () => {
    const drive = new Drive();
    const a = new Device(drive, 'aaa');
    const b = new Device(drive, 'bbb');
    a.data.studies = [study('s1', '7g7f 3c3d', 1)];
    b.data.studies = [study('s2', '2g2f 8c8d', 2)];
    // 両方が「一覧は空」を見た状態で送る
    const blank = (d: Device): SyncPort => ({ ...d.port(), list: async () => [] });
    await syncOnce(blank(a));
    await syncOnce(blank(b));
    await a.sync();
    await b.sync();
    expect(a.ids()).toEqual(['s1', 's2']);
    expect(b.ids()).toEqual(['s1', 's2']);
  });

  it('送ったあとで手を指し直しても、前に自分が送った中身で元の手順はよみがえらない', async () => {
    const drive = new Drive();
    const a = new Device(drive, 'aaa');
    a.data.studies = [study('s1', '7g7f 3c3d 2g2f', 1)];
    await a.sync();
    a.data.studies = [{ ...study('s1', '7g7f 3c3d 6g6f', 1), updatedAt: 5, movesAt: 5 }];
    await a.sync();
    expect(a.ids()).toEqual(['s1']);
    expect(a.data.studies[0].moves).toEqual(['7g7f', '3c3d', '6g6f']);
    expect(a.downloads).toBe(0);
  });

  it('同期していない端末の古いファイルは、一度読んだら次は読まない', async () => {
    const drive = new Drive();
    const old = new Device(drive, 'old');
    old.data.studies = [study('s1', '7g7f 3c3d 2g2f', 1)];
    await old.sync();
    const a = new Device(drive, 'aaa');
    await a.sync();
    a.data.studies = [{ ...study('s1', '7g7f 3c3d 6g6f', 1), updatedAt: 5, movesAt: 5 }];
    await a.sync();
    await a.sync();
    expect(a.ids()).toEqual(['s1']);
    expect(a.downloads).toBe(1);
  });

  it('消した研究手順は、ほかの端末でも消える', async () => {
    const drive = new Drive();
    const a = new Device(drive, 'aaa');
    const b = new Device(drive, 'bbb');
    a.data.studies = [study('s1', '7g7f 3c3d', 1, '消す研究'), study('s2', '2g2f 8c8d', 2)];
    await a.sync();
    await b.sync();
    a.data.deleted = [studyDeletion(a.data.studies[0], 100)];
    a.data.studies = a.data.studies.slice(1);
    await a.sync();
    const r = await b.sync();
    expect(b.ids()).toEqual(['s2']);
    expect(r.ok && r.changes.removed).toEqual(['消す研究']);
  });

  it('一覧・読み込みで失敗したら、この端末もドライブも変えない', async () => {
    const drive = new Drive();
    const a = new Device(drive, 'aaa');
    a.data.studies = [study('s1', '7g7f 3c3d', 1)];
    await a.sync();
    for (const fail of ['list', 'download'] as const) {
      const b = new Device(drive, 'bbb');
      b.data.studies = [study('s2', '2g2f 8c8d', 2)];
      b.fail = fail;
      const r = await b.sync();
      expect(r).toMatchObject({ ok: false, changedHere: false });
      expect(b.ids()).toEqual(['s2']);
      expect(b.applied).toBe(0);
      expect(drive.files.size).toBe(1);
      expect(b.state.seen).toEqual({});
    }
  });

  it('ドライブのファイルがおかしければ、何も合わせず、何も送らない', async () => {
    const drive = new Drive();
    drive.put(null, syncFileName('zzz'), '{"app":"joban-tree","kind":"backup","version":99}');
    const a = new Device(drive, 'aaa');
    a.data.studies = [study('s1', '7g7f 3c3d', 1)];
    const r = await a.sync();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('新しい版');
    expect(a.applied).toBe(0);
    expect(a.uploads).toBe(0);
  });

  it('送るのに失敗したら、合わせたことを知らせる。次の同期で送れる', async () => {
    const drive = new Drive();
    const a = new Device(drive, 'aaa');
    const b = new Device(drive, 'bbb');
    a.data.studies = [study('s1', '7g7f 3c3d', 1)];
    await a.sync();
    b.data.studies = [study('s2', '2g2f 8c8d', 2)];
    b.fail = 'upload';
    const r = await b.sync();
    expect(r).toMatchObject({ ok: false, changedHere: true });
    expect(!r.ok && r.message).toContain('送れませんでした');
    b.fail = null;
    await b.sync();
    await a.sync();
    expect(a.ids()).toEqual(['s1', 's2']);
  });

  it('読んだ覚えを消すと（バックアップから戻したあと）、自分のファイルも読んでから送る＝ドライブの中身を黙って消さない', async () => {
    const drive = new Drive();
    const a = new Device(drive, 'aaa');
    a.data.studies = [study('s1', '7g7f 3c3d', 1), study('s2', '2g2f 8c8d', 2)];
    await a.sync();
    a.data.studies = [];
    a.state = { ...a.state, seen: {}, uploadedHash: '' };
    await a.sync();
    expect(a.ids()).toEqual(['s1', 's2']);
  });

  it('3 台がばらばらの順に同期しても、研究手順はそろって消えない', async () => {
    let seed = 7;
    const random = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
    for (let round = 0; round < 60; round++) {
      const drive = new Drive();
      const devices = ['aaa', 'bbb', 'ccc'].map((id) => new Device(drive, id));
      const made: string[] = [];
      for (let step = 0; step < 14; step++) {
        const d = devices[random(3)];
        if (random(2) === 0) {
          const id = `s${made.length}`;
          // 手順は 1 本ずつ違う（同じ手順は 1 本にまとまるので）
          d.data.studies.push(study(id, FIRST_MOVES[made.length], made.length + 1));
          made.push(id);
        } else expect((await d.sync()).ok).toBe(true);
      }
      for (let i = 0; i < 3; i++) for (const d of devices) expect((await d.sync()).ok).toBe(true);
      for (const d of devices) expect(d.ids()).toEqual([...made].sort());
    }
  });
});

describe('同期の流れ：見直しで見つかった道筋', () => {
  it('2 台が同じ研究を持っていても、片方で指し直した手順は 2 本にならない', async () => {
    const drive = new Drive();
    const a = new Device(drive, 'aaa');
    const b = new Device(drive, 'bbb');
    const old = study('s1', '7g7f 3c3d 2g2f', 1);
    a.data.studies = [old];
    await a.sync();
    await b.sync();
    const cut = stampStudy(old, { ...old, moves: ['7g7f', '3c3d'], updatedAt: 20 }, false, 20);
    a.data.studies = [stampStudy(cut, { ...cut, moves: ['7g7f', '3c3d', '6g6f'], updatedAt: 21 }, false, 21)];
    for (let i = 0; i < 2; i++) {
      await a.sync();
      await b.sync();
    }
    for (const d of [a, b]) expect(d.data.studies.map((x) => x.moves.join(' '))).toEqual(['7g7f 3c3d 6g6f']);
  });

  it('この端末のデータが空なら、前に読んだファイル（自分の分も）を読み直す。空でドライブを上書きしない', async () => {
    const drive = new Drive();
    const a = new Device(drive, 'aaa');
    a.data.studies = [study('s1', '7g7f 3c3d', 1)];
    await a.sync();
    a.data = empty();
    await a.sync();
    expect(a.ids()).toEqual(['s1']);
    expect(JSON.parse([...drive.files.values()][0].text).data.studies).toHaveLength(1);
  });
});

describe('読むファイルの選び方・知らせ', () => {
  const file = (id: string, name: string, v: string): RemoteFile => ({ id, name, modifiedTime: v, md5Checksum: v });

  it('このアプリの同期のファイルで、前に読んだときから変わったものだけ', () => {
    const files = [file('1', syncFileName('aaa'), 'x'), file('2', syncFileName('bbb'), 'y'), file('3', 'memo.txt', 'z')];
    expect(filesToRead(files, {}).map((f) => f.id)).toEqual(['1', '2']);
    expect(filesToRead(files, { '1': 'x x', '2': 'old old' }).map((f) => f.id)).toEqual(['2']);
  });

  it('出す文', () => {
    const none = { added: 0, changed: 0, removed: [], shortened: [] };
    const some = { added: 1, changed: 1, removed: ['消える'], shortened: [{ name: '短くなる', from: 3, to: 2 }] };
    expect(syncMessage(some, true)).toBe('同期しました。研究手順：足した 1 本・変わった 1 本・消えた 1 本。消えた研究手順：消える。手が消えた・指し直された研究手順：短くなる（3手 → 2手）。');
    expect(syncMessage(none, false)).toBe('同期しました。この端末のデータは変わりません。');
    expect(syncMessage(none, true)).toBe('同期しました。研究手順のほかのデータを合わせました。');
  });

  it('2 台で別々に登録した同じ手順が 1 本にまとまっても、「消えた」とは出さない', async () => {
    const drive = new Drive();
    const a = new Device(drive, 'aaa');
    const b = new Device(drive, 'bbb');
    a.data.studies = [study('old', '7g7f 3c3d', 1, '同じ研究')];
    b.data.studies = [study('new', '7g7f 3c3d', 2, '同じ研究')];
    await a.sync();
    const r = await b.sync();
    expect(b.ids()).toEqual(['old']);
    expect(r.ok && r.changes.removed).toEqual([]);
    expect(r.ok && r.changes.added).toBe(0);
  });

  it('前の同期から 1 日以上なら知らせる（同期したことが無ければ出さない）', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(shouldSyncNudge(10 * day, null, null)).toBe(false);
    expect(shouldSyncNudge(10 * day, 10 * day - day + 1, null)).toBe(false);
    expect(shouldSyncNudge(10 * day, 9 * day, null)).toBe(true);
    expect(shouldSyncNudge(10 * day, 8 * day, 10 * day + 1)).toBe(false);
  });
});
