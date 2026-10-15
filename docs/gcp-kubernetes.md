# Kubernetes on Google Cloud: should RabbitOS use it?

**Short answer: not today.** Cloud Run already does what a cluster would do for these services, with less to run and pay for. A cluster is ready to create if you want one, with one command, and one command removes it.

## What runs where now

| Service | Runs on | Why it fits |
|---|---|---|
| Visitor shell | Cloud Run, one visitor per instance, up to 6, scales to zero | A clean container per visitor that exits when the session ends is exactly Cloud Run's model with concurrency 1. |
| Hub MCP | Cloud Run, scales to zero | Stateless, small, public. |
| Standby website | Cloud Run, scales to zero | Static files. |
| App mirror | Cloud Run | Existing. |
| Egress proxy | one small VM (Compute Engine) | A fixed address that the firewall allows. |

## What a GKE Autopilot cluster would add (and cost)

- **Adds:** Kubernetes tooling (kubectl, Helm, manifests), long-running or stateful workloads, GPUs, many cooperating services, CronJobs with many steps.
- **Costs:** a cluster does not scale to zero. Google charges a cluster management fee (as I understand it, one Autopilot or zonal cluster per billing account is covered by a monthly free credit; this is **unverified**, check the current pricing page), plus per-pod CPU and memory while pods run. An external load balancer in front of it has its own fixed monthly charge, so the manifest here is private (ClusterIP only).
- **Needs from you:** upgrades, pod security, Kubernetes access control, and watching it. Cloud Run needs none of that.
- **Does not fix anything today:** the shell's isolation, the egress limit and the credit usage already work on Cloud Run.

## What would justify a cluster

A fleet of long-running research agents, a GPU or batch workload, or wanting everything expressed as Kubernetes manifests. None of these exist yet.

## For scheduled or batch work, use the serverless route first

Cloud Run **Jobs** plus **Cloud Scheduler** run a container on a schedule and cost nothing between runs. A cloud-side copy of the rabbit web miner (which only reads public pages and writes a snapshot to the public bucket) would fit there.

## If you still want a cluster

```powershell
cd C:\Users\odaat\Projects\rabbit-web\scripts\powershell
.\Setup-GcpGke.ps1 -WhatIf      # the plan
.\Setup-GcpGke.ps1              # creates rabbit-cluster (Autopilot, us-west2, deletion protection on), about ten minutes, then runs the hub on it privately
.\Setup-GcpGke.ps1 -Delete      # removes it again (the only way to stop its charges)
```

`kubectl -n rabbitos port-forward svc/hub-mcp 8081:80` reaches it. The manifest is `rabbitsoftware-cloudflare/workers/hub-mcp/k8s/hub.yaml`; it could not be checked offline, so the first `kubectl apply` is its real test. The Kubernetes Engine API is **not** enabled yet; the script enables it.
