import http.server
import ssl
import socket
import os
import subprocess
import webbrowser

PORT_HTTPS = 8443
PORT_HTTP = 8080

def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Doesn't need to be reachable
        s.connect(('8.8.8.8', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def ensure_ssl_certs():
    if not (os.path.exists('cert.pem') and os.path.exists('key.pem')):
        print("Generando certificado SSL para acceso a cámara móvil...")
        openssl_paths = [
            r"C:\Program Files\Git\usr\bin\openssl.exe",
            "openssl"
        ]
        for p in openssl_paths:
            try:
                subprocess.run([
                    p, "req", "-x509", "-newkey", "rsa:2048",
                    "-keyout", "key.pem", "-out", "cert.pem",
                    "-days", "365", "-nodes", "-subj", "/CN=ScannerMobil"
                ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                print("Certificado SSL generado exitosamente.")
                break
            except Exception:
                continue

def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    ensure_ssl_certs()
    ip = get_ip()

    https_url = f"https://{ip}:{PORT_HTTPS}"
    http_url = f"http://{ip}:{PORT_HTTP}"
    local_url = f"https://localhost:{PORT_HTTPS}"

    print("=" * 60)
    print(" 📱 ESCÁNER MÓVIL PRO (Android & iPhone)")
    print("=" * 60)
    print(f"\nPara abrir en tu teléfono (Android o iPhone) conectado a la misma red Wi-Fi:")
    print(f"👉 Abre este enlace en el navegador de tu móvil:")
    print(f"   \033[92m{https_url}\033[0m\n")
    print(f"O en tu PC:")
    print(f"👉 {local_url}\n")
    print("-" * 60)
    print("💡 NOTA IMPORTANTE PARA TU MÓVIL:")
    print("1. Al abrir en Chrome / Safari, te aparecerá 'Aviso de seguridad / Conexión no privada' (por ser certificado local).")
    print("2. Toca en 'Configuración avanzada' y luego 'Continuar / Acceder al sitio'.")
    print("3. Permite el acceso a la cámara y ¡listo para escanear!")
    print("=" * 60)
    print("Servidor iniciado. Presiona Ctrl+C para detener.\n")

    handler = http.server.SimpleHTTPRequestHandler
    
    server_address = ('0.0.0.0', PORT_HTTPS)
    httpd = http.server.HTTPServer(server_address, handler)

    if os.path.exists('cert.pem') and os.path.exists('key.pem'):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile='cert.pem', keyfile='key.pem')
        httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")

if __name__ == '__main__':
    main()
