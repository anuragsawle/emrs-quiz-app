"""
HTTP Integration & API Test Suite for EMRS Quiz Tornado Server.
"""

import os
import sys
import json
import tornado.testing
from tornado.httpclient import HTTPRequest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from server import make_app
from database import init_db, get_db
from sample_questions import load_sample_data

class TestServerEndpoints(tornado.testing.AsyncHTTPTestCase):
    def get_app(self):
        init_db()
        conn = get_db()
        load_sample_data(conn)
        conn.close()
        return make_app()

    def test_pages_render(self):
        """Verifies that all three core HTML views render successfully."""
        # 1. Student / Participant page
        resp = self.fetch("/")
        self.assertEqual(resp.code, 200)
        self.assertIn(b"EMRS QUIZ COMPETITION", resp.body)

        # 2. Host Admin Console
        resp_admin = self.fetch("/admin")
        self.assertEqual(resp_admin.code, 200)
        self.assertIn(b"EMRS QUIZ MASTER CONSOLE", resp_admin.body)

        # 3. Projector View
        resp_proj = self.fetch("/projector")
        self.assertEqual(resp_proj.code, 200)
        self.assertIn(b"AUDITORIUM DISPLAY", resp_proj.body)

    def test_auth_login_api(self):
        """Verifies team login validation with code and PIN."""
        # Valid login for T01 (PIN: 1001)
        payload = json.dumps({"code": "T01", "pin": "1001"})
        resp = self.fetch("/api/auth/login", method="POST", body=payload, headers={"Content-Type": "application/json"})
        self.assertEqual(resp.code, 200)
        data = json.loads(resp.body.decode())
        self.assertTrue(data["success"])
        self.assertEqual(data["team"]["code"], "T01")

        # Invalid login
        bad_payload = json.dumps({"code": "T01", "pin": "9999"})
        resp_bad = self.fetch("/api/auth/login", method="POST", body=bad_payload, headers={"Content-Type": "application/json"})
        self.assertEqual(resp_bad.code, 401)

    def test_admin_apis(self):
        """Verifies admin APIs for questions, leaderboard, and final round state."""
        # Leaderboard
        resp_lb = self.fetch("/api/admin/qualifier/leaderboard")
        self.assertEqual(resp_lb.code, 200)
        data_lb = json.loads(resp_lb.body.decode())
        self.assertIn("leaderboard", data_lb)
        self.assertGreaterEqual(len(data_lb["leaderboard"]), 15)

        # Final Round State
        resp_fs = self.fetch("/api/admin/final/state")
        self.assertEqual(resp_fs.code, 200)
        data_fs = json.loads(resp_fs.body.decode())
        self.assertIn("state", data_fs)
        self.assertEqual(data_fs["state"]["first_team_slot"], 1)

        # Questions API
        resp_q = self.fetch("/api/admin/questions?round_type=final")
        self.assertEqual(resp_q.code, 200)
        data_q = json.loads(resp_q.body.decode())
        self.assertGreaterEqual(len(data_q["questions"]), 12)

        # Reports CSV API
        resp_csv = self.fetch("/api/admin/reports/qualifier")
        self.assertEqual(resp_csv.code, 200)
        self.assertEqual(resp_csv.headers.get("Content-Type"), "text/csv")
        self.assertIn(b"Rank,Team Code,Team Name", resp_csv.body)

if __name__ == "__main__":
    import unittest
    unittest.main()
