/**
 * scrape_rankings.js
 * Puppeteerで楽天ランキングページをスクレイピングし、
 * 商品URLを抽出 → 楽天APIで詳細補完（失敗時はPuppeteerでフォールバック）
 * → ranking_results.json に保存
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const APP_ID       = process.env.RAKUTEN_APP_ID     || '';
const ACCESS_KEY   = process.env.RAKUTEN_ACCESS_KEY || '';
const CONFIGS_FILE = 'data/ranking_configs.json';
const RESULTS_FILE = 'data/ranking_results.json';
const RAKUTEN_API  = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601';

function loadJson(p, d) {
  if (fs.existsSync(p)) { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch(e) { return d; } }
  return d;
}
function saveJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
    console.log('    [API] ' + shopSid + ':' + itemCode + ' => Items empty');
  } catch(e) {
    console.log('    [API] error: ' + e.message);
  }
  return null;
}

async function enrichViaPage(browser, itemUrl, shopSid) {
  if (!itemUrl) return null;
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(itemUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const detail = await page.evaluate(() => {
      const nameEl = document.querySelector('h1[itemprop="name"], .item_name, #itemName, h1');
      const name = nameEl ? nameEl.textContent.trim().slice(0, 80) : '';
      const priceEl = document.querySelector('.price2, [itemprop="price"], .item-price');
      let price = 0;
      if (priceEl) { const m = priceEl.textContent.replace(/,/g,'').match(/\d+/); if (m) price = parseInt(m[0]); }
      const imgEl = document.querySelector('img[id*="IMG"], img.item-image, [itemprop="image"]');
      const image_url = imgEl ? (imgEl.src || imgEl.content || '') : '';
      const reviewEl = document.querySelector('.revCnt, [itemprop="reviewCount"]');
      const review_count = reviewEl ? parseInt(reviewEl.textContent.replace(/[^0-9]/g,'') || '0') : 0;
      const shopEl = document.querySelector('.shop-name, [itemprop="seller"], .store-name');
      const shop_name = shopEl ? shopEl.textContent.trim() : '';
      return { name, price, image_url, review_count, shop_name };
    });
    if (detail.name) {
      console.log('    [Page] OK: ' + detail.name.slice(0,30) + ' Y' + detail.price);
      return Object.assign(detail, { shop_name: detail.shop_name || shopSid });
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
    const debug = await page.evaluate(() => ({
      title: document.title.slice(0,60),
      topBg: document.querySelectorAll('.rnkRanking_topBgColor').length,
      top3:  document.querySelectorAll('.rnkRanking_top3box').length,
      disp:  document.querySelectorAll('.rnkRanking_dispRank').length,
      links: document.querySelectorAll('a[href*="item.rakuten.co.jp"]').length,
    }));
    console.log('    [debug] "' + debug.title + '" topBg=' + debug.topBg + ' top3=' + debug.top3 + ' disp=' + debug.disp + ' links=' + debug.links);
    const items = await page.evaluate((maxN) => {
      const seen = new Set(), results = [];
      function parse(href) {
        const m = href.match(/https?:\/\/item\.rakuten\.co\.jp\/([^/]+)\/([^/?#]+)/);
        return m ? { shopSid: m[1], itemCode: m[2] } : null;
      }
      const t1 = document.querySelector('.rnkRanking_topBgColor a[href*="item.rakuten.co.jp"]');
      if (t1) { const p = parse(t1.href); if (p) { const k = p.shopSid+':'+p.itemCode; if (!seen.has(k)) { seen.add(k); results.push({ rank:1, ...p, url:t1.href.split('?')[0] }); } } }
      document.querySelectorAll('.rnkRanking_top3box a[href*="item.rakuten.co.jp"]').forEach(a => {
        if (results.length >= maxN) return;
        const p = parse(a.href); if (!p) return;
        const k = p.shopSid+':'+p.itemCode; if (seen.has(k)) return;
        seen.add(k); results.push({ rank: results.length+1, ...p, url: a.href.split('?')[0] });
      });
      document.querySelectorAll('.rnkRanking_dispRank').forEach(el => {
        if (results.length >= maxN) return;
        const rn = parseInt(el.textContent); if (isNaN(rn)) return;
        const c = el.closest('li') || el.parentElement; if (!c) return;
        const a = c.querySelector('a[href*="item.rakuten.co.jp"]'); if (!a) return;
        const p = parse(a.href); if (!p) return;
        const k = p.shopSid+':'+p.itemCode; if (seen.has(k)) return;
        seen.add(k); results.push({ rank: rn, ...p, url: a.href.split('?')[0] });
      });
      if (results.length === 0) {
        document.querySelectorAll('a[href*="item.rakuten.co.jp"]').forEach(a => {
          if (results.length >= maxN) return;
          const p = parse(a.href); if (!p) return;
          const k = p.shopSid+':'+p.itemCode; if (seen.has(k)) return;
          seen.add(k); results.push({ rank: results.length+1, ...p, url: a.href.split('?')[0] });
        });
      }
      return results.slice(0, maxN);
    }, topN);
    items.forEach(it => console.log('    [rank' + it.rank + '] ' + it.shopSid + ':' + it.itemCode + ' => ' + it.url));
    console.log('    fetched: ' + items.length);
    return items;
  } finally { await page.close(); }
}

async function main() {
  const configs = loadJson(CONFIGS_FILE, []);
  if (!configs.length) { console.log('configs empty, skip'); return; }
  console.log('\nranking scrape start: ' + configs.length);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],
  });
  const now = new Date().toISOString();
  const results = [];
  try {
    for (const cfg of configs) {
      const url = cfg.url || '', topN = parseInt(cfg.topN||10), label = cfg.label||url, genreId = cfg.genreId||'';
      if (!url) continue;
      try {
        const items = await scrapeRankingPage(browser, url, topN);
        const enriched = [];
        for (const item of items) {
          await sleep(500);
          console.log('  [enrich] rank' + item.rank + ': ' + item.shopSid + ':' + item.itemCode);
          // itemCodeが空の場合は即Puppeteerフォールバック
          let detail = item.itemCode ? await enrichViaApi(item.shopSid, item.itemCode) : null;
          if (!detail || !detail.name) {
            console.log('    -> fallback to page: ' + item.url);
            detail = await enrichViaPage(browser, item.url, item.shopSid);
            await sleep(1000);
          }
          enriched.push({
            rank: item.rank,
            item_id: item.shopSid + ':' + item.itemCode,
            shop_sid: item.shopSid,
            shop_name: (detail && detail.shop_name) || item.shopSid,
            item_code: item.itemCode,
            url: item.url,
            name: (detail && detail.name) || '',
            image_url: (detail && detail.image_url) || '',
            price: (detail && detail.price) || 0,
            review_count: (detail && detail.review_count) || 0,
          });
        }
        results.push({ genreId, label, url, topN, fetchedAt: now, items: enriched });
        await sleep(2000);
      } catch(e) { console.error('  error (' + label + '): ' + e.message); }
    }
  } finally { await browser.close(); }
  saveJson(RESULTS_FILE, { generated_at: now, rankings: results });
  const total = results.reduce((s,r) => s + r.items.length, 0);
  console.log('\ndone: ' + results.length + ' rankings, ' + total + ' items');
  results.forEach(r => {
    console.log('[' + r.label + ']');
    r.items.forEach(i => console.log('  ' + i.rank + ': ' + (i.name||'(no name)') + ' / ' + i.shop_sid + ' Y' + i.price));
  });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });