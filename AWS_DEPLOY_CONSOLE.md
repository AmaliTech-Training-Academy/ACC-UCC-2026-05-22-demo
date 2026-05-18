# Deploy to AWS using only the console (no local CLI)

This is the **browser-only path**. You need an AWS account and a modern
browser. No Git Bash, no AWS CLI on your laptop, no Docker Desktop. All
the building, pushing, and deploying happens in **AWS CloudShell** — a
free, browser-based Linux shell that AWS provides with `aws`, `docker`,
`git`, and `node` already installed.

```
You ─→ AWS Console ─→ CloudShell (build + push to ECR)
                  └→ EC2 (launched via console, with SSM)
                  └→ SSM Session Manager (browser-based shell to EC2)
```

**Always tear it down when you're done — see "Cleanup" at the bottom.**

---

## 0. What you need

- An AWS account (signed up, payment method on file, billing alarm set —
  see [`PREREQUISITES.md`](./PREREQUISITES.md))
- A modern web browser

That's the entire prereq list.

---

## 1. Open CloudShell

In the **AWS Management Console**, look at the top bar. To the right of
the search box you'll see a small terminal icon (`>_`). Click it.

First boot takes ~60 seconds. When it's done you'll see a prompt like:

```
[cloudshell-user@ip-10-x-x-x ~]$
```

Confirm the tools are there:

```bash
aws --version
docker --version
git --version
```

> **What region is CloudShell in?** It runs in whatever AWS region the
> console shows in the top-right. Set it to **us-east-1 (N. Virginia)**
> before opening CloudShell — that's what this guide assumes.

---

## 2. Get the demo source into CloudShell

Clone the repo:

```bash
git clone https://github.com/AmaliTech-Training-Academy/ACC-UCC-2026-05-22-demo.git
cd ACC-UCC-2026-05-22-demo
```

> Alternative if git clone is blocked on your network: in CloudShell click
> **Actions → Upload file** and upload a zip of the source. Then `unzip` it
> and `cd` into the folder.

Confirm you see the right files:

```bash
ls
# expect: backend  frontend  docker-compose.yml  README.md  ...
```

---

## 3. Create the ECR repositories — via the console

Open a second tab in the AWS console:

1. Navigate to **Elastic Container Registry** (ECR)
2. **Repositories → Create repository**
3. Name: `notes-backend` → **Create**
4. Repeat: Name: `notes-frontend` → **Create**

Both repos now exist. The console gives you "View push commands" on each
repo's page — you can use those, or skip to the next step.

---

## 4. Build and push the images — in CloudShell

Back in the CloudShell tab, inside the `demo/` directory:

```bash
# Discover your AWS account ID + region
export AWS_REGION=$(aws configure get region)
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REGISTRY=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
echo "Registry: $ECR_REGISTRY"

# Log Docker in to ECR
aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin $ECR_REGISTRY

# Build both images
docker compose build

# Tag and push
docker tag notes-backend:latest  $ECR_REGISTRY/notes-backend:latest
docker tag notes-frontend:latest $ECR_REGISTRY/notes-frontend:latest
docker push $ECR_REGISTRY/notes-backend:latest
docker push $ECR_REGISTRY/notes-frontend:latest
```

Back in the ECR tab, click each repo → **Images** — you should see
`latest` tagged in both.

---

## 5. Create an IAM role for the EC2 — via the console

The EC2 instance needs to pull from ECR AND be reachable via Session
Manager. One role with two managed policies handles both.

1. Open **IAM → Roles → Create role**
2. **Trusted entity type:** AWS service
3. **Use case:** EC2 → **Next**
4. **Add permissions** — search and select both:
   - `AmazonEC2ContainerRegistryReadOnly`
   - `AmazonSSMManagedInstanceCore`
5. **Next**, name it `notes-ec2-role`, **Create role**

When you create an EC2 instance later, attaching this role automatically
creates a matching **instance profile** of the same name.

---

## 6. Launch the EC2 — via the console

1. Open **EC2 → Instances → Launch instances**
2. **Name:** `notes-demo`
3. **Application and OS Images** → search **Ubuntu** → select
   **Ubuntu Server 22.04 LTS** (free-tier eligible, `x86_64`)
4. **Instance type:** `t3.micro` (free-tier eligible)
5. **Key pair (login):** **Proceed without a key pair**
   We're using SSM Session Manager instead of SSH — no key needed.
6. **Network settings → Edit:**
   - Auto-assign public IP: **Enable**
   - **Create security group**
   - SG name: `notes-sg`
   - Remove the default "SSH from anywhere" rule (we don't need SSH)
   - Add rule: **Type = HTTP, Source = Anywhere (0.0.0.0/0)**
7. **Advanced details:**
   - **IAM instance profile:** `notes-ec2-role`
   - **User data** — paste this exactly:

```bash
#!/bin/bash
set -eux
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl awscli
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
usermod -aG docker ubuntu
```

8. **Launch instance**

It'll take ~2 minutes for the instance to boot and finish installing
Docker via user-data. Refresh **Instances** until **Instance state =
Running** and **Status check = 2/2 checks passed**.

Note the **Public IPv4 address** that appears on the instance details
page — you'll open it in your browser at the end.

---

## 7. Open a shell on the EC2 — via Session Manager

1. With the instance selected in the EC2 console, click **Connect**
2. Choose the **Session Manager** tab
3. Click **Connect**

A black terminal opens in your browser. You're connected as `ssm-user`.

Inside that shell:

```bash
# Switch to the ubuntu user (matches the SSH experience)
sudo su - ubuntu

# Sanity check
docker --version
```

If `docker --version` fails, user-data is still finishing — wait 30s and retry.

---

## 8. Log in to ECR from the EC2, write the compose file, run

Still inside the SSM session:

```bash
# Pick the same region + account values
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Log Docker in to ECR (uses the instance profile credentials)
aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin $ECR_REGISTRY

# Write the compose file with the ECR registry path baked in
mkdir -p ~/notes && cd ~/notes
cat > docker-compose.yml <<YAML
services:
  backend:
    image: $ECR_REGISTRY/notes-backend:latest
    container_name: notes-backend
    environment:
      - PORT=4000
      - NODE_ENV=production
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:4000/api/health || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 3s
    restart: unless-stopped
  frontend:
    image: $ECR_REGISTRY/notes-frontend:latest
    container_name: notes-frontend
    ports:
      - "80:80"
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped
YAML

# Pull and run
docker compose pull
docker compose up -d
docker compose ps
```

You should see backend `(healthy)` first, then frontend `Up`.

---

## 9. Open the app in your browser

Back in the EC2 console, find your instance's **Public IPv4 address**
(top of the instance details page). Open it in a new browser tab:

```
http://<your-public-ip>/
```

The Cloud Notes app loads. Add a note. The status badge says `ok`.

---

## 10. Demo on stage — break and recover

In the SSM shell:

```bash
docker compose stop backend       # the browser flips to "Backend: offline"
docker compose start backend      # ~5 seconds later, flips back to "ok"
```

Refresh the browser between commands to see the change live.

---

## 11. Cleanup — DO THIS WHEN YOU'RE DONE

All via the console:

1. **EC2 → Instances → notes-demo → Instance state → Terminate instance**
   (also deletes the auto-created network interface)
2. Wait for state = `Terminated`
3. **EC2 → Security Groups → notes-sg → Actions → Delete**
   (only works after the instance is fully terminated)
4. **ECR → Repositories:** select `notes-backend` and `notes-frontend` →
   **Delete** (check "I understand" to also delete the images inside)
5. **IAM → Roles → notes-ec2-role → Delete**
   (the matching instance profile is removed automatically when you
   delete the role from the console)

Sanity check: no instances running, no ECR repos, no `notes-ec2-role` —
you should be back to $0 / day.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| CloudShell won't open | Try a different region (top-right of the console) — CloudShell isn't available in every region. `us-east-1` always works. |
| `docker compose build` fails in CloudShell with "no space left on device" | CloudShell's home directory is 1 GB. Run `docker system prune -af` and retry. |
| ECR push: `denied: requested access to the resource is denied` | Your CloudShell session lost auth — re-run the `aws ecr get-login-password ...` line. |
| Session Manager: "Connection failed" | Either the instance is still booting (wait 60s), or the IAM role is missing `AmazonSSMManagedInstanceCore`. Check **IAM → Roles → notes-ec2-role → Permissions**. |
| Browser shows nothing at `http://<ip>/` | In the SSM shell: `docker compose logs --tail 50` to find which service is failing. |
| `/api/notes` returns 502 Bad Gateway | Backend container isn't healthy yet — `docker compose ps` should show `(healthy)`. Wait 10s, refresh. |
| Public IP changed after stop/start | EC2 public IPs are not stable across stop/start. Either don't stop it, or allocate an **Elastic IP** and associate it with the instance. |

---

## What's next

Once this is working, the same demo is ready to evolve into:

- **Amazon DynamoDB** as the notes store (so they survive restarts)
- **S3 + CloudFront** for the React build (cheaper, CDN-backed)
- **Application Load Balancer + HTTPS** in front of the EC2 (via ACM)
- **GitHub Actions** that builds, pushes to ECR, and triggers redeploy on every push

Each one swaps in one AWS service at a time — same demo, more cloud.
