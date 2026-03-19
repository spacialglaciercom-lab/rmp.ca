# OSRM on GKE: Self-hosted routing

This guide gets the app using **your** OSRM instance in GKE instead of the public `router.project-osrm.org`.

---

## 1. Create the OSRM data volume and run the one-time preprocess Job

OSRM needs preprocessed OSM data (extract → partition → customize). Run the Job once; it fills the PVC.

```bash
# Ensure you're in the right cluster and namespace
kubectl config use-context <your-gke-context>
kubectl get ns rmpca || kubectl create namespace rmpca

# Create the PVC and the preprocess Job (do not apply the full k8s/ yet if you want to run the Job in isolation)
kubectl apply -f k8s/osrm-pvc.yaml
kubectl apply -f k8s/osrm-preprocess-job.yaml

# Wait for the Job to complete (Quebec ~15–30 min; full Canada 1–2 h)
kubectl wait --for=condition=complete job/osrm-preprocess -n rmpca --timeout=2h
```

To use **full Canada** instead of Quebec, edit `k8s/osrm-preprocess-job.yaml` and set:

```yaml
- name: PBF_URL
  value: "https://download.geofabrik.de/north-america/canada-latest.osm.pbf"
```

Then re-apply the Job (delete the completed job first if you want to re-run: `kubectl delete job osrm-preprocess -n rmpca`).

---

## 2. Deploy OSRM and the rest of the stack

If you haven’t applied the rest of the manifests yet:

```bash
kubectl apply -k k8s/
```

If you already applied `k8s/` (including `osrm-deployment.yaml` and `osrm-service.yaml`), the OSRM deployment may be in CrashLoopBackOff until the Job fills the PVC. Once the Job has completed, restart the OSRM pods so they see the data:

```bash
kubectl delete pods -n rmpca -l app=osrm
kubectl get pods -n rmpca -l app=osrm
kubectl logs -n rmpca deployment/osrm -f
```

---

## 3. Point the backend at OSRM

Set `OSRM_URL` in the backend secret to the **in-cluster** OSRM service URL. The Node BFF proxies `/api/osrm/*` to this URL and returns the proxy address in `GET /api/config`, so the app (browser/mobile) uses your backend as the OSRM base and never needs to reach the cluster-internal hostname.

```bash
# Add OSRM_URL to the secret (merge with existing keys)
kubectl patch secret backend-secret -n rmpca --type=merge -p '{"stringData":{"OSRM_URL":"http://osrm.rmpca.svc.cluster.local:5000"}}'
```

If you create the secret from an env file, add to `.env.server`:

```bash
OSRM_URL=http://osrm.rmpca.svc.cluster.local:5000
```

Then recreate the secret (back up existing values if needed):

```bash
kubectl create secret generic backend-secret \
  --namespace=rmpca \
  --from-env-file=.env.server \
  --dry-run=client -o yaml | kubectl apply -f -
```

---

## 4. Restart the backend so it picks up the new env

```bash
kubectl rollout restart deployment/backend -n rmpca
kubectl rollout status deployment/backend -n rmpca
```

---

## 5. Verify

- Backend returns the **proxy** URL in config (so the client calls your backend, which forwards to OSRM):
  ```bash
  curl -s https://<your-backend-host>/api/config
  ```
  You should see `"osrmUrl":"https://<your-backend-host>/api/osrm"` (the backend proxies to the in-cluster OSRM).

- In the app, choose **OSRM** as the routing provider (Settings → Navigation). Routes should be served by your in-cluster OSRM via the backend proxy.

---

## Summary

| Step | Action |
|------|--------|
| 1 | `kubectl apply -f k8s/osrm-pvc.yaml` and `kubectl apply -f k8s/osrm-preprocess-job.yaml` |
| 2 | `kubectl wait --for=condition=complete job/osrm-preprocess -n rmpca --timeout=2h` |
| 3 | Apply the rest if needed: `kubectl apply -k k8s/` |
| 4 | Set `OSRM_URL=http://osrm.rmpca.svc.cluster.local:5000` in backend-secret |
| 5 | `kubectl rollout restart deployment/backend -n rmpca` |

After this, the app uses your GKE OSRM when OSRM is selected as the routing provider.
