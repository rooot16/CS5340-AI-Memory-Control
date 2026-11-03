from playwright.sync_api import sync_playwright
from browser_storage_test import make_page, CHROME, ROOT

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME,headless=True,args=['--no-sandbox'])
    ctx,page,errors=make_page(browser, viewport={'width':1366,'height':900})
    page.locator('#settingsMenuToggle').click()
    page.locator('#menuVersionB').click()
    page.locator('#newChat').click()
    page.locator('#messageInput').fill('I like jasmine tea.')
    page.locator('#sendMessage').click()
    page.locator('#memoryNav').click()
    page.wait_for_timeout(350)
    page.screenshot(path=str(ROOT/'auto_memory_dashboard_preview.png'),full_page=True)
    assert page.get_by_text('✦ Auto-saved from chat').count()==1
    assert not errors,errors
    ctx.close()
    ctx,page,errors=make_page(browser,viewport={'width':390,'height':760})
    page.locator('#settingsMenuToggle').click()
    page.locator('#menuVersionB').click()
    page.locator('#sidebarToggle').click()
    page.locator('#newChat').click()
    page.locator('#messageInput').fill('I like jasmine tea.')
    page.locator('#sendMessage').click()
    page.locator('#memoryNav').click()
    page.wait_for_timeout(350)
    page.screenshot(path=str(ROOT/'auto_memory_dashboard_mobile_preview.png'),full_page=True)
    assert page.locator('#autoMemoryToggle').is_visible()
    assert not errors, errors
    ctx.close();browser.close()
print('screenshots created')
