# HysCode brand assets (Vortex)

Canonical logo sources. Rule: **flat (sem borda) inside the app and the TUI**,
**borded (com borda) at OS level** (app/taskbar/dock icon, installers).

| File | Source | Use |
|---|---|---|
| `vortex.png` | `img-logos/Vortex_new logo png.png` (1254x1254, flat) | In-app raster fallback, favicon PNG source, TUI ASCII raster reference |
| `vortex-flat.svg` | `img-logos/vortex_new_desktop_logo2.svg` (normalized: fixed 512x512, no serif namespace) | Official in-app vector (`BrandMark`, `index.html` icon), README |
| `vortex-borded.png` | `img-logos/Vortex_new logo png_borded.png` (1254x1254, black border) | Upstream da fonte com margem, **não** usar direto (conteúdo encosta na borda: margem T/B ~1%) |
| `vortex-borded-1024.png` | Derivada de `vortex-borded.png`: conteúdo reescalado num canvas 1024x1024 com quiet-zone ~12–15% | **Fonte canônica para `apps/desktop/src-tauri/icons/*`** (ico/icns/pngs) e BMPs do instalador |
| `vortex-borded.svg` | `img-logos/vortex_new_desktop_logo.svg` (normalized) | Large-format reserve with border (docs/OGP), not used in-app |

Regenerate OS icons with:

```sh
python scripts/regen-icons.py
```

O script lê `assets/brand/vortex-borded-1024.png` e regenera tudo com Pillow/LANCZOS:
PNGs base (`icon.png`, `app-icon.png`, `32x32`, `64x64`, `128x128`, `128x128@2x`),
tiles Windows (`Square*`, `StoreLogo`), mipmaps Android, iconset iOS,
`icon.ico` (15 entradas: 16→256, cobrindo HiDPI 125/150/175%),
`icon.icns` (11 entradas: 16→1024) e os BMPs do instalador
(`nsis-header.bmp` 150x57, `nsis-sidebar.bmp` 164x314, fundo `#0B0E11`).

> `npx tauri icon` gera um `icon.ico` sem os tamanhos intermediários de HiDPI
> do Windows (20/30/36/40/60/72/80/96) e achata a margem da arte original —
> por isso o pixelado/serrilhado na taskbar. Não usar até o CLI cobrir isso.

Regenerate the TUI ASCII logo (`tools/hyscode-tui/src/logo.ts`) with:

```sh
node scripts/render-cli-logo.mjs
```

Do not hand-edit generated icons. Product/branch rules live in `AGENTS.md`.
