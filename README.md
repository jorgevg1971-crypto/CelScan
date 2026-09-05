# 📱 Escáner Móvil Pro (Android & iPhone)

Aplicación móvil multiplataforma completa diseñada para escanear documentos en alta calidad desde celulares **Android** y **iPhone (iOS)**, con ajustes de encuadre, recorte inteligente, filtros de enfoque y opciones para compartir directamente por **WhatsApp**, **Correo Electrónico** o guardar en el **almacenamiento del teléfono**.

---

## ✨ Funcionalidades Principales

1. **📸 Cámara con Detección y Encuadre Guiado**:
   - Captura en alta resolución con selección de lente (trasero / frontal) y control de linterna.
   - Posibilidad de subir fotografías de documentos existentes desde la galería.

2. **📐 Recorte Inteligente y Corrección de Perspectiva (Auto-Crop & Homografía)**:
   - Detección automática de las 4 esquinas del documento.
   - Puntos de anclaje interactivos arrastrables con los dedos.
   - **Lupa de precisión (Magnifier Loupe)**: Permite ajustar cada esquina con zoom 2.5x para máxima precisión.
   - Transformación proyectiva que endereza documentos fotografiados en ángulo.

3. **✨ Filtros de Enfoque, Realce y Nitidez**:
   - **Color Nítido (Magic Color)**: Aclara el fondo del papel y resalta colores y sellos.
   - **Blanco y Negro (Document B/N)**: Binarización de alto contraste para eliminar sombras y arrugas.
   - **Escala de Grises**: Ideal para documentos administrativos.
   - **Controles manuales**: Contraste, Brillo y Enfoque/Nitidez (Unsharp Mask) mediante convolución 3x3.

4. **📑 Documentos Multi-página**:
   - Escanea múltiples páginas y combínalas en un único documento.

5. **💾 Guardado y Compartir**:
   - **Guardar como PDF**: Genera archivo PDF estándar A4 en la memoria interna del teléfono.
   - **Guardar en Galería**: Descarga la imagen en alta resolución.
   - **Compartir por WhatsApp**: Abre directamente WhatsApp con el documento listo para enviar a cualquier contacto.
   - **Compartir por Correo**: Abre tu app de correo (Gmail, Outlook, Apple Mail) con el documento adjunto.
   - **Más Opciones**: AirDrop (iPhone), Nearby Share / Bluetooth / Drive (Android).

---

## 🚀 Cómo Usar en tu Teléfono (Android o iPhone)

### Método 1: Uso Inmediato (Servidor Local Wi-Fi)
1. Haz doble clic en el archivo **`iniciar_escaner.bat`** (o ejecuta `python serve.py`).
2. En la ventana aparecerá una dirección como:
   ```
   https://192.168.60.180:8443
   ```
3. Abre esa dirección en el navegador de tu celular (**Safari** en iPhone o **Chrome** en Android) conectado a tu misma red Wi-Fi.
4. *Nota:* Al ser un certificado local para habilitar la cámara, tu navegador mostrará un aviso de seguridad. Haz clic en **"Configuración avanzada"** y luego en **"Continuar / Acceder al sitio"**.
5. ¡Concede permiso de cámara y empieza a escanear!

### 📲 Cómo Instalarla como App Nativa en la Pantalla de Inicio

- **En iPhone (iOS / Safari)**:
  1. Toca el botón de **Compartir** (icono de cuadro con flecha hacia arriba) en la barra inferior de Safari.
  2. Selecciona **"Añadir a pantalla de inicio"**.
  3. ¡Aparecerá el icono de **DocScan** en tu pantalla de inicio como una app normal!

- **En Android (Chrome)**:
  1. Toca el menú de 3 puntos en la esquina superior derecha.
  2. Selecciona **"Instalar aplicación"** o **"Añadir a la pantalla de inicio"**.

---

## 🛠️ Proyecto Nativo React Native / Expo (Opcional para Compilar APK/IPA)

En la carpeta `react-native-app/` se encuentra el código fuente nativo de React Native con Expo para compilar paquetes `.apk` para Android o `.ipa` para iOS si deseas distribuirlo en tiendas de aplicaciones (Google Play / App Store).

Para ejecutar el proyecto Expo:
```bash
cd react-native-app
npm install
npx expo start
```
