#!/usr/bin/env python3
"""Non-deploying 1.24m tactics UI candidate built over validated 1.24k vault."""
from pathlib import Path
from zipfile import ZipFile
import argparse
import hashlib
import json

PAGE='game/index.html'
CSS='game/tactics-xi-124m.css'
MANIFEST='hosting-manifest-123d.json'
TAG='<link rel="stylesheet" href="tactics-xi-124m.css?v=124m" />'

def digest(data):return hashlib.sha256(data).hexdigest()
def build(source,output):
    if source.resolve()==output.resolve():raise ValueError('Refusing to overwrite baseline')
    output.parent.mkdir(parents=True,exist_ok=True)
    with ZipFile(source) as old:
        if old.testzip():raise ValueError('Source failed ZIP CRC check')
        names=old.namelist()
        if len(names)!=len(set(names)) or CSS in names:raise ValueError('Unexpected source ZIP files')
        if PAGE not in names or MANIFEST not in names:raise ValueError('Missing source assets')
        page=old.read(PAGE)
        css=Path(CSS).read_bytes()
        manifest=json.loads(old.read(MANIFEST))
        if (manifest['assets'][PAGE]['bytes']!=len(page) or
            manifest['assets'][PAGE]['sha256']!=digest(page)):
            raise ValueError('Baseline HTML checksum mismatch')
        text=page.decode('utf8')
        if text.count('</head>')!=1 or TAG in text:raise ValueError('Unsafe HTML injection anchor')
        changed=(text.replace('</head>','  '+TAG+'\n</head>')).encode('utf8')
        manifest['assets'][PAGE].update(bytes=len(changed),sha256=digest(changed))
        manifest['assets'][CSS]={'minBytes':1000,'mime':'css',
                                 'bytes':len(css),'sha256':digest(css)}
        replacements={PAGE:changed,MANIFEST:(json.dumps(manifest,indent=2)+'\n').encode()}
        with ZipFile(output,'w') as new:
            for info in old.infolist():
                new.writestr(info,replacements.get(info.filename,old.read(info)))
            new.writestr(CSS,css)
    with ZipFile(source) as old,ZipFile(output) as new:
        modified={p for p in old.namelist() if old.read(p)!=new.read(p)}
        if modified!={PAGE,MANIFEST} or new.testzip() or len(new.namelist())!=len(names)+1:
            raise RuntimeError('Unexpected files changed: '+repr(modified))
    result={'new_css':CSS,'changed_entries':sorted(modified),'files':len(names)+1,
            'sha256':digest(output.read_bytes())}
    print(json.dumps(result,indent=2))
    return result

if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('--source',type=Path,default=Path('dist/football-dynasty-site-1.24k-vault-candidate.zip'))
    ap.add_argument('--output',type=Path,default=Path('dist/football-dynasty-site-1.24m-tactics-candidate.zip'))
    args=ap.parse_args()
    build(args.source,args.output)
