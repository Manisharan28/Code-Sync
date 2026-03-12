from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from typing import Any

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------
CURSOR_COLORS = [
    "#89b4fa", "#a6e3a1", "#f9e2af", "#f38ba8",
    "#cba6f7", "#94e2d5", "#fab387", "#74c7ec",
]

rooms: dict[str, dict[str, Any]] = {}


def get_or_create_room(room_id: str) -> dict[str, Any]:
    if room_id not in rooms:
        rooms[room_id] = {
            "code": "# Start coding here\n",
            "users": {},
            "chat": [],
            "language": "python",
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
        {"userId": u["userId"], "nickname": u["nickname"], "cursorColor": u["cursorColor"]}
        for u in room_data["users"].values()
    ]


# ---------------------------------------------------------------------------
# HTTP routes
# ---------------------------------------------------------------------------
@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/run")
def run_code():
    payload = request.get_json(silent=True) or {}
    code = payload.get("code", "")
    language = payload.get("language", "python")

    ext_map = {"python": ".py", "javascript": ".js", "cpp": ".cpp", "java": ".java"}
    ext = ext_map.get(language, ".py")

    with tempfile.NamedTemporaryFile("w", suffix=ext, delete=False, encoding="utf-8") as f:
        f.write(code)
        temp_path = f.name

    out_path = None
    try:
        if language == "python":
            cmd = [sys.executable, temp_path]
        elif language == "javascript":
            cmd = ["node", temp_path]
        elif language == "cpp":
            out_path = temp_path.replace(".cpp", ".exe" if os.name == "nt" else ".out")
            comp = subprocess.run(
                ["g++", temp_path, "-o", out_path],
                capture_output=True, text=True, timeout=10, check=False,
            )
            if comp.returncode != 0:
                return jsonify({"stdout": "", "stderr": comp.stderr, "returncode": comp.returncode})
            cmd = [out_path]
        elif language == "java":
            cmd = ["java", temp_path]
        else:
            cmd = [sys.executable, temp_path]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=5, check=False)
        return jsonify({
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode,
        })
    except subprocess.TimeoutExpired:
        return jsonify({"stdout": "", "stderr": "Execution timed out (5 s limit).", "returncode": 124}), 408
    except FileNotFoundError as e:
        return jsonify({"stdout": "", "stderr": f"Runtime not found: {e}", "returncode": 1})
    finally:
        for p in (temp_path, out_path):
            if p and os.path.exists(p):
                os.remove(p)


# ---------------------------------------------------------------------------
# WebSocket events
# ---------------------------------------------------------------------------
@socketio.on("connect")
def handle_connect():
    print(f"[+] Connected: {request.sid}")


@socketio.on("disconnect")
def handle_disconnect():
    sid = request.sid
    for room_id, room_data in rooms.items():
        if sid in room_data["users"]:
            user = room_data["users"].pop(sid)
            leave_room(room_id)
            emit("user_left", {
                "userId": user["userId"],
                "nickname": user["nickname"],
                "users": user_list(room_data),
            }, to=room_id)
            break
    print(f"[-] Disconnected: {sid}")


@socketio.on("join_room")
def handle_join_room(data):
    room_id = data["room"]
    nickname = data.get("nickname", "Anonymous")
    user_id = data.get("userId", request.sid)

    # Leave any previous room
    for rid, rd in list(rooms.items()):
        if request.sid in rd["users"]:
            old_user = rd["users"].pop(request.sid)
            leave_room(rid)
            emit("user_left", {
                "userId": old_user["userId"],
                "nickname": old_user["nickname"],
                "users": user_list(rd),
            }, to=rid)

    room_data = get_or_create_room(room_id)
    color = assign_color(room_data)
    room_data["users"][request.sid] = {
        "userId": user_id,
        "nickname": nickname,
        "cursorColor": color,
    }
    join_room(room_id)

    # Send full state to the new user
    emit("room_joined", {
        "roomId": room_id,
        "code": room_data["code"],
        "language": room_data["language"],
        "users": user_list(room_data),
        "chat": room_data["chat"][-50:],
        "cursorColor": color,
    })

    # Notify everyone else
    emit("user_joined", {
        "userId": user_id,
        "nickname": nickname,
        "cursorColor": color,
        "users": user_list(room_data),
    }, to=room_id, include_self=False)


@socketio.on("code_change")
def handle_code_change(data):
    room_id = data["room"]
    code = data.get("code", "")
    if room_id in rooms:
        rooms[room_id]["code"] = code
    emit("code_update", {"code": code, "userId": data.get("userId", "")},
         to=room_id, include_self=False)


@socketio.on("cursor_move")
def handle_cursor_move(data):
    emit("cursor_update", data, to=data["room"], include_self=False)


@socketio.on("chat_message")
def handle_chat_message(data):
    room_id = data["room"]
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
    room_id = data["room"]
    language = data.get("language", "python")
    if room_id in rooms:
        rooms[room_id]["language"] = language
    emit("language_update", {"language": language}, to=room_id, include_self=False)


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000)