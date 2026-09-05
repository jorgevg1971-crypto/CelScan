/**
 * Escáner Móvil Pro - Image Processing & Computer Vision Core
 * Proporciona detección automática de bordes, corrección de perspectiva (Homografía) y filtros de realce de documentos.
 */

const ScannerCore = (() => {

  /**
   * Detecta automáticamente las 4 esquinas de un documento dentro de una imagen.
   * Utiliza análisis de gradiente de bordes, umbralización y análisis geométrico de polígonos.
   */
  function detectDocumentCorners(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    // Crear buffer en escala de grises reducido para procesamiento rápido
    const scale = Math.min(1, 300 / Math.max(width, height));
    const sw = Math.floor(width * scale);
    const sh = Math.floor(height * scale);
    const gray = new Uint8ClampedArray(sw * sh);

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const origX = Math.floor(x / scale);
        const origY = Math.floor(y / scale);
        const idx = (origY * width + origX) * 4;
        // Luminancia estándar
        gray[y * sw + x] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      }
    }

    // Suavizado Gaussiano 3x3 simple
    const blurred = new Uint8ClampedArray(sw * sh);
    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        let sum = 0;
        sum += gray[(y - 1) * sw + (x - 1)] + 2 * gray[(y - 1) * sw + x] + gray[(y - 1) * sw + (x + 1)];
        sum += 2 * gray[y * sw + (x - 1)] + 4 * gray[y * sw + x] + 2 * gray[y * sw + (x + 1)];
        sum += gray[(y + 1) * sw + (x - 1)] + 2 * gray[(y + 1) * sw + x] + gray[(y + 1) * sw + (x + 1)];
        blurred[y * sw + x] = sum / 16;
      }
    }

    // Gradiente Sobel para detección de bordes
    const edges = new Uint8ClampedArray(sw * sh);
    let maxMag = 0;
    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        const gx = (-1 * blurred[(y - 1) * sw + (x - 1)] + 1 * blurred[(y - 1) * sw + (x + 1)]) +
                   (-2 * blurred[y * sw + (x - 1)] + 2 * blurred[y * sw + (x + 1)]) +
                   (-1 * blurred[(y + 1) * sw + (x - 1)] + 1 * blurred[(y + 1) * sw + (x + 1)]);
        const gy = (-1 * blurred[(y - 1) * sw + (x - 1)] - 2 * blurred[(y - 1) * sw + x] - 1 * blurred[(y - 1) * sw + (x + 1)]) +
                   (1 * blurred[(y + 1) * sw + (x - 1)] + 2 * blurred[(y + 1) * sw + x] + 1 * blurred[(y + 1) * sw + (x + 1)]);
        const mag = Math.hypot(gx, gy);
        edges[y * sw + x] = mag;
        if (mag > maxMag) maxMag = mag;
      }
    }

    // Umbral de bordes
    const edgeThreshold = maxMag * 0.22;
    const points = [];
    const step = 2;

    for (let y = 5; y < sh - 5; y += step) {
      for (let x = 5; x < sw - 5; x += step) {
        if (edges[y * sw + x] > edgeThreshold) {
          points.push({ x: x / scale, y: y / scale });
        }
      }
    }

    // Si hay suficientes bordes detectados, buscamos los puntos extremos del cuadrilátero
    if (points.length >= 20) {
      let tl = { x: width, y: height, score: Infinity };
      let tr = { x: 0, y: height, score: -Infinity };
      let br = { x: 0, y: 0, score: -Infinity };
      let bl = { x: width, y: 0, score: Infinity };

      points.forEach(p => {
        // tl: min (x + y)
        if (p.x + p.y < tl.score) {
          tl = { x: p.x, y: p.y, score: p.x + p.y };
        }
        // tr: max (x - y)
        if (p.x - p.y > tr.score) {
          tr = { x: p.x, y: p.y, score: p.x - p.y };
        }
        // br: max (x + y)
        if (p.x + p.y > br.score) {
          br = { x: p.x, y: p.y, score: p.x + p.y };
        }
        // bl: min (x - y)
        if (p.x - p.y < bl.score) {
          bl = { x: p.x, y: p.y, score: p.x - p.y };
        }
      });

      // Validar si el polígono cubre al menos el 25% del área
      const polyArea = polygonArea([tl, tr, br, bl]);
      const totalArea = width * height;
      if (polyArea > totalArea * 0.2) {
        // Añadir margen suave para no cortar bordes del documento
        return refineCorners([tl, tr, br, bl], width, height);
      }
    }

    // Default: marco con 8% de margen interno
    const padX = width * 0.08;
    const padY = height * 0.08;
    return [
      { x: padX, y: padY },
      { x: width - padX, y: padY },
      { x: width - padX, y: height - padY },
      { x: padX, y: height - padY }
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

  function refineCorners(corners, w, h) {
    return corners.map(pt => ({
      x: Math.max(5, Math.min(w - 5, pt.x)),
      y: Math.max(5, Math.min(h - 5, pt.y))
    }));
  }

  /**
   * Calcula la matriz de homografía inversa para transformar 4 puntos arbitrarios
   * en un rectángulo perfectamente alineado (Perspective Correction).
   */
  function getPerspectiveTransform(src, dst) {
    // Resuelve sistema de ecuaciones lineales 8x8 para homografía H
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

  // Eliminación Gaussiana con pivoteo parcial para matriz 8x8
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
   * Aplica Perspective Warp (Recorte y encuadre recto) sobre una imagen.
   */
  function warpPerspective(sourceCanvas, corners) {
    const [tl, tr, br, bl] = corners;

    // Calcular dimensiones del documento de salida usando distancias euclidianas
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

    // Matriz de mapeo inverso de destino a origen
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
          // Interpolación bilineal para máxima nitidez de texto
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

  /**
   * Aplica filtros fotográficos profesionales para documentos (Magic Color, B/N, Grises, Nitidez).
   */
  function applyDocumentFilter(canvas, options = {}) {
    const {
      filterType = 'magic', // 'magic' | 'bw' | 'grayscale' | 'original'
      brightness = 0,       // -50 to 50
      contrast = 100,       // 50 to 200 (100 = 1.0)
      sharpness = 0         // 0 to 100
    } = options;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    let imgData = ctx.getImageData(0, 0, w, h);
    let data = imgData.data;

    // 1. Filtro base de modo de documento
    if (filterType === 'magic') {
      // Magic Color: Ecualización de blancos de fondo + realce de texto coloreado
      for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        // Aclarar fondo claro (papel) y oscurecer texto oscuro
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
      // Document B&W: Binarización adaptativa con umbral suave
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

    // 2. Ajuste de Contraste y Brillo
    const cFactor = contrast / 100;
    const bOffset = brightness * 1.5;

    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let val = data[i + c];
        // Brillo
        val += bOffset;
        // Contraste centrado en 128
        val = (val - 128) * cFactor + 128;
        data[i + c] = Math.max(0, Math.min(255, val));
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // 3. Enfoque / Nitidez (Convolution 3x3 Unsharp Mask)
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

    // Matriz de enfoque (Laplacian)
    // [  0, -s,  0 ]
    // [ -s, 1+4s, -s ]
    // [  0, -s,  0 ]
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
    warpPerspective,
    applyDocumentFilter
  };
})();
