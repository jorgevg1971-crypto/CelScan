/**
 * Escáner Móvil Pro - Image Processing & Computer Vision Core
 * Algoritmo 4-Line Perspective Intersection & Boundary Refiner:
 * Modela con precisión la perspectiva real (trapezoide/cuadrilátero) de cualquier
 * documento sobre mesas o escritorios, ajustando las 4 esquinas de forma milimétrica.
 */

const ScannerCore = (() => {

  const A4_ASPECT_RATIO = 1 / 1.41421356;
  const LETTER_ASPECT_RATIO = 8.5 / 11;

  /**
   * Detección automática de alta precisión de las 4 esquinas del documento.
   */
  function detectDocumentCorners(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    // Escala de trabajo optimizada (~360px para alta definición de bordes)
    const targetDim = 360;
    const scale = Math.min(1, targetDim / Math.max(width, height));
    const sw = Math.floor(width * scale);
    const sh = Math.floor(height * scale);

    const lum = new Float32Array(sw * sh);
    const sat = new Float32Array(sw * sh);

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const origX = Math.min(width - 1, Math.floor(x / scale));
        const origY = Math.min(height - 1, Math.floor(y / scale));
        const idx = (origY * width + origX) * 4;

        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        lum[y * sw + x] = 0.299 * r + 0.587 * g + 0.114 * b;

        const maxVal = Math.max(r, g, b);
        const minVal = Math.min(r, g, b);
        sat[y * sw + x] = maxVal === 0 ? 0 : ((maxVal - minVal) / maxVal) * 100;
      }
    }

    // Gradiente direccional Sobel
    const gradX = new Float32Array(sw * sh);
    const gradY = new Float32Array(sw * sh);
    const gradMag = new Float32Array(sw * sh);

    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        const gx = (-1 * lum[(y - 1) * sw + (x - 1)] + 1 * lum[(y - 1) * sw + (x + 1)]) +
                   (-2 * lum[y * sw + (x - 1)] + 2 * lum[y * sw + (x + 1)]) +
                   (-1 * lum[(y + 1) * sw + (x - 1)] + 1 * lum[(y + 1) * sw + (x + 1)]);
        const gy = (-1 * lum[(y - 1) * sw + (x - 1)] - 2 * lum[(y - 1) * sw + x] - 1 * lum[(y - 1) * sw + (x + 1)]) +
                   (1 * lum[(y + 1) * sw + (x - 1)] + 2 * lum[(y + 1) * sw + x] + 1 * lum[(y + 1) * sw + (x + 1)]);
        
        gradX[y * sw + x] = gx;
        gradY[y * sw + x] = gy;
        gradMag[y * sw + x] = Math.hypot(gx, gy);
      }
    }

    // Localizar el núcleo del documento
    const cx0 = sw / 2;
    const cy0 = sh / 2;
    let sumWeight = 0;
    let weightedX = 0;
    let weightedY = 0;
    const sigmaSq = 2 * Math.pow(Math.min(sw, sh) * 0.35, 2);

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const idx = y * sw + x;
        const l = lum[idx];
        const s = sat[idx];

        if (l > 140 && s < 65) {
          const distSq = (x - cx0) * (x - cx0) + (y - cy0) * (y - cy0);
          const spatialWeight = Math.exp(-distSq / sigmaSq);
          const weight = (l / 255) * spatialWeight;
          sumWeight += weight;
          weightedX += x * weight;
          weightedY += y * weight;
        }
      }
    }

    const seedX = sumWeight > 0 ? (weightedX / sumWeight) : cx0;
    const seedY = sumWeight > 0 ? (weightedY / sumWeight) : cy0;

    const seedIdx = Math.floor(seedY) * sw + Math.floor(seedX);
    const seedLum = lum[seedIdx] || 200;
    const paperThreshold = Math.max(115, seedLum * 0.62);

    // Lanzar 120 rayos radiales para muestreo denso del perímetro
    const numRays = 120;
    const boundaryPoints = [];
    const maxR = Math.min(sw, sh) * 0.96;

    for (let i = 0; i < numRays; i++) {
      const angle = i * (2 * Math.PI / numRays);
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      let bestR = maxR;

      for (let r = 10; r < maxR; r += 1.0) {
        const px = Math.round(seedX + r * cosA);
        const py = Math.round(seedY + r * sinA);

        if (px < 2 || px >= sw - 2 || py < 2 || py >= sh - 2) {
          bestR = r;
          break;
        }

        const idx = py * sw + px;
        const l = lum[idx];
        const s = sat[idx];
        const g = gradMag[idx];

        // 1. Caída de luminancia o aumento de saturación al salir de la hoja
        if ((l < paperThreshold || s > 65) && r > 15) {
          bestR = r;
          break;
        }

        // 2. Borde con gradiente marcado
        if (g > 40 && r > 20) {
          const nextPx = Math.round(seedX + (r + 4) * cosA);
          const nextPy = Math.round(seedY + (r + 4) * sinA);
          if (nextPx >= 0 && nextPx < sw && nextPy >= 0 && nextPy < sh) {
            if (lum[nextPy * sw + nextPx] < paperThreshold) {
              bestR = r;
              break;
            }
          }
        }
      }

      boundaryPoints.push({
        x: seedX + bestR * cosA,
        y: seedY + bestR * sinA,
        cosA: cosA,
        sinA: sinA
      });
    }

    // Separar puntos en los 4 bordes del documento
    // Izquierda (cosA < -0.3), Derecha (cosA > 0.3), Arriba (sinA < -0.3), Abajo (sinA > 0.3)
    const leftPts = boundaryPoints.filter(p => p.cosA < -0.3 && Math.abs(p.sinA) < 0.88);
    const rightPts = boundaryPoints.filter(p => p.cosA > 0.3 && Math.abs(p.sinA) < 0.88);
    const topPts = boundaryPoints.filter(p => p.sinA < -0.3 && Math.abs(p.cosA) < 0.88);
    const botPts = boundaryPoints.filter(p => p.sinA > 0.3 && Math.abs(p.cosA) < 0.88);

    if (leftPts.length >= 4 && rightPts.length >= 4 && topPts.length >= 4 && botPts.length >= 4) {
      // Ajustar las 4 líneas por regresión lineal / mínimos cuadrados
      const lineLeft = fitLine(leftPts, 'v');   // x = m*y + c
      const lineRight = fitLine(rightPts, 'v'); // x = m*y + c
      const lineTop = fitLine(topPts, 'h');     // y = m*x + c
      const lineBot = fitLine(botPts, 'h');     // y = m*x + c

      // Intersectar las 4 líneas para obtener las esquinas exactas del trapezoide
      const tl = intersectHV(lineTop, lineLeft);
      const tr = intersectHV(lineTop, lineRight);
      const br = intersectHV(lineBot, lineRight);
      const bl = intersectHV(lineBot, lineLeft);

      if (tl && tr && br && bl) {
        const rawCorners = [tl, tr, br, bl];
        const area = polygonArea(rawCorners);

        // Validar que el polígono tenga un área razonable y forma válida
        if (area > (sw * sh * 0.06) && isConvexQuad(rawCorners)) {
          return rawCorners.map(pt => ({
            x: Math.max(0, Math.min(width, pt.x / scale)),
            y: Math.max(0, Math.min(height, pt.y / scale))
          }));
        }
      }
    }

    // Fallback secundario: Envolvente convexa
    const hull = convexHull(boundaryPoints);
    if (hull.length >= 3) {
      const perimeter = polygonPerimeter(hull);
      for (const eps of [0.035, 0.05, 0.07, 0.1]) {
        const approx = approxPolyDP(hull, eps * perimeter);
        if (approx.length === 4 && isConvexQuad(approx)) {
          return orderCorners(approx).map(pt => ({
            x: Math.max(0, Math.min(width, pt.x / scale)),
            y: Math.max(0, Math.min(height, pt.y / scale))
          }));
        }
      }
      const box = minAreaRect(hull);
      if (box && box.length === 4) {
        return orderCorners(box).map(pt => ({
          x: Math.max(0, Math.min(width, pt.x / scale)),
          y: Math.max(0, Math.min(height, pt.y / scale))
        }));
      }
    }

    return getA4PresetCorners(width, height);
  }

  // Ajuste de línea robusto (Mínimos cuadrados con rechazo de outliers)
  function fitLine(points, type) {
    if (type === 'v') {
      // Línea vertical: x = m*y + c
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
      // Línea horizontal: y = m*x + c
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

  // Intersección de línea horizontal (y = mh*x + ch) y vertical (x = mv*y + cv)
  function intersectHV(hLine, vLine) {
    const mh = hLine.m, ch = hLine.c;
    const mv = vLine.m, cv = vLine.c;

    // y = mh*(mv*y + cv) + ch => y * (1 - mh*mv) = mh*cv + ch
    const denom = 1 - mh * mv;
    if (Math.abs(denom) < 1e-5) return null;

    const y = (mh * cv + ch) / denom;
    const x = mv * y + cv;

    return { x, y };
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

  // --- GEOMETRÍA Y ENVOLVENTES ---

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

  function polygonPerimeter(pts) {
    let perim = 0;
    for (let i = 0; i < pts.length; i++) {
      const next = pts[(i + 1) % pts.length];
      perim += Math.hypot(next.x - pts[i].x, next.y - pts[i].y);
    }
    return perim;
  }

  function approxPolyDP(points, epsilon) {
    if (points.length <= 2) return points;

    let maxDist = 0;
    let index = 0;
    const end = points.length - 1;

    for (let i = 1; i < end; i++) {
      const d = perpendicularDistance(points[i], points[0], points[end]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }

    if (maxDist > epsilon) {
      const rec1 = approxPolyDP(points.slice(0, index + 1), epsilon);
      const rec2 = approxPolyDP(points.slice(index), epsilon);
      return rec1.slice(0, rec1.length - 1).concat(rec2);
    } else {
      return [points[0], points[end]];
    }
  }

  function perpendicularDistance(p, p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const mag = Math.hypot(dx, dy);
    if (mag === 0) return Math.hypot(p.x - p1.x, p.y - p1.y);
    return Math.abs(dy * p.x - dx * p.y + p2.x * p1.y - p2.y * p1.x) / mag;
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

  function minAreaRect(hull) {
    if (hull.length < 3) return null;
    let minArea = Infinity;
    let bestBox = null;

    for (let i = 0; i < hull.length; i++) {
      const p1 = hull[i];
      const p2 = hull[(i + 1) % hull.length];
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

      const cos = Math.cos(-angle);
      const sin = Math.sin(-angle);

      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;

      hull.forEach(p => {
        const rx = p.x * cos - p.y * sin;
        const ry = p.x * sin + p.y * cos;
        if (rx < minX) minX = rx;
        if (rx > maxX) maxX = rx;
        if (ry < minY) minY = ry;
        if (ry > maxY) maxY = ry;
      });

      const area = (maxX - minX) * (maxY - minY);
      if (area < minArea) {
        minArea = area;
        const cosInv = Math.cos(angle);
        const sinInv = Math.sin(angle);

        const corners = [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY }
        ];

        bestBox = corners.map(c => ({
          x: c.x * cosInv - c.y * sinInv,
          y: c.x * sinInv + c.y * cosInv
        }));
      }
    }
    return bestBox;
  }

  function orderCorners(pts) {
    const center = pts.reduce((acc, p) => ({ x: acc.x + p.x / 4, y: acc.y + p.y / 4 }), { x: 0, y: 0 });
    const sorted = pts.slice().sort((a, b) => {
      return Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x);
    });

    let minSumIdx = 0;
    let minSum = Infinity;
    sorted.forEach((p, idx) => {
      const sum = p.x + p.y;
      if (sum < minSum) {
        minSum = sum;
        minSumIdx = idx;
      }
    });

    return [
      sorted[minSumIdx],
      sorted[(minSumIdx + 1) % 4],
      sorted[(minSumIdx + 2) % 4],
      sorted[(minSumIdx + 3) % 4]
    ];
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
