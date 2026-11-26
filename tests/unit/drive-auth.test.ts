// 段階22-3（まずログインの確認）：Google のログイン画面への行き方と、戻ってきたときの受け取り方
import { describe, expect, it } from 'vitest';
import { DRIVE_SCOPE, LOGIN_WAIT_MS, acceptLoginReturn, buildAuthUrl, parseLoginReturn, usableToken } from '../../src/drive/auth';

const NOW = 1_000_000;
const sent = { state: 'abc', at: NOW - 1000 };
const hash = (extra: Record<string, string>) => `#${new URLSearchParams(extra)}`;
const good = { access_token: 'tok', token_type: 'Bearer', expires_in: '3599', scope: DRIVE_SCOPE, state: 'abc' };

describe('ログインの画面へ', () => {
  it('アプリ専用の場所だけの権限で、鍵を直接受け取る形。秘密の鍵は送らない', () => {
    const url = new URL(buildAuthUrl('client-1', 'https://example.test/joban-tree/', 'abc'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-1',
      redirect_uri: 'https://example.test/joban-tree/',
      response_type: 'token',
      scope: 'https://www.googleapis.com/auth/drive.appdata',
      state: 'abc',
    });
  });
});

describe('戻ってきたとき', () => {
  it('アプリの画面の URL（#/…）は、ログインの戻りではない', () => {
    for (const h of ['', '#/', '#/settings', '#/book/x/s-1/3']) expect(parseLoginReturn(h)).toBeNull();
  });

  it('送った印（state）が同じなら、鍵と期限を受け取る', () => {
    const r = acceptLoginReturn(parseLoginReturn(hash(good))!, sent, NOW);
    expect(r).toEqual({ ok: true, token: { token: 'tok', expiresAt: NOW + 3599_000 } });
  });

  it('印が違う・送っていない・時間がたちすぎた戻りは、受け取らない', () => {
    const parsed = parseLoginReturn(hash(good))!;
    expect(acceptLoginReturn(parsed, { state: 'zzz', at: NOW }, NOW).ok).toBe(false);
    expect(acceptLoginReturn(parsed, null, NOW).ok).toBe(false);
    expect(acceptLoginReturn(parsed, { state: 'abc', at: NOW - LOGIN_WAIT_MS - 1 }, NOW).ok).toBe(false);
  });

  it('断った・ドライブの許可が無い・鍵が無いときは、理由を返す', () => {
    const no = acceptLoginReturn(parseLoginReturn(hash({ error: 'access_denied', state: 'abc' }))!, sent, NOW);
    expect(no).toEqual({ ok: false, message: 'ログイン（または許可）が取りやめられました。' });
    const scope = acceptLoginReturn(parseLoginReturn(hash({ ...good, scope: 'openid' }))!, sent, NOW);
    expect(scope.ok === false && scope.message).toContain('ドライブ');
    expect(acceptLoginReturn(parseLoginReturn(hash({ ...good, access_token: '' }))!, sent, NOW).ok).toBe(false);
  });

  it('鍵は期限の 1 分前から使わない。おかしい中身は無いものとする', () => {
    const t = JSON.stringify({ token: 'tok', expiresAt: NOW + 120_000 });
    expect(usableToken(t, NOW)).toEqual({ token: 'tok', expiresAt: NOW + 120_000 });
    expect(usableToken(t, NOW + 61_000)).toBeNull();
    expect(usableToken(null, NOW)).toBeNull();
    expect(usableToken('{', NOW)).toBeNull();
    expect(usableToken('{"token":1}', NOW)).toBeNull();
  });
});
