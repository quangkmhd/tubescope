"""Headless acceptance against the real running app; small live crawl, no seeded rows."""
import argparse
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
REPORT = ROOT / '.runtime/browser-check.json'
REPORT.parent.mkdir(exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://localhost:3000')
parser.add_argument('--job', help='Reuse a previous full crawl instead of hitting YouTube again')
args = parser.parse_args()
report = {'checks': [], 'axe': {}, 'console_errors': [], 'screenshots': []}

def passed(name):
    report['checks'].append(name)
    print('PASS', name, flush=True)

def shot(page, name):
    target = OUT / f'real-{name}.png'
    page.screenshot(path=str(target), full_page=True)
    report['screenshots'].append(str(target))

def audit(page, name):
    if not page.evaluate('typeof window.axe !== "undefined"'):
        page.add_script_tag(path=str(ROOT / 'frontend/node_modules/axe-core/axe.min.js'))
    result = page.evaluate('''async () => {
      const r = await axe.run(document, {runOnly: {type:'tag', values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});
      return r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));
    }''')
    report['axe'][name] = result
    if result:
        print('AXE', name, json.dumps(result, ensure_ascii=False), flush=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    assert not result, f'Accessibility violations at {name}'
    passed(f'axe {name}: no WCAG A/AA violations')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
    page = context.new_page()
    page.on('pageerror', lambda error: report['console_errors'].append(str(error)))
    page.on('console', lambda message: report['console_errors'].append(message.text) if message.type == 'error' else None)
    page.goto(args.base)
    expect(page.get_by_role('heading', name='Discover videos', exact=True)).to_be_visible()
    expect(page.locator('#sources')).to_have_attribute('required', '')
    expect(page.locator('#source-limit')).to_have_value('100')
    passed('real app defaults and required source')

    # Native validity regression for rounded duration presets.
    page.locator('#sources').fill('kiến trúc nhà nhỏ')
    for value in ['short', 'long']:
        page.locator('#duration-preset').select_option(value)
        assert page.locator('.source-panel form').evaluate('(form)=>form.checkValidity()')
    page.locator('#duration-preset').select_option('all')
    passed('short and long duration presets pass native form validation')

    if args.job:
        job_id = args.job
        page.goto(f'{args.base}/?view=discover&job={job_id}')
    else:
        page.locator('#source-limit').select_option('custom')
        page.get_by_role('spinbutton', name='Custom limit').fill('2')
        with page.expect_response(lambda response: response.url.endswith('/api/jobs') and response.request.method == 'POST') as response:
            page.get_by_role('button', name='Collect metadata', exact=True).click()
        payload = response.value.json()
        assert response.value.ok, payload
        job_id = payload['id']
        passed('created real crawl through UI')
    report['job_id'] = job_id
    deadline = time.monotonic() + 150
    while time.monotonic() < deadline:
        job = page.request.get(f'{args.base}/api/jobs/{job_id}').json()
        if job['status'] not in ['queued', 'running']:
            break
        page.wait_for_timeout(1500)
    assert job['status'] == 'completed', job
    assert job['matched_count'] > 0, job
    expect(page.locator('.video-row').first).to_be_visible(timeout=15000)
    expect(page.locator('.job-progress').get_by_role('button', name='Try again')).to_have_count(0)
    passed('real crawl completed, rows rendered, no invalid retry button')
    data = page.request.get(f'{args.base}/api/videos?scope=job&job_id={job_id}&page=1&page_size=50').json()
    video = data['items'][0]
    report['video_ids'] = [item['id'] for item in data['items']]
    page.get_by_role('checkbox', name='Select all videos on this page', exact=True).check()
    with page.expect_response(lambda response: '/api/library/save' in response.url and response.request.method == 'POST') as response:
        page.get_by_role('button', name='Save to library', exact=True).click()
    saved = response.value.json()
    assert response.value.ok and saved['job_id'] is None, saved
    expect(page.locator('.video-row').first.get_by_text('Already in library', exact=True)).to_be_visible()
    passed('selected and saved real videos to SQLite from UI')
    with page.expect_download() as download:
        page.get_by_role('link', name='CSV', exact=True).click()
    downloaded = OUT / 'actual-export.csv'
    download.value.save_as(str(downloaded))
    assert video['id'] in downloaded.read_text(encoding='utf-8-sig')
    passed('downloaded actual filtered CSV')
    audit(page, 'desktop-discover')
    shot(page, 'discover-desktop')

    original = page.request.get(f"{args.base}/api/videos/{video['id']}").json()
    title_button = page.get_by_role('button', name=video['title'], exact=True)
    title_button.click()
    dialog = page.get_by_role('dialog', name='Video details', exact=True)
    expect(dialog).to_be_visible()
    expect(page.get_by_text('17 metadata groups', exact=True).last).to_be_visible()
    test_note = f"Kiểm tra giao diện {job_id[:8]}"
    try:
        page.locator('#video-notes').fill(test_note)
        page.get_by_role('radio', name='Keep', exact=True).check()
        with page.expect_response(lambda response: response.url.endswith('/review') and response.request.method == 'PATCH'):
            page.get_by_role('button', name='Save review', exact=True).click()
        expect(page.get_by_text('Review saved', exact=True)).to_be_visible()
        page.reload()
        expect(page.locator('#video-notes')).to_have_value(test_note)
        assert page.request.get(f"{args.base}/api/videos/{video['id']}").json()['review_status'] == 'keep'
        passed('review survives browser reload and API readback')
        audit(page, 'desktop-detail')
        shot(page, 'detail-desktop')
        page.locator('#video-notes').fill(test_note + ' bản nháp')
        page.go_back()
        expect(dialog).not_to_be_visible()
        page.go_forward()
        expect(page.locator('#video-notes')).to_have_value(test_note + ' bản nháp')
        expect(page.get_by_text('Unsaved draft', exact=True)).to_be_visible()
        passed('browser Back and Forward preserve unsaved review draft')
        page.once('dialog', lambda prompt: prompt.accept())
        page.keyboard.press('Escape')
        expect(dialog).not_to_be_visible()
        # Reloading loses the original trigger reference; fallback is the main landmark.
        expect(page.locator('#main-content')).to_be_focused(timeout=5000)
        assert page.evaluate('(id)=>sessionStorage.getItem(`tubescope.review.v1.${id}`)', video['id']) is None
        title_button.click()
        expect(dialog).to_be_visible()
        page.keyboard.press('Escape')
        expect(dialog).not_to_be_visible()
        expect(title_button).to_be_focused(timeout=5000)
        passed('Escape confirms discard and restores keyboard focus')
    finally:
        response = page.request.patch(f"{args.base}/api/videos/{video['id']}/review", data={key: original[key] for key in ['review_status', 'notes', 'personal_tags']})
        assert response.ok

    page.locator('.main-navigation').get_by_role('link', name='Library', exact=False).click()
    expect(page.locator('.group-card').first).to_be_visible()
    expect(page.locator('.warehouse-tabs').get_by_role('link', name='Channels', exact=True)).to_have_attribute('aria-current', 'page')
    audit(page, 'desktop-warehouse')
    shot(page, 'warehouse-desktop')
    page.locator('#browse-query').fill('zzzzunmatchedacceptance9876')
    expect(page.get_by_text('No matching sources', exact=True)).to_be_visible()
    page.locator('#browse-query').fill('')
    expect(page.locator('.group-card').first).to_be_visible()
    page.locator('.group-card').first.click()
    expect(page.locator('.video-row').first).to_be_visible()
    passed('channel-first warehouse drilldown and server-backed empty search')
    for tab in ['Playlists', 'Categories', 'All videos']:
        page.locator('.warehouse-tabs').get_by_role('link', name=tab, exact=True).click()
        expect(page.locator('.video-row' if tab == 'All videos' else '.group-card').first).to_be_visible()
    passed('playlist, YouTube categories and all-video views load persisted data')
    page.locator('.main-navigation').get_by_role('link', name='History', exact=True).click()
    expect(page.locator('.history-row').first).to_be_visible()
    passed('durable job history renders')

    page.goto(f'{args.base}/?view=discover&job={job_id}')
    page.get_by_role('button', name='YouTube filters', exact=False).click()
    expect(page.get_by_role('dialog', name='YouTube search filters', exact=True)).to_be_visible()
    audit(page, 'native-filter-dialog')
    page.keyboard.press('Escape')
    page.set_viewport_size({'width': 390, 'height': 844})
    expect(page.get_by_role('heading', name='Discover videos', exact=True)).to_be_visible()
    page.wait_for_timeout(300)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    audit(page, 'mobile-discover')
    shot(page, 'discover-mobile')
    page.locator('.main-navigation').get_by_role('link', name='Library', exact=False).click()
    expect(page.locator('.group-card').first).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    audit(page, 'mobile-warehouse')
    shot(page, 'warehouse-mobile')
    passed('390px mobile layout has no horizontal overflow')

    # Separate browser context simulates unavailable API, without mutating saved rows.
    failure_context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    failed = failure_context.new_page()
    failed.route('**/api/health', lambda route: route.fulfill(status=503, content_type='application/json', body=json.dumps({'detail': 'The service is temporarily unavailable'})))
    failed.goto(args.base)
    expect(failed.get_by_text('Could not connect to the library service', exact=True)).to_be_visible()
    expect(failed.locator('.video-row')).to_have_count(0)
    passed('unavailable backend shows an explicit error without fabricated results')
    failure_context.close()
    # Ignore network resource failures for remote thumbnails; all JS/React errors fail acceptance.
    report['console_errors'] = [error for error in report['console_errors'] if not error.startswith('Failed to load resource:')]
    assert not report['console_errors'], report['console_errors']
    passed('no JavaScript or React console errors')
    browser.close()

REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps({'checks': len(report['checks']), 'job_id': job_id, 'report': str(REPORT)}, ensure_ascii=False))
