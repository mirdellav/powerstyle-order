# Powerstyle-0rder

A free, browser-based restock ordering tool for Powerstyle Ltd. Search or scan a
product, enter how many boxes you need (variations supported), and export/share
the order as a PDF — from a MacBook, iPad or iPhone, with everything **synced
live across all of them**.

It's a static web app (no server to run or pay for) backed by a free Firebase
Firestore database for real-time sync, so you can start an order at the office
on the PC, walk out, and keep editing it on your phone — it just carries on
from wherever you left off, and syncs again automatically if you lose signal
along the way.

## What it does

- **Order tab** — search 225 pre-loaded Powerstyle products, filter by
  category, or scan a barcode with the camera. Add a product, type the number
  of boxes, and the piece count is calculated automatically from that
  product's "units per box" setting. The whole draft order (including who
  the supplier is) is **shared live** — open the app on another device and
  it's already there.
- **Variations** — a product like *TSF Shaving Gel* can have variations
  (e.g. Sapphire / Cristal / Golden), each with its own units-per-box. Boxes
  entered per variation roll up automatically into the product's total.
- **Catalog tab** — add brand-new products, edit units-per-box, barcode and
  variations for any existing one, or delete a product entirely. Every change
  appears on every device within a second or two.
- **PDF export** — one click produces a clean PDF listing each product and its
  order quantity (e.g. `TSF Shaving Gel — 1 box (12 pcs)`), with variation
  breakdowns indented underneath.
- **Sharing** —
  - **Share PDF…** uses your device's native share sheet, so the actual PDF
    file is attached to WhatsApp, Mail, AirDrop, etc. (works on iPhone/iPad
    Safari and most Android browsers).
  - **WhatsApp / Email (text list)** are a fallback for browsers without file
    sharing (e.g. desktop Chrome) — they open a plain-text copy of the order,
    since a link can't attach a file directly.
- **History tab** — every order you share is saved to the cloud, visible from
  any device.
- **Barcode scanning** — uses the camera (via `html5-qrcode`) to read a
  barcode and jump straight to that product. Add barcodes for products that
  don't have one yet from the Catalog tab.
- **Works offline, catches up later** — Firestore caches data on the device
  and queues up any changes you make while offline, syncing them the moment
  you're back online. A status dot in the top bar shows *Synced* /
  *Offline — will sync later*.

## Files

```
powerstyle-order/
├── index.html            the app shell
├── style.css              styling
├── app.js                  all app logic (real-time Firestore sync)
├── firebase-config.js      YOUR Firebase project keys go here
├── firestore.rules         security rules to paste into Firebase console
├── data/
│   └── products.json      starter catalog, converted from export_items.csv
└── README.md               this file
```

Everything runs from CDNs (Firebase, jsPDF, html5-qrcode) — no `npm install`,
no build step, just static files.

## Part 1 — create your free Firebase project (~5 minutes)

This is the piece that makes real-time, cross-device sync possible, and it's
free (Firebase's "Spark" plan — no credit card required, 1 GiB storage,
50,000 reads / 20,000 writes per day, far more than this app will ever use).

1. Go to **[console.firebase.google.com](https://console.firebase.google.com)**
   and sign in with any Google account.
2. **Add project** → name it e.g. `powerstyle-order` → you can turn off
   Google Analytics (not needed) → **Create project**.
3. In the left sidebar: **Build → Firestore Database** → **Create database**
   → choose a location close to you → start in **production mode** →
   **Enable**.
4. Still in Firestore, open the **Rules** tab, delete the default contents,
   and paste in everything from this project's `firestore.rules` file →
   **Publish**.
5. In the left sidebar: **Build → Authentication** → **Get started** → under
   **Sign-in method**, enable **Anonymous** → **Save**. (This lets the app
   sign devices in automatically, with no login screen, while keeping the
   database closed to the public internet at large.)
6. In the left sidebar, click the gear icon → **Project settings** → scroll
   to **Your apps** → click the **</>** (Web) icon → nickname it
   `powerstyle-order` → **Register app**. Firebase will show a code block
   containing a `firebaseConfig = { ... }` object.
7. Copy those values into **`firebase-config.js`** in this project, replacing
   the placeholder `YOUR_...` strings.

That's the entire backend. There's no server to run, deploy, or maintain.

## Part 2 — put the code on GitHub

1. Go to [github.com](https://github.com) and sign in (or create a free
   account).
2. Click **+ → New repository**, name it `powerstyle-order`, either
   Public or Private, don't add a README/gitignore → **Create repository**.
3. Upload all the files from the `powerstyle-order` folder (drag-and-drop
   works in the GitHub web UI, or use the terminal):
   ```bash
   cd powerstyle-order
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/powerstyle-order.git
   git push -u origin main
   ```

   **Important:** `firebase-config.js` contains identifiers for your project
   (not secret keys — real protection is the Firestore rules), so it's fine
   to commit as-is. If your repo is public and you'd rather keep it out of
   git entirely, add `firebase-config.js` to a `.gitignore` and instead paste
   its contents directly in Vercel's environment/edit step — but for a small
   internal tool, committing it is the simplest path and is standard practice
   for Firebase web apps.

## Part 3 — deploy for free on Vercel

1. Go to [vercel.com](https://vercel.com) → **Sign up** → **Continue with
   GitHub** (free "Hobby" plan, no card needed).
2. **Add New… → Project** → select the `powerstyle-order` repo → **Import**.
3. Vercel auto-detects it as a static site — leave all settings default (no
   framework, no build command) → **Deploy**.
4. After ~30 seconds you'll get a live URL like
   `https://powerstyle-order.vercel.app`. Open it on your MacBook, iPad and
   iPhone (Add to Home Screen on iOS/iPadOS for an app-like icon).

Any time you `git push` a change, Vercel redeploys automatically.

*(Alternative: GitHub Pages also works and is free — repo Settings → Pages →
Deploy from branch `main`, folder `/root`. Either host is fine; both give you
HTTPS, which the camera requires on a real device.)*

## Using it day to day

1. **First-time setup (Catalog tab):** go through the products you order
   regularly and set their real **units per box**; add **variations** where
   relevant (name + units per box for each). Use **+ Add product** for
   anything not already in the starter list. This only needs doing once per
   product, and every device sees it immediately.
2. **Placing an order (Order tab):** search or scan a product, tap **+** to
   add it, type the number of boxes (or per variation). Totals update as you
   type, and the same draft is visible — and editable — from any signed-in
   device. Start it at the office, finish it in the car.
3. **Sending it:** tap **Share order** → **Share PDF…** to open your device's
   share sheet and send the real PDF straight to WhatsApp/Email/AirDrop, or
   use the plain-text WhatsApp/Email buttons on browsers without file
   sharing.
4. Sent orders land in the **History** tab (synced across devices too) so you
   can reload and reuse them next time.

## Adding barcodes

1. Open **Catalog**, find the product, tap **Edit**.
2. Tap into the **Barcode** field and scan it with a handheld scanner (most
   act as a keyboard) or type it manually.
3. Save. From then on, scanning that barcode in the Order tab adds the
   product automatically, on every device.

## Customising

- **Colours / branding:** edit the CSS variables at the top of `style.css`
  (`--ink`, `--brass`, `--paper`, etc).
- **App name:** shown in `index.html` (`<title>`) and the header
  (`.brand-text strong`).
- **Starting fresh with a different product list:** replace
  `data/products.json` before your first deploy (or before the catalog has
  any products yet) — the app seeds Firestore from that file automatically
  the first time it finds an empty catalog.

## A note on access control

Anyone who opens your app's URL is signed in automatically (anonymously) and
can read/write the catalog and orders — there's no username/password screen.
For a small internal team tool sharing one link privately, this is a
reasonable trade-off for zero setup friction. If you'd rather require a login,
Firebase Authentication also supports email/password or Google sign-in with a
small code change — worth doing if the link were ever shared more widely than
intended.
