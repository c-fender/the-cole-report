import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cheerio from 'cheerio';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Helper: fetch with timeout and error handling
async function proxyFetch(url, errorMsg = 'Failed to fetch data') {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    return data;
  } catch (err) {
    console.error(errorMsg, err.message);
    return { error: errorMsg, details: err.message };
  }
}

// Brent Crude (EIA)
app.get('/api/brent', async (req, res) => {
  const key = process.env.EIA_API_KEY;
  if (!key) return res.json({ error: 'EIA_API_KEY not set' });
  const url = `https://api.eia.gov/series/?series_id=PET.RBRTE.D&api_key=${key}`;
  const data = await proxyFetch(url, 'Brent fetch failed');
  if (data?.error) return res.json(data);

  // Normalize to the same shape used by the frontend
  const points = Array.isArray(data?.series?.[0]?.data) ? data.series[0].data : [];
  const normalized = points.map((p) => ({ date: p[0], value: p[1] }));
  res.json({
    name: 'Brent Crude Oil Spot Price',
    interval: 'daily',
    unit: 'dollars per barrel',
    data: normalized,
  });
});

// US 10Y Treasury (Alpha Vantage FRED)
app.get('/api/treasury', async (req, res) => {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return res.json({ error: 'ALPHA_VANTAGE_API_KEY not set' });
  const url = `https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=daily&maturity=10year&apikey=${key}`;
  const data = await proxyFetch(url, 'Treasury fetch failed');
  res.json(data);
});

// Helper: scrape gas prices from AAA page
async function scrapeGasPrices(url, errorLabel = 'AAA gas') {
  const resFetch = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  const html = await resFetch.text();
  const $ = cheerio.load(html);
  const rowLabels = ['current', 'yesterday', 'weekAgo', 'monthAgo', 'yearAgo'];
  const colKeys = ['regular', 'midGrade', 'premium', 'diesel'];
  const rows = [];
  const baseSelector = 'main > div:nth-child(3) > div:nth-child(3) > table > tbody > tr';
  const fallbackLabels = ['Current Avg.', 'Yesterday Avg.', 'Week Ago Avg.', 'Month Ago Avg.', 'Year Ago Avg.'];

  for (let r = 0; r < 5; r++) {
    const row = { label: rowLabels[r], regular: null, midGrade: null, premium: null, diesel: null };
    for (let c = 0; c < 4; c++) {
      let cell = $(`${baseSelector}:nth-child(${r + 1}) > td:nth-child(${c + 2})`).text().trim();
      if (!cell) {
        $('table tbody tr').each((_, tr) => {
          const tds = $(tr).find('td');
          if ($(tds[0]).text().includes(fallbackLabels[r]) && tds.length > c + 1) {
            cell = $(tds[c + 1]).text().trim();
            return false;
          }
        });
      }
      const match = cell?.match(/\$?([\d.]+)/);
      row[colKeys[c]] = match ? match[1] : null;
    }
    rows.push(row);
  }
  return { rows };
}

// Gas prices - National
app.get('/api/gas', async (req, res) => {
  try {
    const data = await scrapeGasPrices('https://gasprices.aaa.com/');
    res.json(data);
  } catch (err) {
    console.error('AAA national gas scrape failed', err.message);
    res.json({ error: 'AAA gas scrape failed', details: err.message });
  }
});

// Gas prices - North Carolina
app.get('/api/gas/nc', async (req, res) => {
  try {
    const data = await scrapeGasPrices('https://gasprices.aaa.com/?state=NC');
    res.json(data);
  } catch (err) {
    console.error('AAA NC gas scrape failed', err.message);
    res.json({ error: 'AAA NC gas scrape failed', details: err.message });
  }
});

// Gas prices - South Carolina
app.get('/api/gas/sc', async (req, res) => {
  try {
    const data = await scrapeGasPrices('https://gasprices.aaa.com/?state=SC');
    res.json(data);
  } catch (err) {
    console.error('AAA SC gas scrape failed', err.message);
    res.json({ error: 'AAA SC gas scrape failed', details: err.message });
  }
});

// Gas prices - Charlotte-Gastonia-Rock Hill (NC only)
// Table is inside accordion: h3 (Charlotte header) + next div (panel) contains the table
app.get('/api/gas/charlotte', async (req, res) => {
  try {
    const resFetch = await fetch('https://gasprices.aaa.com/?state=NC', {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    const html = await resFetch.text();
    const $ = cheerio.load(html);
    const rowLabels = ['current', 'yesterday', 'weekAgo', 'monthAgo', 'yearAgo'];
    const colKeys = ['regular', 'midGrade', 'premium', 'diesel'];
    const rows = [];
    let charlotteTable = null;

    // Accordion structure: h3 (header) + div (panel with table) pairs
    $('.accordion-prices h3, .metros-js h3, [class*="accordion"] h3, main h3').each((_, h3) => {
      const text = $(h3).text();
      if (text.includes('Charlotte-Gastonia-Rock Hill')) {
        const $panel = $(h3).next('div');
        const $tbody = $panel.find('table tbody');
        if ($tbody.length && $tbody.find('tr').length >= 5) {
          charlotteTable = $tbody.closest('table');
          return false;
        }
      }
    });

    if (!charlotteTable || charlotteTable.length === 0) {
      return res.json({ error: 'Charlotte gas table not found' });
    }

    const trs = charlotteTable.find('tbody tr');
    for (let r = 0; r < 5 && r < trs.length; r++) {
      const row = { label: rowLabels[r], regular: null, midGrade: null, premium: null, diesel: null };
      const tds = $(trs[r]).find('td');
      for (let c = 0; c < 4 && c + 1 < tds.length; c++) {
        const cell = $(tds[c + 1]).text().trim();
        const match = cell.match(/\$?([\d.]+)/);
        row[colKeys[c]] = match ? match[1] : null;
      }
      rows.push(row);
    }
    res.json({ rows });
  } catch (err) {
    console.error('AAA Charlotte gas scrape failed', err.message);
    res.json({ error: 'AAA Charlotte gas scrape failed', details: err.message });
  }
});

// News (NewsAPI - past 12 hours)
app.get('/api/news', async (req, res) => {
  const key = process.env.NEWS_API_KEY;
  if (!key) return res.json({ error: 'NEWS_API_KEY not set' });
  const from = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
  const url = `https://newsapi.org/v2/top-headlines?country=us&pageSize=20&from=${from}&apiKey=${key}`;
  const data = await proxyFetch(url, 'News fetch failed');
  res.json(data);
});

// International news
app.get('/api/news/international', async (req, res) => {
  const key = process.env.NEWS_API_KEY;
  if (!key) return res.json({ error: 'NEWS_API_KEY not set' });
  const from = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
  const url = `https://newsapi.org/v2/top-headlines?language=en&pageSize=20&from=${from}&apiKey=${key}`;
  const data = await proxyFetch(url, 'International news fetch failed');
  res.json(data);
});

// Weather - Charlotte, NC
app.get('/api/weather', async (req, res) => {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) return res.json({ error: 'OPENWEATHER_API_KEY not set' });
  const url = `https://api.openweathermap.org/data/2.5/weather?q=Charlotte,US&units=imperial&appid=${key}`;
  const data = await proxyFetch(url, 'Weather fetch failed');
  res.json(data);
});

app.listen(PORT, () => {
  console.log(`Cole Report API proxy running on http://localhost:${PORT}`);
});
