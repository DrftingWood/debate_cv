import unittest

from src.calicotab_parser import parse_private_url_page


SAMPLE_PRIVATE_HTML = """
<html>
  <head><title>ILNU RR 2026 | Private URL</title></head>
  <body>
    <a href="/ilnurr2026/">Site Home</a>
    <a href="/ilnurr2026/tab/team/">Team Tab</a>
    <a href="/ilnurr2026/tab/speaker/">Speaker Tab</a>
    <a href="/ilnurr2026/tab/motions/">Motions Tab</a>
    <a href="/ilnurr2026/results/round/1/">Round 1</a>
    <a href="/ilnurr2026/results/round/2/">Round 2</a>
    <a href="/ilnurr2026/results/round/6/">Grand Final</a>
    <a href="/ilnurr2026/break/teams/open/">Open</a>
    <a href="/ilnurr2026/break/adjudicators/">Adjudicators</a>
    <a href="/ilnurr2026/participants/list/">Participants</a>
    <a href="/ilnurr2026/participants/institutions/">Institutions</a>

    <p>Private URL for Abhishek Acharya (Viral Adidas Jacket Owners)</p>
    <p>Team name: Viral Adidas Jacket Owners</p>
    <p>Speakers: Shishir Jha, Abhishek Acharya</p>
    <p>Institution: Indira Gandhi National Open University</p>
  </body>
</html>
"""


class ParsePrivateUrlPageTests(unittest.TestCase):
    def test_parses_navigation_and_registration(self):
        snapshot = parse_private_url_page(
            SAMPLE_PRIVATE_HTML,
            "https://ilnuroundrobin.calicotab.com/ilnurr2026/privateurls/rbo1rd0g/",
        )

        self.assertEqual(snapshot.tournament_name, "ILNU RR 2026")
        self.assertEqual(snapshot.registration.person_name, "Abhishek Acharya")
        self.assertEqual(snapshot.registration.team_name, "Viral Adidas Jacket Owners")
        self.assertEqual(
            snapshot.registration.speakers,
            ["Shishir Jha", "Abhishek Acharya"],
        )
        self.assertEqual(
            snapshot.registration.institution,
            "Indira Gandhi National Open University",
        )

        self.assertEqual(
            snapshot.navigation.team_tab,
            "https://ilnuroundrobin.calicotab.com/ilnurr2026/tab/team/",
        )
        self.assertIn(
            "https://ilnuroundrobin.calicotab.com/ilnurr2026/results/round/1/",
            snapshot.navigation.results_rounds,
        )
        self.assertIn(
            "https://ilnuroundrobin.calicotab.com/ilnurr2026/break/adjudicators/",
            snapshot.navigation.break_tabs,
        )


if __name__ == "__main__":
    unittest.main()
