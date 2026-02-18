---
title: Modelo de seguridad y privacidad
subtitle: Una evaluacion honesta de lo que Llamenos cifra de extremo a extremo, lo que el servidor puede ver y lo que estamos trabajando para mejorar. Cubre llamadas de voz, canales de mensajeria, notas, reportes y transcripciones.
---

## Que esta cifrado de extremo a extremo

<details>
<summary><strong>Notas de llamadas (con secreto hacia adelante)</strong></summary>

Cada nota se cifra con una clave aleatoria unica de 32 bytes usando XChaCha20-Poly1305. Esa clave por nota se envuelve via ECIES (ECDH efimero sobre secp256k1) para cada lector autorizado — un sobre para el voluntario, otro para el administrador. Ambos pueden descifrar de forma independiente usando sus claves privadas. Dado que cada nota usa una clave aleatoria nueva, comprometer la clave de identidad no revela retroactivamente las notas pasadas.

</details>

<details>
<summary><strong>Transcripciones de llamadas</strong></summary>

Despues de la transcripcion, el texto resultante se cifra usando el mismo esquema ECIES antes de almacenarse. Lo que se guarda es solo texto cifrado. Tanto el voluntario como el administrador reciben copias cifradas de forma independiente.

</details>

<details>
<summary><strong>Valores de campos personalizados</strong></summary>

Los campos personalizados definidos por el administrador (texto, numero, seleccion, casilla de verificacion, area de texto) se cifran junto con el contenido de la nota usando el mismo cifrado ECIES. Las definiciones de los campos (nombres, tipos, opciones) se almacenan en texto plano para la interfaz del formulario, pero todos los valores ingresados por el usuario se cifran antes de salir del navegador.

</details>

<details>
<summary><strong>Borradores de notas</strong></summary>

Las notas en progreso se guardan automaticamente como borradores cifrados en el localStorage del navegador. Se cifran con la clave publica del voluntario antes de almacenarse. Los borradores se eliminan del localStorage al cerrar sesion.

</details>

<details>
<summary><strong>Reportes cifrados</strong></summary>

Los reportes enviados por el rol de reportero se cifran usando el mismo esquema ECIES. El cuerpo del reporte se cifra en el navegador antes de subirlo — el servidor almacena solo texto cifrado. Los titulos de los reportes se almacenan en texto plano para permitir la clasificacion y el seguimiento de estado. Los archivos adjuntos se cifran por separado antes de subirlos. Tanto el reportero como el administrador reciben copias cifradas de forma independiente.

</details>

## Lo que el servidor nunca ve

- Contenido de las notas (texto libre y valores de campos personalizados)
- Texto de transcripciones despues del cifrado
- Contenido del cuerpo de reportes y archivos adjuntos
- Claves secretas de voluntarios y reporteros (nsec) — nunca se almacenan en texto plano; cifradas con PIN en reposo, solo en memoria cuando estan desbloqueadas
- Claves de cifrado por nota — cada nota usa una clave aleatoria nueva; la clave de identidad sola no puede descifrar notas almacenadas
- Contenido de borradores de notas (almacenados localmente en el navegador)

## Canales de mensajeria

<details>
<summary><strong>Contenido de mensajes SMS, WhatsApp y Signal</strong></summary>

Los mensajes de texto enviados via SMS, WhatsApp o Signal son procesados por el proveedor de mensajeria respectivo (tu proveedor de telefonia para SMS, Meta para WhatsApp, o el bridge signal-cli para Signal). El contenido de los mensajes pasa a traves de estos intermediarios. Llamenos almacena los mensajes de conversacion en el servidor para la vista de conversaciones con hilos. A diferencia de las notas y reportes, el contenido de mensajeria no esta cifrado de extremo a extremo entre el navegador y el servidor — llega a traves de webhooks del proveedor y se almacena tal como se recibe.

</details>

## Limitaciones honestas

<details>
<summary><strong>Las llamadas de voz pasan por la PSTN y tu proveedor de telefonia</strong></summary>

Cuando se usa un proveedor en la nube (Twilio, SignalWire, Vonage o Plivo), Llamenos enruta las llamadas a traves de la red telefonica publica conmutada (PSTN) via la infraestructura de ese proveedor. Esto significa que el proveedor procesa el audio de las llamadas en tiempo real y puede tecnicamente acceder a el durante el transito. Esta es una limitacion inherente de la telefonia en la nube basada en PSTN. Para maxima privacidad, Llamenos tambien soporta Asterisk autoalojado con troncales SIP, lo que elimina al proveedor tercero por completo.

</details>

<details>
<summary><strong>La transcripcion requiere acceso al audio en el servidor</strong></summary>

Las grabaciones de llamadas se transcriben en el servidor usando Cloudflare Workers AI (Whisper). Durante la transcripcion, el servidor tiene acceso transitorio al audio. Despues de completar la transcripcion, el texto se cifra inmediatamente y la referencia al audio se descarta. La ventana de acceso al texto plano se minimiza pero existe.

</details>

<details>
<summary><strong>Los metadatos de llamadas son visibles para el servidor</strong></summary>

Marcas de tiempo, duraciones de llamadas, decisiones de enrutamiento, posiciones en la cola y que voluntario respondio — todo esto son metadatos operacionales que el servidor necesita para funcionar. Los numeros de telefono se almacenan para la verificacion de listas de bloqueo, pero no se incluyen en las transmisiones WebSocket a los voluntarios. La identidad del llamante se redacta de las actualizaciones en tiempo real.

</details>

## Proteccion local de claves

<details>
<summary><strong>Almacen de claves cifrado con PIN</strong></summary>

Tu clave secreta (nsec) se cifra en el localStorage del navegador usando PBKDF2-SHA256 (600,000 iteraciones) para derivar una clave de cifrado, luego XChaCha20-Poly1305 para cifrar el nsec. La clave sin cifrar nunca se almacena en sessionStorage, cookies ni ninguna ubicacion accesible del navegador. Cuando ingresas tu PIN, la clave se descifra en una variable de clausura de JavaScript — solo existe en memoria y se limpia al bloquear o cerrar sesion.

</details>

<details>
<summary><strong>Protocolo de vinculacion de dispositivos</strong></summary>

Agregar un nuevo dispositivo usa un intercambio de claves ECDH efimero. El nuevo dispositivo genera un par de claves secp256k1 temporal y muestra un codigo QR. El dispositivo principal lo escanea, calcula un secreto compartido via ECDH, cifra el nsec con XChaCha20-Poly1305 y lo envia a traves de una sala de retransmision de un solo uso. El nuevo dispositivo descifra, solicita un nuevo PIN y almacena la clave localmente. La sala de retransmision expira despues de 5 minutos y se elimina despues de un uso.

</details>

<details>
<summary><strong>Claves de recuperacion</strong></summary>

Durante la incorporacion, se genera una clave de recuperacion de 128 bits y se muestra en formato Base32. Esta clave cifra una copia de respaldo del nsec (PBKDF2 + XChaCha20-Poly1305). El nsec sin cifrar nunca se muestra a los usuarios — solo reciben la clave de recuperacion. Es obligatorio descargar un archivo de respaldo cifrado antes de continuar.

</details>

## Modelo de amenazas

Llamenos esta disenado para proteger a los voluntarios y llamantes de lineas de crisis contra:

1. **Filtracion de base de datos** — Un atacante que obtenga la base de datos solo obtiene texto cifrado de notas y transcripciones. Sin las claves privadas del voluntario o administrador, el contenido es ilegible.
2. **Servidor comprometido** — Un servidor comprometido puede ver metadatos de llamadas y tiene acceso transitorio al audio durante la transcripcion, pero no puede leer notas ni transcripciones almacenadas.
3. **Vigilancia de red** — Todas las conexiones usan TLS. Las conexiones WebSocket estan autenticadas. El servidor aplica HSTS y encabezados CSP estrictos.
4. **Suplantacion de voluntario** — La autenticacion usa firmas BIP-340 Schnorr. Sin la clave privada del voluntario, el inicio de sesion es imposible. Los passkeys de WebAuthn agregan un segundo factor respaldado por hardware.
5. **Amenaza interna (voluntario)** — Los voluntarios solo pueden descifrar sus propias notas. No pueden ver las notas de otros voluntarios, informacion personal ni datos exclusivos del administrador.
6. **XSS / extension del navegador** — La clave secreta nunca esta en sessionStorage ni en el ambito global. Solo existe en una variable de clausura, que se limpia al bloquear. Un ataque XSS durante una sesion desbloqueada podria firmar solicitudes, pero no puede extraer la clave para uso fuera de linea.
7. **Confiscacion de dispositivo** — Un dispositivo confiscado solo contiene el blob de clave cifrado con PIN. Sin el PIN (y la derivacion PBKDF2 de 600,000 iteraciones), la clave es irrecuperable. El secreto hacia adelante por nota significa que incluso recuperar la clave de identidad no revela notas pasadas.

Ningun sistema es perfectamente seguro. El objetivo es minimizar la superficie de confianza y ser transparentes sobre lo que queda.

## En lo que estamos trabajando

<details>
<summary><strong>Llamadas en el navegador con WebRTC</strong></summary>

Migrar las llamadas de voz de PSTN/proveedores en la nube a WebRTC permite audio directo de navegador a navegador, eliminando al proveedor de telefonia de la ruta de voz por completo. Llamenos ya soporta llamadas WebRTC para voluntarios — combinado con una instalacion de Asterisk autoalojado, toda la ruta de voz puede evitar la infraestructura de terceros.

</details>

<details>
<summary><strong>Transcripcion en el cliente</strong></summary>

Ejecutar Whisper (o un modelo similar) directamente en el navegador via WebAssembly o WebGPU eliminaria por completo el acceso al audio en el servidor. La transcripcion se generaria localmente y se cifraria antes de subirla.

</details>

<details>
<summary><strong>Builds reproducibles</strong></summary>

Compilaciones deterministas que permitan a cualquier persona verificar que el codigo desplegado coincide con el repositorio de codigo abierto, asegurando que no se hayan introducido modificaciones del lado del servidor.

</details>

## Verificalo tu mismo

Llamenos es completamente de codigo abierto. Cada operacion de cifrado, cada endpoint de API, cada verificacion del lado del cliente — todo esta en el repositorio. Lee el codigo, audita la criptografia, reporta problemas. [github.com/rhonda-rodododo/llamenos](https://github.com/rhonda-rodododo/llamenos)
