import hashlib,json,pathlib,stat,zipfile
root=pathlib.Path(__file__).parent
results=[]
for source in sorted(root.glob('dsh-onboarding-*.zip')):
    members=[]
    with zipfile.ZipFile(source) as archive:
        total=0
        for item in archive.infolist():
            name=item.filename
            path=pathlib.PurePosixPath(name)
            if '\\' in name or path.is_absolute() or '..' in path.parts or ':' in name or stat.S_ISLNK(item.external_attr>>16): raise ValueError('Unsafe ZIP member')
            if item.is_dir(): continue
            total+=item.file_size
            if item.file_size>4*1024*1024 or total>32*1024*1024: raise ValueError('ZIP expansion budget exceeded')
            data=archive.read(item)
            entry={'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
            if name.endswith('.json'):
                value=json.loads(data.decode('utf-8-sig'))
                entry['jsonKeys']=list(value) if isinstance(value,dict) else []
                if isinstance(value,dict) and any(k in value for k in ['classification','tool','kind','decision']):
                    entry['facts']={k:value[k] for k in ['schema','tool','kind','platform','arch','version','runId','status','stage','category','classification','decision','notify','cleanup','process','artifact','baseline','candidate','attempts','checks','scope'] if k in value}
            members.append(entry)
    result={'file':source.name,'members':members}
    dest=root/(source.stem+'-inventory.json')
    if not dest.exists(): dest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    results.append({'file':source.name,'members':len(members),'reports':[entry for entry in members if 'facts' in entry]})
print(json.dumps(results,ensure_ascii=False,indent=2))
