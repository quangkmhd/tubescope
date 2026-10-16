"""Regression: result category Select stays visible; no collection POST required."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
base = os.environ.get('TUBESCOPE_TEST_URL', 'http://localhost:3000').rstrip('/')
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width':1000,'height':850})
    errors=[]
    posts=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('request',lambda request:posts.append(request.url) if request.method=='POST' else None)
    page.goto(base+'/?view=library&kind=all')
    page.wait_for_load_state('networkidle')
    page.locator('.result-filters > summary').click()
    category=page.get_by_role('combobox',name='Category',exact=True)
    category.click()
    options=page.get_by_role('listbox')
    expect(options).to_be_visible()
    page.get_by_role('option',name='Howto & Style',exact=True).click()
    expect(category).to_contain_text('Howto & Style')
    category.click()
    expect(page.get_by_role('option',name='Howto & Style',exact=True)).to_have_attribute('aria-selected','true')
    page.keyboard.press('Escape')
    expect(category).to_be_focused()
    page.locator('.result-filter-form').get_by_role('button',name='Apply filters',exact=True).click()
    expect(page).to_have_url(__import__('re').compile('category=26'))
    page.reload()
    page.locator('.result-filters > summary').click()
    expect(category).to_contain_text('Howto & Style')
    page.set_viewport_size({'width':390,'height':844})
    category.click()
    expect(options).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.keyboard.press('Tab')
    assert options.evaluate('(list)=>list.contains(document.activeElement)')
    page.keyboard.press('Shift+Tab')
    assert options.evaluate('(list)=>list.contains(document.activeElement)')
    page.add_script_tag(path=str(root/'frontend/node_modules/axe-core/axe.min.js'))
    violations=page.evaluate("async()=> (await axe.run(document.querySelector('[role=listbox]'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>v.id)")
    assert not violations,violations
    page.keyboard.press('Escape')
    expect(category).to_be_focused()
    page.locator('.result-filter-form').get_by_role('button',name='Reset filters',exact=True).click()
    expect(category).to_contain_text('All categories')
    expect(page.locator('.result-filter-form').get_by_role('button',name='Reset filters',exact=True)).to_be_focused()
    violations=page.evaluate("async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>v.id)")
    assert not violations,violations
    assert not errors,errors
    assert not posts,posts
    print('PASS category menu, selection/reopen, Escape/focus, URL category26, reload/reset, mobile keyboard, axe, no crawl POST')
    browser.close()
