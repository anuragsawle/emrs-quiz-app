"""
Direct Handler Unit Tests without TCP Sockets (Sandbox safe).
"""

import os
import sys
import unittest
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import init_db, get_db
from sample_questions import load_sample_data
from quiz_engine import QuizEngine

class TestDirectHandlers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        conn = get_db()
        load_sample_data(conn)
        conn.close()
        QuizEngine.load_final_question(0)

    def test_qualifier_leaderboard(self):
        lb = QuizEngine.get_qualifier_leaderboard()
        self.assertIsInstance(lb, list)
        self.assertGreaterEqual(len(lb), 15)

    def test_final_round_state(self):
        state = QuizEngine.get_final_round_state()
        self.assertIn("competition", state)
        self.assertIn("question", state)
        self.assertIn("finalists", state)
        self.assertEqual(state["question_index"], 0)

    def test_manual_score_adjust(self):
        ok, err = QuizEngine.adjust_team_score(1, 5, "Manual test adjustment")
        self.assertTrue(ok)
        conn = get_db()
        team = conn.execute("SELECT final_score FROM teams WHERE id = 1;").fetchone()
        self.assertGreaterEqual(team["final_score"], 5)
        conn.close()

if __name__ == "__main__":
    unittest.main()
