---
title: "Recuperación de cuenta"
description: "Qué hacer si olvida su PIN, pierde su dispositivo o necesita ayuda para recuperar el acceso."
audience: [operator, staff]
task: [troubleshooting, security]
feature: "recovery"
order: 15
---

Perder el acceso a su cuenta puede ser estresante, especialmente si lo necesita para su turno. Esta guía cubre las situaciones más comunes y cómo recuperar el acceso.

## Si olvidó su PIN

Su PIN protege las claves de cifrado almacenadas en su dispositivo. Si lo olvida:

1. **Pruebe con su clave de recuperación.** Durante la configuración inicial, se le entregó una clave de recuperación (o tuvo la opción de guardar una). Si la guardó en un gestor de contraseñas o la anotó, úsela para desbloquear su cuenta.
2. **Contacte a su operador.** Si no tiene su clave de recuperación, su operador puede ayudarle con el proceso de reinscripción (vea más abajo).

Su PIN no puede ser restablecido por el servidor — esto es una característica de seguridad, no una limitación. Significa que nadie (ni siquiera alguien con acceso al servidor) puede desbloquear sus datos sin su PIN o clave de recuperación.

## Si perdió su dispositivo

Si su teléfono o computadora se perdió o fue robado:

1. **Contacte a su operador inmediatamente.** Pueden desactivar su sesión para prevenir acceso no autorizado.
2. **Inicie sesión en un nuevo dispositivo.** Use su clave secreta (nsec) o clave de recuperación para iniciar sesión en otro dispositivo.
3. **Establezca un nuevo PIN** en el nuevo dispositivo.

Si tenía una clave de acceso (llave de seguridad de hardware o biometría) registrada, es posible que pueda iniciar sesión en un nuevo dispositivo usándola.

## Reinscripción

Si ha perdido tanto su PIN como su clave de recuperación, su operador puede iniciar una reinscripción:

1. El operador desactiva su cuenta actual
2. Crea un nuevo enlace de invitación para usted
3. Usted abre el enlace y crea un nuevo conjunto de credenciales
4. Establece un nuevo PIN en su dispositivo

**Importante:** La reinscripción crea nuevas claves de cifrado. Esto significa que no podrá leer notas o datos que fueron cifrados con sus claves anteriores. Su operador aún tiene acceso a esos datos a través de sus propias claves.

## Para operadores: ayudar a miembros del equipo

Cuando un miembro del equipo no puede acceder a su cuenta:

1. Vaya a **Usuarios** y busque su perfil
2. Desactive su acceso actual si su dispositivo puede estar comprometido
3. Cree un nuevo enlace de invitación con su rol original
4. Comparta el enlace a través de un canal seguro

Asegúrese de verificar la identidad de la persona antes de reinscribirla — alguien que se hace pasar por un miembro del equipo bloqueado es una táctica común de ingeniería social.

## Prevención

- Guarde su clave de recuperación en un gestor de contraseñas durante la configuración
- Registre una clave de acceso (llave de hardware o biometría) como método alternativo de inicio de sesión
- Si utiliza múltiples dispositivos, vincúlelos para tener una opción de respaldo
