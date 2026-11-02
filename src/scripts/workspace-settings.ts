import {
  preferences,
  savePreferences,
  type Preferences,
} from "../lib/preferences";
import {
  parseBackup,
  mergeBackup,
  createBackup,
  MAX_BACKUP_BYTES,
} from "../lib/workspace-backup";
const root = document.querySelector<HTMLElement>("[data-workspace-settings]");
if (root) {
  const message = root.querySelector<HTMLElement>("[data-workspace-message]")!;
  const preview = root.querySelector<HTMLElement>("[data-import-preview]")!;
  let incoming: Preferences | null = null;
  function render() {
    const p = preferences();
    root!.querySelector("[data-workspace-summary]")!.innerHTML = [
      [p.watching.length, "关注公司"],
      [p.saved.length, "收藏动态"],
      [Object.values(p.read).filter((r) => r > 0).length, "已读记录"],
      [p.dismissed?.length ?? 0, "暂不关注"],
    ]
      .map(
        ([n, label]) => `<div><strong>${n}</strong><span>${label}</span></div>`,
      )
      .join("");
  }
  root
    .querySelector("[data-export-workspace]")!
    .addEventListener("click", () => {
      let json: string;
      try {
        json = createBackup(preferences());
      } catch (error) {
        message.textContent =
          error instanceof Error ? error.message : "无法生成备份。";
        return;
      }
      const url = URL.createObjectURL(
        new Blob([json], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `finmap-workspace-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message.textContent = "备份已生成，请保管好下载的文件。";
    });
  root
    .querySelector("[data-import-workspace]")!
    .addEventListener("change", async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      incoming = null;
      preview.hidden = true;
      if (!file) return;
      try {
        if (file.size > MAX_BACKUP_BYTES)
          throw Error("文件超过 20 MB，暂时无法导入；现有记录没有改变。");
        incoming = parseBackup(await file.text());
        root.querySelector("[data-import-description]")!.textContent =
          `将合并 ${incoming.watching.length} 家关注公司、${incoming.saved.length} 条收藏及 ${Object.keys(incoming.read).length} 条阅读记录。`;
        preview.hidden = false;
        message.textContent = "";
      } catch (error) {
        message.textContent =
          error instanceof Error ? error.message : "无法读取备份。";
      }
    });
  root.querySelector("[data-confirm-import]")!.addEventListener("click", () => {
    if (!incoming) return;
    const stored = savePreferences(mergeBackup(preferences(), incoming));
    incoming = null;
    preview.hidden = true;
    message.textContent = stored
      ? "已合并，关注和收藏列表现在可用。"
      : "当前浏览器无法保存；合并仅在本页有效，请先导出备份。";
    render();
  });
  root.querySelector("[data-cancel-import]")!.addEventListener("click", () => {
    incoming = null;
    preview.hidden = true;
  });
  window.addEventListener("storage", render);
  render();
}
