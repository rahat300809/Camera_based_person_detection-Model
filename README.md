# Biometric AI Face Recognition & Training Hub

A full-stack, high-performance Biometric Face Recognition, Training & Anti-Spoofing Web Application inspired by **KBY-AI FaceRecognition-Android**. Powered by **FastAPI**, **OpenCV YuNet (Face Detector & 5-point Landmark Estimator)**, and **SFace (128-Dimensional Deep Feature Embedder)**.

---

## 🌟 Key Features

1. **Train / Enroll Any Person's Image**:
   - Register individuals via **Live Webcam Snapshot** or **Photo File Upload**.
   - Input metadata: Full Name, Role/Category (VIP, Employee, Guest, Security), Notes.
   - Automatic 68-point face alignment, 128D vector extraction, and avatar thumbnail creation.
   - Multi-shot enrollment: Add multiple training photos per person to improve recognition across lighting & angles.

2. **Real-Time Live Camera Detection & Identification ("Detect Who He Is")**:
   - High-FPS video stream processing with bounding box HUD overlays, 5 facial landmark indicators (Eyes, Nose, Mouth), person name badges, and match confidence percentages.
   - Sound chime alert on identity verification match.
   - Live target sidebar showing full profile card & match history log.

3. **Photo Query & Group Photo Analysis**:
   - Upload any image (single face or multi-person photo).
   - Detects all faces simultaneously, aligns faces, extracts embeddings, matches against database, and renders annotated HUD output.

4. **Passive Liveness & Quality Scoring**:
   - Calculates passive liveness score (0 - 100) evaluating sharpness, eye distance symmetry, and face pose.

5. **Vector Database Management**:
   - SQLite persistent storage (`face_db.sqlite`).
   - Profile management (view registered faces, search by name/role, delete profiles).
   - JSON export & import for database backup & portability.

6. **Adjustable Hyperparameters**:
   - Cosine Similarity Threshold slider (Default: `0.363`, range `0.1` to `0.8`).
   - Detection Confidence Threshold slider (Default: `0.5`).

---

## 🚀 Quick Start Guide

### 1. Run the Server
Launch the application using Python:
```bash
python3 run.py
```
The server will start at: **`http://localhost:8000`**

### 2. How to Train a Model for Anyone
1. Open `http://localhost:8000` in your web browser.
2. Click **"Train New Person"** in the sidebar.
3. Choose either **Webcam Snap** or **File Upload**.
4. Capture or upload a clear photo of the person.
5. Enter their **Full Name**, **Role**, and **Notes**.
6. Click **"Train Embedding & Save Profile"**.
7. The system extracts their 128D facial feature vector and stores it in the database!

### 3. How to Detect & Identify People
- **Live Camera Scanner**: Go to the **Live Scanner** tab, click **"Start Camera"**. As people step in front of the camera, the system highlights their face with bounding boxes, key landmarks, and their name/role badge in real-time.
- **Photo Identification**: Go to the **Photo Query** tab, drag & drop any image. The system will detect all faces in the photo and identify who each person is!

---

## 📁 System Architecture & Files

- `app.py` - FastAPI REST API & Static File Server.
- `face_engine.py` - OpenCV YuNet Detector & SFace Feature Recognizer with ONNX auto-downloader.
- `database.py` - SQLite vector database manager & log system.
- `run.py` - Application launcher with automatic port detection.
- `static/index.html` - Glassmorphism UI layout.
- `static/style.css` - Dark theme, neon accents, HUD scanline styles.
- `static/app.js` - Web camera processing, API integration, interactive controls.
