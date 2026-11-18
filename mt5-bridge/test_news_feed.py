import unittest

from news_feed import classify_category, merge_news_items, parse_rss_items


SAMPLE_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Sample</title>
    <item>
      <title>Fed inflation surge sparks rate hike talk</title>
      <link>https://example.com/econ</link>
      <description>Markets watch CPI and FOMC.</description>
      <pubDate>Wed, 11 Nov 2026 07:00:00 GMT</pubDate>
    </item>
    <item>
      <title>President faces election showdown amid sanctions debate</title>
      <link>https://example.com/politics</link>
      <description>Geopolitical tensions rise.</description>
      <pubDate>Wed, 11 Nov 2026 06:30:00 GMT</pubDate>
    </item>
  </channel>
</rss>
"""


class NewsFeedTests(unittest.TestCase):
    def test_classify_category_detects_economic_and_political(self):
        self.assertEqual(classify_category("Fed inflation and CPI surprise"), "economic")
        self.assertEqual(classify_category("Election sanctions and parliament clash"), "political")
        self.assertEqual(classify_category("Gold and forex stocks rally"), "financial")

    def test_parse_rss_items_and_merge_duplicate_headlines(self):
        items = parse_rss_items(SAMPLE_RSS, "UnitTest")
        self.assertEqual(len(items), 2)
        self.assertTrue(items[0]["title"])
        self.assertIn(items[0]["category"], {"economic", "political", "financial"})
        self.assertEqual(len(merge_news_items([items, items], limit=10)), 2)

    def test_rejects_xml_entities_and_items_without_valid_dates(self):
        self.assertEqual(
            parse_rss_items("<!DOCTYPE rss [<!ENTITY x 'boom'>]><rss/>", "UnitTest"),
            [],
        )
        undated = """<rss><channel><item><title>Undated</title>
        <link>https://example.com/story</link></item></channel></rss>"""
        self.assertEqual(parse_rss_items(undated, "UnitTest"), [])

    def test_discards_non_http_article_links(self):
        xml_payload = SAMPLE_RSS.replace(
            "https://example.com/econ", "javascript:alert(1)"
        )
        items = parse_rss_items(xml_payload, "UnitTest")
        self.assertEqual(items[0]["url"], "")


if __name__ == "__main__":
    unittest.main()
