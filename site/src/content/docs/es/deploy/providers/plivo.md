---
title: "Configuracion: Plivo"
description: Guia paso a paso para configurar Plivo como su proveedor de telefonia.
---

Plivo es un proveedor de telefonia en la nube economico con una API sencilla. Utiliza control de llamadas basado en XML similar a TwiML, lo que hace que la integracion con Llamenos sea fluida.

## Requisitos previos

- Una [cuenta de Plivo](https://console.plivo.com/accounts/register/) (credito de prueba disponible)
- Su instancia de Llamenos desplegada y accesible mediante una URL publica

## 1. Crear una cuenta de Plivo

Registrese en [console.plivo.com](https://console.plivo.com/accounts/register/). Despues de la verificacion, puede encontrar su **Auth ID** y **Auth Token** en la pagina principal del panel.

## 2. Comprar un numero telefonico

1. Vaya a **Phone Numbers** > **Buy Numbers** en la consola de Plivo
2. Seleccione su pais y busque numeros con capacidad de voz
3. Compre un numero

## 3. Crear una aplicacion XML

Plivo utiliza "Aplicaciones XML" para enrutar llamadas:

1. Vaya a **Voice** > **XML Applications**
2. Haga clic en **Add New Application**
3. Configure:
   - **Application Name**: Llamenos Hotline
   - **Answer URL**: `https://su-dominio.com/api/telephony/incoming` (POST)
   - **Hangup URL**: `https://su-dominio.com/api/telephony/status` (POST)
4. Guarde la aplicacion

## 4. Vincular el numero telefonico

1. Vaya a **Phone Numbers** > **Your Numbers**
2. Haga clic en el numero de su linea de ayuda
3. En **Voice**, seleccione la aplicacion XML que creo en el paso 3
4. Guarde

## 5. Configurar en Llamenos

1. Inicie sesion como administrador
2. Vaya a **Configuracion** > **Proveedor de telefonia**
3. Seleccione **Plivo** en el menu desplegable de proveedores
4. Ingrese:
   - **Auth ID**: de la consola de Plivo
   - **Auth Token**: de la consola de Plivo
   - **Numero telefonico**: el numero que compro (formato E.164)
5. Haga clic en **Guardar**

## 6. Probar la configuracion

Llame a su numero de linea de ayuda. Deberia escuchar el menu de seleccion de idioma y ser enrutado a traves del flujo de llamada normal.

## Configuracion de WebRTC (opcional)

Plivo WebRTC utiliza el Browser SDK con sus credenciales existentes:

1. Vaya a **Voice** > **Endpoints** en la consola de Plivo
2. Cree un nuevo endpoint (este actua como la identidad del telefono en el navegador)
3. En Llamenos, vaya a **Configuracion** > **Proveedor de telefonia**
4. Active **Llamadas WebRTC**
5. Haga clic en **Guardar**

El adaptador genera tokens HMAC de duracion limitada a partir de su Auth ID y Auth Token para una autenticacion segura del navegador.

## Notas especificas de Plivo

- **XML vs TwiML**: Plivo utiliza su propio formato XML para el control de llamadas, que es similar pero no identico a TwiML. El adaptador de Llamenos genera el XML de Plivo correcto automaticamente.
- **Answer URL vs Hangup URL**: Plivo separa el controlador de llamada inicial (Answer URL) del controlador de fin de llamada (Hangup URL), a diferencia de Twilio que utiliza un unico callback de estado.
- **Limites de tasa**: Plivo tiene limites de tasa en la API que varian segun el nivel de cuenta. Para lineas de ayuda con alto volumen, contacte al soporte de Plivo para aumentar los limites.

## Solucion de problemas

- **"Auth ID invalid"**: El Auth ID no es su direccion de correo electronico. Encuentrelo en la pagina principal de la consola de Plivo.
- **Las llamadas no se enrutan**: Verifique que el numero telefonico este vinculado a la aplicacion XML correcta.
- **Errores en la Answer URL**: Plivo espera respuestas XML validas. Revise los registros de su servidor para ver los errores de respuesta.
- **Restricciones de llamadas salientes**: Las cuentas de prueba tienen limitaciones en las llamadas salientes. Actualice para uso en produccion.
