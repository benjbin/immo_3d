#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compose_v4.py — Design sonore original (100 % synthétisé) du film « Art Exposium : la puissance technologique » v4.

Aucun échantillon externe : tout est généré ici (synthèse soustractive polyBLEP, FM, bruit filtré),
réverbération par convolution avec une réponse impulsionnelle synthétique, délai ping-pong,
compression de bus, limiteur true-peak (suréchantillonnage x4), normalisation à -14 LUFS (pyloudnorm).

Tempo 120 BPM (1 temps = 0,5 s). Tous les repères imposés tombent sur la grille :
    0,0 · 2,0 · 4,5 · 7,5 · 10,5 · 13,5 · 16,5 · 19,5 · 22,5 · 25,5 · 27,0 s ; fin 30,0 s.

Sorties (à côté de ce script) :
    v4.wav            stéréo 48 kHz 24 bits, exactement 30,000 s
    v4-waveform.png   forme d'onde + spectrogramme + traits verticaux aux repères

Usage : python compose_v4.py            (re-génération déterministe, graine fixe)
Dépendances : numpy, scipy, soundfile, pyloudnorm, matplotlib
"""
import os
import sys
import numpy as np
import soundfile as sf
from scipy import signal
from scipy.ndimage import minimum_filter1d

SR = 48000
DUR = 30.0
N = int(round(SR * DUR))
BPM = 120
BEAT = 60.0 / BPM            # 0,5 s
S16 = BEAT / 4               # double-croche
HITS = [0.0, 2.0, 4.5, 7.5, 10.5, 13.5, 16.5, 19.5, 22.5, 25.5, 27.0]
TARGET_LUFS = -14.0
CEIL_DBTP = -1.2             # plafond du limiteur (marge sous -1 dBTP)
# --- équilibre « mobile » (haut-parleurs de téléphone : quasi rien sous 150 Hz)
SUB_SHELF_DB = -5.0          # étagère grave sur le master (sous ~90 Hz)
PRESENCE_DB = 6.0            # bosse de présence 2,5 kHz sur arpège / accords / cloches / ticks
EXCITE = 0.6                 # saturation harmonique parallèle (150–600 Hz) sur basse, impacts, kick
SEED = 20261024
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_WAV = os.path.join(OUT_DIR, "v4.wav")
OUT_PNG = os.path.join(OUT_DIR, "v4-waveform.png")

rng = np.random.default_rng(SEED)


# ----------------------------------------------------------------------------- outils
def secs(t):
    return int(round(t * SR))


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


def db(x):
    return 20 * np.log10(np.maximum(np.abs(x), 1e-12))


def noise(n, color="white"):
    w = rng.standard_normal(n)
    if color == "pink":
        W = np.fft.rfft(w)
        f = np.fft.rfftfreq(n, 1 / SR)
        f[0] = f[1] if n > 2 else 1.0
        W /= np.sqrt(np.maximum(f, 20.0) / 1000.0)
        w = np.fft.irfft(W, n)
        w /= (w.std() + 1e-12)
    return w


def sos(kind, f, order=2):
    if kind == "bp":
        return signal.butter(order, [f[0], f[1]], btype="bandpass", fs=SR, output="sos")
    return signal.butter(order, f, btype={"lp": "lowpass", "hp": "highpass"}[kind], fs=SR, output="sos")


def filt(x, s):
    return signal.sosfilt(s, x, axis=0)


def biquad(kind, fc, q, gain_db=0.0):
    w = 2 * np.pi * fc / SR
    c, s = np.cos(w), np.sin(w)
    al = s / (2 * q)
    if kind == "lp":
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    elif kind == "hp":
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    elif kind == "bp":
        b = [al, 0.0, -al]
    elif kind in ("ls", "pk"):  # low-shelf / peaking RBJ
        A = 10 ** (gain_db / 40)
        if kind == "pk":
            b = [1 + al * A, -2 * c, 1 - al * A]
            a = [1 + al / A, -2 * c, 1 - al / A]
        else:
            sq = 2 * np.sqrt(A) * al
            b = [A * ((A + 1) - (A - 1) * c + sq), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sq)]
            a = [(A + 1) + (A - 1) * c + sq, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sq]
        return np.array(b) / a[0], np.array(a) / a[0]
    elif kind == "hs":  # high-shelf RBJ
        A = 10 ** (gain_db / 40)
        sq = 2 * np.sqrt(A) * al
        b = [A * ((A + 1) + (A - 1) * c + sq), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sq)]
        a = [(A + 1) - (A - 1) * c + sq, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sq]
        return np.array(b) / a[0], np.array(a) / a[0]
    a = [1 + al, -2 * c, 1 - al]
    return np.array(b) / a[0], np.array(a) / a[0]


def eq(x, kind, f, q, g):
    b, a = biquad(kind, f, q, g)
    return signal.lfilter(b, a, x, axis=0)


def excite(x, drive=4.0):
    """Saturation harmonique douce en parallèle : génère des harmoniques 150–600 Hz à partir du grave,
    pour que basse et impacts « portent » sur un petit haut-parleur."""
    lo = filt(x, sos("lp", 220, 2))
    pk = np.max(np.abs(lo)) + 1e-12
    h = np.tanh(drive * lo / pk) * pk
    h = filt(h - filt(h, sos("lp", 140, 2)), sos("lp", 700, 2))   # garde ~150–700 Hz
    return h


def tv_filter(x, kind, fc, q=0.707, block=64):
    """Filtre biquad à fréquence de coupure variable (mise à jour par blocs, état conservé)."""
    n = len(x)
    fc = np.broadcast_to(np.asarray(fc, float), (n,))
    y = np.empty_like(x)
    zi = np.zeros((2,) + x.shape[1:])
    for i in range(0, n, block):
        j = min(n, i + block)
        f = float(np.clip(fc[(i + j) // 2], 15.0, 0.45 * SR))
        b, a = biquad(kind, f, q)
        y[i:j], zi = signal.lfilter(b, a, x[i:j], axis=0, zi=zi)
    return y


def saw(freq, n, ph0=None):
    """Dent de scie à bande limitée (polyBLEP)."""
    f = np.broadcast_to(np.asarray(freq, float), (n,))
    dt = f / SR
    if ph0 is None:
        ph0 = rng.random()
    ph = (ph0 + np.cumsum(dt)) % 1.0
    y = 2 * ph - 1
    m = ph < dt
    x = ph[m] / dt[m]
    y[m] -= x + x - x * x - 1
    m = ph > 1 - dt
    x = (ph[m] - 1) / dt[m]
    y[m] -= x * x + x + x + 1
    return y


def adsr(length, a, d, s, r):
    nl, nr = max(1, secs(length)), max(1, secs(r))
    t = np.arange(nl) / SR
    e = s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4))
    if a > 0:
        m = t < a
        e[m] = np.sin(0.5 * np.pi * t[m] / a)
    rel = e[-1] * np.cos(0.5 * np.pi * np.arange(nr) / nr) ** 2
    return np.concatenate([e, rel])


def place(buf, sig, t0, gain=1.0, pan=0.0):
    sig = np.asarray(sig, float)
    if sig.ndim == 1:
        th = (np.clip(pan, -1, 1) + 1) * np.pi / 4
        sig = np.stack([sig * np.cos(th), sig * np.sin(th)], 1) * np.sqrt(2)
    i0 = secs(t0)
    if i0 < 0:
        sig = sig[-i0:]
        i0 = 0
    j = min(N, i0 + len(sig))
    if j > i0:
        buf[i0:j] += sig[: j - i0] * gain


def pan_dyn(mono, pan):
    th = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    return np.stack([mono * np.cos(th), mono * np.sin(th)], 1) * np.sqrt(2)


def norm(x):
    return x / (np.max(np.abs(x)) + 1e-12)


def stem():
    return np.zeros((N, 2))


# ----------------------------------------------------------------------------- instruments
def kick_sig(f_hi=160.0, f_lo=50.0, dur=0.55, click=0.35):
    n = secs(dur)
    t = np.arange(n) / SR
    f = f_lo + (f_hi - f_lo) * np.exp(-t / 0.028)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.17)
    clk = filt(noise(n), sos("lp", 2500)) * np.exp(-t / 0.003) * click
    y = np.tanh(1.6 * (body + clk)) / np.tanh(1.6)
    y = y + EXCITE * 0.8 * excite(body, 4.0)
    y *= np.minimum(1, t / 0.0005) * np.clip((dur - t) / 0.05, 0, 1)
    return y


def impact_sig(strength=1.0, tail=2.8, bright=1.0, low=1.0):
    """Impact grave : boum sub à glissement de hauteur + thump + craquement court + souffle stéréo."""
    n = secs(tail)
    t = np.arange(n) / SR
    f = 40 + 75 * np.exp(-t / 0.08)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.55) * low
    thump = norm(filt(noise(n), sos("lp", 260, 4))) * np.exp(-t / 0.05) * 0.7
    crack = norm(filt(noise(n), sos("bp", (700, 4200), 2))) * np.exp(-t / 0.02) * 1.2 * bright
    knock = norm(filt(noise(n), sos("bp", (220, 900), 2))) * np.exp(-t / 0.04) * 1.2   # punch audible sur téléphone
    body = (boom + thump + crack + knock) * np.minimum(1, t / 0.0006)
    mono = np.tanh(1.4 * body) / np.tanh(1.4)
    mono = mono + EXCITE * 1.3 * excite(boom + thump, 5.0)
    out = np.stack([mono, mono], 1)
    for ch in range(2):
        air = norm(filt(noise(n, "pink"), sos("bp", (250, 2600), 2)))
        out[:, ch] += air * np.exp(-t / 0.45) * np.minimum(1, t / 0.01) * 0.10 * bright
    out *= np.clip((tail - t) / 0.3, 0, 1)[:, None]
    return out * strength


def whoosh_sig(L=0.8, f0=220.0, f1=3600.0, q=1.6, pan0=-0.6, pan1=0.6, shape=2.6):
    """Souffle de transition qui monte et se coupe net au repère (finit à zéro sur le hit)."""
    n = secs(L)
    t = np.arange(n) / SR
    x = t / L
    fc = f0 * (f1 / f0) ** (x ** 1.5)
    a = tv_filter(noise(n, "pink"), "bp", fc, q)
    b = tv_filter(noise(n, "pink"), "lp", 110 + 1400 * x ** 2, 0.8) * 0.45
    env = x ** shape * np.clip((L - t) / 0.06, 0, 1) ** 1.5   # « aspiration » avant le hit : contraste
    s = norm(filt((a + b) * env, sos("lp", 7000, 4)))
    return pan_dyn(s, pan0 + (pan1 - pan0) * x)


def pad_voice(f, length, a=0.4, r=1.0, bright=1.0):
    n = secs(length) + max(1, secs(r))
    t = np.arange(n) / SR
    vib = 1 + 0.0012 * np.sin(2 * np.pi * 0.23 * t + rng.random() * 6.28)
    env = adsr(length, a, 0.8, 0.8, r)[:n]
    out = np.zeros((n, 2))
    for ch, dets in enumerate([(-9, -2, 6), (-6, 3, 9)]):
        v = sum(saw(f * 2 ** (c / 1200) * vib, n) for c in dets) / 3
        v += 0.35 * np.sin(2 * np.pi * f * 0.5 * t + ch)   # chaleur (octave inf.)
        out[:, ch] = v * env
    return out


def fm_pluck(f, dur=0.45, index=2.0, ratio=2.0, decay=0.16):
    n = secs(dur)
    t = np.arange(n) / SR
    mod = index * np.exp(-t / 0.07) * np.sin(2 * np.pi * f * ratio * t)
    y = np.sin(2 * np.pi * f * t + mod) * np.exp(-t / decay)
    y *= np.minimum(1, t / 0.002) * np.clip((dur - t) / 0.03, 0, 1)
    return y


def fm_bell(f, dur=2.5, index=1.6, decay=0.9):
    n = secs(dur)
    t = np.arange(n) / SR
    mod = index * np.exp(-t / 0.35) * np.sin(2 * np.pi * f * 3.0 * t)
    y = np.sin(2 * np.pi * f * t + mod) * np.exp(-t / decay)
    y += 0.18 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / (decay * 0.35))
    y *= np.minimum(1, t / 0.003) * np.clip((dur - t) / 0.2, 0, 1)
    return y


def bass_note(f, length, cutoff=700.0, drive=1.4, saw_amt=0.55):
    n = secs(length) + secs(0.04)
    t = np.arange(n) / SR
    sub = np.sin(2 * np.pi * f * t)
    s = tv_filter(saw(f, n), "lp", 90 + cutoff * np.exp(-t / 0.07), 0.9)
    env = adsr(length, 0.003, 0.12, 0.75, 0.04)[:n]
    y = np.tanh(drive * (0.6 * sub + saw_amt * s)) / np.tanh(drive)
    y = y + EXCITE * excite(y, 4.0)
    return y * env


def clap_sig(tone=1.0):
    n = secs(0.45)
    t = np.arange(n) / SR
    nz = norm(filt(noise(n), sos("bp", (900, 3800), 2)))
    env = np.zeros(n)
    for k, d in enumerate([0.0, 0.009, 0.018]):
        tt = t - d
        env += np.where(tt >= 0, np.exp(-np.maximum(tt, 0) / (0.006 if k < 2 else 0.11)), 0)
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.045) * 0.5 * tone
    return norm(nz * env + body)


def hat_sig(decay=0.022):
    n = secs(0.12)
    t = np.arange(n) / SR
    y = filt(filt(noise(n), sos("bp", (5200, 9000), 2)), sos("lp", 9500, 4)) * np.exp(-t / decay)
    return norm(y)


def tick_sig(f=2600.0, decay=0.0022):
    n = secs(0.03)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * f * t) * np.exp(-t / decay)
    y += 0.25 * filt(noise(n), sos("bp", (1500, 5000))) * np.exp(-t / 0.0008)
    return norm(y)


def glitch_sig(L=0.06):
    """Glitch fin : micro-grains à hauteur échantillonnée-bloquée, légèrement « bitcrushés »."""
    n = secs(L)
    y = np.zeros(n)
    i = 0
    while i < n:
        g = secs(rng.uniform(0.003, 0.009))
        f = rng.choice([1100, 1650, 2200, 2750, 3300])
        tt = np.arange(g) / SR
        grain = np.sign(np.sin(2 * np.pi * f * tt)) * np.hanning(g) * rng.uniform(0.3, 1.0)
        y[i:i + g] += grain[: max(0, min(g, n - i))]
        i += g + secs(rng.uniform(0.0, 0.006))
    y = np.round(y * 12) / 12
    y = filt(y, sos("lp", 6000, 4))
    return norm(y) * np.clip((L - np.arange(n) / SR) / 0.004, 0, 1)


# ----------------------------------------------------------------------------- partition
# (début, fin, accord pad (MIDI), fondamentale basse (MIDI))
SECTIONS = [
    (0.0, 2.0, [50, 57, 62], 26),                 # 0 Accroche : quinte à vide, sombre
    (2.0, 4.5, [50, 53, 57, 60, 64], 38),          # 1 Dm9
    (4.5, 7.5, [46, 53, 57, 62], 34),              # 2 Bbmaj7
    (7.5, 10.5, [53, 57, 60, 64, 67], 41),         # 3 Fmaj9
    (10.5, 13.5, [55, 58, 62, 65, 69], 31),        # 4 Gm9
    (13.5, 16.5, [46, 50, 53, 57, 60], 34),        # 5 Bbmaj9
    (16.5, 19.5, [53, 57, 60, 64, 69], 33),        # 6 Fmaj7/A (respiration)
    (19.5, 22.5, [55, 58, 62, 65, 69], 31),        # 7 Gm9
    (22.5, 24.0, [57, 62, 64, 67], 33),            # 8a A7sus4
    (24.0, 25.5, [57, 61, 64, 67], 33),            # 8b A7 (sensible)
    (25.5, 27.0, [50, 53, 57, 60, 64], 38),        # 9 Drop Dm9
    (27.0, 30.0, [50, 54, 57, 61, 64, 69], 26),    # 10 Signature Dmaj9 (tierce picarde)
]


def interp_curve(points):
    t = np.arange(N) / SR
    xs, ys = zip(*points)
    return np.exp(np.interp(t, xs, np.log(ys)))


def compose():
    st = {k: stem() for k in ["kick", "bass", "pad", "arp", "stab", "perc", "impact",
                              "whoosh", "riser", "ui", "bell", "trace"]}

    # ---------------- pad (nappe chaude, saw désaccordées + filtre qui s'ouvre)
    for (t0, t1, chord, _) in SECTIONS:
        a = 0.9 if t0 == 0.0 else (0.08 if t0 in (25.5, 27.0) else 0.25)
        r = 2.5 if t0 == 27.0 else 0.7
        length = (t1 - t0) if t0 != 27.0 else 1.6
        for m in chord:
            place(st["pad"], pad_voice(mtof(m), length, a=a, r=r), t0, 0.16)
    pad_fc = interp_curve([(0, 400), (2, 900), (4.5, 1200), (7.5, 1500), (10.5, 1800), (13.5, 2100),
                           (16.5, 1700), (19.5, 2300), (22.5, 2500), (24.0, 1800), (25.4, 3000),
                           (25.5, 3400), (27.0, 3000), (28.5, 2200), (30, 1500)])
    st["pad"] = tv_filter(st["pad"], "lp", pad_fc, 0.9, block=128)

    # ---------------- kick (pulsation)
    kicks = []
    kicks += [(4.5 + i * BEAT, 0.8) for i in range(24)]            # 4,5 → 16,0
    kicks += [(16.5, 0.75), (17.5, 0.7), (18.5, 0.7), (19.0, 0.6)]  # respiration (demi-temps)
    kicks += [(19.5 + i * BEAT, 0.9) for i in range(9)]             # 19,5 → 23,5
    kicks += [(25.5, 1.0), (26.0, 1.0), (26.5, 1.0)]                # drop
    k = kick_sig()
    for (tk, g) in kicks:
        place(st["kick"], k, tk, g)

    # ---------------- sidechain (ducking) piloté par la grosse caisse + impacts
    t = np.arange(N) / SR
    duck = np.ones(N)
    for (tk, g, depth, tau) in [(a, b, 0.55, 0.12) for a, b in kicks] + [(h, 1.0, 0.85, 0.30) for h in HITS]:
        i0 = secs(tk)
        n = min(N - i0, secs(0.9))
        tt = np.arange(n) / SR
        e = 1 - depth * min(g, 1.0) * np.exp(-tt / tau) * np.minimum(1, tt / 0.004)
        duck[i0:i0 + n] = np.minimum(duck[i0:i0 + n], e)

    # ---------------- basse
    for (t0, t1, chord, root) in SECTIONS:
        f = mtof(root)
        if t0 == 0.0:                                   # drone sub
            place(st["bass"], np.sin(2 * np.pi * f * np.arange(secs(2.0)) / SR) * adsr(1.9, 0.6, 1, 1, 0.1)[:secs(2.0)], 0.0, 0.7)
        elif t0 == 2.0:                                 # sub tenu
            place(st["bass"], bass_note(f, 2.45, cutoff=200, saw_amt=0.3), t0, 0.75)
        elif t0 == 27.0:                                # note finale grave qui s'éteint
            n = secs(3.0)
            tt = np.arange(n) / SR
            y = np.sin(2 * np.pi * f * tt) * np.exp(-tt / 0.9) * np.minimum(1, tt / 0.004)
            y += 0.5 * np.sin(2 * np.pi * 2 * f * tt) * np.exp(-tt / 0.6)
            place(st["bass"], y, t0, 0.65)
        elif t0 == 25.5:                                # drop : double-croches, octaves
            pat = [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0]
            for i, iv in enumerate(pat):
                place(st["bass"], bass_note(f * 2 ** (iv / 12), 0.11, cutoff=1300, drive=1.8), t0 + i * S16, 0.85)
        elif t0 == 24.0:                                # tenue sous la montée
            place(st["bass"], bass_note(f, 1.35, cutoff=300, saw_amt=0.4), t0, 0.6)
        else:                                           # croches pulsées
            soft = 0.75 if t0 == 16.5 else 1.0
            steps = int(round((t1 - t0) / (BEAT / 2)))
            for i in range(steps):
                acc = 1.0 if i % 2 == 0 else 0.8
                place(st["bass"], bass_note(f, 0.2, cutoff=500 + 40 * t0), t0 + i * BEAT / 2, 0.75 * acc * soft)

    # ---------------- arpège FM (pulsation élégante, délai ping-pong)
    pattern = [0, 2, 1, 3, 2, 4, 3, 1]
    for (t0, t1, chord, root) in SECTIONS:
        if t0 < 2.0 or t0 >= 27.0:
            continue
        tones = sorted(set([m + 12 for m in chord if m + 12 <= 81] + [m + 24 for m in chord if m + 24 <= 81]))[:6]
        step = BEAT / 2 if t0 in (2.0, 4.5, 16.5) else S16
        nsteps = int(round((t1 - t0) / step))
        for i in range(nsteps):
            tn = t0 + i * step
            if 24.0 <= tn < 25.5 and i % 2:      # la montée s'épure
                continue
            m = tones[pattern[i % len(pattern)] % len(tones)]
            vel = 1.0 if abs((tn / BEAT) - round(tn / BEAT)) < 1e-6 else 0.62
            idx = 0.8 + 2.2 * min(1, tn / 25.5)
            gain = 0.10 + 0.10 * min(1, tn / 22.5)
            if t0 == 25.5:
                gain, idx = 0.24, 3.0
            place(st["arp"], fm_pluck(mtof(m), index=idx), tn, gain * vel, pan=(-0.35 if i % 2 else 0.35))
    arp_fc = interp_curve([(2, 700), (4.5, 1200), (10.5, 2200), (16.5, 1800), (19.5, 2800), (24.0, 2400),
                           (25.4, 4000), (27, 3500), (30, 3000)])
    st["arp"] = tv_filter(st["arp"], "lp", arp_fc, 0.8, block=128)

    # ---------------- accords « stab » du drop (contretemps)
    for tn in [25.75, 26.25, 26.75]:
        n = secs(0.3)
        tt = np.arange(n) / SR
        y = sum(saw(mtof(m + 12), n) for m in [50, 53, 57, 60, 64]) / 5
        y = tv_filter(y, "lp", 600 + 3000 * np.exp(-tt / 0.05), 1.0) * np.exp(-tt / 0.09)
        place(st["stab"], y, tn, 0.5, pan=0.0)

    # ---------------- percussions : clap / snap et charleston très doux
    cl = clap_sig()
    for tn in [11.0, 12.0, 13.0, 14.0, 15.0, 16.0]:
        place(st["perc"], cl, tn, 0.16)
    for tn in [20.0, 21.0, 22.0, 23.0]:
        place(st["perc"], cl, tn, 0.32)
    for tn in [26.0, 26.5]:
        place(st["perc"], cl, tn, 0.45)
    hh = hat_sig()
    for i in range(int((16.5 - 7.5) / BEAT)):
        place(st["perc"], hh, 7.5 + i * BEAT + BEAT / 2, 0.05, pan=0.3)
    for i in range(int((24.0 - 19.5) / S16)):
        tn = 19.5 + i * S16
        place(st["perc"], hh, tn, 0.06 if i % 2 else 0.025, pan=0.25 if i % 2 else -0.25)
    for i in range(int((27.0 - 25.5) / S16)):
        place(st["perc"], hat_sig(0.03), 25.5 + i * S16, 0.07 if i % 2 else 0.035, pan=0.3)
    # roulement de caisse claire accéléré dans la montée (24,0 → 25,375)
    roll, tn = [], 24.0
    while tn < 25.375 - 1e-9:
        roll.append(tn)
        tn += BEAT / 2 if tn < 24.5 else (S16 if tn < 25.0 else S16 / 2)
    for tn in roll:
        g = 0.07 + 0.22 * ((tn - 24.0) / 1.375) ** 1.5
        place(st["perc"], cl, tn, g)

    # ---------------- impacts graves sur chaque repère
    imp_cfg = {0.0: (1.0, 1.0, 1.0), 2.0: (0.75, 0.8, 0.9), 4.5: (0.85, 0.9, 1.0), 7.5: (0.8, 0.9, 1.0),
               10.5: (0.8, 0.9, 1.0), 13.5: (0.8, 0.9, 1.0), 16.5: (0.75, 0.8, 1.0), 19.5: (0.9, 1.0, 1.0),
               22.5: (0.85, 0.9, 1.0), 25.5: (1.0, 1.0, 1.1), 27.0: (0.85, 1.1, 1.0)}
    for h in HITS:
        s, b, lo = imp_cfg[h]
        place(st["impact"], impact_sig(1.0, bright=b, low=lo), h, s)

    # ---------------- whooshes de transition avant chaque repère (sauf 0,0)
    for k_, h in enumerate(HITS[1:]):
        L = 0.75 if h not in (25.5,) else 0.5
        p = 0.6 if k_ % 2 else -0.6
        g = 0.32 if h != 27.0 else 0.42
        place(st["whoosh"], whoosh_sig(L, pan0=-p, pan1=p), h - L, g)

    # ---------------- accroche 0–2 s : tracé lumineux (ton qui glisse) + éclair du logo
    n = secs(1.9)
    tt = np.arange(n) / SR
    fglide = 220 * 2 ** (tt / 1.9 * 1.0)
    tr = (np.sin(2 * np.pi * np.cumsum(fglide) / SR) + 0.4 * np.sin(2 * np.pi * np.cumsum(fglide * 1.5) / SR))
    tr *= np.sin(np.pi * np.clip(tt / 1.9, 0, 1)) ** 2
    place(st["trace"], pan_dyn(tr, -0.5 + tt / 1.9), 0.05, 0.10)
    place(st["bell"], fm_bell(mtof(86), 1.6, index=1.2, decay=0.45), 1.5, 0.10, pan=0.2)   # éclair logo D6
    place(st["bell"], fm_bell(mtof(81), 1.6, index=1.0, decay=0.45), 1.53, 0.07, pan=-0.2)

    # ---------------- petits sons d'interface (HUD) — très discrets
    def tk(tn, f=2600, g=0.05, p=0.0):
        place(st["ui"], tick_sig(f), tn, g, pan=p)

    def gl(tn, L=0.06, g=0.05, p=0.0):
        place(st["ui"], glitch_sig(L), tn, g, pan=p)

    for i, tn in enumerate(np.arange(0.25, 1.4, S16)):                 # tracé du fil de fer
        tk(tn, 3000 + 150 * (i % 3), 0.018, p=-0.5 + i / 10)
    tk(2.25, 2400, 0.05, -0.3); gl(2.75, 0.05, 0.05, 0.3); tk(3.25, 2800, 0.05, 0.2)   # SCAN → MESH → PBR
    gl(3.5, 0.08, 0.045, -0.2); tk(3.75, 3200, 0.05, 0.0)
    for i, tn in enumerate(np.arange(5.0, 6.0, S16)):                  # compteur polygones
        tk(tn, 2200 + 120 * (i % 4), 0.03 * (1 - i / 10), p=0.4)
    gl(6.0, 0.05, 0.04, -0.4)
    for i, tn in enumerate(np.arange(7.75, 10.25, BEAT / 2)):          # horloge 07:00 → 22:30
        tk(tn, 2000 if i % 2 else 2500, 0.022, p=0.45)
    gl(10.75, 0.06, 0.05, -0.3)                                         # étiquettes lots
    for tn, f in [(11.0, 2400), (11.25, 2700), (11.5, 3000), (12.0, 2600), (12.06, 3100)]:
        tk(tn, f, 0.045, p=0.3)
    for i, tn in enumerate([13.75, 13.83, 13.91]):                      # cascade des écrans
        tk(tn, 2200 + 400 * i, 0.045, p=-0.4 + 0.4 * i)
    tk(14.75, 1800, 0.05, 0.2); tk(15.5, 1800, 0.05, -0.2)              # gestes « tap »
    for i, tn in enumerate([22.75, 23.0, 23.25, 23.5]):                 # images-clés
        tk(tn, 2600 + 200 * i, 0.045, p=-0.45 + 0.3 * i)
    gl(23.75, 0.07, 0.05, 0.0)                                          # timeline
    for i, tn in enumerate(np.arange(24.0, 25.3, S16 / 2)):             # RENDER : vignettes
        tk(tn, 2000 + 1500 * (i / 42), 0.012 + 0.03 * (i / 42), p=(0.4 if i % 2 else -0.4))
    tk(28.25, 1700, 0.05, 0.0); tk(28.31, 2300, 0.03, 0.0)               # bouton « Demandez une démo »

    # ---------------- montée (riser) avant le récap : bruit + saw qui monte
    L = 2.375
    n = secs(L)
    tt = np.arange(n) / SR
    x = tt / L
    nr = tv_filter(noise(n, "pink"), "bp", 300 * (5000 / 300) ** (x ** 1.3), 2.0)
    fr = mtof(45) * 2 ** (x ** 1.4 * 2)                                  # A2 → A4
    sr = (saw(fr, n) + saw(fr * 1.006, n)) / 2
    sr = tv_filter(sr, "lp", 400 + 3200 * x ** 2, 1.2)
    env = x ** 2.2 * np.clip((L - tt) / 0.006, 0, 1)
    place(st["riser"], pan_dyn(norm(nr) * env, 0.5 * np.sin(2 * np.pi * 1.5 * tt * x)), 23.0, 0.25)
    place(st["riser"], np.stack([sr * env, np.roll(sr, 240) * env], 1), 23.0, 0.20)

    # ---------------- signature 27–30 s : cloches FM brillantes + note finale
    for tn, m, g, p in [(27.0, 74, 0.13, 0.0), (27.0, 81, 0.08, 0.2), (27.25, 78, 0.08, -0.3),
                        (27.5, 85, 0.06, 0.3), (27.75, 81, 0.06, -0.2)]:
        place(st["bell"], fm_bell(mtof(m), 2.5, index=1.3, decay=0.7), tn, g, pan=p)
    place(st["bell"], fm_bell(mtof(74), 1.5, index=1.0, decay=0.5), 28.5, 0.14, pan=0.0)  # note finale D5
    place(st["bell"], fm_bell(mtof(86), 1.5, index=0.6, decay=0.4), 28.5, 0.05, pan=0.15)

    # ---------------- ducking + « aspiration » de 40 ms avant chaque repère (l'impact se détache, même sur téléphone)
    pre = np.ones(N)
    for h in HITS[1:]:
        a, b = secs(h - 0.04), secs(h)
        pre[a:b] = np.minimum(pre[a:b], 1 - 0.6 * np.sin(0.5 * np.pi * np.linspace(0, 1, b - a)))
    for k_ in ["pad", "bass", "arp", "stab"]:
        st[k_] *= duck[:, None] if k_ != "bass" else np.minimum(1, duck * 1.25)[:, None]
    for k_ in ["pad", "arp", "stab", "perc", "bell", "ui", "trace"]:
        st[k_] *= pre[:, None]
    for k_ in ["perc", "ui", "bell"]:
        st[k_] *= np.minimum(1, duck * 1.15)[:, None]
    return st


# ----------------------------------------------------------------------------- effets & mixage
def make_ir(length=3.6, predelay=0.022):
    n = secs(length)
    t = np.arange(n) / SR
    bands = [(sos("lp", 250, 2), 3.2), (sos("bp", (250, 1800), 2), 2.6), (sos("bp", (1800, 5500), 2), 1.6),
             (sos("hp", 5500, 2), 0.7)]
    ir = np.zeros((n, 2))
    for ch in range(2):
        w = noise(n)
        for s, rt in bands:
            ir[:, ch] += filt(w, s) * np.exp(-6.91 * t / rt)
    ir *= np.minimum(1, t / 0.008)[:, None]
    ir = np.concatenate([np.zeros((secs(predelay), 2)), ir])
    return ir / np.sqrt(np.sum(ir ** 2, axis=0, keepdims=True))


def reverb(x, ir):
    y = np.stack([signal.fftconvolve(x[:, c], ir[:, c])[:N] for c in range(2)], 1)
    return filt(y, sos("hp", 180, 2))


def pingpong(x, dt=0.375, fb=0.38, taps=6):
    mono = x.mean(1)
    out = np.zeros((N, 2))
    for k in range(1, taps + 1):
        d = secs(k * dt)
        out[d:, (k - 1) % 2] += mono[:-d] * fb ** (k - 1)
    return filt(filt(out, sos("lp", 3800, 2)), sos("hp", 350, 2))


def mono_bass(x, fc=120):
    mid, side = (x[:, 0] + x[:, 1]) / 2, (x[:, 0] - x[:, 1]) / 2
    side = filt(side, sos("hp", fc, 2))
    return np.stack([mid + side, mid - side], 1)


def glue_comp(x, thr_db=-16.0, ratio=2.0, att=0.010, rel=0.18, knee=6.0):
    lvl = np.sqrt(signal.lfilter([1 - np.exp(-1 / (0.005 * SR))], [1, -np.exp(-1 / (0.005 * SR))],
                                 np.max(x ** 2, axis=1)))
    ldb = db(lvl)
    over = ldb - thr_db
    gr = np.where(over <= -knee / 2, 0.0,
                  np.where(over >= knee / 2, over * (1 - 1 / ratio),
                           (1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee)))
    a_a, a_r = np.exp(-1 / (att * SR)), np.exp(-1 / (rel * SR))
    sm = np.empty_like(gr)
    g = 0.0
    for i, v in enumerate(gr):
        g = a_a * g + (1 - a_a) * v if v > g else a_r * g + (1 - a_r) * v
        sm[i] = g
    return x * (10 ** (-sm / 20))[:, None], sm


def true_peak(x):
    return np.max(np.abs(signal.resample_poly(x, 4, 1, axis=0)))


def tp_limiter(x, ceil_db=CEIL_DBTP, look=0.0015, rel=0.06):
    c = 10 ** (ceil_db / 20)
    os_ = np.abs(signal.resample_poly(x, 4, 1, axis=0)).max(1)[: 4 * len(x)].reshape(-1, 4).max(1)
    g = np.minimum(1.0, c / np.maximum(os_, 1e-9))
    L = max(1, secs(look))
    g = minimum_filter1d(g, size=2 * L + 1, mode="nearest")
    a_r = 1 - np.exp(-1 / (rel * SR))
    gs = np.empty_like(g)
    prev = 1.0
    for i, v in enumerate(g):
        prev = v if v < prev else prev + (v - prev) * a_r
        gs[i] = prev
    gs = np.convolve(np.pad(gs, (L, L), mode="edge"), np.ones(L) / L, mode="same")[L:-L]
    y = x * gs[:, None]
    tp = true_peak(y)
    if tp > c:
        y *= c / tp * 0.999
    return y, gs


def master(st):
    import pyloudnorm as pyln
    meter = pyln.Meter(SR)
    gains_db = {"kick": -7.0, "bass": -8.5, "pad": 5.0, "arp": 9.0, "stab": 6.0, "perc": 3.0,
                "impact": -2.0, "whoosh": 0.0, "riser": 1.0, "ui": 15.0, "bell": 4.0, "trace": -1.0}
    for k in ("arp", "pad", "stab", "bell", "ui", "perc"):
        st[k] = eq(st[k], "pk", 2500, 0.7, PRESENCE_DB)
    rev_send = {"pad": 0.30, "arp": 0.35, "stab": 0.30, "perc": 0.18, "impact": 0.45, "whoosh": 0.30,
                "riser": 0.25, "ui": 0.20, "bell": 0.55, "trace": 0.5}
    dly_send = {"arp": 0.30, "stab": 0.35, "bell": 0.25, "ui": 0.15, "trace": 0.3}
    dry = stem()
    rsend = stem()
    dsend = stem()
    for k, x in st.items():
        g = 10 ** (gains_db[k] / 20)
        dry += x * g
        rsend += x * g * rev_send.get(k, 0)
        dsend += x * g * dly_send.get(k, 0)
    ir = make_ir()
    wet = reverb(rsend + 0.4 * pingpong(dsend), ir) * 0.9
    dl = pingpong(dsend) * 0.8
    # coupure (« drop gap ») avant le récap : silence 25,385 → 25,500, l'impact du drop part pile au repère
    gate = np.ones(N)
    a, b, f = secs(25.385), secs(25.5), secs(0.004)
    gate[a:b] = 0.0
    gate[a - f:a] = np.linspace(1, 0, f)
    mix = dry * gate[:, None] + (dl + wet) * (0.25 + 0.75 * gate)[:, None]

    # bus master
    mix = mono_bass(mix, 120)
    mix = filt(mix, sos("hp", 24, 2))
    b_, a_ = biquad("hs", 8500, 0.707, -3.0)
    mix = signal.lfilter(b_, a_, mix, axis=0)
    mix = eq(mix, "ls", 90, 0.707, SUB_SHELF_DB)
    mix = eq(mix, "pk", 2000, 0.6, 2.5)          # présence large (petits haut-parleurs)
    mix *= 10 ** ((-20 - meter.integrated_loudness(mix)) / 20)   # pré-niveau pour le compresseur
    mix, gr = glue_comp(mix)
    # fondu final : la note s'éteint, silence au dernier échantillon
    tt = np.arange(N) / SR
    fade = np.where(tt < 28.9, 1.0, np.cos(0.5 * np.pi * np.clip((tt - 28.9) / 1.08, 0, 1)) ** 2)
    mix *= fade[:, None]
    gain = 0.0
    for _ in range(8):
        out, lim_g = tp_limiter(mix * 10 ** (gain / 20))
        L = meter.integrated_loudness(out)
        if abs(L - TARGET_LUFS) < 0.05:
            break
        gain += TARGET_LUFS - L
    return out, {"comp_gr_max_db": float(gr.max()), "lim_gr_max_db": float(-db(lim_g.min())),
                 "lim_gr_time_pct": float(np.mean(lim_g < 0.989) * 100)}


# ----------------------------------------------------------------------------- analyse
def detect_onsets(x, hits, win=0.06, span=0.010):
    """Attaque = maximum du rapport d'énergie (10 ms après / 10 ms avant) autour de chaque repère,
    sur le signal mono filtré passe-haut 100 Hz (évite l'ondulation des cycles sub)."""
    mono = x.mean(1) if x.ndim == 2 else x
    mono = filt(mono, sos("hp", 100, 2))
    pre = secs(0.05)                       # silence avant 0 s (le film commence sur le premier hit)
    mono = np.concatenate([np.zeros(pre), mono, np.zeros(pre)])
    c = np.concatenate([[0.0], np.cumsum(mono ** 2)])
    k = secs(span)
    res = []
    for h in hits:
        a, b = secs(h - win) + pre, secs(h + win) + pre
        n = np.arange(max(k, a), b)
        post = c[n + k] - c[n]
        prev = c[n] - c[n - k]
        r = 10 * np.log10((post + 1e-10) / (prev + 1e-10))
        i = int(np.argmax(r))
        res.append(((n[i] - pre) / SR, float(r[i])))
    return res


def analyse(y, info):
    import pyloudnorm as pyln
    meter = pyln.Meter(SR)
    rep = {}
    rep["frames"] = len(y)
    rep["duree_s"] = len(y) / SR
    rep["lufs_int"] = meter.integrated_loudness(y)
    rep["sample_peak_dbfs"] = float(db(np.max(np.abs(y))))
    rep["true_peak_dbtp"] = float(db(true_peak(y)))
    rep["echantillons_ecretes"] = int(np.sum(np.abs(y) >= 0.9999))
    st_l = []
    for i in range(0, len(y) - secs(3), secs(0.1)):
        st_l.append(meter.integrated_loudness(y[i:i + secs(3)]) if np.any(y[i:i + secs(3)]) else -70)
    rep["short_term_max_lufs"] = float(np.max(st_l))
    on = detect_onsets(y, HITS)
    rep["onsets"] = [(h, o, (o - h) * 1000, r) for h, (o, r) in zip(HITS, on)]
    mono = y.mean(1)
    f, p = signal.welch(mono, SR, nperseg=8192)
    tot = p.sum()
    bands = [(20, 60), (60, 250), (250, 1000), (1000, 4000), (4000, 8000), (8000, 24000)]
    rep["bandes_pct"] = {f"{lo}-{hi}": float(100 * p[(f >= lo) & (f < hi)].sum() / tot) for lo, hi in bands}
    rep["sub<30Hz_pct"] = float(100 * p[f < 30].sum() / tot)
    # énergie > 8 kHz par tranche de 0,5 s (pire cas)
    worst = 0
    for i in range(0, len(mono) - secs(0.5), secs(0.5)):
        seg = mono[i:i + secs(0.5)]
        if np.sum(seg ** 2) < 1e-6:
            continue
        ff, pp = signal.welch(seg, SR, nperseg=2048)
        worst = max(worst, 100 * pp[ff >= 8000].sum() / pp.sum())
    rep["hf>8k_pire_tranche_pct"] = worst
    # rendu simulé « haut-parleur de téléphone » : passe-haut 200 Hz + passe-bas 12 kHz
    ph = filt(filt(y, sos("hp", 200, 4)), sos("lp", 12000, 4))
    rep["tel_lufs"] = meter.integrated_loudness(ph)
    rep["tel_onsets"] = [(h, o, (o - h) * 1000, r) for h, (o, r) in zip(HITS, detect_onsets(ph, HITS))]
    rep["correlation_LR"] = float(np.corrcoef(y[:, 0], y[:, 1])[0, 1])
    rep.update(info)
    return rep


def plot(y, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    t = np.arange(len(y)) / SR
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(16, 7.5), sharex=True,
                                 gridspec_kw={"height_ratios": [1.1, 1]})
    fig.patch.set_facecolor("#141414")
    for a in (a1, a2):
        a.set_facecolor("#141414")
        a.tick_params(colors="#FBF9F5")
        for s in a.spines.values():
            s.set_color("#555")
    dec = 48
    idx = np.arange(0, len(y), dec)
    mono = y.mean(1)
    a1.fill_between(t[idx], np.maximum.reduceat(mono, idx), np.minimum.reduceat(mono, idx), color="#8C88FF", lw=0)
    a1.set_ylim(-1, 1)
    a1.set_ylabel("amplitude (L+R)/2", color="#FBF9F5")
    a1.set_title("Art Exposium — v4.wav  (120 BPM, repères en bleu)", color="#FBF9F5")
    ff, tt, S = signal.spectrogram(y.mean(1), SR, nperseg=2048, noverlap=1536)
    a2.pcolormesh(tt, ff, 10 * np.log10(S + 1e-14), shading="auto", cmap="magma", vmin=-130, vmax=-40)
    a2.set_yscale("symlog", linthresh=200)
    a2.set_ylim(20, 20000)
    a2.axhline(8000, color="#FBF9F5", ls=":", lw=0.8)
    a2.set_ylabel("Hz", color="#FBF9F5")
    a2.set_xlabel("temps (s)", color="#FBF9F5")
    for h in HITS + [30.0]:
        for a in (a1, a2):
            a.axvline(h, color="#332CFD" if h < 30 else "#FBF9F5", lw=1.6)
        a1.text(h + 0.05, 0.9, f"{h:.1f}", color="#FBF9F5", fontsize=8)
    a1.set_xlim(0, 30)
    fig.tight_layout()
    fig.savefig(path, dpi=110, facecolor=fig.get_facecolor())
    plt.close(fig)


def main():
    st = compose()
    y, info = master(st)
    assert len(y) == N
    sf.write(OUT_WAV, y.astype(np.float64), SR, subtype="PCM_24")
    y2, sr2 = sf.read(OUT_WAV, always_2d=True)          # analyse du fichier réellement écrit (24 bits)
    rep = analyse(y2, info)
    plot(y2, OUT_PNG)
    print(f"Écrit : {OUT_WAV}\n        {OUT_PNG}")
    for k, v in rep.items():
        if k in ("onsets", "tel_onsets"):
            print(("Téléphone — " if k == "tel_onsets" else "") + "Repères (attendu → détecté, écart ms) :")
            for h, o, e, r in v:
                print(f"   {h:5.2f} s → {o:7.4f} s   {e:+6.2f} ms   (saut d'énergie {r:+.1f} dB)")
        else:
            print(f"{k}: {v}")
    return rep


if __name__ == "__main__":
    main()
