#!/usr/bin/env bash
# ============================================================================
# HysCode — Local release build for Linux (x64), run inside WSL.
# Mirrors the build-linux job of .github/workflows/release.yml but keeps every
# artifact in a local output directory instead of uploading it to GitHub.
#
# Invoked by scripts/release-local.ps1 -Linux. Can also run standalone after
# the version files were already bumped:
#   wsl bash scripts/release-local-linux.sh --version 0.9.0 --output <dir>
#
# Produces:
#   - hyscode_*.deb / *.rpm / *.AppImage        (Tauri bundles)
#   - vortex-cli-<version>-linux-x64.tar.gz     (standalone VORTEX CLI archive)
#   - vortex-cli-<version>-linux-x64.deb        (standalone VORTEX CLI deb)
#   - HysCode-Setup-<version>-linux-x64-with-vortex-cli.deb
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
DESKTOP="$ROOT/apps/desktop"
TAURI_DIR="$DESKTOP/src-tauri"
BUNDLE_DIR="$TAURI_DIR/target/release/bundle"

VERSION=""
OUTPUT_DIR=""
SKIP_SIDECAR_BUILD=0
SKIP_DEPS=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version)
            VERSION="$2"; shift 2 ;;
        --output)
            OUTPUT_DIR="$2"; shift 2 ;;
        --skip-sidecar-build)
            SKIP_SIDECAR_BUILD=1; shift ;;
        --skip-deps)
            SKIP_DEPS=1; shift ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1 ;;
    esac
done

if [[ -z "$VERSION" || -z "$OUTPUT_DIR" ]]; then
    echo "Usage: release-local-linux.sh --version <ver> --output <dir> [--skip-sidecar-build] [--skip-deps]" >&2
    exit 1
fi
if [[ ! -f "$TAURI_DIR/tauri.conf.json" ]]; then
    echo "ERROR: could not locate the repository from $ROOT" >&2
    exit 1
fi

# Non-interactive shells do not source ~/.profile: put the user-local
# toolchain bins (rustup, bun) on PATH so the prerequisite checks pass.
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"

if [[ "$(uname -m)" != "x86_64" ]]; then
    echo "ERROR: this script produces x86_64 artifacts only (detected: $(uname -m))" >&2
    exit 1
fi

IS_PRERELEASE=0
if [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+- ]]; then
    IS_PRERELEASE=1
fi

run_as_root() {
    if [[ "$(id -u)" -eq 0 ]]; then
        "$@"
    elif [[ -n "${HYCODE_WSL_SUDO_PASSWORD:-}" ]]; then
        # Non-interactive sudo: password comes from the environment
        # (forwarded from Windows via WSLENV) — never hardcoded.
        echo "$HYCODE_WSL_SUDO_PASSWORD" | sudo -S -p '' "$@"
    else
        sudo "$@"
    fi
}

echo ""
echo "================================================="
echo "  HysCode — Local release build (Linux x64)"
echo "  Version : $VERSION"
if [[ $IS_PRERELEASE -eq 1 ]]; then echo "  Channel : pre-release"; else echo "  Channel : stable"; fi
echo "  Output  : $OUTPUT_DIR"
echo "  GitHub  : no interaction (local artifacts)"
echo "================================================="
echo ""

# ── Step 1: Check prerequisites ─────────────────────────────────────────────
echo ""
echo "[1/8] Checking prerequisites..."

for tool in rustc cargo node npm bun; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "ERROR: missing required tool: $tool" >&2
        exit 1
    fi
    echo "  ✓ $tool"
done

echo "  Checking system dependencies..."
MISSING_DEPS=()
for pkg in libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev libssl-dev librsvg2-dev patchelf libfuse2 binutils; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        MISSING_DEPS+=("$pkg")
    fi
done
if [[ ${#MISSING_DEPS[@]} -gt 0 ]]; then
    echo "  ⚠ Missing system packages:" >&2
    printf "    - %s\n" "${MISSING_DEPS[@]}" >&2
    if [[ -t 0 ]]; then
        read -rp "  Install now? [Y/n] " answer
        if [[ "$answer" == "n" || "$answer" == "N" ]]; then
            echo "  Aborted." >&2
            exit 1
        fi
    fi
    run_as_root apt-get update
    run_as_root apt-get install -y "${MISSING_DEPS[@]}"
fi
echo "  ✓ System dependencies OK"

# ── Step 2: Prepare AppImage tooling for Bun sidecars ───────────────────────
echo ""
echo "[2/8] Preparing AppImage tooling for Bun sidecars..."
# Bun-compiled sidecar binaries crash glibc's loader when traced: ldd exits 1,
# so linuxdeploy aborts the AppImage bundle. Bun binaries only link
# blacklisted system libs, so report success without output for them.
if [[ -w /usr/local/bin ]]; then
    LDD_TARGET=/usr/local/bin/ldd
else
    LDD_TARGET=$(mktemp --dry-run /usr/local/bin/ldd 2>/dev/null || echo "$HOME/.local/bin/ldd")
    mkdir -p "$(dirname "$LDD_TARGET")"
fi
cat > "$LDD_TARGET" <<'EOF'
#!/bin/sh
REAL_LDD=/usr/bin/ldd
"$REAL_LDD" "$@"
rc=$?
if [ "$rc" -ne 0 ] && [ -n "$1" ] && [ -f "$1" ]; then
  if readelf -S "$1" 2>/dev/null | grep -q '\.bun'; then
    exit 0
  fi
fi
exit "$rc"
EOF
chmod +x "$LDD_TARGET"
if [[ "$LDD_TARGET" != "/usr/local/bin/ldd" ]]; then
    run_as_root cp "$LDD_TARGET" /usr/local/bin/ldd
    chmod +x /usr/local/bin/ldd
fi
# Seed tauri's tool cache with a linuxdeploy build whose patchelf handles
# Bun-compiled ELF files (the pinned 2024 build corrupts them).
mkdir -p "$HOME/.cache/tauri"
if [[ ! -f "$HOME/.cache/tauri/linuxdeploy-x86_64.AppImage" ]]; then
    curl -fsSL \
        https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage \
        -o "$HOME/.cache/tauri/linuxdeploy-x86_64.AppImage"
fi
chmod +x "$HOME/.cache/tauri/linuxdeploy-x86_64.AppImage"
echo "  ✓ AppImage tooling ready"

# ── Step 3: Install dependencies ─────────────────────────────────────────────
if [[ $SKIP_DEPS -eq 1 ]]; then
    echo ""
    echo "[3/8] Skip dependency install (--skip-deps)"
    echo "  Reusing the existing node_modules (run 'npm ci' after a checkout)"
else
    echo ""
    echo "[3/8] Installing Node dependencies..."
    cd "$ROOT"
    npm ci || npm install
    echo "  ✓ Dependencies installed"
fi

# ── Step 4: Build AI sidecars ────────────────────────────────────────────────
if [[ $SKIP_SIDECAR_BUILD -eq 1 ]]; then
    echo ""
    echo "[4/8] Skip AI sidecar build (--skip-sidecar-build)"
    echo "  Reusing existing binaries in apps/desktop/src-tauri/binaries"
else
    echo ""
    echo "[4/8] Building AI sidecars..."
    npm run build:sidecars
    echo "  ✓ Sidecars built"
fi

# ── Step 5: Build Tauri bundles (deb + rpm + AppImage) ──────────────────────
echo ""
echo "[5/8] Building Tauri bundles (deb, rpm, AppImage)..."
cd "$DESKTOP"
export APPIMAGE_EXTRACT_AND_RUN="1"
export NO_STRIP="true"
failed=1
for attempt in 1 2 3; do
    echo "  tauri build (attempt $attempt/3)"
    if npm run tauri build -- --bundles deb,rpm,appimage; then
        failed=0
        break
    fi
    echo "  ⚠ tauri build attempt $attempt/3 failed; retrying in 30s..." >&2
    sleep 30
done
if [[ $failed -ne 0 ]]; then
    echo "ERROR: tauri build failed after 3 attempts" >&2
    exit 1
fi
cd "$ROOT"
echo "  ✓ Tauri bundles built"

# ── Step 6: Build and smoke-test VORTEX CLI bundle ──────────────────────────
echo ""
echo "[6/8] Building VORTEX CLI bundle..."
npm run build:vortex -- --skip-sidecar-build --version "$VERSION"
CLI_BUNDLE="$ROOT/tools/hyscode-tui/dist/vortex-production"
CLI_VERSION="$("$CLI_BUNDLE/vortex" --version)"
if [[ "$CLI_VERSION" != "vortex $VERSION" ]]; then
    echo "ERROR: VORTEX version smoke test failed: $CLI_VERSION (expected 'vortex $VERSION')" >&2
    exit 1
fi
echo "  ✓ VORTEX smoke test: $CLI_VERSION"

# ── Step 7: Package VORTEX CLI (archive + deb) ──────────────────────────────
echo ""
echo "[7/8] Packaging VORTEX CLI..."
STAGING_DIR="$OUTPUT_DIR/vortex-cli"
mkdir -p "$STAGING_DIR"
node "$ROOT/scripts/package-vortex-cli.mjs" \
    --bundle "$CLI_BUNDLE" \
    --output-dir "$STAGING_DIR" \
    --version "$VERSION" \
    --platform linux \
    --arch x64
node "$ROOT/scripts/package-vortex-deb.mjs" \
    --mode standalone \
    --bundle "$CLI_BUNDLE" \
    --output-dir "$STAGING_DIR" \
    --version "$VERSION" \
    --arch x64
DESKTOP_DEB=$(find "$BUNDLE_DIR/deb" -maxdepth 1 -type f -name '*.deb' -print -quit)
if [[ -z "$DESKTOP_DEB" ]]; then
    echo "ERROR: desktop Debian package was not produced" >&2
    exit 1
fi
node "$ROOT/scripts/package-vortex-deb.mjs" \
    --mode desktop-with-cli \
    --bundle "$CLI_BUNDLE" \
    --desktop-deb "$DESKTOP_DEB" \
    --output-dir "$STAGING_DIR" \
    --version "$VERSION" \
    --arch x64
echo "  ✓ VORTEX CLI packaged"

# ── Step 8: Stage release artifacts ─────────────────────────────────────────
echo ""
echo "[8/8] Staging release artifacts..."
cp "$BUNDLE_DIR/deb/"*.deb "$OUTPUT_DIR/"
cp "$BUNDLE_DIR/rpm/"*.rpm "$OUTPUT_DIR/"
cp "$BUNDLE_DIR/appimage/"*.AppImage "$OUTPUT_DIR/"
mv "$STAGING_DIR"/* "$OUTPUT_DIR/"
rmdir "$STAGING_DIR"
echo "  ✓ Artifacts staged"

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "================================================="
echo "  Local release complete (Linux x64)"
echo "  Version : $VERSION"
echo "  Output  : $OUTPUT_DIR"
echo "================================================="
echo ""
echo "  Generated files:"
find "$OUTPUT_DIR" -maxdepth 1 -type f | sort | while read -r file; do
    size=$(du -h "$file" | cut -f1)
    echo "    $(basename "$file") ($size)"
done
echo ""
echo "  Notes:"
echo "    • Nothing was committed, tagged, pushed, or uploaded."
echo "    • ARM64, Windows, and macOS assets are produced by CI only."
echo "    • Building on /mnt/<drive> (WSL) is slower than a native Linux build."
echo ""
