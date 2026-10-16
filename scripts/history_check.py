"""Read-only browser acceptance for real persisted history date/month filters."""
import calendar
import os
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
base = os.environ.get('TUBESCOPE_TEST_URL', 'http://localhost:3000').rstrip('/')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width':1440,'height':1000},timezone_id='Asia/Bangkok',locale='vi-VN',reduced_motion='reduce')
    page.set_default_timeout(10000)
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('console',lambda message:errors.append(message.text) if message.type=='error' and not message.text.startswith('Failed to load resource:') else None)
    page.goto(base+'/?view=history&page=2')
    assert page.locator('.history-date-fields').evaluate('(element)=>getComputedStyle(element).display') == 'grid'
    assert page.locator('.history-filters').evaluate('(element)=>getComputedStyle(element).paddingLeft') == '24px'
    page.get_by_role('radio',name='Hôm nay',exact=True).check()
    expect(page.locator('#history-from')).not_to_have_value('')
    expect(page).not_to_have_url(re.compile(r'[?&]page='))
    expect(page.locator('.history-row').first).to_be_visible()
    page.locator('#history-month').fill('2020-02')
    expect(page.locator('#history-from')).to_have_value('2020-02-01')
    expect(page.locator('#history-to')).to_have_value('2020-02-29')
    page.get_by_role('button',name='Áp dụng',exact=True).click()
    expect(page.get_by_text('Không có lượt thu thập trong khoảng ngày này',exact=True)).to_be_visible()
    page.reload()
    expect(page.locator('#history-month')).to_have_value('2020-02')
    page.get_by_role('button',name='Xóa bộ lọc',exact=True).click()
    expect(page.locator('.history-row').first).to_be_visible()
    assert 'history_from' not in parse_qs(urlparse(page.url).query)
    page.locator('#history-from').fill('2026-10-20')
    page.locator('#history-to').fill('2026-10-01')
    page.get_by_role('button',name='Áp dụng',exact=True).click()
    expect(page.get_by_text('Ngày bắt đầu không được sau ngày kết thúc.',exact=True)).to_be_visible()
    page.get_by_role('button',name='Xóa bộ lọc',exact=True).click()
    first=page.request.get(base+'/api/jobs?page_size=1').json()['items'][0]
    local=datetime.fromisoformat(first['created_at']).astimezone(ZoneInfo('Asia/Bangkok'))
    month=local.strftime('%Y-%m')
    page.locator('#history-month').fill(month)
    page.get_by_role('button',name='Áp dụng',exact=True).click()
    expect(page.locator('.history-row').first).to_be_visible()
    expect(page.locator('.history-day-heading').first).to_be_visible()
    expected=page.request.get(f'{base}/api/jobs?date_from={month}-01&date_to={month}-{calendar.monthrange(local.year,local.month)[1]}&time_zone=Asia%2FBangkok').json()
    expect(page.locator('.history-row')).to_have_count(len(expected['items']))
    page.reload()
    expect(page.locator('#history-month')).to_have_value(month)
    page.go_back()
    expect(page.locator('#history-month')).to_have_value('')
    page.go_forward()
    expect(page.locator('#history-month')).to_have_value(month)
    expect(page.locator('.history-row').first).to_be_visible()
    page.add_script_tag(path=str(root/'frontend/node_modules/axe-core/axe.min.js'))
    violations=page.evaluate("async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)}))")
    assert not violations,violations
    output=Path('/home/quangnh/.codex/visualizations/2026/10/16/01a14252-2316-7780-982e-798885154e7d/tubescope-history-filters.png')
    output.parent.mkdir(parents=True,exist_ok=True)
    page.screenshot(path=str(output))
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    violations=page.evaluate("async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>v.id)")
    assert not violations,violations
    assert not errors,errors
    print('PASS today/page reset, leap-month range, empty result, reload, clear, reversed dates, real count, grouping, Back/Forward, desktop/mobile axe, no overflow/JS errors')
    print(output)
    browser.close()
