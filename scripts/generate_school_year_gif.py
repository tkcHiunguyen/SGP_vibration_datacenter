from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


W, H = 2048, 1152
FRAMES = 18
DURATION_MS = 130
OUT_DIR = Path("output/imagegen")
GIF_PATH = OUT_DIR / "co_giao_lai_may_bay_nam_hoc_2025_2026_2k.gif"
PNG_PATH = OUT_DIR / "co_giao_lai_may_bay_nam_hoc_2025_2026_poster_2k.png"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Verdana Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Verdana.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


TITLE_FONT = font(80, True)
YEAR_FONT = font(96, True)
LABEL_FONT = font(32, True)
SMALL_FONT = font(24, True)


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def draw_vertical_gradient(draw: ImageDraw.ImageDraw) -> None:
    top = (97, 202, 255)
    mid = (255, 246, 173)
    bottom = (255, 169, 177)
    for y in range(H):
        p = y / (H - 1)
        if p < 0.62:
            q = p / 0.62
            color = tuple(lerp(top[i], mid[i], q) for i in range(3))
        else:
            q = (p - 0.62) / 0.38
            color = tuple(lerp(mid[i], bottom[i], q) for i in range(3))
        draw.line([(0, y), (W, y)], fill=color)


def rounded_box(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: str, outline: str | None = None, width: int = 1, radius: int = 28) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def centered_text(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    text: str,
    fill: str,
    fnt: ImageFont.ImageFont,
    stroke_fill: str | None = None,
    stroke_width: int = 0,
) -> None:
    bbox = draw.textbbox((0, 0), text, font=fnt, stroke_width=stroke_width)
    x = box[0] + (box[2] - box[0] - (bbox[2] - bbox[0])) / 2
    y = box[1] + (box[3] - box[1] - (bbox[3] - bbox[1])) / 2 - bbox[1]
    draw.text((x, y), text, font=fnt, fill=fill, stroke_width=stroke_width, stroke_fill=stroke_fill)


def draw_cloud(draw: ImageDraw.ImageDraw, x: float, y: float, scale: float, alpha: int = 220) -> None:
    color = (255, 255, 255, alpha)
    parts = [
        (0, 24, 140, 80),
        (70, 0, 190, 96),
        (160, 22, 320, 92),
        (250, 42, 410, 104),
    ]
    for x0, y0, x1, y1 in parts:
        draw.ellipse(
            (x + x0 * scale, y + y0 * scale, x + x1 * scale, y + y1 * scale),
            fill=color,
        )


def draw_sun(draw: ImageDraw.ImageDraw, t: float) -> None:
    cx, cy, r = 1770, 190, 86
    for i in range(18):
        a = 2 * math.pi * i / 18 + t * 0.4
        inner = r + 18
        outer = r + 64 + 8 * math.sin(t * 2 * math.pi + i)
        p1 = (cx + math.cos(a) * inner, cy + math.sin(a) * inner)
        p2 = (cx + math.cos(a) * outer, cy + math.sin(a) * outer)
        draw.line([p1, p2], fill=(255, 206, 72, 190), width=8)
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill="#ffd45a", outline="#ff9f1c", width=6)
    draw.arc((cx - 45, cy - 16, cx - 5, cy + 20), 205, 335, fill="#7a4b00", width=5)
    draw.arc((cx + 5, cy - 16, cx + 45, cy + 20), 205, 335, fill="#7a4b00", width=5)
    draw.arc((cx - 35, cy - 6, cx + 35, cy + 54), 20, 160, fill="#7a4b00", width=6)


def draw_banner(draw: ImageDraw.ImageDraw) -> None:
    shadow = (160, 83, 44, 80)
    draw.rounded_rectangle((205, 75, W - 185, 225), radius=38, fill=shadow)
    rounded_box(draw, (185, 55, W - 205, 205), fill="#fff176", outline="#ff6f61", width=8, radius=38)
    draw.polygon([(185, 95), (92, 130), (185, 165)], fill="#ff6f61")
    draw.polygon([(W - 205, 95), (W - 112, 130), (W - 205, 165)], fill="#ff6f61")
    centered_text(draw, (220, 54, W - 240, 133), "HOÀN THÀNH NĂM HỌC", "#24416b", TITLE_FONT, "#ffffff", 3)
    centered_text(draw, (220, 120, W - 240, 205), "2025-2026", "#ff4f7b", YEAR_FONT, "#ffffff", 3)


def draw_ground(draw: ImageDraw.ImageDraw, t: float) -> None:
    hill = [(0, 1000)]
    for x in range(0, W + 90, 90):
        y = 1002 + 18 * math.sin(x / 150 + t * math.pi * 2)
        hill.append((x, y))
    hill.extend([(W, H), (0, H)])
    draw.polygon(hill, fill="#69c779")
    draw.rectangle((0, 1066, W, H), fill="#48b26a")
    for x in range(110, W, 190):
        draw.rectangle((x, 1016, x + 64, 1080), fill="#ffe082", outline="#f57c00", width=4)
        draw.polygon([(x - 12, 1018), (x + 32, 978), (x + 76, 1018)], fill="#ef5350")
        draw.rectangle((x + 18, 1042, x + 46, 1080), fill="#42a5f5")
    draw.rectangle((0, 1090, W, 1118), fill="#ffe66d")
    for x in range(-80, W, 180):
        draw.rectangle((x + int(t * 80) % 180, 1099, x + 88 + int(t * 80) % 180, 1109), fill="#ffffff")


def draw_face(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int, hair: str, shirt: str, smile: bool = True) -> None:
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill="#ffd3a6", outline="#9f6b43", width=max(2, r // 9))
    draw.pieslice((cx - r - 3, cy - r - 10, cx + r + 3, cy + r), 185, 355, fill=hair)
    draw.ellipse((cx - r // 3 - 4, cy - 3, cx - r // 3 + 4, cy + 5), fill="#2f2f2f")
    draw.ellipse((cx + r // 3 - 4, cy - 3, cx + r // 3 + 4, cy + 5), fill="#2f2f2f")
    if smile:
        draw.arc((cx - r // 2, cy, cx + r // 2, cy + r // 2), 10, 170, fill="#8d3b2f", width=max(2, r // 10))
    draw.pieslice((cx - r, cy + r - 2, cx + r, cy + 2 * r + 34), 180, 360, fill=shirt)


def draw_graduation_cap(draw: ImageDraw.ImageDraw, cx: int, cy: int, s: int, color: str, tilt: float) -> None:
    pts = []
    for px, py in [(-1.0, 0), (0, -0.45), (1.0, 0), (0, 0.45)]:
        x = px * s
        y = py * s
        pts.append((cx + x * math.cos(tilt) - y * math.sin(tilt), cy + x * math.sin(tilt) + y * math.cos(tilt)))
    draw.polygon(pts, fill=color, outline="#333333")
    draw.rectangle((cx - s * 0.36, cy + s * 0.18, cx + s * 0.36, cy + s * 0.46), fill=color, outline="#333333")
    tassel_end = (cx + math.cos(tilt + 0.8) * s * 0.75, cy + math.sin(tilt + 0.8) * s * 0.75)
    draw.line([(cx, cy), tassel_end], fill="#ffd54f", width=max(2, s // 10))
    draw.ellipse((tassel_end[0] - 5, tassel_end[1] - 5, tassel_end[0] + 5, tassel_end[1] + 5), fill="#ffd54f")


def draw_propeller(draw: ImageDraw.ImageDraw, cx: float, cy: float, angle: float) -> None:
    for i in range(3):
        a = angle + i * 2 * math.pi / 3
        p1 = (cx + math.cos(a) * 18, cy + math.sin(a) * 18)
        p2 = (cx + math.cos(a) * 140, cy + math.sin(a) * 140)
        nx, ny = -math.sin(a) * 28, math.cos(a) * 28
        draw.polygon([(p1[0] + nx, p1[1] + ny), (p2[0] + nx * 0.35, p2[1] + ny * 0.35), (p2[0] - nx * 0.35, p2[1] - ny * 0.35), (p1[0] - nx, p1[1] - ny)], fill=(191, 232, 255, 160), outline="#4aa3df")
    draw.ellipse((cx - 24, cy - 24, cx + 24, cy + 24), fill="#ff6f61", outline="#9b2d2a", width=4)


def draw_plane(draw: ImageDraw.ImageDraw, t: float, frame_idx: int) -> None:
    bob = math.sin(t * 2 * math.pi)
    x = 430 + 24 * math.sin(t * 2 * math.pi + 0.6)
    y = 515 + 30 * bob
    body = (x, y, x + 1180, y + 235)

    draw.ellipse((x - 78, y + 38, x + 180, y + 205), fill=(55, 104, 170, 80))
    draw.rounded_rectangle(body, radius=115, fill="#ffffff", outline="#315b8f", width=8)
    draw.ellipse((x + 1010, y + 22, x + 1238, y + 222), fill="#fefefe", outline="#315b8f", width=8)
    draw.rectangle((x + 865, y + 35, x + 1096, y + 220), fill="#ffffff")
    draw.line((x + 20, y + 172, x + 1080, y + 172), fill="#ff6f61", width=18)
    draw.line((x + 40, y + 194, x + 1035, y + 194), fill="#ffd166", width=12)
    draw.line((x + 70, y + 210, x + 970, y + 210), fill="#2ec4b6", width=10)

    draw.polygon([(x + 175, y + 20), (x - 100, y - 115), (x + 70, y + 92)], fill="#5c6bc0", outline="#27346d")
    draw.polygon([(x + 225, y + 55), (x + 585, y - 122), (x + 510, y + 66)], fill="#26c6da", outline="#147a85")
    draw.polygon([(x + 485, y + 150), (x + 890, y + 390), (x + 700, y + 180)], fill="#29b6f6", outline="#166c93")
    draw.polygon([(x + 180, y + 180), (x - 55, y + 330), (x + 220, y + 205)], fill="#9575cd", outline="#5e3ea0")

    cockpit = (x + 858, y + 42, x + 1074, y + 146)
    draw.rounded_rectangle(cockpit, radius=46, fill="#9be7ff", outline="#24416b", width=6)
    draw.line((x + 958, y + 45, x + 930, y + 145), fill="#24416b", width=5)
    draw_face(draw, int(x + 970), int(y + 95), 31, "#5d4037", "#4db6ac")
    draw.ellipse((x + 925, y + 63, x + 955, y + 93), fill="#5d4037")
    draw.line((x + 994, y + 123, x + 1034, y + 132), fill="#f6a878", width=7)
    draw.arc((x + 1018, y + 116, x + 1064, y + 162), 210, 30, fill="#263238", width=7)

    window_xs = [255, 370, 485, 600, 715]
    hair = ["#3e2723", "#6d4c41", "#212121", "#8d6e63", "#4e342e"]
    shirts = ["#ff8a80", "#ffd54f", "#81c784", "#64b5f6", "#ba68c8"]
    for i, wx in enumerate(window_xs):
        cx, cy = int(x + wx), int(y + 92 + 8 * math.sin(t * 2 * math.pi + i))
        draw.ellipse((cx - 48, cy - 48, cx + 48, cy + 48), fill="#a7f3ff", outline="#24416b", width=5)
        draw_face(draw, cx, cy + 8, 25, hair[i], shirts[i])
        draw_graduation_cap(draw, cx, cy - 32, 26, "#263238", -0.25 + 0.12 * i)

    draw.text((x + 322, y + 138), "TRI THỨC BAY CAO", font=LABEL_FONT, fill="#24416b")
    draw.rounded_rectangle((x + 80, y + 158, x + 206, y + 211), radius=18, fill="#ffe66d", outline="#315b8f", width=4)
    draw.text((x + 98, y + 168), "LỚP", font=SMALL_FONT, fill="#24416b")

    draw_propeller(draw, x + 1226, y + 122, frame_idx * 0.95)

    for wx in [235, 805]:
        draw.line((x + wx, y + 224, x + wx + 25, y + 268), fill="#315b8f", width=8)
        draw.ellipse((x + wx + 4, y + 257, x + wx + 54, y + 307), fill="#263238")
        draw.ellipse((x + wx + 17, y + 270, x + wx + 41, y + 294), fill="#90a4ae")


def draw_confetti(draw: ImageDraw.ImageDraw, frame_idx: int) -> None:
    rng = random.Random(2026)
    colors = ["#ff4f7b", "#ffd166", "#06d6a0", "#118ab2", "#8338ec", "#fb8500", "#ffffff"]
    for i in range(150):
        base_x = rng.randint(30, W - 30)
        base_y = rng.randint(-H, H)
        speed = rng.uniform(12, 30)
        x = (base_x + 22 * math.sin(frame_idx * 0.35 + i)) % W
        y = (base_y + frame_idx * speed) % (H + 80) - 40
        c = colors[i % len(colors)]
        size = rng.randint(7, 15)
        if i % 3 == 0:
            draw.ellipse((x, y, x + size, y + size), fill=c)
        else:
            draw.rectangle((x, y, x + size * 1.6, y + size), fill=c)


def draw_caps(draw: ImageDraw.ImageDraw, t: float) -> None:
    spots = [(360, 330, 46), (1510, 330, 54), (290, 680, 38), (1710, 720, 42)]
    colors = ["#263238", "#3949ab", "#00897b", "#6a1b9a"]
    for i, (x, y, s) in enumerate(spots):
        yy = y + 22 * math.sin(t * 2 * math.pi + i * 0.9)
        draw_graduation_cap(draw, x, int(yy), s, colors[i], t * math.pi * 2 + i)


def frame(frame_idx: int) -> Image.Image:
    t = frame_idx / FRAMES
    img = Image.new("RGBA", (W, H), "white")
    draw = ImageDraw.Draw(img, "RGBA")
    draw_vertical_gradient(draw)
    draw_sun(draw, t)
    clouds = [(150, 240, 0.62), (660, 280, 0.48), (1220, 250, 0.58), (1620, 520, 0.38), (70, 735, 0.42)]
    for i, (x, y, scale) in enumerate(clouds):
        draw_cloud(draw, (x + frame_idx * (10 + i * 2)) % (W + 420) - 360, y, scale)
    draw_caps(draw, t)
    draw_banner(draw)
    draw_confetti(draw, frame_idx)
    draw_plane(draw, t, frame_idx)
    draw_ground(draw, t)
    return img.convert("RGB")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    frames = [frame(i) for i in range(FRAMES)]
    frames[5].save(PNG_PATH)
    palette_frames = [f.convert("P", palette=Image.Palette.ADAPTIVE, colors=160) for f in frames]
    palette_frames[0].save(
        GIF_PATH,
        save_all=True,
        append_images=palette_frames[1:],
        optimize=True,
        duration=DURATION_MS,
        loop=0,
        disposal=2,
    )
    print(PNG_PATH)
    print(GIF_PATH)


if __name__ == "__main__":
    main()
