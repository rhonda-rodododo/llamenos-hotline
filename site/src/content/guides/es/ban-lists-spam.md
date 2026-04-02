---
title: "Listas de bloqueo y prevención de spam"
description: "Gestionar números bloqueados, CAPTCHA de voz y limitación de frecuencia para proteger su línea de ayuda contra el abuso."
audience: [operator]
task: [configuration, troubleshooting]
feature: "bans"
order: 10
---

El spam y las personas que llaman de forma abusiva pueden sobrecargar una línea de ayuda. El sistema le ofrece varias herramientas para lidiar con esto, todas gestionables en tiempo real.

## Gestionar la lista de bloqueo

Vaya a la página de **Bloqueos** para bloquear números de teléfono específicos.

**Para bloquear un solo número:** Escriba el número de teléfono en formato internacional (por ejemplo, +15551234567) y agréguelo. El bloqueo se aplica inmediatamente — la persona que llame escuchará un mensaje de rechazo y será desconectada.

**Para bloquear varios números a la vez:** Use la función de importación masiva. Pegue una lista de números de teléfono, uno por línea, y envíe. Esto es útil si tiene una lista de números abusivos conocidos de un incidente anterior.

**Para desbloquear un número:** Búsquelo en la lista de bloqueo y elimínelo. El cambio es instantáneo.

## CAPTCHA de voz

El CAPTCHA de voz agrega un paso simple de verificación antes de que la persona que llama llegue a su equipo. Cuando está habilitado, la persona que llama escucha un código de 4 dígitos generado aleatoriamente y debe ingresarlo en su teclado. Esto detiene las llamadas automatizadas y los bots de spam simples.

Actívelo o desactívelo en **Configuración** bajo Mitigación de spam. Puede alternarlo en cualquier momento — por ejemplo, activarlo durante un ataque de spam y desactivarlo cuando la situación se calme.

## Limitación de frecuencia

La limitación de frecuencia restringe cuántas veces un solo número de teléfono puede llamar dentro de un período de tiempo determinado. Esto evita que una sola persona sature su línea.

Active o desactive la limitación de frecuencia en **Configuración** bajo Mitigación de spam.

## Lidiar con un ataque de spam

Si su línea de ayuda está recibiendo un alto volumen de llamadas de spam:

1. **Habilite el CAPTCHA de voz** inmediatamente — esto bloquea la mayoría de las llamadas automatizadas
2. **Habilite la limitación de frecuencia** para frenar a quienes llaman repetidamente
3. **Bloquee números conocidos** usando la importación masiva si puede identificar un patrón
4. **Revise el registro de llamadas** en la página de Llamadas para identificar números que llaman repetidamente

Todos estos cambios se aplican en tiempo real. No necesita reiniciar nada.

## Reportes del personal

Los miembros del personal pueden marcar a una persona como spam durante una llamada activa usando el botón **Reportar spam**. Esto agrega el número a la lista de bloqueo automáticamente.
