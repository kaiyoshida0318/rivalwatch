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
async function enrichViaApi(shopSid,itemCode){
  if(!APP_ID||!itemCode)return null;
  const params=new URLSearchParams({applicationId:APP_ID,accessKey:ACCESS_KEY,format:'json',itemCode:shopSid+':'+itemCode,hits:1});
  try{const res=await fetch(RAKUTEN_API+'?'+params,{headers:{Referer:'https://kaiyoshida0318.github.io/rivalwatch/'}});
  const data=await res.json();
  if(data&&data.Items&&data.Items.length){const it=data.Items[0].Item||data.Items[0];const imgs=it.mediumImageUrls||[];
  return{name:(it.itemName||'').slice(0,80),image_url:imgs[0]?imgs[0].imageUrl:'',price:parseInt(it.itemPrice||0),review_count:parseInt(it.reviewCount||0),shop_name:it.shopName||shopSid};}
  }catch(e){}return null;}
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
    // ページメタ情報（パンくず・ランキング名・期間タイプ）を取得
    const pageMeta = await page.evaluate(()=>{
      // パンくず: .ranking_pnkz
      const crumbEl = document.querySelector('.ranking_pnkz');
      const breadcrumb = crumbEl ? crumbEl.innerText.trim() : '';
      // カテゴリ名（最後のパンくず要素）
      const crumbParts = breadcrumb.split('>').map(s=>s.trim()).filter(s=>s);
      const categoryName = crumbParts[crumbParts.length-1] || '';
      // ランキング名: h1
      const h1 = document.querySelector('h1');
      const rankingTitle = h1 ? h1.innerText.trim() : '';
      return {breadcrumb, categoryName, rankingTitle};
    });
    // 期間タイプ: URLから判定
    const periodType = url.includes('/weekly/') ? 'Weekly' : url.includes('/monthly/') ? 'Monthly' : url.includes('/realtime/') ? 'Realtime' : 'Daily';
    console.log('    [meta] '+periodType+' | '+pageMeta.rankingTitle+' | '+pageMeta.breadcrumb);
    const items=await page.evaluate((maxN)=>{
      const seen=new Set(),results=[];
      function parseUrl(href){const m=href.match(/https?:\/\/item\.rakuten\.co\.jp\/([^/]+)\/([^/?#]+)/);return m?{shopSid:m[1],itemCode:m[2]}:null;}
      function extract(rank,container){
        if(results.length>=maxN)return;
        const aEl=container.querySelector('a[href*="item.rakuten.co.jp"]');if(!aEl)return;
        const p=parseUrl(aEl.href);if(!p)return;
        const k=p.shopSid+':'+p.itemCode;if(seen.has(k))return;
        seen.add(k);
        const nameEl=container.querySelector('.rnkRanking_itemName');
        const name=(nameEl?nameEl.textContent.trim():'').slice(0,80);
        const priceEl=container.querySelector('.rnkRanking_price');
        let price=0;if(priceEl){const m=priceEl.textContent.replace(/,/g,'').match(/[0-9]+/);if(m)price=parseInt(m[0]);}
        const imgEl=container.querySelector('.rnkRanking_image img,.rnkRanking_imageBox img');
        const image_url=imgEl?(imgEl.src||''):'';
        results.push({rank,...p,url:aEl.href.split('?')[0],name,price,image_url});
      }
      const top1=document.querySelector('.rnkRanking_topBgColor');if(top1)extract(1,top1);
      document.querySelectorAll('.rnkRanking_top3box').forEach(el=>extract(results.length+1,el));
      document.querySelectorAll('.rnkRanking_after4box').forEach(el=>{
        const rankEl=el.querySelector('.rnkRanking_dispRank');
        const rank=rankEl?parseInt(rankEl.textContent):results.length+1;
        extract(rank,el);
      });
      return results.slice(0,maxN);
    },topN);
    console.log('    fetched: '+items.length+'/'+topN);
    return {items, pageMeta, periodType};
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
        const {items, pageMeta, periodType}=await scrapeRankingPage(browser,url,topN);
        const enriched=[];
        for(const item of items){
          await sleep(600);
          let detail=await enrichViaApi(item.shopSid,item.itemCode);
          if(detail&&detail.name){
            console.log('  [rank'+item.rank+'] API ok: '+detail.name.slice(0,25));
          }else{
            detail={name:item.name,price:item.price,image_url:item.image_url,review_count:0,shop_name:item.shopSid};
            console.log('  [rank'+item.rank+'] page: '+item.name.slice(0,25)+' Y'+item.price);
          }
          enriched.push({rank:item.rank,item_id:item.shopSid+':'+item.itemCode,shop_sid:item.shopSid,shop_name:(detail&&detail.shop_name)||item.shopSid,item_code:item.itemCode,url:item.url,name:(detail&&detail.name)||'',image_url:(detail&&detail.image_url)||'',price:(detail&&detail.price)||0,review_count:(detail&&detail.review_count)||0});
        }
        results.push({
          genreId, label, url, topN, fetchedAt:now,
          periodType,                          // Daily/Weekly/Monthly/Realtime
          rankingTitle: pageMeta.rankingTitle, // 接着・補修用品ランキング
          breadcrumb:   pageMeta.breadcrumb,   // 楽天市場トップ > ... > 接着・補修用品
          categoryName: pageMeta.categoryName, // 接着・補修用品
          items: enriched
        });
        await sleep(2000);
      }catch(e){console.error('  error('+label+'): '+e.message);}
    }
  }finally{await browser.close();}
  saveJson(RESULTS_FILE,{generated_at:now,rankings:results});
  const total=results.reduce((s,r)=>s+r.items.length,0);
  console.log('done: '+results.length+' rankings, '+total+' items');
  results.forEach(r=>{
    console.log('['+r.periodType+'] '+r.rankingTitle);
    r.items.forEach(i=>console.log('  '+i.rank+': '+i.name.slice(0,35)+' Y'+i.price));
  });
}
main().catch(e=>{console.error('Fatal:',e);process.exit(1);});