---
title: Autoalojamiento
description: Despliega Llamenos en tu propia infraestructura con Docker Compose o Kubernetes.
---

Llamenos esta disenado para ejecutarse en tu propia infraestructura. El autoalojamiento te da control total sobre la residencia de datos, el aislamiento de red y las decisiones de infraestructura — critico para organizaciones que protegen contra adversarios con buenos recursos.

## Opciones de despliegue

| Opcion | Ideal para | Complejidad | Escalabilidad |
|--------|-----------|-------------|---------------|
| [Docker Compose](/docs/deploy-docker) | Servidor unico, inicio recomendado | Baja | Nodo unico |
| [Kubernetes (Helm)](/docs/deploy-kubernetes) | Orquestacion multi-servicio | Media | Horizontal (multi-replica) |
| [Co-op Cloud](/docs/deploy-coopcloud) | Colectivos de hospedaje cooperativo | Baja | Nodo unico (Swarm) |

## Archivos de Docker Compose

Docker Compose usa un enfoque por capas:

| Archivo | Proposito |
|---------|-----------|
| `docker-compose.yml` | Configuracion base — todos los servicios, redes, volumenes |
| `docker-compose.production.yml` | Capa de produccion — TLS via Let's Encrypt, rotacion de logs, limites de recursos, CSP estricto |
| `docker-compose.test.yml` | Capa de pruebas — expone puerto de la app directamente, modo desarrollo |

Para **desarrollo local**, usa solo el archivo base. Para **produccion**, agrega la capa de produccion:

```bash
# Local
docker compose -f docker-compose.yml up -d

# Produccion
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
```

O usa el script de configuracion, que maneja esto automaticamente:

```bash
./scripts/docker-setup.sh                                     # local
./scripts/docker-setup.sh --domain linea.tuorg.com --email a@b    # produccion
```

## Arquitectura

Todas las opciones de despliegue ejecutan **exactamente el mismo codigo de aplicacion**. La diferencia esta en la capa de infraestructura:

| Componente | Tecnologia |
|------------|------------|
| **Runtime del backend** | Bun + Hono |
| **Almacenamiento de datos** | PostgreSQL |
| **Almacenamiento de archivos** | RustFS (compatible con S3) |
| **Transcripcion** | Whisper del lado del cliente (WASM) — el audio nunca sale del navegador |
| **Archivos estaticos** | Caddy / Hono serveStatic |
| **Eventos en tiempo real** | Relay Nostr (strfry) |
| **Terminacion TLS** | Caddy (HTTPS automatico) |

## Que necesitas

### Requisitos minimos

- Un servidor Linux (2 nucleos CPU, 2 GB RAM minimo)
- Docker y Docker Compose v2 (o un cluster Kubernetes para Helm)
- Un nombre de dominio apuntando a tu servidor
- `openssl` (para generar secretos durante la configuracion)
- Al menos un canal de comunicacion (proveedor de voz, SMS, etc.)

### Componentes opcionales

- **Transcripcion Whisper** — requiere 4 GB+ de RAM (CPU) o una GPU para procesamiento mas rapido
- **Asterisk** — para telefonia SIP autoalojada (ver [configuracion de Asterisk](/docs/setup-asterisk))
- **Bridge Signal** — para mensajeria Signal (ver [configuracion de Signal](/docs/setup-signal))

## Comparacion rapida

**Elige Docker Compose si:**
- Ejecutas en un solo servidor o VPS
- Quieres la configuracion autoalojada mas simple posible
- Te sientes comodo con los basicos de Docker

**Elige Kubernetes (Helm) si:**
- Ya tienes un cluster K8s
- Necesitas escalado horizontal (multiples replicas)
- Quieres integrarte con herramientas K8s existentes (cert-manager, external-secrets, etc.)

**Elige Co-op Cloud si:**
- Eres parte de una cooperativa tecnologica o colectivo de hospedaje
- Ya usas Docker Swarm + Traefik via abra
- Quieres gestion estandarizada de recetas con el CLI `abra`
- Necesitas respaldos integrados via backupbot

## Consideraciones de seguridad

El autoalojamiento te da mas control pero tambien mas responsabilidad:

- **Datos en reposo**: Los datos de PostgreSQL se almacenan sin cifrar por defecto. Usa cifrado de disco completo (LUKS, dm-crypt) en tu servidor, o habilita PostgreSQL TDE si esta disponible. Ten en cuenta que las notas de llamadas y transcripciones ya son E2EE — el servidor nunca ve texto plano.
- **Seguridad de red**: Usa un firewall para restringir acceso. Solo los puertos 80/443 deben ser accesibles publicamente.
- **Secretos**: Nunca pongas secretos en archivos Docker Compose o control de versiones. Usa archivos `.env` (excluidos de imagenes) o secretos de Docker/Kubernetes.
- **Actualizaciones**: Descarga nuevas imagenes regularmente. Consulta el [changelog](https://github.com/rhonda-rodododo/llamenos/blob/main/CHANGELOG.md) para correcciones de seguridad.
- **Respaldos**: Respalda la base de datos PostgreSQL y el almacenamiento RustFS regularmente. Consulta la seccion de respaldos en cada guia de despliegue.

## Siguientes pasos

- [Primeros Pasos](/docs/getting-started) — inicio rapido con Docker
- [Despliegue con Docker Compose](/docs/deploy-docker) — guia completa de despliegue en produccion
- [Despliegue en Kubernetes](/docs/deploy-kubernetes) — despliega con Helm
- [Despliegue en Co-op Cloud](/docs/deploy-coopcloud) — despliega con abra
