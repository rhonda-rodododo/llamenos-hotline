---
title: "Configuración: SMS"
description: Habilitar mensajería SMS entrante y saliente a través de su proveedor de telefonía.
---

La mensajería SMS en Llamenos reutiliza las credenciales de su proveedor de telefonía de voz existente. No se requiere un servicio de SMS separado — si ya configuró Twilio, SignalWire, Vonage o Plivo para voz, el SMS funciona con la misma cuenta.

## Proveedores compatibles

| Proveedor | Soporte SMS | Notas |
|-----------|------------|-------|
| **Twilio** | Sí | SMS bidireccional completo a través de la API de mensajería de Twilio |
| **SignalWire** | Sí | Compatible con la API de Twilio — misma interfaz |
| **Vonage** | Sí | SMS a través de la API REST de Vonage |
| **Plivo** | Sí | SMS a través de la API de mensajes de Plivo |
| **Asterisk** | No | Asterisk no soporta SMS de forma nativa |

## 1. Habilitar SMS en la configuración de administración

Navegue a **Configuración de administración > Canales de mensajería** (o use el asistente de configuración en el primer inicio de sesión) y active **SMS**.

Configure los ajustes de SMS:
- **Mensaje de respuesta automática** — mensaje de bienvenida opcional enviado a contactos nuevos
- **Respuesta fuera de horario** — mensaje opcional enviado fuera del horario de turnos

## 2. Configurar el webhook

Apunte el webhook de SMS de su proveedor de telefonía a su servidor:

```
POST https://your-domain.com/api/messaging/sms/webhook
```

### Twilio / SignalWire

1. Vaya a la consola de Twilio > Phone Numbers > Active Numbers
2. Seleccione su número de teléfono
3. En **Messaging**, configure la URL del webhook para "A message comes in" con la URL indicada arriba
4. Establezca el método HTTP en **POST**

### Vonage

1. Vaya al panel de la API de Vonage > Applications
2. Seleccione su aplicación
3. En **Messages**, configure la URL de entrada con la URL del webhook indicada arriba

### Plivo

1. Vaya a la consola de Plivo > Messaging > Applications
2. Cree o edite una aplicación de mensajería
3. Configure la URL de mensajes con la URL del webhook indicada arriba
4. Asigne la aplicación a su número de teléfono

## 3. Probar

Envíe un SMS al número de teléfono de su línea de ayuda. Debería ver la conversación aparecer en la pestaña **Conversaciones** en el panel de administración.

## Cómo funciona

1. Un SMS llega a su proveedor, que envía un webhook a su servidor
2. El servidor valida la firma del webhook (HMAC específico del proveedor)
3. El mensaje se analiza y se almacena en el ConversationService
4. Los voluntarios en turno son notificados a través de eventos del relay Nostr
5. Los voluntarios responden desde la pestaña de Conversaciones — las respuestas se envían de vuelta a través de la API de SMS de su proveedor

## Notas de seguridad

- Los mensajes SMS atraviesan la red del operador en texto plano — su proveedor y los operadores pueden leerlos
- Los mensajes entrantes se cifran al recibirlos y se almacenan en la base de datos
- Los números de teléfono de los remitentes se procesan con hash antes del almacenamiento (privacidad)
- Las firmas de los webhooks se validan por proveedor (HMAC-SHA1 para Twilio, etc.)
