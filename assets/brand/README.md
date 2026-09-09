# HysCode brand assets (Vortex)

Canonical logo sources. Rule: **flat (sem borda) inside the app and the TUI**,
**borded (com borda) at OS level** (app/taskbar/dock icon, installers).

| File | Source | Use |
|---|---|---|
| `vortex.png` | `img-logos/Vortex_new logo png.png` (1254x1254, flat) | In-app raster fallback, favicon PNG source, TUI ASCII raster reference |
| `vortex-flat.svg` | `img-logos/vortex_new_desktop_logo2.svg` (normalized: fixed 512x512, no serif namespace) | Official in-app vector (`BrandMark`, `index.html` icon), README |
| `vortex-borded.png` | `img-logos/Vortex_new logo png_borded.png` (1254x1254, black border) | Source for `apps/desktop/src-tauri/icons/*` (ico/icns/pngs), installer BMPs |
| `vortex-borded.svg` | `img-logos/vortex_new_desktop_logo.svg` (normalized) | Large-format reserve with border (docs/OGP), not used in-app |

Regenerate OS icons with:

```sh
npx tauri icon assets/brand/vortex-borded.png
```

Regenerate the TUI ASCII logo (`tools/hyscode-tui/src/logo.ts`) with:

```sh
node scripts/render-cli-logo.mjs
```

Do not hand-edit generated icons. Product/branch rules live in `AGENTS.md`.
