#!/usr/bin/env python3
"""Build a complete isolated server WZ tree from a read-only snapshot + exact overlay.

All source files outside the approved overlay retain byte-identical SHA256s.
Snapshot/overlay drift fails; this does not deploy, contact a DB, or start Java.
"""
import argparse
import json
from pathlib import Path
import shutil
from build_release import digest


def materialize(baseline,overlay,output,source_label):
    baseline,overlay,output=map(Path,(baseline,overlay,output))
    for source in (baseline,overlay):
        if output.resolve()==source.resolve() or output.resolve().is_relative_to(source.resolve()) or source.resolve().is_relative_to(output.resolve()):
            raise ValueError('Output must be disjoint from input trees')
    if output.exists() and any(output.iterdir()):raise ValueError('Complete server XML output must be empty')
    evidence=json.loads((overlay/'merge-evidence.json').read_text())
    replacements={r['path']:r for r in evidence['files']}
    for relative,record in replacements.items():
        source=baseline/relative
        observed=digest(source) if source.exists() else None
        if observed!=record['baseline_sha256']:raise ValueError(f'Actual full baseline drifted since exact merge: {relative}')
        if digest(overlay/relative)!=record['merged_sha256']:raise ValueError(f'Exact overlay bytes drifted: {relative}')
    output.mkdir(parents=True,exist_ok=True)
    files=[];preserved=0
    sources={p.relative_to(baseline).as_posix():p for p in baseline.rglob('*') if p.is_file() and '.git' not in p.relative_to(baseline).parts}
    for relative in sorted(sources.keys()|replacements.keys()):
        source=overlay/relative if relative in replacements else sources[relative]
        if source.is_symlink():raise ValueError(f'Symlink in snapshot or overlay: {relative}')
        target=output/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
        expected=digest(source)
        if digest(target)!=expected:raise ValueError(f'Complete server XML copy mismatch: {relative}')
        preserved+=relative not in replacements
        files.append({'name':relative,'sha256':expected,'size':target.stat().st_size,
            'source':'exact-node merged overlay' if relative in replacements else 'actual deployed read-only snapshot byte-identical'})
    result={'status':'complete-isolated-candidate','source_label':source_label,'baseline':str(baseline.resolve()),
        'overlay_evidence_sha256':digest(overlay/'merge-evidence.json'),'non_target_files_byte_identical':preserved,
        'exact_overlay_files':len(replacements),'files':files,'production_writes':False,
        'usage':'Read-only server WZ path for isolated lifecycle verification; no lifecycle acceptance implied by data materialization'}
    (output/'server-corpus-provenance.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--baseline',required=True);p.add_argument('--overlay',required=True)
    p.add_argument('--output',required=True);p.add_argument('--source-label',required=True)
    a=p.parse_args();r=materialize(a.baseline,a.overlay,a.output,a.source_label)
    print(json.dumps({'status':r['status'],'files':len(r['files']),'non_target_files_byte_identical':r['non_target_files_byte_identical'],'exact_overlay_files':r['exact_overlay_files']}))
