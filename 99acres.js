const puppeteer = require('puppeteer');
const fs = require('fs');
const { exit } = require('process');

async function scrape(url = 'https://www.99acres.com/search/property/buy/residential-all/trivandrum?city=138&bedroom_num=3&property_type=2%2C3%2C4%2C22%2C80%2C90&preference=S&area_unit=1&res_com=R&sortby=date_d', outputFile = 'output-99acres.json') {
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

    const appJsMatch = pageContent.match(/window\.__initialData__\s*=\s*([\s\S]*?)window\.__masked__\s*=\s*false/);
    if (appJsMatch) {
      try {
        let fixedAppJs = appJsMatch[1]        
        fixedAppJs = fixedAppJs.replace(/window\.__masked__\s*=\s*false;/g, '');

        fixedAppJs = fixedAppJs.replace(/;\s*$/, '');
      
        let appObjRaw = JSON.parse(fixedAppJs);

        let elements = appObjRaw.srp.pageData.properties;
        if (!elements) {
          console.error('No elements found in appObjRaw.states.items.elements');
          fs.writeFileSync(outputFile, JSON.stringify([]), 'utf-8');
          await browser.close();
          return;
        }

        // write to output file
        fs.writeFileSync(outputFile, JSON.stringify(elements, null, 2), 'utf-8');
        
      } catch (e) {
        console.error('Failed to parse window.__APP JS object:', e);
        console.error('Stack:', e.stack);
        await browser.close();
        return;
      }
    } else {
      console.error('window.__APP not found in HTML.');
      // Optionally log a snippet of pageContent for debugging
      console.error('First 1000 chars of pageContent:', pageContent.slice(0, 1000));
      await browser.close();
      return;
    }
    await browser.close();
  } catch (err) {
    console.error('Fatal error in scrape:', err);
    if (browser) await browser.close();
    return;
  }
}

if (require.main === module) {
  // Allow running standalone for local testing
  scrape().catch(err => process.exit(1));
}

module.exports = scrape;
