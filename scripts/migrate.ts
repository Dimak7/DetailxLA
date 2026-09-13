import { database, closeDatabase } from "../lib/platform/db";
async function main() {
  await database();
  console.log("West Loop relational schema is ready.");
  await closeDatabase();
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
