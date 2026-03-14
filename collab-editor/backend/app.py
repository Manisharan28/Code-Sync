"""
CodeSync — Collaborative Code Editor Backend (Flask + Socket.IO)

=== DB Models ===
  User         — Registered users (username, email, password_hash, avatar_color)
  Room         — Persistent rooms (room_code, name, created_by, is_active)
  RoomMember   — User membership in a room (role, status: pending/approved/rejected)

=== HTTP Routes ===
  GET  /health                          — Health check
  POST /signup                          — Create account
  POST /login                           — Login (session-based)
  GET  /logout                          — Logout
  GET  /me                              — Current logged-in user info
  POST /rooms                           — Create a new room
  GET  /rooms/<id>/exists               — Check if room exists
  POST /rooms/<id>/validate_password    — Validate room password

=== Socket.IO Events ===
CLIENT → SERVER:
  join_room          — Join/create a room (with session_id for dedup)
  join_request       — User requests to join room (role approval flow)
  approve_join       — Admin approves a join request with role
  reject_join        — Admin rejects a join request
  code_change        — Code edited in a file
  cursor_move        — User cursor position changed
  chat_message       — Chat text sent
  language_change    — Programming language changed
  file_change        — Create or switch file
  delete_file        — Delete a file from the room
  camera_toggle      — Toggle own camera status
  mic_toggle         — Toggle own mic status
  media_state        — Mic/camera toggle state
  run_code           — Execute code in terminal
  terminal_input     — Send stdin to running process
  webrtc_offer       — WebRTC SDP offer  (signaling)
  webrtc_answer      — WebRTC SDP answer (signaling)
  webrtc_ice         — WebRTC ICE candidate (signaling)
  change_role        — Admin changes a user's role
  kick_user          — Admin kicks a user from the room

SERVER → CLIENT:
  room_joined        — Full room state on join
  join_error         — Error joining room
  user_joined        — A new user joined
  user_left          — A user left
  code_update        — Code changed by another user
  cursor_update      — Remote cursor moved
  chat_message       — Chat message broadcast
  language_update    — Language changed
  file_update        — File created/switched
  file_deleted       — File deleted
  camera_toggle      — Camera status changed
  mic_toggle         — Mic status changed
  media_state_update — Broadcast media state to room
  terminal_output    — PTY/process output stream
  run_output         — Code execution result
  webrtc_offer       — Forwarded WebRTC offer
  webrtc_answer      — Forwarded WebRTC answer
  webrtc_ice         — Forwarded ICE candidate
  pending_join_request — Notify admins of pending request
  join_approved      — Tell user they're approved + role
  join_rejected      — Tell user they're rejected
  role_changed       — Broadcast role update
  user_kicked        — Tell kicked user + update room
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
import threading
import uuid
import random
import string
from datetime import datetime
from functools import wraps
from typing import Any

from flask import Flask, jsonify, request, session, redirect, url_for
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, emit, join_room, leave_room
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'codesync-secret-key-change-in-prod')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///codesync.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
CORS(app, supports_credentials=True)
db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading", manage_session=False)


# ---------------------------------------------------------------------------
# Database models
# ---------------------------------------------------------------------------
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    avatar_color = db.Column(db.String(7), default='#4A90D9')

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'avatar_color': self.avatar_color,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class Room(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    room_code = db.Column(db.String(20), unique=True, nullable=False)
    name = db.Column(db.String(100))
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    is_active = db.Column(db.Boolean, default=True)
    password = db.Column(db.String(100), default='')


class RoomMember(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.Integer, db.ForeignKey('room.id'))
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    role = db.Column(db.String(20), nullable=True)  # admin, deputy_admin, editor, reviewer, viewer
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(20), default='pending')  # pending, approved, rejected


# ---------------------------------------------------------------------------
# Role helpers
# ---------------------------------------------------------------------------
ROLE_HIERARCHY = {
    'admin': 5,
    'deputy_admin': 4,
    'editor': 3,
    'reviewer': 2,
    'viewer': 1,
}

ROLE_DISPLAY = {
    'admin': {'emoji': '👑', 'label': 'Admin', 'color': '#FFD700'},
    'deputy_admin': {'emoji': '⭐', 'label': 'Deputy Admin', 'color': '#C0C0C0'},
    'editor': {'emoji': '✏️', 'label': 'Editor', 'color': '#4A90D9'},
    'reviewer': {'emoji': '🔍', 'label': 'Reviewer', 'color': '#9B59B6'},
    'viewer': {'emoji': '👁️', 'label': 'Viewer', 'color': '#808080'},
}


def get_user_role(user_id, room_code):
    """Get role of a user in a room by room_code."""
    room = Room.query.filter_by(room_code=room_code).first()
    if not room:
        return None
    member = RoomMember.query.filter_by(user_id=user_id, room_id=room.id, status='approved').first()
    return member.role if member else None


def can_write(role):
    return role in ['admin', 'deputy_admin', 'editor']


def can_approve(role):
    return role in ['admin', 'deputy_admin', 'reviewer']


def is_admin(role):
    return role == 'admin'


def is_admin_or_deputy(role):
    return role in ['admin', 'deputy_admin']


# ---------------------------------------------------------------------------
# In-memory state (for real-time collaboration)
# ---------------------------------------------------------------------------
CURSOR_COLORS = [
    "#89b4fa", "#a6e3a1", "#f9e2af", "#f38ba8",
    "#cba6f7", "#94e2d5", "#fab387", "#74c7ec",
]

rooms: dict[str, dict[str, Any]] = {}
active_processes: dict[str, dict] = {}

DEFAULT_FILES = {"main.py": "# Start coding here\n"}


def create_room_state(room_id: str, password: str = "") -> dict[str, Any]:
    rooms[room_id] = {
        "files": dict(DEFAULT_FILES),
        "activeFile": "main.py",
        "users": {},
        "chat": [],
        "language": "python",
        "password": password,
    }
    return rooms[room_id]


def assign_color(room_data: dict) -> str:
    used = {u["cursorColor"] for u in room_data["users"].values()}
    for color in CURSOR_COLORS:
        if color not in used:
            return color
    return CURSOR_COLORS[len(room_data["users"]) % len(CURSOR_COLORS)]


def user_list(room_data: dict) -> list[dict]:
    return [
        {
            "userId": u["userId"],
            "nickname": u["nickname"],
            "cursorColor": u["cursorColor"],
            "cameraEnabled": u.get("cameraEnabled", False),
            "micEnabled": u.get("micEnabled", False),
            "sessionId": u.get("sessionId", ""),
            "role": u.get("role", "viewer"),
            "dbUserId": u.get("dbUserId", None),
        }
        for u in room_data["users"].values()
    ]


# ---------------------------------------------------------------------------
# Code execution helper
# ---------------------------------------------------------------------------
EXEC_TIMEOUT = 30

import shutil


def _run_code_subprocess(code: str, language: str, sid: str):
    """Run code in a subprocess, stream output back via socket, accept stdin."""
    ext_map = {"python": ".py", "javascript": ".js", "cpp": ".cpp", "java": ".java"}
    ext = ext_map.get(language, ".py")
    run_id = uuid.uuid4().hex[:8]
    temp_dir = tempfile.gettempdir()
    code_path = os.path.join(temp_dir, f"cs_{run_id}_code{ext}")
    out_path = None

    with open(code_path, "w", encoding="utf-8") as f:
        f.write(code)

    try:
        if language == "cpp":
            if not shutil.which("g++"):
                socketio.emit("terminal_output", {
                    "output": "Error: g++ not found. Install MinGW-w64 (Windows) or gcc (Linux/Mac).\n",
                    "done": True, "returncode": 1,
                }, to=sid)
                return
            out_path = os.path.join(temp_dir, f"cs_{run_id}_out" + (".exe" if os.name == "nt" else ""))
            comp = subprocess.run(
                ["g++", "-o", out_path, code_path],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                timeout=20, check=False,
            )
            comp_stderr = comp.stderr.decode("utf-8", errors="replace")
            comp_stdout = comp.stdout.decode("utf-8", errors="replace")
            if comp.returncode != 0:
                error_out = comp_stderr or comp_stdout or "Unknown compilation error"
                socketio.emit("terminal_output", {
                    "output": f"[Compilation Error]\n{error_out}\n",
                    "done": True, "returncode": comp.returncode,
                }, to=sid)
                return
            if comp_stderr.strip():
                socketio.emit("terminal_output", {
                    "output": f"[Compiler Warnings]\n{comp_stderr}\n",
                    "done": False,
                }, to=sid)
            cmd = [out_path]
        elif language == "python":
            cmd = [sys.executable, "-u", code_path]
        elif language == "javascript":
            if not shutil.which("node"):
                socketio.emit("terminal_output", {
                    "output": "Error: node not found on PATH.\n",
                    "done": True, "returncode": 1,
                }, to=sid)
                return
            cmd = ["node", code_path]
        elif language == "java":
            cmd = ["java", code_path]
        else:
            cmd = [sys.executable, "-u", code_path]

        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )

        active_processes[sid] = {
            "proc": proc,
            "code_path": code_path,
            "out_path": out_path,
        }

        def read_stream(stream, is_stderr=False):
            try:
                while True:
                    line = stream.readline()
                    if not line:
                        break
                    text = line.decode("utf-8", errors="replace")
                    socketio.emit("terminal_output", {
                        "output": ("[stderr] " if is_stderr else "") + text,
                        "done": False,
                    }, to=sid)
            except Exception:
                pass
            finally:
                try:
                    stream.close()
                except Exception:
                    pass

        t_out = threading.Thread(target=read_stream, args=(proc.stdout, False), daemon=True)
        t_err = threading.Thread(target=read_stream, args=(proc.stderr, True), daemon=True)
        t_out.start()
        t_err.start()

        try:
            proc.wait(timeout=EXEC_TIMEOUT)
        except subprocess.TimeoutExpired:
            proc.kill()
            try:
                proc.stdin.close()
            except Exception:
                pass
            socketio.emit("terminal_output", {
                "output": f"\nExecution timed out ({EXEC_TIMEOUT}s limit).\n",
                "done": True, "returncode": 124,
            }, to=sid)
            return

        t_out.join(timeout=3)
        t_err.join(timeout=3)

        socketio.emit("terminal_output", {
            "output": "",
            "done": True, "returncode": proc.returncode,
        }, to=sid)

    except FileNotFoundError as e:
        socketio.emit("terminal_output", {
            "output": f"Runtime not found: {e}\n",
            "done": True, "returncode": 1,
        }, to=sid)
    finally:
        active_processes.pop(sid, None)
        for p in (code_path, out_path):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def login_required_api(f):
    """Decorator for API routes that require login. Returns JSON error."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated


def get_socket_user_id():
    """Get DB user_id from the flask session during a socket event."""
    return session.get('user_id')


# ---------------------------------------------------------------------------
# HTTP routes
# ---------------------------------------------------------------------------
@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/signup")
def signup():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    errors = {}

    # Username validation
    if not username:
        errors['username'] = 'Username is required.'
    elif len(username) < 3 or len(username) > 20:
        errors['username'] = 'Username must be 3–20 characters.'
    elif not all(c.isalnum() or c == '_' for c in username):
        errors['username'] = 'Only letters, numbers, and underscores allowed.'
    else:
        if User.query.filter_by(username=username).first():
            errors['username'] = 'Username already taken.'

    # Email validation
    if not email:
        errors['email'] = 'Email is required.'
    elif '@' not in email or '.' not in email.split('@')[-1]:
        errors['email'] = 'Invalid email format.'
    else:
        if User.query.filter_by(email=email).first():
            errors['email'] = 'Email already registered.'

    # Password validation
    if not password:
        errors['password'] = 'Password is required.'
    elif len(password) < 8:
        errors['password'] = 'Password must be at least 8 characters.'
    elif not any(c.isdigit() for c in password):
        errors['password'] = 'Password must contain at least one number.'

    if errors:
        return jsonify({'errors': errors}), 400

    # Pick a random avatar color
    colors = ['#4A90D9', '#a6e3a1', '#f38ba8', '#cba6f7', '#94e2d5', '#fab387', '#f9e2af', '#89b4fa']
    user = User(
        username=username,
        email=email,
        password_hash=generate_password_hash(password),
        avatar_color=random.choice(colors),
    )
    db.session.add(user)
    db.session.commit()
    return jsonify({'message': 'Account created! Please log in.', 'username': username}), 201


@app.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    identifier = (data.get('identifier') or '').strip()
    password = data.get('password') or ''

    if not identifier or not password:
        return jsonify({'error': 'Please provide username/email and password.'}), 400

    # Lookup by username or email
    user = User.query.filter(
        (User.username == identifier) | (User.email == identifier.lower())
    ).first()

    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'Invalid username/password.'}), 401

    session['user_id'] = user.id
    session['username'] = user.username
    session.permanent = True

    return jsonify({
        'message': 'Login successful',
        'user': user.to_dict(),
    }), 200


@app.get("/logout")
def logout():
    session.clear()
    return jsonify({'message': 'Logged out'}), 200


@app.get("/me")
def get_me():
    if 'user_id' not in session:
        return jsonify({'authenticated': False}), 200
    user = User.query.get(session['user_id'])
    if not user:
        session.clear()
        return jsonify({'authenticated': False}), 200
    return jsonify({'authenticated': True, 'user': user.to_dict()}), 200


@app.post("/rooms")
def create_room_endpoint():
    """Create a new room. Returns 409 if room ID is already taken."""
    payload = request.get_json(silent=True) or {}
    room_id = payload.get("roomId", "").strip()
    password = payload.get("password", "").strip()

    if not room_id:
        room_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))

    if room_id in rooms:
        return jsonify({"error": "Room ID already taken"}), 409

    # Create in-memory state
    create_room_state(room_id, password)

    # Create DB room if user is logged in
    db_user_id = session.get('user_id')
    db_room = Room.query.filter_by(room_code=room_id).first()
    if not db_room:
        db_room = Room(
            room_code=room_id,
            name=room_id,
            created_by=db_user_id,
            password=password,
        )
        db.session.add(db_room)
        db.session.commit()

        # Creator becomes admin
        if db_user_id:
            member = RoomMember(
                room_id=db_room.id,
                user_id=db_user_id,
                role='admin',
                status='approved',
            )
            db.session.add(member)
            db.session.commit()

    return jsonify({"roomId": room_id, "hasPassword": bool(password)}), 201


@app.get("/rooms/<room_id>/exists")
def room_exists(room_id: str):
    if room_id in rooms:
        return jsonify({"exists": True, "hasPassword": bool(rooms[room_id].get("password", ""))}), 200
    # Check DB
    db_room = Room.query.filter_by(room_code=room_id, is_active=True).first()
    if db_room:
        return jsonify({"exists": True, "hasPassword": bool(db_room.password)}), 200
    return jsonify({"exists": False}), 200


@app.post("/rooms/<room_id>/validate_password")
def validate_room_password(room_id: str):
    if room_id not in rooms:
        return jsonify({"valid": False, "error": "Room not found"}), 404
    payload = request.get_json(silent=True) or {}
    entered = payload.get("password", "")
    expected = rooms[room_id].get("password", "")
    if not expected or entered == expected:
        return jsonify({"valid": True}), 200
    return jsonify({"valid": False, "error": "Incorrect password"}), 200


@app.post("/run")
def run_code():
    payload = request.get_json(silent=True) or {}
    code = payload.get("code", "")
    language = payload.get("language", "python")

    ext_map = {"python": ".py", "javascript": ".js", "cpp": ".cpp", "java": ".java"}
    ext = ext_map.get(language, ".py")
    run_id = uuid.uuid4().hex[:8]
    temp_dir = tempfile.gettempdir()
    code_path = os.path.join(temp_dir, f"cs_{run_id}_code{ext}")
    out_path = None

    with open(code_path, "w", encoding="utf-8") as f:
        f.write(code)

    try:
        if language == "cpp":
            out_path = os.path.join(temp_dir, f"cs_{run_id}_out" + (".exe" if os.name == "nt" else ""))
            comp = subprocess.run(
                ["g++", code_path, "-o", out_path],
                capture_output=True, text=True, timeout=15, check=False,
            )
            if comp.returncode != 0:
                return jsonify({"stdout": "", "stderr": f"Compilation Error:\n{comp.stderr}", "returncode": comp.returncode})
            cmd = [out_path]
        elif language == "python":
            cmd = [sys.executable, code_path]
        elif language == "javascript":
            cmd = ["node", code_path]
        elif language == "java":
            cmd = ["java", code_path]
        else:
            cmd = [sys.executable, code_path]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=EXEC_TIMEOUT, check=False)
        return jsonify({"stdout": result.stdout, "stderr": result.stderr, "returncode": result.returncode})
    except subprocess.TimeoutExpired:
        return jsonify({"stdout": "", "stderr": f"Execution timed out ({EXEC_TIMEOUT}s limit).", "returncode": 124}), 408
    except FileNotFoundError as e:
        return jsonify({"stdout": "", "stderr": f"Runtime not found: {e}", "returncode": 1})
    finally:
        for p in (code_path, out_path):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass


# ---------------------------------------------------------------------------
# WebSocket events
# ---------------------------------------------------------------------------
@socketio.on("connect")
def handle_connect():
    print(f"[+] Connected: {request.sid}")


@socketio.on("disconnect")
def handle_disconnect():
    sid = request.sid
    proc_info = active_processes.pop(sid, None)
    if proc_info and proc_info.get("proc"):
        try:
            proc_info["proc"].kill()
        except Exception:
            pass

    for room_id, room_data in list(rooms.items()):
        if sid in room_data["users"]:
            user = room_data["users"].pop(sid)
            leave_room(room_id)
            emit("user_left", {
                "userId": user["userId"],
                "nickname": user["nickname"],
                "sessionId": user.get("sessionId", ""),
                "users": user_list(room_data),
            }, to=room_id)
            break
    print(f"[-] Disconnected: {sid}")


@socketio.on("join_room")
def handle_join_room(data):
    room_id = data.get("room", "")
    nickname = data.get("nickname", "Anonymous")
    user_id = data.get("userId", request.sid)
    session_id = data.get("sessionId", "")
    create = data.get("create", False)
    password = data.get("password", "")

    # Get DB user info from session
    db_user_id = session.get('user_id')
    db_username = session.get('username')
    if db_username:
        nickname = db_username  # Use logged-in username, no re-entry

    # Room existence
    if not create and room_id not in rooms:
        emit("join_error", {"message": "Room does not exist. Please check the ID or create a new room."})
        return

    if create and room_id not in rooms:
        room_password = data.get("roomPassword", "")
        create_room_state(room_id, room_password)

    room_data = rooms[room_id]

    # Password check
    expected_password = room_data.get("password", "")
    if expected_password and password != expected_password:
        emit("join_error", {"message": "Incorrect room password."})
        return

    # Get user role from DB
    user_role = 'viewer'  # default
    if db_user_id:
        db_room = Room.query.filter_by(room_code=room_id).first()
        if db_room:
            member = RoomMember.query.filter_by(user_id=db_user_id, room_id=db_room.id).first()
            if member and member.status == 'approved':
                user_role = member.role or 'viewer'
            elif member and member.status == 'pending':
                # Still waiting
                emit("join_pending", {"message": "Waiting for room admin to approve your request..."})
                return
            elif not member:
                # First time joining — if room has no members, make them admin
                member_count = RoomMember.query.filter_by(room_id=db_room.id, status='approved').count()
                if member_count == 0:
                    # First person becomes admin
                    new_member = RoomMember(
                        room_id=db_room.id,
                        user_id=db_user_id,
                        role='admin',
                        status='approved',
                    )
                    db.session.add(new_member)
                    db.session.commit()
                    user_role = 'admin'
                else:
                    # Need approval from admin — create pending request
                    new_member = RoomMember(
                        room_id=db_room.id,
                        user_id=db_user_id,
                        role=None,
                        status='pending',
                    )
                    db.session.add(new_member)
                    db.session.commit()

                    # Notify admins
                    for s, u in room_data["users"].items():
                        if u.get("role") in ['admin', 'deputy_admin']:
                            emit("pending_join_request", {
                                "username": nickname,
                                "userId": user_id,
                                "dbUserId": db_user_id,
                                "roomCode": room_id,
                            }, to=s)

                    emit("join_pending", {"message": "Waiting for room admin to approve your request..."})
                    # Join the socket room so they can receive the approval
                    join_room(room_id)
                    return

    # Duplicate user detection
    existing_sid = None
    display_nickname = nickname
    for s, u in list(room_data["users"].items()):
        if u.get("sessionId") == session_id and session_id:
            existing_sid = s
            break
        elif u["nickname"] == nickname and u.get("sessionId") != session_id:
            count = sum(1 for uu in room_data["users"].values()
                        if uu["nickname"].startswith(nickname))
            display_nickname = f"{nickname} #{count + 1}"

    # Leave any previous room
    for rid, rd in list(rooms.items()):
        if request.sid in rd["users"]:
            old_user = rd["users"].pop(request.sid)
            leave_room(rid)
            if rid != room_id:
                emit("user_left", {
                    "userId": old_user["userId"],
                    "nickname": old_user["nickname"],
                    "sessionId": old_user.get("sessionId", ""),
                    "users": user_list(rd),
                }, to=rid)

    if existing_sid and existing_sid in room_data["users"]:
        room_data["users"].pop(existing_sid)

    color = assign_color(room_data)
    room_data["users"][request.sid] = {
        "userId": user_id,
        "nickname": display_nickname,
        "cursorColor": color,
        "cameraEnabled": False,
        "micEnabled": False,
        "sessionId": session_id,
        "role": user_role,
        "dbUserId": db_user_id,
    }
    join_room(room_id)

    # Send full state to new user
    emit("room_joined", {
        "roomId": room_id,
        "files": room_data["files"],
        "activeFile": room_data["activeFile"],
        "language": room_data["language"],
        "users": user_list(room_data),
        "chat": room_data["chat"][-50:],
        "cursorColor": color,
        "nickname": display_nickname,
        "role": user_role,
    })

    # Notify everyone else
    emit("user_joined", {
        "userId": user_id,
        "nickname": display_nickname,
        "cursorColor": color,
        "sessionId": session_id,
        "users": user_list(room_data),
        "role": user_role,
    }, to=room_id, include_self=False)


@socketio.on("approve_join")
def handle_approve_join(data):
    """Admin approves a join request and assigns a role."""
    approver_db_id = session.get('user_id')
    if not approver_db_id:
        return

    target_db_user_id = data.get("dbUserId")
    room_code = data.get("roomCode", "")
    assigned_role = data.get("role", "viewer")

    if assigned_role not in ['deputy_admin', 'editor', 'reviewer', 'viewer']:
        assigned_role = 'viewer'

    # Verify approver is admin/deputy_admin
    approver_role = get_user_role(approver_db_id, room_code)
    if not is_admin_or_deputy(approver_role):
        return

    # Update DB
    db_room = Room.query.filter_by(room_code=room_code).first()
    if not db_room:
        return
    member = RoomMember.query.filter_by(room_id=db_room.id, user_id=target_db_user_id).first()
    if not member:
        return
    member.status = 'approved'
    member.role = assigned_role
    db.session.commit()

    # Find the user's info
    target_user = User.query.get(target_db_user_id)
    target_username = target_user.username if target_user else 'Unknown'

    # Emit approval to room
    emit("join_approved", {
        "dbUserId": target_db_user_id,
        "username": target_username,
        "role": assigned_role,
        "roomCode": room_code,
    }, to=room_code)


@socketio.on("reject_join")
def handle_reject_join(data):
    """Admin rejects a join request."""
    rejector_db_id = session.get('user_id')
    if not rejector_db_id:
        return

    target_db_user_id = data.get("dbUserId")
    room_code = data.get("roomCode", "")

    rejector_role = get_user_role(rejector_db_id, room_code)
    if not is_admin_or_deputy(rejector_role):
        return

    db_room = Room.query.filter_by(room_code=room_code).first()
    if not db_room:
        return
    member = RoomMember.query.filter_by(room_id=db_room.id, user_id=target_db_user_id).first()
    if member:
        member.status = 'rejected'
        db.session.commit()

    emit("join_rejected", {
        "dbUserId": target_db_user_id,
        "roomCode": room_code,
    }, to=room_code)


@socketio.on("change_role")
def handle_change_role(data):
    """Admin changes a user's role."""
    changer_db_id = session.get('user_id')
    if not changer_db_id:
        return

    target_db_user_id = data.get("dbUserId")
    room_code = data.get("roomCode", "")
    new_role = data.get("role", "viewer")

    if new_role not in ['deputy_admin', 'editor', 'reviewer', 'viewer']:
        return

    changer_role = get_user_role(changer_db_id, room_code)
    if not is_admin(changer_role):
        return

    # Cannot change own role
    if target_db_user_id == changer_db_id:
        return

    db_room = Room.query.filter_by(room_code=room_code).first()
    if not db_room:
        return
    member = RoomMember.query.filter_by(room_id=db_room.id, user_id=target_db_user_id, status='approved').first()
    if not member:
        return

    member.role = new_role
    db.session.commit()

    # Update in-memory state
    if room_code in rooms:
        for sid, u in rooms[room_code]["users"].items():
            if u.get("dbUserId") == target_db_user_id:
                u["role"] = new_role
                break

    emit("role_changed", {
        "dbUserId": target_db_user_id,
        "newRole": new_role,
        "users": user_list(rooms[room_code]) if room_code in rooms else [],
    }, to=room_code)


@socketio.on("kick_user")
def handle_kick_user(data):
    """Admin kicks a user from the room."""
    kicker_db_id = session.get('user_id')
    if not kicker_db_id:
        return

    target_db_user_id = data.get("dbUserId")
    room_code = data.get("roomCode", "")

    kicker_role = get_user_role(kicker_db_id, room_code)
    if not is_admin(kicker_role):
        return

    if target_db_user_id == kicker_db_id:
        return

    # Remove from DB
    db_room = Room.query.filter_by(room_code=room_code).first()
    if db_room:
        member = RoomMember.query.filter_by(room_id=db_room.id, user_id=target_db_user_id).first()
        if member:
            db.session.delete(member)
            db.session.commit()

    # Remove from in-memory state and find the sid
    kicked_sid = None
    kicked_nickname = 'Unknown'
    if room_code in rooms:
        for sid, u in list(rooms[room_code]["users"].items()):
            if u.get("dbUserId") == target_db_user_id:
                kicked_sid = sid
                kicked_nickname = u["nickname"]
                rooms[room_code]["users"].pop(sid)
                break

    if kicked_sid:
        emit("user_kicked", {
            "message": "You have been removed from the room by the admin.",
        }, to=kicked_sid)
        leave_room(room_code, sid=kicked_sid)

    emit("user_left", {
        "userId": "",
        "nickname": kicked_nickname,
        "sessionId": "",
        "users": user_list(rooms[room_code]) if room_code in rooms else [],
        "kicked": True,
    }, to=room_code)


@socketio.on("code_change")
def handle_code_change(data):
    room_id = data.get("room", "")
    code = data.get("code", "")
    filename = data.get("filename", "main.py")

    # Permission check: only writers can change code
    db_user_id = session.get('user_id')
    if db_user_id:
        role = get_user_role(db_user_id, room_id)
        if role and not can_write(role):
            return  # silently reject

    if room_id in rooms:
        rooms[room_id]["files"][filename] = code
    emit("code_update", {
        "code": code,
        "filename": filename,
        "userId": data.get("userId", ""),
    }, to=room_id, include_self=False)


@socketio.on("cursor_move")
def handle_cursor_move(data):
    emit("cursor_update", data, to=data.get("room", ""), include_self=False)


@socketio.on("chat_message")
def handle_chat_message(data):
    room_id = data.get("room", "")
    msg = {
        "userId": data.get("userId", ""),
        "nickname": data.get("nickname", "Anonymous"),
        "text": data.get("text", ""),
        "timestamp": int(time.time() * 1000),
    }
    if room_id in rooms:
        rooms[room_id]["chat"].append(msg)
    emit("chat_message", msg, to=room_id)


@socketio.on("language_change")
def handle_language_change(data):
    room_id = data.get("room", "")
    language = data.get("language", "python")

    db_user_id = session.get('user_id')
    if db_user_id:
        role = get_user_role(db_user_id, room_id)
        if role and not can_write(role):
            return

    if room_id in rooms:
        rooms[room_id]["language"] = language
    emit("language_update", {"language": language}, to=room_id, include_self=False)


@socketio.on("file_change")
def handle_file_change(data):
    room_id = data.get("room", "")
    filename = data.get("filename", "")
    content = data.get("content", "")
    action = data.get("action", "switch")

    if action == "create":
        db_user_id = session.get('user_id')
        if db_user_id:
            role = get_user_role(db_user_id, room_id)
            if role and not can_write(role):
                return

    if room_id not in rooms:
        return
    room_data = rooms[room_id]
    if action == "create":
        if filename not in room_data["files"]:
            room_data["files"][filename] = content
    room_data["activeFile"] = filename
    emit("file_update", {
        "filename": filename,
        "content": room_data["files"].get(filename, ""),
        "files": list(room_data["files"].keys()),
        "action": action,
    }, to=room_id)


@socketio.on("delete_file")
def handle_delete_file(data):
    room_id = data.get("room", "")
    filename = data.get("filename", "")

    db_user_id = session.get('user_id')
    if db_user_id:
        role = get_user_role(db_user_id, room_id)
        if role and not can_write(role):
            return

    if room_id not in rooms:
        return
    room_data = rooms[room_id]
    if filename not in room_data["files"]:
        return
    if len(room_data["files"]) <= 1:
        emit("join_error", {"message": "Cannot delete the last file."})
        return
    del room_data["files"][filename]
    if room_data["activeFile"] == filename:
        room_data["activeFile"] = list(room_data["files"].keys())[0]
    emit("file_deleted", {
        "filename": filename,
        "files": list(room_data["files"].keys()),
        "activeFile": room_data["activeFile"],
    }, to=room_id)


@socketio.on("camera_toggle")
def handle_camera_toggle(data):
    room_id = data.get("room", "")
    user_id = data.get("userId", "")
    enabled = data.get("enabled", False)
    if room_id in rooms:
        for sid, u in rooms[room_id]["users"].items():
            if u["userId"] == user_id:
                u["cameraEnabled"] = enabled
                break
    emit("camera_toggle", {
        "userId": user_id,
        "enabled": enabled,
        "users": user_list(rooms[room_id]) if room_id in rooms else [],
    }, to=room_id, include_self=False)


@socketio.on("mic_toggle")
def handle_mic_toggle(data):
    room_id = data.get("room", "")
    user_id = data.get("userId", "")
    enabled = data.get("enabled", False)
    if room_id in rooms:
        for sid, u in rooms[room_id]["users"].items():
            if u["userId"] == user_id:
                u["micEnabled"] = enabled
                break
    emit("mic_toggle", {
        "userId": user_id,
        "enabled": enabled,
        "users": user_list(rooms[room_id]) if room_id in rooms else [],
    }, to=room_id, include_self=False)


@socketio.on("media_state")
def handle_media_state(data):
    room_id = data.get("room", "")
    emit("media_state_update", data, to=room_id, include_self=False)


@socketio.on("run_code")
def handle_run_code(data):
    code = data.get("code", "")
    language = data.get("language", "python")
    sid = request.sid

    socketio.emit("terminal_output", {"output": "$ Running...\n", "done": False}, to=sid)
    threading.Thread(
        target=_run_code_subprocess,
        args=(code, language, sid),
        daemon=True,
    ).start()


@socketio.on("terminal_input")
def handle_terminal_input(data):
    sid = request.sid
    text = data.get("text", "")
    if not text:
        return
    proc_info = active_processes.get(sid)
    if proc_info and proc_info.get("proc"):
        proc = proc_info["proc"]
        if proc.stdin and proc.poll() is None:
            try:
                proc.stdin.write(text.encode("utf-8"))
                proc.stdin.flush()
            except (BrokenPipeError, OSError):
                pass


# ---------------------------------------------------------------------------
# WebRTC signaling relay
# ---------------------------------------------------------------------------
@socketio.on("webrtc_offer")
def handle_webrtc_offer(data):
    target_sid = data.get("targetSid", "")
    if target_sid:
        emit("webrtc_offer", {
            "offer": data.get("offer"),
            "fromSid": request.sid,
            "fromUserId": data.get("fromUserId", ""),
            "fromNickname": data.get("fromNickname", ""),
        }, to=target_sid)


@socketio.on("webrtc_answer")
def handle_webrtc_answer(data):
    target_sid = data.get("targetSid", "")
    if target_sid:
        emit("webrtc_answer", {
            "answer": data.get("answer"),
            "fromSid": request.sid,
        }, to=target_sid)


@socketio.on("webrtc_ice")
def handle_webrtc_ice(data):
    target_sid = data.get("targetSid", "")
    if target_sid:
        emit("webrtc_ice", {
            "candidate": data.get("candidate"),
            "fromSid": request.sid,
        }, to=target_sid)


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    socketio.run(app, host="0.0.0.0", port=5000, debug=True, use_reloader=False)