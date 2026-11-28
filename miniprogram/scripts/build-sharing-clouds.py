"""Render our original cloud-scroll line ornament; no external artwork or font."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SCALE = 3
image = Image.new("RGBA", (240 * SCALE, 136 * SCALE))
draw = ImageDraw.Draw(image)


def stroke(start, curves):
    points = [start]
    for one, two, end in curves:
        x, y = points[-1]
        for i in range(1, 33):
            t = i / 32
            u = 1 - t
            points.append((u**3*x+3*u*u*t*one[0]+3*u*t*t*two[0]+t**3*end[0],
                           u**3*y+3*u*u*t*one[1]+3*u*t*t*two[1]+t**3*end[1]))
    draw.line([(round(x*SCALE), round(y*SCALE)) for x, y in points], fill="#839b78", width=2*SCALE, joint="curve")


stroke((8, 97), [((28, 99), (20, 70), (48, 74)), ((35, 40), (72, 25), (91, 48)),
                ((103, 11), (151, 15), (155, 51)), ((181, 29), (210, 49), (202, 72)),
                ((235, 69), (237, 98), (212, 101)), ((176, 106), (144, 93), (114, 104)),
                ((81, 119), (44, 105), (24, 119))])
stroke((56, 79), [((46, 61), (69, 48), (80, 63)), ((88, 85), (64, 85), (66, 71))])
stroke((118, 74), [((102, 58), (116, 39), (135, 47)), ((152, 55), (141, 76), (129, 65))])
stroke((169, 81), [((169, 64), (192, 62), (193, 78)), ((194, 88), (183, 91), (178, 84))])
stroke((63, 124), [((106, 133), (124, 108), (167, 119)), ((192, 125), (214, 114), (228, 118))])
image.resize((480, 272), Image.Resampling.LANCZOS).save(ROOT / "miniprogram/assets/sharing-cloud.png")
