"""
CodeSync — Collaborative Code Editor Backend (Flask + Socket.IO)

=== Socket.IO Events ===
CLIENT → SERVER:
  join_room        — Join/create a room (with session_id for dedup)
  code_change      — Code edited in a file
  cursor_move      — User cursor position changed
  chat_message     — Chat text sent
  language_change  — Programming language changed
  file_change      — Create or switch file
  delete_file      — Delete a file from the room
  camera_toggle    — Toggle own camera status
  mic_toggle       — Toggle own mic status
  run_code         — Execute code in terminal
  terminal_input   — Send stdin to running process
  webrtc_offer     — WebRTC SDP offer  (signaling)
  webrtc_answer    — WebRTC SDP answer (signaling)
  webrtc_ice       — WebRTC ICE candidate (signaling)

SERVER → CLIENT:
  room_joined      — Full room state on join
  join_error       — Error joining room
  user_joined      — A new user joined
  user_left        — A user left
  code_update      — Code changed by another user
  cursor_update    — Remote cursor moved
  chat_message     — Chat message broadcast
  language_update  — Language changed
  file_update      — File created/switched
  file_deleted     — File deleted
  camera_toggle    — Camera status changed
  mic_toggle       — Mic status changed
  terminal_output  — PTY/process output stream
  run_output       — Code execution result
  webrtc_offer     — Forwarded WebRTC offer
  webrtc_answer    — Forwarded WebRTC answer
  webrtc_ice       — Forwarded ICE candidate
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
import threading
import uuid
from typing import Any

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------
CURSOR_COLORS = [
    "#89b4fa", "#a6e3a1", "#f9e2af", "#f38ba8",
    "#cba6f7", "#94e2d5", "#fab387", "#74c7ec",
]

rooms: dict[str, dict[str, Any]] = {}
# Map sid → active process info for terminal input
active_processes: dict[str, dict] = {}

DEFAULT_FILES = {"main.py": "# Start coding here\n"}


def create_room(room_id: str, password: str = "") -> dict[str, Any]:
    rooms[room_id] = {
        "files": dict(DEFAULT_FILES),
        "activeFile": "main.py",
        "users": {},            # keyed by socket sid
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
        }
        for u in room_data["users"].values()
    ]


# ---------------------------------------------------------------------------
# Code execution helper (with subprocess + threading for streaming)
# ---------------------------------------------------------------------------
EXEC_TIMEOUT = 30  # seconds

def _run_code_subprocess(code: str, language: str, sid: str):
    """Run code in a subprocess, stream output back via socket, accept stdin."""
    ext_map = {"python": ".py", "javascript": ".js", "cpp": ".cpp", "java": ".java"}
    ext = ext_map.get(language, ".py")

    run_id = uuid.uuid4().hex[:8]
    # Use cross-platform temp files
    temp_dir = tempfile.gettempdir()
    code_path = os.path.join(temp_dir, f"cs_{run_id}_code{ext}")
    out_path = None

    with open(code_path, "w", encoding="utf-8") as f:
        f.write(code)

    try:
        # --- Compilation step for C++ ---
        if language == "cpp":
            out_path = os.path.join(temp_dir, f"cs_{run_id}_out" + (".exe" if os.name == "nt" else ""))
            # NOTE: g++ must be installed and on PATH.
            # On Windows install MinGW-w64; on Linux: sudo apt install g++
            comp = subprocess.run(
                ["g++", code_path, "-o", out_path],
                capture_output=True, text=True, timeout=15, check=False,
            )
            if comp.returncode != 0:
                socketio.emit("terminal_output", {
                    "output": f"Compilation Error:\n{comp.stderr}",
                    "done": True, "returncode": comp.returncode,
                }, to=sid)
                return
            cmd = [out_path]
        elif language == "python":
            cmd = [sys.executable, "-u", code_path]
        elif language == "javascript":
            cmd = ["node", code_path]
        elif language == "java":
            cmd = ["java", code_path]
        else:
            cmd = [sys.executable, "-u", code_path]

        # Spawn process with pipes for stdin/stdout/stderr
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        # Store process so terminal_input can write to it
        active_processes[sid] = {"proc": proc, "code_path": code_path, "out_path": out_path}

        # Reader threads to stream output
        def read_stream(stream, label=""):
            try:
                for line in iter(stream.readline, ""):
                    if line:
                        socketio.emit("terminal_output", {
                            "output": (f"[{label}] " if label == "stderr" else "") + line,
                            "done": False,
                        }, to=sid)
                stream.close()
            except Exception:
                pass

        t_out = threading.Thread(target=read_stream, args=(proc.stdout,), daemon=True)
        t_err = threading.Thread(target=read_stream, args=(proc.stderr, "stderr"), daemon=True)
        t_out.start()
        t_err.start()

        try:
            proc.wait(timeout=EXEC_TIMEOUT)
        except subprocess.TimeoutExpired:
            proc.kill()
            socketio.emit("terminal_output", {
                "output": f"\nExecution timed out ({EXEC_TIMEOUT}s limit).\n",
                "done": True, "returncode": 124,
            }, to=sid)
            return

        t_out.join(timeout=2)
        t_err.join(timeout=2)

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
# HTTP routes
# ---------------------------------------------------------------------------
@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/rooms")
def create_room_endpoint():
    """Create a new room. Returns 409 if room ID is already taken."""
    payload = request.get_json(silent=True) or {}
    room_id = payload.get("roomId", "").strip()
    password = payload.get("password", "").strip()

    if not room_id:
        import random, string
        room_id = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))

    if room_id in rooms:
        return jsonify({"error": "Room ID already taken"}), 409

    create_room(room_id, password)
    return jsonify({"roomId": room_id, "hasPassword": bool(password)}), 201


@app.get("/rooms/<room_id>/exists")
def room_exists(room_id: str):
    if room_id in rooms:
        return jsonify({"exists": True, "hasPassword": bool(rooms[room_id].get("password", ""))}), 200
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
    # Kill any running process
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

    # --- Room existence ---
    if not create and room_id not in rooms:
        emit("join_error", {"message": "Room does not exist. Please check the ID or create a new room."})
        return

    if create and room_id not in rooms:
        room_password = data.get("roomPassword", "")
        create_room(room_id, room_password)

    room_data = rooms[room_id]

    # --- Password check ---
    expected_password = room_data.get("password", "")
    if expected_password and password != expected_password:
        emit("join_error", {"message": "Incorrect room password."})
        return

    # --- Duplicate user detection by (nickname, session_id) ---
    # If same session_id already exists (reconnect), update existing entry
    existing_sid = None
    display_nickname = nickname
    for s, u in list(room_data["users"].items()):
        if u.get("sessionId") == session_id and session_id:
            # Same tab reconnecting — update sid mapping
            existing_sid = s
            break
        elif u["nickname"] == nickname and u.get("sessionId") != session_id:
            # Same username, different tab — disambiguate
            count = sum(1 for uu in room_data["users"].values()
                        if uu["nickname"].startswith(nickname))
            display_nickname = f"{nickname} #{count + 1}"

    # --- Leave any previous room this sid was in ---
    for rid, rd in list(rooms.items()):
        if request.sid in rd["users"]:
            old_user = rd["users"].pop(request.sid)
            leave_room(rid)
            # Only emit user_left if we're actually leaving a DIFFERENT room
            if rid != room_id:
                emit("user_left", {
                    "userId": old_user["userId"],
                    "nickname": old_user["nickname"],
                    "sessionId": old_user.get("sessionId", ""),
                    "users": user_list(rd),
                }, to=rid)

    # If reconnecting same session, remove old sid entry
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
    }
    join_room(room_id)

    # Send full state to new user (only to this sid)
    emit("room_joined", {
        "roomId": room_id,
        "files": room_data["files"],
        "activeFile": room_data["activeFile"],
        "language": room_data["language"],
        "users": user_list(room_data),
        "chat": room_data["chat"][-50:],
        "cursorColor": color,
        "nickname": display_nickname,
    })

    # Notify everyone else ONCE
    emit("user_joined", {
        "userId": user_id,
        "nickname": display_nickname,
        "cursorColor": color,
        "sessionId": session_id,
        "users": user_list(room_data),
    }, to=room_id, include_self=False)


@socketio.on("code_change")
def handle_code_change(data):
    room_id = data.get("room", "")
    code = data.get("code", "")
    filename = data.get("filename", "main.py")
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
    if room_id in rooms:
        rooms[room_id]["language"] = language
    emit("language_update", {"language": language}, to=room_id, include_self=False)


@socketio.on("file_change")
def handle_file_change(data):
    room_id = data.get("room", "")
    filename = data.get("filename", "")
    content = data.get("content", "")
    action = data.get("action", "switch")
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
    """Delete a file from the room's in-memory file store."""
    room_id = data.get("room", "")
    filename = data.get("filename", "")
    if room_id not in rooms:
        return
    room_data = rooms[room_id]
    if filename not in room_data["files"]:
        return
    # Prevent deleting the last file
    if len(room_data["files"]) <= 1:
        emit("join_error", {"message": "Cannot delete the last file."})
        return
    del room_data["files"][filename]
    # If active file was deleted, switch to first remaining file
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


@socketio.on("run_code")
def handle_run_code(data):
    """Execute code via socket in a background thread with stdin support."""
    code = data.get("code", "")
    language = data.get("language", "python")
    sid = request.sid

    socketio.emit("terminal_output", {"output": "$ Running...\n", "done": False}, to=sid)
    # Run in background thread so we don't block the event loop
    threading.Thread(
        target=_run_code_subprocess,
        args=(code, language, sid),
        daemon=True,
    ).start()


@socketio.on("terminal_input")
def handle_terminal_input(data):
    """Write stdin to the active process for this session."""
    sid = request.sid
    text = data.get("text", "")
    proc_info = active_processes.get(sid)
    if proc_info and proc_info.get("proc") and proc_info["proc"].stdin:
        try:
            proc_info["proc"].stdin.write(text)
            proc_info["proc"].stdin.flush()
        except (BrokenPipeError, OSError):
            pass


# ---------------------------------------------------------------------------
# WebRTC signaling relay
# ---------------------------------------------------------------------------
@socketio.on("webrtc_offer")
def handle_webrtc_offer(data):
    """Forward SDP offer to the target user."""
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
    """Forward SDP answer to the target user."""
    target_sid = data.get("targetSid", "")
    if target_sid:
        emit("webrtc_answer", {
            "answer": data.get("answer"),
            "fromSid": request.sid,
        }, to=target_sid)


@socketio.on("webrtc_ice")
def handle_webrtc_ice(data):
    """Forward ICE candidate to the target user."""
    target_sid = data.get("targetSid", "")
    if target_sid:
        emit("webrtc_ice", {
            "candidate": data.get("candidate"),
            "fromSid": request.sid,
        }, to=target_sid)


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True, use_reloader=False)