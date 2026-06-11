# Runbooks — Restate on minikube (Operator)

Step-by-step operational procedures for the local minikube deployment (Restate Operator +
`RestateCluster` + `RestateDeployment`). For symptom-driven debugging see
[`k8s-troubleshooting.md`](./k8s-troubleshooting.md); for the manifests see
[`../k8s/`](../k8s/).

All resources live in namespace **`restate`**; the operator runs in **`restate-operator`**.
The service image is **`durable-research:0.1.0`**. API keys come from the
**`durable-research-secrets`** Secret (never baked into the image).

## Prerequisites

- Docker, `minikube`, `kubectl`, `helm` installed. `restate` CLI optional (the UI covers
  most of it).
- A `.env` with `OPENAI_API_KEY` + `TAVILY_API_KEY` (copy from `.env.example`).
- A minikube with headroom: `minikube start --cpus=4 --memory=6144`.

Two `port-forward`s are used throughout (run each in its own terminal; they stay open):

```bash
kubectl -n restate port-forward svc/restate 8080:8080   # ingress (clients/CLI)
kubectl -n restate port-forward svc/restate 9070:9070   # admin + UI (http://localhost:9070)
```

---

## Runbook 1 — Deploy from scratch

**Goal:** bring the whole system up on a fresh minikube.

**Steps:**

```bash
# 1. Cluster + operator
minikube start --cpus=4 --memory=6144
helm install restate-operator oci://ghcr.io/restatedev/restate-operator-helm \
  --namespace restate-operator --create-namespace
kubectl -n restate-operator rollout status deploy/restate-operator

# 2. Restate server (the operator creates the StatefulSet + Service + PVC in ns restate)
kubectl apply -f k8s/restate-cluster.yaml
kubectl -n restate rollout status statefulset/restate --timeout=180s

# 3. Service image into the cluster (--platform pins the node arch; without it a stray
#    DOCKER_DEFAULT_PLATFORM bakes a wrong-arch image that won't exec — see k8s-troubleshooting.md #11)
docker build --platform linux/arm64 -t durable-research:0.1.0 .
minikube image load durable-research:0.1.0

# 4. Secret (keys only, from .env) + non-secret config
set -a; source .env; set +a
kubectl -n restate create secret generic durable-research-secrets \
  --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY" \
  --from-literal=TAVILY_API_KEY="$TAVILY_API_KEY"
kubectl apply -f k8s/config.yaml

# 5. Deploy the service (operator auto-registers it — no manual register step)
kubectl apply -f k8s/restate-deployment.yaml
# the operator makes a versioned ReplicaSet (not a Deployment), so wait on the pod:
kubectl -n restate wait --for=create pod -l app=durable-research --timeout=60s
kubectl -n restate wait --for=condition=Ready pod -l app=durable-research --timeout=120s
```

**Verify:**

```bash
kubectl get pods -A | grep -E 'restate|durable-research'    # operator, restate-0, durable-research all Running/Ready
kubectl -n restate port-forward svc/restate 8080:8080 &     # ingress
kubectl -n restate port-forward svc/restate 9070:9070 &     # admin/UI
restate deployments list                                    # durable-research handlers listed
# free, no-API-cost smoke test through the in-cluster ingress:
curl localhost:8080/greeter/greet --json '{"name":"Ada"}'   # -> "Hello, Ada! ..."
RESTATE_INGRESS_URL=http://localhost:8080 npm run cli health
```

**Rollback / clean slate:** see Runbook 6 (Teardown).

---

## Runbook 2 — Roll out a new version (zero-downtime) and roll back

**Goal:** ship a new build with no dropped/duplicated in-flight work, and revert if needed.
This exercises the operator's version-draining (the centerpiece durability demo).

**Prerequisites:** Runbook 1 done; ideally a long research turn in flight (so you can watch
it drain on the old version).

**Steps (roll out):**

```bash
# 1. Build + load a NEW immutable tag (a new pod template = a new Restate version)
docker build --platform linux/arm64 -t durable-research:0.1.1 .
minikube image load durable-research:0.1.1

# 2. Point the RestateDeployment at the new tag and apply
#    edit k8s/restate-deployment.yaml:  image: durable-research:0.1.1
kubectl apply -f k8s/restate-deployment.yaml

# 3. Watch the rollout: a new ReplicaSet appears; the old one stays until its
#    in-flight invocations finish, then drains.
kubectl -n restate get rs -l app=durable-research -w
restate deployments list        # new version active; old marked draining until done
```

**Verify:** new turns hit the new version while any in-flight turn completes on the old
version (watch it finish in the UI at http://localhost:9070), then the old ReplicaSet
scales to 0 and is removed — no turn was dropped or repeated.

**Rollback:** set `image:` back to `durable-research:0.1.0` in
[`k8s/restate-deployment.yaml`](../k8s/restate-deployment.yaml) and `kubectl apply` again
(this is just another versioned rollout, back to the previous image). If a bad new version
has a poison in-flight invocation, cancel it (Runbook 3).

---

## Runbook 3 — Recover a stuck / poison invocation

**Goal:** stop an invocation that retries forever (e.g. a handler hitting an unreachable
host) without tearing down the cluster.

**Steps:**

```bash
kubectl -n restate port-forward svc/restate 9070:9070    # admin (if not already)
restate invocations list                                 # find the stuck id
restate invocations describe <id>                        # inspect the failing journal entry
restate invocations cancel <id>                          # stop it (runs to a cancelled state)
```

**Verify:** `restate invocations list` no longer shows it as running/retrying; the
session's `getProgress` reports `failed`/cancelled rather than spinning.

**Notes:** transient errors (network/Tavily) are *meant* to retry. Only genuinely
unrecoverable input should be terminal — the code already throws `restate.TerminalError`
for invalid tool args / missing required env so Restate stops retrying those.

---

## Runbook 4 — Rotate API keys

**Goal:** replace `OPENAI_API_KEY` / `TAVILY_API_KEY` with no code or image change.

**Steps:**

```bash
# 1. Revoke/replace the key at the provider, update your local .env.
# 2. Recreate the Secret in-place (create-or-update):
set -a; source .env; set +a
kubectl -n restate create secret generic durable-research-secrets \
  --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY" \
  --from-literal=TAVILY_API_KEY="$TAVILY_API_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -
# 3. Restart the service pods so they pick up the new env (envFrom is read at start).
#    A RestateDeployment has no Deployment to `rollout restart`; delete the pod and the
#    operator's ReplicaSet recreates it:
kubectl -n restate delete pod -l app=durable-research
kubectl -n restate wait --for=condition=Ready pod -l app=durable-research --timeout=120s
```

**Verify:**

```bash
RESTATE_INGRESS_URL=http://localhost:8080 npm run cli health   # openai/tavily: true, status ok
```

**Rollback:** restore the previous key in `.env` and repeat. Never commit `.env`; rotate
immediately if a key ever lands in git history (the repo is public).

---

## Runbook 5 — Resume after pod / node loss (durability demo)

**Goal:** prove a turn survives losing the service pod (and the Restate pod) and resumes
without repeating completed work.

**Prerequisites:** a long research turn in flight:

```bash
RESTATE_INGRESS_URL=http://localhost:8080 npm run cli start          # -> <sessionId>
RESTATE_INGRESS_URL=http://localhost:8080 npm run cli turn <sessionId> \
  "Compare Datadog and Snowflake over the last three years"
```

**Steps:**

```bash
# A) Kill the SERVICE pod mid-turn — the ReplicaSet recreates it; Restate redelivers the
#    in-flight invocation and replays the journal (completed LLM/tool steps are NOT re-run).
kubectl -n restate delete pod -l app=durable-research

# B) (Optional) Kill the RESTATE pod — the StatefulSet recreates it; the PVC persists the
#    journal/state, so the turn resumes after restart.
kubectl -n restate delete pod restate-0
kubectl -n restate rollout status statefulset/restate
```

**Verify:** the CLI poll keeps streaming and the turn completes with a cited answer. In the
UI (http://localhost:9070) or `npm run cli trace <sessionId>`, the steps completed before
the kill show as replayed, not re-executed — no duplicate LLM call or web search.

---

## Runbook 6 — Teardown / reset

**Goal:** remove the app, the cluster, or the whole minikube — at the right blast radius.

```bash
# A) Just the service (keep Restate + its state):
kubectl delete -f k8s/restate-deployment.yaml
kubectl -n restate delete secret durable-research-secrets
kubectl delete -f k8s/config.yaml

# B) The Restate cluster too (this releases its PVC -> durable state is gone):
kubectl delete -f k8s/restate-cluster.yaml
kubectl -n restate get pvc        # confirm the PVC is removed (or delete it explicitly)

# C) The operator + CRDs:
helm uninstall restate-operator -n restate-operator

# D) Nuke everything (fastest full reset):
minikube delete
```

**Verify:** `kubectl get pods -A | grep -E 'restate|durable-research'` returns nothing
(A–C), or `minikube status` shows no cluster (D).
