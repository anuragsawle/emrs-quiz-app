"""
EMRS Quiz Competition - Database Module
SQLite-based persistent storage with immediate write-through (WAL mode)
for high reliability and crash recovery in school LAN environments.
"""

import sqlite3
import json
import time
import os
from datetime import datetime

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "emrs_quiz.db")

def get_db():
    """Returns a SQLite connection with row factory and WAL mode enabled."""
    conn = sqlite3.connect(DB_FILE, timeout=10.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db():
    """Initializes all database tables, default settings, and sample data if empty."""
    conn = get_db()
    cursor = conn.cursor()

    # 1. Competition Configuration & State
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS competition (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'EMRS School Quiz Competition',
        stage TEXT NOT NULL DEFAULT 'setup', -- 'setup', 'qualifier_active', 'qualifier_completed', 'final_active', 'final_completed'
        qualifier_duration_seconds INTEGER NOT NULL DEFAULT 1200, -- 20 minutes
        qualifier_team_count INTEGER NOT NULL DEFAULT 15,
        final_team_count INTEGER NOT NULL DEFAULT 6,
        final_main_timer_seconds INTEGER NOT NULL DEFAULT 60,
        final_pass_timer_seconds INTEGER NOT NULL DEFAULT 5,
        final_correct_marks INTEGER NOT NULL DEFAULT 10,
        final_pass_1_marks INTEGER NOT NULL DEFAULT 5,
        final_pass_2_marks INTEGER NOT NULL DEFAULT 2,
        final_max_passes INTEGER NOT NULL DEFAULT 2,
        shuffle_options INTEGER NOT NULL DEFAULT 1,
        active_final_question_idx INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 2. Teams
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS teams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL, -- e.g. 'T01', 'T02'
        name TEXT NOT NULL,
        members TEXT DEFAULT '',
        pin TEXT NOT NULL DEFAULT '1234',
        assigned_station TEXT DEFAULT '', -- Lab PC identifier, e.g. 'PC-01'
        is_active INTEGER NOT NULL DEFAULT 1,
        qualifier_score INTEGER NOT NULL DEFAULT 0,
        qualifier_time_ms INTEGER NOT NULL DEFAULT 0,
        qualifier_submitted INTEGER NOT NULL DEFAULT 0,
        qualifier_submitted_at TIMESTAMP NULL,
        is_finalist INTEGER NOT NULL DEFAULT 0,
        finalist_slot INTEGER NULL, -- 1 to 6 (T1 to T6)
        final_score INTEGER NOT NULL DEFAULT 0,
        final_time_ms INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 3. Question Bank
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        round_type TEXT NOT NULL, -- 'qualifier'/'screening' or 'final'/'projector'
        question_number INTEGER NOT NULL DEFAULT 1,
        text TEXT NOT NULL,
        options_json TEXT NOT NULL, -- JSON list of 4 options: ["A", "B", "C", "D"]
        correct_index INTEGER NOT NULL DEFAULT 0, -- 0 to 3
        category TEXT DEFAULT 'General',
        explanation TEXT DEFAULT '',
        marks INTEGER NOT NULL DEFAULT 1,
        media_type TEXT NOT NULL DEFAULT 'none', -- 'none', 'image', 'audio'
        media_url TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Safe migration in case questions table exists
    try:
        cursor.execute("ALTER TABLE questions ADD COLUMN media_type TEXT NOT NULL DEFAULT 'none';")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE questions ADD COLUMN media_url TEXT NOT NULL DEFAULT '';")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE competition ADD COLUMN final_pass_1_marks INTEGER NOT NULL DEFAULT 5;")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE competition ADD COLUMN final_pass_2_marks INTEGER NOT NULL DEFAULT 2;")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE competition ADD COLUMN final_max_passes INTEGER NOT NULL DEFAULT 2;")
    except Exception:
        pass

    # 4. Qualifier Attempts (Team test sessions)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS qualifier_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id INTEGER UNIQUE NOT NULL,
        started_at_ts INTEGER NOT NULL,
        submitted_at_ts INTEGER NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        is_submitted INTEGER NOT NULL DEFAULT 0,
        tab_switch_count INTEGER NOT NULL DEFAULT 0,
        question_order_json TEXT NOT NULL, -- Ordered list of question IDs for this team
        option_orders_json TEXT NOT NULL, -- Map of {q_id: [shuffled indices]}
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    """)

    # Safe migration in case table already exists
    try:
        cursor.execute("ALTER TABLE qualifier_attempts ADD COLUMN tab_switch_count INTEGER NOT NULL DEFAULT 0;")
    except Exception:
        pass

    # 5. Qualifier Responses (Per-question answers)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS qualifier_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempt_id INTEGER NOT NULL,
        team_id INTEGER NOT NULL,
        question_id INTEGER NOT NULL,
        selected_option_index INTEGER NULL, -- The original option index (0-3) selected
        is_marked_review INTEGER NOT NULL DEFAULT 0,
        is_correct INTEGER NOT NULL DEFAULT 0,
        answered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (attempt_id, question_id),
        FOREIGN KEY (attempt_id) REFERENCES qualifier_attempts(id) ON DELETE CASCADE,
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    );
    """)

    # 6. Final Round Live State
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS final_round_state (
        id INTEGER PRIMARY KEY,
        current_question_id INTEGER NULL,
        question_index INTEGER NOT NULL DEFAULT 0, -- 0-based question number
        first_team_slot INTEGER NOT NULL DEFAULT 1, -- 1 to 6
        active_team_slot INTEGER NOT NULL DEFAULT 1, -- 1 to 6
        turn_type TEXT NOT NULL DEFAULT 'main', -- 'main' (60s) or 'pass' (5s)
        time_remaining_seconds INTEGER NOT NULL DEFAULT 60,
        timer_is_running INTEGER NOT NULL DEFAULT 0,
        timer_started_at_ms INTEGER NOT NULL DEFAULT 0,
        pass_history_json TEXT NOT NULL DEFAULT '[]', -- List of {slot, result: 'timeout'|'incorrect'|'correct'}
        question_status TEXT NOT NULL DEFAULT 'idle', -- 'idle', 'in_progress', 'paused', 'ended'
        is_question_visible INTEGER NOT NULL DEFAULT 0, -- 0 = hidden on projector, 1 = shown
        is_options_visible INTEGER NOT NULL DEFAULT 0, -- 0 = options hidden (audio/visual step 1), 1 = options shown
        winning_team_slot INTEGER NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Safe migration for is_question_visible & is_options_visible
    try:
        cursor.execute("ALTER TABLE final_round_state ADD COLUMN is_question_visible INTEGER NOT NULL DEFAULT 0;")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE final_round_state ADD COLUMN is_options_visible INTEGER NOT NULL DEFAULT 0;")
    except Exception:
        pass

    # 7. Score Transactions (Audit trail for scores)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS score_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id INTEGER NOT NULL,
        round_type TEXT NOT NULL, -- 'qualifier' or 'final'
        delta_marks INTEGER NOT NULL,
        resulting_score INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );
    """)

    # 8. Competition Audit Events
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        details TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 9. Persistent Question Results for Final Round (locks answered questions)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS final_question_results (
        question_id INTEGER PRIMARY KEY,
        question_index INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'ended',
        winning_team_slot INTEGER NULL,
        winning_team_name TEXT NULL,
        awarded_marks INTEGER NOT NULL DEFAULT 0,
        selected_option INTEGER NULL,
        correct_index INTEGER NOT NULL DEFAULT 0,
        attempted_by TEXT DEFAULT '',
        pass_history_json TEXT NOT NULL DEFAULT '[]',
        time_taken_seconds REAL DEFAULT 0.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Safe migration for final_time_ms in teams & time_taken_seconds in final_question_results
    try:
        cursor.execute("ALTER TABLE teams ADD COLUMN final_time_ms INTEGER NOT NULL DEFAULT 0;")
    except Exception:
        pass
    try:
        cursor.execute("ALTER TABLE final_question_results ADD COLUMN time_taken_seconds REAL DEFAULT 0.0;")
    except Exception:
        pass

    # Ensure competition row 1 exists
    cursor.execute("SELECT COUNT(*) FROM competition WHERE id = 1;")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO competition (id, title) VALUES (1, 'EMRS Inter-School Quiz Competition');")

    # Ensure final_round_state row 1 exists
    cursor.execute("SELECT COUNT(*) FROM final_round_state WHERE id = 1;")
    if cursor.fetchone()[0] == 0:
        cursor.execute("""
        INSERT INTO final_round_state (
            id, question_index, first_team_slot, active_team_slot, turn_type,
            time_remaining_seconds, timer_is_running, pass_history_json, question_status
        ) VALUES (1, 0, 1, 1, 'main', 60, 0, '[]', 'idle');
        """)

    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully at", DB_FILE)
