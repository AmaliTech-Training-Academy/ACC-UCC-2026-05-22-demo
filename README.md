# Cloud Notes — Demo

**Repo:** <https://github.com/AmaliTech-Training-Academy/ACC-UCC-2026-05-22-demo>

```bash
git clone https://github.com/AmaliTech-Training-Academy/ACC-UCC-2026-05-22-demo.git
cd ACC-UCC-2026-05-22-demo
```

A tiny full-stack app for the Cloud Computing & AWS talk.

- **Frontend** — React + Vite, served by Nginx in a container
- **Backend** — Express (Node 20) JSON API, in a separate container
- **Glue** — `docker-compose.yml` runs both with one command

The two services talk over Docker's default bridge network, but the browser
reaches the API at `http://localhost:4000` (CORS is enabled).

## Run it

```bash
cd demo
docker compose up --build
```

Then open:

- React app — http://localhost:5173
- API health — http://localhost:4000/api/health

Stop everything with `Ctrl+C`, then `docker compose down` to remove the
containers.

## What to demo on stage

1. Show the running app in the browser. Add a note, refresh — it persists in
   the backend's memory.
2. Open a terminal and `docker compose ps` — point at the two running
   containers.
3. Kill the backend container: `docker compose stop backend`. The app shows
   "Backend: offline" in real time.
4. Bring it back: `docker compose start backend`. The status flips back to
   `ok` within ~5 seconds.
5. Mention the next step: the same containers can run on AWS (ECS, App
   Runner, or EC2) with no code changes — that's the cloud value proposition.

## Files

```
demo/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/server.js
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        └── App.css
```

## Notes

- The backend stores notes in memory; restarting the backend container wipes
  them. That's intentional — it's the cue for "this is why we'd put a real
  database (AWS RDS / DynamoDB) here in production."
- The frontend bakes `VITE_API_URL` in at build time. If you ever want to
  point it at a deployed backend, rebuild with
  `--build-arg VITE_API_URL=https://your-api.example.com`.

## Before the talk

See [`PREREQUISITES.md`](./PREREQUISITES.md) for what to install on your
laptop — there are two paths (browser-only via CloudShell, or local CLI),
pick whichever fits your setup.

## Deploying to AWS

Three paths, all targeting a single EC2 instance — pick whichever matches
how you want to work:

- **[`AWS_DEPLOY_CONSOLE.md`](./AWS_DEPLOY_CONSOLE.md)** — browser-only.
  Uses AWS CloudShell to build/push and the AWS Console + Session Manager
  for everything else. No tools installed locally beyond a browser.
- **[`AWS_DEPLOY.md`](./AWS_DEPLOY.md)** — local CLI, simplest path.
  Build locally, `docker save`, `scp` the tar files to EC2, `docker load`,
  run. No registry needed.
- **[`AWS_DEPLOY_ECR.md`](./AWS_DEPLOY_ECR.md)** — local CLI,
  production-shaped path. Build locally, push to Amazon ECR, EC2 pulls
  via an instance profile. More steps but mirrors how real teams ship.

Every guide includes cleanup commands — run them the moment you're done
so you don't pay for an idle instance.
