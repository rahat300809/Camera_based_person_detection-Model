import sqlite3
import json
import os
import time
from datetime import datetime

DB_PATH = "face_db.sqlite"

class DatabaseManager:
    def __init__(self, db_path=DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS persons (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    role TEXT DEFAULT 'User',
                    notes TEXT DEFAULT '',
                    avatar_path TEXT DEFAULT '',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS embeddings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    person_id INTEGER NOT NULL,
                    vector_json TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS detection_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    person_id INTEGER,
                    person_name TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    similarity REAL NOT NULL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()

    def add_person(self, name, role="User", notes="", avatar_path=""):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO persons (name, role, notes, avatar_path) VALUES (?, ?, ?, ?)",
                (name, role, notes, avatar_path)
            )
            conn.commit()
            return cursor.lastrowid

    def update_person_avatar(self, person_id, avatar_path):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE persons SET avatar_path = ? WHERE id = ?", (avatar_path, person_id))
            conn.commit()

    def add_embedding(self, person_id, vector):
        vector_json = json.dumps([float(v) for v in vector])
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO embeddings (person_id, vector_json) VALUES (?, ?)",
                (person_id, vector_json)
            )
            conn.commit()
            return cursor.lastrowid

    def get_all_persons(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT p.id, p.name, p.role, p.notes, p.avatar_path, p.created_at,
                       COUNT(e.id) as embeddings_count
                FROM persons p
                LEFT JOIN embeddings e ON p.id = e.person_id
                GROUP BY p.id
                ORDER BY p.id DESC
            """)
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def get_person(self, person_id):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM persons WHERE id = ?", (person_id,))
            row = cursor.fetchone()
            if row:
                person = dict(row)
                cursor.execute("SELECT vector_json FROM embeddings WHERE person_id = ?", (person_id,))
                embeddings = [json.loads(r["vector_json"]) for r in cursor.fetchall()]
                person["embeddings"] = embeddings
                return person
            return None

    def get_all_embeddings_with_persons(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT e.person_id, e.vector_json, p.name, p.role, p.avatar_path
                FROM embeddings e
                JOIN persons p ON e.person_id = p.id
            """)
            rows = cursor.fetchall()
            result = []
            for row in rows:
                result.append({
                    "person_id": row["person_id"],
                    "vector": json.loads(row["vector_json"]),
                    "name": row["name"],
                    "role": row["role"],
                    "avatar_path": row["avatar_path"]
                })
            return result

    def delete_person(self, person_id):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM persons WHERE id = ?", (person_id,))
            conn.commit()

    def log_detection(self, person_id, person_name, confidence, similarity):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO detection_logs (person_id, person_name, confidence, similarity) VALUES (?, ?, ?, ?)",
                (person_id, person_name, float(confidence), float(similarity))
            )
            conn.commit()

    def get_recent_logs(self, limit=20):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM detection_logs ORDER BY id DESC LIMIT ?", (limit,)
            )
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def export_database(self):
        persons = self.get_all_persons()
        data = []
        for p in persons:
            p_data = self.get_person(p["id"])
            data.append(p_data)
        return data

    def import_database(self, data):
        count = 0
        for p in data:
            pid = self.add_person(p.get("name", "Imported"), p.get("role", "User"), p.get("notes", ""), p.get("avatar_path", ""))
            for vec in p.get("embeddings", []):
                self.add_embedding(pid, vec)
            count += 1
        return count
