---
title: "Configuracion: Twilio"
description: Guia paso a paso para configurar Twilio como su proveedor de telefonia.
---

Twilio es el proveedor de telefonia predeterminado de Llamenos y el mas facil para comenzar. Esta guia le muestra como crear una cuenta, configurar un numero telefonico y establecer los webhooks.

## Requisitos previos

- Una [cuenta de Twilio](https://www.twilio.com/try-twilio) (la prueba gratuita funciona para realizar pruebas)
- Su instancia de Llamenos desplegada y accesible mediante una URL publica

## 1. Crear una cuenta de Twilio

Registrese en [twilio.com/try-twilio](https://www.twilio.com/try-twilio). Verifique su correo electronico y numero de telefono. Twilio ofrece credito de prueba para realizar pruebas.

## 2. Comprar un numero telefonico

1. Vaya a **Phone Numbers** > **Manage** > **Buy a number** en la consola de Twilio
2. Busque un numero con capacidad de **Voice** en el codigo de area deseado
3. Haga clic en **Buy** y confirme

Guarde este numero: lo ingresara en la configuracion de administrador de Llamenos.

## 3. Obtener su Account SID y Auth Token

1. Vaya al [panel principal de la consola de Twilio](https://console.twilio.com)
2. Encuentre su **Account SID** y **Auth Token** en la pagina principal
3. Haga clic en el icono del ojo para revelar el Auth Token

## 4. Configurar webhooks

En la consola de Twilio, navegue a la configuracion de su numero telefonico:

1. Vaya a **Phone Numbers** > **Manage** > **Active Numbers**
2. Haga clic en el numero de su linea de ayuda
3. En **Voice Configuration**, establezca:
   - **A call comes in**: Webhook, `https://su-dominio.com/api/telephony/incoming`, HTTP POST
   - **Call status changes**: `https://su-dominio.com/api/telephony/status`, HTTP POST

Reemplace `su-dominio.com` con la URL real de su despliegue de Llamenos.

## 5. Configurar en Llamenos

1. Inicie sesion como administrador
2. Vaya a **Configuracion** > **Proveedor de telefonia**
3. Seleccione **Twilio** en el menu desplegable de proveedores
4. Ingrese:
   - **Account SID**: del paso 3
   - **Auth Token**: del paso 3
   - **Numero telefonico**: el numero que compro (formato E.164, por ejemplo, `+15551234567`)
5. Haga clic en **Guardar**

## 6. Probar la configuracion

Llame a su numero de linea de ayuda desde un telefono. Deberia escuchar el menu de seleccion de idioma. Si hay voluntarios en turno, la llamada se conectara con ellos.

## Configuracion de WebRTC (opcional)

Para permitir que los voluntarios respondan llamadas desde su navegador en lugar de su telefono:

### Crear una API Key

1. Vaya a **Account** > **API keys & tokens** en la consola de Twilio
2. Haga clic en **Create API Key**
3. Elija el tipo de clave **Standard**
4. Guarde el **SID** y el **Secret**: el secreto solo se muestra una vez

### Crear una aplicacion TwiML

1. Vaya a **Voice** > **Manage** > **TwiML Apps**
2. Haga clic en **Create new TwiML App**
3. Establezca la **Voice Request URL** como `https://su-dominio.com/api/telephony/webrtc-incoming`
4. Guarde y anote el **App SID**

### Habilitar en Llamenos

1. Vaya a **Configuracion** > **Proveedor de telefonia**
2. Active **Llamadas WebRTC**
3. Ingrese:
   - **API Key SID**: de la API Key que creo
   - **API Key Secret**: de la API Key que creo
   - **TwiML App SID**: de la aplicacion TwiML que creo
4. Haga clic en **Guardar**

Consulte [Llamadas WebRTC desde el navegador](/docs/deploy/providers/webrtc) para la configuracion de voluntarios y solucion de problemas.

## Solucion de problemas

- **Las llamadas no llegan**: Verifique que la URL del webhook sea correcta y que su servidor este desplegado. Revise los registros de errores en la consola de Twilio.
- **Errores de "Invalid webhook"**: Asegurese de que la URL del webhook use HTTPS y devuelva TwiML valido.
- **Limitaciones de la cuenta de prueba**: Las cuentas de prueba solo pueden llamar a numeros verificados. Actualice a una cuenta de pago para uso en produccion.
- **Fallos en la validacion de webhook**: Asegurese de que el Auth Token en Llamenos coincida con el de la consola de Twilio.
