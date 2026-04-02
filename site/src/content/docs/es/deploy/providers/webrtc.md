---
title: Llamadas WebRTC en el Navegador
description: Habilitar la atención de llamadas en el navegador para voluntarios usando WebRTC.
---

WebRTC (Web Real-Time Communication) permite a los voluntarios atender llamadas de la línea de ayuda directamente en su navegador, sin necesidad de un teléfono. Esto es útil para voluntarios que prefieren no compartir su número de teléfono o que trabajan desde una computadora.

## Cómo funciona

1. El administrador habilita WebRTC en la configuración del proveedor de telefonía
2. Los voluntarios establecen su preferencia de llamada en "Navegador" en su perfil
3. Cuando llega una llamada, la aplicación Llamenos suena en el navegador con una notificación
4. El voluntario hace clic en "Contestar" y la llamada se conecta a través del navegador usando su micrófono

El audio de la llamada se enruta desde el proveedor de telefonía a través de una conexión WebRTC hacia el navegador del voluntario. La calidad de la llamada depende de la conexión a internet del voluntario.

## Requisitos previos

### Configuración del administrador

- Un proveedor de telefonía compatible con WebRTC habilitado (Twilio, SignalWire, Vonage o Plivo)
- Credenciales WebRTC específicas del proveedor configuradas (consulte las guías de configuración de cada proveedor)
- WebRTC activado en **Configuración** > **Proveedor de telefonía**

### Requisitos para voluntarios

- Un navegador moderno (Chrome, Firefox, Edge o Safari 14.1+)
- Un micrófono funcional
- Una conexión a internet estable (mínimo 100 kbps de subida/bajada)
- Permisos de notificación del navegador otorgados

## Configuración por proveedor

Cada proveedor de telefonía requiere credenciales diferentes para WebRTC:

### Twilio / SignalWire

1. Cree una **API Key** en la consola del proveedor
2. Cree una **aplicación TwiML/LaML** con la Voice URL configurada como `https://your-domain.com/api/telephony/webrtc-incoming`
3. En Llamenos, ingrese el API Key SID, el API Key Secret y el Application SID

### Vonage

1. Su aplicación de Vonage ya incluye la capacidad WebRTC
2. En Llamenos, pegue la **clave privada** de su aplicación (formato PEM)
3. El Application ID ya está configurado desde la configuración inicial

### Plivo

1. Cree un **Endpoint** en la consola de Plivo en **Voice** > **Endpoints**
2. WebRTC utiliza su Auth ID y Auth Token existentes
3. Habilite WebRTC en Llamenos — no se necesitan credenciales adicionales

### Asterisk

WebRTC con Asterisk requiere configuración de SIP.js con transporte WebSocket. Esto es más complejo que con proveedores en la nube:

1. Habilite el transporte WebSocket en `http.conf` de Asterisk
2. Cree endpoints PJSIP para clientes WebRTC con DTLS-SRTP
3. Llamenos auto-configura el cliente SIP.js cuando se selecciona Asterisk

Consulte la [guía de configuración de Asterisk](/es/docs/deploy/providers/asterisk) para más detalles.

## Configuración de preferencia de llamada del voluntario

Los voluntarios configuran su preferencia de llamada en la aplicación:

1. Inicie sesión en Llamenos
2. Vaya a **Configuración** (icono de engranaje)
3. En **Preferencias de llamada**, seleccione **Navegador** en lugar de **Teléfono**
4. Otorgue permisos de micrófono y notificación cuando se le solicite
5. Mantenga la pestaña de Llamenos abierta durante su turno

Cuando llegue una llamada, verá una notificación del navegador y un indicador de timbre en la aplicación. Haga clic en **Contestar** para conectarse.

## Compatibilidad de navegadores

| Navegador | Escritorio | Móvil | Notas |
|---|---|---|---|
| Chrome | Sí | Sí | Recomendado |
| Firefox | Sí | Sí | Soporte completo |
| Edge | Sí | Sí | Basado en Chromium, soporte completo |
| Safari | Sí (14.1+) | Sí (14.1+) | Requiere interacción del usuario para iniciar el audio |
| Brave | Sí | Limitado | Puede ser necesario desactivar los escudos para el micrófono |

## Consejos para la calidad del audio

- Use auriculares para evitar el eco
- Cierre otras aplicaciones que usen el micrófono
- Use una conexión a internet por cable cuando sea posible
- Desactive extensiones del navegador que puedan interferir con WebRTC (extensiones VPN, bloqueadores de anuncios con protección contra fugas WebRTC)

## Solución de problemas

### Sin audio

- **Verifique los permisos del micrófono**: Haga clic en el icono del candado en la barra de direcciones y asegúrese de que el acceso al micrófono esté en "Permitir"
- **Pruebe su micrófono**: Use la prueba de audio integrada de su navegador o un sitio como [webcamtest.com](https://webcamtest.com)
- **Verifique la salida de audio**: Asegúrese de que sus altavoces o auriculares estén seleccionados como dispositivo de salida

### Las llamadas no suenan en el navegador

- **Notificaciones bloqueadas**: Verifique que las notificaciones del navegador estén habilitadas para el sitio de Llamenos
- **Pestaña no activa**: La pestaña de Llamenos debe estar abierta (puede estar en segundo plano, pero la pestaña debe existir)
- **Preferencia de llamada**: Verifique que su preferencia de llamada esté establecida en "Navegador" en Configuración
- **WebRTC no configurado**: Solicite a su administrador que verifique que WebRTC esté habilitado y las credenciales estén configuradas

### Problemas de firewall y NAT

WebRTC utiliza servidores STUN/TURN para atravesar firewalls y NAT. Si las llamadas se conectan pero no se escucha audio:

- **Firewalls corporativos**: Algunos firewalls bloquean el tráfico UDP en puertos no estándar. Solicite a su equipo de TI que permita tráfico UDP en los puertos 3478 y 10000-60000
- **NAT simétrico**: Algunos routers usan NAT simétrico que puede impedir conexiones directas entre pares. Los servidores TURN del proveedor de telefonía deberían manejar esto automáticamente
- **Interferencia de VPN**: Las VPN pueden interferir con las conexiones WebRTC. Intente desconectar su VPN durante los turnos

### Eco o retroalimentación

- Use auriculares en lugar de altavoces
- Reduzca la sensibilidad del micrófono en la configuración de audio de su sistema operativo
- Habilite la cancelación de eco en su navegador (generalmente habilitada por defecto)
- Aléjese de superficies duras y reflectantes
