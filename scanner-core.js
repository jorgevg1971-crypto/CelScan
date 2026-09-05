/**
 * Escáner Móvil Pro - Image Processing & Computer Vision Core
 * Proporciona detección inteligente de hojas/documentos (A4, Carta),
 * corrección de perspectiva (Homografía) y filtros de realce de documentos.
 */

const ScannerCore = (() => {

  /**
   * Proporción A4 estándar (ancho / alto = 1 / 1.4142 = 0.707)
   */
  const A4_ASPECT_RATIO = 1 / 1.41421356;
  const LETTER_ASPECT_RATIO = 8.5 / 11; // 0.7727

  /**
   * Detecta automáticamente las 4 esquinas de un documento (hoja blanca/clara)
   * separándolo del fondo (escritorio, teclado, ratón, etc.).
   */
  function detectDocumentCorners(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    // Redimensionar para análisis rápido (máx 360px)
    const targetDim = 360;
    const scale = Math.min(1, targetDim / Math.max(width, height));
    const sw = Math.floor(width * scale);
    const sh = Math.floor(height * scale);

    const gray = new Uint8ClampedArray(sw * sh);
    let totalLum = 0;
    const hist = new Int32Array(256);

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const origX = Math.min(width - 1, Math.floor(x / scale));
        const origY = Math.min(height - 1, Math.floor(y / scale));
        const idx = (origY * width + origX) * 4;
        
        // Luminancia percibida
        const lum = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
        gray[y * sw + x] = lum;
        hist[lum]++;
        totalLum += lum;
      }
    }

    const totalPixels = sw * sh;
    const meanLum = totalLum / totalPixels;

    // Calcular Umbral de Otsu para separar el papel blanco de la mesa
    let otsuThresh = computeOtsuThreshold(hist, totalPixels);
    // Ajustar si la escena es muy oscura o clara
    const paperThreshold = Math.max(105, Math.min(otsuThresh, 160));

    // Crear máscara binaria (1 = candidato a documento / papel, 0 = fondo/mesa)
    const mask = new Uint8Array(sw * sh);
    for (let i = 0; i < totalPixels; i++) {
      mask[i] = gray[i] >= paperThreshold ? 1 : 0;
    }

    // Clausura morfológica (Dilation + Erosion) para unir letras y párrafos en un bloque sólido
    const closedMask = morphClose(mask, sw, sh, 3);

    // Encontrar componentes conectados (Blobs)
    const blobs = findConnectedComponents(closedMask, sw, sh);

    // Ordenar blobs por área (mayor a menor)
    blobs.sort((a, b) => b.area - a.area);

    let bestCorners = null;
    let bestScore = -1;

    for (let i = 0; i < Math.min(5, blobs.length); i++) {
      const blob = blobs[i];
      // El documento debe ocupar entre 10% y 95% de la imagen
      if (blob.area < totalPixels * 0.08 || blob.area > totalPixels * 0.96) continue;

      // Extraer contorno exterior del blob
      const contour = extractContour(blob.pixels, sw, sh);
      if (contour.length < 10) continue;

      // Obtener Convex Hull (envoltura convexa)
      const hull = convexHull(contour);
      if (hull.length < 4) continue;

      // Aproximar polígono con Douglas-Peucker probando diferentes tolerancias
      let quad = null;
      for (let epsRatio of [0.02, 0.035, 0.05, 0.07, 0.1]) {
        const perimeter = polygonPerimeter(hull);
        const approx = approxPolyDP(hull, epsRatio * perimeter);
        if (approx.length === 4 && isConvexQuad(approx)) {
          quad = approx;
          break;
        }
      }

      // Si no se obtuvo cuadrilátero exacto con Douglas-Peucker, calcular Minimum Bounding Box orientado
      if (!quad) {
        quad = minAreaRect(hull);
      }

      if (quad && quad.length === 4) {
        const ordered = orderCorners(quad);
        const area = polygonArea(ordered);

        // Evaluar rectangularidad y relación de aspecto (cercana a A4 / Carta ~ 1.2 a 1.6)
        const wTop = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
        const wBot = Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y);
        const hLeft = Math.hypot(ordered[3].x - ordered[0].x, ordered[3].y - ordered[0].y);
        const hRight = Math.hypot(ordered[2].x - ordered[1].x, ordered[2].y - ordered[1].y);

        const avgW = (wTop + wBot) / 2;
        const avgH = (hLeft + hRight) / 2;
        const ratio = Math.max(avgW, avgH) / (Math.min(avgW, avgH) || 1);

        // Puntuación del candidato
        let score = area;
        if (ratio >= 1.15 && ratio <= 1.75) {
          score *= 1.5; // Bonificación si coincide con aspecto típico de documento
        }

        if (score > bestScore) {
          bestScore = score;
          bestCorners = ordered.map(pt => ({
            x: Math.max(0, Math.min(width, pt.x / scale)),
            y: Math.max(0, Math.min(height, pt.y / scale))
          }));
        }
      }
    }

    if (bestCorners && polygonArea(bestCorners) > (width * height * 0.08)) {
      return bestCorners;
    }

    // Fallback: Si no se detecta contorno con suficiente certeza,
    // devolver un encuadre centrado perfecto con PROPORCIÓN A4 (Vertical)
    return getA4PresetCorners(width, height);
  }

  /**
   * Genera un marco rectangular centrado con proporción A4 exacta (Vertical u Horizontal)
   */
  function getA4PresetCorners(width, height) {
    const isPortrait = height >= width;
    let targetW, targetH;

    if (isPortrait) {
      // Proporción A4 vertical
      targetW = width * 0.82;
      targetH = targetW * (1 / A4_ASPECT_RATIO);
      if (targetH > height * 0.88) {
        targetH = height * 0.88;
        targetW = targetH * A4_ASPECT_RATIO;
      }
    } else {
      // Proporción A4 horizontal
      targetH = height * 0.82;
      targetW = targetH * (1 / A4_ASPECT_RATIO);
      if (targetW > width * 0.88) {
        targetW = width * 0.88;
        targetH = targetW * A4_ASPECT_RATIO;
      }
    }

    const left = (width - targetW) / 2;
    const top = (height - targetH) / 2;
    const right = left + targetW;
    const bottom = top + targetH;

    return [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom }
    ];
  }

  /**
   * Genera marco rectangular con formato Carta (Letter)
   */
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

  // --- ALGORITMOS AUXILIARES DE VISIÓN POR COMPUTADORA ---

  function computeOtsuThreshold(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];

    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let maxVariance = 0;
    let threshold = 128;

    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      wF = total - wB;
      if (wF === 0) break;

      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const variance = wB * wF * (mB - mF) * (mB - mF);

      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = t;
      }
    }
    return threshold;
  }

  function morphClose(mask, w, h, radius) {
    const dilated = new Uint8Array(w * h);
    const closed = new Uint8Array(w * h);

    // Dilatación
    for (let y = radius; y < h - radius; y++) {
      for (let x = radius; x < w - radius; x++) {
        let maxVal = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (mask[(y + dy) * w + (x + dx)] === 1) {
              maxVal = 1;
              break;
            }
          }
          if (maxVal === 1) break;
        }
        dilated[y * w + x] = maxVal;
      }
    }

    // Erosión
    for (let y = radius; y < h - radius; y++) {
      for (let x = radius; x < w - radius; x++) {
        let minVal = 1;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dilated[(y + dy) * w + (x + dx)] === 0) {
              minVal = 0;
              break;
            }
          }
          if (minVal === 0) break;
        }
        closed[y * w + x] = minVal;
      }
    }
    return closed;
  }

  function findConnectedComponents(binaryMask, w, h) {
    const visited = new Uint8Array(w * h);
    const blobs = [];

    for (let y = 4; y < h - 4; y += 2) {
      for (let x = 4; x < w - 4; x += 2) {
        const idx = y * w + x;
        if (binaryMask[idx] === 1 && visited[idx] === 0) {
          // BFS Flood Fill
          const blobPixels = [];
          const queue = [idx];
          visited[idx] = 1;

          while (queue.length > 0) {
            const curr = queue.pop();
            const cx = curr % w;
            const cy = Math.floor(curr / w);
            blobPixels.push({ x: cx, y: cy });

            const neighbors = [
              curr - 1, curr + 1,
              curr - w, curr + w
            ];

            for (let n of neighbors) {
              if (n >= 0 && n < w * h && binaryMask[n] === 1 && visited[n] === 0) {
                visited[n] = 1;
                queue.push(n);
              }
            }
          }

          if (blobPixels.length >= 50) {
            blobs.push({
              area: blobPixels.length,
              pixels: blobPixels
            });
          }
        }
      }
    }
    return blobs;
  }

  function extractContour(pixels, w, h) {
    // Tomar los bordes exteriores mediante muestreo perimetral
    const grid = new Map();
    pixels.forEach(p => grid.set(`${p.x},${p.y}`, true));

    const contour = [];
    pixels.forEach(p => {
      // Si alguno de los 4 vecinos no está en el blob, es borde
      if (!grid.has(`${p.x - 1},${p.y}`) || !grid.has(`${p.x + 1},${p.y}`) ||
          !grid.has(`${p.x},${p.y - 1}`) || !grid.has(`${p.x},${p.y + 1}`)) {
        contour.push(p);
      }
    });
    return contour;
  }

  // Algoritmo Convex Hull (Monotone Chain)
  function convexHull(points) {
    if (points.length <= 3) return points;
    const pts = points.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);

    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    const lower = [];
    for (let p of pts) {
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

  // Ramer-Douglas-Peucker
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

  // Minimum Area Bounding Box (Oriented Box)
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

  /**
   * Ordena 4 esquinas en sentido horario: [TL, TR, BR, BL]
   */
  function orderCorners(pts) {
    const center = pts.reduce((acc, p) => ({ x: acc.x + p.x / 4, y: acc.y + p.y / 4 }), { x: 0, y: 0 });
    
    // Ordenar por ángulo respecto al centroide
    const sorted = pts.slice().sort((a, b) => {
      const angleA = Math.atan2(a.y - center.y, a.x - center.x);
      const angleB = Math.atan2(b.y - center.y, b.x - center.x);
      return angleA - angleB;
    });

    // Encontrar cuál es la esquina superior izquierda (TL: min x + y)
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
   * Aplica filtros fotográficos profesionales (Magic Color, B/N, Grises, Nitidez).
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

        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum > 140) {
          const boost = (lum - 140) / 115 * 55;
          r = Math.min(255, r + boost);
          g = Math.min(255, g + boost);
          b = Math.min(255, b + boost);
        } else {
          const dim = (140 - lum) / 140 * 30;
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
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const val = lum > 135 ? 255 : (lum < 70 ? 0 : ((lum - 70) / 65) * 255);
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
      }
    } else if (filterType === 'grayscale') {
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        data[i] = lum;
        data[i + 1] = lum;
        data[i + 2] = lum;
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
