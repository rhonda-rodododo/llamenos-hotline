---
title: "Configuración: WhatsApp"
description: Conectar WhatsApp Business a través de Meta Cloud API para mensajería cifrada.
---

Llamenos soporta mensajería de WhatsApp Business a través de Meta Cloud API (Graph API v21.0). WhatsApp permite mensajería enriquecida con soporte para texto, imágenes, documentos, audio y mensajes interactivos.

## Requisitos previos

- Una [cuenta de Meta Business](https://business.facebook.com)
- Un número de teléfono de la API de WhatsApp Business
- Una aplicación de desarrollador de Meta con el producto WhatsApp habilitado

## Modos de integración

Llamenos soporta dos modos de integración con WhatsApp:

### Meta Directo (recomendado)

Conexión directa a Meta Cloud API. Ofrece control total y todas las funcionalidades.

**Credenciales requeridas:**
- **Phone Number ID** — el ID de su número de teléfono de WhatsApp Business
- **Business Account ID** — el ID de su cuenta de Meta Business
- **Access Token** — un token de acceso de larga duración de la API de Meta
- **Verify Token** — una cadena personalizada que usted elige para la verificación del webhook
- **App Secret** — el secreto de su aplicación de Meta (para la validación de firmas del webhook)

### Modo Twilio

Si ya utiliza Twilio para voz, puede enrutar WhatsApp a través de su cuenta de Twilio. Configuración más sencilla, pero algunas funcionalidades pueden ser limitadas.

**Credenciales requeridas:**
- Su Account SID de Twilio existente, Auth Token y un remitente de WhatsApp conectado a Twilio

## 1. Crear una aplicación de Meta

1. Vaya a [developers.facebook.com](https://developers.facebook.com)
2. Cree una nueva aplicación (tipo: Business)
3. Agregue el producto **WhatsApp**
4. En WhatsApp > Getting Started, anote su **Phone Number ID** y **Business Account ID**
5. Genere un token de acceso permanente (Settings > Access Tokens)

## 2. Configurar el webhook

En el panel de desarrolladores de Meta:

1. Vaya a WhatsApp > Configuration > Webhook
2. Configure la URL de callback:
   ```
   https://your-domain.com/api/messaging/whatsapp/webhook
   ```
3. Establezca el Verify Token con la misma cadena que ingresará en la configuración de administración de Llamenos
4. Suscríbase al campo de webhook `messages`

Meta enviará una solicitud GET para verificar el webhook. Su servidor responderá con el desafío si el token de verificación coincide.

## 3. Habilitar WhatsApp en la configuración de administración

Navegue a **Configuración de administración > Canales de mensajería** (o use el asistente de configuración) y active **WhatsApp**.

Seleccione el modo **Meta Directo** o **Twilio** e ingrese las credenciales requeridas.

Configure los ajustes opcionales:
- **Mensaje de respuesta automática** — enviado a contactos nuevos
- **Respuesta fuera de horario** — enviada fuera del horario de turnos

## 4. Probar

Envíe un mensaje de WhatsApp a su número de teléfono Business. La conversación debería aparecer en la pestaña **Conversaciones**.

## Ventana de mensajería de 24 horas

WhatsApp aplica una ventana de mensajería de 24 horas:
- Puede responder a un usuario dentro de las 24 horas posteriores a su último mensaje
- Después de 24 horas, debe usar un **mensaje de plantilla** aprobado para reiniciar la conversación
- Llamenos maneja esto automáticamente — si la ventana ha expirado, envía un mensaje de plantilla para reiniciar la conversación

## Soporte de medios

WhatsApp soporta mensajes con medios enriquecidos:
- **Imágenes** (JPEG, PNG)
- **Documentos** (PDF, Word, etc.)
- **Audio** (MP3, OGG)
- **Video** (MP4)
- Compartir **ubicación**
- **Mensajes interactivos** con botones y listas

Los archivos adjuntos de medios aparecen en línea en la vista de conversación.

## Notas de seguridad

- WhatsApp utiliza cifrado de extremo a extremo entre el usuario y la infraestructura de Meta
- Meta técnicamente puede acceder al contenido de los mensajes en sus servidores
- Los mensajes se cifran al recibirlos y se almacenan en la base de datos
- Las firmas de los webhooks se validan usando HMAC-SHA256 con el secreto de su aplicación
- Para máxima privacidad, considere usar Signal en lugar de WhatsApp
