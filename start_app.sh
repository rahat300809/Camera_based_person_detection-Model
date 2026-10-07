#!/bin/bash

# ============================================================
# 🚀 BIOMETRIC AI FACE RECOGNITION & TRAINING SYSTEM
# ============================================================
# Double-click this file in your file manager to start the app.
# ============================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "============================================================"
echo "🚀 BIOMETRIC AI FACE RECOGNITION & TRAINING SYSTEM"
echo "============================================================"
echo "Starting server... Please wait."
echo "============================================================"

# Launch the server in background
python3 run.py &
SERVER_PID=$!

# Wait a moment for the server to start
sleep 3

# Auto-open browser
echo "Opening browser at http://localhost:8000 ..."
if command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:8000"
elif command -v gnome-open &>/dev/null; then
    gnome-open "http://localhost:8000"
elif command -v firefox &>/dev/null; then
    firefox "http://localhost:8000" &
fi

echo ""
echo "✅ Server is running at http://localhost:8000"
echo "   Close this terminal to stop the server."
echo "============================================================"

# Keep script alive until user closes terminal
wait $SERVER_PID
