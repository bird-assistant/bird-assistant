"""Original Yuji decorative vectors and PNGs. Optional rebuild: pip install cairosvg pillow.

PNG is the native runtime format. SVG sources stay outside the upload root.
"""
from pathlib import Path
import random
import cairosvg
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/design/ornaments'
TARGET = ROOT / 'miniprogram/assets/decorations'
SOURCE.mkdir(parents=True, exist_ok=True)
TARGET.mkdir(parents=True, exist_ok=True)
PATHS = {
    'leaf': '<path d="M23 80Q26 24 80 18Q86 68 23 80ZM24 80L68 34M41 60L37 42M51 51L68 53"/>',
    'flower': '<path d="M49 49C18 41 21 16 38 24Q49 31 49 49ZM50 48C48 12 74 13 68 33Q65 43 50 48ZM53 51C85 29 92 56 73 62Q63 63 53 51ZM52 54C80 73 59 93 51 74Q47 64 52 54ZM47 53C40 86 16 70 31 56Q39 50 47 53Z"/><circle cx="50" cy="50" r="7" fill="#c4a260"/>',
    'star': '<path d="M50 16L59 39L84 42L65 59L69 84L50 70L29 84L34 59L16 42L41 39Z"/><path d="M81 14L83 24M78 19H88" stroke="#c4a260"/>',
    'feather': '<path d="M23 85L75 20M29 77Q6 30 78 17Q85 72 29 77ZM35 69L33 45M45 56L65 58M55 43L56 26"/>',
    'stamp': '<circle cx="50" cy="50" r="34"/><circle cx="50" cy="50" r="28" stroke-dasharray="2 5"/><path d="M29 44H72M29 56H65M74 37H94M75 49H96M75 61H94"/><path d="M38 31L43 26L48 31" stroke="#c4a260"/>',
    'sprig': '<path d="M25 90Q51 53 66 13M43 63Q14 62 19 40Q39 42 43 63ZM53 45Q53 20 75 25Q75 43 53 45ZM34 78Q31 59 14 64Q15 81 34 78ZM62 28Q48 25 51 12Q66 11 62 28Z"/>',
    'grass': '<path d="M47 89Q49 49 37 16M50 89Q58 55 72 31M44 89Q34 62 21 47M34 20Q22 13 29 7Q43 9 37 22ZM36 29Q23 28 23 20M39 39Q25 37 25 29M66 42Q75 17 81 24Q84 36 68 43M61 53L78 49"/>',
    'sun': '<circle cx="50" cy="50" r="21" fill="#e4cb92" stroke="#b79a5a"/><path d="M50 10V20M50 80V90M10 50H20M80 50H90M22 22L29 29M71 71L78 78M22 78L29 71M71 29L78 22" stroke="#b79a5a"/>',
    'moon': '<path d="M67 15A36 36 0 1 0 86 66A35 35 0 0 1 67 15Z" fill="#e7dfc8"/><path d="M77 18V29M72 24H83M86 39V46M83 42H90" stroke="#b79a5a"/>',
    'waves': '<path d="M8 34Q18 24 28 34T48 34T68 34T88 34M8 51Q18 41 28 51T48 51T68 51T88 51M8 68Q18 58 28 68T48 68T68 68T88 68"/>',
    'compass': '<circle cx="50" cy="52" r="30"/><path d="M50 5V17M50 87V95M8 52H17M83 52H92M62 29L56 58L37 75L44 46Z"/><path d="M50 52L62 29L44 46Z" fill="#b79a5a"/>',
}
for name, body in PATHS.items():
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="none" stroke="#71866a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">'+body+'</g></svg>'
    (SOURCE / (name+'.svg')).write_text(svg)
    cairosvg.svg2png(bytestring=svg.encode(), write_to=str(TARGET/(name+'.png')), output_width=240, output_height=240)

paper = ROOT / 'miniprogram/assets/papers'
paper.mkdir(exist_ok=True)
for name in ['fiber', 'linen', 'grid', 'dots', 'ruled']:
    image = Image.new('RGBA', (900, 1200)); draw = ImageDraw.Draw(image)
    if name == 'fiber':
        rng = random.Random(20261124)
        for _ in range(1900):
            x,y=rng.randrange(900),rng.randrange(1200)
            draw.line((x,y,x+rng.randrange(-9,10),y+rng.randrange(2,13)),fill=(113,98,67,rng.randrange(7,20)))
    if name == 'linen':
        for x in range(0,900,8): draw.line((x,0,x,1200),fill=(108,110,85,11))
        for y in range(0,1200,8): draw.line((0,y,900,y),fill=(108,110,85,9))
    if name == 'grid':
        for x in range(0,900,36): draw.line((x,0,x,1200),fill=(93,125,111,24))
        for y in range(0,1200,36): draw.line((0,y,900,y),fill=(93,125,111,24))
    if name == 'dots':
        for x in range(18,900,36):
            for y in range(18,1200,36): draw.ellipse((x,y,x+2,y+2),fill=(98,124,105,52))
    if name == 'ruled':
        for y in range(36,1200,42): draw.line((0,y,900,y),fill=(99,132,123,29))
        draw.line((86,0,86,1200),fill=(170,107,95,22))
    image.save(paper/(name+'.png'),optimize=True)
print('Built 11 original ornaments and 5 transparent paper overlays.')
