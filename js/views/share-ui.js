// 番組の共有ファイルの書き出し・取り込み画面（F-SHARE）

import { openForm, toast, chooseSheet, rerender } from '../ui.js';
import { all, notifyChange } from '../store.js';
import { buildShareFile, parseShareFile, findSameProgram, importShareItem } from '../share.js';
import { saveJsonFile, pickJsonFile, stamp } from '../files.js';
import { protectBeforeOverwrite } from '../sync.js';

export function exportShare(ids = null) {
  const go = async (list) => {
    if (!list.length) return;
    const file = buildShareFile(list);
    const name = list.length === 1 ? `番組-${file.programs[0].program.name}.json` : `番組${list.length}件-${stamp()}.json`;
    const how = await saveJsonFile(name.replace(/[\\/:*?"<>|]/g, '_'), file);
    if (how !== 'cancelled') toast('書き出しました。メモ・投稿履歴・ラジオネームは含みません');
  };
  if (ids) { go(ids); return; }
  const programs = all('programs').sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  if (!programs.length) { toast('番組がありません'); return; }
  openForm({
    title: '共有ファイルに書き出す番組',
    fields: [{ name: 'ids', label: '番組', type: 'checks', options: programs.map((p) => ({ value: p.id, label: p.name })), help: '放送枠・配信媒体・コーナー・投稿先・ハッシュタグを書き出します。メモや投稿履歴などの個人的な情報は含めません' }],
    values: { ids: programs.filter((p) => !p.archived).map((p) => p.id) },
    submitLabel: '書き出す',
    validate: (v) => (v.ids.length ? {} : { ids: '番組を選んでください' }),
    onSubmit: (v) => { go(v.ids); },
  });
}

export async function importShareFlow() {
  let items;
  try {
    const json = await pickJsonFile();
    if (!json) return;
    items = parseShareFile(json);
  } catch (e) {
    toast(`取り込めませんでした：${e.message}`, { error: true });
    return;
  }
  // 同じ名前の番組があるものは、先にすべて扱いを決めてもらう
  const plan = [];
  for (const item of items) {
    if (!findSameProgram(item)) { plan.push([item, 'add']); continue; }
    const mode = await chooseSheet(`「${item.program.name}」はすでに登録されています`, [
      { value: 'overwrite', label: '上書きする（メモ・投稿履歴は残す）' },
      { value: 'add', label: '別の番組として追加する' },
      { value: 'skip', label: 'スキップする' },
    ]);
    if (!mode) return; // 途中で閉じたら何もしない
    plan.push([item, mode]);
  }
  if (plan.some(([, mode]) => mode === 'overwrite')) await protectBeforeOverwrite('共有ファイルで上書きする前');
  const done = plan.filter(([item, mode]) => importShareItem(item, mode)).length;
  notifyChange();
  toast(`${done}件の番組を取り込みました`);
  rerender();
}
