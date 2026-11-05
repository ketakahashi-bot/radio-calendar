// 機種変更用の QR コード（F-MIG-05）。ライブラリは vendor/ に同梱し、使うときだけ読み込む。

import { h, button } from './ui.js';

const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { loaded.delete(src); reject(new Error('部品を読み込めません')); };
      document.head.append(s);
    }));
  }
  return loaded.get(src);
}

/** QR コードを canvas に描く */
export async function qrCanvas(text, size = 240) {
  await loadScript('./vendor/qrcode.js');
  const qr = globalThis.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const cell = Math.floor(size / (n + quiet * 2));
  const canvas = h('canvas', { width: cell * (n + quiet * 2), height: cell * (n + quiet * 2), class: 'qr', role: 'img', 'aria-label': '連携用の QR コード' });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
  return canvas;
}

/** カメラで QR コードを読む。読めた文字列を返す（閉じたら null） */
export function scanQr() {
  return new Promise((resolve) => {
    let stream = null;
    let done = false;
    let result = null;
    const video = h('video', { playsInline: true, muted: true, autoplay: true, class: 'qr-video' });
    video.setAttribute('playsinline', '');
    const status = h('p', { class: 'help', role: 'status' }, 'カメラを起動しています…');
    const dlg = h('dialog', { class: 'sheet' },
      h('h2', { class: 'sheet-title' }, 'QR コードを読み取る'),
      h('p', { class: 'help' }, '前の端末の「設定 > 機種変更用の QR コード」を写してください。'),
      video, status,
      h('div', { class: 'sheet-actions' }, button('閉じる', () => dlg.close())));
    const stop = () => {
      done = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
    dlg.addEventListener('close', () => { stop(); dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      if (done) return;
      if (video.readyState >= 2 && video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const code = globalThis.jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
        if (code?.data) {
          result = code.data;
          dlg.close();
          return;
        }
      }
      requestAnimationFrame(tick);
    };
    Promise.all([loadScript('./vendor/jsQR.js'), navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })])
      .then(([, s]) => {
        if (!s) throw new Error('この端末ではカメラを使えません');
        stream = s;
        if (done) { stop(); return; }
        video.srcObject = s;
        status.textContent = 'QR コードを枠に入れてください';
        requestAnimationFrame(tick);
      })
      .catch((e) => {
        status.textContent = `カメラを使えません（${e.message || e.name}）。下の「連携コードを貼り付ける」を使ってください`;
      });
  });
}
