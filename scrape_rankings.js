const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const APP_ID       = process.env.RAKUTEN_APP_ID     || '';
const ACCESS_KEY   = process.env.RAKUTEN_ACCESS_KEY || '';
const CONFIGS_FILE = 'data/ranking_configs.json';
const RESULTS_FILE = 'data/ranking_results.json';
const RAKUTEN_API  = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601';
function loadJson(p,d){if(fs.existsSync(p)){try{return JSON.parse(fs.readFileSync(p,'utf-8'));}catch(e){return d;}}return d;}
function saveJson(p,data){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(data,null,2),'utf-8');}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function cleanTitle(raw){if(!raw)return '';return raw.replace(/^[\u300c\u300d\u3010\u3011]?\u697d\u5929\u5e02\u5834[\u300c\u300d\u3010\u3011]?\s*/u,'').replace(/[\s|\uff5c:\uff1a]+\u697d\u5929\u5e02\u5834.*$/u,'').replace(/\s*\u697d\u5929\u5e02\u5834$/u,'').trim().slice(0,80);}

// 楽天API itemCode直接検索（これが成功するケースのみ使う）
async function enrichViaApi(shopSid,itemCode){
  if(!APP_ID||!itemCode)return null;
  const params=new URLSearchParams({applicationId:APP_ID,accessKey:ACCESS_KEY,format:'json',itemCode:shopSid+':'+itemCode,hits:1});
  try{
    const res=await fetch(RAKUTEN_API+'?'+params,{headers:{Referer:'https://kaiyoshida0318.github.io/rivalwatch/'}});
    const data=await res.json();
    if(data&&data.Items&&data.Items.length){
      const it=data.Items[0].Item||data.Items[0];const imgs=it.mediumImageUrls||[];
      return{name:(it.itemName||'').slice(0,80),image_url:imgs[0]?imgs[0].imageUrl:'',price:parseInt(it.itemPrice||0),review_count:parseInt(it.reviewCount||0),shop_name:it.shopName||shopSid};
    }
  }catch(e){}
  return null;
}

// ランキングページからURLと商品情報を一緒にスクレイプ
async function scrapeRankingPage(browser,url,topN){
  const page=await browser.newPage();
  try{
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'ja,en-US;q=0.9,en;q=0.8'});
    console.log('  -> '+url);
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight/2));
    await sleep(1500);
    await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
    await sleep(2000);
    const dbg=await page.evaluate(()=>({
      topBg:document.querySelectorAll('.rnkRanking_topBgColor').length,
      top3:document.querySelectorAll('.rnkRanking_top3box').length,
      links:document.querySelectorAll('a[href*="item.rakuten.co.jp"]').length,
    }));
    console.log('    [debug] topBg='+dbg.topBg+' top3='+dbg.top3+' links='+dbg.links);
    // ランキングページから商品URL + 商品名・価格・画像を一緒に取得
    const items=await page.evaluate((maxN)=>{
      const seen=new Set(),results=[];
      function parse(href){const m=href.match(/https?:\/\/item\.rakuten\.co\.jp\/([^/]+)\/([^/?#]+)/);return m?{shopSid:m[1],itemCode:m[2]}:null;}
      // アイテムコンテナを特定: 商品リンクの直近の祖先要素から名前・価格・画像を取得
      function extractItemInfo(container){
        const nameEl=container.querySelector('.rnkRanking_itemName,.item_name,[class*="itemName"],[class*="item-name"],h3,h4');
        const priceEl=container.querySelector('.rnkRanking_price,.price,[class*="price"],[class*="Price"]');
        const imgEl=container.querySelector('img[src*="thumbnail.image.rakuten"],[src*="r10s.jp"],img');
        const name=nameEl?nameEl.textContent.trim().slice(0,80):'';
        let price=0;
        if(priceEl){const m=priceEl.textContent.replace(/[,，]/g,'').match(/\d+/);if(m)price=parseInt(m[0]);}
        const image_url=imgEl?(imgEl.src||imgEl.dataset.src||''):'';
        return{name,price,image_url};
      }
      function add(rank,a){
        if(results.length>=maxN)return;
        const p=parse(a.href);if(!p)return;
        const k=p.shopSid+':'+p.itemCode;if(seen.has(k))return;
        seen.add(k);
        // 祖先要素をさかのぼって商品コンテナを探す
        let container=a.closest('li,.rnkRanking_item,[class*="rankItem"],[class*="rank-item"]')||a.parentElement;
        const info=extractItemInfo(container);
        results.push({rank,...p,url:a.href.split('?')[0],...info});
      }
      const t1=document.querySelector('.rnkRanking_topBgColor a[href*="item.rakuten.co.jp"]');if(t1)add(1,t1);
      document.querySelectorAll('.rnkRanking_top3box a[href*="item.rakuten.co.jp"]').forEach(a=>add(results.length+1,a));
      document.querySelectorAll('.rnkRanking_dispRank').forEach(el=>{const rn=parseInt(el.textContent);if(isNaN(rn))return;const c=el.closest('li')||el.parentElement;if(!c)return;const a=c.querySelector('a[href*="item.rakuten.co.jp"]');if(a)add(rn,a);});
      if(results.length<maxN)document.querySelectorAll('a[href*="item.rakuten.co.jp"]').forEach(a=>add(results.length+1,a));
      return results.slice(0,maxN);
    },topN);
    items.forEach(it=>console.log('    [rank'+it.rank+'] '+it.shopSid+' name="'+it.name.slice(0,25)+'" price='+it.price));
    console.log('    fetched: '+items.length+'/'+topN);
    return items;
  }finally{await page.close();}
}

async function main(){
  const configs=loadJson(CONFIGS_FILE,[]);
  if(!configs.length){console.log('configs empty, skip');return;}
  console.log('ranking scrape start: '+configs.length);
  const browser=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const now=new Date().toISOString();const results=[];
  try{
    for(const cfg of configs){
      const url=cfg.url||'',topN=parseInt(cfg.topN||10),label=cfg.label||url,genreId=cfg.genreId||'';
      if(!url)continue;
      try{
        const items=await scrapeRankingPage(browser,url,topN);
        const enriched=[];
        for(const item of items){
          await sleep(800);
          console.log('  [enrich] rank'+item.rank+': '+item.shopSid+':'+item.itemCode);
          // ランキングページで既に名前・価格が取れていればAPIスキップ
          let detail=null;
          if(item.name&&item.price>0){
            console.log('    -> from ranking page: '+item.name.slice(0,30));
            detail={name:item.name,price:item.price,image_url:item.image_url,review_count:0,shop_name:item.shopSid};
          } else {
            // ランキングページで取れなかった場合のみAPI検索
            detail=await enrichViaApi(item.shopSid,item.itemCode);
            if(!detail||!detail.name) console.log('    -> MISS');
          }
          enriched.push({rank:item.rank,item_id:item.shopSid+':'+item.itemCode,shop_sid:item.shopSid,shop_name:(detail&&detail.shop_name)||item.shopSid,item_code:item.itemCode,url:item.url,name:(detail&&detail.name)||'',image_url:(detail&&detail.image_url)||item.image_url||'',price:(detail&&detail.price)||item.price||0,review_count:(detail&&detail.review_count)||0});
        }
        results.push({genreId,label,url,topN,fetchedAt:now,items:enriched});
        await sleep(2000);
      }catch(e){console.error('  error('+label+'): '+e.message);}
    }
  }finally{await browser.close();}
  saveJson(RESULTS_FILE,{generated_at:now,rankings:results});
  const total=results.reduce((s,r)=>s+r.items.length,0);
  const named=results.reduce((s,r)=>s+r.items.filter(i=>i.name).length,0);
  console.log('done: '+results.length+' rankings, '+named+'/'+total+' named');
  results.forEach(r=>{console.log('['+r.label+']');r.items.forEach(i=>console.log('  '+i.rank+': '+(i.name||'(no name)')+' Y'+i.price));});
}
main().catch(e=>{console.error('Fatal:',e);process.exit(1);});