// Investigate Mavat - find plan discovery mechanisms
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  page.on('response', async res => {
    const url = res.url();
    if (url.includes('rest/api') && !url.includes('.js') && !url.includes('.css') && !url.includes('google') && !url.includes('recaptcha') && !url.includes('analytics') && !url.includes('gtm')) {
      try {
        const ct = res.headers()['content-type'] || '';
        let body = '';
        if (ct.includes('json')) {
          body = await res.text().catch(() => '');
          if (body.length > 600) body = body.substring(0, 600) + '\n...';
        } else if (res.status() === 404) {
          body = '(404)';
        }
        console.log(`\n[${res.status()}] ${url.split('?')[0]}`);
        if (body) console.log(`  ${body}`);
      } catch(e) {}
    }
  });

  // Load site to get cookies
  console.log('=== Loading homepage ===');
  await page.goto('https://mavat.iplan.gov.il', { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // Test known good MP_ID
  console.log('\n=== Testing MP_ID 2005099108 ===');
  await page.goto('https://mavat.iplan.gov.il/SV4/1/2005099108/310', { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  console.log(`URL: ${page.url()}`);
  const planText = await page.evaluate(() => document.body.innerText.substring(0, 1500));
  console.log(`Content: ${planText}`);

  // Try search endpoint
  console.log('\n=== Testing search on SV1 ===');
  await page.goto('https://mavat.iplan.gov.il/SV1', { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));

  // Type in search box
  const searchInput = await page.waitForSelector('#sv3-search__input', { timeout: 5000 }).catch(() => null);
  if (searchInput) {
    await searchInput.click();
    await searchInput.type('262-0907907', { delay: 30 });
    await new Promise(r => setTimeout(r, 1500));
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 5000));
    console.log(`Search URL: ${page.url()}`);
    const searchText = await page.evaluate(() => document.body.innerText.substring(0, 1500));
    console.log(`Search result: ${searchText}`);
  }

  // Try getBiStatusByType endpoint
  console.log('\n=== Testing getBiStatusByType ===');
  const statusResult = await page.evaluate(async () => {
    const r = await fetch('https://mavat.iplan.gov.il/rest/api/getBiStatusByType/', { 
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });
    const text = await r.text();
    return { status: r.status, contentType: r.headers.get('content-type'), text: text.substring(0, 500) };
  });
  console.log(`Status: ${statusResult.status}`);
  console.log(`Body: ${statusResult.text}`);

  // Try Luts endpoint for all table types
  console.log('\n=== Luts all types ===');
  const allTypes = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,39,48,52,53];
  const lutsUrl = `https://mavat.iplan.gov.il/rest/api/Luts/${allTypes.join('-')}`;
  const lutsResult = await page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    const text = await r.text();
    const data = JSON.parse(text);
    return { status: r.status, keys: Object.keys(data) };
  }, lutsUrl);
  console.log(`Luts tables: ${lutsResult.keys.join(', ')}`);

  // Try more Luts table type numbers
  console.log('\n=== Testing more Luts types ===');
  const moreLuts = [];
  for (let i = 19; i <= 60; i++) {
    if (![4,5,6,7,8,9,10,11,39,48,52,53,1,2,3,12,13,14,15,16,17,18].includes(i)) {
      moreLuts.push(i);
    }
  }
  for (let start = 0; start < moreLuts.length; start += 5) {
    const batch = moreLuts.slice(start, start + 5);
    const url = `https://mavat.iplan.gov.il/rest/api/Luts/${batch.join('-')}`;
    const result = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'include' });
      return { status: r.status, length: (await r.text()).length };
    }, url);
    console.log(`Luts/${batch.join('-')} => ${result.status} (${result.length} bytes)`);
  }

  // Try the old Mavat search page
  console.log('\n=== Checking old mavat search ===');
  const oldSearch = await page.evaluate(async () => {
    try {
      const r = await fetch('http://mavat.moin.gov.il/MavatPS/Forms/SV3.aspx?tid=3', { 
        mode: 'no-cors',
        headers: { 'Accept': 'text/html' } 
      });
      return { status: r.status, type: r.type };
    } catch(e) {
      return { error: e.message };
    }
  });
  console.log(`Old mavat: ${JSON.stringify(oldSearch)}`);

  // Check Angular routes from the main bundle
  console.log('\n=== Angular routes from main bundle ===');
  const bundleSrc = await page.evaluate(() => {
    const scripts = document.querySelectorAll('script[src]');
    const mainScript = Array.from(scripts).find(s => s.src.includes('main.'));
    return mainScript ? mainScript.src : null;
  });
  
  if (bundleSrc) {
    const mainContent = await page.evaluate(async (url) => {
      const r = await fetch(url);
      return await r.text();
    }, bundleSrc);
    
    // Find Angular route patterns
    const routeRegex = /path:\s*['"]([^'"]+)['"]/g;
    let m;
    const routes = new Set();
    while ((m = routeRegex.exec(mainContent)) !== null) {
      if (m[1].length > 1 && !m[1].includes(':') && !m[1].includes('*')) {
        routes.add(m[1]);
      }
    }
    console.log('Angular routes:');
    routes.forEach(r => console.log(`  /${r}`));
    
    // Find API endpoints
    const apiRegex = /['"]([a-zA-Z]*api\/[a-zA-Z0-9_/]+)['"]/g;
    const apis = new Set();
    while ((m = apiRegex.exec(mainContent)) !== null) {
      apis.add(m[1]);
    }
    console.log('\nAPI endpoints in main bundle:');
    apis.forEach(a => console.log(`  ${a}`));
  }

  await browser.close();
  console.log('\n=== DONE ===');
})();
