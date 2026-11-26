// 段階25-2：取り込みの取り消し・研究手順をまとめて消す
import { describe, expect, it } from 'vitest';
import { planImportUndo } from '../../src/tree/bulkDelete';
import { deletionHits, removalRecords } from '../../src/tree/deleted';
import type { Study } from '../../src/tree/types';

const study = (id: string, moves: string, templateId?: string, mySide: 'black' | 'white' = 'black'): Study => ({
  id,
  name: id,
  note: '',
  moves: moves.split(' '),
  mySide,
  ...(templateId ? { templateId } : {}),
  createdAt: 1,
  updatedAt: 1,
});

describe('取り込みの取り消し', () => {
  const old = study('old', '7g7f 3c3d');
  const a = study('a', '7g7f 8c8d', 'new');
  const b = study('b', '7g7f 8c8d 2g2f', 'new');

  it('その取り込みで足した研究手順だけを消す。前からあったものは消さない', () => {
    const plan = planImportUndo({ studyIds: ['a', 'b'] }, [old, a, b]);
    expect(plan.remove.map((s) => s.id)).toEqual(['a', 'b']);
    expect(plan.dropTemplate).toBe(false);
  });

  it('すでに無いものは数えない', () => {
    expect(planImportUndo({ studyIds: ['a', 'b'] }, [old, b]).remove.map((s) => s.id)).toEqual(['b']);
  });

  it('一緒に作った戦型も消す。残る研究手順が記録していれば残す。前からあった戦型は消さない', () => {
    expect(planImportUndo({ studyIds: ['a', 'b'], templateId: 'new' }, [old, a, b]).dropTemplate).toBe(true);
    const other = study('x', '7g7f 8c8d 6g6f', 'new');
    expect(planImportUndo({ studyIds: ['a', 'b'], templateId: 'new' }, [old, a, b, other]).dropTemplate).toBe(false);
    // 戦型を作っていない取り込み（templateId を覚えていない）
    expect(planImportUndo({ studyIds: ['a'] }, [old, a]).dropTemplate).toBe(false);
  });
});

describe('まとめて消したときの消した記録', () => {
  const a = study('a', '7g7f 3c3d');
  const b = study('b', '2g2f 8c8d', undefined, 'white');
  const c = study('c', '7g7f 8c8d');
  const map = (...list: Study[]) => new Map(list.map((s) => [s.id, s]));

  it('1 本ずつ、手順と自分の側を残す', () => {
    const records = removalRecords(map(a, b, c), map(c), ['a', 'b'], 10);
    expect(records).toEqual([
      { kind: 'study', id: 'a', at: 10, moves: a.moves, side: 'black' },
      { kind: 'study', id: 'b', at: 10, moves: b.moves, side: 'white' },
    ]);
  });

  it('同じ手順の別の研究手順が残るなら、id が同じものだけに効かせる', () => {
    const twin = { ...a, id: 'a2' };
    expect(removalRecords(map(a, twin), map(twin), ['a'], 10)[0].onlyId).toBe(true);
  });

  it('取り込みの取り消しは、全部 id が同じものだけに効かせる（ほかの端末の同じ手順は消えない）', () => {
    const [record] = removalRecords(map(a), map(), ['a'], 10, true);
    expect(record.onlyId).toBe(true);
    expect(deletionHits(record, a)).toBe(true);
    expect(deletionHits(record, { ...a, id: 'on-ipad' })).toBe(false);
  });

  it('保存場所に無いもの・保存し直すものは記録しない', () => {
    expect(removalRecords(map(a), map(a), ['a', 'zzz'], 10)).toEqual([]);
  });
});
