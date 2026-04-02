---
title: "Protección de sus datos"
description: "Cómo se mantienen seguros sus datos, qué hace su PIN y qué sucede si pierde el acceso."
audience: [operator, staff]
task: [security, setup]
feature: "encryption"
order: 7
---

Su línea de ayuda cifra los datos sensibles de modo que ni siquiera el servidor pueda leerlos. Esta guía le explica qué significa eso en términos sencillos — no se necesitan conocimientos técnicos.

## Su PIN protege sus claves

Cuando configura su cuenta, el sistema crea un par de claves criptográficas que le pertenecen únicamente a usted. Piense en ellas como una cerradura y una llave — una cifra los datos, la otra los descifra.

Su **PIN** protege estas claves en su dispositivo. Cuando bloquea la aplicación o cierra su navegador, sus claves quedan selladas. Cuando ingresa su PIN, se desbloquean para que pueda leer sus datos.

**Elija un PIN seguro y recuérdelo.** Sin él, sus claves permanecen bloqueadas.

## Qué se cifra

- **Notas de llamadas** — se cifran antes de salir de su navegador. Solo usted y sus operadores pueden leerlas.
- **Información de contacto** — nombres, números de teléfono y otros datos personales se cifran.
- **Mensajes** — las conversaciones por SMS, WhatsApp y Signal se cifran al almacenarse.
- **Informes** — el contenido de los informes y los archivos adjuntos se cifran antes de subirlos.
- **Datos de la organización** — nombres de turnos, nombres de roles y otras etiquetas internas se cifran con una clave compartida.

El servidor almacena únicamente datos codificados. Incluso si alguien accediera a la base de datos, no podría leerlos.

## Vinculación de dispositivos

Si utiliza la línea de ayuda en más de un dispositivo (por ejemplo, su computadora y su teléfono), puede vincularlos. Vaya a **Configuración** y use la opción **Vincular dispositivo**. Esto transfiere sus claves de forma segura al nuevo dispositivo sin exponerlas al servidor.

## Qué sucede si pierde el acceso

Si olvida su PIN o pierde su dispositivo, consulte la guía de [Recuperación de cuenta](/es/docs/guides/es/account-recovery). En resumen: su clave de recuperación (creada durante la configuración) o su operador pueden ayudarle a recuperar el acceso.

## Para operadores

Usted tiene una responsabilidad especial — sus claves pueden descifrar datos que pertenecen a los miembros de su equipo. Mantenga sus credenciales seguras, utilice una llave de seguridad de hardware si está disponible, y siga los procedimientos de seguridad de su organización.
