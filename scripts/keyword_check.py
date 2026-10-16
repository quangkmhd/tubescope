"""Live YouTube keyword UI acceptance, isolated temporary SQLite; no user warehouse writes."""
import argparse
import json
import socket
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import uvicorn
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.main import create_app
from tubescope.extractor import Extractor

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base',default='http://localhost:3000')
args=parser.parse_args()
output=Path('/home/quangnh/.codex/visualizations/2026/10/16/01a14252-2316-7780-982e-798885154e7d')
report={'checks':[],'jobs':[]}

def passed(message):
    report['checks'].append(message)
    print('PASS',message,flush=True)

with tempfile.TemporaryDirectory(prefix='tubescope-keyword-') as directory:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0))
        port=sock.getsockname()[1]
    api=f'http://127.0.0.1:{port}'
    app=create_app(Path(directory)/'live.sqlite3',extractor=Extractor())
    server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=port,log_level='error'))
    thread=threading.Thread(target=server.run,daemon=True)
    thread.start()
    deadline=time.monotonic()+10
    while not server.started and time.monotonic()<deadline:
        time.sleep(0.01)
    assert server.started
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(headless=True)
        context=browser.new_context(viewport={'width':1440,'height':1000},locale='vi-VN',timezone_id='Asia/Bangkok',reduced_motion='reduce')
        page=context.new_page()
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        def proxy(route):
            target=urlsplit(route.request.url)
            response=route.fetch(url=api+target.path+('?' + target.query if target.query else ''))
            route.fulfill(response=response)
        page.route('**/api/**',proxy)
        try:
            page.goto(args.base)
            page.wait_for_load_state('networkidle')
            page.locator('#source-limit').select_option('custom')
            page.get_by_role('spinbutton',name='Giới hạn tùy chỉnh').fill('2')
            for kind,target in [('video','videos'),('channel','channels'),('playlist','playlists')]:
                page.locator('#source-type').select_option(kind)
                page.locator('#sources').fill('nhạc vàng')
                expect(page.locator('#sources')).to_have_attribute('aria-describedby','source-input-help')
                expect(page.get_by_role('button',name='Bộ lọc YouTube',exact=True)).to_be_enabled()
                page.get_by_role('button',name='Bộ lọc YouTube',exact=True).click()
                expect(page.locator('#native-type')).to_have_value(target)
                expect(page.locator('#native-type')).to_be_disabled()
                if kind!='video':
                    expect(page.locator('#native-duration')).to_have_count(0)
                page.get_by_role('dialog').get_by_role('button',name='Áp dụng bộ lọc',exact=True).click()
                began=time.monotonic()
                with page.expect_response(lambda response: urlsplit(response.url).path=='/api/jobs' and response.request.method=='POST') as response:
                    page.locator('.source-panel button[type=submit]').click()
                payload=response.value.json()
                assert response.value.status==202,payload
                assert response.value.request.post_data_json['source_type']==kind
                job_id=payload['id']
                deadline=time.monotonic()+180
                while time.monotonic()<deadline:
                    job=context.request.get(api+'/api/jobs/'+job_id).json()
                    if job['status'] not in ('queued','running'):
                        break
                    page.wait_for_timeout(500)
                assert job['status']=='completed',job
                assert job['matched_count']>0,job
                rows=context.request.get(api+'/api/videos?scope=job&job_id='+job_id).json()
                resources=context.request.get(api+'/api/jobs/'+job_id+'/resources').json()['items']
                if kind=='video':
                    expect(page.locator('.video-row').first).to_be_visible(timeout=15000)
                    assert rows['total']>0 and all(v['metadata_level']=='full' for v in rows['items'])
                    assert page.locator('.job-progress').get_by_text('Chưa thể bắt đầu').count()==0
                else:
                    expect(page.locator('.resource-card').first).to_be_visible(timeout=15000)
                    assert resources and all(r['kind']==kind for r in resources),resources
                    assert rows['total']==0
                    expect(page.locator('.video-table')).to_have_count(0)
                    expect(page.locator('.browse-toolbar')).to_have_count(0)
                    expect(page.get_by_text('Không có video phù hợp',exact=True)).to_have_count(0)
                    expect(page.locator('.resource-card a').first).to_have_attribute('target','_blank')
                report['jobs'].append({'kind':kind,'seconds':round(time.monotonic()-began,2),'videos':rows['total'],'resources':len(resources),'titles':[v['title'] for v in rows['items']] + [r['title'] for r in resources]})
                expect(page.locator('.job-progress')).to_contain_text('Hoàn thành',timeout=15000)
                if kind=='video':
                    expect(page.locator('.video-row')).to_have_count(min(rows['total'],50),timeout=10000)
                else:
                    expect(page.locator('.resource-card')).to_have_count(len(resources),timeout=10000)
                page.evaluate('window.scrollTo(0,0)')
                output.mkdir(parents=True,exist_ok=True)
                page.screenshot(path=str(output/f'tubescope-keyword-{kind}.png'))
                passed('real nhạc vàng keyword under '+kind+' returns matching results without URL422 or recursive collection')
            page.set_viewport_size({'width':390,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.add_script_tag(path=str(ROOT/'frontend/node_modules/axe-core/axe.min.js'))
            violations=page.evaluate("async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)}))")
            assert not violations,violations
            assert not errors,errors
            passed('mobile layout, axe A/AA, no JS errors')
        finally:
            browser.close()
            server.should_exit=True
            thread.join(timeout=12)
            (ROOT/'.runtime/keyword-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
            assert not thread.is_alive()
