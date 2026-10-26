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
RUNTIME='game/runtime-096g.js'
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

        engine=old.read(RUNTIME)
        if (manifest['assets'][RUNTIME]['bytes']!=len(engine) or
            manifest['assets'][RUNTIME]['sha256']!=digest(engine)):
            raise ValueError('Baseline runtime checksum mismatch')
        runtime=engine.decode('utf8')
        begin=runtime.index('    function pitchHtml(formation, assignments, pool, roles, rankings097e=null) {')
        end=runtime.index('    function syncStarterSet063m(plan){',begin)
        section=runtime[begin:end]
        line='        const slots = FORMATIONS[formation];'
        new_line="""        const slots = FORMATIONS[formation];
        // 1.24m: space the display rows evenly without touching role or squad data.
        const distinctYs=[...new Set(slots.map(row=>Number(row[3])))].sort((a,b)=>a-b);
        const bands=[];
        for(const y of distinctYs){
            const last=bands[bands.length-1];
            if(last&&y-last.max<=8){last.max=y;last.values.push(y);}
            else bands.push({max:y,values:[y]});
        }
        const boardHeight124m=Math.max(1450,bands.length*315);
        const placeY124m=y=>{
            const i=bands.findIndex(row=>row.values.includes(Number(y)));
            return bands.length<=1?50:10+80*i/(bands.length-1);
        };"""
        if section.count(line)!=1:raise ValueError('Unexpected pitch function layout')
        section=section.replace(line,new_line)
        pitch_open='<div class="pitch tactics-pitch tactics-pitch-063m">'
        pitch_new='<div class="pitch tactics-pitch tactics-pitch-063m" style="--fd-xi-height:${boardHeight124m}px">'
        if section.count(pitch_open)!=1:raise ValueError('No tactical pitch tag')
        section=section.replace(pitch_open,pitch_new)
        position_old='style="left:${x}%;top:${y}%"'
        position_new='style="left:${x}%;top:${placeY124m(y)}%"'
        if section.count(position_old)!=1:raise ValueError('No tactical pitch coordinates')
        section=section.replace(position_old,position_new)
        new_engine=(runtime[:begin]+section+runtime[end:]).encode('utf8')
        manifest['assets'][RUNTIME].update(bytes=len(new_engine),sha256=digest(new_engine))
        manifest['assets'][PAGE].update(bytes=len(changed),sha256=digest(changed))
        manifest['assets'][CSS]={'minBytes':1000,'mime':'css',
                                 'bytes':len(css),'sha256':digest(css)}
        replacements={PAGE:changed,RUNTIME:new_engine,MANIFEST:(json.dumps(manifest,indent=2)+'\n').encode()}
        with ZipFile(output,'w') as new:
            for info in old.infolist():
                new.writestr(info,replacements.get(info.filename,old.read(info)))
            new.writestr(CSS,css)
    with ZipFile(source) as old,ZipFile(output) as new:
        modified={p for p in old.namelist() if old.read(p)!=new.read(p)}
        if modified!={PAGE,MANIFEST,RUNTIME} or new.testzip() or len(new.namelist())!=len(names)+1:
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
