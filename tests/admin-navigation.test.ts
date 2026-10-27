import assert from "node:assert/strict";
import test from "node:test";
import { adminLandingPage, adminNavigation } from "../lib/platform/admin-navigation";
import { access } from "../lib/platform/auth";

test("each role can reach its permitted workspaces without forbidden default links", () => {
  for (const role of ["owner", "admin", "manager", "staff"] as const) {
    const allowed = Object.keys(access).filter((section) => access[section].includes(role));
    const landing = adminLandingPage(role).split("/").at(-1)!;
    assert.ok(allowed.includes(landing), `${role} lands in an allowed workspace`);
    assert.equal(landing, role === "staff" ? "my_schedule" : "dashboard");
    const navigation = adminNavigation(allowed);
    assert.ok(navigation.every(w=>!w.sections.includes("messages")&&!w.sections.includes("gallery")));
    for (const workspace of navigation) {
      assert.ok(allowed.includes(workspace.target));
      assert.ok(workspace.sections.every((section) => allowed.includes(section)));
    }
    if (role === "manager") {
      assert.equal(navigation.find((workspace) => workspace.label === "Money")?.target, "payments");
      assert.equal(navigation.find((workspace) => workspace.label === "Growth"), undefined);
    }
    if (role === "staff") {
      assert.deepEqual(navigation.map((workspace) => workspace.target), ["my_schedule"]);
      assert.equal(navigation[0].label, "My schedule");
    }
  }
});

 test("each section appears in one navigation group and Schedule stays with the team", () => {
  const navigation = adminNavigation(Object.keys(access));
  const sections = navigation.flatMap(workspace => workspace.sections);
  assert.equal(new Set(sections).size, sections.length);
  assert.ok(navigation.find(workspace => workspace.label === "Team")?.sections.includes("schedule"));
  assert.ok(!navigation.find(workspace => workspace.label === "Bookings")?.sections.includes("schedule"));
});
