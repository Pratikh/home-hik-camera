import { ADMIN_STATE } from "./support/qa-env";
import { test, expect } from "./support/fixtures";
import { ROUTES, getCameras } from "./support/app";

/**
 * RULE-UI — multi-select camera/event rules.
 *
 * This spec creates and deletes a rule, so it only runs against a disposable
 * test database. Start the hub with a temporary DATA_DIR and set
 * QA_ALLOW_RULE_MUTATIONS=1. It is skipped by default so a normal QA run can
 * never touch production notification rules.
 */
const MUTATIONS_ALLOWED = process.env.QA_ALLOW_RULE_MUTATIONS === "1";

test.describe("RULE-UI - multi-select notification rules", () => {
  test.skip(!MUTATIONS_ALLOWED, "Set QA_ALLOW_RULE_MUTATIONS=1 and run against a disposable DATA_DIR");
  test.use({ storageState: ADMIN_STATE });
  test.describe.configure({ mode: "serial" });

  test("RULE-UI-001 creates, edits, and preserves a multi-camera/multi-event rule", async ({ page, diag }) => {
    const ruleName = `QA multi ${Date.now()}`;
    const cameras = await getCameras(page);
    expect(cameras.length).toBeGreaterThanOrEqual(3);
    const [first, second, third] = cameras;
    expect(first && second && third).toBeTruthy();

    const rules = await page.request.get("/api/notification-rules");
    expect(rules.status()).toBe(200);
    const before = (await rules.json()) as { rules: Array<{ id: string; name: string }> };
    const existingIds = new Set(before.rules.map((rule) => rule.id));
    let createdId: string | null = null;

    try {
      await page.goto(ROUTES.notificationRules);
      await expect(page.getByRole("heading", { level: 1, name: "Notification rules" })).toBeVisible();
      await page.getByRole("button", { name: "New rule" }).click();

      const form = page.locator("form").filter({ hasText: "New rule" }).first();
      await form.getByPlaceholder("Camera 2 Person Night Alert").fill(ruleName);

      const cameraGroup = form.getByRole("group", { name: "Camera" });
      const eventGroup = form.getByRole("group", { name: "Event" });

      // Blank rules start with All cameras selected. Clear it, then choose two.
      const allCameras = cameraGroup.getByRole("checkbox", { name: "All cameras" });
      await expect(allCameras).toBeChecked();
      await allCameras.click();
      await expect(allCameras).not.toBeChecked();
      await cameraGroup.getByRole("checkbox", { name: first!.name }).check();
      await cameraGroup.getByRole("checkbox", { name: second!.name }).check();
      await expect(cameraGroup.getByRole("checkbox", { name: third!.name })).not.toBeChecked();

      // Person is the default; add Vehicle.
      await eventGroup.getByRole("checkbox", { name: "Vehicle" }).check();
      await expect(eventGroup.getByRole("checkbox", { name: "Person" })).toBeChecked();
      await expect(eventGroup.getByRole("checkbox", { name: "Motion" })).not.toBeChecked();

      await form.getByRole("button", { name: "Save rule" }).click();
      await expect(page.getByText("Rule created.")).toBeVisible();

      const afterCreate = (await (await page.request.get("/api/notification-rules")).json()) as {
        rules: Array<{ id: string; name: string; cameraIds: number[]; eventTypes: string[] }>;
      };
      const created = afterCreate.rules.find((rule) => rule.name === ruleName);
      expect(created, "the API must return the new rule").toBeTruthy();
      createdId = created!.id;
      expect(created!.cameraIds.sort()).toEqual([first!.id, second!.id].sort());
      expect(created!.eventTypes.sort()).toEqual(["person", "vehicle"]);

      // The rule appears in the list with the selected camera and event labels.
      const row = page.locator("li").filter({ hasText: ruleName }).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText(first!.name);
      await expect(row).toContainText(second!.name);
      await expect(row).toContainText("Person, Vehicle");

      // Edit: every selected value must round-trip into the checkboxes.
      await row.getByRole("button", { name: "Edit" }).click();
      const editForm = page.locator("form").filter({ hasText: "Edit rule" }).first();
      const editCameras = editForm.getByRole("group", { name: "Camera" });
      const editEvents = editForm.getByRole("group", { name: "Event" });
      await expect(editCameras.getByRole("checkbox", { name: first!.name })).toBeChecked();
      await expect(editCameras.getByRole("checkbox", { name: second!.name })).toBeChecked();
      await expect(editCameras.getByRole("checkbox", { name: third!.name })).not.toBeChecked();
      await expect(editCameras.getByRole("checkbox", { name: "All cameras" })).not.toBeChecked();
      await expect(editEvents.getByRole("checkbox", { name: "Person" })).toBeChecked();
      await expect(editEvents.getByRole("checkbox", { name: "Vehicle" })).toBeChecked();
      await expect(editEvents.getByRole("checkbox", { name: "Motion" })).not.toBeChecked();

      // Uncheck one camera and save. Reopen: only the remaining one is checked.
      await editCameras.getByRole("checkbox", { name: second!.name }).uncheck();
      await editForm.getByRole("button", { name: "Save rule" }).click();
      await expect(page.getByText("Rule saved.")).toBeVisible();

      const editedRow = page.locator("li").filter({ hasText: ruleName }).first();
      await editedRow.getByRole("button", { name: "Edit" }).click();
      const reopened = page.locator("form").filter({ hasText: "Edit rule" }).first();
      const reopenedCameras = reopened.getByRole("group", { name: "Camera" });
      await expect(reopenedCameras.getByRole("checkbox", { name: first!.name })).toBeChecked();
      await expect(reopenedCameras.getByRole("checkbox", { name: second!.name })).not.toBeChecked();
      await expect(reopenedCameras.getByRole("checkbox", { name: third!.name })).not.toBeChecked();
      await expect(reopened.getByRole("group", { name: "Event" }).getByRole("checkbox", { name: "Vehicle" })).toBeChecked();

      const afterEdit = (await (await page.request.get("/api/notification-rules")).json()) as {
        rules: Array<{ id: string; cameraIds: number[]; eventTypes: string[] }>;
      };
      const updated = afterEdit.rules.find((rule) => rule.id === createdId);
      expect(updated?.cameraIds).toEqual([first!.id]);
      expect(updated?.eventTypes.sort()).toEqual(["person", "vehicle"]);
      diag.expectClean();
    } finally {
      if (createdId) await page.request.delete(`/api/notification-rules/${createdId}`).catch(() => undefined);
      const after = (await (await page.request.get("/api/notification-rules")).json()) as {
        rules: Array<{ id: string }>;
      };
      expect(after.rules.some((rule) => !existingIds.has(rule.id) && rule.id === createdId)).toBe(false);
    }
  });

  test("RULE-UI-002 refuses to save with no camera or no event selected", async ({ page, diag }) => {
    await page.goto(ROUTES.notificationRules);
    await page.getByRole("button", { name: "New rule" }).click();
    const form = page.locator("form").filter({ hasText: "New rule" }).first();
    const cameraGroup = form.getByRole("group", { name: "Camera" });
    const eventGroup = form.getByRole("group", { name: "Event" });

    // No cameras: clear the default All cameras selection and try to save.
    await cameraGroup.getByRole("checkbox", { name: "All cameras" }).click();
    await expect(cameraGroup.getByRole("checkbox", { name: "All cameras" })).not.toBeChecked();
    await form.getByRole("button", { name: "Save rule" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Select at least one camera." })).toBeVisible();

    // Restore one camera, then remove every event.
    await cameraGroup.getByRole("checkbox", { name: "All cameras" }).click();
    for (const label of ["Person", "Vehicle", "Motion"]) {
      const box = eventGroup.getByRole("checkbox", { name: label });
      if (await box.isChecked()) await box.uncheck();
    }
    await form.getByRole("button", { name: "Save rule" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Select at least one event." })).toBeVisible();

    // Nothing was created: the form is still the only editable state.
    await form.getByRole("button", { name: "Cancel" }).click();
    diag.expectClean();
  });
});
