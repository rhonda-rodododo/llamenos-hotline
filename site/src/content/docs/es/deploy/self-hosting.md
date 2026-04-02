---
title: Descripcion General del Autoalojamiento
description: Despliega Llamenos en tu propia infraestructura con Docker Compose o Kubernetes.
---

Llamenos esta disenado para ejecutarse en tu propia infraestructura. El autoalojamiento te da control total sobre la residencia de datos, el aislamiento de red y las decisiones de infraestructura — algo critico para organizaciones que se protegen contra adversarios con amplios recursos.

## Opciones de despliegue

| Opcion | Ideal para | Complejidad | Escalado |
|--------|------------|-------------|----------|
| [Docker Compose](/es/docs/deploy/docker) | Servidor unico, inicio recomendado | Baja | Nodo unico |
| [Kubernetes (Helm)](/es/docs/deploy/kubernetes) | Orquestacion multiservicio | Media | Horizontal (multireplica) |
| [Co-op Cloud](/es/docs/deploy/coopcloud) | Colectivos de alojamiento cooperativo | Baja | Nodo unico (Swarm) |

## Archivos de Docker Compose

Docker Compose usa un enfoque por capas:

| Archivo | Proposito |
|---------|-----------|
| `docker-compose.yml` | Configuracion base — todos los servicios, redes, volumenes |
| `docker-compose.production.yml` | Capa de produccion — TLS via Let's Encrypt, rotacion de logs, limites de recursos, CSP estricto |
| `docker-compose.test.yml` | Capa de pruebas — expone el puerto de la aplicacion directamente, modo desarrollo |

Para **desarrollo local**, usa solo el archivo base. Para **produccion**, apila la capa de produccion:

```bash
# Local
docker compose -f docker-compose.yml up -d

# Produccion
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
```

O usa el script de configuracion, que maneja esto automaticamente:

```bash
./scripts/docker-setup.sh                                     # local
./scripts/docker-setup.sh --domain hotline.org --email a@b    # produccion
```

## Servicios principales

Todos los objetivos de despliegue ejecutan estos servicios principales:

| Componente | Proposito |
|------------|-----------|
| **Aplicacion Bun** | Servidor API Hono + servicio de archivos estaticos |
| **PostgreSQL** | Base de datos principal |
| **RustFS** | Almacenamiento de objetos compatible con S3 (correo de voz, adjuntos, exportaciones) |
| **strfry** | Relay Nostr para eventos en tiempo real |
| **Caddy** | Proxy inverso + TLS automatico (Docker Compose) |
| **Authentik** | Proveedor de identidad — SSO, incorporacion por invitacion, MFA |

## Lo que necesitas

### Requisitos minimos

- Un servidor Linux (2 nucleos de CPU, 2 GB de RAM minimo)
- Docker y Docker Compose v2 (o un cluster de Kubernetes para Helm)
- Un nombre de dominio apuntando a tu servidor
- `openssl` (para generar secretos durante la configuracion)
- Al menos un canal de comunicacion (proveedor de voz, SMS, etc.)

### Componentes opcionales

- **Transcripcion Whisper** — requiere 4 GB+ de RAM (CPU) o una GPU para procesamiento mas rapido
- **Asterisk** — para telefonia SIP autoalojada (consulta la [configuracion de Asterisk](/docs/deploy/providers/asterisk))
- **Puente Signal** — para mensajeria Signal (consulta la [configuracion de Signal](/docs/deploy/providers/signal))

## Comparacion rapida

**Elige Docker Compose si:**
- Ejecutas en un solo servidor o VPS
- Quieres la configuracion autoalojada mas sencilla posible
- Te sientes comodo con los conceptos basicos de Docker

**Elige Kubernetes (Helm) si:**
- Ya tienes un cluster de K8s
- Necesitas escalado horizontal (multiples replicas)
- Quieres integrarte con herramientas existentes de K8s (cert-manager, external-secrets, etc.)

**Elige Co-op Cloud si:**
- Eres parte de una cooperativa tecnologica o colectivo de alojamiento
- Ya usas Docker Swarm + Traefik via abra
- Quieres gestion estandarizada de recetas con el CLI `abra`
- Necesitas copias de seguridad integradas via backupbot

## Consideraciones de seguridad

El autoalojamiento te da mas control pero tambien mas responsabilidad:

- **Datos en reposo**: Los datos de PostgreSQL se almacenan sin cifrar por defecto. Usa cifrado de disco completo (LUKS, dm-crypt) en tu servidor, o habilita PostgreSQL TDE si esta disponible. Ten en cuenta que las notas de llamadas y transcripciones ya estan cifradas de extremo a extremo (E2EE) — el servidor nunca ve texto plano.
- **Seguridad de red**: Usa un firewall para restringir el acceso. Solo los puertos 80/443 deben ser accesibles publicamente.
- **Secretos**: Nunca pongas secretos en archivos de Docker Compose o control de versiones. Usa archivos `.env` (excluidos de las imagenes) o secretos de Docker/Kubernetes.
- **Actualizaciones**: Descarga imagenes nuevas regularmente. Consulta el [registro de cambios](https://github.com/rhonda-rodododo/llamenos/blob/main/CHANGELOG.md) para correcciones de seguridad.
- **Copias de seguridad**: Respalda la base de datos PostgreSQL y el almacenamiento RustFS regularmente. Consulta la seccion de copias de seguridad en cada guia de despliegue.

## Siguientes pasos

- [Primeros Pasos](/es/docs/deploy/) — inicio rapido con Docker
- [Despliegue con Docker Compose](/es/docs/deploy/docker) — guia completa de despliegue en produccion
- [Despliegue en Kubernetes](/es/docs/deploy/kubernetes) — despliegue con Helm
- [Despliegue con Co-op Cloud](/es/docs/deploy/coopcloud) — despliegue con abra
