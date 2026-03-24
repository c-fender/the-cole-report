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

// Helper: fetch and normalize EIA series response
async function fetchEiaSeries(seriesId, key, label) {
  const url = `https://api.eia.gov/v2/seriesid/${seriesId}?api_key=${key}`;
  const data = await proxyFetch(url, `${label} fetch failed`);
  if (data?.error) return data;

  const points = Array.isArray(data?.response?.data) ? data.response.data : [];
  const normalized = points.map((p) => ({ date: p.period, value: p.value }));
  return {
    name: label,
    interval: 'daily',
    unit: 'dollars per barrel',
    data: normalized,
  };
}

// Brent Crude (EIA)
app.get('/api/brent', async (req, res) => {
  const key = process.env.EIA_API_KEY;
  if (!key) return res.json({ error: 'EIA_API_KEY not set' });
  const normalized = await fetchEiaSeries('PET.RBRTE.D', key, 'Brent Crude Oil Spot Price');
  res.json(normalized);
});

// WTI Crude (EIA)
app.get('/api/wti', async (req, res) => {
  const key = process.env.EIA_API_KEY;
  if (!key) return res.json({ error: 'EIA_API_KEY not set' });
  const normalized = await fetchEiaSeries('PET.RWTC.D', key, 'WTI Crude Oil Spot Price');
  res.json(normalized);
});

// US 10Y Treasury (Alpha Vantage FRED)
app.get('/api/treasury', async (req, res) => {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return res.json({ error: 'ALPHA_VANTAGE_API_KEY not set' });
  const url = `https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=daily&maturity=10year&apikey=${key}`;
  const data = await proxyFetch(url, 'Treasury fetch failed');
  res.json(data);
});

const AAA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const AAA_TIMEOUT_MS = 10000;
const GAS_ALL_CACHE_MS = 15 * 60 * 1000; // align with client refresh

async function fetchAaaHtml(url) {
  const resFetch = await fetch(url, {
    signal: AbortSignal.timeout(AAA_TIMEOUT_MS),
    headers: { 'User-Agent': AAA_UA },
  });
  if (!resFetch.ok) throw new Error(`AAA HTTP ${resFetch.status}`);
  return resFetch.text();
}

function parseGasTableFromHtml(html) {
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

/** Charlotte metro table from NC state page HTML (same URL as state-level scrape). */
function parseCharlotteFromNcHtml(html) {
  const $ = cheerio.load(html);
  const rowLabels = ['current', 'yesterday', 'weekAgo', 'monthAgo', 'yearAgo'];
  const colKeys = ['regular', 'midGrade', 'premium', 'diesel'];
  const rows = [];
  let charlotteTable = null;

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
    return { error: 'Charlotte gas table not found' };
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
  return { rows };
}

async function scrapeGasPrices(url) {
  const html = await fetchAaaHtml(url);
  return parseGasTableFromHtml(html);
}

let gasAllCache = { at: 0, payload: null };
let gasAllInflight = null;

async function buildGasAllBundle() {
  const [nationalHtml, ncHtml, scHtml] = await Promise.all([
    fetchAaaHtml('https://gasprices.aaa.com/'),
    fetchAaaHtml('https://gasprices.aaa.com/?state=NC'),
    fetchAaaHtml('https://gasprices.aaa.com/?state=SC'),
  ]);
  return {
    gas: parseGasTableFromHtml(nationalHtml),
    gasNc: parseGasTableFromHtml(ncHtml),
    gasSc: parseGasTableFromHtml(scHtml),
    gasCharlotte: parseCharlotteFromNcHtml(ncHtml),
  };
}

// All gas regions in one response: 3 AAA pages (NC reused for Charlotte), cached
app.get('/api/gas/all', async (req, res) => {
  try {
    const now = Date.now();
    if (gasAllCache.payload && now - gasAllCache.at < GAS_ALL_CACHE_MS) {
      return res.json(gasAllCache.payload);
    }
    if (!gasAllInflight) {
      gasAllInflight = buildGasAllBundle()
        .then((payload) => {
          gasAllCache = { at: Date.now(), payload };
          return payload;
        })
        .finally(() => {
          gasAllInflight = null;
        });
    }
    const payload = await gasAllInflight;
    res.json(payload);
  } catch (err) {
    console.error('AAA gas/all failed', err.message);
    res.json({ error: 'AAA gas bundle failed', details: err.message });
  }
});

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
app.get('/api/gas/charlotte', async (req, res) => {
  try {
    const html = await fetchAaaHtml('https://gasprices.aaa.com/?state=NC');
    const data = parseCharlotteFromNcHtml(html);
    res.json(data);
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

const CHARLOTTE_QUERY = 'Charlotte,US';
const CHARLOTTE_TZ = 'America/New_York';

function dateKeyInTimeZone(tsSec, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(tsSec * 1000));
}

function todayKeyInTimeZone(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Weather - Charlotte, NC (current + 3h forecast for today’s range & next 24h)
app.get('/api/weather', async (req, res) => {
  const key = process.env.OPENWEATHER_API_KEY?.trim();
  if (!key) return res.json({ error: 'OPENWEATHER_API_KEY not set' });
  const base = 'https://api.openweathermap.org/data/2.5';
  const q = encodeURIComponent(CHARLOTTE_QUERY);
  const current = await proxyFetch(
    `${base}/weather?q=${q}&units=imperial&appid=${key}`,
    'Weather current failed'
  );
  if (current?.error) return res.json(current);
  if (current?.cod === 401 || current?.cod === 403) {
    return res.json({
      error:
        current?.message ||
        'OpenWeather rejected the API key (check key and activation at openweathermap.org).',
    });
  }

  const forecastRes = await proxyFetch(
    `${base}/forecast?q=${q}&units=imperial&appid=${key}`,
    'Weather forecast failed'
  );
  const list =
    forecastRes?.error || !Array.isArray(forecastRes?.list) ? [] : forecastRes.list;

  const tKey = todayKeyInTimeZone(CHARLOTTE_TZ);
  const todaySlots = list.filter((item) => dateKeyInTimeZone(item.dt, CHARLOTTE_TZ) === tKey);

  const tempsHigh = [];
  const tempsLow = [];
  if (typeof current?.main?.temp_max === 'number') tempsHigh.push(current.main.temp_max);
  if (typeof current?.main?.temp_min === 'number') tempsLow.push(current.main.temp_min);
  for (const i of todaySlots) {
    if (typeof i.main?.temp === 'number') {
      tempsHigh.push(i.main.temp);
      tempsLow.push(i.main.temp);
    }
  }
  const todayRange =
    tempsHigh.length && tempsLow.length
      ? {
          high: Math.round(Math.max(...tempsHigh)),
          low: Math.round(Math.min(...tempsLow)),
        }
      : null;

  const next24h = list.slice(0, 8).map((item) => ({
    dt: item.dt,
    temp: typeof item.main?.temp === 'number' ? Math.round(item.main.temp) : null,
    icon: item.weather?.[0]?.icon,
    description: item.weather?.[0]?.description,
    pop: item.pop != null ? Math.round(item.pop * 100) : null,
  }));

  res.json({
    current,
    todayRange,
    next24h,
    timeZone: CHARLOTTE_TZ,
  });
});

app.listen(PORT, () => {
  console.log(`Cole Report API proxy running on http://localhost:${PORT}`);
});
