---
title: "Configuracion: Vonage"
description: Guia paso a paso para configurar Vonage como su proveedor de telefonia.
---

Vonage (anteriormente Nexmo) ofrece una solida cobertura internacional y precios competitivos. Utiliza un modelo de API diferente al de Twilio: las Aplicaciones de Vonage agrupan su numero, webhooks y credenciales en un solo lugar.

## Requisitos previos

- Una [cuenta de Vonage](https://dashboard.nexmo.com/sign-up) (credito gratuito disponible)
- Su instancia de Llamenos desplegada y accesible mediante una URL publica

## 1. Crear una cuenta de Vonage

Registrese en el [panel de API de Vonage](https://dashboard.nexmo.com/sign-up). Verifique su cuenta y anote su **API Key** y **API Secret** que aparecen en la pagina principal del panel.

## 2. Comprar un numero telefonico

1. Vaya a **Numbers** > **Buy numbers** en el panel de Vonage
2. Seleccione su pais y elija un numero con capacidad de **Voice**
3. Compre el numero

## 3. Crear una aplicacion de Vonage

Vonage agrupa la configuracion en "Aplicaciones":

1. Vaya a **Applications** > **Create a new application**
2. Ingrese un nombre (por ejemplo, "Llamenos Hotline")
3. En **Voice**, activelo y establezca:
   - **Answer URL**: `https://su-dominio.com/api/telephony/incoming` (POST)
   - **Event URL**: `https://su-dominio.com/api/telephony/status` (POST)
4. Haga clic en **Generate new application**
5. Guarde el **Application ID** que aparece en la pagina de confirmacion
6. Descargue el archivo de **clave privada**: necesitara su contenido para la configuracion

## 4. Vincular el numero telefonico

1. Vaya a **Numbers** > **Your numbers**
2. Haga clic en el icono de engranaje junto al numero de su linea de ayuda
3. En **Voice**, seleccione la aplicacion que creo en el paso 3
4. Haga clic en **Save**

## 5. Configurar en Llamenos

1. Inicie sesion como administrador
2. Vaya a **Configuracion** > **Proveedor de telefonia**
3. Seleccione **Vonage** en el menu desplegable de proveedores
4. Ingrese:
   - **API Key**: de la pagina principal del panel de Vonage
   - **API Secret**: de la pagina principal del panel de Vonage
   - **Application ID**: del paso 3
   - **Numero telefonico**: el numero que compro (formato E.164)
5. Haga clic en **Guardar**

## 6. Probar la configuracion

Llame a su numero de linea de ayuda. Deberia escuchar el menu de seleccion de idioma. Verifique que las llamadas se enruten a los voluntarios en turno.

## Configuracion de WebRTC (opcional)

Vonage WebRTC utiliza las credenciales de la aplicacion que ya creo:

1. En Llamenos, vaya a **Configuracion** > **Proveedor de telefonia**
2. Active **Llamadas WebRTC**
3. Ingrese el contenido de la **clave privada** (el texto PEM completo del archivo que descargo)
4. Haga clic en **Guardar**

El Application ID ya esta configurado. Vonage genera JWT con RS256 utilizando la clave privada para la autenticacion del navegador.

## Notas especificas de Vonage

- **NCCO vs TwiML**: Vonage utiliza NCCO (Nexmo Call Control Objects) en formato JSON en lugar de marcado XML. El adaptador de Llamenos genera el formato correcto automaticamente.
- **Formato de Answer URL**: Vonage espera que la Answer URL devuelva JSON (NCCO), no XML. Esto es manejado por el adaptador.
- **Event URL**: Vonage envia eventos de llamada (timbrando, contestada, completada) a la Event URL como solicitudes JSON POST.
- **Seguridad de la clave privada**: La clave privada se almacena cifrada. Nunca sale del servidor: solo se utiliza para generar tokens JWT de corta duracion.

## Solucion de problemas

- **"Application not found"**: Verifique que el Application ID coincida exactamente. Puede encontrarlo en **Applications** en el panel de Vonage.
- **No llegan llamadas entrantes**: Asegurese de que el numero telefonico este vinculado a la aplicacion correcta (paso 4).
- **Errores de clave privada**: Pegue el contenido PEM completo incluyendo las lineas `-----BEGIN PRIVATE KEY-----` y `-----END PRIVATE KEY-----`.
- **Formato de numeros internacionales**: Vonage requiere formato E.164. Incluya el `+` y el codigo de pais.
