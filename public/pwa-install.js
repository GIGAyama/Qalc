/* インストールの合図を、いちばん先に受け取る（Part I §3-2）
 *
 * Chrome は条件がそろうと、ページを開いてすぐ beforeinstallprompt を投げてくる。
 * React や CSS の読みこみより後で addEventListener しても間に合わず、
 * 校内Wi-Fiが混んでいる日ほど「インストール」ボタンが出なくなる。
 * だから <head> のいちばん上で、この小さなファイルだけを先に読ませている。
 *
 * インラインの <script> にしていないのは CSP のため。
 * このアプリは script-src 'self' で閉じているので、インラインは実行されない。
 * ハッシュを書く手もあるが、中身を直すたびに index.html も直す必要があり、
 * 直しわすれるとインストールボタンが黙って出なくなる。外部ファイルなら起きない。
 */
(function () {
    // 受け取ったイベントは、あとでボタンが押されたときに使うので取っておく。
    // prompt() は「ユーザーが押した」ことが必要なので、ここでは呼べない
    window.__deferredInstallPrompt = null;

    window.addEventListener('beforeinstallprompt', function (e) {
        // 既定のミニ情報バーを止める。アプリ内のボタンから案内したい
        e.preventDefault();
        window.__deferredInstallPrompt = e;
        window.dispatchEvent(new Event('pwa-installable'));
    });

    window.addEventListener('appinstalled', function () {
        window.__deferredInstallPrompt = null;
        window.dispatchEvent(new Event('pwa-installed'));
    });
})();
