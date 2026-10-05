document.addEventListener("DOMContentLoaded", () => {
    // Audio synthesizer for match chime
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function playMatchBeep() {
        if (!document.getElementById("audio-toggle").checked) return;
        try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.2);
        } catch(e) {}
    }

    // App State
    const state = {
        activeTab: "live",
        cameraActive: false,
        videoStream: null,
        scanInterval: null,
        fps: 0,
        frameCount: 0,
        lastFpsTime: Date.now(),
        cosineThreshold: 0.363,
        detectionConfidence: 0.50,
        registeredPersons: [],
        lastDetectedPersonId: null,
        enrollMode: "webcam",
        enrollCapturedBlob: null
    };

    // DOM Elements
    const elements = {
        navButtons: document.querySelectorAll(".nav-item"),
        tabPanes: document.querySelectorAll(".tab-pane"),
        personsBadgeCount: document.getElementById("persons-badge-count"),
        
        // Live Tab
        webcamVideo: document.getElementById("webcam-video"),
        overlayCanvas: document.getElementById("overlay-canvas"),
        btnToggleCamera: document.getElementById("btn-toggle-camera"),
        camBtnText: document.getElementById("cam-btn-text"),
        hudFpsCounter: document.getElementById("hud-fps-counter"),
        targetDetailsContainer: document.getElementById("target-details-container"),
        matchLogList: document.getElementById("match-log-list"),
        currentThreshDisplay: document.getElementById("current-thresh-display"),
        btnSnapRegister: document.getElementById("btn-snap-register"),

        // Photo Query Tab
        photoDropzone: document.getElementById("photo-dropzone"),
        photoFileInput: document.getElementById("photo-file-input"),
        photoResultPreview: document.getElementById("photo-result-preview"),
        photoAnnotatedImg: document.getElementById("photo-annotated-img"),
        photoAnalysisResults: document.getElementById("photo-analysis-results"),

        // Database Tab
        personsCardsGrid: document.getElementById("persons-cards-grid"),
        dbSearchInput: document.getElementById("db-search-input"),
        btnNavToEnroll: document.getElementById("btn-nav-to-enroll"),

        // Enroll Tab
        modeWebcamBtn: document.getElementById("mode-webcam-btn"),
        modeUploadBtn: document.getElementById("mode-upload-btn"),
        enrollWebcamBox: document.getElementById("enroll-webcam-box"),
        enrollFileBox: document.getElementById("enroll-file-box"),
        enrollVideo: document.getElementById("enroll-video"),
        btnSnapEnroll: document.getElementById("btn-snap-enroll"),
        enrollFileInput: document.getElementById("enroll-file-input"),
        enrollFileTrigger: document.getElementById("enroll-file-trigger"),
        enrollPreviewImg: document.getElementById("enroll-preview-img"),
        previewLandmarkTag: document.getElementById("preview-landmark-tag"),
        enrollForm: document.getElementById("enroll-form"),

        // Settings Tab
        inputCosineThresh: document.getElementById("input-cosine-thresh"),
        threshValText: document.getElementById("thresh-val-text"),
        inputDetConf: document.getElementById("input-det-conf"),
        detConfValText: document.getElementById("det-conf-val-text"),
        btnExportDb: document.getElementById("btn-export-db"),
        btnImportDbTrigger: document.getElementById("btn-import-db-trigger"),
        importDbFile: document.getElementById("import-db-file"),

        toastContainer: document.getElementById("toast-container")
    };

    // --- TAB SWITCHING ---
    elements.navButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const targetTab = btn.getAttribute("data-tab");
            switchTab(targetTab);
        });
    });

    if (elements.btnNavToEnroll) {
        elements.btnNavToEnroll.addEventListener("click", () => switchTab("enroll"));
    }

    function switchTab(tabId) {
        state.activeTab = tabId;
        elements.navButtons.forEach(btn => {
            btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
        });
        elements.tabPanes.forEach(pane => {
            pane.classList.toggle("active", pane.id === `tab-${tabId}`);
        });

        if (tabId === "database") {
            loadPersonsDatabase();
        } else if (tabId === "enroll") {
            initEnrollTab();
        }
    }

    // Toast Notification helper
    function showToast(message, type = "info") {
        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
            <span>${message}</span>
        `;
        elements.toastContainer.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    // --- LIVE WEBCAM SCANNER ---
    elements.btnToggleCamera.addEventListener("click", toggleCamera);

    async function toggleCamera() {
        if (state.cameraActive) {
            stopCamera();
        } else {
            await startCamera();
        }
    }

    async function startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            state.videoStream = stream;
            elements.webcamVideo.srcObject = stream;
            state.cameraActive = true;
            elements.camBtnText.textContent = "Stop Camera";
            elements.btnToggleCamera.classList.remove("btn-primary");
            elements.btnToggleCamera.classList.add("btn-danger");

            showToast("Camera scanner activated", "success");

            // Start processing loop
            clearInterval(state.scanInterval);
            state.scanInterval = setInterval(processWebcamFrame, 250);
        } catch (err) {
            console.error("Camera access error:", err);
            showToast("Could not access webcam stream. Please grant camera permissions.", "danger");
        }
    }

    function stopCamera() {
        if (state.videoStream) {
            state.videoStream.getTracks().forEach(track => track.stop());
            state.videoStream = null;
        }
        clearInterval(state.scanInterval);
        state.cameraActive = false;
        elements.webcamVideo.srcObject = null;
        elements.camBtnText.textContent = "Start Camera";
        elements.btnToggleCamera.classList.remove("btn-danger");
        elements.btnToggleCamera.classList.add("btn-primary");
        
        // Clear canvas
        const ctx = elements.overlayCanvas.getContext("2d");
        ctx.clearRect(0, 0, elements.overlayCanvas.width, elements.overlayCanvas.height);
    }

    async function processWebcamFrame() {
        if (!state.cameraActive || elements.webcamVideo.paused || elements.webcamVideo.ended) return;

        const video = elements.webcamVideo;
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (width === 0 || height === 0) return;

        // Sync overlay canvas size
        if (elements.overlayCanvas.width !== width) elements.overlayCanvas.width = width;
        if (elements.overlayCanvas.height !== height) elements.overlayCanvas.height = height;

        // Capture snapshot frame to canvas
        const frameCanvas = document.createElement("canvas");
        frameCanvas.width = width;
        frameCanvas.height = height;
        const fctx = frameCanvas.getContext("2d");
        fctx.drawImage(video, 0, 0, width, height);

        const frameB64 = frameCanvas.toDataURL("image/jpeg", 0.8);

        // Send to backend API
        const formData = new FormData();
        formData.append("image_b64", frameB64);
        formData.append("confidence_threshold", state.detectionConfidence);
        formData.append("similarity_threshold", state.cosineThreshold);
        formData.append("render_hud", false);

        try {
            const res = await fetch("/api/identify", { method: "POST", body: formData });
            const data = await res.json();
            
            // Draw overlays on live canvas
            drawLiveOverlays(data.faces || []);
            updateLiveHudSidebar(data.faces || []);
            
            // FPS calculation
            state.frameCount++;
            const now = Date.now();
            if (now - state.lastFpsTime >= 1000) {
                state.fps = state.frameCount;
                state.frameCount = 0;
                state.lastFpsTime = now;
                elements.hudFpsCounter.textContent = `FPS: ${state.fps}`;
            }
        } catch (err) {
            console.error("Frame recognition error:", err);
        }
    }

    function drawLiveOverlays(faces) {
        const ctx = elements.overlayCanvas.getContext("2d");
        ctx.clearRect(0, 0, elements.overlayCanvas.width, elements.overlayCanvas.height);

        faces.forEach(face => {
            const [x, y, w, h] = face.bbox;
            const isMatched = face.matched;
            const color = isMatched ? "#00f5a0" : "#ff9900"; // Neon Emerald or Orange

            // Bounding Box
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, w, h);

            // Facial Landmark Dots (Eyes, Nose, Mouth)
            if (face.landmarks) {
                face.landmarks.forEach(lm => {
                    ctx.fillStyle = "#e100ff";
                    ctx.beginPath();
                    ctx.arc(lm[0], lm[1], 4, 0, 2 * Math.PI);
                    ctx.fill();
                });
            }

            // Label Badge
            const labelText = isMatched 
                ? `${face.person_name} (${Math.round(face.cosine_similarity * 100)}%)`
                : "Unknown Person";

            ctx.font = "600 14px Inter, sans-serif";
            const textWidth = ctx.measureText(labelText).width;
            
            ctx.fillStyle = color;
            ctx.fillRect(x, y - 28, textWidth + 16, 28);

            ctx.fillStyle = "#000000";
            ctx.fillText(labelText, x + 8, y - 9);
        });
    }

    function updateLiveHudSidebar(faces) {
        if (faces.length === 0) return;

        const primaryFace = faces[0];
        if (primaryFace.matched) {
            if (state.lastDetectedPersonId !== primaryFace.person_id) {
                state.lastDetectedPersonId = primaryFace.person_id;
                playMatchBeep();
                addMatchLogEntry(primaryFace.person_name, primaryFace.cosine_similarity);
            }

            elements.targetDetailsContainer.innerHTML = `
                <div class="target-card-matched">
                    <img class="target-avatar" src="${primaryFace.avatar_path || '/static/default-avatar.png'}" alt="${primaryFace.person_name}">
                    <div class="target-name">${primaryFace.person_name}</div>
                    <div class="target-role-badge">${primaryFace.role}</div>
                    <div class="metrics-pill mt-2">
                        Match Confidence: <strong>${Math.round(primaryFace.cosine_similarity * 100)}%</strong>
                    </div>
                </div>
            `;
        } else {
            elements.targetDetailsContainer.innerHTML = `
                <div class="target-card-empty">
                    <div class="text-warning" style="font-size: 1.1rem; font-weight: 700; color: var(--neon-orange);">
                        Unregistered Face Detected
                    </div>
                    <p class="mt-2">No database match found above threshold (${state.cosineThreshold}).</p>
                    <button class="btn btn-secondary btn-sm mt-3" id="btn-quick-enroll-unknown">
                        Enroll This Face
                    </button>
                </div>
            `;
            
            const btnQuick = document.getElementById("btn-quick-enroll-unknown");
            if (btnQuick) {
                btnQuick.addEventListener("click", () => switchTab("enroll"));
            }
        }
    }

    function addMatchLogEntry(name, similarity) {
        const timeStr = new Date().toLocaleTimeString();
        const li = document.createElement("li");
        li.className = "log-item";
        li.innerHTML = `
            <span><strong>${name}</strong></span>
            <span class="text-sub">${Math.round(similarity * 100)}% match • ${timeStr}</span>
        `;
        
        // Remove empty state if present
        const empty = elements.matchLogList.querySelector(".empty");
        if (empty) empty.remove();

        elements.matchLogList.prepend(li);
        if (elements.matchLogList.children.length > 10) {
            elements.matchLogList.lastElementChild.remove();
        }
    }

    elements.btnSnapRegister.addEventListener("click", () => {
        if (!state.cameraActive || !elements.webcamVideo || elements.webcamVideo.videoWidth === 0) {
            showToast("Please start live camera scanner first", "warning");
            return;
        }

        const video = elements.webcamVideo;
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
        state.enrollCapturedDataUrl = dataUrl;
        elements.enrollPreviewImg.src = dataUrl;
        elements.previewLandmarkTag.textContent = "Live Frame Captured";
        elements.previewLandmarkTag.style.background = "rgba(0, 245, 160, 0.9)";

        switchTab("enroll");
        showToast("Live frame captured! Enter details to complete training.", "info");
    });

    // --- PHOTO QUERY TAB ---
    elements.photoDropzone.addEventListener("click", () => elements.photoFileInput.click());
    
    elements.photoDropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        elements.photoDropzone.classList.add("dragover");
    });

    elements.photoDropzone.addEventListener("dragleave", () => {
        elements.photoDropzone.classList.remove("dragover");
    });

    elements.photoDropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        elements.photoDropzone.classList.remove("dragover");
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            processPhotoFile(e.dataTransfer.files[0]);
        }
    });

    elements.photoFileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
            processPhotoFile(e.target.files[0]);
        }
    });

    async function processPhotoFile(file) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("confidence_threshold", state.detectionConfidence);
        formData.append("similarity_threshold", state.cosineThreshold);
        formData.append("render_hud", "true");

        try {
            showToast("Analyzing facial features...", "info");
            const res = await fetch("/api/identify", { method: "POST", body: formData });
            const data = await res.json();

            if (data.rendered_image_b64) {
                elements.photoAnnotatedImg.src = data.rendered_image_b64;
                elements.photoResultPreview.classList.remove("hidden");
                elements.photoDropzone.classList.add("hidden");
            }

            // Render detection list
            if (data.faces.length === 0) {
                elements.photoAnalysisResults.innerHTML = `
                    <div class="empty-state">
                        <p>No faces were detected in the uploaded photo.</p>
                    </div>
                `;
            } else {
                elements.photoAnalysisResults.innerHTML = data.faces.map((f, i) => `
                    <div class="card card-glass mb-3" style="padding: 16px;">
                        <div class="flex-row justify-between align-center">
                            <div>
                                <h4 style="font-size: 1rem; color: ${f.matched ? 'var(--neon-green)' : 'var(--neon-orange)'}">
                                    Face #${i+1}: ${f.person_name}
                                </h4>
                                <span class="text-sub" style="font-size: 0.8rem;">Role: ${f.role}</span>
                            </div>
                            <div class="badge ${f.matched ? 'badge-accent' : ''}">
                                ${f.matched ? `${Math.round(f.cosine_similarity * 100)}% Match` : 'Unregistered'}
                            </div>
                        </div>
                        <div class="mt-2 text-sub" style="font-size: 0.78rem;">
                            Detection Conf: ${Math.round(f.confidence * 100)}% | Liveness Index: ${f.liveness_score}/100
                        </div>
                    </div>
                `).join("");
            }

            showToast(`Detected ${data.faces_count} faces in image`, "success");
        } catch (err) {
            console.error("Photo analysis error:", err);
            showToast("Failed to analyze image file", "danger");
        }
    }

    // --- PERSONS DATABASE TAB ---
    async function loadPersonsDatabase() {
        try {
            const res = await fetch("/api/persons");
            const persons = await res.json();
            state.registeredPersons = persons;
            elements.personsBadgeCount.textContent = persons.length;
            renderPersonsGrid(persons);
        } catch (err) {
            console.error("Failed to load persons DB:", err);
        }
    }

    function renderPersonsGrid(persons) {
        if (persons.length === 0) {
            elements.personsCardsGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 48px;">
                    <h3>No Persons Enrolled Yet</h3>
                    <p class="text-sub mt-2">Click "Train New Person" to register your first face model.</p>
                </div>
            `;
            return;
        }

        elements.personsCardsGrid.innerHTML = persons.map(p => `
            <div class="person-card">
                <img class="person-card-avatar" src="${p.avatar_path || '/static/default-avatar.png'}" alt="${p.name}">
                <div class="person-card-name">${p.name}</div>
                <div class="person-card-role">${p.role}</div>
                <div class="person-card-meta">
                    ${p.embeddings_count || 1} face vector embedding(s) registered
                </div>
                ${p.notes ? `<p class="mt-2 text-sub" style="font-size: 0.78rem;">"${p.notes}"</p>` : ''}
                <div class="person-card-actions">
                    <button class="btn btn-danger btn-sm w-full btn-delete-person" data-id="${p.id}">
                        Delete Profile
                    </button>
                </div>
            </div>
        `).join("");

        // Delete buttons event handlers
        document.querySelectorAll(".btn-delete-person").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const id = e.target.getAttribute("data-id");
                if (confirm("Are you sure you want to delete this enrolled person profile?")) {
                    await fetch(`/api/persons/${id}`, { method: "DELETE" });
                    showToast("Person profile deleted", "info");
                    loadPersonsDatabase();
                }
            });
        });
    }

    elements.dbSearchInput.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = state.registeredPersons.filter(p => 
            p.name.toLowerCase().includes(query) || p.role.toLowerCase().includes(query)
        );
        renderPersonsGrid(filtered);
    });

    // --- ENROLLMENT WIZARD ---
    function initEnrollTab() {
        if (state.enrollMode === "webcam") {
            startEnrollWebcam();
        }
    }

    elements.modeWebcamBtn.addEventListener("click", () => {
        state.enrollMode = "webcam";
        elements.modeWebcamBtn.classList.add("active");
        elements.modeUploadBtn.classList.remove("active");
        elements.enrollWebcamBox.classList.remove("hidden");
        elements.enrollFileBox.classList.add("hidden");
        startEnrollWebcam();
    });

    elements.modeUploadBtn.addEventListener("click", () => {
        state.enrollMode = "upload";
        elements.modeUploadBtn.classList.add("active");
        elements.modeWebcamBtn.classList.remove("active");
        elements.enrollFileBox.classList.remove("hidden");
        elements.enrollWebcamBox.classList.add("hidden");
    });

    async function startEnrollWebcam() {
        try {
            if (state.cameraActive && state.videoStream) {
                elements.enrollVideo.srcObject = state.videoStream;
                elements.enrollVideo.play().catch(e => {});
            } else {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1280 }, height: { ideal: 720 } }
                });
                state.enrollStream = stream;
                elements.enrollVideo.srcObject = stream;
                elements.enrollVideo.play().catch(e => {});
            }
        } catch (err) {
            console.error("Enrollment camera error:", err);
            showToast("Camera access error. You can also upload a photo file.", "warning");
        }
    }

    elements.btnSnapEnroll.addEventListener("click", async () => {
        let activeVideo = elements.enrollVideo;

        if ((!activeVideo || activeVideo.videoWidth === 0) && elements.webcamVideo && elements.webcamVideo.videoWidth > 0) {
            activeVideo = elements.webcamVideo;
        }

        if (!activeVideo || activeVideo.videoWidth === 0) {
            showToast("Camera stream not ready. Ensure camera is on or select photo file.", "danger");
            return;
        }

        const canvas = elements.enrollCanvas;
        canvas.width = activeVideo.videoWidth;
        canvas.height = activeVideo.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(activeVideo, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
        elements.enrollPreviewImg.src = dataUrl;
        elements.previewLandmarkTag.textContent = "Analyzing Face...";
        state.enrollCapturedDataUrl = dataUrl;

        try {
            const formData = new FormData();
            formData.append("image_b64", dataUrl);
            formData.append("confidence_threshold", 0.4);
            formData.append("similarity_threshold", 0.363);
            formData.append("render_hud", "true");

            const res = await fetch("/api/identify", { method: "POST", body: formData });
            const data = await res.json();

            if (data.rendered_image_b64) {
                elements.enrollPreviewImg.src = data.rendered_image_b64;
            }

            if (data.faces && data.faces.length > 0) {
                const face = data.faces[0];
                elements.previewLandmarkTag.textContent = `Face Verified (${Math.round(face.confidence * 100)}% Conf)`;
                elements.previewLandmarkTag.style.background = "rgba(0, 245, 160, 0.9)";
                showToast("Face frame captured and verified!", "success");
            } else {
                elements.previewLandmarkTag.textContent = "No Face Detected";
                elements.previewLandmarkTag.style.background = "rgba(255, 51, 102, 0.9)";
                showToast("No face detected in frame. Align your face and capture again.", "warning");
            }
        } catch (e) {
            elements.previewLandmarkTag.textContent = "Snapshot Captured";
            showToast("Face frame captured!", "success");
        }
    });

    elements.enrollFileTrigger.addEventListener("click", () => elements.enrollFileInput.click());
    elements.enrollFileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const dataUrl = event.target.result;
                elements.enrollPreviewImg.src = dataUrl;
                elements.previewLandmarkTag.textContent = "Analyzing Photo...";
                state.enrollCapturedDataUrl = dataUrl;

                try {
                    const formData = new FormData();
                    formData.append("image_b64", dataUrl);
                    formData.append("confidence_threshold", 0.4);
                    formData.append("similarity_threshold", 0.363);
                    formData.append("render_hud", "true");

                    const res = await fetch("/api/identify", { method: "POST", body: formData });
                    const data = await res.json();

                    if (data.rendered_image_b64) {
                        elements.enrollPreviewImg.src = data.rendered_image_b64;
                    }

                    if (data.faces && data.faces.length > 0) {
                        elements.previewLandmarkTag.textContent = `Face Verified (${Math.round(data.faces[0].confidence * 100)}% Conf)`;
                        elements.previewLandmarkTag.style.background = "rgba(0, 245, 160, 0.9)";
                        showToast("Photo loaded and face verified!", "success");
                    } else {
                        elements.previewLandmarkTag.textContent = "No Face Detected";
                        elements.previewLandmarkTag.style.background = "rgba(255, 51, 102, 0.9)";
                        showToast("No face detected in photo. Try a clearer image.", "warning");
                    }
                } catch (e) {
                    elements.previewLandmarkTag.textContent = "Photo Loaded";
                }
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    });

    elements.enrollForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = document.getElementById("enroll-name").value.trim();
        const role = document.getElementById("enroll-role").value;
        const notes = document.getElementById("enroll-notes").value;

        if (!state.enrollCapturedDataUrl) {
            showToast("Please capture or upload a face image first!", "warning");
            return;
        }

        const formData = new FormData();
        formData.append("name", name);
        formData.append("role", role);
        formData.append("notes", notes);
        formData.append("image_b64", state.enrollCapturedDataUrl);

        try {
            showToast("Registering person & extracting 128D embedding...", "info");
            const res = await fetch("/api/register", { method: "POST", body: formData });
            const data = await res.json();

            if (res.ok && data.success) {
                showToast(`Successfully enrolled ${name}!`, "success");
                elements.enrollForm.reset();
                state.enrollCapturedDataUrl = null;
                switchTab("database");
            } else {
                showToast(data.detail || "Registration failed", "danger");
            }
        } catch (err) {
            console.error("Registration error:", err);
            showToast("Failed to register person", "danger");
        }
    });

    // --- SETTINGS TAB ---
    elements.inputCosineThresh.addEventListener("input", (e) => {
        state.cosineThreshold = parseFloat(e.target.value);
        elements.threshValText.textContent = state.cosineThreshold.toFixed(3);
        elements.currentThreshDisplay.textContent = state.cosineThreshold.toFixed(3);
    });

    elements.inputDetConf.addEventListener("input", (e) => {
        state.detectionConfidence = parseFloat(e.target.value);
        elements.detConfValText.textContent = state.detectionConfidence.toFixed(2);
    });

    elements.btnExportDb.addEventListener("click", async () => {
        const res = await fetch("/api/export-db");
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `face_db_backup_${Date.now()}.json`;
        a.click();
        showToast("Exported face database JSON", "success");
    });

    elements.btnImportDbTrigger.addEventListener("click", () => elements.importDbFile.click());
    elements.importDbFile.addEventListener("change", async (e) => {
        if (e.target.files && e.target.files[0]) {
            const text = await e.target.files[0].text();
            const data = JSON.parse(text);
            const res = await fetch("/api/import-db", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            showToast(`Imported ${result.imported_count} person records!`, "success");
            loadPersonsDatabase();
        }
    });

    // Initialize status
    fetch("/api/status").then(r => r.json()).then(data => {
        if (data.registered_persons_count !== undefined) {
            elements.personsBadgeCount.textContent = data.registered_persons_count;
        }
    });

    // Initial DB fetch
    loadPersonsDatabase();
});
