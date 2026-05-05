#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 biligame 歧路旅人大陆霸者 Wiki 各角色详情页提取 **国服中文「主动技能」** 名称列表。

页面结构（以 鸣·雷 为例）:
  - 角色页: https://wiki.biligame.com/octopathsp/ + URL 编码后的角色名
    与旅人图鉴中的 wikiPath 一致（见 avatar/wiki_avatars.json）。
  - 技能区分栏位于 `.y_tabbar`：一级 tab「中文」→ 二级 tab「主动技能」对应 DOM 容器为
    `div#chinese-active.content`，其 **直接子节点** `div.skillbox` 每条为一个技能卡片。
  - 技能中文名在卡片内的 `div.skillbox-name`。

解析策略:
  - 仅解析 `#chinese-active`，避免混入同页的被动 / 特殊 / 必杀 & EX（它们在 `#chinese-passive`
    等容器内）。
  - 使用「直接子级 skillbox」，避免误抓嵌套结构里的重复块。

依赖:
  python3 -m venv .venv
  .venv/bin/pip install requests beautifulsoup4

用法（仓库根目录）:
  .venv/bin/python scrape_wiki_active_skills.py
  .venv/bin/python scrape_wiki_active_skills.py --limit 5
  .venv/bin/python scrape_wiki_active_skills.py --only 鸣·雷
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("请先安装依赖: pip install requests beautifulsoup4", file=sys.stderr)
    sys.exit(1)

WIKI_ORIGIN = "https://wiki.biligame.com"
ROOT = Path(__file__).resolve().parent
AVATAR_JSON = ROOT / "avatar" / "wiki_avatars.json"
OUT_DIR = ROOT / "skills"
REQUEST_DELAY_SEC = 2.4
USER_AGENT = "paiZhouUtil-wiki-active-skills/1.0 (local; +https://github.com/w1334113230/qllr_dldbz_paiZhouUtil)"
# bilibili Wiki 批量请求可能返回 567（边缘拦截）；退避重试
RETRY_HTTP_STATUS = frozenset({403, 408, 429, 500, 502, 503, 504, 567})
FETCH_MAX_ATTEMPTS = 5


def norm_name(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def page_url_from_wiki_path(wiki_path: str) -> str:
    p = (wiki_path or "").strip()
    if not p:
        return ""
    if p.startswith("http://") or p.startswith("https://"):
        return p
    if not p.startswith("/"):
        p = "/" + p
    return WIKI_ORIGIN + p


def page_url_from_display_name(name: str) -> str:
    """无 wikiPath 时，用角色展示名按 Wiki 标题规则拼 URL（与「旅人图鉴」链接通常一致）。"""
    n = (name or "").strip()
    if not n:
        return ""
    # MediaWiki 子路径即标题的 URL 编码；空格在地址栏常显示为下划线，这里用 quote 不转义已足够
    return f"{WIKI_ORIGIN}/octopathsp/{quote(n, safe='')}"


def load_characters() -> List[Tuple[str, str, str]]:
    """
    返回 [(展示名, wiki页完整URL, wikiTitle), ...]
    优先读 avatar/wiki_avatars.json 的 list。
    """
    if not AVATAR_JSON.is_file():
        print(f"未找到 {AVATAR_JSON}，请先运行 scrape_wiki_avatars.py 或传入 --only。", file=sys.stderr)
        return []

    data = json.loads(AVATAR_JSON.read_text(encoding="utf-8"))
    lst = data.get("list") or []
    out: List[Tuple[str, str, str]] = []
    for row in lst:
        if not isinstance(row, dict):
            continue
        name = norm_name(str(row.get("name") or ""))
        path = str(row.get("wikiPath") or "").strip()
        title = norm_name(str(row.get("wikiTitle") or name))
        if not name:
            continue
        url = page_url_from_wiki_path(path) if path else page_url_from_display_name(name)
        if url:
            out.append((name, url, title))
    return out


def parse_zh_active_skill_names(html: str) -> Tuple[List[str], Optional[str]]:
    """
    从角色详情页 HTML 提取国服主动技能名称列表；若结构不符返回 ( [], 错误说明 )。
    """
    soup = BeautifulSoup(html, "html.parser")
    panel = soup.select_one("#chinese-active")
    if not panel:
        return [], "未找到 #chinese-active（页面可能无中文技能 Tab 或模板变更）"

    names: List[str] = []
    for box in panel.find_all("div", class_="skillbox", recursive=False):
        name_el = box.select_one(".skillbox-name")
        if not name_el:
            continue
        t = norm_name(name_el.get_text())
        if t:
            names.append(t)

    # 去重保序
    seen: set = set()
    uniq: List[str] = []
    for n in names:
        if n in seen:
            continue
        seen.add(n)
        uniq.append(n)

    if not uniq:
        return [], "#chinese-active 内无 .skillbox-name 文本"
    return uniq, None


def fetch(session: requests.Session, url: str) -> Tuple[int, str]:
    last_code = 0
    last_text = ""
    for attempt in range(FETCH_MAX_ATTEMPTS):
        r = session.get(url, timeout=120)
        enc = r.encoding
        if enc is None or enc.lower() == "iso-8859-1":
            r.encoding = r.apparent_encoding or "utf-8"
        last_code = r.status_code
        last_text = r.text or ""
        if last_code == 200:
            return last_code, last_text
        if last_code == 404:
            return last_code, last_text
        if last_code not in RETRY_HTTP_STATUS:
            return last_code, last_text
        if attempt < FETCH_MAX_ATTEMPTS - 1:
            wait = 2.0 * (2**attempt) + random.uniform(0.4, 2.2)
            time.sleep(wait)
    return last_code, last_text


def main() -> int:
    ap = argparse.ArgumentParser(description="爬取 Wiki 角色页国服主动技能名")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 个角色（调试用）")
    ap.add_argument("--only", type=str, default="", help="只处理指定展示名（须与 wiki_avatars 中 name 一致）")
    ap.add_argument("--dry-run", action="store_true", help="不写入文件，只打印解析结果（配合 --only）")
    args = ap.parse_args()

    chars = load_characters()
    if args.only.strip():
        target = norm_name(args.only)
        chars = [c for c in chars if c[0] == target or c[2] == target]
        if not chars:
            print(f"未在 wiki_avatars.json 中找到角色: {target!r}", file=sys.stderr)
            return 1
    if args.limit and args.limit > 0:
        chars = chars[: args.limit]

    if not chars:
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": "https://wiki.biligame.com/octopathsp/",
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        }
    )

    by_character: Dict[str, Any] = {}
    errors: List[Dict[str, str]] = []

    for display_name, url, wiki_title in chars:
        code, html = fetch(session, url)
        if code != 200:
            errors.append({"name": display_name, "url": url, "error": f"HTTP {code}"})
            by_character[display_name] = {"activeSkillsZh": [], "wikiUrl": url, "httpStatus": code}
            time.sleep(REQUEST_DELAY_SEC)
            continue

        skills, err = parse_zh_active_skill_names(html)
        entry = {
            "activeSkillsZh": skills,
            "wikiUrl": url,
            "wikiTitle": wiki_title,
            "count": len(skills),
        }
        if err:
            entry["parseWarning"] = err
            errors.append({"name": display_name, "url": url, "error": err})
        by_character[display_name] = entry

        if args.dry_run and args.only:
            print(json.dumps(entry, ensure_ascii=False, indent=2))

        time.sleep(REQUEST_DELAY_SEC)

    payload = {
        "schema": "octopathsp-wiki-active-skills-zh-1",
        "description": "各角色 Wiki 详情页 #chinese-active 内主动技能中文名（用于排轴工具检索）",
        "sourceAvatarIndex": str(AVATAR_JSON.relative_to(ROOT)),
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "characterCount": len(by_character),
        "byCharacter": by_character,
    }
    if errors:
        payload["warnings"] = errors

    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2)[:8000])
        return 0

    pretty = OUT_DIR / "wiki_active_skills_zh.json"
    mini = OUT_DIR / "wiki_active_skills_zh.min.json"
    pretty.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    mini.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 扁平：所有技能名去重（便于全局搜索索引）
    flat: List[str] = []
    seen_f: set = set()
    for _n, meta in by_character.items():
        arr = (meta or {}).get("activeSkillsZh") or []
        for s in arr:
            if s not in seen_f:
                seen_f.add(s)
                flat.append(s)
    (OUT_DIR / "wiki_active_skills_zh_flat.txt").write_text("\n".join(flat) + "\n", encoding="utf-8")

    print("写入:", pretty)
    print("角色数:", len(by_character), "扁平技能条数(去重):", len(flat))
    if errors:
        print("警告条数:", len(errors), "（见 JSON warnings）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
