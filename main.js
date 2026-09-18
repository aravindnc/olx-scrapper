const fs = require('fs');
const puppeteer = require('puppeteer');

const DEFAULT_API_URL = 'https://api.olx.in/relevance/v4/search?category=1723&facet_limit=1000&location=4058889&location_facet_limit=40&page=1&platform=web-desktop&pttEnabled=true&price_max=20000&relaxedFilters=true&size=40&user=anonymous&lang=en-IN';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8',
  'Origin': 'https://www.olx.in',
  'Referer': 'https://www.olx.in/'
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function fetchUserContact(userId, userCache = new Map()) {
  if (!userId) return { phone: null, name: null };
  if (userCache.has(userId)) {
    return userCache.get(userId);
  }

  try {
    const userApiUrl = `https://www.olx.in/api/v3/users/${userId}`;
    const res = await fetchWithTimeout(userApiUrl, { headers: HEADERS }, 10000);
    if (!res.ok) {
      userCache.set(userId, { phone: null, name: null });
      return { phone: null, name: null };
    }

    const userJson = await res.json();
    let phone = null;
    let name = null;

    if (userJson && userJson.data) {
      if (userJson.data.phone) {
        phone = userJson.data.phone;
      } else if (
        userJson.data.contacts &&
        Array.isArray(userJson.data.contacts.phones) &&
        userJson.data.contacts.phones.length > 0
      ) {
        phone = userJson.data.contacts.phones[0];
      }

      if (userJson.data.name) {
        name = userJson.data.name;
      } else if (userJson.data.first_name || userJson.data.last_name) {
        name = `${userJson.data.first_name || ''} ${userJson.data.last_name || ''}`.trim();
      }
    }

    const result = { phone, name };
    userCache.set(userId, result);
    return result;
  } catch (err) {
    userCache.set(userId, { phone: null, name: null });
    return { phone: null, name: null };
  }
}

async function fetchViaPuppeteer(apiUrl) {
  console.log('Attempting fetch via headless Puppeteer browser...');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setUserAgent(HEADERS['User-Agent']);
    await page.setExtraHTTPHeaders({
      'Accept-Language': HEADERS['Accept-Language']
    });

    const response = await page.goto(apiUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    const text = await response.text();
    const json = JSON.parse(text);
    await browser.close();
    return json;
  } catch (err) {
    if (browser) await browser.close();
    throw err;
  }
}

async function scrapeOlx(apiUrl = DEFAULT_API_URL, outputFile = 'output.json') {
  try {
    console.log(`Fetching OLX listings from API: ${apiUrl}`);
    let json = null;

    try {
      const response = await fetchWithTimeout(apiUrl, { headers: HEADERS }, 15000);
      if (!response.ok) {
        throw new Error(`OLX API request failed with status: ${response.status} ${response.statusText}`);
      }
      json = await response.json();
    } catch (directFetchErr) {
      console.warn(`Direct fetch failed (${directFetchErr.message}). Switching to Puppeteer fallback...`);
      json = await fetchViaPuppeteer(apiUrl);
    }

    const items = json && Array.isArray(json.data) ? json.data : [];
    console.log(`Received ${items.length} items from OLX API.`);

    const userCache = new Map();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      item.url = item.url || `https://www.olx.in/item/iid-${item.id}`;

      if (item.user_id) {
        const contact = await fetchUserContact(item.user_id, userCache);
        item.phone = contact.phone || null;
        if (!item.user_name && contact.name) {
          item.user_name = contact.name;
        }
      } else {
        item.phone = null;
      }
    }

    fs.writeFileSync(outputFile, JSON.stringify(items, null, 2), 'utf-8');
    console.log(`✅ Saved ${items.length} OLX items with contact info to ${outputFile}`);
    return items;
  } catch (err) {
    console.error('Fatal error in scrapeOlx:', err);
    fs.writeFileSync(outputFile, JSON.stringify([]), 'utf-8');
    return [];
  }
}

if (require.main === module) {
  scrapeOlx().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = scrapeOlx;
