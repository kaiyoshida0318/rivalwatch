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
    const items=await page.evaluate((maxN)=>{
      const seen=new Set(),results=[];
      function parseUrl(href){const m=href.match(/https?:\/\/item\.rakuten\.co\.jp\/([^/]+)\/([^/?#]+)/);return m?{shopSid:m[1],itemCode:m[2]}:null;}
      function add(rank,aEl){
        if(results.length>=maxN)return;
        const p=parseUrl(aEl.href);if(!p)return;
        const k=p.shopSid+':'+p.itemCode;if(seen.has(k))return;
        seen.add(k);
        // img altを優先的に商品名として取得
        const img=aEl.querySelector('img');
        let name='';
        if(img&&img.alt&&img.alt.length>2)name=img.alt;
        if(!name)name=aEl.textContent.trim().replace(/\s+/g,' ');
        // 価格取得
        let price=0;
        const container=aEl.closest('li')||aEl.closest('[class*="item"]')||aEl.parentElement;
        if(container){
          const pe=container.querySelector('[class*="price"],[class*="Price"]');
          if(pe){const m=pe.textContent.replace(/,/g,'').match(/[0-9]+/);if(m)price=parseInt(m[0]);}
        }
        const image_url=img?(img.src||img.dataset.src||''):'';
        results.push({rank,...p,url:aEl.href.split('?')[0],name:name.slice(0,80),price,image_url});
      }
      const t1=document.querySelector('.rnkRanking_topBgColor a[href*="item.rakuten.co.jp"]');if(t1)add(1,t1);
      document.querySelectorAll('.rnkRanking_top3box a[href*="item.rakuten.co.jp"]').forEach(a=>add(results.length+1,a));
      document.querySelectorAll('.rnkRanking_dispRank').forEach(el=>{
        const rn=parseInt(el.textContent);if(isNaN(rn))return;
        const c=el.closest('li')||el.parentElement;if(!c)return;
        const a=c.querySelector('a[href*="item.rakuten.co.jp"]');if(!a)return;
        add(rn,a);
      });
      if(results.length<maxN)document.querySelectorAll('a[href*="item.rakuten.co.jp"]').forEach(a=>add(results.length+1,a));
      return results.slice(0,maxN);
    },topN);
    console.log('    fetched: '+items.length+'/'+topN);
    items.forEach(it=>console.log('    [rank'+it.rank+'] '+it.shopSid+' name='+it.name.slice(0,20)+' price='+it.price));
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
          // APIで補完（成功すればAPI優先、失敗したらランキングページ取得値を使う）
          let detail=await enrichViaApi(item.shopSid,item.itemCode);
          if(detail&&detail.name){
            console.log('    -> API ok: '+detail.name.slice(0,25));
          }else{
            detail={name:item.name,price:item.price,image_url:item.image_url,review_count:0,shop_name:item.shopSid};
            console.log('    -> page data: '+(item.name||'(no name)').slice(0,25)+' Y'+item.price);
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
  const named=results.reduce((s,r)=>s+r.items.filter(i=>i.name).length,0);
  console.log('done: '+results.length+' rankings, '+total+' items ('+named+' named)');
  results.forEach(r=>{console.log('['+r.label+']');r.items.forEach(i=>console.log('  '+i.rank+': '+(i.name||'(no name)').slice(0,35)+' / '+i.shop_sid+' Y'+i.price));});
}
main().catch(e=>{console.error('Fatal:',e);process.exit(1);});