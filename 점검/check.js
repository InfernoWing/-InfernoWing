/* 올리기 전 자동 점검 — 가짜 서버·가짜 자료로만 동작합니다(운영 자료는 건드리지 않음).
   실행: node 점검/check.js   (playwright 필요: npm i -g playwright && npx playwright install chromium)
   끝에 "합계: n 통과 / m 실패"가 나오고, 실패가 있으면 종료 코드 1 */
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'check-'));
/* 운영 열쇠·프로젝트 이름을 가짜로 바꾼 사본으로만 연다 */
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const fake = src.replace(/apiKey: "[^"]*"/, 'apiKey: "FAKE_KEY_FOR_TEST"').replace(/projectId: "[^"]*"/, 'projectId: "fake-test-project"');
if (fake === src || !fake.includes('FAKE_KEY_FOR_TEST')) { console.error('열쇠를 가짜로 바꾸지 못했어요 — 중단'); process.exit(2); }
fs.writeFileSync(path.join(TMP, 'test.html'), fake);

const srv = http.createServer((q, r) => { const f = path.join(TMP, q.url.split('?')[0]); if (fs.existsSync(f) && fs.statSync(f).isFile()) { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(f)); } else { r.writeHead(404); r.end(); } });
const results = [];
const ok = (name, cond, extra = '') => { results.push(cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); };
const stu = i => ({ name: '가짜학생' + i, school: '가짜중', grade: '중1', regularClass: '1T' + i + ' (월수금 1부)', regularTeacher: '가짜쌤', status: '재원' });

async function open(browser, view) {
  const page = await (await browser.newContext({ viewport: view })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) errs.push(m.text()); });
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1')) return route.continue();
    if (u.endsWith('firebase-firestore.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(__dirname, 'mock-firestore.js')) });
    if (u.endsWith('firebase-app.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(__dirname, 'mock-app.js')) });
    return route.abort();   /* 바깥 연결은 전부 막음 */
  });
  await page.addInitScript(() => { sessionStorage.setItem('kladi_edit', '1'); sessionStorage.setItem('kladi_who_skip', '1'); });
  await page.goto('http://127.0.0.1:8127/test.html'); await page.waitForTimeout(600);
  await page.evaluate(s => { s.forEach((x, i) => window.__mockfs.seed('students', 'stu' + i, x));
    window.__mockfs.seed('exams', 'ex1', { school: '가짜중', grade: '중1', examName: '중간고사', startDate: '2026-11-20', endDate: '2026-11-22' });
    const t = new Date(), k = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    window.__mockfs.seed('exams', 'ex2', { school: '가짜중', grade: '중1', examName: '기말고사', startDate: k, endDate: k }); }, [1, 2, 3, 4, 5].map(stu));
  await page.waitForTimeout(400);
  return { page, errs };
}

(async () => {
  await new Promise(r => srv.listen(8127, r));
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const [label, view] of [['컴퓨터', { width: 1280, height: 900 }], ['휴대폰', { width: 390, height: 844 }]]) {
    const { page, errs } = await open(browser, view);
    ok(`${label}: "이번 주 시험 보는 학교" 줄에 오늘 시험이 나옴`, await page.$eval('.stat-card.week', e => e.textContent.includes('가짜중') && e.textContent.includes('진행 중')).catch(() => false));
    await page.click('#todoBtn'); await page.waitForTimeout(250);
    ok(`${label}: "할 일" 창에 범위 미입력·교과서 미등록이 나옴`, await page.$$eval('#todoBody .todo-row', r => r.some(x => x.dataset.kind === 'scope') && r.some(x => x.dataset.kind === 'book')));
    await page.click('#closeTodoModal');
    const tabs = await page.$$eval('.tab-btn[data-tab]', b => b.map(x => x.dataset.tab));
    ok(`${label}: 탭 ${tabs.length}개 찾음`, tabs.length >= 5, tabs.join(','));
    for (const t of tabs) {
      await page.click(`.tab-btn[data-tab="${t}"]`); await page.waitForTimeout(350);
      ok(`${label}: "${t}" 탭이 열림`, await page.$eval(`.tab-btn[data-tab="${t}"]`, b => b.classList.contains('active')));
    }
    ok(`${label}: 가로로 삐져나오지 않음`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (label === '컴퓨터') {
      await page.click('.tab-btn[data-tab="students"]'); await page.waitForTimeout(300);
      const n0 = await page.evaluate(() => window.__mockfs.count('students'));
      await page.click('#studentTableBody .icon-btn.del >> nth=0'); await page.waitForSelector('#askModal.active'); await page.click('#askYes'); await page.waitForTimeout(500);
      ok('학생 삭제됨', await page.evaluate(() => window.__mockfs.count('students')) === n0 - 1);
      await page.click('#toastWrap .tclose').catch(() => {});
      await page.click('#trashList .trash-restore'); await page.waitForSelector('#askModal.active'); await page.click('#askYes'); await page.waitForTimeout(500);
      ok('"최근 삭제"에서 복구됨', await page.evaluate(() => window.__mockfs.count('students')) === n0);
    }
    ok(`${label}: 화면 오류 0건`, errs.length === 0, errs.join(' | '));
    await page.context().close();
  }
  await browser.close(); srv.close(); fs.rmSync(TMP, { recursive: true, force: true });
  const f = results.filter(x => !x).length;
  console.log(`\n합계: ${results.length - f} 통과 / ${f} 실패`);
  process.exit(f ? 1 : 0);
})();
