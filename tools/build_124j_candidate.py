#!/usr/bin/env python3
"""1.24j isolated candidate: compress large player-state saves without losing history.

Uses the existing UTF-8 LZW codec. Backups/export remain plain, portable JSON.
Must build from the successful 1.24i candidate; never modifies the live site.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

TARGET = 'game/runtime-096g.js'
MANIFEST = 'hosting-manifest-123d.json'
FORMAT = "fd-player-career-lzw-124j"

KEY = "    const PLAYER_STATE_STORAGE_KEY = 'fd-player-career-state-v1';"
KEY_NEW = KEY + "\n    const PLAYER_STATE_COMPRESSED_FORMAT_124J = '"+FORMAT+"';"
READ = """        const value=readStored(slotStorageKey(slot, key), fallback);
        if(key!==WORLD_STORAGE_KEY)return value;"""
READ_NEW = """        const value=readStored(slotStorageKey(slot, key), fallback);
        if(key===PLAYER_STATE_STORAGE_KEY&&value?.format===PLAYER_STATE_COMPRESSED_FORMAT_124J){
            // Preserve all old raw JSON careers. Decode only our explicitly
            // versioned player-state format; never discard corrupt save bytes.
            if(typeof value.zip!=='string'||value.zip.length>20000000)
                throw Error('Invalid compressed player-state save. Keep the backup.');
            const recovered=JSON.parse(FDShadowCodec121i.unzip(value.zip));
            if(!recovered||typeof recovered!=='object'||Array.isArray(recovered))
                throw Error('Invalid player-state object. Do not overwrite this save.');
            return recovered;
        }
        if(key!==WORLD_STORAGE_KEY)return value;"""
WRITE = """    function writeCareerStored(key, value) {
        let payload=value;
        if(key===WORLD_STORAGE_KEY"""
WRITE_NEW = """    function writeCareerStored(key, value) {
        let payload=value;
        if(key===PLAYER_STATE_STORAGE_KEY&&value&&typeof value==='object'&&!Array.isArray(value)){
            // 1.24j: large, full-career snapshots can exhaust localStorage
            // after a second occupied save slot. Only disk bytes are changed.
            // The read path and exported JSON both restore the exact object.
            const raw=JSON.stringify(value);
            if(raw.length>=180000){
                const zip=FDShadowCodec121i.zip(raw);
                if(zip.length<raw.length*.92)
                    payload={format:PLAYER_STATE_COMPRESSED_FORMAT_124J,zip};
            }
        }
        if(key===WORLD_STORAGE_KEY"""
EXPORT = """  if(data['fd-world-state-v043']?.shadowSidecar121i){"""
EXPORT_NEW = """  // Download/export remains an ordinary JSON career, readable by old builds.
  if(data['fd-player-career-state-v1']?.format==='fd-player-career-lzw-124j'){
   const zip=data['fd-player-career-state-v1'].zip;
   if(typeof zip!=='string'||zip.length>20000000)throw Error('Player-state archive is invalid; backup cancelled.');
   const expanded=JSON.parse(window.FDShadowCodec121i.unzip(zip));
   if(!expanded||typeof expanded!=='object'||Array.isArray(expanded))throw Error('Player-state archive is invalid; backup cancelled.');
   data['fd-player-career-state-v1']=expanded;
  }
  if(data['fd-world-state-v043']?.shadowSidecar121i){"""
RECOVERY = "function recoveryBackup(){"
RECOVERY_END = "function availability(p){"
RECOVERY_RETURN = " return {format:'football-dynasty-restored-career',version:1,createdAt:new Date().toISOString(),data};}"
RECOVERY_NEW = """ if(data['fd-player-career-state-v1']?.format==='fd-player-career-lzw-124j'){
  const zip=data['fd-player-career-state-v1'].zip;
  if(typeof zip!=='string'||zip.length>20000000)throw Error('Recovery player archive is invalid.');
  data['fd-player-career-state-v1']=JSON.parse(window.FDShadowCodec121i.unzip(zip));
 }
 return {format:'football-dynasty-restored-career',version:1,createdAt:new Date().toISOString(),data};}"""

def sha(blob:bytes)->str:return hashlib.sha256(blob).hexdigest()
def swap(source:str,needle:str,replacement:str,scope:str)->str:
    if source.count(needle)!=1 or replacement in source:
        raise RuntimeError(f"Unexpected {scope} implementation: {source.count(needle)} matches")
    return source.replace(needle,replacement)
def patch(source:str)->str:
    for token in ("resolvedYouth124b","resolvePlayerIdAlias124c","seenTrainingIds124d",
                  "cachedSlotScore124e","fixtureContext124f","cupByRound124g",
                  "releaseShadowSaveBuffers124i"):
        if token not in source:raise RuntimeError("Missing prior optimization "+token)
    if FORMAT in source:raise RuntimeError("Already compressed")
    source=swap(source,KEY,KEY_NEW,"storage key")
    source=swap(source,READ,READ_NEW,"reader")
    source=swap(source,WRITE,WRITE_NEW,"writer")
    if source.count(EXPORT)!=1:raise RuntimeError("Unexpected export implementation")
    source=source.replace(EXPORT,EXPORT_NEW)
    a=source.index(RECOVERY);b=source.index(RECOVERY_END,a)
    block=source[a:b]
    if block.count(RECOVERY_RETURN)!=1:
        raise RuntimeError("Unexpected recovery backup implementation")
    source=source[:a]+block.replace(RECOVERY_RETURN,RECOVERY_NEW)+source[b:]
    return source

def build(source:Path,output:Path,inspection:Path):
    if source.resolve()==output.resolve():raise ValueError("Refusing to overwrite source")
    if not source.exists():raise FileNotFoundError(source)
    output.parent.mkdir(parents=True,exist_ok=True)
    inspection.mkdir(parents=True,exist_ok=True)
    with ZipFile(source) as original:
        if original.testzip() is not None:raise RuntimeError("Input archive CRC failed")
        names=original.namelist()
        if len(names)!=len(set(names)) or TARGET not in names or MANIFEST not in names:
            raise RuntimeError("Archive missing required entries or has duplicates")
        raw=original.read(TARGET)
        updated=patch(raw.decode('utf-8')).encode('utf-8')
        manifest=json.loads(original.read(MANIFEST))
        record=manifest['assets'][TARGET]
        if record['bytes']!=len(raw) or record['sha256']!=sha(raw):
            raise RuntimeError("Source integrity manifest mismatch")
        record['bytes']=len(updated);record['sha256']=sha(updated)
        (inspection/'primary-before.js').write_bytes(raw)
        (inspection/'primary-after.js').write_bytes(updated)
        changes={TARGET:updated,MANIFEST:(json.dumps(manifest,indent=2)+'\n').encode('utf-8')}
        with ZipFile(output,'w') as candidate:
            for entry in original.infolist():
                candidate.writestr(entry,changes.get(entry.filename,original.read(entry)))
    with ZipFile(source) as original,ZipFile(output) as candidate:
        changed=[n for n in original.namelist() if original.read(n)!=candidate.read(n)]
        if set(changed)!={TARGET,MANIFEST} or len(changed)!=2 or len(candidate.namelist())!=len(names) or candidate.testzip() is not None:
            raise RuntimeError("Archive content changed unexpectedly: "+repr(changed))
    result={'source_sha256':sha(source.read_bytes()),'candidate_sha256':sha(output.read_bytes()),
            'changed_entries':changed,'file_count':len(names)}
    (inspection/'candidate-manifest.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--source',type=Path,default=Path('dist/football-dynasty-site-1.24i-candidate.zip'))
    p.add_argument('--output',type=Path,default=Path('dist/football-dynasty-site-1.24j-candidate.zip'))
    p.add_argument('--comparison-dir',type=Path,default=Path('dist/inspection-124j'))
    a=p.parse_args()
    build(a.source,a.output,a.comparison_dir)
