"""
楽天ライバル定点観測スクリプト（新API版 openapi.rakuten.co.jp）
"""
import json, time, os, base64
from datetime import datetime, timezone, timedelta
import urllib.request, urllib.parse

SNAPSHOTS_FILE = "data/snapshots.json"
SUMMARY_FILE   = "data/latest_summary.json"
ALERTS_FILE    = "data/alerts.json"
ITEMS_PER_SHOP = 30
SLEEP_SEC      = 1.0
JST            = timezone(timedelta(hours=9))

APP_ID     = os.environ.get("RAKUTEN_APP_ID", "")
ACCESS_KEY = os.environ.get("RAKUTEN_ACCESS_KEY", "")

SHOPS = [
    {"no":"1","name":"Porto 楽天市場店","sid":"338610"},
    {"no":"2","name":"Trade-ABC 楽天市場店","sid":"397933"},
    {"no":"3","name":"フエロショップ 楽天市場店","sid":"363823"},
    {"no":"6","name":"カラダノミライ 自然通販","sid":"302794"},
    {"no":"7","name":"リムストア","sid":"399177"},
    {"no":"9","name":"LASIEM（ラシエム）","sid":"366493"},
    {"no":"11","name":"e-kit（いーきっと）","sid":"347924"},
    {"no":"12","name":"ddice","sid":"339164"},
    {"no":"13","name":"Lumiere","sid":"381078"},
    {"no":"14","name":"PolaPola楽天市場店","sid":"407241"},
    {"no":"15","name":"Queens Land","sid":"276423"},
    {"no":"16","name":"roryXtyle","sid":"264063"},
    {"no":"17","name":"Barsado","sid":"310070"},
    {"no":"18","name":"MWJ TOKYO","sid":"299452"},
    {"no":"19","name":"C.C.C STORES","sid":"210048"},
    {"no":"20","name":"Across【アクロース】","sid":"349310"},
    {"no":"21","name":"Trend Style 楽天市場店","sid":"283235"},
    {"no":"22","name":"grepo 楽天市場店","sid":"377037"},
    {"no":"23","name":"ハッピートーク楽天市場店","sid":"384887"},
    {"no":"24","name":"輸入品屋さん","sid":"206370"},
    {"no":"25","name":"生活雑貨グラシア","sid":"366975"},
    {"no":"26","name":"MAPLE517","sid":"254770"},
    {"no":"27","name":"サトウ楽天市場店","sid":"362383"},
    {"no":"28","name":"GLANCIA 楽天市場店","sid":"404024"},
    {"no":"29","name":"jhstudio楽天市場店","sid":"367538"},
    {"no":"30","name":"オーダー服と布マスクのコモンママ","sid":"317090"},
    {"no":"31","name":"KQueenStore","sid":"322345"},
    {"no":"32","name":"台湾 kawaii shop","sid":"350613"},
    {"no":"33","name":"SIMPS SHOP","sid":"357772"},
    {"no":"34","name":"液晶保護フィルムとカバーケース卸","sid":"313270"},
    {"no":"35","name":"スタンダード","sid":"333309"},
    {"no":"36","name":"Gutto楽天市場店","sid":"330654"},
    {"no":"37","name":"便利雑貨ショップ umiwo","sid":"342783"},
    {"no":"38","name":"くらし応援ショップ サンキュー","sid":"360349"},
    {"no":"40","name":"雑貨屋マイスター","sid":"311815"},
    {"no":"42","name":"小物専門店のSOLE I L","sid":"376023"},
    {"no":"44","name":"APNショップ","sid":"304818"},
    {"no":"45","name":"Rinrin Store","sid":"339882"},
    {"no":"46","name":"LARUTANオンラインショップ","sid":"396364"},
    {"no":"47","name":"tempostar","sid":"406187"},
    {"no":"48","name":"アイデアグッズのララフェスタ","sid":"287591"},
    {"no":"49","name":"motto-motto","sid":"384255"},
    {"no":"50","name":"タブレット スマホホルダーecoride","sid":"322293"},
    {"no":"51","name":"ADXI","sid":"399610"},
    {"no":"52","name":"TheBestDay楽天市場店","sid":"408415"},
    {"no":"53","name":"日用雑貨のH・T 楽天市場店","sid":"369110"},
    {"no":"54","name":"アリージェム","sid":"362251"},
    {"no":"55","name":"SweetSweet Shop","sid":"371892"},
    {"no":"56","name":"エクレボ 楽天市場店","sid":"278191"},
    {"no":"57","name":"スリーアール","sid":"277890"},
    {"no":"58","name":"シェリーショップ","sid":"229638"},
    {"no":"59","name":"便利グッズのお店 AQSHOP","sid":"321840"},
    {"no":"60","name":"プランドル楽天市場店","sid":"313202"},
    {"no":"61","name":"THTECH","sid":"365774"},
    {"no":"62","name":"CENTRALITY 楽天市場店","sid":"385884"},
    {"no":"64","name":"ONE DAZE","sid":"363503"},
    {"no":"65","name":"UNICONA 楽天市場店","sid":"360077"},
    {"no":"66","name":"大江ESHOP","sid":"334563"},
    {"no":"68","name":"MILASIC","sid":"371705"},
    {"no":"69","name":"よろず生活雑貨屋レーベンウッド","sid":"383523"},
    {"no":"70","name":"1st Market","sid":"302982"},
    {"no":"71","name":"e-monoplus","sid":"390105"},
    {"no":"72","name":"mitas","sid":"263585"},
    {"no":"73","name":"hidekistore","sid":"386514"},
    {"no":"74","name":"Shining Stars","sid":"411282"},
    {"no":"75","name":"ドリームマックス","sid":"268249"},
    {"no":"76","name":"ぷらす堂","sid":"367615"},
]

def fetch_items(shop_code):
    params = {
        "format":    "json",
        "keyword":   "",
        "shopCode":  shop_code,
        "hits":      30,
        "sort":      "-reviewCount",
    }
    url = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?" \
          + urllib.parse.urlencode(params)
    credentials = base64.b64encode(f"{APP_ID}:{ACCESS_KEY}".encode()).decode()
    req = urllib.request.Request(url, headers={
        "Authorization": f"Basic {credentials}",
        "Content-Type":  "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if "error" in data:
                print(f"    [API ERROR] {data.get('error')}: {data.get('error_description','')}")
                return None
            return data
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"    [HTTP {e.code}] {body[:300]}")
        return None
    except Exception as e:
        print(f"    [ERROR] {e}")
        return None

def collect_shop(sid):
    data = fetch_items(sid)
    if not data or "Items" not in data:
        return []
    items = []
    for entry in data["Items"][:ITEMS_PER_SHOP]:
        it = entry.get("Item", entry)
        items.append({
            "item_id":      str(it.get("itemCode", "")),
            "name":         it.get("itemName", "")[:80],
            "price":        int(it.get("itemPrice", 0)),
            "review_count": int(it.get("reviewCount", 0)),
            "review_avg":   float(it.get("reviewAverage", 0)),
            "url":          it.get("itemUrl", ""),
        })
    return items

def estimate_weekly_sales(delta):
    if not delta or delta <= 0: return None
    return {"low":round(delta/0.05),"high":round(delta/0.03),"mid":round(delta/0.04)}

def detect_alerts(shop_name, prev_items, curr_items, week):
    alerts = []
    prev_map = {it["item_id"]: it for it in prev_items}
    for iid, curr in {it["item_id"]:it for it in curr_items}.items():
        if iid not in prev_map:
            alerts.append({"type":"new_item","level":"info","shop":shop_name,"week":week,
                           "message":f"新商品：{curr['name'][:40]}","detail":{"price":curr["price"]}})
            continue
        prev = prev_map[iid]
        if prev["price"]>0 and curr["price"]>0:
            pct=(curr["price"]-prev["price"])/prev["price"]*100
            if pct<=-5:
                alerts.append({"type":"price_drop","level":"danger","shop":shop_name,"week":week,
                               "message":f"値下げ {pct:.1f}%：{curr['name'][:40]}",
                               "detail":{"prev":prev["price"],"curr":curr["price"]}})
        delta=curr["review_count"]-prev["review_count"]
        if delta>=20:
            alerts.append({"type":"review_spike","level":"warn","shop":shop_name,"week":week,
                           "message":f"レビュー急増 +{delta}件：{curr['name'][:40]}",
                           "detail":{"delta":delta,"est":estimate_weekly_sales(delta)}})
    return alerts

def load_json(path, default):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f: return json.load(f)
    return default

def save_json(path, data):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path,"w",encoding="utf-8") as f: json.dump(data,f,ensure_ascii=False,indent=2)

def main():
    if not APP_ID or not ACCESS_KEY:
        print("ERROR: RAKUTEN_APP_ID または RAKUTEN_ACCESS_KEY が未設定"); return

    now  = datetime.now(JST)
    week = f"W{now.strftime('%Y-%m-%d')}"
    print("="*56)
    print(f"  楽天ライバル定点観測（新API版）")
    print(f"  実行日時: {now.strftime('%Y/%m/%d %H:%M')} JST")
    print(f"  APP_ID: {APP_ID[:8]}...")
    print("="*56)

    snapshots=load_json(SNAPSHOTS_FILE,{})
    all_alerts=load_json(ALERTS_FILE,[])
    summary_shops=[]

    for shop in SHOPS:
        sid,name,no = shop["sid"],shop["name"],shop["no"]
        print(f"\n▶ [{no:>2}] {name}")
        curr_items=collect_shop(sid)
        if not curr_items:
            print(f"      スキップ"); continue
        print(f"      取得: {len(curr_items)}商品 / 最多レビュー: {curr_items[0]['review_count']}件")

        prev_snap=snapshots.get(sid,{}).get("latest_items",[])
        if prev_snap:
            new_alerts=detect_alerts(name,prev_snap,curr_items,week)
            for a in new_alerts:
                print(f"      {'🔴' if a['level']=='danger' else '⚠️' if a['level']=='warn' else '✅'} {a['message']}")
            all_alerts.extend(new_alerts)

        prev_map={it["item_id"]:it for it in prev_snap}
        items_with_delta=[]
        for item in curr_items:
            d=dict(item)
            prev=prev_map.get(item["item_id"])
            if prev:
                d["review_delta"]=item["review_count"]-prev["review_count"]
                d["price_delta"]=item["price"]-prev["price"]
                d["est_sales"]=estimate_weekly_sales(d["review_delta"])
            else:
                d["review_delta"]=d["price_delta"]=d["est_sales"]=None
            items_with_delta.append(d)

        total_rev=sum(it["review_count"] for it in curr_items)
        total_delta=sum(it["review_delta"] for it in items_with_delta if it["review_delta"] is not None)
        shop_est=estimate_weekly_sales(total_delta) if total_delta>0 else None
        if shop_est: print(f"      推定週販売: {shop_est['low']:,}〜{shop_est['high']:,} 個/週")
        else: print(f"      累計レビュー: {total_rev:,}")

        if sid not in snapshots: snapshots[sid]={"history":[]}
        snapshots[sid]["latest_items"]=curr_items
        snapshots[sid]["history"].append({"week":week,"timestamp":now.isoformat(),
            "total_reviews":total_rev,"item_count":len(curr_items),"items":items_with_delta})

        summary_shops.append({"no":no,"name":name,"sid":sid,"total_reviews":total_rev,
            "item_count":len(curr_items),"weekly_delta":total_delta,"weekly_est":shop_est,
            "top_items":items_with_delta[:10],
            "alert_count":len([a for a in all_alerts if a["shop"]==name and a["week"]==week])})
        time.sleep(SLEEP_SEC)

    save_json(SNAPSHOTS_FILE,snapshots)
    save_json(ALERTS_FILE,all_alerts[-500:])
    save_json(SUMMARY_FILE,{"generated_at":now.isoformat(),"week":week,
        "shop_count":len(summary_shops),
        "alert_count":len([a for a in all_alerts if a["week"]==week]),
        "shops":summary_shops})

    print("\n"+"="*56)
    print(f"  完了: {len(summary_shops)}店舗取得")
    ranked=sorted([s for s in summary_shops if s["weekly_est"]],key=lambda x:x["weekly_est"]["mid"],reverse=True)
    for r in ranked[:10]:
        e=r["weekly_est"]
        print(f"  {r['name'][:24]:<26} {e['low']:>5,}〜{e['high']:>6,} 個/週")

if __name__=="__main__":
    main()
