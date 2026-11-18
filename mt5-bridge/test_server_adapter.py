import importlib
import gc
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from types import SimpleNamespace


class FakeMT5Adapter:
    def __init__(self):
        self.calls = []

    def symbol_info(self, symbol):
        self.calls.append(("symbol_info", symbol))
        return SimpleNamespace(trade_mode=4)


class TestServerTestDependencies(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_directory = tempfile.TemporaryDirectory()
        cls.original_localappdata = os.environ.get("LOCALAPPDATA")
        cls.original_database = os.environ.get("MT5_BRIDGE_STATE_DATABASE")
        os.environ["LOCALAPPDATA"] = cls.temp_directory.name
        os.environ["MT5_BRIDGE_STATE_DATABASE"] = os.path.join(
            cls.temp_directory.name, "test-state.sqlite3"
        )
        cls.server = importlib.import_module("server")
        cls.original_adapter = cls.server.mt5

    @classmethod
    def tearDownClass(cls):
        cls.server.configure_mt5_adapter(cls.original_adapter)
        if cls.original_localappdata is None:
            os.environ.pop("LOCALAPPDATA", None)
        else:
            os.environ["LOCALAPPDATA"] = cls.original_localappdata
        if cls.original_database is None:
            os.environ.pop("MT5_BRIDGE_STATE_DATABASE", None)
        else:
            os.environ["MT5_BRIDGE_STATE_DATABASE"] = cls.original_database
        gc.collect()
        cls.temp_directory.cleanup()

    def test_fake_adapter_is_used_for_broker_calls(self):
        adapter = FakeMT5Adapter()
        self.server.configure_mt5_adapter(adapter)

        self.assertEqual(self.server.resolve_broker_symbol("XAUUSD"), "XAUUSD")
        self.assertEqual(adapter.calls, [("symbol_info", "XAUUSD")])

    def test_server_state_database_is_initialized_in_temporary_directory(self):
        self.assertTrue(self.server.STATE_DATABASE.is_relative_to(self.temp_directory.name))
        with closing(sqlite3.connect(self.server.STATE_DATABASE)) as connection, connection:
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }

        self.assertIn("order_requests", tables)
        self.assertIn("control_state", tables)


if __name__ == "__main__":
    unittest.main()
