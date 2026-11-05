// ファイルの書き出しと読み込み。iPhone では共有シートから「ファイル」アプリ（iCloud Drive など）に保存できる（F-MIG-08）。

import { h } from './ui.js';

/** JSON をファイルとして渡す。共有シートが使えればそれを、なければダウンロード */
export async function saveJsonFile(filename, obj) {
  const text = JSON.stringify(obj, null, 2);
  const file = new File([text], filename, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      // 共有に失敗したらダウンロードに切り替える
    }
  }
  const a = h('a', { href: URL.createObjectURL(file), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'downloaded';
}

/** ファイルを選んで JSON として読む。選ばなければ null */
export function pickJsonFile() {
  return new Promise((resolve, reject) => {
    const input = h('input', { type: 'file', accept: 'application/json,.json', class: 'hidden' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (!file) { resolve(null); return; }
      try {
        resolve(JSON.parse(await file.text()));
      } catch {
        reject(new Error('JSON ファイルとして読めません'));
      }
    });
    document.body.append(input);
    input.click();
  });
}

export const stamp = () => new Date().toISOString().slice(0, 10);
