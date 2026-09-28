# 🚀 Render Deployment Guide - SIH Thermal Shelter System

Complete guide to deploy the backend on Render.com (Free tier available)

---

## 📋 Prerequisites

1. **GitHub Account** with your repository
2. **Render Account** (Sign up at https://render.com - Free!)
3. Repository URL: `https://github.com/samarthdarak24-cpu/3rd-sih-pb`

---

## 🎯 Quick Deploy (Automated)

### Option 1: Blueprint Deploy (Recommended)

1. **Push render.yaml to your repo** (already included)

2. **Go to Render Dashboard**
   - Visit: https://dashboard.render.com
   - Click **"New +"** → **"Blueprint"**

3. **Connect Repository**
   - Connect your GitHub account
   - Select: `samarthdarak24-cpu/3rd-sih-pb`
   - Branch: `main`

4. **Deploy**
   - Render will automatically create:
     - ✅ Backend Web Service
     - ✅ PostgreSQL Database
     - ✅ All environment variables
   - Click **"Apply"**

5. **Wait 5-10 minutes** for initial build

6. **Your API is live!**
   - URL: `https://sih-thermal-shelter-api.onrender.com`
   - Health: `https://sih-thermal-shelter-api.onrender.com/api/health`
   - Docs: `https://sih-thermal-shelter-api.onrender.com/docs`

---

## 🔧 Manual Deploy (Step by Step)

### Step 1: Create PostgreSQL Database

1. **Go to Render Dashboard**
   - Click **"New +"** → **"PostgreSQL"**

2. **Configure Database**
   - **Name:** `sih-thermal-shelter-db`
   - **Database:** `thermal_shelter`
   - **User:** `thermal_shelter_user`
   - **Region:** Oregon (or closest to you)
   - **Plan:** Free

3. **Create Database**
   - Click **"Create Database"**
   - Wait 2-3 minutes
   - **Copy Internal Database URL** (you'll need this!)

### Step 2: Create Web Service

1. **New Web Service**
   - Click **"New +"** → **"Web Service"**

2. **Connect Repository**
   - Click **"Connect a repository"**
   - Authorize GitHub
   - Select: `samarthdarak24-cpu/3rd-sih-pb`

3. **Configure Service**

   **Basic Settings:**
   - **Name:** `sih-thermal-shelter-api`
   - **Region:** Oregon (same as database)
   - **Branch:** `main`
   - **Root Directory:** `backend`
   - **Runtime:** `Python 3`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

   **Instance Type:**
   - **Plan:** Free (or Starter for better performance)

4. **Add Environment Variables**

   Click **"Advanced"** → **"Environment Variables"** → **"Add from .env"**

   Or add manually:

   | Key | Value |
   |-----|-------|
   | `PYTHON_VERSION` | `3.11.0` |
   | `APP_NAME` | `SIH Thermal Shelter Design System` |
   | `ENVIRONMENT` | `production` |
   | `DEBUG` | `False` |
   | `HOST` | `0.0.0.0` |
   | `DATABASE_URL` | *Paste Internal Database URL from Step 1* |
   | `CORS_ORIGINS` | `["https://your-frontend-url.vercel.app","http://localhost:3000"]` |
   | `OPENMETEO_API_URL` | `https://api.open-meteo.com/v1` |
   | `OPEN_METEO_BASE` | `https://archive-api.open-meteo.com/v1/archive` |
   | `ENABLE_LIVE_CLIMATE` | `true` |
   | `USE_ML_OPTIMIZATION` | `False` |
   | `SECRET_KEY` | *Click "Generate"* |

5. **Create Web Service**
   - Click **"Create Web Service"**
   - Render will start building (5-10 minutes)

### Step 3: Verify Deployment

Once deployed, test these endpoints:

```bash
# Health check
curl https://your-service-name.onrender.com/api/health

# Climate API
curl "https://your-service-name.onrender.com/api/climate?lat=18.5204&lon=73.8567&city=Pune"

# API Documentation
# Visit in browser:
https://your-service-name.onrender.com/docs
```

---

## 🔗 Connect Frontend to Backend

### Update Frontend Environment Variables

In your frontend (Next.js), update the API URL:

**Create `.env.local` in frontend root:**

```env
NEXT_PUBLIC_API_URL=https://your-service-name.onrender.com
```

**Or in Vercel:**
- Go to Project Settings → Environment Variables
- Add: `NEXT_PUBLIC_API_URL` = `https://your-service-name.onrender.com`

### Update CORS Origins

After deploying frontend, update backend CORS:

1. Go to Render Dashboard → Your Service
2. Environment → Edit `CORS_ORIGINS`
3. Add your frontend URL:
   ```json
   ["https://your-frontend.vercel.app","http://localhost:3000"]
   ```
4. Save → Render will auto-redeploy

---

## 📊 Render Dashboard Overview

### Monitoring

**Logs:**
- Click your service → **"Logs"** tab
- Real-time logs of your application

**Metrics:**
- CPU usage
- Memory usage
- Request count
- Response times

**Events:**
- Deployment history
- Build logs
- Crashes and restarts

---

## ⚙️ Environment Variables on Render

### Required Variables

```env
# Application
APP_NAME=SIH Thermal Shelter Design System
ENVIRONMENT=production
DEBUG=False

# Server (PORT is auto-set by Render)
HOST=0.0.0.0

# Database (Auto-filled if using Render PostgreSQL)
DATABASE_URL=${DATABASE_URL}

# CORS (Update with your frontend URLs)
CORS_ORIGINS=["https://your-frontend.vercel.app"]

# External APIs
OPENMETEO_API_URL=https://api.open-meteo.com/v1
OPEN_METEO_BASE=https://archive-api.open-meteo.com/v1/archive

# Security
SECRET_KEY=<generate-on-render>
```

### Optional Variables

```env
# Features
USE_ML_OPTIMIZATION=False
ENABLE_ML_FEATURES=True
ENABLE_ADVANCED_THERMAL_MODEL=True
ENABLE_COST_OPTIMIZATION=True
ENABLE_ENERGY_SIMULATION=True

# Performance
MAX_CONCURRENT_OPTIMIZATIONS=5
REQUEST_TIMEOUT_SECONDS=300

# Logging
LOG_LEVEL=INFO
```

---

## 💰 Render Plans

### Free Tier
- ✅ 750 hours/month (sleeps after 15 min inactivity)
- ✅ PostgreSQL database (90 days retention)
- ✅ Custom domains
- ✅ Automatic SSL
- ⚠️ Spins down with inactivity (30s wake-up time)

### Starter Tier ($7/month)
- ✅ Always on (no sleep)
- ✅ More resources (512 MB RAM)
- ✅ Better performance

**Recommendation:** Start with Free, upgrade for SIH demo day!

---

## 🔄 Auto-Deploy on Git Push

Render automatically deploys when you push to GitHub:

```bash
git add .
git commit -m "Update backend"
git push origin main
```

Render detects changes and redeploys automatically! ✨

---

## 🐛 Troubleshooting

### Issue: Build Failed

**Check:**
1. Build logs in Render dashboard
2. Ensure `requirements.txt` is correct
3. Check Python version compatibility

**Solution:**
```bash
# Test locally first
cd backend
pip install -r requirements.txt
python run.py
```

### Issue: Service Not Starting

**Check:**
1. Environment variables set correctly
2. DATABASE_URL is valid
3. PORT is not hardcoded (Render sets it automatically)

**Solution:**
- Use `$PORT` in start command
- Check logs for errors

### Issue: Database Connection Failed

**Check:**
1. DATABASE_URL environment variable
2. Database is running
3. Connection string format

**Solution:**
- Copy Internal Database URL (not External)
- Format: `postgresql://user:password@host/database`

### Issue: CORS Errors

**Check:**
1. CORS_ORIGINS includes your frontend URL
2. URL format is exact (no trailing slash)
3. JSON array format: `["url1","url2"]`

**Solution:**
```env
CORS_ORIGINS=["https://your-app.vercel.app","http://localhost:3000"]
```

### Issue: Service Sleeping (Free Tier)

**Expected behavior on free tier:**
- Service sleeps after 15 minutes of inactivity
- First request takes 30s to wake up

**Solutions:**
1. Upgrade to Starter plan ($7/month)
2. Use a uptime monitor (like UptimeRobot) to ping every 10 min
3. Accept the cold start (fine for demos)

---

## 📱 Monitoring & Alerts

### Set Up Health Checks

Render automatically monitors: `/api/health`

### External Monitoring (Optional)

**UptimeRobot** (Free):
1. Sign up: https://uptimerobot.com
2. Add monitor: `https://your-service.onrender.com/api/health`
3. Get alerts if down

---

## 🎯 Pre-Demo Checklist

- [ ] Backend deployed on Render
- [ ] Database created and connected
- [ ] Health endpoint returns 200 OK
- [ ] API docs accessible at `/docs`
- [ ] Climate API returns data
- [ ] Frontend connected to backend
- [ ] CORS configured correctly
- [ ] All environment variables set
- [ ] Service is awake (ping it 5 min before demo!)

---

## 🔗 Useful Links

- **Render Dashboard:** https://dashboard.render.com
- **Render Docs:** https://render.com/docs
- **Your Service URL:** `https://sih-thermal-shelter-api.onrender.com`
- **API Documentation:** `https://sih-thermal-shelter-api.onrender.com/docs`
- **GitHub Repo:** https://github.com/samarthdarak24-cpu/3rd-sih-pb

---

## 📞 Quick Commands

```bash
# Test deployed API
curl https://your-service.onrender.com/api/health

# Check climate endpoint
curl "https://your-service.onrender.com/api/climate?lat=18.52&lon=73.85"

# View logs (requires Render CLI)
render logs -s sih-thermal-shelter-api

# Trigger manual deploy
git commit --allow-empty -m "Trigger deploy"
git push
```

---

## ✅ Success Indicators

Your deployment is successful when:

1. ✅ Service status shows **"Live"** (green)
2. ✅ Health check returns:
   ```json
   {
     "status": "healthy",
     "version": "1.0.0"
   }
   ```
3. ✅ API docs load at `/docs`
4. ✅ Climate endpoint returns data
5. ✅ No errors in logs
6. ✅ Frontend can connect successfully

---

## 🎉 You're Live!

Your backend is now deployed and accessible worldwide! 

**Next Steps:**
1. Deploy frontend to Vercel
2. Connect frontend to backend API
3. Update CORS with frontend URL
4. Test complete pipeline
5. Prepare for SIH demo! 🚀

**Your Live Endpoints:**
- API: `https://your-service-name.onrender.com`
- Health: `https://your-service-name.onrender.com/api/health`
- Docs: `https://your-service-name.onrender.com/docs`
- Interactive API: `https://your-service-name.onrender.com/redoc`
