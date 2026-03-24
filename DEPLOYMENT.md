# Deploying The Cole Report

Deploy the **backend** on Render (free) and the **frontend** on Netlify (free). You'll need a GitHub account and your project pushed to a repo.

---

## Prerequisites

1. **GitHub account** – [github.com](https://github.com)
2. **Project in a Git repo** – Your project pushed to GitHub
3. **API keys** – Alpha Vantage, NewsAPI, OpenWeatherMap (get free keys from README)

---

## Step 1: Push to GitHub

If you haven't already:

```bash
cd "c:\Users\ColeFender\.cursor\The Cole Report"
git init
git add .
git commit -m "Initial commit"
```

Create a new repo on GitHub, then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/the-cole-report.git
git branch -M main
git push -u origin main
```

---

## Step 2: Deploy backend to Render

1. Go to [render.com](https://render.com) and sign up (free).

2. Click **New** → **Web Service**.

3. Connect your GitHub account and select the `the-cole-report` repo (or whatever you named it).

4. Configure:
   - **Name:** `cole-report-api` (or any name)
   - **Region:** Oregon (or closest to you)
   - **Root Directory:** `backend`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`

5. Click **Advanced** and add **Environment Variables:**
   - `ALPHA_VANTAGE_API_KEY` = your key
   - `NEWS_API_KEY` = your key
   - `OPENWEATHER_API_KEY` = your key

6. Click **Create Web Service**. Wait for the deploy to finish (2–3 min).

7. Copy your backend URL, e.g. `https://cole-report-api.onrender.com` (you’ll need it for Netlify).

---

## Step 3: Deploy frontend to Netlify

1. Go to [netlify.com](https://netlify.com) and sign up (free).

2. Click **Add new site** → **Import an existing project**.

3. Choose **GitHub** and authorize Netlify, then select your repo.

4. Configure the build:
   - **Base directory:** leave empty (root)
   - **Build command:** `cd frontend && npm install && npm run build`
   - **Publish directory:** `frontend/dist`

5. Click **Add environment variables** and add:
   - **Key:** `VITE_API_URL`
   - **Value:** `https://cole-report-api.onrender.com`  
   (use your actual Render backend URL, no trailing slash)

6. Click **Deploy site**. Wait for the deploy to finish.

---

## Step 4: Test

Open your Netlify URL (e.g. `https://your-site.netlify.app`).  
The app should load and call your Render API. Gas prices (scraped) will work; Oil, Treasury, Weather, and News depend on the API keys you added on Render.

---

## Notes

- **Render free tier:** The backend sleeps after ~15 min of no traffic. The first request after that may take 30–60 seconds to respond.
- **Netlify:** The frontend is static; deploys are fast and free.
- **Custom domain:** You can add one in Netlify’s site settings.
