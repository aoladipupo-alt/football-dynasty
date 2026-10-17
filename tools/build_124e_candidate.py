#!/usr/bin/env python3
"""1.24e: reduce repeated AI lineup suitability calculations in matchday simulation.

Build the preceding 1.24d candidate first. This only writes a new candidate ZIP;
the verified published 1.23f archive and previous candidates are never overwritten.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

TARGET = "game/runtime-096g.js"
MANIFEST = "hosting-manifest-123d.json"
FUNCTION_START = "    function autoAssign(playerIds, formation) {"
FUNCTION_END = "    function defaultClubPlan() {"
ANCHOR = "        const used = new Set(), assignments = {};"
CACHE = """        // 1.24e: a formation picks many slots from the same roster. Evaluate
        // each player/position suitability once per assignment, not on every
        // comparison performed by Array.sort (no changes to player rankings).
        const scoresByPosition124e = new Map();
        const cachedSlotScore124e = (player, pos) => {
            let scores = scoresByPosition124e.get(pos);
            if (!scores) { scores = new Map(); scoresByPosition124e.set(pos, scores); }
            if (!scores.has(player)) scores.set(player, playerSlotScore(player, pos));
            return scores.get(player);
        };
"""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def patch(source: str) -> str:
    if source.count(FUNCTION_START) != 1 or source.count(FUNCTION_END) != 1:
        raise ValueError("Unexpected lineup implementation: refusing patch")
    if "cachedSlotScore124e" in source:
        raise ValueError("Already patched lineup")
    if any(key not in source for key in ("resolvedYouth124b", "resolvePlayerIdAlias124c", "seenTrainingIds124d")):
        raise ValueError("Source is missing 1.24b/1.24c/1.24d fixes")
    start = source.index(FUNCTION_START)
    end = source.index(FUNCTION_END, start)
    before = source[start:end]
    if before.count("playerSlotScore(") != 5 or before.count(ANCHOR) != 1:
        raise ValueError("Unexpected lineup scorer or assignment body")
    after = before.replace("playerSlotScore(", "cachedSlotScore124e(")
    after = after.replace(ANCHOR, ANCHOR + "\n" + CACHE)
    # The cached function must call the REAL scorer, never recurse.
    after = after.replace("scores.set(player, cachedSlotScore124e(player, pos))",
                          "scores.set(player, playerSlotScore(player, pos))")
    if after.count("playerSlotScore(") != 1 or after.count("cachedSlotScore124e(") != 5:
        raise ValueError("Unexpected scoring cache expansion")
    return source[:start] + after + source[end:]


def build(source: Path, output: Path, comparison_dir: Path):
    if source.resolve() == output.resolve():
        raise ValueError("Refusing to overwrite source candidate")
    if not source.is_file():
        raise FileNotFoundError(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    comparison_dir.mkdir(parents=True, exist_ok=True)
    with ZipFile(source) as z:
        if z.testzip() is not None:
            raise ValueError("Corrupt incoming game archive")
        names = z.namelist()
        if len(names) != len(set(names)) or TARGET not in names or MANIFEST not in names:
            raise ValueError("Game archive has duplicate names or missing required entries")
        before_raw = z.read(TARGET)
        before = before_raw.decode("utf-8")
        after = patch(before)
        after_raw = after.encode("utf-8")
        manifest = json.loads(z.read(MANIFEST))
        record = manifest["assets"][TARGET]
        if record["bytes"] != len(before_raw) or record["sha256"] != digest(before_raw):
            raise ValueError("Existing engine failed integrity manifest")
        record["bytes"] = len(after_raw)
        record["sha256"] = digest(after_raw)
        new_manifest = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
        (comparison_dir / "primary-before.js").write_text(before, encoding="utf-8")
        (comparison_dir / "primary-after.js").write_text(after, encoding="utf-8")
        updated_entries = {TARGET: after_raw, MANIFEST: new_manifest}
        with ZipFile(output, "w") as candidate:
            for info in z.infolist():
                candidate.writestr(info, updated_entries.get(info.filename, z.read(info)))
    with ZipFile(source) as before_zip, ZipFile(output) as candidate:
        changed = [n for n in before_zip.namelist()
                   if before_zip.read(n) != candidate.read(n)]
        if set(changed) != {TARGET, MANIFEST} or len(changed) != 2:
            raise RuntimeError(f"Unexpected changes: {changed}")
        if len(candidate.namelist()) != len(names) or candidate.testzip() is not None:
            raise RuntimeError("Candidate archive integrity check failed")
    report = {"input_sha256": digest(source.read_bytes()),
              "candidate_sha256": digest(output.read_bytes()),
              "changed_entries": changed, "file_count": len(names)}
    (comparison_dir / "candidate-manifest.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("dist/football-dynasty-site-1.24d-candidate.zip"))
    parser.add_argument("--output", type=Path, default=Path("dist/football-dynasty-site-1.24e-candidate.zip"))
    parser.add_argument("--comparison-dir", type=Path, default=Path("dist/inspection-124e"))
    args = parser.parse_args()
    build(args.source, args.output, args.comparison_dir)
