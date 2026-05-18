# Deploying the demo to AWS (EC2, via `scp`)

The two containers you built locally can run unchanged on a single EC2
instance. This guide takes the simplest path — no registry, no extra
AWS services:

```
docker build (laptop)  →  docker save → scp → docker load (EC2)  →  public IP
```

Estimated cost: a `t3.micro` is free-tier eligible for 12 months on a new
account. Outside the free tier, this demo costs ~$0.30 / day if you leave
it running, and zero once you terminate.

**Always tear it down when you're done — see "Cleanup" at the bottom.**

> The frontend uses Nginx to reverse-proxy `/api/*` to the backend
> container, so the React image is portable: it doesn't bake any host or
> IP at build time. You build the images once and they run anywhere.

---

## 0. Prerequisites (one-time)

1. **AWS account** — sign up at <https://aws.amazon.com>. Set a $1
   CloudWatch billing alarm on day one.
2. **AWS CLI** installed locally:
   - macOS: `brew install awscli`
   - Linux: `sudo apt install awscli` (or the AWS install guide)
   - Windows: `winget install Amazon.AWSCLI`
3. **An IAM user with programmatic access** — in the AWS console:
   IAM → Users → Create user. Attach `AmazonEC2FullAccess` for this
   demo (in production you'd scope it tighter).
4. **Docker** running locally (Docker Desktop or Docker Engine).

Configure the CLI once:

```bash
aws configure
# AWS Access Key ID:     <paste from IAM>
# AWS Secret Access Key: <paste from IAM>
# Default region name:   eu-west-1
# Default output format: json
```

Verify:

```bash
aws sts get-caller-identity
```

You should see your account ID and the IAM user ARN.

---

## 1. Set environment variables

Open one terminal and stay in it for the whole walkthrough:

```bash
export AWS_REGION=eu-west-1
```

---

## 2. Build the images locally

```bash
cd demo
docker compose build
```

You get two images:

- `notes-backend:latest`
- `notes-frontend:latest`

Confirm:

```bash
docker images | grep notes
```

---

## 3. Save the images to tar files

```bash
docker save -o /tmp/notes-backend.tar  notes-backend:latest
docker save -o /tmp/notes-frontend.tar notes-frontend:latest
ls -lh /tmp/notes-*.tar
```

You should see two files totalling ~150 MB.

> **Want it smaller?** Pipe through gzip: `docker save notes-backend:latest | gzip > /tmp/notes-backend.tgz`. Halves the size at the cost of a tiny CPU pause.

---

## 4. Create a security group

```bash
# Default VPC
export VPC_ID=$(aws ec2 describe-vpcs \
  --filters Name=is-default,Values=true \
  --query "Vpcs[0].VpcId" --output text --region $AWS_REGION)

# Create the SG
aws ec2 create-security-group \
  --group-name notes-sg \
  --description "Notes demo: HTTP + SSH" \
  --vpc-id $VPC_ID --region $AWS_REGION

export SG_ID=$(aws ec2 describe-security-groups \
  --filters Name=group-name,Values=notes-sg \
  --query "SecurityGroups[0].GroupId" --output text --region $AWS_REGION)

# Allow SSH from YOUR laptop's PUBLIC IP only
# (Private IPs like 192.168.x.x are invisible across the internet;
#  AWS only ever sees the public IP your ISP gives you.)
export MY_IP=$(curl -s https://checkip.amazonaws.com)/32
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID --protocol tcp --port 22 --cidr $MY_IP \
  --region $AWS_REGION

# Allow HTTP from anywhere
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID --protocol tcp --port 80 --cidr 0.0.0.0/0 \
  --region $AWS_REGION
```

> **Want to use EC2 Instance Connect (the browser-based SSH tab in the
> AWS console) instead of / in addition to your laptop?** Connections
> from Instance Connect come from an AWS-owned IP range, not from your
> laptop. Allow that range too:
> ```bash
> EIC_CIDR=$(curl -s https://ip-ranges.amazonaws.com/ip-ranges.json \
>   | jq -r ".prefixes[]
>            | select(.service==\"EC2_INSTANCE_CONNECT\" and .region==\"$AWS_REGION\")
>            | .ip_prefix" | head -1)
> aws ec2 authorize-security-group-ingress \
>   --group-id $SG_ID --protocol tcp --port 22 --cidr $EIC_CIDR \
>   --region $AWS_REGION
> ```
> For `eu-west-1` today that's `18.202.216.48/29`, but AWS rotates these
> — always query.

---

## 5. Create an SSH key pair

```bash
aws ec2 create-key-pair \
  --key-name notes-key \
  --query "KeyMaterial" --output text \
  --region $AWS_REGION > ~/.ssh/notes-key.pem

chmod 400 ~/.ssh/notes-key.pem
```

---

## 6. Create an IAM role for SSM Session Manager

This is what lets you click **Connect → Session Manager** in the AWS
console and get a shell in your browser — no SSH, no key, no SG rule.
SSH is still required for the `scp` in step 9, but SSM is the easiest
debugging path once the instance is running.

```bash
# Trust policy — allow EC2 to assume this role
cat > /tmp/ec2-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ec2.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF

aws iam create-role \
  --role-name notes-ssm-role \
  --assume-role-policy-document file:///tmp/ec2-trust.json

aws iam attach-role-policy \
  --role-name notes-ssm-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore

aws iam create-instance-profile --instance-profile-name notes-ssm-profile
aws iam add-role-to-instance-profile \
  --instance-profile-name notes-ssm-profile \
  --role-name notes-ssm-role
```

The Canonical Ubuntu 22.04 AMI ships with the SSM agent (as a snap) and
starts it automatically, so no other setup is needed on the instance.

> **Already launched the instance without the profile?** Attach it after
> the fact:
> ```bash
> aws ec2 associate-iam-instance-profile \
>   --instance-id $INSTANCE_ID \
>   --iam-instance-profile Name=notes-ssm-profile \
>   --region $AWS_REGION
> ```
>
> Then **SSH in and restart the SSM agent** — the agent only fetches
> credentials at startup, so it won't see the new role until it restarts:
> ```bash
> ssh -i ~/.ssh/notes-key.pem ubuntu@$PUBLIC_IP \
>   "sudo snap restart amazon-ssm-agent"
> ```
> The instance appears in **Systems Manager → Fleet Manager → Managed
> nodes** within ~60 seconds, state `Online`. Then **EC2 → Connect →
> Session Manager** will work.
>
> If you skip the restart, the instance never registers and Session
> Manager fails with `Error establishing SSH connection` — that error
> message is misleading, it's really an SSM-agent-not-registered error.

---

## 7. Launch the EC2 instance

User-data installs Docker on first boot so the box is ready by the time
you SSH in:

```bash
cat > /tmp/userdata.sh <<'EOF'
#!/bin/bash
set -eux

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
usermod -aG docker ubuntu
EOF
```

Pick the latest Ubuntu 22.04 LTS (Jammy) AMI for your region (owner
`099720109477` is Canonical, the publisher of Ubuntu on AWS):

```bash
export AMI_ID=$(aws ec2 describe-images \
  --owners 099720109477 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd*/ubuntu-jammy-22.04-amd64-server-*" "Name=state,Values=available" \
  --query "sort_by(Images, &CreationDate)[-1].ImageId" \
  --output text --region $AWS_REGION)
echo "AMI: $AMI_ID"
```

Launch (with the SSM instance profile from step 6 attached):

```bash
aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type t3.micro \
  --key-name notes-key \
  --security-group-ids $SG_ID \
  --iam-instance-profile Name=notes-ssm-profile \
  --user-data file:///tmp/userdata.sh \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=notes-demo}]" \
  --region $AWS_REGION
```

> **Heads-up — IAM eventual consistency:** if the launch fails with
> `InvalidParameterValue: ... iamInstanceProfile.name is invalid`, wait
> 30 seconds and retry. IAM takes a few seconds to propagate the new
> instance profile globally.

---

## 8. Get the public IP

```bash
export INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=notes-demo" "Name=instance-state-name,Values=pending,running" \
  --query "Reservations[0].Instances[0].InstanceId" \
  --output text --region $AWS_REGION)

aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $AWS_REGION

export PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids $INSTANCE_ID \
  --query "Reservations[0].Instances[0].PublicIpAddress" \
  --output text --region $AWS_REGION)

echo "EC2 IP: $PUBLIC_IP"
```

Wait ~60 seconds after the wait command returns — Docker is still
installing via user-data even though the instance is "running."

---

## 9. Copy the images to the EC2

```bash
scp -i ~/.ssh/notes-key.pem \
  /tmp/notes-backend.tar /tmp/notes-frontend.tar \
  ubuntu@$PUBLIC_IP:~/
```

Expect a ~10–30 second transfer on a decent connection.

> **One-liner alternative (no tar files on disk):**
> ```bash
> docker save notes-backend:latest | ssh -i ~/.ssh/notes-key.pem ubuntu@$PUBLIC_IP "docker load"
> docker save notes-frontend:latest | ssh -i ~/.ssh/notes-key.pem ubuntu@$PUBLIC_IP "docker load"
> ```
> Pipes the image straight from your laptop into Docker on the EC2.

---

## 10. Get a shell on the EC2 — SSH or SSM

You can use either:

- **SSH:** `ssh -i ~/.ssh/notes-key.pem ubuntu@$PUBLIC_IP`
- **SSM Session Manager** (browser-based, no key, no port 22): in the
  AWS console go to **EC2 → Instances → notes-demo → Connect → Session
  Manager → Connect**. Opens a shell in the browser as `ssm-user`; run
  `sudo su - ubuntu` if you want the same env as the SSH session.

Inside the EC2 session:

```bash
# Load the images into the EC2's Docker
docker load -i ~/notes-backend.tar
docker load -i ~/notes-frontend.tar
docker images | grep notes

# Write a tiny compose file
mkdir -p ~/notes && cd ~/notes
cat > docker-compose.yml <<'YAML'
services:
  backend:
    image: notes-backend:latest
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
    image: notes-frontend:latest
    container_name: notes-frontend
    ports:
      - "80:80"
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped
YAML

# Start everything
docker compose up -d
docker compose ps
```

Both containers should show `Up`.

> If you get `permission denied while trying to connect to the Docker
> daemon`, type `newgrp docker` once (the user-data added you to the
> docker group on first login).

---

## 11. Open the app

Back on your laptop:

```bash
echo "Open: http://$PUBLIC_IP/"
```

Hit that URL in a browser — the same React app from your laptop, now on
the public internet.

---

## 12. Redeploy after a code change

```bash
# Rebuild locally
docker compose build

# Re-save the changed image
docker save notes-backend:latest | ssh -i ~/.ssh/notes-key.pem ubuntu@$PUBLIC_IP "docker load"

# Restart on the EC2
ssh -i ~/.ssh/notes-key.pem ubuntu@$PUBLIC_IP \
  "cd ~/notes && docker compose up -d --force-recreate backend"
```

Same shape for the frontend — swap `notes-backend` for `notes-frontend`.

---

## 13. Cleanup — DO THIS WHEN YOU'RE DONE

EC2 bills per second the instance is running.

```bash
# Terminate the EC2 instance
aws ec2 terminate-instances --instance-ids $INSTANCE_ID --region $AWS_REGION
aws ec2 wait instance-terminated --instance-ids $INSTANCE_ID --region $AWS_REGION

# Delete the security group
aws ec2 delete-security-group --group-id $SG_ID --region $AWS_REGION

# Delete the key pair (and the local file)
aws ec2 delete-key-pair --key-name notes-key --region $AWS_REGION
rm -f ~/.ssh/notes-key.pem

# Detach + delete the SSM IAM role + instance profile
aws iam remove-role-from-instance-profile \
  --instance-profile-name notes-ssm-profile --role-name notes-ssm-role
aws iam delete-instance-profile --instance-profile-name notes-ssm-profile
aws iam detach-role-policy \
  --role-name notes-ssm-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam delete-role --role-name notes-ssm-role

# Remove the local tar files
rm -f /tmp/notes-backend.tar /tmp/notes-frontend.tar /tmp/userdata.sh /tmp/ec2-trust.json
```

Sanity check:

```bash
aws ec2 describe-instances --filters Name=tag:Name,Values=notes-demo \
  --query "Reservations[].Instances[].State.Name" --region $AWS_REGION
```

Should be empty or `terminated`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ssh: connection refused` immediately after launch | The instance is still booting — wait 30 seconds and retry |
| `permission denied (publickey)` on SSH | Wrong key, wrong username, or wrong IP. User is `ubuntu` (Ubuntu AMIs use this; not `ec2-user`), key is `~/.ssh/notes-key.pem`, mode must be `400`. |
| `Cannot connect to the Docker daemon` on SSH | Docker just installed — log out, log back in, or run `newgrp docker` |
| `port 80 already in use` on `docker compose up` | Another process owns 80 — `sudo lsof -i :80` to find it (usually a leftover container — `docker ps -a`) |
| Browser shows nothing at `http://<ip>/` | SSH in: `docker compose logs --tail 50` to find the failing service |
| `/api/notes` returns 502 Bad Gateway | Backend isn't healthy — `docker logs notes-backend --tail 100` |
| Session Manager: `Failed to connect / Error establishing SSH connection` | The SSM agent isn't registered. Verify the instance shows up under **Systems Manager → Fleet Manager → Managed nodes**. If missing and you attached the IAM profile after launch, SSH in and `sudo snap restart amazon-ssm-agent`, then re-check Fleet Manager after 60s. Also confirm you're clicking the **Session Manager** tab, not **EC2 Instance Connect**. |

---

## What's next (after this works)

- Swap the in-memory notes array for **Amazon DynamoDB** so notes survive
  restarts — the only AWS dep your code touches
- Graduate to **ECS Fargate** when you want auto-scaling instead of one
  box you SSH into
- Move the React build off the EC2 onto **S3 + CloudFront** for a real
  CDN — and keep the backend container on EC2
- Wire up **CloudWatch Logs** so you don't have to SSH for logs
- Replace these manual CLI calls with a **GitHub Actions** workflow:
  build, save, scp, restart — all on push to main
