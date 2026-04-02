---
title: "Canales de mensajería"
description: "Configuración de SMS, WhatsApp y Signal para que su equipo pueda recibir y responder mensajes de texto."
audience: [operator]
task: [setup, configuration]
feature: "messaging"
order: 8
---

Su línea puede recibir mensajes por SMS, WhatsApp y Signal además de llamadas de voz. Los mensajes llegan a una vista unificada de **Conversaciones** donde su equipo puede leerlos y responder.

## Configurar SMS

SMS utiliza el mismo proveedor de telefonía que sus llamadas de voz (Twilio, SignalWire, Vonage o Plivo). Para habilitarlo:

1. Vaya a **Configuración** y busque la sección de mensajería
2. Active **SMS**
3. Configure un mensaje de bienvenida — esta es la respuesta automática que se envía cuando alguien envía un mensaje de texto a su número por primera vez
4. Apunte el webhook de SMS de su proveedor al endpoint de SMS de su línea (que se muestra en la configuración)

## Configurar WhatsApp

WhatsApp requiere una cuenta de Meta Cloud API. Para habilitarlo:

1. Active **WhatsApp** en la configuración
2. Ingrese sus credenciales de Meta Cloud API: token de acceso, token de verificación e ID del número de teléfono
3. Configure el webhook de WhatsApp en el panel de Meta para que apunte al endpoint de WhatsApp de su línea

WhatsApp tiene una ventana de mensajería de 24 horas — solo puede responder a alguien dentro de las 24 horas posteriores a su último mensaje. Después de eso, necesita usar un mensaje de plantilla preaprobado para reiniciar la conversación.

## Configurar Signal

Signal utiliza un servicio puente llamado signal-cli. Para habilitarlo:

1. Active **Signal** en la configuración
2. Ingrese la URL del puente y el número de teléfono
3. El sistema monitorea el estado del puente y le avisará si la conexión se interrumpe

## Cómo llegan los mensajes

Cuando alguien envía un mensaje al número de su línea, aparece en la página de **Conversaciones**. Cada conversación se organiza por remitente en hilos, para que pueda ver el historial completo con esa persona.

Los mensajes se cifran al almacenarse — el servidor descarta el texto original inmediatamente después de cifrarlo.

## Asignación automática

Los mensajes entrantes pueden asignarse automáticamente al miembro del equipo en turno, o puede configurarlos para que vayan a un equipo específico. Los miembros del personal responden directamente desde la vista de conversación, y su respuesta se envía de vuelta por el mismo canal que usó la persona.
