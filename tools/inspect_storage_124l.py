#!/usr/bin/env python3
"""Bounded runtime save-path inspection for 1.24l cutover design."""
from pathlib import Path
from zipfile import ZipFile
import re

with ZipFile('dist/football-dynasty-site-1.24k-vault-candidate.zip') as z:
    engine=z.read('game/runtime-096g.js').decode()
    page=z.read('game/index.html').decode()
for token in [
    'function readCareerStored(', 'function writeCareerStored(',
    'function readStored(', 'function writeStored(',
    'function loadSaveSlot(', 'function saveCareer(', 'function flushMatchSaves(',
    'function slotStorageKey(', 'function loadCareerFromSaveSlot(',
    'function saveSlot(', 'function switchCareer(', 'function setActiveSaveSlot(',
    'function renderSaveManager(', 'function importCareer(',
    "fd-player-career-state-v1", 'FDCareerVault124k',
]:
    idx=engine.find(token)
    print('###',token,'count',engine.count(token),'offset',idx)
    if idx>=0:print(engine[max(idx-180,0):idx+1450].replace('\r',''))
print('### game HTML script references')
for line in page.splitlines():
    if '<script' in line or 'runtime-096g' in line:print(line.strip()[:250])
