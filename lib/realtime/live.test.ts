import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { POLL_MS, cordonTopics, createRefreshScheduler, statusFromSubscribe, vaultTopics } from "./live.ts";

const ID = "3f2b8c1e-9a4d-4e7b-8c55-0d1f6a7b9e21";

test("cordonTopics: satu langganan nav_points yang difilter ke Cordon itu", () => {
  assert.deepEqual(cordonTopics(ID), [{ table: "nav_points", filter: `cordon_id=eq.${ID}` }]);
});

test("vaultTopics: satu langganan rounds yang difilter ke vault itu", () => {
  assert.deepEqual(vaultTopics(ID), [{ table: "rounds", filter: `vault_id=eq.${ID}` }]);
});

test("id yang bukan UUID tidak pernah masuk ke string filter", () => {
  for (const bad of ["", "c1", "abc", `${ID}x`, `${ID},vault_id=eq.x`, "1' or '1'='1", `${ID}\n`, "../etc/passwd"]) {
    assert.deepEqual(cordonTopics(bad), [], `cordon: ${JSON.stringify(bad)}`);
    assert.deepEqual(vaultTopics(bad), [], `vault: ${JSON.stringify(bad)}`);
  }
});

test("statusFromSubscribe: hanya SUBSCRIBED yang dianggap live", () => {
  assert.equal(statusFromSubscribe("SUBSCRIBED"), "live");
  for (const s of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]) assert.equal(statusFromSubscribe(s), "paused");
});

test("interval polling saat jeda adalah satu menit", () => {
  assert.equal(POLL_MS, 60_000);
});

test("scheduler: rentetan event menjadi satu run setelah jeda sejak event terakhir", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    let runs = 0;
    const s = createRefreshScheduler(() => { runs++; }, { delayMs: 800, maxWaitMs: 5000 });
    s.schedule();
    mock.timers.tick(500);
    s.schedule(); // event kedua mengundurkan jadwal
    mock.timers.tick(500);
    assert.equal(runs, 0, "belum boleh jalan: baru 500ms sejak event terakhir");
    assert.equal(s.pending, true);
    mock.timers.tick(300);
    assert.equal(runs, 1);
    assert.equal(s.pending, false);
  } finally { mock.timers.reset(); }
});

test("scheduler: aliran event tanpa henti tetap menyegarkan paling lambat tiap maxWaitMs", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    let runs = 0;
    const s = createRefreshScheduler(() => { runs++; }, { delayMs: 800, maxWaitMs: 5000 });
    // event tiap 500ms selama 6 detik: tanpa batas maksimum, run tidak akan pernah terjadi.
    for (let t = 0; t < 6000; t += 500) { s.schedule(); mock.timers.tick(500); }
    assert.ok(runs >= 1, "harus sudah jalan sekali sebelum 6 detik");
    assert.ok(runs <= 2, `tidak boleh jalan terlalu sering (runs=${runs})`);
  } finally { mock.timers.reset(); }
});

test("scheduler: cancel membatalkan run yang tertunda dan bisa dijadwalkan lagi", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    let runs = 0;
    const s = createRefreshScheduler(() => { runs++; });
    s.schedule();
    s.cancel();
    mock.timers.tick(10_000);
    assert.equal(runs, 0);
    assert.equal(s.pending, false);
    s.schedule();
    mock.timers.tick(800);
    assert.equal(runs, 1);
  } finally { mock.timers.reset(); }
});

test("scheduler: setelah run, event berikutnya mulai hitungan maxWait yang baru", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    let runs = 0;
    const s = createRefreshScheduler(() => { runs++; }, { delayMs: 800, maxWaitMs: 5000 });
    s.schedule(); mock.timers.tick(800);
    assert.equal(runs, 1);
    mock.timers.tick(60_000); // lama tidak ada event
    s.schedule(); mock.timers.tick(799);
    assert.equal(runs, 1, "tidak langsung jalan karena firstAt lama");
    mock.timers.tick(1);
    assert.equal(runs, 2);
  } finally { mock.timers.reset(); }
});
