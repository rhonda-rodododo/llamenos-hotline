---
title: "Desplegar: Kubernetes (Helm)"
description: Despliega Llamenos en Kubernetes usando el chart oficial de Helm.
---

Esta guia cubre el despliegue de Llamenos en un cluster de Kubernetes usando el chart oficial de Helm. El chart gestiona la aplicacion, el almacenamiento RustFS, el proveedor de identidad Authentik y los servicios opcionales de Whisper como despliegues separados. Tu proporcionas una base de datos PostgreSQL.

## Requisitos previos

- Un cluster de Kubernetes (v1.24+) — gestionado (EKS, GKE, AKS) o autoalojado
- Una instancia de PostgreSQL 14+ (se recomienda RDS/Cloud SQL gestionado, o autoalojado)
- [Helm](https://helm.sh/) v3.10+
- [kubectl](https://kubernetes.io/docs/tasks/tools/) configurado para tu cluster
- Un controlador de ingress (NGINX Ingress, Traefik, etc.)
- cert-manager (opcional, para certificados TLS automaticos)

## 1. Instalar el chart

```bash
helm install llamenos deploy/helm/llamenos/ \
  --set secrets.postgresPassword=YOUR_PG_PASSWORD \
  --set postgres.host=YOUR_PG_HOST \
  --set rustfs.credentials.accessKey=your-access-key \
  --set rustfs.credentials.secretKey=your-secret-key \
  --set ingress.hosts[0].host=hotline.yourdomain.com \
  --set ingress.tls[0].secretName=llamenos-tls \
  --set ingress.tls[0].hosts[0]=hotline.yourdomain.com
```

O crea un archivo `values-production.yaml` para despliegues reproducibles:

```yaml
# values-production.yaml
app:
  image:
    repository: ghcr.io/your-org/llamenos
    tag: "0.14.0"
  replicas: 2
  env:
    HOTLINE_NAME: "Your Hotline"

postgres:
  host: my-rds-instance.region.rds.amazonaws.com
  port: 5432
  database: llamenos
  user: llamenos
  poolSize: 10

secrets:
  postgresPassword: "your-strong-password"
  # twilioAccountSid: ""
  # twilioAuthToken: ""
  # twilioPhoneNumber: ""

rustfs:
  enabled: true
  persistence:
    size: 50Gi
    storageClass: "gp3"
  credentials:
    accessKey: "your-access-key"
    secretKey: "your-secret-key-change-me"

authentik:
  enabled: true
  env:
    AUTHENTIK_SECRET_KEY: "your-authentik-secret"
  postgresql:
    host: my-rds-instance.region.rds.amazonaws.com
    name: authentik
    user: authentik
    password: "your-authentik-pg-password"

whisper:
  enabled: true
  model: "Systran/faster-whisper-base"
  device: "cpu"
  resources:
    requests:
      memory: "2Gi"
      cpu: "1"
    limits:
      memory: "4Gi"
      cpu: "2"

ingress:
  enabled: true
  className: "nginx"
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
  hosts:
    - host: hotline.yourdomain.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: llamenos-tls
      hosts:
        - hotline.yourdomain.com
```

Luego instala:

```bash
helm install llamenos deploy/helm/llamenos/ -f values-production.yaml
```

## 2. Verificar el despliegue

```bash
# Comprobar que los pods estan en ejecucion
kubectl get pods -l app.kubernetes.io/instance=llamenos

# Comprobar la salud de la aplicacion
kubectl port-forward svc/llamenos 3000:3000
curl http://localhost:3000/api/health
# -> {"status":"ok"}
```

## 3. Configurar DNS

Apunta tu dominio a la IP externa o balanceador de carga del controlador de ingress:

```bash
kubectl get ingress llamenos
```

## 4. Primer inicio de sesion y configuracion

Abre `https://hotline.yourdomain.com` en tu navegador. Seras redirigido a Authentik para crear tu cuenta de administrador mediante un enlace de invitacion, y luego completaras el asistente de configuracion.

## Referencia de configuracion del chart

### Aplicacion

| Parametro | Descripcion | Valor por defecto |
|-----------|-------------|-------------------|
| `app.image.repository` | Imagen del contenedor | `ghcr.io/your-org/llamenos` |
| `app.image.tag` | Etiqueta de la imagen | appVersion del chart |
| `app.port` | Puerto de la aplicacion | `3000` |
| `app.replicas` | Replicas del pod | `2` |
| `app.resources` | Solicitudes y limites de CPU/memoria | `{}` |
| `app.env` | Variables de entorno adicionales | `{}` |

### PostgreSQL

| Parametro | Descripcion | Valor por defecto |
|-----------|-------------|-------------------|
| `postgres.host` | Nombre de host de PostgreSQL (requerido) | `""` |
| `postgres.port` | Puerto de PostgreSQL | `5432` |
| `postgres.database` | Nombre de la base de datos | `llamenos` |
| `postgres.user` | Usuario de la base de datos | `llamenos` |
| `postgres.poolSize` | Tamano del pool de conexiones | `10` |

### Secretos

| Parametro | Descripcion | Valor por defecto |
|-----------|-------------|-------------------|
| `secrets.postgresPassword` | Contrasena de PostgreSQL (requerido) | `""` |
| `secrets.twilioAccountSid` | SID de cuenta Twilio | `""` |
| `secrets.twilioAuthToken` | Token de autenticacion Twilio | `""` |
| `secrets.twilioPhoneNumber` | Numero de telefono Twilio (E.164) | `""` |
| `secrets.existingSecret` | Usar un Secret de K8s existente | `""` |

> **Consejo**: Para produccion, usa `secrets.existingSecret` para referenciar un Secret gestionado por External Secrets Operator, Sealed Secrets o Vault.

### RustFS

| Parametro | Descripcion | Valor por defecto |
|-----------|-------------|-------------------|
| `rustfs.enabled` | Desplegar RustFS | `true` |
| `rustfs.image.repository` | Imagen de RustFS | `ghcr.io/rustfs/rustfs` |
| `rustfs.image.tag` | Etiqueta de RustFS | `latest` |
| `rustfs.persistence.size` | Volumen de datos de RustFS | `50Gi` |
| `rustfs.persistence.storageClass` | Clase de almacenamiento | `""` |
| `rustfs.credentials.accessKey` | Usuario root de RustFS | `""` (requerido) |
| `rustfs.credentials.secretKey` | Contrasena root de RustFS | `""` (requerido) |
| `rustfs.resources` | Solicitudes y limites de CPU/memoria | `{}` |

### Authentik (Proveedor de Identidad)

| Parametro | Descripcion | Valor por defecto |
|-----------|-------------|-------------------|
| `authentik.enabled` | Desplegar Authentik | `true` |
| `authentik.env.AUTHENTIK_SECRET_KEY` | Clave secreta de Authentik | `""` (requerido) |
| `authentik.postgresql.host` | Host de PostgreSQL para Authentik | Mismo que el de la app |
| `authentik.postgresql.name` | Nombre de base de datos de Authentik | `authentik` |
| `authentik.postgresql.user` | Usuario de base de datos de Authentik | `authentik` |
| `authentik.postgresql.password` | Contrasena de base de datos de Authentik | `""` (requerido) |
| `authentik.resources` | Solicitudes y limites de CPU/memoria | `{}` |

### Transcripcion Whisper

| Parametro | Descripcion | Valor por defecto |
|-----------|-------------|-------------------|
| `whisper.enabled` | Desplegar Whisper | `false` |
| `whisper.image.repository` | Imagen de Whisper | `fedirz/faster-whisper-server` |
| `whisper.image.tag` | Etiqueta de Whisper | `0.4.1` |
| `whisper.model` | Nombre del modelo Whisper | `Systran/faster-whisper-base` |
| `whisper.device` | Dispositivo: `cpu` o `cuda` | `cpu` |
| `whisper.resources` | Solicitudes y limites de CPU/memoria | `{}` |

### Ingress

| Parametro | Descripcion | Valor por defecto |
|-----------|-------------|-------------------|
| `ingress.enabled` | Crear recurso Ingress | `true` |
| `ingress.className` | Clase de ingress | `nginx` |
| `ingress.annotations` | Anotaciones del ingress | `{}` |
| `ingress.hosts` | Reglas de host | Ver values.yaml |
| `ingress.tls` | Configuracion TLS | `[]` |

### Cuenta de servicio

| Parametro | Descripcion | Valor por defecto |
|-----------|-------------|-------------------|
| `serviceAccount.create` | Crear un ServiceAccount | `true` |
| `serviceAccount.annotations` | Anotaciones del SA (por ejemplo, IRSA) | `{}` |
| `serviceAccount.name` | Sobreescribir nombre del SA | `""` |

## Usar secretos externos

Para produccion, evita poner secretos directamente en los valores de Helm. En su lugar, crea el Secret por separado y referencialo:

```yaml
# values-production.yaml
secrets:
  existingSecret: llamenos-secrets
```

Crea el Secret con tu herramienta preferida:

```bash
# Manual
kubectl create secret generic llamenos-secrets \
  --from-literal=postgres-password=your_password \
  --from-literal=rustfs-access-key=your_key \
  --from-literal=rustfs-secret-key=your_key

# O con External Secrets Operator, Sealed Secrets, Vault, etc.
```

## Usar un almacenamiento externo compatible con S3

Si ya tienes RustFS, MinIO o un servicio compatible con S3, desactiva el RustFS integrado y proporciona el endpoint:

```yaml
rustfs:
  enabled: false

app:
  env:
    STORAGE_ENDPOINT: "https://your-storage.example.com"
    STORAGE_ACCESS_KEY: "your-key"
    STORAGE_SECRET_KEY: "your-secret"
    STORAGE_BUCKET: "llamenos"
```

## Transcripcion con GPU

Para transcripcion Whisper acelerada por GPU en GPUs NVIDIA:

```yaml
whisper:
  enabled: true
  device: "cuda"
  model: "Systran/faster-whisper-large-v3"
  resources:
    limits:
      nvidia.com/gpu: 1
```

Asegurate de que el [plugin de dispositivos NVIDIA](https://github.com/NVIDIA/k8s-device-plugin) este instalado en tu cluster.

## Escalado

El despliegue usa la estrategia `RollingUpdate` para actualizaciones sin tiempo de inactividad. Escala las replicas segun tu trafico:

```bash
kubectl scale deployment llamenos --replicas=3
```

O establece `app.replicas` en tu archivo de valores. Los bloqueos de aviso de PostgreSQL aseguran la consistencia de datos entre replicas.

## Monitoreo

### Verificaciones de salud

El chart configura sondas de vivacidad (liveness), disponibilidad (readiness) e inicio (startup) contra `/api/health`:

```yaml
# Integrado en la plantilla de despliegue
livenessProbe:
  httpGet:
    path: /api/health
    port: http
  initialDelaySeconds: 15
  periodSeconds: 15
readinessProbe:
  httpGet:
    path: /api/health
    port: http
  initialDelaySeconds: 10
  periodSeconds: 10
startupProbe:
  httpGet:
    path: /api/health
    port: http
  failureThreshold: 30
  periodSeconds: 5
```

### Logs

```bash
kubectl logs -l app.kubernetes.io/instance=llamenos -c app -f
```

## Actualizacion

```bash
helm upgrade llamenos deploy/helm/llamenos/ -f values-production.yaml
```

La estrategia `RollingUpdate` proporciona actualizaciones sin tiempo de inactividad.

## Desinstalacion

```bash
helm uninstall llamenos
```

> **Nota**: Los PersistentVolumeClaims no se eliminan con `helm uninstall`. Eliminelos manualmente si desea borrar todos los datos:
> ```bash
> kubectl delete pvc -l app.kubernetes.io/instance=llamenos
> ```

## Solucion de problemas

### Pod atascado en CrashLoopBackOff

```bash
kubectl logs llamenos-0 -c app --previous
kubectl describe pod llamenos-0
```

Causas comunes: secretos faltantes, PostgreSQL no alcanzable, RustFS no listo.

### Errores de conexion a la base de datos

Verifica que PostgreSQL sea alcanzable desde el cluster:

```bash
kubectl run pg-test --rm -it --image=postgres:17-alpine -- psql postgresql://llamenos:PASSWORD@PG_HOST:5432/llamenos -c "SELECT 1"
```

### Ingress no funciona

Verifica que el controlador de ingress este en ejecucion y que el recurso Ingress tenga una direccion:

```bash
kubectl get ingress llamenos
kubectl describe ingress llamenos
```

## Siguientes pasos

- [Guia de Administrador](/es/docs/guides/?audience=operator) — configura la linea de ayuda
- [Descripcion General del Autoalojamiento](/es/docs/deploy/self-hosting) — compara opciones de despliegue
- [Despliegue con Docker Compose](/es/docs/deploy/docker) — alternativa mas sencilla
