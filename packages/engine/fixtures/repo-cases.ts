// Repository-backed evaluation cases. Each case is materialized as a two-commit git repo (base → head).
// `expected` marks the added line(s) a correct review should flag (any line containing one of the strings counts);
// `context` lists files a retriever must surface for the bug to be provable; `decoys` share symbol names but are unrelated.
// Labels were authored with the code; they are not independent human ground truth.
import type { RepoCase } from '../src/evaluation.js';

type Files=Record<string,string>;
const c=(id:string,split:RepoCase['split'],language:string,category:string,base:Files,change:Files,expected:(string|string[])[],context:string[],decoys:string[]=[]):RepoCase=>
  ({id,split,language,category,base,head:{...base,...change},expected:expected.map(e=>({path:Object.keys(change)[0],contains:e})),context,decoys});

export const repoCases:RepoCase[]=[
  // ── TypeScript ──────────────────────────────────────────────────────────
  c('ts-undefined-deref','development','typescript','callee-contract',{
    'src/users.ts':"export type User = { id: string; name: string; email: string };\nconst table = new Map<string, User>();\nexport function findUser(id: string): User | undefined {\n  return table.get(id);\n}\n",
    'src/profile.ts':"import { findUser } from './users';\nexport function displayName(id: string) {\n  const user = findUser(id);\n  return user ? user.name : 'unknown';\n}\n",
    'admin/users.ts':"export function findUser(id: string) {\n  return { id, name: 'admin', email: 'root@example.test' };\n}\n"},
    {'src/profile.ts':"import { findUser } from './users';\nexport function displayName(id: string) {\n  const user = findUser(id);\n  return user ? user.name : 'unknown';\n}\nexport function contactEmail(id: string) {\n  return findUser(id)!.email.toLowerCase();\n}\n"},
    ['findUser(id)!.email'],['src/users.ts'],['admin/users.ts']),
  c('ts-signature-break','development','typescript','caller-contract',{
    'src/pricing.ts':"export function applyDiscount(price: number, percent: number) {\n  return price - (price * percent) / 100;\n}\n",
    'src/checkout.ts':"import { applyDiscount } from './pricing';\nexport function checkoutTotal(total: number, coupon?: number) {\n  return coupon ? applyDiscount(total, coupon) : total;\n}\n",
    'legacy/pricing.ts':"export function applyDiscount(price: number) {\n  return price;\n}\nexport const sample = applyDiscount(10);\n"},
    {'src/pricing.ts':"export function applyDiscount(price: number, discount: { percent: number; cap: number }) {\n  return price - Math.min((price * discount.percent) / 100, discount.cap);\n}\n"},
    ['export function applyDiscount(price: number, discount'],['src/checkout.ts'],['legacy/pricing.ts']),
  c('ts-unit-mismatch','heldout','typescript','callee-contract',{
    'src/time.ts':"/** Converts seconds to milliseconds for timers. */\nexport function delayMs(seconds: number) {\n  return seconds * 1000;\n}\n",
    'src/retry.ts':"import { delayMs } from './time';\nexport function retryLater(fn: () => void) {\n  setTimeout(fn, delayMs(2));\n}\n"},
    {'src/retry.ts':"import { delayMs } from './time';\nexport function retryLater(fn: () => void) {\n  setTimeout(fn, delayMs(2));\n}\nexport function retrySoon(fn: () => void) {\n  // retry after 250 milliseconds\n  setTimeout(fn, delayMs(250));\n}\n"},
    ['delayMs(250)'],['src/time.ts']),
  c('ts-clean-internal','development','typescript','clean',{
    'src/format.ts':"export function formatPrice(cents: number) {\n  const dollars = cents / 100;\n  return '$' + dollars.toFixed(2);\n}\n",
    'src/cart.ts':"import { formatPrice } from './format';\nexport function label(total: number) {\n  return `Total: ${formatPrice(total)}`;\n}\n"},
    {'src/format.ts':"const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });\nexport function formatPrice(cents: number) {\n  return currency.format(cents / 100);\n}\n"},
    [],['src/cart.ts']),
  c('ts-null-to-throw','heldout','typescript','caller-contract',{
    'src/parser.ts':"export type Config = { port: number };\nexport function parseConfig(text: string): Config | null {\n  try { return JSON.parse(text) as Config; } catch { return null; }\n}\n",
    'src/loader.ts':"import { parseConfig } from './parser';\nconst defaults = { port: 8080 };\nexport function load(text: string) {\n  const cfg = parseConfig(text);\n  if (!cfg) return defaults;\n  return cfg;\n}\n"},
    {'src/parser.ts':"export type Config = { port: number };\nexport function parseConfig(text: string): Config {\n  const value = JSON.parse(text);\n  if (typeof value.port !== 'number') throw new Error('invalid config: port');\n  return value as Config;\n}\n"},
    ['const value = JSON.parse(text);',"throw new Error('invalid config: port')"],['src/loader.ts']),
  c('ts-sync-to-async','development','typescript','caller-contract',{
    'src/ledger.ts':"const balances = new Map<string, number>();\nexport function getBalance(account: string): number {\n  return balances.get(account) ?? 0;\n}\n",
    'src/transfer.ts':"import { getBalance } from './ledger';\nexport function canTransfer(account: string, amount: number) {\n  if (getBalance(account) < amount) return false;\n  return true;\n}\n",
    'reports/balance.ts':"export async function getBalance(id: string) {\n  return 0;\n}\n"},
    {'src/ledger.ts':"import { db } from './db';\nexport async function getBalance(account: string): Promise<number> {\n  const row = await db.get(account);\n  return row?.balance ?? 0;\n}\n"},
    ['export async function getBalance'],['src/transfer.ts'],['reports/balance.ts']),
  c('ts-monorepo-barrel','heldout','typescript','caller-contract',{
    'packages/core/package.json':'{"name":"@acme/core","main":"src/index.ts"}\n',
    'packages/core/src/index.ts':"export * from './ids';\n",
    'packages/core/src/ids.ts':"let next = 1;\nexport function makeId(prefix: string): string {\n  return `${prefix}_${next++}`;\n}\n",
    'apps/api/src/orders.ts':"import { makeId } from '@acme/core';\nexport function newOrder() {\n  const id = makeId('ord');\n  if (!id.startsWith('ord_')) throw new Error('bad id');\n  return { id };\n}\n"},
    {'packages/core/src/ids.ts':"let next = 1;\nexport function makeId(prefix: string): number {\n  return next++;\n}\n"},
    ['export function makeId(prefix: string): number'],['apps/api/src/orders.ts']),
  c('tsx-prop-rename','development','tsx','caller-contract',{
    'src/Button.tsx':"export function Button(props: { label: string; onClick: () => void }) {\n  return <button onClick={props.onClick}>{props.label}</button>;\n}\n",
    'src/Page.tsx':"import { Button } from './Button';\nexport function Page() {\n  return <Button label=\"Save\" onClick={() => save()} />;\n}\ndeclare function save(): void;\n"},
    {'src/Button.tsx':"export function Button(props: { label: string; onPress: () => void }) {\n  return <button onClick={props.onPress}>{props.label}</button>;\n}\n"},
    ['onPress: () => void'],['src/Page.tsx']),
  c('ts-swapped-args','heldout','typescript','callee-contract',{
    'src/permissions.ts':"export type User = { id: string; role: string };\nexport type Doc = { ownerId: string };\nexport function canEdit(user: User, doc: Doc) {\n  return user.role === 'admin' || doc.ownerId === user.id;\n}\n",
    'src/docs.ts':"import { canEdit, type User, type Doc } from './permissions';\nexport function rename(user: User, doc: Doc, name: string) {\n  if (!canEdit(user, doc)) throw new Error('forbidden');\n  return { ...doc, name };\n}\n"},
    {'src/docs.ts':"import { canEdit, type User, type Doc } from './permissions';\nexport function rename(user: User, doc: Doc, name: string) {\n  if (!canEdit(user, doc)) throw new Error('forbidden');\n  return { ...doc, name };\n}\nexport function archive(user: User, doc: Doc) {\n  if (!canEdit(doc as any, user as any)) throw new Error('forbidden');\n  return { ...doc, archived: true };\n}\n"},
    ['canEdit(doc as any, user as any)'],['src/permissions.ts']),
  c('ts-optional-field','development','typescript','callee-contract',{
    'src/types.ts':"export interface Order {\n  total: number;\n  /** Absent when no coupon was applied. */\n  discount?: number;\n}\n",
    'src/receipt.ts':"import type { Order } from './types';\nexport function header(order: Order) {\n  return `Order total ${order.total}`;\n}\n"},
    {'src/receipt.ts':"import type { Order } from './types';\nexport function header(order: Order) {\n  return `Order total ${order.total}`;\n}\nexport function payable(order: Order) {\n  return order.total - order.discount!;\n}\n"},
    ['order.total - order.discount'],['src/types.ts']),
  // ── JavaScript ──────────────────────────────────────────────────────────
  c('js-sql-injection','development','javascript','security',{
    'lib/db.js':"const pool = require('./pool');\n/** Runs a parameterized query. Always pass user input through params. */\nfunction runQuery(sql, params = []) {\n  return pool.query(sql, params);\n}\nmodule.exports = { runQuery };\n",
    'lib/pool.js':"module.exports = { query: async () => [] };\n",
    'lib/users.js':"const { runQuery } = require('./db');\nfunction byEmail(email) {\n  return runQuery('SELECT * FROM users WHERE email = $1', [email]);\n}\nmodule.exports = { byEmail };\n"},
    {'lib/users.js':"const { runQuery } = require('./db');\nfunction byEmail(email) {\n  return runQuery('SELECT * FROM users WHERE email = $1', [email]);\n}\nfunction byName(name) {\n  return runQuery(\"SELECT * FROM users WHERE name = '\" + name + \"'\");\n}\nmodule.exports = { byEmail, byName };\n"},
    ['SELECT * FROM users WHERE name ='],['lib/db.js']),
  c('js-callback-to-promise','heldout','javascript','caller-contract',{
    'src/storage.js':"const fs = require('fs');\nfunction readSettings(cb) {\n  fs.readFile('settings.json', 'utf8', (err, text) => cb(err, text && JSON.parse(text)));\n}\nmodule.exports = { readSettings };\n",
    'src/app.js':"const { readSettings } = require('./storage');\nfunction boot(start) {\n  readSettings((err, settings) => {\n    if (err) throw err;\n    start(settings);\n  });\n}\nmodule.exports = { boot };\n"},
    {'src/storage.js':"const fs = require('fs');\nasync function readSettings() {\n  const text = await fs.promises.readFile('settings.json', 'utf8');\n  return JSON.parse(text);\n}\nmodule.exports = { readSettings };\n"},
    ['async function readSettings()'],['src/app.js']),
  c('js-param-order','development','javascript','caller-contract',{
    'src/math.mjs':"export function clamp(value, min, max) {\n  return Math.min(max, Math.max(min, value));\n}\n",
    'src/slider.mjs':"import { clamp } from './math.mjs';\nexport function setVolume(el, value) {\n  el.volume = clamp(value, 0, 100);\n}\n",
    'old/clamp.mjs':"export function clamp(min, max, value) {\n  return value;\n}\n"},
    {'src/math.mjs':"export function clamp(min, max, value) {\n  if (min > max) throw new RangeError('min > max');\n  return Math.min(max, Math.max(min, value));\n}\n"},
    ['export function clamp(min, max, value)'],['src/slider.mjs'],['old/clamp.mjs']),
  c('js-clean-reduce','heldout','javascript','clean',{
    'src/stats.js':"function total(values) {\n  let sum = 0;\n  for (const v of values) sum += v;\n  return sum;\n}\nmodule.exports = { total };\n",
    'src/report.js':"const { total } = require('./stats');\nfunction summary(rows) {\n  return { count: rows.length, sum: total(rows) };\n}\nmodule.exports = { summary };\n"},
    {'src/stats.js':"function total(values) {\n  return values.reduce((sum, v) => sum + v, 0);\n}\nmodule.exports = { total };\n"},
    [],['src/report.js']),
  c('js-method-units','development','javascript','caller-contract',{
    'src/cart.js':"class Cart {\n  constructor() { this.items = []; }\n  subtotal() {\n    return this.items.reduce((s, i) => s + i.price, 0);\n  }\n}\nmodule.exports = { Cart };\n",
    'src/invoice.js':"const { Cart } = require('./cart');\nfunction render(cart) {\n  return `Amount due: $${cart.subtotal().toFixed(2)}`;\n}\nmodule.exports = { render, Cart };\n"},
    {'src/cart.js':"class Cart {\n  constructor() { this.items = []; }\n  subtotal() {\n    return this.items.reduce((s, i) => s + i.priceCents, 0);\n  }\n}\nmodule.exports = { Cart };\n"},
    ['s + i.priceCents'],['src/invoice.js']),
  // ── Python ──────────────────────────────────────────────────────────────
  c('py-none-deref','development','python','callee-contract',{
    'app/repo.py':"USERS = {}\n\ndef get_user(uid):\n    \"\"\"Returns the user dict or None when missing.\"\"\"\n    return USERS.get(uid)\n",
    'app/service.py':"from app.repo import get_user\n\ndef display_name(uid):\n    user = get_user(uid)\n    return user['name'] if user else 'unknown'\n",
    'legacy/repo.py':"def get_user(uid):\n    return {'email': 'x@example.test'}\n"},
    {'app/service.py':"from app.repo import get_user\n\ndef display_name(uid):\n    user = get_user(uid)\n    return user['name'] if user else 'unknown'\n\ndef email_for(uid):\n    return get_user(uid)['email'].lower()\n"},
    ["get_user(uid)['email']"],['app/repo.py'],['legacy/repo.py']),
  c('py-kwarg-rename','heldout','python','caller-contract',{
    'notify/mailer.py':"def send_mail(to, subject, body):\n    return {'to': to, 'subject': subject, 'body': body}\n",
    'notify/alerts.py':"from notify.mailer import send_mail\n\ndef alert(user, text):\n    return send_mail(to=user.email, subject='Alert', body=text)\n"},
    {'notify/mailer.py':"def send_mail(recipient, subject, body, cc=None):\n    return {'to': recipient, 'cc': cc or [], 'subject': subject, 'body': body}\n"},
    ['def send_mail(recipient'],['notify/alerts.py']),
  c('py-relative-case','development','python','caller-contract',{
    'auth/__init__.py':'',
    'auth/tokens.py':"def normalize(key):\n    return key.strip()\n",
    'auth/check.py':"from .tokens import normalize\n\nSTORED = 'AbC123'\n\ndef valid(key):\n    return normalize(key) == STORED\n"},
    {'auth/tokens.py':"def normalize(key):\n    return key.strip().lower()\n"},
    ['return key.strip().lower()'],['auth/check.py']),
  c('py-percent-rate','heldout','python','callee-contract',{
    'billing/tax.py':"RATES = {'eu': 20, 'us': 7}\n\ndef rate(region):\n    \"\"\"Tax rate for a region, in percent (20 means 20%).\"\"\"\n    return RATES.get(region, 0)\n",
    'billing/invoice.py':"from billing.tax import rate\n\ndef tax_line(region):\n    return f'Tax: {rate(region)}%'\n"},
    {'billing/invoice.py':"from billing.tax import rate\n\ndef tax_line(region):\n    return f'Tax: {rate(region)}%'\n\ndef gross(amount, region):\n    return amount * (1 + rate(region))\n"},
    ['amount * (1 + rate(region))'],['billing/tax.py']),
  c('py-clean-sum','development','python','clean',{
    'shop/cart.py':"def cart_total(items):\n    total = 0\n    for item in items:\n        total += item['price'] * item['qty']\n    return total\n",
    'shop/checkout.py':"from shop.cart import cart_total\n\ndef charge(items):\n    return {'amount': cart_total(items)}\n"},
    {'shop/cart.py':"def cart_total(items):\n    return sum(item['price'] * item['qty'] for item in items)\n"},
    [],['shop/checkout.py']),
  c('py-none-return-method','heldout','python','callee-contract',{
    'bank/models.py':"class Account:\n    def __init__(self, balance):\n        self.balance = balance\n\n    def apply_fee(self, amount):\n        \"\"\"Deducts a fee in place. Returns None.\"\"\"\n        self.balance -= amount\n",
    'bank/fees.py':"from bank.models import Account\n\ndef monthly(acct: Account):\n    acct.apply_fee(5)\n    return acct.balance\n"},
    {'bank/fees.py':"from bank.models import Account\n\ndef monthly(acct: Account):\n    acct.apply_fee(5)\n    return acct.balance\n\ndef overdraft(acct: Account, store):\n    new_balance = acct.apply_fee(35)\n    store.save(acct, new_balance)\n"},
    ['new_balance = acct.apply_fee(35)'],['bank/models.py']),
  c('py-missing-await','development','python','async',{
    'net/client.py':"import asyncio\n\nasync def fetch_json(url):\n    await asyncio.sleep(0)\n    return {'url': url}\n",
    'net/sync.py':"import asyncio\nfrom net.client import fetch_json\n\ndef load(url):\n    return asyncio.run(fetch_json(url))\n"},
    {'net/sync.py':"import asyncio\nfrom net.client import fetch_json\n\ndef load(url):\n    return asyncio.run(fetch_json(url))\n\nasync def load_title(url):\n    data = fetch_json(url)\n    return data['title']\n"},
    ['data = fetch_json(url)'],['net/client.py']),
  c('py-test-regression','heldout','python','test-coverage',{
    'text/slug.py':"def slugify(title):\n    return '-'.join(title.strip().lower().split())\n",
    'tests/test_slug.py':"from text.slug import slugify\n\ndef test_trims():\n    assert slugify('  Hello World ') == 'hello-world'\n"},
    {'text/slug.py':"def slugify(title):\n    return title.lower().replace(' ', '-')\n"},
    ["return title.lower().replace(' ', '-')"],['tests/test_slug.py']),
  c('py-sql-injection','development','python','security',{
    'data/db.py':"def execute(sql, params=()):\n    \"\"\"Executes SQL with bound parameters; never interpolate user input.\"\"\"\n    return CONN.execute(sql, params)\n\nCONN = None\n",
    'data/reports.py':"from data.db import execute\n\ndef by_id(order_id):\n    return execute('SELECT * FROM orders WHERE id = ?', (order_id,))\n"},
    {'data/reports.py':"from data.db import execute\n\ndef by_id(order_id):\n    return execute('SELECT * FROM orders WHERE id = ?', (order_id,))\n\ndef by_customer(name):\n    return execute(f\"SELECT * FROM orders WHERE customer = '{name}'\")\n"},
    ['SELECT * FROM orders WHERE customer ='],['data/db.py']),
  // ── Go ──────────────────────────────────────────────────────────────────
  c('go-ignored-error','development','go','callee-contract',{
    'go.mod':'module example.com/shop\n\ngo 1.22\n',
    'store/db.go':'package store\n\nimport "errors"\n\nvar ErrNotFound = errors.New("not found")\n\ntype User struct{ Name string }\n\n// LoadUser returns ErrNotFound and a nil user when id is unknown.\nfunc LoadUser(id string) (*User, error) {\n\treturn nil, ErrNotFound\n}\n',
    'api/handler.go':'package api\n\nimport "example.com/shop/store"\n\nfunc Exists(id string) bool {\n\t_, err := store.LoadUser(id)\n\treturn err == nil\n}\n'},
    {'api/handler.go':'package api\n\nimport "example.com/shop/store"\n\nfunc Exists(id string) bool {\n\t_, err := store.LoadUser(id)\n\treturn err == nil\n}\n\nfunc Name(id string) string {\n\tu, _ := store.LoadUser(id)\n\treturn u.Name\n}\n'},
    ['u, _ := store.LoadUser(id)','return u.Name'],['store/db.go']),
  c('go-units-change','heldout','go','caller-contract',{
    'go.mod':'module example.com/shop\n',
    'pay/charge.go':'package pay\n\n// Charge bills the customer amountCents (integer cents).\nfunc Charge(amountCents int64) error {\n\treturn nil\n}\n',
    'checkout/checkout.go':'package checkout\n\nimport "example.com/shop/pay"\n\ntype Order struct{ TotalCents int64 }\n\nfunc Complete(o Order) error {\n\treturn pay.Charge(o.TotalCents)\n}\n'},
    {'pay/charge.go':'package pay\n\n// Charge bills the customer amount in dollars.\nfunc Charge(amount float64) error {\n\tcents := int64(amount * 100)\n\t_ = cents\n\treturn nil\n}\n'},
    ['func Charge(amount float64) error'],['checkout/checkout.go']),
  c('go-same-package-expiry','development','go','caller-contract',{
    'go.mod':'module example.com/app\n',
    'cache/cache.go':'package cache\n\nimport "time"\n\ntype entry struct {\n\tvalue   string\n\texpires time.Time\n}\n\ntype Cache struct{ items map[string]entry }\n\nfunc (c *Cache) Lookup(key string) (string, bool) {\n\te, ok := c.items[key]\n\tif ok && time.Now().Before(e.expires) {\n\t\treturn e.value, true\n\t}\n\treturn "", false\n}\n',
    'cache/session.go':'package cache\n\n// ValidSession relies on Lookup honoring expiry: expired sessions must be rejected.\nfunc ValidSession(c *Cache, token string) bool {\n\t_, ok := c.Lookup("session:" + token)\n\treturn ok\n}\n'},
    {'cache/cache.go':'package cache\n\nimport "time"\n\ntype entry struct {\n\tvalue   string\n\texpires time.Time\n}\n\ntype Cache struct{ items map[string]entry }\n\nfunc (c *Cache) Lookup(key string) (string, bool) {\n\te, ok := c.items[key]\n\tif ok {\n\t\treturn e.value, true\n\t}\n\treturn "", false\n}\n'},
    ['if ok {'],['cache/session.go']),
  c('go-clean-refactor','heldout','go','clean',{
    'go.mod':'module example.com/app\n',
    'mathx/sum.go':'package mathx\n\nfunc Sum(xs []int) int {\n\tt := 0\n\tfor i := 0; i < len(xs); i++ {\n\t\tt += xs[i]\n\t}\n\treturn t\n}\n',
    'stats/stats.go':'package stats\n\nimport "example.com/app/mathx"\n\nfunc Mean(xs []int) float64 {\n\tif len(xs) == 0 {\n\t\treturn 0\n\t}\n\treturn float64(mathx.Sum(xs)) / float64(len(xs))\n}\n'},
    {'mathx/sum.go':'package mathx\n\nfunc Sum(xs []int) int {\n\tt := 0\n\tfor _, x := range xs {\n\t\tt += x\n\t}\n\treturn t\n}\n'},
    [],['stats/stats.go']),
  c('go-shared-map-mutation','development','go','callee-contract',{
    'go.mod':'module example.com/app\n',
    'config/config.go':'package config\n\nvar limits = map[string]int{"rps": 100}\n\n// Limits returns the shared process-wide limits map. Callers must not modify it.\nfunc Limits() map[string]int {\n\treturn limits\n}\n',
    'server/server.go':'package server\n\nimport "example.com/app/config"\n\nfunc RPS() int {\n\treturn config.Limits()["rps"]\n}\n'},
    {'server/server.go':'package server\n\nimport "example.com/app/config"\n\nfunc RPS() int {\n\treturn config.Limits()["rps"]\n}\n\nfunc ForTenant(trial bool) map[string]int {\n\tl := config.Limits()\n\tif trial {\n\t\tl["rps"] = 5\n\t}\n\treturn l\n}\n'},
    ['l["rps"] = 5','l := config.Limits()'],['config/config.go']),
  c('go-dropped-error','heldout','go','callee-contract',{
    'go.mod':'module example.com/app\n',
    'worker/pool.go':'package worker\n\nimport "errors"\n\nvar ErrFull = errors.New("queue full")\n\ntype Pool struct{ jobs chan string }\n\n// Enqueue is non-blocking and returns ErrFull when the queue is full; the job is dropped.\nfunc (p *Pool) Enqueue(job string) error {\n\tselect {\n\tcase p.jobs <- job:\n\t\treturn nil\n\tdefault:\n\t\treturn ErrFull\n\t}\n}\n',
    'jobs/billing.go':'package jobs\n\nimport "example.com/app/worker"\n\nfunc Nightly(p *worker.Pool) error {\n\treturn p.Enqueue("reconcile")\n}\n'},
    {'jobs/billing.go':'package jobs\n\nimport "example.com/app/worker"\n\nfunc Nightly(p *worker.Pool) error {\n\treturn p.Enqueue("reconcile")\n}\n\nfunc ChargeAll(p *worker.Pool, ids []string) {\n\tfor _, id := range ids {\n\t\tp.Enqueue("charge:" + id)\n\t}\n}\n'},
    ['p.Enqueue("charge:" + id)'],['worker/pool.go']),
  // ── Java ────────────────────────────────────────────────────────────────
  c('java-null-return','development','java','callee-contract',{
    'src/main/java/com/acme/data/UserRepo.java':'package com.acme.data;\n\npublic class UserRepo {\n  /** Returns null when no user has this email. */\n  public User findByEmail(String email) {\n    return null;\n  }\n}\n',
    'src/main/java/com/acme/data/User.java':'package com.acme.data;\n\npublic class User {\n  public String getPasswordHash() { return ""; }\n}\n',
    'src/main/java/com/acme/web/LoginController.java':'package com.acme.web;\n\nimport com.acme.data.UserRepo;\n\npublic class LoginController {\n  private UserRepo repo;\n  public boolean exists(String email) {\n    return repo.findByEmail(email) != null;\n  }\n}\n',
    'src/main/java/com/acme/legacy/UserRepo.java':'package com.acme.legacy;\n\npublic class UserRepo {\n  public Object findByEmail(String email) { return new Object(); }\n}\n'},
    {'src/main/java/com/acme/web/LoginController.java':'package com.acme.web;\n\nimport com.acme.data.UserRepo;\n\npublic class LoginController {\n  private UserRepo repo;\n  public boolean exists(String email) {\n    return repo.findByEmail(email) != null;\n  }\n  public boolean login(String email, String hash) {\n    return repo.findByEmail(email).getPasswordHash().equals(hash);\n  }\n}\n'},
    ['repo.findByEmail(email).getPasswordHash()'],['src/main/java/com/acme/data/UserRepo.java'],['src/main/java/com/acme/legacy/UserRepo.java']),
  c('java-widening-units','heldout','java','caller-contract',{
    'src/com/acme/shop/Money.java':'package com.acme.shop;\n\npublic class Money {\n  private long cents;\n  public Money plus(long amountCents) {\n    cents += amountCents;\n    return this;\n  }\n}\n',
    'src/com/acme/shop/Cart.java':'package com.acme.shop;\n\npublic class Cart {\n  private Money total = new Money();\n  public void add(Item item) {\n    total.plus(item.priceCents());\n  }\n}\n'},
    {'src/com/acme/shop/Money.java':'package com.acme.shop;\n\npublic class Money {\n  private long cents;\n  public Money plus(double dollars) {\n    cents += Math.round(dollars * 100);\n    return this;\n  }\n}\n'},
    ['public Money plus(double dollars)'],['src/com/acme/shop/Cart.java']),
  c('java-new-exception','development','java','caller-contract',{
    'src/com/acme/io/RowParser.java':'package com.acme.io;\n\npublic class RowParser {\n  public static String[] parseRow(String line) {\n    return line.split(",");\n  }\n}\n',
    'src/com/acme/io/Importer.java':'package com.acme.io;\n\nimport java.util.List;\n\npublic class Importer {\n  public int importAll(List<String> lines) {\n    int n = 0;\n    for (String l : lines) { RowParser.parseRow(l); n++; }\n    return n;\n  }\n}\n'},
    {'src/com/acme/io/RowParser.java':'package com.acme.io;\n\npublic class RowParser {\n  public static String[] parseRow(String line) {\n    if (line.isBlank()) throw new IllegalArgumentException("blank row");\n    return line.split(",");\n  }\n}\n'},
    ['throw new IllegalArgumentException("blank row")'],['src/com/acme/io/Importer.java']),
  c('java-clean','heldout','java','clean',{
    'src/com/acme/util/Strings.java':'package com.acme.util;\n\npublic class Strings {\n  public static boolean isEmptyish(String s) {\n    return s == null || s.trim().length() == 0;\n  }\n}\n',
    'src/com/acme/web/Form.java':'package com.acme.web;\n\nimport com.acme.util.Strings;\n\npublic class Form {\n  public boolean valid(String name) { return !Strings.isEmptyish(name); }\n}\n'},
    {'src/com/acme/util/Strings.java':'package com.acme.util;\n\npublic class Strings {\n  public static boolean isEmptyish(String s) {\n    return s == null || s.isBlank();\n  }\n}\n'},
    [],['src/com/acme/web/Form.java']),
  c('java-enum-ordinal','development','java','caller-contract',{
    'src/com/acme/orders/Status.java':'package com.acme.orders;\n\npublic enum Status {\n  OPEN,\n  SHIPPED,\n  CLOSED\n}\n',
    'src/com/acme/orders/OrderStore.java':'package com.acme.orders;\n\npublic class OrderStore {\n  // Persisted as the enum ordinal in the orders.status column.\n  public int encode(Status s) { return s.ordinal(); }\n  public Status decode(int v) { return Status.values()[v]; }\n}\n'},
    {'src/com/acme/orders/Status.java':'package com.acme.orders;\n\npublic enum Status {\n  PENDING,\n  OPEN,\n  SHIPPED,\n  CLOSED\n}\n'},
    ['PENDING,'],['src/com/acme/orders/OrderStore.java']),
  // ── Rust ────────────────────────────────────────────────────────────────
  c('rust-unwrap-none','development','rust','callee-contract',{
    'Cargo.toml':'[package]\nname = "app"\nversion = "0.1.0"\n',
    'src/store/mod.rs':'pub struct User { pub name: String }\n\n/// Returns None when the id is unknown.\npub fn lookup_user(id: u32) -> Option<User> {\n    if id == 0 { None } else { Some(User { name: String::new() }) }\n}\n',
    'src/api.rs':'use crate::store;\n\npub fn exists(id: u32) -> bool {\n    store::lookup_user(id).is_some()\n}\n',
    'src/lib.rs':'pub mod api;\npub mod store;\n'},
    {'src/api.rs':'use crate::store;\n\npub fn exists(id: u32) -> bool {\n    store::lookup_user(id).is_some()\n}\n\npub fn name(id: u32) -> String {\n    store::lookup_user(id).unwrap().name\n}\n'},
    ['store::lookup_user(id).unwrap()'],['src/store/mod.rs']),
  c('rust-seconds-as-millis','heldout','rust','callee-contract',{
    'Cargo.toml':'[package]\nname = "app"\nversion = "0.1.0"\n',
    'src/config.rs':'/// Request timeout in seconds.\npub fn timeout_secs() -> u64 {\n    30\n}\n',
    'src/client.rs':'use std::time::Duration;\nuse crate::config;\n\npub fn default_timeout() -> Duration {\n    Duration::from_secs(config::timeout_secs())\n}\n',
    'src/lib.rs':'pub mod client;\npub mod config;\n'},
    {'src/client.rs':'use std::time::Duration;\nuse crate::config;\n\npub fn default_timeout() -> Duration {\n    Duration::from_secs(config::timeout_secs())\n}\n\npub fn upload_timeout() -> Duration {\n    Duration::from_millis(config::timeout_secs() * 2)\n}\n'},
    ['Duration::from_millis(config::timeout_secs() * 2)'],['src/config.rs']),
  c('rust-clean','development','rust','clean',{
    'Cargo.toml':'[package]\nname = "app"\nversion = "0.1.0"\n',
    'src/stats.rs':'pub fn mean(xs: &[f64]) -> f64 {\n    let mut t = 0.0;\n    for x in xs { t += x; }\n    if xs.is_empty() { 0.0 } else { t / xs.len() as f64 }\n}\n',
    'src/report.rs':'use crate::stats;\n\npub fn line(xs: &[f64]) -> String {\n    format!("mean={}", stats::mean(xs))\n}\n',
    'src/lib.rs':'pub mod report;\npub mod stats;\n'},
    {'src/stats.rs':'pub fn mean(xs: &[f64]) -> f64 {\n    if xs.is_empty() { return 0.0; }\n    xs.iter().sum::<f64>() / xs.len() as f64\n}\n'},
    [],['src/report.rs']),
  // ── Ruby ────────────────────────────────────────────────────────────────
  c('ruby-nil-deref','development','ruby','callee-contract',{
    'lib/store.rb':"class Store\n  # Returns nil when the record is missing.\n  def self.lookup(id)\n    RECORDS[id]\n  end\n  RECORDS = {}\nend\n",
    'app/api.rb':"require_relative '../lib/store'\n\nclass Api\n  def exists?(id)\n    !Store.lookup(id).nil?\n  end\nend\n"},
    {'app/api.rb':"require_relative '../lib/store'\n\nclass Api\n  def exists?(id)\n    !Store.lookup(id).nil?\n  end\n\n  def title(id)\n    Store.lookup(id).fetch(:title).upcase\n  end\nend\n"},
    ['Store.lookup(id).fetch(:title)'],['lib/store.rb']),
  c('ruby-kwargs-removed','heldout','ruby','caller-contract',{
    'lib/mailer.rb':"class Mailer\n  def self.deliver(to:, subject:)\n    { to: to, subject: subject }\n  end\nend\n",
    'app/notify.rb':"require_relative '../lib/mailer'\n\nclass Notify\n  def welcome(user)\n    Mailer.deliver(to: user.email, subject: 'Welcome')\n  end\nend\n"},
    {'lib/mailer.rb':"class Mailer\n  def self.deliver(recipient, subject)\n    { to: recipient, subject: subject }\n  end\nend\n"},
    ['def self.deliver(recipient, subject)'],['app/notify.rb']),
  c('ruby-clean','development','ruby','clean',{
    'lib/money.rb':"class Money\n  def self.format(cents)\n    '$' + format('%.2f', cents / 100.0)\n  end\nend\n",
    'app/receipt.rb':"require_relative '../lib/money'\n\nclass Receipt\n  def line(cents)\n    \"Total: #{Money.format(cents)}\"\n  end\nend\n"},
    {'lib/money.rb':"class Money\n  def self.format(cents)\n    dollars = cents / 100.0\n    '$' + Kernel.format('%.2f', dollars)\n  end\nend\n"},
    [],['app/receipt.rb']),
  // ── C# ──────────────────────────────────────────────────────────────────
  c('cs-null-return','development','csharp','callee-contract',{
    'src/Data/CustomerRepo.cs':'namespace Shop.Data;\n\npublic class CustomerRepo {\n  /// <summary>Returns null when the customer does not exist.</summary>\n  public Customer? FindCustomer(int id) { return null; }\n}\npublic class Customer { public string Email = ""; }\n',
    'src/Data/Mailer.cs':'namespace Shop.Data;\n\npublic class Mailer {\n  private CustomerRepo repo = new CustomerRepo();\n  public bool Known(int id) { return repo.FindCustomer(id) != null; }\n}\n',
    'Legacy/OldRepo.cs':'namespace Legacy;\n\npublic class OldRepo {\n  public object FindCustomer(int id) { return new object(); }\n}\n'},
    {'src/Data/Mailer.cs':'namespace Shop.Data;\n\npublic class Mailer {\n  private CustomerRepo repo = new CustomerRepo();\n  public bool Known(int id) { return repo.FindCustomer(id) != null; }\n  public string Address(int id) { return repo.FindCustomer(id)!.Email.ToLower(); }\n}\n'},
    ['repo.FindCustomer(id)!.Email'],['src/Data/CustomerRepo.cs'],['Legacy/OldRepo.cs']),
  c('cs-timeout-units','heldout','csharp','callee-contract',{
    'src/Net/Settings.cs':'namespace App.Net;\n\npublic static class Settings {\n  /// <summary>Timeout in milliseconds.</summary>\n  public static int TimeoutMs() { return 5000; }\n}\n',
    'src/Net/Client.cs':'namespace App.Net;\nusing System;\n\npublic class Client {\n  public TimeSpan Timeout() { return TimeSpan.FromMilliseconds(Settings.TimeoutMs()); }\n}\n'},
    {'src/Net/Client.cs':'namespace App.Net;\nusing System;\n\npublic class Client {\n  public TimeSpan Timeout() { return TimeSpan.FromMilliseconds(Settings.TimeoutMs()); }\n  public TimeSpan UploadTimeout() { return TimeSpan.FromSeconds(Settings.TimeoutMs() * 2); }\n}\n'},
    ['TimeSpan.FromSeconds(Settings.TimeoutMs() * 2)'],['src/Net/Settings.cs']),
  c('cs-clean','development','csharp','clean',{
    'src/Util/Text.cs':'namespace App.Util;\n\npublic static class Text {\n  public static string Initials(string name) {\n    var parts = name.Split(\' \');\n    var s = "";\n    foreach (var p in parts) { if (p.Length > 0) s += p[0]; }\n    return s.ToUpper();\n  }\n}\n',
    'src/Util/Badge.cs':'namespace App.Util;\n\npublic class Badge {\n  public string Label(string name) { return Text.Initials(name); }\n}\n'},
    {'src/Util/Text.cs':'namespace App.Util;\nusing System.Linq;\n\npublic static class Text {\n  public static string Initials(string name) {\n    return string.Concat(name.Split(\' \').Where(p => p.Length > 0).Select(p => p[0])).ToUpper();\n  }\n}\n'},
    [],['src/Util/Badge.cs']),
  // ── PHP ─────────────────────────────────────────────────────────────────
  c('php-null-deref','development','php','callee-contract',{
    'src/Store/Repo.php':"<?php\nnamespace App\\Store;\n\nclass Repo {\n  /** @return array|null null when missing */\n  public function lookupAccount($id) { return null; }\n}\n",
    'src/Http/AccountController.php':"<?php\nnamespace App\\Http;\n\nuse App\\Store\\Repo;\n\nclass AccountController {\n  private Repo $repo;\n  public function exists($id) { return $this->repo->lookupAccount($id) !== null; }\n}\n"},
    {'src/Http/AccountController.php':"<?php\nnamespace App\\Http;\n\nuse App\\Store\\Repo;\n\nclass AccountController {\n  private Repo $repo;\n  public function exists($id) { return $this->repo->lookupAccount($id) !== null; }\n  public function email($id) { return strtolower($this->repo->lookupAccount($id)['email']); }\n}\n"},
    ["$this->repo->lookupAccount($id)['email']"],['src/Store/Repo.php']),
  c('php-percent-rate','heldout','php','callee-contract',{
    'src/Billing/Tax.php':"<?php\nnamespace App\\Billing;\n\nclass Tax {\n  /** Rate in percent, e.g. 20 for 20%. */\n  public static function regionRate($region) { return $region === 'eu' ? 20 : 7; }\n}\n",
    'src/Billing/Invoice.php':"<?php\nnamespace App\\Billing;\n\nclass Invoice {\n  public function label($r) { return Tax::regionRate($r) . '%'; }\n}\n"},
    {'src/Billing/Invoice.php':"<?php\nnamespace App\\Billing;\n\nclass Invoice {\n  public function label($r) { return Tax::regionRate($r) . '%'; }\n  public function gross($amount, $r) { return $amount * (1 + Tax::regionRate($r)); }\n}\n"},
    ['$amount * (1 + Tax::regionRate($r))'],['src/Billing/Tax.php']),
  c('php-clean','development','php','clean',{
    'src/Util/Slug.php':"<?php\nnamespace App\\Util;\n\nclass Slug {\n  public static function make($s) { return strtolower(str_replace(' ', '-', trim($s))); }\n}\n",
    'src/Http/PostController.php':"<?php\nnamespace App\\Http;\n\nuse App\\Util\\Slug;\n\nclass PostController {\n  public function path($title) { return '/posts/' . Slug::make($title); }\n}\n"},
    {'src/Util/Slug.php':"<?php\nnamespace App\\Util;\n\nclass Slug {\n  public static function make($s) {\n    $trimmed = trim($s);\n    return strtolower(str_replace(' ', '-', $trimmed));\n  }\n}\n"},
    [],['src/Http/PostController.php']),
  // ── C / C++ ─────────────────────────────────────────────────────────────
  c('cpp-dangling-pointer','development','cpp','callee-contract',{
    'src/buffer.h':'#pragma once\n#include <string>\n\nclass Buffer {\n public:\n  // Pointer is invalidated by any later append().\n  const char* view() const { return data_.c_str(); }\n  void append(const std::string& s) { data_ += s; }\n private:\n  std::string data_;\n};\n',
    'src/parser.cpp':'#include "buffer.h"\n\nint header_length(Buffer& buf) {\n  const char* start = buf.view();\n  int n = 0;\n  while (start[n] && start[n] != \'\\n\') n++;\n  return n;\n}\n'},
    {'src/parser.cpp':'#include "buffer.h"\n\nint header_length(Buffer& buf) {\n  const char* start = buf.view();\n  int n = 0;\n  while (start[n] && start[n] != \'\\n\') n++;\n  return n;\n}\n\nchar first_after_append(Buffer& buf, const std::string& more) {\n  const char* start = buf.view();\n  buf.append(more);\n  return start[0];\n}\n'},
    ['buf.append(more);','return start[0];'],['src/buffer.h']),
  c('cpp-seconds-as-millis','heldout','cpp','callee-contract',{
    'src/config.h':'#pragma once\n\n// Retry interval in seconds.\ninline int retry_interval_seconds() { return 5; }\n',
    'src/client.cpp':'#include "config.h"\n#include "sleep.h"\n\nvoid backoff() {\n  sleep_seconds(retry_interval_seconds());\n}\n',
    'src/sleep.h':'#pragma once\nvoid sleep_seconds(int s);\nvoid sleep_ms(int ms);\n'},
    {'src/client.cpp':'#include "config.h"\n#include "sleep.h"\n\nvoid backoff() {\n  sleep_seconds(retry_interval_seconds());\n}\n\nvoid short_backoff() {\n  sleep_ms(retry_interval_seconds() / 2);\n}\n'},
    ['sleep_ms(retry_interval_seconds() / 2)'],['src/config.h']),
  c('cpp-clean','development','cpp','clean',{
    'src/vec.h':'#pragma once\n#include <vector>\n\ninline int total(const std::vector<int>& v) {\n  int t = 0;\n  for (size_t i = 0; i < v.size(); i++) t += v[i];\n  return t;\n}\n',
    'src/report.cpp':'#include "vec.h"\n\nint report(const std::vector<int>& v) {\n  return total(v);\n}\n'},
    {'src/vec.h':'#pragma once\n#include <numeric>\n#include <vector>\n\ninline int total(const std::vector<int>& v) {\n  return std::accumulate(v.begin(), v.end(), 0);\n}\n'},
    [],['src/report.cpp']),
];
