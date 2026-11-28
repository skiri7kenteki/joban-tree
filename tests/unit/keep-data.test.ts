// 機能の整理：画面から消した・隠したもの（ツリー・復習の記録・研究手順のメモ・局面メモ・候補の理由・ツリーの設定）が、
// バックアップのファイル（Google ドライブの同期が運ぶものも同じ形）と、合わせる計算で消えないこと
import { describe, expect, it } from 'vitest';
import type { ReviewRecord } from '../../src/review/review';
import { backupToJson, makeBackup, parseBackupJson, type BackupData } from '../../src/tree/backupFile';
import { mergeAll } from '../../src/tree/merge';
import type { PositionNote } from '../../src/tree/positions';
import type { Study } from '../../src/tree/types';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../../src/shogi/position';
import { lineTree } from './tree-fixture';

const study: Study = { id: 's-1', name: '研究', note: '研究手順のメモ', moves: ['7g7f', '3c3d'], mySide: 'white', createdAt: 1, updatedAt: 2 };
const key = sfenKey(applyUsiMove(STARTPOS_SFEN, '7g7f')!.sfen);
const position: PositionNote = { id: `white|${key}`, side: 'white', key, note: '局面メモ', candidates: [{ move: '3c3d', mark: 'main', reason: '候補の理由', at: 3 }], noteAt: 3, updatedAt: 3 };
const tree = lineTree([], ['7g7f', '3c3d'], 'white', 'tree-1');
const review: ReviewRecord = { treeId: 'tree-1', version: 1, nodes: { [key]: { seen: 1, correct: 1, streak: 1, lastOk: true, lastAt: 4 } } };

const empty = (): BackupData => ({ studies: [], trees: [], reviews: [], templates: [], games: [], practice: [], positions: [], deleted: [], prefs: {} });
const full = (): BackupData => ({ ...empty(), studies: [study], trees: [tree], reviews: [review], positions: [position] });

/** ファイルにして読み直す */
function roundTrip(data: BackupData): BackupData {
  const parsed = parseBackupJson(backupToJson(makeBackup(data, 10, '0.0.0')));
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.file.data;
}

const kept = (d: BackupData) => ({ studies: d.studies, trees: d.trees, reviews: d.reviews, positions: d.positions });

describe('画面に無いデータが消えない', () => {
  it('バックアップのファイルにして読み直しても同じ', () => {
    expect(kept(roundTrip(full()))).toEqual(kept(full()));
  });

  it('同期で合わせる計算：空の端末に取り込んでも、持っている端末に空の端末を合わせても、同じものが残る', () => {
    expect(kept(roundTrip(mergeAll(empty(), [roundTrip(full())]).data))).toEqual(kept(full()));
    expect(kept(mergeAll(full(), [empty()]).data)).toEqual(kept(full()));
  });
});
