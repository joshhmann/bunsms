#!/usr/bin/env python3
"""Read-only actual deployed WZ tree equivalence and exact-delta apply preflight.

Remote commands only resolve a path, enumerate files and calculate SHA256s.
No remote writes, database access, service action or deployment is performed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
from build_release import digest


def verify(host,remote,baseline,overlay,complete,output):
    baseline,overlay,complete,output=map(Path,(baseline,overlay,complete,output))
    if output.exists():raise ValueError('Do not overwrite baseline lineage evidence')
    canonical=subprocess.check_output(['ssh',host,'readlink -f '+shlex.quote(remote)],text=True).strip()
    # Follow the mounted WZ symlink and any effective runtime file links. Ignore
    # .git bookkeeping consistently with isolated materialization, not WZ data.
    command='find -L '+shlex.quote(canonical)+' -type d -name .git -prune -o -type f -exec sha256sum --zero -- {} +'
    data=subprocess.check_output(['ssh',host,command])
    observed={}
    for entry in data.split(b'\0'):
        if not entry:continue
        sha=entry[:64].decode('ascii');absolute=entry[66:].decode('utf-8')
        if len(sha)!=64 or any(c not in '0123456789abcdef' for c in sha):raise ValueError('Malformed remote SHA256 record')
        prefix=canonical.rstrip('/')+'/'
        if not absolute.startswith(prefix):raise ValueError('Remote hash escaped canonical WZ tree')
        relative=absolute[len(prefix):]
        if relative in observed:raise ValueError('Duplicate remote runtime file')
        observed[relative]=sha
    local={p.relative_to(baseline).as_posix():digest(p) for p in baseline.rglob('*')
        if p.is_file() and '.git' not in p.relative_to(baseline).parts}
    missing=sorted(observed.keys()-local.keys());extra=sorted(local.keys()-observed.keys())
    different=[p for p in sorted(observed.keys()&local.keys()) if observed[p]!=local[p]]
    evidence=json.loads((overlay/'merge-evidence.json').read_text());guards=[]
    replacements={r['path']:r for r in evidence['files']}
    for path,entry in replacements.items():
        before=observed.get(path);expected=entry['baseline_sha256']
        guards.append({'path':path,'expected_baseline_sha256':expected,'actual_deployed_sha256':before,
            'expected_absent':expected is None,'input_guard_pass':before==expected,
            'approved_merged_sha256':entry['merged_sha256'],'approved_merged_size':entry['size'],
            'explicit_targets':entry['explicit_targets'],
            'non_target_semantic_sha256':entry['original_non_target_semantic_sha256'],
            'non_target_nodes_preserved':entry['original_non_target_nodes_preserved']})
    complete_files={p.relative_to(complete).as_posix():p for p in complete.rglob('*')
        if p.is_file() and p.name!='server-corpus-provenance.json'}
    unchanged=[p for p in observed if p not in replacements]
    lost_or_changed=[p for p in unchanged if p not in complete_files or digest(complete_files[p])!=observed[p]]
    unexpected=sorted(complete_files.keys()-(observed.keys()|replacements.keys()))
    target_changed=[p for p,r in replacements.items() if p not in complete_files or digest(complete_files[p])!=r['merged_sha256']]
    success=not(missing or extra or different or lost_or_changed or unexpected or target_changed) and all(g['input_guard_pass'] for g in guards)
    def tree_hash(files):
        h=hashlib.sha256()
        for path,sha in sorted(files.items()):h.update(path.encode()+b'\0'+bytes.fromhex(sha))
        return h.hexdigest()
    result={'status':'pass' if success else 'refused','actual_deployed':{'host':host,'requested':remote,'canonical':canonical,
        'method':'read-only SSH GNU find -L + sha256sum --zero; .git excluded','files':len(observed),'tree_sha256':tree_hash(observed)},
        'captured_baseline':{'path':str(baseline.resolve()),'files':len(local),'tree_sha256':tree_hash(local),
            'missing':missing,'extra':extra,'different':different},
        'complete_candidate':{'path':str(complete.resolve()),'files':len(complete_files),
            'non_target_files_byte_identical_to_actual_deployed':len(unchanged),'lost_or_changed_non_targets':lost_or_changed,
            'unexpected_files':unexpected,'incorrect_target_bytes':target_changed},
        'apply_contract':{'strategy':'Apply ONLY these exact file deltas, NOT a whole-tree replacement',
            'guard':'Before any apply, recheck EVERY existing target SHA256 and EVERY expected absence against the current mounted deployed tree; any difference refuses the entire delta',
            'target_files':guards,'production_writes_performed':False},
        'native_lineage':'Separately pinned clean GMS v83 native corpus; never treated as the deployed server XML baseline'}
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result,indent=2)+'\n');return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--host',required=True);p.add_argument('--remote',required=True)
    p.add_argument('--baseline',required=True);p.add_argument('--overlay',required=True);p.add_argument('--complete',required=True);p.add_argument('--output',required=True)
    a=p.parse_args();r=verify(a.host,a.remote,a.baseline,a.overlay,a.complete,a.output)
    print(json.dumps({'status':r['status'],'actual_files':r['actual_deployed']['files'],'actual_tree_sha256':r['actual_deployed']['tree_sha256'],
        'captured_tree_sha256':r['captured_baseline']['tree_sha256'],'guarded_deltas':len(r['apply_contract']['target_files']),
        'unchanged_files':r['complete_candidate']['non_target_files_byte_identical_to_actual_deployed']}))
    raise SystemExit(0 if r['status']=='pass' else 2)
