#!/usr/bin/env python3
"""Extract inspectable runtime code from the committed game archive (analysis only)."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

archive = Path("football-dynasty-site.zip")
target = Path("inspection/runtime")
manifest_path = Path("inspection/archive-manifest.json")
target.mkdir(parents=True, exist_ok=True)
extensions = {".js", ".mjs", ".html", ".py", ".json", ".css"}
with ZipFile(archive) as z:
    entries = []
    for info in z.infolist():
        path = PurePosixPath(info.filename)
        if info.is_dir():
            continue
        if path.is_absolute() or ".." in path.parts:
            raise ValueError(f"Unsafe archive member: {info.filename!r}")
        entries.append({
            "path": info.filename, "bytes": info.file_size,
            "compressed_bytes": info.compress_size,
            "crc32": f"{info.CRC:08x}", "kind": path.suffix.lower(),
        })
    manifest = {
        "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "files": entries, "file_count": len(entries),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    candidates = [e for e in entries if PurePosixPath(e["path"]).suffix.lower() in extensions]
    candidates.sort(key=lambda e: (PurePosixPath(e["path"]).suffix.lower() != ".html", PurePosixPath(e["path"]).suffix.lower() not in {".js", ".py"}, -e["bytes"]))
    selected = candidates[:50]
    total = 0
    for entry in selected:
        if total + entry["bytes"] > 30000000:
            continue
        data = z.read(entry["path"])
        try:
            decoded = data.decode("utf-8")
        except UnicodeDecodeError:
            continue
        out = target / entry["path"]
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(decoded, encoding="utf-8")
        total += len(data)
    print(f"Archive files: {len(entries)}; candidate text files: {len(candidates)}; extraction total: {total}")
    for entry in sorted(candidates, key=lambda x: -x["bytes"])[:30]:
        print(f'{entry["bytes"]:>10} {entry["path"]}')
    print("Inspection copies only: released ZIP left untouched.")
