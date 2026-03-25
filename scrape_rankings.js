const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const APP_ID       = process.env.RAKUTEN_APP_ID     || '';
const ACCESS_KEY   = process.env.RAKUTEN_ACCESS_KEY || '';
const CONFIGS_FILE = 'data/ranking_configs.json';
const RESULTS_FILE = 'data/ranking_results.json';
const RAKUTEN_API  = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601';

function loadJson(p, d) {
  if (fs.existsSync(p)) { try { return JSON.parse(fs.readFileSync(p,'utf-8')); } catch(e) { return d; } }
  return d;
}
function saveJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanTitle(raw) {
  if (!raw) return '';
  return raw
    .replace(/^[\u300c\u300d\u3010\u3011]?\u697d\u5929\u5e02\u5834[\u300c\u300d\u3010\u3011]?\s*/u, '')
    .replace(/[\s|\uff5c:\uff1a]+\u697d\u5929\u5e02\u5834.*$/u, '')
    .replace(/\s*\u697d\u5929\u5e02\u5834$/u, '')
    .trim().slice(0, 80);
}

async function enrichViaApi(shopSid, itemCode) {
  if (!APP_ID || !itemCode) return null;
  const params = new URLSearchParams({
    applicationId: APP_ID, accessKey: ACCESS_KEY, format: 'json',
    itemCode: shopSid + ':' + itemCode, hits: 1,
  });
  try {
    const res = await fetch(RAKUTEN_API + '?' + params, {
      headers: { Referer: 'https://kaiyoshida0318.github.io/rivalwatch/' }
    });
    const data = await res.json();
    if (data && data.Items && data.Items.length) {
      const it = data.Items[0].Item || data.Items[0];
      const imgs = it.mediumImageUrls || [];
      return {
        name: (it.itemName || '').slice(0, 80),
        image_url: imgs[0] ? imgs[0].imageUrl : '',
        price: parseInt(it.itemPrice || 0),
        review_count: parseInt(it.reviewCount || 0),
        shop_name: it.shopName || shopSid,
      };
    }
  } catch(e) {}
  return null;
}

async function enrichViaPage(browser, itemUrl, shopSid) {
  if (!itemUrl) return null;
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' });
    await page.goto(itemUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    const detail = await page.evaluate((cleanTitleSrc) => {
      const cleanTitle = new Function('raw', cleanTitleSrc);
      const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const s of ldScripts) {
        try {
          const json = JSON.parse(s.textContent);
          const obj = Array.isArray(json) ? json.find(o => o['@type']==='Product') : (json['@type']==='Product' ? json : null);
          if (obj) {
            const name = cleanTitle(obj.name || '');
            let price = 0;
            if (obj.offers) { const o=Array.isArray(obj.offers)?obj.offers[0]:obj.offers; price=parseInt(o.price||0); }
            const imgRaw = obj.image;
            const image_url = Array.isArray(imgRaw)?(imgRaw[0]||''):(imgRaw||'');
            const review_count = obj.aggregateRating ? parseInt(obj.aggregateRating.reviewCount||0) : 0;
            if (name) return { name, price, image_url: typeof image_url==='string'?image_url:'', review_count, source:'ld' };
          }
        } catch(e) {}
      }
      const ogTitle = document.querySelector('meta[property="og:title"]');
      const ogImage = document.querySelector('meta[property="og:image"]');
      const name = cleanTitle(ogTitle ? ogTitle.content : '');
      const image_url = ogImage ? ogImage.content : '';
      const priceEl = document.querySelector('[itemprop="price"]');
      let price = 0;
      if (priceEl) { const v=priceEl.getAttribute('content')||priceEl.textContent; const m=v.replace(/,/g,'').match(/\d+/); if(m) price=parseInt(m[0]); }
      if (name && name.length > 1) return { name, price, image_url, review_count: 0, source:'ogp' };
      const titleName = cleanTitle(document.title || '');
      if (titleName && titleName.length > 1) return { name: titleName, price, image_url, review_count: 0, source:'title' };
      return null;
    }, `
      if (!raw) return '';
      return raw
        .replace(/^[\u300c\u300d\u3010\u3011]?\u697d\u5929\u5e02\u5834[\u300c\u300d\u3010\u3011]?\s*/u, '')
        .replace(/[\s|\uff5c:\uff1a]+\u697d\u5929\u5e02\u5834.*$/u, '')
        .replace(/\s*\u697d\u5929\u5e02\u5834$/u, '')
        .trim().slice(0, 80);
    `);
    if (detail && detail.name && detail.name.length > 1) {
      console.log('    [Page/'+detail.source+'] ' + detail.name.slice(0,40) + ' Y'+detail.price);
      return Object.assign(detail, { shop_name: shopSid });
    }
    console.log('    [Page] name not found: ' + itemUrl);
  } catch(e) {
    console.log('    [Page] error: ' + e.message);
  } finally {
    await page.close();
  }
  return null;
}

async function scrapeRankingPage(browser, url, topN) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' });
    console.log('  -> ' + url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // ── 4位以降のHTML構造を詳しく調べる ──
    const structureInfo = await page.evaluate(() => {
      const info = {};
      // rnkRanking_で始まるクラスを全部列挙
      const allClasses = new Set();
      document.querySelectorAll('[class]').forEach(el => {
        el.className.split(/\s+/).forEach(c => { if (c.startsWith('rnkRanking_')) allClasses.add(c); });
      });
      info.rnkClasses = Array.from(allClasses);
      // item.rakuten.co.jpリンクを全部収集して順番に確認
      const allLinks = Array.from(document.querySelectorAll('a[href*="item.rakuten.co.jp"]'));
      info.totalLinks = allLinks.length;
      // 最初の15件のURL
      info.sampleLinks = allLinks.slice(0, 15).map(a => a.href.replace('https://item.rakuten.co.jp/', '').split('?')[0].slice(0, 40));
      // rnkRanking_top3box に含まれるリンク数
      info.top3links = document.querySelectorAll('.rnkRanking_top3box a[href*="item.rakuten.co.jp"]').length;
      info.topBgLinks = document.querySelectorAll('.rnkRanking_topBgColor a[href*="item.rakuten.co.jp"]').length;
      return info;
    });
    console.log('    [structure] rnkClasses=' + structureInfo.rnkClasses.join(','));
    console.log('    [structure] totalLinks=' + structureInfo.totalLinks + ' topBg=' + structureInfo.topBgLinks + ' top3=' + structureInfo.top3links);
    console.log('    [structure] sampleLinks=' + JSON.stringify(structureInfo.sampleLinks));

    const items = await page.evaluate((maxN) => {
      const seen = new Set(), results = [];
      function parse(href) {
        const m = href.match(/https?:\/\/item\.rakuten\.co\.jp\/([^/]+)\/([^/?#]+)/);
        return m ? { shopSid: m[1], itemCode: m[2] } : null;
      }
      // 1位
      const t1 = document.querySelector('.rnkRanking_topBgColor a[href*="item.rakuten.co.jp"]');
      if (t1) { const p=parse(t1.href); if(p){const k=p.shopSid+':'+p.itemCode; if(!seen.has(k)){seen.add(k);results.push({rank:1,...p,url:t1.href.split('?')[0]});}}}
      // 2〜3位
      document.querySelectorAll('.rnkRanking_top3box a[href*="item.rakuten.co.jp"]').forEach(a => {
        if (results.length >= maxN) return;
        const p = parse(a.href); if (!p) return;
        const k = p.shopSid+':'+p.itemCode; if (seen.has(k)) return;
        seen.add(k); results.push({rank: results.length+1, ...p, url: a.href.split('?')[0]});
      });
      // 4位以降: rnkRanking_dispRank が見つからない場合は
      // li[data-rank] または data-rank 属性で取得
      const ranked = document.querySelectorAll('[data-rank]');
      ranked.forEach(el => {
        if (results.length >= maxN) return;
        const rn = parseInt(el.getAttribute('data-rank'));
        if (isNaN(rn) || rn <= 3) return;
        const a = el.querySelector('a[href*="item.rakuten.co.jp"]');
        if (!a) return;
        const p = parse(a.href); if (!p) return;
        const k = p.shopSid+':'+p.itemCode; if (seen.has(k)) return;
        seen.add(k); results.push({rank: rn, ...p, url: a.href.split('?')[0]});
      });
      // data-rank がない場合: rnkRanking_dispRank テキストを数値化して対応
      document.querySelectorAll('.rnkRanking_dispRank').forEach(el => {
        if (results.length >= maxN) return;
        const rn = parseInt(el.textContent); if (isNaN(rn)) return;
        const c = el.closest('li') || el.parentElement; if (!c) return;
        const a = c.querySelector('a[href*="item.rakuten.co.jp"]'); if (!a) return;
        const p = parse(a.href); if (!p) return;
        const k = p.shopSid+':'+p.itemCode; if (seen.has(k)) return;
        seen.add(k); results.push({rank: rn, ...p, url: a.href.split('?')[0]});
      });
      // 上記で足りなければ: ページ内の全 item.rakuten リンクを順番に収集
      if (results.length < maxN) {
        document.querySelectorAll('a[href*="item.rakuten.co.jp"]').forEach(a => {
          if (results.length >= maxN) return;
          const p = parse(a.href); if (!p) return;
          const k = p.shopSid+':'+p.itemCode; if (seen.has(k)) return;
          seen.add(k); results.push({rank: results.length+1, ...p, url: a.href.split('?')[0]});
        });
      }
      return results.slice(0, maxN);
    }, topN);

    items.forEach(it => console.log('    [rank'+it.rank+'] '+it.shopSid+':'+it.itemCode));
    console.log('    fetched: ' + items.length + '/' + topN);
    return items;
  } finally { await page.close(); }
}

async function main() {
  const configs = loadJson(CONFIGS_FILE, []);
  if (!configs.length) { console.log('configs empty, skip'); return; }
  console.log('ranking scrape start: ' + configs.length);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],
  });
  const now = new Date().toISOString();
  const results = [];
  try {
    for (const cfg of configs) {
      const url=cfg.url||'', topN=parseInt(cfg.topN||10), label=cfg.label||url, genreId=cfg.genreId||'';
      if (!url) continue;
      try {
        const items = await scrapeRankingPage(browser, url, topN);
        const enriched = [];
        for (const item of items) {
          await sleep(600);
          console.log('  [enrich] rank'+item.rank+': '+item.shopSid+':'+item.itemCode);
          let detail = item.itemCode ? await enrichViaApi(item.shopSid, item.itemCode) : null;
          if (!detail || !detail.name) {
            console.log('    -> page fallback: ' + item.url);
            detail = await enrichViaPage(browser, item.url, item.shopSid);
            await sleep(1500);
          }
          enriched.push({
            rank: item.rank,
            item_id: item.shopSid+':'+item.itemCode,
            shop_sid: item.shopSid,
            shop_name: (detail&&detail.shop_name)||item.shopSid,
            item_code: item.itemCode,
            url: item.url,
            name: (detail&&detail.name)||'',
            image_url: (detail&&detail.image_url)||'',
            price: (detail&&detail.price)||0,
            review_count: (detail&&detail.review_count)||0,
          });
        }
        results.push({genreId,label,url,topN,fetchedAt:now,items:enriched});
        await sleep(2000);
      } catch(e) { console.error('  error('+label+'): '+e.message); }
    }
  } finally { await browser.close(); }
  saveJson(RESULTS_FILE, {generated_at:now,rankings:results});
  const total = results.reduce((s,r)=>s+r.items.length,0);
  console.log('done: '+results.length+' rankings, '+total+' items');
  results.forEach(r=>{
    console.log('['+r.label+']');
    r.items.forEach(i=>console.log('  '+i.rank+': '+(i.name||'(no name)')+' / '+i.shop_sid+' Y'+i.price));
  });
}

main().catch(e=>{ console.error('Fatal:',e); process.exit(1); });