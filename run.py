import uvicorn
import socket
import os
import sys

def find_available_port(default_port=8000):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(('0.0.0.0', default_port))
        s.close()
        return default_port
    except OSError:
        # Find next available port
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(('0.0.0.0', 0))
        port = s.getsockname()[1]
        s.close()
        return port

if __name__ == "__main__":
    port = find_available_port(8000)
    print("=" * 65)
    print("🚀 BIOMETRIC AI FACE RECOGNITION & TRAINING SYSTEM 🚀")
    print("=" * 65)
    print(f"Server is running on: http://localhost:{port}")
    print("Open the link in your web browser to start real-time detection!")
    print("=" * 65)
    
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False, log_level="info")
