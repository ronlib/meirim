// Investigate Mavat SV3 search with the discovered URL
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Capture ALL api calls
  page.on('response', async res => {
    const url = res.url();
    if (url.includes('rest/api/sv3') || url.includes('rest/api/SV3') || url.includes('rest/api/SV4/1?mid=')) {
      try {
        const ct = res.headers()['content-type'] || '';
        let body = '';
        if (ct.includes('json')) {
          body = await res.text().catch(() => '');
          if (body.length > 800) body = body.substring(0, 800) + '\n...';
        }
        console.log(`\n[${res.status()}] ${url.split('?')[0]}`);
        console.log(`  Body: ${body}`);
      } catch(e) {}
    }
  });

  // Also capture POST requests
  page.on('request', req => {
    if (req.url().includes('rest/api/sv3') && req.method() === 'POST') {
      console.log(`\n[POST] ${req.url()}`);
      console.log(`  Payload: ${req.postData()}`);
    }
  });

  // Load homepage first
  console.log('=== Loading homepage ===');
  await page.goto('https://mavat.iplan.gov.il', { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // Visit the discovered search URL
  console.log('\n=== Visiting SV3 search URL ===');
  await page.goto('https://mavat.iplan.gov.il/SV3?searchEntity=1&searchType=3&searchMethod=2', { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  console.log(`URL: ${page.url()}`);

  // Get page content
  const sv3Content = await page.evaluate(() => document.body.innerText.substring(0, 3000));
  console.log(`\nSV3 page content:\n${sv3Content}`);

  // Try clicking a search/filter option to trigger API call
  console.log('\n=== Clicking "כל התכניות" (All plans) ===');
  const clicked = await page.evaluate(() => {
    const links = document.querySelectorAll('a, button, span, div');
    for (const el of links) {
      const text = el.textContent?.trim();
      if (text === 'כל התכניות' || text === 'תכניות' || text.includes('הכל')) {
        el.click();
        return { tag: el.tagName, text: text?.substring(0, 50) };
      }
    }
    return null;
  });
  console.log(`Clicked: ${JSON.stringify(clicked)}`);
  await new Promise(r => setTimeout(r, 5000));

  const afterClick = await page.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log(`\nAfter click content:\n${afterClick}`);

  // Try to find and click the "חיפוש" (search) button on SV3
  console.log('\n=== Looking for search button on SV3 ===');
  const elements = await page.evaluate(() => {
    const all = document.querySelectorAll('button, a[href], input[type="submit"], [role="button"]');
    return Array.from(all).map(el => ({
      tag: el.tagName,
      text: el.textContent?.trim()?.substring(0, 80),
      type: el.type || '',
      className: el.className?.substring(0, 60),
      href: el.href || '',
      id: el.id || ''
    })).filter(el => el.text || el.href || el.id);
  });
  console.log(`Found ${elements.length} interactive elements`);
  elements.slice(0, 30).forEach(el => console.log(`  <${el.tag}> text="${el.text}" type="${el.type}" href="${el.href}"`));

  await browser.close();
  console.log('\n=== DONE ===');
})();
