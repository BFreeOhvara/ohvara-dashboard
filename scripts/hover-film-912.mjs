// P912 proof: the dark-mode "film". A visible Edge window (real GPU, real compositor) on /agent is hovered 48 times and
// the window's presented frame is read with Windows PrintWindow — a CDP screenshot redraws the whole page and never shows
// it. In each frame the strip at the chart tile's right edge (x 933-950) is compared with the chart left of it
// (x 880-900): normally -4.0; the film made it +3.7 (a lighter vertical band). Runs "now" and "oldblur" (the panel blur
// put back) and counts band frames for each.
//   node scripts/hover-film-912.mjs --base-url http://localhost:5912 [--variants now,oldblur] [--out qa/hover-912-film]
// Pops a browser window for ~2 minutes. Windows only.
import process from 'node:process'
import { readFileSync, mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { PNG } from 'pngjs'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const BASE = flag('--base-url', '').replace(/\/$/, '')
const OUT = resolve(flag('--out', 'qa/hover-912-film'))
if (!BASE) { console.error('--base-url is required'); process.exit(2) }
mkdirSync(OUT, { recursive: true })
const logins = JSON.parse(readFileSync(join(homedir(), '.atlas', 'test-logins.json'), 'utf8'))

// One PowerShell process, DPI-aware, captures a screen rectangle per line "x y w h path" and answers "ok".
const ps1 = join(tmpdir(), `p912-grab-${process.pid}.ps1`)
writeFileSync(ps1, `Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Text; using System.Drawing; using System.Runtime.InteropServices;
public class Grab {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  public struct RECT { public int L, T, R, B; }
  public static IntPtr Find(string t) { IntPtr found = IntPtr.Zero; EnumWindows((h, p) => { if (!IsWindowVisible(h)) return true; var s = new StringBuilder(512); GetWindowText(h, s, 512); if (s.ToString().Contains(t)) { found = h; return false; } return true; }, IntPtr.Zero); return found; }
  // the client area as the window last presented it (PW_CLIENTONLY | PW_RENDERFULLCONTENT), bottom w x h cropped
  public static void Shot(string t, int w, int h, string path) {
    IntPtr hw = Find(t); RECT r; GetClientRect(hw, out r); int cw = r.R - r.L, ch = r.B - r.T;
    using (var b = new Bitmap(cw, ch)) { using (var g = Graphics.FromImage(b)) { IntPtr dc = g.GetHdc(); PrintWindow(hw, dc, 3); g.ReleaseHdc(dc); }
      using (var c = b.Clone(new Rectangle(0, ch - h, Math.Min(w, cw), h), b.PixelFormat)) c.Save(path, System.Drawing.Imaging.ImageFormat.Png); }
  }
}
"@
[Grab]::SetProcessDPIAware() | Out-Null
while ($true) { $l = [Console]::In.ReadLine(); if ($l -eq $null -or $l -eq 'quit') { break }
  $p = $l.Split(' '); try { [Grab]::Shot('P912CAPTURE', [int]$p[0], [int]$p[1], $p[2]) } catch { [Console]::Error.WriteLine($_) }; [Console]::Out.WriteLine('ok') }
`)
const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1], { stdio: ['pipe', 'pipe', 'inherit'] })
let pending = null
ps.stdout.on('data', d => { if (/ok/.test(String(d)) && pending) { const r = pending; pending = null; r() } })
const tmp = join(tmpdir(), `p912-${process.pid}.png`)
async function grab(rect) {
  if (existsSync(tmp)) unlinkSync(tmp)
  await new Promise(r => { pending = r; ps.stdin.write(`${rect.w} ${rect.h} ${tmp}\n`) })
  return readFileSync(tmp)
}


const VARIANTS = {
  noblur: '.fx .fx-tile.fx-tile:not(.is-fill), .fx .ov-card.ov-card, .fx .ov-attn.ov-attn { -webkit-backdrop-filter: saturate(1.35) !important; backdrop-filter: saturate(1.35) !important; }',
  now: '',
  oldblur: '.fx .fx-tile.fx-tile:not(.is-fill), .fx .ov-card.ov-card, .fx .ov-attn.ov-attn { -webkit-backdrop-filter: blur(26px) saturate(1.35) !important; backdrop-filter: blur(26px) saturate(1.35) !important; }',
}
const strip = (buf) => { const P = PNG.sync.read(buf); const m = (x0, x1) => { let s = 0, n = 0; for (let y = 300; y < 700; y += 2) for (let x = x0; x < x1; x++) { const i = (y * P.width + x) * 4; s += P.data[i] + P.data[i + 1] + P.data[i + 2]; n++ } return s / n / 3 }; return { band: m(933, 950), left: m(880, 900) } }
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-position=0,0', '--window-size=1460,1040', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] })
const THEME = flag('--theme', 'dark')
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: THEME })
await ctx.addInitScript(t => { try { localStorage.setItem('ohvara-theme', t) } catch { /* */ } }, THEME)
const page = await ctx.newPage()
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[placeholder="you@email.com"]', logins.agent.email); await page.fill('input[placeholder="Your password"]', logins.agent.password)
await page.click('button[type="submit"]'); await page.waitForURL(u => !/\/login/.test(u.pathname))
const rect = { w: 1440, h: 900 }
const only = flag('--variants', Object.keys(VARIANTS).join(',')).split(',')
const PTS = [[1437, 897], [750, 450], [450, 450], [1050, 450], [925, 200], [150, 750], [1437, 897], [750, 600]]
for (const v of only) {
  await page.goto(`${BASE}/agent`, { waitUntil: 'networkidle' })
  if (VARIANTS[v]) await page.addStyleTag({ content: VARIANTS[v] })
  await page.evaluate(() => { document.title = 'P912CAPTURE' }); await page.waitForTimeout(2500)
  const hb = await page.locator('.fx-ovl-hero').boundingBox()
  let hits = 0, max = -99, min = 99
  for (let k = 0; k < 48; k++) {
    const [x, y] = PTS[k % PTS.length]
    await page.mouse.move(x, y, { steps: 3 }); await page.waitForTimeout(k % 3 === 0 ? 40 : k % 3 === 1 ? 160 : 500)
    const buf = await grab(rect); const st = strip(buf); const d = st.band - st.left
    if (d > max) max = d
    if (d < min) min = d
    if (d > 0) { hits++; writeFileSync(join(OUT, `${v}-band-${k}.png`), buf) }
    if (k === 47) writeFileSync(join(OUT, `${v}-last.png`), buf)
  }
  console.log(v, `band frames ${hits}/48, strip-minus-chart ranged ${min.toFixed(1)} to ${max.toFixed(1)} (dark: steady -4.0, film +3.7)`)
}
ps.stdin.write('quit\n'); await browser.close()
