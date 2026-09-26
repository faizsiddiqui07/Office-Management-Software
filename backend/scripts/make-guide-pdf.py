"""
"Attendance aur Points theek karne ki guide" — PDF banata hai.

    python scripts/make-guide-pdf.py

Nikalta hai: docs/attendance-points-guide.pdf

Guide ka matn isi file me neeche GUIDE me hai — kuch badalna ho to wahan badlo aur ye
script dobara chala do. Python + reportlab (website ki tarah yahan koi PDF lib nahi hai,
aur ye ek baar ka document hai — Lambda me kuch nahi jaata).
"""
import os
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, Image, KeepTogether, NextPageTemplate, PageTemplate,
    Paragraph, Spacer, Table, TableStyle,
)

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)
OUT = os.path.join(ROOT, 'docs', 'attendance-points-guide.pdf')
BRAND = os.path.join(ROOT, 'website', 'public', 'brand')

NAVY = colors.HexColor('#0b2a5b')
BLUE = colors.HexColor('#4a7fc1')
INK = colors.HexColor('#1a2333')
MUTED = colors.HexColor('#6e7487')
RULE = colors.HexColor('#dfe3ec')
CODE_BG = colors.HexColor('#f4f6fa')
WARN_BG = colors.HexColor('#fff6e8')
WARN_EDGE = colors.HexColor('#e0a33a')
OK_BG = colors.HexColor('#eef7f0')
OK_EDGE = colors.HexColor('#4a9c63')

# Windows ke fonts — Unicode (₹ · — →) inhi se aata hai; Helvetica me ye nahi chhapte.
FONTS = [
    ('Body', r'C:\Windows\Fonts\segoeui.ttf'),
    ('Body-Bold', r'C:\Windows\Fonts\segoeuib.ttf'),
    ('Body-It', r'C:\Windows\Fonts\segoeuii.ttf'),
    ('Mono', r'C:\Windows\Fonts\consola.ttf'),
    ('Mono-Bold', r'C:\Windows\Fonts\consolab.ttf'),
]
for name, path in FONTS:
    if not os.path.exists(path):
        sys.exit(f'Font nahi mila: {path}')
    pdfmetrics.registerFont(TTFont(name, path))

ss = getSampleStyleSheet()
S = {
    'h1': ParagraphStyle('h1', parent=ss['Title'], fontName='Body-Bold', fontSize=22, leading=27, textColor=NAVY, alignment=TA_LEFT, spaceAfter=2),
    'sub': ParagraphStyle('sub', fontName='Body', fontSize=10.5, leading=15, textColor=MUTED, spaceAfter=14),
    'h2': ParagraphStyle('h2', fontName='Body-Bold', fontSize=14, leading=19, textColor=NAVY, spaceBefore=16, spaceAfter=6),
    'h3': ParagraphStyle('h3', fontName='Body-Bold', fontSize=11.5, leading=16, textColor=INK, spaceBefore=10, spaceAfter=4),
    'p': ParagraphStyle('p', fontName='Body', fontSize=10, leading=15.5, textColor=INK, spaceAfter=6),
    'li': ParagraphStyle('li', fontName='Body', fontSize=10, leading=15.5, textColor=INK, leftIndent=12, bulletIndent=2, spaceAfter=3),
    'note': ParagraphStyle('note', fontName='Body', fontSize=9.5, leading=14, textColor=MUTED, spaceAfter=6),
    'code': ParagraphStyle('code', fontName='Mono', fontSize=8.8, leading=13, textColor=INK),
    'cell': ParagraphStyle('cell', fontName='Body', fontSize=9, leading=13, textColor=INK),
    'cellb': ParagraphStyle('cellb', fontName='Body-Bold', fontSize=9, leading=13, textColor=INK),
    'cellm': ParagraphStyle('cellm', fontName='Mono', fontSize=8.5, leading=12.5, textColor=NAVY),
}


def P(t, k='p'):
    return Paragraph(t, S[k])


def bullets(items, style='li'):
    return [Paragraph(t, S[style], bulletText='•') for t in items]


def code(lines, bg=CODE_BG, edge=RULE):
    def esc(l):
        # HTML lagataar spaces ko ek me badal deta hai — terminal ka output tab tedha
        # dikhta hai, isliye har space ko pakka karo.
        t = l.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace(' ', '&nbsp;')
        return t or '&nbsp;'
    body = '<br/>'.join(esc(l) for l in lines)
    t = Table([[Paragraph(body, S['code'])]], colWidths=[165 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg),
        ('BOX', (0, 0), (-1, -1), 0.6, edge),
        ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
    ]))
    return t


def callout(title, lines, bg=WARN_BG, edge=WARN_EDGE):
    inner = [Paragraph(f'<b>{title}</b>', S['p'])] + [Paragraph(l, S['p']) for l in lines]
    t = Table([[inner]], colWidths=[165 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg),
        ('LINEBEFORE', (0, 0), (0, -1), 2.5, edge),
        ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 8), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    return t


def table(rows, widths, head=True):
    data = []
    for i, r in enumerate(rows):
        data.append([Paragraph(c, S['cellb'] if (head and i == 0) else ('cellm' if c.startswith('--') or c.startswith('node ') else 'cell') and (S['cellm'] if (c.startswith('--') or c.startswith('node ')) else S['cell'])) for c in r])
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0)
    style = [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LINEBELOW', (0, 0), (-1, -2), 0.4, RULE),
        ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7),
        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]
    if head:
        style += [('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#eef1f7')), ('LINEBELOW', (0, 0), (-1, 0), 0.8, BLUE)]
    t.setStyle(TableStyle(style))
    return t


def step(n, title):
    """Ginti wala bada heading — 'Step 3' jaisa."""
    num = ParagraphStyle('num', fontName='Body-Bold', fontSize=11, leading=11, textColor=colors.white, alignment=1)
    badge = Table([[Paragraph(str(n), num)]], colWidths=[8 * mm], rowHeights=[8 * mm])
    badge.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), NAVY), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    row = Table([[badge, Paragraph(title, S['h2'])]], colWidths=[11 * mm, 154 * mm])
    row.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 10), ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    return row


def build():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=22 * mm, rightMargin=23 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                          title='Attendance aur Points theek karne ki guide', author='ManagiBot')
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='body', leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)

    def footer(canvas, d):
        canvas.saveState()
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(d.leftMargin, 14 * mm, d.leftMargin + d.width, 14 * mm)
        canvas.setFont('Body', 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(d.leftMargin, 9.5 * mm, 'ManagiBot · Attendance aur points theek karne ki guide')
        canvas.drawRightString(d.leftMargin + d.width, 9.5 * mm, f'{canvas.getPageNumber()}')
        canvas.restoreState()

    doc.addPageTemplates([PageTemplate(id='all', frames=[frame], onPage=footer)])
    doc.build(GUIDE())
    print('Ban gaya:', OUT, f'({os.path.getsize(OUT) / 1024:.0f} KB)')


# ── Guide ka matn ────────────────────────────────────────────────────────────
def GUIDE():
    f = []
    tile = os.path.join(BRAND, 'launch-tile.png')
    wm = os.path.join(BRAND, 'wordmark-light.png')
    if os.path.exists(tile) and os.path.exists(wm):
        head = Table([[Image(tile, 13 * mm, 13 * mm), Image(wm, 34 * mm, 34 * mm * 163 / 800)]], colWidths=[16 * mm, 40 * mm])
        head.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 10)]))
        f.append(head)

    f += [
        P('Attendance aur points theek karne ki guide', 'h1'),
        P('Kisi ek din ka check-in / check-out badalna hai aur uske points bhi apne aap sahi ho jaayein — ye uska poora tareeka hai. Koi programming nahi aati, tab bhi ye guide dekh kar kaam ho jaayega.', 'sub'),

        callout('Sabse pehle ye samajh lo', [
            'Ye script <b>seedha asli (live) database</b> par chalti hai — jo badla, wo turant sab ko dikhega.',
            'Isliye har hukm <b>do baar</b> chalana hai: pehle bina <font face="Mono">--apply</font> ke (sirf dikhata hai), aur theek lage tab <font face="Mono">--apply</font> ke saath.',
        ]),

        P('Kya-kya chahiye', 'h2'),
        *bullets([
            'Wahi laptop jisme project ka folder hai: <font face="Mono">D:\\React Projects\\office-management-software</font>',
            'Node.js installed (jo pehle se hai — isi se backend chalta hai)',
            '<font face="Mono">backend</font> folder me <font face="Mono">.env</font> file (isi me database ka pata hai — ise kabhi kisi ko mat bhejna)',
        ]),

        step(1, 'Terminal kholo'),
        P('Windows me: <b>Start</b> dabao → <b>cmd</b> likho → <b>Command Prompt</b> kholo. Phir ye do line chipkao (ek-ek karke, har ek ke baad Enter):'),
        code([
            'd:',
            'cd "D:\\React Projects\\office-management-software\\backend"',
        ]),
        P('Ab tum sahi jagah par ho. Aage ke saare hukm yahin se chalenge.', 'note'),

        step(2, 'Pehle sirf dekho (kuch nahi badlega)'),
        P('Maan lo <b>Faiz</b> ka <b>18 September</b> ka check-in <b>10:09</b> karna hai:'),
        code(['node scripts/fix-checkin.js --user faiz --date 2026-09-18 --in 10:09']),
        P('Ye hukm kuch badalta nahi — sirf batata hai ki kya hoga. Jawab kuch aisa aayega:'),
        code([
            'Database: office_management   (DRY RUN — kuch nahi badlega)',
            '',
            'Mohd Faiz · mohdfaiz.1842@gmail.com · shift 10:00-18:00, grace 16 min',
            '2026-09-18 abhi: LATE     in 10:49  out 18:33  overtime 0m',
            '2026-09-18 naya: PRESENT  in 10:09  out 18:33  overtime 0m',
            '',
            'Mohd Faiz · 2026-09 ke points abhi: 307',
            '2026-09-18    -1  auto_late    Late arrival · 2026-09-18',
            '...',
            '(DRY RUN — asli badlav ke liye wahi hukm --apply ke saath chalao)',
        ]),
        P('<b>Is jawab ko dhyan se padho:</b>', 'h3'),
        table([
            ['Line', 'Iska matlab'],
            ['Database: office_management', 'Asli database hai. Agar yahan <font face="Mono">office_ui_demo</font> likha ho to wo test wala hai.'],
            ['(DRY RUN)', 'Abhi kuch nahi badla. Ye shabd dikhe to nishchint raho.'],
            ['shift 10:00-18:00, grace 16 min', 'Us bande ka apna shift. On-time ki aakhri hadd = 10:16. Iske baad late.'],
            ['abhi: LATE in 10:49', 'Jo abhi database me hai.'],
            ['naya: PRESENT in 10:09', 'Badalne ke baad kya hoga. <b>Yahi check karo ki sahi hai.</b>'],
            ['points abhi: 307', 'Us mahine ke uske kul points, badalne se pehle.'],
        ], [52 * mm, 113 * mm]),

        step(3, 'Ab asli badlav karo'),
        P('Wahi hukm, aakhir me <font face="Mono">--apply</font> laga kar. Aur agar din <b>purana</b> hai (aaj ka nahi), to <font face="Mono">--rescan-streak</font> bhi — kyun, wo agle page par:'),
        code(['node scripts/fix-checkin.js --user faiz --date 2026-09-18 --in 10:09 --apply --rescan-streak']),
        P('Jawab me aakhri hisse me ye dikhega — yahi tumhara sabut hai:'),
        code([
            'Mohd Faiz · 2026-09 ke points: 307 → 313  (farak +6)',
            '  hata : 2026-09-18    -1  auto_late    Late arrival · 2026-09-18',
            '  juda : 2026-09-21     5  auto_streak  Punctual streak · 6 days on time',
        ]),
        *bullets([
            '<b>hata</b> — jo points nikal gaye (yahan late ka jurmana)',
            '<b>juda</b> — jo naye mile (yahan 6 din lagataar on-time ka inaam)',
            '<b>farak</b> — kul kitna badla',
        ]),

        step(4, 'Aakhir me jaanch lo'),
        code(['node scripts/verify-streaks.js']),
        P('Ye sirf padhta hai, kuch badalta nahi. Ye batata hai ki streak ke award utne hi hain jitne niyam se banne chahiye.'),
        callout('Dhyan do', [
            'Abhi ye "3 zyada" dikhayega — wo Ankit ke teen purane award hain, jinhe tumne jaan-bujh kar rakhne ko kaha tha (26 Sept). Wo galti nahi, tumhara faisla hai.',
        ], bg=OK_BG, edge=OK_EDGE),

        NextPageTemplate('all'),
        P('Har option ka matlab', 'h2'),
        table([
            ['Option', 'Kya karta hai'],
            ['--user faiz', 'Kiska record. Naam ka hissa, poora email, ya employee ID — koi bhi. Do log match ho gaye to script ruk jaati hai aur dono ke naam dikha deti hai.'],
            ['--date 2026-09-18', 'Kis din ka. Hamesha <font face="Mono">YYYY-MM-DD</font> — pehle saal, phir mahina, phir din.'],
            ['--in 10:09', 'Naya check-in. 24 ghante wala waqt — shaam ke 6 baje ke liye <font face="Mono">18:00</font>.'],
            ['--out 18:30', 'Naya check-out (marzi ka). Isse us din ka overtime dobara gina jayega.'],
            ['--apply', 'Iske bina kuch nahi badalta. Yahi "haan, kar do" hai.'],
            ['--rescan-streak', 'Streak (lagataar on-time dinon ka inaam) dobara ginwata hai. <b>Purana din badla ho to zaroori hai.</b>'],
            ['--db office_ui_demo', 'Asli ki jagah test wale database par chalao — pehle aazmane ke liye.'],
        ], [40 * mm, 125 * mm]),

        P('Ek badlav se kya-kya apne aap theek hota hai', 'h2'),
        P('Sirf waqt nahi badalta — points ka poora hisaab dobara hota hai, bilkul waise jaise app me "Attendance correction" approve karne par hota hai:'),
        table([
            ['Cheez', 'Kya hota hai'],
            ['Status', 'Late ya Present — naye waqt se dobara tay hota hai (shift aur grace ke hisaab se).'],
            ['Late ka jurmana', 'On-time ho gaya to hat jata hai; ab bhi late hai to ghanton ke hisaab se theek hota hai.'],
            ['Gair-hazri (absent)', 'Din ab "aaya hua" ban gaya to absent ka jurmana hat jata hai.'],
            ['Overtime', 'Check-out badla ho to us mahine ka overtime dobara gina jata hai.'],
            ['Perfect attendance', 'Us mahine ka 20-point wala inaam dobara tay hota hai.'],
            ['Punctual streak', 'Sirf tab jab <font face="Mono">--rescan-streak</font> lagao. Neeche dekho kyun.'],
        ], [45 * mm, 120 * mm]),

        P('Streak dobara kyun ginwani padti hai', 'h2'),
        P('<b>Niyam:</b> lagataar <b>6 din</b> on-time aana = <b>+5 points</b>, phir ginti zero se shuru. Itwar, chhutti, approved leave aur work-from-home <i>neutral</i> hain — na ginti todte hain, na ginti me aate hain. Ek late din ya bina batae gair-hazri ginti ko zero kar deti hai.'),
        P('<b>Dikkat:</b> system har din ko <b>sirf ek baar</b> dekhta hai aur yaad rakhta hai ki kahan tak dekh chuka. Isliye purana din theek karne par wo dobara nahi dekhta — award chhoot jata hai. <font face="Mono">--rescan-streak</font> usse poori ginti shuru se dobara karwa deta hai.'),
        callout('Isi wajah se +5 aata hai, par alag din par', [
            'Faiz wale case me 18 Sept theek karne se award <b>18 ko nahi, 21 September ko</b> bana — kyunki 15, 16, 17, 18, 19 (20 itwar) ke baad <b>21 chhatha on-time din</b> tha.',
        ], bg=OK_BG, edge=OK_EDGE),

        P('Sirf usi bande ke points hilte hain', 'h2'),
        P('Ginti majboori me sab ke liye chalti hai (ek hi scan hai), par <font face="Mono">--user</font> ke saath chalane par script aakhir me <b>doosron ke award bilkul waise hi wapas</b> kar deti hai jaise the. Matlab: jiska din theek kiya, bas uske points badlenge — kisi aur ka ek point bhi upar-neeche nahi hoga.'),
        P('Agar kabhi <b>sab ke liye</b> poori ginti dobara karwani ho (jaise bahut saare purane din theek kiye hon), to <font face="Mono">--user</font> mat do:', 'p'),
        code(['node scripts/fix-checkin.js --rescan-streak --apply']),
        P('Tab jo award chhoot gaye the wo sab ban jayenge — aur kuch logon ke points badhenge. Ye jaan kar karna.', 'note'),

        P('Ye script kya NAHI karti', 'h2'),
        *bullets([
            '<b>Activity me kuch nahi likhti</b> — ye sudhaar andar ka kaam hai, kisi ki timeline me nahi dikhta.',
            '<b>Naya record nahi banati</b> — jis din ka koi record hi nahi, us din ke liye ye kaam nahi karegi (pehle app se attendance ya correction banwao).',
            '<b>Chhutti/leave wale din ka status nahi badalti</b> — waqt badal degi, par din "leave" hi rahega.',
            '<b>Kisi ko notification nahi bhejti.</b>',
        ]),

        P('Agar koi gadbad dikhe', 'h2'),
        table([
            ['Jawab me ye dikhe', 'Matlab / kya karo'],
            ['"faiz" naam ka koi nahi mila', 'Naam galat hai. Poora email daal kar dekho.'],
            ['"..." par 2 log mile', 'Do logon ke naam milte hain — script ne dono dikha diye honge. Poora email ya employee ID do.'],
            ['ka koi attendance record hi nahi hai', 'Us din ka record hi nahi. Pehle app me attendance banwao, phir ye chalao.'],
            ['--date YYYY-MM-DD me do', 'Tareekh ka format galat hai. <font face="Mono">2026-09-18</font> jaisa likho.'],
            ['Kuch aur error', 'Screenshot le lo aur bata do — bina <font face="Mono">--apply</font> wale hukm se kuch bigadta nahi.'],
        ], [58 * mm, 107 * mm]),

        P('Sabse zaroori teen baatein', 'h2'),
        *bullets([
            '<b>Pehle hamesha bina <font face="Mono">--apply</font> chalao.</b> Jo dikhe wo padho, tabhi aage badho.',
            '<b>Purana din badla ho to <font face="Mono">--rescan-streak</font> zaroor lagao</b> — warna streak ka inaam chhoot jayega.',
            '<b>Aakhir me <font face="Mono">verify-streaks.js</font> chala lo</b> — do second ka kaam hai, aur tasalli ho jaati hai.',
        ]),
        Spacer(1, 6),
        P('Ye guide <font face="Mono">backend/scripts/make-guide-pdf.py</font> se banti hai. Kuch badalna ho to usi file me matn badal kar <font face="Mono">python scripts/make-guide-pdf.py</font> chala do.', 'note'),
    ]
    return f


if __name__ == '__main__':
    build()
