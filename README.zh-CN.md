# Fast Bead（拼豆图纸生成器）

[English](./README.md) | **中文**

开源的 **照片 → 拼豆 / 融合豆图纸** 工具。

在浏览器里上传照片，映射到各品牌色号，清理杂色，跟摆时记录进度，并导出可打印图纸。**图片不会上传到服务器**，全部在本地处理。

- 在线演示：[fastgames.cn/tools/perler](https://fastgames.cn/tools/perler/)
- 本仓库：[github.com/leexiangf/fast_bead](https://github.com/leexiangf/fast_bead)

## 功能

- 多品牌色板（MARD / COCO / 漫漫 / 盼盼 / 咪小窝 / Artkal / Perler / Hama / …）
- 写真 / 平涂等管线（含 FS v2 抖动路径）
- 去背景、画笔编辑、稀疏色合并
- 库存色、珠数统计、CSV / PNG / 分板打印
- 跟摆模式：进度与草稿保存在本机（IndexedDB / localStorage）

## 快速开始

```bash
git clone https://github.com/leexiangf/fast_bead.git
cd fast_bead
npx --yes serve -l 5173 .
```

浏览器打开 `http://localhost:5173`。

也可用任意静态文件服务器打开 `index.html`（不建议直接用 `file://`，部分浏览器会限制本地资源）。

## 目录结构

```
fast_bead/
  index.html          # 应用入口
  css/                # 样式
  js/                 # 色板、量化、跟摆、i18n
  templates/          # 示例图
  docs/               # 算法说明
```

站点枢纽专属能力（分析 API、画板交接、Beadants 关卡导出）已剥离或改为 stub，本包可单独运行。

## 许可证

MIT © leexiangf — 见 [LICENSE](./LICENSE)。

## 参与贡献

欢迎 Issue 与 PR。优先小范围改动（色板数据、缺陷修复、文档）。请勿提交受 AGPL 等协议约束的第三方代码拷贝。
