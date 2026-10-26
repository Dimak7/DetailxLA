/** Canonical choices for expense entry. Existing expense amounts are unchanged. */
export const expenseDirectorySchema = `
CREATE TABLE IF NOT EXISTS wl.expense_directory (
 kind text NOT NULL CHECK(kind IN ('vendor','category')),
 canonical_key text NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
 created_by uuid REFERENCES wl.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(kind,canonical_key)
);
INSERT INTO wl.expense_directory(kind,canonical_key,name)
SELECT 'category',lower(name),name FROM unnest(ARRAY[
 'Rent','Utilities','Payroll','Chemicals','Equipment','Supplies','Insurance',
 'Advertising','Software','Vehicle','Repairs','Taxes / Fees','Other'
]) name ON CONFLICT DO NOTHING;
INSERT INTO wl.expense_directory(kind,canonical_key,name)
SELECT DISTINCT ON (kind,canonical_key) kind,canonical_key,name FROM (
 SELECT 'vendor' kind,lower(regexp_replace(btrim(vendor),'\\s+',' ','g')) canonical_key,
 regexp_replace(btrim(vendor),'\\s+',' ','g') name,created_at FROM wl.expenses
 WHERE length(btrim(vendor))>=2
 UNION ALL
 SELECT 'category',lower(regexp_replace(btrim(category),'\\s+',' ','g')),
 regexp_replace(btrim(category),'\\s+',' ','g'),created_at FROM wl.expenses
 WHERE length(btrim(category))>=2
) existing ORDER BY kind,canonical_key,created_at,name ON CONFLICT DO NOTHING;
UPDATE wl.expenses e SET vendor=d.name FROM wl.expense_directory d
WHERE d.kind='vendor' AND d.canonical_key=lower(regexp_replace(btrim(e.vendor),'\\s+',' ','g'))
AND e.vendor<>d.name;
UPDATE wl.expenses e SET category=d.name FROM wl.expense_directory d
WHERE d.kind='category' AND d.canonical_key=lower(regexp_replace(btrim(e.category),'\\s+',' ','g'))
AND e.category<>d.name;
`;
