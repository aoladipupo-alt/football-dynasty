#!/usr/bin/env python3
from zipfile import ZipFile
from pathlib import Path
import re
p=Path('dist/football-dynasty-site-1.24k-vault-candidate.zip')
needles=['ATTACKING XI','TEAM SELECTION IN POSSESSION','TAP TO SWAP','tactics-pitch','tactic-pitch','tactics-xi','formation-pitch','player-chip','lineup-pitch','squad-relative','in possession','team selection','xi-pitch']
with ZipFile(p) as z:
 for name in z.namelist():
  if not name.endswith(('.css','.html','.js')): continue
  try:s=z.read(name).decode()
  except:continue
  found=[]
  for needle in needles:
   for match in list(re.finditer(re.escape(needle),s,re.I))[:3]:
    found.append((match.start(),needle))
  if found:
   print('== MATCH FILE ==',name,'chars',len(s),'found',found[:18])
   for pos,needle in sorted(found)[:22]:
    start=max(0,pos-1200);end=min(len(s),pos+2400)
    print('\n---',needle,pos,'---\n',s[start:end][:3700])
