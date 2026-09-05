/**
 * Escáner Móvil Pro - Image Processing & Computer Vision Core
 * Algoritmo Avanzado de Detección de Documentos (Multi-Threshold + Ramer-Douglas-Peucker + Normal Ray Gradient Snapping)
 * Encuadra de forma milimétrica los 4 bordes exactos del papel bajo cualquier iluminación, ángulo y perspectiva.
 */

const ScannerCore = (() => {

  const A4_ASPECT_RATIO = 1 / 1.41421356;
  const LETTER_ASPECT_RATIO = 8.5 / 11;

  /**
   * Detección automática ultra-precisa de esquinas de documento
   */
  function detectDocumentCorners(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    // Escala de análisis (280px para alta velocidad a 25+ FPS en móviles sin sobrecalentar)
    const targetDim = 280;
    const scale = Math.min(1, targetDim / Math.max(width, height));
    const sw = Math.floor(width * scale);
    const sh = Math.floor(height * scale);
    const totalPixels = sw * sh;

    if (sw < 20 || sh < 20) {
      return getA4PresetCorners(width, height);
    }

    const lum = new Float32Array(totalPixels);
    const sat = new Float32Array(totalPixels);

    // 1. Mapas de Luminancia y Saturación
    let sumLum = 0;
    const hist = new Int32Array(256);

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const origX = Math.min(width - 1, Math.floor(x / scale));
        const origY = Math.min(height - 1, Math.floor(y / scale));
        const idx = (origY * width + origX) * 4;

        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        lum[y * sw + x] = l;
        sumLum += l;
        hist[l]++;

        const maxVal = Math.max(r, g, b);
        const minVal = Math.min(r, g, b);
        const s = maxVal === 0 ? 0 : ((maxVal - minVal) / maxVal) * 100;
        sat[y * sw + x] = s;
      }
    }

    // 2. Umbral de Otsu adaptativo
    const otsuT = computeOtsuThreshold(hist, totalPixels);
    const meanLum = sumLum / totalPixels;

    // 3. Gradientes Sobel 2D y Magnitud de Gradiente
    const gradX = new Float32Array(totalPixels);
    const gradY = new Float32Array(totalPixels);
    const gradMag = new Float32Array(totalPixels);

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

    // 4. Intentar varios umbrales candidatos para máxima robustez
    const thresholdCandidates = [
      Math.max(85, Math.min(200, otsuT)),
      Math.max(90, Math.min(210, Math.round(meanLum + 18))),
      135,
      115,
      155
    ];

    let bestQuad = null;
    let bestQuadScore = -1;

    for (const thresh of thresholdCandidates) {
      const mask = new Uint8Array(totalPixels);
      for (let i = 0; i < totalPixels; i++) {
        // Un papel blanco/claro tiene luminancia alta y saturación de color baja
        if (lum[i] >= thresh && sat[i] < 68) {
          mask[i] = 1;
        }
      }

      // Clausura morfológica direccional para consolidar texto y tablas internas
      const closedMask = morphCloseDirectional(mask, sw, sh, 13);
      const blobs = findConnectedComponents(closedMask, sw, sh);

      const cx0 = sw / 2;
      const cy0 = sh / 2;

      for (const blob of blobs) {
        if (blob.area < totalPixels * 0.05 || blob.area > totalPixels * 0.98) continue;

        const centroidX = blob.sumX / blob.area;
        const centroidY = blob.sumY / blob.area;
        const distFromCenter = Math.hypot(centroidX - cx0, centroidY - cy0);
        const centerScore = Math.max(0.3, 1 - distFromCenter / (Math.max(sw, sh) * 0.55));

        const contour = extractContour(blob.pixels, sw, sh);
        if (contour.length < 8) continue;

        const hull = convexHull(contour);
        if (hull.length < 4) continue;

        // Aproximar polígono cuadrilátero mediante Ramer-Douglas-Peucker adaptativo
        const candidateQuad = approximateQuadrilateral(hull);
        if (!candidateQuad || candidateQuad.length !== 4) continue;

        if (!isConvexQuad(candidateQuad)) continue;

        const area = polygonArea(candidateQuad);
        if (area < totalPixels * 0.06) continue;

        // Evaluar relación de aspecto
        const qOrdered = orderCorners(candidateQuad);
        const wTop = Math.hypot(qOrdered[1].x - qOrdered[0].x, qOrdered[1].y - qOrdered[0].y);
        const wBot = Math.hypot(qOrdered[2].x - qOrdered[3].x, qOrdered[2].y - qOrdered[3].y);
        const hLeft = Math.hypot(qOrdered[3].x - qOrdered[0].x, qOrdered[3].y - qOrdered[0].y);
        const hRight = Math.hypot(qOrdered[2].x - qOrdered[1].x, qOrdered[2].y - qOrdered[1].y);

        const avgW = (wTop + wBot) / 2;
        const avgH = (hLeft + hRight) / 2;
        if (avgW < 20 || avgH < 20) continue;

        const aspect = Math.min(avgW, avgH) / Math.max(avgW, avgH);
        // La relación de aspecto de un documento A4/Carta es ~0.7, permitimos 0.35 - 0.98
        const aspectScore = (aspect >= 0.35 && aspect <= 0.98) ? 1.0 : 0.4;

        const score = area * centerScore * aspectScore;
        if (score > bestQuadScore) {
          bestQuadScore = score;
          bestQuad = qOrdered;
        }
      }

      // Si encontramos un candidato con alto score, no necesitamos seguir buscando más umbrales
      if (bestQuad && bestQuadScore > totalPixels * 0.3) {
        break;
      }
    }

    if (bestQuad) {
      // 5. AJUSTE FINO MEDIANTE RAY-CASTING NORMAL A LOS GRADIENTES (Sub-pixel Normal Edge Snapping)
      const refinedQuad = snapCornersAlongNormals(bestQuad, gradMag, gradX, gradY, sw, sh);
      const finalQuad = (refinedQuad && isConvexQuad(refinedQuad) && polygonArea(refinedQuad) > totalPixels * 0.05)
        ? refinedQuad
        : bestQuad;

      // Escalar de vuelta a la resolución nativa de la imagen
      return finalQuad.map(pt => ({
        x: Math.max(0, Math.min(width, pt.x / scale)),
        y: Math.max(0, Math.min(height, pt.y / scale))
      }));
    }

    // Fallback: Preseteo A4 centrado
    return getA4PresetCorners(width, height);
  }

  /**
   * Calcula el umbral óptimo de Otsu
   */
  function computeOtsuThreshold(hist, totalPixels) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];

    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let maxVariance = 0;
    let threshold = 130;

    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      wF = totalPixels - wB;
      if (wF === 0) break;

      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const varianceBetween = wB * wF * (mB - mF) * (mB - mF);

      if (varianceBetween > maxVariance) {
        maxVariance = varianceBetween;
        threshold = t;
      }
    }
    return threshold;
  }

  /**
   * Aproxima un polígono convexo a exactamente 4 vértices usando RDP o selección de extremos
   */
  function approximateQuadrilateral(hull) {
    if (hull.length === 4) return hull;

    // Probar Ramer-Douglas-Peucker con epsilon variable
    const peri = polygonPerimeter(hull);
    for (let factor = 0.02; factor <= 0.08; factor += 0.005) {
      const approx = ramerDouglasPeucker(hull, factor * peri);
      if (approx.length === 4) {
        return approx;
      }
    }

    // Si RDP no da 4 exactos, seleccionar los 4 puntos de extremos en las 4 direcciones diagonales
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

    return [initTL, initTR, initBR, initBL];
  }

  /**
   * Algoritmo Ramer-Douglas-Peucker para simplificar contornos
   */
  function ramerDouglasPeucker(points, epsilon) {
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
      const left = ramerDouglasPeucker(points.slice(0, index + 1), epsilon);
      const right = ramerDouglasPeucker(points.slice(index), epsilon);
      return left.slice(0, left.length - 1).concat(right);
    } else {
      return [points[0], points[end]];
    }
  }

  function perpendicularDistance(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const mag = Math.hypot(dx, dy);
    if (mag < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
    return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / mag;
  }

  function polygonPerimeter(pts) {
    let p = 0;
    for (let i = 0; i < pts.length; i++) {
      const next = pts[(i + 1) % pts.length];
      p += Math.hypot(next.x - pts[i].x, next.y - pts[i].y);
    }
    return p;
  }

  /**
   * Ajuste milimétrico de los 4 bordes muestreando rayos perpendiculares (Normal Vector Raycast)
   */
  function snapCornersAlongNormals(quad, gradMag, gradX, gradY, sw, sh) {
    const ordered = orderCorners(quad); // [TL, TR, BR, BL]
    const fittedLines = [];

    const numSamples = 16;
    const searchRange = 18; // Distancia de búsqueda perpendicular

    for (let side = 0; side < 4; side++) {
      const pA = ordered[side];
      const pB = ordered[(side + 1) % 4];

      const edgeDx = pB.x - pA.x;
      const edgeDy = pB.y - pA.y;
      const edgeLen = Math.hypot(edgeDx, edgeDy);

      if (edgeLen < 10) return quad;

      // Vector unitario normal perpendicular (apuntando hacia afuera)
      const nx = -edgeDy / edgeLen;
      const ny = edgeDx / edgeLen;

      const edgePoints = [];

      for (let s = 1; s < numSamples; s++) {
        const t = s / numSamples;
        const qx = pA.x + t * edgeDx;
        const qy = pA.y + t * edgeDy;

        let bestD = 0;
        let maxGrad = 0;

        for (let d = -searchRange; d <= searchRange; d++) {
          const sx = Math.round(qx + d * nx);
          const sy = Math.round(qy + d * ny);

          if (sx >= 1 && sx < sw - 1 && sy >= 1 && sy < sh - 1) {
            const g = gradMag[sy * sw + sx];
            if (g > maxGrad) {
              maxGrad = g;
              bestD = d;
            }
          }
        }

        if (maxGrad > 15) {
          edgePoints.push({
            x: qx + bestD * nx,
            y: qy + bestD * ny
          });
        }
      }

      if (edgePoints.length >= 4) {
        fittedLines.push(fitRobustLine2D(edgePoints));
      } else {
        // Si no hay suficientes puntos de gradiente, usar la línea original
        fittedLines.push(fitRobustLine2D([pA, pB]));
      }
    }

    // Intersectar las 4 líneas consecutivas:
    // 0: Top (TL->TR), 1: Right (TR->BR), 2: Bottom (BR->BL), 3: Left (BL->TL)
    const newTL = intersectLines2D(fittedLines[3], fittedLines[0]);
    const newTR = intersectLines2D(fittedLines[0], fittedLines[1]);
    const newBR = intersectLines2D(fittedLines[1], fittedLines[2]);
    const newBL = intersectLines2D(fittedLines[2], fittedLines[3]);

    if (newTL && newTR && newBR && newBL) {
      // Validar que los puntos resultantes no se hayan disparado fuera de rango
      const pts = [newTL, newTR, newBR, newBL];
      const valid = pts.every(p => p.x >= -30 && p.x <= sw + 30 && p.y >= -30 && p.y <= sh + 30);
      if (valid) {
        return pts.map(p => ({
          x: Math.max(0, Math.min(sw, p.x)),
          y: Math.max(0, Math.min(sh, p.y))
        }));
      }
    }

    return quad;
  }

  /**
   * Ajusta una línea general A*x + B*y + C = 0 mediante regresión ortogonal de mínimos cuadrados
   */
  function fitRobustLine2D(points) {
    const n = points.length;
    let meanX = 0, meanY = 0;
    for (const p of points) {
      meanX += p.x;
      meanY += p.y;
    }
    meanX /= n;
    meanY /= n;

    let covXX = 0, covXY = 0, covYY = 0;
    for (const p of points) {
      const dx = p.x - meanX;
      const dy = p.y - meanY;
      covXX += dx * dx;
      covXY += dx * dy;
      covYY += dy * dy;
    }

    // Ángulo del vector director principal
    const theta = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
    const dirX = Math.cos(theta);
    const dirY = Math.sin(theta);

    // Vector normal a la línea
    const A = -dirY;
    const B = dirX;
    const C = -(A * meanX + B * meanY);

    return { A, B, C };
  }

  /**
   * Intersección exacta entre dos líneas en forma A*x + B*y + C = 0
   */
  function intersectLines2D(line1, line2) {
    const det = line1.A * line2.B - line2.A * line1.B;
    if (Math.abs(det) < 1e-5) return null;

    const x = (line1.B * line2.C - line2.B * line1.C) / det;
    const y = (line2.A * line1.C - line1.A * line2.C) / det;

    return { x, y };
  }

  /**
   * Ordena 4 esquinas siempre en sentido horario: [Top-Left, Top-Right, Bottom-Right, Bottom-Left]
   */
  function orderCorners(pts) {
    const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
    const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;

    // Ordenar por ángulo trigonométrico con respecto al centroide
    const sorted = pts.slice().sort((a, b) => {
      const angleA = Math.atan2(a.y - cy, a.x - cx);
      const angleB = Math.atan2(b.y - cy, b.x - cx);
      return angleA - angleB;
    });

    // Encontrar cuál de los puntos es el Top-Left (mínimo x + y)
    let minSum = Infinity;
    let tlIdx = 0;
    for (let i = 0; i < 4; i++) {
      const sum = sorted[i].x + sorted[i].y;
      if (sum < minSum) {
        minSum = sum;
        tlIdx = i;
      }
    }

    const ordered = [];
    for (let i = 0; i < 4; i++) {
      ordered.push(sorted[(tlIdx + i) % 4]);
    }
    return ordered;
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

  /**
   * Corrección de perspectiva mediante homografía proyectiva
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
