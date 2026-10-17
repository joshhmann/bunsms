#!/usr/bin/env python3
"""Snapshot only affected deployed XML files over SSH reads into an isolated directory."""
import argparse
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import tarfile


def snapshot(host,remote,contracts,output):
    output=Path(output)
    if output.exists() and any(output.iterdir()):raise ValueError('Snapshot destination must be empty')
    output.mkdir(parents=True,exist_ok=True)
    wanted=set()
    for c in contracts:
        for op in json.loads(Path(c).read_text())['operations']:
            wanted.add(op['target_wz']+'/'+op['target_image']+'.xml')
    for p in wanted:
        if Path(p).is_absolute() or '..' in Path(p).parts:raise ValueError('Unsafe XML path')
    # tar only READS remote paths. Extraction is manual and constrained locally;
    # no remote script, restart, install, database command or write is executed.
    command='tar -cf - --ignore-failed-read -C '+shlex.quote(remote)+' -- '+' '.join(shlex.quote(p) for p in sorted(wanted))
    process=subprocess.Popen(['ssh',host,command],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    records=[]
    with tarfile.open(fileobj=process.stdout,mode='r|') as archive:
        for member in archive:
            if member.name not in wanted or not member.isfile():raise ValueError('Unexpected remote tar member')
            target=output/member.name;target.parent.mkdir(parents=True,exist_ok=True)
            data=archive.extractfile(member).read();target.write_bytes(data)
            records.append({'path':member.name,'sha256':hashlib.sha256(data).hexdigest(),'size':len(data)})
    stderr=process.stderr.read().decode(errors='replace');code=process.wait()
    if code:raise RuntimeError(f'Read-only remote snapshot failed ({code}): {stderr}')
    canonical=subprocess.check_output(['ssh',host,'readlink -f '+shlex.quote(remote)],text=True).strip()
    result={'host':host,'remote_requested':remote,'remote_canonical':canonical,'method':'read-only ssh tar selected files',
            'files':records,'absent':sorted(wanted-{r['path'] for r in records}),'stderr':stderr}
    (output/'snapshot-provenance.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--host',required=True);p.add_argument('--remote',required=True)
    p.add_argument('--contract',action='append',required=True);p.add_argument('--output',required=True)
    a=p.parse_args();r=snapshot(a.host,a.remote,a.contract,a.output)
    print(json.dumps({'present':len(r['files']),'absent':len(r['absent']),'remote':r['remote_canonical']}))
