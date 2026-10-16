"""Regression: category options must render in the page, including embedded browsers."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1000, 'height': 850})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://localhost:3000/?view=discover')
    page.locator('.advanced-filters summary').click()
    category = page.get_by_role('combobox', name='Danh mục', exact=True)
    category.click()
    options = page.get_by_role('listbox', name='Danh mục', exact=True)
    expect(options).to_be_visible(timeout=3000)
    expect(page.get_by_role('option', name='Hướng dẫn & phong cách', exact=True)).to_be_visible()
    page.get_by_role('option', name='Hướng dẫn & phong cách', exact=True).click()
    expect(category).to_contain_text('Hướng dẫn & phong cách')
    category.click()
    expect(options).to_be_visible()
    expect(page.get_by_role('option', name='Hướng dẫn & phong cách', exact=True)).to_have_attribute('aria-selected', 'true')
    page.keyboard.press('Escape')
    expect(options).not_to_be_visible()
    expect(category).to_be_focused()
    page.locator('#sources').fill('thiết kế nội thất')
    expect(category).to_contain_text('Hướng dẫn & phong cách')
    captured = []
    def capture(route):
        captured.append(route.request.post_data_json)
        route.fulfill(status=422, content_type='application/json', body='{"detail":"Kiểm tra kết thúc, không tạo lượt cào"}')
    page.route('**/api/jobs', capture)
    page.get_by_role('button', name='Thu thập video', exact=True).click()
    expect(page.get_by_text('Kiểm tra kết thúc, không tạo lượt cào', exact=True)).to_be_visible()
    assert captured[0]['filters']['category'] == '26', captured
    category.click()
    page.get_by_role('option', name='Tất cả danh mục', exact=True).click()
    page.get_by_role('button', name='Thu thập video', exact=True).click()
    page.wait_for_timeout(200)
    assert not captured[-1]['filters'].get('category'), captured
    page.set_viewport_size({'width': 390, 'height': 844})
    category.evaluate("element=>element.scrollIntoView({block:'center'})")
    category.click()
    expect(options).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    # Radix hides the background while this modal list is open. Audit its visible
    # subtree and verify that Tab cannot reach the hidden form behind it.
    page.keyboard.press('Tab')
    assert options.evaluate('(list)=>list.contains(document.activeElement)')
    page.keyboard.press('Shift+Tab')
    assert options.evaluate('(list)=>list.contains(document.activeElement)')
    page.add_script_tag(path=str(root / 'frontend/node_modules/axe-core/axe.min.js'))
    violations = page.evaluate('''async()=> (await axe.run(document.querySelector('[role="listbox"]'), {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,html:n.html,summary:n.failureSummary}))}))''')
    assert not violations, violations
    output = root / 'test-results/category-fixed.png'
    output.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(output))
    page.keyboard.press('Escape')
    expect(category).to_be_focused()
    violations = page.evaluate('''async()=> (await axe.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>v.id)''')
    assert not violations, violations
    assert not errors, errors
    print('PASS: visible category options, retained selection, Escape/focus, category 26 payload, clear filter, mobile, axe, no JS errors')
    print(output)
    browser.close()
