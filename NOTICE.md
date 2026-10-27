# NOTICE · 来源与致谢

## 本项目的来源

**EasyRead Plus** 是 [EasyRead](https://github.com/Edwardxlai/easyread) 的**非官方**衍生版本。

- 原项目：EasyRead，作者 Edward（GitHub [@Edwardxlai](https://github.com/Edwardxlai)），版权人 LiangXiLin，以 [MIT 协议](https://github.com/Edwardxlai/easyread/blob/main/LICENSE) 发布。
- 本仓库基于原项目 **v1.0.0**（[`8a88ec1`](https://github.com/Edwardxlai/easyread/commit/8a88ec199759f6eef535de71cbbf1c1b9674b551)）修改，提交历史接在原项目的提交之后，可以逐条看到改了什么。
- 翻译流程、阅读器、文献库、数据格式等核心设计都来自原作者，在此致谢。本仓库新增和改动的部分见下文和 [CHANGELOG.md](CHANGELOG.md) 的“未发布”一节。
- 本版本由 xiuyangFeng 维护，与原作者无关；出现的问题请在本仓库反馈，不要打扰原项目。原项目后来的版本（v1.1 之后）没有合并进来，想用官方最新版请去[原仓库](https://github.com/Edwardxlai/easyread)。
- “EasyRead”这个名字归原作者，本仓库用“EasyRead Plus”以示区分。

## 本仓库的主要改动（相对 EasyRead v1.0.0）

- **论文脉络**：模型按章节给每段写一句主旨，标出角色（问题 / 方法 / 结果……）和与上一段的承接；全文故事线、章节脉络图、核心论点与证据、图表关系与结果链；“只看主旨”。
- **随文看图**：读到“图 N”时右侧显示这些图，上图下脉络，没提到图时脉络占满。
- **原文阅读模式**：正文整篇换成英文原文，右侧照样开脉络和看图；原文面板可看 PDF 原页或排好版的英文。
- 右侧面板拖宽、捏合调字号、全文搜索、全库备份、导出中文 PDF、朗读、图片灯箱、表格复制，以及引用追溯、缩写释义、笔记中心、阅读统计、文献对比等。

## 第三方组件

| 组件 | 用途 | 许可 |
|---|---|---|
| [KaTeX](https://katex.org) 0.16.22（`easyread/web/vendor/katex/`） | 渲染公式 | MIT，见下文 |
| [pypdfium2](https://github.com/pypdfium2-team/pypdfium2)、[pdfplumber](https://github.com/jsvine/pdfplumber)、[Pillow](https://python-pillow.org)、[pypdf](https://github.com/py-pdf/pypdf) | PDF 渲染与解析（安装时从 PyPI 下载，不随本仓库分发） | 各自的开源许可 |

在线演示（`docs/demo/`）用的论文是 Rafailov 等人的 *Direct Preference Optimization: Your Language Model is Secretly a Reward Model*（[arXiv:2305.18290](https://arxiv.org/abs/2305.18290)），以 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 发布；中文译文由模型生成，属于对原文的改编，演示里的划线和笔记是示例。该演示来自原项目。

### KaTeX 许可

```
The MIT License (MIT)

Copyright (c) 2013-2020 Khan Academy and other contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
