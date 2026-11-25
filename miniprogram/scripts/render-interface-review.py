"""Render local WXML/CSS projections; this is not native WeChat acceptance.
Optional QA dependencies: weasyprint, pymupdf, pillow. No application dependency.
Run npm test; node scripts/review-interface.mjs; then this script from the client root.
"""
from pathlib import Path
import json
import logging
import re

import fitz
from PIL import Image, ImageDraw, ImageFont
from weasyprint import CSS, HTML

logging.getLogger('weasyprint').setLevel(logging.ERROR)
root = Path(__file__).resolve().parents[1]
source = root / 'docs/design/interface-0.4.5'
proof = root / 'docs/design/interface-0.4.5-review'
proof.mkdir(parents=True, exist_ok=True)
results = []
for width in (320, 390, 768):
    for kind in ('camera', 'cameraZoom', 'map', 'mapMoving', 'search', 'menu', 'photo', 'photoBack', 'feed', 'refresh', 'compose', 'import', 'profile', 'trip', 'journal'):
        text = (source / f'{kind}-{width}.html').read_text()
        text = text.replace('/assets/', (root / 'miniprogram/assets').as_uri() + '/')
        text = re.sub(r'(\d+(?:\.\d+)?)rpx', lambda m: str(round(float(m.group(1))*width/750, 3))+'px', text)
        text = re.sub(r'env\(safe-area-inset-bottom\)', '0px', text)
        text = re.sub(r'calc\((\d+)px \+ 0px\)', r'\1px', text)
        # Avoid print pagination breaking a phone panel; each projection is one long viewport.
        style = CSS(string=f'@page{{size:{width}px 844px;margin:0}}html,body{{width:{width}px}}'
                    'button,input,textarea{font-family:"Noto Sans CJK SC",sans-serif}'
                    '.header{position:absolute}.tab-shell{position:absolute;top:764px;bottom:auto;padding-bottom:15px}'
                    '.viewfinder,.native-camera,.demo-scene{top:0;left:0;right:0;bottom:0}'
                    '.forum-menu-backdrop{top:0;left:0;right:0;bottom:0}'
                    '.flight-bird{animation:none;opacity:1;left:0}.bird-two{left:14px}.bird-three{left:28px}'
                    '.pull-flight.is-flying .flight-bird{left:3px}.pull-flight.is-flying .bird-two{left:20px}.pull-flight.is-flying .bird-three{left:37px}'
                    'input,textarea{display:block}.projection-banner{position:absolute}'
                    '.post-card,.reply-thread,.column,.record-sheet{break-inside:avoid}'
                    '.photo-face{top:0;left:0;right:0;bottom:0;transform:none}.photo-front{z-index:1}'
                    '.photo-back{z-index:0}.photo-flipped .photo-front{display:none}.photo-flipped .photo-back{z-index:2}'
                    '.photo-watermark{top:0;left:0;right:0;bottom:0}.photo-data{overflow:hidden}'
                    '.photo-image{object-fit:contain}.import-drop{height:170px}.avatar-grid button{height:100px}'
                    '.tab-row{display:block;width:100%;max-width:none}.tab{display:block;float:left;width:20%;text-align:center}'
                    '.tab-icon{display:block;margin:0 auto}.orb{margin:0 auto}')
        doc = HTML(string=text, base_url=str(source)).render(stylesheets=[style])
        result = {'kind': kind, 'width': width, 'renderer': 'WeasyPrint source projection', 'panels': []}
        for box in doc.pages[0]._page_box.descendants():
            element = box.element
            if element is None or box.__class__.__name__ in ('TextBox', 'LineBox', 'InlineBox'):
                continue
            classes = element.get('class', '')
            if any(c in classes.split() for c in ('record-sheet', 'sheet-header', 'clue-panel', 'zoom-control', 'capture-row', 'forum-menu', 'photo-info-card', 'live-bottom', 'photo-card', 'photo-stage', 'search-results', 'zoom-chip', 'advice-overview', 'import-modes')):
                result['panels'].append({'class': classes, 'x': round(box.position_x, 2), 'y': round(box.position_y, 2),
                                         'width': round(box.width, 2), 'height': round(box.height, 2)})
        results.append(result)
        pdf = fitz.open(stream=doc.write_pdf(), filetype='pdf')
        pix = pdf[0].get_pixmap(matrix=fitz.Matrix(4 / 3, 4 / 3), alpha=False)
        Image.frombytes('RGB', (pix.width, pix.height), pix.samples).save(proof / f'{kind}-{width}.png')
font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
heading = ImageFont.truetype(font, 22)
small = ImageFont.truetype(font, 14)
canvas = Image.new('RGB', (2450, 980), '#e7ecdf')
draw = ImageDraw.Draw(canvas)
draw.text((28, 18), 'Bird Assistant 0.4.5 | Source layout projection', font=heading, fill='#285b49')
draw.text((28, 52), 'Original sample content. WXML/CSS print projection, not native WeChat acceptance.', font=small, fill='#60765e')
for i, (kind, label) in enumerate((('map', 'Drawer / opaque base'), ('search', 'Search / toolbar boundary'), ('photoBack', 'Photo / metadata back'), ('import', 'Import / selected deck'), ('trip', 'Trip / readable advice'), ('profile', 'Profile / name avatar'))):
    x = 28 + i * 405
    draw.text((x, 88), label, font=heading, fill='#285b49')
    canvas.paste(Image.open(proof / f'{kind}-390.png').convert('RGB').crop((0, 0, 390, 844)), (x, 124))
canvas.save(root / 'docs/design/interface-0.4.5.png', optimize=True)
(root / 'docs/design/interface-0.4.5-bounds.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'reviewed': len(results), 'bounds': 'docs/design/interface-0.4.5-bounds.json', 'image': 'docs/design/interface-0.4.5.png'}))
