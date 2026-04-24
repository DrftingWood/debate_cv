"""Utilities for understanding and parsing Calicotab/Tabbycat private URL structures.

This module focuses on **structure discovery** so downstream scrapers can fetch and parse
Team/Speaker/Results/Break/Participants/Institutions pages in a repeatable way.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from html import unescape
from html.parser import HTMLParser
import re
from typing import Dict, List, Optional
from urllib.parse import urljoin, urlparse


@dataclass
class NavigationStructure:
    home: Optional[str] = None
    team_tab: Optional[str] = None
    speaker_tab: Optional[str] = None
    motions_tab: Optional[str] = None
    results_rounds: List[str] = field(default_factory=list)
    break_tabs: List[str] = field(default_factory=list)
    participants: Optional[str] = None
    institutions: Optional[str] = None


@dataclass
class RegistrationSnapshot:
    person_name: Optional[str] = None
    team_name: Optional[str] = None
    speakers: List[str] = field(default_factory=list)
    institution: Optional[str] = None


@dataclass
class PrivateUrlSnapshot:
    source_url: str
    tournament_name: Optional[str]
    navigation: NavigationStructure
    registration: RegistrationSnapshot


class _LinkExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: List[tuple[str, str]] = []
        self._current_href: Optional[str] = None
        self._text_chunks: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[tuple[str, Optional[str]]]) -> None:
        if tag.lower() != "a":
            return
        attr_map = {k: v for k, v in attrs}
        self._current_href = attr_map.get("href")
        self._text_chunks = []

    def handle_data(self, data: str) -> None:
        if self._current_href is not None:
            self._text_chunks.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or self._current_href is None:
            return
        label = " ".join("".join(self._text_chunks).split())
        self.links.append((label, self._current_href))
        self._current_href = None
        self._text_chunks = []


def _extract_title(html: str) -> Optional[str]:
    match = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    raw = unescape(match.group(1))
    return " ".join(raw.split())


def _extract_tournament_name(title: Optional[str]) -> Optional[str]:
    if not title:
        return None
    if "|" in title:
        return title.split("|", 1)[0].strip()
    return title.strip()


def _extract_registration(html: str) -> RegistrationSnapshot:
    snapshot = RegistrationSnapshot()

    # Private URL for Name (Team)
    match = re.search(r"Private URL\s+for\s+([^<(]+?)\s*\(([^)]+)\)", html, re.IGNORECASE)
    if match:
        snapshot.person_name = " ".join(match.group(1).split())
        snapshot.team_name = " ".join(match.group(2).split())

    # Team name: X
    team_match = re.search(r"Team name:\s*([^<\n\r]+)", html, re.IGNORECASE)
    if team_match:
        snapshot.team_name = " ".join(team_match.group(1).split())

    # Speakers: A, B
    speakers_match = re.search(r"Speakers:\s*([^<\n\r]+)", html, re.IGNORECASE)
    if speakers_match:
        raw = speakers_match.group(1)
        snapshot.speakers = [" ".join(x.split()) for x in raw.split(",") if x.strip()]

    # Institution: X
    institution_match = re.search(r"Institution:\s*([^<\n\r]+)", html, re.IGNORECASE)
    if institution_match:
        snapshot.institution = " ".join(institution_match.group(1).split())

    return snapshot


def extract_navigation_structure(html: str, source_url: str) -> NavigationStructure:
    extractor = _LinkExtractor()
    extractor.feed(html)

    base = _base_tournament_url(source_url)
    nav = NavigationStructure()

    for label, href in extractor.links:
        absolute = urljoin(base, href)
        lower = label.lower()

        if lower == "site home":
            nav.home = absolute
        elif lower == "team tab":
            nav.team_tab = absolute
        elif lower == "speaker tab":
            nav.speaker_tab = absolute
        elif lower == "motions tab":
            nav.motions_tab = absolute
        elif lower.startswith("round ") or "final" in lower:
            nav.results_rounds.append(absolute)
        elif lower in {"open", "adjudicators"}:
            nav.break_tabs.append(absolute)
        elif lower == "participants":
            nav.participants = absolute
        elif lower == "institutions":
            nav.institutions = absolute

    nav.results_rounds = sorted(set(nav.results_rounds))
    nav.break_tabs = sorted(set(nav.break_tabs))
    return nav


def parse_private_url_page(html: str, source_url: str) -> PrivateUrlSnapshot:
    title = _extract_title(html)
    tournament_name = _extract_tournament_name(title)
    navigation = extract_navigation_structure(html, source_url)
    registration = _extract_registration(html)

    return PrivateUrlSnapshot(
        source_url=source_url,
        tournament_name=tournament_name,
        navigation=navigation,
        registration=registration,
    )


def _base_tournament_url(source_url: str) -> str:
    parsed = urlparse(source_url)
    parts = [p for p in parsed.path.split("/") if p]
    if not parts:
        return f"{parsed.scheme}://{parsed.netloc}/"
    # Example: /ilnurr2026/privateurls/abc/ -> keep first segment /ilnurr2026/
    tournament_slug = parts[0]
    return f"{parsed.scheme}://{parsed.netloc}/{tournament_slug}/"
