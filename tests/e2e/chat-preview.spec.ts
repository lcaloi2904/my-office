import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

// Browser integration for the real CSS cascade. No WebGL, app bootstrap, external requests or fake CSS fix.
const css = ['base.css', 'drawers.css', 'group-chat.css'].map((file) =>
  fs.readFileSync(path.resolve('src/styles', file), 'utf8')).join('\n');

test('an existing chat preview yields to either drawer, then becomes clickable again', async ({ page }) => {
  await page.setContent(`<style>${css}</style>
    <section class="drawer" id="dr-mac" hidden><button id="mac-close">Close machine</button></section>
    <section class="drawer" id="dr-session" hidden><button id="session-close">Close session</button></section>
    <button class="zc-peek" id="zc-peek">Synthetic message</button>`);
  const preview = page.locator('#zc-peek');
  await expect(preview).toBeVisible();
  for (const id of ['dr-mac', 'dr-session']) {
    await page.locator('#' + id).evaluate((n) => { (n as HTMLElement).hidden = false; });
    await expect(preview).toBeHidden();
    const close = page.locator('#' + id + ' button');
    await close.evaluate((n) => n.addEventListener('click', () => { (n.parentElement as HTMLElement).hidden = true; }));
    await close.click();
    await expect(page.locator('#' + id)).toBeHidden();
    await expect(preview).toBeVisible();
  }
  await preview.evaluate((n) => n.addEventListener('click', () => n.setAttribute('data-opened', 'true')));
  await preview.click();
  await expect(preview).toHaveAttribute('data-opened', 'true');
});

test('fading chat preview cannot intercept pointer events', async ({ page }) => {
  await page.setContent(`<style>${css}</style><button class="zc-peek is-out" id="zc-peek">Fading message</button>`);
  await expect(page.locator('#zc-peek')).toHaveCSS('pointer-events', 'none');
  expect(await page.locator('#zc-peek').evaluate((n) => {
    const rect = n.getBoundingClientRect();
    return n.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(false);
});
