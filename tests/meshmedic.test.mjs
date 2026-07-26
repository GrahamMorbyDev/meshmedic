import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("repository metadata identifies MeshMedic as MIT licensed", async () => {
  const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const licence = await readFile(new URL("LICENSE", root), "utf8");

  assert.equal(packageJson.name, "meshmedic");
  assert.equal(packageJson.license, "MIT");
  assert.match(licence, /MIT License/);
  assert.match(licence, /Copyright \(c\) 2026 Grey Patrick/);
});

test("analytics is optional and never uses the production ID in source", async () => {
  const [layout, consent, example] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/analytics-consent.tsx", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);

  assert.match(layout, /process\.env\.GA_MEASUREMENT_ID/);
  assert.match(consent, /if \(!measurementId\) return null/);
  assert.match(consent, /analytics_storage: "granted"/);
  assert.match(consent, /ad_storage: "denied"/);
  assert.match(consent, /dataLayer\.push\(arguments\)/);
  assert.match(consent, /send_page_view: true/);
  assert.match(consent, /meshmedic_analytics_enabled/);
  assert.match(example, /GA_MEASUREMENT_ID=/);
  assert.doesNotMatch(`${layout}\n${consent}\n${example}`, /G-[A-Z0-9]{10}/);
});

test("public copy accurately describes local STL processing", async () => {
  const studio = await readFile(new URL("app/repair-studio.tsx", root), "utf8");

  assert.match(studio, /your file stays private/i);
  assert.match(studio, /Analysis, visualisation and repair run locally in the browser/i);
  assert.match(studio, /Compare the original and repaired mesh before downloading/i);
});
