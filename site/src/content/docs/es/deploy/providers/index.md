---
title: Proveedores de telefonia
description: Compare los proveedores de telefonia compatibles y elija el mas adecuado para su linea de ayuda.
---

Llamenos admite varios proveedores de telefonia a traves de su interfaz **TelephonyAdapter**. Puede cambiar de proveedor en cualquier momento desde la configuracion de administrador sin modificar el codigo de la aplicacion.

## Proveedores compatibles

| Proveedor | Tipo | Modelo de precios | Soporte WebRTC | Dificultad de configuracion | Ideal para |
|---|---|---|---|---|---|
| **Twilio** | Nube | Por minuto | Si | Facil | Comenzar rapidamente |
| **SignalWire** | Nube | Por minuto (mas economico) | Si | Facil | Organizaciones con presupuesto limitado |
| **Vonage** | Nube | Por minuto | Si | Media | Cobertura internacional |
| **Plivo** | Nube | Por minuto | Si | Media | Opcion economica en la nube |
| **Asterisk** | Autoalojado | Solo costo del troncal SIP | Si (SIP.js) | Dificil | Maxima privacidad, despliegue a escala |

## Comparacion de precios

Costos aproximados por minuto para llamadas de voz en EE.UU. (los precios varian segun la region y el volumen):

| Proveedor | Entrante | Saliente | Numero telefonico | Nivel gratuito |
|---|---|---|---|---|
| Twilio | $0.0085 | $0.014 | $1.15/mes | Credito de prueba |
| SignalWire | $0.005 | $0.009 | $1.00/mes | Credito de prueba |
| Vonage | $0.0049 | $0.0139 | $1.00/mes | Credito gratuito |
| Plivo | $0.0055 | $0.010 | $0.80/mes | Credito de prueba |
| Asterisk | Tarifa del troncal SIP | Tarifa del troncal SIP | Del proveedor SIP | N/A |

Todos los proveedores en la nube facturan por minuto con granularidad por segundo. Los costos de Asterisk dependen de su proveedor de troncal SIP y del alojamiento del servidor.

## Matriz de funcionalidades

| Funcionalidad | Twilio | SignalWire | Vonage | Plivo | Asterisk |
|---|---|---|---|---|---|
| Grabacion de llamadas | Si | Si | Si | Si | Si |
| Transcripcion en vivo | Si | Si | Si | Si | Si (via bridge) |
| CAPTCHA de voz | Si | Si | Si | Si | Si |
| Buzon de voz | Si | Si | Si | Si | Si |
| Llamadas WebRTC desde el navegador | Si | Si | Si | Si | Si (SIP.js) |
| Validacion de webhook | Si | Si | Si | Si | Personalizada (HMAC) |
| Timbre simultaneo | Si | Si | Si | Si | Si |
| Cola / musica en espera | Si | Si | Si | Si | Si |

## Como configurar

1. Navegue a **Configuracion** en la barra lateral de administrador
2. Abra la seccion **Proveedor de telefonia**
3. Seleccione su proveedor en el menu desplegable
4. Ingrese las credenciales requeridas (cada proveedor tiene campos diferentes)
5. Establezca el numero telefonico de su linea de ayuda en formato E.164 (por ejemplo, `+15551234567`)
6. Haga clic en **Guardar**
7. Configure los webhooks en la consola de su proveedor para que apunten a su instancia de Llamenos

Consulte las guias de configuracion individuales para instrucciones paso a paso:

- [Configuracion: Twilio](/docs/deploy/providers/twilio)
- [Configuracion: SignalWire](/docs/deploy/providers/signalwire)
- [Configuracion: Vonage](/docs/deploy/providers/vonage)
- [Configuracion: Plivo](/docs/deploy/providers/plivo)
- [Configuracion: Asterisk (Autoalojado)](/docs/deploy/providers/asterisk)
- [Llamadas WebRTC desde el navegador](/docs/deploy/providers/webrtc)
