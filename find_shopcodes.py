"""
各ショップの正しいshopCodeを検索して取得するスクリプト
実行方法: python find_shopcodes.py
結果: data/shopcodes.json に保存
"""
import json, time, os, urllib.request, urllib.parse

APP_ID     = os.environ.get("RAKUTEN_APP_ID", "")
ACCESS_KEY = os.environ.get("RAKUTEN_ACCESS_KEY", "")

# sid（数字）とショップ名の対応表
SHOPS = [
    {"no":"1", "name":"Porto 楽天市場店",               "sid":"338610"},
    {"no":"2", "name":"Trade-ABC 楽天市場店",            "sid":"397933"},
    {"no":"3", "name":"フエロショップ 楽天市場店",        "sid":"363823"},
    {"no":"6", "name":"カラダノミライ 自然通販",          "sid":"302794"},
    {"no":"7", "name":"リムストア",                      "sid":"399177"},
    {"no":"9", "name":"LASIEM（ラシエム）",               "sid":"366493"},
    {"no":"11","name":"e-kit（いーきっと）",              "sid":"347924"},
    {"no":"12","name":"ddice",                           "sid":"339164"},
    {"no":"13","name":"Lumiere",                         "sid":"381078"},
    {"no":"14","name":"PolaPola楽天市場店",               "sid":"407241"},
    {"no":"15","name":"Queens Land",                     "sid":"276423"},
    {"no":"16","name":"roryXtyle",                       "sid":"264063"},
    {"no":"17","name":"Barsado",                         "sid":"310070"},
    {"no":"18","name":"MWJ TOKYO",                       "sid":"299452"},
    {"no":"19","name":"C.C.C STORES",                    "sid":"210048"},
    {"no":"20","name":"Across【アクロース】",             "sid":"349310"},
    {"no":"21","name":"Trend Style 楽天市場店",           "sid":"283235"},
    {"no":"22","name":"grepo 楽天市場店",                 "sid":"377037"},
    {"no":"23","name":"ハッピートーク楽天市場店",         "sid":"384887"},
    {"no":"24","name":"輸入品屋さん",                    "sid":"206370"},
    {"no":"25","name":"生活雑貨グラシア",                "sid":"366975"},
    {"no":"26","name":"MAPLE517",                        "sid":"254770"},
    {"no":"27","name":"サトウ楽天市場店",                "sid":"362383"},
    {"no":"28","name":"GLANCIA 楽天市場店",              "sid":"404024"},
    {"no":"29","name":"jhstudio楽天市場店",              "sid":"367538"},
    {"no":"30","name":"オーダー服と布マスクのコモンママ", "sid":"317090"},
    {"no":"31","name":"KQueenStore",                     "sid":"322345"},
    {"no":"32","name":"台湾 kawaii shop",                "sid":"350613"},
    {"no":"33","name":"SIMPS SHOP",                      "sid":"357772"},
    {"no":"34","name":"液晶保護フィルムとカバーケース卸", "sid":"313270"},
    {"no":"35","name":"スタンダード",                    "sid":"333309"},
    {"no":"36","name":"Gutto楽天市場店",                 "sid":"330654"},
    {"no":"37","name":"便利雑貨ショップ umiwo",           "sid":"342783"},
    {"no":"38","name":"くらし応援ショップ サンキュー",    "sid":"360349"},
    {"no":"40","name":"雑貨屋マイスター",                "sid":"311815"},
    {"no":"42","name":"小物専門店のSOLE I L",            "sid":"376023"},
    {"no":"44","name":"APNショップ",                     "sid":"304818"},
    {"no":"45","name":"Rinrin Store",                    "sid":"339882"},
    {"no":"46","name":"LARUTANオンラインショップ",        "sid":"396364"},
    {"no":"47","name":"tempostar",                       "sid":"406187"},
    {"no":"48","name":"アイデアグッズのララフェスタ",     "sid":"287591"},
    {"no":"49","name":"motto-motto",                     "sid":"384255"},
    {"no":"50","name":"タブレット スマホホルダーecoride", "sid":"322293"},
    {"no":"51","name":"ADXI",                            "sid":"399610"},
    {"no":"52","name":"TheBestDay楽天市場店",            "sid":"408415"},
    {"no":"53","name":"日用雑貨のH・T 楽天市場店",       "sid":"369110"},
    {"no":"54","name":"アリージェム",                    "sid":"362251"},
    {"no":"55","name":"SweetSweet Shop",                 "sid":"371892"},
    {"no":"56","name":"エクレボ 楽天市場店",             "sid":"278191"},
    {"no":"57","name":"スリーアール",                    "sid":"277890"},
    {"no":"58","name":"シェリーショップ",                "sid":"229638"},
    {"no":"59","name":"便利グッズのお店 AQSHOP",         "sid":"321840"},
    {"no":"60","name":"プランドル楽天市場店",             "sid":"313202"},
    {"no":"61","name":"THTECH",                          "sid":"365774"},
    {"no":"62","name":"CENTRALITY 楽天市場店",           "sid":"385884"},
    {"no":"64","name":"ONE DAZE",                        "sid":"363503"},
    {"no":"65","name":"UNICONA 楽天市場店",              "sid":"360077"},
    {"no":"66","name":"大江ESHOP",                       "sid":"334563"},
    {"no":"68","name":"MILASIC",                         "sid":"371705"},
    {"no":"69","name":"よろず生活雑貨屋レーベンウッド",  "sid":"383523"},
    {"no":"70","name":"1st Market",                      "sid":"302982"},
    {"no":"71","name":"e-monoplus",                      "sid":"390105"},
    {"no":"72","name":"mitas",                           "sid":"263585"},
    {"no":"73","name":"hidekistore",                     "sid":"386514"},
    {"no":"74","name":"Shining Stars",                   "sid":"411282"},
    {"no":"75","name":"ドリームマックス",                "sid":"268249"},
    {"no":"76","name":"ぷらす堂",                        "sid":"367615"},
]

def search_shop(name):
    """ショップ名でAPIを検索して正しいshopCodeを取得"""
    params = {
        "applicationId": APP_ID,
        "accessKey":     ACCESS_KEY,
        "format":        "json",
        "keyword":       name,
        "hits":          5,
    }
    url = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?" \
          + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Referer": "https://kaiyoshida0318.github.io/rivalwatch/",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if "Items" not in data or not data["Items"]:
                return None
            # 最初のアイテムのshopCodeを返す
            for entry in data["Items"]:
                it = entry.get("Item", entry)
                shop_name_api = it.get("shopName", "")
                shop_code     = it.get("shopCode", "")
                if shop_code:
                    return {"shopCode": shop_code, "shopNameApi": shop_name_api}
    except Exception as e:
        print(f"  ERROR: {e}")
    return None

def main():
    if not APP_ID or not ACCESS_KEY:
        print("ERROR: 環境変数が未設定"); return

    results = []
    os.makedirs("data", exist_ok=True)

    for shop in SHOPS:
        name = shop["name"]
        # 名前を短くして検索（「楽天市場店」などを除去）
        keyword = name.replace("楽天市場店","").replace("楽天市場","").replace("　","").strip()
        print(f"▶ {name} → 検索: '{keyword}'")
        found = search_shop(keyword)
        if found:
            print(f"  ✅ shopCode: {found['shopCode']} ({found['shopNameApi']})")
            results.append({
                "no":          shop["no"],
                "name":        name,
                "sid":         shop["sid"],
                "shopCode":    found["shopCode"],
                "shopNameApi": found["shopNameApi"],
                "matched":     True,
            })
        else:
            print(f"  ❌ 見つからず")
            results.append({
                "no":       shop["no"],
                "name":     name,
                "sid":      shop["sid"],
                "shopCode": "",
                "matched":  False,
            })
        time.sleep(1.5)

    with open("data/shopcodes.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    matched = [r for r in results if r["matched"]]
    print(f"\n完了: {len(matched)}/{len(results)} ショップのshopCode取得成功")
    print("data/shopcodes.json に保存しました")

if __name__ == "__main__":
    main()
