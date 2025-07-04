const puppeteer = require('puppeteer');
const fs = require('fs');
const { exit } = require('process');

async function scrapeOlx(url = 'https://www.olx.in/thiruvananthapuram_g4058889/for-sale-houses-apartments_c1725?sorting=desc-creation&filter=rooms_eq_3', outputFile = 'output.json') {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: [
    '--no-sandbox',
    '--disable-setuid-sandbox'
  ] });
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    );
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    const pageContent = await page.content();
    // Extract <script type="application/ld+json" data-rh="true"> JSON
    let appUrls = null;
    let itemListElement = null;
    let itemUrls = [];
    const itemUrlObj = {};
    const ldJsonMatch = pageContent.match(/<\/script><script type="application\/ld\+json" data-rh="true">([\s\S]*?)<\/script>/);
    if (ldJsonMatch) {
      try {
        appUrls = JSON.parse(ldJsonMatch[1]);
        itemListElement = appUrls['@graph'] && appUrls['@graph']['itemListElement'];
        if (itemListElement && Array.isArray(itemListElement)) {
          itemListElement.forEach(item => {
            itemUrls.push(item.url);
          });
          itemUrls.forEach(url => {
            const match = url.match(/iid-(\d+)/);
            if (match) {
              itemUrlObj[match[1]] = url;
            }
          });
        } else {
          console.warn('itemListElement missing or not an array.');
        }
      } catch (e) {
        console.error('Failed to parse ld+json:', e);
        appUrls = null;
      }
    } else {
      console.warn('ld+json script not found.');
    }

    // Extract window.__APP
    const appJsMatch = pageContent.match(/window\.__APP\s*=\s*([\s\S]*?)<\/script>/);
    if (appJsMatch) {
      try {
        let fixedAppJs = appJsMatch[1]
          .replace(/(?<![\w"'])props(?![\w"'])/g, '"props"')
          .replace(/(?<![\w"'])config(?![\w"'])/g, '"config"')
          .replace(/(?<![\w"'])states(?![\w"'])/g, '"states"');
        fixedAppJs = fixedAppJs.replace(/;\s*$/, '');
        fixedAppJs = fixedAppJs.replace(/}\s*$/, '');
        fixedAppJs = fixedAppJs.replace(/,\s*$/, '');
        fixedAppJs += '}';
        let appObjRaw = JSON.parse(fixedAppJs);
        let elements = appObjRaw.states && appObjRaw.states.items && appObjRaw.states.items.elements;
        if (!elements) {
          console.error('No elements found in appObjRaw.states.items.elements');
          fs.writeFileSync(outputFile, JSON.stringify([]), 'utf-8');
          await browser.close();
          return;
        }
        elements = Object.values(elements).map(item => {
          item.url = itemUrlObj[item.id] || item.url;
          item.url = itemUrlObj[item.id] || item.url;
          item.phone = null; // Placeholder for phone number
          item.user_name = null; // Placeholder for user name
          return item;
        });
        // Save appObjRaw as JSON for GitHub Action
        // Fetch phone numbers for each user
        for (let i = 0; i < elements.length; i++) {
          const userId = elements[i].user_id;
          if (userId) {
            try {
              const userApiUrl = `https://www.olx.in/api/v3/users/${userId}`;
              const userResponse = await page.goto(userApiUrl, { waitUntil: 'networkidle2', timeout: 20000 });
              const userJson = await userResponse.json();
              // Improved phone and user name extraction logic
              if (userJson && userJson.data) {
                // Phone
                if (userJson.data.phone) {
                  elements[i].phone = userJson.data.phone;
                } else if (
                  userJson.data.contacts &&
                  Array.isArray(userJson.data.contacts.phones) &&
                  userJson.data.contacts.phones.length > 0
                ) {
                  elements[i].phone = userJson.data.contacts.phones[0];
                }
                // User name
                if (userJson.data.name) {
                  elements[i].user_name = userJson.data.name;
                } else if (userJson.data.first_name || userJson.data.last_name) {
                  elements[i].user_name = ((userJson.data.first_name || '') + ' ' + (userJson.data.last_name || '')).trim();
                }
              }
            } catch (e) {
              // Ignore fetch errors, keep phone and user_name as null
            }
          }
        }
        fs.writeFileSync(outputFile, JSON.stringify(elements), 'utf-8');
        console.log(`✅ appObjRaw with phones saved to ${outputFile}`);
      } catch (e) {
        console.error('Failed to parse window.__APP JS object:', e);
        console.error('Stack:', e.stack);
        fs.writeFileSync(outputFile, JSON.stringify([]), 'utf-8');
        await browser.close();
        return;
      }
    } else {
      console.error('window.__APP not found in HTML.');
      // Optionally log a snippet of pageContent for debugging
      console.error('First 1000 chars of pageContent:', pageContent.slice(0, 1000));
      fs.writeFileSync(outputFile, JSON.stringify([]), 'utf-8');
      await browser.close();
      return;
    }
    await browser.close();
  } catch (err) {
    console.error('Fatal error in scrapeOlx:', err);
    if (browser) await browser.close();
    fs.writeFileSync(outputFile, JSON.stringify([]), 'utf-8');
    return;
  }
}

if (require.main === module) {
  // Allow running standalone for local testing
  scrapeOlx().catch(err => process.exit(1));
}

module.exports = scrapeOlx;
