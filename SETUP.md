# SIH Thermal Comfort Shelter Design System - Setup Guide

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.9+
- **Git**

---

## 🌐 Deployment Options

### Option 1: Deploy to Render (Recommended for Production)

See **[RENDER_DEPLOYMENT.md](./RENDER_DEPLOYMENT.md)** for complete deployment guide.

**Quick Deploy:**
1. Push code to GitHub
2. Connect repository to Render
3. Deploy with one click using `render.yaml`
4. Your API is live at: `https://your-app.onrender.com`

### Option 2: Local Development

Follow the instructions below for local setup and testing.

---

## 📦 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/samarthdarak24-cpu/3rd-sih-pb.git
cd 3rd-sih-pb
```

### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Copy and configure environment file
copy .env.example .env  # Windows
# OR
cp .env.example .env    # Linux/Mac
```

#### Backend .env Configuration

**For Local Development:**

Create `backend/.env` with:

```env
# Backend Configuration
APP_NAME=SIH Thermal Shelter Design System
DEBUG=True
ENVIRONMENT=development

# Server Configuration
HOST=0.0.0.0
PORT=8000

# CORS Configuration
CORS_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]

# Database Configuration (SQLite for local)
DATABASE_URL=sqlite:///./thermal_shelter.db

# Open-Meteo API (Free - No key required)
OPENMETEO_API_URL=https://api.open-meteo.com/v1
OPEN_METEO_BASE=https://archive-api.open-meteo.com/v1/archive

# Feature Flags
USE_ML_OPTIMIZATION=False
ENABLE_ML_FEATURES=True
ENABLE_ADVANCED_THERMAL_MODEL=True
```

**For Render Deployment:**

See [RENDER_DEPLOYMENT.md](./RENDER_DEPLOYMENT.md) for production configuration.

#### Start Backend Server

```bash
# Make sure you're in the backend directory with venv activated
python run.py

# Backend will run at: http://localhost:8000
# API docs at: http://localhost:8000/docs
```

---

### 3. Frontend Setup

Open a **new terminal** window:

```bash
cd frontend  # or cd sih-thermal-shelter if in root

# Install dependencies
npm install

# Start development server
npm run dev

# Frontend will run at: http://localhost:3000
```

---

## 🌐 Accessing the Application

Once both servers are running:

1. **Frontend Dashboard**: http://localhost:3000
2. **Backend API**: http://localhost:8000
3. **API Documentation**: http://localhost:8000/docs
4. **Interactive API**: http://localhost:8000/redoc

---

## 📋 Environment Variables Reference

### Backend (.env)

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_NAME` | Application name | SIH Thermal Shelter Design System |
| `DEBUG` | Debug mode | True |
| `HOST` | Server host | 0.0.0.0 |
| `PORT` | Server port | 8000 |
| `DATABASE_URL` | Database connection | sqlite:///./thermal_shelter.db |
| `CORS_ORIGINS` | Allowed origins | ["http://localhost:3000"] |
| `OPENMETEO_API_URL` | Weather API | https://api.open-meteo.com/v1 |
| `USE_ML_OPTIMIZATION` | Enable ML | False |
| `ENABLE_ADVANCED_THERMAL_MODEL` | Advanced thermal | True |

### Optional: PostgreSQL Database

If you want to use PostgreSQL instead of SQLite:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/thermal_shelter_db
```

Then create the database:

```bash
createdb thermal_shelter_db
```

---

## 🔧 Development Commands

### Backend

```bash
cd backend

# Run server
python run.py

# Run tests
pytest

# Run specific test
pytest tests/test_api.py

# Format code
black app/

# Type checking
mypy app/
```

### Frontend

```bash
cd frontend

# Development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Lint code
npm run lint

# Type checking
npm run typecheck
```

---

## 🧪 Testing the System

### 1. Quick Health Check

**Backend:**
```bash
curl http://localhost:8000/api/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### 2. Test Climate API

```bash
curl "http://localhost:8000/api/climate?lat=18.5204&lon=73.8567&city=Pune"
```

### 3. Test Complete Pipeline

1. Open http://localhost:3000
2. Click "Get Started" or "Login"
3. Go to Dashboard
4. Select Location: **Pune, Maharashtra**
5. Click **"Generate Optimized Design"**
6. Watch the system:
   - Fetch climate data
   - Analyze climate
   - Calculate thermal comfort
   - Optimize parameters
   - Generate 3D model

---

## 📊 Demo Scenario

Follow this to demonstrate the complete system:

### Step 1: Select Location
- Navigate to Dashboard
- Select: **Pune, Maharashtra, India**
- Coordinates auto-fill: 18.5204°N, 73.8567°E

### Step 2: Generate Design
- Click **"Generate Optimized Design"**
- System analyzes:
  - Temperature: 25-30°C
  - Humidity: 55-65%
  - Solar radiation: High
  - Climate type: Hot Semi-Arid

### Step 3: View Recommendations
The system recommends:
- ✓ Cross ventilation
- ✓ External shading (0.8m depth)
- ✓ Insulated roof
- ✓ Optimized window ratio (25%)
- ✓ East-West orientation

### Step 4: 3D Visualization
- Parametric 3D model updates automatically
- Switch views: Normal, Heatmap, Airflow, Solar

### Step 5: Compare Results
- View **Before vs Optimized** comparison
- See improvements in:
  - Indoor temperature: 29°C → 25°C
  - Energy consumption: 18 kWh → 11 kWh
  - Comfort score: 65 → 85

### Step 6: Change Location
- Select: **Leh, Ladakh** (Cold climate)
- Click Generate
- Watch design change:
  - Increased insulation
  - Reduced ventilation openings
  - Different window configuration
  - Modified orientation

---

## 🏗️ Project Structure

```
sih-thermal-shelter/
├── backend/                    # Python FastAPI Backend
│   ├── app/
│   │   ├── routers/           # API routes
│   │   ├── climate.py         # Climate analysis
│   │   ├── optimize.py        # Optimization engine
│   │   ├── ml.py              # Machine learning
│   │   └── main.py            # FastAPI app
│   ├── data/                  # Climate & material data
│   ├── tests/                 # Backend tests
│   └── requirements.txt       # Python dependencies
│
├── frontend/                   # Next.js Frontend
│   ├── app/                   # Pages
│   │   ├── page.tsx           # Landing page
│   │   └── (app)/dashboard/   # Dashboard pages
│   ├── components/            # React components
│   │   ├── 3d/               # Three.js components
│   │   ├── dashboard/        # Dashboard UI
│   │   └── ui/               # Primitives
│   ├── climate/              # Climate service
│   ├── thermal/              # Thermal calculations
│   ├── optimization/         # Optimization logic
│   ├── types/                # TypeScript types
│   └── package.json          # Node dependencies
│
└── SETUP.md                   # This file
```

---

## 🐛 Troubleshooting

### Backend Issues

**Issue: Port 8000 already in use**
```bash
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# Linux/Mac
lsof -i :8000
kill -9 <PID>
```

**Issue: Module not found**
```bash
pip install -r requirements.txt --force-reinstall
```

**Issue: Database error**
```bash
rm thermal_shelter.db  # Delete and recreate
python run.py
```

### Frontend Issues

**Issue: Port 3000 already in use**
```bash
# Kill process on port 3000
# Or change port:
npm run dev -- -p 3001
```

**Issue: Module not found**
```bash
rm -rf node_modules package-lock.json
npm install
```

**Issue: Three.js errors**
```bash
npm install three @react-three/fiber @react-three/drei --force
```

---

## 🔐 Security Notes

- `.env` files contain sensitive data and are **NOT** committed to git
- Change `SECRET_KEY` in production
- Use proper authentication in production
- Enable HTTPS for production deployment

---

## 📚 API Documentation

Once backend is running, access:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/climate` | GET | Get climate data |
| `/api/optimize/generate` | POST | Generate optimized design |
| `/api/thermal/calculate` | POST | Calculate thermal comfort |
| `/api/catalogue/materials` | GET | Get materials list |

---

## 🎯 SIH Demo Checklist

- [ ] Backend running on port 8000
- [ ] Frontend running on port 3000
- [ ] Can select location (Pune)
- [ ] Climate data loads automatically
- [ ] Generate design works
- [ ] 3D model renders correctly
- [ ] Recommendations display with reasons
- [ ] Heatmap visualization works
- [ ] Airflow visualization works
- [ ] Before/After comparison shows
- [ ] Can switch to different location (Leh)
- [ ] Design updates for new location
- [ ] Parameter sliders update 3D model
- [ ] All thermal metrics display

---

## 📞 Support

For issues or questions:
- Check API docs: http://localhost:8000/docs
- Review console logs in browser (F12)
- Check backend logs in terminal
- Verify both servers are running

---

## 🎉 Success!

If everything is working:
- ✅ Backend API responding
- ✅ Frontend dashboard loading
- ✅ Location selection working
- ✅ 3D model rendering
- ✅ Climate analysis functioning
- ✅ Optimization generating results

You're ready for the SIH demonstration! 🚀
