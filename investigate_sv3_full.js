// Investigate Mavat SV3 Search API - pagination, change detection, all plans
const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const out = [];
  const log = (m) => { out.push(m); console.log(m); };

  page.on('response', async res => {
    const url = res.url();
    if (url.includes('rest/api/sv3/Search')) {
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('json')) {
          const body = await res.text().catch(() => '');
          const data = JSON.parse(body);
          const result = data[0]?.result;
          if (result) {
            log(`\n[SV3 Search Response]`);
            log(`  Total records: ${result.intRecordsCount}`);
            log(`  Total pages: ${result.totalPages}`);
            log(`  Results on this page: ${result.dtResults?.length || 0}`);
            if (result.dtResults?.length > 0) {
              const first = result.dtResults[0];
              log(`  First result fields: ${Object.keys(first).join(', ')}`);
              log(`  First result MP_ID: ${first.MP_ID}, Entity: ${first.ENTITY_NUMBER}, Status: ${first.INTERNET_SHORT_STATUS}, Update: ${first.UPDATE_DATE}`);
              // Also show last result for pagination check
              const last = result.dtResults[result.dtResults.length - 1];
              log(`  Last result MP_ID: ${last.MP_ID}, Entity: ${last.ENTITY_NUMBER}, Update: ${last.UPDATE_DATE}`);
            }
          }
        }
      } catch(e) {
        log(`Error parsing SV3 response: ${e.message}`);
      }
    }
  });

  // Load site first
  log('=== Loading homepage ===');
  await page.goto('https://mavat.iplan.gov.il', { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // Test 1: Search ALL plans (no date filter, no type filter)
  log('\n=== Test 1: Search ALL plans (no filters) ===');
  await page.goto('https://mavat.iplan.gov.il/SV3?searchEntity=1&searchType=1&searchMethod=2', { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  log(`URL after: ${page.url()}`);

  // Test 2: Search plans in deposit process (תכניות בתהליך הפקדה)
  log('\n=== Test 2: Plans in deposit process ===');
  // Click the "תכניות בתהליך הפקדה" button
  const depositClicked = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      if (btn.textContent.includes('תכניות בתהליך הפקדה')) {
        btn.click();
        return true;
      }
    }
    return false;
  });
  log(`Clicked deposit filter: ${depositClicked}`);
  await new Promise(r => setTimeout(r, 3000));

  // Test 3: Search all plans with no status filter
  log('\n=== Test 3: Click "כל התכניות" (All plans) ===');
  const allClicked = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      if (btn.textContent.includes('כל התכניות')) {
        btn.click();
        return true;
      }
    }
    return false;
  });
  log(`Clicked all plans: ${allClicked}`);
  await new Promise(r => setTimeout(r, 3000));

  // Test 4: Pagination - get page 2
  log('\n=== Test 4: Scroll to load more (pagination) ===');
  // The "הצג עוד" (show more) button
  const showMoreClicked = await page.evaluate(() => {
    const btns = document.querySelectorAll('button, a, span');
    for (const btn of btns) {
      if (btn.textContent.includes('הצג עוד')) {
        btn.click();
        return true;
      }
    }
    return false;
  });
  log(`Clicked show more: ${showMoreClicked}`);
  await new Promise(r => setTimeout(r, 5000));

  // Test 5: Try SV3 with no query params (default search)
  log('\n=== Test 5: SV3 without params ===');
  await page.goto('https://mavat.iplan.gov.il/SV3', { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 3000));
  log(`SV3 URL: ${page.url()}`);

  // Test 6: Search with broader date range
  log('\n=== Test 6: Searching with "כל התכניות" filter ===');
  // Read the page to see what search was executed
  const allPlansCount = await page.evaluate(() => {
    const allText = document.body.innerText;
    const match = allText.match(/תכניות\s*\((\d+)\)/);
    return match ? match[1] : 'unknown';
  });
  log(`Total plans count displayed: ${allPlansCount}`);

  // Test 7: Look at the result fields more carefully
  log('\n=== Test 7: Results analysis ===');
  const resultFields = await page.evaluate(async () => {
    const response = await fetch('https://mavat.iplan.gov.il/rest/api/sv3/Search', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        searchEntity: 1,
        searchType: 1,
        fromResult: 1,
        toResult: 3,
        _page: 1
      })
    });
    const data = await response.json();
    const result = data[0]?.result;
    return {
      recordsCount: result?.intRecordsCount,
      totalPages: result?.totalPages,
      fields: result?.dtResults?.[0] ? Object.keys(result.dtResults[0]) : [],
      sampleResult: result?.dtResults?.[0]
    };
  });
  log(`Total records: ${resultFields.recordsCount}`);
  log(`Total pages: ${resultFields.totalPages}`);
  log(`All fields: ${resultFields.fields?.join(', ')}`);
  log(`Sample result:\n${JSON.stringify(resultFields.sampleResult, null, 2)}`);

  // Test 8: Check if UPDATE_DATE changes when plan is modified
  log('\n=== Test 8: Check multiple plans for change detection ===');
  const planUpdates = await page.evaluate(async () => {
    const response = await fetch('https://mavat.iplan.gov.il/rest/api/sv3/Search', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        searchEntity: 1,
        searchType: 1,
        fromResult: 1,
        toResult: 5,
        _page: 1
      })
    });
    const data = await response.json();
    return data[0]?.result?.dtResults?.map(r => ({
      mp_id: r.MP_ID,
      entity_number: r.ENTITY_NUMBER,
      entity_name: r.ENTITY_NAME?.substring(0, 40),
      update_date: r.UPDATE_DATE,
      app_date: r.APP_DATE,
      internet_status_date: r.INTERNET_STATUS_DATE,
      bi_status_date: r.BI_STATUS_DATE,
      status: r.INTERNET_SHORT_STATUS,
      unified_status: r.UNIFIED_STATUS_DESC
    })) || [];
  });
  log('Sample plans update info:');
  planUpdates.forEach(p => log(`  ${p.mp_id} | ${p.entity_number} | Update: ${p.update_date} | Status: ${p.status} | StatusDate: ${p.internet_status_date}`));

  // Test 9: Search by plan number directly (for individual lookups)
  log('\n=== Test 9: Search by specific plan number ===');
  const specificPlan = await page.evaluate(async () => {
    const response = await fetch('https://mavat.iplan.gov.il/rest/api/sv3/Search', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        searchEntity: 1,
        searchType: 1,
        plNumber: '262-0907907',
        fromResult: 1,
        toResult: 5,
        _page: 1
      })
    });
    const data = await response.json();
    return data[0]?.result?.dtResults?.map(r => ({
      mp_id: r.MP_ID,
      entity_number: r.ENTITY_NUMBER,
      update_date: r.UPDATE_DATE,
      bi_status_date: r.BI_STATUS_DATE,
      status: r.INTERNET_SHORT_STATUS,
      app_date: r.APP_DATE
    })) || [];
  });
  log(`Specific plan search: ${JSON.stringify(specificPlan)}`);

  // Test 10: Search without reCAPTCHA (just to see the error)
  log('\n=== Test 10: Check what token looks like ===');
  const tokenInfo = await page.evaluate(async () => {
    // Get the token from a successful call
    const response = await fetch('https://mavat.iplan.gov.il/rest/api/sv3/Search', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        searchEntity: 1,
        searchType: 1,
        fromResult: 1,
        toResult: 2,
        _page: 1
      })
    });
    const data = await response.json();
    return { status: response.status };
  });
  log(`Test search status: ${tokenInfo.status}`);

  fs.writeFileSync('/app/investigate_sv3_results.txt', out.join('\n'));
  await browser.close();
  log('\n=== DONE ===');
})();
