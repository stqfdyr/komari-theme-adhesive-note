#!/usr/bin/env python3
"""从分层 Blender 母版派生首页卡片纸张素材。

    python3 scripts/assets/make-sheets.py <母版目录> [输出目录] \
        [--variants=a-left-point,...] [--prefix=<前缀>]

母版目录必须包含 `paper-<variant>-layered.png` 和由
`compose_layered_masters.py` 生成的 `composition-manifest.json`。@1x 与 @2x
都由 cwebp 直接从无损母版缩放编码，不能从 WebP 互转。

`--variants` 用来只派生单卡 PoC；`--prefix` 给输出文件名加前缀，让另一套
打光的素材（`paper-<前缀><variant>@1x.webp`）与现有素材共存于同一目录——
前提是两套的画布、纸张尺寸与 CSS 换算完全相同，只有光照不同。

依赖：cwebp（libwebp）
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


VARIANTS = ("a-left-point", "b-left-band", "c-mid-point", "d-mid-band")
CANVAS_MM = (176.0, 165.8)
SHEET_MM = (140.0, 129.8)
WIDTH_2X = 1236
QUALITY = 94
ALPHA_QUALITY = 100
METHOD = 6


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_cwebp() -> str:
    configured = os.environ.get("CWEBP")
    if configured:
        path = Path(configured).expanduser()
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
        raise FileNotFoundError(f"CWEBP 不可执行：{path}")
    discovered = shutil.which("cwebp")
    if discovered:
        return discovered
    homebrew = Path("/opt/homebrew/bin/cwebp")
    if homebrew.is_file():
        return str(homebrew)
    raise FileNotFoundError("找不到 cwebp；请安装 libwebp 或设置 CWEBP=/path/to/cwebp")


def encode(cwebp: str, source: Path, output: Path, width: int, height: int) -> None:
    subprocess.run(
        [
            cwebp,
            "-quiet",
            "-q",
            str(QUALITY),
            "-alpha_q",
            str(ALPHA_QUALITY),
            "-m",
            str(METHOD),
            "-resize",
            str(width),
            str(height),
            str(source),
            "-o",
            str(output),
        ],
        check=True,
    )
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError(f"cwebp 未生成有效文件：{output}")


def option(name: str, default: str) -> str:
    prefix = f"--{name}="
    return next(
        (item[len(prefix) :] for item in sys.argv[1:] if item.startswith(prefix)),
        default,
    )


def main() -> None:
    positional = [item for item in sys.argv[1:] if not item.startswith("--")]
    if not positional:
        print(__doc__)
        raise SystemExit(2)

    masters = Path(positional[0]).resolve()
    output_dir = Path(
        positional[1] if len(positional) > 1 else "src/assets/sheets"
    ).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    cwebp = find_cwebp()

    variants = tuple(
        item for item in option("variants", ",".join(VARIANTS)).split(",") if item
    )
    unknown = set(variants) - set(VARIANTS)
    if unknown:
        raise SystemExit(f"未知变体：{sorted(unknown)}")
    name_prefix = option("prefix", "")

    composition_manifest = masters / "composition-manifest.json"
    if not composition_manifest.is_file():
        raise FileNotFoundError(composition_manifest)
    composition = json.loads(composition_manifest.read_text(encoding="utf-8"))
    reports = composition.get("variants", {})

    height_2x = round(WIDTH_2X * CANVAS_MM[1] / CANVAS_MM[0])
    scales = (("@1x", WIDTH_2X // 2, height_2x // 2), ("@2x", WIDTH_2X, height_2x))
    print(f"画布 {CANVAS_MM[0]}×{CANVAS_MM[1]} mm，纸 {SHEET_MM[0]}×{SHEET_MM[1]} mm")
    print(
        "CSS 容器换算："
        f"宽 {100 * CANVAS_MM[0] / SHEET_MM[0]:.3f}%  "
        f"高 {100 * CANVAS_MM[1] / SHEET_MM[1]:.3f}%  "
        f"left {50 * (1 - CANVAS_MM[0] / SHEET_MM[0]):.3f}%  "
        f"top {50 * (1 - CANVAS_MM[1] / SHEET_MM[1]):.3f}%"
    )
    print(f"编码器 {cwebp}，q={QUALITY} alpha_q={ALPHA_QUALITY} method={METHOD}")

    total = 0
    output_manifest: dict[str, dict[str, object]] = {}
    for variant in variants:
        source = masters / f"paper-{variant}-layered.png"
        if not source.is_file():
            raise FileNotFoundError(source)
        report = reports.get(variant)
        if not isinstance(report, dict):
            raise RuntimeError(f"composition manifest 缺少 {variant}")
        if report.get("width") != 1865 or report.get("height") != 1757:
            raise RuntimeError(f"{variant} 母版尺寸异常：{report.get('width')}×{report.get('height')}")
        if float(report.get("edge_max", 1.0)) > 0.01:
            raise RuntimeError(f"{variant} 画布边缘 alpha 未归零：{report.get('edge_max')}")
        expected_sha = report.get("combined_sha256")
        actual_sha = sha256(source)
        if expected_sha != actual_sha:
            raise RuntimeError(f"{variant} 母版哈希与 composition manifest 不一致")

        derived: dict[str, object] = {}
        lines: list[str] = []
        for suffix, width, height in scales:
            output = output_dir / f"paper-{name_prefix}{variant}{suffix}.webp"
            encode(cwebp, source, output, width, height)
            size = output.stat().st_size
            total += size
            digest = sha256(output)
            derived[suffix] = {
                "name": output.name,
                "width": width,
                "height": height,
                "bytes": size,
                "sha256": digest,
            }
            lines.append(f"{suffix} {width}×{height} {size / 1024:6.1f}KB sha256={digest[:12]}")
        output_manifest[variant] = {
            "source": source.name,
            "source_sha256": actual_sha,
            "edge_max": report["edge_max"],
            "derived": derived,
        }
        print(f"{variant:<14} " + "\n               ".join(lines))

    derived_manifest = {
        "schema": 1,
        "profile": masters.name,
        "canvas_mm": list(CANVAS_MM),
        "sheet_mm": list(SHEET_MM),
        "quality": QUALITY,
        "alpha_quality": ALPHA_QUALITY,
        "method": METHOD,
        "cwebp": cwebp,
        "variants": output_manifest,
    }
    manifest_path = output_dir / f"sheet-assets-manifest{'-' + name_prefix.rstrip('-') if name_prefix else ''}.json"
    manifest_path.write_text(json.dumps(derived_manifest, indent=2) + "\n", encoding="utf-8")
    print(f"\n合计 {total / 1024:.1f} KB（两档；浏览器按 DPR 只取其一）")
    print(f"派生清单 {manifest_path}")


if __name__ == "__main__":
    main()
