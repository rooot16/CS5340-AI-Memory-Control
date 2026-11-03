"""v1.9 memory-aware reply actions and dashboard back-button browser regression."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
from browser_storage_test import make_page, saved, CHROME, ROOT
from playwright.sync_api import sync_playwright


def test():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        ctx, page, errors = make_page(browser)
        # The assistant response is unboxed; the user's message keeps its bubble.
        assistant = page.locator('.message.assistant')
        assert assistant.count() == 1
        assert assistant.evaluate('(e) => getComputedStyle(e).backgroundColor') in ('rgba(0, 0, 0, 0)', 'transparent')
        assert assistant.evaluate('(e) => getComputedStyle(e).paddingTop') == '0px'
        assert page.locator('.message.user').evaluate('(e) => getComputedStyle(e).backgroundColor') != 'rgba(0, 0, 0, 0)'
        assert page.get_by_role('button', name='Copy reply').count() == 1
        assert page.get_by_role('button', name='Manage memory for this reply').count() == 0
        # Use a reliable clipboard mock in a page with about:blank origin.
        page.evaluate("window.__copied = null; Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText: async value => {window.__copied=value}}});")
        page.get_by_role('button', name='Copy reply').click()
        assert page.evaluate('window.__copied') == 'An iced latte would be a refreshing choice.'
        assert page.get_by_text('Reply copied to clipboard.').is_visible()

        page.locator('#settingsMenuToggle').click()
        page.locator('#menuVersionB').click()
        assert page.get_by_role('button', name='Manage memory for this reply').count() == 1
        btn = page.get_by_role('button', name='Manage memory for this reply')
        btn.click()
        assert btn.get_attribute('aria-expanded') == 'true'
        assert page.get_by_text('Memories used in this reply').is_visible()
        assert page.locator('.memory-source-row').count() == 2
        page.evaluate("document.querySelector('#toast').hidden = true")
        page.screenshot(path=str(ROOT/'preview_v1.9.png'), full_page=True)
        page.get_by_role('button', name='Open memory in dashboard: User likes coffee.').click()
        assert page.locator('#memoryView').is_visible()
        assert page.locator('#memoryView #backToChat').is_visible()
        assert page.locator('#memoryList .is-highlighted .memory-text').inner_text() == 'User likes coffee.'
        # Edit and return, then sources are marked updated.
        page.locator('#memoryList .is-highlighted .small-button').first.click()
        page.locator('.memory-edit-input').fill('User likes jasmine tea.')
        page.locator('.memory-item.is-editing .small-button').first.click()
        page.locator('#backToChat').click()
        page.get_by_role('button', name='Manage memory for this reply').click()
        assert page.get_by_text('Updated since this reply').is_visible()
        assert page.get_by_role('button', name='Open Memory Dashboard ↗').is_visible()
        page.get_by_role('button', name='Open Memory Dashboard ↗').click()
        assert page.locator('#memoryView').is_visible()
        page.locator('#backToChat').click()

        # Refresh simulation keeps previously stored A/B conversations.
        snapshot = saved(page)
        assert not errors, errors
        ctx.close()
        ctx, page, errors2 = make_page(browser, snapshot)
        assert page.get_by_role('button', name='Manage memory for this reply').count() == 1
        assert page.locator('.message.assistant').evaluate('(e) => getComputedStyle(e).backgroundColor') == 'rgba(0, 0, 0, 0)'
        page.get_by_role('button', name='Manage memory for this reply').click()
        assert page.get_by_text('Updated since this reply').is_visible()
        assert not errors2, errors2
        ctx.close()

        # No attribution: a generic Mock response must only show Copy.
        ctx, page, errors3 = make_page(browser, snapshot)
        page.get_by_role('button', name='New chat').click()
        page.get_by_role('textbox', name='Message AI Assistant').fill('Hello!')
        page.get_by_role('button', name='Send message').click()
        assert page.locator('.message.assistant').count() == 1
        assert page.get_by_role('button', name='Copy reply').count() == 1
        assert page.get_by_role('button', name='Manage memory for this reply').count() == 0
        # Dashboard is still reachable using the main navigation.
        page.locator('#memoryNav').click()
        assert page.locator('#memoryView #backToChat').is_visible()
        back = page.locator('#memoryView #backToChat').bounding_box()
        intro = page.locator('#memoryView .memory-intro').bounding_box()
        assert back['y'] + back['height'] <= intro['y'], (back, intro)
        page.locator('#backToChat').click()
        assert page.locator('#chatView').is_visible()
        assert not errors3, errors3
        ctx.close()

        ctx, page, mobile_errors = make_page(browser, viewport={'width':390,'height':760})
        page.locator('#settingsMenuToggle').click()
        page.locator('#menuVersionB').click()
        page.get_by_role('button', name='Manage memory for this reply').click()
        assert page.locator('.memory-source-panel').is_visible()
        panel = page.locator('.memory-source-panel').bounding_box()
        assert panel and panel['x'] >= -1 and panel['x'] + panel['width'] <= 391, panel
        assert page.locator('.response-actions').bounding_box()['x'] >= 0
        page.screenshot(path=str(ROOT/'preview_mobile_v1.9.png'), full_page=True)
        assert not mobile_errors, mobile_errors
        ctx.close()
        browser.close()
    print('PASS: only memory-attributed replies show manage button; dashboard back button and regression checks pass')

if __name__ == '__main__':
    test()
