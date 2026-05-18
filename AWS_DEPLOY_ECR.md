# Deploying the demo to AWS via ECR + EC2

This is the production-shaped path: push your container images to
**Amazon ECR** (Elastic Container Registry), then have an EC2 instance
pull them down using an IAM role.

```
docker build (laptop)  →  Amazon ECR  →  EC2 pulls via instance profile  →  public IP
```

It's more steps than the `scp`-based path in
[`AWS_DEPLOY.md`](./AWS_DEPLOY.md), but it's how real teams ship to AWS:
the registry decouples build from deploy, and the instance profile means
no AWS credentials ever live on the EC2.

**Always tear it down when you're done — see "Cleanup" at the bottom.**

> The frontend uses Nginx to reverse-proxy `/api/*` to the backend
> container, so the React image is portable: it doesn't bake any host or
> IP at build time. Build the images once and they run anywhere.

---

## 0. Prerequisites (one-time)

1. **AWS account** — sign up at <https://aws.amazon.com>. Set a $1
   CloudWatch billing alarm on day one.
2. **AWS CLI** installed locally:
   - macOS: `brew install awscli`
   - Linux: `sudo apt install awscli` (or the AWS install guide)
   - Windows: `winget install Amazon.AWSCLI`
3. **An IAM user with programmatic access** — in the AWS console:
   IAM → Users → Create user. Attach these managed policies for this demo:
   - `AmazonEC2ContainerRegistryFullAccess`
   - `AmazonEC2FullAccess`
   - `IAMFullAccess` (only because step 5 creates a role; in production
     you'd scope this much tighter)
4. **Docker** running locally (Docker Desktop or Docker Engine).

Configure the CLI once:

```bash
aws configure
# AWS Access Key ID:     <paste from IAM>
# AWS Secret Access Key: <paste from IAM>
# Default region name:   us-east-1
# Default output format: json
```

Verify:

```bash
aws sts get-caller-identity
```

You should see your account ID and the IAM user ARN.

---

## 1. Set environment variables

```bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REGISTRY=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
echo "Registry: $ECR_REGISTRY"
```

---

## 2. Build the images locally

Clone the repo if you haven't already, then build:

```bash
git clone https://github.com/AmaliTech-Training-Academy/ACC-UCC-2026-05-22-demo.git
cd ACC-UCC-2026-05-22-demo
docker compose build
```

You get two images:

- `notes-backend:latest`
- `notes-frontend:latest`

---

## 3. Push the images to Amazon ECR

### 3a. Create the two repositories

```bash
aws ecr create-repository --repository-name notes-backend  --region $AWS_REGION
aws ecr create-repository --repository-name notes-frontend --region $AWS_REGION
```

(If they already exist, ECR returns `RepositoryAlreadyExistsException` —
safe to ignore.)

### 3b. Log Docker in to ECR

```bash
aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin $ECR_REGISTRY
```

Expect: `Login Succeeded`. The token is valid for 12 hours.

### 3c. Tag the local images for ECR

```bash
docker tag notes-backend:latest  $ECR_REGISTRY/notes-backend:latest
docker tag notes-frontend:latest $ECR_REGISTRY/notes-frontend:latest
```

### 3d. Push them

```bash
docker push $ECR_REGISTRY/notes-backend:latest
docker push $ECR_REGISTRY/notes-frontend:latest
```

Verify in the console: **ECR → Repositories → Images**.

---

## 4. Create an IAM role for the EC2 instance

The EC2 instance needs to pull from ECR. Instead of putting credentials
on the box, you attach an IAM role and EC2 hands out short-lived
credentials automatically.

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
  --role-name notes-ec2-role \
  --assume-role-policy-document file:///tmp/ec2-trust.json

# Attach the AWS-managed ECR read-only policy
aws iam attach-role-policy \
  --role-name notes-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly

# Attach the SSM policy so you can also use Session Manager (browser-
# based shell) in addition to (or instead of) SSH
aws iam attach-role-policy \
  --role-name notes-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore

# Wrap the role in an "instance profile" so EC2 can attach it
aws iam create-instance-profile --instance-profile-name notes-ec2-profile
aws iam add-role-to-instance-profile \
  --instance-profile-name notes-ec2-profile \
  --role-name notes-ec2-role
```

> **What you just gave the instance:**
> - **ECR read** — so user-data can `docker login` and `docker pull`
> - **SSM core** — so you can click **Connect → Session Manager** in the
>   console and get a browser-based shell, no SSH required. The Canonical
>   Ubuntu 22.04 AMI ships the SSM agent as a snap and starts it
>   automatically.

---

## 5. Create a security group

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
> AWS console)?** Connections from Instance Connect come from an
> AWS-owned IP range, not from your laptop. Allow that range too:
> ```bash
> EIC_CIDR=$(curl -s https://ip-ranges.amazonaws.com/ip-ranges.json \
>   | jq -r ".prefixes[]
>            | select(.service==\"EC2_INSTANCE_CONNECT\" and .region==\"$AWS_REGION\")
>            | .ip_prefix" | head -1)
> aws ec2 authorize-security-group-ingress \
>   --group-id $SG_ID --protocol tcp --port 22 --cidr $EIC_CIDR \
>   --region $AWS_REGION
> ```
> If you're using Session Manager (the recommended path — see step 4 for
> the SSM policy), you don't need this — SSM works over outbound HTTPS
> with no inbound rules at all.

---

## 6. Create an SSH key pair

```bash
aws ec2 create-key-pair \
  --key-name notes-key \
  --query "KeyMaterial" --output text \
  --region $AWS_REGION > ~/.ssh/notes-key.pem

chmod 400 ~/.ssh/notes-key.pem
```

---

## 7. Launch the EC2 instance

User-data installs Docker, logs into ECR via the instance profile, writes
a compose file, and starts the containers — no manual SSH needed for the
happy path.

```bash
cat > /tmp/userdata.sh <<EOF
#!/bin/bash
set -eux

export DEBIAN_FRONTEND=noninteractive

# Install Docker + the compose plugin, plus AWS CLI for the ECR login
apt-get update
apt-get install -y ca-certificates curl awscli

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \$(. /etc/os-release && echo \$VERSION_CODENAME) stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
usermod -aG docker ubuntu

# Log in to ECR using the instance profile credentials
aws ecr get-login-password --region ${AWS_REGION} \
  | docker login --username AWS --password-stdin ${ECR_REGISTRY}

# Write a tiny compose file that pulls from ECR
mkdir -p /opt/notes
cat > /opt/notes/docker-compose.yml <<'YAML'
services:
  backend:
    image: ${ECR_REGISTRY}/notes-backend:latest
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
    image: ${ECR_REGISTRY}/notes-frontend:latest
    container_name: notes-frontend
    ports:
      - "80:80"
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped
YAML

cd /opt/notes
docker compose pull
docker compose up -d
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

Launch:

```bash
aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type t3.micro \
  --key-name notes-key \
  --security-group-ids $SG_ID \
  --iam-instance-profile Name=notes-ec2-profile \
  --user-data file:///tmp/userdata.sh \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=notes-demo}]" \
  --region $AWS_REGION
```

> **Heads-up — IAM eventual consistency:** if the launch fails with
> `InvalidParameterValue: ... iamInstanceProfile.name is invalid`, wait
> 30 seconds and rerun. IAM takes a few seconds to propagate the new
> instance profile globally.

---

## 8. Get the public IP and open the app

It takes ~2 minutes for the instance to boot, pull the images, and start
the containers.

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

echo "Open: http://$PUBLIC_IP/"
```

Visit that URL in your browser. The same React app you ran locally — now
on the public internet.

---

## 9. Get a shell on the EC2 if you need to debug

You have two options — pick either:

- **SSH:** `ssh -i ~/.ssh/notes-key.pem ubuntu@$PUBLIC_IP`
- **SSM Session Manager** (no key, no port 22): in the AWS console go to
  **EC2 → Instances → notes-demo → Connect → Session Manager → Connect**.
  Opens a shell in the browser as `ssm-user`; run `sudo su - ubuntu` if
  you want the same env as the SSH session.

Useful commands once you're in:

```bash
sudo docker ps                              # are both containers up?
sudo docker logs notes-backend --tail 50    # backend logs
sudo docker logs notes-frontend --tail 50   # nginx logs
sudo tail -f /var/log/cloud-init-output.log # user-data script output
```

---

## 10. Redeploy after a code change

```bash
# Rebuild locally
docker compose build

# Push the changed image(s)
docker tag notes-backend:latest $ECR_REGISTRY/notes-backend:latest
docker push $ECR_REGISTRY/notes-backend:latest

# On the EC2, pull & restart
ssh -i ~/.ssh/notes-key.pem ubuntu@$PUBLIC_IP \
  "cd /opt/notes && sudo docker compose pull && sudo docker compose up -d"
```

---

## 11. Cleanup — DO THIS WHEN YOU'RE DONE

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

# Delete the ECR repositories (and all images inside)
aws ecr delete-repository --repository-name notes-backend  --force --region $AWS_REGION
aws ecr delete-repository --repository-name notes-frontend --force --region $AWS_REGION

# Detach + delete the IAM role + instance profile
aws iam remove-role-from-instance-profile \
  --instance-profile-name notes-ec2-profile --role-name notes-ec2-role
aws iam delete-instance-profile --instance-profile-name notes-ec2-profile
aws iam detach-role-policy \
  --role-name notes-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
aws iam detach-role-policy \
  --role-name notes-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam delete-role --role-name notes-ec2-role
```

Sanity check:

```bash
aws ec2 describe-instances --filters Name=tag:Name,Values=notes-demo \
  --query "Reservations[].Instances[].State.Name" --region $AWS_REGION
aws ecr describe-repositories --region $AWS_REGION
```

First should be empty (or `terminated`); second should not list
`notes-backend` or `notes-frontend`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `no basic auth credentials` on `docker push` | Re-run step 3b — the ECR login token expired |
| `denied: requested access to the resource is denied` | Your IAM user is missing `AmazonEC2ContainerRegistryFullAccess` |
| EC2 launch fails: `iamInstanceProfile.name is invalid` | IAM eventual consistency — wait 30 seconds and retry |
| Browser shows nothing at `http://<ip>/` after 2 min | SSH in, check `sudo tail -f /var/log/cloud-init-output.log` for user-data errors |
| `Cannot connect to the Docker daemon` on SSH | The `ubuntu` user's `docker` group membership only takes effect on next login — run `newgrp docker`, or log out and back in |
| `/api/notes` returns 502 Bad Gateway | Backend container failed to start — `sudo docker logs notes-backend --tail 100` |
| User-data fails at `docker login` step | The instance profile didn't attach — confirm with `aws ec2 describe-instances --instance-ids $INSTANCE_ID --query "Reservations[0].Instances[0].IamInstanceProfile"` |
| Session Manager: `Failed to connect / Error establishing SSH connection` | The SSM agent isn't registered with SSM. Check **Systems Manager → Fleet Manager → Managed nodes** — if the instance is missing, SSH in and `sudo snap restart amazon-ssm-agent`. Also confirm you're on the **Session Manager** tab, not **EC2 Instance Connect**. |

---

## What's next (after this works)

- Swap the in-memory notes array for **Amazon DynamoDB** so notes survive
  restarts
- Move the React build off EC2 onto **S3 + CloudFront** for a real CDN —
  keep the backend container on EC2 / ECS
- Wire up **CloudWatch Logs** so you don't have to SSH for logs
- Replace the manual CLI calls with a **GitHub Actions** workflow using
  `aws-actions/configure-aws-credentials` and `aws-actions/amazon-ecr-login`
- Graduate to **ECS Fargate** when you want auto-scaling and no instance
  to patch
