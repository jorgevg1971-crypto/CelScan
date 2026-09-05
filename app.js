/**
 * Escáner Móvil Pro - Application Controller
 * Manejo de UI, Cámara, Recorte interactivo con lupa, Filtros y Guardado / Compartir (WhatsApp, Correo, Almacenamiento local)
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const screenCamera = document.getElementById('screen-camera');
  const screenCrop = document.getElementById('screen-crop');
  const screenFilter = document.getElementById('screen-filter');
  const screenShare = document.getElementById('screen-share');
  
  const cameraFeed = document.getElementById('camera-feed');
  const cameraCanvas = document.getElementById('camera-canvas');
  const btnShutter = document.getElementById('btn-shutter');
  const btnTorch = document.getElementById('btn-torch');
  const btnSwitchCam = document.getElementById('btn-switch-cam');
  const galleryInput = document.getElementById('gallery-input');
  const btnDocList = document.getElementById('btn-doc-list');
  const badgePageCount = document.getElementById('badge-page-count');
  const btnBack = document.getElementById('btn-back');
  const btnInfo = document.getElementById('btn-info');
  const modalInfo = document.getElementById('modal-info');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const headerTitle = document.getElementById('header-title');

  // Crop Screen Elements
  const cropCanvas = document.getElementById('crop-canvas');
  const cropWrapper = document.getElementById('crop-wrapper');
  const btnAutoCrop = document.getElementById('btn-auto-crop');
  const btnA4Crop = document.getElementById('btn-a4-crop');
  const btnLetterCrop = document.getElementById('btn-letter-crop');
  const btnRotateCrop = document.getElementById('btn-rotate-crop');
  const btnFullCrop = document.getElementById('btn-full-crop');
  const btnApplyCrop = document.getElementById('btn-apply-crop');
  const loupe = document.getElementById('loupe');
  const loupeCanvas = document.getElementById('loupe-canvas');

  // Filter Screen Elements
  const filterCanvas = document.getElementById('filter-canvas');
  const presetButtons = document.querySelectorAll('.preset-btn');
  const sliderSharpness = document.getElementById('slider-sharpness');
  const sliderContrast = document.getElementById('slider-contrast');
  const sliderBrightness = document.getElementById('slider-brightness');
  const valSharpness = document.getElementById('val-sharpness');
  const valContrast = document.getElementById('val-contrast');
  const valBrightness = document.getElementById('val-brightness');
  const btnAddMorePages = document.getElementById('btn-add-more-pages');
  const btnDoneFilter = document.getElementById('btn-done-filter');

  // Share Screen Elements
  const docTitleInput = document.getElementById('doc-title-input');
  const docPagesInfo = document.getElementById('doc-pages-info');
  const pagesCarousel = document.getElementById('pages-carousel');
  const btnSavePdf = document.getElementById('btn-save-pdf');
  const btnSaveImg = document.getElementById('btn-save-img');
  const btnShareWhatsapp = document.getElementById('btn-share-whatsapp');
  const btnShareEmail = document.getElementById('btn-share-email');
  const btnShareSystem = document.getElementById('btn-share-system');
  const btnNewScan = document.getElementById('btn-new-scan');
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');

  // Application State
  let stream = null;
  let currentFacingMode = 'environment'; // Cámara trasera por defecto
  let torchActive = false;
  let rawCapturedCanvas = null;
  let warpedCanvas = null;
  let activeScreen = 'camera';
  
  // Crop state
  let cropCorners = []; // [{x, y}, {x, y}, {x, y}, {x, y}] (tl, tr, br, bl)
  let activeCornerIndex = -1;
  let cropScale = 1;
  let cropOffsetX = 0;
  let cropOffsetY = 0;

  // Filter state
  let currentFilter = 'magic';
  let filterSettings = {
    sharpness: 40,
    contrast: 125,
    brightness: 10
  };

  // Scanned pages collection (Multi-page document)
  const scannedPages = []; // Array of { dataUrl, width, height }

  // ==========================================
  // INITIALIZATION & CAMERA
  // ==========================================
  async function initCamera() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
      audio: false,
      video: {
        facingMode: currentFacingMode,
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraFeed.srcObject = stream;
      await cameraFeed.play();
    } catch (err) {
      console.warn('Error al abrir cámara con constraints avanzados, reintentando con básicos...', err);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        cameraFeed.srcObject = stream;
        await cameraFeed.play();
      } catch (e) {
        showToast('Permiso de cámara no disponible. Usa el botón de galería 📁');
      }
    }
  }

  async function toggleTorch() {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    
    try {
      const capabilities = track.getCapabilities ? track.getCapabilities() : {};
      if (capabilities.torch) {
        torchActive = !torchActive;
        await track.applyConstraints({ advanced: [{ torch: torchActive }] });
        btnTorch.classList.toggle('active', torchActive);
        showToast(torchActive ? 'Linterna encendida' : 'Linterna apagada');
      } else {
        showToast('Linterna no soportada en este lente');
      }
    } catch (err) {
      showToast('Linterna no disponible');
    }
  }

  function switchCamera() {
    currentFacingMode = (currentFacingMode === 'environment') ? 'user' : 'environment';
    initCamera();
    showToast(currentFacingMode === 'environment' ? 'Cámara Trasera' : 'Cámara Frontal');
  }

  // Capturar imagen desde el video stream
  function capturePhoto() {
    if (!cameraFeed.videoWidth) {
      showToast('Esperando señal de la cámara...');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = cameraFeed.videoWidth;
    canvas.height = cameraFeed.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(cameraFeed, 0, 0, canvas.width, canvas.height);

    processCapturedImage(canvas);
  }

  // Cargar imagen desde archivo/galería
  galleryInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        processCapturedImage(canvas);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
    galleryInput.value = '';
  });

  function processCapturedImage(canvas) {
    rawCapturedCanvas = canvas;
    
    // Auto-detectar esquinas iniciales
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    cropCorners = ScannerCore.detectDocumentCorners(imgData);

    goToScreen('crop');
    renderCropCanvas();
    showToast('Encuadre y bordes detectados');
  }

  // ==========================================
  // NAVIGATION
  // ==========================================
  function goToScreen(screenName) {
    activeScreen = screenName;
    [screenCamera, screenCrop, screenFilter, screenShare].forEach(s => s.classList.remove('active'));
    
    if (screenName === 'camera') {
      screenCamera.classList.add('active');
      btnBack.classList.add('hidden');
      headerTitle.innerText = 'Escáner Móvil Pro';
      initCamera();
    } else if (screenName === 'crop') {
      screenCrop.classList.add('active');
      btnBack.classList.remove('hidden');
      headerTitle.innerText = 'Ajustar Encuadre';
    } else if (screenName === 'filter') {
      screenFilter.classList.add('active');
      btnBack.classList.remove('hidden');
      headerTitle.innerText = 'Filtros y Enfoque';
    } else if (screenName === 'share') {
      screenShare.classList.add('active');
      btnBack.classList.remove('hidden');
      headerTitle.innerText = 'Guardar y Compartir';
      updateShareScreen();
    }
  }

  btnBack.addEventListener('click', () => {
    if (activeScreen === 'crop') goToScreen('camera');
    else if (activeScreen === 'filter') goToScreen('crop');
    else if (activeScreen === 'share') {
      if (scannedPages.length > 0) goToScreen('camera');
      else goToScreen('camera');
    }
  });

  // ==========================================
  // CROP & PERSPECTIVE INTERACTION (ENCUADRE)
  // ==========================================
  function renderCropCanvas() {
    if (!rawCapturedCanvas) return;

    const wrapperRect = cropWrapper.getBoundingClientRect();
    const maxWidth = wrapperRect.width - 24;
    const maxHeight = wrapperRect.height - 24;

    const imgW = rawCapturedCanvas.width;
    const imgH = rawCapturedCanvas.height;

    cropScale = Math.min(maxWidth / imgW, maxHeight / imgH);
    cropCanvas.width = imgW * cropScale;
    cropCanvas.height = imgH * cropScale;

    const ctx = cropCanvas.getContext('2d');
    ctx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    ctx.drawImage(rawCapturedCanvas, 0, 0, cropCanvas.width, cropCanvas.height);

    // Dibujar polígono semi-transparente del documento
    ctx.beginPath();
    ctx.moveTo(cropCorners[0].x * cropScale, cropCorners[0].y * cropScale);
    for (let i = 1; i < 4; i++) {
      ctx.lineTo(cropCorners[i].x * cropScale, cropCorners[i].y * cropScale);
    }
    ctx.closePath();

    // Relleno suave con tinte azul
    ctx.fillStyle = 'rgba(59, 130, 246, 0.22)';
    ctx.fill();

    // Líneas de borde
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Dibujar las 4 manijas de las esquinas
    cropCorners.forEach((pt, idx) => {
      const sx = pt.x * cropScale;
      const sy = pt.y * cropScale;

      ctx.beginPath();
      ctx.arc(sx, sy, 14, 0, Math.PI * 2);
      ctx.fillStyle = idx === activeCornerIndex ? '#facc15' : '#38bdf8';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Punto central
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
    });
  }

  // Manejo de Toque / Arrastre de Esquinas
  function getCanvasTouchPos(e) {
    const rect = cropCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) / cropScale,
      y: (clientY - rect.top) / cropScale,
      rawX: clientX,
      rawY: clientY
    };
  }

  function handleStart(e) {
    if (!rawCapturedCanvas) return;
    const pos = getCanvasTouchPos(e);
    const hitRadius = 35 / cropScale; // Radio amplio táctil para dedos

    activeCornerIndex = -1;
    let minDist = Infinity;

    cropCorners.forEach((pt, idx) => {
      const dist = Math.hypot(pt.x - pos.x, pt.y - pos.y);
      if (dist < hitRadius && dist < minDist) {
        minDist = dist;
        activeCornerIndex = idx;
      }
    });

    if (activeCornerIndex !== -1) {
      e.preventDefault();
      updateLoupe(pos);
      renderCropCanvas();
    }
  }

  function handleMove(e) {
    if (activeCornerIndex === -1 || !rawCapturedCanvas) return;
    e.preventDefault();
    const pos = getCanvasTouchPos(e);

    // Restringir dentro de los límites de la imagen
    const clampedX = Math.max(0, Math.min(rawCapturedCanvas.width, pos.x));
    const clampedY = Math.max(0, Math.min(rawCapturedCanvas.height, pos.y));

    cropCorners[activeCornerIndex] = { x: clampedX, y: clampedY };
    updateLoupe(pos);
    renderCropCanvas();
  }

  function handleEnd() {
    if (activeCornerIndex !== -1) {
      activeCornerIndex = -1;
      loupe.classList.add('hidden');
      renderCropCanvas();
    }
  }

  // Lupa de precisión para ajuste al milímetro
  function updateLoupe(pos) {
    loupe.classList.remove('hidden');
    const wrapperRect = cropWrapper.getBoundingClientRect();
    
    // Posicionar lupa arriba del dedo para no taparla
    let loupeLeft = pos.rawX - wrapperRect.left - 60;
    let loupeTop = pos.rawY - wrapperRect.top - 140;

    if (loupeTop < 10) loupeTop = pos.rawY - wrapperRect.top + 50;
    if (loupeLeft < 10) loupeLeft = 10;
    if (loupeLeft > wrapperRect.width - 130) loupeLeft = wrapperRect.width - 130;

    loupe.style.left = `${loupeLeft}px`;
    loupe.style.top = `${loupeTop}px`;

    // Renderizar imagen ampliada 2.5x en el canvas de la lupa
    const lCtx = loupeCanvas.getContext('2d');
    lCtx.clearRect(0, 0, 120, 120);

    const corner = cropCorners[activeCornerIndex];
    const zoom = 2.5;
    const sampleSize = 120 / zoom;

    lCtx.drawImage(
      rawCapturedCanvas,
      corner.x - sampleSize / 2,
      corner.y - sampleSize / 2,
      sampleSize,
      sampleSize,
      0,
      0,
      120,
      120
    );
  }

  cropCanvas.addEventListener('mousedown', handleStart);
  window.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleEnd);

  cropCanvas.addEventListener('touchstart', handleStart, { passive: false });
  window.addEventListener('touchmove', handleMove, { passive: false });
  window.addEventListener('touchend', handleEnd);

  // Botones de la barra de recorte
  function setCropChipActive(btn) {
    [btnAutoCrop, btnA4Crop, btnLetterCrop].forEach(b => {
      if (b) b.classList.remove('active');
    });
    if (btn) btn.classList.add('active');
  }

  btnAutoCrop.addEventListener('click', () => {
    if (!rawCapturedCanvas) return;
    setCropChipActive(btnAutoCrop);
    const ctx = rawCapturedCanvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, rawCapturedCanvas.width, rawCapturedCanvas.height);
    cropCorners = ScannerCore.detectDocumentCorners(imgData);
    renderCropCanvas();
    showToast('🪄 Detección inteligente de hoja');
  });

  btnA4Crop.addEventListener('click', () => {
    if (!rawCapturedCanvas) return;
    setCropChipActive(btnA4Crop);
    cropCorners = ScannerCore.getA4PresetCorners(rawCapturedCanvas.width, rawCapturedCanvas.height);
    renderCropCanvas();
    showToast('📄 Encuadre A4 aplicado');
  });

  btnLetterCrop.addEventListener('click', () => {
    if (!rawCapturedCanvas) return;
    setCropChipActive(btnLetterCrop);
    cropCorners = ScannerCore.getLetterPresetCorners(rawCapturedCanvas.width, rawCapturedCanvas.height);
    renderCropCanvas();
    showToast('📃 Encuadre Carta aplicado');
  });

  btnFullCrop.addEventListener('click', () => {
    if (!rawCapturedCanvas) return;
    setCropChipActive(null);
    const w = rawCapturedCanvas.width;
    const h = rawCapturedCanvas.height;
    cropCorners = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h }
    ];
    renderCropCanvas();
    showToast('Selección completa');
  });

  btnRotateCrop.addEventListener('click', () => {
    if (!rawCapturedCanvas) return;
    const rotated = document.createElement('canvas');
    rotated.width = rawCapturedCanvas.height;
    rotated.height = rawCapturedCanvas.width;
    const rCtx = rotated.getContext('2d');
    rCtx.translate(rotated.width / 2, rotated.height / 2);
    rCtx.rotate(Math.PI / 2);
    rCtx.drawImage(rawCapturedCanvas, -rawCapturedCanvas.width / 2, -rawCapturedCanvas.height / 2);

    rawCapturedCanvas = rotated;
    const ctx = rawCapturedCanvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, rawCapturedCanvas.width, rawCapturedCanvas.height);
    cropCorners = ScannerCore.detectDocumentCorners(imgData);
    renderCropCanvas();
  });

  btnApplyCrop.addEventListener('click', () => {
    if (!rawCapturedCanvas) return;
    // Aplicar homografía y perspectiva
    warpedCanvas = ScannerCore.warpPerspective(rawCapturedCanvas, cropCorners);
    goToScreen('filter');
    applyFiltersAndRender();
    showToast('Perspectiva rectificada');
  });

  // ==========================================
  // FILTERS & ENHANCEMENTS (ENFOQUE Y FILTROS)
  // ==========================================
  function applyFiltersAndRender() {
    if (!warpedCanvas) return;

    filterCanvas.width = warpedCanvas.width;
    filterCanvas.height = warpedCanvas.height;
    const ctx = filterCanvas.getContext('2d');
    ctx.drawImage(warpedCanvas, 0, 0);

    ScannerCore.applyDocumentFilter(filterCanvas, {
      filterType: currentFilter,
      sharpness: filterSettings.sharpness,
      contrast: filterSettings.contrast,
      brightness: filterSettings.brightness
    });
  }

  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      presetButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;

      // Ajustes por defecto inteligentes según el preset
      if (currentFilter === 'magic') {
        sliderSharpness.value = 40;
        sliderContrast.value = 125;
        sliderBrightness.value = 10;
      } else if (currentFilter === 'bw') {
        sliderSharpness.value = 60;
        sliderContrast.value = 150;
        sliderBrightness.value = 5;
      } else if (currentFilter === 'grayscale') {
        sliderSharpness.value = 30;
        sliderContrast.value = 120;
        sliderBrightness.value = 0;
      } else if (currentFilter === 'original') {
        sliderSharpness.value = 0;
        sliderContrast.value = 100;
        sliderBrightness.value = 0;
      }
      syncSliderLabels();
      applyFiltersAndRender();
    });
  });

  function syncSliderLabels() {
    filterSettings.sharpness = parseInt(sliderSharpness.value, 10);
    filterSettings.contrast = parseInt(sliderContrast.value, 10);
    filterSettings.brightness = parseInt(sliderBrightness.value, 10);

    valSharpness.innerText = `${filterSettings.sharpness}%`;
    valContrast.innerText = `${filterSettings.contrast}%`;
    valBrightness.innerText = filterSettings.brightness > 0 ? `+${filterSettings.brightness}` : `${filterSettings.brightness}`;
  }

  [sliderSharpness, sliderContrast, sliderBrightness].forEach(slider => {
    slider.addEventListener('input', () => {
      syncSliderLabels();
      applyFiltersAndRender();
    });
  });

  // Guardar página actual en la lista del documento
  function commitCurrentPage() {
    const pageDataUrl = filterCanvas.toDataURL('image/jpeg', 0.92);
    scannedPages.push({
      dataUrl: pageDataUrl,
      width: filterCanvas.width,
      height: filterCanvas.height
    });
    updatePageBadge();
  }

  function updatePageBadge() {
    const count = scannedPages.length;
    badgePageCount.innerText = count;
    if (count > 0) {
      badgePageCount.classList.remove('hidden');
    } else {
      badgePageCount.classList.add('hidden');
    }
  }

  btnAddMorePages.addEventListener('click', () => {
    commitCurrentPage();
    showToast(`Página ${scannedPages.length} guardada. Escanea la siguiente`);
    goToScreen('camera');
  });

  btnDoneFilter.addEventListener('click', () => {
    commitCurrentPage();
    goToScreen('share');
  });

  btnDocList.addEventListener('click', () => {
    if (scannedPages.length > 0) {
      goToScreen('share');
    } else {
      showToast('Aún no has escaneado ninguna página');
    }
  });

  // ==========================================
  // DOCUMENT HUB: SHARE & SAVE
  // ==========================================
  function updateShareScreen() {
    docPagesInfo.innerText = `${scannedPages.length} Página(s)`;
    pagesCarousel.innerHTML = '';

    scannedPages.forEach((page, index) => {
      const item = document.createElement('div');
      item.className = 'page-thumb-item';
      item.innerHTML = `
        <img src="${page.dataUrl}" alt="Pág ${index + 1}">
        <span class="page-thumb-num">#${index + 1}</span>
        <button class="page-thumb-del" data-idx="${index}" title="Eliminar">&times;</button>
      `;
      pagesCarousel.appendChild(item);
    });

    // Eventos de eliminación de páginas
    document.querySelectorAll('.page-thumb-del').forEach(delBtn => {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(delBtn.dataset.idx, 10);
        scannedPages.splice(idx, 1);
        updatePageBadge();
        if (scannedPages.length === 0) {
          goToScreen('camera');
        } else {
          updateShareScreen();
        }
      });
    });
  }

  // GENERAR PDF MULTIPÁGINA
  function generatePDFBlob() {
    if (scannedPages.length === 0) return null;

    const { jsPDF } = window.jspdf;
    const firstPage = scannedPages[0];
    const isPortrait = firstPage.height >= firstPage.width;
    
    // PDF en orientación del primer documento
    const pdf = new jsPDF({
      orientation: isPortrait ? 'portrait' : 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    scannedPages.forEach((page, i) => {
      if (i > 0) {
        const pageIsPortrait = page.height >= page.width;
        pdf.addPage('a4', pageIsPortrait ? 'portrait' : 'landscape');
      }
      pdf.addImage(page.dataUrl, 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
    });

    return pdf.output('blob');
  }

  // 1. GUARDAR EN MEMORIA (PDF)
  btnSavePdf.addEventListener('click', () => {
    try {
      const blob = generatePDFBlob();
      if (!blob) {
        showToast('No hay páginas escaneadas');
        return;
      }
      const title = (docTitleInput.value.trim() || 'Documento_Escaneado') + '.pdf';
      downloadBlob(blob, title);
      showToast('✅ PDF guardado en la memoria del teléfono');
    } catch (err) {
      console.error(err);
      showToast('Error al generar PDF');
    }
  });

  // 2. GUARDAR EN MEMORIA (IMAGEN JPEG)
  btnSaveImg.addEventListener('click', () => {
    if (scannedPages.length === 0) {
      showToast('No hay páginas escaneadas');
      return;
    }
    const title = (docTitleInput.value.trim() || 'Documento_Escaneado') + '.jpg';
    // Descargar primera o todas
    scannedPages.forEach((p, idx) => {
      const filename = scannedPages.length > 1 ? `${docTitleInput.value.trim()}_pag_${idx + 1}.jpg` : title;
      const link = document.createElement('a');
      link.href = p.dataUrl;
      link.download = filename;
      link.click();
    });
    showToast('✅ Foto guardada en la galería / almacenamiento');
  });

  // 3. COMPARTIR POR WHATSAPP
  btnShareWhatsapp.addEventListener('click', async () => {
    const title = (docTitleInput.value.trim() || 'Documento_Escaneado') + '.pdf';
    const blob = generatePDFBlob();
    if (!blob) return;

    const file = new File([blob], title, { type: 'application/pdf' });

    // Intento con Web Share API (Nativo para Android e iOS WhatsApp)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'Documento Escaneado',
          text: 'Te comparto este documento escaneado con Escáner Móvil Pro'
        });
        showToast('Compartiendo con WhatsApp...');
      } catch (e) {
        if (e.name !== 'AbortError') {
          fallbackWhatsappText();
        }
      }
    } else {
      fallbackWhatsappText();
    }
  });

  function fallbackWhatsappText() {
    const text = encodeURIComponent('Te comparto este documento escaneado desde mi teléfono con Escáner Móvil Pro.');
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
    showToast('Abriendo WhatsApp...');
  }

  // 4. COMPARTIR POR CORREO ELECTRÓNICO
  btnShareEmail.addEventListener('click', async () => {
    const title = (docTitleInput.value.trim() || 'Documento_Escaneado') + '.pdf';
    const blob = generatePDFBlob();
    if (!blob) return;

    const file = new File([blob], title, { type: 'application/pdf' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: title,
          text: 'Adjunto documento escaneado.'
        });
        showToast('Abriendo cliente de correo...');
      } catch (e) {
        if (e.name !== 'AbortError') {
          fallbackEmailMailto();
        }
      }
    } else {
      fallbackEmailMailto();
    }
  });

  function fallbackEmailMailto() {
    const subject = encodeURIComponent(docTitleInput.value.trim() || 'Documento Escaneado');
    const body = encodeURIComponent('Adjunto documento escaneado mediante Escáner Móvil Pro.');
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    showToast('Abriendo correo...');
  }

  // 5. MÁS OPCIONES DE COMPARTIR (AirDrop, Bluetooth, etc.)
  btnShareSystem.addEventListener('click', async () => {
    const title = (docTitleInput.value.trim() || 'Documento_Escaneado') + '.pdf';
    const blob = generatePDFBlob();
    if (!blob) return;

    const file = new File([blob], title, { type: 'application/pdf' });

    if (navigator.share) {
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: title,
            text: 'Documento Escaneado'
          });
        } else {
          await navigator.share({
            title: title,
            text: 'Documento Escaneado'
          });
        }
      } catch (e) {
        console.log('Share cancelado o no soportado');
      }
    } else {
      // Fallback: descargar directamente
      downloadBlob(blob, title);
      showToast('Descargado al teléfono');
    }
  });

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  btnNewScan.addEventListener('click', () => {
    scannedPages.length = 0;
    updatePageBadge();
    goToScreen('camera');
  });

  // UI Toast helper
  let toastTimer = null;
  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toastMessage.innerText = msg;
    toast.classList.remove('hidden');
    toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 2800);
  }

  // Eventos de controles de cámara
  btnShutter.addEventListener('click', capturePhoto);
  btnTorch.addEventListener('click', toggleTorch);
  btnSwitchCam.addEventListener('click', switchCamera);
  btnInfo.addEventListener('click', () => modalInfo.classList.remove('hidden'));
  btnCloseModal.addEventListener('click', () => modalInfo.classList.add('hidden'));

  // Inicio
  initCamera();
});
