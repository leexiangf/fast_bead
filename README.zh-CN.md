# Fast Bead（拼豆图纸生成器）

[English](./README.md) | **中文**

开源的 **照片 → 拼豆 / 融合豆图纸** 工具。

在浏览器里上传照片，映射到各品牌色号，清理杂色，跟摆时记录进度，并导出可打印图纸。**图片不会上传到服务器**，全部在本地处理。

- 在线演示：[fastgames.cn/tools/perler](https://fastgames.cn/tools/perler/)
- 本仓库：[github.com/leexiangf/fast_bead](https://github.com/leexiangf/fast_bead)

![Fast Bead 效果图：照片转拼豆图纸](./docs/images/screenshot.png)

## 功能亮点

- **照片生成图纸**：按拼豆网格采样映射；提供写真高还原、细节、手绘感、自定义等预设，可调边长与色数。
- **多品牌色号匹配**：内置 MARD / COCO / 漫漫 / 盼盼 / 咪小窝 / Artkal / Perler / Hama 等色板，出图直接标色号。
- **FS v2 / 手绘感管线**：面向插画与写真的量化与抖动路径，减少糊边、提升色块可读性。
- **去背景与精修**：一键抠外轮廓背景（可调容差）；画笔、桶填、整色替换、橡皮、区域擦除，支持撤销。
- **稀疏色合并**：按相似度阈值合并零星杂色，图纸更干净、备料更省心。
- **我的库存色**：勾选手头已有色号，可强制只用库存色重匹配，少买少浪费。
- **跟摆模式（本站特色）**：按色或按行跟摆；「下一颗」逐格推进并记录已摆进度，支持色号高亮、坐标尺、草稿保存，退出后再进可继续。
- **用量与结构提示**：按色统计珠数与大致袋数；结构面板辅助检查连通与薄弱处。
- **打印与导出**：PNG 图纸、带色号图纸、CSV 清单；可选 29×29 / 58×58 分板与柱距提示，方便按底板拼。
- **浏览器本地处理**：转换与编辑均在本机完成，图片无需上传服务器；开源 MIT，可自建部署。

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
  docs/               # 算法说明与效果截图
```

站点枢纽专属能力（分析 API、画板交接、Beadants 关卡导出）已剥离或改为 stub，本包可单独运行。

## 许可证

MIT © leexiangf — 见 [LICENSE](./LICENSE)。

## 参与贡献

欢迎 Issue 与 PR。优先小范围改动（色板数据、缺陷修复、文档）。请勿提交受 AGPL 等协议约束的第三方代码拷贝。
