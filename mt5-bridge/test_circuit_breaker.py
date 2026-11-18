import unittest
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

class TestCircuitBreakerState(unittest.TestCase):
    def setUp(self):
        with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as temp_db:
            self.db_path = Path(temp_db.name)
        with closing(sqlite3.connect(self.db_path)) as conn, conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS control_state (
                    state_key TEXT PRIMARY KEY,
                    state_value TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "INSERT OR IGNORE INTO control_state (state_key, state_value) VALUES ('circuit_breaker_enabled', 'true')"
            )

    def tearDown(self):
        self.db_path.unlink()

    def test_default_circuit_breaker_enabled(self):
        with closing(sqlite3.connect(self.db_path)) as conn, conn:
            row = conn.execute(
                "SELECT state_value FROM control_state WHERE state_key = 'circuit_breaker_enabled'"
            ).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row[0], "true")

    def test_toggle_circuit_breaker_disabled_and_enabled(self):
        # 1. Disable
        with closing(sqlite3.connect(self.db_path)) as conn, conn:
            conn.execute(
                "INSERT OR REPLACE INTO control_state (state_key, state_value) VALUES ('circuit_breaker_enabled', 'false')"
            )
            val = conn.execute(
                "SELECT state_value FROM control_state WHERE state_key = 'circuit_breaker_enabled'"
            ).fetchone()[0]
            self.assertEqual(val, "false")

        # 2. Re-enable
        with closing(sqlite3.connect(self.db_path)) as conn, conn:
            conn.execute(
                "INSERT OR REPLACE INTO control_state (state_key, state_value) VALUES ('circuit_breaker_enabled', 'true')"
            )
            val = conn.execute(
                "SELECT state_value FROM control_state WHERE state_key = 'circuit_breaker_enabled'"
            ).fetchone()[0]
            self.assertEqual(val, "true")


if __name__ == "__main__":
    unittest.main()
