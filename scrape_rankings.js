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

// 楽天API: itemCode直接検索
async function enrichViaItemCode(shopSid, itemCode) {
  if (!APP_ID || !itemCode) return null;
  const params = new URLSearchParams({applicationId:APP_ID,accessKey:ACCESS_KEY,format:'json',itemCode:shopSid+':'+itemCode,hits:1});
  try {
    const res = await fetch(RAKUTEN_API+'?'+params, {headers:{Referer:'https://kaiyoshida0318.github.io/rivalwatch/'}});
    const data = await res.json();
    if (data&&data.Items&&data.Items.length) {
      const it = data.Items[0].Item||data.Items[0]; const imgs=it.mediumImageUrls||[];
      return {name:(it.itemName||'').slice(0,80),image_url:imgs[0]?imgs[0].imageUrl:'',price:parseInt(it.itemPrice||0),review_count:parseInt(it.reviewCount||0),shop_name:it.shopName||shopSid};
    }
  } catch(e) {}
  return null;
}

// 楽天API: ショップ検索でitemCodeに一致する商品を探す（フォールバック）
async function enrichViaShopSearch(shopSid, itemCode) {
  if (!APP_ID || !shopSid) return null;
  // ショップの上位30件を取得してitemCodeが一致するものを探す
  const params = new URLSearchParams({applicationId:APP_ID,accessKey:ACCESS_KEY,format:'json',shopCode:shopSid,hits:30,sort:'-reviewCount'});
  try {
    const res = await fetch(RAKUTEN_API+'?'+params, {headers:{Referer:'https://kaiyoshida0318.github.io/rivalwatch/'}});
    const data = await res.json();
    if (data&&data.Items&&data.Items.length) {
      // itemCodeで一致するものを探す
      let match = data.Items.find(e => {
        const it = e.Item||e;
        const code = (it.itemCode||'').split(':').pop();
        return code === itemCode;
      });
      // 一致しなければ1件目を使う
      if (!match) match = data.Items[0];
      const it = match.Item||match; const imgs=it.mediumImageUrls||[];
      console.log('    [ShopSearch] '+it.itemName.slice(0,30)+' Y'+it.itemPrice);
      return {name:(it.itemName||'').slice(0,80),image_url:imgs[0]?imgs[0].imageUrl:'',price:parseInt(it.itemPrice||0),review_count:parseInt(it.reviewCount||0),shop_name:it.shopName||shopSid};
    }
  } catch(e) { console.log('    [ShopSearch] error: '+e.message); }
  return null;
}

async function scrapeRankingPage(browser,url,topN){
  const page=await browser.newPage();
  try{
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({'Accept-Language':'ja,en-US;q=0.9,en;q=0.8'});
    console.log('  -> '+url);
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    await page.evaluate(()=>{window.scrollTo(0,document.body.scrollHeight/2);});
    await sleep(1500);
    await page.evaluate(()=>{window.scrollTo(0,document.body.scrollHeight);});
    await sleep(2000);
    const dbg=await page.evaluate(()=>({topBg:document.querySelectorAll('.rnkRanking_topBgColor').length,top3:document.querySelectorAll('.rnkRanking_top3box').length,links:document.querySelectorAll('a[href*="item.rakuten.co.jp"]').length}));
    console.log('    [debug] topBg='+dbg.topBg+' top3='+dbg.top3+' links='+dbg.links);
    const items=await page.evaluate((maxN)=>{
      const seen=new Set(),results=[];
      function parse(href){const m=href.match(/https?:\/\/item\.rakuten\.co\.jp\/([^/]+)\/([^/?#]+)/);return m?{shopSid:m[1],itemCode:m[2]}:null;}
      function add(rank,href){if(results.length>=maxN)return;const p=parse(href);if(!p)return;const k=p.shopSid+':'+p.itemCode;if(seen.has(k))return;seen.add(k);results.push({rank,...p,url:href.split('?')[0]});}
      const t1=document.querySelector('.rnkRanking_topBgColor a[href*="item.rakuten.co.jp"]');if(t1)add(1,t1.href);
      document.querySelectorAll('.rnkRanking_top3box a[href*="item.rakuten.co.jp"]').forEach(a=>add(results.length+1,a.href));
      document.querySelectorAll('.rnkRanking_dispRank').forEach(el=>{const rn=parseInt(el.textContent);if(isNaN(rn))return;const c=el.closest('li')||el.parentElement;if(!c)return;const a=c.querySelector('a[href*="item.rakuten.co.jp"]');if(a)add(rn,a.href);});
      if(results.length<maxN)document.querySelectorAll('a[href*="item.rakuten.co.jp"]').forEach(a=>add(results.length+1,a.href));
      return results.slice(0,maxN);
    },topN);
    items.forEach(it=>console.log('    [rank'+it.rank+'] '+it.shopSid+':'+it.itemCode));
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
          await sleep(600);
          console.log('  [enrich] rank'+item.rank+': '+item.shopSid+':'+item.itemCode);
          // 1) itemCode直接検索
          let detail=await enrichViaItemCode(item.shopSid,item.itemCode);
          // 2) 失敗したらショップ検索フォールバック
          if(!detail||!detail.name){
            console.log('    -> shopSearch fallback: '+item.shopSid);
            detail=await enrichViaShopSearch(item.shopSid,item.itemCode);
            await sleep(800);
          }
          enriched.push({rank:item.rank,item_id:item.shopSid+':'+item.itemCode,shop_sid:item.shopSid,shop_name:(detail&&detail.shop_name)||item.shopSid,item_code:item.itemCode,url:item.url,name:(detail&&detail.name)||'',image_url:(detail&&detail.image_url)||'',price:(detail&&detail.price)||0,review_count:(detail&&detail.review_count)||0});
        }
        results.push({genreId,label,url,topN,fetchedAt:now,items:enriched});
        await sleep(2000);
      }catch(e){console.error('  error('+label+'): '+e.message);}
    }
  }finally{await browser.close();}
  saveJson(RESULTS_FILE,{generated_at:now,rankings:results});
  const total=results.reduce((s,r)=>s+r.items.length,0);
  console.log('done: '+results.length+' rankings, '+total+' items');
  results.forEach(r=>{console.log('['+r.label+']');r.items.forEach(i=>console.log('  '+i.rank+': '+(i.name||'(no name)')+' / '+i.shop_sid+' Y'+i.price));});
}
main().catch(e=>{console.error('Fatal:',e);process.exit(1);});