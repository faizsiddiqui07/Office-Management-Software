"""
iOS ke liye launch (splash) images — `apple-touch-startup-image`.

Android/Chrome apna splash manifest se khud bana leta hai (icon + naam + background_color).
iOS Safari manifest ko iske liye IGNORE karta hai: use har device ke screen ke liye EXACT
pixel-size ki alag PNG chahiye, media query se matched. Size ek pixel bhi alag ho to iOS
chup-chaap kuch nahi dikhata (safed screen) — isliye table neeche haath se rakhi hai.

Ek baar chalao, PNGs commit karo (runtime par kuch nahi banta):

    python scripts/gen-ios-splash.py <full-logo.png/webp> <mark.png/webp>

Banata hai:
  public/brand/splash/<W>x<H>-{light,dark}.png     (iPhone: portrait; iPad: portrait + landscape)
  lib/ios-splash.js                                 (Next metadata ke liye {url, media} list)
  public/brand/launch-tile.png, wordmark-{light,dark}.png
        — app ke apne LaunchScreen (components/shell/launch-screen.jsx) ke liye WAHI tile aur
          wordmark, taaki iOS ka splash → app ka loading screen bina jhatke ke ek jaisa dikhe.

Python + Pillow isliye ki website me koi image library nahi hai aur ek one-time asset ke
liye native dependency (sharp) add karna theek nahi.

Look: beech me app-icon jaisa safed tile (ghar-screen ka icon "phail" kar splash banta
hai), neeche wordmark, sabse neeche "A product of BrainQbit". Light/dark dono — bg wahi jo
app ka pehla paint hai (layout.jsx viewport.themeColor), taaki splash → app me koi jhatka
na dikhe.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ── Device table ─────────────────────────────────────────────────────────────
# (device-width pt, device-height pt, dpr, kind, models) — PORTRAIT logical size jo Safari
# report karta hai (native panel resolution NAHI: iPhone 12 mini 375×812@3x hai, 1080×2340
# nahi). Ek hi triple wale models ek row me. Galat row = us phone par splash nahi.
DEVICES = [
    # iPhone — (iOS 15+). Teen alag sources (Apple specs/App Store Connect, iosref/
    # useyourloaf, ios-resolution + pwa-asset-generator) se 19 Sep 2026 ko milaaya hua.
    (320, 568, 2, 'iphone', 'iPhone SE (1st gen)'),
    (375, 667, 2, 'iphone', 'iPhone 6s/7/8, SE (2nd/3rd gen)'),
    (414, 736, 3, 'iphone', 'iPhone 6s Plus/7 Plus/8 Plus'),
    (375, 812, 3, 'iphone', 'iPhone X/XS/11 Pro, 12 mini, 13 mini'),
    (414, 896, 2, 'iphone', 'iPhone XR, 11'),
    (414, 896, 3, 'iphone', 'iPhone XS Max, 11 Pro Max'),
    (390, 844, 3, 'iphone', 'iPhone 12/12 Pro, 13/13 Pro, 14, 16e, 17e'),
    (428, 926, 3, 'iphone', 'iPhone 12 Pro Max, 13 Pro Max, 14 Plus'),
    (393, 852, 3, 'iphone', 'iPhone 14 Pro, 15/15 Pro, 16'),
    (430, 932, 3, 'iphone', 'iPhone 14 Pro Max, 15 Plus/15 Pro Max, 16 Plus'),
    (402, 874, 3, 'iphone', 'iPhone 16 Pro, 17, 17 Pro, 18 Pro'),
    (440, 956, 3, 'iphone', 'iPhone 16 Pro Max, 17 Pro Max, 18 Pro Max'),
    (420, 912, 3, 'iphone', 'iPhone Air'),
    # iPhone Duo (fold, Oct 2026) — Apple ne point-size publish nahi kiye; App Store Connect
    # screenshot sizes se. Galat nikle to bas kabhi match nahi hoga — nuksaan kuch nahi.
    (466, 678, 3, 'iphone', 'iPhone Duo (cover display) - unverified on hardware'),
    (669, 951, 3, 'iphone', 'iPhone Duo (inner display) - unverified on hardware'),
    (626, 890, 3, 'iphone', 'iPhone Duo (inner display, alt) - unverified on hardware'),
    # iPad — (iPadOS 15+)
    (768, 1024, 2, 'ipad', 'iPad (5th/6th gen), iPad Air 2, iPad mini 4/5, iPad Pro 9.7"'),
    (744, 1133, 2, 'ipad', 'iPad mini (6th gen, A17 Pro)'),
    (810, 1080, 2, 'ipad', 'iPad 10.2" (7th-9th gen)'),
    (820, 1180, 2, 'ipad', 'iPad (10th gen, A16), iPad Air (4th/5th gen), iPad Air 11" (M2/M3/M4)'),
    (834, 1112, 2, 'ipad', 'iPad Air (3rd gen), iPad Pro 10.5"'),
    (834, 1194, 2, 'ipad', 'iPad Pro 11" (1st-4th gen)'),
    (834, 1210, 2, 'ipad', 'iPad Pro 11" (M4/M5)'),
    (1024, 1366, 2, 'ipad', 'iPad Pro 12.9" (all gens), iPad Air 13" (M2/M3/M4)'),
    (1032, 1376, 2, 'ipad', 'iPad Pro 13" (M4/M5)'),
]

# App ka pehla paint (website/app/layout.jsx → viewport.themeColor) — splash isi rang par.
BG = {'light': (247, 248, 252), 'dark': (12, 14, 22)}
CAPTION = 'A product of BrainQbit'
CAPTION_COLOR = {'light': (110, 116, 135), 'dark': (140, 146, 165)}
DARK_WORDMARK_INK = (245, 247, 251)  # dark bg par navy "Managi" ko is rang me
FONT_CANDIDATES = [r'C:\Windows\Fonts\segoeui.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf',
                   '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
OUT_DIR = os.path.join(WEB, 'public', 'brand', 'splash')
OUT_JS = os.path.join(WEB, 'lib', 'ios-splash.js')


def trimmed(path):
    im = Image.open(path).convert('RGBA')
    return im.crop(im.getchannel('A').getbbox())


def wordmark_from_lockup(lockup):
    """Lockup (mark + "ManagiBot") me se sirf wordmark: pehla poora-transparent column jo
    mark ke baad aata hai, wahan se kaato."""
    a = lockup.getchannel('A')
    w, h = lockup.size
    cols = [any(a.getpixel((x, y)) for y in range(0, h, 2)) for x in range(w)]
    # mark ka content shuru → uska end (pehla khaali column) → phir text ka shuru
    x = 0
    while x < w and not cols[x]:
        x += 1
    while x < w and cols[x]:
        x += 1
    while x < w and not cols[x]:
        x += 1
    wm = lockup.crop((x, 0, w, h))
    return wm.crop(wm.getchannel('A').getbbox())


def recolor_dark(wordmark):
    """Navy (gehra) → halka; blue "Bot" waise ka waisa. Alpha ko haath nahi lagaya."""
    px = wordmark.load()
    w, h = wordmark.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a and (0.299 * r + 0.587 * g + 0.114 * b) < 90:
                px[x, y] = (*DARK_WORDMARK_INK, a)
    return wordmark


def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return None


TILE_RADIUS = 0.22   # tile ki side ka hissa — launch-screen.jsx me rounded-[22%] isi se
MARK_IN_TILE = 0.66  # tile ke andar mark kitna bada


def rounded_tile(side, radius, fill, ring=None):
    tile = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    d.rounded_rectangle((0, 0, side - 1, side - 1), radius=radius, fill=fill, outline=ring, width=2 if ring else 0)
    return tile


def render(W, H, theme, mark, wordmark_by_theme, font_cache):
    S = min(W, H)  # sab kuch chhoti side ke hisaab se — portrait/landscape dono me ek jaisa
    img = Image.new('RGBA', (W, H), (*BG[theme], 255))

    # App-icon tile: home-screen ka icon (mark on white) hi bada hokar beech me.
    tile_side = round(S * 0.28)
    radius = round(tile_side * TILE_RADIUS)
    cx, cy = W // 2, round(H * 0.44)
    tile_xy = (cx - tile_side // 2, cy - tile_side // 2)
    if theme == 'light':
        # Halki chhaya, warna safed tile safed-si bg par gum ho jaata
        shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        off = round(tile_side * 0.04)
        sd.rounded_rectangle((tile_xy[0], tile_xy[1] + off, tile_xy[0] + tile_side, tile_xy[1] + tile_side + off),
                             radius=radius, fill=(20, 24, 40, 46))
        shadow = shadow.filter(ImageFilter.GaussianBlur(round(tile_side * 0.05)))
        img.alpha_composite(shadow)
        tile = rounded_tile(tile_side, radius, (255, 255, 255, 255), ring=(226, 229, 238, 255))
    else:
        tile = rounded_tile(tile_side, radius, (255, 255, 255, 255))
    img.alpha_composite(tile, tile_xy)

    m_side = round(tile_side * MARK_IN_TILE)
    m = mark.copy()
    m.thumbnail((m_side, m_side), Image.LANCZOS)
    img.alpha_composite(m, (cx - m.width // 2, cy - m.height // 2))

    # Wordmark tile ke neeche
    wm = wordmark_by_theme[theme].copy()
    wm_w = round(S * 0.42)
    wm.thumbnail((wm_w, round(wm_w * wm.height / wm.width)), Image.LANCZOS)
    wm_y = tile_xy[1] + tile_side + round(S * 0.075)
    img.alpha_composite(wm, (cx - wm.width // 2, wm_y))

    # Caption sabse neeche (home indicator se upar)
    fs = max(18, round(S * 0.028))
    font = font_cache.get(fs) or load_font(fs)
    if font:
        font_cache[fs] = font
        d = ImageDraw.Draw(img)
        bbox = d.textbbox((0, 0), CAPTION, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        d.text((cx - tw // 2, round(H * 0.93) - th), CAPTION, font=font, fill=(*CAPTION_COLOR[theme], 255))

    return img.convert('RGB')


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    lockup = trimmed(sys.argv[1])
    mark = trimmed(sys.argv[2])
    wordmark = wordmark_from_lockup(lockup)
    wordmark_by_theme = {'light': wordmark, 'dark': recolor_dark(wordmark.copy())}
    print(f'lockup {lockup.size}  mark {mark.size}  wordmark {wordmark.size}')

    os.makedirs(OUT_DIR, exist_ok=True)
    for f in os.listdir(OUT_DIR):
        os.remove(os.path.join(OUT_DIR, f))

    # App ke LaunchScreen ke liye wahi hisse alag se: tile (safed, kone CSS se gol hote hain)
    # aur wordmark dono theme me — splash PNG aur in-app screen pixel-level ek jaise.
    brand_dir = os.path.dirname(OUT_DIR)
    tile = Image.new('RGBA', (512, 512), (255, 255, 255, 255))
    m = mark.copy()
    m.thumbnail((round(512 * MARK_IN_TILE), round(512 * MARK_IN_TILE)), Image.LANCZOS)
    tile.alpha_composite(m, ((512 - m.width) // 2, (512 - m.height) // 2))
    tile.convert('RGB').save(os.path.join(brand_dir, 'launch-tile.png'), 'PNG', optimize=True)
    for theme, wm in wordmark_by_theme.items():
        w = wm.copy()
        w.thumbnail((800, round(800 * w.height / w.width)), Image.LANCZOS)
        w.save(os.path.join(brand_dir, f'wordmark-{theme}.png'), 'PNG', optimize=True)

    entries = []
    font_cache = {}
    total = 0
    for (wpt, hpt, dpr, kind, models) in DEVICES:
        orientations = ['portrait', 'landscape'] if kind == 'ipad' else ['portrait']
        for orient in orientations:
            W, H = (wpt * dpr, hpt * dpr) if orient == 'portrait' else (hpt * dpr, wpt * dpr)
            for theme in ('light', 'dark'):
                name = f'{W}x{H}-{theme}.png'
                img = render(W, H, theme, mark, wordmark_by_theme, font_cache)
                img.save(os.path.join(OUT_DIR, name), 'PNG', optimize=True)
                total += os.path.getsize(os.path.join(OUT_DIR, name))
                # device-width/height hamesha PORTRAIT ke pt — orientation alag se.
                media = (f'(device-width: {wpt}px) and (device-height: {hpt}px) and '
                         f'(-webkit-device-pixel-ratio: {dpr}) and (orientation: {orient})')
                # Dark wale par hi prefers-color-scheme; light bina clause ke (hamesha match).
                if theme == 'dark':
                    media = f'(prefers-color-scheme: dark) and {media}'
                entries.append({'url': f'/brand/splash/{name}', 'media': media, 'models': models, 'theme': theme})
        print(f'  {wpt}x{hpt}@{dpr}x  {models}')

    # Order matter karta hai: iOS me aakhri matching <link> jeet-ta hai. Pehle saare light
    # (hamesha match), uske baad saare dark — dark mode me dark wala baad me aata hai, jeet-ta
    # hai; light mode me dark wala match hi nahi hota. Yahi order pwa-asset-generator ka hai
    # (iOS 13+ par tested). Light par clause isliye nahi ki query na chale to bhi light mile.
    entries = [e for e in entries if e['theme'] == 'light'] + [e for e in entries if e['theme'] == 'dark']

    lines = [
        '// GENERATED by scripts/gen-ios-splash.py — haath se mat badlo, script chalao.',
        '// iOS launch images: app/layout.jsx → metadata.appleWebApp.startupImage.',
        '// Har entry = ek device size × orientation × light/dark; PNG ka size media query se',
        '// EXACT match hona chahiye (device-width×dpr by device-height×dpr), warna iOS kuch nahi dikhata.',
        '// ORDER matter karta hai: saare light pehle, saare dark baad me (aakhri match jeet-ta hai).',
        'export const IOS_STARTUP_IMAGES = [',
    ]
    for e in entries:
        lines.append(f"  // {e['models']}")
        lines.append(f"  {{ url: '{e['url']}', media: '{e['media']}' }},")
    lines.append('];')
    lines.append('')
    with open(OUT_JS, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines))
    print(f'\n{len(entries)} images, {total / 1024 / 1024:.1f} MB → {os.path.relpath(OUT_DIR, WEB)}')
    print(f'{os.path.relpath(OUT_JS, WEB)} likhi')


if __name__ == '__main__':
    main()
