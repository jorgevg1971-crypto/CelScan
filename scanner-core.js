/**
 * Escáner Móvil Pro - Image Processing & Computer Vision Core
 * Algoritmo de Detección con Snap de Gradiente Activo (Active Gradient Edge Snapping)
 * Encuadra de forma milimétrica los 4 bordes exactos del papel.
 */

const ScannerCore = (() => {

  const A4_ASPECT_RATIO = 1 / 1.41421356;
  const LETTER_ASPECT_RATIO = 8.5 / 11;

  /**
   * Detección automática con ajuste activo al pico de gradiente
   */
  function detectDocumentCorners(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    // Escala de análisis (280px para alta velocidad a 20+ FPS en móviles)
    const targetDim = 280;
    const scale = Math.min(1, targetDim / Math.max(width, height));
    const sw = Math.floor(width * scale);
    const sh = Math.floor(height * scale);
    const totalPixels = sw * sh;

    const lum = new Float32Array(totalPixels);
    const sat = new Float32Array(totalPixels);
    const paperMask = new Uint8Array(totalPixels);

    // 1. Mapas de Luminancia, Saturación y Máscara Inicial
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const origX = Math.min(width - 1, Math.floor(x / scale));
        const origY = Math.min(height - 1, Math.floor(y / scale));
        const idx = (origY * width + origX) * 4;

        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        lum[y * sw + x] = l;

        const maxVal = Math.max(r, g, b);
        const minVal = Math.min(r, g, b);
        const s = maxVal === 0 ? 0 : ((maxVal - minVal) / maxVal) * 100;
        sat[y * sw + x] = s;

        if (l > 130 && s < 62) {
          paperMask[y * sw + x] = 1;
        }
      }
    }

    // 2. Gradientes direccionales Sobel
    const gradX = new Float32Array(totalPixels);
    const gradY = new Float32Array(totalPixels);

    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        const gx = (-1 * lum[(y - 1) * sw + (x - 1)] + 1 * lum[(y - 1) * sw + (x + 1)]) +
                   (-2 * lum[y * sw + (x - 1)] + 2 * lum[y * sw + (x + 1)]) +
                   (-1 * lum[(y + 1) * sw + (x - 1)] + 1 * lum[(y + 1) * sw + (x + 1)]);
        const gy = (-1 * lum[(y - 1) * sw + (x - 1)] - 2 * lum[(y - 1) * sw + x] - 1 * lum[(y - 1) * sw + (x + 1)]) +
                   (1 * lum[(y + 1) * sw + (x - 1)] + 2 * lum[(y + 1) * sw + x] + 1 * lum[(y + 1) * sw + (x + 1)]);
        gradX[y * sw + x] = gx;
        gradY[y * sw + x] = gy;
      }
    }

    // 3. Clausura morfológica direccional
    const closedMask = morphCloseDirectional(paperMask, sw, sh, 11);
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

          // Estimar los 4 límites iniciales del trapezoide
          let initTL = hull[0], initTR = hull[0], initBR = hull[0], initBL = hull[0];
          let minTL = Infinity, maxTR = -Infinity, maxBR = -Infinity, minBL = Infinity;

          for (const p of hull) {
            const sTL = p.x + 1.15 * p.y;
            if (sTL < minTL) { minTL = sTL; initTL = p; }
            const sTR = p.x - 1.15 * p.y;
            if (sTR > maxTR) { maxTR = sTR; initTR = p; }
            const sBR = p.x + 1.15 * p.y;
            if (sBR > maxBR) { maxBR = sBR; initBR = p; }
            const sBL = p.x - 1.15 * p.y;
            if (sBL < minBL) { minBL = sBL; initBL = p; }
          }

          // 4. REFINAMIENTO CON AJUSTE ACTIVO AL PICO DE GRADIENTE (Active Edge Snapping)
          const snappedCorners = snapToGradientEdges(
            [initTL, initTR, initBR, initBL],
            gradX, gradY, sw, sh
          );

          if (snappedCorners && isConvexQuad(snappedCorners)) {
            const area = polygonArea(snappedCorners);
            if (area > totalPixels * 0.04) {
              return snappedCorners.map(pt => ({
                x: Math.max(0, Math.min(width, pt.x / scale)),
                y: Math.max(0, Math.min(height, pt.y / scale))
              }));
            }
          }
        }
      }
    }

    return getA4PresetCorners(width, height);
  }

  /**
   * Refina las 4 líneas del documento buscando el pico de gradiente más nítido (transición papel-mesa)
   */
  function snapToGradientEdges(rawQuad, gradX, gradY, sw, sh) {
    const [tl, tr, br, bl] = rawQuad;

    // 1. Refinar Borde Izquierdo: buscar pico positivo en gradX (Mesa oscura -> Papel blanco)
    const leftPoints = [];
    const numSamples = 12;
    for (let i = 1; i < numSamples; i++) {
      const t = i / numSamples;
      const expX = Math.round(tl.x * (1 - t) + bl.x * t);
      const expY = Math.round(tl.y * (1 - t) + bl.y * t);

      let maxGx = 0;
      let bestX = expX;
      for (let dx = -10; dx <= 10; dx++) {
        const sx = expX + dx;
        if (sx >= 1 && sx < sw - 1 && expY >= 1 && expY < sh - 1) {
          const gx = gradX[expY * sw + sx];
          if (gx > maxGx) {
            maxGx = gx;
            bestX = sx;
          }
        }
      }
      leftPoints.push({ x: bestX, y: expY });
    }

    // 2. Refinar Borde Derecho: buscar pico negativo en gradX (Papel blanco -> Mesa oscura)
    const rightPoints = [];
    for (let i = 1; i < numSamples; i++) {
      const t = i / numSamples;
      const expX = Math.round(tr.x * (1 - t) + br.x * t);
      const expY = Math.round(tr.y * (1 - t) + br.y * t);

      let maxNegGx = 0;
      let bestX = expX;
      for (let dx = -10; dx <= 10; dx++) {
        const sx = expX + dx;
        if (sx >= 1 && sx < sw - 1 && expY >= 1 && expY < sh - 1) {
          const negGx = -gradX[expY * sw + sx];
          if (negGx > maxNegGx) {
            maxNegGx = negGx;
            bestX = sx;
          }
        }
      }
      rightPoints.push({ x: bestX, y: expY });
    }

    // 3. Refinar Borde Superior: buscar pico positivo en gradY (Fondo -> Papel)
    const topPoints = [];
    for (let i = 1; i < numSamples; i++) {
      const t = i / numSamples;
      const expX = Math.round(tl.x * (1 - t) + tr.x * t);
      const expY = Math.round(tl.y * (1 - t) + tr.y * t);

      let maxGy = 0;
      let bestY = expY;
      for (let dy = -10; dy <= 10; dy++) {
        const sy = expY + dy;
        if (expX >= 1 && expX < sw - 1 && sy >= 1 && sy < sh - 1) {
          const gy = gradY[sy * sw + expX];
          if (gy > maxGy) {
            maxGy = gy;
            bestY = sy;
          }
        }
      }
      topPoints.push({ x: expX, y: bestY });
    }

    // 4. Refinar Borde Inferior: buscar pico negativo en gradY (Papel -> Fondo)
    const botPoints = [];
    for (let i = 1; i < numSamples; i++) {
      const t = i / numSamples;
      const expX = Math.round(bl.x * (1 - t) + br.x * t);
      const expY = Math.round(bl.y * (1 - t) + br.y * t);

      let maxNegGy = 0;
      let bestY = expY;
      for (let dy = -10; dy <= 10; dy++) {
        const sy = expY + dy;
        if (expX >= 1 && expX < sw - 1 && sy >= 1 && sy < sh - 1) {
          const negGy = -gradY[sy * sw + expX];
          if (negGy > maxNegGy) {
            maxNegGy = negGy;
            bestY = sy;
          }
        }
      }
      botPoints.push({ x: expX, y: bestY });
    }

    // Ajustar 4 líneas por regresión
    const lineLeft = fitLine(leftPoints, 'v');
    const lineRight = fitLine(rightPoints, 'v');
    const lineTop = fitLine(topPoints, 'h');
    const lineBot = fitLine(botPoints, 'h');

    const snappedTL = intersectHV(lineTop, lineLeft);
    const snappedTR = intersectHV(lineTop, lineRight);
    const snappedBR = intersectHV(lineBot, lineRight);
    const snappedBL = intersectHV(lineBot, lineLeft);

    if (snappedTL && snappedTR && snappedBR && snappedBL) {
      return [snappedTL, snappedTR, snappedBR, snappedBL];
    }

    return rawQuad;
  }

  function fitLine(points, type) {
    if (type === 'v') {
      let sumY = 0, sumX = 0, sumY2 = 0, sumYX = 0;
      const n = points.length;
      for (const p of points) {
        sumY += p.y;
        sumX += p.x;
        sumY2 += p.y * p.y;
        sumYX += p.y * p.x;
      }
      const denom = n * sumY2 - sumY * sumY;
      const m = Math.abs(denom) > 1e-5 ? (n * sumYX - sumY * sumX) / denom : 0;
      const c = (sumX - m * sumY) / n;
      return { m, c, type: 'v' };
    } else {
      let sumX = 0, sumY = 0, sumX2 = 0, sumXY = 0;
      const n = points.length;
      for (const p of points) {
        sumX += p.x;
        sumY += p.y;
        sumX2 += p.x * p.x;
        sumXY += p.x * p.y;
      }
      const denom = n * sumX2 - sumX * sumX;
      const m = Math.abs(denom) > 1e-5 ? (n * sumXY - sumX * sumY) / denom : 0;
      const c = (sumY - m * sumX) / n;
      return { m, c, type: 'h' };
    }
  }

  function intersectHV(hLine, vLine) {
    const mh = hLine.m, ch = hLine.c;
    const mv = vLine.m, cv = vLine.c;

    const denom = 1 - mh * mv;
    if (Math.abs(denom) < 1e-5) return null;

    const y = (mh * cv + ch) / denom;
    const x = mv * y + cv;

    return { x, y };
  }

  function morphCloseDirectional(mask, w, h, len) {
    const hClosed = new Uint8Array(w * h);
    const half = Math.floor(len / 2);

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
