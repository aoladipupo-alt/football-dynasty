#!/usr/bin/env python3
"""Build opt-in 1.24f candidate: index players per club for continental AI fixtures.

The verified release and 1.24e input ZIP are never modified.
Unexpected source code or asset hashes abort instead of producing a candidate.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

TARGET = "game/runtime-096g.js"
MANIFEST = "hosting-manifest-123d.json"
FUNC = "function simulateFixture(season,fixture,clubs,players){"
FUNC_NEW = "function simulateFixture(season,fixture,clubs,players,context124f=null){"
BY_CLUB = "byClub=new Map(clubs.map(c=>[c.id,c]));"
BY_CLUB_NEW = "byClub=context124f?.byClub||new Map(clubs.map(c=>[c.id,c]));"
XI = " const xi=id=>players.filter(p=>p.clubId===id&&!p.retired&&!p.profilePending&&!loanUnavailable085b(p)&&(Number(p.age)||Number(p.simulationAge071g)||24)>=16&&Number(p.overall)>0&&(p.registrationGroup!=='U21'||Number(p.overall)>=72)).sort((a,b)=>Number(b.overall)-Number(a.overall)).slice(0,11);"
XI_NEW = """ const eligibleXI124f=roster=>roster.filter(p=>!p.retired&&!p.profilePending&&!loanUnavailable085b(p)&&(Number(p.age)||Number(p.simulationAge071g)||24)>=16&&Number(p.overall)>0&&(p.registrationGroup!=='U21'||Number(p.overall)>=72)).sort((a,b)=>Number(b.overall)-Number(a.overall)).slice(0,11);
 const xi=id=>{
  if(!context124f)return players.filter(p=>p.clubId===id&&!p.retired&&!p.profilePending&&!loanUnavailable085b(p)&&(Number(p.age)||Number(p.simulationAge071g)||24)>=16&&Number(p.overall)>0&&(p.registrationGroup!=='U21'||Number(p.overall)>=72)).sort((a,b)=>Number(b.overall)-Number(a.overall)).slice(0,11);
  if(!context124f.lineups.has(id))context124f.lineups.set(id,eligibleXI124f(context124f.playerGroups.get(id)||[]));
  return context124f.lineups.get(id);
 };"""
ADV = "function advance(season,{throughDate,clubs,players,selectedClubId=null}={}){\n let played=0,generated=0;"
ADV_NEW = """function advance(season,{throughDate,clubs,players,selectedClubId=null}={}){
 let played=0,generated=0;
 // 1.24f: initialize only when an AI fixture needs playing. One club index
 // per advance, with cached eligible lineups reused during knockout passes.
 // Neither the fixture RNG nor any career save is modified by this cache.
 let context124f=null;
 const fixtureContext124f=()=>{
  if(context124f)return context124f;
  const playerGroups=new Map();
  for(const p of players){
   let group=playerGroups.get(p.clubId);
   if(!group){group=[];playerGroups.set(p.clubId,group);}
   group.push(p);
  }
  context124f={byClub:new Map(clubs.map(c=>[c.id,c])),playerGroups,lineups:new Map()};
  return context124f;
 };"""
CALL = "if(record(season,f,simulateFixture(season,f,clubs,players)))played++;"
CALL_NEW = "if(record(season,f,simulateFixture(season,f,clubs,players,fixtureContext124f())))played++;"

def sha(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()

def exact_replace(source: str, original: str, replacement: str) -> str:
    if source.count(original) != 1 or replacement in source:
        raise RuntimeError("Unexpected fixture runtime or previously applied patch")
    return source.replace(original, replacement)

def patch(source: str) -> str:
    if any(token not in source for token in
           ("resolvedYouth124b","resolvePlayerIdAlias124c","seenTrainingIds124d","cachedSlotScore124e")):
        raise RuntimeError("Missing a previous optimization")
    if source.count(FUNC)!=1 or source.count(ADV)!=1 or source.count(CALL)!=1:
        raise RuntimeError("Unexpected continental module")
    # Scope the club-map and XI changes to the exact simulateFixture function,
    # avoiding accidental replacements elsewhere in the large game engine.
    a=source.index(FUNC)
    b=source.index("\nfunction advance(",a)
    block=source[a:b]
    block=exact_replace(block,FUNC,FUNC_NEW)
    block=exact_replace(block,BY_CLUB,BY_CLUB_NEW)
    block=exact_replace(block,XI,XI_NEW)
    source=source[:a]+block+source[b:]
    return exact_replace(exact_replace(source,ADV,ADV_NEW),CALL,CALL_NEW)

def build(source: Path, output: Path, inspection: Path):
    if source.resolve()==output.resolve():
        raise ValueError("Refusing to overwrite source candidate")
    if not source.is_file(): raise FileNotFoundError(source)
    output.parent.mkdir(parents=True,exist_ok=True)
    inspection.mkdir(parents=True,exist_ok=True)
    with ZipFile(source) as z:
        if z.testzip() is not None: raise RuntimeError("Corrupt input archive")
        paths=z.namelist()
        if len(paths)!=len(set(paths)) or TARGET not in paths or MANIFEST not in paths:
            raise RuntimeError("Missing or duplicate ZIP entries")
        original_bytes=z.read(TARGET)
        original=original_bytes.decode("utf-8")
        modified=patch(original)
        modified_bytes=modified.encode("utf-8")
        manifest=json.loads(z.read(MANIFEST))
        record=manifest["assets"][TARGET]
        if record["bytes"]!=len(original_bytes) or record["sha256"]!=sha(original_bytes):
            raise RuntimeError("Input asset integrity manifest mismatch")
        record["bytes"]=len(modified_bytes)
        record["sha256"]=sha(modified_bytes)
        modified_manifest=(json.dumps(manifest,indent=2)+"\n").encode("utf-8")
        (inspection/"primary-before.js").write_text(original,encoding="utf-8")
        (inspection/"primary-after.js").write_text(modified,encoding="utf-8")
        updates={TARGET:modified_bytes,MANIFEST:modified_manifest}
        with ZipFile(output,"w") as candidate:
            for entry in z.infolist():
                candidate.writestr(entry,updates.get(entry.filename,z.read(entry)))
    with ZipFile(source) as before,ZipFile(output) as after:
        changed=[name for name in before.namelist()
                 if before.read(name)!=after.read(name)]
        if set(changed)!={TARGET,MANIFEST} or len(changed)!=2 or len(after.namelist())!=len(paths) or after.testzip() is not None:
            raise RuntimeError("Candidate ZIP integrity failed: "+repr(changed))
    result={"input_sha256":sha(source.read_bytes()),"candidate_sha256":sha(output.read_bytes()),
            "changed_entries":changed,"file_count":len(paths)}
    (inspection/"candidate-manifest.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,indent=2))
    return result

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--source",type=Path,default=Path("dist/football-dynasty-site-1.24e-candidate.zip"))
    parser.add_argument("--output",type=Path,default=Path("dist/football-dynasty-site-1.24f-candidate.zip"))
    parser.add_argument("--comparison-dir",type=Path,default=Path("dist/inspection-124f"))
    args=parser.parse_args()
    build(args.source,args.output,args.comparison_dir)
