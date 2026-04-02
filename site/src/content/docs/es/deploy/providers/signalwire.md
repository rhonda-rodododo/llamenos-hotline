---
title: "Configuracion: SignalWire"
description: Guia paso a paso para configurar SignalWire como su proveedor de telefonia.
---

SignalWire es una alternativa economica a Twilio con una API compatible. Utiliza LaML (un lenguaje de marcado compatible con TwiML), por lo que migrar entre Twilio y SignalWire es sencillo.

## Requisitos previos

- Una [cuenta de SignalWire](https://signalwire.com/signup) (prueba gratuita disponible)
- Su instancia de Llamenos desplegada y accesible mediante una URL publica

## 1. Crear una cuenta de SignalWire

Registrese en [signalwire.com/signup](https://signalwire.com/signup). Durante el registro, elegira un nombre de **Space** (por ejemplo, `mihotline`). La URL de su Space sera `mihotline.signalwire.com`. Anote este nombre: lo necesitara en la configuracion.

## 2. Comprar un numero telefonico

1. En el panel de SignalWire, vaya a **Phone Numbers**
2. Haga clic en **Buy a Phone Number**
3. Busque un numero con capacidad de voz
4. Compre el numero

## 3. Obtener sus credenciales

1. Vaya a **API** en el panel de SignalWire
2. Encuentre su **Project ID** (este funciona como el Account SID)
3. Cree un nuevo **API Token** si no tiene uno: este funciona como el Auth Token

## 4. Configurar webhooks

1. Vaya a **Phone Numbers** en el panel
2. Haga clic en el numero de su linea de ayuda
3. En **Voice Settings**, establezca:
   - **Handle calls using**: LaML Webhooks
   - **When a call comes in**: `https://su-dominio.com/api/telephony/incoming` (POST)
   - **Call status callback**: `https://su-dominio.com/api/telephony/status` (POST)

## 5. Configurar en Llamenos

1. Inicie sesion como administrador
2. Vaya a **Configuracion** > **Proveedor de telefonia**
3. Seleccione **SignalWire** en el menu desplegable de proveedores
4. Ingrese:
   - **Account SID**: su Project ID del paso 3
   - **Auth Token**: su API Token del paso 3
   - **SignalWire Space**: el nombre de su Space (solo el nombre, no la URL completa, por ejemplo, `mihotline`)
   - **Numero telefonico**: el numero que compro (formato E.164)
5. Haga clic en **Guardar**

## 6. Probar la configuracion

Llame a su numero de linea de ayuda. Deberia escuchar el menu de seleccion de idioma seguido del flujo de llamada.

## Configuracion de WebRTC (opcional)

SignalWire WebRTC utiliza el mismo patron de API Key que Twilio:

1. En el panel de SignalWire, cree una **API Key** en **API** > **Tokens**
2. Cree una **aplicacion LaML**:
   - Vaya a **LaML** > **LaML Applications**
   - Establezca la Voice URL como `https://su-dominio.com/api/telephony/webrtc-incoming`
   - Anote el Application SID
3. En Llamenos, vaya a **Configuracion** > **Proveedor de telefonia**
4. Active **Llamadas WebRTC**
5. Ingrese el API Key SID, API Key Secret y Application SID
6. Haga clic en **Guardar**

## Diferencias con Twilio

- **LaML vs TwiML**: SignalWire utiliza LaML, que es funcionalmente identico a TwiML. Llamenos maneja esto automaticamente.
- **URL del Space**: Las llamadas a la API van a `{space}.signalwire.com` en lugar de `api.twilio.com`. El adaptador maneja esto a traves del nombre de Space que usted proporciona.
- **Precios**: SignalWire es generalmente un 30-40% mas economico que Twilio para llamadas de voz.
- **Paridad de funciones**: Todas las funciones de Llamenos (grabacion, transcripcion, CAPTCHA, buzon de voz) funcionan de manera identica con SignalWire.

## Solucion de problemas

- **Errores de "Space not found"**: Verifique el nombre del Space (solo el subdominio, no la URL completa).
- **Fallos en los webhooks**: Asegurese de que la URL de su servidor sea accesible publicamente y use HTTPS.
- **Problemas con el API Token**: Los tokens de SignalWire pueden expirar. Cree un nuevo token si recibe errores de autenticacion.
