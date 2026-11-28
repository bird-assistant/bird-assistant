"""Source layout projections only; this is not WeChat or a hardware camera test."""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory')
    parser.add_argument('--profiles', default='docs/testing/device-profiles.json')
    parser.add_argument('--browser-config')
    args = parser.parse_args()
    config = json.loads(Path(args.browser_config).read_text()) if args.browser_config else {}
    root = Path(args.directory).resolve()
    profiles = json.loads(Path(args.profiles).read_text())['profiles']
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=config.get('path'), headless=True, args=config.get('args', [])+['--no-sandbox','--allow-file-access-from-files'])
        for profile in profiles:
            w, h = profile['width'], profile['height']
            page = await browser.new_page(viewport={'width': w,'height': h}, device_scale_factor=1, reduced_motion='reduce')
            for file in sorted(root.glob(f'*-{w}x{h}.html')):
                kind = file.name.removesuffix(f'-{w}x{h}.html')
                await page.goto(file.as_uri())
                await page.evaluate('document.fonts.ready')
                if w==365 and kind=='editorPortrait':
                    await page.screenshot(path=str(root/'editorPortrait-initial-365.png'), scale='css')
                metrics = await page.evaluate('''() => {
                  const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right}};
                  const control=document.querySelector('.editor-controls'),stage=document.querySelector('.stage-sticky');let editor=null;
                  if(control){const button=[...control.querySelectorAll('button')].find(b=>b.textContent.trim()==='导出成品图');if(button){const c=control.getBoundingClientRect(),r=button.getBoundingClientRect();control.scrollTop+=r.top-c.top-(c.height-r.height)/2;}editor={controls:rect(control),stage:rect(stage),export:button?rect(button):null};}
                  const pills=[...document.querySelectorAll('.explore-source-strip button')].map(rect),strip=document.querySelector('.explore-source-strip'),toolbar=[...document.querySelectorAll('.sightings-toolbar button')].map(rect);
                  const cards=[...document.querySelectorAll('.sighting-card')].slice(0,2).map(rect);
                  const shutter=document.querySelector('.shutter'),hint=document.querySelector('.capture-hint'),tabs=document.querySelector('.tab-bar');
                  return {scroll:document.documentElement.scrollWidth,editor,pills,strip:strip?rect(strip):null,toolbar,cards,shutter:shutter?rect(shutter):null,hint:hint?rect(hint):null,tabs:tabs?rect(tabs):null};
                }''')
                results.append({'kind':kind,'window':[w,h],'device':profile['name'],**metrics})
                await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                if w in (320,365,768) and kind in ('editorPortrait','editorSideText','externalGallery','cameraBurst','cameraExpired','profile'):
                    await page.screenshot(path=str(root/f'{kind}-{w}.png'), scale='css')
            await page.close()
        await browser.close()
    bad=[]
    for row in results:
        w,h=row['window']
        if row['scroll']>w+2:bad.append([row['kind'],row['window'],'horizontal overflow'])
        editor=row['editor']
        if editor:
            c,e=editor['controls'],editor['export']
            if c['bottom']>h+1 or c['h']<44:bad.append([row['kind'],row['window'],'editor controls outside viewport',c])
            if not e or e['y']<c['y']-1 or e['bottom']>c['bottom']+1:bad.append([row['kind'],row['window'],'export unreachable',e])
        if row['strip']:
            for pill in row['pills']:
                if pill['y']<row['strip']['y']-1 or pill['bottom']>row['strip']['bottom']+1:bad.append([row['kind'],row['window'],'source pill clipped',pill])
        if row['cards'] and abs(row['cards'][0]['h']-row['cards'][1]['h'])>1:bad.append([row['kind'],row['window'],'card baseline mismatch'])
        for k in ['shutter','hint']:
            b=row[k]
            if b and (b['bottom']>h-65+1 or b['y']<88):bad.append([row['kind'],row['window'],k+' outside live window',b])
    (root/'capture-layout-metrics.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
    print(json.dumps({'cases':len(results),'devices':len(profiles),'failures':bad},ensure_ascii=False),flush=True)
    if bad:raise SystemExit(1)

asyncio.run(main())
