// Investigate Mavat SV3 Search API - plan discovery
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Load site to get cookies
  console.log('=== Loading homepage ===');
  await page.goto('https://mavat.iplan.gov.il', { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // Test the SV3 search API
  console.log('\n=== 1. Test sv3/Search with empty query (list all?) ===');
  const emptySearch = await page.evaluate(async () => {
    const r = await fetch('https://mavat.iplan.gov.il/rest/api/sv3/Search', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({})
    });
    return { status: r.status, text: await r.text().then(t => t.substring(0, 1000)).catch(() => '') };
  });
  console.log(`Empty search: ${emptySearch.status}`);
  console.log(`Response: ${emptySearch.text}`);

  // Test SV3 search with a wildcard/empty text
  console.log('\n=== 2. Test sv3/Search with text="*" ===');
  const wcSearch = await page.evaluate(async () => {
    const r = await fetch('https://mavat.iplan.gov.il/rest/api/sv3/Search', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ text: '*' })
    });
    const text = await r.text();
    const data = JSON.parse(text);
    return { 
      status: r.status, 
      resultCount: data[0]?.result?.intRecordsCount,
      totalPages: data[0]?.result?.totalPages,
      firstResult: data[0]?.result?.dtResults?.[0]
    };
  });
  console.log(`Wildcard search: ${JSON.stringify(wcSearch, null, 2)}`);

  // Test with partial plan number
  console.log('\n=== 3. Test sv3/Search with specific plan number ===');
  const planSearch = await page.evaluate(async () => {
    const r = await fetch('https://mavat.iplan.gov.il/rest/api/sv3/Search', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ text: '262-0907907' })
    });
    const text = await r.text();
    console.log('Raw response:', text.substring(0, 500));
    const data = JSON.parse(text);
    return { 
      status: r.status, 
      recordsCount: data[0]?.result?.intRecordsCount,
      totalPages: data[0]?.result?.totalPages,
      firstResult: data[0]?.result?.dtResults?.[0]
    };
  });
  console.log(`Plan search: ${JSON.stringify(planSearch, null, 2)}`);

  // Try more search parameters
  console.log('\n=== 4. Test sv3/Search with various params ===');
  const searchTests = [
    { text: '', entityType: 1 },  // Plans only
    { text: '', pageSize: 10, pageNumber: 1 },
    { entityType: 1, pageSize: 100, pageNumber: 1 },
    { entityType: 1, pageSize: 10, pageNumber: 1, sortOrder: 'DESC', sortBy: 'INTERNET_STATUS_DATE' },
  ];
  
  for (const params of searchTests) {
    const result = await page.evaluate(async (p) => {
      const r = await fetch('https://mavat.iplan.gov.il/rest/api/sv3/Search', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(p)
      });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch(e) { data = { error: text.substring(0, 200) }; }
      return { 
        status: r.status,
        params: p,
        resultCount: data[0]?.result?.intRecordsCount,
        totalPages: data[0]?.result?.totalPages,
        resultsReturned: data[0]?.result?.dtResults?.length,
        firstResultEntity: data[0]?.result?.dtResults?.[0]?.ENTITY_TYPE
      };
    }, params);
    console.log(`\nParams ${JSON.stringify(params)}:`);
    console.log(`  Status: ${result.status}, Records: ${result.resultCount}, Pages: ${result.totalPages}, Returned: ${result.resultsReturned}`);
  }

  // Test the SV3 page for advanced search
  console.log('\n=== 5. Visit /SV3 route for advanced search ===');
  await page.goto('https://mavat.iplan.gov.il/SV3', { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 3000));
  console.log(`SV3 URL: ${page.url()}`);
  const sv3Text = await page.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log(`SV3 content:\n${sv3Text}`);

  // Check if SV3 has a search form
  const sv3Html = await page.evaluate(() => document.querySelector('app-root')?.innerHTML?.substring(0, 3000) || 'N/A');
  console.log(`\nSV3 HTML snippet:\n${sv3Html}`);

  await browser.close();
  console.log('\n=== DONE ===');
})();
