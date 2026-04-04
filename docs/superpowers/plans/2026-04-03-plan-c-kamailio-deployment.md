# Kamailio Deployment — Ansible, Docker Compose & Helm

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Kamailio as an optional SIP proxy/load balancer for high-availability deployments, with Ansible role, Docker Compose profile, and Helm chart values.

**Dependency:** Plan A (sip-bridge refactor) must be completed first. Plan A introduces the `KamailioClient` class in sip-bridge that talks to Kamailio's JSONRPC module. This plan is infrastructure-only — no TelephonyAdapter or sip-bridge code changes.

**Architecture context:** Kamailio is a SIP proxy/router, NOT a PBX. It does not control calls or media. It sits in front of one or more Asterisk/FreeSWITCH instances and distributes SIP traffic using the dispatcher module. Health checks via SIP OPTIONS pings detect failed PBX instances. The sip-bridge from Plan A manages Kamailio's dispatcher list via JSONRPC for dynamic PBX registration/deregistration.

**Kamailio modules used:**

- `jsonrpcs` — management API (used by sip-bridge's KamailioClient)
- `dispatcher` — load balancing + failover across PBX instances
- `nathelper` — NAT traversal for SIP clients behind NAT
- `tls` — SIP-TLS (port 5061) for encrypted signaling
- `textops` / `siputils` — SIP message manipulation

---

### Task 1: Ansible Role — Defaults & Templates

**Files:**

- Create: `deploy/ansible/roles/kamailio/defaults/main.yml`
- Create: `deploy/ansible/roles/kamailio/templates/kamailio.cfg.j2`
- Create: `deploy/ansible/roles/kamailio/templates/dispatcher.list.j2`

#### 1a. Role defaults

- [ ] Create `deploy/ansible/roles/kamailio/defaults/main.yml`:

```yaml
---
# Kamailio SIP proxy — optional, for multi-PBX HA deployments
#
# Enable by adding 'kamailio' to compose_profiles list.
# Kamailio sits in front of Asterisk/FreeSWITCH and distributes SIP traffic.

# Toggle Kamailio deployment
kamailio_enabled: false

# Docker image
kamailio_image: kamailio/kamailio:5.7

# SIP listening ports (host-mapped)
kamailio_sip_port: 5060
kamailio_sip_tls_port: 5061

# JSONRPC fifo path (container-internal, used by management tools)
kamailio_jsonrpc_fifo: /run/kamailio/kamailio_rpc.fifo

# JSONRPC HTTP transport — used by sip-bridge KamailioClient
kamailio_jsonrpc_port: 5064

# Dispatcher module configuration
kamailio_dispatcher_set_id: 1

# PBX instances for load balancing (Asterisk/FreeSWITCH endpoints)
# Each entry: { uri: "sip:host:port", flags: 0, priority: 0, attrs: "" }
# flags: 0=active, 1=inactive, 2=probing  |  priority: lower=higher priority
kamailio_pbx_instances:
  - uri: "sip:asterisk:5060"
    flags: 0
    priority: 0
    attrs: "weight=50"

# Dispatcher algorithm: 0=hash over callid, 4=round-robin, 10=weight-based
kamailio_dispatcher_algorithm: 4

# Health check interval (seconds) — SIP OPTIONS pings to PBX instances
kamailio_dispatcher_ping_interval: 30

# Number of failed pings before marking PBX as down
kamailio_dispatcher_ping_threshold: 3

# TLS settings (Caddy terminates external TLS; this is for internal SIP-TLS)
kamailio_tls_enabled: false
kamailio_tls_cert_path: /etc/kamailio/tls/kamailio.pem
kamailio_tls_key_path: /etc/kamailio/tls/kamailio.key

# Log level: 0=ALERT, 1=BUG, 2=CRIT, 3=ERR, 4=WARN, 5=NOTICE, 6=INFO, 7=DBG
kamailio_log_level: 4

# SIP domain (defaults to deployment domain)
kamailio_sip_domain: "{{ domain | default('localhost') }}"
```

#### 1b. Kamailio config template

- [ ] Create `deploy/ansible/roles/kamailio/templates/kamailio.cfg.j2`:

```
#!KAMAILIO
# Kamailio configuration — managed by Ansible
# Do not edit directly; changes will be overwritten on next deploy.
#
# Role: SIP proxy/load balancer in front of PBX instances (Asterisk/FreeSWITCH).
# Modules: dispatcher (load balance), jsonrpcs (management API), nathelper, tls.

####### Global Parameters #########

debug={{ kamailio_log_level | default(4) }}
log_stderror=no
log_facility=LOG_LOCAL0

memdbg=5
memlog=5

# Limit max open files (SIP can have many concurrent dialogs)
open_files_limit=65536

# Listen on SIP UDP + TCP
listen=udp:0.0.0.0:5060
listen=tcp:0.0.0.0:5060
{% if kamailio_tls_enabled | default(false) | bool %}
listen=tls:0.0.0.0:5061
{% endif %}

# SIP domain
alias="{{ kamailio_sip_domain }}"

# Disable DNS SRV lookups for simplicity in Docker networking
dns=no
rev_dns=no

# TCP connection lifetime (seconds)
tcp_connection_lifetime=3605

####### Modules Section ########

# Set module search path
mpath="/usr/lib/x86_64-linux-gnu/kamailio/modules/"

# --- JSON-RPC management interface ---
loadmodule "jsonrpcs.so"
modparam("jsonrpcs", "fifo_name", "{{ kamailio_jsonrpc_fifo | default('/run/kamailio/kamailio_rpc.fifo') }}")
modparam("jsonrpcs", "transport", 7)  # 1=FIFO, 2=datagram, 4=HTTP => 7=all

# --- Core SIP modules ---
loadmodule "kex.so"
loadmodule "corex.so"
loadmodule "tm.so"
loadmodule "tmx.so"
loadmodule "sl.so"
loadmodule "rr.so"
loadmodule "pv.so"
loadmodule "maxfwd.so"
loadmodule "textops.so"
loadmodule "siputils.so"
loadmodule "xlog.so"
loadmodule "sanity.so"
loadmodule "ctl.so"

# --- NAT traversal ---
loadmodule "nathelper.so"
modparam("nathelper", "received_avp", "$avp(RECEIVED)")

# --- Dispatcher (load balancing) ---
loadmodule "dispatcher.so"
modparam("dispatcher", "list_file", "/etc/kamailio/dispatcher.list")
modparam("dispatcher", "ds_ping_method", "OPTIONS")
modparam("dispatcher", "ds_ping_interval", {{ kamailio_dispatcher_ping_interval | default(30) }})
modparam("dispatcher", "ds_probing_threshold", {{ kamailio_dispatcher_ping_threshold | default(3) }})
modparam("dispatcher", "ds_probing_mode", 1)  # Probe inactive destinations
modparam("dispatcher", "ds_ping_from", "sip:kamailio@{{ kamailio_sip_domain }}")

{% if kamailio_tls_enabled | default(false) | bool %}
# --- TLS ---
loadmodule "tls.so"
modparam("tls", "config", "/etc/kamailio/tls.cfg")
modparam("tls", "tls_force_run", 1)
{% endif %}

# --- HTTP transport for JSONRPC (used by sip-bridge KamailioClient) ---
loadmodule "xhttp.so"
modparam("xhttp", "url_skip", "^/rpc")

# TM module parameters
modparam("tm", "failure_reply_mode", 3)
modparam("tm", "fr_timer", 30000)        # Transaction timeout (ms)
modparam("tm", "fr_inv_timer", 120000)   # INVITE transaction timeout (ms)

# Record-Route parameters
modparam("rr", "enable_full_lr", 1)
modparam("rr", "append_fromtag", 1)

# Max-Forwards limit
modparam("maxfwd", "max_limit", 70)

####### Routing Logic ########

# Main SIP request routing
request_route {
    # Per-SIP-request initial checks
    if (!mf_process_maxfwd_header("10")) {
        sl_send_reply("483", "Too Many Hops");
        exit;
    }

    # Sanity checks
    if (!sanity_check("17895", "7")) {
        xlog("L_WARN", "Malformed SIP message from $si:$sp\n");
        exit;
    }

    # Record-Route for all requests (except REGISTER)
    if (!is_method("REGISTER")) {
        record_route();
    }

    # Handle requests within existing dialogs
    if (has_totag()) {
        if (loose_route()) {
            # In-dialog request — route normally
            if (is_method("BYE")) {
                xlog("L_INFO", "BYE from $fu (call-id=$ci)\n");
            }
            route(RELAY);
            exit;
        }

        if (is_method("ACK")) {
            if (t_check_trans()) {
                route(RELAY);
                exit;
            }
            exit;
        }

        sl_send_reply("404", "Not Found");
        exit;
    }

    # --- Initial requests (no to-tag) ---

    # CANCEL processing
    if (is_method("CANCEL")) {
        if (t_check_trans()) {
            t_relay();
        }
        exit;
    }

    # Absorb retransmissions
    t_check_trans();

    # Handle OPTIONS (keepalive/health checks)
    if (is_method("OPTIONS") && uri==myself) {
        sl_send_reply("200", "OK");
        exit;
    }

    # INVITE — dispatch to PBX pool
    if (is_method("INVITE")) {
        route(DISPATCH);
        exit;
    }

    # REGISTER — proxy to PBX (Asterisk handles registration)
    if (is_method("REGISTER")) {
        route(DISPATCH);
        exit;
    }

    # All other requests — try to dispatch
    route(DISPATCH);
}

# Dispatch to PBX instances via dispatcher module
route[DISPATCH] {
    # Select a PBX from dispatcher set {{ kamailio_dispatcher_set_id | default(1) }}
    # Algorithm: {{ kamailio_dispatcher_algorithm | default(4) }} (4=round-robin)
    if (!ds_select_dst("{{ kamailio_dispatcher_set_id | default(1) }}", "{{ kamailio_dispatcher_algorithm | default(4) }}")) {
        # No available PBX instances
        xlog("L_ERR", "No PBX instances available for $ru from $fu\n");
        sl_send_reply("503", "All PBX Instances Unavailable");
        exit;
    }

    xlog("L_INFO", "Dispatching $rm $ru to $du (from $fu)\n");

    # Set failure route for failover
    t_on_failure("PBX_FAILOVER");

    route(RELAY);
}

# Relay request to destination
route[RELAY] {
    if (!t_relay()) {
        sl_reply_error();
    }
}

# Failure route — try next PBX on failure
failure_route[PBX_FAILOVER] {
    if (t_is_canceled()) {
        exit;
    }

    # Check for transport/timeout failures (no response, or 5xx/6xx from PBX)
    if (t_check_status("(5[0-9][0-9])|(6[0-9][0-9])") || t_branch_timeout() || !t_branch_replied()) {
        # Mark current destination as failed
        if (ds_next_dst()) {
            xlog("L_WARN", "PBX failover: trying next destination $du for $ru\n");
            t_on_failure("PBX_FAILOVER");
            route(RELAY);
            exit;
        }

        # All PBX instances failed
        xlog("L_ERR", "All PBX instances failed for $ru from $fu\n");
        t_reply("503", "All PBX Instances Unavailable");
        exit;
    }
}

# Handle JSONRPC over HTTP (for sip-bridge KamailioClient)
event_route[xhttp:request] {
    if ($hu =~ "^/rpc") {
        jsonrpc_dispatch();
    } else {
        xhttp_reply("200", "OK", "text/plain", "Kamailio SIP Proxy\n");
    }
}
```

#### 1c. Dispatcher list template

- [ ] Create `deploy/ansible/roles/kamailio/templates/dispatcher.list.j2`:

```
# Kamailio dispatcher list — managed by Ansible
# Do not edit directly; changes will be overwritten on next deploy.
#
# Format: setid destination flags priority attributes
# flags: 0=active, 1=inactive, 2=probing (test with OPTIONS first)
# priority: lower number = higher priority (0 is highest)
#
# The sip-bridge KamailioClient can dynamically modify this list at runtime
# via JSONRPC (dispatcher.add / dispatcher.remove). Static entries here
# serve as the baseline that is restored on Kamailio restart.

{% for instance in kamailio_pbx_instances | default([]) %}
{{ kamailio_dispatcher_set_id | default(1) }} {{ instance.uri }} {{ instance.flags | default(0) }} {{ instance.priority | default(0) }} {{ instance.attrs | default('') }}
{% endfor %}
```

- [ ] Verify template syntax: the dispatcher.list format is `setid uri flags priority attrs` (space-separated, one per line)

### Task 2: Ansible Role — Tasks & Variable Documentation

**Files:**

- Create: `deploy/ansible/roles/kamailio/tasks/main.yml`
- Modify: `deploy/ansible/demo_vars.example.yml`

#### 2a. Role tasks

- [ ] Create `deploy/ansible/roles/kamailio/tasks/main.yml`:

```yaml
---
# Kamailio SIP proxy role — creates config directory, templates config files.
# The actual container is defined in the docker-compose.j2 template (llamenos role)
# and conditionally included when 'kamailio' is in compose_profiles.

- name: Create Kamailio config directory
  ansible.builtin.file:
    path: "{{ app_dir }}/kamailio"
    state: directory
    owner: "{{ deploy_user }}"
    group: "{{ deploy_group }}"
    mode: "0755"
  when: kamailio_enabled | default(false) | bool

- name: Template Kamailio configuration
  ansible.builtin.template:
    src: kamailio.cfg.j2
    dest: "{{ app_dir }}/kamailio/kamailio.cfg"
    owner: "{{ deploy_user }}"
    group: "{{ deploy_group }}"
    mode: "0644"
  when: kamailio_enabled | default(false) | bool
  notify: Restart llamenos stack

- name: Template dispatcher list
  ansible.builtin.template:
    src: dispatcher.list.j2
    dest: "{{ app_dir }}/kamailio/dispatcher.list"
    owner: "{{ deploy_user }}"
    group: "{{ deploy_group }}"
    mode: "0644"
  when: kamailio_enabled | default(false) | bool
  notify: Restart llamenos stack

- name: Create Kamailio TLS directory
  ansible.builtin.file:
    path: "{{ app_dir }}/kamailio/tls"
    state: directory
    owner: "{{ deploy_user }}"
    group: "{{ deploy_group }}"
    mode: "0750"
  when:
    - kamailio_enabled | default(false) | bool
    - kamailio_tls_enabled | default(false) | bool
```

#### 2b. Update demo_vars.example.yml

- [ ] Add Kamailio section to `deploy/ansible/demo_vars.example.yml` after the `# ─── Asterisk WebRTC` section and before `# ─── IdP Auth`:

```yaml
# ─── Kamailio SIP Proxy (when kamailio profile enabled) ─────
# Kamailio is a SIP proxy/load balancer — NOT a PBX.
# It distributes SIP traffic across multiple Asterisk/FreeSWITCH instances
# for high-availability deployments. Requires the 'asterisk' profile too.
# kamailio_enabled: false
# kamailio_image: kamailio/kamailio:5.7
# kamailio_sip_domain: demo.llamenos-hotline.com
# kamailio_dispatcher_algorithm: 4  # 0=hash, 4=round-robin, 10=weight
# kamailio_pbx_instances:
#   - uri: "sip:asterisk:5060"
#     flags: 0
#     priority: 0
#     attrs: "weight=50"
```

- [ ] Add `kamailio` to the `compose_profiles` comment on line ~109:

Change:

```yaml
# Options: transcription, asterisk, signal
```

To:

```yaml
# Options: transcription, asterisk, signal, kamailio
```

### Task 3: Docker Compose — Production & Dev

**Files:**

- Modify: `deploy/docker/docker-compose.yml`
- Modify: `deploy/docker/docker-compose.dev.yml`
- Modify: `deploy/ansible/roles/llamenos/templates/docker-compose.j2`

#### 3a. Production docker-compose.yml

- [ ] Add the `kamailio` service to `deploy/docker/docker-compose.yml` after the `signal-cli` service block (before `volumes:`):

```yaml
# ── Optional: Kamailio SIP Proxy ────────────────────────
kamailio:
  image: kamailio/kamailio:5.7
  profiles: ["kamailio"]
  restart: unless-stopped
  ports:
    - "${KAMAILIO_SIP_PORT:-5060}:5060/udp"
    - "${KAMAILIO_SIP_PORT:-5060}:5060/tcp"
    - "${KAMAILIO_TLS_PORT:-5061}:5061/tcp"
  volumes:
    - ./kamailio/kamailio.cfg:/etc/kamailio/kamailio.cfg:ro
    - ./kamailio/dispatcher.list:/etc/kamailio/dispatcher.list:ro
  environment:
    - SIP_DOMAIN=${DOMAIN:-localhost}
  networks:
    - internal
  healthcheck:
    test: ["CMD", "kamcmd", "core.version"]
    interval: 30s
    timeout: 5s
    retries: 3
    start_period: 10s
  depends_on:
    asterisk:
      condition: service_healthy
```

#### 3b. Dev docker-compose.dev.yml

- [ ] Add Kamailio dev overrides to `deploy/docker/docker-compose.dev.yml` after the `coturn` service:

```yaml
# Kamailio SIP proxy — dev port offsets
kamailio:
  ports:
    - "5070:5060/udp" # SIP UDP (offset from default 5060, avoids Asterisk at 5062)
    - "5070:5060/tcp" # SIP TCP
    - "5071:5061/tcp" # SIP-TLS
    - "5074:5064/tcp" # JSONRPC HTTP (for sip-bridge KamailioClient)
```

#### 3c. Ansible docker-compose.j2 template

- [ ] Add Kamailio service block to `deploy/ansible/roles/llamenos/templates/docker-compose.j2` after the `signal-cli` conditional block and before the `volumes:` section. Follow the existing `{% if 'profile' in (compose_profiles | default([])) %}` pattern:

```jinja2
{% if 'kamailio' in (compose_profiles | default([])) %}

  kamailio:
    image: {{ kamailio_image | default('kamailio/kamailio:5.7') }}
    restart: unless-stopped
    ports:
      - "{{ kamailio_sip_port | default(5060) }}:5060/udp"
      - "{{ kamailio_sip_port | default(5060) }}:5060/tcp"
      - "{{ kamailio_sip_tls_port | default(5061) }}:5061/tcp"
    volumes:
      - ./kamailio/kamailio.cfg:/etc/kamailio/kamailio.cfg:ro
      - ./kamailio/dispatcher.list:/etc/kamailio/dispatcher.list:ro
{% if kamailio_tls_enabled | default(false) | bool %}
      - ./kamailio/tls:/etc/kamailio/tls:ro
{% endif %}
    networks:
      - internal
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    healthcheck:
      test: ["CMD", "kamcmd", "core.version"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
{% endif %}
```

- [ ] Add Kamailio volume directory to the Ansible `volumes:` section — Kamailio uses bind mounts (config dir), so no named volume is needed. Verify no volume entry is required.

### Task 4: Helm Chart Values

**Files:**

- Modify: `deploy/helm/llamenos/values.yaml`

- [ ] Add Kamailio section to `deploy/helm/llamenos/values.yaml` after the `asteriskBridge` section:

```yaml
# Kamailio SIP proxy (load balancer for multi-PBX HA)
kamailio:
  enabled: false
  image:
    repository: kamailio/kamailio
    tag: "5.7"
  # SIP listening ports
  sipPort: 5060
  sipTlsPort: 5061
  # JSONRPC HTTP port (used by sip-bridge KamailioClient)
  jsonrpcPort: 5064
  # Dispatcher configuration
  dispatcherSetId: 1
  dispatcherAlgorithm: 4 # 0=hash, 4=round-robin, 10=weight
  pingInterval: 30
  pingThreshold: 3
  # PBX instances for load balancing
  pbxInstances:
    - uri: "sip:asterisk:5060"
      flags: 0
      priority: 0
      attrs: "weight=50"
  # TLS for SIP signaling (internal)
  tls:
    enabled: false
    certSecret: "" # K8s secret containing tls.crt and tls.key
  # SIP domain
  sipDomain: "" # Defaults to ingress host
  resources:
    requests:
      cpu: 50m
      memory: 64Mi
    limits:
      cpu: 500m
      memory: 256Mi
  env:
    # JSONRPC URL for sip-bridge to reach Kamailio
    KAMAILIO_JSONRPC_URL: "http://kamailio:5064/rpc"
```

### Task 5: Commit & Verify

- [ ] Verify all new files exist:
  - `deploy/ansible/roles/kamailio/defaults/main.yml`
  - `deploy/ansible/roles/kamailio/templates/kamailio.cfg.j2`
  - `deploy/ansible/roles/kamailio/templates/dispatcher.list.j2`
  - `deploy/ansible/roles/kamailio/tasks/main.yml`
- [ ] Verify modified files have correct syntax:
  - `deploy/docker/docker-compose.yml` — run `docker compose -f deploy/docker/docker-compose.yml config --profiles kamailio` to validate
  - `deploy/docker/docker-compose.dev.yml` — run `docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.dev.yml config --profiles kamailio` to validate
  - `deploy/ansible/demo_vars.example.yml` — verify YAML syntax with `python3 -c "import yaml; yaml.safe_load(open('deploy/ansible/demo_vars.example.yml'))"`
  - `deploy/helm/llamenos/values.yaml` — verify YAML syntax with `python3 -c "import yaml; yaml.safe_load(open('deploy/helm/llamenos/values.yaml'))"`
- [ ] Verify Ansible Jinja2 template renders (dry run): `ansible-playbook deploy/ansible/deploy-demo.yml --check --diff` (if available)
- [ ] `bun run typecheck && bun run build` (no app code changed, but confirm nothing broke)
- [ ] Commit: `feat(deploy): add Kamailio SIP proxy for multi-PBX load balancing`
- [ ] Update NEXT_BACKLOG.md to mark Kamailio deployment as complete

---

## Summary

| Task | Files                                                        | Action                                                                         |
| ---- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 1a   | `deploy/ansible/roles/kamailio/defaults/main.yml`            | Create — role defaults with all Kamailio variables                             |
| 1b   | `deploy/ansible/roles/kamailio/templates/kamailio.cfg.j2`    | Create — full Kamailio config (dispatcher, jsonrpcs, nathelper, TLS, failover) |
| 1c   | `deploy/ansible/roles/kamailio/templates/dispatcher.list.j2` | Create — PBX instance list for dispatcher load balancing                       |
| 2a   | `deploy/ansible/roles/kamailio/tasks/main.yml`               | Create — config dir, template config, template dispatcher list                 |
| 2b   | `deploy/ansible/demo_vars.example.yml`                       | Modify — add kamailio_enabled and related variables                            |
| 3a   | `deploy/docker/docker-compose.yml`                           | Modify — add kamailio service under `profiles: [kamailio]`                     |
| 3b   | `deploy/docker/docker-compose.dev.yml`                       | Modify — add kamailio dev port offsets (5070/5071/5074)                        |
| 3c   | `deploy/ansible/roles/llamenos/templates/docker-compose.j2`  | Modify — add kamailio conditional block                                        |
| 4    | `deploy/helm/llamenos/values.yaml`                           | Modify — add kamailio section with all config values                           |
| 5    | —                                                            | Verify syntax, commit                                                          |
