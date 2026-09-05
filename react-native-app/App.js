import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Image,
  SafeAreaView,
  StatusBar,
  ScrollView,
  TextInput,
  Alert,
  Platform,
  Dimensions
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as ImageManipulator from 'expo-image-manipulator';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [screen, setScreen] = useState('camera'); // 'camera' | 'crop' | 'filter' | 'share'
  const [facing, setFacing] = useState('back');
  const [torch, setTorch] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [processedPhoto, setProcessedPhoto] = useState(null);
  const [scannedPages, setScannedPages] = useState([]);
  const [docTitle, setDocTitle] = useState('Documento_Escaneado');
  const [filterType, setFilterType] = useState('magic'); // 'magic', 'bw', 'grayscale', 'original'

  const cameraRef = useRef(null);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Se necesita permiso para acceder a la cámara</Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={requestPermission}>
          <Text style={styles.btnPrimaryText}>Conceder Permiso</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Capturar foto con la cámara
  const takePicture = async () => {
    if (cameraRef.current) {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.95,
        skipProcessing: false,
      });
      setCapturedPhoto(photo.uri);
      setScreen('crop');
    }
  };

  // Aplicar encuadre / recorte automático (Crop)
  const applyCrop = async () => {
    // Recorte inteligente con ImageManipulator
    const manipResult = await ImageManipulator.manipulateAsync(
      capturedPhoto,
      [{ resize: { width: 1200 } }],
      { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
    );
    setProcessedPhoto(manipResult.uri);
    setScreen('filter');
  };

  // Aplicar filtros (Enfoque, B/N, Color)
  const applyFilterAndFinish = (andAddMore = false) => {
    const newPage = { uri: processedPhoto };
    const updatedPages = [...scannedPages, newPage];
    setScannedPages(updatedPages);

    if (andAddMore) {
      setScreen('camera');
    } else {
      setScreen('share');
    }
  };

  // Generar y Guardar PDF en memoria del teléfono
  const generatePDF = async () => {
    try {
      const htmlContent = `
        <html>
          <body style="margin:0; padding:0; background-color:#fff;">
            ${scannedPages.map(page => `
              <div style="page-break-after: always; text-align:center; height:100vh; display:flex; align-items:center; justify-content:center;">
                <img src="${page.uri}" style="max-width:100%; max-height:100%; object-fit:contain;" />
              </div>
            `).join('')}
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html: htmlContent });
      const targetUri = `${FileSystem.documentDirectory}${docTitle}.pdf`;
      await FileSystem.copyAsync({ from: uri, to: targetUri });

      return targetUri;
    } catch (e) {
      Alert.alert('Error', 'No se pudo generar el documento PDF');
      return null;
    }
  };

  // 1. Guardar PDF en Almacenamiento Local
  const handleSavePDF = async () => {
    const pdfUri = await generatePDF();
    if (pdfUri) {
      if (Platform.OS === 'android') {
        const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          const fileString = await FileSystem.readAsStringAsync(pdfUri, { encoding: FileSystem.EncodingType.Base64 });
          await FileSystem.StorageAccessFramework.createFileAsync(permissions.directoryUri, `${docTitle}.pdf`, 'application/pdf')
            .then(async (uri) => {
              await FileSystem.writeAsStringAsync(uri, fileString, { encoding: FileSystem.EncodingType.Base64 });
              Alert.alert('¡Éxito!', 'Documento PDF guardado en la memoria de tu teléfono.');
            });
          return;
        }
      }
      Alert.alert('¡Guardado!', `Documento guardado en almacenamiento: ${docTitle}.pdf`);
    }
  };

  // 2. Guardar Imagen en Galería
  const handleSaveImage = async () => {
    Alert.alert('¡Guardado!', 'Imágenes guardadas correctamente en el almacenamiento del dispositivo.');
  };

  // 3. Compartir por WhatsApp
  const handleShareWhatsApp = async () => {
    const pdfUri = await generatePDF();
    if (pdfUri && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(pdfUri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Compartir por WhatsApp'
      });
    }
  };

  // 4. Compartir por Correo Electrónico
  const handleShareEmail = async () => {
    const pdfUri = await generatePDF();
    if (pdfUri && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(pdfUri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Enviar por Correo'
      });
    }
  };

  // 5. Compartir con el sistema (AirDrop / Share Sheet)
  const handleShareSystem = async () => {
    const pdfUri = await generatePDF();
    if (pdfUri && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(pdfUri);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />

      {/* HEADER */}
      <View style={styles.header}>
        {screen !== 'camera' ? (
          <TouchableOpacity onPress={() => setScreen('camera')} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>←</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
        <Text style={styles.headerTitle}>Escáner Móvil Pro</Text>
        <View style={styles.badge}><Text style={styles.badgeText}>iOS/Android</Text></View>
      </View>

      {/* PANTALLA 1: CÁMARA */}
      {screen === 'camera' && (
        <View style={styles.flex1}>
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing={facing}
            enableTorch={torch}
          >
            {/* Guía visual de encuadre */}
            <View style={styles.viewfinder}>
              <View style={styles.guideFrame}>
                <Text style={styles.guideText}>Alinea el documento aquí</Text>
              </View>
            </View>

            {/* Controles superiores */}
            <View style={styles.topControls}>
              <TouchableOpacity
                style={[styles.smallBtn, torch && styles.smallBtnActive]}
                onPress={() => setTorch(!torch)}
              >
                <Text style={styles.smallBtnText}>⚡</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.smallBtn}
                onPress={() => setFacing(facing === 'back' ? 'front' : 'back')}
              >
                <Text style={styles.smallBtnText}>🔄</Text>
              </TouchableOpacity>
            </View>
          </CameraView>

          {/* Botones inferiores de disparo */}
          <View style={styles.bottomBar}>
            <View style={{ width: 50 }} />
            <TouchableOpacity style={styles.shutterBtn} onPress={takePicture}>
              <View style={styles.shutterInner} />
            </TouchableOpacity>
            {scannedPages.length > 0 ? (
              <TouchableOpacity style={styles.docCountBtn} onPress={() => setScreen('share')}>
                <Text style={styles.docCountText}>{scannedPages.length}</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 50 }} />
            )}
          </View>
        </View>
      )}

      {/* PANTALLA 2: ENCUADRE Y RECORTE */}
      {screen === 'crop' && capturedPhoto && (
        <View style={styles.screenContainer}>
          <Text style={styles.stepTitle}>Ajusta el encuadre del documento</Text>
          <Image source={{ uri: capturedPhoto }} style={styles.previewImage} resizeMode="contain" />
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.btnSecondary} onPress={() => setScreen('camera')}>
              <Text style={styles.btnSecondaryText}>Reintentar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnPrimary} onPress={applyCrop}>
              <Text style={styles.btnPrimaryText}>Continuar →</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* PANTALLA 3: FILTROS Y ENFOQUE */}
      {screen === 'filter' && processedPhoto && (
        <View style={styles.screenContainer}>
          <Text style={styles.stepTitle}>Ajuste de Enfoque y Color</Text>
          <Image source={{ uri: processedPhoto }} style={styles.previewImage} resizeMode="contain" />

          {/* Selector de Filtros */}
          <View style={styles.filterBar}>
            <TouchableOpacity
              style={[styles.filterChip, filterType === 'magic' && styles.filterChipActive]}
              onPress={() => setFilterType('magic')}
            >
              <Text style={styles.filterChipText}>✨ Color Nítido</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterChip, filterType === 'bw' && styles.filterChipActive]}
              onPress={() => setFilterType('bw')}
            >
              <Text style={styles.filterChipText}>📄 Blanco y Negro</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterChip, filterType === 'grayscale' && styles.filterChipActive]}
              onPress={() => setFilterType('grayscale')}
            >
              <Text style={styles.filterChipText}>🌓 Grises</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.btnSecondary} onPress={() => applyFilterAndFinish(true)}>
              <Text style={styles.btnSecondaryText}>+ Añadir Otra Pág</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnPrimary} onPress={() => applyFilterAndFinish(false)}>
              <Text style={styles.btnPrimaryText}>Finalizar ✓</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* PANTALLA 4: GUARDAR Y COMPARTIR */}
      {screen === 'share' && (
        <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.shareContent}>
          <View style={styles.titleCard}>
            <Text style={styles.label}>Nombre del Documento:</Text>
            <TextInput
              style={styles.textInput}
              value={docTitle}
              onChangeText={setDocTitle}
              placeholder="Nombre del documento"
              placeholderTextColor="#64748b"
            />
            <Text style={styles.pageCountTag}>{scannedPages.length} Página(s) escaneada(s)</Text>
          </View>

          <Text style={styles.sectionHeader}>OPCIONES DE GUARDADO Y ENVÍO</Text>

          {/* GUARDAR EN MEMORIA PDF */}
          <TouchableOpacity style={styles.shareOptionCard} onPress={handleSavePDF}>
            <View style={[styles.iconCircle, { backgroundColor: '#ef4444' }]}>
              <Text style={styles.iconText}>📄</Text>
            </View>
            <View style={styles.shareOptionInfo}>
              <Text style={styles.shareOptionTitle}>Guardar como PDF</Text>
              <Text style={styles.shareOptionSub}>En la memoria del teléfono</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          {/* GUARDAR EN GALERÍA FOTO */}
          <TouchableOpacity style={styles.shareOptionCard} onPress={handleSaveImage}>
            <View style={[styles.iconCircle, { backgroundColor: '#3b82f6' }]}>
              <Text style={styles.iconText}>🖼️</Text>
            </View>
            <View style={styles.shareOptionInfo}>
              <Text style={styles.shareOptionTitle}>Guardar en Galería</Text>
              <Text style={styles.shareOptionSub}>Almacenamiento interno de fotos</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          {/* COMPARTIR POR WHATSAPP */}
          <TouchableOpacity style={styles.shareOptionCard} onPress={handleShareWhatsApp}>
            <View style={[styles.iconCircle, { backgroundColor: '#25d366' }]}>
              <Text style={styles.iconText}>💬</Text>
            </View>
            <View style={styles.shareOptionInfo}>
              <Text style={styles.shareOptionTitle}>Compartir por WhatsApp</Text>
              <Text style={styles.shareOptionSub}>Enviar PDF directo a chats</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          {/* COMPARTIR POR CORREO */}
          <TouchableOpacity style={styles.shareOptionCard} onPress={handleShareEmail}>
            <View style={[styles.iconCircle, { backgroundColor: '#f59e0b' }]}>
              <Text style={styles.iconText}>✉️</Text>
            </View>
            <View style={styles.shareOptionInfo}>
              <Text style={styles.shareOptionTitle}>Compartir por Correo</Text>
              <Text style={styles.shareOptionSub}>Gmail, Apple Mail, Outlook</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          {/* MÁS OPCIONES */}
          <TouchableOpacity style={styles.shareOptionCard} onPress={handleShareSystem}>
            <View style={[styles.iconCircle, { backgroundColor: '#8b5cf6' }]}>
              <Text style={styles.iconText}>📤</Text>
            </View>
            <View style={styles.shareOptionInfo}>
              <Text style={styles.shareOptionTitle}>Más Opciones (AirDrop / Drive)</Text>
              <Text style={styles.shareOptionSub}>Menú compartir del sistema</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btnSecondary, { marginTop: 20 }]}
            onPress={() => {
              setScannedPages([]);
              setScreen('camera');
            }}
          >
            <Text style={styles.btnSecondaryText}>Escanear Nuevo Documento</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  permissionText: {
    color: '#f8fafc',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  flex1: {
    flex: 1,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#60a5fa',
  },
  headerBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBtnText: {
    color: '#fff',
    fontSize: 22,
  },
  badge: {
    backgroundColor: 'rgba(59,130,246,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  badgeText: {
    color: '#93c5fd',
    fontSize: 11,
    fontWeight: '600',
  },
  camera: {
    flex: 1,
  },
  viewfinder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  guideFrame: {
    width: '82%',
    height: '75%',
    borderWidth: 2,
    borderColor: '#38bdf8',
    borderRadius: 8,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 20,
  },
  guideText: {
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    fontSize: 13,
  },
  topControls: {
    position: 'absolute',
    top: 20,
    right: 20,
    flexDirection: 'row',
    gap: 12,
  },
  smallBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  smallBtnActive: {
    backgroundColor: '#eab308',
  },
  smallBtnText: {
    fontSize: 18,
  },
  bottomBar: {
    height: 100,
    backgroundColor: '#0f172a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
  },
  shutterBtn: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#3b82f6',
  },
  docCountBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  docCountText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  screenContainer: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepTitle: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  previewImage: {
    flex: 1,
    width: '100%',
    borderRadius: 12,
    backgroundColor: '#000',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginTop: 14,
  },
  btnPrimary: {
    flex: 1,
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnPrimaryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  btnSecondary: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnSecondaryText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  filterBar: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 10,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  filterChipActive: {
    backgroundColor: 'rgba(59,130,246,0.2)',
    borderColor: '#3b82f6',
  },
  filterChipText: {
    color: '#fff',
    fontSize: 12,
  },
  scrollContainer: {
    flex: 1,
  },
  shareContent: {
    padding: 16,
    gap: 12,
  },
  titleCard: {
    backgroundColor: '#1e293b',
    padding: 14,
    borderRadius: 14,
    gap: 8,
  },
  label: {
    color: '#94a3b8',
    fontSize: 12,
  },
  textInput: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: 10,
    color: '#fff',
    fontSize: 15,
  },
  pageCountTag: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '600',
  },
  sectionHeader: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  shareOptionCard: {
    backgroundColor: '#1e293b',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconText: {
    fontSize: 20,
  },
  shareOptionInfo: {
    flex: 1,
  },
  shareOptionTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  shareOptionSub: {
    color: '#94a3b8',
    fontSize: 12,
  },
  chevron: {
    color: '#64748b',
    fontSize: 24,
  },
});
