#!/usr/bin/env python3
"""1.24b: build an opt-in, save-format-compatible candidate from the released ZIP.

The main deployment ZIP is NEVER modified. Refuse to patch unexpected engine text.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

TARGET = "game/runtime-096g.js"
OLD = """            const liveYouth=[];
            for (const y of youth) { const p=FD.getPlayer(y.id); if(p) liveYouth.push(p); }
            if (liveYouth.length) FD.normalizeIntegerPlayerStats?.(liveYouth);
            worldState.youth = youth.map(y => {
                const p = FD.getPlayer(y.id);
                return p ? { ...p, positions:[...(p.positions||[])], attributes:{...(p.attributes||{})}, development:{...(p.development||{})} } : y;
            });"""
NEW = """            // 1.24b: resolve each youth ID once; normalization still runs before
            // snapshot cloning, and unresolved IDs retain their original row.
            const resolvedYouth124b = youth.map(y => FD.getPlayer(y.id) || null);
            const liveYouth = resolvedYouth124b.filter(Boolean);
            if (liveYouth.length) FD.normalizeIntegerPlayerStats?.(liveYouth);
            worldState.youth = youth.map((y, i) => {
                const p = resolvedYouth124b[i];
                return p ? { ...p, positions:[...(p.positions||[])], attributes:{...(p.attributes||{})}, development:{...(p.development||{})} } : y;
            });"""

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def build(source: Path, output: Path, comparison_dir: Path):
    if source.resolve() == output.resolve():
        raise ValueError("Source release archive must not be overwritten")
    if not source.is_file():
        raise FileNotFoundError(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    comparison_dir.mkdir(parents=True, exist_ok=True)
    with ZipFile(source) as old_zip:
        if old_zip.testzip() is not None:
            raise RuntimeError("Corrupt baseline game archive")
        names = old_zip.namelist()
        if len(names) != len(set(names)) or TARGET not in names:
            raise RuntimeError("Archive missing target file or has duplicate names")
        original = old_zip.read(TARGET).decode("utf-8")
        if original.count(OLD) != 1 or "resolvedYouth124b" in original:
            raise RuntimeError("Unexpected baseline engine: refusing an unsafe patch")
        patched = original.replace(OLD, NEW)
        if patched.count(NEW) != 1:
            raise RuntimeError("Patch assertion failed")
        (comparison_dir / "primary-before.js").write_text(original, encoding="utf-8")
        (comparison_dir / "primary-after.js").write_text(patched, encoding="utf-8")
        with ZipFile(output, "w") as new_zip:
            for info in old_zip.infolist():
                # Preserve per-file compression, names, timestamps and metadata.
                data = patched.encode("utf-8") if info.filename == TARGET else old_zip.read(info)
                new_zip.writestr(info, data)
    with ZipFile(source) as old_zip, ZipFile(output) as new_zip:
        changed = [name for name in old_zip.namelist()
                   if old_zip.read(name) != new_zip.read(name)]
        if changed != [TARGET] or new_zip.testzip() is not None:
            raise RuntimeError(f"Candidate integrity failure, changed={changed}")
        if len(old_zip.namelist()) != len(new_zip.namelist()):
            raise RuntimeError("Archive member count changed")
    result = {"source_sha256": digest(source.read_bytes()),
              "candidate_sha256": digest(output.read_bytes()),
              "modified_files": changed,
              "baseline_files": len(names),
              "source_bytes": source.stat().st_size,
              "candidate_bytes": output.stat().st_size}
    (comparison_dir / "candidate-manifest.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("football-dynasty-site.zip"))
    parser.add_argument("--output", type=Path, default=Path("dist/football-dynasty-site-1.24b-candidate.zip"))
    parser.add_argument("--comparison-dir", type=Path, default=Path("dist/inspection"))
    args = parser.parse_args()
    build(args.source, args.output, args.comparison_dir)
