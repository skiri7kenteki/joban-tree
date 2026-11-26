// 段階22-2：ほかの端末のバックアップと合わせる計算と、保存するときに付ける印（持ち主の判断 2026-11-26「全部おすすめの通りで」）
import { describe, expect, it } from 'vitest';
import type { Game } from '../../src/games/game';
import type { PracticeRecord } from '../../src/practice/practice';
import type { ReviewRecord } from '../../src/review/review';
import { backupToJson, makeBackup, parseBackupJson, type BackupData } from '../../src/tree/backupFile';
import type { Candidate } from '../../src/tree/candidates';
import { reviveForRestore, stampPosition, stampStudy, studyDeletion, type DeletedRecord } from '../../src/tree/deleted';
import { changesNothing, mergeAll, mergeBackups } from '../../src/tree/merge';
import type { PositionNote } from '../../src/tree/positions';
import type { Study, TreeData } from '../../src/tree/types';

const study = (id: string, moves: string, patch: Partial<Study> = {}): Study => ({
  id,
  name: id,
  note: '',
  moves: moves.split(' '),
  mySide: 'black',
  createdAt: 10,
  updatedAt: 10,
  ...patch,
});
const data = (patch: Partial<BackupData> = {}): BackupData => ({
  studies: [],
  trees: [],
  reviews: [],
  templates: [],
  games: [],
  practice: [],
  positions: [],
  deleted: [],
  prefs: {},
  ...patch,
});
const practice = (studyId: string, lastAt: number): PracticeRecord => ({ studyId, step: 1, dueAt: lastAt + 1, lastAt, firstAt: lastAt, lastMistakes: 0, count: 1 });
const shape = (list: readonly Study[]) => list.map((s) => [s.id, s.name, s.moves.join(' ')]).sort((a, b) => a[0].localeCompare(b[0]));
/** どちらの端末で合わせても同じになる */
const both = (a: BackupData, b: BackupData) => {
  const ab = mergeBackups(a, b);
  const ba = mergeBackups(b, a);
  expect(shape(ba.data.studies)).toEqual(shape(ab.data.studies));
  return ab;
};

const BASE = '7g7f 3c3d';

describe('研究手順', () => {
  it('無いものは足す。もう一度合わせても増えない', () => {
    const a = data({ studies: [study('s-1', `${BASE} 2g2f`)] });
    const b = data({ studies: [study('s-2', `${BASE} 6g6f`)] });
    const m = both(a, b);
    expect(shape(m.data.studies).map((x) => x[0])).toEqual(['s-1', 's-2']);
    expect(m.summary.studies).toEqual({ added: 1, updated: 0, removed: 0 });
    expect(mergeBackups(m.data, b).data.studies).toHaveLength(2);
    expect(mergeBackups(m.data, b).summary.studies).toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it('手順と自分の側が同じで id が違うものは 1 本。作った日が古い方の id を残し、稽古の記録を付け替える', () => {
    const a = data({ studies: [study('s-new', BASE, { createdAt: 20, updatedAt: 30, name: '新しい名前' })], practice: [practice('s-new', 100)] });
    const b = data({ studies: [study('s-old', BASE, { createdAt: 5, updatedAt: 8, name: '古い名前' })], practice: [practice('s-old', 50)] });
    const m = both(a, b);
    expect(shape(m.data.studies)).toEqual([['s-old', '新しい名前', BASE]]);
    expect(m.data.studies[0].createdAt).toBe(5);
    expect(m.data.practice.map((p) => [p.studyId, p.lastAt, p.firstAt])).toEqual([['s-old', 100, 50]]);
  });

  it('自分の側が違えば別の研究手順', () => {
    const m = both(data({ studies: [study('s-1', BASE)] }), data({ studies: [study('s-2', BASE, { mySide: 'white' })] }));
    expect(m.data.studies).toHaveLength(2);
  });

  it('片方で手を延ばし、もう片方で後から名前を直した：延ばした手順と新しい名前の 1 本', () => {
    const old = study('s-1', BASE);
    const extended = stampStudy(old, { ...old, moves: [...old.moves, '2g2f'], updatedAt: 20 }, false, 20);
    const renamed = stampStudy(old, { ...old, name: '直した名前', updatedAt: 30 }, false, 30);
    const m = both(data({ studies: [extended] }), data({ studies: [renamed] }));
    expect(shape(m.data.studies)).toEqual([['s-1', '直した名前', `${BASE} 2g2f`]]);
  });

  it('後で短くした（この手から先を消した）方が残る', () => {
    const long = study('s-1', `${BASE} 2g2f`, { updatedAt: 20 });
    const cut = stampStudy(long, { ...long, moves: long.moves.slice(0, 2), updatedAt: 40 }, false, 40);
    const m = both(data({ studies: [long] }), data({ studies: [cut] }));
    expect(shape(m.data.studies)).toEqual([['s-1', 's-1', BASE]]);
  });

  it('同じ id が別々に枝分かれしていたら両方残す。稽古の記録は手順の方へ付いていき、くり返し合わせても増えない', () => {
    const a = data({ studies: [study('s-1', `${BASE} 2g2f`, { updatedAt: 20 })], practice: [practice('s-1', 100)] });
    const b = data({ studies: [study('s-1', `${BASE} 6g6f`, { updatedAt: 30 })], practice: [practice('s-1', 200)] });
    const m = both(a, b);
    expect(m.data.studies).toHaveLength(2);
    expect(m.split).toBe(1);
    const idOf = (list: Study[], move: string) => list.find((s) => s.moves[2] === move)!.id;
    expect(m.data.practice.find((p) => p.studyId === idOf(m.data.studies, '2g2f'))!.lastAt).toBe(100);
    expect(m.data.practice.find((p) => p.studyId === idOf(m.data.studies, '6g6f'))!.lastAt).toBe(200);
    // まだ合わせていない端末で、分かれた片方がさらに延びていても 2 本のまま
    const longer = data({ studies: [study('s-1', `${BASE} 6g6f 8c8d`, { updatedAt: 50, movesAt: 50 })] });
    const again = both(m.data, longer);
    expect(again.data.studies.map((s) => s.moves.join(' ')).sort()).toEqual([`${BASE} 2g2f`, `${BASE} 6g6f 8c8d`]);
    expect(again.data.studies.map((s) => s.id).sort()).toEqual(m.data.studies.map((s) => s.id).sort());
  });
});

describe('研究が消えないこと（見直しで見つかった道筋）', () => {
  const lines = (list: readonly Study[]) => list.map((s) => s.moves.join(' ')).sort();

  it('枝分かれの新しい id が、同じ端末の別の研究手順とぶつかっても、どれも消えない', () => {
    const first = mergeBackups(data({ studies: [study('s-1', `${BASE} 2g2f`)] }), data({ studies: [study('s-1', `${BASE} 6g6f 8c8d`)] }));
    const loser = first.data.studies.find((s) => s.id !== 's-1')!;
    // この端末は s-1 を消して、分かれた方だけある。そこへ「s-1 の同じ分かれ方で、先が違う」古い版が 2 回来る
    const here = data({ studies: [loser] });
    const withOther = mergeBackups(here, data({ studies: [study('s-1', `${BASE} 6g6f 4a3b`)] })).data;
    const m = mergeBackups(withOther, data({ studies: [study('s-1', `${BASE} 2g2f`)] }));
    expect(lines(m.data.studies)).toEqual([`${BASE} 2g2f`, `${BASE} 6g6f 4a3b`, `${BASE} 6g6f 8c8d`]);
    expect(new Set(m.data.studies.map((s) => s.id)).size).toBe(3);
  });

  it('この端末で「両方残す」にした同じ手順の 2 本は、1 本にしない（どちらで合わせても）', () => {
    const two = data({ studies: [study('s-1', BASE, { name: '一つ目', note: 'メモ1' }), study('s-2', BASE, { name: '二つ目', note: 'メモ2', createdAt: 11 })] });
    expect(both(two, data()).data.studies.map((s) => s.note).sort()).toEqual(['メモ1', 'メモ2']);
    // 相手の版の方が前に直したもの（名前は後で直した方が残る決まり）
    const m = both(two, data({ studies: [study('s-3', BASE, { createdAt: 12, updatedAt: 5 })] }));
    expect(m.data.studies.map((s) => s.name).sort()).toEqual(['一つ目', '二つ目']);
  });

  it('別々に作った同じ手順を 1 本にするとき、メモはどちらも残す（空のメモで消さない）。もう一度合わせても増えない', () => {
    const a = data({ studies: [study('s-a', BASE, { note: '長いメモ', createdAt: 1, updatedAt: 1 })] });
    const emptyNewer = data({ studies: [study('s-b', BASE, { createdAt: 2, updatedAt: 99 })] });
    expect(both(a, emptyNewer).data.studies[0].note).toBe('長いメモ');
    const other = data({ studies: [study('s-b', BASE, { note: '別のメモ', createdAt: 2, updatedAt: 99 })] });
    const m = both(a, other);
    expect(m.data.studies[0].note).toBe('長いメモ\n――\n別のメモ');
    expect(mergeBackups(m.data, other).data.studies[0].note).toBe('長いメモ\n――\n別のメモ');
  });

  it('重複の片方を消しても、残した方は次に合わせても消えない', () => {
    const kept = study('s-1', BASE);
    const m = both(data({ studies: [kept], deleted: [{ ...studyDeletion(study('s-2', BASE), 50), onlyId: true }] }), data({ studies: [kept] }));
    expect(m.data.studies).toHaveLength(1);
  });

  it('長く延ばした後に、もう片方で少しだけ足した（消してはいない）：長い方が残る', () => {
    const base = study('s-1', BASE);
    const long = stampStudy(base, { ...base, moves: `${BASE} 2g2f 8c8d 2f2e`.split(' '), updatedAt: 20 }, false, 20);
    const short = stampStudy(base, { ...base, moves: `${BASE} 2g2f`.split(' '), updatedAt: 30 }, false, 30);
    expect(lines(both(data({ studies: [long] }), data({ studies: [short] })).data.studies)).toEqual([`${BASE} 2g2f 8c8d 2f2e`]);
  });

  it('前の版のデータ（手を変えた日時が無い）で、短い版の名前だけ後で直した：長い方の手が残る', () => {
    const long = study('s-1', `${BASE} 2g2f 8c8d`, { updatedAt: 20 });
    const renamed = study('s-1', BASE, { name: '直した名前', updatedAt: 30 });
    const m = both(data({ studies: [long] }), data({ studies: [renamed] }));
    expect(shape(m.data.studies)).toEqual([['s-1', '直した名前', `${BASE} 2g2f 8c8d`]]);
  });

  it('消してから少し足した短い版は勝つ。短くなる研究手順は名前と手数を出す', () => {
    const long = study('s-1', `${BASE} 2g2f 8c8d 2f2e`, { updatedAt: 20 });
    const cut = stampStudy(long, { ...long, moves: BASE.split(' '), updatedAt: 40 }, false, 40);
    const grown = stampStudy(cut, { ...cut, moves: `${BASE} 2g2f`.split(' '), updatedAt: 50 }, false, 50);
    const m = mergeBackups(data({ studies: [long] }), data({ studies: [grown] }));
    expect(lines(m.data.studies)).toEqual([`${BASE} 2g2f`]);
    expect(m.shortened).toEqual([{ name: 's-1', from: 5, to: 3 }]);
  });

  /** 保存するときと同じように印を付けて直す */
  const edit = (prev: Study, patch: Partial<Study>, at: number) => stampStudy(prev, { ...prev, updatedAt: at, ...patch }, false, at);

  it('1 手試して取り消しても、まだ見ていない相手の長い手順は消えない', () => {
    const base = study('s-1', BASE);
    const long = edit(base, { moves: `${BASE} 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b`.split(' ') }, 20);
    const tried = edit(base, { moves: `${BASE} 2g2f`.split(' ') }, 30);
    const undone = stampStudy(tried, base, false, 40);
    expect(lines(both(data({ studies: [undone] }), data({ studies: [long] })).data.studies)).toEqual([long.moves.join(' ')]);
  });

  it('消した後にさらに短くしても、消すときに見ていた手は消える。見ていない手があれば残る', () => {
    const seen = study('s-1', `${BASE} 2g2f 8c8d 2f2e`);
    const cutTwice = edit(edit(seen, { moves: `${BASE} 2g2f`.split(' ') }, 30), { moves: BASE.split(' ') }, 40);
    expect(lines(both(data({ studies: [cutTwice] }), data({ studies: [seen] })).data.studies)).toEqual([BASE]);
    const unseen = study('s-1', `${BASE} 2g2f 8c8d 2f2e 8d8e`, { updatedAt: 20, movesAt: 20 });
    expect(lines(both(data({ studies: [cutTwice] }), data({ studies: [unseen] })).data.studies)).toEqual([unseen.moves.join(' ')]);
  });

  it('まとめた両方のメモは、相手が古いメモのまま手を延ばしても消えない。メモを直せばその内容になる', () => {
    for (const [t1, t2] of [
      [10, 20],
      [20, 10],
    ]) {
      const one = study('s-1', BASE, { note: 'm1', createdAt: 1, updatedAt: t1 });
      const two = study('s-2', BASE, { note: 'm2', createdAt: 2, updatedAt: t2 });
      const merged = mergeBackups(data({ studies: [one] }), data({ studies: [two] })).data;
      const grown = edit(one, { moves: `${BASE} 2g2f`.split(' ') }, 50);
      const m = both(merged, data({ studies: [grown] }));
      expect(m.data.studies[0].note).toBe('m1\n――\nm2');
      const rewritten = edit(m.data.studies[0], { note: '書き直した' }, 90);
      expect(both(data({ studies: [rewritten] }), merged).data.studies[0].note).toBe('書き直した');
    }
  });

  it('同じメモは重ねない', () => {
    const a = data({ studies: [study('s-1', BASE, { note: 'm1\n――\nm2', createdAt: 1 })] });
    const b = data({ studies: [study('s-2', BASE, { note: 'm2\n――\nm3', createdAt: 2 })] });
    expect(both(a, b).data.studies[0].note).toBe('m1\n――\nm2\n――\nm3');
  });

  it('重複のうち、残る id になる方を消しても、残した 1 本は消えない（消した方の古い版と合わせる）', () => {
    const old = study('s-old', BASE, { createdAt: 1 });
    const kept = study('s-new', BASE, { createdAt: 2, note: '残す' });
    const here = data({ studies: [kept], deleted: [{ ...studyDeletion(old, 50), onlyId: true }] });
    const m = both(here, data({ studies: [old] }));
    expect(m.data.studies.map((s) => [s.id, s.note])).toEqual([['s-new', '残す']]);
    expect(mergeBackups(m.data, data({ studies: [old] })).data.studies).toHaveLength(1);
  });

  it('重複を知らない端末で 1 本を消しても、こちらの「両方残す」の 2 本は、同じ id のもの以外消えない', () => {
    const two = data({ studies: [study('s-1', BASE, { note: 'メモ1' }), study('s-2', BASE, { note: 'メモ2' })] });
    const gone = data({ deleted: [studyDeletion(study('s-9', BASE), 50)] });
    expect(both(two, gone).data.studies).toHaveLength(2);
  });

  it('枝分かれの新しい id が、同じ端末の続きの研究手順に使われていても、メモは消えない', () => {
    const first = mergeBackups(data({ studies: [study('s-1', `${BASE} 2g2f`)] }), data({ studies: [study('s-1', `${BASE} 6g6f`)] }));
    const branchId = first.data.studies.find((s) => s.id !== 's-1')!.id;
    const here = data({ studies: [study('s-1', `${BASE} 6g6f`, { note: '元のメモ' }), study(branchId, `${BASE} 6g6f 8c8d`, { note: '分かれた方のメモ' })] });
    const m = both(here, data({ studies: [study('s-1', `${BASE} 2g2f`)] }));
    expect(m.data.studies.map((s) => s.note).filter(Boolean).sort()).toEqual(['元のメモ', '分かれた方のメモ'].sort());
    expect(new Set(m.data.studies.map((s) => s.id)).size).toBe(m.data.studies.length);
  });

  it('ツリーの名前を直しても、相手で生成を進めた中身は消えない', () => {
    const tree = (name: string, updatedAt: number, nodes: number, renamedAt?: number) =>
      ({ id: 't', name, updatedAt, nodes: Object.fromEntries(Array.from({ length: nodes }, (_, i) => [`n${i}`, {}])), ...(renamedAt ? { renamedAt } : {}) }) as unknown as TreeData;
    const renamed = data({ trees: [tree('新しい名前', 10, 1, 30)] });
    const grown = data({ trees: [tree('前の名前', 20, 5)] });
    for (const m of [mergeBackups(renamed, grown), mergeBackups(grown, renamed)]) {
      expect(m.data.trees[0].name).toBe('新しい名前');
      expect(Object.keys(m.data.trees[0].nodes)).toHaveLength(5);
    }
  });

  it('何も変わらない合わせかどうかが分かる', () => {
    const a = data({ studies: [study('s-1', BASE)] });
    expect(changesNothing(mergeBackups(a, a))).toBe(true);
    expect(changesNothing(mergeBackups(a, data({ studies: [study('s-2', `${BASE} 2g2f`)] })))).toBe(false);
  });
});

describe('ランダムな操作をくり返しても、そろって、消えない', () => {
  /** 同じ並びになる乱数（失敗を再現できるように） */
  const random = (seed: number) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const norm = (list: readonly Study[]) => list.map((s) => `${s.id}|${s.moves.join(' ')}|${s.note}`).sort();
  const isHead = (a: string[], b: string[]) => a.length <= b.length && a.every((m, i) => b[i] === m);

  it('研究手順を作る・延ばす・名前を直すだけなら、どの手順もメモも残る（2 台・300 通り）', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = random(seed);
      const pick = (n: number) => Math.floor(rnd() * n);
      const devices = [data(), data()];
      const lines: string[][] = [];
      const memos: string[] = [];
      let time = 100;
      for (let step = 0; step < 14; step++) {
        time += 10;
        const at = pick(2);
        const d = devices[at];
        const kind = pick(6);
        if (kind <= 1 || d.studies.length === 0) {
          const moves = Array.from({ length: 1 + pick(3) }, () => `m${pick(2)}`);
          // 1 台の中で同じ手順は 1 本（盤で指したときと同じ）
          if (d.studies.some((s) => s.moves.join() === moves.join())) continue;
          const note = pick(2) === 0 ? `<${seed}-${step}>` : '';
          if (note) memos.push(note);
          lines.push(moves);
          d.studies = [...d.studies, study(`s-${seed}-${step}`, moves.join(' '), { note, createdAt: time, updatedAt: time })];
        } else if (kind === 5) {
          devices[at] = mergeBackups(d, devices[1 - at]).data;
        } else {
          const i = pick(d.studies.length);
          const prev = d.studies[i];
          const next = kind === 4 ? { ...prev, name: `n${step}`, updatedAt: time } : { ...prev, moves: [...prev.moves, `m${pick(2)}`], updatedAt: time };
          lines.push(next.moves);
          d.studies = d.studies.map((s, j) => (j === i ? stampStudy(prev, next, false, time) : s));
        }
      }
      const [a, b] = devices;
      const ab = mergeBackups(a, b).data;
      const ba = mergeBackups(b, a).data;
      expect(norm(ba.studies), `seed ${seed} 向き`).toEqual(norm(ab.studies));
      expect(norm(mergeBackups(ab, b).data.studies), `seed ${seed} 2 回目`).toEqual(norm(ab.studies));
      expect(norm(mergeBackups(ab, a).data.studies), `seed ${seed} 2 回目`).toEqual(norm(ab.studies));
      expect(new Set(ab.studies.map((s) => s.id)).size, `seed ${seed} id`).toBe(ab.studies.length);
      for (const line of lines) expect(ab.studies.some((s) => isHead(line, s.moves)), `seed ${seed} 手順 ${line.join(' ')}`).toBe(true);
      for (const memo of memos) expect(ab.studies.some((s) => s.note.includes(memo)), `seed ${seed} メモ ${memo}`).toBe(true);
    }
  });
});

describe('消したことを運ぶ', () => {
  const s = study('s-1', BASE, { updatedAt: 10 });

  it('消した日時の方が新しければ消す。確認の窓に名前を出す', () => {
    const m = both(data({ studies: [s] }), data({ deleted: [studyDeletion(s, 20)] }));
    expect(m.data.studies).toEqual([]);
    const fromHere = mergeBackups(data({ studies: [s] }), data({ deleted: [studyDeletion(s, 20)] }));
    expect(fromHere.summary.studies.removed).toBe(1);
    expect(fromHere.removedStudies).toEqual(['s-1']);
    expect(fromHere.data.deleted).toHaveLength(1);
  });

  it('消した後に直していれば残す', () => {
    const edited = { ...s, name: '後で直した', updatedAt: 30 };
    expect(both(data({ studies: [edited] }), data({ deleted: [studyDeletion(s, 20)] })).data.studies).toHaveLength(1);
  });

  it('消した版に無い手が足されていれば残す（見ていない手は消さない）', () => {
    const more = study('s-1', `${BASE} 2g2f`, { updatedAt: 15 });
    expect(both(data({ studies: [more] }), data({ deleted: [studyDeletion(s, 20)] })).data.studies).toHaveLength(1);
  });

  it('消した版の途中までのもの（古い版）は消す', () => {
    const gone = studyDeletion(study('s-1', `${BASE} 2g2f`), 20);
    expect(both(data({ studies: [s] }), data({ deleted: [gone] })).data.studies).toEqual([]);
  });

  it('id が違っても、手順と自分の側がまったく同じなら消す。短いだけのものは消さない', () => {
    const other = study('s-9', BASE);
    expect(both(data({ studies: [other] }), data({ deleted: [studyDeletion(s, 20)] })).data.studies).toEqual([]);
    const gone = studyDeletion(study('s-1', `${BASE} 2g2f`), 20);
    expect(both(data({ studies: [other] }), data({ deleted: [gone] })).data.studies).toHaveLength(1);
  });

  it('取り消しで戻したもの（戻した日時）は、消した記録より勝つ', () => {
    const back = stampStudy(undefined, s, true, 40);
    expect(back).toMatchObject({ updatedAt: 10, restoredAt: 40 });
    expect(both(data({ studies: [back] }), data({ deleted: [studyDeletion(s, 20)] })).data.studies).toHaveLength(1);
  });

  it('消した記録は捨てない（古くても残る）', () => {
    const m = mergeBackups(data({ deleted: [studyDeletion(s, 1)] }), data());
    expect(m.data.deleted).toHaveLength(1);
  });
});

describe('保存するときに付ける印', () => {
  const s = study('s-1', BASE, { updatedAt: 10 });

  it('手が変われば手を変えた日時。名前だけなら前のまま（名前を直す前の日時を覚える）', () => {
    expect(stampStudy(s, { ...s, moves: [...s.moves, '2g2f'], updatedAt: 20 }, false, 21).movesAt).toBe(21);
    expect(stampStudy(s, { ...s, name: 'x', updatedAt: 20 }, false, 21).movesAt).toBe(10);
  });

  it('取り消し（直した日時が前に戻る）は戻した日時を付け、同期しても取り消した内容が勝つ', () => {
    const extended = stampStudy(s, { ...s, moves: [...s.moves, '2g2f'], updatedAt: 20 }, false, 20);
    const undone = stampStudy(extended, s, false, 30);
    expect(undone).toMatchObject({ movesAt: 30, restoredAt: 30, updatedAt: 10 });
    expect(shape(both(data({ studies: [undone] }), data({ studies: [extended] })).data.studies)).toEqual([['s-1', 's-1', BASE]]);
  });

  it('新しく作ったものには何も付けない', () => {
    expect(stampStudy(undefined, s, false, 30)).toEqual(s);
  });
});

const cp = (value: number) => ({ kind: 'cp' as const, value });
const pos = (patch: Partial<PositionNote>): PositionNote => ({ id: 'black|k', side: 'black', key: 'k', note: '', updatedAt: 10, ...patch });
const cand = (move: string, mark: Candidate['mark'], at: number): Candidate => ({ move, mark, eval: cp(0), at });

describe('局面の記録（局面メモと候補の表）', () => {
  it('局面メモと表は別々に新しい方。表は手ごとに合わせる', () => {
    const a = pos({ note: 'A のメモ', noteAt: 50, candidates: [cand('7g7f', 'main', 10), cand('2g2f', 'alt', 10)], updatedAt: 50 });
    const b = pos({ note: 'B の古いメモ', noteAt: 20, candidates: [cand('2g2f', 'bad', 60), cand('5g5f', 'alt', 60)], updatedAt: 60 });
    const m = mergeBackups(data({ positions: [a] }), data({ positions: [b] })).data.positions;
    expect(m).toHaveLength(1);
    expect(m[0].note).toBe('A のメモ');
    expect(m[0].candidates!.map((c) => [c.move, c.mark])).toEqual([
      ['7g7f', 'main'],
      ['5g5f', 'alt'],
      ['2g2f', 'bad'],
    ]);
  });

  it('本命が 2 つになったら、後で付けた方が本命、ほかは次善', () => {
    const m = mergeBackups(data({ positions: [pos({ candidates: [cand('7g7f', 'main', 10)] })] }), data({ positions: [pos({ candidates: [cand('2g2f', 'main', 20)] })] }));
    expect(m.data.positions[0].candidates!.map((c) => [c.move, c.mark])).toEqual([
      ['2g2f', 'main'],
      ['7g7f', 'alt'],
    ]);
  });

  it('表は 8 手まで（本命と新しいものを残す）', () => {
    const files = '123456789'.split('');
    const a = pos({ candidates: files.slice(0, 5).map((f) => cand(`${f}g${f}f`, 'alt', 10)) });
    const b = pos({ candidates: files.slice(5).map((f) => cand(`${f}g${f}f`, f === '9' ? 'main' : 'alt', 20)) });
    const t = mergeBackups(data({ positions: [a] }), data({ positions: [b] })).data.positions[0].candidates!;
    expect(t).toHaveLength(8);
    expect(t[0]).toMatchObject({ move: '9g9f', mark: 'main' });
  });

  it('表から外した手・消したメモは、相手に古いものがあっても戻らない', () => {
    const before = pos({ note: 'メモ', candidates: [cand('7g7f', 'main', 10), cand('2g2f', 'alt', 10)] });
    const { rec, removed } = stampPosition(before, { ...before, note: '', candidates: [cand('7g7f', 'main', 10)] }, 30);
    expect(removed.map((r) => [r.kind, r.id]).sort()).toEqual([
      ['candidate', 'black|k|2g2f'],
      ['note', 'black|k'],
    ]);
    const m = mergeBackups(data({ positions: [before] }), data({ positions: [rec!], deleted: removed })).data.positions;
    expect(m[0].note).toBe('');
    expect(m[0].candidates!.map((c) => c.move)).toEqual(['7g7f']);
  });

  it('保存の印：変えた手とメモだけ新しい日時。取り消しで戻した手は今の日時', () => {
    const before = pos({ note: 'メモ', candidates: [cand('7g7f', 'main', 10), { move: '2g2f', mark: 'alt' }], updatedAt: 15 });
    const { rec } = stampPosition(before, { ...before, candidates: [cand('7g7f', 'main', 10), { move: '2g2f', mark: 'bad' }] }, 30);
    expect(rec!.candidates!.map((c) => c.at)).toEqual([10, 30]);
    expect(rec!.noteAt).toBe(15);
    const undone = stampPosition(rec!, { ...rec!, candidates: before.candidates }, 40).rec!;
    expect(undone.candidates!.map((c) => c.at)).toEqual([10, 40]);
  });

  it('空になった記録は消して、メモと手の消した記録を残す', () => {
    const before = pos({ note: 'メモ', candidates: [cand('7g7f', 'main', 10)] });
    const { rec, removed } = stampPosition(before, { ...before, note: '', candidates: undefined }, 30);
    expect(rec).toBeNull();
    expect(removed).toHaveLength(2);
    expect(mergeBackups(data({ positions: [before] }), data({ deleted: removed })).data.positions).toEqual([]);
  });
});

describe('ほかの種類', () => {
  const game = (id: string, addedAt: number, patch: Partial<Game> = {}): Game => ({
    id,
    kifu: 'k',
    moves: ['7g7f'],
    black: { name: 'a' },
    white: { name: 'b' },
    playedAt: 1,
    mySide: 'black',
    winner: null,
    addedAt,
    ...patch,
  });

  it('稽古の記録は最後に稽古した方', () => {
    const m = mergeBackups(data({ practice: [practice('s-1', 5)] }), data({ practice: [practice('s-1', 9)] }));
    expect(m.data.practice.map((p) => p.lastAt)).toEqual([9]);
    expect(m.summary.practice).toEqual({ added: 0, updated: 1, removed: 0 });
  });

  it('同じ実戦は 1 局（先に貼った方の id）。直した方の自分の側を使う', () => {
    const m = mergeBackups(data({ games: [game('g-b', 20)] }), data({ games: [game('g-a', 10, { mySide: 'white', updatedAt: 99 })] }));
    expect(m.data.games.map((g) => [g.id, g.mySide])).toEqual([['g-a', 'white']]);
  });

  it('消した実戦は消える', () => {
    const m = mergeBackups(data({ games: [game('g-a', 10)] }), data({ deleted: [{ kind: 'game', id: 'g-a', at: 20 }] }));
    expect(m.data.games).toEqual([]);
  });

  it('復習の記録は問題ごとに新しい方。消した記録より前の問題は消える', () => {
    const rec = (nodes: Record<string, number>) =>
      ({
        treeId: 't',
        version: 1 as const,
        nodes: Object.fromEntries(Object.entries(nodes).map(([k, lastAt]) => [k, { seen: 1, correct: 1, streak: 1, lastOk: true, lastAt }])),
      }) satisfies ReviewRecord;
    const m = mergeBackups(data({ reviews: [rec({ x: 5, y: 50 })] }), data({ reviews: [rec({ x: 8 })], deleted: [{ kind: 'review', id: 't', at: 20 }] }));
    expect(Object.keys(m.data.reviews[0].nodes)).toEqual(['y']);
  });

  it('設定は合わせない（この端末のまま）', () => {
    const m = mergeBackups(data({ prefs: { 'joban-tree.settings': 'here' } }), data({ prefs: { 'joban-tree.settings': 'there', 'joban-tree.wars-name': 'x' } }));
    expect(m.data.prefs).toEqual({ 'joban-tree.settings': 'here' });
  });
});

describe('戻す（全部置きかえ・戻す前のデータに戻す）', () => {
  it('消した記録のあるものを戻すと、戻した日時が付いて、記録は消える。ほかは変えない', () => {
    const gone = study('s-1', BASE);
    const kept = study('s-2', `${BASE} 2g2f`);
    const note = pos({ note: 'メモ', candidates: [cand('7g7f', 'main', 10)] });
    const deleted: DeletedRecord[] = [studyDeletion(gone, 20), { kind: 'note', id: 'black|k', at: 20 }, { kind: 'candidate', id: 'black|k|7g7f', at: 20 }, { kind: 'game', id: 'g-x', at: 20 }];
    const r = reviveForRestore(data({ studies: [gone, kept], positions: [note] }), deleted, 90);
    expect(r.studies.map((s) => s.restoredAt)).toEqual([90, undefined]);
    expect(r.positions[0]).toMatchObject({ noteAt: 90, candidates: [{ move: '7g7f', at: 90 }] });
    expect(r.deleted).toEqual([{ kind: 'game', id: 'g-x', at: 20 }]);
    expect(mergeBackups(r, data({ deleted })).data.studies).toHaveLength(2);
  });
});

describe('戻したものは、合わせても消し直されない', () => {
  it('復習の記録', () => {
    const rec = { treeId: 't', version: 1 as const, nodes: { x: { seen: 1, correct: 1, streak: 1, lastOk: true, lastAt: 5 } } } satisfies ReviewRecord;
    const deleted: DeletedRecord[] = [{ kind: 'review', id: 't', at: 20 }];
    const restored = reviveForRestore(data({ reviews: [rec] }), deleted, 90);
    expect(mergeBackups(restored, data({ deleted })).data.reviews).toHaveLength(1);
    const parsed = parseBackupJson(backupToJson(makeBackup(restored, 1, 'x')));
    expect(parsed.ok && parsed.file.data.reviews).toEqual(restored.reviews);
  });

  it('前の版の「このままでよい」だけの局面の記録', () => {
    const old = pos({ okMoves: ['7g7f'] });
    const deleted: DeletedRecord[] = [{ kind: 'candidate', id: 'black|k|7g7f', at: 20 }];
    const restored = reviveForRestore(data({ positions: [old] }), deleted, 90);
    expect(mergeBackups(restored, data({ deleted })).data.positions).toHaveLength(1);
  });
});

describe('前の版で取っておいた「戻す前のデータ」', () => {
  it('実戦・稽古・局面の記録・消した記録の欄が無くても戻せる', () => {
    const old = { studies: [study('s-1', BASE)], trees: [], reviews: [], templates: [], prefs: {} } as unknown as BackupData;
    expect(reviveForRestore(old, [], 1)).toMatchObject({ games: [], practice: [], positions: [], deleted: [] });
  });
});

describe('バックアップのファイル', () => {
  const gone = studyDeletion(study('s-1', BASE), 20);

  it('消した記録も作る → 読むで元どおり。前のバックアップ（消した記録が無い）は空として読む', () => {
    const full = data({ studies: [study('s-2', BASE, { movesAt: 3, restoredAt: 4 })], deleted: [gone] });
    const parsed = parseBackupJson(backupToJson(makeBackup(full, 1, '0.50.0')));
    expect(parsed.ok && parsed.file.data).toEqual(full);
    expect(parsed.ok && parsed.unknownKinds).toEqual([]);
    const old = JSON.parse(backupToJson(makeBackup(data(), 1, '0.49.1')));
    delete old.data.deleted;
    const parsedOld = parseBackupJson(JSON.stringify(old));
    expect(parsedOld.ok && parsedOld.file.data.deleted).toEqual([]);
  });

  it('おかしい消した記録・日時は断る', () => {
    const bad = (d: unknown) => parseBackupJson(JSON.stringify(makeBackup(d as BackupData, 1, 'x'))).ok;
    expect(bad(data({ deleted: [{ ...gone, kind: 'x' } as never] }))).toBe(false);
    expect(bad(data({ deleted: [{ ...gone, at: 'x' } as never] }))).toBe(false);
    expect(bad(data({ deleted: [{ kind: 'study', id: 's', at: 1 }] }))).toBe(false);
    expect(bad(data({ studies: [{ ...study('s', BASE), movesAt: 'x' } as never] }))).toBe(false);
  });
});

describe('何台かで同期するときの道筋（段階22-3 の見直し）', () => {
  /** [7g7f 3c3d 2g2f] を、最後の 1 手を消して 6g6f に指し直す（保存の印つき） */
  const old = study('s1', `${BASE} 2g2f`);
  const cut = stampStudy(old, { ...old, moves: BASE.split(' '), updatedAt: 20 }, false, 20);
  const redone = stampStudy(cut, { ...cut, moves: `${BASE} 6g6f`.split(' '), updatedAt: 21 }, false, 21);

  it('指し直した手順は、前の形をまだ持つ端末と合わせても 2 本にならない', () => {
    const r = both(data({ studies: [redone] }), data({ studies: [old] }));
    expect(r.data.studies.map((s) => [s.id, s.moves.join(' ')])).toEqual([['s1', `${BASE} 6g6f`]]);
    expect(r.split).toBe(0);
  });

  it('指し直した方の手順が短くても、指し直した方が残る', () => {
    const long = study('s1', `${BASE} 2g2f 8c8d`);
    const short = stampStudy(long, { ...long, moves: BASE.split(' '), updatedAt: 20 }, false, 20);
    const again = stampStudy(short, { ...short, moves: `${BASE} 6g6f`.split(' '), updatedAt: 21 }, false, 21);
    const r = both(data({ studies: [again] }), data({ studies: [long] }));
    expect(r.data.studies.map((s) => s.moves.join(' '))).toEqual([`${BASE} 6g6f`]);
  });

  it('消したときに見ていない手が相手にあれば、今まで通り両方残す', () => {
    const unseen = study('s1', `${BASE} 2g2f 8c8d`, { movesAt: 12, updatedAt: 12 });
    const r = both(data({ studies: [redone] }), data({ studies: [unseen] }));
    expect(r.data.studies).toHaveLength(2);
  });

  it('相手が、消した後の日時で手を足し直したものは、今まで通り両方残す', () => {
    const later = { ...old, movesAt: 30, updatedAt: 30 };
    const r = both(data({ studies: [redone] }), data({ studies: [later] }));
    expect(r.data.studies).toHaveLength(2);
  });

  it('短くしたのを戻すと、短くした記録のある端末と合わせても、短くならない', () => {
    const full = study('s1', `${BASE} 2g2f 8c8d`);
    const shortened = stampStudy(full, { ...full, moves: BASE.split(' '), updatedAt: 20 }, false, 20);
    const restored = reviveForRestore(data({ studies: [full] }), [], 90, [shortened]);
    const r = both(restored, data({ studies: [shortened] }));
    expect(r.data.studies.map((s) => s.moves.length)).toEqual([4]);
  });

  it('戻して中身が変わらない研究手順には、印を足さない', () => {
    const full = study('s1', `${BASE} 2g2f`);
    expect(reviveForRestore(data({ studies: [full] }), [], 90, [full]).studies[0]).toEqual(full);
  });

  it('何台分かを一度に合わせると、読む順で結果が変わらない', () => {
    const mine = data({ studies: [study('id1', BASE, { createdAt: 1 })] });
    const two = data({ studies: [study('id2', `${BASE} 2g2f`, { createdAt: 2 })] });
    const ext = data({ studies: [study('id1', `${BASE} 2g2f`, { createdAt: 1, movesAt: 15, updatedAt: 15 })] });
    expect(shape(mergeAll(mine, [two, ext]).data.studies)).toEqual(shape(mergeAll(mine, [ext, two]).data.studies));
    expect(mergeAll(mine, [two, ext]).data.studies).toHaveLength(1);
  });
});

describe('手を消した記録（段階22-3 の 2 回目の見直し）', () => {
  const at = (moves: string, time: number) => study('s', moves, { movesAt: time, updatedAt: time });
  const edit = (prev: Study, moves: string, time: number) => stampStudy(prev, { ...prev, moves: moves.split(' '), updatedAt: time }, false, time);
  const seqs = (list: readonly Study[]) => list.map((s) => s.moves.join(' ')).sort();
  const one = (s: Study) => data({ studies: [s] });

  it('3 つの版を、どの順で読んでも同じになる（消した後に指した手は残る）', () => {
    const old = at('A B C D', 10);
    const cut = edit(old, 'A B', 20);
    const after = edit(cut, 'A B C', 30);
    const all = [cut, old, after];
    for (const first of all) {
      const rest = all.filter((x) => x !== first);
      for (const order of [rest, [...rest].reverse()]) expect(seqs(mergeAll(one(first), order.map(one)).data.studies)).toEqual(['A B C']);
    }
  });

  it('別の id の同じ手順を 1 本にしても、手を消した記録は移らない', () => {
    const q = study('q', 'A B', { createdAt: 1, movesAt: 5, updatedAt: 5 });
    const long = study('p', 'A B C D', { createdAt: 2, movesAt: 10, updatedAt: 10 });
    const p = stampStudy(long, { ...long, moves: ['A', 'B'], updatedAt: 20 }, false, 20);
    const joined = mergeBackups(one(q), one(p)).data;
    const grown = stampStudy(q, { ...q, moves: ['A', 'B', 'C', 'D'], updatedAt: 15 }, false, 15);
    expect(seqs(mergeAll(one(grown), [joined, one(p)]).data.studies)).toContain('A B C D');
  });

  it('1 手試して取り消した記録は、前に消したあとで相手が指し直した手までは消さない', () => {
    const cut = edit(at('A B C D', 10), 'A B', 20);
    const theirs = edit(cut, 'A B C D', 25);
    const tried = edit(edit(cut, 'A B C', 30), 'A B', 31);
    const r = both(one(tried), one(theirs));
    expect(seqs(r.data.studies)).toEqual(['A B C D']);
  });

  it('短くしてから研究手順ごと消した後に戻すと、短い版を持つ端末と合わせても短くならない', () => {
    const full = at('A B C D', 10);
    const cut = edit(full, 'A B', 20);
    const deleted = [studyDeletion(cut, 30)];
    const restored = reviveForRestore(one(full), deleted, 90, []);
    expect(seqs(both(restored, one(cut)).data.studies)).toEqual(['A B C D']);
  });

  it('指し直した手順で置きかわる研究手順は、手が減らなくても知らせる', () => {
    const old = at('A B C D', 10);
    const redone = edit(edit(old, 'A B', 20), 'A B E F', 21);
    expect(mergeBackups(one(old), one(redone)).shortened).toEqual([{ name: 's', from: 4, to: 4 }]);
  });

  it('3 台で延ばす・消す・指し直す・合わせるをくり返しても、読む順で変わらず、2 回目で変わらず、誰も消していない手は残る（1500 通り）', () => {
    const isHead = (a: readonly string[], b: readonly string[]) => a.length <= b.length && a.every((x, i) => b[i] === x);
    for (let seed = 1; seed <= 1500; seed++) {
      let n = seed;
      const pick = (k: number) => {
        n = (n * 48271) % 2147483647;
        return n % k;
      };
      let time = 100;
      const base = at('A', 50);
      const devices = [one(base), one(base), one(base)];
      /** できた手順（手と、その手になった日時）と、消した操作 */
      const made: { moves: string[]; time: number }[] = [{ moves: base.moves, time: 50 }];
      const cuts: { from: string[]; keep: number; time: number }[] = [];
      for (let step = 0; step < 18; step++) {
        time += 10;
        const i = pick(3);
        const d = devices[i];
        const kind = pick(5);
        if (kind === 4) {
          const others = [(i + 1) % 3, (i + 2) % 3].filter(() => pick(3) > 0).map((j) => devices[j]);
          if (others.length > 0) devices[i] = mergeAll(d, others).data;
          continue;
        }
        if (d.studies.length === 0) continue;
        const k = pick(d.studies.length);
        const prev = d.studies[k];
        let moves: string[];
        if (kind <= 1 || prev.moves.length === 1) moves = [...prev.moves, 'BC'[pick(2)]];
        else {
          const keep = 1 + pick(prev.moves.length - 1);
          moves = prev.moves.slice(0, keep);
          cuts.push({ from: prev.moves, keep, time });
        }
        made.push({ moves, time });
        const next = stampStudy(prev, { ...prev, moves, updatedAt: time }, false, time);
        devices[i] = { ...d, studies: d.studies.map((s, j) => (j === k ? next : s)) };
      }
      const [a, b, c] = devices;
      const result = mergeAll(a, [b, c]).data;
      const want = seqs(result.studies);
      expect(seqs(mergeAll(a, [c, b]).data.studies), `seed ${seed} 順`).toEqual(want);
      expect(seqs(mergeAll(b, [a, c]).data.studies), `seed ${seed} 向き b`).toEqual(want);
      expect(seqs(mergeAll(c, [b, a]).data.studies), `seed ${seed} 向き c`).toEqual(want);
      expect(seqs(mergeAll(result, [a, b, c]).data.studies), `seed ${seed} 2 回目`).toEqual(want);
      expect(new Set(result.studies.map((s) => s.id)).size, `seed ${seed} id`).toBe(result.studies.length);
      // 今どこかの端末にある手順は、その後の「消す」操作で消されたものでなければ、結果に残る
      for (const s of devices.flatMap((d) => d.studies)) {
        const when = s.movesAt ?? s.updatedAt;
        const removed = cuts.some((x) => s.moves.length > x.keep && isHead(s.moves, x.from) && x.time > when);
        if (!removed) expect(result.studies.some((r) => isHead(s.moves, r.moves)), `seed ${seed} 手順 ${s.moves.join(' ')}`).toBe(true);
      }
    }
  }, 30_000);
});
