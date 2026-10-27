# Fast Bead

**English** | [中文](./README.zh-CN.md)

Open-source **photo → perler / fuse-bead pattern** generator.

Upload a photo in the browser, map it to brand bead palettes, clean noise, follow-place while crafting, and export printable sheets. **No upload to a server** — processing stays on your device.

- Live product mirror: [fastgames.cn/tools/perler](https://fastgames.cn/tools/perler/)
- Repository: [github.com/leexiangf/fast_bead](https://github.com/leexiangf/fast_bead)

Inspired by the broader perler-tool ecosystem (e.g. [Zippland/perler-beads](https://github.com/Zippland/perler-beads), [Jett-Wu/Perler_Beads_Generator](https://github.com/Jett-Wu/Perler_Beads_Generator)) — this codebase is an independent implementation under **MIT**.

## Features

- Multi-brand palettes (MARD / COCO / Manman / Panpan / Mixiaowo / Artkal / Perler / Hama / …)
- Photo / flat-art pipelines (including FS v2 dither path)
- Background remove, edit tools, sparse color merge
- Inventory colors, bead counts, CSV / PNG / print boards
- Craft “follow” mode with local progress + drafts (IndexedDB / localStorage)

## Quick start

```bash
git clone https://github.com/leexiangf/fast_bead.git
cd fast_bead
npx --yes serve -l 5173 .
```

Open `http://localhost:5173`.

Or open `index.html` via any static file server (required for ES-less relative loads / some browsers’ `file://` limits).

## Layout

```
fast_bead/
  index.html          # app shell
  css/                # UI
  js/                 # palettes, quantize, craft, i18n
  templates/          # sample photo
  docs/               # algorithm notes
```

Hub-only pieces (analytics Worker, paint handoff, Beadants level export) are stubbed or removed so the package runs alone.

## License

MIT © leexiangf — see [LICENSE](./LICENSE).

## Contributing

Issues and PRs welcome. Prefer small, focused changes (palette data, bug fixes, docs). Please do not submit copies of AGPL-licensed third-party code.
