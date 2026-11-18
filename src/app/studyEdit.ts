// 研究手順の手順の編集中の状態（段階9-1）。計算は src/tree/studyEdit.ts。
// 編集中は URL を #/study/<id>/edit にする（スマホの戻るボタンで編集をやめられるように）。
// 下書きは画面の外（この signal）に置く：戻るボタンで編集の画面から出たときに「変更を捨てますか？」を聞くため。

import { signal } from '@preact/signals';
import type { Draft } from '../tree/studyEdit';
import { route } from './router';

export interface EditSession {
  /** 編集している研究手順 */
  id: string;
  /** 編集を始めたとき（または最後に保存したとき）の手順 */
  saved: string[];
  draft: Draft;
  /** 「分かれる手」で作った研究手順の続きなら、分かれた手（0 始まり。名前に分かれ目を入れたままにするため） */
  branchAt?: number;
  /** 研究手順の画面（#/study/<id>）から入ったか（保存・やめるで履歴を 1 つ戻す） */
  fromView: boolean;
  /** 編集の画面に出す一言（別の研究手順を作った、など。次に手順を変えたら消す） */
  notice?: string;
}

export const editSession = signal<EditSession | null>(null);

/**
 * アプリが自分で画面を移している途中か（URL が変わるまでの間）。
 * この間は「編集の画面なのに下書きが無い」「ほかの研究手順の下書きがある」を、戻るボタンで出たのと取り違えないようにする
 */
let navigating = false;
export const isNavigating = (): boolean => navigating;

/** 下書きを入れ替えて、画面を移る（back：履歴を 1 つ戻る、それ以外：今の履歴をその URL に置き換える） */
export function navigateEdit(next: EditSession | null, to: 'back' | string): void {
  navigating = true;
  editSession.value = next;
  if (to === 'back') history.back();
  else location.replace(`#${to}`);
}

/** 編集の画面に入る（履歴に積むので、戻るボタンで出られる） */
export function enterEdit(session: EditSession): void {
  navigating = true;
  editSession.value = session;
  location.hash = `/study/${session.id}/edit`;
}

/** 編集の画面から出る（保存・やめるの後）。入ってきた画面に戻る */
export function leaveEdit(session: EditSession): void {
  navigateEdit(null, session.fromView ? 'back' : `/study/${session.id}`);
}

// URL が変わったら：移している途中は終わり。研究手順の画面から出たら下書きは捨てる
route.subscribe((r) => {
  navigating = false;
  if (r.name !== 'study') editSession.value = null;
});
