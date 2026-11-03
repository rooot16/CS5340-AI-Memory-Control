"""Memory icon, disclosure, dashboard deep-link, and A/B isolation regression test."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from browser_storage_test import make_page, saved, CHROME, ROOT
from playwright.sync_api import sync_playwright


def test():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        ctx, page, errors = make_page(browser)
        # A must not disclose memory attribution.
        assert page.locator('.memory-indicator').count() == 0
        assert page.locator('.memory-attribution').count() == 0

        page.locator('#settingsMenuToggle').click()
        page.locator('#menuVersionB').click()
        assert page.locator('.memory-indicator').count() == 1
        assert page.locator('.memory-source-panel').count() == 1
        assert not page.locator('.memory-source-panel').is_visible()
        assert page.locator('.memory-attribution').count() == 0

        page.locator('.memory-indicator').click()
        assert page.locator('.memory-source-panel').is_visible()
        assert page.locator('.memory-source-row').count() == 2
        assert page.get_by_text('Memories used in this reply').is_visible()
        assert page.locator('.memory-indicator').get_attribute('aria-expanded') == 'true'
        page.screenshot(path=str(ROOT/'preview_v1.7.png'), full_page=True)
        # Click coffee in popover, jump to highlighted dashboard entry.
        page.get_by_role('button', name='Open memory in dashboard: User likes coffee.').click()
        assert page.locator('#memoryView').is_visible()
        assert page.locator('#memoryList .is-highlighted').count() == 1
        assert page.locator('#memoryList .is-highlighted .memory-text').inner_text() == 'User likes coffee.'
        assert page.locator('#memoryList .is-highlighted .small-button').first.evaluate('(el) => el === document.activeElement')

        # The dashboard is still fully editable.
        page.locator('#memoryList .is-highlighted .small-button').first.click()
        page.locator('.memory-edit-input').fill('User prefers tea.')
        page.locator('.memory-item.is-editing .small-button').first.click()
        page.locator('#backToChat').click()
        page.locator('.memory-indicator').click()
        assert page.locator('.memory-source-panel .memory-source-row-text').first.is_visible()
        assert page.get_by_text('Updated since this reply', exact=True).is_visible()

        # Closing details preserves the reply; refresh preserves old sources and new data.
        page.get_by_role('button', name='Close memory details').click()
        assert not page.locator('.memory-source-panel').is_visible()
        snapshot = saved(page)
        ctx.close()
        ctx, page, errors2 = make_page(browser, snapshot)
        assert page.locator('.memory-indicator').count() == 1
        page.locator('.memory-indicator').click()
        assert page.locator('.memory-source-panel .memory-source-row-text').first.is_visible()
        assert page.get_by_text('Updated since this reply', exact=True).is_visible()

        # Deleting an attributed memory makes it non-navigable, but keeps historical context.
        page.locator('#memoryNav').click()
        page.locator('.memory-item').filter(has_text='User prefers tea.').get_by_role('button',name='Delete memory: User prefers tea.').click()
        page.locator('#confirmDelete').click()
        page.locator('#backToChat').click()
        page.locator('.memory-indicator').click()
        assert page.get_by_text('Deleted · no longer in Memory Dashboard').count() == 1
        assert page.get_by_role('button', name='Open memory in dashboard: User prefers tea.').count() == 0
        assert not (errors + errors2), errors + errors2
        ctx.close()

        # Responsive disclosure still fits the chat area.
        ctx, page, errors = make_page(browser, viewport={'width':390,'height':760})
        page.locator('#settingsMenuToggle').click()
        page.locator('#menuVersionB').click()
        page.locator('.memory-indicator').click()
        assert page.locator('.memory-source-panel').is_visible()
        panel = page.locator('.memory-source-panel').bounding_box()
        assert panel and panel['x'] >= 0 and panel['x'] + panel['width'] <= 391, panel
        page.screenshot(path=str(ROOT/'preview_mobile_v1.7.png'), full_page=True)
        assert not errors, errors
        ctx.close()
        browser.close()
    print('PASS: compact disclosure, jump and highlight, edit, refresh, delete handling, Version A privacy, mobile layout')

if __name__ == '__main__':
    test()
