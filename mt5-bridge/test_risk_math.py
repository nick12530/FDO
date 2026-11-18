import unittest

from risk_math import has_consecutive_losses_today, is_valid_close_volume, stop_risk, volume_for_risk


class RiskMathTests(unittest.TestCase):
    def test_consecutive_loss_breaker_ignores_losses_from_prior_utc_days(self) -> None:
        losses = [
            {"closedAt": "2026-11-17T23:59:00+00:00", "profit": -1},
            {"closedAt": "2026-11-18T00:01:00+00:00", "profit": -1},
            {"closedAt": "2026-11-18T00:02:00+00:00", "profit": -1},
        ]

        self.assertFalse(has_consecutive_losses_today(losses, 3, "2026-11-18"))
        losses.insert(0, {"closedAt": "2026-11-18T00:00:00+00:00", "profit": -1})
        self.assertTrue(has_consecutive_losses_today(losses, 3, "2026-11-18"))

    def test_stop_risk_counts_only_adverse_distance(self) -> None:
        self.assertEqual(stop_risk("BUY", 0.1, 100, 90, 1, 2), 2.0)
        self.assertEqual(stop_risk("SELL", 0.1, 100, 110, 1, 2), 2.0)
        self.assertEqual(stop_risk("BUY", 0.1, 100, 105, 1, 2), 0.0)

    def test_invalid_or_missing_stop_data_is_unknown(self) -> None:
        self.assertIsNone(stop_risk("BUY", 0.1, 100, 0, 1, 2))
        self.assertIsNone(stop_risk("HOLD", 0.1, 100, 90, 1, 2))

    def test_minimum_volume_never_exceeds_risk_budget(self) -> None:
        self.assertIsNone(volume_for_risk(0.1, 20, 0.01, 0.01, 1))
        self.assertEqual(volume_for_risk(1, 20, 0.01, 0.01, 1), 0.05)
        # Adaptive micro-floor permits 0.01 if dollar risk <= $15
        self.assertEqual(volume_for_risk(0.1, 20, 0.01, 0.01, 1, allow_micro_floor=True), 0.01)

    def test_volume_rounds_down_to_step_and_caps_at_broker_max(self) -> None:
        self.assertEqual(volume_for_risk(0.97, 10, 0.01, 0.01, 1), 0.09)
        self.assertEqual(volume_for_risk(100, 1, 0.01, 0.01, 2), 2)

    def test_partial_close_requires_valid_step_and_minimum_remaining_volume(self) -> None:
        self.assertTrue(is_valid_close_volume(0.05, 0.10, 0.01, 0.01))
        self.assertFalse(is_valid_close_volume(0.055, 0.10, 0.01, 0.01))
        self.assertTrue(is_valid_close_volume(0.08, 0.10, 0.02, 0.01))
        self.assertFalse(is_valid_close_volume(0.09, 0.10, 0.02, 0.01))
        self.assertFalse(is_valid_close_volume(0.11, 0.10, 0.01, 0.01))
        self.assertFalse(is_valid_close_volume(float("nan"), 0.10, 0.01, 0.01))


if __name__ == "__main__":
    unittest.main()
