"""Automatic memory: real API response emulation and mock mode, persistence, A/B, opt-out."""
from playwright.sync_api import sync_playwright
from browser_storage_test import make_page, saved, CHROME, STORAGE_KEY
import json


def stub(page):
    page.evaluate('''() => {
      window.__sent = [];
      window.__memoryProposals = [];
      window.fetch = async (url, options={}) => {
        if (url === '/api/status') return new Response(JSON.stringify({configured:true, model:'gemini-3.5-flash-lite'}), {status:200, headers:{'Content-Type':'application/json'}});
        if (url === '/api/chat') {
          const body = JSON.parse(options.body);
          window.__sent.push(body);
          return new Response(JSON.stringify({reply:'Thanks for sharing.', usedMemoryIds:[], memoryUpdates:window.__memoryProposals}), {status:200,headers:{'Content-Type':'application/json'}});
        }
        throw new Error('Unexpected API request '+url);
      };
    }''')
    page.locator('#aiMode').select_option('gemini')


def send(page, text):
    page.locator('#messageInput').fill(text)
    page.locator('#sendMessage').click()
    page.wait_for_function('!document.querySelector("#messageInput").disabled')


def test():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        ctx, page, errors = make_page(browser)
        stub(page)
        # Go to B (editable) and start with 3 seeded memories.
        page.locator('#settingsMenuToggle').click()
        page.locator('#menuVersionB').click()
        page.locator('#newChat').click()
        page.evaluate("window.__memoryProposals = [{action:'add',memoryId:0,text:'User likes jasmine tea.'}]")
        send(page, 'I like jasmine tea.')
        snapshot = json.loads(saved(page)[STORAGE_KEY]); b = snapshot['B']; a = snapshot['A']
        assert len(b['memories']) == 4 and len(a['memories']) == 3
        assert b['memories'][-1]['text'] == 'User likes jasmine tea.'
        assert b['memories'][-1]['source'] == 'auto'
        assert page.locator('.message.assistant').count() == 1
        assert page.get_by_role('button', name='Manage memory for this reply').count() == 0

        # Duplicate suggested fact is NOT saved again.
        send(page, 'I like jasmine tea.')
        assert len(json.loads(saved(page)[STORAGE_KEY])['B']['memories']) == 4
        # An update targets the same stable ID.
        page.evaluate("window.__memoryProposals = [{action:'update',memoryId:4,text:'User loves jasmine tea.'}]")
        send(page, 'I really love jasmine tea!')
        assert json.loads(saved(page)[STORAGE_KEY])['B']['memories'][-1]['text'] == 'User loves jasmine tea.'

        page.locator('#memoryNav').click()
        assert page.locator('#autoMemoryToggle').is_checked()
        assert page.locator('#memoryCount').inner_text() == '4 memories'
        assert page.get_by_text('User loves jasmine tea.').is_visible()
        assert page.get_by_text('✦ Auto-saved from chat').count() == 1
        # Disable extraction. API may send suggestions, but client should not save them.
        page.locator('#autoMemoryToggle').uncheck()
        assert not page.locator('#autoMemoryToggle').is_checked()
        page.locator('#backToChat').click()
        page.evaluate("window.__memoryProposals = [{action:'add',memoryId:0,text:'User likes pineapple juice.'}]")
        send(page, 'I like pineapple juice.')
        assert len(json.loads(saved(page)[STORAGE_KEY])['B']['memories']) == 4
        assert page.evaluate('window.__sent.at(-1).autoSave') is False
        snapshot = saved(page)
        assert not errors, errors
        ctx.close()
        ctx, page, errors = make_page(browser, snapshot)
        page.locator('#memoryNav').click()
        assert not page.locator('#autoMemoryToggle').is_checked()
        assert page.locator('#memoryCount').inner_text() == '4 memories'
        page.locator('#backToChat').click()
        # Switching conditions doesn't leak B saved memories into A.
        page.locator('#settingsMenuToggle').click()
        page.locator('#menuVersionA').click()
        assert len(json.loads(saved(page)[STORAGE_KEY])['A']['memories']) == 3
        assert not errors, errors
        ctx.close()

        # In Mock mode, a clear durable preference can also be extracted locally.
        ctx, page, errors = make_page(browser)
        page.locator('#settingsMenuToggle').click()
        page.locator('#menuVersionB').click()
        page.locator('#newChat').click()
        send(page, 'I like green tea.')
        mems = json.loads(saved(page)[STORAGE_KEY])['B']['memories']
        assert len(mems) == 4 and mems[-1]['text'] == 'User likes green tea.', mems
        page.locator('#settingsMenuToggle').click()
        page.locator('#clearAllData').click()
        page.locator('#confirmClearAll').click()
        assert json.loads(saved(page)[STORAGE_KEY])['B']['memories'] == []
        assert not errors, errors
        ctx.close()
        browser.close()
    print('PASS: auto memory adds/updates and deduplicates, opt-out & persistence, A/B isolation, Mock and clear')


if __name__ == '__main__': test()
