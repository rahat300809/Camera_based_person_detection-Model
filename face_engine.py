import os
import urllib.request
import cv2
import numpy as np
import math

class FaceEngine:
    """
    OpenCV YuNet (Detection + Landmarks) & SFace (128D Embedding & Recognition) engine.
    """
    def __init__(self, models_dir="models"):
        self.models_dir = models_dir
        os.makedirs(self.models_dir, exist_ok=True)
        
        self.det_path = os.path.join(self.models_dir, "face_detection_yunet_2023mar.onnx")
        self.rec_path = os.path.join(self.models_dir, "face_recognition_sface_2021dec.onnx")
        
        self._download_models_if_needed()
        
        # Default detector initialized for 640x480 (will resize on fly per image)
        self.detector = cv2.FaceDetectorYN.create(
            self.det_path, "", (640, 480), score_threshold=0.5, nms_threshold=0.3, top_k=5000
        )
        self.recognizer = cv2.FaceRecognizerSF.create(self.rec_path, "")
        
        # SFace cosine threshold recommended: 0.363
        self.cosine_threshold = 0.363
        self.l2_threshold = 1.128

    def _download_models_if_needed(self):
        det_url = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
        rec_url = "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
        
        if not os.path.exists(self.det_path):
            print("Downloading YuNet Face Detector model...")
            urllib.request.urlretrieve(det_url, self.det_path)
            
        if not os.path.exists(self.rec_path):
            print("Downloading SFace Face Recognizer model...")
            urllib.request.urlretrieve(rec_url, self.rec_path)

    def detect_faces(self, image_bgr, score_threshold=0.5):
        """
        Detect faces in image_bgr.
        Returns list of dicts with bounding boxes, landmarks, confidence, and cropped aligned face.
        """
        h, w = image_bgr.shape[:2]
        self.detector.setInputSize((w, h))
        self.detector.setScoreThreshold(score_threshold)
        
        _, faces = self.detector.detect(image_bgr)
        
        results = []
        if faces is None or len(faces) == 0:
            return results
            
        for face in faces:
            bbox = face[:4].astype(int) # [x, y, w, h]
            landmarks = face[4:14].reshape((5, 2)).astype(float) # 5 landmark points (x, y)
            score = float(face[14])
            
            # Align and crop face for embedding extraction
            try:
                aligned_crop = self.recognizer.alignCrop(image_bgr, face)
                embedding = self.recognizer.feature(aligned_crop)[0] # 128D numpy array
            except Exception as e:
                aligned_crop = None
                embedding = None
                
            # Liveness / Quality heuristic score based on eye distance, nose placement & sharpness
            liveness_score = self._estimate_liveness_quality(image_bgr, bbox, landmarks)
            
            results.append({
                "bbox": [int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])],
                "landmarks": landmarks.tolist(),
                "confidence": round(score, 4),
                "embedding": embedding,
                "aligned_crop": aligned_crop,
                "liveness_score": round(liveness_score, 2)
            })
            
        return results

    def compute_similarity(self, feat1, feat2):
        """
        Computes Cosine Similarity and L2 Distance between 2 128D embeddings.
        Cosine similarity range [-1, 1], identical ~ 1.0.
        """
        if feat1 is None or feat2 is None:
            return 0.0, 999.0
            
        feat1_mat = np.array(feat1, dtype=np.float32).reshape(1, -1)
        feat2_mat = np.array(feat2, dtype=np.float32).reshape(1, -1)
        
        cosine_sim = float(self.recognizer.match(feat1_mat, feat2_mat, cv2.FaceRecognizerSF_FR_COSINE))
        l2_dist = float(self.recognizer.match(feat1_mat, feat2_mat, cv2.FaceRecognizerSF_FR_NORM_L2))
        
        return cosine_sim, l2_dist

    def _estimate_liveness_quality(self, img, bbox, landmarks):
        """
        Estimates face quality & passive liveness based on posture, eye distance symmetry & image Laplacian blur.
        """
        x, y, w, h = bbox
        if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > img.shape[1] or y + h > img.shape[0]:
            return 50.0
            
        crop = img[y:y+h, x:x+w]
        if crop.size == 0:
            return 50.0
            
        # 1. Laplacian variance for blur/sharpness check
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        blur_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        sharpness_factor = min(1.0, blur_var / 300.0)
        
        # 2. Eye-Nose symmetry check
        right_eye, left_eye, nose, r_mouth, l_mouth = landmarks
        eye_dist = math.hypot(left_eye[0] - right_eye[0], left_eye[1] - right_eye[1])
        eye_center = ((right_eye[0] + left_eye[0]) / 2.0, (right_eye[1] + left_eye[1]) / 2.0)
        nose_offset = math.hypot(nose[0] - eye_center[0], nose[1] - eye_center[1])
        
        symmetry_ratio = 1.0 - min(1.0, abs(nose_offset - (eye_dist * 0.5)) / (eye_dist + 1e-5))
        
        score = (sharpness_factor * 50.0) + (symmetry_ratio * 50.0)
        return min(99.9, max(10.0, score))
