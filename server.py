"""
EMRS Quiz Competition - Main Application Server
Built with Python Tornado and SQLite.
Fully self-contained, offline-first, LAN-capable.
"""

import os
import sys
import json
import time
import socket
import csv
import io
import asyncio
from datetime import datetime

import tornado.ioloop
import tornado.web
import tornado.websocket

from database import init_db, get_db
from sample_questions import load_sample_data
from quiz_engine import QuizEngine

# Directory paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")

# Connected WebSocket clients
ws_clients = set()

def get_local_ip():
    """Detects primary LAN IP for display on admin dashboard."""
    import subprocess, re
    try:
        out = subprocess.check_output(["ifconfig"], timeout=2).decode()
        ips = re.findall(r'inet\s+(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)', out)
        if ips:
            return ips[0]
    except Exception:
        pass

    for iface in ["en0", "en1", "eth0", "wlan0"]:
        try:
            out = subprocess.check_output(["ipconfig", "getifaddr", iface], timeout=1).decode().strip()
            if out and out != "127.0.0.1":
                return out
        except Exception:
            pass

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and ip != "127.0.0.1":
            return ip
    except Exception:
        pass

    try:
        return socket.gethostbyname(socket.gethostname())
    except Exception:
        return "127.0.0.1"

async def broadcast_ws(message: dict):
    """Broadcasts a JSON message to all connected WebSocket clients."""
    msg_str = json.dumps(message)
    dead_clients = set()
    for client in ws_clients:
        try:
            client.write_message(msg_str)
        except Exception:
            dead_clients.add(client)
    for dc in dead_clients:
        ws_clients.discard(dc)

# Timer background worker for final round authoritative timing
async def final_timer_loop():
    """Runs every 500ms to handle server-side countdown for final round."""
    while True:
        try:
            state = QuizEngine.get_final_round_state()
            if state.get("timer_is_running") and state.get("question_status") == "in_progress":
                comp = state["competition"]
                total_duration = comp["final_main_timer_seconds"] if state["turn_type"] == "main" else comp["final_pass_timer_seconds"]
                
                # Check if timer expired -> Pause timer at 0s and alert stage/host to click pass
                if state["time_remaining_seconds"] <= 0:
                    conn = get_db()
                    conn.execute("UPDATE final_round_state SET timer_is_running = 0, time_remaining_seconds = 0 WHERE id = 1;")
                    conn.commit()
                    conn.close()
                    updated_state = QuizEngine.get_final_round_state()
                    await broadcast_ws({
                        "type": "FINAL_STATE_UPDATE",
                        "event": "TIME_OVER",
                        "sound": "BUZZER",
                        "data": updated_state
                    })
                else:
                    await broadcast_ws({
                        "type": "TIMER_TICK",
                        "time_remaining": state["time_remaining_seconds"],
                        "turn_type": state["turn_type"],
                        "active_slot": state["active_team_slot"]
                    })
        except Exception as e:
            print("Timer loop error:", e)
        await asyncio.sleep(0.5)

# =============================================================================
# WEB SOCKET HANDLER
# =============================================================================
class QuizWebSocketHandler(tornado.websocket.WebSocketHandler):
    def check_origin(self, origin):
        return True # Allow all LAN clients

    def open(self):
        ws_clients.add(self)
        final_state = QuizEngine.get_final_round_state()
        self.write_message(json.dumps({
            "type": "INIT_STATE",
            "final_state": final_state
        }))

    def on_close(self):
        ws_clients.discard(self)

    def on_message(self, message):
        try:
            data = json.loads(message)
            msg_type = data.get("type")
            if msg_type == "PING":
                self.write_message(json.dumps({"type": "PONG"}))
        except Exception:
            pass

# =============================================================================
# PAGE HANDLERS
# =============================================================================
class BaseHandler(tornado.web.RequestHandler):
    def get_current_user_team(self):
        team_id = self.get_secure_cookie("team_id")
        return int(team_id.decode()) if team_id else None

class QuizPageHandler(BaseHandler):
    def get(self):
        self.render("quiz.html")

class AdminPageHandler(BaseHandler):
    def get(self):
        lan_ip = get_local_ip()
        self.render("admin.html", lan_ip=lan_ip, port=8888)

class ProjectorPageHandler(BaseHandler):
    def get(self):
        self.render("projector.html")

# =============================================================================
# REST API: AUTH
# =============================================================================
class LoginApiHandler(BaseHandler):
    def post(self):
        data = tornado.escape.json_decode(self.request.body)
        code = data.get("code", "").strip().upper()
        pin = data.get("pin", "").strip()

        conn = get_db()
        team = conn.execute("SELECT * FROM teams WHERE code = ? AND is_active = 1;", (code,)).fetchone()
        conn.close()

        if not team:
            self.set_status(401)
            self.write({"success": False, "error": "Invalid team code."})
            return

        if team["pin"] and team["pin"] != pin:
            self.set_status(401)
            self.write({"success": False, "error": "Incorrect PIN for this team."})
            return

        self.set_secure_cookie("team_id", str(team["id"]), expires_days=1)
        self.write({
            "success": True,
            "team": {
                "id": team["id"],
                "code": team["code"],
                "name": team["name"],
                "station": team["assigned_station"]
            }
        })

class LogoutApiHandler(BaseHandler):
    def post(self):
        self.clear_cookie("team_id")
        self.write({"success": True})

class CheckSessionApiHandler(BaseHandler):
    def get(self):
        team_id = self.get_current_user_team()
        if not team_id:
            self.write({"authenticated": False})
            return
        conn = get_db()
        team = conn.execute("SELECT id, code, name, assigned_station FROM teams WHERE id = ?;", (team_id,)).fetchone()
        conn.close()
        if not team:
            self.clear_cookie("team_id")
            self.write({"authenticated": False})
            return
        self.write({"authenticated": True, "team": dict(team)})

# =============================================================================
# REST API: QUALIFIER
# =============================================================================
class QualifierAttemptApiHandler(BaseHandler):
    def get(self):
        team_id = self.get_current_user_team()
        if not team_id:
            self.set_status(401)
            self.write({"error": "Unauthorized. Please log in."})
            return

        attempt_data, err = QuizEngine.start_or_resume_qualifier_attempt(team_id)
        if err:
            self.set_status(400)
            self.write({"error": err})
            return

        self.write({"success": True, "attempt": attempt_data})

class QualifierAnswerApiHandler(BaseHandler):
    def post(self):
        team_id = self.get_current_user_team()
        if not team_id:
            self.set_status(401)
            self.write({"error": "Unauthorized."})
            return

        data = tornado.escape.json_decode(self.request.body)
        q_id = int(data.get("question_id"))
        orig_idx = data.get("selected_orig_idx")
        if orig_idx is not None:
            orig_idx = int(orig_idx)
        marked_rev = bool(data.get("is_marked_review", False))

        ok, err = QuizEngine.record_qualifier_answer(team_id, q_id, orig_idx, marked_rev)
        if not ok:
            self.set_status(400)
            self.write({"error": err})
            return

        leaderboard = QuizEngine.get_qualifier_leaderboard()
        tornado.ioloop.IOLoop.current().add_callback(
            broadcast_ws, {"type": "QUALIFIER_PROGRESS", "leaderboard": leaderboard}
        )
        self.write({"success": True})

class QualifierViolationApiHandler(BaseHandler):
    async def post(self):
        team_id = self.get_current_user_team()
        if not team_id:
            self.set_status(401)
            self.write({"error": "Unauthorized."})
            return

        data = tornado.escape.json_decode(self.request.body)
        reason = data.get("reason", "Window/Tab Switch")

        count, terminated = QuizEngine.record_tab_switch_violation(team_id, reason)

        lb = QuizEngine.get_qualifier_leaderboard()
        await broadcast_ws({
            "type": "QUALIFIER_VIOLATION",
            "team_id": team_id,
            "count": count,
            "terminated": terminated,
            "reason": reason,
            "leaderboard": lb
        })
        self.write({"success": True, "count": count, "terminated": terminated})

class QualifierSubmitApiHandler(BaseHandler):
    def post(self):
        team_id = self.get_current_user_team()
        if not team_id:
            self.set_status(401)
            self.write({"error": "Unauthorized."})
            return

        ok, err = QuizEngine.submit_qualifier_attempt(team_id)
        if not ok:
            self.set_status(400)
            self.write({"error": err})
            return

        leaderboard = QuizEngine.get_qualifier_leaderboard()
        tornado.ioloop.IOLoop.current().add_callback(
            broadcast_ws, {"type": "QUALIFIER_SUBMITTED", "team_id": team_id, "leaderboard": leaderboard}
        )
        self.write({"success": True})

# =============================================================================
# REST API: ADMIN & FINAL ROUND CONTROLS
# =============================================================================
class AdminQualifierLeaderboardHandler(BaseHandler):
    def get(self):
        lb = QuizEngine.get_qualifier_leaderboard()
        self.write({"leaderboard": lb})

class AdminPromoteFinalistsHandler(BaseHandler):
    async def post(self):
        ok, names = QuizEngine.promote_top_finalists(6)
        final_state = QuizEngine.get_final_round_state()
        await broadcast_ws({
            "type": "FINALISTS_PROMOTED",
            "names": names,
            "final_state": final_state
        })
        self.write({"success": ok, "promoted": names})

class AdminResetAttemptHandler(BaseHandler):
    async def post(self):
        data = tornado.escape.json_decode(self.request.body)
        team_id = int(data.get("team_id"))
        conn = get_db()
        conn.execute("DELETE FROM qualifier_responses WHERE team_id = ?;", (team_id,))
        conn.execute("DELETE FROM qualifier_attempts WHERE team_id = ?;", (team_id,))
        conn.execute("""
            UPDATE teams SET
                qualifier_score = 0,
                qualifier_time_ms = 0,
                qualifier_submitted = 0,
                qualifier_submitted_at = NULL
            WHERE id = ?;
        """, (team_id,))
        conn.commit()
        conn.close()

        lb = QuizEngine.get_qualifier_leaderboard()
        await broadcast_ws({"type": "QUALIFIER_PROGRESS", "leaderboard": lb})
        self.write({"success": True})

class AdminFinalStateHandler(BaseHandler):
    def get(self):
        state = QuizEngine.get_final_round_state()
        self.write({"state": state})

class AdminFinalLoadQuestionHandler(BaseHandler):
    async def post(self):
        data = tornado.escape.json_decode(self.request.body)
        q_idx = int(data.get("question_index", 0))
        ok, err = QuizEngine.load_final_question(q_idx)
        if not ok:
            self.set_status(400)
            self.write({"error": err})
            return
        state = QuizEngine.get_final_round_state()
        await broadcast_ws({
            "type": "FINAL_STATE_UPDATE",
            "event": "LOAD_QUESTION",
            "data": state
        })
        self.write({"success": True, "state": state})

class AdminFinalLoadRoundHandler(BaseHandler):
    async def post(self):
        data = tornado.escape.json_decode(self.request.body)
        r_num = int(data.get("round_number", 1))
        ok, err = QuizEngine.load_final_round(r_num)
        if not ok:
            self.set_status(400)
            self.write({"error": err})
            return
        state = QuizEngine.get_final_round_state()
        await broadcast_ws({
            "type": "FINAL_STATE_UPDATE",
            "event": "LOAD_ROUND",
            "data": state
        })
        self.write({"success": True, "state": state})

class AdminFinalTimerControlHandler(BaseHandler):
    async def post(self):
        data = tornado.escape.json_decode(self.request.body)
        action = data.get("action")

        if action == "start":
            QuizEngine.start_final_timer()
        elif action == "pause":
            QuizEngine.pause_final_timer()
        elif action == "reset":
            state = QuizEngine.get_final_round_state()
            QuizEngine.load_final_question(state["question_index"])

        state = QuizEngine.get_final_round_state()
        await broadcast_ws({
            "type": "FINAL_STATE_UPDATE",
            "event": f"TIMER_{action.upper()}",
            "data": state
        })
        self.write({"success": True, "state": state})

class AdminFinalRevealQuestionHandler(BaseHandler):
    async def post(self):
        data = tornado.escape.json_decode(self.request.body)
        action = data.get("action", "reveal") # 'reveal', 'reveal_options', or 'hide'

        sound = None
        if action == "reveal":
            QuizEngine.reveal_final_question(auto_start_timer=True)
            sound = "CHIME"
        elif action == "reveal_options":
            QuizEngine.reveal_final_options(auto_start_timer=True)
            sound = "CHIME"
        else:
            QuizEngine.hide_final_question()

        state = QuizEngine.get_final_round_state()
        await broadcast_ws({
            "type": "FINAL_STATE_UPDATE",
            "event": f"QUESTION_{action.upper()}",
            "sound": sound,
            "data": state
        })
        self.write({"success": True, "state": state})

class AdminFinalAdjudicateHandler(BaseHandler):
    async def post(self):
        data = tornado.escape.json_decode(self.request.body)
        decision = data.get("decision")
        selected_option = data.get("selected_option", None)

        sound = None
        if decision == "correct":
            ok, err = QuizEngine.mark_final_correct(selected_option=selected_option)
            sound = "CORRECT"
        elif decision == "incorrect":
            ok, err = QuizEngine.mark_final_incorrect(selected_option=selected_option)
            sound = "WRONG"
        elif decision == "timeout_or_pass":
            ok, err = QuizEngine.handle_final_timeout_or_pass()
            sound = "PASS"
        else:
            self.set_status(400)
            self.write({"error": "Unknown decision type."})
            return

        if not ok:
            self.set_status(400)
            self.write({"error": err})
            return

        state = QuizEngine.get_final_round_state()
        await broadcast_ws({
            "type": "FINAL_STATE_UPDATE",
            "event": f"ADJUDICATE_{decision.upper()}",
            "sound": sound,
            "data": state
        })
        self.write({"success": True, "state": state})

class AdminScoreAdjustHandler(BaseHandler):
    async def post(self):
        data = tornado.escape.json_decode(self.request.body)
        team_id = int(data.get("team_id"))
        delta = int(data.get("delta", 0))
        reason = data.get("reason", "Manual adjustment by quiz master")

        ok, err = QuizEngine.adjust_team_score(team_id, delta, reason)
        if not ok:
            self.set_status(400)
            self.write({"error": err})
            return

        state = QuizEngine.get_final_round_state()
        await broadcast_ws({
            "type": "FINAL_STATE_UPDATE",
            "event": "SCORE_ADJUSTED",
            "data": state
        })
        self.write({"success": True, "state": state})

class AdminFinalResetScoresHandler(BaseHandler):
    async def post(self):
        QuizEngine.reset_final_scores()
        state = QuizEngine.get_final_round_state()
        await broadcast_ws({
            "type": "FINAL_STATE_UPDATE",
            "event": "SCORES_RESET",
            "data": state
        })
        self.write({"success": True, "state": state})

class AdminFinalUnlockQuestionHandler(BaseHandler):
    async def post(self):
        data = tornado.escape.json_decode(self.request.body)
        q_idx = int(data.get("question_index", 0))
        ok, err = QuizEngine.unlock_final_question(q_idx)
        if not ok:
            self.set_status(400)
            self.write({"error": err})
            return
        state = QuizEngine.get_final_round_state()
        await broadcast_ws({
            "type": "FINAL_STATE_UPDATE",
            "event": "QUESTION_UNLOCKED",
            "data": state
        })
        self.write({"success": True, "state": state})

# =============================================================================
# REST API: QUESTIONS & TEAMS MANAGEMENT
# =============================================================================
class AdminMediaUploadHandler(BaseHandler):
    async def post(self):
        """Uploads question media (images or audio clips) to static/uploads/."""
        if 'file' not in self.request.files:
            self.set_status(400)
            self.write({"error": "No file uploaded."})
            return

        file_obj = self.request.files['file'][0]
        filename = file_obj['filename']
        ext = os.path.splitext(filename)[1].lower()
        allowed_exts = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp3', '.wav', '.ogg', '.m4a', '.aac'}
        if ext not in allowed_exts:
            self.set_status(400)
            self.write({"error": f"Unsupported media extension: {ext}"})
            return

        clean_base = "".join(c for c in os.path.splitext(filename)[0] if c.isalnum() or c in ("-", "_"))[:30]
        saved_name = f"{int(time.time())}_{clean_base}{ext}"
        upload_dir = os.path.join(STATIC_DIR, "uploads")
        os.makedirs(upload_dir, exist_ok=True)
        target_path = os.path.join(upload_dir, saved_name)

        with open(target_path, "wb") as f:
            f.write(file_obj['body'])

        media_url = f"/static/uploads/{saved_name}"
        self.write({
            "success": True,
            "url": media_url,
            "filename": saved_name,
            "media_type": "audio" if ext in {'.mp3', '.wav', '.ogg', '.m4a', '.aac'} else "image"
        })

class AdminProjectorMediaControlHandler(BaseHandler):
    async def post(self):
        """Controls audio playback on the Big-Screen Projector remotely."""
        data = tornado.escape.json_decode(self.request.body)
        action = data.get("action", "play") # 'play', 'pause', 'stop'
        await broadcast_ws({
            "type": "PROJECTOR_MEDIA_CONTROL",
            "action": action
        })
        self.write({"success": True, "action": action})

class AdminQuestionsHandler(BaseHandler):
    def get(self):
        round_type = self.get_argument("round_type", None) or self.get_argument("pool", None)
        conn = get_db()
        if round_type in ("screening", "qualifier"):
            rows = conn.execute("SELECT * FROM questions WHERE round_type IN ('screening', 'qualifier') ORDER BY question_number ASC;").fetchall()
        elif round_type in ("projector", "final"):
            rows = QuizEngine.get_final_questions(conn)
        elif round_type and round_type != "all":
            rows = conn.execute("SELECT * FROM questions WHERE round_type = ? ORDER BY question_number ASC;", (round_type,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM questions ORDER BY round_type, question_number ASC;").fetchall()
        conn.close()

        result = []
        for r in rows:
            # Normalize display round type
            r_type = "screening" if r["round_type"] in ("qualifier", "screening") else "projector"
            result.append({
                "id": r["id"],
                "round_type": r_type,
                "raw_round_type": r["round_type"],
                "question_number": r["question_number"],
                "text": r["text"],
                "options": json.loads(r["options_json"]),
                "correct_index": r["correct_index"],
                "category": r["category"],
                "explanation": r["explanation"],
                "marks": r["marks"],
                "media_type": r["media_type"] if "media_type" in r.keys() else "none",
                "media_url": r["media_url"] if "media_url" in r.keys() else ""
            })
        self.write({"questions": result})

    async def post(self):
        try:
            data = tornado.escape.json_decode(self.request.body)
            round_type = data.get("round_type", "screening").strip().lower()
            if round_type == "screening": round_type = "qualifier"
            if round_type == "projector": round_type = "final"

            text = data.get("text", "").strip()
            if not text:
                self.set_status(400)
                self.write({"success": False, "error": "Question statement cannot be empty."})
                return

            options = data.get("options", ["", "", "", ""])
            correct_index = int(data.get("correct_index", 0))
            category = data.get("category", "General").strip()
            explanation = data.get("explanation", "").strip()
            marks = int(data.get("marks", 1 if round_type in ("qualifier", "screening") else 10))
            media_type = data.get("media_type", "none").strip().lower() # 'none', 'image', 'audio'
            media_url = data.get("media_url", "").strip()

            conn = get_db()
            max_no = conn.execute("SELECT COALESCE(MAX(question_number), 0) FROM questions WHERE round_type IN (?, ?);", (round_type, 'screening' if round_type=='qualifier' else 'projector')).fetchone()[0]
            cur = conn.cursor()
            cur.execute("""
            INSERT INTO questions (round_type, question_number, text, options_json, correct_index, category, explanation, marks, media_type, media_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (round_type, max_no + 1, text, json.dumps(options), correct_index, category, explanation, marks, media_type, media_url))
            new_id = cur.lastrowid
            conn.commit()
            conn.close()

            if round_type == "final":
                state = QuizEngine.get_final_round_state()
                await broadcast_ws({
                    "type": "FINAL_STATE_UPDATE",
                    "event": "QUESTION_ADDED",
                    "data": state
                })

            self.write({"success": True, "question_id": new_id})
        except Exception as e:
            self.set_status(500)
            self.write({"success": False, "error": str(e)})

    async def put(self):
        """Allows editing any existing question, options, media, or category."""
        data = tornado.escape.json_decode(self.request.body)
        q_id = int(data.get("id"))
        round_type = data.get("round_type", "screening").strip().lower()
        if round_type == "screening": round_type = "qualifier"
        if round_type == "projector": round_type = "final"

        text = data.get("text", "").strip()
        options = data.get("options", ["", "", "", ""])
        correct_index = int(data.get("correct_index", 0))
        category = data.get("category", "General").strip()
        explanation = data.get("explanation", "").strip()
        marks = int(data.get("marks", 1 if round_type in ("qualifier", "screening") else 10))
        media_type = data.get("media_type", "none").strip().lower()
        media_url = data.get("media_url", "").strip()

        conn = get_db()
        conn.execute("""
        UPDATE questions SET
            round_type = ?,
            text = ?,
            options_json = ?,
            correct_index = ?,
            category = ?,
            explanation = ?,
            marks = ?,
            media_type = ?,
            media_url = ?
        WHERE id = ?;
        """, (round_type, text, json.dumps(options), correct_index, category, explanation, marks, media_type, media_url, q_id))
        conn.commit()
        conn.close()

        # If projector question was edited, refresh final state
        state = QuizEngine.get_final_round_state()
        await broadcast_ws({
            "type": "FINAL_STATE_UPDATE",
            "event": "QUESTION_EDITED",
            "data": state
        })

        self.write({"success": True})

    async def delete(self):
        delete_all = self.get_argument("all", "0").lower() in ("1", "true")
        pool = self.get_argument("pool", None) or self.get_argument("round_type", None)
        q_id = self.get_argument("id", None)
        if not q_id and not delete_all and not pool and self.request.body:
            try:
                data = tornado.escape.json_decode(self.request.body)
                q_id = data.get("id")
                delete_all = data.get("all", False)
                pool = data.get("pool") or data.get("round_type")
            except Exception:
                pass

        conn = get_db()
        if delete_all:
            conn.execute("DELETE FROM questions;")
        elif pool:
            if pool in ("screening", "qualifier"):
                conn.execute("DELETE FROM questions WHERE round_type IN ('screening', 'qualifier');")
            elif pool in ("projector", "final"):
                conn.execute("DELETE FROM questions WHERE round_type IN ('projector', 'final');")
            else:
                conn.execute("DELETE FROM questions WHERE round_type = ?;", (pool,))
        elif q_id:
            q_id = int(q_id)
            conn.execute("DELETE FROM questions WHERE id = ?;", (q_id,))
        else:
            conn.close()
            self.set_status(400)
            self.write({"error": "Missing question id, pool, or all parameter."})
            return

        conn.commit()
        conn.close()

        # Refresh projector if final round questions changed
        try:
            state = QuizEngine.get_final_round_state()
            await broadcast_ws({
                "type": "FINAL_STATE_UPDATE",
                "event": "QUESTION_DELETED",
                "data": state
            })
        except Exception:
            pass

        self.write({"success": True})

class AdminImportQuestionsHandler(BaseHandler):
    async def post(self):
        file_obj = None
        if 'file' in self.request.files:
            file_obj = self.request.files['file'][0]
        elif 'csv_file' in self.request.files:
            file_obj = self.request.files['csv_file'][0]

        if not file_obj:
            self.set_status(400)
            self.write({"error": "No file uploaded."})
            return
        content = file_obj['body'].decode('utf-8', errors='ignore')
        reader = csv.DictReader(io.StringIO(content))

        conn = get_db()
        imported = 0
        for row in reader:
            raw_round = row.get("round_type", "screening").strip().lower()
            if raw_round in ("screening", "qualifier", "online_screening"):
                round_type = "qualifier"
            else:
                round_type = "final"

            text = row.get("text", "").strip()
            if not text:
                continue
            opts = [
                row.get("option_a", "").strip(),
                row.get("option_b", "").strip(),
                row.get("option_c", "").strip(),
                row.get("option_d", "").strip(),
            ]
            correct_val = row.get("correct", "A").strip().upper()
            correct_map = {"A": 0, "B": 1, "C": 2, "D": 3, "0": 0, "1": 1, "2": 2, "3": 3}
            correct_idx = correct_map.get(correct_val, 0)
            category = row.get("category", "General").strip()
            explanation = row.get("explanation", "").strip()
            marks = int(row.get("marks", 1 if round_type == "qualifier" else 10))
            media_type = row.get("media_type", "none").strip().lower()
            if media_type not in ("none", "image", "audio"):
                media_type = "none"
            media_url = row.get("media_url", "").strip()

            max_no = conn.execute("SELECT COALESCE(MAX(question_number), 0) FROM questions WHERE round_type IN (?, ?);", (round_type, 'screening' if round_type=='qualifier' else 'projector')).fetchone()[0]
            conn.execute("""
            INSERT INTO questions (round_type, question_number, text, options_json, correct_index, category, explanation, marks, media_type, media_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (round_type, max_no + 1, text, json.dumps(opts), correct_idx, category, explanation, marks, media_type, media_url))
            imported += 1

        conn.commit()
        conn.close()

        state = QuizEngine.get_final_round_state()
        await broadcast_ws({
            "type": "FINAL_STATE_UPDATE",
            "event": "QUESTIONS_IMPORTED",
            "data": state
        })

        self.write({"success": True, "imported_count": imported})

class AdminTeamsHandler(BaseHandler):
    def get(self):
        conn = get_db()
        teams = conn.execute("SELECT * FROM teams WHERE is_active = 1 ORDER BY code ASC;").fetchall()
        conn.close()
        self.write({"teams": [dict(t) for t in teams]})

    async def post(self):
        data = tornado.escape.json_decode(self.request.body)
        code = data.get("code", "").strip().upper()
        name = data.get("name", "").strip()
        members = data.get("members", "").strip()
        pin = data.get("pin", "1234").strip()
        station = data.get("assigned_station", "").strip()

        conn = get_db()
        try:
            conn.execute("""
            INSERT INTO teams (code, name, members, pin, assigned_station)
            VALUES (?, ?, ?, ?, ?);
            """, (code, name, members, pin, station))
            conn.commit()
            conn.close()

            lb = QuizEngine.get_qualifier_leaderboard()
            await broadcast_ws({"type": "QUALIFIER_PROGRESS", "leaderboard": lb})
            self.write({"success": True})
        except Exception as e:
            conn.close()
            self.set_status(400)
            self.write({"error": f"Could not create team: {str(e)}"})

    async def put(self):
        data = tornado.escape.json_decode(self.request.body)
        team_id = int(data.get("id"))
        code = data.get("code", "").strip().upper()
        name = data.get("name", "").strip()
        members = data.get("members", "").strip()
        pin = data.get("pin", "1234").strip()
        station = data.get("assigned_station", "").strip()

        conn = get_db()
        try:
            conn.execute("""
            UPDATE teams SET
                code = ?,
                name = ?,
                members = ?,
                pin = ?,
                assigned_station = ?
            WHERE id = ?;
            """, (code, name, members, pin, station, team_id))
            conn.commit()
            conn.close()

            lb = QuizEngine.get_qualifier_leaderboard()
            final_state = QuizEngine.get_final_round_state()
            await broadcast_ws({
                "type": "QUALIFIER_PROGRESS",
                "leaderboard": lb,
                "final_state": final_state
            })
            self.write({"success": True})
        except Exception as e:
            conn.close()
            self.set_status(400)
            self.write({"error": f"Could not update team: {str(e)}"})

    async def delete(self):
        delete_all = self.get_argument("all", "0").lower() in ("1", "true")
        t_id = self.get_argument("id", None)
        conn = get_db()
        if delete_all:
            conn.execute("DELETE FROM qualifier_responses;")
            conn.execute("DELETE FROM qualifier_attempts;")
            conn.execute("DELETE FROM score_transactions;")
            conn.execute("DELETE FROM teams;")
        elif t_id:
            t_id = int(t_id)
            conn.execute("DELETE FROM qualifier_responses WHERE team_id = ?;", (t_id,))
            conn.execute("DELETE FROM qualifier_attempts WHERE team_id = ?;", (t_id,))
            conn.execute("DELETE FROM score_transactions WHERE team_id = ?;", (t_id,))
            conn.execute("DELETE FROM teams WHERE id = ?;", (t_id,))
        else:
            conn.close()
            self.set_status(400)
            self.write({"error": "Missing team id or all=1 parameter."})
            return
        conn.commit()
        conn.close()

        lb = QuizEngine.get_qualifier_leaderboard()
        final_state = QuizEngine.get_final_round_state()
        await broadcast_ws({
            "type": "QUALIFIER_PROGRESS",
            "leaderboard": lb,
            "final_state": final_state
        })
        self.write({"success": True})

class AdminImportTeamsHandler(BaseHandler):
    async def post(self):
        if 'file' not in self.request.files:
            self.set_status(400)
            self.write({"error": "No file uploaded."})
            return

        file_obj = self.request.files['file'][0]
        content = file_obj['body'].decode('utf-8', errors='ignore')
        reader = csv.DictReader(io.StringIO(content))

        conn = get_db()
        imported = 0
        for row in reader:
            code = row.get("code", "").strip().upper()
            name = row.get("name", "").strip()
            if not code or not name:
                continue
            members = row.get("members", "").strip()
            pin = row.get("pin", "1234").strip()
            station = row.get("assigned_station", row.get("station", "")).strip()

            try:
                conn.execute("""
                INSERT INTO teams (code, name, members, pin, assigned_station)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(code) DO UPDATE SET
                    name = excluded.name,
                    members = excluded.members,
                    pin = excluded.pin,
                    assigned_station = excluded.assigned_station;
                """, (code, name, members, pin, station))
                imported += 1
            except Exception:
                pass

        conn.commit()
        conn.close()

        lb = QuizEngine.get_qualifier_leaderboard()
        await broadcast_ws({"type": "QUALIFIER_PROGRESS", "leaderboard": lb})
        self.write({"success": True, "imported_count": imported})

# =============================================================================
# REST API: REPORTS & EXPORTS
# =============================================================================
class AdminReportQualifierCsvHandler(BaseHandler):
    def get(self):
        lb = QuizEngine.get_qualifier_leaderboard()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Rank", "Team Code", "Team Name", "Lab PC", "Score", "Time Taken", "Status", "Violations", "Finalist Qualified"])
        for r in lb:
            writer.writerow([
                r["rank"],
                r["code"],
                r["name"],
                r["station"],
                r["score"],
                r["formatted_time"],
                "Submitted" if r["submitted"] else "In Progress",
                r.get("tab_switch_count", 0),
                "YES" if r["will_qualify"] else "NO"
            ])
        self.set_header("Content-Type", "text/csv")
        self.set_header("Content-Disposition", "attachment; filename=EMRS_Qualifier_Results.csv")
        self.write(output.getvalue())

class AdminReportFinalCsvHandler(BaseHandler):
    def get(self):
        conn = get_db()
        finalists = conn.execute("""
            SELECT finalist_slot, code, name, assigned_station, final_score
            FROM teams
            WHERE is_finalist = 1
            ORDER BY final_score DESC;
        """).fetchall()
        conn.close()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Final Rank", "Finalist Slot", "Team Code", "Team Name", "Lab PC", "Final Score"])
        for rank, f in enumerate(finalists, 1):
            writer.writerow([rank, f"T{f['finalist_slot']}", f["code"], f["name"], f["assigned_station"], f["final_score"]])

        self.set_header("Content-Type", "text/csv")
        self.set_header("Content-Disposition", "attachment; filename=EMRS_Final_Scores.csv")
        self.write(output.getvalue())

class AdminAuditLogHandler(BaseHandler):
    def get(self):
        conn = get_db()
        events = conn.execute("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100;").fetchall()
        txs = conn.execute("""
            SELECT s.*, t.name as team_name, t.code as team_code
            FROM score_transactions s
            JOIN teams t ON t.id = s.team_id
            ORDER BY s.created_at DESC LIMIT 100;
        """).fetchall()
        conn.close()
        self.write({
            "events": [dict(e) for e in events],
            "transactions": [dict(tx) for tx in txs]
        })

class AdminSampleQuestionsCsvHandler(BaseHandler):
    def get(self):
        file_path = os.path.join(BASE_DIR, "sample_data", "sample_questions.csv")
        if not os.path.exists(file_path):
            self.set_status(404)
            self.write("Sample file not found.")
            return
        self.set_header("Content-Type", "text/csv; charset=utf-8")
        self.set_header("Content-Disposition", "attachment; filename=\"sample_questions.csv\"")
        with open(file_path, "rb") as f:
            self.write(f.read())

class AdminSampleTeamsCsvHandler(BaseHandler):
    def get(self):
        file_path = os.path.join(BASE_DIR, "sample_data", "sample_teams.csv")
        if not os.path.exists(file_path):
            self.set_status(404)
            self.write("Sample file not found.")
            return
        self.set_header("Content-Type", "text/csv; charset=utf-8")
        self.set_header("Content-Disposition", "attachment; filename=\"sample_teams.csv\"")
        with open(file_path, "rb") as f:
            self.write(f.read())

class AdminResetCompetitionHandler(BaseHandler):
    async def post(self):
        conn = get_db()
        conn.execute("DELETE FROM qualifier_responses;")
        conn.execute("DELETE FROM qualifier_attempts;")
        conn.execute("DELETE FROM score_transactions;")
        conn.execute("DELETE FROM audit_events;")
        conn.execute("""
            UPDATE teams SET
                qualifier_score = 0,
                qualifier_time_ms = 0,
                qualifier_submitted = 0,
                qualifier_submitted_at = NULL,
                is_finalist = 0,
                finalist_slot = NULL,
                final_score = 0;
        """)
        conn.execute("UPDATE competition SET stage = 'setup', active_final_question_idx = 0 WHERE id = 1;")
        conn.execute("""
            UPDATE final_round_state SET
                current_question_id = NULL,
                question_index = 0,
                first_team_slot = 1,
                active_team_slot = 1,
                turn_type = 'main',
                time_remaining_seconds = 60,
                timer_is_running = 0,
                pass_history_json = '[]',
                question_status = 'idle',
                winning_team_slot = NULL
            WHERE id = 1;
        """)
        conn.commit()
        conn.close()

        final_state = QuizEngine.get_final_round_state()
        lb = QuizEngine.get_qualifier_leaderboard()
        await broadcast_ws({
            "type": "COMPETITION_RESET",
            "final_state": final_state,
            "leaderboard": lb
        })
        self.write({"success": True})

# =============================================================================
# APPLICATION FACTORY
# =============================================================================
def make_app():
    settings = {
        "template_path": TEMPLATES_DIR,
        "static_path": STATIC_DIR,
        "cookie_secret": "EMRS_QUIZ_COMPETITION_SECRET_KEY_2026_OFFLINE_LAN",
        "debug": False,
        "compiled_template_cache": False,
    }
    return tornado.web.Application([
        # Pages
        (r"/", QuizPageHandler),
        (r"/quiz", QuizPageHandler),
        (r"/admin", AdminPageHandler),
        (r"/projector", ProjectorPageHandler),

        # WebSocket
        (r"/ws", QuizWebSocketHandler),

        # Auth APIs
        (r"/api/auth/login", LoginApiHandler),
        (r"/api/auth/logout", LogoutApiHandler),
        (r"/api/auth/session", CheckSessionApiHandler),

        # Qualifier APIs
        (r"/api/qualifier/attempt", QualifierAttemptApiHandler),
        (r"/api/qualifier/answer", QualifierAnswerApiHandler),
        (r"/api/qualifier/violation", QualifierViolationApiHandler),
        (r"/api/qualifier/submit", QualifierSubmitApiHandler),

        # Admin & Final Round APIs
        (r"/api/admin/qualifier/leaderboard", AdminQualifierLeaderboardHandler),
        (r"/api/admin/qualifier/promote", AdminPromoteFinalistsHandler),
        (r"/api/admin/qualifier/reset", AdminResetAttemptHandler),
        (r"/api/admin/final/state", AdminFinalStateHandler),
        (r"/api/admin/final/load_question", AdminFinalLoadQuestionHandler),
        (r"/api/admin/final/load_round", AdminFinalLoadRoundHandler),
        (r"/api/admin/final/reveal", AdminFinalRevealQuestionHandler),
        (r"/api/admin/final/timer", AdminFinalTimerControlHandler),
        (r"/api/admin/final/adjudicate", AdminFinalAdjudicateHandler),
        (r"/api/admin/final/score/adjust", AdminScoreAdjustHandler),
        (r"/api/admin/final/reset_scores", AdminFinalResetScoresHandler),
        (r"/api/admin/final/unlock_question", AdminFinalUnlockQuestionHandler),

        # Questions & Teams Management
        (r"/api/admin/questions", AdminQuestionsHandler),
        (r"/api/admin/questions/import", AdminImportQuestionsHandler),
        (r"/api/admin/questions/sample_csv", AdminSampleQuestionsCsvHandler),
        (r"/api/admin/media/upload", AdminMediaUploadHandler),
        (r"/api/admin/projector/media", AdminProjectorMediaControlHandler),
        (r"/api/admin/teams", AdminTeamsHandler),
        (r"/api/admin/teams/import", AdminImportTeamsHandler),
        (r"/api/admin/teams/sample_csv", AdminSampleTeamsCsvHandler),
        (r"/sample_data/(.*)", tornado.web.StaticFileHandler, {"path": os.path.join(BASE_DIR, "sample_data")}),

        # Reports & Recovery
        (r"/api/admin/reports/qualifier", AdminReportQualifierCsvHandler),
        (r"/api/admin/reports/final", AdminReportFinalCsvHandler),
        (r"/api/admin/audit-log", AdminAuditLogHandler),
        (r"/api/admin/competition/reset", AdminResetCompetitionHandler),
    ], **settings)

def start_server(port=8888):
    init_db()
    conn = get_db()
    load_sample_data(conn)
    conn.close()

    app = make_app()
    app.listen(port, address="0.0.0.0")

    lan_ip = get_local_ip()
    print("=" * 70)
    print("  EMRS SCHOOL QUIZ COMPETITION - SERVER STARTED")
    print(f"  LAN Access URL for Student PCs : http://{lan_ip}:{port}/")
    print(f"  Admin / Host Console           : http://{lan_ip}:{port}/admin")
    print(f"  Big-Screen Projector View      : http://{lan_ip}:{port}/projector")
    print("=" * 70)
    print("  No internet connection required. Press Ctrl+C to stop.")

    tornado.ioloop.IOLoop.current().spawn_callback(final_timer_loop)
    tornado.ioloop.IOLoop.current().start()

if __name__ == "__main__":
    start_server(8888)
