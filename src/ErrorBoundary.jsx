import React from 'react';

/* 画面を描くとちゅうで例外が出ても、まっ白にしない。
 *
 * 以前はエラー境界が無く、どこかで1つ例外が出ると、その場で画面がまっ白になり、
 * 何も押せなくなった（児童にはなにが起きたか分からず、先生も手の打ちようがなかった）。
 * ここでは「ホームに もどる」（アプリを はじめから描きなおす）と「よみこみ なおす」を出す。
 *
 * 色はテーマの変数を使わずに書く。テーマの変数はアプリ（App）の中で入れているので、
 * App が止まったときには無いかもしれないため。
 * 保存データを消すボタンは置かない。押しまちがえると、児童の記録が消えてしまう。 */
export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    // attempt: 「ホームに もどる」でやりなおした回数。やりなおしても また止まるなら、先生むけの説明を出す
    this.state = { error: null, attempt: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[Qalc] 画面の表示で止まりました', error, info && info.componentStack);
  }

  goHome = () => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));

  reload = () => { window.location.reload(); };

  render() {
    const { error, attempt } = this.state;
    // attempt が変わると、アプリ全体を はじめから描きなおす（画面はホームから）
    if (!error) return <React.Fragment key={attempt}>{this.props.children}</React.Fragment>;
    return (
      <div role="alert" className="min-h-[100dvh] flex items-center justify-center p-4 bg-[#fffbeb] text-[#1f2937]">
        <div className="w-full max-w-sm bg-white border-[3px] border-[#1f2937] rounded-2xl p-6 text-center shadow-[4px_4px_0_#1f2937]">
          <p className="text-5xl mb-2" aria-hidden="true">🙇</p>
          <h1 className="font-black text-xl mb-2">うまく うごかなく なりました</h1>
          <p className="text-sm mb-5">これまでに ほぞんした きろくは きえて いません。</p>
          <div className="flex flex-col gap-2">
            {/* お知らせが出たら、キーボードや読み上げでもすぐ押せるように、このボタンへ移る */}
            <button autoFocus type="button" onClick={this.goHome} className="min-h-[48px] rounded-xl font-black bg-[#1d4ed8] text-white border-[3px] border-[#1f2937]">ホームに もどる</button>
            <button type="button" onClick={this.reload} className="min-h-[48px] rounded-xl font-bold bg-white text-[#1f2937] border-[3px] border-[#1f2937]">よみこみ なおす</button>
          </div>
          {/* やりなおしても また止まったら、先生むけに 何で止まったかを出す（児童の名前などは入らない） */}
          {attempt >= 1 && (
            <>
              <p className="text-sm mt-4">なんども でる ときは、せんせいに この がめんを みせて ください。</p>
              <p className="text-xs mt-2 break-all text-[#374151]">{String(error.name || 'Error')}: {String(error.message || '').slice(0, 160)}</p>
            </>
          )}
        </div>
      </div>
    );
  }
}
