import assert from "node:assert/strict";
import test from "node:test";
import { adminNavigation } from "../lib/platform/admin-navigation";
import { access } from "../lib/platform/auth";

test("each role can reach its permitted workspaces without forbidden default links", () => {
  for (const role of ["owner", "admin", "manager", "staff"] as const) {
    const allowed = Object.keys(access).filter((section) => access[section].includes(role));
    const navigation = adminNavigation(allowed);
    for (const workspace of navigation) {
      assert.ok(allowed.includes(workspace.target));
      assert.ok(workspace.sections.every((section) => allowed.includes(section)));
    }
    if (role === "manager") {
      assert.equal(navigation.find((workspace) => workspace.label === "Operations")?.target, "payments");
      assert.equal(navigation.find((workspace) => workspace.label === "Growth")?.target, "messages");
    }
    if (role === "staff") {
      assert.deepEqual(navigation.map((workspace) => workspace.target), ["bookings", "my_schedule"]);
      assert.equal(navigation[1].label, "My schedule");
    }
  }
});
