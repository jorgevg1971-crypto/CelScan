/**
 * Escáner Móvil Pro - Image Processing & Computer Vision Core
 * Algoritmo de Detección Precisa de Documentos con Clausura Direccional 1D
 * y Ajuste Trapezoidal de Perspectiva.
 */

const ScannerCore = (() => {

  const A4_ASPECT_RATIO = 1 / 1.41421356;
  const LETTER_ASPECT_RATIO = 8.5 / 11;

  /**
   * Detección de alta precisión de las 4 esquinas del documento
   */
  function detectDocumentCorners(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    // Escala de análisis (280px para alta velocidad en móviles a 20+ FPS)
    const targetDim = 280;
    const scale = Math.min(1, targetDim / Math.max(width, height));
    const sw = Math.floor(width * scale);
    const sh = Math.floor(height * scale);
    const totalPixels = sw * sh;

    const paperMask = new Uint8Array(totalPixels);

    // 1. Umbralización adaptativa por color y brillo
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const origX = Math.min(width - 1, Math.floor(x / scale));
        const origY = Math.min(height - 1, Math.floor(y / scale));
        const idx = (origY * width + origX) * 4;

        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Luminancia
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        // Saturación HSV (0 a 100)
        const maxVal = Math.max(r, g, b);
        const minVal = Math.min(r, g, b);
        const sat = maxVal === 0 ? 0 : ((maxVal - minVal) / maxVal) * 100;

        // El papel blanco tiene luminancia > 132 y saturación baja < 60
        if (lum > 132 && sat < 60) {
          paperMask[y * sw + x] = 1;
        }
      }
    }

    // 2. Clausura morfológica 1D direccional (Horizontal + Vertical)
    // Cierra líneas de tablas y texto SIN expandir el contorno exterior hacia la madera
    const closedMask = morphCloseDirectional(paperMask, sw, sh, 11);

    // 3. Encontrar componente conectado del documento
    const blobs = findConnectedComponents(closedMask, sw, sh);

    if (blobs.length > 0) {
      const cx0 = sw / 2;
      const cy0 = sh / 2;

      let bestBlob = null;
      let bestScore = -1;

      for (const blob of blobs) {
        if (blob.area < totalPixels * 0.05) continue;

        const centroidX = blob.sumX / blob.area;
        const centroidY = blob.sumY / blob.area;

        const distFromCenter = Math.hypot(centroidX - cx0, centroidY - cy0);
        const centerScore = Math.max(0.2, 1 - distFromCenter / (Math.max(sw, sh) * 0.6));

        const score = blob.area * centerScore;
        if (score > bestScore) {
          bestScore = score;
          bestBlob = blob;
        }
      }

      if (bestBlob) {
        const contour = extractContour(bestBlob.pixels, sw, sh);

        if (contour.length >= 4) {
          const hull = convexHull(contour);

          // Extraer los 4 vértices extremos del trapezoide de perspectiva
          let tl = hull[0], tr = hull[0], br = hull[0], bl = hull[0];
          let minTL = Infinity, maxTR = -Infinity, maxBR = -Infinity, minBL = Infinity;

          for (const p of hull) {
            // TL: min (x + y)
            const scoreTL = p.x + 1.15 * p.y;
            if (scoreTL < minTL) { minTL = scoreTL; tl = p; }

            // TR: max (x - y)
            const scoreTR = p.x - 1.15 * p.y;
            if (scoreTR > maxTR) { maxTR = scoreTR; tr = p; }

            // BR: max (x + y)
            const scoreBR = p.x + 1.15 * p.y;
            if (scoreBR > maxBR) { maxBR = scoreBR; br = p; }

            // BL: min (x - y)
            const scoreBL = p.x - 1.15 * p.y;
            if (scoreBL < minBL) { minBL = scoreBL; bl = p; }
          }

          const rawCorners = [tl, tr, br, bl];
          const area = polygonArea(rawCorners);

          if (area > (totalPixels * 0.04) && isConvexQuad(rawCorners)) {
            return rawCorners.map(pt => ({
              x: Math.max(0, Math.min(width, pt.x / scale)),
              y: Math.max(0, Math.min(height, pt.y / scale))
            }));
          }
        }
      }
    }

    return getA4PresetCorners(width, height);
  }

  // Clausura morfológica direccional 1D (elimina la expansión hacia el fondo)
  function morphCloseDirectional(mask, w, h, len) {
    const hClosed = new Uint8Array(w * h);
    const half = Math.floor(len / 2);

    // Pase horizontal
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x] === 1) {
          hClosed[y * w + x] = 1;
        } else {
          let leftFound = false, rightFound = false;
          for (let dx = 1; dx <= half; dx++) {
            if (x - dx >= 0 && mask[y * w + (x - dx)] === 1) leftFound = true;
            if (x + dx < w && mask[y * w + (x + dx)] === 1) rightFound = true;
          }
          if (leftFound && rightFound) {
            hClosed[y * w + x] = 1;
          }
        }
      }
    }

    // Pase vertical
    const vClosed = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (hClosed[y * w + x] === 1) {
          vClosed[y * w + x] = 1;
        } else {
          let topFound = false, botFound = false;
          for (let dy = 1; dy <= half; dy++) {
            if (y - dy >= 0 && hClosed[(y - dy) * w + x] === 1) topFound = true;
            if (y + dy < h && hClosed[(y + dy) * w + x] === 1) botFound = true;
          }
          if (topFound && botFound) {
            vClosed[y * w + x] = 1;
          }
        }
      }
    }

    return vClosed;
  }

  function findConnectedComponents(binaryMask, w, h) {
    const visited = new Uint8Array(w * h);
    const blobs = [];

    for (let y = 3; y < h - 3; y += 2) {
      for (let x = 3; x < w - 3; x += 2) {
        const idx = y * w + x;
        if (binaryMask[idx] === 1 && visited[idx] === 0) {
          const blobPixels = [];
          const queue = [idx];
          visited[idx] = 1;
          let sumX = 0;
          let sumY = 0;

          while (queue.length > 0) {
            const curr = queue.pop();
            const cx = curr % w;
            const cy = Math.floor(curr / w);

            blobPixels.push({ x: cx, y: cy });
            sumX += cx;
            sumY += cy;

            const neighbors = [
              curr - 1, curr + 1,
              curr - w, curr + w
            ];

            for (const n of neighbors) {
              if (n >= 0 && n < w * h && binaryMask[n] === 1 && visited[n] === 0) {
                visited[n] = 1;
                queue.push(n);
              }
            }
          }

          if (blobPixels.length >= 35) {
            blobs.push({
              area: blobPixels.length,
              pixels: blobPixels,
              sumX,
              sumY
            });
          }
        }
      }
    }

    return blobs;
  }

  function extractContour(pixels, w, h) {
    const grid = new Map();
    pixels.forEach(p => grid.set(`${p.x},${p.y}`, true));

    const contour = [];
    pixels.forEach(p => {
      if (!grid.has(`${p.x - 1},${p.y}`) || !grid.has(`${p.x + 1},${p.y}`) ||
          !grid.has(`${p.x},${p.y - 1}`) || !grid.has(`${p.x},${p.y + 1}`)) {
        contour.push(p);
      }
    });

    return contour;
  }

  function getA4PresetCorners(width, height) {
    const isPortrait = height >= width;
    let targetW, targetH;

    if (isPortrait) {
      targetW = width * 0.82;
      targetH = targetW * (1 / A4_ASPECT_RATIO);
      if (targetH > height * 0.88) {
        targetH = height * 0.88;
        targetW = targetH * A4_ASPECT_RATIO;
      }
    } else {
      targetH = height * 0.82;
      targetW = targetH * (1 / A4_ASPECT_RATIO);
      if (targetW > width * 0.88) {
        targetW = width * 0.88;
        targetH = targetW * A4_ASPECT_RATIO;
      }
    }

    const left = (width - targetW) / 2;
    const top = (height - targetH) / 2;
    return [
      { x: left, y: top },
      { x: left + targetW, y: top },
      { x: left + targetW, y: top + targetH },
      { x: left, y: top + targetH }
    ];
  }

  function getLetterPresetCorners(width, height) {
    const isPortrait = height >= width;
    let targetW, targetH;

    if (isPortrait) {
      targetW = width * 0.84;
      targetH = targetW * (1 / LETTER_ASPECT_RATIO);
      if (targetH > height * 0.88) {
        targetH = height * 0.88;
        targetW = targetH * LETTER_ASPECT_RATIO;
      }
    } else {
      targetH = height * 0.84;
      targetW = targetH * (1 / LETTER_ASPECT_RATIO);
      if (targetW > width * 0.88) {
        targetW = width * 0.88;
        targetH = targetW * LETTER_ASPECT_RATIO;
      }
    }

    const left = (width - targetW) / 2;
    const top = (height - targetH) / 2;
    return [
      { x: left, y: top },
      { x: left + targetW, y: top },
      { x: left + targetW, y: top + targetH },
      { x: left, y: top + targetH }
    ];
  }

  function convexHull(points) {
    if (points.length <= 3) return points;
    const pts = points.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }

    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function isConvexQuad(pts) {
    if (pts.length !== 4) return false;
    let prevSign = 0;
    for (let i = 0; i < 4; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % 4];
      const p3 = pts[(i + 2) % 4];
      const cross = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
      const sign = cross > 0 ? 1 : (cross < 0 ? -1 : 0);
      if (sign === 0) continue;
      if (prevSign === 0) prevSign = sign;
      else if (prevSign !== sign) return false;
    }
    return true;
  }

  function polygonArea(points) {
    let area = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
  }

  /**
   * Corrección de perspectiva con homografía inversa
   */
  function warpPerspective(sourceCanvas, corners) {
    const [tl, tr, br, bl] = corners;

    const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const widthBottom = Math.hypot(br.x - bl.x, br.y - bl.y);
    const dstWidth = Math.max(400, Math.round(Math.max(widthTop, widthBottom)));

    const heightLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const heightRight = Math.hypot(br.x - tr.x, br.y - tr.y);
    const dstHeight = Math.max(400, Math.round(Math.max(heightLeft, heightRight)));

    const dstCorners = [
      { x: 0, y: 0 },
      { x: dstWidth, y: 0 },
      { x: dstWidth, y: dstHeight },
      { x: 0, y: dstHeight }
    ];

    const H_inv = getPerspectiveTransform(dstCorners, corners);

    const srcCtx = sourceCanvas.getContext('2d');
    const srcImgData = srcCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const srcWidth = sourceCanvas.width;
    const srcHeight = sourceCanvas.height;
    const srcData = srcImgData.data;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = dstWidth;
    outCanvas.height = dstHeight;
    const outCtx = outCanvas.getContext('2d');
    const outImgData = outCtx.createImageData(dstWidth, dstHeight);
    const outData = outImgData.data;

    const h0 = H_inv[0], h1 = H_inv[1], h2 = H_inv[2];
    const h3 = H_inv[3], h4 = H_inv[4], h5 = H_inv[5];
    const h6 = H_inv[6], h7 = H_inv[7], h8 = H_inv[8];

    for (let dy = 0; dy < dstHeight; dy++) {
      for (let dx = 0; dx < dstWidth; dx++) {
        const w = h6 * dx + h7 * dy + h8;
        const sx = (h0 * dx + h1 * dy + h2) / w;
        const sy = (h3 * dx + h4 * dy + h5) / w;

        const outIdx = (dy * dstWidth + dx) * 4;

        if (sx >= 0 && sx < srcWidth - 1 && sy >= 0 && sy < srcHeight - 1) {
          const x0 = Math.floor(sx);
          const y0 = Math.floor(sy);
          const x1 = x0 + 1;
          const y1 = y0 + 1;
          const fx = sx - x0;
          const fy = sy - y0;

          const idx00 = (y0 * srcWidth + x0) * 4;
          const idx10 = (y0 * srcWidth + x1) * 4;
          const idx01 = (y1 * srcWidth + x0) * 4;
          const idx11 = (y1 * srcWidth + x1) * 4;

          for (let c = 0; c < 3; c++) {
            const top = srcData[idx00 + c] * (1 - fx) + srcData[idx10 + c] * fx;
            const bottom = srcData[idx01 + c] * (1 - fx) + srcData[idx11 + c] * fx;
            outData[outIdx + c] = top * (1 - fy) + bottom * fy;
          }
          outData[outIdx + 3] = 255;
        } else {
          outData[outIdx] = 255;
          outData[outIdx + 1] = 255;
          outData[outIdx + 2] = 255;
          outData[outIdx + 3] = 255;
        }
      }
    }

    outCtx.putImageData(outImgData, 0, 0);
    return outCanvas;
  }

  function getPerspectiveTransform(src, dst) {
    const a = [];
    const b = [];

    for (let i = 0; i < 4; i++) {
      const sx = src[i].x;
      const sy = src[i].y;
      const dx = dst[i].x;
      const dy = dst[i].y;

      a.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
      b.push(dx);

      a.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
      b.push(dy);
    }

    const h = solveLinearSystem8(a, b);
    return [
      h[0], h[1], h[2],
      h[3], h[4], h[5],
      h[6], h[7], 1
    ];
  }

  function solveLinearSystem8(A, B) {
    const n = 8;
    const M = [];
    for (let i = 0; i < n; i++) {
      M.push([...A[i], B[i]]);
    }

    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) {
          maxRow = k;
        }
      }
      const tmp = M[i];
      M[i] = M[maxRow];
      M[maxRow] = tmp;

      const pivot = M[i][i];
      if (Math.abs(pivot) < 1e-10) continue;

      for (let j = i; j <= n; j++) {
        M[i][j] /= pivot;
      }

      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = M[k][i];
          for (let j = i; j <= n; j++) {
            M[k][j] -= factor * M[i][j];
          }
        }
      }
    }

    const res = [];
    for (let i = 0; i < n; i++) {
      res.push(M[i][n]);
    }
    return res;
  }

  /**
   * Filtros fotográficos
   */
  function applyDocumentFilter(canvas, options = {}) {
    const {
      filterType = 'magic',
      brightness = 0,
      contrast = 100,
      sharpness = 0
    } = options;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    let imgData = ctx.getImageData(0, 0, w, h);
    let data = imgData.data;

    if (filterType === 'magic') {
      for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        const lumVal = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lumVal > 140) {
          const boost = (lumVal - 140) / 115 * 55;
          r = Math.min(255, r + boost);
          g = Math.min(255, g + boost);
          b = Math.min(255, b + boost);
        } else {
          const dim = (140 - lumVal) / 140 * 30;
          r = Math.max(0, r - dim);
          g = Math.max(0, g - dim);
          b = Math.max(0, b - dim);
        }

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }
    } else if (filterType === 'bw') {
      for (let i = 0; i < data.length; i += 4) {
        const lumVal = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const val = lumVal > 135 ? 255 : (lumVal < 70 ? 0 : ((lumVal - 70) / 65) * 255);
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
      }
    } else if (filterType === 'grayscale') {
      for (let i = 0; i < data.length; i += 4) {
        const lumVal = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        data[i] = lumVal;
        data[i + 1] = lumVal;
        data[i + 2] = lumVal;
      }
    }

    const cFactor = contrast / 100;
    const bOffset = brightness * 1.5;

    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let val = data[i + c];
        val += bOffset;
        val = (val - 128) * cFactor + 128;
        data[i + c] = Math.max(0, Math.min(255, val));
      }
    }

    ctx.putImageData(imgData, 0, 0);

    if (sharpness > 0) {
      applySharpenConvolution(canvas, sharpness / 100);
    }
  }

  function applySharpenConvolution(canvas, strength) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const src = ctx.getImageData(0, 0, w, h);
    const srcData = src.data;
    const out = ctx.createImageData(w, h);
    const outData = out.data;

    const s = strength * 0.75;
    const center = 1 + 4 * s;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        const topIdx = ((y - 1) * w + x) * 4;
        const botIdx = ((y + 1) * w + x) * 4;
        const leftIdx = (y * w + (x - 1)) * 4;
        const rightIdx = (y * w + (x + 1)) * 4;

        for (let c = 0; c < 3; c++) {
          const val = center * srcData[idx + c] -
                      s * (srcData[topIdx + c] + srcData[botIdx + c] + srcData[leftIdx + c] + srcData[rightIdx + c]);
          outData[idx + c] = Math.max(0, Math.min(255, val));
        }
        outData[idx + 3] = 255;
      }
    }

    ctx.putImageData(out, 0, 0);
  }

  return {
    detectDocumentCorners,
    getA4PresetCorners,
    getLetterPresetCorners,
    warpPerspective,
    applyDocumentFilter
  };
})();
