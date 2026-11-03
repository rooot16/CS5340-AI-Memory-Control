"""Self-contained headless Chromium UI regression test.

Uses set_content instead of a localhost request to support environments where
browser navigation to localhost/file: is blocked by an administrator. This tests
real DOM interactions with a localStorage-compatible in-page store.
Requires: pip install playwright and local Chromium.
"""
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'index.html').read_text()
CSS = (ROOT / 'styles.css').read_text()
JS = (ROOT / 'app.js').read_text()
CHROME = shutil.which('chromium') or shutil.which('google-chrome')
STORAGE_KEY = 'cs5340-ai-memory-chat-history-v1.5'


def make_page(browser, old_storage=None, viewport=None):
    context = browser.new_context(viewport=viewport or {'width': 1366, 'height': 860})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('about:blank')
    page.set_content(HTML.replace('<script src="app.js" defer></script>', '').replace('<link rel="stylesheet" href="styles.css" />', ''))
    # Simulates localStorage API while retaining data between separate pages.
    page.evaluate('''data => {
      window.__store = {...data};
      const storage = {
        get length(){return Object.keys(window.__store).length;},
        key(i){return Object.keys(window.__store)[i] ?? null;},
        getItem(k){return Object.prototype.hasOwnProperty.call(window.__store,k) ? window.__store[k] : null;},
        setItem(k,v){window.__store[k]=String(v);},
        removeItem(k){delete window.__store[k];},
        clear(){window.__store={};}
      };
      Object.defineProperty(window, 'localStorage', {value:storage,configurable:true});
    }''', old_storage or {})
    page.add_style_tag(content=CSS)
    page.add_script_tag(content=JS)
    return context, page, errors


def saved(page):
    return page.evaluate('({...window.__store})')


def test():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        ctx, page, errors = make_page(browser)
        page.locator('#settingsMenuToggle').click()
        assert page.locator('#settingsMenu').is_visible()
        assert page.locator('#resetDemo').count() == 0
        page.locator('#menuVersionB').click()
        assert page.locator('#memoryNav').is_visible()
        page.locator('#memoryNav').click()
        assert page.locator('#memoryCount').inner_text() == '3 memories'
        page.locator('#addMemory').click()
        page.locator('.memory-edit-input').fill('User loves matcha.')
        page.locator('.memory-item.is-editing .small-button').first.click()
        assert page.locator('#memoryCount').inner_text() == '4 memories'
        page.locator('#backToChat').click()
        page.locator('#newChat').click()
        page.locator('#messageInput').fill('Recommend something to drink')
        page.locator('#sendMessage').click()
        assert page.locator('#chatHistory .history-row').count() == 2
        snapshot = saved(page)
        assert snapshot[STORAGE_KEY]
        assert not errors, errors
        ctx.close()

        # Reopen in the same logical browser: version, history, memories survive.
        ctx, page, errors = make_page(browser, snapshot)
        assert page.locator('#memoryNav').is_visible()  # Version B survived refresh
        page.locator('#memoryNav').click()
        assert page.locator('#memoryCount').inner_text() == '4 memories'
        assert page.get_by_text('User loves matcha.', exact=True).is_visible()
        page.locator('#backToChat').click()
        assert page.locator('#chatHistory .history-row').count() == 2

        # Cancel leaves user data intact.
        page.locator('#settingsMenuToggle').click()
        page.locator('#clearAllData').click()
        assert page.locator('#clearAllOverlay').is_visible()
        assert '7 saved memories' in page.locator('#clearAllSummary').inner_text()
        page.locator('#cancelClearAll').click()
        assert page.locator('#chatHistory .history-row').count() == 2

        page.locator('#settingsMenuToggle').click()
        page.locator('#clearAllData').click()
        page.locator('#confirmClearAll').click()
        assert page.locator('#messages .message').count() == 0
        assert page.locator('#chatHistory .history-row').count() == 0
        assert page.locator('.history-empty').count() == 1
        cleared = saved(page)
        db = __import__('json').loads(cleared[STORAGE_KEY])
        assert db['cleared'] is True
        assert db['A']['memories'] == [] and db['B']['memories'] == []
        assert all(len(chat['messages']) == 0 for v in ['A','B'] for chat in db[v]['conversations'])
        assert not errors, errors
        ctx.close()

        # Cleared state must NOT reseed starter data; new chats can still be made.
        ctx, page, errors = make_page(browser, cleared)
        assert page.locator('#messages .message').count() == 0
        assert page.locator('#chatHistory .history-row').count() == 0
        page.locator('#settingsMenuToggle').click()
        page.locator('#menuVersionB').click()
        page.locator('#memoryNav').click()
        assert page.locator('#memoryCount').inner_text() == '0 memories'
        page.locator('#backToChat').click()
        page.locator('#messageInput').fill('Hello again')
        page.locator('#sendMessage').click()
        assert page.locator('#chatHistory .history-row').count() == 1
        assert not errors, errors
        ctx.close()

        # New browser profile doesn't inherit cleared data.
        ctx, page, errors = make_page(browser)
        assert page.locator('#messages .message').count() == 2
        assert page.locator('#chatHistory .history-row').count() == 1
        page.locator('#settingsMenuToggle').click()
        page.screenshot(path=str(ROOT/'preview_v1.6.png'),full_page=True)
        assert not errors, errors
        ctx.close()

        # Mobile breakpoint layout; burger remains visible and menu fits screen.
        ctx, page, errors = make_page(browser,viewport={'width':390,'height':760})
        page.locator('#settingsMenuToggle').click()
        assert page.locator('#settingsMenu').is_visible()
        menu_box=page.locator('#settingsMenu').bounding_box()
        assert menu_box and menu_box['x']>=-1 and menu_box['x']+menu_box['width']<=391
        page.screenshot(path=str(ROOT/'preview_mobile_v1.6.png'),full_page=True)
        assert not errors, errors
        ctx.close();browser.close()
    print('PASS: A/B menu, persistent chats+memories, clear confirmation/cancel, no reseed, separate browser profiles, mobile layout')


if __name__=='__main__': test()
