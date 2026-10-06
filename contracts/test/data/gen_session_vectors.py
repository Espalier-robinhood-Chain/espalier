#!/usr/bin/env python3
"""Membuat test/data/session_vectors.json untuk MarketSession.t.sol.

Implementasi independen (zoneinfo America/New_York, bukan aritmetika manual seperti di kontrak).
Jalankan ulang bila aturan sesi di MarketSession.sol berubah:  python3 test/data/gen_session_vectors.py
"""
import json, random, datetime as dt
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
UTC = dt.timezone.utc
CLOSED, OVERNIGHT, EXTENDED, REGULAR = 0, 1, 2, 3

# Libur contoh (bukan daftar resmi NYSE; hanya untuk menguji mekanisme): tengah pekan, Jumat, Senin.
HOLIDAYS = [dt.date(2026, 10, 7), dt.date(2026, 11, 26), dt.date(2026, 12, 25), dt.date(2027, 1, 18),
            dt.date(2027, 4, 2), dt.date(2027, 7, 5), dt.date(2028, 1, 3), dt.date(2028, 11, 22)]
HSET = set(HOLIDAYS)


def local(ts):
    return dt.datetime.fromtimestamp(ts, NY)


def session(ts):
    t = local(ts)
    d, wd = t.date(), (t.weekday() + 1) % 7  # 0 = Minggu
    m = t.hour * 3600 + t.minute * 60 + t.second
    if d in HSET:
        return CLOSED
    if m >= 20 * 3600:  # malam: Minggu-Kamis, esok bukan libur
        return OVERNIGHT if wd <= 4 and (d + dt.timedelta(days=1)) not in HSET else CLOSED
    if m < 4 * 3600:  # dini hari: Senin-Jumat, kemarin bukan libur
        return OVERNIGHT if 1 <= wd <= 5 and (d - dt.timedelta(days=1)) not in HSET else CLOSED
    if wd in (0, 6):
        return CLOSED
    return REGULAR if 9.5 * 3600 <= m < 16 * 3600 else EXTENDED


def last_open_end(ts, scan_seconds=14 * 86400):
    """Brute force per detik pada batas: cari mundur per menit lalu per detik (independen dari kontrak)."""
    if session(ts) != CLOSED:
        return ts
    t = ts
    limit = ts - scan_seconds
    while t > limit:
        t -= 60
        if session(t) != CLOSED:
            # batas ada di (t, t+60]; cari detik pertama yang Closed
            for s in range(t + 1, t + 61):
                if session(s) == CLOSED:
                    return s
    return 0


def ts_of(y, mo, d, h=0, mi=0, s=0):
    return int(dt.datetime(y, mo, d, h, mi, s, tzinfo=NY).timestamp())


random.seed(4553)
stamps = set()
lo, hi = ts_of(2026, 1, 1), ts_of(2029, 12, 31)
while len(stamps) < 1500:
    stamps.add(random.randint(lo, hi))
# Batas sesi +-1 detik untuk beberapa pekan (biasa, DST mulai/akhir, sekitar libur).
for day in [dt.date(2026, 3, 6), dt.date(2026, 3, 9), dt.date(2026, 10, 30), dt.date(2026, 11, 2),
            dt.date(2026, 10, 5), dt.date(2026, 10, 6), dt.date(2026, 10, 7), dt.date(2026, 10, 8),
            dt.date(2027, 1, 15), dt.date(2027, 1, 18), dt.date(2027, 1, 19), dt.date(2027, 4, 1), dt.date(2027, 4, 5)]:
    for k in range(-1, 3):
        d = day + dt.timedelta(days=k)
        for (h, mi) in [(0, 0), (4, 0), (9, 30), (16, 0), (20, 0)]:
            base = ts_of(d.year, d.month, d.day, h, mi)
            stamps.update([base - 1, base, base + 1])
# DST: tepat sekitar pergantian.
for iso in ["2026-03-08T06:59:59", "2026-03-08T07:00:00", "2026-11-01T05:59:59", "2026-11-01T06:00:00",
            "2027-03-14T06:59:59", "2027-03-14T07:00:00", "2027-11-07T05:59:59", "2027-11-07T06:00:00"]:
    stamps.add(int(dt.datetime.fromisoformat(iso).replace(tzinfo=UTC).timestamp()))

rows = []
for ts in sorted(stamps):
    rows.append({"ts": ts, "session": session(ts), "dst": 1 if local(ts).dst() else 0, "lastOpenEnd": last_open_end(ts)})

json.dump({"holYear": [h.year for h in HOLIDAYS], "holMonth": [h.month for h in HOLIDAYS],
           "holDay": [h.day for h in HOLIDAYS],
           "ts": [r["ts"] for r in rows], "session": [r["session"] for r in rows],
           "dst": [r["dst"] for r in rows], "lastOpenEnd": [r["lastOpenEnd"] for r in rows]},
          open("test/data/session_vectors.json", "w"), separators=(",", ":"))
print(len(rows), "vectors;", sum(1 for r in rows if r["session"] == CLOSED), "closed")
