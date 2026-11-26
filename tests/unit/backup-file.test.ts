// 段階17：まとめてのバックアップのファイル（作る → 文字列 → 読む で元どおり・おかしいファイルは断る・すすめを出す時機）
import { describe, expect, it } from 'vitest';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../../src/shogi/position';
import {
  BACKUP_VERSION,
  backupCounts,
  backupFileName,
  backupToJson,
  makeBackup,
  nudgeHiddenUntil,
  parseBackupJson,
  shouldNudge,
  type BackupData,
} from '../../src/tree/backupFile';
import { TREE_APP, TREE_FORMAT_VERSION, type Study, type TreeData, type TreeNode } from '../../src/tree/types';

const DAY = 24 * 60 * 60 * 1000;

function tree(id: string): TreeData {
  const sfen = applyUsiMove(STARTPOS_SFEN, '7g7f')!.sfen;
  const nodes: Record<string, TreeNode> = {};
  const add = (s: string) => (nodes[sfenKey(s)] ??= { key: sfenKey(s), sfen: s, round: 0, edges: [] } as TreeNode);
  const root = add(sfen);
  const next = add(applyUsiMove(sfen, '3c3d')!.sfen);
  root.edges.push({ move: '3c3d', to: next.key, score: { kind: 'cp', value: 40 }, diff: 0 } as never);
  return {
    app: TREE_APP,
    version: TREE_FORMAT_VERSION,
    id,
    name: 'ツリー',
    createdAt: 1,
    updatedAt: 2,
    mySide: 'black',
    rootKey: root.key,
    prefix: { initialSfen: STARTPOS_SFEN, moves: ['7g7f'] },
    nodes,
    settings: { totalMs: 1, movetimeMs: 1, multiPV: 1, maxRounds: 1, maxNodes: 1, windowCp: 300 },
  } as TreeData;
}

const study = (id: string, moves: string, createdAt = 1): Study => ({
  id,
  name: `研究 ${id}`,
  note: 'メモ',
  moves: moves.split(' '),
  mySide: 'black',
  createdAt,
  updatedAt: createdAt,
});

function sample(): BackupData {
  return {
    studies: [study('s-1', '7g7f 3c3d 2g2f'), study('s-2', '2g2f 8c8d')],
    trees: [tree('t-1')],
    reviews: [
      { treeId: 't-1', version: 1, nodes: { a: { seen: 2, correct: 1, streak: 1, lastOk: true, lastAt: 5 } } },
      { treeId: 'studies', version: 1, nodes: { 'b>2g2f': { seen: 1, correct: 0, streak: 0, lastOk: false, lastAt: 6 }, c: { seen: 1, correct: 1, streak: 1, lastOk: true, lastAt: 7 } } },
    ],
    templates: [
      { id: 'my-1', name: '自分の戦型', group: '横歩取り', mySide: 'white', moves: ['7g7f', '3c3d'], note: '', reviewed: true, createdAt: 3, updatedAt: 4 },
    ],
    games: [
      { id: 'g-1', kifu: '1 ７六歩(77)', moves: ['7g7f'], black: { name: 'a', rank: '七段' }, white: { name: 'b' }, playedAt: 8, timeLimit: '3分切れ負け', mySide: 'white', winner: 'black', ending: '投了', addedAt: 9 },
    ],
    practice: [{ studyId: 's-1', step: 2, dueAt: 10, lastAt: 5, firstAt: 1, lastMistakes: 0, count: 3 }],
    positions: [
      { id: 'white|k1', side: 'white', key: 'k1', note: '局面のメモ', updatedAt: 11 },
      { id: 'black|k2', side: 'black', key: 'k2', note: '', okMoves: ['2g2f', '7g7f'], updatedAt: 12 },
      {
        id: 'black|k3',
        side: 'black',
        key: 'k3',
        note: '',
        candidates: [
          { move: '2g2f', mark: 'main', eval: { kind: 'cp', value: 40 }, by: { engine: 'e', ms: 3000, at: 13 }, pv: ['8c8d'], reason: '理由' },
          { move: 'P*5e', mark: 'bad', eval: { kind: 'mate', plies: -5 } },
        ],
        updatedAt: 13,
      },
    ],
    deleted: [{ kind: 'game', id: 'g-0', at: 14 }],
    prefs: { 'joban-tree.settings': '{"version":1}', 'joban-tree:book-write': 'off' },
  };
}

describe('バックアップのファイル', () => {
  it('作る → 文字列 → 読む で、研究手順・ツリー・復習の記録・戦型・設定が元どおり', () => {
    const data = sample();
    const file = makeBackup(data, 1700000000000, '0.41.0');
    const parsed = parseBackupJson(backupToJson(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.file).toEqual(file);
    expect(parsed.unknownKinds).toEqual([]);
    expect(file).toMatchObject({ app: 'joban-tree', kind: 'backup', version: 1, createdAt: 1700000000000, appVersion: '0.41.0' });
    expect(backupCounts(parsed.file.data)).toEqual({ studies: 2, trees: 1, reviewProblems: 3, templates: 1, games: 1, practice: 1, positions: 1, tables: 1, prefs: 2 });
  });

  it('空のデータも作って読める', () => {
    const empty: BackupData = { studies: [], trees: [], reviews: [], templates: [], games: [], practice: [], positions: [], deleted: [], prefs: {} };
    const parsed = parseBackupJson(backupToJson(makeBackup(empty, 1, '0.41.0')));
    expect(parsed.ok && parsed.file.data).toEqual(empty);
  });

  it('この版が知らない種類（あとの段階の局面メモなど）は読まずに知らせる。知らない設定の名前は入れない', () => {
    const file = makeBackup(sample(), 1, '0.44.0') as unknown as { data: Record<string, unknown> };
    file.data.notes = [{ id: 'n-1' }];
    (file.data.prefs as Record<string, string>)['joban-tree.unknown'] = 'x';
    const parsed = parseBackupJson(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.unknownKinds).toEqual(['notes']);
    expect('notes' in parsed.file.data).toBe(false);
    expect(Object.keys(parsed.file.data.prefs).sort()).toEqual(['joban-tree.settings', 'joban-tree:book-write']);
  });

  it('おかしいファイルは断る（JSON でない・別のファイル・新しい版・壊れた中身・同じ id）', () => {
    const fileOf = (patch: (f: Record<string, any>) => void) => {
      const f = JSON.parse(backupToJson(makeBackup(sample(), 1, '0.41.0')));
      patch(f);
      return parseBackupJson(JSON.stringify(f));
    };
    const msg = (r: ReturnType<typeof parseBackupJson>) => (r.ok ? '' : r.message);
    expect(msg(parseBackupJson('{'))).toContain('JSON として読めません');
    expect(msg(fileOf((f) => (f.kind = 'studies')))).toContain('バックアップのファイルではありません');
    expect(msg(fileOf((f) => (f.version = BACKUP_VERSION + 1)))).toContain('新しい版のアプリで作った');
    expect(msg(fileOf((f) => (f.data.studies[0].moves = ['7g7f', '7g7f'])))).toContain('研究手順 1 本目');
    expect(msg(fileOf((f) => (f.data.trees[0].rootKey = 'none')))).toContain('ツリー 1 本目');
    expect(msg(fileOf((f) => (f.data.reviews[1].nodes.c.seen = 'x')))).toContain('復習の記録 2 つ目');
    expect(msg(fileOf((f) => delete f.data.templates[0].createdAt))).toContain('戦型 1 つ目');
    expect(msg(fileOf((f) => (f.data.games[0].mySide = 'x')))).toContain('実戦 1 局目');
    expect(msg(fileOf((f) => (f.data.practice[0].step = -1)))).toContain('稽古の記録 1 つ目');
    expect(msg(fileOf((f) => (f.data.positions[1].id = 'white|k2')))).toContain('局面メモ 2 つ目');
    expect(msg(fileOf((f) => (f.data.positions[0].note = 'x'.repeat(3001))))).toContain('局面メモ 1 つ目');
    expect(msg(fileOf((f) => (f.data.prefs['joban-tree.settings'] = 3)))).toContain('設定');
    expect(msg(fileOf((f) => f.data.studies.push({ ...f.data.studies[0] })))).toContain('同じ id');
  });

  it('ファイル名は日付と時刻（同じ日に何度保存しても分かる）', () => {
    expect(backupFileName(new Date(2026, 10, 23, 13, 5))).toBe('将棋定跡帳-バックアップ-2026-11-23-1305.json');
  });
});

describe('「しばらくバックアップしていません」を出す時機', () => {
  const now = 100 * DAY;
  it('研究手順が無ければ出さない', () => {
    expect(shouldNudge(now, [], null, null)).toBe(false);
  });
  it('最後のバックアップから 30 日以上で出す（まだなら、いちばん古い研究手順から数える）', () => {
    expect(shouldNudge(now, [{ createdAt: now - 31 * DAY }], now - 29 * DAY, null)).toBe(false);
    expect(shouldNudge(now, [{ createdAt: now - 31 * DAY }], now - 30 * DAY, null)).toBe(true);
    expect(shouldNudge(now, [{ createdAt: now - 10 * DAY }, { createdAt: now - 40 * DAY }], null, null)).toBe(true);
    expect(shouldNudge(now, [{ createdAt: now - 10 * DAY }], null, null)).toBe(false);
  });
  it('閉じたら 30 日は出さない', () => {
    const hidden = nudgeHiddenUntil(now);
    expect(shouldNudge(now + 29 * DAY, [{ createdAt: 0 }], null, hidden)).toBe(false);
    expect(shouldNudge(now + 30 * DAY, [{ createdAt: 0 }], null, hidden)).toBe(true);
  });
});

describe('段階21-1：候補の表', () => {
  it('形のおかしい候補の表があれば、全体を読まない', () => {
    const f = JSON.parse(backupToJson(makeBackup(sample(), 1, '0.47.0')));
    f.data.positions[2].candidates[1].mark = 'best';
    const parsed = parseBackupJson(JSON.stringify(f));
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.message).toContain('候補の表の印');
  });
});

describe('段階17 の版のバックアップ（実戦の棋譜・稽古の記録が無い）', () => {
  it('実戦・稽古の記録は空として読む', () => {
    const f = JSON.parse(backupToJson(makeBackup(sample(), 1, '0.41.0')));
    delete f.data.games;
    delete f.data.practice;
    delete f.data.positions;
    const parsed = parseBackupJson(JSON.stringify(f));
    expect(parsed.ok && parsed.file.data.games).toEqual([]);
    expect(parsed.ok && parsed.file.data.practice).toEqual([]);
    expect(parsed.ok && parsed.file.data.positions).toEqual([]);
    expect(parsed.ok && parsed.unknownKinds).toEqual([]);
  });
});
