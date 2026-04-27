/**
 * screenshot.mjs
 * Captura screenshots de páginas HTML locais e analisa visualmente.
 *
 * Uso:
 *   node screenshot.mjs [arquivo.html] [--full]
 *
 * Exemplos:
 *   node screenshot.mjs                  → captura todos os .html da pasta
 *   node screenshot.mjs v2.html          → captura apenas v2.html
 *   node screenshot.mjs v2.html --full   → captura a página inteira (não só a viewport)
 *
 * Screenshots salvos em: .screenshots/
 */

import puppeteer from 'puppeteer';
import { readdir, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, basename, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCREENSHOTS_DIR = join(__dirname, '.screenshots');
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile',  width: 390,  height: 844 },
];

async function ensureDir(dir) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function getHtmlFiles(targetFile) {
  if (targetFile) {
    const abs = resolve(__dirname, targetFile);
    if (!existsSync(abs)) {
      console.error(`Arquivo nao encontrado: ${targetFile}`);
      process.exit(1);
    }
    return [abs];
  }
  const files = await readdir(__dirname);
  return files
    .filter(f => f.endsWith('.html') && !f.startsWith('_'))
    .map(f => resolve(__dirname, f));
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function capture(page, filePath, viewport, fullPage, ts) {
  const url = `file:///${filePath.replace(/\\/g, '/')}`;
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

  // Aguarda fontes e imagens carregarem
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 500));

  const name = basename(filePath, '.html');
  const screenshotPath = join(SCREENSHOTS_DIR, `${name}__${viewport.name}__${ts}.png`);

  await page.screenshot({ path: screenshotPath, fullPage });
  console.log(`  Salvo: ${screenshotPath}`);

  // Coleta métricas visuais para análise
  const metrics = await page.evaluate(() => {
    const getComputedProps = (el, props) =>
      props.reduce((acc, p) => ({ ...acc, [p]: getComputedStyle(el)[p] }), {});

    const body = document.body;
    const allElements = [...document.querySelectorAll('*')];

    // Elementos com padding/margin não-zero
    const spacingIssues = allElements
      .slice(0, 200)
      .filter(el => {
        const s = getComputedStyle(el);
        return el.getBoundingClientRect().width > 0;
      })
      .map(el => {
        const s = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          class: el.className?.toString().slice(0, 60) || null,
          padding: s.padding,
          margin: s.margin,
          fontSize: s.fontSize,
          color: s.color,
          backgroundColor: s.backgroundColor,
          borderRadius: s.borderRadius,
          boxShadow: s.boxShadow !== 'none' ? s.boxShadow.slice(0, 80) : null,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter(el => el.width > 0 && el.height > 0)
      .slice(0, 50);

    return {
      title: document.title,
      bodyWidth: body.scrollWidth,
      bodyHeight: body.scrollHeight,
      viewportWidth: window.innerWidth,
      elements: spacingIssues,
    };
  });

  return { screenshotPath, metrics };
}

async function main() {
  const args = process.argv.slice(2);
  const fullPage = args.includes('--full');
  const targetFile = args.find(a => a.endsWith('.html'));

  await ensureDir(SCREENSHOTS_DIR);

  const files = await getHtmlFiles(targetFile);
  console.log(`\nCapturando ${files.length} arquivo(s)...`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const ts = timestamp();
  const results = [];

  for (const file of files) {
    console.log(`\n→ ${basename(file)}`);
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage();
      try {
        const result = await capture(page, file, viewport, fullPage, ts);
        results.push({ file: basename(file), viewport: viewport.name, ...result });
      } catch (err) {
        console.error(`  Erro (${viewport.name}): ${err.message}`);
      } finally {
        await page.close();
      }
    }
  }

  await browser.close();

  // Relatório resumido no terminal
  console.log('\n─────────────────────────────────────────');
  console.log('Screenshots gerados:');
  results.forEach(r => {
    console.log(`  ${r.file} [${r.viewport}] → ${r.screenshotPath.split('\\').pop()}`);
  });
  console.log(`\nPasta: ${SCREENSHOTS_DIR}`);
  console.log('─────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
