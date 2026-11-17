#!/usr/bin/env python3
"""Gera thumbnails WebP estáticos; preserva as 82 fotos originais."""
from pathlib import Path
from PIL import Image, ImageOps
import json

source = Path("img/cardapio")
target = Path("img/cardapio-lite")
target.mkdir(parents=True, exist_ok=True)
photos = sorted(source.glob("*.webp"))
if len(photos) != 82:
    raise SystemExit(f"ERRO: esperadas 82 imagens de catálogo, recebidas {len(photos)}")
original_bytes = optimized_bytes = 0
items = []
for photo in photos:
    output = target / photo.name
    with Image.open(photo) as image:
        picture = ImageOps.exif_transpose(image)
        picture.thumbnail((560, 560), Image.Resampling.LANCZOS)
        if picture.mode not in ("RGB", "RGBA"):
            picture = picture.convert("RGB")
        picture.save(output, "WEBP", quality=67, method=6, exif=b"")
        width, height = picture.size
    before, after = photo.stat().st_size, output.stat().st_size
    original_bytes += before
    optimized_bytes += after
    if after >= before:
        raise SystemExit(f"ERRO: thumbnail maior que a original: {photo.name}")
    items.append({"file": photo.name, "bytes": after, "width": width, "height": height})
report = {
    "source_count": len(photos),
    "original_total_bytes": original_bytes,
    "optimized_total_bytes": optimized_bytes,
    "saved_percent": round(100 * (1 - optimized_bytes/original_bytes), 1),
    "variant": "max_dimension_560_webp_quality_67",
    "images": items
}
(target / "optimization-report.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(f"{len(photos)} WebP leves: {optimized_bytes/1024/1024:.2f} MiB"
      f" vs {original_bytes/1024/1024:.2f} MiB; economia {report['saved_percent']}%")
if optimized_bytes >= original_bytes * 0.65:
    raise SystemExit("Economia inferior a 35%; rever processamento")
