/* package.json に lint スクリプトはあったが、設定ファイルが無く
 * `npm run eslint` はずっとエラーで終わっていた（CI にも入っていなかった）。
 *
 * ねらいは「書きかたの好み」をそろえることではなく、
 * 事故につながる書きまちがいを止めること。
 *   - 使っていない変数 → 消しわすれ・打ちまちがい
 *   - useEffect の依存配列もれ → 古い値を見つづける不具合（PeerJS のコールバックで実際に起きやすい）
 * インデントや引用符には口を出さない（既存のコードを一括で書きかえたくない）。
 *
 * ⚠️ `npm run lint` には --ext .js,.jsx,.mjs が要る。ESLint 8 の `eslint .` は
 *    .js しか見ないので、画面のコード（src/*.jsx）が1本も検査されていなかった
 *    （CI は毎回「警告0件」で通っていたが、.jsx を足すとエラー7件・警告56件あった）。
 * ⚠️ --max-warnings は「いまある警告の数」。下の react-hooks/exhaustive-deps の
 *    既存21件だけが残っている。新しく警告を増やすと CI が落ちる。
 *    直して減らしたら、package.json の数字も同じだけ下げること。
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  // 入っている React の版を見る（以前は '18.2' と書いてあったが、実際は 19）
  settings: { react: { version: 'detect' } },
  plugins: ['react-refresh'],
  ignorePatterns: ['dist', 'node_modules', '.eslintrc.cjs'],
  rules: {
    // React 17 以降は import React が要らない
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    // 児童の画面に出す文字にカギかっこや「'」が入るので、エスケープを強制しない
    'react/no-unescaped-entities': 'off',
    // catch (e) で e を使わない書きかたが多いので、そこだけ見のがす
    'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    'no-empty': ['warn', { allowEmptyCatch: true }],
    // 依存配列もれは警告にとどめる。既存分をいま全部直すと変更が大きくなりすぎるため、
    // 「新しく増やさない」ことを目的にする
    'react-hooks/exhaustive-deps': 'warn',
  },
};
