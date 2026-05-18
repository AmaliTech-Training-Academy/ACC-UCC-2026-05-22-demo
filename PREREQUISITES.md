# Pre-Presentation Setup

Install these on your laptop **before** the talk so you can follow along.
There are two paths — pick the one that fits your setup.

| Path | What you need | When to pick it |
|---|---|---|
| **A. Browser-only (CloudShell)** | An AWS account + a modern browser | First time touching AWS; can't / don't want to install CLI tools |
| **B. Local CLI** | AWS CLI v2, Docker Desktop, Git, code editor | You've used a terminal before and want the faster iteration loop |

If you pick Path A, you still need an AWS account — see [Path B → step 1](#1-aws-account-both-paths).

---

## Path A — Browser-only (zero local setup)

You need:

1. **An AWS account** — sign up at <https://aws.amazon.com> with a card.
   The first 12 months are mostly free-tier covered for what we'll do.
   **Set a $1 CloudWatch billing alarm on day one** so you're never surprised.
2. **A modern browser** — current Chrome, Firefox, Edge, or Safari.
   That's it.

All builds, pushes, and deploys happen in **AWS CloudShell** — a free
browser-based Linux shell with `aws`, `docker`, `git`, and `node` already
installed. On the day, the [console-only deploy guide](./AWS_DEPLOY_CONSOLE.md)
walks you through it.

---

## Path B — Local CLI

Install these. Each section has Windows, macOS, and Linux commands.

| Tool | Why | What you'll run to check it |
|---|---|---|
| **AWS CLI v2** | Talk to AWS from your terminal | `aws --version` → `aws-cli/2.x` |
| **Docker Desktop** (Win/Mac) or **Docker Engine** (Linux) | Build and run the demo's containers | `docker --version` and `docker compose version` |
| **Git** | Clone the demo repo (also gives you Git Bash on Windows for a usable shell) | `git --version` |
| **A code editor** | Read and edit the source | VS Code recommended |
| *(Optional)* **Node.js 22 LTS** | Run the app outside Docker if you want | `node --version` → `v22.x.x` |

---

### 1. AWS account (both paths)

Same as Path A above — sign up at <https://aws.amazon.com>, set the
billing alarm, save the password somewhere safe.

---

### 2. Install — Windows

Open **PowerShell as Administrator** and run:

```powershell
winget install --id Amazon.AWSCLI -e
winget install --id Docker.DockerDesktop -e
winget install --id Git.Git -e
winget install --id Microsoft.VisualStudioCode -e
# Optional:
winget install --id OpenJS.NodeJS.LTS -e
```

Then:

- Open **Docker Desktop** once, wait for the whale icon to go steady — Docker is now running.
- Open a new **Git Bash** window (search Start menu for "Git Bash"). This is the shell we use for all `aws` / `docker` / `ssh` / `scp` commands.

> **Don't have winget?** It ships with Windows 10 21H2+ / Windows 11.
> If `winget` isn't recognized, install **App Installer** from the Microsoft Store, or download each tool manually:
> - AWS CLI: <https://awscli.amazonaws.com/AWSCLIV2.msi>
> - Docker Desktop: <https://www.docker.com/products/docker-desktop/>
> - Git: <https://git-scm.com/download/win>
> - VS Code: <https://code.visualstudio.com/>

---

### 3. Install — macOS

Install [Homebrew](https://brew.sh) first if you don't have it:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then:

```bash
brew install awscli
brew install --cask docker
brew install git
brew install --cask visual-studio-code
# Optional:
brew install node@22
```

Open **Docker Desktop** once (Applications → Docker) and accept the terms.
Use the built-in **Terminal** (Spotlight → "Terminal") or **iTerm2** for the
`aws` / `docker` commands.

---

### 4. Install — Linux (Ubuntu 22.04 / 24.04 / Debian 12)

Open a terminal and run:

```bash
# Git + editor
sudo apt update
sudo apt install -y git curl unzip
sudo snap install code --classic   # or: sudo apt install code

# AWS CLI v2 (apt's awscli is v1 — install the official v2 zip)
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
unzip /tmp/awscliv2.zip -d /tmp
sudo /tmp/aws/install
rm -rf /tmp/awscliv2.zip /tmp/aws

# Docker Engine + compose plugin (from Docker's official repo)
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo tee /etc/apt/keyrings/docker.asc > /dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Let your user run docker without sudo (log out + back in after this)
sudo usermod -aG docker $USER

# Optional: Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Log out and log back in so the `docker` group takes effect.

---

## Verification — does everything work?

Open your terminal (Git Bash on Windows; Terminal on macOS/Linux) and run:

```bash
aws --version
# expect: aws-cli/2.x ...

docker --version
docker compose version
# expect: Docker version 27.x or newer; Docker Compose version v2.x

git --version
# expect: git version 2.40 or newer

# Optional, if you installed Node:
node --version
# expect: v22.x

# Quick smoke test that Docker can pull and run an image:
docker run --rm hello-world
# expect: "Hello from Docker!"
```

If any of those fail, fix that one before moving on — they're independent.

---

## Configure AWS CLI (Path B only)

In the AWS console:
**IAM → Users → Create user** → name it (e.g. your name) → attach
`AdministratorAccess` *for this demo* (in production you'd scope down) →
go to the user → **Security credentials → Create access key** → choose
"Command Line Interface (CLI)" → save the **Access Key ID** and **Secret
Access Key** somewhere safe (you can only see the secret once).

Then in your terminal:

```bash
aws configure
# AWS Access Key ID:     <paste>
# AWS Secret Access Key: <paste>
# Default region name:   us-east-1
# Default output format: json
```

Verify:

```bash
aws sts get-caller-identity
# expect: your account ID + the IAM user ARN
```

---

## Day-of checklist

Before joining the talk:

- [ ] Laptop charged + charger in bag
- [ ] AWS account login works (try it the day before, not 5 minutes before)
- [ ] Path B only: `aws sts get-caller-identity` returns your account
- [ ] Path B only: `docker run --rm hello-world` works
- [ ] You've cloned the demo repo (or have the link to clone it during the talk)
- [ ] Your `$1` CloudWatch billing alarm exists in `us-east-1`
- [ ] You can find **CloudShell** in the AWS console (top-right area, looks like a terminal icon) — try opening it now

If anything's broken at this point, message me before the day. The talk
itself isn't the time to debug installs.
