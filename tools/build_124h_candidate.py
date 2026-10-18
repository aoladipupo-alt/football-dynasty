#!/usr/bin/env python3
"""1.24h: eliminate full-roster fallback searches while replaying historical transfers.

Build from 1.24g candidate only. Preserve saved career format and baseline ZIP.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

TARGET = 'game/runtime-096g.js'
MANIFEST = 'hosting-manifest-123d.json'
ORIGINAL = '            const p = byId.get(h.playerId) || FD.getPlayer(h.playerId), c = FD.getClub(h.toClubId);'
PATCHED = '''            // 1.24h: long careers may contain thousands of transfers for players
            // who have retired or moved out of the active database. Reuse the
            // local player-ID index and the same eight-hop legacy alias resolver;
            // never run a full allPlayers scan for each missing historical ID.
            const p = byId.get(h.playerId) || byId.get(FD.resolvePlayerIdAlias124c?.(h.playerId) ?? h.playerId), c = FD.getClub(h.toClubId);'''
START = '    function applyCareerTransferHistory() {'
END = '    function processLoanReturnsDaily() {'

def digest(blob:bytes)->str:
    return hashlib.sha256(blob).hexdigest()

def patch(source:str)->str:
    if any(token not in source for token in ('resolvedYouth124b','resolvePlayerIdAlias124c','seenTrainingIds124d','cachedSlotScore124e','fixtureContext124f','cupByRound124g')):
        raise RuntimeError('Missing earlier candidate modifications')
    if source.count(START)!=1 or source.count(END)!=1:
        raise RuntimeError('Unexpected transfer restore boundaries')
    start=source.index(START)
    end=source.index(END,start)
    section=source[start:end]
    if section.count(ORIGINAL)!=1 or '1.24h:' in section:
        raise RuntimeError('Unexpected transfer restore implementation')
    return source[:start]+section.replace(ORIGINAL,PATCHED)+source[end:]

def build(source:Path,output:Path,inspection:Path)->dict:
    if source.resolve()==output.resolve():
        raise ValueError('Refusing to overwrite input')
    if not source.exists():
        raise FileNotFoundError(source)
    inspection.mkdir(parents=True,exist_ok=True)
    output.parent.mkdir(parents=True,exist_ok=True)
    with ZipFile(source) as old:
        if old.testzip() is not None:
            raise ValueError('Invalid source ZIP')
        members=old.namelist()
        if len(members)!=len(set(members)) or TARGET not in members or MANIFEST not in members:
            raise ValueError('Invalid ZIP contents')
        original=old.read(TARGET)
        modified=patch(original.decode('utf-8')).encode('utf-8')
        record=json.loads(old.read(MANIFEST))
        asset=record['assets'][TARGET]
        if asset['bytes']!=len(original) or asset['sha256']!=digest(original):
            raise RuntimeError('Existing manifest mismatch')
        asset['bytes']=len(modified)
        asset['sha256']=digest(modified)
        new_manifest=(json.dumps(record,indent=2)+'\n').encode('utf-8')
        (inspection/'primary-before.js').write_bytes(original)
        (inspection/'primary-after.js').write_bytes(modified)
        updates={TARGET:modified,MANIFEST:new_manifest}
        with ZipFile(output,'w') as candidate:
            for info in old.infolist():
                candidate.writestr(info,updates.get(info.filename,old.read(info)))
    with ZipFile(source) as old,ZipFile(output) as new:
        changed=[name for name in old.namelist() if old.read(name)!=new.read(name)]
        if len(new.namelist())!=len(members) or set(changed)!={TARGET,MANIFEST} or new.testzip() is not None:
            raise RuntimeError('Unexpected output ZIP changes: '+str(changed))
    report={'source_sha256':digest(source.read_bytes()),'candidate_sha256':digest(output.read_bytes()),'changed_entries':changed,'file_count':len(members)}
    (inspection/'candidate-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,default=Path('dist/football-dynasty-site-1.24g-candidate.zip'))
    parser.add_argument('--output',type=Path,default=Path('dist/football-dynasty-site-1.24h-candidate.zip'))
    parser.add_argument('--comparison-dir',type=Path,default=Path('dist/inspection-124h'))
    args=parser.parse_args()
    build(args.source,args.output,args.comparison_dir)
