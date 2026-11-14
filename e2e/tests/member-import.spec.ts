import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { api, sharedCollection } from "../support/api";

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

/** Invites a member and signs them in with the emailed sign-in link or code. */
async function signInAsNewMember(page: Page, request: APIRequestContext) {
  const email = `member-${Date.now().toString(36)}@example.com`;
  await api(request, "users.invite", { invites: [{ email, name: "Max Member", role: "member" }] });

  await page.goto("/");
  await page.getByRole("button", { name: /Continue with Email/i }).click();
  await page.getByRole("textbox").first().fill(email);
  await page.keyboard.press("Enter");

  let body = "";
  await expect
    .poll(async () => {
      const list = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
      const message = list.messages?.find((m: { Subject: string }) => /sign-in|sign in|code/i.test(m.Subject));
      if (!message) return "";
      body = (await (await request.get(`${MAILPIT}/api/v1/message/${message.ID}`)).json()).Text;
      return body;
    }, { timeout: 30_000 })
    .not.toBe("");

  const link = body.match(/https?:\/\/\S+\/auth\/email\.callback\?\S+/)?.[0];
  if (link) {
    await page.goto(link);
  } else {
    const code = body.match(/\b\d{6}\b/)?.[0] ?? "";
    await page.getByRole("textbox").first().fill(code);
    await page.keyboard.press("Enter");
  }
  await expect(page.getByRole("link", { name: "Search" })).toBeVisible({ timeout: 30_000 });
}

test.describe("Import", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a member imports a markdown file into a collection", async ({ page, request }) => {
    await signInAsNewMember(page, request);

    const collection = sharedCollection();
    await page.goto(collection.url);
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "standup.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Standup\n\n## Yesterday\n\nReviewed the roadmap."),
    });
    await expect(page).toHaveURL(/\/doc\//, { timeout: 30_000 });
    await expect(page.locator(".ProseMirror").first().getByText("Reviewed the roadmap.")).toBeVisible();
  });
});
