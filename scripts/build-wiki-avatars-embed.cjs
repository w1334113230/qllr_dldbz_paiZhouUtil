/**
 * 从 avatar/wiki_avatars.min.json 生成 paiZhouUtil/wiki_avatars.embed.js，
 * 供 file:// 打开页面时使用（浏览器禁止 fetch 本地其它文件）。
 * 更新 Wiki 数据后执行：npm run wiki-embed
 */
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");
var src = path.join(root, "avatar", "wiki_avatars.min.json");
var out = path.join(root, "paiZhouUtil", "wiki_avatars.embed.js");

var raw = fs.readFileSync(src, "utf8");
var data = JSON.parse(raw);
var body = "window.__PAIZHOU_WIKI_AVATARS__=" + JSON.stringify(data) + ";\n";
fs.writeFileSync(out, body, "utf8");
console.log("Wrote", out, "(" + Math.round(body.length / 1024) + " KB)");
