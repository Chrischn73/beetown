/* Automatische Varroa-Zaehlung auf Windelfotos - klassische Bildauswertung im
   Browser (Canvas), ohne KI und ohne Server-Abhaengigkeit.

   Messwerte (Machbarkeitstest 20.10.2026, Python-Vorlage varroa_count.py):
   Milben sind im Foto fast schwarz (Grauwert 20-50) auf heller Windel
   (150-210), brauner Dreck/Pollen ist nur halb so dunkel und deutlich
   braeunlicher. Ein "rotbraun"-Filter erkennt deshalb genau das Falsche.
   Gezaehlt werden zusammenhaengende dunkle Flecken; Klumpen werden ueber die
   typische Milbenflaeche (pro Bildstreifen wegen Perspektive) aufgeteilt.
   Zusaetzlich zur Python-Vorlage: Formpruefung (kompaktes Oval, gleichmaessig
   dunkel) gegen Dreck und Bienenteile.

   Kern (count) arbeitet auf RGBA-Pixeln und ist ohne DOM testbar (Node). */
(function(root){
  'use strict';

  const DARK_RATIO = 0.45; // Pixel-Grauwert <= 45 % des lokalen Hintergrunds
  const BG_MIN = 110;      // Hintergrund muss hell sein (Windel, nicht Holz/Rahmen)
  const BROWN_MAX = 24;    // R - (G+B)/2 darueber = brauner Dreck
  const BANDS = 4;         // horizontale Streifen fuer die typische Milbenflaeche

  /* Grauwert wie PIL convert('L') (ITU-R 601, gerundet) */
  function toGray(rgba, n){
    const g = new Uint8Array(n);
    for(let i = 0, j = 0; i < n; i++, j += 4){
      g[i] = (rgba[j]*19595 + rgba[j+1]*38470 + rgba[j+2]*7471 + 0x8000) >> 16;
    }
    return g;
  }

  /* Box-Blur mit Radius r (Fenster 2r+1), Rand wird fortgesetzt - wie
     PIL ImageFilter.BoxBlur. Zwei Durchgaenge (waagerecht, senkrecht). */
  function boxBlur(src, w, h, r){
    const tmp = new Uint8Array(w*h), out = new Uint8Array(w*h);
    const win = 2*r + 1;
    for(let y = 0; y < h; y++){
      const row = y*w;
      let s = 0;
      for(let k = -r; k <= r; k++) s += src[row + Math.min(w-1, Math.max(0, k))];
      for(let x = 0; x < w; x++){
        tmp[row + x] = Math.round(s / win);
        s += src[row + Math.min(w-1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    for(let x = 0; x < w; x++){
      let s = 0;
      for(let k = -r; k <= r; k++) s += tmp[Math.min(h-1, Math.max(0, k))*w + x];
      for(let y = 0; y < h; y++){
        out[y*w + x] = Math.round(s / win);
        s += tmp[Math.min(h-1, y + r + 1)*w + x] - tmp[Math.max(0, y - r)*w + x];
      }
    }
    return out;
  }

  /* Zaehlt Milben. rgba: Uint8ClampedArray/Uint8Array (w*h*4).
     Rueckgabe: { total, marks:[{x,y,n}], width, height, ms }
     opts.debug: zusaetzlich alle Flecken mit Merkmalen + Ablehnungsgrund. */
  function count(rgba, w, h, opts){
    opts = opts || {};
    const t0 = Date.now();
    const N = w*h;
    const k = Math.max(w, h) / 1280; // Massstab relativ zu 1280er-Fotos
    const gray = toGray(rgba, N);
    const bg = boxBlur(gray, w, h, Math.round(14*k));

    const mask = new Uint8Array(N);
    for(let i = 0, j = 0; i < N; i++, j += 4){
      const b = bg[i];
      if(b >= BG_MIN && gray[i] <= DARK_RATIO*b &&
         rgba[j] - (rgba[j+1] + rgba[j+2])/2 <= BROWN_MAX) mask[i] = 1;
    }

    // Zusammenhaengende Flecken (8er-Nachbarschaft), Merkmale sammeln
    const blobs = [];
    const stack = new Int32Array(N > 1<<22 ? 1<<22 : N);
    for(let i0 = 0; i0 < N; i0++){
      if(mask[i0] !== 1) continue;
      let sp = 0; stack[sp++] = i0; mask[i0] = 2;
      let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sg = 0, sbr = 0, sbg = 0;
      let x0 = w, x1 = 0, y0 = h, y1 = 0;
      while(sp > 0){
        const p = stack[--sp];
        const x = p % w, y = (p - x) / w;
        n++; sx += x; sy += y; sxx += x*x; syy += y*y; sxy += x*y;
        const q = p*4;
        sg += gray[p]; sbg += bg[p];
        sbr += rgba[q] - (rgba[q+1] + rgba[q+2])/2;
        if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y;
        for(let dy = -1; dy <= 1; dy++){
          const ny = y + dy;
          if(ny < 0 || ny >= h) continue;
          for(let dx = -1; dx <= 1; dx++){
            const nx = x + dx;
            if(nx < 0 || nx >= w) continue;
            const nb = ny*w + nx;
            if(mask[nb] === 1 && sp < stack.length){ mask[nb] = 2; stack[sp++] = nb; }
          }
        }
      }
      const cx = sx/n, cy = sy/n;
      // Kovarianz -> Haupt-/Nebenachse (Ellipsen-Naeherung)
      const vxx = sxx/n - cx*cx, vyy = syy/n - cy*cy, vxy = sxy/n - cx*cy;
      const tr = vxx + vyy, det = vxx*vyy - vxy*vxy;
      const disc = Math.sqrt(Math.max(0, tr*tr/4 - det));
      const l1 = tr/2 + disc, l2 = Math.max(tr/2 - disc, 1/12);
      blobs.push({
        n, cx, cy, bw: x1-x0+1, bh: y1-y0+1,
        elong: Math.sqrt(l1/l2),                       // 1 = rund
        fill: n / (4*Math.PI*Math.sqrt(l1*l2)),        // ~1 = gefuelltes Oval
        dark: (sg/n) / (sbg/n),                        // mittlere Dunkelheit rel. Hintergrund
        brown: sbr/n,
      });
    }

    const reject = (b, why) => { b.reject = why; };
    const minArea = 3*k*k;
    blobs.forEach(b => { if(b.n < minArea) reject(b, 'klein'); });

    // Rand-Filter: liegt der Fleck an der Kante zum dunklen Rahmen, ist es in
    // mehreren Richtungen dauerhaft (10 und 18 px) dunkel.
    const dirs = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
    const d1 = Math.round(10*k), d2 = Math.round(18*k);
    const atEdge = (cx, cy) => {
      let hits = 0;
      for(const [dx, dy] of dirs){
        let dark = true;
        for(const dist of [d1, d2]){
          const x = Math.trunc(cx + dx*dist), y = Math.trunc(cy + dy*dist);
          if(x >= 0 && x < w && y >= 0 && y < h && gray[y*w + x] >= 110) dark = false;
        }
        if(dark) hits++;
      }
      return hits >= 3;
    };
    blobs.forEach(b => { if(!b.reject && atEdge(b.cx, b.cy)) reject(b, 'kante'); });

    // Umfeld: Anteil mittel-dunkler Pixel in einem Fenster um den Fleck
    // (Biene: Koerper/Fluegel ringsum, Milbe: freie Windel)
    const ctxR = 3*d1;
    blobs.forEach(b => {
      if(b.reject) return;
      let s = 0, c = 0;
      for(let y = Math.max(0, Math.round(b.cy - ctxR)); y <= Math.min(h-1, b.cy + ctxR); y += 2){
        for(let x = Math.max(0, Math.round(b.cx - ctxR)); x <= Math.min(w-1, b.cx + ctxR); x += 2){
          const p = y*w + x; c++;
          if(mask[p] !== 2 && gray[p] < 0.75*bg[p]) s++;
        }
      }
      b.ctx = c ? s/c : 0;
    });

    // Typische Milbenflaeche pro Streifen (Perspektive: vorne groesser)
    const median = a => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
    const live = blobs.filter(b => !b.reject);
    const med = live.length ? median(live.map(b => b.n)) : 1;
    const meds = [];
    for(let i = 0; i < BANDS; i++){
      const a = live.filter(b => i*h/BANDS <= b.cy && b.cy < (i+1)*h/BANDS).map(b => b.n);
      meds.push(a.length >= 15 ? median(a) : med);
    }

    // Umfeld einer typischen Einzelmilbe in diesem Foto (verschmutzte Windel
    // hat ueberall Kruemel - Biene erkennt man nur relativ dazu)
    const ctxMed = median(live.filter(b => b.n < 1.5*med).map(b => b.ctx)) || 0;
    const ctxBee = Math.max(0.06, 3*ctxMed);

    let total = 0;
    const marks = [];
    for(const b of blobs){
      if(b.reject) continue;
      const m = meds[Math.min(BANDS-1, Math.floor(b.cy*BANDS/h))];
      if(b.n > 12*m){ reject(b, 'gross'); continue; }  // Holzrand, Biene o. ae.
      const n = Math.max(1, Math.round(b.n / (1.25*m))); // Einzelmilben streuen in der Groesse
      /* Formpruefung (geeicht an Galerien der Testfotos 20.10.2026): Einzelmilbe
         ist ein kompaktes Oval (Laenge/Breite bis ~2,3 auch von der Seite),
         Dreck/Zweige/Kanten sind lang oder zerfranst. Mehrere aneinander
         liegende Milben sind laenglich, aber nicht ausgefranst. */
      if(n === 1 ? (b.elong > 2.6 || b.fill < 0.6) : (b.elong > 4.5 || b.fill < 0.5 || (n >= 4 && b.fill < 0.65))){
        reject(b, 'form'); continue;
      }
      // Loch in der Kunststoffwindel: kreisrund, gross, randscharf - ein
      // Milbenhaufen ist nie so gleichmaessig rund.
      if(n >= 3 && b.elong <= 1.35 && b.fill >= 0.93){ reject(b, 'loch'); continue; }
      // Tote Biene: dunkle Koerperteile mit viel Halbdunklem (Streifen, Fluegel) ringsum
      if(n >= 3 && b.ctx > ctxBee){ reject(b, 'biene'); continue; }
      b.count = n;
      total += n;
      marks.push({ x: b.cx, y: b.cy, n });
    }
    const res = { total, marks, width: w, height: h, typ: med, ms: Date.now() - t0,
                  lowRes: Math.max(w, h) < 2000 }; // Milben dann nur 3-5 px gross
    if(opts.debug) res.blobs = blobs;
    return res;
  }

  /* ---------- Browser: Foto laden, zaehlen, markiertes Bild erzeugen ---------- */

  function loadImage(blob){
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild nicht lesbar')); };
      img.src = url;
    });
  }

  /* Zaehlt auf dem (schon verkleinerten) JPEG, das auch gespeichert wird -
     so passt die Markierung immer zum gespeicherten Foto. */
  async function analyze(blob){
    const img = await loadImage(blob);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const result = count(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    return { result, canvas: c };
  }

  /* Kontrollbild: Kreise (blau = Milbe, lila = mehrere) + Raster 4x3 bzw.
     3x4 mit Zaehlwert pro Feld zum Nachzaehlen. Liefert eine Blob-URL. */
  function markedURL(canvas, result){
    const w = canvas.width, h = canvas.height, k = Math.max(w, h) / 1280;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(canvas, 0, 0);
    g.lineWidth = Math.max(2, Math.round(2*k));
    for(const m of result.marks){
      g.strokeStyle = m.n === 1 ? 'rgb(0,200,255)' : 'rgb(255,0,255)';
      g.beginPath(); g.arc(m.x, m.y, (m.n === 1 ? 7 : 10)*k, 0, 2*Math.PI); g.stroke();
    }
    const [cols, rows] = w >= h ? [4, 3] : [3, 4];
    const cells = {};
    for(const m of result.marks){
      const key = Math.min(cols-1, Math.floor(m.x*cols/w)) + ',' + Math.min(rows-1, Math.floor(m.y*rows/h));
      cells[key] = (cells[key] || 0) + m.n;
    }
    g.strokeStyle = 'rgb(255,220,0)';
    g.beginPath();
    for(let i = 1; i < cols; i++){ g.moveTo(i*w/cols, 0); g.lineTo(i*w/cols, h); }
    for(let j = 1; j < rows; j++){ g.moveTo(0, j*h/rows); g.lineTo(w, j*h/rows); }
    g.stroke();
    g.font = `bold ${Math.round(28*k)}px sans-serif`;
    g.textBaseline = 'top';
    for(let j = 0; j < rows; j++){
      for(let i = 0; i < cols; i++){
        const label = `${String.fromCharCode(65+j)}${i+1}: ${cells[i+','+j] || 0}`;
        const x0 = i*w/cols + 8*k, y0 = j*h/rows + 6*k, tw = g.measureText(label).width;
        g.fillStyle = '#000'; g.fillRect(x0 - 4, y0 - 3, tw + 8, 30*k + 6);
        g.fillStyle = 'rgb(255,220,0)'; g.fillText(label, x0, y0);
      }
    }
    return new Promise((resolve, reject) =>
      c.toBlob(b => b ? resolve(URL.createObjectURL(b)) : reject(new Error('Bild fehlerhaft')), 'image/jpeg', 0.85));
  }

  const api = { count, analyze, markedURL };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Varroa = api;
})(typeof window !== 'undefined' ? window : this);
