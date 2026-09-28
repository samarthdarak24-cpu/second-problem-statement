# 🚀 Quick Deployment Instructions

## Repository Information

**GitHub Repository:** https://github.com/samarthdarak24-cpu/second-problem-statement

---

## ✅ Files Ready for Deployment

All deployment configuration files have been created:

### Backend Deployment (Render)

1. **`render.yaml`** - Automated deployment blueprint
2. **`backend/.env`** - Production environment variables (configured for Render)
3. **`backend/.env.render`** - Reference environment variables for Render
4. **`RENDER_DEPLOYMENT.md`** - Complete Render deployment guide

### Environment Files

- **`backend/.env`** - Already configured for production with Render
- Database will use Render's managed PostgreSQL
- CORS configured for frontend URLs

---

## 📤 Pushing to GitHub (Manual Steps)

Due to the repository size, push from your local terminal:

```bash
cd "c:\Users\darak\Downloads\sih2nd pb\sih-thermal-shelter"

# Verify remote
git remote -v

# Add all files
git add -A

# Commit
git commit -m "Complete SIH thermal shelter system with Render deployment config"

# Push (may take 5-10 minutes due to size)
git push -u origin main
```

---

## 🎯 Deploy to Render (After Pushing to GitHub)

### Option 1: Blueprint Deploy (Easiest)

1. Go to https://dashboard.render.com
2. Click **"New +"** → **"Blueprint"**
3. Connect your GitHub repository: `samarthdarak24-cpu/second-problem-statement`
4. Render will read `render.yaml` and automatically:
   - Create PostgreSQL database
   - Create web service
   - Set all environment variables
   - Deploy backend
5. Click **"Apply"**
6. Wait 5-10 minutes for deployment

### Option 2: Manual Deploy

Follow the detailed guide in **`RENDER_DEPLOYMENT.md`**

---

## 🔧 Important Environment Variables for Render

After deployment, update these in Render Dashboard:

### CORS_ORIGINS
Update with your actual frontend URL:
```
["https://your-frontend-url.vercel.app","http://localhost:3000"]
```

### DATABASE_URL
Automatically set by Render if using managed PostgreSQL.

### SECRET_KEY
Click "Generate" in Render dashboard to create a secure key.

---

## 🌐 Frontend Deployment (Vercel Recommended)

1. Push frontend to GitHub (or same repo)
2. Go to https://vercel.com
3. Import project
4. Set environment variable:
   ```
   NEXT_PUBLIC_API_URL=https://your-backend.onrender.com
   ```
5. Deploy

---

## ✅ Post-Deployment Checklist

- [ ] Backend deployed on Render
- [ ] Database created and connected
- [ ] Environment variables set
- [ ] Health endpoint responding: `https://your-api.onrender.com/api/health`
- [ ] API docs accessible: `https://your-api.onrender.com/docs`
- [ ] Frontend deployed
- [ ] Frontend connected to backend
- [ ] CORS updated with frontend URL
- [ ] Test complete flow: location → climate → optimization → 3D model

---

## 📊 Your API Endpoints (After Deployment)

```
Health Check:    https://your-app.onrender.com/api/health
API Docs:        https://your-app.onrender.com/docs
Climate API:     https://your-app.onrender.com/api/climate
Optimize:        https://your-app.onrender.com/api/optimize
Materials:       https://your-app.onrender.com/api/materials
```

---

## 🆘 Need Help?

1. Read **`RENDER_DEPLOYMENT.md`** for detailed instructions
2. Check **`SETUP.md`** for local development
3. Review **`backend/README.md`** for backend specifics

---

## 🎉 Ready for SIH!

Once deployed, your system will be:
- ✅ Live and accessible worldwide
- ✅ Using managed PostgreSQL database
- ✅ Auto-deploying on git push
- ✅ SSL enabled (HTTPS)
- ✅ Production-ready

**Live API:** `https://sih-thermal-shelter-api.onrender.com`
**Documentation:** `https://sih-thermal-shelter-api.onrender.com/docs`
