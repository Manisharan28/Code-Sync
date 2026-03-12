# Collaborative Editor

Minimal hackathon-ready collaborative editor built with React, Monaco, Flask, and Flask-SocketIO.

## Structure

```
collab-editor/
├── backend/
│   ├── app.py
│   └── requirements.txt
└── frontend/
```

## Backend

From `backend/`:

```powershell
C:/Users/pende/AppData/Local/Programs/Python/Python312/python.exe -m pip install -r requirements.txt
C:/Users/pende/AppData/Local/Programs/Python/Python312/python.exe app.py
```

Server URL: `http://localhost:5000`

Quick start from the workspace root:

```powershell
npm install
npm run dev
```

This uses the root `package.json` to launch both backend and frontend together.

HTTP routes:

- `GET /health`
- `POST /run`

Socket events:

- `join_room`
- `load_code`
- `code_change`
- `code_update`
- `cursor_move`
- `cursor_update`

## Frontend

From `frontend/`:

```powershell
npm install
npm start
```

Optional environment variable:

```powershell
$env:REACT_APP_BACKEND_URL="http://localhost:5000"
```

## Demo Flow

1. Start the backend.
2. Start the frontend.
3. Open multiple browser tabs.
4. Join the same room ID in each tab.
5. Type in one tab and verify code and cursor updates appear in the others.
6. Click `Run Code` to execute the shared Python buffer and show output.