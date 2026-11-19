"""
EMRS Quiz Engine - Core Rules & State Management
Implements Qualifier shuffling/scoring and Final Round rotation/timing
strictly adhering to the EMRS School Quiz Functional Specification.
"""

import json
import random
import time
from datetime import datetime
from database import get_db

class QuizEngine:
    @staticmethod
    def get_competition_status():
        """Returns the global competition configuration and current stage."""
        conn = get_db()
        comp = conn.execute("SELECT * FROM competition WHERE id = 1;").fetchone()
        final_state = conn.execute("SELECT * FROM final_round_state WHERE id = 1;").fetchone()
        conn.close()
        return dict(comp) if comp else {}, dict(final_state) if final_state else {}

    @staticmethod
    def update_competition_settings(settings: dict):
        """Updates competition configuration."""
        conn = get_db()
        conn.execute("""
        UPDATE competition SET
            title = ?,
            qualifier_duration_seconds = ?,
            qualifier_team_count = ?,
            final_team_count = ?,
            final_main_timer_seconds = ?,
            final_pass_timer_seconds = ?,
            final_correct_marks = ?,
            shuffle_options = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1;
        """, (
            settings.get("title", "EMRS School Quiz Competition"),
            int(settings.get("qualifier_duration_seconds", 1200)),
            int(settings.get("qualifier_team_count", 15)),
            int(settings.get("final_team_count", 6)),
            int(settings.get("final_main_timer_seconds", 60)),
            int(settings.get("final_pass_timer_seconds", 5)),
            int(settings.get("final_correct_marks", 5)),
            1 if settings.get("shuffle_options", True) else 0
        ))
        conn.commit()
        conn.close()

    @staticmethod
    def set_competition_stage(stage: str):
        """Sets current stage: 'setup', 'qualifier_active', 'qualifier_completed', 'final_active', 'final_completed'."""
        conn = get_db()
        conn.execute("UPDATE competition SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1;", (stage,))
        conn.execute("INSERT INTO audit_events (event_type, details) VALUES (?, ?);",
                     ("STAGE_CHANGE", f"Competition stage changed to {stage}"))
        conn.commit()
        conn.close()

    # =========================================================================
    # QUALIFIER ROUND METHODS
    # =========================================================================

    @staticmethod
    def start_or_resume_qualifier_attempt(team_id: int):
        """
        Retrieves or creates a qualifier attempt for a team.
        Implements independent question & option shuffling, server-side timing,
        and reconnect recovery.
        """
        conn = get_db()
        team = conn.execute("SELECT * FROM teams WHERE id = ?;", (team_id,)).fetchone()
        if not team:
            conn.close()
            return None, "Team not found"

        comp = conn.execute("SELECT * FROM competition WHERE id = 1;").fetchone()
        duration_seconds = comp["qualifier_duration_seconds"]
        shuffle_opts = bool(comp["shuffle_options"])

        attempt = conn.execute("SELECT * FROM qualifier_attempts WHERE team_id = ?;", (team_id,)).fetchone()

        if not attempt:
            # First time starting attempt
            # Fetch all active qualifier questions
            questions = conn.execute("""
                SELECT id FROM questions
                WHERE round_type IN ('qualifier', 'screening')
                ORDER BY question_number ASC;
            """).fetchall()

            if not questions:
                conn.close()
                return None, "No qualifier questions configured in the question bank."

            q_ids = [q["id"] for q in questions]
            # Shuffle question order independently for this team
            random.shuffle(q_ids)

            # Option order per question
            option_orders = {}
            for q_id in q_ids:
                if shuffle_opts:
                    opt_order = [0, 1, 2, 3]
                    random.shuffle(opt_order)
                    option_orders[str(q_id)] = opt_order
                else:
                    option_orders[str(q_id)] = [0, 1, 2, 3]

            now_ts = int(time.time())
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO qualifier_attempts (team_id, started_at_ts, question_order_json, option_orders_json, is_submitted)
            VALUES (?, ?, ?, ?, 0);
            """, (team_id, now_ts, json.dumps(q_ids), json.dumps(option_orders)))
            conn.commit()
            attempt = conn.execute("SELECT * FROM qualifier_attempts WHERE id = ?;", (cursor.lastrowid,)).fetchone()

        # Calculate server elapsed time and remaining time
        now_ts = int(time.time())
        started_epoch = attempt["started_at_ts"]
        elapsed_seconds = max(0, now_ts - started_epoch)
        remaining_seconds = max(0, duration_seconds - elapsed_seconds)

        # Check if attempt has expired but not marked submitted
        if remaining_seconds == 0 and not attempt["is_submitted"]:
            QuizEngine.submit_qualifier_attempt(team_id)
            attempt = conn.execute("SELECT * FROM qualifier_attempts WHERE team_id = ?;", (team_id,)).fetchone()

        # Fetch existing responses for this team
        responses = conn.execute("""
            SELECT question_id, selected_option_index, is_marked_review
            FROM qualifier_responses
            WHERE attempt_id = ?;
        """, (attempt["id"],)).fetchall()
        saved_responses = {
            r["question_id"]: {
                "selected": r["selected_option_index"],
                "marked_review": bool(r["is_marked_review"])
            }
            for r in responses
        }

        # Build ordered question list with team-specific shuffled options
        q_order = json.loads(attempt["question_order_json"])
        opt_orders = json.loads(attempt["option_orders_json"])

        questions_data = []
        for q_id in q_order:
            q_row = conn.execute("SELECT * FROM questions WHERE id = ?;", (q_id,)).fetchone()
            if not q_row:
                continue

            orig_opts = json.loads(q_row["options_json"])
            shuffled_indices = opt_orders.get(str(q_id), [0, 1, 2, 3])

            # Build list of options presented to the user
            # Each choice has a display_index (0..3) and maps to original_index
            presented_options = []
            for display_idx, orig_idx in enumerate(shuffled_indices):
                if orig_idx < len(orig_opts):
                    presented_options.append({
                        "display_idx": display_idx,
                        "orig_idx": orig_idx,
                        "text": orig_opts[orig_idx]
                    })

            user_resp = saved_responses.get(q_id, {"selected": None, "marked_review": False})

            questions_data.append({
                "id": q_row["id"],
                "text": q_row["text"],
                "category": q_row["category"],
                "marks": q_row["marks"],
                "media_type": q_row["media_type"] if "media_type" in q_row.keys() else "none",
                "media_url": q_row["media_url"] if "media_url" in q_row.keys() else "",
                "options": presented_options,
                "selected_orig_idx": user_resp["selected"],
                "is_marked_review": user_resp["marked_review"]
            })

        result = {
            "attempt_id": attempt["id"],
            "team": {
                "id": team["id"],
                "code": team["code"],
                "name": team["name"],
                "station": team["assigned_station"]
            },
            "is_submitted": bool(attempt["is_submitted"]),
            "duration_seconds": duration_seconds,
            "elapsed_seconds": elapsed_seconds,
            "remaining_seconds": remaining_seconds,
            "tab_switch_count": attempt["tab_switch_count"] if "tab_switch_count" in attempt.keys() else 0,
            "questions": questions_data
        }

        conn.close()
        return result, None

    @staticmethod
    def record_tab_switch_violation(team_id: int, reason: str = "Window/Tab Switch"):
        """
        Records a window blur, tab switch, or fullscreen exit violation.
        Increments count and logs an audit event.
        Returns (new_count, max_exceeded_bool).
        """
        conn = get_db()
        attempt = conn.execute("SELECT id, tab_switch_count, is_submitted FROM qualifier_attempts WHERE team_id = ? AND is_submitted = 0;", (team_id,)).fetchone()
        if not attempt:
            conn.close()
            return 0, False

        new_count = (attempt["tab_switch_count"] or 0) + 1
        conn.execute("UPDATE qualifier_attempts SET tab_switch_count = ? WHERE id = ?;", (new_count, attempt["id"]))

        team = conn.execute("SELECT code, name, assigned_station FROM teams WHERE id = ?;", (team_id,)).fetchone()
        team_label = f"{team['name']} ({team['code']} at {team['assigned_station']})" if team else f"Team {team_id}"

        conn.execute("""
            INSERT INTO audit_events (event_type, details)
            VALUES ('SECURITY_VIOLATION', ?);
        """, (f"Window switch / fullscreen exit violation #{new_count} by {team_label}. Reason: {reason}",))

        max_exceeded = new_count >= 3
        if max_exceeded:
            conn.commit()
            conn.close()
            QuizEngine.submit_qualifier_attempt(team_id)
            return new_count, True

        conn.commit()
        conn.close()
        return new_count, False

    @staticmethod
    def record_qualifier_answer(team_id: int, question_id: int, selected_orig_idx: int, is_marked_review: bool):
        """
        Saves or clears an answer for a question in real-time.
        Immediately evaluates correctness and writes to SQLite.
        """
        conn = get_db()
        attempt = conn.execute("""
            SELECT * FROM qualifier_attempts
            WHERE team_id = ? AND is_submitted = 0;
        """, (team_id,)).fetchone()

        if not attempt:
            conn.close()
            return False, "No active unsubmitted attempt found."

        # Fetch question to check correct index
        q = conn.execute("SELECT correct_index FROM questions WHERE id = ?;", (question_id,)).fetchone()
        if not q:
            conn.close()
            return False, "Question not found."

        is_correct = 1 if (selected_orig_idx is not None and selected_orig_idx == q["correct_index"]) else 0

        conn.execute("""
        INSERT INTO qualifier_responses (
            attempt_id, team_id, question_id, selected_option_index, is_marked_review, is_correct, answered_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(attempt_id, question_id) DO UPDATE SET
            selected_option_index = excluded.selected_option_index,
            is_marked_review = excluded.is_marked_review,
            is_correct = excluded.is_correct,
            answered_at = CURRENT_TIMESTAMP;
        """, (attempt["id"], team_id, question_id, selected_orig_idx, 1 if is_marked_review else 0, is_correct))

        conn.commit()
        conn.close()
        return True, None

    @staticmethod
    def submit_qualifier_attempt(team_id: int):
        """
        Submits the qualifier attempt, tallies score, computes precise elapsed time,
        and saves final qualifier results.
        """
        conn = get_db()
        attempt = conn.execute("SELECT * FROM qualifier_attempts WHERE team_id = ?;", (team_id,)).fetchone()
        if not attempt:
            conn.close()
            return False, "Attempt not found."

        if attempt["is_submitted"]:
            conn.close()
            return True, "Already submitted."

        # Compute elapsed time
        now_ts = int(time.time())
        started_epoch = attempt["started_at_ts"]
        elapsed_seconds = max(1, now_ts - started_epoch)
        elapsed_ms = int(elapsed_seconds * 1000)

        # Calculate total marks (+1 per correct)
        score_row = conn.execute("""
            SELECT COALESCE(SUM(is_correct), 0) as total_score
            FROM qualifier_responses
            WHERE attempt_id = ?;
        """, (attempt["id"],)).fetchone()
        total_score = int(score_row["total_score"])

        # Mark attempt submitted
        conn.execute("""
        UPDATE qualifier_attempts SET
            is_submitted = 1,
            submitted_at_ts = ?,
            duration_ms = ?
        WHERE id = ?;
        """, (now_ts, elapsed_ms, attempt["id"]))

        # Update team record
        conn.execute("""
        UPDATE teams SET
            qualifier_score = ?,
            qualifier_time_ms = ?,
            qualifier_submitted = 1,
            qualifier_submitted_at = CURRENT_TIMESTAMP
        WHERE id = ?;
        """, (total_score, elapsed_ms, team_id))

        # Record score transaction
        conn.execute("""
        INSERT INTO score_transactions (team_id, round_type, delta_marks, resulting_score, reason)
        VALUES (?, 'qualifier', ?, ?, 'Qualifier round submission');
        """, (team_id, total_score, total_score))

        conn.execute("""
        INSERT INTO audit_events (event_type, details)
        VALUES ('QUALIFIER_SUBMISSION', ?);
        """, (f"Team {team_id} submitted qualifier: {total_score} marks in {elapsed_seconds}s",))

        conn.commit()
        conn.close()
        return True, None

    @staticmethod
    def get_qualifier_leaderboard():
        """
        Calculates rankings according to Functional Spec Section 2.1:
        1. Correct answer: +1 mark
        2. Tie-breaker: Where marks are equal, the lower time taken ranks higher.
        3. Equal time tie-breaker: earlier submission timestamp.
        """
        conn = get_db()
        teams = conn.execute("""
            SELECT
                t.id, t.code, t.name, t.assigned_station, t.qualifier_score,
                t.qualifier_time_ms, t.qualifier_submitted, t.qualifier_submitted_at,
                t.is_finalist, t.finalist_slot,
                a.started_at_ts,
                COALESCE(a.tab_switch_count, 0) as tab_switch_count,
                (SELECT COUNT(*) FROM qualifier_responses r WHERE r.team_id = t.id AND r.selected_option_index IS NOT NULL) as answered_count
            FROM teams t
            LEFT JOIN qualifier_attempts a ON a.team_id = t.id
            WHERE t.is_active = 1
            ORDER BY
                t.qualifier_score DESC,
                (CASE WHEN t.qualifier_submitted = 1 THEN t.qualifier_time_ms ELSE 999999999 END) ASC,
                t.qualifier_submitted_at ASC,
                t.code ASC;
        """).fetchall()

        total_questions = conn.execute("SELECT COUNT(*) FROM questions WHERE round_type = 'qualifier';").fetchone()[0]

        leaderboard = []
        for rank, row in enumerate(teams, 1):
            ms = row["qualifier_time_ms"]
            seconds = ms // 1000
            mins = seconds // 60
            secs = seconds % 60
            formatted_time = f"{mins:02d}:{secs:02d}" if row["qualifier_submitted"] else "--:--"

            leaderboard.append({
                "rank": rank,
                "id": row["id"],
                "code": row["code"],
                "name": row["name"],
                "station": row["assigned_station"],
                "score": row["qualifier_score"],
                "time_ms": ms,
                "formatted_time": formatted_time,
                "submitted": bool(row["qualifier_submitted"]),
                "answered_count": row["answered_count"],
                "total_questions": total_questions,
                "is_finalist": bool(row["is_finalist"]),
                "finalist_slot": row["finalist_slot"],
                "tab_switch_count": row["tab_switch_count"],
                "will_qualify": rank <= 6
            })

        conn.close()
        return leaderboard

    @staticmethod
    def promote_top_finalists(top_n=6):
        """Promotes the top 6 teams from the qualifier leaderboard to the Final Round."""
        leaderboard = QuizEngine.get_qualifier_leaderboard()
        conn = get_db()

        # Reset existing finalist slots, scores, and answer times
        conn.execute("UPDATE teams SET is_finalist = 0, finalist_slot = NULL, final_score = 0, final_time_ms = 0;")

        top_teams = leaderboard[:top_n]
        for slot, team_entry in enumerate(top_teams, 1):
            conn.execute("""
            UPDATE teams SET
                is_finalist = 1,
                finalist_slot = ?,
                final_score = 0,
                final_time_ms = 0
            WHERE id = ?;
            """, (slot, team_entry["id"]))

        # Set stage to final_active
        conn.execute("UPDATE competition SET stage = 'final_active' WHERE id = 1;")

        # Initialize final round state with question index 0 and first team slot 1
        conn.execute("""
        UPDATE final_round_state SET
            question_index = 0,
            first_team_slot = 1,
            active_team_slot = 1,
            turn_type = 'main',
            time_remaining_seconds = 60,
            timer_is_running = 0,
            pass_history_json = '[]',
            question_status = 'idle',
            winning_team_slot = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1;
        """)

        conn.execute("""
        INSERT INTO audit_events (event_type, details)
        VALUES ('PROMOTED_FINALISTS', ?);
        """, (f"Top {len(top_teams)} teams promoted to final round.",))

        conn.commit()
        conn.close()
        return True, [t["name"] for t in top_teams]

    # =========================================================================
    # FINAL ROUND METHODS
    # =========================================================================

    @staticmethod
    def get_finalists():
        """Returns the 6 finalist teams ordered by their finalist slot (T1 to T6)."""
        conn = get_db()
        finalists = conn.execute("""
            SELECT id, code, name, finalist_slot, final_score, final_time_ms, assigned_station
            FROM teams
            WHERE is_finalist = 1
            ORDER BY finalist_slot ASC;
        """).fetchall()
        conn.close()
        return [dict(f) for f in finalists]

    @staticmethod
    def get_passing_order_for_slot(first_slot: int, total_slots: int = 6):
        """
        Calculates the exact passing sequence for a given question's first team slot.
        Rule (Section 2.3):
        Q1 (T1 first): Passing order: T2 -> T3 -> T4 -> T5 -> T6
        Q2 (T2 first): Passing order: T3 -> T4 -> T5 -> T6 -> T1
        """
        order = []
        for i in range(1, total_slots):
            slot = ((first_slot - 1 + i) % total_slots) + 1
            order.append(slot)
        return order

    @staticmethod
    def get_final_questions(conn):
        """
        Returns all final round projector questions strictly grouped by competition round:
        Round 1: Indian Culture
        Round 2: Indian Heritage
        Round 3: Tribal Traditions
        Round 4: Audio Round
        Round 5: Visual Round
        Sorted by round priority, question_number ASC, and id ASC.
        """
        return conn.execute("""
            SELECT * FROM questions
            WHERE round_type IN ('final', 'projector')
            ORDER BY 
                CASE 
                    WHEN LOWER(media_type) = 'audio' OR LOWER(category) LIKE '%audio%' THEN 4
                    WHEN LOWER(media_type) = 'image' OR LOWER(category) LIKE '%visual%' OR LOWER(category) LIKE '%image%' THEN 5
                    WHEN LOWER(category) LIKE '%culture%' THEN 1
                    WHEN LOWER(category) LIKE '%heritage%' THEN 2
                    WHEN LOWER(category) LIKE '%tribal%' THEN 3
                    ELSE 1
                END ASC,
                question_number ASC,
                id ASC;
        """).fetchall()

    @staticmethod
    def get_final_round_state():
        """
        Returns full state of the Final Round including:
        - Active question details
        - Active team and turn type (main / pass)
        - Pass sequence and status for each team
        - Timer remaining and status
        - 6-team live leaderboard
        """
        conn = get_db()
        comp = conn.execute("SELECT * FROM competition WHERE id = 1;").fetchone()
        f_state = conn.execute("SELECT * FROM final_round_state WHERE id = 1;").fetchone()
        finalists = conn.execute("""
            SELECT id, code, name, finalist_slot, final_score, final_time_ms, assigned_station
            FROM teams
            WHERE is_finalist = 1
            ORDER BY finalist_slot ASC;
        """).fetchall()

        if not finalists:
            all_teams = conn.execute("SELECT id, code, name, final_score, assigned_station FROM teams WHERE is_active = 1 ORDER BY code ASC LIMIT 6;").fetchall()
            for slot, t in enumerate(all_teams, 1):
                conn.execute("UPDATE teams SET is_finalist = 1, finalist_slot = ? WHERE id = ?;", (slot, t["id"]))
            conn.commit()
            finalists = conn.execute("""
                SELECT id, code, name, finalist_slot, final_score, final_time_ms, assigned_station
                FROM teams
                WHERE is_finalist = 1
                ORDER BY finalist_slot ASC;
            """).fetchall()

        # Fetch all final round questions
        questions = QuizEngine.get_final_questions(conn)

        q_idx = f_state["question_index"]
        if q_idx >= len(questions) and len(questions) > 0:
            q_idx = 0
            conn.execute("UPDATE final_round_state SET question_index = 0, is_question_visible = 0, timer_is_running = 0, question_status = 'idle' WHERE id = 1;")
            conn.commit()

        current_q = None
        if 0 <= q_idx < len(questions):
            q_row = questions[q_idx]
            current_q = {
                "id": q_row["id"],
                "index": q_idx,
                "question_number": q_idx + 1,
                "text": q_row["text"],
                "options": json.loads(q_row["options_json"]),
                "correct_index": q_row["correct_index"],
                "category": q_row["category"],
                "explanation": q_row["explanation"],
                "marks": q_row["marks"],
                "media_type": q_row["media_type"] if "media_type" in q_row.keys() else "none",
                "media_url": q_row["media_url"] if "media_url" in q_row.keys() else ""
            }

        first_slot = f_state["first_team_slot"]
        passing_order = QuizEngine.get_passing_order_for_slot(first_slot, len(finalists) or 6)

        # Parse pass history
        pass_history = json.loads(f_state["pass_history_json"])

        # Limit passing sequence to max 2 passes (Main + 2 passes = 3 teams total)
        max_passes = 2
        allowed_passing_order = passing_order[:max_passes]
        full_sequence = [first_slot] + allowed_passing_order

        pass_count = len(pass_history)
        current_marks = QuizEngine.get_final_turn_marks(pass_count)

        finalists_list = []
        for f in finalists:
            f_dict = dict(f)
            t_ms = f_dict.get("final_time_ms") or 0
            f_dict["final_time_ms"] = t_ms
            f_dict["final_time_seconds"] = round(t_ms / 1000.0, 1)
            sec = t_ms / 1000.0
            if sec < 60:
                f_dict["final_time_display"] = f"{sec:.1f}s"
            else:
                m = int(sec // 60)
                s = sec % 60
                f_dict["final_time_display"] = f"{m}m {s:.1f}s"
            finalists_list.append(f_dict)

        finalists_map = {f["finalist_slot"]: f for f in finalists_list}

        # Calculate time remaining if timer is running
        time_remaining = f_state["time_remaining_seconds"]
        if f_state["timer_is_running"] and f_state["timer_started_at_ms"] > 0:
            now_ms = int(time.time() * 1000)
            elapsed_sec = (now_ms - f_state["timer_started_at_ms"]) // 1000
            total_duration = comp["final_main_timer_seconds"] if f_state["turn_type"] == "main" else comp["final_pass_timer_seconds"]
            time_remaining = max(0, total_duration - elapsed_sec)

        # 5 Competition Rounds grouping & metadata
        rounds_summary = QuizEngine.get_projector_rounds_info(questions)
        current_round = None
        round_q_idx = 1
        round_total_q = 6

        for r in rounds_summary:
            if q_idx in r["question_indices"]:
                r["is_active"] = True
                current_round = {
                    "round_number": r["round_number"],
                    "id": r["id"],
                    "name": r["name"],
                    "icon": r["icon"],
                    "color": r["color"],
                    "total_questions": r["total_questions"]
                }
                round_q_idx = r["question_indices"].index(q_idx) + 1
                round_total_q = r["total_questions"]
            else:
                r["is_active"] = False

        completed_rows = conn.execute("SELECT * FROM final_question_results;").fetchall()
        completed_map = {}
        for cr in completed_rows:
            completed_map[cr["question_index"]] = {
                "question_id": cr["question_id"],
                "question_index": cr["question_index"],
                "status": cr["status"],
                "winning_team_slot": cr["winning_team_slot"],
                "winning_team_name": cr["winning_team_name"],
                "awarded_marks": cr["awarded_marks"],
                "selected_option": cr["selected_option"],
                "correct_index": cr["correct_index"],
                "attempted_by": cr["attempted_by"],
                "pass_history": json.loads(cr["pass_history_json"]) if cr["pass_history_json"] else [],
                "time_taken_seconds": cr["time_taken_seconds"] if "time_taken_seconds" in cr.keys() else 0.0
            }

        for r in rounds_summary:
            r["completed_count"] = sum(1 for idx in r["question_indices"] if idx in completed_map)

        is_media = QuizEngine.is_media_question(questions[q_idx]) if 0 <= q_idx < len(questions) else False
        is_q_vis = bool(f_state["is_question_visible"]) if "is_question_visible" in f_state.keys() else False
        is_opt_vis = bool(f_state["is_options_visible"]) if "is_options_visible" in f_state.keys() else is_q_vis
        lock_info = completed_map.get(q_idx, None)
        is_locked = bool(lock_info) or (f_state["question_status"] == "ended")

        if current_q:
            current_q["round_number"] = current_round["round_number"] if current_round else 1
            current_q["round_name"] = current_round["name"] if current_round else "Indian Culture"
            current_q["round_icon"] = current_round["icon"] if current_round else "🎭"
            current_q["round_color"] = current_round["color"] if current_round else "#10b981"
            current_q["round_question_index"] = round_q_idx
            current_q["round_total_questions"] = round_total_q
            current_q["is_media_question"] = is_media
            current_q["is_locked"] = is_locked
            current_q["lock_info"] = lock_info

        result = {
            "competition": dict(comp),
            "question": current_q,
            "rounds": rounds_summary,
            "current_round": current_round,
            "total_questions": len(questions),
            "question_index": q_idx,
            "first_team_slot": first_slot,
            "active_team_slot": f_state["active_team_slot"],
            "turn_type": f_state["turn_type"], # 'main' (60s) or 'pass' (5s)
            "pass_count": pass_count,
            "max_passes": max_passes,
            "current_marks": current_marks,
            "time_remaining_seconds": time_remaining,
            "timer_is_running": bool(f_state["timer_is_running"]),
            "is_question_visible": is_q_vis,
            "is_options_visible": is_opt_vis,
            "is_media_question": is_media,
            "is_locked": is_locked,
            "lock_info": lock_info,
            "completed_questions": completed_map,
            "question_status": f_state["question_status"], # 'idle', 'in_progress', 'paused', 'ended'
            "winning_team_slot": f_state["winning_team_slot"],
            "pass_history": pass_history,
            "full_sequence": full_sequence,
            "passing_order": allowed_passing_order,
            "finalists": finalists_list,
            "active_team": finalists_map.get(f_state["active_team_slot"], None)
        }

        conn.close()
        return result

    @staticmethod
    def is_media_question(q_row):
        """Returns True if the question is an Audio or Visual (Image) question."""
        if not q_row:
            return False
        media = (q_row["media_type"] or "").strip().lower() if "media_type" in q_row.keys() else "none"
        cat = (q_row["category"] or "").strip().lower() if "category" in q_row.keys() else ""
        return media in ("audio", "image") or "audio" in cat or "visual" in cat or "image" in cat

    @staticmethod
    def get_projector_rounds_info(questions):
        """
        Groups projector questions into 5 distinct competition rounds:
        1. Indian Culture
        2. Indian Heritage
        3. Tribal Traditions
        4. Audio Round
        5. Visual Round
        """
        rounds_def = [
            {"round_number": 1, "id": "culture", "name": "Indian Culture", "icon": "🎭", "color": "#10b981"},
            {"round_number": 2, "id": "heritage", "name": "Indian Heritage", "icon": "🏛️", "color": "#0ea5e9"},
            {"round_number": 3, "id": "tribal", "name": "Tribal Traditions", "icon": "🏹", "color": "#f43f5e"},
            {"round_number": 4, "id": "audio", "name": "Audio Round", "icon": "🎵", "color": "#f59e0b"},
            {"round_number": 5, "id": "visual", "name": "Visual Round", "icon": "🖼️", "color": "#a855f7"}
        ]

        rounds_summary = []
        for r in rounds_def:
            r_copy = dict(r)
            r_copy["question_indices"] = []
            rounds_summary.append(r_copy)

        for idx, q in enumerate(questions):
            cat = (q["category"] or "").lower()
            media = (q["media_type"] or "").lower() if "media_type" in q.keys() else "none"

            if media == "audio" or "audio" in cat:
                r_idx = 3 # Round 4: Audio
            elif media == "image" or "visual" in cat or "image" in cat:
                r_idx = 4 # Round 5: Visual
            elif "culture" in cat:
                r_idx = 0 # Round 1: Culture
            elif "heritage" in cat:
                r_idx = 1 # Round 2: Heritage
            elif "tribal" in cat:
                r_idx = 2 # Round 3: Tribal
            else:
                r_idx = 0

            rounds_summary[r_idx]["question_indices"].append(idx)

        for r in rounds_summary:
            indices = r["question_indices"]
            r["total_questions"] = len(indices)
            r["start_index"] = indices[0] if indices else 0
            r["end_index"] = indices[-1] if indices else 0

        return rounds_summary

    @staticmethod
    def load_final_round(round_number: int):
        conn = get_db()
        questions = QuizEngine.get_final_questions(conn)
        conn.close()

        rounds_summary = QuizEngine.get_projector_rounds_info(questions)
        target_round = None
        for r in rounds_summary:
            if r["round_number"] == round_number:
                target_round = r
                break

        if not target_round or not target_round["question_indices"]:
            return False, f"Round {round_number} not found or has no questions."

        start_idx = target_round["start_index"]
        return QuizEngine.load_final_question(start_idx)

    @staticmethod
    def load_final_question(question_index: int):
        """
        Loads a question for the Final Round and establishes the rotation starting team:
        Rule (Section 2.3):
        First team for Q1 = T1
        First team for Q2 = T2
        ...
        First team for Q6 = T6
        First team for Q7 = T1 (repeats modulo 6)
        """
        conn = get_db()
        comp = conn.execute("SELECT * FROM competition WHERE id = 1;").fetchone()
        questions = QuizEngine.get_final_questions(conn)

        if question_index < 0 or question_index >= len(questions):
            conn.close()
            return False, "Question index out of range."

        q_row = questions[question_index]
        first_team_slot = (question_index % 6) + 1
        main_timer = comp["final_main_timer_seconds"]

        # Check if question was already completed and locked
        saved_result = conn.execute("""
            SELECT * FROM final_question_results WHERE question_id = ? OR question_index = ?;
        """, (q_row["id"], question_index)).fetchone()

        if saved_result and saved_result["status"] == "ended":
            conn.execute("""
            UPDATE final_round_state SET
                current_question_id = ?,
                question_index = ?,
                first_team_slot = ?,
                active_team_slot = ?,
                turn_type = 'main',
                time_remaining_seconds = 0,
                timer_is_running = 0,
                timer_started_at_ms = 0,
                pass_history_json = ?,
                question_status = 'ended',
                is_question_visible = 1,
                is_options_visible = 1,
                winning_team_slot = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1;
            """, (q_row["id"], question_index, first_team_slot,
                  saved_result["winning_team_slot"] or first_team_slot,
                  saved_result["pass_history_json"],
                  saved_result["winning_team_slot"]))
        else:
            conn.execute("""
            UPDATE final_round_state SET
                current_question_id = ?,
                question_index = ?,
                first_team_slot = ?,
                active_team_slot = ?,
                turn_type = 'main',
                time_remaining_seconds = ?,
                timer_is_running = 0,
                timer_started_at_ms = 0,
                pass_history_json = '[]',
                question_status = 'idle',
                is_question_visible = 0,
                is_options_visible = 0,
                winning_team_slot = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1;
            """, (q_row["id"], question_index, first_team_slot, first_team_slot, main_timer))

        conn.commit()
        conn.close()
        return True, None

    @staticmethod
    def reveal_final_question(auto_start_timer=True):
        """
        Reveals the question on the Projector Screen.
        - For Text questions: immediately shows question + options and starts the 60s timer.
        - For Audio / Visual questions: shows media + question FIRST (options stay hidden
          and timer stays paused until reveal_final_options() is triggered).
        """
        conn = get_db()
        comp = conn.execute("SELECT * FROM competition WHERE id = 1;").fetchone()
        f_state = conn.execute("SELECT * FROM final_round_state WHERE id = 1;").fetchone()

        if f_state["question_status"] == "ended":
            conn.close()
            return True, None

        questions = QuizEngine.get_final_questions(conn)

        q_idx = f_state["question_index"]
        q_row = questions[q_idx] if 0 <= q_idx < len(questions) else None
        is_media = QuizEngine.is_media_question(q_row)

        main_duration = comp["final_main_timer_seconds"] # 60
        now_ms = int(time.time() * 1000)

        if is_media:
            # Step 1 for Audio/Visual: show media & question only; do NOT show options or start timer yet!
            conn.execute("""
            UPDATE final_round_state SET
                is_question_visible = 1,
                is_options_visible = 0,
                turn_type = 'main',
                timer_is_running = 0,
                time_remaining_seconds = ?,
                timer_started_at_ms = 0,
                question_status = 'idle',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1;
            """, (main_duration,))
        elif auto_start_timer:
            conn.execute("""
            UPDATE final_round_state SET
                is_question_visible = 1,
                is_options_visible = 1,
                turn_type = 'main',
                timer_is_running = 1,
                time_remaining_seconds = ?,
                timer_started_at_ms = ?,
                question_status = 'in_progress',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1;
            """, (main_duration, now_ms))
        else:
            conn.execute("""
            UPDATE final_round_state SET
                is_question_visible = 1,
                is_options_visible = 1,
                turn_type = 'main',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1;
            """)
        conn.commit()
        conn.close()
        return True, None

    @staticmethod
    def reveal_final_options(auto_start_timer=True):
        """
        Step 2 for Audio & Visual questions:
        Reveals the 4 answer options on the Projector Screen and starts the 60-second timer.
        """
        conn = get_db()
        comp = conn.execute("SELECT * FROM competition WHERE id = 1;").fetchone()
        f_state = conn.execute("SELECT * FROM final_round_state WHERE id = 1;").fetchone()

        if f_state["question_status"] == "ended":
            conn.close()
            return True, None

        main_duration = comp["final_main_timer_seconds"] # 60
        now_ms = int(time.time() * 1000)

        if auto_start_timer:
            conn.execute("""
            UPDATE final_round_state SET
                is_question_visible = 1,
                is_options_visible = 1,
                turn_type = 'main',
                timer_is_running = 1,
                time_remaining_seconds = ?,
                timer_started_at_ms = ?,
                question_status = 'in_progress',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1;
            """, (main_duration, now_ms))
        else:
            conn.execute("""
            UPDATE final_round_state SET
                is_question_visible = 1,
                is_options_visible = 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1;
            """)
        conn.commit()
        conn.close()
        return True, None

    @staticmethod
    def hide_final_question():
        """Hides the question & options from the Projector Screen and stops the timer."""
        conn = get_db()
        f_state = conn.execute("SELECT * FROM final_round_state WHERE id = 1;").fetchone()
        if f_state["question_status"] == "ended":
            conn.close()
            return True, None

        comp = conn.execute("SELECT * FROM competition WHERE id = 1;").fetchone()
        main_duration = comp["final_main_timer_seconds"]
        conn.execute("""
        UPDATE final_round_state SET
            is_question_visible = 0,
            is_options_visible = 0,
            turn_type = 'main',
            timer_is_running = 0,
            timer_started_at_ms = 0,
            time_remaining_seconds = ?,
            question_status = 'idle',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1;
        """, (main_duration,))
        conn.commit()
        conn.close()
        return True, None

    @staticmethod
    def start_final_timer():
        """Starts or resumes the countdown timer."""
        conn = get_db()
        f_state = conn.execute("SELECT * FROM final_round_state WHERE id = 1;").fetchone()
        comp = conn.execute("SELECT * FROM competition WHERE id = 1;").fetchone()

        if f_state["question_status"] == "ended":
            conn.close()
            return False, "Question has already ended."

        # If starting fresh, set default timer duration for turn type
        time_rem = f_state["time_remaining_seconds"]
        if f_state["question_status"] == "idle":
            time_rem = comp["final_main_timer_seconds"] if f_state["turn_type"] == "main" else comp["final_pass_timer_seconds"]

        now_ms = int(time.time() * 1000)
        # Offset start timestamp by remaining seconds so elapsed arithmetic stays accurate
        duration = comp["final_main_timer_seconds"] if f_state["turn_type"] == "main" else comp["final_pass_timer_seconds"]
        elapsed_sec = duration - time_rem
        synthetic_start_ms = now_ms - (elapsed_sec * 1000)

        conn.execute("""
        UPDATE final_round_state SET
            timer_is_running = 1,
            time_remaining_seconds = ?,
            timer_started_at_ms = ?,
            question_status = 'in_progress',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1;
        """, (time_rem, synthetic_start_ms))

        conn.commit()
        conn.close()
        return True, None

    @staticmethod
    def pause_final_timer():
        """Pauses the countdown timer and records remaining seconds."""
        conn = get_db()
        f_state = conn.execute("SELECT * FROM final_round_state WHERE id = 1;").fetchone()
        comp = conn.execute("SELECT * FROM competition WHERE id = 1;").fetchone()

        if not f_state["timer_is_running"]:
            conn.close()
            return True, "Already paused."

        now_ms = int(time.time() * 1000)
        duration = comp["final_main_timer_seconds"] if f_state["turn_type"] == "main" else comp["final_pass_timer_seconds"]
        elapsed_sec = (now_ms - f_state["timer_started_at_ms"]) // 1000
        time_rem = max(0, duration - elapsed_sec)

        conn.execute("""
        UPDATE final_round_state SET
            timer_is_running = 0,
            time_remaining_seconds = ?,
            question_status = 'paused',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1;
        """, (time_rem,))

        conn.commit()
        conn.close()
        return True, None

    @staticmethod
    def get_team_for_slot(conn, slot: int):
        """Returns the team corresponding to the given finalist slot, with robust fallback."""
        team = conn.execute("SELECT * FROM teams WHERE finalist_slot = ?;", (slot,)).fetchone()
        if not team:
            teams = conn.execute("SELECT * FROM teams WHERE is_active = 1 ORDER BY code ASC;").fetchall()
            if 0 < slot <= len(teams):
                team = teams[slot - 1]
                conn.execute("UPDATE teams SET finalist_slot = ?, is_finalist = 1 WHERE id = ?;", (slot, team["id"]))
                conn.commit()
        return team

    @staticmethod
    def get_final_turn_marks(pass_count: int) -> int:
        """
        Marks progression rule:
        - Main turn (0 passes): 10 marks
        - 1st Pass: 5 marks
        - 2nd Pass: 2 marks
        """
        if pass_count == 0:
            return 10
        elif pass_count == 1:
            return 5
        elif pass_count == 2:
            return 2
        return 0

    @staticmethod
    def mark_final_correct(selected_option=None):
        """
        Adjudication: Correct Answer.
        - Main turn: 10 marks
        - 1st Pass: 5 marks
        - 2nd Pass: 2 marks
        Question ends immediately.
        """
        conn = get_db()
        f_state = conn.execute("SELECT * FROM final_round_state WHERE id = 1;").fetchone()

        if f_state["question_status"] == "ended":
            conn.close()
            return False, "Question is already ended."

        active_slot = f_state["active_team_slot"]
        team = QuizEngine.get_team_for_slot(conn, active_slot)
        if not team:
            conn.close()
            return False, "Active finalist team not found."

        comp = conn.execute("SELECT * FROM competition WHERE id = 1;").fetchone()
        max_duration = comp["final_main_timer_seconds"] if f_state["turn_type"] == "main" else comp["final_pass_timer_seconds"]
        now_ms = int(time.time() * 1000)
        if f_state["timer_started_at_ms"] and f_state["timer_started_at_ms"] > 0:
            elapsed_ms = max(200, min(max_duration * 1000, now_ms - f_state["timer_started_at_ms"]))
        else:
            elapsed_sec = max(0, max_duration - f_state["time_remaining_seconds"])
            elapsed_ms = max(200, elapsed_sec * 1000)
        time_taken_sec = round(elapsed_ms / 1000.0, 1)

        pass_hist = json.loads(f_state["pass_history_json"])
        pass_count = len(pass_hist)
        marks = QuizEngine.get_final_turn_marks(pass_count)
        new_score = team["final_score"] + marks
        new_time_ms = (team["final_time_ms"] or 0) + elapsed_ms

        # Update team score and cumulative response time
        conn.execute("UPDATE teams SET final_score = ?, final_time_ms = ? WHERE id = ?;", (new_score, new_time_ms, team["id"]))

        # Also persist into final_question_results (Locks question)
        q_id = f_state["current_question_id"]
        q_idx = f_state["question_index"]
        q_row = conn.execute("SELECT * FROM questions WHERE id = ?;", (q_id,)).fetchone()
        correct_idx = q_row["correct_index"] if q_row else 0
        if selected_option is None:
            selected_option = correct_idx

        # Record pass history with response time
        pass_hist.append({
            "slot": active_slot,
            "team_name": team["name"],
            "result": "correct",
            "marks": marks,
            "selected_option": selected_option,
            "time_taken_seconds": time_taken_sec
        })

        # End question
        conn.execute("""
        UPDATE final_round_state SET
            timer_is_running = 0,
            question_status = 'ended',
            winning_team_slot = ?,
            pass_history_json = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1;
        """, (active_slot, json.dumps(pass_hist)))

        # Also persist into final_question_results (Locks question)
        attempted_desc = " ➔ ".join([f"T{h['slot']} ({h['team_name']})" for h in pass_hist])

        conn.execute("""
        INSERT INTO final_question_results (
            question_id, question_index, status, winning_team_slot, winning_team_name,
            awarded_marks, selected_option, correct_index, attempted_by, pass_history_json, time_taken_seconds, updated_at
        ) VALUES (?, ?, 'ended', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(question_id) DO UPDATE SET
            status = 'ended',
            winning_team_slot = excluded.winning_team_slot,
            winning_team_name = excluded.winning_team_name,
            awarded_marks = excluded.awarded_marks,
            selected_option = excluded.selected_option,
            correct_index = excluded.correct_index,
            attempted_by = excluded.attempted_by,
            pass_history_json = excluded.pass_history_json,
            time_taken_seconds = excluded.time_taken_seconds,
            updated_at = CURRENT_TIMESTAMP;
        """, (q_id, q_idx, active_slot, team["name"], marks, selected_option, correct_idx, attempted_desc, json.dumps(pass_hist), time_taken_sec))

        # Score transaction
        turn_desc = "main turn" if pass_count == 0 else f"pass {pass_count}"
        conn.execute("""
        INSERT INTO score_transactions (team_id, round_type, delta_marks, resulting_score, reason)
        VALUES (?, 'final', ?, ?, ?);
        """, (team["id"], marks, new_score, f"Q{f_state['question_index']+1} correct answer ({turn_desc}, {marks} pts, {time_taken_sec}s)"))

        conn.execute("""
        INSERT INTO audit_events (event_type, details)
        VALUES ('FINAL_CORRECT', ?);
        """, (f"Team {team['name']} (T{active_slot}) awarded +{marks} for Q{f_state['question_index']+1} ({turn_desc}, {time_taken_sec}s)",))

        conn.commit()
        conn.close()
        return True, None

    @staticmethod
    def mark_final_incorrect(selected_option=None):
        """
        Adjudication: Incorrect Answer.
        Rule:
        - Main turn incorrect: pass to 1st passing team (5 seconds, 5 marks).
        - 1st pass incorrect: pass to 2nd passing team (5 seconds, 2 marks).
        - 2nd pass incorrect: only 2 passes allowed! Question ends immediately with 0 marks.
        """
        conn = get_db()
        f_state = conn.execute("SELECT * FROM final_round_state WHERE id = 1;").fetchone()
        comp = conn.execute("SELECT * FROM competition WHERE id = 1;").fetchone()

        if f_state["question_status"] == "ended":
            conn.close()
            return False, "Question is already ended."

        active_slot = f_state["active_team_slot"]
        first_slot = f_state["first_team_slot"]
        team = QuizEngine.get_team_for_slot(conn, active_slot)
        team_name = team["name"] if team else f"Team {active_slot}"

        max_duration = comp["final_main_timer_seconds"] if f_state["turn_type"] == "main" else comp["final_pass_timer_seconds"]
        now_ms = int(time.time() * 1000)
        if f_state["timer_started_at_ms"] and f_state["timer_started_at_ms"] > 0:
            elapsed_ms = max(200, min(max_duration * 1000, now_ms - f_state["timer_started_at_ms"]))
        else:
            elapsed_sec = max(0, max_duration - f_state["time_remaining_seconds"])
            elapsed_ms = max(200, elapsed_sec * 1000)
        time_taken_sec = round(elapsed_ms / 1000.0, 1)

        pass_hist = json.loads(f_state["pass_history_json"])
        entry = {"slot": active_slot, "team_name": team_name, "result": "incorrect", "marks": 0, "time_taken_seconds": time_taken_sec}
        if selected_option is not None:
            entry["selected_option"] = int(selected_option)
        pass_hist.append(entry)

        # Calculate passing sequence (only 2 passes allowed)
        max_passes = 2
        passing_order = QuizEngine.get_passing_order_for_slot(first_slot, 6)[:max_passes]

        attempted_slots = {item["slot"] for item in pass_hist}

        next_slot = None
        if len(pass_hist) <= max_passes:
            for slot in passing_order:
                if slot not in attempted_slots:
                    next_slot = slot
                    break

        if next_slot is not None:
            # Advance to next team in passing turn (5 seconds)
            pass_duration = comp["final_pass_timer_seconds"]
            now_ms = int(time.time() * 1000)

            conn.execute("""
            UPDATE final_round_state SET
                active_team_slot = ?,
                turn_type = 'pass',
                time_remaining_seconds = ?,
                timer_is_running = 1,
                timer_started_at_ms = ?,
                question_status = 'in_progress',
                pass_history_json = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1;
            """, (next_slot, pass_duration, now_ms, json.dumps(pass_hist)))

            conn.execute("""
            INSERT INTO audit_events (event_type, details)
            VALUES ('FINAL_INCORRECT_PASS', ?);
            """, (f"Team {team_name} (T{active_slot}) gave incorrect answer on Q{f_state['question_index']+1}. Passed to T{next_slot} (Pass {len(pass_hist)}/2, {pass_duration}s timer started).",))
        else:
            # Only 2 passes allowed: after 2nd pass answers incorrectly, question ends with 0 marks!
            conn.execute("""
            UPDATE final_round_state SET
                timer_is_running = 0,
                question_status = 'ended',
                winning_team_slot = NULL,
                pass_history_json = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1;
            """, (json.dumps(pass_hist),))

            # Also persist into final_question_results (Locks question)
            q_id = f_state["current_question_id"]
            q_idx = f_state["question_index"]
            q_row = conn.execute("SELECT * FROM questions WHERE id = ?;", (q_id,)).fetchone()
            correct_idx = q_row["correct_index"] if q_row else 0
            attempted_desc = " ➔ ".join([f"T{h['slot']} ({h['team_name']})" for h in pass_hist])

            conn.execute("""
            INSERT INTO final_question_results (
                question_id, question_index, status, winning_team_slot, winning_team_name,
                awarded_marks, selected_option, correct_index, attempted_by, pass_history_json, time_taken_seconds, updated_at
            ) VALUES (?, ?, 'ended', NULL, NULL, 0, ?, ?, ?, ?, 0.0, CURRENT_TIMESTAMP)
            ON CONFLICT(question_id) DO UPDATE SET
                status = 'ended',
                winning_team_slot = NULL,
                winning_team_name = NULL,
                awarded_marks = 0,
                selected_option = excluded.selected_option,
                correct_index = excluded.correct_index,
                attempted_by = excluded.attempted_by,
                pass_history_json = excluded.pass_history_json,
                time_taken_seconds = 0.0,
                updated_at = CURRENT_TIMESTAMP;
            """, (q_id, q_idx, selected_option, correct_idx, attempted_desc, json.dumps(pass_hist)))

            conn.execute("""
            INSERT INTO audit_events (event_type, details)
            VALUES ('FINAL_INCORRECT', ?);
            """, (f"Team {team_name} (T{active_slot}) gave incorrect answer on Q{f_state['question_index']+1}. Max passes (2) reached; question ended with 0 marks.",))

        conn.commit()
        conn.close()
        return True, None

    @staticmethod
    def handle_final_timeout_or_pass(start_timer=True):
        """
        Adjudication: Timeout or Pass.
        Rule:
        - Main turn timeout/pass: pass to 1st passing team (5 seconds, 5 marks).
        - 1st pass timeout/pass: pass to 2nd passing team (5 seconds, 2 marks).
        - 2nd pass timeout/pass: only 2 passes allowed! Question ends immediately with 0 marks.
        """
        conn = get_db()
        f_state = conn.execute("SELECT * FROM final_round_state WHERE id = 1;").fetchone()
        comp = conn.execute("SELECT * FROM competition WHERE id = 1;").fetchone()

        if f_state["question_status"] == "ended":
            conn.close()
            return False, "Question is already ended."

        active_slot = f_state["active_team_slot"]
        first_slot = f_state["first_team_slot"]
        team = QuizEngine.get_team_for_slot(conn, active_slot)
        team_name = team["name"] if team else f"Team {active_slot}"

        duration = comp["final_main_timer_seconds"] if f_state["turn_type"] == "main" else comp["final_pass_timer_seconds"]
        pass_hist = json.loads(f_state["pass_history_json"])
        pass_hist.append({"slot": active_slot, "team_name": team_name, "result": "timeout", "marks": 0, "time_taken_seconds": duration})

        # Calculate passing sequence (only 2 passes allowed)
        max_passes = 2
        passing_order = QuizEngine.get_passing_order_for_slot(first_slot, 6)[:max_passes]

        attempted_slots = {item["slot"] for item in pass_hist}

        next_slot = None
        # Only allow advancing if we haven't exceeded max_passes
        # len(pass_hist) == 1: main turn passed -> advance to pass 1
        # len(pass_hist) == 2: pass 1 passed -> advance to pass 2
        # len(pass_hist) >= 3: pass 2 passed -> limit reached! Question ends!
        if len(pass_hist) <= max_passes:
            for slot in passing_order:
                if slot not in attempted_slots:
                    next_slot = slot
                    break

        if next_slot is not None:
            # Advance to next team in passing turn (5 seconds)
            pass_duration = comp["final_pass_timer_seconds"]
            now_ms = int(time.time() * 1000)

            conn.execute("""
            UPDATE final_round_state SET
                active_team_slot = ?,
                turn_type = 'pass',
                time_remaining_seconds = ?,
                timer_is_running = ?,
                timer_started_at_ms = ?,
                question_status = 'in_progress',
                pass_history_json = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1;
            """, (next_slot, pass_duration, 1 if start_timer else 0, now_ms if start_timer else 0, json.dumps(pass_hist)))

            conn.execute("""
            INSERT INTO audit_events (event_type, details)
            VALUES ('FINAL_PASS', ?);
            """, (f"Q{f_state['question_index']+1} passed from T{active_slot} to T{next_slot} (Pass {len(pass_hist)}/2, 5s timer started).",))

        else:
            # Only 2 passes allowed: after 2nd pass times out/passes, question ends with 0 marks!
            conn.execute("""
            UPDATE final_round_state SET
                timer_is_running = 0,
                question_status = 'ended',
                winning_team_slot = NULL,
                pass_history_json = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1;
            """, (json.dumps(pass_hist),))

            # Also persist into final_question_results (Locks question)
            q_id = f_state["current_question_id"]
            q_idx = f_state["question_index"]
            q_row = conn.execute("SELECT * FROM questions WHERE id = ?;", (q_id,)).fetchone()
            correct_idx = q_row["correct_index"] if q_row else 0
            attempted_desc = " ➔ ".join([f"T{h['slot']} ({h['team_name']})" for h in pass_hist])

            conn.execute("""
            INSERT INTO final_question_results (
                question_id, question_index, status, winning_team_slot, winning_team_name,
                awarded_marks, selected_option, correct_index, attempted_by, pass_history_json, time_taken_seconds, updated_at
            ) VALUES (?, ?, 'ended', NULL, NULL, 0, NULL, ?, ?, ?, 0.0, CURRENT_TIMESTAMP)
            ON CONFLICT(question_id) DO UPDATE SET
                status = 'ended',
                winning_team_slot = NULL,
                winning_team_name = NULL,
                awarded_marks = 0,
                selected_option = NULL,
                correct_index = excluded.correct_index,
                attempted_by = excluded.attempted_by,
                pass_history_json = excluded.pass_history_json,
                time_taken_seconds = 0.0,
                updated_at = CURRENT_TIMESTAMP;
            """, (q_id, q_idx, correct_idx, attempted_desc, json.dumps(pass_hist)))

            conn.execute("""
            INSERT INTO audit_events (event_type, details)
            VALUES ('FINAL_TIMEOUT_ENDED', ?);
            """, (f"Q{f_state['question_index']+1} ended after exhausting allowed passes (max 2) with 0 marks.",))

        conn.commit()
        conn.close()
        return True, None

    @staticmethod
    def adjust_team_score(team_id: int, delta: int, reason: str):
        """Allows host to manually adjust any team's score with auditable tracking."""
        conn = get_db()
        team = conn.execute("SELECT * FROM teams WHERE id = ?;", (team_id,)).fetchone()
        if not team:
            conn.close()
            return False, "Team not found."

        new_final_score = max(0, team["final_score"] + delta)
        conn.execute("UPDATE teams SET final_score = ? WHERE id = ?;", (new_final_score, team_id))

        conn.execute("""
        INSERT INTO score_transactions (team_id, round_type, delta_marks, resulting_score, reason)
        VALUES (?, 'final', ?, ?, ?);
        """, (team_id, delta, new_final_score, f"Host Manual Adjustment: {reason}"))

        conn.execute("""
        INSERT INTO audit_events (event_type, details)
        VALUES ('SCORE_ADJUSTMENT', ?);
        """, (f"Manual score adjustment for {team['name']}: {delta:+d} points. Reason: {reason}",))

        conn.commit()
        conn.close()
        return True, None

    @staticmethod
    def reset_final_scores():
        """Resets all teams' Projector / Final Quiz scores and answer times to 0 and clears question lock history."""
        conn = get_db()
        conn.execute("UPDATE teams SET final_score = 0, final_time_ms = 0;")
        conn.execute("DELETE FROM score_transactions WHERE round_type = 'final';")
        conn.execute("DELETE FROM final_question_results;")
        conn.execute("""
        INSERT INTO audit_events (event_type, details)
        VALUES ('FINAL_SCORES_RESET', 'Host reset all Projector Quiz (Final Round) scores, answer times, and question locks.');
        """)
        conn.commit()
        conn.close()
        return QuizEngine.load_final_question(0)

    @staticmethod
    def unlock_final_question(question_index: int):
        """Allows host in Admin console to reopen/unlock an answered question if needed."""
        conn = get_db()
        questions = QuizEngine.get_final_questions(conn)
        if 0 <= question_index < len(questions):
            q_id = questions[question_index]["id"]
            res = conn.execute("SELECT * FROM final_question_results WHERE question_id = ? OR question_index = ?;", (q_id, question_index)).fetchone()
            if res and res["winning_team_slot"] and res["awarded_marks"]:
                w_slot = res["winning_team_slot"]
                w_marks = res["awarded_marks"]
                w_time_ms = int((res["time_taken_seconds"] or 0) * 1000)
                team = conn.execute("SELECT * FROM teams WHERE finalist_slot = ? AND is_finalist = 1;", (w_slot,)).fetchone()
                if team:
                    rev_score = max(0, team["final_score"] - w_marks)
                    rev_time = max(0, (team["final_time_ms"] or 0) - w_time_ms)
                    conn.execute("UPDATE teams SET final_score = ?, final_time_ms = ? WHERE id = ?;", (rev_score, rev_time, team["id"]))
            conn.execute("DELETE FROM final_question_results WHERE question_id = ? OR question_index = ?;", (q_id, question_index))
            conn.commit()
        conn.close()
        return QuizEngine.load_final_question(question_index)
