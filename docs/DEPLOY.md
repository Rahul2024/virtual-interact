# Going live, for free

Three accounts, about half an hour, no credit card. At the end you have a
public link anyone can open, with HTTPS (so voice works), and the city updates
itself every time you save and push code.

| Step | Service | What it hosts | Cost |
| --- | --- | --- | --- |
| 1 | GitHub | the code, the Idea issues, CI | free |
| 2 | Render | the world server + the client | free |
| 3 | Upstash | the Idea Wall data (so it survives restarts) | free |

---

## 1. Put the code on GitHub

1. Create an account at https://github.com (free).
2. In VS Code, click the **Source Control** icon in the left bar (the branch
   symbol) and press **Publish to GitHub**.
   - If VS Code says Git isn't installed, click **Install**: macOS opens a
     "command line developer tools" prompt. Accept it, wait for it to finish
     (5–10 minutes), then quit and reopen VS Code.
   - VS Code asks you to sign in to GitHub in the browser. Click **Authorize**.
3. Choose **Publish to GitHub public repository** and keep the namew
   `virtual-interact`. VS Code uploads everything except `node_modules`.
4. On github.com, open the repo and do two one-time things:
   - **Settings → General → Features**: tick **Discussions**.
   - **Issues → Labels → New label**, five times: `idea`, `up for grabs`,
     `claimed`, `built`, `good first build`.
5. The repo links in `.github/ISSUE_TEMPLATE/config.yml`, `package.json`
   and `packages/shared/src/index.ts` point at
   `github.com/Rahul2024/virtual-interact`. If you ever move the repo, change
   them there, then push: Source Control → type a message → **Commit** →
   **Sync Changes**.

From now on, **Commit** + **Sync Changes** in VS Code is how you publish any
change.

## 2. Deploy on Render

1. Go to https://render.com and **Sign up with GitHub**.
2. Dashboard → **New** → **Blueprint**.
3. Pick the `virtual-interact` repository. Render reads `render.yaml` and
   shows two services: `virtual-interact-server` and `virtual-interact`.
   Give the blueprint any name and click **Deploy Blueprint**.
4. Wait 3–5 minutes. Both services turn green.
5. Click **virtual-interact** (the static site). Its URL looks like
   `https://virtual-interact.onrender.com`. Open it: that's the city.

If the join screen says it can't reach the server, the one link between the
two services didn't resolve. Fix it by hand once:

- Open **virtual-interact-server** and copy its hostname (the part after
  `https://`, e.g. `virtual-interact-server.onrender.com`).
- Open **virtual-interact** → **Environment** → set `VITE_SERVER_HOST` to that
  hostname → **Save, rebuild, and deploy**.

**What "free" means on Render:** the server goes to sleep after 15 minutes
with nobody in it and takes up to a minute to wake. The join screen shows
"Waking the world server up…" while that happens; the next person walks
straight in. 750 free hours a month covers a server that's awake all the time,
so if you want it never to sleep, point a free pinger (for example
cron-job.org) at `https://<server>/health` every 10 minutes.

## 3. Keep the Idea Wall: Upstash

Render's free server has no disk: every restart would wipe the ideas. Upstash
gives a free Redis database that keeps them.

1. Go to https://upstash.com, sign up with GitHub.
2. **Create Database** → name `virtual-interact`, type **Regional**, region
   closest to your Render server (Singapore → `ap-southeast-1`), plan
   **Free** → Create.
3. On the database page, find the **REST API** section and copy
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
4. Render → **virtual-interact-server** → **Environment** → **Add
   Environment Variable**, twice, with those two names and values → **Save**.
   Render redeploys the server.
5. Check **Logs**: you should see `[ideas] 0 ideas loaded (upstash redis)`.

## 4. Share it

Send people the static site link. Things to tell them:

- The first person in after a quiet spell waits up to a minute.
- Press **M** for voice; the browser asks for the mic once.
- The Idea Wall is by the plaza (press **E**). Whatever they post is on the
  roadmap.

## Updating the city

Save your code, then in VS Code: **Source Control** → type what you changed →
**Commit** → **Sync Changes**. GitHub runs the checks, Render rebuilds both
services in a few minutes. Nothing else to do.

## Later

- **Your own domain** (`city.example.com`): Render → service → Settings →
  Custom Domains; free TLS included.
- **More than ~8 people talking in one spot**: switch voice to LiveKit (the
  design doc has the plan).
- **Never sleeps, more CPU**: move the server to Render's $7 Starter instance,
  or to a free Oracle VM (design doc, tier 0) if you'd rather run it yourself.
