import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const migrationFiles = [
  "db/001_schema.sql",
  "db/002_seed.sql",
  "db/003_auth_and_management.sql",
  "db/004_operations.sql",
  "db/005_shared_access.sql",
  "db/006_role_shift_rules.sql",
  "db/007_simple_halfday_flow.sql",
  "db/008_audio_rotation_and_news_coverage.sql",
  "db/009_leave_pin_and_substitute_rules.sql",
  "db/010_relay_leave_without_substitute.sql",
];

function splitSql(input) {
  const statements = [];
  let buffer = "";
  let index = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockComment = false;
  let dollarTag = null;

  while (index < input.length) {
    const character = input[index];
    const nextCharacter = input[index + 1];

    if (lineComment) {
      buffer += character;
      index += 1;
      if (character === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      buffer += character;
      if (character === "*" && nextCharacter === "/") {
        buffer += nextCharacter;
        index += 2;
        blockComment = false;
      } else {
        index += 1;
      }
      continue;
    }

    if (dollarTag) {
      if (input.startsWith(dollarTag, index)) {
        buffer += dollarTag;
        index += dollarTag.length;
        dollarTag = null;
      } else {
        buffer += character;
        index += 1;
      }
      continue;
    }

    if (singleQuoted) {
      buffer += character;
      index += 1;
      if (character === "'") {
        if (input[index] === "'") {
          buffer += input[index];
          index += 1;
        } else {
          singleQuoted = false;
        }
      }
      continue;
    }

    if (doubleQuoted) {
      buffer += character;
      index += 1;
      if (character === '"') {
        if (input[index] === '"') {
          buffer += input[index];
          index += 1;
        } else {
          doubleQuoted = false;
        }
      }
      continue;
    }

    if (character === "-" && nextCharacter === "-") {
      buffer += character + nextCharacter;
      index += 2;
      lineComment = true;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      buffer += character + nextCharacter;
      index += 2;
      blockComment = true;
      continue;
    }

    if (character === "'") {
      buffer += character;
      index += 1;
      singleQuoted = true;
      continue;
    }

    if (character === '"') {
      buffer += character;
      index += 1;
      doubleQuoted = true;
      continue;
    }

    if (character === "$") {
      const match = input
        .slice(index)
        .match(/^(\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$)/);
      if (match) {
        dollarTag = match[1];
        buffer += dollarTag;
        index += dollarTag.length;
        continue;
      }
    }

    if (character === ";") {
      if (buffer.trim()) statements.push(buffer.trim());
      buffer = "";
      index += 1;
      continue;
    }

    buffer += character;
    index += 1;
  }

  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL이 설정되지 않았습니다.");
}

const sql = neon(databaseUrl);

for (const file of migrationFiles) {
  const source = await readFile(file, "utf8");
  const statements = splitSql(source);

  for (const statement of statements) {
    await sql.query(statement, []);
  }

  console.log(`MIGRATION_OK ${file} (${statements.length})`);
}

const employeeRows = await sql.query(
  "SELECT COUNT(*)::int AS count FROM employees",
  [],
);
const tableRows = await sql.query(
  "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'",
  [],
);

console.log(
  `MIGRATION_VERIFY tables=${tableRows[0].count} employees=${employeeRows[0].count}`,
);
