/* 帮助：快捷键、怎么用、关于。按 ? 或点顶栏问号打开。 */
(function (PR) {
  "use strict";
  const dlg = PR.$("#textDlg");
  const K = (keys, what) => "<tr><td>" + keys.split(" ").map((k) => "<kbd>" + k + "</kbd>").join(" ") + "</td><td>" + what + "</td></tr>";

  PR.openHelp = function () {
    dlg.querySelector(".dialog").innerHTML =
      '<div class="help-head">' + PR.logo("hero sm") + "<div><h2>EasyRead</h2><div class=\"hint\">版本 " + PR.esc(PR.lib.version || "") + " · 本地运行，论文和笔记只存在你的电脑上</div></div></div>" +
      '<div class="help-cols"><div><h4>文献库</h4><table class="keys">' +
      K("/", "搜索标题，也搜全部译文全文") + K("J K", "上下移动") + K("Enter", "打开阅读") + K("S", "星标") + K("⌘/Ctrl+点 Shift+点", "多选，批量改状态、分类、导出 BibTeX、文献对比表") + K("⌘/Ctrl+A", "全选当前列表") + K("Ctrl+V", "粘贴链接直接导入") + K("?", "这个帮助") +
      "</table><h4>导入</h4><p class=\"hint\">拖 PDF 进窗口；或填 arXiv 编号、DOI、论文标题、论文网页（arXiv、OpenReview、ACL、NeurIPS、bioRxiv、PMC、期刊页面）或 PDF 直链。找不到公开 PDF 的，下载后拖进来。长论文可以只译正文。</p>" +
      "<h4>翻译引擎</h4><p class=\"hint\">本机装了 Claude Code 或 Codex 就能直接用，不用 Key；也可以用 DeepSeek、智谱、通义、Gemini 等 API，或本机 Ollama。在设置里换。</p>" +
      '<h4>数据</h4><p class="hint">所有论文、译文、笔记、修改都存放在本机的文献库文件夹里。<button class="btn sm line" data-x="backup">' + PR.icon("download", "sm") + "导出全部数据备份（zip）</button>　备份不含可再生的原页图。</p></div>" +
      '<div><h4>阅读页</h4><table class="keys">' +
      K("J K", "下一段 / 上一段") + K("N Q", "给当前段写笔记 / 提问") + K("A", "问 AI（带当前段）") + K("E", "改译文") + K("R", "让模型重译这段") +
      K("B", "译文 / 对照原文") + K("/", "搜索译文和原文") + K("W", "自动滚动 开/关") + K("V", "朗读译文 开/关") +
      K("O", "原文页面板") + K("I", "图表一览") + K("M", "笔记面板") + K("T", "目录") + K("= - 0", "字号大 / 小 / 默认") + K("1 2 3 4", "选中文字后四色划线") +
      "</table><p class=\"hint\">插图和表格还有小惊喜：点图片全屏放大、滚轮缩放、能下载原图；表格右上角可以复制成 Excel / Markdown / CSV；公式可以复制 LaTeX。作者-年份引用（Smith et al., 2020）也能悬停、点击；参考文献条目下面能看正文里在哪几处引用、一键导入；缩写悬停看全称。</p></div></div>" +
      '<div class="actions"><button class="btn" data-close>关闭</button>' +
      '<button class="btn line" data-x="backup" style="margin-left:auto">' + PR.icon("download", "sm") + "导出全部数据备份（zip）</button></div>";
    dlg.classList.add("open");
  };
  dlg.addEventListener("click", (e) => { if (e.target.closest('[data-x="backup"]')) { location.href = "/api/backup"; } });
  PR.$("#helpBtn").onclick = PR.openHelp;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "?" || e.target.closest("input, textarea, select, [contenteditable]") || PR.$(".dialog-backdrop.open")) return;
    e.preventDefault();
    PR.openHelp();
  });
})(window.PR);
