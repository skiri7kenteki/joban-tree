// USI（将棋エンジンとのやり取りの決まりごと）の行を読み取る関数たち。
// エンジンの実装には依存しない「ただの文字列処理」なので、Vitest でテストする。

/** 評価値。cp は「歩 1 枚 ≒ 100」の単位。mate は詰みまでの手数（プラス＝手番側が詰ます、マイナス＝詰まされる） */
export type Score = { kind: 'cp'; value: number } | { kind: 'mate'; plies: number };

/** `info ...` の 1 行を読み取った結果 */
export interface InfoLine {
  depth?: number;
  seldepth?: number;
  nodes?: number;
  nps?: number;
  time?: number;
  hashfull?: number;
  /** 何番目の候補か（MultiPV）。書かれていなければ 1 */
  multipv: number;
  score?: Score;
  /** 探索の途中で「少なくともこの値」「多くてもこの値」と分かったときの印 */
  bound?: 'lower' | 'upper';
  /** 読み筋（USI 形式の指し手の並び） */
  pv: string[];
  /** `info string ...` のときの文字列 */
  string?: string;
}

/** 「詰み」の手数が書かれていない（`mate +` / `mate -`）ときに使う手数 */
const UNKNOWN_MATE_PLIES = 999;

const NUMBER_KEYS = ['depth', 'seldepth', 'nodes', 'nps', 'time', 'hashfull'] as const;

/** `info ...` の行を読み取る。info 行でなければ null */
export function parseInfo(line: string): InfoLine | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'info') return null;

  const info: InfoLine = { multipv: 1, pv: [] };
  let i = 1;
  while (i < tokens.length) {
    const key = tokens[i];
    if (key === 'string') {
      info.string = tokens.slice(i + 1).join(' ');
      break;
    }
    if (key === 'pv') {
      info.pv = tokens.slice(i + 1);
      break;
    }
    if (key === 'score') {
      const kind = tokens[i + 1];
      const raw = tokens[i + 2] ?? '';
      if (kind === 'cp') {
        info.score = { kind: 'cp', value: Number.parseInt(raw, 10) };
      } else if (kind === 'mate') {
        info.score = { kind: 'mate', plies: parseMatePlies(raw) };
      }
      i += 3;
      continue;
    }
    // lowerbound / upperbound は値を持たない（score の直後とは限らない）
    if (key === 'lowerbound' || key === 'upperbound') {
      info.bound = key === 'lowerbound' ? 'lower' : 'upper';
      i += 1;
      continue;
    }
    if (key === 'multipv') {
      info.multipv = Number.parseInt(tokens[i + 1] ?? '1', 10);
      i += 2;
      continue;
    }
    if ((NUMBER_KEYS as readonly string[]).includes(key)) {
      info[key as (typeof NUMBER_KEYS)[number]] = Number(tokens[i + 1]);
      i += 2;
      continue;
    }
    // 知らない項目（currmove など）は値ごと読み飛ばす
    i += 2;
  }
  return info;
}

/** `mate 5` / `mate -4` / `mate +` / `mate -` の手数部分を数にする */
function parseMatePlies(raw: string): number {
  if (raw === '+' || raw === '') return UNKNOWN_MATE_PLIES;
  if (raw === '-') return -UNKNOWN_MATE_PLIES;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return UNKNOWN_MATE_PLIES;
  // 0 は「すでに詰まされている」扱い（scoreToNumber で最小になる）
  return n;
}

/** `bestmove 7g7f ponder 3c3d` を読み取る。bestmove 行でなければ null */
export function parseBestmove(line: string): { move: string; ponder?: string } | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'bestmove' || tokens.length < 2) return null;
  const result: { move: string; ponder?: string } = { move: tokens[1] };
  if (tokens[2] === 'ponder' && tokens[3]) result.ponder = tokens[3];
  return result;
}

/** 詰みの評価値を数にするときの基準（どんな cp よりも大きい） */
export const MATE_VALUE = 100_000;

/**
 * 評価値を「大小比較できる 1 つの数」にする。
 * 早く詰ますほど大きく、早く詰まされるほど小さくなる。
 *   cp 300 → 300、mate 3 → 99997、mate 9 → 99991、mate -2 → -99998、mate -10 → -99990
 */
export function scoreToNumber(score: Score): number {
  if (score.kind === 'cp') return score.value;
  if (score.plies > 0) return MATE_VALUE - score.plies;
  return -MATE_VALUE - score.plies;
}

/** 反対側から見た評価値にする（手番側の値 → 相手側の値） */
export function negateScore(score: Score): Score {
  if (score.kind === 'cp') return { kind: 'cp', value: -score.value };
  return { kind: 'mate', plies: -score.plies };
}

/** 評価値の表示用の文字（`+123` / `−45` / `詰み 5手` / `詰まされ 4手`） */
export function formatScore(score: Score): string {
  if (score.kind === 'mate') {
    const n = Math.abs(score.plies);
    const plies = n >= UNKNOWN_MATE_PLIES ? '' : ` ${Math.round(n)}手`;
    return score.plies > 0 ? `詰み${plies}` : `詰まされ${plies}`;
  }
  if (score.value > 0) return `+${score.value}`;
  if (score.value < 0) return `−${Math.abs(score.value)}`;
  return '0';
}

/** 1 つの候補手の、探索結果としての読み筋 */
export interface PvLine {
  multipv: number;
  score: Score;
  bound?: 'lower' | 'upper';
  depth: number;
  pv: string[];
}

/**
 * MultiPV の各候補について「最後に出た info 行」を覚えておく入れ物。
 * 評価値と読み筋がそろっている行だけを対象にする。
 */
export class MultiPvCollector {
  private readonly latest = new Map<number, PvLine>();
  /** 最後に見た depth・nodes・nps（評価値の無い行も含む） */
  depth = 0;
  nodes = 0;
  nps = 0;

  add(info: InfoLine): void {
    if (info.depth !== undefined) this.depth = info.depth;
    if (info.nodes !== undefined) this.nodes = info.nodes;
    if (info.nps !== undefined) this.nps = info.nps;
    if (!info.score || info.pv.length === 0) return;
    this.latest.set(info.multipv, {
      multipv: info.multipv,
      score: info.score,
      bound: info.bound,
      depth: info.depth ?? 0,
      pv: info.pv,
    });
  }

  /** multipv の番号順に並べた候補 */
  lines(): PvLine[] {
    return [...this.latest.values()].sort((a, b) => a.multipv - b.multipv);
  }
}
