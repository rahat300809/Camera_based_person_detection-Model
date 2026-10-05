import os
import io
import base64
import time
import uuid
import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from pydantic import BaseModel
from typing import Optional, List

from face_engine import FaceEngine
from database import DatabaseManager

app = FastAPI(title="Biometric Face Recognition System", version="1.0.0")

# Setup directories
UPLOADS_DIR = "uploads"
STATIC_DIR = "static"
os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

# Mount static files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

# Initialize Engine & Database
engine = FaceEngine(models_dir="models")
db = DatabaseManager()

def bytes_to_bgr_image(image_bytes: bytes) -> np.ndarray:
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image file format")
    return img

def base64_to_bgr_image(b64_str: str) -> np.ndarray:
    if "," in b64_str:
        b64_str = b64_str.split(",")[1]
    image_bytes = base64.b64decode(b64_str)
    return bytes_to_bgr_image(image_bytes)

@app.get("/", response_class=HTMLResponse)
def read_root():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse("<h1>Face Recognition System API is running</h1>")

@app.get("/api/status")
def get_status():
    persons = db.get_all_persons()
    all_embeddings = db.get_all_embeddings_with_persons()
    return {
        "status": "online",
        "engine": "OpenCV YuNet + SFace ONNX",
        "registered_persons_count": len(persons),
        "total_embeddings_count": len(all_embeddings),
        "default_cosine_threshold": engine.cosine_threshold
    }

class Base64ImageRequest(BaseModel):
    image_b64: str
    confidence_threshold: Optional[float] = 0.5
    similarity_threshold: Optional[float] = 0.363

class PersonRegistrationRequest(BaseModel):
    name: str
    role: Optional[str] = "User"
    notes: Optional[str] = ""
    image_b64: str

@app.post("/api/register")
async def register_person(
    name: str = Form(...),
    role: str = Form("User"),
    notes: str = Form(""),
    file: Optional[UploadFile] = File(None),
    image_b64: Optional[str] = Form(None)
):
    """
    Enroll a new person into the face recognition database.
    Accepts photo file upload or base64 image string.
    """
    if file is not None:
        content = await file.read()
        img = bytes_to_bgr_image(content)
    elif image_b64:
        img = base64_to_bgr_image(image_b64)
    else:
        raise HTTPException(status_code=400, detail="Must provide an image file or base64 string")

    # Detect faces in provided image
    detected = engine.detect_faces(img, score_threshold=0.4)
    if not detected:
        raise HTTPException(status_code=400, detail="No face detected in the provided image. Please use a clear, front-facing photo.")
        
    # Use largest detected face
    face = max(detected, key=lambda f: f["bbox"][2] * f["bbox"][3])
    embedding = face["embedding"]
    
    if embedding is None:
        raise HTTPException(status_code=400, detail="Could not extract facial embedding feature from image")

    # Save face avatar crop image
    crop = face["aligned_crop"]
    filename = f"avatar_{uuid.uuid4().hex[:10]}.jpg"
    avatar_path = os.path.join(UPLOADS_DIR, filename)
    
    if crop is not None:
        cv2.imwrite(avatar_path, crop)
    else:
        # Fallback to bbox crop
        x, y, w, h = face["bbox"]
        x, y = max(0, x), max(0, y)
        cv2.imwrite(avatar_path, img[y:y+h, x:x+w])

    avatar_url = f"/uploads/{filename}"
    
    # Save to SQLite Database
    person_id = db.add_person(name=name, role=role, notes=notes, avatar_path=avatar_url)
    db.add_embedding(person_id, embedding)
    
    return {
        "success": True,
        "person_id": person_id,
        "name": name,
        "role": role,
        "avatar_url": avatar_url,
        "liveness_score": face["liveness_score"],
        "message": f"Successfully registered {name} into biometric database!"
    }

@app.post("/api/persons/{person_id}/add-face")
async def add_face_to_person(
    person_id: int,
    file: Optional[UploadFile] = File(None),
    image_b64: Optional[str] = Form(None)
):
    person = db.get_person(person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    if file is not None:
        content = await file.read()
        img = bytes_to_bgr_image(content)
    elif image_b64:
        img = base64_to_bgr_image(image_b64)
    else:
        raise HTTPException(status_code=400, detail="Must provide an image file or base64 string")

    detected = engine.detect_faces(img, score_threshold=0.4)
    if not detected:
        raise HTTPException(status_code=400, detail="No face detected in image")

    face = max(detected, key=lambda f: f["bbox"][2] * f["bbox"][3])
    embedding = face["embedding"]
    if embedding is None:
        raise HTTPException(status_code=400, detail="Failed to extract facial embedding")

    db.add_embedding(person_id, embedding)
    return {"success": True, "message": f"Added additional training face vector for {person['name']}"}

@app.post("/api/identify")
async def identify_faces(
    file: Optional[UploadFile] = File(None),
    image_b64: Optional[str] = Form(None),
    confidence_threshold: float = Form(0.4),
    similarity_threshold: float = Form(0.363),
    render_hud: bool = Form(True)
):
    """
    Detects and identifies ALL faces in input image against registered persons database.
    """
    if file is not None:
        content = await file.read()
        img = bytes_to_bgr_image(content)
    elif image_b64:
        img = base64_to_bgr_image(image_b64)
    else:
        raise HTTPException(status_code=400, detail="Must provide an image file or base64 string")

    # Fetch registered face embeddings
    registered_records = db.get_all_embeddings_with_persons()
    
    # Detect faces
    detected_faces = engine.detect_faces(img, score_threshold=confidence_threshold)
    
    results = []
    render_img = img.copy() if render_hud else None

    for face in detected_faces:
        query_emb = face["embedding"]
        bbox = face["bbox"]
        landmarks = face["landmarks"]
        liveness = face["liveness_score"]
        conf = face["confidence"]

        best_match = None
        best_sim = -1.0
        best_l2 = 999.0

        if query_emb is not None and len(registered_records) > 0:
            for rec in registered_records:
                sim, l2 = engine.compute_similarity(query_emb, rec["vector"])
                if sim > best_sim:
                    best_sim = sim
                    best_l2 = l2
                    best_match = rec

        is_matched = best_match is not None and best_sim >= similarity_threshold

        if is_matched:
            p_id = best_match["person_id"]
            p_name = best_match["name"]
            p_role = best_match["role"]
            p_avatar = best_match["avatar_path"]
            match_score = round(best_sim, 4)
            db.log_detection(p_id, p_name, conf, match_score)
        else:
            p_id = None
            p_name = "Unknown Person"
            p_role = "Unregistered"
            p_avatar = ""
            match_score = round(max(0.0, best_sim), 4)

        face_res = {
            "bbox": bbox,
            "landmarks": landmarks,
            "confidence": conf,
            "matched": is_matched,
            "person_id": p_id,
            "person_name": p_name,
            "role": p_role,
            "avatar_path": p_avatar,
            "cosine_similarity": match_score,
            "liveness_score": liveness
        }
        results.append(face_res)

        # Draw HUD overlays on image if requested
        if render_hud and render_img is not None:
            x, y, w, h = bbox
            color = (0, 245, 160) if is_matched else (0, 140, 255) # Green or Orange/Neon Blue
            
            # Box corners
            thickness = 2
            cv2.rectangle(render_img, (x, y), (x + w, y + h), color, thickness)
            
            # Corner accents
            c_len = int(min(w, h) * 0.2)
            cv2.line(render_img, (x, y), (x + c_len, y), color, 4)
            cv2.line(render_img, (x, y), (x, y + c_len), color, 4)
            cv2.line(render_img, (x + w, y), (x + w - c_len, y), color, 4)
            cv2.line(render_img, (x + w, y), (x + w, y + c_len), color, 4)
            cv2.line(render_img, (x, y + h), (x + c_len, y + h), color, 4)
            cv2.line(render_img, (x, y + h), (x, y + h - c_len), color, 4)
            cv2.line(render_img, (x + w, y + h), (x + w - c_len, y + h), color, 4)
            cv2.line(render_img, (x + w, y + h), (x + w, y + h - c_len), color, 4)

            # Landmarks points (Eyes, Nose, Mouth)
            for lm in landmarks:
                cv2.circle(render_img, (int(lm[0]), int(lm[1])), 3, (255, 0, 200), -1)

            # Text badge background
            label = f"{p_name} ({int(match_score * 100)}%)" if is_matched else "Unknown Person"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
            cv2.rectangle(render_img, (x, y - th - 12), (x + tw + 10, y), color, -1)
            cv2.putText(render_img, label, (x + 5, y - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

    # Encode rendered image to base64
    rendered_b64 = None
    if render_hud and render_img is not None:
        _, buffer = cv2.imencode(".jpg", render_img)
        rendered_b64 = "data:image/jpeg;base64," + base64.b64encode(buffer).decode("utf-8")

    return {
        "faces_count": len(results),
        "faces": results,
        "rendered_image_b64": rendered_b64
    }

@app.get("/api/persons")
def list_persons():
    return db.get_all_persons()

@app.get("/api/persons/{person_id}")
def get_person_details(person_id: int):
    p = db.get_person(person_id)
    if not p:
        raise HTTPException(status_code=404, detail="Person not found")
    return p

@app.delete("/api/persons/{person_id}")
def delete_person(person_id: int):
    db.delete_person(person_id)
    return {"success": True, "message": "Person profile deleted successfully"}

@app.get("/api/logs")
def get_logs(limit: int = Query(20, ge=1, le=100)):
    return db.get_recent_logs(limit=limit)

@app.get("/api/export-db")
def export_db():
    return db.export_database()

@app.post("/api/import-db")
def import_db(data: List[dict]):
    count = db.import_database(data)
    return {"success": True, "imported_count": count}
