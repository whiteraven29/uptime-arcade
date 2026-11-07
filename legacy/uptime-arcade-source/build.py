import pathlib,base64,re
root=pathlib.Path(__file__).resolve().parent;src=root/'src'
js=''.join((src/f).read_text()+'\n' for f in ['shell.js','vi.js','commands.js','data.js','learn.js','t_shell.js','t_rest.js','rewind.js','ui.js','ui-keep.js','boot.js'])
assert '</script' not in js.lower()
page=(src/'page.html').read_text()
art=page.replace('/*__JS__*/',js)
(root/'uptime-arcade.html').write_text(art)
# offline: fonts and python inside the file, no network at all
def font(fam,w,f):
    b=base64.b64encode(pathlib.Path(f).read_bytes()).decode()
    return f"@font-face{{font-family:'{fam}';font-weight:{w};font-style:normal;src:url(data:font/woff2;base64,{b}) format('woff2')}}\n"
fd=root/'fonts'
plex=next(fd.glob('x-*plex*/package/files/ibm-plex-mono-latin-400-normal.woff2')).parent
ox=next(fd.glob('x-ox/package/files/oxanium-latin-400-normal.woff2')).parent
faces=''.join(font('Oxanium',w,ox/f'oxanium-latin-{w}-normal.woff2') for w in (400,600,800))+''.join(font('IBM Plex Mono',w,plex/f'ibm-plex-mono-latin-{w}-normal.woff2') for w in (400,500,700))
skull=(root/'vendor/package/dist/skulpt.min.js').read_text()
std=(root/'vendor/package/dist/skulpt-stdlib.js').read_text()
esc=lambda s:s.replace('</script','<\\/script').replace('</SCRIPT','<\\/SCRIPT')
off=re.sub(r'<link [^>]*>\n','',page)
off=off.replace('<style>','<style>\n'+faces,1)
off=off.replace('<meta name="claude:viewport-fit-sides" content="cover">\n','')
head='<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n'
i=off.index('</style>')+len('</style>')
off=head+off[:i]+'\n</head><body>\n'+off[i:]
libs='<script>'+esc(skull)+'</script>\n<script>'+esc(std)+'</script>\n'
off=off.replace('<script>\n/*__JS__*/',libs+'<script>\n/*__JS__*/',1).replace('/*__JS__*/',js)+'\n</body></html>\n'
(root/'offline').mkdir(exist_ok=True)
(root/'offline/uptime-arcade.html').write_text(off)
print(len(art),len(off))
