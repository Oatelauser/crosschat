import hashlib,json,pathlib,stat,zipfile
root=pathlib.Path(__file__).parent.resolve()
for source in sorted(root.glob('dsh-onboarding-*.zip')):
    target=root/'inspection'/source.stem
    members=[]
    with zipfile.ZipFile(source) as archive:
        total=0
        for item in archive.infolist():
            name=item.filename
            member=pathlib.PurePosixPath(name)
            if '\\' in name or member.is_absolute() or '..' in member.parts or ':' in name or stat.S_ISLNK(item.external_attr>>16): raise ValueError('Unsafe ZIP member')
            if item.is_dir(): continue
            total+=item.file_size
            if item.file_size>4*1024*1024 or total>32*1024*1024: raise ValueError('ZIP expansion budget exceeded')
            data=archive.read(item)
            if not name.endswith(('.json','.jsonl')): raise ValueError('Unexpected artifact file type')
            output=target.joinpath(*member.parts).resolve()
            if not output.is_relative_to(target): raise ValueError('Member escaped inspection root')
            output.parent.mkdir(parents=True,exist_ok=True)
            if output.exists():
                if output.read_bytes()!=data: raise ValueError('Existing inspection bytes differ')
            else:
                with output.open('xb') as handle: handle.write(data)
            members.append({'file':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    index=target/'index.json'
    result={'zip':source.name,'members':members}
    content=(json.dumps(result,ensure_ascii=False,indent=2)+'\n').encode()
    if not index.exists():
        with index.open('xb') as handle:handle.write(content)
    print(json.dumps({'zip':source.name,'members':len(members),'uncompressedBytes':total}))
