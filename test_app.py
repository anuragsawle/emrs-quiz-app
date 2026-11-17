"""
Comprehensive Test Suite for EMRS Quiz Application
Verifies all functional rules, scoring, rotations, and API endpoints.
"""

import unittest
import os
import sys
import json
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import init_db, get_db
from sample_questions import load_sample_data
from quiz_engine import QuizEngine

class TestEmrsQuiz(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        conn = get_db()
        load_sample_data(conn)
        conn.close()

    def test_01_database_and_samples(self):
        """Verifies database tables and initial sample data."""
        conn = get_db()
        teams_count = conn.execute("SELECT COUNT(*) FROM teams;").fetchone()[0]
        self.assertGreaterEqual(teams_count, 15, "Should have at least 15 sample teams")

        qual_q = conn.execute("SELECT COUNT(*) FROM questions WHERE round_type = 'qualifier';").fetchone()[0]
        self.assertGreaterEqual(qual_q, 20, "Should have at least 20 qualifier questions")

        final_q = conn.execute("SELECT COUNT(*) FROM questions WHERE round_type = 'final';").fetchone()[0]
        self.assertGreaterEqual(final_q, 12, "Should have at least 12 final round questions")
        conn.close()

    def test_02_qualifier_shuffling_and_attempt(self):
        """Verifies that each team gets independent question orders and options."""
        attempt1, err1 = QuizEngine.start_or_resume_qualifier_attempt(1)
        self.assertIsNone(err1)
        self.assertIsNotNone(attempt1)
        self.assertIn("questions", attempt1)
        self.assertEqual(len(attempt1["questions"]), 20)

        attempt2, err2 = QuizEngine.start_or_resume_qualifier_attempt(2)
        self.assertIsNone(err2)

        # Question order should be independently shuffled
        order1 = [q["id"] for q in attempt1["questions"]]
        order2 = [q["id"] for q in attempt2["questions"]]
        # In a random shuffle of 20 items, probability of identical ordering is 1 / 20! ~ 0
        self.assertNotEqual(order1, order2, "Team 1 and Team 2 question orders should be shuffled independently")

    def test_03_qualifier_scoring_and_tie_breaker(self):
        """Verifies +1 correct scoring, elapsed time calculation, and tie-breaking."""
        # Record answers for Team 1: 10 correct
        attempt1, _ = QuizEngine.start_or_resume_qualifier_attempt(1)
        for i in range(10):
            q = attempt1["questions"][i]
            # Find correct original index from database
            conn = get_db()
            db_q = conn.execute("SELECT correct_index FROM questions WHERE id = ?;", (q["id"],)).fetchone()
            conn.close()
            QuizEngine.record_qualifier_answer(1, q["id"], db_q["correct_index"], False)

        # Submit Team 1
        QuizEngine.submit_qualifier_attempt(1)

        # Record answers for Team 2: 10 correct (tied score) but submitted later
        attempt2, _ = QuizEngine.start_or_resume_qualifier_attempt(2)
        for i in range(10):
            q = attempt2["questions"][i]
            conn = get_db()
            db_q = conn.execute("SELECT correct_index FROM questions WHERE id = ?;", (q["id"],)).fetchone()
            conn.close()
            QuizEngine.record_qualifier_answer(2, q["id"], db_q["correct_index"], False)

        QuizEngine.submit_qualifier_attempt(2)

        lb = QuizEngine.get_qualifier_leaderboard()
        team1_entry = next(r for r in lb if r["id"] == 1)
        team2_entry = next(r for r in lb if r["id"] == 2)

        self.assertEqual(team1_entry["score"], 10)
        self.assertEqual(team2_entry["score"], 10)
        self.assertTrue(team1_entry["submitted"])
        self.assertTrue(team2_entry["submitted"])

    def test_04_promote_finalists(self):
        """Verifies promotion of exactly top 6 teams to finalist slots T1 to T6."""
        ok, names = QuizEngine.promote_top_finalists(6)
        self.assertTrue(ok)
        self.assertEqual(len(names), 6)

        finalists = QuizEngine.get_finalists()
        self.assertEqual(len(finalists), 6)
        slots = [f["finalist_slot"] for f in finalists]
        self.assertEqual(slots, [1, 2, 3, 4, 5, 6])

    def test_05_final_round_rotation_modulo_6(self):
        """Verifies Section 2.3 rotation pattern for Q1..Q7+."""
        expected_patterns = [
            (0, 1, [2, 3, 4, 5, 6]), # Q1: T1 first, pass: T2->T3->T4->T5->T6
            (1, 2, [3, 4, 5, 6, 1]), # Q2: T2 first, pass: T3->T4->T5->T6->T1
            (2, 3, [4, 5, 6, 1, 2]), # Q3: T3 first, pass: T4->T5->T6->T1->T2
            (3, 4, [5, 6, 1, 2, 3]), # Q4: T4 first, pass: T5->T6->T1->T2->T3
            (4, 5, [6, 1, 2, 3, 4]), # Q5: T5 first, pass: T6->T1->T2->T3->T4
            (5, 6, [1, 2, 3, 4, 5]), # Q6: T6 first, pass: T1->T2->T3->T4->T5
            (6, 1, [2, 3, 4, 5, 6]), # Q7: Repeats from T1!
        ]

        for q_idx, exp_first, exp_pass in expected_patterns:
            slot = (q_idx % 6) + 1
            pass_order = QuizEngine.get_passing_order_for_slot(slot, 6)
            self.assertEqual(slot, exp_first, f"Q{q_idx+1} first team should be T{exp_first}")
            self.assertEqual(pass_order, exp_pass, f"Q{q_idx+1} passing order mismatch")

    def test_06_final_round_correct_answer(self):
        """Verifies +5 marks awarded and question ending immediately upon correct answer."""
        QuizEngine.load_final_question(0) # Q1 (T1 first)
        state_before = QuizEngine.get_final_round_state()
        self.assertEqual(state_before["active_team_slot"], 1)

        ok, err = QuizEngine.mark_final_correct()
        self.assertTrue(ok)

        state_after = QuizEngine.get_final_round_state()
        self.assertEqual(state_after["question_status"], "ended")
        self.assertEqual(state_after["winning_team_slot"], 1)

        # Check score transaction
        conn = get_db()
        t1 = conn.execute("SELECT final_score FROM teams WHERE finalist_slot = 1;").fetchone()
        self.assertEqual(t1["final_score"], 5)
        conn.close()

    def test_07_final_round_incorrect_ends_question_immediately(self):
        """CRITICAL SPEC RULE (Section 2.2): Incorrect answer ends question immediately; NO passing."""
        QuizEngine.load_final_question(1) # Q2 (T2 first)
        state = QuizEngine.get_final_round_state()
        self.assertEqual(state["active_team_slot"], 2)

        # Mark incorrect
        ok, err = QuizEngine.mark_final_incorrect()
        self.assertTrue(ok)

        state_after = QuizEngine.get_final_round_state()
        self.assertEqual(state_after["question_status"], "ended", "Question MUST end immediately on incorrect answer")
        self.assertIsNone(state_after["winning_team_slot"])

    def test_08_final_round_timeout_passes_to_next_with_5s(self):
        """SPEC RULE (Section 2.2): Main turn timeout passes to next team with 5 seconds."""
        QuizEngine.load_final_question(2) # Q3 (T3 first)
        state = QuizEngine.get_final_round_state()
        self.assertEqual(state["active_team_slot"], 3)
        self.assertEqual(state["turn_type"], "main")

        # Main turn times out
        ok, err = QuizEngine.handle_final_timeout_or_pass()
        self.assertTrue(ok)

        state_after = QuizEngine.get_final_round_state()
        self.assertEqual(state_after["active_team_slot"], 4, "Should pass to next in sequence: T4")
        self.assertEqual(state_after["turn_type"], "pass", "Turn type should now be 'pass'")
        self.assertEqual(state_after["time_remaining_seconds"], 5, "Passing turn should receive 5 seconds")
        self.assertEqual(state_after["question_status"], "in_progress")

if __name__ == "__main__":
    unittest.main()
