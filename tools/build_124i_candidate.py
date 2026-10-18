#!/usr/bin/env python3
"""1.24i: release previous-slot foreign academy save buffers on career handoff.

The original release and cumulative 1.24h candidate are never modified.
Source anchors, prior patches, ZIP contents and content hashes are checked.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

TARGET = "game/runtime-096g.js"
MANIFEST = "hosting-manifest-123d.json"

CACHE_ANCHOR = "    function markShadowChanged121i(){shadowSaveRevision121i++;}"
CACHE_PATCH = CACHE_ANCHOR + """
    // 1.24i: these are save-serialization caches, not gameplay state.
    // Old slot arrays and zipped buffers may be megabytes in a mature career.
    // Release them when a different save, imported save, or new career is loaded;
    // the next save safely rebuilds the archive from the current worldState.
    function releaseShadowSaveBuffers124i() {
        shadowZipCache121i='';
        shadowPackedRevision121i=-1;
        shadowPackedRows121i=null;
        lastShadowSidecar121i={slot:0,zip:null};
    }"""

HANDOFF_ANCHOR = """        if(!reuseLoaded){flushMatchSaves();flushActiveSlotMeta096z();}
        activeSaveSlot = requestedSlot;"""
# The core roster loader and the later career-management module are two
# separate IIFEs. Fresh-save migrations used a private core helper without
# defining it in the career module, so clicking Continue raised ReferenceError.
CORE_NORMALIZER = "    function normalizeRosterName(value) {"
CORE_NORMALIZER_END = "    function rosterOverrides() {"
CAREER_REPAIR = "    function repairDataOnlyProspectsSave096e() {"

HANDOFF_PATCH = """        if(!reuseLoaded){flushMatchSaves();flushActiveSlotMeta096z();}
        // Keep fast same-session resumes free of unnecessary re-encoding.
        // Forced reloads and new careers must drop the old archive reference,
        // even when they reuse the same numbered slot.
        if(requestedSlot!==activeSaveSlot||forceReload||freshSetup096y)
            releaseShadowSaveBuffers124i();
        activeSaveSlot = requestedSlot;"""

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def patch(source: str) -> str:
    for previous in (
        "resolvedYouth124b", "resolvePlayerIdAlias124c", "seenTrainingIds124d",
        "cachedSlotScore124e", "fixtureContext124f", "cupByRound124g",
        "1.24h: long careers"
    ):
        if previous not in source:
            raise RuntimeError("Missing previous candidate work: "+previous)
    if "releaseShadowSaveBuffers124i" in source:
        raise RuntimeError("Archive buffers already patched")
    if source.count(CACHE_ANCHOR)!=1 or source.count(HANDOFF_ANCHOR)!=1:
        raise RuntimeError("Unexpected runtime save-cache or career handoff logic")
    source=source.replace(CACHE_ANCHOR,CACHE_PATCH)
    source=source.replace(HANDOFF_ANCHOR,HANDOFF_PATCH)
    if source.count("releaseShadowSaveBuffers124i();")!=1:
        raise RuntimeError("Invalid cache reset placement")
    # Carry over the exact, already-shipped name-normalization implementation
    # into the distinct career-manager closure. No new migration rules.
    if source.count(CORE_NORMALIZER)!=1 or source.count(CAREER_REPAIR)!=1:
        raise RuntimeError("Unexpected normalizer or career repair layout")
    start=source.index(CORE_NORMALIZER)
    end=source.index(CORE_NORMALIZER_END,start)
    helper=source[start:end]
    if not helper.rstrip().endswith("}") or len(helper)>1000 or len(helper)<180:
        raise RuntimeError("Unexpected core normalizer implementation")
    source=source.replace(CAREER_REPAIR,helper+CAREER_REPAIR)
    if source.count(CORE_NORMALIZER)!=2:
        raise RuntimeError("Failed to provide career-scoped normalizer")
    return source

def build(source: Path, output: Path, inspection: Path) -> dict:
    if source.resolve()==output.resolve():
        raise ValueError("Source candidate must never be overwritten")
    if not source.is_file():
        raise FileNotFoundError(source)
    output.parent.mkdir(parents=True,exist_ok=True)
    inspection.mkdir(parents=True,exist_ok=True)
    with ZipFile(source) as baseline:
        if baseline.testzip() is not None:
            raise ValueError("Corrupt source game archive")
        names=baseline.namelist()
        if len(names)!=len(set(names)) or TARGET not in names or MANIFEST not in names:
            raise ValueError("Missing or duplicated ZIP entries")
        before=baseline.read(TARGET)
        after=patch(before.decode("utf-8")).encode("utf-8")
        manifest=json.loads(baseline.read(MANIFEST))
        engine=manifest["assets"][TARGET]
        if engine["bytes"]!=len(before) or engine["sha256"]!=sha(before):
            raise ValueError("Source integrity manifest does not match engine")
        engine["bytes"]=len(after)
        engine["sha256"]=sha(after)
        revised_manifest=(json.dumps(manifest,indent=2)+"\n").encode("utf-8")
        (inspection/"primary-before.js").write_bytes(before)
        (inspection/"primary-after.js").write_bytes(after)
        changes={TARGET:after,MANIFEST:revised_manifest}
        with ZipFile(output,"w") as candidate:
            for entry in baseline.infolist():
                candidate.writestr(entry,changes.get(entry.filename,baseline.read(entry)))
    with ZipFile(source) as baseline, ZipFile(output) as candidate:
        modified=[name for name in baseline.namelist()
                  if baseline.read(name)!=candidate.read(name)]
        if set(modified)!={TARGET,MANIFEST} or len(modified)!=2:
            raise ValueError("Unexpected modifications: "+str(modified))
        if len(candidate.namelist())!=len(names) or candidate.testzip() is not None:
            raise ValueError("Candidate ZIP integrity failure")
    result={
        "source_sha256":sha(source.read_bytes()),
        "candidate_sha256":sha(output.read_bytes()),
        "changed_entries":modified,
        "file_count":len(names)
    }
    (inspection/"candidate-manifest.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,indent=2))
    return result

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--source",type=Path,default=Path("dist/football-dynasty-site-1.24h-candidate.zip"))
    p.add_argument("--output",type=Path,default=Path("dist/football-dynasty-site-1.24i-candidate.zip"))
    p.add_argument("--comparison-dir",type=Path,default=Path("dist/inspection-124i"))
    a=p.parse_args()
    build(a.source,a.output,a.comparison_dir)
