---
title: "Deploy: Kubernetes (Helm)"
description: Deploy Llamenos to Kubernetes using the official Helm chart.
---

This guide covers deploying Llamenos to a Kubernetes cluster using the official Helm chart. The chart manages the application, RustFS storage, Authentik identity provider, and optional Whisper services as separate deployments. You provide a PostgreSQL database.

## Prerequisites

- A Kubernetes cluster (v1.24+) — managed (EKS, GKE, AKS) or self-hosted
- A PostgreSQL 14+ instance (managed RDS/Cloud SQL recommended, or self-hosted)
- [Helm](https://helm.sh/) v3.10+
- [kubectl](https://kubernetes.io/docs/tasks/tools/) configured for your cluster
- An ingress controller (NGINX Ingress, Traefik, etc.)
- cert-manager (optional, for automatic TLS certificates)

## 1. Install the chart

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

Or create a `values-production.yaml` file for reproducible deploys:

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

Then install:

```bash
helm install llamenos deploy/helm/llamenos/ -f values-production.yaml
```

## 2. Verify the deployment

```bash
# Check pods are running
kubectl get pods -l app.kubernetes.io/instance=llamenos

# Check the app health
kubectl port-forward svc/llamenos 3000:3000
curl http://localhost:3000/api/health
# -> {"status":"ok"}
```

## 3. Configure DNS

Point your domain to the ingress controller's external IP or load balancer:

```bash
kubectl get ingress llamenos
```

## 4. First login and setup

Open `https://hotline.yourdomain.com` in your browser. You'll be redirected to Authentik to create your admin account via invite link, then complete the setup wizard.

## Chart configuration reference

### Application

| Parameter | Description | Default |
|-----------|-------------|---------|
| `app.image.repository` | Container image | `ghcr.io/your-org/llamenos` |
| `app.image.tag` | Image tag | Chart appVersion |
| `app.port` | Application port | `3000` |
| `app.replicas` | Pod replicas | `2` |
| `app.resources` | CPU/memory requests and limits | `{}` |
| `app.env` | Extra environment variables | `{}` |

### PostgreSQL

| Parameter | Description | Default |
|-----------|-------------|---------|
| `postgres.host` | PostgreSQL hostname (required) | `""` |
| `postgres.port` | PostgreSQL port | `5432` |
| `postgres.database` | Database name | `llamenos` |
| `postgres.user` | Database user | `llamenos` |
| `postgres.poolSize` | Connection pool size | `10` |

### Secrets

| Parameter | Description | Default |
|-----------|-------------|---------|
| `secrets.postgresPassword` | PostgreSQL password (required) | `""` |
| `secrets.twilioAccountSid` | Twilio Account SID | `""` |
| `secrets.twilioAuthToken` | Twilio Auth Token | `""` |
| `secrets.twilioPhoneNumber` | Twilio phone number (E.164) | `""` |
| `secrets.existingSecret` | Use an existing K8s Secret | `""` |

> **Tip**: For production, use `secrets.existingSecret` to reference a Secret managed by External Secrets Operator, Sealed Secrets, or Vault.

### RustFS

| Parameter | Description | Default |
|-----------|-------------|---------|
| `rustfs.enabled` | Deploy RustFS | `true` |
| `rustfs.image.repository` | RustFS image | `ghcr.io/rustfs/rustfs` |
| `rustfs.image.tag` | RustFS tag | `latest` |
| `rustfs.persistence.size` | RustFS data volume | `50Gi` |
| `rustfs.persistence.storageClass` | Storage class | `""` |
| `rustfs.credentials.accessKey` | RustFS root user | `""` (required) |
| `rustfs.credentials.secretKey` | RustFS root password | `""` (required) |
| `rustfs.resources` | CPU/memory requests and limits | `{}` |

### Authentik (Identity Provider)

| Parameter | Description | Default |
|-----------|-------------|---------|
| `authentik.enabled` | Deploy Authentik | `true` |
| `authentik.env.AUTHENTIK_SECRET_KEY` | Authentik secret key | `""` (required) |
| `authentik.postgresql.host` | PostgreSQL host for Authentik | Same as app postgres |
| `authentik.postgresql.name` | Authentik database name | `authentik` |
| `authentik.postgresql.user` | Authentik database user | `authentik` |
| `authentik.postgresql.password` | Authentik database password | `""` (required) |
| `authentik.resources` | CPU/memory requests and limits | `{}` |

### Whisper transcription

| Parameter | Description | Default |
|-----------|-------------|---------|
| `whisper.enabled` | Deploy Whisper | `false` |
| `whisper.image.repository` | Whisper image | `fedirz/faster-whisper-server` |
| `whisper.image.tag` | Whisper tag | `0.4.1` |
| `whisper.model` | Whisper model name | `Systran/faster-whisper-base` |
| `whisper.device` | Device: `cpu` or `cuda` | `cpu` |
| `whisper.resources` | CPU/memory requests and limits | `{}` |

### Ingress

| Parameter | Description | Default |
|-----------|-------------|---------|
| `ingress.enabled` | Create Ingress resource | `true` |
| `ingress.className` | Ingress class | `nginx` |
| `ingress.annotations` | Ingress annotations | `{}` |
| `ingress.hosts` | Host rules | See values.yaml |
| `ingress.tls` | TLS configuration | `[]` |

### Service account

| Parameter | Description | Default |
|-----------|-------------|---------|
| `serviceAccount.create` | Create a ServiceAccount | `true` |
| `serviceAccount.annotations` | SA annotations (e.g., IRSA) | `{}` |
| `serviceAccount.name` | Override SA name | `""` |

## Using external secrets

For production, avoid putting secrets directly in Helm values. Instead, create the Secret separately and reference it:

```yaml
# values-production.yaml
secrets:
  existingSecret: llamenos-secrets
```

Create the Secret with your preferred tool:

```bash
# Manual
kubectl create secret generic llamenos-secrets \
  --from-literal=postgres-password=your_password \
  --from-literal=rustfs-access-key=your_key \
  --from-literal=rustfs-secret-key=your_key

# Or with External Secrets Operator, Sealed Secrets, Vault, etc.
```

## Using an external S3-compatible store

If you already have RustFS, MinIO, or an S3-compatible service, disable the built-in RustFS and pass the endpoint:

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

## GPU transcription

For GPU-accelerated Whisper transcription on NVIDIA GPUs:

```yaml
whisper:
  enabled: true
  device: "cuda"
  model: "Systran/faster-whisper-large-v3"
  resources:
    limits:
      nvidia.com/gpu: 1
```

Ensure the [NVIDIA device plugin](https://github.com/NVIDIA/k8s-device-plugin) is installed in your cluster.

## Scaling

The deployment uses `RollingUpdate` strategy for zero-downtime upgrades. Scale replicas based on your traffic:

```bash
kubectl scale deployment llamenos --replicas=3
```

Or set `app.replicas` in your values file. PostgreSQL advisory locks ensure data consistency across replicas.

## Monitoring

### Health checks

The chart configures liveness, readiness, and startup probes against `/api/health`:

```yaml
# Built into the deployment template
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

## Upgrading

```bash
helm upgrade llamenos deploy/helm/llamenos/ -f values-production.yaml
```

The `RollingUpdate` strategy provides zero-downtime upgrades.

## Uninstalling

```bash
helm uninstall llamenos
```

> **Note**: PersistentVolumeClaims are not deleted by `helm uninstall`. Delete them manually if you want to remove all data:
> ```bash
> kubectl delete pvc -l app.kubernetes.io/instance=llamenos
> ```

## Troubleshooting

### Pod stuck in CrashLoopBackOff

```bash
kubectl logs llamenos-0 -c app --previous
kubectl describe pod llamenos-0
```

Common causes: missing secrets, PostgreSQL not reachable, RustFS not ready.

### Database connection errors

Verify PostgreSQL is reachable from the cluster:

```bash
kubectl run pg-test --rm -it --image=postgres:17-alpine -- psql postgresql://llamenos:PASSWORD@PG_HOST:5432/llamenos -c "SELECT 1"
```

### Ingress not working

Verify the ingress controller is running and the Ingress resource has an address:

```bash
kubectl get ingress llamenos
kubectl describe ingress llamenos
```

## Next steps

- [Admin Guide](/docs/guides/?audience=operator) — configure the hotline
- [Self-Hosting Overview](/docs/deploy/self-hosting) — compare deployment options
- [Docker Compose Deployment](/docs/deploy/docker) — simpler alternative
