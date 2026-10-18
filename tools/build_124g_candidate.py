#!/usr/bin/env python3
"""Create an isolated 1.24g cup-calendar candidate from the verified 1.24f archive.

Never overwrite the input. Fail closed if the upstream runtime or integrity
manifest is different from the expected version.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

TARGET="game/runtime-096g.js"
MANIFEST="hosting-manifest-123d.json"
RESCHED="    function rescheduleLeagueClashesWithCup078(cupFixtures){"
PROGRESS="    function progressDomesticCups078(date=state.currentDate){"
OLD_RESC="""        const leagueIds=leagueCompetitionIds062b(),all=[...seasonFixtures,...cupFixtures];let moved=0;
        for(const cup of cupFixtures){
            const clashes=seasonFixtures.filter(f=>leagueIds.has(f.competitionId)&&!resultFor(f)?.finished&&f.date===cup.date&&
                (f.homeClubId===cup.homeClubId||f.awayClubId===cup.homeClubId||f.homeClubId===cup.awayClubId||f.awayClubId===cup.awayClubId));
            for(const league of clashes){"""
NEW_RESC="""        const leagueIds=leagueCompetitionIds062b(),all=[...seasonFixtures,...cupFixtures];let moved=0;
        // 1.24g: temporary, ordered date index instead of a full-fixture scan
        // per cup tie. Include newly rescheduled fixtures at their new dates.
        if(!cupFixtures.length)return 0;
        const leagueByDate124g=new Map(),fixtureOrder124g=new Map();
        for(let i=0;i<seasonFixtures.length;i++){
            const f=seasonFixtures[i];fixtureOrder124g.set(f,i);
            if(!leagueIds.has(f.competitionId)||resultFor(f)?.finished)continue;
            if(!leagueByDate124g.has(f.date))leagueByDate124g.set(f.date,[]);
            leagueByDate124g.get(f.date).push(f);
        }
        for(const cup of cupFixtures){
            const clashes=(leagueByDate124g.get(cup.date)||[]).filter(f=>f.date===cup.date&&
                (f.homeClubId===cup.homeClubId||f.awayClubId===cup.homeClubId||f.homeClubId===cup.awayClubId||f.awayClubId===cup.awayClubId));
            for(const league of clashes){"""
OLD_MOVE="                league.rescheduledFrom ||= old;league.rescheduleReason='FA Cup fixture congestion';league.date=next;moved++;"
NEW_MOVE="""                league.rescheduledFrom ||= old;league.rescheduleReason='FA Cup fixture congestion';league.date=next;moved++;
                // Preserve global fixture order when moves collide with later
                // cup ties during this same rescheduling call.
                if(!leagueByDate124g.has(next))leagueByDate124g.set(next,[]);
                const shifted124g=leagueByDate124g.get(next);shifted124g.push(league);
                shifted124g.sort((a,b)=>fixtureOrder124g.get(a)-fixtureOrder124g.get(b));"""
OLD_PROGRESS="""        const year=seasonYear(date);let added=0,penaltyTouched=false;
        rescheduleLeagueClashesWithCup078(seasonFixtures.filter(f=>f.competitionId==='eng-fa-cup'&&Number(f.cupSeason078??year)===Number(year)&&!resultFor(f)?.finished));
        for(let i=0;i<FA_CUP_ROUNDS_078.length;i++){
            const [round]=FA_CUP_ROUNDS_078[i],fixtures=seasonFixtures.filter(f=>f.competitionId==='eng-fa-cup'&&f.round===round&&Number(f.cupSeason078??year)===Number(year));"""
NEW_PROGRESS="""        const year=seasonYear(date);let added=0,penaltyTouched=false;
        // 1.24g: index this season's cup fixtures once and update the local
        // index as winners advance; no persistent cache or save migration.
        const cupByRound124g=new Map(),pendingCup124g=[];
        for(const f of seasonFixtures){
            if(f.competitionId!=='eng-fa-cup'||Number(f.cupSeason078??year)!==Number(year))continue;
            if(!cupByRound124g.has(f.round))cupByRound124g.set(f.round,[]);
            cupByRound124g.get(f.round).push(f);
            if(!resultFor(f)?.finished)pendingCup124g.push(f);
        }
        rescheduleLeagueClashesWithCup078(pendingCup124g);
        for(let i=0;i<FA_CUP_ROUNDS_078.length;i++){
            const [round]=FA_CUP_ROUNDS_078[i],fixtures=cupByRound124g.get(round)||[];"""
OLD_NEXT="            const nextRound=FA_CUP_ROUNDS_078[i+1][0];if(seasonFixtures.some(f=>f.competitionId==='eng-fa-cup'&&f.round===nextRound&&Number(f.cupSeason078??year)===Number(year)))continue;"
NEW_NEXT="            const nextRound=FA_CUP_ROUNDS_078[i+1][0];if((cupByRound124g.get(nextRound)||[]).length)continue;"
OLD_CREATE="            rescheduleLeagueClashesWithCup078(created);seasonFixtures=[...seasonFixtures,...created].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));added+=created.length;"
NEW_CREATE="            rescheduleLeagueClashesWithCup078(created);seasonFixtures=[...seasonFixtures,...created].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));cupByRound124g.set(nextRound,created);added+=created.length;"

def sha(content):return hashlib.sha256(content).hexdigest()
def replace_in(source,first,last,old,new):
    a=source.index(first);b=source.index(last,a);part=source[a:b]
    if part.count(old)!=1 or new in part:
        raise RuntimeError("Unexpected game code: "+first+"; matches="+str(part.count(old)))
    return source[:a]+part.replace(old,new)+source[b:]
def patch(source):
    for token in ("resolvedYouth124b","resolvePlayerIdAlias124c","seenTrainingIds124d","cachedSlotScore124e","fixtureContext124f"):
        if token not in source:raise RuntimeError("Missing prior optimization: "+token)
    if "cupByRound124g" in source or "leagueByDate124g" in source:raise RuntimeError("Already patched")
    source=replace_in(source,RESCHED,"    function recordFaCupChampion078(",OLD_RESC,NEW_RESC)
    source=replace_in(source,RESCHED,"    function recordFaCupChampion078(",OLD_MOVE,NEW_MOVE)
    source=replace_in(source,PROGRESS,"    function raceWatch078(",OLD_PROGRESS,NEW_PROGRESS)
    source=replace_in(source,PROGRESS,"    function raceWatch078(",OLD_NEXT,NEW_NEXT)
    return replace_in(source,PROGRESS,"    function raceWatch078(",OLD_CREATE,NEW_CREATE)
def build(source,output,inspection):
    if source.resolve()==output.resolve():raise ValueError("Refusing input overwrite")
    if not source.is_file():raise FileNotFoundError(source)
    output.parent.mkdir(parents=True,exist_ok=True);inspection.mkdir(parents=True,exist_ok=True)
    with ZipFile(source) as z:
        if z.testzip() is not None:raise RuntimeError("Corrupt input ZIP")
        names=z.namelist()
        if len(set(names))!=len(names) or TARGET not in names or MANIFEST not in names:
            raise RuntimeError("Missing/duplicate archive entries")
        old=z.read(TARGET);new=patch(old.decode("utf-8")).encode("utf-8")
        manifest=json.loads(z.read(MANIFEST));entry=manifest["assets"][TARGET]
        if entry["bytes"]!=len(old) or entry["sha256"]!=sha(old):
            raise RuntimeError("Input manifest mismatch")
        entry["bytes"]=len(new);entry["sha256"]=sha(new)
        updates={TARGET:new,MANIFEST:(json.dumps(manifest,indent=2)+"\n").encode("utf-8")}
        (inspection/"primary-before.js").write_bytes(old)
        (inspection/"primary-after.js").write_bytes(new)
        with ZipFile(output,"w") as updated:
            for info in z.infolist():updated.writestr(info,updates.get(info.filename,z.read(info)))
    with ZipFile(source) as a,ZipFile(output) as b:
        changed=[n for n in a.namelist() if a.read(n)!=b.read(n)]
        if set(changed)!={TARGET,MANIFEST} or len(changed)!=2 or len(names)!=len(b.namelist()) or b.testzip() is not None:
            raise RuntimeError("Candidate integrity differences: "+repr(changed))
    report={"input_sha256":sha(source.read_bytes()),"candidate_sha256":sha(output.read_bytes()),
            "changed_entries":changed,"file_count":len(names)}
    (inspection/"candidate-manifest.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2))
if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--source",type=Path,default=Path("dist/football-dynasty-site-1.24f-candidate.zip"))
    parser.add_argument("--output",type=Path,default=Path("dist/football-dynasty-site-1.24g-candidate.zip"))
    parser.add_argument("--comparison-dir",type=Path,default=Path("dist/inspection-124g"))
    a=parser.parse_args()
    build(a.source,a.output,a.comparison_dir)
