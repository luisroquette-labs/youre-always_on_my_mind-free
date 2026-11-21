#!/usr/bin/env node
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(process.env.PUPPETEER_REQUIRE ?? import.meta.url);
const puppeteer = require("puppeteer-core");

const base = process.env.YAOM_URL ?? "http://127.0.0.1:4317/?demo=1";
const out = new URL("../docs/ph/", import.meta.url);
const frames = "/tmp/yaom-ph-frames";
await mkdir(out, { recursive: true });
await mkdir(frames, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1", "--window-size=1440,900"],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
await page.goto(base, { waitUntil: "networkidle0", timeout: 60_000 });
await page.waitForSelector("#scene canvas", { timeout: 20_000 });
await page.waitForFunction(() => document.querySelectorAll(".project-button").length >= 8, { timeout: 20_000 });
await page.waitForFunction(() => /healthy|saudável/i.test(document.querySelector("#health-pill")?.innerText ?? ""), { timeout: 20_000 });
await delay(600);

let frame = 0;
async function shot(name) {
  const file = new URL(name, out);
  await page.screenshot({ path: file, type: "png" });
  for (let copy = 0; copy < 5; copy += 1) {
    await page.screenshot({ path: `${frames}/frame-${String(frame++).padStart(3, "0")}.png`, type: "png" });
    await delay(160);
  }
}

await shot("01-project-graph.png");
await page.click("[data-mode='clusters']");
await page.waitForSelector("#cluster-list .cluster-chip");
await delay(400);
await shot("02-clusters.png");
await page.click("[data-mode='volume']");
await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
await page.evaluate(() => {
  const button = [...document.querySelectorAll(".project-button")].find((item) => item.textContent.includes("Northwind Atlas"));
  button.click();
});
await page.waitForSelector(".memory-card", { timeout: 15_000 });
await page.waitForSelector(".quality-panel", { timeout: 15_000 });
await page.evaluate(() => document.querySelector(".memory-explorer").scrollIntoView({ block: "start" }));
await delay(700);
await shot("03-memory-search.png");
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.evaluate(() => window.scrollTo(0, 0));
await page.click("[data-action='timeline']");
await page.waitForSelector("#growth-chart svg", { timeout: 15_000 });
await delay(400);
await shot("04-timeline.png");
await page.click("[data-close-timeline]");
await page.click("[data-action='alerts']");
await page.waitForSelector(".alert-row", { timeout: 15_000 });
await delay(300);
await shot("05-alerts.png");
await page.click("[data-close-alerts]");
await page.click("[data-action='cleanup']");
await page.waitForSelector(".candidate-row", { timeout: 15_000 });
await page.evaluate(() => document.querySelector(".cleanup-workspace").scrollIntoView({ block: "start" }));
await delay(400);
await shot("06-safe-cleanup.png");
await page.click("[data-close-cleanup]");
await page.click("[data-mode='relations']");
await delay(500);
await shot("07-relations.png");

if (errors.length) {
  console.error(errors.slice(0, 12).join("\n"));
  process.exitCode = 1;
}
await browser.close();

await writeFile(new URL("README.txt", out), "English fictional-demo captures for the Product Hunt gallery. Not real user data.\n");
const ffmpeg = spawn("ffmpeg", ["-y", "-framerate", "4", "-i", `${frames}/frame-%03d.png`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", new URL("walkthrough.mp4", out).pathname], { stdio: "inherit" });
await new Promise((resolve, reject) => ffmpeg.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg mp4 ${code}`))));
const gif = spawn("ffmpeg", ["-y", "-i", new URL("walkthrough.mp4", out).pathname, "-vf", "fps=6,scale=960:-1:flags=lanczos", new URL("walkthrough.gif", out).pathname], { stdio: "inherit" });
await new Promise((resolve, reject) => gif.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg gif ${code}`))));
console.log("Captured docs/ph");
