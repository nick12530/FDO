import unittest

from symbol_resolution import select_broker_symbol, symbol_allows_open


class TestBrokerSymbolResolution(unittest.TestCase):
    def test_prefers_enabled_valetax_suffix_over_disabled_exact_symbol(self):
        selected = select_broker_symbol(
            "EURUSD",
            [
                ("EURUSD", 0, True),
                ("EURUSD.raw", 4, True),
                ("EURUSD.std", 4, False),
            ],
        )
        self.assertEqual(selected, "EURUSD.raw")

    def test_resolves_symbol_for_requested_direction(self):
        candidates = [
            ("GBPUSD.long", 1, True),
            ("GBPUSD.short", 2, True),
        ]
        self.assertEqual(select_broker_symbol("GBPUSD", candidates, "BUY"), "GBPUSD.long")
        self.assertEqual(select_broker_symbol("GBPUSD", candidates, "SELL"), "GBPUSD.short")
        self.assertIsNone(select_broker_symbol("GBPUSD", [("GBPUSD.short", 2, True)], "BUY"))

    def test_accepts_gold_alias_and_rejects_close_only_mode(self):
        self.assertEqual(select_broker_symbol("XAUUSD", [("GOLD.raw", 4, True)]), "GOLD.raw")
        self.assertFalse(symbol_allows_open(3))


if __name__ == "__main__":
    unittest.main()
