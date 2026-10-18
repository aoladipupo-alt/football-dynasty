#!/usr/bin/env python3
"""Build opt-in 1.24k IndexedDB safety-vault candidate (non-destructive phase 1).

Never modifies the 1.24j ZIP. Explicitly aborts on unexpected engine or UI anchors,
conflicting ZIP members, corrupt input, or inconsistent asset hashes.
"""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

RUNTIME='game/runtime-096g.js'
PAGE='game/index.html'
NEW='game/durable-career-vault-124k.js'
MANIFEST='hosting-manifest-123d.json'
PAGE_ANCHOR='  <script src="device-mode-096g.js?v=123a-save-transfer"></script>'
PAGE_NEW='  <script src="durable-career-vault-124k.js?v=124k"></script>\n'+PAGE_ANCHOR
UI_OLD="  bar.append(save,load,recover,input);host.replaceChildren(bar);"
UI_NEW="""  // 1.24k phase 1: explicit, verified IndexedDB safety checkpoints.
  // Do NOT remove localStorage saves until the full durable-save migration
  // and its cross-browser crash-recovery tests are complete.
  const protect=element('button','Protect career (IndexedDB)','small-btn');
  const protectedExport=element('button','Download protected checkpoint','small-btn');
  protect.addEventListener('click',async()=>{
    protect.disabled=true;
    try{
      notice('Creating an independently verified career checkpoint…');
      const result=await window.FDCareerVault124k.checkpointLocal(slot());
      notice('Career '+result.slot+' protected in IndexedDB (checkpoint '+result.revision+').');
    }catch(error){notice('Protected checkpoint was not created: '+String(error?.message||error));}
    finally{protect.disabled=false;}
  });
  protectedExport.addEventListener('click',async()=>{
    protectedExport.disabled=true;
    try{
      const backup=await window.FDCareerVault124k.exportPortable(slot(),validateBackup);
      downloadBackup(backup,'football-dynasty-protected-career-'+slot()+'.json');
      notice('Verified protected checkpoint downloaded as portable career JSON.');
    }catch(error){notice('Cannot download protected checkpoint: '+String(error?.message||error));}
    finally{protectedExport.disabled=false;}
  });
  bar.append(save,load,recover,protect,protectedExport,input);host.replaceChildren(bar);"""

def sha(blob): return hashlib.sha256(blob).hexdigest()
def once(source,old,new,label):
    if source.count(old)!=1 or new in source:
        raise ValueError('Unexpected '+label+' source, aborting candidate')
    return source.replace(old,new)
def build(source,output,script):
    if source.resolve()==output.resolve():raise ValueError('Cannot overwrite source')
    if not source.is_file() or not script.is_file():raise FileNotFoundError('Missing candidate input')
    output.parent.mkdir(parents=True,exist_ok=True)
    with ZipFile(source) as old:
        if old.testzip() is not None:raise ValueError('Input ZIP is corrupt')
        names=old.namelist()
        if len(names)!=len(set(names)) or any(x not in names for x in [RUNTIME,PAGE,MANIFEST]) or NEW in names:
            raise ValueError('Unexpected ZIP contents')
        meta=json.loads(old.read(MANIFEST))
        for name in [PAGE,RUNTIME]:
            record=meta['assets'][name]
            original=old.read(name)
            if record['bytes']!=len(original) or record['sha256']!=sha(original):
                raise ValueError('Baseline integrity failed: '+name)
        runtime=once(old.read(RUNTIME).decode(),UI_OLD,UI_NEW,'backup UI').encode()
        page=once(old.read(PAGE).decode(),PAGE_ANCHOR,PAGE_NEW,'device loader').encode()
        vault=script.read_bytes()
        if b'FDCareerVault124k' not in vault:raise ValueError('Invalid IndexedDB vault module')
        updated={PAGE:page,RUNTIME:runtime,NEW:vault}
        for name in [PAGE,RUNTIME]:
            meta['assets'][name]['bytes']=len(updated[name]);meta['assets'][name]['sha256']=sha(updated[name])
        meta['assets'][NEW]={'minBytes':3000,'mime':'javascript','bytes':len(vault),'sha256':sha(vault)}
        updated[MANIFEST]=(json.dumps(meta,indent=2)+'\n').encode()
        with ZipFile(output,'w') as dest:
            for info in old.infolist():dest.writestr(info,updated.get(info.filename,old.read(info)))
            dest.writestr(NEW,vault)
    with ZipFile(source) as old,ZipFile(output) as new:
        changed=[k for k in old.namelist() if old.read(k)!=new.read(k)]
        if set(changed)!={RUNTIME,PAGE,MANIFEST} or len(new.namelist())!=len(names)+1 or new.testzip() is not None:
            raise ValueError('Unexpected archive changes: '+repr(changed))
    result={'file_count':len(names)+1,'modified':changed,'added':NEW,
            'candidate_sha256':sha(output.read_bytes())}
    print(json.dumps(result,indent=2));return result
if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,default=Path('dist/football-dynasty-site-1.24j-candidate.zip'))
    parser.add_argument('--output',type=Path,default=Path('dist/football-dynasty-site-1.24k-vault-candidate.zip'))
    parser.add_argument('--script',type=Path,default=Path('game/durable-career-vault-124k.js'))
    opts=parser.parse_args();build(opts.source,opts.output,opts.script)
