"""Rebuild the solid native map bookmark. Optional build dependency: Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
points = [(20, 13), (76, 13), (76, 96), (48, 78), (20, 96), (20, 13)]
image = Image.new('RGBA', (384, 448))
draw = ImageDraw.Draw(image)
scaled = [(4*x, 4*y) for x, y in points]
draw.polygon(scaled, fill='#285b49')
draw.line(scaled, fill='#ffffff', width=24, joint='curve')
image.resize((96, 112), Image.Resampling.LANCZOS).save(root / 'miniprogram/assets/icons/map-bookmark.png')
svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="112" viewBox="0 0 96 112"><path d="M20 13H76V96L48 78L20 96Z" fill="#285b49" stroke="#ffffff" stroke-width="6" stroke-linejoin="round"/></svg>'
(root / 'docs/design/map-bookmark.svg').write_text(svg + '\n')
