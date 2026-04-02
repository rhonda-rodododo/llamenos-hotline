---
title: "Configuración: Asterisk (Autoalojado)"
description: Guía paso a paso para desplegar Asterisk con el puente ARI para Llamenos.
---

Asterisk es una plataforma de telefonía de código abierto que usted aloja en su propia infraestructura. Esto le da el máximo control sobre sus datos y elimina los costos por minuto de los proveedores en la nube. Llamenos se conecta a Asterisk mediante la Interfaz REST de Asterisk (ARI).

Esta es la opción de configuración más compleja y se recomienda para organizaciones con personal técnico capaz de administrar infraestructura de servidores.

## Requisitos previos

- Un servidor Linux (Ubuntu 22.04+ o Debian 12+ recomendado) con una dirección IP pública
- Un proveedor de troncal SIP para conectividad PSTN (por ejemplo, Telnyx, Flowroute, VoIP.ms)
- Su instancia de Llamenos desplegada y accesible mediante una URL pública
- Familiaridad básica con la administración de servidores Linux

## 1. Instalar Asterisk

### Opción A: Gestor de paquetes (más sencillo)

```bash
sudo apt update
sudo apt install asterisk
```

### Opción B: Docker (recomendado para una gestión más fácil)

```bash
docker pull asterisk/asterisk:20
docker run -d \
  --name asterisk \
  --network host \
  -v /etc/asterisk:/etc/asterisk \
  -v /var/lib/asterisk:/var/lib/asterisk \
  asterisk/asterisk:20
```

### Opción C: Compilar desde el código fuente (para módulos personalizados)

```bash
wget https://downloads.asterisk.org/pub/telephony/asterisk/asterisk-20-current.tar.gz
tar xzf asterisk-20-current.tar.gz
cd asterisk-20.*/
./configure
make
sudo make install
sudo make samples
```

## 2. Configurar la troncal SIP

Edite `/etc/asterisk/pjsip.conf` para agregar su proveedor de troncal SIP. A continuación se muestra una configuración de ejemplo:

```ini
; Troncal SIP hacia su proveedor PSTN
[trunk-provider]
type=registration
transport=transport-tls
outbound_auth=trunk-auth
server_uri=sip:sip.your-provider.com
client_uri=sip:your-account@sip.your-provider.com

[trunk-auth]
type=auth
auth_type=userpass
username=your-account
password=your-password

[trunk-endpoint]
type=endpoint
context=from-trunk
transport=transport-tls
disallow=all
allow=ulaw
allow=alaw
allow=opus
aors=trunk-aor
outbound_auth=trunk-auth

[trunk-aor]
type=aor
contact=sip:sip.your-provider.com
```

## 3. Habilitar ARI

ARI (Asterisk REST Interface) es la interfaz que Llamenos utiliza para controlar las llamadas en Asterisk.

Edite `/etc/asterisk/ari.conf`:

```ini
[general]
enabled=yes
pretty=yes

[llamenos]
type=user
read_only=no
password=your-strong-ari-password
```

Edite `/etc/asterisk/http.conf` para habilitar el servidor HTTP:

```ini
[general]
enabled=yes
bindaddr=0.0.0.0
bindport=8088
tlsenable=yes
tlsbindaddr=0.0.0.0:8089
tlscertfile=/etc/asterisk/keys/asterisk.pem
tlsprivatekey=/etc/asterisk/keys/asterisk.key
```

## 4. Configurar el plan de marcación

Edite `/etc/asterisk/extensions.conf` para enrutar las llamadas entrantes a la aplicación ARI:

```ini
[from-trunk]
exten => _X.,1,NoOp(Incoming call from ${CALLERID(num)})
 same => n,Stasis(llamenos,incoming)
 same => n,Hangup()

[llamenos-outbound]
exten => _X.,1,NoOp(Outbound call to ${EXTEN})
 same => n,Stasis(llamenos,outbound)
 same => n,Hangup()
```

## 5. Desplegar el servicio puente ARI

El puente ARI es un servicio pequeño que traduce entre los webhooks de Llamenos y los eventos ARI. Se ejecuta junto a Asterisk y se conecta tanto al WebSocket de ARI como a su servidor de Llamenos.

```bash
# El servicio puente está incluido en el repositorio de Llamenos
cd llamenos
bun run build:ari-bridge

# Ejecutarlo
ASTERISK_ARI_URL=https://your-asterisk-server:8089/ari \
ASTERISK_ARI_USERNAME=llamenos \
ASTERISK_ARI_PASSWORD=your-strong-ari-password \
LLAMENOS_CALLBACK_URL=https://your-domain.com/api/telephony \
bun run ari-bridge
```

O con Docker:

```bash
docker run -d \
  --name llamenos-ari-bridge \
  -e ASTERISK_ARI_URL=https://your-asterisk-server:8089/ari \
  -e ASTERISK_ARI_USERNAME=llamenos \
  -e ASTERISK_ARI_PASSWORD=your-strong-ari-password \
  -e LLAMENOS_CALLBACK_URL=https://your-domain.com/api/telephony \
  llamenos/ari-bridge
```

## 6. Configurar en Llamenos

1. Inicie sesión como administrador
2. Vaya a **Configuración** > **Proveedor de telefonía**
3. Seleccione **Asterisk (Autoalojado)** en el menú desplegable de proveedores
4. Ingrese:
   - **URL de ARI**: `https://your-asterisk-server:8089/ari`
   - **Usuario de ARI**: `llamenos`
   - **Contraseña de ARI**: su contraseña de ARI
   - **URL de callback del puente**: URL donde el puente ARI recibe webhooks de Llamenos (por ejemplo, `https://bridge.your-domain.com/webhook`)
   - **Número de teléfono**: su número de teléfono de la troncal SIP (formato E.164)
5. Haga clic en **Guardar**

## 7. Probar la configuración

1. Reinicie Asterisk: `sudo systemctl restart asterisk`
2. Verifique que ARI esté ejecutándose: `curl -u llamenos:password https://your-server:8089/ari/asterisk/info`
3. Llame a su número de línea de ayuda desde un teléfono
4. Revise los registros del puente ARI para verificar la conexión y los eventos de llamadas

## Consideraciones de seguridad

Ejecutar su propio servidor Asterisk le da control total, pero también la responsabilidad total de la seguridad:

### TLS y SRTP

Siempre habilite TLS para la señalización SIP y SRTP para el cifrado de medios:

```ini
; En la sección de transporte de pjsip.conf
[transport-tls]
type=transport
protocol=tls
bind=0.0.0.0:5061
cert_file=/etc/asterisk/keys/asterisk.pem
priv_key_file=/etc/asterisk/keys/asterisk.key
method=tlsv1_2
```

Habilite SRTP en los endpoints:

```ini
[trunk-endpoint]
media_encryption=sdes
media_encryption_optimistic=yes
```

### Aislamiento de red

- Coloque Asterisk en una DMZ o segmento de red aislado
- Use un firewall para restringir el acceso:
  - SIP (5060-5061/tcp/udp): solo desde su proveedor de troncal SIP
  - RTP (10000-20000/udp): solo desde su proveedor de troncal SIP
  - ARI (8088-8089/tcp): solo desde el servidor del puente ARI
  - SSH (22/tcp): solo desde las IPs de administración
- Use fail2ban para protegerse contra ataques de escaneo SIP

### Actualizaciones periódicas

Mantenga Asterisk actualizado para corregir vulnerabilidades de seguridad:

```bash
sudo apt update && sudo apt upgrade asterisk
```

## WebRTC con Asterisk

Asterisk soporta WebRTC mediante su transporte WebSocket integrado y SIP.js en el navegador. Esto requiere configuración adicional:

1. Habilitar el transporte WebSocket en `http.conf`
2. Crear endpoints PJSIP para clientes WebRTC
3. Configurar DTLS-SRTP para el cifrado de medios
4. Usar SIP.js en el lado del cliente (configurado automáticamente por Llamenos cuando se selecciona Asterisk)

La configuración de WebRTC con Asterisk es más compleja que con proveedores en la nube. Consulte la guía de [Llamadas por navegador con WebRTC](/es/docs/deploy/providers/webrtc) para más detalles.

## Solución de problemas

- **Conexión ARI rechazada**: Verifique que `http.conf` tenga `enabled=yes` y que la dirección de enlace sea correcta.
- **Sin audio**: Verifique que los puertos RTP (10000-20000/udp) estén abiertos en su firewall y que el NAT esté configurado correctamente.
- **Fallos en el registro SIP**: Verifique las credenciales de su troncal SIP y que el DNS resuelva el servidor SIP de su proveedor.
- **El puente no se conecta**: Verifique que el puente ARI pueda alcanzar tanto el endpoint ARI de Asterisk como la URL de su servidor Llamenos.
- **Problemas de calidad de llamada**: Asegúrese de que su servidor tenga suficiente ancho de banda y baja latencia hacia el proveedor de troncal SIP. Considere los códecs (opus para WebRTC, ulaw/alaw para PSTN).
