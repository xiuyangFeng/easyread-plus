# 数据格式

## paper.json

```json
{
  "schema": 2,
  "meta": {
    "title_zh": "给评测加上误差条：语言模型评测的统计学方法",
    "short_zh": "给评测加上误差条",
    "title_en": "Adding Error Bars to Evals: ...",
    "authors": "Evan Miller", "affiliation": "Anthropic",
    "date": "2024 年 11 月 4 日", "arxiv": "arXiv:2411.00640v1 [stat.AP]",
    "pdf": "source.pdf", "source_sha256": "…", "pages": [{"n": 1, "w": 612, "h": 792, "img": "pages/page-001.webp"}]
  },
  "translation": { "scope": "全文", "done_pages": [1, 2, 3], "note": "参考文献保留原文" },
  "glossary": [{ "en": "standard error", "zh": "标准误", "note": "可选" }],
  "references": [{ "id": "1", "text": "原文条目" }],
  "blocks": [ … ]
}
```

`meta.pages`、`page_count`、`source_sha256`、`pdf` 由导入时写，不要手改。文献库页里改的标题、作者等存在 `item.json` 的 `meta_override`，不改 paper.json。

### 块

每块必须有唯一 `id`（后续讨论、笔记都锚在它上面，定下后不要改）、`type`、`page`（这块在原 PDF 从哪页开始）。

| type | 字段 | 说明 |
|---|---|---|
| `heading` | `level`(1/2)、`num`、`zh`、`en`、`appendix` | 章节标题。`num` 如 "2.1"、"A"；附录的标题加 `"appendix": true` |
| `para` | `zh`、`en`、`role`、`cont` | 段落。`role: "abstract"` 用摘要样式；`cont: true` 表示接着公式的半句（如 “其中 …”） |
| `list` | `ordered`、`items: [{zh, en}]` | 列表 |
| `math` | `tex`、`tag` | 行间公式。`tag` 是原文编号（"1"），无编号不写。多行用 `aligned` / `gathered` |
| `table` | `num`、`head: [[…]]`、`rows: [[…]]`、`align`、`caption_zh`、`caption_en`、`caption_pos` | 表格。单元格支持行内标记，`\n` 换行（第二行括号内容自动变灰，适合“均值\n(标准误)”）。`align` 如 "lrrr" |
| `figure` | `num`、`src`、`caption_zh`、`caption_en` | 图。`src` 是论文目录下的图片（如 `figures/fig1.webp`），留空时页面显示“图见原文第 N 页” |
| `references` | `zh`、`en` | 放参考文献列表的位置（内容取 `references`） |
| `note` | `zh` | 正文流里的“阅读批注（非原文）”。尽量不用，解释放 discussion.json |

可选 `box: [x0, y0, x1, y1]`（按页宽高归一化）手工指定原页高亮区域，覆盖自动定位。

浮动体（表、图）放在正文第一次提到它的段落之后，`page` 仍写它实际所在页。

新增一批块（`easyread blocks ID --from 批次.json --done 4-6`）时可带 `"_after": "某块id"` 指定插入位置，否则追加到末尾；同 id 的块整块替换。

### 行内标记（zh、en、单元格、讨论正文通用）

- `$...$` 行内公式（KaTeX）；字面美元符写 `\$`
- `**粗体**`、`*斜体*`、`` `代码` ``
- `[7]`、`[2, 5]` 自动链到参考文献
- 中文里的“公式 (4)”“公式 (9) 和 (10)”“表 2”“图 3”“第 2.2 节”“附录 A”，英文里的 “Equation 4”“Table 2”“Section 2.2”“Appendix A”，自动变成可悬停预览、点击跳转的链接（目标要存在）
- 讨论正文里空行分段；单独一段 `$$...$$` 是行间公式

JSON 里 TeX 的反斜杠要写两个（`\\frac`）。`\f` `\b` `\t` `\n` `\r` 开头的命令（`\frac`、`\bar`、`\text`、`\nu`、`\right`）写错会被 JSON 悄悄吃掉，`paper.py check` 会报“含控制字符”。

## discussion.json

```json
{ "schema": 2, "entries": [
  { "id": "d001-ab12c", "anchor": "s2-1-p4", "quote": "对它（即“真实”的平均评测分数）进行推断",
    "kind": "check", "title": "原句漏了一个符号", "body": "…", "at": "…" }
]}
```

| 字段 | 说明 |
|---|---|
| `anchor` | 块 id；不写表示整篇（显示在题头旁） |
| `quote` | 可选，锚点块**译文**里的一段原话（纯文字，不能含 `$` 公式），页面会给它加下划线 |
| `kind` | `explain` 解释 / `qa` 问答 / `insight` 感悟 / `reply` 回复用户问题 / `check` 原文核对提示 |
| `title`、`q`、`body` | 标题、问题（问答用）、正文（必填，支持行内标记） |
| `reply_to` | 回复用户笔记时填笔记 id（`easyread status` 里能看到），锚点自动跟随那条笔记 |

用 `easyread discuss ID --from 文件.json` 追加（数组或单个对象）；带已有 `id` 是修改；`--delete ID` 删除。`id`、`at` 不写会自动生成。

## reader.json（只读）

```json
{ "rev": 12,
  "edits": { "s1-p3": { "zh": "用户版本", "base": "改时译者稿的哈希", "at": "…" },
             "tab1#caption": { … }, "s1-recs#2": { … } },
  "notes": { "n…": { "id": "n…", "anchor": "s1-p2", "key": "s1-p2", "quote": "…", "prefix": "…", "suffix": "…",
                    "kind": "note | question | highlight", "color": "yellow | green | blue | pink",
                    "body": "…", "created": "…", "updated": "…", "deleted": false } },
  "paper_note": { "body": "整篇的论文笔记", "at": "…" },
  "progress": { "block": "s3-1-p2", "ratio": 0.35, "at": "…" } }
```

编辑的键：普通块是块 id，表/图题注是 `id#caption`，列表项是 `id#序号`。页面只通过 `/api/p/ID/ops` 发操作（`edit`、`note`、`note_del`、`paper_note`、`progress`），每个操作幂等、带时间戳，同一对象以较新的为准；服务端加锁、原子写、记日志。离线版导出的修改用 `easyread merge ID --from 导出.json` 并回。

## item.json（只读）

```json
{ "added": "…", "tags": ["统计"], "status": "unread | reading | done", "starred": false,
  "last_opened": "…", "meta_override": { "title_zh": "…" }, "done_at": "第一次标为已读的时间",
  "read": { "total": 5230, "days": { "2026-10-26": 1820 }, "last": "…" } }
```

`read` 是阅读时长（秒），阅读页每 30 秒报一次（`/api/p/ID/readtime`，单次最多 600 秒），按读者本地日期累计；只算页面在前台、两分钟内有滚动 / 点击 / 按键（或开着自动滚动、朗读）的时间。

## job.json（后台任务状态）

`{"type": "translate", "state": "queued | running | done | partial | error | cancelled", "message": "…", "done": 4, "total": 14, "error": "", "failed": {"7": "原因"}, "scope": "all | body | first:N"}`。服务重启后 queued / running 的任务会自动继续。`partial` 表示有页没译成功（`failed` 里是页码和原因），页面上可以一键重试。每篇的翻译过程记在 `job.log`。

## chat.json（“问 AI”的对话记录，只有服务写）

```json
{ "threads": [
  { "id": "t…", "title": "我标红的那些公式有什么联系", "model": "opus", "created": "…", "updated": "…",
    "messages": [
      { "role": "user", "content": "…", "anchor": "s1-recs", "quote": "", "note": null, "at": "…" },
      { "id": "m…", "role": "assistant", "content": "……", "model": "Claude Opus 5", "anchor": "s1-recs", "note": null, "at": "…" } ] } ] }
```

一篇论文可以有多个对话。`note` 不为空时，这次是在回答页边那条笔记里的问题，回答同时写进 discussion.json（`reply_to` 那条笔记，`live: true`）。“放到页边”把一条回答写成 discussion.json 里的 `qa` 条目。提问时会把读者的全部标记（按颜色分组）一起交给模型。

## gist.json（段落主旨与论文脉络，服务写）

阅读页“脉络”面板点“生成”（或设置里开了“翻译完自动生成”）时，服务用设置里的翻译模型按一级章节读译文写出来；页面只读，读者改主旨走 `/api/p/ID/gist-edit`。

```json
{ "schema": 1, "at": "…", "by": "deepseek-flash",
  "blocks": {
    "p12-1": { "gist": "定性显示 G3e-Net 更贴近 CFD 压力与流线", "role": "结果", "link": "递进",
               "why": "在实验设定后展示优选病例的可视化", "h": "40eeb388", "at": "…" },
    "p1-2":  { "gist": "我自己写的", "role": "问题", "by": "me", "h": "…", "ai": { "gist": "模型原来写的", "…": "…" } }
  },
  "sections": { "s2": { "gist": "说明数据、CFD 真值、几何特征和图网络" } },
  "story": "全文故事线，两三句",
  "claims": [ { "id": "c1", "kind": "主结论", "claim": "…", "support": [ { "id": "p12-2", "how": "定量对比" }, { "id": "fig9", "how": "箱线图" } ], "weak": "" } ],
  "floats": { "fig7": { "q": "收缩峰下预测与 CFD 差异在哪？", "look": "先看 CFD 与 G3e 流线，再比误差图" } },
  "links":  [ { "from": "fig7", "to": "fig8", "rel": "对照", "note": "同一队列峰值与周期平均对照" } ],
  "chains": [ { "id": "k1", "title": "胸主动脉双状态验证", "steps": [ { "id": "p12-1", "note": "定性贴近 CFD" }, { "id": "fig7", "note": "" } ], "conclusion": "…" } ] }
```

- `role` 取自：概述、背景、问题、思路、方法、设定、结果、对比、解释、局限、结论；`link`（和上一段的关系）取自：开启、递进、转折、举例、证据、细化、并列、总结。
- `h` 是生成时这段译文（读者改过的优先，列表各项用换行连起来，去掉首尾空白）的 `text_hash`；和现在的译文对不上，页面就标“可能过时”，再点“补全”只重写这些段。
- 读者改过的条目 `by: "me"`，模型原来的版本放在 `ai`；“全部重新生成”只更新 `ai`，不覆盖读者写的。
- 不写主旨的：不足 24 字的段、参考文献之后的零碎、文末事务性章节（致谢、各类声明、作者贡献、数据可用性、资助）。
- `claims[].support[].id`、`links` 的两端、`chains[].steps[].id` 只会是真实存在的段落、图、表 id，模型编出来的会被丢掉；只剩一步的结果链也丢掉。
- `floats`、`links`、`chains` 是“图表关系”这一步写的：每张图表回答什么、看哪里；图表之间、结果段落之间的关系（`rel` 取自：对照、递进、推广、细化、互证、补充、反差）；2–4 条结果链（结果段落和图表交替的证据顺序）。这一步失败不影响主旨和论点。

## 不另存的汇总

库内引用关系（`citegraph.py`）、全部笔记、阅读统计、文献对比表（`overview.py`）都是现读各篇的 JSON 现算的，不另存文件。引用关系按标题（去掉大小写、标点、空格和公式记号后包含）、arXiv 编号、DOI 认，结果按 paper.json / item.json 的修改时间缓存。

## 数据目录里的其他文件

| 文件 | 内容 |
|---|---|
| `config.json` | 设置：翻译引擎、各家 API Key（`openai.keys`，按服务商分开存）、问 AI 的模型名单和默认模型（`chat.models`、`chat.default`） |
| `prefs.json` | 界面偏好：阅读页字号、版心、主题、划线笔（`reader`），功能开关和快捷键总开关（`ui`），改过的键位（`keys`） |
| `easyread.log` | 服务日志，设置底部“查看运行日志”能看到 |

## 为什么用 JSON 文件而不是数据库

EasyRead 是个人工具：一个人、一台电脑、几十到几百篇论文。每篇一个文件夹、几个 JSON，好处是能直接看、能直接备份和同步（网盘、git 都行），agent 在对话里也能直接读写；按“谁写哪个文件”分开之后，也不需要数据库的并发控制。文献库列表每次扫描各文件夹生成，几百篇以内是毫秒级。浏览器 localStorage 只用来暂存还没写进文件的修改和缓存偏好，不是数据的正本。
