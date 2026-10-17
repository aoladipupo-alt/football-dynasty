#!/usr/bin/env python3
"""1.24d: patch O(n^2) daily training deduplication in the isolated candidate.

Run build_124b_candidate.py first (that intermediate includes 1.24b + 1.24c).
This script never modifies the original release or the intermediate archive.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

TARGET = "game/runtime-096g.js"
MANIFEST = "hosting-manifest-123d.json"
OLD = "        const trainableSquad = [...currentPlayers(), ...academyPlayers()].filter((p, i, arr) => !p.profilePending && arr.findIndex(x => x.id === p.id) === i && !(p.transferType === 'Loan' && p.parentClubId === state.selectedClubId));"
NEW = """        // 1.24d: deduplicate the combined squad once rather than calling
        // findIndex across the entire roster for every training-day player.
        // Mark IDs before eligibility checks: a later duplicate must not become
        // eligible when its first occurrence was pending or a parent-club loan.
        const seenTrainingIds124d = new Set();
        const trainableSquad = [...currentPlayers(), ...academyPlayers()].filter(p => {
            if (seenTrainingIds124d.has(p.id)) return false;
            seenTrainingIds124d.add(p.id);
            return !p.profilePending && !(p.transferType === 'Loan' && p.parentClubId === state.selectedClubId);
        });"""


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build(source: Path, output: Path, inspect_dir: Path) -> dict:
    if source.resolve() == output.resolve():
        raise ValueError("Candidate source must not be overwritten")
    if not source.is_file():
        raise FileNotFoundError(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    inspect_dir.mkdir(parents=True, exist_ok=True)
    with ZipFile(source) as baseline:
        if baseline.testzip() is not None:
            raise RuntimeError("Invalid input game archive")
        paths = baseline.namelist()
        if len(paths) != len(set(paths)) or TARGET not in paths or MANIFEST not in paths:
            raise RuntimeError("Missing target/manifest or duplicate names")
        original_bytes = baseline.read(TARGET)
        original = original_bytes.decode("utf-8")
        if original.count(OLD) != 1 or "seenTrainingIds124d" in original:
            raise RuntimeError("Unexpected training implementation: refusing patch")
        # Keep prior candidate work intact; do not accidentally patch old release.
        if "resolvedYouth124b" not in original or "resolvePlayerIdAlias124c" not in original:
            raise RuntimeError("Intermediate candidate is missing prior regression fixes")
        patched = original.replace(OLD, NEW)
        if patched.count(NEW) != 1:
            raise RuntimeError("Training patch assertion failed")
        patched_bytes = patched.encode("utf-8")
        manifest = json.loads(baseline.read(MANIFEST))
        record = manifest["assets"][TARGET]
        if record["bytes"] != len(original_bytes) or record["sha256"] != sha(original_bytes):
            raise RuntimeError("Intermediate candidate integrity manifest mismatch")
        record["bytes"] = len(patched_bytes)
        record["sha256"] = sha(patched_bytes)
        new_manifest = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
        (inspect_dir / "primary-before.js").write_text(original, encoding="utf-8")
        (inspect_dir / "primary-after.js").write_text(patched, encoding="utf-8")
        update = {TARGET: patched_bytes, MANIFEST: new_manifest}
        with ZipFile(output, "w") as updated:
            for info in baseline.infolist():
                updated.writestr(info, update.get(info.filename, baseline.read(info)))
    with ZipFile(source) as baseline, ZipFile(output) as candidate:
        changed = [name for name in baseline.namelist()
                   if baseline.read(name) != candidate.read(name)]
        if len(candidate.namelist()) != len(paths) or set(changed) != {TARGET, MANIFEST} or len(changed) != 2:
            raise RuntimeError(f"Unexpected changed file set: {changed}")
        if candidate.testzip() is not None:
            raise RuntimeError("Candidate archive failed ZIP integrity test")
    report = {
        "input_sha256": sha(source.read_bytes()),
        "candidate_sha256": sha(output.read_bytes()),
        "changed_entries": changed,
        "file_count": len(paths),
        "engine_before_bytes": len(original_bytes),
        "engine_after_bytes": len(patched_bytes),
    }
    (inspect_dir / "candidate-manifest.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--source", type=Path, default=Path("dist/football-dynasty-site-1.24b-candidate.zip"))
    p.add_argument("--output", type=Path, default=Path("dist/football-dynasty-site-1.24d-candidate.zip"))
    p.add_argument("--comparison-dir", type=Path, default=Path("dist/inspection-124d"))
    args = p.parse_args()
    build(args.source, args.output, args.comparison_dir)
