# Font untuk gambar share dan OG

Satori (di balik `next/og`) tidak membaca woff2, jadi font di sini adalah **ttf statis** hasil instansiasi dari
font variabel yang sama dengan situs (`app/fonts/*.woff2`, paket `@fontsource-variable`):

| File | Sumber | Weight |
|---|---|---|
| `Fraunces-Regular.ttf` | fraunces | 400 |
| `Inter-Regular.ttf` | inter | 400 |
| `Inter-SemiBold.ttf` | inter | 600 |
| `JetBrainsMono-Medium.ttf` | jetbrains-mono | 500 |

Dibuat ulang dengan fontTools (`pip install fonttools brotli`). **Setelah instansiasi, semua glyph komposit harus diratakan (decompose)**: pembaca font di Satori salah menempatkan komponen (mis. tanda "+" di Fraunces tampil pecah):

```python
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
t = TTFont("app/fonts/inter-latin-wght-normal.woff2")
f = instancer.instantiateVariableFont(t, {"wght": 600}); f.flavor = None
# ratakan glyph komposit
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
gs, glyf = f.getGlyphSet(), f["glyf"]
for n in f.getGlyphOrder():
    if glyf[n].isComposite():
        rec = DecomposingRecordingPen(gs); gs[n].draw(rec)
        pen = TTGlyphPen(None); rec.replay(pen); glyf[n] = pen.glyph()
for n in f.getGlyphOrder(): glyf[n].recalcBounds(glyf)
f.save("assets/og-fonts/Inter-SemiBold.ttf")
```

Lisensi font: Fraunces, Inter, dan JetBrains Mono berlisensi SIL OFL 1.1 (sama dengan paket fontsource yang sudah dipakai).
