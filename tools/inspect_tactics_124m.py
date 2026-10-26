#!/usr/bin/env python3
from zipfile import ZipFile
from pathlib import Path
import re
p=Path('dist/football-dynasty-site-1.24k-vault-candidate.zip')
terms=['tactics-workspace-063m','tactics-layout-063m','tactics-pitch-card-063m','tactics-pitch-063m','drag-slot','tactics-squad','tactics-team','tactics-roster','pitch-player','lineup-player','fd55-pitch','fd55-player','tactics-selected','tactics-pitch','player-bubble']
with ZipFile(p) as z:
 for name in z.namelist():
  if not name.endswith(('.css','.html','.js')):continue
  s=z.read(name).decode('utf8','replace')
  hits=[term for term in terms if term in s]
  if not hits:continue
  print('\nFILE',name,'size',len(s),'hits',hits)
  if name.endswith('.css') or name.endswith('.html'):
   for term in terms:
    if term not in s:continue
    pos=[m.start() for m in re.finditer(re.escape(term),s)]
    print(' SELECTOR',term,'count',len(pos))
    for at in pos[:7]:print('  '+s[max(0,at-180):at+350].replace('\n',' ')[:540])
  elif name.endswith('runtime-096g.js'):
   for term in ['function pitchHtml(', 'const squadPanel=','const content=phase','<div class="tactics-workspace-063m"']:
    at=s.find(term)
    print('\n MARKUP',term,'at',at)
    if at>=0:print(s[at:at+6700])
print('\nHTML style references')
with ZipFile(p) as z:
 s=z.read('game/index.html').decode()
 for line in s.splitlines():
  if '<link' in line or '<style' in line:print(line.strip()[:220])
