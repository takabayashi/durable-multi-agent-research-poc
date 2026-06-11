# Restate on minikube (Operator) — Troubleshooting Guide

The most common failure scenarios for running this project on minikube via the **Restate
Operator**, with the commands to diagnose and fix each. For the happy-path procedures
(deploy, roll out, resume, teardown) see [`runbooks.md`](./runbooks.md).

Topology (what the operator gives you):

- **restate-operator** — a cluster-scoped controller (ns `restate-operator`) plus three
  CRDs (`RestateCluster`, `RestateDeployment`, `RestateCloudEnvironment`). It reconciles
  your CRs into real Kubernetes objects and **auto-registers** services.
- **restate** — the runtime, from a `RestateCluster` CR. The operator runs it as a
  single-node **StatefulSet + PVC** plus a `Service` (`svc/restate`) in ns `restate`.
  Ports: `8080` ingress (clients), `9070` admin/UI (registration), `5122` node.
  Holds the durable journal/state, single-writer locking, retries, replay.
- **durable-research** — your Node app (`Dockerfile`, port `9080`, h2c), from a
  `RestateDeployment` CR. The operator creates a **versioned ReplicaSet + Service** per
  pod-template revision and registers each version with the cluster.

Flow: `CLI -> restate(8080) -> invokes -> durable-research(9080)`. Everything lives in
namespace `restate`; the API keys come from the `durable-research-secrets` Secret.

---

## 1. Operator not installed / CRDs missing / operator pod down

**Symptom:** `kubectl apply -f k8s/restate-cluster.yaml` fails with
`no matches for kind "RestateCluster" in version "restate.dev/v1"`, or the CRs apply but
nothing ever happens (no StatefulSet, no Service, no pods).

**Cause:** the Restate Operator (which owns the CRDs and does all reconciliation) isn't
installed or its controller pod is not running.

**Fix:**

```bash
kubectl get crd | grep restate.dev                 # expect restateclusters/restatedeployments
kubectl -n restate-operator get pods               # controller should be Running
# (re)install if missing:
helm install restate-operator oci://ghcr.io/restatedev/restate-operator-helm \
  --namespace restate-operator --create-namespace
kubectl -n restate-operator logs deploy/restate-operator   # reconciliation errors show here
```

---

## 2. `RestateCluster` never becomes Ready (`restate-0` Pending / CrashLoop / OOMKilled)

**Symptom:** `kubectl -n restate get pods` shows no `restate-0`, or it's stuck `Pending`,
`CrashLoopBackOff`, or restarts with `OOMKilled`.

**Cause:** PVC can't bind (no default StorageClass), the pod doesn't fit the minikube VM
(requests too high), or RocksDB memory exceeds the pod limit.

**Fix:**

```bash
kubectl -n restate describe pod restate-0 | sed -n '/Events/,$p'   # the reason is here
kubectl -n restate get pvc                                         # must be Bound, not Pending
minikube addons enable default-storageclass storage-provisioner    # if no default SC
kubectl get storageclass                                           # one marked (default)
```

If it's resources: give the VM headroom (`minikube start --cpus=4 --memory=6144`) and/or
lower `spec.compute.resources` and keep `rocksdb-total-memory-size` well under the memory
limit in [`k8s/restate-cluster.yaml`](../k8s/restate-cluster.yaml), then re-apply.

---

## 3. `durable-research` pod stuck in `ImagePullBackOff` / `ErrImagePull`

**Symptom:** the `durable-research-*` pod never starts; `kubectl -n restate get pods`
shows `ImagePullBackOff`.

**Cause:** the image only exists in your local Docker — it was never loaded into minikube
— or the pull policy is `Always` so the node tries a remote registry that doesn't have it.

**Fix:**

```bash
docker build --platform linux/arm64 -t durable-research:0.1.0 .
minikube image load durable-research:0.1.0
minikube image ls | grep durable-research          # confirm it's in the cluster
# ensure the RestateDeployment template uses imagePullPolicy: IfNotPresent and a real tag
kubectl -n restate delete pod -l app=durable-research   # ReplicaSet recreates it; or re-apply the CR
```

Avoid `:latest` (it defaults the pull policy to `Always`); use immutable tags like
`durable-research:0.1.0`. If the image instead loads fine but the pod `CrashLoopBackOff`s
with `exec format error`, that's a CPU-architecture mismatch — see #11.

---

## 4. `RestateDeployment` didn't auto-register (service not in the UI / `deployments list`)

**Symptom:** the pod is `Running` but the service's handlers don't appear in the Restate
UI or `restate deployments list`, so ingress calls 404.

**Cause:** the operator registers by calling the cluster's admin API with the service's
in-cluster URL. It fails if: the pod isn't `Ready` yet (discovery hits a not-ready
endpoint), the `restate.register` reference is wrong, or (under enforced NetworkPolicies)
the operator/cluster can't reach the service.

**Fix:**

```bash
kubectl -n restate get restatedeployment durable-research -o yaml | sed -n '/status/,$p'
kubectl -n restate-operator logs deploy/restate-operator | grep -i durable-research
kubectl -n restate get pods -l app=durable-research          # must be READY 1/1
# confirm the register target matches the cluster Service (name/namespace: restate)
kubectl -n restate port-forward svc/restate 9070:9070        # then:
restate deployments list                                     # handlers should be listed
```

On minikube keep `security.disableNetworkPolicies: true` in the `RestateCluster` (the
default CNI doesn't enforce policies, but disabling makes it explicit and CNI-independent).

---

## 5. `CrashLoopBackOff` from a missing / mis-named secret

**Symptom:** the `durable-research` pod crashes or the first turn fails with a
`TerminalError` like `OPENAI_API_KEY is not set` / `TAVILY_API_KEY is not set`.

**Cause:** the `durable-research-secrets` Secret is missing, in the wrong namespace, or
the keys are named differently than the app reads (`OPENAI_API_KEY`, `TAVILY_API_KEY`).
The service starts without keys but throws on the first LLM/tool step.

**Fix:**

```bash
kubectl -n restate get secret durable-research-secrets -o jsonpath='{.data}' ; echo
set -a; source .env; set +a
kubectl -n restate create secret generic durable-research-secrets \
  --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY" \
  --from-literal=TAVILY_API_KEY="$TAVILY_API_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -      # create or update
kubectl -n restate logs -l app=durable-research --previous   # the crash before restart
```

`npm run cli health` (via the ingress) reports `openai`/`tavily` as booleans without
leaking values.

---

## 6. CLI / client times out on the ingress (port 8080)

**Symptom:** `npm run cli ...` hangs or refuses the connection.

**Cause:** talking to the wrong port (`9070` admin instead of `8080` ingress), the
port-forward isn't running, or the service was never registered (scenario 4).

**Fix:**

```bash
kubectl -n restate port-forward svc/restate 8080:8080        # ingress for clients
restate deployments list                                     # confirm handlers exist
RESTATE_INGRESS_URL=http://localhost:8080 npm run cli health # quick end-to-end check
```

The CLI needs **no** API keys (only the service pods do); it only needs
`RESTATE_INGRESS_URL` pointed at the forwarded ingress.

---

## 7. State lost after a restart / PVC not `Bound`

**Symptom:** after a `restate-0` restart, sessions/turns are gone and in-flight turns
don't resume.

**Cause:** the durable journal isn't on persistent storage — the PVC failed to bind, so
the StatefulSet fell back to nothing, or storage was misconfigured. With the operator the
StatefulSet + PVC are managed for you, so this is almost always a binding problem.

**Fix:**

```bash
kubectl -n restate get pvc                          # must be Bound
kubectl -n restate describe pvc -l app.kubernetes.io/name=restate | sed -n '/Events/,$p'
kubectl get pv                                       # backing volume exists?
```

Ensure `spec.storage.storageClassName` in the `RestateCluster` matches an existing
(default) StorageClass (`standard` on minikube). `storageRequestBytes` can be increased,
never decreased.

---

## 8. Versioned redeploy won't create a new version / old version won't drain

**Symptom:** you changed the service and re-applied, but the Restate UI still shows one
deployment / routes to the old behavior; or the old version lingers forever.

**Cause:** the `RestateDeployment` keys a new version off the **pod-template hash**, so
reusing the **same image tag** (with no other template change) produces no new version.
Conversely, an old version is deliberately kept alive until its in-flight invocations
finish — a long turn keeps the old ReplicaSet around until it completes.

**Fix:**

```bash
# trigger a real new version: build + load a NEW tag, then bump image: in the CR and apply
docker build --platform linux/arm64 -t durable-research:0.1.1 . && minikube image load durable-research:0.1.1
# edit k8s/restate-deployment.yaml image: durable-research:0.1.1, then:
kubectl apply -f k8s/restate-deployment.yaml
kubectl -n restate get rs -l app=durable-research    # old + new ReplicaSets during drain
restate deployments list                             # old marked draining until in-flight done
```

If the old version must go immediately, cancel its in-flight invocations (scenario 9).

---

## 9. Invocations stuck / retrying forever

**Symptom:** a turn never completes; Restate keeps retrying a handler.

**Cause:** the handler throws a *retryable* error every attempt (e.g. a tool call to an
unreachable host, or a missing key surfaced as retryable) instead of a `TerminalError`.
Restate retries non-terminal errors indefinitely by design.

**Fix:**

```bash
kubectl -n restate port-forward svc/restate 9070:9070   # admin
restate invocations list
restate invocations describe <id>      # see the failing journal entry + error
restate invocations cancel <id>        # stop a poison invocation
```

For genuinely unrecoverable input, the code throws `restate.TerminalError` so Restate
stops retrying (e.g. invalid tool args, missing required env). Transient
network/Tavily errors stay retryable on purpose.

---

## 10. NetworkPolicy denial or in-cluster DNS failure

**Symptom:** the operator can't reach the service to register (scenario 4), or pods can't
resolve `restate` / `durable-research` names.

**Cause:** under an enforcing CNI the `RestateCluster`'s default-deny NetworkPolicies
block traffic to/from namespaces that aren't allow-listed; or CoreDNS is unhealthy /
you're calling cross-namespace without an FQDN.

**Fix:**

```bash
# Local: keep policies disabled (minikube's default CNI ignores them anyway)
#   spec.security.disableNetworkPolicies: true   (in k8s/restate-cluster.yaml)
# If you enable a policy CNI (e.g. minikube start --cni=calico), instead label the
# app namespace so the cluster may egress to it:
kubectl label namespace restate allow.restate.dev/restate=true
# DNS sanity check from an ad-hoc pod:
kubectl -n restate run dbg --rm -it --image=busybox:1.36 -- \
  nslookup restate.restate.svc.cluster.local
kubectl -n kube-system get pods -l k8s-app=kube-dns      # CoreDNS healthy?
```

Use the FQDN `<svc>.<namespace>.svc.cluster.local` for any cross-namespace call.

---

## 11. `durable-research` pod `CrashLoopBackOff` with `exec format error`

**Symptom:** `kubectl -n restate get pods` shows `durable-research-*` flapping in
`CrashLoopBackOff`, and `kubectl -n restate logs -l app=durable-research` prints only:

```
exec /usr/local/bin/docker-entrypoint.sh: exec format error
```

**Cause:** the image's CPU architecture doesn't match the minikube node. On Apple Silicon
this is almost always a stray `DOCKER_DEFAULT_PLATFORM=linux/amd64` in your shell:
`docker build` (which doesn't pass `--platform`) then bakes an **amd64** image while the
node is **arm64**, so the kernel can't exec the binary. Unlike #3 the image pulls/loads
fine — `minikube image load` faithfully copies the wrong-arch image — it only fails at exec.

**Fix:**

```bash
echo "$DOCKER_DEFAULT_PLATFORM"                                              # often linux/amd64
uname -m                                                                     # host arch
kubectl get node minikube -o jsonpath='{.status.nodeInfo.architecture}{"\n"}' # node arch
docker image inspect durable-research:0.1.0 --format '{{.Architecture}}'     # image arch — the odd one out

# rebuild for the node's arch, replace the stale image, respin the pod:
docker build --platform linux/arm64 -t durable-research:0.1.0 .   # linux/amd64 on Intel minikube
minikube image rm durable-research:0.1.0                          # load won't overwrite an existing tag
minikube image load durable-research:0.1.0
kubectl -n restate delete pod -l app=durable-research
kubectl -n restate wait --for=condition=Ready pod -l app=durable-research --timeout=120s
```

Match `--platform` to the node arch on every build, or `unset DOCKER_DEFAULT_PLATFORM` so
`docker build` defaults to the host arch (which equals the node arch on minikube).

---

## Cheat sheet — the commands you'll reach for

```bash
# 1. State of everything (start here, every time)
kubectl get pods -A | grep -E 'restate|durable-research'

# 2. Why is THIS pod unhappy? (Events at the bottom: ImagePull, OOM, scheduling, probes)
kubectl -n restate describe pod <pod>

# 3. What did the app log? (-f follow; --previous = the crashed container)
kubectl -n restate logs -l app=durable-research -f
kubectl -n restate logs <pod> --previous

# 4. Operator reconciliation (registration/versioning happens here)
kubectl -n restate-operator logs deploy/restate-operator

# 5. CR status (cluster + service)
kubectl -n restate get restatecluster,restatedeployment
kubectl -n restate get restatedeployment durable-research -o yaml | sed -n '/status/,$p'

# 6. Reach Restate from your laptop (8080 ingress for clients, 9070 admin/UI)
kubectl -n restate port-forward svc/restate 8080:8080 9070:9070

# 7. Durable storage must be Bound
kubectl -n restate get pvc

# 8. Build the image into minikube (no registry push). --platform matches the node's arch;
#    without it a stray DOCKER_DEFAULT_PLATFORM bakes a wrong-arch image that won't exec (see #11).
docker build --platform linux/arm64 -t durable-research:0.1.0 . && minikube image load durable-research:0.1.0
minikube image ls | grep durable-research

# 9. Restate: deployments + invocations (needs admin port-forwarded, or RESTATE_ADMIN_URL)
restate deployments list
restate invocations list
restate invocations cancel <id>

# 10. Versions / ReplicaSets during a redeploy drain
kubectl -n restate get rs -l app=durable-research

# 11. Cluster-wide events, newest last (scheduling/quota/volume issues)
kubectl get events -A --sort-by=.lastTimestamp | tail -30

# 12. Resource usage (needs: minikube addons enable metrics-server)
kubectl top pods -A
```

### The 30-second triage loop

Run these in order and you'll localize ~90% of issues:

```bash
kubectl get pods -A | grep -E 'restate|durable-research'   # 1. who's not Running/Ready?
kubectl -n restate describe pod <bad-pod>                  # 2. why? (read Events)
kubectl -n restate logs <bad-pod> --previous               # 3. what did it say before dying?
kubectl -n restate-operator logs deploy/restate-operator   # 4. did the operator reconcile/register?
restate deployments list                                   # 5. is the service registered? (port-forward 9070)
```
