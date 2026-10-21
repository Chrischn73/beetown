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

  /* ---------- Schieber-Erkennung (v2.9.55) ----------
     Geeicht an 23 Windelfotos vom 21.10.2026 plus Gegenbeispielen: Die Windel
     ist die grosse, gleichmaessig helle Flaeche in der Farbe der Bildmitte
     (weiss, beige oder gelb - nicht ueber "wenig Farbe" erkennen, sonst faellt
     die gelbe Kunststoffwindel durch). Gemessen: Windeln Flaeche 0,46-0,85
     des Bildes, Rechteckigkeit 0,84-0,98; Supermarkt-Prospekt 0,16 / 0,36.
     Gearbeitet wird auf einer Vorschau mit ~320 px langer Kante. */
  const BOARD_PREVIEW = 320;
  const BOARD_TOL = 60;        // max. Abweichung je Farbkanal zur Bezugsfarbe
  const BOARD_GRAY = 0.62;     // ... und mind. 62 % ihres Grauwerts
  const BOARD_MIN_AREA = 0.25; // darunter: keine Windel
  const BOARD_MIN_RECT = 0.75;
  const BOARD_MARGIN = 0;      // kein fester Rand mehr (v2.9.56): Milben liegen oft direkt am Rand

  function detectBoard(rgba, w, h){
    const s = Math.max(1, Math.ceil(Math.max(w, h) / BOARD_PREVIEW));
    const pw = Math.floor(w / s), ph = Math.floor(h / s), N = pw*ph;
    // Vorschau: Mittelwert je s*s-Block
    const pr = new Float32Array(N), pg = new Float32Array(N), pb = new Float32Array(N), gr = new Float32Array(N);
    for(let y = 0; y < ph; y++){
      for(let x = 0; x < pw; x++){
        let r = 0, g = 0, b = 0;
        for(let yy = y*s; yy < y*s + s; yy++){
          let j = (yy*w + x*s)*4;
          for(let xx = 0; xx < s; xx++, j += 4){ r += rgba[j]; g += rgba[j+1]; b += rgba[j+2]; }
        }
        const p = y*pw + x, c = s*s;
        pr[p] = r/c; pg[p] = g/c; pb[p] = b/c; gr[p] = (pr[p] + pg[p] + pb[p]) / 3;
      }
    }
    // Bezugsfarbe: Median der helleren Haelfte im mittleren Bildbereich (30-70 %)
    const mid = [];
    for(let y = Math.floor(ph*0.3); y < ph*0.7; y++)
      for(let x = Math.floor(pw*0.3); x < pw*0.7; x++) mid.push(y*pw + x);
    const median = a => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
    const gmed = median(mid.map(p => gr[p]));
    const hi = mid.filter(p => gr[p] >= gmed);
    const ref = [median(hi.map(p => pr[p])), median(hi.map(p => pg[p])), median(hi.map(p => pb[p]))];
    const refGray = (ref[0] + ref[1] + ref[2]) / 3;
    const m = new Uint8Array(N);
    for(let p = 0; p < N; p++){
      const d = Math.max(Math.abs(pr[p] - ref[0]), Math.abs(pg[p] - ref[1]), Math.abs(pb[p] - ref[2]));
      m[p] = d <= BOARD_TOL && gr[p] >= BOARD_GRAY*refGray ? 1 : 0;
    }
    // Groesste zusammenhaengende Flaeche (4er-Nachbarschaft)
    const lab = new Int32Array(N), q = new Int32Array(N);
    let cur = 0, best = 0, bestN = 0;
    for(let i0 = 0; i0 < N; i0++){
      if(!m[i0] || lab[i0]) continue;
      cur++; let qh = 0, qt = 0, n = 0; q[qt++] = i0; lab[i0] = cur;
      while(qh < qt){
        const p = q[qh++], x = p % pw; n++;
        if(x > 0 && m[p-1] && !lab[p-1]){ lab[p-1] = cur; q[qt++] = p-1; }
        if(x < pw-1 && m[p+1] && !lab[p+1]){ lab[p+1] = cur; q[qt++] = p+1; }
        if(p >= pw && m[p-pw] && !lab[p-pw]){ lab[p-pw] = cur; q[qt++] = p-pw; }
        if(p < N-pw && m[p+pw] && !lab[p+pw]){ lab[p+pw] = cur; q[qt++] = p+pw; }
      }
      if(n > bestN){ bestN = n; best = cur; }
    }
    // Loecher fuellen (Milben, Dreck): innen ist alles, was von aussen nicht erreichbar ist
    const out = new Uint8Array(N);
    let qh = 0, qt = 0;
    const push = p => { if(lab[p] !== best && !out[p]){ out[p] = 1; q[qt++] = p; } };
    for(let x = 0; x < pw; x++){ push(x); push((ph-1)*pw + x); }
    for(let y = 0; y < ph; y++){ push(y*pw); push(y*pw + pw - 1); }
    while(qh < qt){
      const p = q[qh++], x = p % pw;
      if(x > 0) push(p-1); if(x < pw-1) push(p+1);
      if(p >= pw) push(p-pw); if(p < N-pw) push(p+pw);
    }
    let area = 0;
    for(let p = 0; p < N; p++) if(!out[p]) area++;
    // Rechteckigkeit: Flaeche / kleinstes gedrehtes Rechteck (Winkel 0-87 Grad)
    let rect = 0;
    if(area){
      const xs = new Float32Array(area), ys = new Float32Array(area);
      for(let p = 0, k = 0; p < N; p++) if(!out[p]){ xs[k] = p % pw; ys[k] = (p - xs[k]) / pw; k++; }
      for(let ang = 0; ang < 90; ang += 3){
        const c = Math.cos(ang*Math.PI/180), sn = Math.sin(ang*Math.PI/180);
        let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
        for(let k = 0; k < area; k++){
          const u = xs[k]*c + ys[k]*sn, v = ys[k]*c - xs[k]*sn;
          if(u < u0) u0 = u; if(u > u1) u1 = u; if(v < v0) v0 = v; if(v > v1) v1 = v;
        }
        rect = Math.max(rect, area / ((u1 - u0 + 1)*(v1 - v0 + 1)));
      }
    }
    // Abstand zum Windelrand (Schachbrett-Distanz in Vorschau-Pixeln, Bildrand zaehlt als Rand)
    const dist = new Uint16Array(N);
    for(let p = 0; p < N; p++) dist[p] = out[p] ? 0 : 65535;
    for(let y = 0; y < ph; y++) for(let x = 0; x < pw; x++){
      const p = y*pw + x; if(!dist[p]) continue;
      let d = (x === 0 || y === 0 || x === pw-1 || y === ph-1) ? 1 : dist[p];
      if(x > 0) d = Math.min(d, dist[p-1] + 1);
      if(y > 0){ d = Math.min(d, dist[p-pw] + 1); if(x > 0) d = Math.min(d, dist[p-pw-1] + 1); if(x < pw-1) d = Math.min(d, dist[p-pw+1] + 1); }
      dist[p] = d;
    }
    for(let y = ph-1; y >= 0; y--) for(let x = pw-1; x >= 0; x--){
      const p = y*pw + x; if(!dist[p]) continue;
      let d = dist[p];
      if(x < pw-1) d = Math.min(d, dist[p+1] + 1);
      if(y < ph-1){ d = Math.min(d, dist[p+pw] + 1); if(x < pw-1) d = Math.min(d, dist[p+pw+1] + 1); if(x > 0) d = Math.min(d, dist[p+pw-1] + 1); }
      dist[p] = d;
    }
    const minDist = BOARD_MARGIN * Math.max(pw, ph);
    const inside = new Uint8Array(N);
    for(let p = 0; p < N; p++) inside[p] = dist[p] > minDist ? 1 : 0;
    area /= N;
    return { ok: area >= BOARD_MIN_AREA && rect >= BOARD_MIN_RECT,
             area: +area.toFixed(3), rect: +rect.toFixed(3), scale: s, w: pw, h: ph, inside, dist };
  }

  /* Liegt Bildpunkt (x, y) im gezaehlten Bereich der Windel? */
  function inBoard(board, x, y){
    const px = Math.min(board.w - 1, Math.floor(x / board.scale)), py = Math.min(board.h - 1, Math.floor(y / board.scale));
    return board.inside[py*board.w + px] === 1;
  }

  /* Zaehlt Milben. rgba: Uint8ClampedArray/Uint8Array (w*h*4).
     Rueckgabe: { total, marks:[{x,y,n}], width, height, ms, board }
     Ohne erkannte Windel: noBoard = true, total 0 (App zeigt "selbst zaehlen").
     opts.debug: zusaetzlich alle Flecken mit Merkmalen + Ablehnungsgrund. */
  function count(rgba, w, h, opts){
    opts = opts || {};
    const t0 = Date.now();
    const N = w*h;
    const k = Math.max(w, h) / 1280; // Massstab relativ zu 1280er-Fotos
    const lowRes = Math.max(w, h) < 2000; // Milben dann nur 3-5 px gross
    // Erst pruefen, ob ueberhaupt ein Varroa-Schieber im Bild ist
    const board = detectBoard(rgba, w, h);
    if(!board.ok) return { total: 0, marks: [], width: w, height: h, typ: 0, ms: Date.now() - t0, lowRes, noBoard: true, board };
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
    const lab = new Int32Array(N); // Fleck-Nummer + 1 je Pixel
    for(let i0 = 0; i0 < N; i0++){
      if(mask[i0] !== 1) continue;
      let sp = 0; stack[sp++] = i0; mask[i0] = 2;
      let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sg = 0, sbr = 0, sbg = 0, rmin = 9;
      let x0 = w, x1 = 0, y0 = h, y1 = 0;
      while(sp > 0){
        const p = stack[--sp];
        const x = p % w, y = (p - x) / w;
        lab[p] = blobs.length + 1;
        n++; sx += x; sy += y; sxx += x*x; syy += y*y; sxy += x*y;
        const q = p*4;
        sg += gray[p]; sbg += bg[p];
        const rr = gray[p] / bg[p]; if(rr < rmin) rmin = rr;
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
        rmin,                                          // dunkelster Pixel rel. Hintergrund (Milbe: fast schwarzer Kern)
        brown: sbr/n,
      });
    }

    /* Filter und Schwellen (v2.9.56) geeicht an 18 handgezaehlten Feldern vom
       21.10.2026 (Werkzeuge: Varroa-Counter/werkzeuge/). Reihenfolge wichtig. */
    const reject = (b, why) => { b.reject = why; };
    const median = a => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
    const k3 = 3*k*k; // frueher feste Mindestflaeche; aus groesserem Abstand sind Milben kleiner
    blobs.forEach(b => { if(b.n < 1.5*k*k) reject(b, 'klein'); });
    // Nur auf der Windel zaehlen (Rahmen, Gras, Schrauben in der Leiste)
    blobs.forEach(b => { if(!b.reject && !inBoard(board, b.cx, b.cy)) reject(b, 'ausserhalb'); });
    const onBoard = blobs.filter(b => !b.reject);

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

    /* Umfeld-Merkmale. Pixel direkt am Rand milbenaehnlicher Nachbarn zaehlen
       nicht als Kruemel (sonst wirkt ein dichtes Milbenfeld wie Dreck), gelber
       Pollen auch nicht, und gemessen wird nur auf der Windel. */
    const mk = blobs.map(b => b.n >= k3 && b.fill >= 0.8 && b.elong <= 2.2 && b.dark <= 0.32);
    const ml = p => lab[p] > 0 && mk[lab[p]-1];
    const near = new Uint8Array(N);
    { const rr = Math.max(2, Math.round(1.5*k)), tmp = new Uint8Array(N);
      for(let y = 0; y < h; y++){
        let last = -1e9; for(let x = 0; x < w; x++){ if(ml(y*w + x)) last = x; if(x - last <= rr) tmp[y*w + x] = 1; }
        last = 1e9;      for(let x = w-1; x >= 0; x--){ if(ml(y*w + x)) last = x; if(last - x <= rr) tmp[y*w + x] = 1; }
      }
      for(let x = 0; x < w; x++){
        let last = -1e9; for(let y = 0; y < h; y++){ if(tmp[y*w + x]) last = y; if(y - last <= rr) near[y*w + x] = 1; }
        last = 1e9;      for(let y = h-1; y >= 0; y--){ if(tmp[y*w + x]) last = y; if(last - y <= rr) near[y*w + x] = 1; }
      }
    }
    const boardEdge = (x, y) => board.dist[Math.min(board.h-1, Math.floor(y/board.scale))*board.w + Math.min(board.w-1, Math.floor(x/board.scale))] <= 1;
    const ctxR = 3*d1, hr = Math.max(2, Math.round(1.5*k));
    onBoard.forEach(b => {
      b.atEdge = atEdge(b.cx, b.cy);
      // ctx: halbdunkle Pixel ringsum (Biene: Koerper/Fluegel)
      // ctxg: graue Kruemel ringsum, nur Windel (Dreck)
      let s = 0, c = 0, sg = 0, cg = 0;
      for(let y = Math.max(0, Math.round(b.cy - ctxR)); y <= Math.min(h-1, b.cy + ctxR); y += 2){
        for(let x = Math.max(0, Math.round(b.cx - ctxR)); x <= Math.min(w-1, b.cx + ctxR); x += 2){
          const p = y*w + x; c++;
          const semi = mask[p] !== 2 && gray[p] < 0.75*bg[p];
          if(semi) s++;
          if(bg[p] < BG_MIN || mask[p] === 2 || boardEdge(x, y)) continue;
          cg++;
          if(semi && !near[p] && rgba[p*4] - rgba[p*4+2] <= 30) sg++;
        }
      }
      b.ctx = c ? s/c : 0; b.ctxg = cg ? sg/cg : 0;
      // halod: halbdunkler grauer Hof direkt am Fleck (Milbe: scharfe Kante)
      const bx0 = Math.round(b.cx - b.bw/2), by0 = Math.round(b.cy - b.bh/2);
      let hd = 0, hc = 0;
      for(let y = Math.max(0, by0 - hr); y <= Math.min(h-1, by0 + b.bh + hr); y++){
        for(let x = Math.max(0, bx0 - hr); x <= Math.min(w-1, bx0 + b.bw + hr); x++){
          const p = y*w + x; if(mask[p] === 2) continue;
          hc++; if(gray[p] < 0.75*bg[p] && rgba[p*4] - rgba[p*4+2] <= 30) hd++;
        }
      }
      b.halod = hc ? hd/hc : 0;
    });
    // nm: milbenaehnliche Nachbarn im Umkreis (dichtes Milbenfeld)
    { const like = onBoard.filter(b => b.n >= k3 && b.rmin <= 0.2 && b.fill >= 0.9 && b.elong <= 2.0);
      const R = 30*k, grid = new Map(), key = (gx, gy) => gx*100003 + gy;
      for(const b of like){ const kk = key(Math.floor(b.cx/R), Math.floor(b.cy/R)); if(!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(b); }
      for(const b of onBoard){
        const gx = Math.floor(b.cx/R), gy = Math.floor(b.cy/R); let c = 0;
        for(let dx = -1; dx <= 1; dx++) for(let dy = -1; dy <= 1; dy++)
          for(const o of grid.get(key(gx+dx, gy+dy)) || [])
            if(o !== b && (o.cx-b.cx)**2 + (o.cy-b.cy)**2 <= R*R) c++;
        b.nm = c;
      }
    }
    // Kante: nur verwerfen, was nicht wie eine Milbe aussieht (Milben liegen oft direkt an der Leiste)
    onBoard.forEach(b => { if(b.atEdge && !(b.elong <= 2.6 && b.fill >= 0.8 && b.halod <= 0.3)) reject(b, 'kante'); });
    // Mindestgroesse relativ zur typischen Milbe, aber nie groesser als frueher (3 k^2)
    { const cand = blobs.filter(b => !b.reject);
      const good = cand.filter(b => b.n >= k3 && b.fill >= 0.8 && b.elong <= 2 && b.dark <= 0.36).map(b => b.n);
      const pm = good.length >= 15 ? median(good) : (median(cand.filter(b => b.n >= k3).map(b => b.n)) || k3);
      const minN = Math.min(k3, 0.5*pm);
      cand.forEach(b => { if(b.n < minN) reject(b, 'klein'); });
    }

    // Typische Milbenflaeche pro Streifen (Perspektive: vorne groesser)
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
    // Dunkelheit einer typischen Milbe auf freier Windel in diesem Foto
    const clean = live.filter(b => 0.7*med <= b.n && b.n <= 1.5*med && b.fill >= 0.85 && b.elong <= 2 && b.ctxg <= 0.04).map(b => b.dark);
    const dref = clean.length >= 10 ? median(clean) : 0.30;

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
      /* Dreck (v2.9.56): Dreck ist heller als die typische Milbe des Fotos, hat
         keinen schwarzen Kern und liegt zwischen grauen Kruemeln. */
      const dirty = (() => {
        if(n >= 2 && b.ctxg > 0.04 && b.nm < 4) return true;        // Klumpen zwischen Kruemeln
        if(b.nm >= 4) return false;                                  // dichtes Milbenfeld
        if(b.rmin <= 0.18 && b.fill >= 0.94 && b.elong <= 2.3) return false; // eindeutige Milbe
        const d = b.dark - dref;
        return (b.ctxg > 0.12 && d > 0) || (b.halod > 0.16 && d > -0.02) || (b.ctxg > 0.03 && d > 0.02);
      })();
      if(dirty){ reject(b, 'dreck'); continue; }
      b.count = n;
      total += n;
      marks.push({ x: b.cx, y: b.cy, n });
    }
    const res = { total, marks, width: w, height: h, typ: med, ms: Date.now() - t0, lowRes, board };
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
     3x4 mit Zaehlwert pro Feld zum Nachzaehlen. Liefert ein JPEG-Blob. */
  function markedBlob(canvas, result){
    const w = canvas.width, h = canvas.height, k = Math.max(w, h) / 1280;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(canvas, 0, 0);
    // Nicht gezaehlter Bereich (ausserhalb der Windel und Rand) abgedunkelt
    const brd = result.board;
    if(brd && brd.ok){
      const mc = document.createElement('canvas');
      mc.width = brd.w; mc.height = brd.h;
      const mg = mc.getContext('2d'), im = mg.createImageData(brd.w, brd.h);
      for(let p = 0; p < brd.w*brd.h; p++) im.data[p*4 + 3] = brd.inside[p] ? 0 : 140;
      mg.putImageData(im, 0, 0);
      g.drawImage(mc, 0, 0, brd.w*brd.scale, brd.h*brd.scale); // weich hochskaliert, keine Treppenkante
    }
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
    g.font = `bold ${Math.round(20*k)}px sans-serif`; // klein + halbtransparent, damit keine Milben verdeckt werden
    g.textBaseline = 'top';
    for(let j = 0; j < rows; j++){
      for(let i = 0; i < cols; i++){
        const label = `${String.fromCharCode(65+j)}${i+1}: ${cells[i+','+j] || 0}`;
        const x0 = i*w/cols + 8*k, y0 = j*h/rows + 6*k, tw = g.measureText(label).width;
        g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x0 - 4, y0 - 3, tw + 8, 22*k + 6);
        g.fillStyle = 'rgba(255,220,0,0.85)'; g.fillText(label, x0, y0);
      }
    }
    return new Promise((resolve, reject) =>
      c.toBlob(b => b ? resolve(b) : reject(new Error('Bild fehlerhaft')), 'image/jpeg', 0.85));
  }

  const api = { count, analyze, markedBlob };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Varroa = api;
})(typeof window !== 'undefined' ? window : this);
