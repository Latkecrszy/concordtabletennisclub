// Run: node scripts/build-sessions.js > data/sessions.json
// Scrapes CTTC's old Google Sites RR archive for public Drive report links.
// Falls back to the legacy scraped link list so local builds keep working.

const cheerio = require('cheerio');

const ARCHIVE_URL = process.env.CTTC_ARCHIVE_URL ||
  'https://sites.google.com/site/concordtabletennis/cttc-round-robins/rr-archives';
const FETCH_HEADERS = { 'User-Agent': 'cttc-session-builder/1.0' };

const MONTHS = {
  January: '01', February: '02', March: '03', April: '04',
  May: '05', June: '06', July: '07', August: '08',
  September: '09', October: '10', November: '11', December: '12'
};

// Extract file ID from a Drive URL
function fileId(url) {
  let m = String(url || '').match(/\/d\/([^/?#]+)/);
  if (m) return m[1];
  m = String(url || '').match(/[?&]id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function folderId(url) {
  let m = String(url || '').match(/\/folders\/([^/?#]+)/);
  if (m) return m[1];
  m = String(url || '').match(/[?&]id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// Parse a 2024-format filename like "2024-01-07.HTM" -> "2024-01-07"
function parse2024(name) {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})\.HTM$/i);
  return m ? m[1] : null;
}

// Parse a 2025/2026 SessionGroupReport filename to YYYY-MM-DD
function parseSession(name) {
  // Pattern: SessionGroupReport2025-02February10.HTM
  let m = name.match(/SessionGroupReport(\d{4})-(\d{2})([A-Za-z]+)(\d+)\.HTM$/i);
  if (m) {
    return `${m[1]}-${m[2]}-${m[4].padStart(2, '0')}`;
  }
  // Pattern: SessionGroupReport2025January27.HTM or SessionGroupReport2026April1.HTM
  m = name.match(/SessionGroupReport(\d{4})([A-Za-z]+)(\d+)\.HTM$/i);
  if (m) {
    const mon = MONTHS[m[2]];
    if (!mon) return null;
    return `${m[1]}-${mon}-${m[3].padStart(2, '0')}`;
  }
  return null;
}

function parseName(name) {
  // Try 2024 format
  const d = parse2024(name);
  if (d) return d;
  // Try 2025-format date prefix
  const m = name.match(/^(\d{4}-\d{2}-\d{2})\.HTM$/i);
  if (m) return m[1];
  // Try SessionGroupReport format
  return parseSession(name);
}

function legacySessions() {
  return sessionsFromEntries([...RAW_2024, ...RAW_2025, ...RAW_2026]);
}

function sessionsFromEntries(entries) {
  const sessions = [];
  const seen = new Set();

  for (const [name, url] of entries) {
    const date = parseName(name);
    const id = fileId(url);
    if (!date || !id) {
      process.stderr.write(`WARN: could not parse "${name}"\n`);
      continue;
    }
    const key = `${date}-${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sessions.push({ date, fileId: id });
  }

  return sortSessions(sessions);
}

function sortSessions(sessions) {
  return sessions.slice().sort(function (a, b) {
    return b.date.localeCompare(a.date);
  });
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: FETCH_HEADERS
  });

  if (!response.ok) {
    throw new Error('HTTP ' + response.status + ' fetching ' + url);
  }

  return response.text();
}

function embeddedFolderUrl(id) {
  return 'https://drive.google.com/embeddedfolderview?id=' + encodeURIComponent(id) + '#list';
}

function extractArchiveFolderIds(html) {
  const ids = [];
  const seen = new Set();
  const $ = cheerio.load(html);

  function add(id) {
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  }

  $('iframe[src*="embeddedfolderview"], a[href*="folderview"], a[href*="/drive/folders/"]').each(function (_idx, element) {
    add(folderId($(element).attr('src') || $(element).attr('href')));
  });

  const pattern = /(?:embeddedfolderview|folderview)\?id=([A-Za-z0-9_-]+)/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    add(match[1]);
  }

  return ids;
}

function extractFolderEntries(html) {
  const $ = cheerio.load(html);
  const entries = [];

  $('.flip-entry').each(function (_idx, element) {
    const title = $(element).find('.flip-entry-title').first().text().trim();
    const href = $(element).find('a[href]').first().attr('href') || '';
    if (!title || !href) return;
    entries.push({ title: title, href: href });
  });

  return entries;
}

async function oldSiteSessions() {
  const archiveHtml = await fetchText(ARCHIVE_URL);
  const rootFolderIds = extractArchiveFolderIds(archiveHtml);
  if (!rootFolderIds.length) {
    throw new Error('No embedded Drive folder found on ' + ARCHIVE_URL);
  }

  const visitedFolders = new Set();
  const seenFiles = new Set();
  const reportEntries = [];

  async function crawlFolder(id) {
    if (visitedFolders.has(id)) return;
    visitedFolders.add(id);

    const html = await fetchText(embeddedFolderUrl(id));
    const entries = extractFolderEntries(html);

    await Promise.all(entries.map(async function (entry) {
      const childFolderId = folderId(entry.href);
      if (childFolderId && /\/folders\//.test(entry.href)) {
        await crawlFolder(childFolderId);
        return;
      }

      if (!/^https:\/\/drive\.google\.com\/file\/d\//.test(entry.href)) return;

      const id = fileId(entry.href);
      if (!id || !parseName(entry.title) || seenFiles.has(id)) return;
      seenFiles.add(id);
      reportEntries.push([entry.title, entry.href]);
    }));
  }

  for (const id of rootFolderIds) {
    await crawlFolder(id);
  }

  if (!reportEntries.length) {
    throw new Error('No session report files found from ' + ARCHIVE_URL);
  }

  const sessions = sessionsFromEntries(reportEntries);
  if (!sessions.length) {
    throw new Error('Session report files were found, but no filenames could be parsed.');
  }

  return sessions;
}

async function discoveredSessions() {
  try {
    return await oldSiteSessions();
  } catch (error) {
    process.stderr.write('WARN: old site scrape failed; using legacy session list: ' + error.message + '\n');
    return legacySessions();
  }
}

async function main() {
  const sessions = await discoveredSessions();
  process.stdout.write(JSON.stringify(sessions, null, 2) + '\n');
}

// Raw link data: [filename, url]
const RAW_2024 = [
  ["2024-01-07.HTM","https://drive.google.com/file/d/13xU-UZKqA82v9rBpKtWaKv4NGshK22dh/view"],
  ["2024-01-11.HTM","https://drive.google.com/file/d/1379Q3SmFkkE1931CHfC2_VU0ub0h55Nz/view"],
  ["2024-01-14.HTM","https://drive.google.com/file/d/14Tp8zx6CmWVtqc5SXNMxNbTs_P8Z43wS/view"],
  ["2024-01-18.HTM","https://drive.google.com/file/d/10WEc67I9soZ3C6cEgH2Tq76dvKS61I2_/view"],
  ["2024-01-21.HTM","https://drive.google.com/file/d/10Ir7G8l8RVkrWV96HSF24LSU98i6oj3r/view"],
  ["2024-01-25.HTM","https://drive.google.com/file/d/146pgWbIZVnfEcidBD54_rNTmYrXbm_4w/view"],
  ["2024-01-28.HTM","https://drive.google.com/file/d/1-Rjymcb-UWGugZQn4p3LAchWdxyL0ELH/view"],
  ["2024-02-01.HTM","https://drive.google.com/file/d/1-v7Shkb6H_37A4jd7xfGvHMLwsnwLt8L/view"],
  ["2024-02-04.HTM","https://drive.google.com/file/d/131bVtqEQC-uSHVLcyA4i7Ln0btheazT8/view"],
  ["2024-02-08.HTM","https://drive.google.com/file/d/1406P04RLLPNoNZBzvoQQJIgXCOOvDkUF/view"],
  ["2024-02-11.HTM","https://drive.google.com/file/d/121rswv8ihfnknRkjXTZxMjg3og98BWz4/view"],
  ["2024-02-15.HTM","https://drive.google.com/file/d/12-sxQFlSjdDje5JwSfeIBxRpwIjmT-5-/view"],
  ["2024-02-18.HTM","https://drive.google.com/file/d/1-_4vVeKVlWKvVDLYINjOKZAqUCL8k-aX/view"],
  ["2024-02-22.HTM","https://drive.google.com/file/d/10O0rQsS4EcpxrKv5WAlUr0KvNoNR41e7/view"],
  ["2024-02-25.HTM","https://drive.google.com/file/d/13SvlmZdfxBZN8E4OpvGT6XN0ISNT_nQc/view"],
  ["2024-02-29.HTM","https://drive.google.com/file/d/13zrdVDceYdJPG7VX4pp49TxrYiHTwqr-/view"],
  ["2024-03-03.HTM","https://drive.google.com/file/d/12p0qZUDIajxmy-AMx0zNBPLRue56Nd6a/view"],
  ["2024-03-07.HTM","https://drive.google.com/file/d/11t73TGFxu4HgYqWJX9VuJSGmSMGAjsph/view"],
  ["2024-03-14.HTM","https://drive.google.com/file/d/1-MHpCSA_SRUrZ-JJl0KvxmAZsq4dHpp2/view"],
  ["2024-03-17.HTM","https://drive.google.com/file/d/13DWvSYOoCqze5HOS8HeVhEk338OyNfAA/view"],
  ["2024-03-21.HTM","https://drive.google.com/file/d/12MZtWhiMB58nX42Rp8TpFZHA6sYURGuC/view"],
  ["2024-03-24.HTM","https://drive.google.com/file/d/13Yv8D5pElPaBmSTZ1OGTWGj09p7HiU6N/view"],
  ["2024-03-28.HTM","https://drive.google.com/file/d/1-DsZLpqDWo_YGrjaZIBpN_-XHfooTThy/view"],
  ["2024-03-31.HTM","https://drive.google.com/file/d/1112Un66yQr0mzPeZMRff8dbultQ7Ru8R/view"],
  ["2024-04-04.HTM","https://drive.google.com/file/d/11o5HEIrWYL-s-1plUl9Lf_K6oifuMDWx/view"],
  ["2024-04-07.HTM","https://drive.google.com/file/d/1-ruzo8seFi_i_dGFDnFf-4XYGMXGQJfE/view"],
  ["2024-04-11.HTM","https://drive.google.com/file/d/135Q3qOo6F2ch4-45mkKFVm3RVIgHPhOJ/view"],
  ["2024-04-14.HTM","https://drive.google.com/file/d/14XxpV8NfZq6qLIX1QnlehC37Fj_O5nBN/view"],
  ["2024-04-18.HTM","https://drive.google.com/file/d/10hxzfXHfUg2kL4-nodQzNeuiOQWePcR7/view"],
  ["2024-04-21.HTM","https://drive.google.com/file/d/13P6s02_6qQTK3gs4FHU9CqVpolJWms9v/view"],
  ["2024-04-25.HTM","https://drive.google.com/file/d/12cSW167oOOS-P1jaT4lOCEngyY5qvwPc/view"],
  ["2024-04-28.HTM","https://drive.google.com/file/d/13COb_alRYM2s4c-E3qw15Oui8aikm4qP/view"],
  ["2024-05-02.HTM","https://drive.google.com/file/d/15FWZHAYb-XbsCT12uExKCFqbsLYRf3vx/view"],
  ["2024-05-05.HTM","https://drive.google.com/file/d/12I0NfQaLzXkuwpN0P2RIQuFYjMuS1icn/view"],
  ["2024-05-09.HTM","https://drive.google.com/file/d/14eQw-i__6PyT4MZJQ3cmTzxLfPQo20Bl/view"],
  ["2024-05-12.HTM","https://drive.google.com/file/d/10BSqYcRi5tCOZvzeby3TBPPm-qbvBqch/view"],
  ["2024-05-16.HTM","https://drive.google.com/file/d/11IykuxJx-MKnY1Qjb-m0Ha5jitDzjiv-/view"],
  ["2024-05-19.HTM","https://drive.google.com/file/d/1471FcvRJqHOO96UIT_2_pfqd-33B4x1B/view"],
  ["2024-05-23.HTM","https://drive.google.com/file/d/105THy6IMT-U804iSTY7QDFinf3fY-IDw/view"],
  ["2024-05-26.HTM","https://drive.google.com/file/d/15NbWGvQ3nUstbALVsrF1vh7U36n2FGnH/view"],
  ["2024-06-06.HTM","https://drive.google.com/file/d/13Yw3_Nd7k70fcN0QFGdpnX_TmmzUvmGZ/view"],
  ["2024-06-09.HTM","https://drive.google.com/file/d/11aumAw_gdVJ6DiNp2S8IiuaQV56Pxo05/view"],
  ["2024-06-10.HTM","https://drive.google.com/file/d/14s8jOgZwDI2L170QTyQR9Hs94tE6bLS9/view"],
  ["2024-06-13.HTM","https://drive.google.com/file/d/11CEseiXSzS6CyBuJ5b8rKQHQR5GRW-ns/view"],
  ["2024-06-16.HTM","https://drive.google.com/file/d/12DV05SDPJqne6DBmD-W6VLjtF4k8TXjc/view"],
  ["2024-06-20.HTM","https://drive.google.com/file/d/13oH0HKXd3fGLpJtRVc4Ez82N5rCmO2Ix/view"],
  ["2024-06-23.HTM","https://drive.google.com/file/d/153EuYWszi_N_9zjRYwjPem_bC7iUBjml/view"],
  ["2024-06-27.HTM","https://drive.google.com/file/d/15ImBqsg5awc-tTi0gCgOnu0XAv_XzA3M/view"],
  ["2024-06-30.HTM","https://drive.google.com/file/d/12VtTHqHTp_1m8gEUBtyFbAnAtVfs-aH3/view"],
  ["2024-07-01.HTM","https://drive.google.com/file/d/107AmYwDpQNTp6X2HHMTaCnzCCkUdDAz4/view"],
  ["2024-07-03.HTM","https://drive.google.com/file/d/10R7thkGHBdPAMP618Z8O_tTis0CACWlm/view"],
  ["2024-07-08.HTM","https://drive.google.com/file/d/13FCFRUgD8scHPPy6LFpIx6AQd8QY4Bpg/view"],
  ["2024-07-10.HTM","https://drive.google.com/file/d/12y6fem4pYU2G_sPjK9o0jIxpPBbrgqp-/view"],
  ["2024-07-15.HTM","https://drive.google.com/file/d/12PmMoFuuomqeoLrYvvcY5m8oMO5NT50U/view"],
  ["2024-07-17.HTM","https://drive.google.com/file/d/141fdh3Jx2prsxz460DHPWs0zaLo01XJ1/view"],
  ["2024-07-22.HTM","https://drive.google.com/file/d/13luRVHq8CyY6PfGJMFrmxKqSjeemtjIy/view"],
  ["2024-07-24.HTM","https://drive.google.com/file/d/13UVm1HyGBWd7nMM1Du2NYFkquw_gEVRB/view"],
  ["2024-07-29.HTM","https://drive.google.com/file/d/10b4Z3CkET3KApyt5_FTVBLcMzH4wCeA6/view"],
  ["2024-07-31.HTM","https://drive.google.com/file/d/15CqePaB0MY1zxl0c7IXJa6Mz7SJmHnjK/view"],
  ["2024-08-05.HTM","https://drive.google.com/file/d/14tQ7bOmJclwYkuXQAlMwHwVp8YIJDdWV/view"],
  ["2024-08-07.HTM","https://drive.google.com/file/d/10cuiIs2i6lisNOUrrLcNNPyQ1aiKhuFp/view"],
  ["2024-08-12.HTM","https://drive.google.com/file/d/10DlmVucQX9TqddrPCUWHKb0KIrcbkBsz/view"],
  ["2024-08-14.HTM","https://drive.google.com/file/d/10GHR5OwKJLLJp0RNz6t0D9apVcPqw_f_/view"],
  ["2024-08-26.HTM","https://drive.google.com/file/d/12rG5lv4KDLYONpYf5Tv229l9MTwVzXen/view"],
  ["2024-08-28.HTM","https://drive.google.com/file/d/10gDkCkXKzIXI_3Z-x4wqqYqniSCBf-XX/view"],
  ["2024-09-04.HTM","https://drive.google.com/file/d/11x2R46fpU_33KAa7FUijK-1epRUWEhXe/view"],
  ["2024-09-09.HTM","https://drive.google.com/file/d/11m8qg1zwq6TT-yWBVy1uO8CKQaSNFLpE/view"],
  ["2024-09-11.HTM","https://drive.google.com/file/d/13xbgOgF0PI5WeYeL7LxK-wUZtKyxFX46/view"],
  ["2024-09-16.HTM","https://drive.google.com/file/d/10fxJmbLjDY9zeU1R3VeyRHLqsWn5NII0/view"],
  ["2024-09-18.HTM","https://drive.google.com/file/d/11JGWB6iw53u7CdgGpsxTfN-yrVWlc6Ce/view"],
  ["2024-09-23.HTM","https://drive.google.com/file/d/11sfZvxaLZHK8x5lj8tsgIMEJzjgkxcS6/view"],
  ["2024-09-25.HTM","https://drive.google.com/file/d/10SWa8ikgrWeVFARoH4ASmME-gl_oaMJQ/view"],
  ["2024-09-30.HTM","https://drive.google.com/file/d/1-FLFUUiOHgZPUzziBdFDtaiV3Ko29AU9/view"],
  ["2024-10-02.HTM","https://drive.google.com/file/d/13gjy6Ko7sgzl4LD9EVVWivy-VsznoBFp/view"],
  ["2024-10-07.HTM","https://drive.google.com/file/d/14bJ4Q1GEnUw9wKXN29O8GZGxD86Nr-M2/view"],
  ["2024-10-09.HTM","https://drive.google.com/file/d/1-vx_CROLPC4deJhLaStbAgaFGHDYBt7l/view"],
  ["2024-10-14.HTM","https://drive.google.com/file/d/12HrF44v4YMPUfZNCiu4s3TIvBoz1yP3T/view"],
  ["2024-10-16.HTM","https://drive.google.com/file/d/1-LklbuRtMrN8YPk8zU0ur84INNoJwKDM/view"],
  ["2024-10-21.HTM","https://drive.google.com/file/d/14s59yrh8LnIIMFCITuO8MhcOsQlDhI8J/view"],
  ["2024-10-23.HTM","https://drive.google.com/file/d/10FbyBa3QyPzRKIaRwIJONY4B3Kxe-GYP/view"],
  ["2024-10-28.HTM","https://drive.google.com/file/d/12J1uz0IWLsG5MnQK_hAaYeQbqvOKa4w_/view"],
  ["2024-11-04.HTM","https://drive.google.com/file/d/11pusAQqRDAfobkFDVNhIWJA1qemcA1BL/view"],
  ["2024-11-06.HTM","https://drive.google.com/file/d/10F_pk5RNqIl7dwDSyH4V-q9TY6KCssjm/view"],
  ["2024-11-11.HTM","https://drive.google.com/file/d/122to84TBsmMi1TUfxpm-LlDBNkBcSigT/view"],
  ["2024-11-13.HTM","https://drive.google.com/file/d/151UmuHYB3pluDo90Ttac0wqFIsy2IQdL/view"],
  ["2024-11-18.HTM","https://drive.google.com/file/d/13abObE_BM1Qj-B8yfJIVmgnW7ngtoFKD/view"],
  ["2024-11-20.HTM","https://drive.google.com/file/d/11iDJeVfBAHj8aaBAbfgIQ9mYFtBKIKWz/view"],
  ["2024-11-25.HTM","https://drive.google.com/file/d/14ofklu3QrpZj3ixhP0vSfACx_xSCK29a/view"],
  ["2024-11-27.HTM","https://drive.google.com/file/d/1-uWIRONjLj3RU0WqPR1HMpPbJkmRkvkg/view"],
  ["2024-12-02.HTM","https://drive.google.com/file/d/1-ZWZbEaFbDDFUwF7MwUdHdE0AUmT_Mul/view"],
  ["2024-12-04.HTM","https://drive.google.com/file/d/1-OVA2E09c6QRJdZbm_nUJEeEWGs6Nrof/view"],
  ["2024-12-09.HTM","https://drive.google.com/file/d/11HgdwJWYbaZ4Lj8gkPiXmRQ3CK_P7kVy/view"],
  ["2024-12-11.HTM","https://drive.google.com/file/d/15K2dfzjebSA0uKNqpNPed9vnvMz4NCmh/view"],
  ["2024-12-16.HTM","https://drive.google.com/file/d/15Pmvr8ICAH_fotUuNWVtOmf33PreKtBq/view"],
  ["2024-12-18.HTM","https://drive.google.com/file/d/15UB0jjfyyROy4Zd5T2vqmpbMpgNavseA/view"],
  ["2024-12-30.HTM","https://drive.google.com/file/d/15VEUAIXDBe8gxOB0LSdy7M-Yc_hxqkzE/view"],
];

const RAW_2025 = [
  ["2025-01-06.HTM","https://drive.google.com/file/d/15c_XZ-hPtByDeA4Y6daWReNR2w8Zkxu2/view"],
  ["2025-01-08.HTM","https://drive.google.com/file/d/17JB7u_CBB4vhtEQAZ5earz7h7YgJYIEp/view"],
  ["2025-01-13.HTM","https://drive.google.com/file/d/17MBPX6NL9jiq1IVkiW-_kw82tnNZKBel/view"],
  ["2025-01-15.HTM","https://drive.google.com/file/d/17QKSsr2LBlw91-ZpqPEaXWa08iB09kL1/view"],
  ["2025-01-20.HTM","https://drive.google.com/file/d/17ZW750_EBgGJolPAH6NIF_uPc-8oGNji/view"],
  ["2025-01-22.HTM","https://drive.google.com/file/d/17iRS2JZ5WvJf-WXkVDMHyGrApyXOWJYF/view"],
  ["SessionGroupReport2025January27.HTM","https://drive.google.com/file/d/1BT2FJoiiPec3qxqb220_pByr3II1s-RY/view"],
  ["SessionGroupReport2025January29.HTM","https://drive.google.com/file/d/1Bvei7Vktli8XqbkU9SpuI19a9MdXx_vK/view"],
  ["SessionGroupReport2025-02February3.HTM","https://drive.google.com/file/d/1CWROF0d_Jy7CdqcmdH1-55tiAo-MBiM_/view"],
  ["SessionGroupReport2025-02February5.HTM","https://drive.google.com/file/d/1D927wyEW8GJRvzakZjdO7K5neJjk8ejI/view"],
  ["SessionGroupReport2025-02February10.HTM","https://drive.google.com/file/d/1EKWZu4rgVuh6FCg1JtOwcSDVCjyPY31D/view"],
  ["SessionGroupReport2025-02February12.HTM","https://drive.google.com/file/d/1GGXAtFtpcayvr0MaJDu3CCXOJ0Dkl0RR/view"],
  ["SessionGroupReport2025February17.HTM","https://drive.google.com/file/d/1Gv0nflqLCV71nHnirdeMhRhFUqZNiw3o/view"],
  ["SessionGroupReport2025February19.HTM","https://drive.google.com/file/d/1IkQiKG9luoL9P-uLTP3yxlV2OHnNhhQi/view"],
  ["SessionGroupReport2025February24.HTM","https://drive.google.com/file/d/1JGH-Z_GPw9bj-JqvrEVnjTWGPthIaEfg/view"],
  ["SessionGroupReport2025February26.HTM","https://drive.google.com/file/d/1Je3i_QjSmRXKNyaq-Dkbs_wJgf7t3ISA/view"],
  ["SessionGroupReport2025March3.HTM","https://drive.google.com/file/d/1KYQ9PRYaRSo_uPejg_2MZ3GKaDLxUihP/view"],
  ["SessionGroupReport2025March5.HTM","https://drive.google.com/file/d/1LFmzDcVmOG9fECZDIfVoahkoHrVCxzpr/view"],
  ["SessionGroupReport2025March10.HTM","https://drive.google.com/file/d/1LoHULXmFJWEO8dQFfjSHTna7ktNFd2Fd/view"],
  ["SessionGroupReport2025March12.HTM","https://drive.google.com/file/d/1MZVN7gQskzMFhapnXa9DDvRAN8YxEXlw/view"],
  ["SessionGroupReport2025March17.HTM","https://drive.google.com/file/d/1Mn6Qz4_C08tit6WWOxKjmgQt_N9gcTOi/view"],
  ["SessionGroupReport2025March19.HTM","https://drive.google.com/file/d/1OJKWvqk-Zhe0lAkvNzkqGOYw53raasUw/view"],
  ["SessionGroupReport2025March24.HTM","https://drive.google.com/file/d/1PwAWD7E4OjAx5R-tTo-wjr04FYeZPpUB/view"],
  ["SessionGroupReport2025March26.HTM","https://drive.google.com/file/d/1QvBZpgdQmrEPKCfUo5QKqIEfKfVFbGMz/view"],
  ["SessionGroupReport2025March31.HTM","https://drive.google.com/file/d/1RnVjoC6qAU7CQWr7CQWr_UNjWYn1l/view"],
  ["SessionGroupReport2025-04April2.HTM","https://drive.google.com/file/d/1T4AISC7Lme97dhNsG7qiVVgv5ZjvCT_F/view"],
  ["SessionGroupReport2025-04April7.HTM","https://drive.google.com/file/d/1TdxK8iYyWCBfl22HfABhpa8HtMRwOf-6/view"],
  ["SessionGroupReport2025-04April9.HTM","https://drive.google.com/file/d/1V0PMbkQ2_vxfxaguWIRKFWHEQmEVHXK1/view"],
  ["SessionGroupReport2025-04April14.HTM","https://drive.google.com/file/d/1VGZb2VkLS8JBTmBRWEXL5zdWsODOT92v/view"],
  ["SessionGroupReport2025-04April16.HTM","https://drive.google.com/file/d/1Vz4xPxFhE0L29erUhwtL2X4HqMcpkYnR/view"],
  ["SessionGroupReport2025-04April21.HTM","https://drive.google.com/file/d/1WTbBIF2ESkGptwxFgKfFB3Xh6406YHnl/view"],
  ["SessionGroupReport2025-04April23.HTM","https://drive.google.com/file/d/1XYsuAebicmy1UOWu9igX6pMXfliuPgfH/view"],
  ["SessionGroupReport2025-04April28.HTM","https://drive.google.com/file/d/1YEDrspf_5fPiWm-fl6aOIMQW4bSKdzPd/view"],
  ["SessionGroupReport2025-04April30.HTM","https://drive.google.com/file/d/1Z6XFnIJewJXGKYikpYrVFFmCqLearbxQ/view"],
  ["SessionGroupReport2025May5.HTM","https://drive.google.com/file/d/1ZuaxV0_rhP61LucTiVhe4dASID1qbWoS/view"],
  ["SessionGroupReport2025May7.HTM","https://drive.google.com/file/d/1_UqnXwPWb89wOAsW7iluc0PtUuisXyGV/view"],
  ["SessionGroupReport2025May12.HTM","https://drive.google.com/file/d/1_t4ZMH_OgpR67sua3KKC7SebDVqY7SKj/view"],
  ["SessionGroupReport2025May14.HTM","https://drive.google.com/file/d/1axTa1gNwbRWZqnFUs0VdRlMfQJSZsHjF/view"],
  ["SessionGroupReport2025May19.HTM","https://drive.google.com/file/d/1bnhjBF2y06-HcHlapg4MyEAsGacCo-fq/view"],
  ["SessionGroupReport2025May21.HTM","https://drive.google.com/file/d/1dBqNNAwsKhNxVrMxu2BYINswYF8CBLKE/view"],
  ["SessionGroupReport2025May26.HTM","https://drive.google.com/file/d/1dZPfNpnaeQhtibmnmvj6kxnOnfFWRTbn/view"],
  ["SessionGroupReport2025May28.HTM","https://drive.google.com/file/d/1ehEwsCKAxsqGmFLNIgYXzQZrbgLDnvAi/view"],
  ["SessionGroupReport2025June2.HTM","https://drive.google.com/file/d/1D0KMn_StKJNZeZFO3GigEMyTlnZm1-Ey/view"],
  ["SessionGroupReport2025June4.HTM","https://drive.google.com/file/d/1HRpsjBBJPu2VptI_PXjq0_s8Tm3d6CYp/view"],
  ["SessionGroupReport2025June9.HTM","https://drive.google.com/file/d/1iUED1llz8Ao8b0oOqLQwloRmYYTG29Fu/view"],
  ["SessionGroupReport2025June11.HTM","https://drive.google.com/file/d/1JUW4oDTILkSsWOl6n7eE5_Y1hGarempb/view"],
  ["SessionGroupReport2025June23.HTM","https://drive.google.com/file/d/1ohTa9tsTDPQ6Gj_xsYvKNs9xM150GRzd/view"],
  ["SessionGroupReport2025June25.HTM","https://drive.google.com/file/d/1nbWcT2JYp2aVml-xqL3pBCiRd-0QnXXq/view"],
  ["SessionGroupReport2025June30.HTM","https://drive.google.com/file/d/1CPKEZbxLD6-xF1FIz8i9HckvZO06q5Td/view"],
  ["SessionGroupReport2025July2.HTM","https://drive.google.com/file/d/10uN6hjr4LpzyNgDhO1BJ2SjeXtnvyM-A/view"],
  ["SessionGroupReport2025July7.HTM","https://drive.google.com/file/d/1i2pGgpV6BSmQjVoDKrtps8BiAdP9CBzX/view"],
  ["SessionGroupReport2025July9.HTM","https://drive.google.com/file/d/1UL6OlOJ56SbZnf6s4M0IeD7mzPgomISE/view"],
  ["SessionGroupReport2025July14.HTM","https://drive.google.com/file/d/19GM8144H4gS9iaLqQapE91sfjGl-xyb4/view"],
  ["SessionGroupReport2025July16.HTM","https://drive.google.com/file/d/14CHZD9-t65FUjEdsz7fD0YlgYxxUF-m2/view"],
  ["SessionGroupReport2025July21.HTM","https://drive.google.com/file/d/1GQcx_rnZDEZsfhy38KS2-1u1MWCmfLlc/view"],
  ["SessionGroupReport2025July23.HTM","https://drive.google.com/file/d/1X7QZWz3Yz7tOi7Ld1ignodWF2O9Tn5AO/view"],
  ["SessionGroupReport2025July28.HTM","https://drive.google.com/file/d/1ptVYQVghMwg_kJ2fW9qPgNffrwo8DAft/view"],
  ["SessionGroupReport2025July30.HTM","https://drive.google.com/file/d/1w6OymVsjNSv1B4079QX3--8P02cvBaoq/view"],
  ["SessionGroupReport2025August4.HTM","https://drive.google.com/file/d/1llwTTmIXHIwpXfA4GdmnRV8O2udotZCl/view"],
  ["SessionGroupReport2025August6.HTM","https://drive.google.com/file/d/13st9T6jY0dZko7zBxztws0IMHSRHkuMV/view"],
  ["SessionGroupReport2025August11.HTM","https://drive.google.com/file/d/1BCuUCVKdzB3o_9Ho6iNI6Cw_SCJx2032/view"],
  ["SessionGroupReport2025August13.HTM","https://drive.google.com/file/d/1kZk0AFyTsMFvPvEbb9kutJB-KBlzeNuZ/view"],
  ["SessionGroupReport2025August18.HTM","https://drive.google.com/file/d/1nlLJ1IGrQ3pIK1aB6-v2zhpd9j62TkcW/view"],
  ["SessionGroupReport2025August20.HTM","https://drive.google.com/file/d/1gnGE4JuLEETJ70TnaR6T6YmrtewQTn7C/view"],
  ["SessionGroupReport2025August25.HTM","https://drive.google.com/file/d/1l7jO6qqLeea3Wx5hTt0u-ywV7sgU2jbg/view"],
  ["SessionGroupReport2025August27.HTM","https://drive.google.com/file/d/1O__Q0EqHUB1MknFNlRm3Aby-MLOuDDaz/view"],
  ["SessionGroupReport2025September3.HTM","https://drive.google.com/file/d/1o_x0GjviDktuQH77sxp4XRCTUhXUkaHt/view"],
  ["SessionGroupReport2025September8.HTM","https://drive.google.com/file/d/1ZeezTCRkrJVhgzPjvhOkUgMhP_1tU8_c/view"],
  ["SessionGroupReport2025September10.HTM","https://drive.google.com/file/d/11-j4s7a-BUQ9TJTHfbT8d-AbUYbuH4a_/view"],
  ["SessionGroupReport2025September15.HTM","https://drive.google.com/file/d/1VZHe5ZkGk-GXsCS5xuVJQrtPvHYuXcZQ/view"],
  ["SessionGroupReport2025September17.HTM","https://drive.google.com/file/d/1CX3g-9WYh5-zL1LEyO_jozuG4TVyGavY/view"],
  ["SessionGroupReport2025September22.HTM","https://drive.google.com/file/d/1O-fHvvepNtlvtHGjUr4gOx_XvbuHQxeF/view"],
  ["SessionGroupReport2025September24.HTM","https://drive.google.com/file/d/1VBoCsCw-IP7Y2CVLhBBS-wGbACLsfjdX/view"],
  ["SessionGroupReport2025September29.HTM","https://drive.google.com/file/d/1QfzvAQtupGW7WVgcM-wkVio7T5IvckdV/view"],
  ["SessionGroupReport2025October1.HTM","https://drive.google.com/file/d/1yqrLHA0HxITRjuTRvMM2dmMhWhZRND9M/view"],
  ["SessionGroupReport2025October6.HTM","https://drive.google.com/file/d/10m8rL_jgByexzBRck_xe4ugwL3w48BQq/view"],
  ["SessionGroupReport2025October8.HTM","https://drive.google.com/file/d/1T72CcCBz4yfPJXXFAoVqGSRizokf5i55/view"],
  ["SessionGroupReport2025October13.HTM","https://drive.google.com/file/d/1XyvDGJrx_8z5ANeNmX0GOCXqizO_Sl7V/view"],
  ["SessionGroupReport2025October15.HTM","https://drive.google.com/file/d/1YTWQ2phoWsnxnuoaUN4M-uHecbNhIvam/view"],
  ["SessionGroupReport2025October20.HTM","https://drive.google.com/file/d/18X9kVr6tRekfPmg0rIYlE2HNZxBi5l3i/view"],
  ["SessionGroupReport2025October22.HTM","https://drive.google.com/file/d/1BgfiHQK6bA244QHw9vz7A626s28NFZY6/view"],
  ["SessionGroupReport2025October27.HTM","https://drive.google.com/file/d/1R2nNsMYzegiV6aGvOlrUwmW9rIR8zRKT/view"],
  ["SessionGroupReport2025October29.HTM","https://drive.google.com/file/d/1aa3U5GpacRyN9lxyd0d341lDpZcH5stz/view"],
  ["SessionGroupReport2025November3.HTM","https://drive.google.com/file/d/1mn_HF-gRLcgAz4zxBOMVypqyiaz_YGHY/view"],
  ["SessionGroupReport2025November5.HTM","https://drive.google.com/file/d/1mFEb0g2nGGhgac4I-dswKULWB02YZeWC/view"],
  ["SessionGroupReport2025November10.HTM","https://drive.google.com/file/d/1cdF1-Yh-MjuSA1JC2vfuWT_m8CeiXHAO/view"],
  ["SessionGroupReport2025November12.HTM","https://drive.google.com/file/d/1atoKekSFcpZC7AnvBeSlEHTolES9YP_h/view"],
  ["SessionGroupReport2025November17.HTM","https://drive.google.com/file/d/1bDpWnya0EUEoWqhz5QQwR50-OT9n-Nm4/view"],
  ["SessionGroupReport2025November19.HTM","https://drive.google.com/file/d/1fwJ4kLNoB0rPDdJ-j00lDuXcHfNBy4I9/view"],
  ["SessionGroupReport2025November24.HTM","https://drive.google.com/file/d/1EFVT0MDoeL2ThGo54duQElt_TTifgGSg/view"],
  ["SessionGroupReport2025December1.HTM","https://drive.google.com/file/d/17Cve7PmZbrUeSFqlSPXqHTP9vHSQpYaT/view"],
  ["SessionGroupReport2025December3.HTM","https://drive.google.com/file/d/1RWOBqS0vZtPBBCyC2wybRA059IPrOD9N/view"],
  ["SessionGroupReport2025December8.HTM","https://drive.google.com/file/d/1Fr6LSvTQCEa8ZB3ayJGT5rPsxAdWcxnX/view"],
  ["SessionGroupReport2025December10.HTM","https://drive.google.com/file/d/1C8bTMRWrMIdaF3nyna1sqZ7uxjzcqi6f/view"],
  ["SessionGroupReport2025December15.HTM","https://drive.google.com/file/d/1q1Ms3uanXk4F_TB_PTRN_c9Jde37KE7v/view"],
  ["SessionGroupReport2025December17.HTM","https://drive.google.com/file/d/1V2gzhR8aascIYVShmTqhbnQ3Ib7ce9ze/view"],
];

const RAW_2026 = [
  ["SessionGroupReport2026January5.HTM","https://drive.google.com/file/d/1gqmcKZTK0IcUoONvErk5c5ReBLdEh9k0/view"],
  ["SessionGroupReport2026January7.HTM","https://drive.google.com/file/d/1GSPO_2SG0VlxKfTvzAVzribrWRP3kF5h/view"],
  ["SessionGroupReport2026January12.HTM","https://drive.google.com/file/d/1PG4oQ9iGLkogvpM5OQ4LfsZrH5SpgjUY/view"],
  ["SessionGroupReport2026January14.HTM","https://drive.google.com/file/d/14Sqbh62pCxqdZ-6YdpE4g8OQyEuDSeup/view"],
  ["SessionGroupReport2026January19.HTM","https://drive.google.com/file/d/1iLL6daagb5P61PhpN4LLTm4PIo0KdGiK/view"],
  ["SessionGroupReport2026January21.HTM","https://drive.google.com/file/d/1TS25EW4ElGBgfG76rohrJyAeOv2uJyx2/view"],
  ["SessionGroupReport2026January26.HTM","https://drive.google.com/file/d/120eJal04sZGaEVuUyA-y9igCCFAk1Umk/view"],
  ["SessionGroupReport2026January28.HTM","https://drive.google.com/file/d/1PR6rSmmcoSxBwvvW_iRW5_zIXE9djT7q/view"],
  ["SessionGroupReport2026February2.HTM","https://drive.google.com/file/d/1CBFmV7DlcDxD0-lmXrIqZQN0SO-KEjAc/view"],
  ["SessionGroupReport2026February4.HTM","https://drive.google.com/file/d/1MhoH-l4taolsp3F3zkEEShupkAn3_kAd/view"],
  ["SessionGroupReport2026February9.HTM","https://drive.google.com/file/d/1qk5FZAcWHN72hmmwEGNNs5_QWjEHDeUn/view"],
  ["SessionGroupReport2026February11.HTM","https://drive.google.com/file/d/1VQoL5f66kYCsD7HCEBurSRFuLqpbnQ2o/view"],
  ["SessionGroupReport2026February16.HTM","https://drive.google.com/file/d/1fmmIMK8qoUhBuv6qtokj8jLzOApF0vYM/view"],
  ["SessionGroupReport2026February18.HTM","https://drive.google.com/file/d/19Pz9BOq9Q_9PyLDr-_lQEKRwmqDm9cNi/view"],
  ["SessionGroupReport2026February23.HTM","https://drive.google.com/file/d/14X5B9pdmEPCsr49rFLXQpCsr1zJRrSAV/view"],
  ["SessionGroupReport2026February25.HTM","https://drive.google.com/file/d/1VXjl2R9oMuLvSAr0shHc2HqSDQNJDSW3/view"],
  ["SessionGroupReport2026March2.HTM","https://drive.google.com/file/d/1B2FJCF1dUX1Ai7Z7ILfqdhwtoDVh38NM/view"],
  ["SessionGroupReport2026March4.HTM","https://drive.google.com/file/d/1qsZRsO1pD4xiNGqxh9hznKs7S1cLSnL4/view"],
  ["SessionGroupReport2026March9.HTM","https://drive.google.com/file/d/1nOQexMhafPHjYPhYISTNpv-ZcOVPC07S/view"],
  ["SessionGroupReport2026March11.HTM","https://drive.google.com/file/d/1e9U93-lkuSwaL1C6-H4fNS9t8e0vJdmK/view"],
  ["SessionGroupReport2026March16.HTM","https://drive.google.com/file/d/14BT0lLltgM8MruxtKRAFZ8D_oB4PwC_0/view"],
  ["SessionGroupReport2026March18.HTM","https://drive.google.com/file/d/15do4TW6aelt42tGnfXu11RtOfMBUtF36/view"],
  ["SessionGroupReport2026March23.HTM","https://drive.google.com/file/d/1USC4mzzH60t3CTuTqH60YqFTRsWNMVbJ/view"],
  ["SessionGroupReport2026March25.HTM","https://drive.google.com/file/d/1IEvgPg2135GHtHQfUEODMypqJSdgiAEv/view"],
  ["SessionGroupReport2026March30.HTM","https://drive.google.com/file/d/1evQo5nkU7XNj9BE2ZT5EY7itzl634qSj/view"],
  ["SessionGroupReport2026April1.HTM","https://drive.google.com/file/d/1T_tRJlh3Erg8M1TeyoTwwyNTelK-EHyi/view"],
  ["SessionGroupReport2026April6.HTM","https://drive.google.com/file/d/1p2x4Yt92q-3FPv5yUupBl-UCniI9r6Po/view"],
  ["SessionGroupReport2026April8.HTM","https://drive.google.com/file/d/1WWrsKHdhVt0z4SQ-DB3nT9439lE0rGag/view"],
  ["SessionGroupReport2026April13.HTM","https://drive.google.com/file/d/11c7B0gaWEIRSlT7zsWiXxUZWloV5S6b6/view"],
  ["SessionGroupReport2026April15.HTM","https://drive.google.com/file/d/1b7krDPx0iX9jkPT7KeLONWd6SAS8Gh45/view"],
  ["SessionGroupReport2026April20.HTM","https://drive.google.com/file/d/1YIbZBS3XoSEHeAUWN1bBwFQThYCnZXoP/view"],
  ["SessionGroupReport2026April22.HTM","https://drive.google.com/file/d/1fAf-dCtR8ev2ZlEUAvv8UWwt4KpSzX3X/view"],
  ["SessionGroupReport2026April27.HTM","https://drive.google.com/file/d/1PsXSPzsrhRMvS0U9AnF1KqsrFPhqr_q-/view"],
  ["SessionGroupReport2026April29.HTM","https://drive.google.com/file/d/1A00LEReamEHFTb2O3o-Bf9wPRpNp3-Ms/view"],
  ["SessionGroupReport2026May4.HTM","https://drive.google.com/file/d/1kcHGLraqmhwiOBRyjTnNKlX3z4L5-31H/view"],
  ["SessionGroupReport2026May6.HTM","https://drive.google.com/file/d/1XfYl01FXkWMatzr9MVjt6UzCjU0RAOvW/view"],
  ["SessionGroupReport2026May11.HTM","https://drive.google.com/file/d/1kLWOOKtbUewmyZiRIJmz6AtCVzSqR7Ip/view"],
  ["SessionGroupReport2026May13.HTM","https://drive.google.com/file/d/1k5QB67DZDszrp57rEz7vXVPEFMmEHj4P/view"],
  ["SessionGroupReport2026May18.HTM","https://drive.google.com/file/d/12aaN8sVZnofDOfDTo3Ce9yoCmIC2eoJ8/view"],
  ["SessionGroupReport2026May20.HTM","https://drive.google.com/file/d/1EBxIi6hJQ2Bmn4u-mcAaWdEgsmXjiu3b/view"],
  ["SessionGroupReport2026May25.HTM","https://drive.google.com/file/d/1gUi5qDMCxYYk0dXcweHjLGGXkFoGq8_k/view"],
  ["SessionGroupReport2026May27.HTM","https://drive.google.com/file/d/1u6M6AZaY6-flcUzxqdAcW5qijjr_vMsY/view"],
  ["SessionGroupReport2026June1.HTM","https://drive.google.com/file/d/1baLaMRRfXKRRBYMQrPy5LmrQwkITV9P6/view"],
  ["SessionGroupReport2026June3.HTM","https://drive.google.com/file/d/1KY0FsKaBg7o8wqmqK5pd537MIXhwKCM4/view"],
  ["SessionGroupReport2026June8.HTM","https://drive.google.com/file/d/1yC0J8sou9YpTqWL2raqDODS4WYQlb8hM/view"],
  ["SessionGroupReport2026June10.HTM","https://drive.google.com/file/d/1_Q5DcpzkYql8kdJpJRFpB3cCIeFD5fXU/view"],
  ["SessionGroupReport2026June15.HTM","https://drive.google.com/file/d/1P6KKvxOInFOBz_FX1_7RSVBs4QRiUI3A/view"],
  ["SessionGroupReport2026June17.HTM","https://drive.google.com/file/d/1LcQcjQpXIiGsUgINELuFCJp274uD0HwB/view"],
];

if (require.main === module) {
  main().catch(function (error) {
    process.stderr.write((error && error.stack ? error.stack : String(error)) + '\n');
    process.exitCode = 1;
  });
}

module.exports = {
  parseName,
  sessionsFromEntries,
  legacySessions,
  oldSiteSessions,
  discoveredSessions
};
