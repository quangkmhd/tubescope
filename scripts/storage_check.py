"""Browser acceptance: real warehouse read-only, lifecycle on isolated temporary SQLite."""
import argparse
import csv
import io
import json
import socket
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
OUT = Path('/home/quangnh/.codex/visualizations/2026/10/16/01a14252-2316-7780-982e-798885154e7d')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', default='http://localhost:3000')
parser.add_argument('--lifecycle', action='store_true', help='Also run real worker against a controlled test extractor and temporary SQLite')
parser.add_argument('--lifecycle-only', action='store_true', help='Only use the isolated lifecycle test database')
args = parser.parse_args()
report = {'checks': [], 'screenshots': [], 'axe': {}}


def passed(label):
    report['checks'].append(label)
    print('PASS', label, flush=True)


def audit(page, label):
    page.add_script_tag(path=str(ROOT / 'frontend/node_modules/axe-core/axe.min.js'))
    violations = page.evaluate("async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)}))")
    report['axe'][label] = violations
    assert not violations, violations
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow'
    passed(label + ' accessibility and no overflow')


def screenshot(page, name):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    page.screenshot(path=str(path), full_page=True)
    report['screenshots'].append(str(path))


def real_checks(browser):
    context = browser.new_context(viewport={'width':1440, 'height':1000}, timezone_id='Asia/Bangkok', locale='vi-VN', reduced_motion='reduce')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.base + '/?view=library&kind=channels')
    page.wait_for_load_state('networkidle')
    expect(page.locator('.group-card').first.locator('time')).to_be_visible()
    screenshot(page, 'tubescope-storage-groups.png')
    page.goto(args.base + '/?view=library&kind=all')
    page.wait_for_load_state('networkidle')
    expect(page.get_by_role('heading', name='Kho lưu trữ', exact=True)).to_be_visible()
    expect(page.locator('.video-row').first).to_be_visible()
    assert 'Kho nghiên cứu' not in page.locator('body').inner_text()
    assert page.locator('.video-row').first.locator('time').count() > 0
    expect(page.locator('#sort option[value=arrival]')).to_have_count(0)
    audit(page, 'storage-desktop')
    screenshot(page, 'tubescope-storage-dates.png')
    passed('storage naming and real saved timestamps')
    jobs = page.request.get(args.base + '/api/jobs?page_size=50').json()['items']
    job = next(j for j in jobs if j['matched_count'] > 0 and j['status'] == 'completed')
    page.goto(args.base + '/?view=discover&job=' + job['id'])
    page.wait_for_load_state('networkidle')
    expect(page.locator('.video-row').first).to_be_visible()
    api_rows = page.request.get(args.base + '/api/videos?scope=job&job_id=' + job['id'] + '&sort=arrival').json()
    expect(page.locator('.video-row').first).to_contain_text(api_rows['items'][0]['title'])
    expect(page.locator('.job-timing-grid')).to_contain_text('Kết thúc lúc')
    expect(page.locator('.job-timing-grid')).not_to_contain_text('NaN')
    passed('default discovery arrival order and frozen completion timer')
    # Inspect the real rendered component before exercising fields.
    summary = page.locator('.result-filters > summary')
    expect(summary).to_be_visible()
    summary.click()
    inputs = page.locator('.result-filters input').evaluate_all('(els)=>els.map(e=>({id:e.id,type:e.type}))')
    report['result_inputs'] = inputs
    form = page.locator('.result-filter-form')
    page.locator('#result-views_min').fill('100')
    page.locator('#result-views_max').fill('1')
    form.get_by_role('button', name='Áp dụng bộ lọc', exact=True).click()
    expect(page.get_by_text('Lượt xem tối đa phải lớn hơn hoặc bằng tối thiểu.', exact=True)).to_be_visible()
    form.get_by_role('button', name='Đặt lại bộ lọc', exact=True).click()
    page.locator('#result-category').click()
    expect(page.get_by_role('listbox')).to_be_visible()
    page.get_by_role('option', name='Hướng dẫn & phong cách', exact=True).click()
    expect(page.locator('#result-category')).to_contain_text('Hướng dẫn & phong cách')
    page.locator('#result-category').click()
    page.keyboard.press('Escape')
    expect(page.locator('#result-category')).to_be_focused()
    form.get_by_role('button', name='Đặt lại bộ lọc', exact=True).click()
    ceiling = str(api_rows['items'][0]['view_count'])
    page.locator('#result-views_min').fill('0')
    page.locator('#result-views_max').fill(ceiling)
    form.get_by_role('button', name='Áp dụng bộ lọc', exact=True).click()
    expect(page).to_have_url(__import__('re').compile('views_max=' + ceiling))
    expect(page.locator('.video-row').first).to_be_visible()
    csv_url = page.get_by_role('link', name='CSV', exact=True).get_attribute('href')
    assert 'views_max=' + ceiling in csv_url and 'sort=arrival' in csv_url
    expected = page.request.get(args.base + '/api/videos?scope=job&job_id=' + job['id'] + '&sort=arrival&views_min=0&views_max=' + ceiling).json()
    expect(page.locator('.video-row')).to_have_count(min(expected['total'], 50))
    exported = list(csv.DictReader(io.StringIO(page.request.get(args.base + csv_url).text().lstrip('\ufeff'))))
    assert len(exported) == expected['total']
    page.reload()
    expect(page.locator('#result-views_max')).to_have_value(ceiling)
    page.go_back()
    expect(page.locator('#result-views_max')).to_have_value('')
    page.go_forward()
    expect(page.locator('#result-views_max')).to_have_value(ceiling)
    expect(page.locator('.video-row').first).to_be_visible()
    if not page.locator('.result-filters').evaluate('(element)=>element.open'):
        page.locator('.result-filters > summary').click()
    passed('postfilter validation, category keyboard, URL reload/Back/Forward, server counts and matching CSV')
    audit(page, 'result-filters-desktop')
    screenshot(page, 'tubescope-discovery-filters.png')
    page.set_viewport_size({'width':390, 'height':844})
    audit(page, 'result-filters-mobile')
    screenshot(page, 'tubescope-storage-mobile.png')
    assert not errors, errors
    context.close()


class LifecycleExtractor:
    """Test-only bounded network substitute; never used by production app."""
    version = 'isolated-browser-test'

    def extract(self, url, *, flat=False, limit=100, start=None, end=None, cancel=None):
        from tubescope.extractor import ExtractionCancelled
        if 'forced-failure' in url:
            raise RuntimeError('YouTube test: HTTP 429 - Too Many Requests')
        if flat:
            return {'entries': [
                {'id':'UC' + '0'*22, 'title':'Kênh kiểm thử', 'url':'https://www.youtube.com/channel/UC'+'0'*22, 'ie_key':'YoutubeTab'},
                *[{'id':f't{i:010d}', 'url':f'https://www.youtube.com/watch?v=t{i:010d}', 'title':f'Kiểm thử video {i}'} for i in range(1,7)]
            ]}
        vid = urlsplit(url).query.split('v=')[-1]
        index = int(vid[1:])
        # After three completed records, leave one in flight for ETA/cancellation.
        delay = 0.8 if index <= 3 else 30
        if cancel.wait(delay):
            raise ExtractionCancelled()
        return {'id':vid, 'webpage_url':url, 'title':f'Kiểm thử video {index}', 'channel':'Kênh kiểm thử', 'channel_id':'UC'+'0'*22, 'duration':120+60*index, 'view_count':900-100*index, 'like_count':10*index, 'upload_date':'20261016', 'categories':['Entertainment'], 'description':'Dữ liệu kiểm thử biệt lập', 'live_status':'not_live'}


def lifecycle_checks(browser):
    import uvicorn
    from app.main import create_app
    with tempfile.TemporaryDirectory(prefix='tubescope-browser-') as directory:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        app = create_app(Path(directory) / 'test.sqlite3', extractor=LifecycleExtractor())
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='error'))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        deadline = time.monotonic()+10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.01)
        assert server.started
        context = browser.new_context(viewport={'width':1440,'height':1000}, timezone_id='Asia/Bangkok', locale='vi-VN', reduced_motion='reduce')
        page = context.new_page()
        posts = []
        payloads = []
        def proxy(route):
            request = route.request
            if request.method == 'POST':
                posts.append(urlsplit(request.url).path)
                if urlsplit(request.url).path == '/api/jobs':
                    payloads.append(request.post_data_json)
            target = urlsplit(request.url)
            response = route.fetch(url=f'http://127.0.0.1:{port}{target.path}' + ('?' + target.query if target.query else ''))
            route.fulfill(response=response)
        page.route('**/api/**', proxy)
        try:
            page.goto(args.base)
            page.wait_for_load_state('networkidle')
            page.locator('#source-type').select_option('playlist')
            page.locator('.source-panel .advanced-filters > summary').click()
            page.locator('#playlist-start').fill('3')
            page.locator('#source-type').select_option('keyword')
            page.locator('.source-panel .advanced-filters > summary').click()
            expect(page.locator('#duration-min')).to_be_visible()
            expect(page.locator('.source-panel #result-category')).to_have_count(0)
            page.locator('#sources').fill('lifecycle')
            page.get_by_role('button', name='Thu thập video', exact=True).click()
            expect(page.locator('.video-row')).to_have_count(3, timeout=15000)
            expect(page.locator('.video-row').first).to_contain_text('Kiểm thử video 3')
            expect(page.locator('.job-timing-grid')).to_contain_text('≈', timeout=6000)
            before = page.locator('.job-timing-grid dd').first.inner_text()
            page.wait_for_timeout(1200)
            assert page.locator('.job-timing-grid dd').first.inner_text() != before
            assert not payloads[0]['filters'].get('playlist_start'), payloads[0]
            assert not payloads[0]['filters'].get('category'), payloads[0]
            passed('source settings clear hidden playlist bounds; prefilters and result filters are separate')
            passed('live arrivals prepend despite lower views, elapsed ticks and ETA appears')
            link = page.get_by_role('link', name='Mở nguồn', exact=True)
            expect(link).to_have_attribute('href', 'https://www.youtube.com/channel/UC'+'0'*22)
            assert link.get_attribute('target') == '_blank'
            posted = len(posts)
            # Stop external navigation at the browser boundary; assert no new crawl POST.
            context.route('https://www.youtube.com/**', lambda route: route.abort())
            with page.expect_popup() as popup:
                link.click()
            popup.value.close()
            page.wait_for_timeout(300)
            assert len(posts) == posted
            passed('Mở nguồn opens YouTube and creates no collection job')
            page.get_by_role('button', name='Hủy thu thập', exact=True).click()
            expect(page.locator('.job-progress')).to_contain_text('Đã hủy thu thập')
            expect(page.locator('.video-row')).to_have_count(3)
            expect(page.get_by_role('button', name='Hủy thu thập', exact=True)).to_have_count(0)
            end = page.locator('.job-timing-grid dd').first.inner_text()
            page.wait_for_timeout(1200)
            assert page.locator('.job-timing-grid dd').first.inner_text() == end
            passed('real worker cancellation retains results and freezes timer')
            page.get_by_role('checkbox', name='Chọn tất cả video trên trang', exact=True).check()
            page.get_by_role('button', name='Lưu vào kho', exact=True).click()
            expect(page.locator('.video-saved-at')).to_have_count(3)
            expect(page.locator('.video-saved-at').first).to_contain_text('Đã có trong kho')
            assert page.locator('.video-saved-at time').first.get_attribute('datetime')
            page.get_by_role('button', name='Kiểm thử video 3', exact=True).click()
            expect(page.get_by_role('dialog')).to_contain_text('Đã lưu vào kho:')
            page.keyboard.press('Escape')
            passed('saved status shows actual saved date in results and detail on isolated SQLite')
            audit(page, 'cancelled-job')
            screenshot(page, 'tubescope-cancelled-job-test.png')
            page.locator('#sources').fill('forced-failure')
            page.get_by_role('button', name='Thu thập video', exact=True).click()
            expect(page.locator('.job-reason')).to_contain_text('HTTP 429', timeout=10000)
            passed('underlying source error reason is visible')
        finally:
            context.close()
            server.should_exit = True
            thread.join(timeout=10)
            assert not thread.is_alive()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        if not args.lifecycle_only:
            real_checks(browser)
        if args.lifecycle or args.lifecycle_only:
            lifecycle_checks(browser)
    finally:
        browser.close()
        (ROOT / '.runtime').mkdir(exist_ok=True)
        (ROOT / '.runtime/storage-check.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
