# Nutri – a private Cronometer-style tracker

A nutrition tracker for iPhone and Android, built with Expo (SDK 57) and TypeScript, for two people sharing one set of foods but separate diaries.

- **Accurate data, offline:** 19,913 foods bundled in the app — USDA FoodData Central (Foundation, SR Legacy, FNDDS) plus the German Bundeslebensmittelschlüssel (BLS 4.0) — with up to 41 nutrients each. Packaged foods via barcode lookup on Open Food Facts.
- **Fast logging:** search in English or German, one-tap re-logging of recent foods (with your last amount), household units (cup, slice, piece…), grams/ounces, quick add, custom foods, saved meals, copy the previous day or a single meal.
- **Tracking:** diary by meal, calorie/macro/micronutrient targets with progress (US DRIs by age and sex), BMR/TDEE-based calorie target per person, weight log, 7/14/30-day trends and a watch list of gaps and excesses.
- **Your data stays on the phone** (SQLite). Export/import a JSON backup at any time.
- **Optional AI** (off until you set it up): describe or dictate a meal, photograph a plate, read a nutrition label, weekly insights. Runs through your own small server so no API key is in the app. See [server/README.md](server/README.md).

---

## 1. Install on your phones

Pick one option. All of them need [Node.js 20+](https://nodejs.org) on a computer and this folder. The project uses **pnpm** (install scripts blocked by default, versions younger than 24 h refused; see `pnpm-workspace.yaml`):

```bash
corepack enable        # once; provides the pinned pnpm version
cd app
pnpm install
```

### Option A — Expo Go (free, quickest, good for trying it)

The app runs inside the free **Expo Go** app, loaded from your computer.

1. Install **Expo Go** on both phones (App Store / Google Play). It must support SDK 57 (the current store version does).
2. On the computer: `pnpm expo start`
3. iPhone: scan the QR code with the Camera app. Android: scan it in Expo Go.
   Phones and computer must be on the same Wi-Fi. On iPhone, allow Expo Go under Settings → Privacy & Security → Local Network, or it hangs on "Opening project…".
4. If it still can't connect (guest Wi-Fi, client isolation, mobile data): run `pnpm expo login` on the computer, sign in to Expo Go with the same account, then use `pnpm expo start --tunnel`. Every phone opening a tunnel project must be signed in to Expo Go with that account (sign out afterwards on a partner's phone), or use Option B for Android.

Limits: the computer must be running `pnpm expo start` whenever the app is opened from scratch, and data lives inside Expo Go. For daily use, build a real app (Option B/C). Export a backup before switching, then import it in the installed app.

### Option B — Android: installable APK (free)

1. Create a free account at [expo.dev](https://expo.dev), then:
   ```bash
   pnpm dlx eas-cli@latest login
   pnpm dlx eas-cli@latest build --platform android --profile preview
   ```
   The first run asks to create the project and a signing key — accept (EAS stores the key).
2. When the cloud build finishes (~10–20 min), open the printed link on the Android phone, download the APK, and allow "install unknown apps" when prompted.

The installed app runs on its own: code and food database are inside the APK, your data is on the phone, so the computer is only needed to build new versions (barcode lookup and AI still need internet). Code changes reach the phone only through a new build.

Updates: rebuild and install the new APK over the old one — data is kept as long as the same signing key is used (EAS reuses it automatically).

### Option C — iPhone: installed app via EAS (needs Apple Developer Program, 99 €/year)

Apple does not allow installing your own apps permanently without a paid developer account.

1. Join the [Apple Developer Program](https://developer.apple.com/programs/).
2. Register both iPhones (each person opens the link on their iPhone and installs the profile):
   ```bash
   pnpm dlx eas-cli@latest device:create
   ```
3. Build (sign in with your Apple ID when asked; EAS creates certificates and the ad hoc profile):
   ```bash
   pnpm dlx eas-cli@latest build --platform ios --profile preview
   ```
4. Open the printed link on each iPhone and tap Install. On iOS 16+, enable **Settings → Privacy & Security → Developer Mode** once.

A new device later requires `device:create` and a new build. Alternatively use TestFlight: `pnpm dlx eas-cli@latest build --platform ios --profile production` then `pnpm dlx eas-cli@latest submit --platform ios`.

### Both platforms at once

```bash
pnpm dlx eas-cli@latest build --platform all --profile preview
```

---

## 2. First start

1. The app asks for a profile (name, sex, birth year, height, weight, activity, goal). Targets are calculated immediately; you can adjust the macro split or set a fixed calorie target.
2. Each phone has its own database. If you both use one phone, add a second profile under **Profile → + Add profile** and switch with the chips at the top of the diary.
3. Logging: **Search** (or **+ Add** on a meal) → pick a food → choose unit and amount → Add. Next time the food appears under *Recent* with a **+** for one-tap logging. AI-logged items appear there too, so yesterday's AI meal can be re-logged without typing or a photo.
4. Barcode: **Scan**. Found products are saved to *My foods* (shared by all profiles on the phone). Unknown products can be entered from the label.
5. Swipe left/right on the diary to change the day. Tap a diary entry to edit it, long-press to delete or copy to today.
6. Below each meal: **Save as meal** (tick the foods to include) or **Copy yesterday's …** when the meal is empty, and **Saved meals** to log a saved one.

## 3. Backups

**Profile → Backup → Export** creates a JSON file and opens the share sheet (save to Files/Google Drive, or AirDrop it). **Import** merges a backup into the phone (same IDs are overwritten, nothing else deleted). The file contains your diary and body data — keep it private.

Moving to a new phone or from Expo Go to an installed build: Export on the old one, Import on the new one.

## 4. Optional AI assistant

1. Deploy the server once: follow [server/README.md](server/README.md) (Cloudflare account + Gemini API key; the free tier works for trying it, the paid tier keeps your data out of training; expected paid cost roughly 1–3 €/month for two people, hard-capped by rate limits).
2. On each phone: **Profile → AI assistant**, enter the server URL and that phone's device token → **Test connection**.
3. Use **✨ AI** in the diary. For each food the AI suggests an amount and its own nutrient estimate (energy, macros, fibre, sugars, saturated fat, sodium); you can swap in a lab-measured database match instead, which also brings vitamins and minerals. Set the amount you ate with the ½ × / 1 × / 1½ × / 2 × buttons (multiples of the AI's portion guess) or type grams; the kcal/macros for that amount update live. Results are always shown for confirmation before anything is logged.

Privacy: only what you type, photos you pick (downscaled, no location metadata) and aggregated nutrient averages are sent. Never name, age or weight. Remove the setup to turn AI off; everything else works without it.

---

## Data accuracy notes

- Values are per 100 g from the source databases and scaled by the grams you log. A nutrient that the source doesn't list is shown as "no data" (not zero), and daily totals show how many items lacked data.
- BLS carbohydrates are shown as **total** carbohydrate (available carbohydrate + fibre) to match USDA; net carbs are shown on the Nutrients screen.
- Open Food Facts data is community-entered. The app flags implausible products (calories not matching macros, >100 g per 100 g) — double-check those against the label.
- Targets are US Dietary Reference Intakes (age/sex-specific) and Mifflin-St Jeor + activity factor for energy. Not medical advice.

## Development

| Task | Command |
| --- | --- |
| Start dev server | `pnpm expo start` |
| Add a dependency | `pnpm expo install <package>` (picks the SDK-compatible version) |
| Type-check | `pnpm typecheck` |
| Tests | `pnpm test` |
| Lint | `pnpm lint` |
| Diagnose | `pnpm dlx expo-doctor` |
| Rebuild food database | `pnpm build:foods` (downloads USDA/BLS into `data-raw/`, git-ignored; bump `FOOD_DB_VERSION` in `src/data/foodDbVersion.ts` so installed apps replace their copy) |

Structure: routes in `src/app` (Expo Router), pure logic in `src/domain` (tested), SQLite access in `src/data`, UI pieces in `src/ui`, food-database build in `scripts/`, AI proxy in `server/`. Native `ios/`/`android/` folders are generated by EAS — don't commit or edit them.

Known dependency advisory: `decode-uri-component` (moderate, via Expo Router's `query-string`) — only reachable through malformed deep links on your own device; the patched version is ESM-only and would break Expo Router, so it is left until Expo updates it.

## Data sources & licences

- U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. Public domain.
- Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 – Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0. CC BY 4.0 (values converted to app units).
- Open Food Facts, © contributors, Open Database License (ODbL).
