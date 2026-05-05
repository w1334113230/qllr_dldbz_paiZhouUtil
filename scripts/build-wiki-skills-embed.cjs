/**
 * 从 skills/wiki_active_skills_zh.min.json 生成 paiZhouUtil/wiki_active_skills_zh.embed.js，
 * 供 file:// 打开页面时使用（与 wiki_avatars.embed.js 同理）。
 * 更新数据后：npm run wiki-skills-embed
 */
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");
var src = path.join(root, "skills", "wiki_active_skills_zh.min.json");
var out = path.join(root, "paiZhouUtil", "wiki_active_skills_zh.embed.js");

if (!fs.existsSync(src)) {
  console.error("Missing:", src);
  console.error("Run: .venv/bin/python scrape_wiki_active_skills.py");
  process.exit(1);
}

var raw = fs.readFileSync(src, "utf8");
var data = JSON.parse(raw);
var body = "window.__PAIZHOU_WIKI_ACTIVE_SKILLS_ZH__=" + JSON.stringify(data) + ";\n";
fs.writeFileSync(out, body, "utf8");
console.log("Wrote", out, "(" + Math.round(body.length / 1024) + " KB)");
