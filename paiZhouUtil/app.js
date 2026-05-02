(function () {
  var STORAGE_KEY = "paiZhouUtilData.v1";
  var SKILL_TYPE_CLASS = {
    active: "turn-box--battle",
    ex: "turn-box--ex",
    ult: "turn-box--ult",
  };
  var CAP_EFFECT_TARGET = {
    atkCap: "atk",
    defCap: "def",
    dmgCap: "dmg",
    resCap: "res",
  };

  var state = {
    roster: [{}, {}, {}, {}, {}, {}, {}, {}],
    selected: { idx: 0, turn: 1, mode: "turn" },
    turnFilter: null,
    modalAvatarData: "",
    cellCaps: {},
    capEditorCellId: "",
    draggingIdx: null,
    turnDragging: null,
    preventTurnClick: false,
    teamName: "",
    teamNote: "",
    turnCount: 5,
    turnFormView: "simple",
  };

  function sanitizeFileName(input) {
    var str = String(input || "").trim();
    // 替换 Windows/macOS 下常见非法文件名字符
    str = str.replace(/[\/\\:*?"<>|]/g, "_");
    // 避免过长
    str = str.slice(0, 50);
    return str || "pai-zhou-data";
  }

  /** 与 index.html 同目录下的 vendor/*.bundle.js（无外网可用；缺失时在仓库根执行 npm run vendor） */
  var vendorScriptPromises = {};
  function loadVendorScriptOnce(src, id, globalCheck) {
    var key = id || src;
    if (vendorScriptPromises[key]) return vendorScriptPromises[key];
    vendorScriptPromises[key] = new Promise(function (resolve, reject) {
      if (typeof globalCheck === "function" && globalCheck()) {
        resolve();
        return;
      }
      var s = document.createElement("script");
      if (id) s.id = id;
      s.async = true;
      s.src = src;
      s.onload = function () {
        if (typeof globalCheck === "function" && !globalCheck()) {
          reject(new Error("脚本已加载但未注册全局：" + src));
          return;
        }
        resolve();
      };
      s.onerror = function () {
        reject(new Error("无法加载本地脚本：" + src));
      };
      document.head.appendChild(s);
    }).catch(function (err) {
      delete vendorScriptPromises[key];
      return Promise.reject(err);
    });
    return vendorScriptPromises[key];
  }

  var qrcodeToDataURLPromise = null;
  function loadQrCodeToDataURL() {
    if (!qrcodeToDataURLPromise) {
      qrcodeToDataURLPromise = loadVendorScriptOnce("vendor/qrcode.bundle.js", "vendor-qrcode", function () {
        return typeof window.__qrcodeToDataURL === "function";
      })
        .then(function () {
          if (typeof window.__qrcodeToDataURL !== "function") throw new Error("qrcode vendor");
          return window.__qrcodeToDataURL;
        })
        .catch(function (e) {
          qrcodeToDataURLPromise = null;
          return Promise.reject(e);
        });
    }
    return qrcodeToDataURLPromise;
  }

  var jsQrPromise = null;
  function loadJsQrOnce() {
    if (!jsQrPromise) {
      jsQrPromise = loadVendorScriptOnce("vendor/jsqr.bundle.js", "vendor-jsqr", function () {
        return typeof window.__jsQR === "function";
      })
        .then(function () {
          if (typeof window.__jsQR !== "function") throw new Error("jsQR vendor");
          return window.__jsQR;
        })
        .catch(function (e) {
          jsQrPromise = null;
          return Promise.reject(e);
        });
    }
    return jsQrPromise;
  }

  function loadImageFromFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !file.type || file.type.indexOf("image/") !== 0) {
        reject(new Error("请选择图片文件"));
        return;
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("图片无法加载"));
      };
      img.src = url;
    });
  }

  /** 从二维码截图解析出图中编码的字符串（多为完整分享 URL） */
  async function decodeQrFromImageFile(file) {
    var jsQR = await loadJsQrOnce();
    var img = await loadImageFromFile(file);
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (w < 8 || h < 8) throw new Error("图片尺寸过小");

    var scales = [1, 2, 2.5, 3, 0.65, 0.5];
    var maxEdge = 1400;
    for (var si = 0; si < scales.length; si += 1) {
      var sw = Math.max(32, Math.round(w * scales[si]));
      var sh = Math.max(32, Math.round(h * scales[si]));
      if (sw > maxEdge || sh > maxEdge) {
        var r = Math.min(maxEdge / sw, maxEdge / sh);
        sw = Math.max(32, Math.round(sw * r));
        sh = Math.max(32, Math.round(sh * r));
      }
      var canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      var ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建画布");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, sw, sh);
      var imageData = ctx.getImageData(0, 0, sw, sh);
      var code = jsQR(imageData.data, sw, sh, { inversionAttempts: "attemptBoth" });
      if (code && code.data) return String(code.data).trim();
    }
    throw new Error("未在图中识别到二维码");
  }

  function utf8ToBytes(str) {
    return new TextEncoder().encode(String(str || ""));
  }

  function bytesToBase64Url(bytes) {
    var bin = "";
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    var b64 = btoa(bin);
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlToBytes(b64url) {
    var b64 = String(b64url || "").replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function gzipBytes(bytes) {
    if (!window.CompressionStream) return null;
    var stream = new CompressionStream("gzip");
    var writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();
    var buf = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function gunzipBytes(bytes) {
    if (!window.DecompressionStream) return null;
    var stream = new DecompressionStream("gzip");
    var writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();
    var buf = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(buf);
  }

  function buildSharePayloadV2() {
    var rosterOut = new Array(8).fill(null);
    for (var i = 0; i < 8; i += 1) {
      var ch = state.roster[i] || {};
      var minimal = null;

      var hasName = !!(ch.charName && String(ch.charName).trim());
      var hasNote = !!(ch.charNote && String(ch.charNote).trim());
      var gear = ch.gear || {};
      var gearKeys = Object.keys(gear);
      var hasGear = gearKeys.some(function (k) {
        return !!(gear[k] && String(gear[k]).trim());
      });
      var hasPassive = !!ch.passiveSkill;
      var hasTurns = false;
      if (ch.turns && typeof ch.turns === "object") {
        hasTurns = Object.keys(ch.turns).some(function (tk) {
          return !!ch.turns[tk];
        });
      }

      if (!hasName && !hasNote && !hasGear && !hasPassive && !hasTurns) {
        rosterOut[i] = null;
        continue;
      }

      minimal = {};
      if (hasName) minimal.n = String(ch.charName).trim();
      if (hasNote) minimal.o = String(ch.charNote).trim();

      if (hasGear) {
        var g = {};
        if (gear.weapon && String(gear.weapon).trim()) g.w = String(gear.weapon).trim();
        if (gear.helmet && String(gear.helmet).trim()) g.h = String(gear.helmet).trim();
        if (gear.armor && String(gear.armor).trim()) g.a = String(gear.armor).trim();
        if (gear.acc1 && String(gear.acc1).trim()) g.a1 = String(gear.acc1).trim();
        if (gear.acc2 && String(gear.acc2).trim()) g.a2 = String(gear.acc2).trim();
        if (gear.acc3 && String(gear.acc3).trim()) g.a3 = String(gear.acc3).trim();
        if (gear.skill1 && String(gear.skill1).trim()) g.s1 = String(gear.skill1).trim();
        if (gear.skill2 && String(gear.skill2).trim()) g.s2 = String(gear.skill2).trim();
        if (gear.skill3 && String(gear.skill3).trim()) g.s3 = String(gear.skill3).trim();
        if (gear.skill4 && String(gear.skill4).trim()) g.s4 = String(gear.skill4).trim();
        if (Object.keys(g).length) minimal.g = g;
      }

      function packSkill(sk, isPassive) {
        if (!sk) return null;
        var out = {};
        var sn = typeof sk.skillName === "string" ? sk.skillName : "";
        if (!isPassive && sn) out.sn = sn;
        if (!isPassive && sk.skillType) out.st = sk.skillType;

        if (!isPassive) {
          if (sk.bp) out.bp = Number(sk.bp || 0);
          if (sk.shieldBreak) out.sb = Number(sk.shieldBreak || 0);
        }

        if (sk.summonName && String(sk.summonName).trim()) out.sum = String(sk.summonName).trim();
        if (sk.summonEnabled) out.se = true;
        if (sk.summonBp) out.sbp = Number(sk.summonBp || 0);
        if (sk.summonBreak) out.sbr = Number(sk.summonBreak || 0);

        if (sk.gutsEnabled) out.ge = true;
        if (sk.stateSwitchEnabled) out.ss = true;
        if (sk.chaseEnabled) out.ce = true;
        if (sk.chaseBreak) out.cbr = Number(sk.chaseBreak || 0);

        if (sk.power) out.p = Number(sk.power || 0);
        if (sk.upper) out.u = Number(sk.upper || 0);
        if (sk.bean) out.b = Number(sk.bean || 0);
        if (sk.ultGauge) out.ug = Number(sk.ultGauge || 0);
        if (sk.crit) out.c = true;

        var effs = (sk.effects || [])
          .map(function (e) {
            if (!e) return null;
            var v = Number(e.value || 0);
            if (!(v > 0)) return null;
            var note = typeof e.note === "string" ? e.note.trim() : "";
            var eo = { z: e.zone, t: e.type, v: v };
            if (e.zone === "passive" && note) eo.n = note;
            return eo;
          })
          .filter(Boolean);
        if (effs.length) out.e = effs;

        // 如果除了被动名以外都空，仍可能被动只有统计字段
        if (Object.keys(out).length === 0) return null;
        return out;
      }

      if (hasPassive) {
        var pk = packSkill(ch.passiveSkill, true);
        if (pk) minimal.p = pk;
      }

      if (hasTurns) {
        var turnsObj = {};
        Object.keys(ch.turns || {}).forEach(function (tk) {
          var tn = Number(tk);
          if (!Number.isInteger(tn) || tn < 1 || tn > state.turnCount) return;
          var sk = ch.turns[tn];
          var packed = packSkill(sk, false);
          if (packed) turnsObj[String(tn)] = packed;
        });
        if (Object.keys(turnsObj).length) minimal.t = turnsObj;
      }

      rosterOut[i] = minimal;
    }

    // 去掉末尾的空槽位，避免 JSON 数组过长；但保留中间 null 以维持索引对齐
    while (rosterOut.length > 0 && rosterOut[rosterOut.length - 1] === null) {
      rosterOut.pop();
    }

    return {
      v: 2,
      k: "pz1",
      t: new Date().toISOString(),
      tn: state.teamName || "",
      tm: state.teamNote || "",
      tc: state.turnCount,
      tv: state.turnFormView === "detailed" ? "detailed" : "simple",
      r: rosterOut,
    };
  }

  function expandSharePayloadV2(payload) {
    var roster = emptyRoster();
    var arr = payload && Array.isArray(payload.r) ? payload.r : [];
    for (var i = 0; i < 8; i += 1) {
      var m = i < arr.length ? arr[i] : null;
      if (!m) continue;

      var ch = { charName: "", charNote: "", color: "", avatar: "", gear: {}, turns: {} };
      ch.charName = typeof m.n === "string" ? m.n : "";
      ch.charNote = typeof m.o === "string" ? m.o : "";
      ch.color = hashColor(ch.charName || "未命名");

      if (m.g && typeof m.g === "object") {
        ch.gear = {
          weapon: typeof m.g.w === "string" ? m.g.w : "",
          helmet: typeof m.g.h === "string" ? m.g.h : "",
          armor: typeof m.g.a === "string" ? m.g.a : "",
          acc1: typeof m.g.a1 === "string" ? m.g.a1 : "",
          acc2: typeof m.g.a2 === "string" ? m.g.a2 : "",
          acc3: typeof m.g.a3 === "string" ? m.g.a3 : "",
          skill1: typeof m.g.s1 === "string" ? m.g.s1 : "",
          skill2: typeof m.g.s2 === "string" ? m.g.s2 : "",
          skill3: typeof m.g.s3 === "string" ? m.g.s3 : "",
          skill4: typeof m.g.s4 === "string" ? m.g.s4 : "",
        };
      }

      function unpackSkill(p, isPassive, turnNum) {
        if (!p || typeof p !== "object") return null;
        var sk = normalizeSkill({
          skillName: isPassive ? "被动" : typeof p.sn === "string" ? p.sn : "",
          turn: isPassive ? 0 : Number(turnNum || 0),
          skillType: isPassive ? "" : typeof p.st === "string" ? p.st : "",
          bp: isPassive ? 0 : Number(p.bp || 0),
          summonName: typeof p.sum === "string" ? p.sum : "",
          shieldBreak: isPassive ? 0 : Number(p.sb || 0),
          summonEnabled: !!p.se,
          summonBp: Number(p.sbp || 0),
          summonBreak: Number(p.sbr || 0),
          gutsEnabled: !!p.ge,
          stateSwitchEnabled: !!p.ss,
          chaseEnabled: !!p.ce,
          chaseCount: 0,
          chaseBreak: Number(p.cbr || 0),
          effects: Array.isArray(p.e)
            ? p.e.map(function (e) {
                if (!e) return null;
                return {
                  zone: String(e.z || ""),
                  type: String(e.t || ""),
                  value: Number(e.v || 0),
                  note: typeof e.n === "string" ? e.n : "",
                };
              }).filter(Boolean)
            : [],
          power: Number(p.p || 0),
          upper: Number(p.u || 0),
          bean: Number(p.b || 0),
          ultGauge: Number(p.ug || 0),
          crit: !!p.c,
        });
        return sk;
      }

      if (m.p) {
        var ps = unpackSkill(m.p, true, 0);
        if (ps) ch.passiveSkill = ps;
      }

      if (m.t && typeof m.t === "object") {
        Object.keys(m.t).forEach(function (tk) {
          var tn = Number(tk);
          if (!Number.isInteger(tn) || tn < 1) return;
          var ts = unpackSkill(m.t[tk], false, tn);
          if (ts) ch.turns[tn] = ts;
        });
      }

      roster[i] = ch;
    }

    return {
      roster: roster,
      teamName: typeof payload.tn === "string" ? payload.tn : "",
      teamNote: typeof payload.tm === "string" ? payload.tm : "",
      turnCount: clampTurnCount(payload.tc || 5),
      turnFormView: payload.tv === "detailed" ? "detailed" : "simple",
    };
  }

  var SHARE_ZONES = ["passive", "active", "ult", "summon"];
  var SHARE_TYPES = ["atk", "def", "dmg", "res", "atkCap", "defCap", "dmgCap", "resCap"];

  function shareZoneIndex(zone) {
    var i = SHARE_ZONES.indexOf(String(zone || ""));
    return i >= 0 ? i : 0;
  }

  function shareTypeIndex(typ) {
    var i = SHARE_TYPES.indexOf(String(typ || ""));
    return i >= 0 ? i : 0;
  }

  function packGearArray(gear) {
    var order = ["weapon", "helmet", "armor", "acc1", "acc2", "acc3", "skill1", "skill2", "skill3", "skill4"];
    var arr = order.map(function (key) {
      var v = gear[key] && String(gear[key]).trim();
      return v ? String(v).trim() : "";
    });
    while (arr.length > 0 && arr[arr.length - 1] === "") arr.pop();
    return arr.length ? arr : null;
  }

  function unpackGearArray(arr) {
    var order = ["weapon", "helmet", "armor", "acc1", "acc2", "acc3", "skill1", "skill2", "skill3", "skill4"];
    var g = {};
    if (!Array.isArray(arr)) return g;
    for (var i = 0; i < order.length; i += 1) {
      g[order[i]] = typeof arr[i] === "string" ? arr[i] : "";
    }
    return g;
  }

  function packSkillV3(sk, isPassive) {
    if (!sk) return null;
    var out = {};
    if (!isPassive) {
      var sn = typeof sk.skillName === "string" ? sk.skillName : "";
      if (sn) out.m = sn;
      var st = sk.skillType === "battle" || sk.skillType === "guts" ? "active" : sk.skillType;
      if (st === "ex") out.y = 2;
      else if (st === "ult") out.y = 3;
      else if (st === "active") out.y = 1;
      if (sk.bp) out.b = Number(sk.bp || 0);
      if (sk.shieldBreak) out.d = Number(sk.shieldBreak || 0);
    }
    if (sk.summonName && String(sk.summonName).trim()) out.u = String(sk.summonName).trim();
    if (sk.summonBp) out.j = Number(sk.summonBp || 0);
    if (sk.summonBreak) out.r = Number(sk.summonBreak || 0);
    if (sk.power) out.p = Number(sk.power || 0);
    if (sk.upper) out.q = Number(sk.upper || 0);
    if (sk.bean) out.w = Number(sk.bean || 0);
    if (sk.ultGauge) out.g = Number(sk.ultGauge || 0);
    var f = 0;
    if (sk.crit) f |= 1;
    if (sk.summonEnabled) f |= 2;
    if (sk.gutsEnabled) f |= 4;
    if (sk.stateSwitchEnabled) f |= 8;
    if (sk.chaseEnabled) f |= 16;
    if (sk.chaseBreak) out.x = Number(sk.chaseBreak || 0);
    if (f) out.f = f;

    var effRows = (sk.effects || [])
      .map(function (e) {
        if (!e) return null;
        var v = Number(e.value || 0);
        if (!(v > 0)) return null;
        var note = typeof e.note === "string" ? e.note.trim() : "";
        var row = [shareZoneIndex(e.zone), shareTypeIndex(e.type), v];
        if (e.zone === "passive" && note) row.push(note);
        return row;
      })
      .filter(Boolean);
    if (effRows.length) out.e = effRows;

    if (Object.keys(out).length === 0) return null;
    return out;
  }

  function unpackSkillV3(p, isPassive, turnNum) {
    if (!p || typeof p !== "object") return null;
    var f = Number(p.f || 0);
    var skillName = isPassive ? "被动" : typeof p.m === "string" ? p.m : "";
    var y = Number(p.y || 0);
    var stMap = { 1: "active", 2: "ex", 3: "ult" };
    var skillType = isPassive ? "" : stMap[y] || "active";
    var effects = [];
    if (Array.isArray(p.e)) {
      p.e.forEach(function (row) {
        if (!Array.isArray(row) || row.length < 3) return;
        var zi = Number(row[0]);
        var ti = Number(row[1]);
        if (!Number.isFinite(zi) || !Number.isFinite(ti)) return;
        var zone = SHARE_ZONES[zi] || "";
        var type = SHARE_TYPES[ti] || "";
        var value = Number(row[2] || 0);
        var note = row.length > 3 && typeof row[3] === "string" ? row[3] : "";
        if (value > 0) effects.push({ zone: zone, type: type, value: value, note: note });
      });
    }
    return normalizeSkill({
      skillName: skillName,
      turn: isPassive ? 0 : Number(turnNum || 0),
      skillType: skillType,
      bp: isPassive ? 0 : Number(p.b || 0),
      summonName: typeof p.u === "string" ? p.u : "",
      shieldBreak: isPassive ? 0 : Number(p.d || 0),
      summonEnabled: !!(f & 2),
      summonBp: Number(p.j || 0),
      summonBreak: Number(p.r || 0),
      gutsEnabled: !!(f & 4),
      stateSwitchEnabled: !!(f & 8),
      chaseEnabled: !!(f & 16),
      chaseCount: 0,
      chaseBreak: Number(p.x || 0),
      effects: effects,
      power: Number(p.p || 0),
      upper: Number(p.q || 0),
      bean: Number(p.w || 0),
      ultGauge: Number(p.g || 0),
      crit: !!(f & 1),
    });
  }

  function buildSharePayloadV3() {
    var rosterOut = new Array(8).fill(null);
    for (var i = 0; i < 8; i += 1) {
      var ch = state.roster[i] || {};
      var hasName = !!(ch.charName && String(ch.charName).trim());
      var hasNote = !!(ch.charNote && String(ch.charNote).trim());
      var gear = ch.gear || {};
      var gearArr = packGearArray(gear);
      var hasGear = !!gearArr;
      var hasPassive = !!ch.passiveSkill;
      var hasTurns = false;
      if (ch.turns && typeof ch.turns === "object") {
        hasTurns = Object.keys(ch.turns).some(function (tk) {
          return !!ch.turns[tk];
        });
      }
      if (!hasName && !hasNote && !hasGear && !hasPassive && !hasTurns) {
        rosterOut[i] = null;
        continue;
      }
      var minimal = {};
      if (hasName) minimal.n = String(ch.charName).trim();
      if (hasNote) minimal.o = String(ch.charNote).trim();
      if (hasGear) minimal.g = gearArr;
      if (hasPassive) {
        var pk = packSkillV3(ch.passiveSkill, true);
        if (pk) minimal.p = pk;
      }
      if (hasTurns) {
        var turnsObj = {};
        Object.keys(ch.turns || {}).forEach(function (tk) {
          var tn = Number(tk);
          if (!Number.isInteger(tn) || tn < 1 || tn > state.turnCount) return;
          var sk = ch.turns[tn];
          var packed = packSkillV3(sk, false);
          if (packed) turnsObj[String(tn)] = packed;
        });
        if (Object.keys(turnsObj).length) minimal.t = turnsObj;
      }
      rosterOut[i] = minimal;
    }
    while (rosterOut.length > 0 && rosterOut[rosterOut.length - 1] === null) {
      rosterOut.pop();
    }
    var payload = { v: 3, k: "pz1", r: rosterOut };
    if (state.teamName && String(state.teamName).trim()) payload.tn = String(state.teamName).trim();
    if (state.teamNote && String(state.teamNote).trim()) payload.tm = String(state.teamNote).trim();
    if (state.turnCount !== 5) payload.tc = state.turnCount;
    if (state.turnFormView === "detailed") payload.tv = 1;
    return payload;
  }

  function expandSharePayloadV3(payload) {
    var roster = emptyRoster();
    var arr = payload && Array.isArray(payload.r) ? payload.r : [];
    for (var i = 0; i < 8; i += 1) {
      var m = i < arr.length ? arr[i] : null;
      if (!m) continue;
      var ch = { charName: "", charNote: "", color: "", avatar: "", gear: {}, turns: {} };
      ch.charName = typeof m.n === "string" ? m.n : "";
      ch.charNote = typeof m.o === "string" ? m.o : "";
      ch.color = hashColor(ch.charName || "未命名");
      if (Array.isArray(m.g)) ch.gear = unpackGearArray(m.g);
      else if (m.g && typeof m.g === "object") {
        ch.gear = {
          weapon: typeof m.g.w === "string" ? m.g.w : "",
          helmet: typeof m.g.h === "string" ? m.g.h : "",
          armor: typeof m.g.a === "string" ? m.g.a : "",
          acc1: typeof m.g.a1 === "string" ? m.g.a1 : "",
          acc2: typeof m.g.a2 === "string" ? m.g.a2 : "",
          acc3: typeof m.g.a3 === "string" ? m.g.a3 : "",
          skill1: typeof m.g.s1 === "string" ? m.g.s1 : "",
          skill2: typeof m.g.s2 === "string" ? m.g.s2 : "",
          skill3: typeof m.g.s3 === "string" ? m.g.s3 : "",
          skill4: typeof m.g.s4 === "string" ? m.g.s4 : "",
        };
      }
      if (m.p) {
        var ps = unpackSkillV3(m.p, true, 0);
        if (ps) ch.passiveSkill = ps;
      }
      if (m.t && typeof m.t === "object") {
        Object.keys(m.t).forEach(function (tk) {
          var tn = Number(tk);
          if (!Number.isInteger(tn) || tn < 1) return;
          var ts = unpackSkillV3(m.t[tk], false, tn);
          if (ts) ch.turns[tn] = ts;
        });
      }
      roster[i] = ch;
    }
    var tv = payload.tv;
    return {
      roster: roster,
      teamName: typeof payload.tn === "string" ? payload.tn : "",
      teamNote: typeof payload.tm === "string" ? payload.tm : "",
      turnCount: clampTurnCount(payload.tc != null ? payload.tc : 5),
      turnFormView: tv === 1 || tv === "detailed" ? "detailed" : "simple",
    };
  }

  async function encodeShareToken(payloadObj) {
    var json = JSON.stringify(payloadObj);
    var bytes = utf8ToBytes(json);
    var gz = await gzipBytes(bytes);
    if (gz && gz.length + 8 < bytes.length) {
      var out = new Uint8Array(1 + gz.length);
      out[0] = 1;
      out.set(gz, 1);
      return "z1" + bytesToBase64Url(out);
    }
    var out2 = new Uint8Array(1 + bytes.length);
    out2[0] = 0;
    out2.set(bytes, 1);
    return "z0" + bytesToBase64Url(out2);
  }

  async function decodeShareToken(token) {
    var s = String(token || "");
    if (!s.startsWith("z0") && !s.startsWith("z1")) {
      throw new Error("bad token prefix");
    }
    var kind = s.slice(0, 2);
    var b64 = s.slice(2);
    var packed = base64UrlToBytes(b64);
    if (!packed.length) throw new Error("empty token");
    var flag = packed[0];
    var body = packed.subarray(1);
    var jsonBytes = body;
    if (flag === 1) {
      var ug = await gunzipBytes(body);
      if (!ug) throw new Error("gzip not supported");
      jsonBytes = ug;
    } else if (flag !== 0) {
      throw new Error("bad token flag");
    }
    var text = new TextDecoder().decode(jsonBytes);
    return JSON.parse(text);
  }

  // 分享链接与二维码内容始终用线上页，避免 file:// 或本地路径把码撑得极密、也无法发给别人
  var SHARE_PAGE_BASE =
    "https://w1334113230.github.io/qllr_dldbz_paiZhouUtil/paiZhouUtil/index.html?d=";

  async function openQrExportModal() {
    var backdrop = document.getElementById("qrModalBackdrop");
    var img = document.getElementById("qrModalImg");
    var ta = document.getElementById("qrModalUrl");
    var tip = document.getElementById("qrModalTip");
    if (!backdrop || !img || !ta || !tip) return;

    var payload = buildSharePayloadV3();
    var token = await encodeShareToken(payload);
    var shareUrl = SHARE_PAGE_BASE + encodeURIComponent(token);

    ta.value = shareUrl;

    var approxBytes = utf8ToBytes(shareUrl).length;
    tip.textContent =
      "链接固定为 GitHub Pages（v3 gzip，无头像/cellCaps）。UTF-8 约 " +
      approxBytes +
      " bytes。纠错 L、画布 300px；若仍难扫可缩短装备/备注文字。";

    var toDataURL = await loadQrCodeToDataURL();
    if (typeof toDataURL !== "function") {
      alert("二维码模块加载失败：请确认 paiZhouUtil/vendor/qrcode.bundle.js 存在（仓库根目录执行 npm install && npm run vendor 可生成）。");
      return;
    }

    var dataUrl = await toDataURL(shareUrl, {
      errorCorrectionLevel: "L",
      margin: 4,
      width: 300,
    });
    img.src = dataUrl;

    backdrop.classList.remove("is-hidden");
  }

  function closeQrExportModal() {
    var backdrop = document.getElementById("qrModalBackdrop");
    if (backdrop) backdrop.classList.add("is-hidden");
  }

  /** 从 d 参数字符串解码并写入 state（不跳转、不改地址栏） */
  async function applyShareTokenToState(dParam) {
    var d = String(dParam || "").trim();
    if (!d) throw new Error("empty");
    var decoded = await decodeShareToken(decodeURIComponent(d));
    if (!decoded || decoded.k !== "pz1") {
      throw new Error("bad payload");
    }
    var expanded;
    if (decoded.v === 3) expanded = expandSharePayloadV3(decoded);
    else if (decoded.v === 2) expanded = expandSharePayloadV2(decoded);
    else throw new Error("bad payload");
    state.turnCount = expanded.turnCount;
    state.teamName = expanded.teamName;
    state.teamNote = expanded.teamNote;
    state.turnFormView = expanded.turnFormView;
    state.roster = normalizeRoster(expanded.roster);
    state.cellCaps = collectCellCapsFromDom();
    await loadWikiAvatarsOnce();
    syncWikiAvatarsIntoRosterChars();
    saveToStorage();
  }

  /** 从粘贴的整段文字里取出 token（完整 http(s) 链接、?d=…、或裸 z0/z1 串） */
  function extractShareTokenFromPaste(text) {
    var s = String(text || "")
      .trim()
      .replace(/[\r\n]+/g, "");
    if (!s) return "";
    if (/^z[01][A-Za-z0-9_-]+$/i.test(s)) return s;
    try {
      var u = new URL(s);
      var q = u.searchParams.get("d");
      if (q) return q;
    } catch (e1) {}
    try {
      var u2 = new URL(s, "https://example.invalid/share");
      var q2 = u2.searchParams.get("d");
      if (q2) return q2;
    } catch (e2) {}
    var m = s.match(/[?&]d=([^&\s#]+)/);
    if (m && m[1]) {
      try {
        return decodeURIComponent(m[1]);
      } catch (e3) {
        return m[1];
      }
    }
    return "";
  }

  function openImportDataModal() {
    var backdrop = document.getElementById("shareImportModalBackdrop");
    if (!backdrop) {
      console.warn("导入弹窗节点缺失（shareImportModalBackdrop），请确认 index.html 与 app.js 为同一版本并已刷新缓存。");
      return;
    }
    var ta = document.getElementById("shareImportTextarea");
    var fi = document.getElementById("shareImportQrFile");
    var fn = document.getElementById("shareImportFileName");
    var jf = document.getElementById("importJsonFile");
    var jn = document.getElementById("importJsonFileName");
    if (ta) ta.value = "";
    if (fi) fi.value = "";
    if (fn) fn.textContent = "";
    if (jf) jf.value = "";
    if (jn) jn.textContent = "";
    backdrop.classList.remove("is-hidden");
  }

  function closeImportDataModal() {
    var backdrop = document.getElementById("shareImportModalBackdrop");
    if (backdrop) backdrop.classList.add("is-hidden");
  }

  async function tryImportFromShareUrl() {
    var u = new URL(window.location.href);
    var d = u.searchParams.get("d");
    if (!d) return false;
    try {
      await applyShareTokenToState(d);
      u.searchParams.delete("d");
      history.replaceState({}, "", u.toString());
      return true;
    } catch (e) {
      console.error(e);
      alert("从链接参数导入失败：数据损坏或不兼容。");
      return false;
    }
  }

  function emptyRoster() {
    return [{}, {}, {}, {}, {}, {}, {}, {}];
  }

  function clampTurnCount(n) {
    var val = Number(n);
    if (!Number.isFinite(val)) return 5;
    val = Math.floor(val);
    if (val < 1) return 1;
    if (val > 20) return 20;
    return val;
  }

  function detectTurnCountFromRawRoster(rawRoster) {
    if (!Array.isArray(rawRoster)) return 5;
    var maxTurn = 5;
    rawRoster.forEach(function (char) {
      if (!char || !char.turns || typeof char.turns !== "object") return;
      Object.keys(char.turns).forEach(function (k) {
        var n = Number(k);
        if (Number.isInteger(n) && n > maxTurn) maxTurn = n;
      });
    });
    return clampTurnCount(maxTurn);
  }

  function collectCellCapsFromDom() {
    var caps = {};
    document.querySelectorAll(".buff-cell[data-cell-id]").forEach(function (cell) {
      var id = cell.getAttribute("data-cell-id");
      if (!id) return;
      var max = Number(cell.getAttribute("data-max") || 30);
      caps[id] = Number.isFinite(max) && max > 0 ? max : 30;
    });
    return caps;
  }

  function refreshCapButtons() {
    document.querySelectorAll(".buff-cell[data-cell-id]").forEach(function (cell) {
      var btn = cell.querySelector(".buff-cap-btn");
      if (!btn) return;
      btn.textContent = "上限 " + (cell.getAttribute("data-max") || "30") + "%";
    });
  }

  function applyCellCapsToDom() {
    document.querySelectorAll(".buff-cell[data-cell-id]").forEach(function (cell) {
      var id = cell.getAttribute("data-cell-id");
      if (!id) return;
      var cap = state.cellCaps && state.cellCaps[id];
      if (typeof cap === "number" && cap > 0) {
        cell.setAttribute("data-max", String(cap));
      }
    });
    syncBuffLayout(document);
    refreshCapButtons();
  }

  function initCapEditors() {
    document.querySelectorAll(".buff-cell[data-cell-id]").forEach(function (cell) {
      if (cell.querySelector(".buff-cap-btn")) return;
      var btn = document.createElement("span");
      btn.className = "buff-cap-btn";
      btn.textContent = "上限 " + (cell.getAttribute("data-max") || "30") + "%";
      cell.appendChild(btn);
    });
  }

  function openCapEditor(cellId, currentValue) {
    var backdrop = document.getElementById("capEditorBackdrop");
    var input = document.getElementById("capEditorInput");
    if (!backdrop || !input || !cellId) return;
    state.capEditorCellId = cellId;
    input.value = String(currentValue || 30);
    backdrop.classList.remove("is-hidden");
    setTimeout(function () {
      input.focus();
      input.select();
    }, 0);
  }

  function closeCapEditor() {
    var backdrop = document.getElementById("capEditorBackdrop");
    if (backdrop) backdrop.classList.add("is-hidden");
    state.capEditorCellId = "";
  }

  function saveCapEditorValue() {
    var input = document.getElementById("capEditorInput");
    if (!input || !state.capEditorCellId) return;
    var next = Number(input.value);
    if (!Number.isFinite(next) || next <= 0) return;
    var cell = document.querySelector('.buff-cell[data-cell-id="' + state.capEditorCellId + '"]');
    if (!cell) return;
    cell.setAttribute("data-max", String(next));
    if (!state.cellCaps) state.cellCaps = {};
    state.cellCaps[state.capEditorCellId] = next;
    syncBuffLayout(document);
    refreshCapButtons();
    saveToStorage();
    closeCapEditor();
  }

  function hashColor(input) {
    var str = input || "未命名";
    var h = 0;
    for (var i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) % 360;
    return "hsl(" + h + ", 42%, 42%)";
  }

  function syncBuffLayout(root) {
    var scope = root || document;
    scope.querySelectorAll(".buff-cell[data-max]").forEach(function (cell) {
      var max = parseFloat(cell.getAttribute("data-max"), 10);
      if (!isNaN(max) && max > 0) cell.style.setProperty("--cap", String(max));
    });
    scope.querySelectorAll(".buff-segment[data-value]").forEach(function (seg) {
      var v = parseFloat(seg.getAttribute("data-value"), 10);
      if (!isNaN(v) && v >= 0) seg.style.setProperty("--v", String(v));
    });
  }

  function ensureChar(idx) {
    var roster = state.roster;
    if (!roster[idx]) roster[idx] = {};
    if (!roster[idx].turns) roster[idx].turns = {};
    if (!roster[idx].gear || typeof roster[idx].gear !== "object") roster[idx].gear = {};
    return roster[idx];
  }

  function normalizeSkill(skill) {
    if (!skill || typeof skill !== "object") return null;
    return {
      skillName: typeof skill.skillName === "string" ? skill.skillName : "",
      turn: Number(skill.turn || 0),
      skillType:
        typeof skill.skillType === "string"
          ? (skill.skillType === "battle" || skill.skillType === "guts" ? "active" : skill.skillType)
          : "",
      bp: Number(skill.bp || 0),
      summonName: typeof skill.summonName === "string" ? skill.summonName : "",
      shieldBreak: Number(skill.shieldBreak || 0),
      summonEnabled: !!skill.summonEnabled,
      summonBp: Number(skill.summonBp || 0),
      summonBreak: Number(skill.summonBreak || 0),
      gutsEnabled: !!skill.gutsEnabled,
      stateSwitchEnabled: !!skill.stateSwitchEnabled,
      chaseEnabled: !!skill.chaseEnabled,
      chaseCount: Number(skill.chaseCount || 0),
      chaseBreak: Number(skill.chaseBreak || 0),
      effects: Array.isArray(skill.effects)
        ? skill.effects
            .map(function (e) {
              if (!e) return null;
              return {
                zone: String(e.zone || ""),
                type: String(e.type || ""),
                value: Number(e.value || 0),
                note: typeof e.note === "string" ? e.note : "",
              };
            })
            .filter(Boolean)
        : [],
      power: Number(skill.power || 0),
      upper: Number(skill.upper || 0),
      bean: Number(skill.bean || 0),
      ultGauge: Number(skill.ultGauge || 0),
      crit: !!skill.crit,
    };
  }

  function normalizeRoster(rawRoster) {
    var roster = emptyRoster();
    if (!Array.isArray(rawRoster)) return roster;
    var maxTurn = clampTurnCount(state.turnCount);
    for (var i = 0; i < 8; i += 1) {
      var src = rawRoster[i] || {};
      var dst = {
        charName: typeof src.charName === "string" ? src.charName : "",
        charNote: typeof src.charNote === "string" ? src.charNote : "",
        color: typeof src.color === "string" ? src.color : "",
        avatar: typeof src.avatar === "string" ? src.avatar : "",
        gear: {
          weapon: src && src.gear && typeof src.gear.weapon === "string" ? src.gear.weapon : "",
          helmet: src && src.gear && typeof src.gear.helmet === "string" ? src.gear.helmet : "",
          armor: src && src.gear && typeof src.gear.armor === "string" ? src.gear.armor : "",
          acc1: src && src.gear && typeof src.gear.acc1 === "string" ? src.gear.acc1 : "",
          acc2: src && src.gear && typeof src.gear.acc2 === "string" ? src.gear.acc2 : "",
          acc3: src && src.gear && typeof src.gear.acc3 === "string" ? src.gear.acc3 : "",
          skill1: src && src.gear && typeof src.gear.skill1 === "string" ? src.gear.skill1 : "",
          skill2: src && src.gear && typeof src.gear.skill2 === "string" ? src.gear.skill2 : "",
          skill3: src && src.gear && typeof src.gear.skill3 === "string" ? src.gear.skill3 : "",
          skill4: src && src.gear && typeof src.gear.skill4 === "string" ? src.gear.skill4 : "",
        },
        turns: {},
      };
      if (src.turns && typeof src.turns === "object") {
        Object.keys(src.turns).forEach(function (k) {
          var n = Number(k);
          if (n >= 1 && n <= maxTurn && Number.isInteger(n)) {
            var skill = normalizeSkill(src.turns[k]);
            if (skill) dst.turns[n] = skill;
          }
        });
      }
      var passive = normalizeSkill(src.passiveSkill);
      if (passive) dst.passiveSkill = passive;
      roster[i] = dst;
    }
    return roster;
  }

  function saveToStorage() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          savedAt: new Date().toISOString(),
          roster: state.roster,
          cellCaps: state.cellCaps,
          teamName: state.teamName,
          teamNote: state.teamNote,
          turnCount: state.turnCount,
          turnFormView: state.turnFormView,
        })
      );
    } catch (e) {}
  }

  function loadFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      state.turnCount = clampTurnCount((data && data.turnCount) || detectTurnCountFromRawRoster(data && data.roster));
      state.roster = normalizeRoster(data && data.roster);
      state.cellCaps = data && data.cellCaps && typeof data.cellCaps === "object" ? data.cellCaps : {};
      state.teamName = typeof data.teamName === "string" ? data.teamName : "";
      state.teamNote = typeof data.teamNote === "string" ? data.teamNote : "";
      state.turnFormView = data && data.turnFormView === "detailed" ? "detailed" : "simple";
    } catch (e) {
      state.roster = emptyRoster();
      state.cellCaps = {};
      state.teamName = "";
      state.teamNote = "";
      state.turnCount = 5;
      state.turnFormView = "simple";
    }
  }

  function exportData() {
    var payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      roster: state.roster,
      cellCaps: state.cellCaps,
      teamName: state.teamName,
      teamNote: state.teamNote,
      turnCount: state.turnCount,
      turnFormView: state.turnFormView,
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = sanitizeFileName(state.teamName) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function applyImportedData(parsed) {
    state.turnCount = clampTurnCount((parsed && parsed.turnCount) || detectTurnCountFromRawRoster(parsed && parsed.roster));
    state.roster = normalizeRoster(parsed && parsed.roster);
    if (parsed && parsed.cellCaps && typeof parsed.cellCaps === "object" && Object.keys(parsed.cellCaps).length) {
      state.cellCaps = parsed.cellCaps;
    } else {
      state.cellCaps = collectCellCapsFromDom();
    }
    state.teamName = parsed && typeof parsed.teamName === "string" ? parsed.teamName : "";
    state.teamNote = parsed && typeof parsed.teamNote === "string" ? parsed.teamNote : "";
    state.turnFormView = parsed && parsed.turnFormView === "detailed" ? "detailed" : "simple";
    applyCellCapsToDom();
    renderParty();
    rebuildBuffGrid();
    updateStatsPanel(calcSummary());
    saveToStorage();
    refreshWikiAvatarsOnRosterThenRerender();
  }

  function resetAllData() {
    state.roster = emptyRoster();
    state.selected = { idx: 0, turn: 1, mode: "turn" };
    state.turnFilter = null;
    state.cellCaps = collectCellCapsFromDom();
    state.teamName = "";
    state.teamNote = "";
    state.turnCount = 5;
    state.turnFormView = "simple";
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    document.querySelectorAll(".turn-filter-box").forEach(function (item) {
      item.classList.remove("is-active");
    });
    renderParty();
    rebuildBuffGrid();
    updateStatsPanel(calcSummary());
  }

  function getAllSkills(char) {
    var skills = [];
    if (!char) return skills;
    if (char.passiveSkill) skills.push(char.passiveSkill);
    if (char.turns) {
      Object.keys(char.turns).forEach(function (turnKey) {
        if (char.turns[turnKey]) skills.push(char.turns[turnKey]);
      });
    }
    return skills;
  }

  function updateStatsPanel(summary) {
    var statMap = {
      statPower: summary.power + "%",
      statCap: summary.upper + "w",
      statBean: String(summary.bean),
      statUlt: summary.ultGauge + "%",
      statCrit: summary.crit ? "是" : "否",
      statBreak: String(summary.breakValue),
    };
    Object.keys(statMap).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = statMap[id];
    });
  }

  function rebuildBuffGrid() {
    var allEffects = [];
    var cellTips = {};
    var capByCell = {};
    document.querySelectorAll(".buff-cell[data-cell-id]").forEach(function (cell) {
      var id = cell.getAttribute("data-cell-id");
      if (id) capByCell[id] = 30;
    });
    state.roster.forEach(function (char) {
      getAllSkills(char).forEach(function (skill) {
        (skill.effects || []).forEach(function (eff) {
          var turnLabel = skill.turn === 0 ? "被动" : "T" + skill.turn;
          var effectValueLabel = Number(eff.value || 0) + "%";
          var title;
          if (eff.zone === "summon") {
            title = (char.charName || "未知角色") + "，" + turnLabel + "，" + (skill.summonName || "未命名支炎兽") + "，" + effectValueLabel;
          } else if (eff.zone === "passive") {
            if (eff.note) {
              title =
                skill.turn === 0
                  ? (char.charName || "未知角色") + "，" + eff.note + "，" + effectValueLabel
                  : (char.charName || "未知角色") + "，" + turnLabel + "，" + (skill.skillName || "未命名技能") + "，" + eff.note + "，" + effectValueLabel;
            } else {
              title =
                skill.turn === 0
                  ? (char.charName || "未知角色") + "，被动，" + effectValueLabel
                  : (char.charName || "未知角色") + "，" + turnLabel + "，" + (skill.skillName || "未命名技能") + "，" + effectValueLabel;
            }
          } else {
            title =
              skill.turn === 0
                ? (char.charName || "未知角色") + "，被动，" + effectValueLabel
                : (char.charName || "未知角色") + "，" + turnLabel + "，" + (skill.skillName || "未命名技能") + "，" + effectValueLabel;
          }
          if (CAP_EFFECT_TARGET[eff.type]) {
            var targetCellId = CAP_EFFECT_TARGET[eff.type] + ":" + eff.zone;
            var nextCap = Math.max(30, Number(eff.value || 0));
            if (capByCell[targetCellId] !== undefined) {
              capByCell[targetCellId] = Math.max(capByCell[targetCellId], nextCap);
            }
            if (!cellTips[targetCellId]) cellTips[targetCellId] = [];
            cellTips[targetCellId].push(title + "，上限提升至" + nextCap + "%");
          } else {
            var normalCellId = eff.type + ":" + eff.zone;
            allEffects.push({
              cellId: normalCellId,
              value: Number(eff.value || 0),
              color: char.color || "#4b6a88",
              avatar: char.avatar || "",
              title: title,
            });
            if (!cellTips[normalCellId]) cellTips[normalCellId] = [];
            cellTips[normalCellId].push(title);
          }
        });
      });
    });

    document.querySelectorAll(".buff-cell").forEach(function (cell) {
      var track = cell.querySelector(".buff-cell-track");
      if (track) track.innerHTML = "";
      cell.removeAttribute("data-tip");
      var cid = cell.getAttribute("data-cell-id");
      if (cid && capByCell[cid] !== undefined) {
        cell.setAttribute("data-max", String(capByCell[cid]));
      }
    });

    allEffects.forEach(function (eff) {
      var cell = document.querySelector('.buff-cell[data-cell-id="' + eff.cellId + '"]');
      if (!cell) return;
      var track = cell.querySelector(".buff-cell-track");
      if (!track) return;
      var seg = document.createElement("div");
      seg.className = "buff-segment";
      seg.setAttribute("data-value", String(eff.value));
      seg.style.background = "linear-gradient(180deg, " + eff.color + " 0%, rgba(20,20,20,.78) 100%)";
      if (eff.avatar) {
        seg.classList.add("buff-segment--with-avatar");
        seg.style.setProperty("--avatar-url", "url(\"" + eff.avatar + "\")");
      }
      track.appendChild(seg);
    });
    Object.keys(cellTips).forEach(function (cellId) {
      var cell = document.querySelector('.buff-cell[data-cell-id="' + cellId + '"]');
      if (!cell) return;
      cell.setAttribute("data-tip", cellTips[cellId].join("\n"));
    });
    syncBuffLayout(document);
    refreshCapButtons();
  }

  function calcSummary() {
    var result = { power: 0, upper: 0, bean: 0, ultGauge: 0, crit: false, breakValue: 0 };
    state.roster.forEach(function (char) {
      getAllSkills(char).forEach(function (skill) {
        result.power = Math.max(result.power, Number(skill.power || 0));
        result.upper += Number(skill.upper || 0);
        result.bean += Number(skill.bean || 0);
        result.ultGauge += Number(skill.ultGauge || 0);
        result.crit = result.crit || !!skill.crit;
        result.breakValue += Number(skill.shieldBreak || 0);
        result.breakValue += Number(skill.summonBreak || 0);
        result.breakValue += Number(skill.chaseBreak || 0);
      });
    });
    return result;
  }

  function renderParty() {
    var grid = document.getElementById("partyGrid");
    if (!grid) return;
    grid.innerHTML = "";

    for (var row = 0; row < 4; row += 1) {
      var rowEl = document.createElement("div");
      rowEl.className = "party-row";
      for (var col = 0; col < 2; col += 1) {
        var idx = row * 2 + col;
        var char = state.roster[idx] || {};
        var card = document.createElement("article");
        card.className = "char-card";
        card.dataset.idx = String(idx);
        card.draggable = true;
        if (!char.charName) card.classList.add("char-card--empty");
        if (state.turnFilter && char.turns && char.turns[state.turnFilter]) {
          card.classList.add("is-turn-blink");
        }

        var color = char.color || "#4d4d4d";
        var noteTip = (char.charNote || "").trim();
        var portrait = document.createElement("div");
        portrait.className = "char-portrait";
        if (char.avatar) {
          portrait.classList.add("has-avatar");
          portrait.style.background = "";
          portrait.style.backgroundColor = color;
          portrait.style.backgroundImage = "url(\"" + char.avatar + "\")";
          portrait.style.backgroundSize = "contain";
          portrait.style.backgroundPosition = "center";
          portrait.style.backgroundRepeat = "no-repeat";
        } else {
          portrait.style.backgroundImage = "none";
          portrait.style.background = "linear-gradient(145deg, " + color + " 0%, #222 100%)";
        }
        portrait.dataset.idx = String(idx);
        portrait.setAttribute("data-tip", noteTip || "点击设置头像");

        var main = document.createElement("div");
        main.className = "char-main";
        var name = document.createElement("span");
        name.className = "role-name";
        name.textContent = char.charName || "点击图标录入";
        if (noteTip) {
          name.setAttribute("data-tip", noteTip);
        } else {
          name.removeAttribute("data-tip");
        }
        main.appendChild(name);

        var turns = document.createElement("div");
        turns.className = "turn-slots";

        var beBtn = document.createElement("button");
        beBtn.type = "button";
        beBtn.className = "turn-box turn-box--be";
        beBtn.draggable = false; // 被动只用于点击录入，不参与拖拽交换
        beBtn.textContent = "被";
        beBtn.dataset.idx = String(idx);
        beBtn.dataset.turn = "0";
        beBtn.dataset.mode = "passive";
        if (char.passiveSkill) {
          beBtn.classList.add("is-active");
          beBtn.setAttribute("data-tip", char.passiveSkill.skillName || "被动已设置");
        } else {
          beBtn.setAttribute("data-tip", "点击设置被动");
        }
        turns.appendChild(beBtn);

        for (var t = 1; t <= state.turnCount; t += 1) {
          var btn = document.createElement("button");
          var skill = char.turns && char.turns[t];
          btn.type = "button";
          btn.className = "turn-box";
          btn.draggable = true; // 仅允许拖拽回合行动按钮，交换同一格内的内容
          btn.textContent = String(t);
          btn.dataset.idx = String(idx);
          btn.dataset.turn = String(t);
          btn.dataset.mode = "turn";
          if (skill) {
            btn.classList.add("is-active");
            if (SKILL_TYPE_CLASS[skill.skillType]) btn.classList.add(SKILL_TYPE_CLASS[skill.skillType]);
            if (skill.chaseEnabled) btn.classList.add("turn-box--chase");
            if (skill.gutsEnabled || skill.stateSwitchEnabled) btn.classList.add("turn-box--down-mark");
            if (skill.summonName) btn.classList.add("is-summon");
            var tipParts = [];
            if (skill.skillName) tipParts.push(skill.skillName);
            if (skill.summonEnabled) tipParts.push('支炎兽"' + (skill.summonName || "") + '"');
            if (skill.gutsEnabled) tipParts.push("发动底力");
            if (skill.stateSwitchEnabled) tipParts.push("切换状态");
            if (skill.chaseEnabled) tipParts.push("追击");
            var tipText = tipParts.length ? tipParts.join("\n") : "已设置技能";
            btn.setAttribute("data-tip", tipText);
            if (state.turnFilter === t) {
              btn.classList.add("turn-box--show-tip");
              var inlineTip = document.createElement("span");
              inlineTip.className = "turn-inline-tip";
              inlineTip.textContent = tipText;
              btn.appendChild(inlineTip);
            }
          } else {
            btn.setAttribute("data-tip", "第" + t + "回合未设置");
          }
          turns.appendChild(btn);
        }
        main.appendChild(turns);

        card.appendChild(portrait);
        card.appendChild(main);
        rowEl.appendChild(card);
      }
      grid.appendChild(rowEl);
    }
    renderTurnFilter();
  }

  function renderTurnFilter() {
    var slots = document.getElementById("turnFilterSlots");
    if (!slots) return;
    slots.innerHTML = "";

    for (var t = 1; t <= state.turnCount; t += 1) {
      var item = document.createElement("div");
      item.className = "turn-filter-item";
      item.dataset.turn = String(t);
      if (t === state.turnCount) item.classList.add("turn-filter-item--last");

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "turn-filter-box";
      btn.dataset.turn = String(t);
      btn.textContent = String(t);
      btn.classList.toggle("is-active", state.turnFilter === t);
      item.appendChild(btn);

      if (t === state.turnCount && state.turnCount > 1) {
        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "turn-filter-remove";
        removeBtn.dataset.action = "remove-last-turn";
        removeBtn.textContent = "x";
        removeBtn.title = "删除最后一个回合";
        item.appendChild(removeBtn);
      }
      slots.appendChild(item);
    }

    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "turn-filter-add";
    addBtn.dataset.action = "add-turn";
    addBtn.title = "新增回合";
    addBtn.textContent = "+";
    slots.appendChild(addBtn);
  }

  function createZoneOptions(mode, skillType, allowSummon) {
    if (mode === "passive") {
      return '<option value="passive">被动区</option><option value="active">主动区</option><option value="ult">必杀区</option>';
    }
    return '<option value="passive">被动区</option><option value="active">主动区</option><option value="ult">必杀区</option><option value="summon">支炎兽</option>';
  }

  function makeEffectRow(mode, init, skillType, allowSummon) {
    var row = document.createElement("div");
    row.className = "effect-row";
    row.innerHTML =
      '<label><select class="js-zone">' +
      createZoneOptions(mode, skillType, allowSummon) +
      "</select></label>" +
      '<label><select class="js-type"><option value="atk">攻击上升</option><option value="def">防御下降</option><option value="dmg">伤害上升</option><option value="res">耐性下降</option><option value="atkCap">攻击上限提升至</option><option value="defCap">防御上限提升至</option><option value="dmgCap">伤害上限提升至</option><option value="resCap">耐性上限提升至</option></select></label>' +
      '<label class="effect-value"><input class="js-value" type="number" step="0.1" min="0" /><span class="unit">%</span></label>' +
      '<label class="effect-note is-hidden"><input class="js-note" maxlength="30" placeholder="可输入装备名" /></label>' +
      '<button type="button" class="btn-delete">删</button>';
    if (init) {
      row.querySelector(".js-zone").value = init.zone;
      row.querySelector(".js-type").value = init.type;
      row.querySelector(".js-value").value = init.value;
      row.querySelector(".js-note").value = init.note || "";
    }
    function syncNoteInput() {
      var zone = row.querySelector(".js-zone").value;
      var noteWrap = row.querySelector(".effect-note");
      row.classList.toggle("effect-row--with-note", zone === "passive");
      noteWrap.classList.toggle("is-hidden", zone !== "passive");
      if (zone !== "passive") row.querySelector(".js-note").value = "";
    }
    row.querySelector(".js-zone").addEventListener("change", syncNoteInput);
    syncNoteInput();
    row.querySelector(".btn-delete").addEventListener("click", function () {
      row.remove();
    });
    return row;
  }

  function syncEffectRowsByForm(form, mode) {
    if (mode === "char") return;
    var skillType = form.skillType ? form.skillType.value : "active";
    var allowSummon = !!(form.summonEnabled && form.summonEnabled.value === "true");
    document.querySelectorAll("#effectsRows .effect-row").forEach(function (row) {
      var zoneSelect = row.querySelector(".js-zone");
      if (!zoneSelect) return;
      var prev = zoneSelect.value;
      zoneSelect.innerHTML = createZoneOptions(mode, skillType, allowSummon);
      var valid = Array.from(zoneSelect.options).some(function (opt) {
        return opt.value === prev;
      });
      if (valid) {
        zoneSelect.value = prev;
      } else {
        zoneSelect.value = zoneSelect.options[0] ? zoneSelect.options[0].value : "";
      }
      zoneSelect.dispatchEvent(new Event("change"));
    });
  }

  function syncSkillNameRequirement(form, mode) {
    if (!form || !form.skillName) return;
    if (mode === "passive" || mode === "char") {
      form.skillName.required = false;
      return;
    }
    var allowBySummonOrChase =
      !!(form.summonEnabled && form.summonEnabled.value === "true") ||
      !!(form.chaseEnabled && form.chaseEnabled.value === "true") ||
      !!(form.gutsEnabled && form.gutsEnabled.value === "true") ||
      !!(form.stateSwitchEnabled && form.stateSwitchEnabled.value === "true");
    form.skillName.required = !allowBySummonOrChase;
  }

  function applyTurnFormView(mode, refs) {
    if (!refs) return;
    var turnViewToggle = refs.turnViewToggle;
    var turnWrap = refs.turnWrap;
    var bpField = refs.bpField;
    var shieldBreakField = refs.shieldBreakField;
    var actionRow3 = refs.actionRow3;
    var actionRow4 = refs.actionRow4;
    var actionRow5 = refs.actionRow5;
    var statsFieldsWrap = refs.statsFieldsWrap;

    if (mode !== "turn") {
      if (turnViewToggle) turnViewToggle.classList.add("is-hidden");
      return;
    }

    if (turnViewToggle) {
      turnViewToggle.classList.remove("is-hidden");
      turnViewToggle.querySelectorAll(".view-toggle-btn").forEach(function (btn) {
        var view = btn.getAttribute("data-view");
        btn.classList.toggle("is-active", view === state.turnFormView);
      });
    }

    var isSimple = state.turnFormView === "simple";
    if (turnWrap) turnWrap.classList.toggle("is-hidden", isSimple);
    if (bpField) bpField.classList.toggle("is-hidden", isSimple);
    if (shieldBreakField) shieldBreakField.classList.toggle("is-hidden", isSimple);
    if (actionRow3) actionRow3.classList.toggle("is-hidden", isSimple);
    if (actionRow4) actionRow4.classList.toggle("is-hidden", isSimple);
    if (actionRow5) actionRow5.classList.toggle("is-hidden", isSimple);
    if (statsFieldsWrap) statsFieldsWrap.classList.toggle("is-hidden", isSimple);
  }

  function openModal(idx, turn, mode) {
    state.selected = { idx: idx, turn: turn, mode: mode };
    var modal = document.getElementById("skillModal");
    var form = document.getElementById("skillForm");
    var rows = document.getElementById("effectsRows");
    var err = document.getElementById("formError");
    var turnWrap = document.getElementById("turnBadgeWrap");
    var turnValue = document.getElementById("turnBadgeValue");
    var modalTitle = document.getElementById("modalTitle");
    var basicFieldsWrap = document.getElementById("basicFieldsWrap");
    var charExtraSection = document.getElementById("charExtraSection");
    var charExtraToggle = document.getElementById("charExtraToggle");
    var charExtraBody = document.getElementById("charExtraBody");
    var effectHeader = document.getElementById("effectHeader");
    var skillNameField = document.getElementById("skillNameField");
    var charNoteField = document.getElementById("charNoteField");
    var actionRow2 = document.getElementById("actionRow2");
    var actionRow3 = document.getElementById("actionRow3");
    var actionRow4 = document.getElementById("actionRow4");
    var actionRow5 = document.getElementById("actionRow5");
    var turnViewToggle = document.getElementById("turnViewToggle");
    var skillTypeField = document.getElementById("skillTypeField");
    var bpField = document.getElementById("bpField");
    var shieldBreakField = document.getElementById("shieldBreakField");
    var summonField = document.getElementById("summonField");
    var avatarField = document.getElementById("avatarField");
    var statsFieldsWrap = document.getElementById("statsFieldsWrap");
    var resetCellBtn = document.getElementById("resetCellBtn");
    if (!modal || !form || !rows || !err || !turnWrap || !turnValue || !modalTitle || !basicFieldsWrap || !charExtraSection || !charExtraToggle || !charExtraBody || !effectHeader || !actionRow2 || !actionRow3 || !actionRow4 || !actionRow5 || !turnViewToggle || !skillNameField || !charNoteField || !skillTypeField || !bpField || !shieldBreakField || !summonField || !avatarField || !statsFieldsWrap || !resetCellBtn) return;

    err.textContent = "";
    rows.innerHTML = "";
    hideCharNameSuggest();

    var char = ensureChar(idx);
    var skill = mode === "passive" ? char.passiveSkill : char.turns[turn];

    form.charName.value = char.charName || "";
    form.charNote.value = char.charNote || "";
    var gear = char.gear || {};
    form.gearWeapon.value = gear.weapon || "";
    form.gearHelmet.value = gear.helmet || "";
    form.gearArmor.value = gear.armor || "";
    form.gearAcc1.value = gear.acc1 || "";
    form.gearAcc2.value = gear.acc2 || "";
    form.gearAcc3.value = gear.acc3 || "";
    form.gearSkill1.value = gear.skill1 || "";
    form.gearSkill2.value = gear.skill2 || "";
    form.gearSkill3.value = gear.skill3 || "";
    form.gearSkill4.value = gear.skill4 || "";
    form.skillName.value = mode === "passive" ? "" : (skill && skill.skillName) || "";
    form.skillType.value = (skill && skill.skillType) || "active";
    var bpVal = skill && skill.bp !== undefined && skill.bp !== null ? skill.bp : 0;
    form.bp.value = String(bpVal);
    form.summonName.value = (skill && skill.summonName) || "";
    form.shieldBreak.value = skill ? skill.shieldBreak || "" : "";
    form.summonEnabled.value = skill && skill.summonEnabled ? "true" : "false";
    form.summonBp.value = String((skill && (skill.summonBp || skill.summonBp === 0) ? skill.summonBp : 0));
    form.summonBreak.value = skill ? skill.summonBreak || "" : "";
    form.gutsEnabled.value = skill && skill.gutsEnabled ? "true" : "false";
    form.stateSwitchEnabled.value = skill && skill.stateSwitchEnabled ? "true" : "false";
    form.chaseEnabled.value = skill && skill.chaseEnabled ? "true" : "false";
    form.chaseBreak.value = skill ? skill.chaseBreak || "" : "";
    form.power.value = skill ? skill.power || "" : "";
    form.upper.value = skill ? skill.upper || "" : "";
    form.bean.value = skill ? skill.bean || "" : "";
    form.ultGauge.value = skill ? skill.ultGauge || "" : "";
    form.crit.value = skill && skill.crit ? "true" : "false";
    state.modalAvatarData = char.avatar || "";
    setAvatarPreview(state.modalAvatarData);
    if (mode === "char" && char.avatar) {
      normalizeAvatarDataUrl(char.avatar, function (normalized) {
        state.modalAvatarData = normalized;
        setAvatarPreview(normalized);
      });
    }

    if (mode === "char") {
      modalTitle.textContent = "角色录入";
      turnWrap.classList.add("is-hidden");
      turnViewToggle.classList.add("is-hidden");
      charNoteField.classList.remove("is-hidden");
      charExtraSection.classList.remove("is-hidden");
      charExtraToggle.setAttribute("aria-expanded", "false");
      charExtraBody.classList.add("is-hidden");
      skillNameField.classList.add("is-hidden");
      skillTypeField.classList.add("is-hidden");
      bpField.classList.add("is-hidden");
      summonField.classList.add("is-hidden");
      avatarField.classList.remove("is-hidden");
      effectHeader.classList.add("is-hidden");
      rows.classList.add("is-hidden");
      actionRow2.classList.add("is-hidden");
      actionRow3.classList.add("is-hidden");
      actionRow4.classList.add("is-hidden");
      actionRow5.classList.add("is-hidden");
      statsFieldsWrap.classList.add("is-hidden");
      resetCellBtn.classList.remove("is-hidden");
      resetCellBtn.textContent = "重置该格";
      rows.innerHTML = "";
    } else if (mode === "passive") {
      modalTitle.textContent = "被动及装备录入";
      turnWrap.classList.add("is-hidden");
      turnViewToggle.classList.add("is-hidden");
      charNoteField.classList.add("is-hidden");
      charExtraSection.classList.add("is-hidden");
      charExtraToggle.setAttribute("aria-expanded", "false");
      charExtraBody.classList.add("is-hidden");
      skillNameField.classList.add("is-hidden");
      skillTypeField.classList.add("is-hidden");
      bpField.classList.add("is-hidden");
      summonField.classList.add("is-hidden");
      avatarField.classList.add("is-hidden");
      effectHeader.classList.remove("is-hidden");
      rows.classList.remove("is-hidden");
      actionRow2.classList.add("is-hidden");
      actionRow3.classList.add("is-hidden");
      actionRow4.classList.add("is-hidden");
      actionRow5.classList.add("is-hidden");
      statsFieldsWrap.classList.remove("is-hidden");
      resetCellBtn.classList.remove("is-hidden");
      resetCellBtn.textContent = "重置该被动";
    } else {
      modalTitle.textContent = "回合行动信息录入";
      turnWrap.classList.remove("is-hidden");
      turnViewToggle.classList.remove("is-hidden");
      charNoteField.classList.add("is-hidden");
      charExtraSection.classList.add("is-hidden");
      charExtraToggle.setAttribute("aria-expanded", "false");
      charExtraBody.classList.add("is-hidden");
      skillNameField.classList.remove("is-hidden");
      skillTypeField.classList.remove("is-hidden");
      bpField.classList.remove("is-hidden");
      summonField.classList.remove("is-hidden");
      avatarField.classList.add("is-hidden");
      effectHeader.classList.remove("is-hidden");
      rows.classList.remove("is-hidden");
      actionRow2.classList.remove("is-hidden");
      actionRow3.classList.remove("is-hidden");
      actionRow4.classList.remove("is-hidden");
      actionRow5.classList.remove("is-hidden");
      statsFieldsWrap.classList.remove("is-hidden");
      resetCellBtn.classList.remove("is-hidden");
      resetCellBtn.textContent = "重置该回合";
      turnValue.textContent = String(turn);
    }

    applyTurnFormView(mode, {
      turnViewToggle: turnViewToggle,
      turnWrap: turnWrap,
      bpField: bpField,
      shieldBreakField: shieldBreakField,
      actionRow3: actionRow3,
      actionRow4: actionRow4,
      actionRow5: actionRow5,
      statsFieldsWrap: statsFieldsWrap,
    });

    if (mode !== "char" && skill && skill.effects && skill.effects.length) {
      skill.effects.forEach(function (eff) {
        rows.appendChild(makeEffectRow(mode, eff, form.skillType.value, !!(form.summonEnabled.value === "true")));
      });
    } else if (mode !== "char") {
      rows.appendChild(
        makeEffectRow(
          mode,
          { zone: mode === "passive" ? "passive" : form.skillType.value === "ult" ? "ult" : "active", type: "atk", value: "" },
          form.skillType.value,
          !!(form.summonEnabled.value === "true")
        )
      );
    }
    syncSkillNameRequirement(form, mode);
    syncEffectRowsByForm(form, mode);
    modal.classList.remove("is-hidden");
    loadWikiAvatarsOnce().then(function () {
      if (mode === "char") tryWikiAvatarFromCharNameInput(form);
    });
  }

  function closeModal() {
    var modal = document.getElementById("skillModal");
    if (modal) modal.classList.add("is-hidden");
    hideCharNameSuggest();
  }

  function setAvatarPreview(dataUrl) {
    var preview = document.getElementById("avatarPreview");
    if (!preview) return;
    if (dataUrl) {
      preview.textContent = "";
      preview.style.backgroundImage = "url(\"" + dataUrl + "\")";
    } else {
      preview.textContent = "在这粘贴";
      preview.style.backgroundImage = "none";
    }
  }

  function readImageFileAsDataUrl(file, done) {
    if (!file || !file.type || !file.type.startsWith("image/")) return;
    var reader = new FileReader();
    reader.onload = function () {
      normalizeAvatarDataUrl(String(reader.result || ""), done);
    };
    reader.readAsDataURL(file);
  }

  function initTooltipSystem() {
    if (document.getElementById("appTooltip")) return;
    var tip = document.createElement("div");
    tip.id = "appTooltip";
    tip.className = "app-tooltip";
    tip.setAttribute("aria-hidden", "true");
    document.body.appendChild(tip);

    var activeEl = null;
    function hideTip() {
      activeEl = null;
      tip.style.transform = "translate(-9999px, -9999px)";
      tip.textContent = "";
    }
    function moveTip(e) {
      if (!activeEl) return;
      var x = e.clientX + 12;
      var y = e.clientY + 14;
      tip.style.transform = "translate(" + x + "px, " + y + "px)";
    }

    document.addEventListener("mouseover", function (e) {
      var el = e.target.closest("[data-tip]");
      if (!el) {
        hideTip();
        return;
      }
      var text = el.getAttribute("data-tip") || "";
      if (!text) {
        hideTip();
        return;
      }
      activeEl = el;
      tip.textContent = text;
      moveTip(e);
    });
    document.addEventListener("mousemove", moveTip);
    document.addEventListener("mouseout", function (e) {
      if (!activeEl) return;
      var related = e.relatedTarget;
      if (related && related.closest && related.closest("[data-tip]") === activeEl) return;
      hideTip();
    });
    document.addEventListener("scroll", function () {
      if (activeEl) hideTip();
    }, true);
  }

  function normalizeAvatarDataUrl(dataUrl, done) {
    if (!dataUrl) {
      done("");
      return;
    }
    var s = String(dataUrl);
    if (/^https?:\/\//i.test(s)) {
      done(s);
      return;
    }
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      if (!w || !h) {
        done(dataUrl);
        return;
      }
      var canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext("2d");
      if (!ctx) {
        done(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0);
      var imageData = ctx.getImageData(0, 0, w, h).data;
      var minX = w;
      var minY = h;
      var maxX = -1;
      var maxY = -1;
      for (var y = 0; y < h; y += 1) {
        for (var x = 0; x < w; x += 1) {
          var a = imageData[(y * w + x) * 4 + 3];
          if (a > 8) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < minX || maxY < minY) {
        done(dataUrl);
        return;
      }
      var cropW = maxX - minX + 1;
      var cropH = maxY - minY + 1;
      var out = document.createElement("canvas");
      out.width = cropW;
      out.height = cropH;
      var outCtx = out.getContext("2d");
      if (!outCtx) {
        done(dataUrl);
        return;
      }
      outCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
      done(out.toDataURL("image/png"));
    };
    img.onerror = function () {
      done(dataUrl);
    };
    img.src = dataUrl;
  }

  /** Wiki 头像库 byName，加载失败时为 null */
  var wikiAvatarByName = null;
  var wikiAvatarsLoadPromise = null;
  var wikiCharNameKeys = null;

  function ingestWikiAvatarsPayload(data) {
    var by = data && data.byName && typeof data.byName === "object" ? data.byName : {};
    wikiAvatarByName = by;
    wikiCharNameKeys = Object.keys(by).sort(function (a, b) {
      return a.localeCompare(b, "zh-Hans-CN");
    });
    return by;
  }

  /** 与 index.html 同目录的 JSON（http(s) 部署时可选拷贝，便于单目录托管） */
  function wikiAvatarsFetchUrls() {
    var list = [];
    try {
      list.push(new URL("./wiki_avatars.min.json", window.location.href).href);
    } catch (e1) {}
    try {
      list.push(new URL("../avatar/wiki_avatars.min.json", window.location.href).href);
    } catch (e2) {}
    return list;
  }

  function fetchWikiAvatarsJsonSequential(urls, idx) {
    if (idx >= urls.length) return Promise.reject(new Error("wiki json"));
    return fetch(urls[idx])
      .then(function (res) {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .catch(function () {
        return fetchWikiAvatarsJsonSequential(urls, idx + 1);
      });
  }

  /**
   * 1) wiki_avatars.embed.js 已写入 window.__PAIZHOU_WIKI_AVATARS__ 时直接用（含 file://）。
   * 2) 否则 http(s) 下按顺序 fetch：同目录 wiki_avatars.min.json → 上级 avatar/。
   */
  function loadWikiAvatarsOnce() {
    if (wikiAvatarsLoadPromise) return wikiAvatarsLoadPromise;
    var pre = typeof window.__PAIZHOU_WIKI_AVATARS__ === "object" && window.__PAIZHOU_WIKI_AVATARS__;
    if (pre && typeof pre.byName === "object") {
      wikiAvatarsLoadPromise = Promise.resolve(ingestWikiAvatarsPayload(pre));
      return wikiAvatarsLoadPromise;
    }
    if (String(window.location.protocol || "").toLowerCase() === "file:") {
      wikiAvatarByName = null;
      wikiCharNameKeys = null;
      wikiAvatarsLoadPromise = Promise.resolve(null);
      return wikiAvatarsLoadPromise;
    }
    var urls = wikiAvatarsFetchUrls();
    if (!urls.length) {
      wikiAvatarByName = null;
      wikiCharNameKeys = null;
      wikiAvatarsLoadPromise = Promise.resolve(null);
      return wikiAvatarsLoadPromise;
    }
    wikiAvatarsLoadPromise = fetchWikiAvatarsJsonSequential(urls, 0)
      .then(ingestWikiAvatarsPayload)
      .catch(function () {
        wikiAvatarByName = null;
        wikiCharNameKeys = null;
        return null;
      });
    return wikiAvatarsLoadPromise;
  }

  function getWikiAvatarRowForName(name) {
    var n = String(name || "").trim();
    if (!n || !wikiAvatarByName) return null;
    var row = wikiAvatarByName[n];
    if (!row || typeof row.avatar !== "string" || !row.avatar.trim()) return null;
    return row;
  }

  function hideCharNameSuggest() {
    var ul = document.getElementById("charNameSuggest");
    if (!ul) return;
    ul.classList.add("is-hidden");
    ul.innerHTML = "";
  }

  function filterWikiCharNamesForSuggest(query, limit) {
    var lim = typeof limit === "number" ? limit : 30;
    var q = String(query || "").trim();
    if (!wikiCharNameKeys || !wikiCharNameKeys.length) return [];
    if (!q) return wikiCharNameKeys.slice(0, lim);
    var lower = q.toLowerCase();
    var hits = [];
    var i;
    for (i = 0; i < wikiCharNameKeys.length; i += 1) {
      var k = wikiCharNameKeys[i];
      if (k.indexOf(q) >= 0 || k.toLowerCase().indexOf(lower) >= 0) hits.push(k);
    }
    hits.sort(function (a, b) {
      var ap = a.indexOf(q) === 0 ? 0 : 1;
      var bp = b.indexOf(q) === 0 ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.localeCompare(b, "zh-Hans-CN");
    });
    return hits.slice(0, lim);
  }

  function renderCharNameSuggest(query) {
    var ul = document.getElementById("charNameSuggest");
    if (!ul || !wikiCharNameKeys) return;
    var names = filterWikiCharNamesForSuggest(query, 30);
    ul.innerHTML = "";
    if (!names.length) {
      ul.classList.add("is-hidden");
      return;
    }
    names.forEach(function (name) {
      var li = document.createElement("li");
      li.className = "char-name-suggest-item";
      li.setAttribute("role", "option");
      li.textContent = name;
      li.dataset.name = name;
      ul.appendChild(li);
    });
    ul.classList.remove("is-hidden");
  }

  /** 角色录入弹窗：名称与 Wiki 完全一致时用库内头像 URL（不覆盖已有自定义头像） */
  function tryWikiAvatarFromCharNameInput(form) {
    if ((state.selected.mode || "") !== "char" || !form || !form.charName) return;
    var nm = (form.charName.value || "").trim();
    var row = getWikiAvatarRowForName(nm);
    if (!row) return;
    var cur = String(state.modalAvatarData || "").trim();
    if (cur) return;
    state.modalAvatarData = row.avatar;
    setAvatarPreview(row.avatar);
  }

  /** 保存时：若角色尚无头像且 Wiki 有同名条目，写入 Wiki 头像 URL */
  function applyWikiAvatarIfCharHasNoAvatar(char) {
    if (!char || !wikiAvatarByName) return;
    if (String(char.avatar || "").trim()) return;
    var row = getWikiAvatarRowForName(char.charName);
    if (row && row.avatar) char.avatar = row.avatar;
  }

  /** 对全队无头像且 Wiki 可匹配的角色补头像；有任意变更返回 true */
  function syncWikiAvatarsIntoRosterChars() {
    if (!wikiAvatarByName) return false;
    var changed = false;
    for (var i = 0; i < state.roster.length; i += 1) {
      var ch = state.roster[i];
      if (!ch || typeof ch !== "object") continue;
      var before = String(ch.avatar || "").trim();
      applyWikiAvatarIfCharHasNoAvatar(ch);
      if (String(ch.avatar || "").trim() !== before) changed = true;
    }
    return changed;
  }

  /** 分享/JSON 导入或本地读档后：加载 Wiki 库并为缺头像角色补图 */
  function refreshWikiAvatarsOnRosterThenRerender() {
    return loadWikiAvatarsOnce().then(function () {
      if (!syncWikiAvatarsIntoRosterChars()) return;
      renderParty();
      rebuildBuffGrid();
      updateStatsPanel(calcSummary());
      saveToStorage();
    });
  }

  function parseNumber(input, fallback) {
    var val = Number(input);
    return Number.isFinite(val) ? val : fallback;
  }

  function initHandlers() {
    var teamNameText = document.getElementById("teamNameText");
    var teamNoteText = document.getElementById("teamNoteText");
    var teamNameInput = document.getElementById("teamNameInput");
    var teamNoteInput = document.getElementById("teamNoteInput");
    var teamMetaEditBtns = document.querySelectorAll(".team-meta-edit");

    var metaEditingKey = null;
    var metaEditingRow = null;
    var metaCommitting = false;

    function renderTeamMetaUI() {
      var tn = (state.teamName || "").trim();
      var tno = String(state.teamNote || "");
      if (teamNameText) teamNameText.textContent = tn || "未设置";
      if (teamNoteText) {
        // textarea 可能含换行：展示时用空格替换以免撑开行高
        teamNoteText.textContent = tno.trim() ? tno.replace(/\n/g, " ") : "未设置";
      }
      if (teamNameInput) teamNameInput.value = tn;
      if (teamNoteInput) teamNoteInput.value = tno;

      // 收起编辑框（不管之前是否正在编辑）
      if (metaEditingKey) {
        metaEditingKey = null;
        metaEditingRow = null;
      }
      if (teamNameInput && teamNameInput.classList) teamNameInput.classList.add("is-hidden");
      if (teamNoteInput && teamNoteInput.classList) teamNoteInput.classList.add("is-hidden");
      if (teamNameText && teamNameText.classList) teamNameText.classList.remove("is-hidden");
      if (teamNoteText && teamNoteText.classList) teamNoteText.classList.remove("is-hidden");
      teamMetaEditBtns.forEach(function (btn) {
        if (btn.classList) btn.classList.remove("is-hidden");
      });
    }

    function openMetaEditor(metaKey) {
      if (!metaKey) return;
      renderTeamMetaUI(); // 先统一收起，避免状态错乱

      metaEditingKey = metaKey;
      if (metaKey === "teamName") {
        if (teamNameInput) teamNameInput.classList.remove("is-hidden");
        if (teamNameText) teamNameText.classList.add("is-hidden");
        if (teamNameInput) teamNameInput.focus();
        if (teamNameInput) teamNameInput.select();
        metaEditingRow = teamNameInput ? teamNameInput.closest(".team-meta-row") : null;
      } else {
        if (teamNoteInput) teamNoteInput.classList.remove("is-hidden");
        if (teamNoteText) teamNoteText.classList.add("is-hidden");
        if (teamNoteInput) teamNoteInput.focus();
        metaEditingRow = teamNoteInput ? teamNoteInput.closest(".team-meta-row") : null;
      }

      // 隐藏当前行的“编辑”按钮
      teamMetaEditBtns.forEach(function (btn) {
        if (!btn || !btn.dataset) return;
        if (btn.dataset.meta === metaKey && btn.closest(".team-meta-row") === metaEditingRow) {
          btn.classList.add("is-hidden");
        }
      });
    }

    function commitMeta(metaKey) {
      if (metaCommitting) return;
      if (!metaKey) return;
      metaCommitting = true;
      try {
        if (metaKey === "teamName") {
          state.teamName = String((teamNameInput && teamNameInput.value) || "").trim();
        } else if (metaKey === "teamNote") {
          state.teamNote = String((teamNoteInput && teamNoteInput.value) || "");
        }
        saveToStorage();
        renderTeamMetaUI();
      } finally {
        metaCommitting = false;
        metaEditingKey = null;
        metaEditingRow = null;
      }
    }

    // 初次渲染
    renderTeamMetaUI();

    // 编辑按钮
    teamMetaEditBtns.forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        var key = (btn.dataset && btn.dataset.meta) || "";
        if (!key) return;
        openMetaEditor(key);
      });
    });

    // 回车提交
    if (teamNameInput) {
      teamNameInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          commitMeta("teamName");
        }
      });
    }
    if (teamNoteInput) {
      teamNoteInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          commitMeta("teamNote");
        }
      });
    }

    // 点击其它地方提交并收起
    document.addEventListener("mousedown", function (e) {
      if (!metaEditingKey) return;
      var target = e.target;
      if (!target || !metaEditingRow) return;
      if (metaEditingRow.contains(target)) return;
      commitMeta(metaEditingKey);
    });

    function swapRosterCells(srcIdx, dstIdx) {
      if (!Number.isInteger(srcIdx) || !Number.isInteger(dstIdx) || srcIdx === dstIdx) return;
      var src = state.roster[srcIdx] || {};
      state.roster[srcIdx] = state.roster[dstIdx] || {};
      state.roster[dstIdx] = src;
      renderParty();
      rebuildBuffGrid();
      updateStatsPanel(calcSummary());
      saveToStorage();
    }

    function swapTurnActions(charIdx, turnA, turnB) {
      if (!Number.isInteger(charIdx) || charIdx < 0 || charIdx > 7) return;
      if (!Number.isInteger(turnA) || !Number.isInteger(turnB)) return;
      if (turnA === turnB || turnA < 1 || turnA > state.turnCount || turnB < 1 || turnB > state.turnCount) return;

      var char = ensureChar(charIdx);
      if (!char.turns) char.turns = {};
      var a = char.turns[turnA];
      var b = char.turns[turnB];
      char.turns[turnA] = b;
      char.turns[turnB] = a;

      renderParty();
      rebuildBuffGrid();
      updateStatsPanel(calcSummary());
      saveToStorage();
    }

    var partyGrid = document.getElementById("partyGrid");

    // 回合行动图标拖拽交换（同一角色格内：交换两个 turn slot 的内容）
    partyGrid.addEventListener("dragstart", function (e) {
      var turnBtn = e.target.closest('.turn-box[data-mode="turn"]');
      if (!turnBtn) return;

      // 确保是可拖拽的回合按钮（被动“被”不在这里）
      if (turnBtn.draggable === false) return;
      if (state.turnDragging) return;

      var idx = Number(turnBtn.dataset.idx);
      var turn = Number(turnBtn.dataset.turn);
      if (!Number.isInteger(idx) || !Number.isInteger(turn)) return;

      state.turnDragging = { idx: idx, turn: turn };
      state.preventTurnClick = true;

      turnBtn.classList.add("is-dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", "turn:" + idx + ":" + turn);
      }
    });

    partyGrid.addEventListener("dragover", function (e) {
      var targetTurnBtn = e.target.closest('.turn-box[data-mode="turn"]');
      if (!targetTurnBtn || !state.turnDragging) return;

      var targetIdx = Number(targetTurnBtn.dataset.idx);
      var targetTurn = Number(targetTurnBtn.dataset.turn);
      if (!Number.isInteger(targetIdx) || !Number.isInteger(targetTurn)) return;

      // 必须同一个角色格，且不能放到自己身上
      if (targetIdx !== state.turnDragging.idx || targetTurn === state.turnDragging.turn) return;

      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      targetTurnBtn.classList.add("is-drop-target");
    });

    partyGrid.addEventListener("dragleave", function (e) {
      var targetTurnBtn = e.target.closest('.turn-box[data-mode="turn"]');
      if (!targetTurnBtn) return;
      targetTurnBtn.classList.remove("is-drop-target");
    });

    partyGrid.addEventListener("drop", function (e) {
      var targetTurnBtn = e.target.closest('.turn-box[data-mode="turn"]');
      if (!targetTurnBtn || !state.turnDragging) return;

      e.preventDefault();

      var targetIdx = Number(targetTurnBtn.dataset.idx);
      var targetTurn = Number(targetTurnBtn.dataset.turn);
      if (!Number.isInteger(targetIdx) || !Number.isInteger(targetTurn)) return;

      // 必须同一角色格
      if (targetIdx !== state.turnDragging.idx) return;

      var srcTurn = state.turnDragging.turn;
      swapTurnActions(state.turnDragging.idx, srcTurn, targetTurn);

      // 清理拖拽态
      state.turnDragging = null;
      state.preventTurnClick = false;
      partyGrid.querySelectorAll('.turn-box[data-mode="turn"]').forEach(function (btn) {
        btn.classList.remove("is-dragging");
        btn.classList.remove("is-drop-target");
      });
    });

    partyGrid.addEventListener("dragend", function () {
      state.turnDragging = null;
      state.preventTurnClick = false;
      partyGrid.querySelectorAll('.turn-box[data-mode="turn"]').forEach(function (btn) {
        btn.classList.remove("is-dragging");
        btn.classList.remove("is-drop-target");
      });
    });

    partyGrid.addEventListener("dragstart", function (e) {
      var card = e.target.closest(".char-card");
      if (!card) return;
      var idx = Number(card.dataset.idx);
      if (!Number.isInteger(idx)) return;

      // 如果是从 turn-box 拖拽来的，就不要触发整格交换逻辑
      var turnBtn = e.target.closest('.turn-box[data-mode="turn"]');
      if (turnBtn) return;

      state.draggingIdx = idx;
      card.classList.add("is-dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(idx));
      }
    });
    partyGrid.addEventListener("dragover", function (e) {
      var targetCard = e.target.closest(".char-card");
      if (!targetCard || state.draggingIdx === null) return;
      var targetIdx = Number(targetCard.dataset.idx);
      if (!Number.isInteger(targetIdx) || targetIdx === state.draggingIdx) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });
    partyGrid.addEventListener("dragenter", function (e) {
      var targetCard = e.target.closest(".char-card");
      if (!targetCard || state.draggingIdx === null) return;
      var targetIdx = Number(targetCard.dataset.idx);
      if (!Number.isInteger(targetIdx) || targetIdx === state.draggingIdx) return;
      targetCard.classList.add("is-drop-target");
    });
    partyGrid.addEventListener("dragleave", function (e) {
      var targetCard = e.target.closest(".char-card");
      if (!targetCard) return;
      targetCard.classList.remove("is-drop-target");
    });
    partyGrid.addEventListener("drop", function (e) {
      var targetCard = e.target.closest(".char-card");
      if (!targetCard || state.draggingIdx === null) return;
      e.preventDefault();
      var targetIdx = Number(targetCard.dataset.idx);
      if (!Number.isInteger(targetIdx)) return;
      targetCard.classList.remove("is-drop-target");
      swapRosterCells(state.draggingIdx, targetIdx);
      state.draggingIdx = null;
    });
    partyGrid.addEventListener("dragend", function () {
      state.draggingIdx = null;
      partyGrid.querySelectorAll(".char-card").forEach(function (card) {
        card.classList.remove("is-dragging");
        card.classList.remove("is-drop-target");
      });
    });

    partyGrid.addEventListener("click", function (e) {
      if (state.preventTurnClick) return;
      var portrait = e.target.closest(".char-portrait");
      if (portrait) {
        var pIdx = Number(portrait.dataset.idx);
        if (!Number.isInteger(pIdx)) return;
        openModal(pIdx, 0, "char");
        return;
      }

      var target = e.target.closest(".turn-box");
      if (!target) return;
      openModal(Number(target.dataset.idx), Number(target.dataset.turn), target.dataset.mode || "turn");
    });

    document.getElementById("avatarPickBtn").addEventListener("click", function () {
      var input = document.getElementById("avatarInput");
      if (input) input.click();
    });
    document.getElementById("avatarInput").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      readImageFileAsDataUrl(file, function (dataUrl) {
        state.modalAvatarData = dataUrl;
        setAvatarPreview(dataUrl);
      });
      e.target.value = "";
    });

    document.getElementById("charExtraToggle").addEventListener("click", function () {
      var toggle = document.getElementById("charExtraToggle");
      var body = document.getElementById("charExtraBody");
      if (!toggle || !body) return;
      var expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
      body.classList.toggle("is-hidden", expanded);
    });

    document.getElementById("addEffectBtn").addEventListener("click", function () {
      var form = document.getElementById("skillForm");
      var mode = state.selected.mode || "turn";
      var skillType = form.skillType ? form.skillType.value : "active";
      var allowSummon = !!(form.summonEnabled && form.summonEnabled.value === "true");
      var defaultZone = mode === "passive" ? "passive" : skillType === "ult" ? "ult" : "active";
      document.getElementById("effectsRows").appendChild(makeEffectRow(mode, { zone: defaultZone, type: "atk", value: "" }, skillType, allowSummon));
    });
    document.getElementById("cancelSkillBtn").addEventListener("click", closeModal);
    document.getElementById("resetCellBtn").addEventListener("click", function () {
      var mode = state.selected.mode || "";
      var idx = state.selected.idx;
      if (!Number.isInteger(idx)) return;
      if (mode !== "char" && mode !== "passive" && mode !== "turn") return;
      var ok = false;
      if (mode === "char") {
        ok = confirm("确认重置该单元格吗？将清空角色名、头像、被动和所有回合行动。");
      } else if (mode === "passive") {
        ok = confirm("确认重置该被动信息吗？");
      } else {
        ok = confirm("确认重置该回合行动信息吗？");
      }
      if (!ok) return;
      if (mode === "char") {
        state.roster[idx] = {};
      } else {
        var char = ensureChar(idx);
        if (mode === "passive") {
          delete char.passiveSkill;
        } else {
          var turn = state.selected.turn;
          if (char.turns && Number.isInteger(turn)) {
            delete char.turns[turn];
          }
        }
      }
      renderParty();
      rebuildBuffGrid();
      updateStatsPanel(calcSummary());
      saveToStorage();
      closeModal();
    });
    document.getElementById("skillModal").addEventListener("click", function (e) {
      if (e.target.id === "skillModal") closeModal();
    });
    document.getElementById("skillModal").addEventListener("paste", function (e) {
      if ((state.selected.mode || "") !== "char") return;
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i += 1) {
        var item = items[i];
        if (item.type && item.type.indexOf("image/") === 0) {
          var file = item.getAsFile();
          if (!file) return;
          readImageFileAsDataUrl(file, function (dataUrl) {
            state.modalAvatarData = dataUrl;
            setAvatarPreview(dataUrl);
          });
          e.preventDefault();
          return;
        }
      }
    });

    document.getElementById("skillForm").skillType.addEventListener("change", function (e) {
      var form = document.getElementById("skillForm");
      var skillType = e.target.value;
      if (form.summonName.value.trim() === "") {
        if (skillType === "ult") form.skillName.value = "必杀";
        if (skillType === "ex") form.skillName.value = "EX";
      }
      syncEffectRowsByForm(form, state.selected.mode || "turn");
    });

    document.getElementById("skillForm").summonEnabled.addEventListener("change", function () {
      var form = document.getElementById("skillForm");
      syncSkillNameRequirement(form, state.selected.mode || "turn");
      syncEffectRowsByForm(form, state.selected.mode || "turn");
    });

    document.getElementById("skillForm").chaseEnabled.addEventListener("change", function () {
      var form = document.getElementById("skillForm");
      syncSkillNameRequirement(form, state.selected.mode || "turn");
    });
    document.getElementById("skillForm").gutsEnabled.addEventListener("change", function () {
      var form = document.getElementById("skillForm");
      syncSkillNameRequirement(form, state.selected.mode || "turn");
    });
    document.getElementById("skillForm").stateSwitchEnabled.addEventListener("change", function () {
      var form = document.getElementById("skillForm");
      syncSkillNameRequirement(form, state.selected.mode || "turn");
    });

    document.getElementById("turnViewToggle").addEventListener("click", function (e) {
      var btn = e.target.closest(".view-toggle-btn");
      if (!btn) return;
      var nextView = btn.getAttribute("data-view");
      if (nextView !== "detailed" && nextView !== "simple") return;
      if (state.turnFormView === nextView) return;
      state.turnFormView = nextView;
      saveToStorage();

      applyTurnFormView(state.selected.mode || "turn", {
        turnViewToggle: document.getElementById("turnViewToggle"),
        turnWrap: document.getElementById("turnBadgeWrap"),
        bpField: document.getElementById("bpField"),
        shieldBreakField: document.getElementById("shieldBreakField"),
        actionRow3: document.getElementById("actionRow3"),
        actionRow4: document.getElementById("actionRow4"),
        actionRow5: document.getElementById("actionRow5"),
        statsFieldsWrap: document.getElementById("statsFieldsWrap"),
      });
    });

    document.getElementById("skillForm").summonName.addEventListener("input", function () {
      var form = document.getElementById("skillForm");
      syncSkillNameRequirement(form, state.selected.mode || "turn");
    });

    document.getElementById("skillForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var form = e.currentTarget;
      var err = document.getElementById("formError");
      var mode = state.selected.mode || "turn";
      err.textContent = "";

      if (mode === "char") {
        var onlyName = (form.charName.value || "").trim();
        if (!onlyName) {
          err.textContent = "角色名不能为空。";
          return;
        }
        var onlyChar = ensureChar(state.selected.idx);
        onlyChar.charName = onlyName;
        onlyChar.charNote = (form.charNote.value || "").trim();
        onlyChar.color = hashColor(onlyName);
        applyWikiAvatarIfCharHasNoAvatar(onlyChar);
        onlyChar.avatar = state.modalAvatarData || onlyChar.avatar || "";
        onlyChar.gear = {
          weapon: (form.gearWeapon.value || "").trim(),
          helmet: (form.gearHelmet.value || "").trim(),
          armor: (form.gearArmor.value || "").trim(),
          acc1: (form.gearAcc1.value || "").trim(),
          acc2: (form.gearAcc2.value || "").trim(),
          acc3: (form.gearAcc3.value || "").trim(),
          skill1: (form.gearSkill1.value || "").trim(),
          skill2: (form.gearSkill2.value || "").trim(),
          skill3: (form.gearSkill3.value || "").trim(),
          skill4: (form.gearSkill4.value || "").trim(),
        };
        renderParty();
        rebuildBuffGrid();
        updateStatsPanel(calcSummary());
        saveToStorage();
        closeModal();
        return;
      }

      if (mode === "turn") {
        var turn = state.selected.turn;
        if (turn < 1 || turn > state.turnCount || !Number.isInteger(turn)) {
          err.textContent = "发动回合只能是 1-" + state.turnCount + " 的整数。";
          return;
        }
      }

      var effects = [];
      document.querySelectorAll("#effectsRows .effect-row").forEach(function (row) {
        var zone = row.querySelector(".js-zone").value;
        var type = row.querySelector(".js-type").value;
        var value = parseNumber(row.querySelector(".js-value").value, 0);
        var note = (row.querySelector(".js-note").value || "").trim();
        if (value > 0) effects.push({ zone: zone, type: type, value: value, note: zone === "passive" ? note : "" });
      });

      var char = ensureChar(state.selected.idx);
      var charName = (form.charName.value || "").trim();
      char.charName = charName || "未命名角色";
      char.color = hashColor(char.charName);
      applyWikiAvatarIfCharHasNoAvatar(char);
      var summonName = (form.summonName.value || "").trim();
      var rawSkillName = (form.skillName.value || "").trim();
      var summonEnabled = form.summonEnabled.value === "true";
      var gutsEnabled = form.gutsEnabled.value === "true";
      var stateSwitchEnabled = form.stateSwitchEnabled.value === "true";
      var chaseEnabled = form.chaseEnabled.value === "true";
      var finalSkillName = mode === "passive" ? "被动" : rawSkillName;
      var finalSkillType = mode === "passive" ? "" : form.skillType.value || "active";
      if (mode !== "passive" && rawSkillName === "") {
        finalSkillType = "";
      }
      if (mode === "turn" && !rawSkillName && !summonEnabled && !chaseEnabled && !gutsEnabled && !stateSwitchEnabled) {
        err.textContent = "行动方式至少填写一项：技能名 / 发动支炎兽 / 发动底力 / 切换状态 / 发动追击。";
        return;
      }

      var payload = {
        skillName: finalSkillName,
        turn: mode === "passive" ? 0 : state.selected.turn,
        skillType: finalSkillType,
        bp: mode === "passive" ? 0 : parseNumber(form.bp.value, 0),
        summonName: summonName,
        shieldBreak: parseNumber(form.shieldBreak.value, 0),
        summonEnabled: summonEnabled,
        summonBp: parseNumber(form.summonBp.value, 0),
        summonBreak: parseNumber(form.summonBreak.value, 0),
        gutsEnabled: gutsEnabled,
        stateSwitchEnabled: stateSwitchEnabled,
        chaseEnabled: chaseEnabled,
        chaseCount: 0,
        chaseBreak: parseNumber(form.chaseBreak.value, 0),
        effects: effects,
        power: parseNumber(form.power.value, 0),
        upper: parseNumber(form.upper.value, 0),
        bean: parseNumber(form.bean.value, 0),
        ultGauge: parseNumber(form.ultGauge.value, 0),
        crit: form.crit.value === "true",
      };

      if (mode === "passive") {
        char.passiveSkill = payload;
      } else {
        char.turns[state.selected.turn] = payload;
      }

      rebuildBuffGrid();
      updateStatsPanel(calcSummary());
      renderParty();
      saveToStorage();
      closeModal();
    });

    document.getElementById("exportBtn").addEventListener("click", exportData);
    document.getElementById("exportQrBtn").addEventListener("click", function () {
      openQrExportModal().catch(function (err) {
        console.error(err);
        alert("导出二维码失败：" + (err && err.message ? err.message : String(err)));
      });
    });
    document.getElementById("qrModalClose").addEventListener("click", closeQrExportModal);
    document.getElementById("qrModalBackdrop").addEventListener("click", function (e) {
      if (e.target.id === "qrModalBackdrop") closeQrExportModal();
    });
    document.getElementById("qrModalCopy").addEventListener("click", async function () {
      var ta = document.getElementById("qrModalUrl");
      if (!ta) return;
      try {
        await navigator.clipboard.writeText(ta.value || "");
      } catch (e) {
        ta.focus();
        ta.select();
        alert("复制失败：请手动复制文本框内容。");
      }
    });
    var shareImportQrFile = document.getElementById("shareImportQrFile");
    if (shareImportQrFile) {
      shareImportQrFile.addEventListener("change", function (e) {
        var fn = document.getElementById("shareImportFileName");
        var f = e.target.files && e.target.files[0];
        if (fn) fn.textContent = f ? f.name : "";
      });
    }
    var importJsonFileEl = document.getElementById("importJsonFile");
    if (importJsonFileEl) {
      importJsonFileEl.addEventListener("change", function (e) {
        var jn = document.getElementById("importJsonFileName");
        var f = e.target.files && e.target.files[0];
        if (jn) jn.textContent = f ? f.name : "";
      });
    }
    var shareImportCancel = document.getElementById("shareImportCancel");
    if (shareImportCancel) shareImportCancel.addEventListener("click", closeImportDataModal);
    var shareImportBackdrop = document.getElementById("shareImportModalBackdrop");
    if (shareImportBackdrop) {
      shareImportBackdrop.addEventListener("click", function (e) {
        if (e.target.id === "shareImportModalBackdrop") closeImportDataModal();
      });
    }
    var shareImportConfirm = document.getElementById("shareImportConfirm");
    if (!shareImportConfirm) {
      console.warn("导入确认按钮缺失（shareImportConfirm），请同步部署 index.html。");
    } else shareImportConfirm.addEventListener("click", function () {
      var jsonIn = document.getElementById("importJsonFile");
      var jsonFile = jsonIn && jsonIn.files && jsonIn.files[0];
      var ta = document.getElementById("shareImportTextarea");
      var raw = ta ? ta.value : "";
      var tokenFromLink = extractShareTokenFromPaste(raw);
      var qrInput = document.getElementById("shareImportQrFile");
      var qrFile = qrInput && qrInput.files && qrInput.files[0];

      function finishShareImport(token) {
        return applyShareTokenToState(token).then(function () {
          applyCellCapsToDom();
          renderParty();
          rebuildBuffGrid();
          updateStatsPanel(calcSummary());
          renderTeamMetaUI();
          closeImportDataModal();
        });
      }

      if (jsonFile) {
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var parsed = JSON.parse(String(reader.result || "{}"));
            applyImportedData(parsed);
            renderTeamMetaUI();
            closeImportDataModal();
          } catch (err) {
            alert("JSON 导入失败：格式不正确");
          }
        };
        reader.readAsText(jsonFile, "utf-8");
        return;
      }

      if (tokenFromLink) {
        finishShareImport(tokenFromLink).catch(function (err) {
          console.error(err);
          alert("导入失败：数据损坏、格式不对或不兼容。");
        });
        return;
      }

      if (qrFile) {
        decodeQrFromImageFile(qrFile)
          .then(function (decodedText) {
            var tokenFromImg = extractShareTokenFromPaste(decodedText);
            if (!tokenFromImg) {
              throw new Error("图中识别出的内容不是有效分享链接或分享码");
            }
            return finishShareImport(tokenFromImg);
          })
          .catch(function (err) {
            console.error(err);
            alert(
              "从图片导入失败：" +
                (err && err.message ? err.message : String(err)) +
                "（可改用粘贴链接；若缺少识别库请确认 paiZhouUtil/vendor/jsqr.bundle.js 存在并执行 npm run vendor 重新打包）"
            );
          });
        return;
      }

      alert("请选择 JSON 文件、粘贴分享链接/分享码，或选择二维码截图。");
    });
    document.getElementById("resetBtn").addEventListener("click", function () {
      var ok = confirm("确认重置全部数据吗？此操作不可撤销。");
      if (!ok) return;
      resetAllData();
      renderTeamMetaUI();
    });
    document.getElementById("importBtn").addEventListener("click", function () {
      openImportDataModal();
    });

    document.getElementById("turnFilterSlots").addEventListener("click", function (e) {
      var addBtn = e.target.closest(".turn-filter-add");
      if (addBtn) {
        state.turnCount = clampTurnCount(state.turnCount + 1);
        renderParty();
        saveToStorage();
        return;
      }

      var removeBtn = e.target.closest(".turn-filter-remove");
      if (removeBtn) {
        if (state.turnCount <= 1) return;
        var lastTurn = state.turnCount;
        var ok = confirm("确认删除最后一个回合（T" + lastTurn + "）吗？该回合行动将被清空。");
        if (!ok) return;

        state.roster.forEach(function (char) {
          if (!char || !char.turns) return;
          delete char.turns[lastTurn];
        });
        if (state.turnFilter === lastTurn) state.turnFilter = null;
        if (state.selected.turn === lastTurn) state.selected.turn = Math.max(1, lastTurn - 1);
        state.turnCount = clampTurnCount(lastTurn - 1);

        renderParty();
        rebuildBuffGrid();
        updateStatsPanel(calcSummary());
        saveToStorage();
        return;
      }

      var btn = e.target.closest(".turn-filter-box");
      if (!btn) return;
      var turn = Number(btn.dataset.turn);
      state.turnFilter = state.turnFilter === turn ? null : turn;
      document.querySelectorAll(".turn-filter-box").forEach(function (item) {
        item.classList.toggle("is-active", Number(item.dataset.turn) === state.turnFilter);
      });
      renderParty();
    });

    document.getElementById("capEditorCancel").addEventListener("click", closeCapEditor);
    document.getElementById("capEditorSave").addEventListener("click", saveCapEditorValue);
    document.getElementById("capEditorBackdrop").addEventListener("click", function (e) {
      if (e.target.id === "capEditorBackdrop") closeCapEditor();
    });
    document.getElementById("capEditorInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        saveCapEditorValue();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeCapEditor();
      }
    });

    var charNameInput = document.getElementById("charNameInput");
    var charNameSuggest = document.getElementById("charNameSuggest");
    if (charNameInput && charNameSuggest) {
      var charNameBlurTimer = null;
      charNameInput.addEventListener("focus", function () {
        loadWikiAvatarsOnce().then(function () {
          renderCharNameSuggest(charNameInput.value);
        });
      });
      charNameInput.addEventListener("input", function () {
        loadWikiAvatarsOnce().then(function () {
          renderCharNameSuggest(charNameInput.value);
          var form = document.getElementById("skillForm");
          if (form && (state.selected.mode || "") === "char") tryWikiAvatarFromCharNameInput(form);
        });
      });
      charNameInput.addEventListener("blur", function () {
        if (charNameBlurTimer) clearTimeout(charNameBlurTimer);
        charNameBlurTimer = window.setTimeout(function () {
          charNameBlurTimer = null;
          hideCharNameSuggest();
        }, 200);
      });
      charNameSuggest.addEventListener("mousedown", function (e) {
        var li = e.target.closest(".char-name-suggest-item");
        if (!li) return;
        e.preventDefault();
        var name = (li.dataset && li.dataset.name) || (li.textContent || "").trim();
        if (!name) return;
        charNameInput.value = name;
        var form = document.getElementById("skillForm");
        if (form && form.charName) form.charName.value = name;
        hideCharNameSuggest();
        loadWikiAvatarsOnce().then(function () {
          if (form) tryWikiAvatarFromCharNameInput(form);
        });
      });
    }
    loadWikiAvatarsOnce();
  }

  document.addEventListener("DOMContentLoaded", function () {
    tryImportFromShareUrl()
      .then(function (imported) {
        if (!imported) loadFromStorage();
        initTooltipSystem();
        initCapEditors();
        if (!state.cellCaps || !Object.keys(state.cellCaps).length) {
          state.cellCaps = collectCellCapsFromDom();
        } else {
          applyCellCapsToDom();
        }
        syncBuffLayout(document);
        initHandlers();
        renderParty();
        rebuildBuffGrid();
        updateStatsPanel(calcSummary());
        refreshWikiAvatarsOnRosterThenRerender();
      })
      .catch(function () {
        loadFromStorage();
        initTooltipSystem();
        initCapEditors();
        if (!state.cellCaps || !Object.keys(state.cellCaps).length) {
          state.cellCaps = collectCellCapsFromDom();
        } else {
          applyCellCapsToDom();
        }
        syncBuffLayout(document);
        initHandlers();
        renderParty();
        rebuildBuffGrid();
        updateStatsPanel(calcSummary());
        refreshWikiAvatarsOnRosterThenRerender();
      });
  });
})();
