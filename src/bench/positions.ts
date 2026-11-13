// 速度測定に使う局面（USI の position コマンドの後ろの部分）。
// 合法な手順かどうかは tests/unit/bench-positions.test.ts で確かめている。
export interface BenchPosition {
  name: string;
  position: string;
}

export const BENCH_POSITIONS: BenchPosition[] = [
  { name: '平手の初期局面', position: 'startpos' },
  { name: '相居飛車の序盤（4手目）', position: 'startpos moves 7g7f 8c8d 2g2f 3c3d' },
  {
    name: '角換わり（8手目）',
    position: 'startpos moves 7g7f 8c8d 2g2f 3c3d 8h2b+ 3a2b 7i8h 7a7b',
  },
  {
    name: '四間飛車 対 居飛車（18手目）',
    position:
      'startpos moves 7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 3i4h 3a3b 5i6h 8b4b 6h7h 5a6b 5g5f 6b7b 4i5h 7b8b 9g9f 9c9d',
  },
];
