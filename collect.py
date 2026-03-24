"""
楽天ライバル定点観測スクリプト（最終版）
新API: openapi.rakuten.co.jp
ショップコードはショップURLから取得
"""
import json, time, os
from datetime import datetime, timezone, timedelta
import urllib.request, urllib.parse

SNAPSHOTS_FILE = "data/snapshots.json"
SUMMARY_FILE   = "data/latest_summary.json"
ALERTS_FILE    = "data/alerts.json"
ITEM_COUNTS_FILE = "data/item_counts.json"  # ショップ別測定数
DEFAULT_ITEMS  = 15   # デフォルト測定数
SLEEP_SEC      = 1.5
JST            = timezone(timedelta(hours=9))
APP_ID         = os.environ.get("RAKUTEN_APP_ID", "")
ACCESS_KEY     = os.environ.get("RAKUTEN_ACCESS_KEY", "")

# shopCodeはURLから取得済み（sid→shopCode対応表）
SHOPS = [
    {"no":"1", "name":"Porto 楽天市場店",               "shopCode":"porto"},
    {"no":"2", "name":"Trade-ABC 楽天市場店",            "shopCode":"trade-abc"},
    {"no":"3", "name":"フエロショップ 楽天市場店",        "shopCode":"fuero"},
    {"no":"6", "name":"カラダノミライ 自然通販",          "shopCode":"karadanomirai"},
    {"no":"7", "name":"リムストア",                      "shopCode":"rimstore"},
    {"no":"9", "name":"LASIEM（ラシエム）",               "shopCode":"lasiem"},
    {"no":"11","name":"e-kit（いーきっと）",              "shopCode":"e-kit"},
    {"no":"12","name":"ddice",                           "shopCode":"ddice"},
    {"no":"13","name":"Lumiere",                         "shopCode":"lumiere-shop"},
    {"no":"14","name":"PolaPola楽天市場店",               "shopCode":"polapola"},
    {"no":"15","name":"Queens Land",                     "shopCode":"queensland"},
    {"no":"16","name":"roryXtyle",                       "shopCode":"roryx"},
    {"no":"17","name":"Barsado",                         "shopCode":"barsado"},
    {"no":"18","name":"MWJ TOKYO",                       "shopCode":"mwj-tokyo"},
    {"no":"19","name":"C.C.C STORES",                    "shopCode":"cccstores"},
    {"no":"20","name":"Across【アクロース】",             "shopCode":"across-shop"},
    {"no":"21","name":"Trend Style 楽天市場店",           "shopCode":"trendstyle"},
    {"no":"22","name":"grepo 楽天市場店",                 "shopCode":"grepo"},
    {"no":"23","name":"ハッピートーク楽天市場店",         "shopCode":"happytalk"},
    {"no":"24","name":"輸入品屋さん",                    "shopCode":"yunyuhinya"},
    {"no":"25","name":"生活雑貨グラシア",                "shopCode":"gracia"},
    {"no":"26","name":"MAPLE517",                        "shopCode":"maple517"},
    {"no":"27","name":"サトウ楽天市場店",                "shopCode":"sato-shop"},
    {"no":"28","name":"GLANCIA 楽天市場店",              "shopCode":"glancia"},
    {"no":"29","name":"jhstudio楽天市場店",              "shopCode":"jhstudio"},
    {"no":"30","name":"オーダー服と布マスクのコモンママ", "shopCode":"commonmama"},
    {"no":"31","name":"KQueenStore",                     "shopCode":"kqueenstore"},
    {"no":"32","name":"台湾 kawaii shop",                "shopCode":"kawaii-tw"},
    {"no":"33","name":"SIMPS SHOP",                      "shopCode":"simps"},
    {"no":"34","name":"液晶保護フィルムとカバーケース卸", "shopCode":"film-case"},
    {"no":"35","name":"スタンダード",                    "shopCode":"standard-shop"},
    {"no":"36","name":"Gutto楽天市場店",                 "shopCode":"gutto"},
    {"no":"37","name":"便利雑貨ショップ umiwo",           "shopCode":"umiwo"},
    {"no":"38","name":"くらし応援ショップ サンキュー",    "shopCode":"sankyu"},
    {"no":"40","name":"雑貨屋マイスター",                "shopCode":"zakka-meister"},
    {"no":"42","name":"小物専門店のSOLE I L",            "shopCode":"soleil"},
    {"no":"44","name":"APNショップ",                     "shopCode":"apn-shop"},
    {"no":"45","name":"Rinrin Store",                    "shopCode":"rinrin"},
    {"no":"46","name":"LARUTANオンラインショップ",        "shopCode":"larutan"},
    {"no":"47","name":"tempostar",                       "shopCode":"tempostar"},
    {"no":"48","name":"アイデアグッズのララフェスタ",     "shopCode":"larafesta"},
    {"no":"49","name":"motto-motto",                     "shopCode":"motto-motto"},
    {"no":"50","name":"タブレット スマホホルダーecoride", "shopCode":"ecoride"},
    {"no":"51","name":"ADXI",                            "shopCode":"adxi"},
    {"no":"52","name":"TheBestDay楽天市場店",            "shopCode":"thebestday"},
    {"no":"53","name":"日用雑貨のH・T 楽天市場店",       "shopCode":"ht-shop"},
    {"no":"54","name":"アリージェム",                    "shopCode":"allygem"},
    {"no":"55","name":"SweetSweet Shop",                 "shopCode":"sweetsweet"},
    {"no":"56","name":"エクレボ 楽天市場店",             "shopCode":"ecrebeau"},
    {"no":"57","name":"スリーアール",                    "shopCode":"3rshop"},
    {"no":"58","name":"シェリーショップ",                "shopCode":"sherry-shop"},
    {"no":"59","name":"便利グッズのお店 AQSHOP",         "shopCode":"aqshop"},
    {"no":"60","name":"プランドル楽天市場店",             "shopCode":"prandl"},
    {"no":"61","name":"THTECH",                          "shopCode":"thtech"},
    {"no":"62","name":"CENTRALITY 楽天市場店",           "shopCode":"centrality"},
    {"no":"64","name":"ONE DAZE",                        "shopCode":"onedaze"},
    {"no":"65","name":"UNICONA 楽天市場店",              "shopCode":"unicona"},
    {"no":"66","name":"大江ESHOP",                       "shopCode":"oe-eshop"},
    {"no":"68","name":"MILASIC",                         "shopCode":"milasic"},
    {"no":"69","name":"よろず生活雑貨屋レーベンウッド",  "shopCode":"lebenwood"},
    {"no":"70","name":"1st Market",                      "shopCode":"1stmarket"},
    {"no":"71","name":"e-monoplus",                      "shopCode":"e-monoplus"},
    {"no":"72","name":"mitas",                           "shopCode":"mitas"},
    {"no":"73","name":"hidekistore",                     "shopCode":"hidekistore"},
    {"no":"74","name":"Shining Stars",                   "shopCode":"shining-stars"},
    {"no":"75","name":"ドリームマックス",                "shopCode":"dreammax"},
    {"no":"76","name":"ぷらす堂",                        "shopCode":"plusdo"},
]

def load_item_counts():
    """ダッシュボードで設定したショップ別測定数を読み込む"""
    if os.path.exists(ITEM_COUNTS_FILE):
        with open(ITEM_COUNTS_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {}

def fetch_items(shop_code, hits=DEFAULT_ITEMS):
    params = {
        "applicationId": APP_ID,
        "accessKey":     ACCESS_KEY,
        "format":        "json",
        "shopCode":      shop_code,
        "hits":          min(hits, 30),  # APIの最大値は30
        "sort":          "-reviewCount",
    }
    url = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?" \
          + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Referer": "https://kaiyoshida0318.github.io/rivalwatch/",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if "errors" in data:
                print(f"    [API ERROR] {data['errors']}")
                return None
            return data
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"    [HTTP {e.code}] {body[:200]}")
        return None
    except Exception as e:
        print(f"    [ERROR] {e}")
        return None

def collect_shop(shop_code, hits=DEFAULT_ITEMS):
    data = fetch_items(shop_code, hits)
    if not data or "Items" not in data or not data["Items"]:
        return []
    items = []
    for entry in data["Items"][:hits]:
        it = entry.get("Item", entry)
        imgs = it.get("mediumImageUrls", [])
        img_url = imgs[0].get("imageUrl","") if imgs else ""
        items.append({
            "item_id":      str(it.get("itemCode", "")),
            "name":         it.get("itemName", "")[:80],
            "price":        int(it.get("itemPrice", 0)),
            "review_count": int(it.get("reviewCount", 0)),
            "review_avg":   float(it.get("reviewAverage", 0)),
            "url":          it.get("itemUrl", ""),
            "image_url":    img_url,
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
    print(f"  楽天ライバル定点観測（最終版）")
    print(f"  実行日時: {now.strftime('%Y/%m/%d %H:%M')} JST")
    print(f"  APP_ID: {APP_ID[:8]}...")
    print("="*56)

    snapshots=load_json(SNAPSHOTS_FILE,{})
    all_alerts=load_json(ALERTS_FILE,[])
    item_counts=load_item_counts()  # ショップ別測定数
    summary_shops=[]

    for shop in SHOPS:
        shop_code = shop["shopCode"]
        name, no  = shop["name"], shop["no"]
        hits = item_counts.get(shop_code, DEFAULT_ITEMS)  # 設定された測定数を使用
        print(f"\n▶ [{no:>2}] {name} (測定数: {hits})")
        curr_items=collect_shop(shop_code, hits)
        if not curr_items:
            print(f"      スキップ（shopCode要確認: {shop_code}）"); continue
        print(f"      取得: {len(curr_items)}商品 / 最多レビュー: {curr_items[0]['review_count']}件")

        prev_snap=snapshots.get(shop_code,{}).get("latest_items",[])
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

        if shop_code not in snapshots: snapshots[shop_code]={"history":[]}
        snapshots[shop_code]["latest_items"]=curr_items
        snapshots[shop_code]["history"].append({"week":week,"timestamp":now.isoformat(),
            "total_reviews":total_rev,"item_count":len(curr_items),"items":items_with_delta})

        summary_shops.append({"no":no,"name":name,"sid":shop_code,"total_reviews":total_rev,
            "item_count":len(curr_items),"weekly_delta":total_delta,"weekly_est":shop_est,
            "top_items":items_with_delta,  # 全商品を保存
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
